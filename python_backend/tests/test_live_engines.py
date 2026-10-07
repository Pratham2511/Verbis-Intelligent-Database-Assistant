"""Opt-in real engine acceptance. URLs must identify disposable verbis_* databases."""
import os
import sys
import time
import asyncio
import threading
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]))
import pytest
from sqlalchemy import create_engine,text
from sqlalchemy.engine import make_url
from services.execution_service import ExecutionService
from services.validator_service import Validator
from services.schema_creator_service import schema_to_ddl
from test_http_repairs import client

@pytest.fixture(params=['postgresql','mysql'])
def live(request,client):
    kind=request.param
    raw=os.environ.get('VERBIS_TEST_POSTGRES_URL' if kind=='postgresql' else 'VERBIS_TEST_MYSQL_URL')
    if not raw:pytest.skip('Disposable '+kind+' URL not supplied')
    url=make_url(raw)
    if not url.database.startswith('verbis_'):pytest.fail('Live tests require a disposable verbis_* database')
    engine=client.app.state.qm.db_pools.register('live',raw,validate=True)
    with engine.begin() as conn:
        conn.execute(text('DROP TABLE IF EXISTS verbis_employees'))
        conn.execute(text('CREATE TABLE verbis_employees(id INTEGER PRIMARY KEY,name VARCHAR(50),salary INTEGER,department VARCHAR(50))'))
        conn.execute(text("INSERT INTO verbis_employees VALUES(1,'Alice',7500,'IT'),(2,'Bob',8000,'IT'),(3,'Cara',8001,'Finance'),(4,'Dev',12000,'IT'),(5,'Esha',NULL,'Finance')"))
    yield kind,engine,client
    with engine.begin() as conn:conn.execute(text('DROP TABLE IF EXISTS verbis_employees'))

@pytest.mark.asyncio
async def test_real_engine_bounds_bindings_and_database_read_only(live):
    kind,engine,client=live
    r=await ExecutionService(engine,read_only=True,row_limit=1).execute('SELECT id FROM verbis_employees WHERE salary > :threshold ORDER BY id',{'threshold':8000})
    assert r['rows']==[{'id':3}] and r['truncated']
    with pytest.raises(RuntimeError):await ExecutionService(engine,read_only=True).execute('UPDATE verbis_employees SET salary=0')
    with engine.connect() as conn:assert conn.execute(text('SELECT salary FROM verbis_employees WHERE id=4')).scalar()==12000
    for op in ('UNION','INTERSECT','EXCEPT'):
        r=client.post('/api/execute',json={'connection_id':'live','sql':f'SELECT id FROM verbis_employees {op} SELECT id FROM verbis_employees'})
        assert r.status_code==200,r.text
    if kind=='postgresql':
        for sql in ['SELECT * INTO verbis_stolen FROM verbis_employees','WITH x AS (DELETE FROM verbis_employees RETURNING *) SELECT * FROM x','EXPLAIN ANALYZE DELETE FROM verbis_employees']:
            assert client.post('/api/execute',json={'connection_id':'live','sql':sql}).status_code==403
        with engine.connect() as conn:
            assert conn.execute(text('SELECT count(*) FROM verbis_employees')).scalar()==5
            assert conn.execute(text("SELECT to_regclass('verbis_stolen')")).scalar() is None

@pytest.mark.asyncio
async def test_real_engine_timeout_cancel_and_recovery(live):
    kind,engine,_=live
    slow='SELECT pg_sleep(10)' if kind=='postgresql' else 'SELECT SLEEP(10)'
    start=time.monotonic()
    with pytest.raises(TimeoutError):await ExecutionService(engine,read_only=True,timeout_seconds=1).execute(slow)
    assert time.monotonic()-start<4
    cancel=threading.Event();svc=ExecutionService(engine,read_only=True,timeout_seconds=20,cancel_event=cancel)
    task=asyncio.create_task(svc.execute(slow));await asyncio.sleep(.15);cancel.set()
    with pytest.raises(TimeoutError):await task
    assert (await ExecutionService(engine,read_only=True).execute('SELECT 1 AS recovered'))['rows']==[{'recovered':1}]

@pytest.mark.asyncio
async def test_real_engine_generated_ddl(live):
    kind,engine,_=live
    schema={'tables':[{'name':'verbis_created','columns':[{'name':'id','type':'INT','constraints':['PRIMARY KEY','AUTO_INCREMENT']},{'name':'salary','type':'INT','constraints':[]}],'indexes':['salary']}],'relationships':[]}
    ddl=schema_to_ddl(schema,kind)
    try:
        await ExecutionService(engine).execute(ddl)
        with engine.connect() as c:assert c.execute(text('SELECT count(*) FROM verbis_created')).scalar()==0
    finally:
        with engine.begin() as c:c.execute(text('DROP TABLE IF EXISTS verbis_created'))

@pytest.mark.asyncio
async def test_real_engine_child_first_ddl_with_keyword_columns(live):
    kind,engine,_=live
    schema={'tables':[
        {'name':'verbis_child','columns':[{'name':'id','type':'INT','constraints':['PRIMARY KEY','AUTO_INCREMENT']},{'name':'select','type':'INT','constraints':[],'foreign_key':{'references_table':'verbis_parent','references_column':'id'}}],'indexes':['select']},
        {'name':'verbis_parent','columns':[{'name':'id','type':'INT','constraints':['PRIMARY KEY','AUTO_INCREMENT']},{'name':'created_at','type':'TIMESTAMP','constraints':['DEFAULT CURRENT_TIMESTAMP']}]}]}
    quote='`' if kind=='mysql' else '"'
    try:
        await ExecutionService(engine).execute(schema_to_ddl(schema,kind))
        with engine.begin() as c:
            c.execute(text('INSERT INTO verbis_parent(id) VALUES (1)'))
            c.execute(text(f'INSERT INTO verbis_child({quote}select{quote}) VALUES (1)'))
            assert c.execute(text(f'SELECT count(*) FROM verbis_child c JOIN verbis_parent p ON c.{quote}select{quote}=p.id WHERE p.created_at IS NOT NULL')).scalar()==1
    finally:
        with engine.begin() as c:
            c.execute(text('DROP TABLE IF EXISTS verbis_child'))
            c.execute(text('DROP TABLE IF EXISTS verbis_parent'))

def test_postgres_verified_tls_and_failed_edit_preserves_pool(client):
    raw=os.environ.get('VERBIS_TEST_POSTGRES_URL');ca=os.environ.get('VERBIS_TEST_POSTGRES_CA')
    if not raw or not ca:pytest.skip('Disposable PostgreSQL TLS fixture not supplied')
    from api.routes import connections
    client.app.include_router(connections.router,prefix='/api')
    client.app.state.qm.settings.workspace_path=client.app.state.qm.workspace_path.parent
    url=make_url(raw)
    c={'id':'tls-test','name':'Disposable TLS','dialect':'postgresql','database':url.database,'host':'localhost','port':url.port,'user':url.username,'ssl':True,'sslCa':ca}
    r=client.post('/api/connections',json={'connection':c,'password':url.password or ''});assert r.status_code==200,r.text
    original=client.app.state.qm.db_pools.get('tls-test')
    with original.connect() as conn:assert conn.execute(text('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).scalar() is True
    c['host']='127.0.0.1'  # Certificate intentionally only covers localhost.
    r=client.post('/api/connections',json={'connection':c,'password':url.password or ''});assert r.status_code==400,r.text
    assert client.app.state.qm.db_pools.get('tls-test') is original
    with original.connect() as conn:assert conn.execute(text('SELECT 1')).scalar()==1


def test_mysql_verified_tls_and_missing_ca_error(client):
    raw=os.environ.get('VERBIS_TEST_MYSQL_URL');ca=os.environ.get('VERBIS_TEST_MYSQL_CA')
    if not raw or not ca:pytest.skip('Disposable MySQL TLS fixture not supplied')
    from api.routes import connections
    client.app.include_router(connections.router,prefix='/api')
    client.app.state.qm.settings.workspace_path=client.app.state.qm.workspace_path.parent
    url=make_url(raw)
    c={'id':'tls-mysql','name':'Disposable MySQL TLS','dialect':'mysql','database':url.database,'host':'localhost','port':url.port,'user':url.username,'ssl':True,'sslCa':ca}
    r=client.post('/api/connections',json={'connection':c,'password':url.password or ''});assert r.status_code==200,r.text
    original=client.app.state.qm.db_pools.get('tls-mysql')
    with original.connect() as conn:assert conn.exec_driver_sql("SHOW STATUS LIKE 'Ssl_cipher'").fetchone()[1]
    c['host']='127.0.0.1'
    assert client.post('/api/connections',json={'connection':c,'password':url.password or ''}).status_code==400
    c['host']='localhost';c['sslCa']='/nonexistent/verbis-acceptance-ca.pem'
    assert client.post('/api/connections',json={'connection':c,'password':url.password or ''}).status_code==400
    assert client.app.state.qm.db_pools.get('tls-mysql') is original


def test_cloud_privacy_keeps_live_engine_parameter_bindings(live,monkeypatch):
    import json
    from api.routes import generate
    _,_,client=live
    async def provider(**kw):
        schema=json.loads(kw['schema_context']);table=next(t for t in schema if any(c['name']=='col_4' for c in t['columns']))
        return json.dumps({'query':f"SELECT col_3,col_4 FROM {table['tableName']} WHERE col_4 > :threshold ORDER BY col_4",'parameters':{'threshold':8000}})
    monkeypatch.setattr(generate,'generate_sql',provider)
    r=client.post('/api/generate',json={'db_config_id':'live','provider':'gemini','api_key':'controlled-fixture','nl_query':'employees whose salary is above 8000'})
    assert r.status_code==200,r.text
    sql=r.json()['query'];assert ':threshold' in sql and r.json()['parameters']=={'threshold':8000}
    r=client.post('/api/execute',json={'connection_id':'live','sql':sql,'parameters':{'threshold':8000}})
    assert r.status_code==200,r.text
    assert [row['name'] for row in r.json()['rows']]==['Cara','Dev']
