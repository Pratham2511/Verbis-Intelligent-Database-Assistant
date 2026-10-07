import sys, os, asyncio, json
from types import SimpleNamespace
from pathlib import Path
sys.path.insert(0,os.path.join(os.path.dirname(__file__),'..'))
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from core.db_pool import DBPoolManager,build_connection_url
from core.history_store import HistoryStore
from services.rag_service import RAGService
from services.privacy_shield import PrivacyShield
from services.perf_tracker import PerfTracker
from services.pii_service import PIIMasker
from api.routes import schema,generate,execute,glossary,impact,schema_create
from sqlalchemy import text

@pytest.fixture
def client(tmp_path):
 p=tmp_path/'.qmind';p.mkdir();pools=DBPoolManager()
 for id,ddl in [('hr','CREATE TABLE employees(id INTEGER PRIMARY KEY, name TEXT, salary REAL, department TEXT)'),('other','CREATE TABLE products(id INTEGER, price REAL)')]:
  engine=pools.register(id,build_connection_url('sqlite','',0,id,'','',workspace_path=tmp_path))
  with engine.begin() as c:c.execute(text(ddl))
 with pools.get('hr').begin() as c:
  c.execute(text("INSERT INTO employees VALUES(1,'Alice',7500,'IT'),(2,'Bob',8000,'IT'),(3,'Cara',8001,'Finance'),(4,'Dev',12000,'IT'),(5,'Esha',NULL,'Finance')"))
 state=SimpleNamespace(db_pools=pools,workspace_path=p,extra={},settings=SimpleNamespace(row_limit_default=500,row_limit_max=10000,read_only_by_default=True,execution_timeout_seconds=60),rag=RAGService(str(p/'index')),privacy_shield=PrivacyShield(p/'priv_map.enc'),pii_masker=PIIMasker(),perf_tracker=PerfTracker(p/'perf.json'),history_store=HistoryStore(p/'history.json',p/'query_tree.json'))
 app=FastAPI();app.state.qm=state
 for r in [schema,generate,execute,glossary,schema_create]:app.include_router(r.router,prefix='/api')
 app.include_router(impact.router,prefix='/api/schema')
 with TestClient(app) as c:yield c
 pools.dispose_all()
def test_connection_schema_isolation_and_external_refresh(client):
 assert [t['tableName'] for t in client.get('/api/schema?dbConfigId=hr').json()['tables']]==['employees']
 assert [t['tableName'] for t in client.get('/api/schema?dbConfigId=other').json()['tables']]==['products']
 with client.app.state.qm.db_pools.get('hr').begin() as c:c.execute(text('CREATE TABLE extra(id INT)'))
 assert len(client.get('/api/schema?dbConfigId=hr').json()['tables'])==2
def test_generation_privacy_envelope_history_and_glossary(client,monkeypatch):
 captured=[]
 async def provider(**kw):
  captured.append(kw)
  return json.dumps({'query':'SELECT col_2, col_3, col_4 FROM table_1 WHERE col_4 > 8000'})
 monkeypatch.setattr(generate,'generate_sql',provider)
 assert client.post('/api/glossary',json={'term':'high earners','sqlTemplate':'salary > 8000','dialect':'sqlite'}).status_code==200
 req={'nl_query':'find high earners from employees','db_config_id':'hr','session_id':'chat','provider':'gemini','api_key':'fixture-not-real'}
 r=client.post('/api/generate',json=req);assert r.status_code==200,r.text
 assert r.json()['validation']=='schema-validated' and 'salary' in r.json()['query']
 assert r.json()['providerVerified'] is True
 for name in ['employees','salary','department','name']:
  # field keys like 'name' are metadata, but source identifiers must not appear as values.
  assert f'"{name}"' not in captured[0]['schema_context'] or name=='name'
 assert 'salary' not in captured[0]['glossary'] and 'employees' not in captured[0]['nl_query']
 req['nl_query']='only IT';r=client.post('/api/generate',json=req);assert r.status_code==200,r.text
 assert len(captured[1]['conversation'])==2
 assert len(client.app.state.qm.history_store.read_tree()['nodes'])==2
@pytest.mark.parametrize('output',['','Here is your answer','SELECT invented_column FROM employees','SELECT salary FROM products'])
def test_invalid_model_output_rejected(client,monkeypatch,output):
 async def provider(**kw):return output
 monkeypatch.setattr(generate,'generate_sql',provider)
 r=client.post('/api/generate',json={'nl_query':'find employees','db_config_id':'hr','provider':'local'})
 assert r.status_code==422,r.text
def test_fences_normalized_and_salary_boundary(client,monkeypatch):
 async def provider(**kw):return '```sql\nSELECT name,salary FROM employees WHERE salary > 8000 ORDER BY salary;\n```'
 monkeypatch.setattr(generate,'generate_sql',provider)
 r=client.post('/api/generate',json={'nl_query':'find employees','db_config_id':'hr','provider':'local'})
 assert r.status_code==200,r.text
 result=client.post('/api/execute',json={'sql':r.json()['query'],'connection_id':'hr'})
 assert [x['name'] for x in result.json()['rows']]==['Cara','Dev']
def test_glossary_reopen_and_update(client):
 for threshold in [8000,9000]:
  r=client.post('/api/glossary',json={'term':'high earners','sqlTemplate':f'salary > {threshold}','dialect':'sqlite'});assert r.status_code==200,r.text
 assert client.get('/api/glossary').json()['terms'][0]['sqlTemplate']=='salary > 9000'
def test_impact_contract(client):
 r=client.post('/api/schema/impact',json={'proposed_ddl':'ALTER TABLE employees DROP COLUMN salary','db_config_id':'hr'})
 assert r.status_code==200,r.text
@pytest.mark.parametrize('op',['UNION','INTERSECT','EXCEPT'])
def test_execute_set_operations(client,op):
 r=client.post('/api/execute',json={'sql':f'SELECT id FROM employees {op} SELECT id FROM employees','connection_id':'hr'})
 assert r.status_code==200,r.text
def test_generated_bindings_validated_and_execute_without_interpolation(client,monkeypatch):
 async def provider(**kw):return json.dumps({'query':'SELECT name,salary FROM employees WHERE salary > :threshold','parameters':{'threshold':8000}})
 monkeypatch.setattr(generate,'generate_sql',provider)
 req={'nl_query':'salary above 8000','db_config_id':'hr','provider':'local'}
 r=client.post('/api/generate',json=req);assert r.status_code==200,r.text
 data=r.json();assert data['parameters']=={'threshold':8000}
 r=client.post('/api/execute',json={'connection_id':'hr','sql':data['query'],'parameters':data['parameters']})
 assert [row['name'] for row in r.json()['rows']]==['Cara','Dev']
 async def bad(**kw):return json.dumps({'query':'SELECT name FROM employees WHERE salary > :threshold'})
 monkeypatch.setattr(generate,'generate_sql',bad)
 assert client.post('/api/generate',json=req).status_code==422


def test_obvious_off_topic_list_from_does_not_call_provider(client,monkeypatch):
 async def provider(**kw):pytest.fail('Obvious off-topic input must not call the provider')
 monkeypatch.setattr(generate,'generate_sql',provider)
 for question in ['tell me a joke','list jokes from India','list recipes from France']:
  r=client.post('/api/generate',json={'db_config_id':'hr','provider':'local','nl_query':question})
  assert r.status_code==200 and r.json()['offtopic']
  assert r.json()['providerVerified'] is False

def test_model_clarification_verifies_provider_without_executable_sql(client,monkeypatch):
 async def provider(**kw):return json.dumps({'clarification':'Which salary threshold and period?'})
 monkeypatch.setattr(generate,'generate_sql',provider)
 r=client.post('/api/generate',json={'db_config_id':'hr','provider':'gemini','api_key':'fixture-not-real','nl_query':'Who earns a lot?'})
 assert r.status_code==200,r.text
 assert r.json()['providerVerified'] is True and r.json()['query'] is None

def test_anonymous_semantic_roles_and_user_facing_clarification_names(client,monkeypatch):
 async def provider(**kw):
  schema=json.loads(kw['schema_context']);columns={c['name']:c for c in schema[0]['columns']}
  assert columns['col_1']['semanticHint']=='organizational unit'
  assert columns['col_3']['semanticHint']=='entity label'
  assert 'employees' not in kw['schema_context'] and 'department' not in kw['schema_context']
  return json.dumps({'clarification':'Should IT filter col_1 or col_3 in table_1?'})
 monkeypatch.setattr(generate,'generate_sql',provider)
 r=client.post('/api/generate',json={'db_config_id':'hr','provider':'gemini','api_key':'fixture-not-real','nl_query':'Only IT from those employees'})
 assert r.status_code==200,r.text
 assert r.json()['message']=='Should IT filter department or name in employees?'
 assert not client.app.state.qm.privacy_shield._active_maps
