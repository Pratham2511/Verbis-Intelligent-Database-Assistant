"""GET /api/schema — Schema introspection + ChromaDB indexing.
POST /api/schema/refresh — Force-refresh schema cache + ChromaDB index (Fix C + Fix F).
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from loguru import logger

router = APIRouter()


class RefreshSchemaRequest(BaseModel):
    db_config_id: str


def _introspect_schema(pool, workspace_path, state) -> List[Dict[str, Any]]:
    """Shared introspection logic — used by both GET /schema and POST /schema/refresh."""
    from sqlalchemy import inspect, MetaData
    inspector = inspect(pool)
    metadata = MetaData()
    metadata.reflect(bind=pool)

    tables: List[Dict[str, Any]] = []
    for table_name in inspector.get_table_names():
        columns = []
        for col in inspector.get_columns(table_name):
            columns.append({
                'name': col['name'],
                'type': str(col['type']),
                'isNullable': bool(col.get('nullable', True)),
                'isPrimaryKey': False,
                'isForeignKey': False,
                'defaultValue': str(col.get('default')) if col.get('default') else None,
            })
        pk_cols = inspector.get_pk_constraint(table_name).get('constrained_columns', [])
        for col in columns:
            if col['name'] in pk_cols:
                col['isPrimaryKey'] = True

        fks = []
        for fk in inspector.get_foreign_keys(table_name):
            for col_name, ref_col in zip(fk['constrained_columns'], fk['referred_columns']):
                fks.append({
                    'column': col_name,
                    'referencedTable': fk['referred_table'],
                    'referencedColumn': ref_col,
                })
                for col in columns:
                    if col['name'] == col_name:
                        col['isForeignKey'] = True

        try:
            import sqlalchemy
            row_count = pool.connect().execute(
                sqlalchemy.text(f'SELECT COUNT(*) FROM "{table_name}"')
            ).scalar()
        except Exception:
            row_count = None

        tables.append({
            'tableName': table_name,
            'columns': columns,
            'primaryKey': pk_cols,
            'foreignKeys': fks,
            'rowCountEstimate': row_count,
        })

    # Cache to disk
    import json
    cache_path = workspace_path / 'schema_cache.json'
    cache_path.write_text(json.dumps(tables, indent=2, default=str))

    # Index into ChromaDB (Novel #3a — Schema RAG)
    state.rag.index_schema(tables)

    return tables


@router.get('/schema')
async def get_schema(dbConfigId: str, request: Request) -> Dict[str, Any]:
    state = request.app.state.qm
    pool = state.db_pools.get(dbConfigId)
    if pool is None:
        raise HTTPException(404, detail=f'No DB connection registered for id={dbConfigId}')

    # Check cache first — but only trust a NON-EMPTY cache. An empty cached
    # result ([]) is almost always a stale artifact from a moment when the
    # database had no introspectable tables (e.g. a placeholder SQLite file
    # created before the real data was migrated in). Treating [] as valid
    # would leave the Schema panel permanently showing "No schema loaded" even
    # after the database gained tables, so an empty cache falls through to a
    # fresh introspection below.
    cache_path = state.workspace_path / 'schema_cache.json'
    if cache_path.exists():
        import json
        cached = json.loads(cache_path.read_text())
        if cached:
            logger.info('Returning cached schema (use POST /api/schema/refresh to force)')
            return {'tables': cached, 'indexed': True}
        logger.info('Schema cache is empty — re-introspecting instead of returning []')

    # Introspect via SQLAlchemy reflection
    tables = _introspect_schema(pool, state.workspace_path, state)
    return {'tables': tables, 'indexed': True}


@router.post('/schema/refresh')
async def refresh_schema(req: RefreshSchemaRequest, request: Request):
    """
    Force-refresh the schema cache + ChromaDB index for a connection.

    Called by extension.ts after SCHEMA_EXECUTE creates new tables. Without
    this, the user immediately switching to Chat gets hallucinated SQL
    because the schema context doesn't include the just-created tables.

    Fix F: This is a POST endpoint (not a GET query param) because cache
    invalidation is semantically a mutation, and POST is more robust than
    relying on requestJson's implicit GET-with-no-body behavior.
    """
    state = request.app.state.qm
    pool = state.db_pools.get(req.db_config_id)
    if pool is None:
        raise HTTPException(404, detail=f'No DB connection registered for id={req.db_config_id}')

    cache_path = state.workspace_path / 'schema_cache.json'

    # Delete stale cache so the next introspection runs fresh
    if cache_path.exists():
        cache_path.unlink()
        logger.info(f'Schema cache deleted for connection {req.db_config_id}')

    # Re-introspect + re-index ChromaDB
    tables = _introspect_schema(pool, state.workspace_path, state)

    logger.info(f'Schema refreshed for connection {req.db_config_id}: {len(tables)} tables indexed')
    return {'tables': tables, 'indexed': True}
