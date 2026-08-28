"""Execution Service — Component 7 (sub-module).

Safe execution:
    - 60s timeout (via SQLAlchemy execution_options(timeout=60))
    - Row limit (default 500, max 10,000)
    - Read-only connection enforced at DB user level (recommended)
"""

from __future__ import annotations

import time
from typing import Any, Dict, List

import sqlglot
from sqlalchemy import text
from loguru import logger


def _split_statements(sql: str, dialect: str | None = None) -> List[str]:
    """Split a SQL script into individual statements using sqlglot.

    Naive ``str.split(';')`` breaks on semicolons inside string literals,
    quoted identifiers, and comments. sqlglot's parser is dialect-aware and
    only splits on real statement boundaries, so ``'Lu;ca'`` and
    ``-- comment ;`` stay intact. Returns a list of executable statement
    strings (empty statements dropped). Falls back to the whole input as a
    single statement if parsing yields nothing.
    """
    try:
        expressions = sqlglot.parse(sql, read=dialect) if dialect else sqlglot.parse(sql)
    except Exception as exc:
        # Unparseable as a script: let the DB driver surface the real error by
        # executing it as a single statement (preserves prior behaviour).
        logger.warning(f'sqlglot split failed ({exc}); executing as single statement.')
        return [sql.strip()] if sql.strip() else []
    statements: List[str] = []
    for expr in expressions:
        if expr is None:
            continue
        stmt_sql = expr.sql(dialect=dialect) if dialect else expr.sql()
        if stmt_sql and stmt_sql.strip():
            statements.append(stmt_sql)
    return statements if statements else ([sql.strip()] if sql.strip() else [])


class ExecutionService:
    def __init__(self, engine, timeout_seconds: int = 60, row_limit: int = 500) -> None:
        self.engine = engine
        self.timeout_seconds = timeout_seconds
        self.row_limit = row_limit

    async def execute(self, sql: str) -> Dict[str, Any]:
        start = time.perf_counter()
        # Derive the dialect from the engine so statement splitting is
        # dialect-aware (e.g. sqlite vs postgres quoting/keywords).
        try:
            dialect = self.engine.dialect.name
        except Exception:
            dialect = None
        # sqlglot uses 'postgres'; SQLAlchemy uses 'postgresql'.
        sqlglot_dialect = 'postgres' if dialect == 'postgresql' else dialect

        statements = _split_statements(sql, dialect=sqlglot_dialect)
        if not statements:
            return {
                'columns': [],
                'rows': [],
                'rowCount': 0,
                'executionTimeMs': int((time.perf_counter() - start) * 1000),
                'truncated': False,
            }

        with self.engine.connect().execution_options(
            timeout=self.timeout_seconds
        ) as conn:
            columns: List[str] = []
            rows: List[Dict] = []
            truncated = False
            statements_executed = 0
            total = len(statements)

            for index, stmt_sql in enumerate(statements, start=1):
                try:
                    result = conn.execute(text(stmt_sql))
                except Exception as exc:
                    # Stop on first failure; roll back so partial writes from
                    # earlier statements in this script do not persist.
                    conn.rollback()
                    raise RuntimeError(
                        f'Statement {index} of {total} failed: {exc}. '
                        f'Statement: {stmt_sql[:200]}'
                    ) from exc
                statements_executed = index

                if result.returns_rows:
                    # Row-returning statement: capture its result set. If more
                    # than one statement returns rows, the LAST one wins (the
                    # meaningful final result of the script).
                    columns = list(result.keys())
                    rows = []
                    for i, row in enumerate(result):
                        if i >= self.row_limit:
                            logger.info(f'Row limit ({self.row_limit}) hit; truncating.')
                            truncated = True
                            break
                        rows.append(dict(row._mapping) if hasattr(row, '_mapping') else dict(row))

            # All statements succeeded: commit so DDL/DML writes persist.
            conn.commit()
            elapsed = int((time.perf_counter() - start) * 1000)
            out: Dict[str, Any] = {
                'columns': columns,
                'rows': rows,
                'rowCount': len(rows),
                'executionTimeMs': elapsed,
                'truncated': truncated,
            }
            if total > 1:
                out['statementsExecuted'] = statements_executed
            return out

    async def explain(self, sql: str) -> Dict[str, Any] | None:
        """Fetch EXPLAIN (ANALYZE) output as JSON. Best-effort.

        Only meaningful for a single row-returning statement; for multi-statement
        scripts, explain just the first statement (EXPLAIN cannot wrap a script).
        """
        try:
            try:
                dialect = self.engine.dialect.name
            except Exception:
                dialect = None
            sqlglot_dialect = 'postgres' if dialect == 'postgresql' else dialect
            statements = _split_statements(sql, dialect=sqlglot_dialect)
            first = statements[0] if statements else sql

            # SQLite has no EXPLAIN (ANALYZE, FORMAT JSON). Skip plan analysis
            # quietly for dialects that don't support a JSON plan — this is
            # expected, not a warning-worthy failure.
            if dialect in ('sqlite', 'mssql', 'oracle'):
                return None

            with self.engine.connect() as conn:
                # PostgreSQL: EXPLAIN (ANALYZE, FORMAT JSON) ...
                # MySQL: EXPLAIN FORMAT=JSON ...
                if dialect == 'mysql':
                    explain_sql = f'EXPLAIN FORMAT=JSON {first}'
                else:
                    explain_sql = f'EXPLAIN (ANALYZE, FORMAT JSON) {first}'
                result = conn.execute(text(explain_sql))
                row = result.fetchone()
                if row:
                    return row[0] if isinstance(row[0], (dict, list)) else {'raw': str(row[0])}
        except Exception as exc:
            logger.warning(f'EXPLAIN failed: {exc}')
        return None
