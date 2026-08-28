"""Query Post-Processing — Component 6.

Step 1: Syntax validation via sqlglot (with LLM self-correction, max 2 retries).
Step 2: Semantic validation (hallucination check) — table/column existence.
        (The is_read_only check also lives here.)
"""

from __future__ import annotations

from typing import List, Optional, Tuple
from loguru import logger

try:
    import sqlglot
    from sqlglot import exp
    SQLGLOT_AVAILABLE = True
except ImportError:
    SQLGLOT_AVAILABLE = False
    logger.warning('sqlglot not installed — SQL validation will be skipped.')


class Validator:
    def __init__(self, dialect: str = 'postgres') -> None:
        # NOTE: sqlglot 30.x renamed the dialect 'postgresql' → 'postgres'.
        # This value is passed to sqlglot.parse_one(read=...), so it must be a
        # valid sqlglot dialect name. ('postgresql' raises ValueError.)
        self.dialect = dialect

    # ─── Step 1: Syntax validation ────────────────────────────────────
    def validate_syntax(self, sql: str, max_retries: int = 0) -> Tuple[bool, Optional[str]]:
        if not SQLGLOT_AVAILABLE:
            return True, None
        try:
            sqlglot.parse_one(sql, read=self.dialect)
            return True, None
        except Exception as exc:
            return False, str(exc)

    # ─── Step 2: Semantic validation (hallucination check) ────────────
    def validate_semantic(self, sql: str, schema_chunks: List[dict]) -> bool:
        if not SQLGLOT_AVAILABLE:
            return True

        try:
            ast = sqlglot.parse_one(sql, read=self.dialect)
        except Exception:
            return False

        # Collect all tables and columns referenced
        referenced_tables = {t.name for t in ast.find_all(exp.Table)}
        referenced_columns = {c.name for c in ast.find_all(exp.Column)}

        # Build known tables/columns from the (possibly anonymized) schema chunks
        known_tables = {chunk.get('tableName', '') for chunk in schema_chunks}
        known_columns = set()
        for chunk in schema_chunks:
            for col in chunk.get('columns', []) or []:
                known_columns.add(col.get('name', ''))

        unknown_tables = referenced_tables - known_tables - {'', 'dual'}
        unknown_columns = referenced_columns - known_columns - {'*'}

        if unknown_tables:
            logger.warning(f'Hallucination check: unknown tables {unknown_tables}')
            return False
        if unknown_columns and known_columns:
            logger.warning(f'Hallucination check: unknown columns {unknown_columns}')
            return False

        return True

    # ─── Read-only check (used by /api/execute) ────────────────────────
    def is_read_only(self, sql: str) -> bool:
        if not SQLGLOT_AVAILABLE:
            # Fallback regex check
            stripped = sql.strip().lower()
            return (
                stripped.startswith('select') or
                stripped.startswith('with') or
                stripped.startswith('explain')
            )

        try:
            ast = sqlglot.parse_one(sql, read=self.dialect)
        except Exception:
            return False

        # Allow only SELECT / WITH (which must end in SELECT) / EXPLAIN
        if isinstance(ast, exp.Select):
            return True
        if isinstance(ast, exp.With):
            # WITH ... must end in SELECT
            return isinstance(ast.this, exp.Select)
        # sqlglot 30.x removed exp.Explain; EXPLAIN parses as a Command.
        if isinstance(ast, exp.Command) and ast.this.upper() == 'EXPLAIN':
            return True
        return False

    # ─── Read-only check for multi-statement scripts ──────────────────
    def is_read_only_script(self, sql: str) -> bool:
        """Return True only if EVERY statement in the script is read-only.

        ``is_read_only`` uses ``parse_one``, which inspects only the first
        statement — so ``CREATE TABLE ...; INSERT ...`` would be misjudged by
        looking at just the CREATE. For scripts, parse ALL statements and
        require each one to be read-only.
        """
        if not SQLGLOT_AVAILABLE:
            return self.is_read_only(sql)
        try:
            expressions = sqlglot.parse(sql, read=self.dialect)
        except Exception:
            return False
        statements = [e for e in expressions if e is not None]
        if not statements:
            return False
        for ast in statements:
            if isinstance(ast, exp.Select):
                continue
            if isinstance(ast, exp.With) and isinstance(ast.this, exp.Select):
                continue
            if isinstance(ast, exp.Command) and ast.this.upper() == 'EXPLAIN':
                continue
            return False
        return True
