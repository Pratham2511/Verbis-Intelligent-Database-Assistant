"""Live schema introspection with connection-specific fingerprints and index state."""
import hashlib
import json
import uuid
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from sqlalchemy import inspect
router = APIRouter()
class RefreshSchemaRequest(BaseModel):
    db_config_id: str

def _introspect_schema(pool, workspace_path, state, connection_id='default'):
    inspector = inspect(pool)
    tables = []
    for table_name in inspector.get_table_names():
        pk = inspector.get_pk_constraint(table_name).get('constrained_columns', [])
        fks = [{'column': c, 'referencedTable': fk['referred_table'], 'referencedColumn': rc}
               for fk in inspector.get_foreign_keys(table_name)
               for c, rc in zip(fk['constrained_columns'], fk['referred_columns'])]
        columns = [{'name': c['name'], 'type': str(c['type']), 'isNullable': bool(c.get('nullable', True)),
                    'isPrimaryKey': c['name'] in pk, 'isForeignKey': any(f['column']==c['name'] for f in fks),
                    'defaultValue': str(c['default']) if c.get('default') is not None else None}
                   for c in inspector.get_columns(table_name)]
        tables.append({'tableName': table_name, 'columns': columns, 'primaryKey': pk,
                       'foreignKeys': fks, 'rowCountEstimate': None})
    fingerprint = hashlib.sha256(json.dumps(tables, sort_keys=True).encode()).hexdigest()[:16]
    cache = state.extra.setdefault('schemas', {})
    old = cache.get(connection_id, {})
    indexed = old.get('indexed', False)
    if old.get('fingerprint') != fingerprint:
        try: indexed = bool(state.rag.index_schema(tables, connection_id=connection_id))
        except Exception: indexed = False
    entry = {'tables': tables, 'fingerprint': fingerprint, 'indexed': indexed, 'indexKind': 'offline lexical'}
    cache[connection_id] = entry
    # Never reuse a workspace-wide cache for a different connection.
    key = hashlib.sha256(connection_id.encode()).hexdigest()[:16]
    target = workspace_path / f'schema_{key}.json'
    tmp=target.with_name(target.name+'.'+uuid.uuid4().hex+'.tmp')
    tmp.write_text(json.dumps(entry, indent=2)); tmp.replace(target)
    return tables

async def schema_result(state, connection_id):
    pool = state.db_pools.get(connection_id)
    if pool is None: raise HTTPException(404, detail=f'No DB connection registered for id={connection_id}')
    tables = await run_in_threadpool(_introspect_schema, pool, state.workspace_path, state, connection_id)
    return state.extra['schemas'][connection_id]

@router.get('/schema')
async def get_schema(dbConfigId: str, request: Request):
    return await schema_result(request.app.state.qm, dbConfigId)

@router.post('/schema/refresh')
async def refresh_schema(req: RefreshSchemaRequest, request: Request):
    request.app.state.qm.extra.setdefault('schemas', {}).pop(req.db_config_id, None)
    return await schema_result(request.app.state.qm, req.db_config_id)
