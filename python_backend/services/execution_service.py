"""Execution Service — Component 7 (sub-module).

Safe execution:
    - 60s timeout (via SQLAlchemy execution_options(timeout=60))
    - Row limit (default 500, max 10,000)
    - Read-only connection enforced at DB user level (recommended)
"""

from __future__ import annotations

import time
import asyncio
import threading
import sqlite3
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
        # SQLAlchemy text() binds :name. Dialect generators otherwise change
        # PostgreSQL placeholders into %(name)s, which text() treats as literal
        # percent signs and escapes a second time for psycopg2.
        expr = expr.transform(lambda node: sqlglot.exp.Var(this=':' + node.name)
                              if isinstance(node, sqlglot.exp.Placeholder) and node.name
                              else node)
        stmt_sql = expr.sql(dialect=dialect) if dialect else expr.sql()
        if stmt_sql and stmt_sql.strip():
            statements.append(stmt_sql)
    return statements if statements else ([sql.strip()] if sql.strip() else [])


class ExecutionService:
    def __init__(self, engine, timeout_seconds=60, row_limit=500, read_only=False, cancel_event=None):
        self.engine = engine
        self.timeout_seconds = timeout_seconds
        self.row_limit = row_limit
        self.read_only = read_only
        self.cancel_event = cancel_event or threading.Event()

    async def execute(self, sql, parameters=None):
        return await asyncio.to_thread(self._execute_sync, sql, parameters or {})

    def _execute_sync(self, sql, parameters):
        start = time.monotonic()
        deadline = start + self.timeout_seconds
        dialect = self.engine.dialect.name
        statements = _split_statements(sql, 'postgres' if dialect == 'postgresql' else dialect)
        with self.engine.connect() as conn:
            raw = conn.connection.driver_connection
            timed_out = threading.Event()
            def interrupted():
                return self.cancel_event.is_set() or time.monotonic() >= deadline
            finished = threading.Event()
            def monitor():
                while not finished.wait(0.02):
                    if interrupted():
                        timed_out.set()
                        try:
                            if dialect == 'sqlite': raw.interrupt()
                            elif dialect == 'postgresql': raw.cancel()
                            elif dialect == 'mysql':
                                # A separate connection is required while the first is blocked.
                                with self.engine.connect() as control:
                                    control.exec_driver_sql(f'KILL QUERY {int(raw.thread_id())}')
                        except Exception:
                            pass  # Server-side statement timeout remains the fallback.
                        return
            monitor_thread = threading.Thread(target=monitor, daemon=True)
            if dialect == 'sqlite':
                raw.set_progress_handler(lambda: int(interrupted()), 1000)
                if self.read_only:
                    conn.exec_driver_sql('PRAGMA query_only=ON')
            elif dialect == 'postgresql':
                if self.read_only: conn.exec_driver_sql('SET TRANSACTION READ ONLY')
                conn.execute(text("SELECT set_config('statement_timeout', :ms, true)"), {'ms': str(self.timeout_seconds * 1000)})
            elif dialect == 'mysql':
                conn.exec_driver_sql(f'SET SESSION MAX_EXECUTION_TIME={self.timeout_seconds * 1000}')
                if self.read_only: conn.exec_driver_sql('SET TRANSACTION READ ONLY')
            monitor_thread.start()
            try:
                columns, rows, truncated = [], [], False
                index=0
                for index, stmt in enumerate(statements, 1):
                    if interrupted(): raise TimeoutError('Query cancelled or timed out')
                    result = conn.execute(text(stmt), parameters)
                    if result.returns_rows:
                        columns = list(result.keys())
                        if len(columns) != len(set(columns)):
                            raise ValueError('Duplicate result column names; give joined columns distinct aliases.')
                        fetched = result.fetchmany(self.row_limit + 1)
                        rows = [dict(r._mapping) for r in fetched[:self.row_limit]]
                        truncated = len(fetched) > self.row_limit
                    result.close()
                if interrupted(): raise TimeoutError('Query cancelled or timed out')
                conn.commit()
                out = {'columns': columns, 'rows': rows, 'rowCount': len(rows),
                       'executionTimeMs': int((time.monotonic()-start)*1000), 'truncated': truncated}
                if len(statements)>1: out['statementsExecuted'] = len(statements)
                return out
            except Exception as exc:
                conn.rollback()
                if interrupted() or timed_out.is_set(): raise TimeoutError('Query cancelled or timed out') from exc
                raise RuntimeError(f'Statement {index} of {len(statements)} failed: {exc}') from exc
            finally:
                finished.set()
                monitor_thread.join(timeout=2)
                if monitor_thread.is_alive(): conn.invalidate()
                if dialect == 'sqlite':
                    raw.set_progress_handler(None, 0)
                    if self.read_only: conn.exec_driver_sql('PRAGMA query_only=OFF')
                    conn.rollback()
                elif dialect == 'mysql':
                    conn.exec_driver_sql('SET SESSION MAX_EXECUTION_TIME=0')
                    conn.rollback()

    async def explain(self, sql):
        # Explain-only; ANALYZE would execute a statement a second time.
        from services.validator_service import Validator
        dialect = self.engine.dialect.name
        if not Validator(dialect).is_read_only_script(sql): return None
        if len(_split_statements(sql, 'postgres' if dialect == 'postgresql' else dialect)) != 1: return None
        def run():
            with self.engine.connect() as conn:
                if dialect == 'sqlite': stmt = 'EXPLAIN QUERY PLAN ' + sql
                elif dialect == 'mysql': stmt = 'EXPLAIN FORMAT=JSON ' + sql
                elif dialect == 'postgresql': stmt = 'EXPLAIN (FORMAT JSON) ' + sql
                else: return None
                rows = conn.execute(text(stmt)).fetchmany(100)
                return {'rows': [list(r) for r in rows]}
        return await asyncio.to_thread(run)
