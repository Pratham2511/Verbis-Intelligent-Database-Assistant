"""Schema Change Impact Predictor — Component 9.

Implements Novel Contribution #9 (Schema Change Impact Predictor).

Pipeline:
    1. Intercept DDL (ALTER TABLE, DROP TABLE, RENAME COLUMN, etc.)
    2. Parse all saved queries in history.json via sqlglot AST
    3. Extract table/column dependency graph from each AST
    4. Cross-reference against the proposed DDL change
    5. Categorize each query: WILL_BREAK / NEEDS_REVIEW / UNAFFECTED
    6. Auto-rewrite queries affected by simple column/table renames
"""

from __future__ import annotations

import re
from typing import Dict, List, Tuple
from loguru import logger

try:
    import sqlglot
    from sqlglot import exp
    SQLGLOT_AVAILABLE = True
except ImportError:
    SQLGLOT_AVAILABLE = False

from models.requests import ImpactResponse, BreakageEntry


# ─── DDL parsing ────────────────────────────────────────────────────────
DDL_PATTERNS = [
    # ALTER TABLE <t> RENAME COLUMN <old> TO <new>
    (re.compile(r'ALTER\s+TABLE\s+(\w+)\s+RENAME\s+COLUMN\s+(\w+)\s+TO\s+(\w+)', re.I),
     'column_rename'),
    # ALTER TABLE <t> DROP COLUMN <c>
    (re.compile(r'ALTER\s+TABLE\s+(\w+)\s+DROP\s+COLUMN\s+(\w+)', re.I),
     'column_drop'),
    # ALTER TABLE <t> RENAME TO <new>
    (re.compile(r'ALTER\s+TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+)', re.I),
     'table_rename'),
    # DROP TABLE <t>
    (re.compile(r'DROP\s+TABLE\s+(\w+)', re.I),
     'table_drop'),
]


class SchemaImpactPredictor:
    def __init__(self, history_store) -> None:
        self.history = history_store

    def predict(self, ddl: str, db_config_id: str) -> ImpactResponse:
        # 1. Parse DDL to extract affected object(s)
        affected = self._parse_ddl(ddl)
        if not affected:
            return ImpactResponse(
                ddl=ddl,
                affectedObject={'type': 'unknown', 'name': ''},
                breakage={'willBreak': [], 'needsReview': [], 'unaffected': 0},
                autoRewriteAvailable=0,
            )

        # 2. Walk saved queries
        history = self.history.read_history()
        will_break: List[BreakageEntry] = []
        needs_review: List[BreakageEntry] = []
        unaffected = 0
        auto_rewrite_count = 0

        for entry in history:
            if entry.get('connectionId') != db_config_id: continue
            query_id = entry.get('id', '')
            nl_input = entry.get('nlInput', '')
            sql = entry.get('sql', '')
            if not sql:
                continue

            status, reason = self._classify_query(sql, affected)
            if status == 'will_break':
                will_break.append(BreakageEntry(queryId=query_id, nlInput=nl_input, reason=reason))
                if affected['type'] in ('column_rename', 'table_rename'):
                    auto_rewrite_count += 1
            elif status == 'needs_review':
                needs_review.append(BreakageEntry(queryId=query_id, nlInput=nl_input, reason=reason))
            else:
                unaffected += 1

        affected_object = {
            'type': affected['type'].split('_')[0],  # 'column' or 'table'
            'name': affected.get('table', ''),
        }

        return ImpactResponse(
            ddl=ddl,
            affectedObject=affected_object,
            breakage={
                'willBreak': will_break,
                'needsReview': needs_review,
                'unaffected': unaffected,
            },
            autoRewriteAvailable=auto_rewrite_count,
        )

    # ─── Internal ─────────────────────────────────────────────────────────
    def _parse_ddl(self, ddl: str) -> Dict | None:
        for pattern, kind in DDL_PATTERNS:
            m = pattern.search(ddl)
            if not m:
                continue
            if kind == 'column_rename':
                return {
                    'type': 'column_rename',
                    'table': m.group(1),
                    'old_name': m.group(2),
                    'new_name': m.group(3),
                }
            if kind == 'column_drop':
                return {
                    'type': 'column_drop',
                    'table': m.group(1),
                    'column': m.group(2),
                }
            if kind == 'table_rename':
                return {
                    'type': 'table_rename',
                    'old_name': m.group(1),
                    'new_name': m.group(2),
                }
            if kind == 'table_drop':
                return {
                    'type': 'table_drop',
                    'table': m.group(1),
                }
        return None

    def _classify_query(self, sql: str, affected: Dict) -> Tuple[str, str]:
        if not SQLGLOT_AVAILABLE:
            # Fallback: substring matching
            if affected['type'] in ('column_rename', 'column_drop'):
                col = affected.get('old_name') or affected.get('column')
                if col and col in sql:
                    return 'will_break', f'Direct reference to {col}'
            if affected['type'] in ('table_rename', 'table_drop'):
                tbl = affected.get('old_name') or affected.get('table')
                if tbl and tbl in sql:
                    return 'will_break', f'Direct reference to table {tbl}'
            if 'SELECT *' in sql.upper():
                return 'needs_review', 'Wildcard SELECT — may be affected'
            return 'unaffected', ''

        # AST-based check
        try:
            ast = sqlglot.parse_one(sql, read='postgres')

            if affected['type'] in ('column_rename', 'column_drop'):
                col_name = affected.get('old_name') or affected.get('column')
                referenced_cols = {c.name for c in ast.find_all(exp.Column)}
                referenced_tables = {t.name for t in ast.find_all(exp.Table)}

                if col_name in referenced_cols:
                    return 'will_break', f'Direct reference to {col_name}'

                if (affected.get('table') in referenced_tables
                        and any(isinstance(n, exp.Star) for n in ast.walk())):
                    return 'needs_review', f'SELECT * on affected table {affected["table"]}'

            if affected['type'] in ('table_rename', 'table_drop'):
                tbl_name = affected.get('old_name') or affected.get('table')
                referenced_tables = {t.name for t in ast.find_all(exp.Table)}
                if tbl_name in referenced_tables:
                    return 'will_break', f'Direct reference to table {tbl_name}'

            return 'unaffected', ''
        except Exception as exc:
            logger.debug(f'AST parse failed for query: {exc}')
            return 'needs_review', 'Could not parse AST — manual review required.'

    # ─── Auto-rewrite (sqlglot AST transformation) ──────────────────────
    def auto_rewrite(self, sql: str, affected: Dict) -> str | None:
        """Return rewritten SQL or None if rewrite not possible."""
        if not SQLGLOT_AVAILABLE:
            return None
        if affected['type'] == 'column_rename':
            try:
                ast = sqlglot.parse_one(sql, read='postgres')
                for col in ast.find_all(exp.Column):
                    if col.name == affected['old_name']:
                        col.set('this', exp.to_identifier(affected['new_name']))
                return ast.sql(dialect='postgres')
            except Exception:
                return None
        if affected['type'] == 'table_rename':
            try:
                ast = sqlglot.parse_one(sql, read='postgres')
                for tbl in ast.find_all(exp.Table):
                    if tbl.name == affected['old_name']:
                        tbl.set('this', exp.to_identifier(affected['new_name']))
                return ast.sql(dialect='postgres')
            except Exception:
                return None
        return None
