"""Privacy Shield — Component 4.

Implements Novel Contribution #2 (Privacy Shield for Cloud LLMs).

Pipeline:
    1. tokenize(schema)         → anonymized_schema + token_map
    2. send anonymized prompt   → LLM
    3. deanonymize_sql(sql, map) → real SQL with original names

Token maps remain in memory for one request and are discarded after completion.
Schema defaults and dataset rows are not included in outbound context.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Dict, List, Tuple

from loguru import logger


class PrivacyShield:
    def __init__(self, salt_path: Path) -> None:
        self._active_maps: Dict[str, Dict[str, str]] = {}  # session_id → map

    # ─── Public API ────────────────────────────────────────────────────
    def anonymize(self, schema: List[Dict]) -> Tuple[List[Dict], str]:
        """Replace table/column names with anonymous tokens.

        Returns (anonymized_schema, session_id). The token map for session_id
        is held in memory until the caller discards it.
        """
        session_id = str(uuid.uuid4())
        forward_map: Dict[str, str] = {}     # real → token
        reverse_map: Dict[str, str] = {}     # token → real

        # Column tokens are unique across names, shared only for the same name.
        # The old per-table col_1 map overwrote unrelated columns in joins.
        names = sorted({c['name'] for t in schema for c in t.get('columns', [])})
        col_tokens = {n: f'col_{i+1}' for i, n in enumerate(names)}
        table_tokens = {t['tableName']: f'table_{i+1}' for i, t in enumerate(schema)}
        forward_map.update(table_tokens)
        forward_map.update(col_tokens)
        reverse_map.update({v: k for k, v in forward_map.items()})
        anon_schema = []
        for table in schema:
            anon_schema.append({
                'tableName': table_tokens[table['tableName']],
                'columns': [{**c, 'name': col_tokens[c['name']], 'defaultValue': None,
                             'semanticHint': self.semantic_hint(c['name'])}
                            for c in table.get('columns', [])],
                'primaryKey': [col_tokens[c] for c in table.get('primaryKey', [])],
                'foreignKeys': [{'column': col_tokens[f['column']],
                    'referencedTable': table_tokens.get(f['referencedTable'], 'unresolved'),
                    'referencedColumn': col_tokens.get(f['referencedColumn'], 'unresolved')}
                    for f in table.get('foreignKeys', [])],
            })

        full_map = {'forward': forward_map, 'reverse': reverse_map}
        self._active_maps[session_id] = full_map
        # Active generation maps are request-scoped and never persisted.
        return anon_schema, session_id

    def deanonymize_sql(self, sql: str, session_id: str, dialect=None) -> str:
        """Replace anonymous tokens in the generated SQL with real names."""
        full_map = self._active_maps.get(session_id, {})
        reverse = full_map.get('reverse', {})
        if not reverse:
            logger.warning(f'No active token map for session {session_id}; returning SQL as-is.')
            return sql

        import sqlglot
        from sqlglot import exp
        ast = sqlglot.parse_one(sql,read=dialect)
        for identifier in ast.find_all(exp.Identifier):
            real = reverse.get(identifier.name.lower())
            if real:
                identifier.set('this', real)
                identifier.set('quoted', True)
        ast=ast.transform(lambda node: exp.Var(this=':'+node.name) if isinstance(node,exp.Placeholder) and node.name else node)
        return ast.sql(dialect=dialect)

    def anonymize_text(self, text: str, session_id: str) -> str:
        forward = self._active_maps[session_id]['forward']
        for real in sorted(forward, key=len, reverse=True):
            text = re.sub(r'(?<!\w)' + re.escape(real) + r'(?!\w)', forward[real], text, flags=re.I)
        return text

    @staticmethod
    def semantic_hint(name: str) -> str:
        """Coarse conventional roles, never source identifiers or sampled values."""
        normalized=name.lower()
        if normalized in {'department','department_name','dept','team','team_name'}:return 'organizational unit'
        if normalized in {'name','full_name','display_name','employee_name'}:return 'entity label'
        if normalized=='id' or normalized.endswith('_id'):return 'entity identifier'
        if normalized in {'salary','monthly_salary','annual_salary','gross_salary','base_salary'}:return 'compensation amount; units must come from reviewed metadata'
        return ''

    def deanonymize_text(self, text: str, session_id: str) -> str:
        reverse=self._active_maps.get(session_id,{}).get('reverse',{})
        return re.sub(r'\b(?:table|col)_\d+\b',lambda match:reverse.get(match.group().lower(),match.group()),text,flags=re.I)

    def discard(self, session_id: str):
        self._active_maps.pop(session_id, None)
