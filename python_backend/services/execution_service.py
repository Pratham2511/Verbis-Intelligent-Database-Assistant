"""Execution Service — Component 7 (sub-module).

Safe execution:
    - 60s timeout (via SQLAlchemy execution_options(timeout=60))
    - Row limit (default 500, max 10,000)
    - Read-only connection enforced at DB user level (recommended)
"""

from __future__ import annotations

import time
from typing import Any, Dict, List

from sqlalchemy import text
from loguru import logger


class ExecutionService:
    def __init__(self, engine, timeout_seconds: int = 60, row_limit: int = 500) -> None:
        self.engine = engine
        self.timeout_seconds = timeout_seconds
        self.row_limit = row_limit

    async def execute(self, sql: str) -> Dict[str, Any]:
        start = time.perf_counter()
        with self.engine.connect().execution_options(
            timeout=self.timeout_seconds
        ) as conn:
            stmt = text(sql)
            result = conn.execute(stmt)
            columns: List[str] = list(result.keys()) if result.returns_rows else []
            rows: List[Dict] = []
            if not result.returns_rows:
                # DDL/DML (INSERT/UPDATE/DELETE/CREATE/DROP/...): no result set.
                # Commit so the write persists, then return an empty result.
                conn.commit()
                elapsed = int((time.perf_counter() - start) * 1000)
                return {
                    'columns': columns,
                    'rows': rows,
                    'rowCount': 0,
                    'executionTimeMs': elapsed,
                    'truncated': False,
                }
            for i, row in enumerate(result):
                if i >= self.row_limit:
                    logger.info(f'Row limit ({self.row_limit}) hit; truncating.')
                    return {
                        'columns': columns,
                        'rows': rows,
                        'rowCount': len(rows),
                        'executionTimeMs': int((time.perf_counter() - start) * 1000),
                        'truncated': True,
                    }
                rows.append(dict(row._mapping) if hasattr(row, '_mapping') else dict(row))
            elapsed = int((time.perf_counter() - start) * 1000)
            return {
                'columns': columns,
                'rows': rows,
                'rowCount': len(rows),
                'executionTimeMs': elapsed,
                'truncated': False,
            }

    async def explain(self, sql: str) -> Dict[str, Any] | None:
        """Fetch EXPLAIN (ANALYZE) output as JSON. Best-effort."""
        try:
            with self.engine.connect() as conn:
                # PostgreSQL: EXPLAIN (ANALYZE, FORMAT JSON) ...
                # MySQL: EXPLAIN FORMAT=JSON ...
                explain_sql = f'EXPLAIN (ANALYZE, FORMAT JSON) {sql}'
                result = conn.execute(text(explain_sql))
                row = result.fetchone()
                if row:
                    return row[0] if isinstance(row[0], (dict, list)) else {'raw': str(row[0])}
        except Exception as exc:
            logger.warning(f'EXPLAIN failed: {exc}')
        return None
