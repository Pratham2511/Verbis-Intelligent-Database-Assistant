"""Dialect resolution for SQL generation.

The extension historically hard-coded ``dialect: 'postgresql'`` in the generate
payload, so the LLM produced PostgreSQL-specific SQL (e.g.
``information_schema.tables``) even for SQLite/MySQL connections. The
authoritative source is the registered connection's engine, which the backend
created from the saved config's real dialect. Derive the dialect from that
engine via ``db_config_id``; fall back to the request value only when no
connection is registered (e.g. schema-less / default flows).
"""

from __future__ import annotations

from typing import Any, Optional


def resolve_dialect(db_pools: Any, db_config_id: Optional[str], fallback: str) -> str:
    """Return the SQL dialect to use for generation.

    Args:
        db_pools: the app's DBPoolManager (has ``.get(id)`` → Engine or None).
        db_config_id: the connection id from the request (may be None).
        fallback: the dialect value from the request, used when no connection
            is registered or the engine dialect cannot be determined.
    """
    if db_config_id:
        try:
            pool = db_pools.get(db_config_id)
        except Exception:
            pool = None
        if pool is not None:
            try:
                name = pool.dialect.name
                if name:
                    return name
            except Exception:
                pass
    return fallback
