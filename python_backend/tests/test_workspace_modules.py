import sys,os,json,sqlite3
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,os.path.join(os.path.dirname(__file__),'..'))
import pytest
from sqlalchemy import text
from services.dataset_service import DatasetService
from services.navigator_service import NavigatorService
from services.analysis_service import AnalysisService,chart_suggestion
from services.pii_service import PIIMasker
from core.db_pool import DBPoolManager
from services.glossary_service import GlossaryService
from test_http_repairs import client

@pytest.fixture
def state(tmp_path):
    q=tmp_path/'.qmind';q.mkdir();pools=DBPoolManager()
    s=SimpleNamespace(workspace_path=q,db_pools=pools,extra={},pii_masker=PIIMasker())
    yield s
    pools.dispose_all()
def preview_payload(s,**kw):
    svc=DatasetService(s);p={'content':'id,name,salary\n1,Alice,7500\n2,Bob,8000\n3,Cara,8001\n4,Dev,12000\n5,Esha,\n','table':'employees','key':'id',**kw}
    r=svc.preview(p);p.update(mapping=r['mapping'],previewHash=r['previewHash']);return svc,p,r

def test_csv_salary_boundaries_nulls_provenance_and_reimport(state):
    svc,p,r=preview_payload(state)
    assert r['nulls']['salary']==1 and r['conversionErrorCount']==0
    out=svc.import_csv(p);assert out['report']['rowCount']==5
    with state.db_pools.get('datasets').connect() as c:
        assert [r.name for r in c.execute(text('SELECT name FROM employees WHERE salary > 8000 ORDER BY salary'))]==['Cara','Dev']
    with pytest.raises(ValueError,match='Table exists'):svc.import_csv(p)
    p['policy']='replace';svc.import_csv(p)
    with sqlite3.connect(svc.database) as c:assert c.execute('SELECT count(*) FROM employees').fetchone()[0]==5
    p['policy']='append'
    with pytest.raises(sqlite3.IntegrityError):svc.import_csv(p)
    with sqlite3.connect(svc.database) as c:assert c.execute('SELECT count(*) FROM employees').fetchone()[0]==5
    assert svc.store.read({})['tables'][0]['sourceHash']==r['sourceHash']

def test_currency_duplicates_invalid_dates_are_visible(state):
    svc,p,r=preview_payload(state,content='id;salary;date\n1;₹8,001;01/02/2026\n1;;\n',delimiter=';')
    assert r['mapping'][1]['type']=='TEXT' and r['mapping'][2]['type']=='TEXT'
    m=p['mapping'];m[1].update(type='REAL',currency='INR',period='monthly',groupSeparator=',');m[2].update(type='DATE')
    r=svc.preview(p);assert r['preview'][0]['salary']==8001 and r['duplicateKeyRows']==[3]
    assert r['conversionErrorCount']==1
    with pytest.raises(ValueError):svc.import_csv({**p,'previewHash':r['previewHash']})
    m[2]['dateFormat']='%d/%m/%Y';p['content']=p['content'].replace('\n1;;','\n2;;');r=svc.preview(p)
    assert r['preview'][0]['date']=='2026-02-01'
    out=svc.import_csv({**p,'previewHash':r['previewHash']});assert out['report']['mapping'][1]['period']=='monthly'

def test_csv_stale_preview_and_header_errors(state):
    svc,p,r=preview_payload(state);p['content']=p['content'].replace('8001','7000')
    with pytest.raises(ValueError,match='Preview'):svc.import_csv(p)
    for content in ['x,x\n1,2','a,b\n1,2,3','']:
        with pytest.raises(ValueError):svc.preview({'content':content})

def test_imported_relationships_are_reviewed_and_enforced(state):
    svc,p,_=preview_payload(state);svc.import_csv(p)
    child={'content':'id,employee_id\n1,4\n2,4','table':'details','key':'id','relationships':[{'column':'employee_id','table':'employees','targetColumn':'id'}]}
    r=svc.preview(child);child.update(mapping=r['mapping'],previewHash=r['previewHash'])
    assert svc.import_csv(child)['report']['relationships']==child['relationships']
    child.update(policy='replace',content='id,employee_id\n1,999')
    r=svc.preview(child);child['previewHash']=r['previewHash']
    with pytest.raises(sqlite3.IntegrityError):svc.import_csv(child)
    with sqlite3.connect(svc.database) as c:
        assert c.execute('SELECT count(*) FROM details').fetchone()[0]==2
    child['relationships'][0]['targetColumn']='salary'
    with pytest.raises(ValueError,match='primary key'):svc.preview(child)

def test_file_preview_masks_email_beyond_five_rows(state):
    r=DatasetService(state).preview({'content':'id,contact\n'+''.join(f'{i},e{i}@example.com\n' for i in range(10))})
    assert all('@example.com' not in str(row) for row in r['preview'])

def test_project_adapter_reads_writes_dynamic_sql_and_refresh(state):
    source=state.workspace_path.parent/'payroll.py'
    source.write_text('''from sqlalchemy import Column,Integer,select,update,text
class Employee(Base):
 __tablename__="employees"
 id=Column(Integer)
 salary=Column(Integer)
def report(session):
 session.execute(text("SELECT salary FROM employees WHERE salary > 8000"))
 session.execute(select(Employee.salary))
def change(session):
 session.execute(update(Employee).values(salary=1))
def dynamic(session,query):
 session.execute(query)
''')
    svc=NavigatorService(state);index=svc.scan()
    assert any(e['table']=='employees' and e['kind']=='read' and e['symbol']=='report' for e in index['entries'])
    assert any(e['kind']=='write' and e['symbol']=='change' for e in index['entries'])
    assert any(u['symbol']=='dynamic' for u in index['unresolved'])
    source.write_text(source.read_text().replace('employees','workers'))
    assert any(e['table']=='workers' for e in svc.scan()['entries'])
    assert not any(e['table']=='employees' for e in svc.scan()['entries'])

def test_analysis_parameters_bindings_reopen_and_chart(state):
    svc,p,_=preview_payload(state);svc.import_csv(p)
    a=AnalysisService(state);info={'tables':[{'tableName':'employees','columns':[{'name':'id','type':'INTEGER'},{'name':'salary','type':'INTEGER'}]}],'fingerprint':'rev1'}
    entry=a.save({'name':'High earners','sql':'SELECT id,salary FROM employees WHERE salary > :threshold','connectionId':'datasets','parameters':{'threshold':8000}},info,{'revision':'terms1','terms':[]})
    assert AnalysisService(state).list()['analyses'][0]['connectionId']=='datasets'
    assert entry['parameters']=={'threshold':8000}
    with pytest.raises(ValueError,match='exactly'):a.save({**entry,'parameters':{'wrong':1}},info,{'revision':'terms1','terms':[]})
    assert chart_suggestion('SELECT department,SUM(salary) FROM employees GROUP BY department',['department','total'],[{'department':'IT','total':28000}])['points'][0]['total']==28000
    assert chart_suggestion('SELECT name,salary FROM employees',['name','salary'],[{'name':'Dev','salary':12000}]) is None

def test_workspace_http_operations(client):
    from api.routes import workspace
    client.app.include_router(workspace.router,prefix='/api')
    r=client.post('/api/workspace/dataset_preview',json={'payload':{'content':'id,salary\n1,8001','table':'csv_employees'}})
    assert r.status_code==200,r.text
    p={'content':'id,salary\n1,8001','table':'csv_employees','mapping':r.json()['mapping'],'previewHash':r.json()['previewHash']}
    r=client.post('/api/workspace/dataset_import',json={'payload':p});assert r.status_code==200,r.text
    assert client.post('/api/workspace/dataset_catalog',json={'payload':{}}).json()['tables'][0]['totalRows']==1
    assert client.get('/api/schema?dbConfigId=datasets').status_code==200

@pytest.mark.asyncio
async def test_forensics_equality_null_and_join_expansion(client):
    from services.forensics_service import ForensicsService
    state=client.app.state.qm;svc=ForensicsService(state,'hr')
    sql='SELECT id,name,salary FROM employees WHERE salary > 8000'
    r=await svc.diagnose({'sql':sql,'entityKey':2});assert r['evidence'][0]['statuses']['predicate_1']=='fail'
    r=await svc.diagnose({'sql':sql,'entityKey':5});assert r['evidence'][0]['statuses']['predicate_1']=='unknown (NULL)'
    with state.db_pools.get('hr').begin() as c:
        c.execute(text('CREATE TABLE details(id INTEGER PRIMARY KEY, employee_id INT)'))
        c.execute(text('INSERT INTO details VALUES(1,4),(2,4)'))
    r=await svc.diagnose({'sql':'SELECT SUM(e.salary) AS total FROM employees e JOIN details d ON e.id=d.employee_id'})
    assert any(e['kind']=='join-expansion' and e['rows'][0]['joined_rows']==2 for e in r['evidence'])
    aggregate=next(e for e in r['evidence'] if e['kind']=='aggregate-contributions')
    assert aggregate['aggregateRows']==[{'total':24000}]
    assert (await svc.diagnose({'sql':'WITH x AS (SELECT id FROM employees) SELECT * FROM x'}))['supported'] is False

@pytest.mark.asyncio
async def test_rehearsal_rename_breaks_query_without_production_change(client):
    from services.rehearsal_service import RehearsalService
    state=client.app.state.qm
    r=await RehearsalService(state).run({'connectionId':'hr','ddl':'ALTER TABLE employees RENAME COLUMN salary TO base_salary','queries':[{'name':'Payroll','sql':'SELECT SUM(salary) AS total FROM employees'}]})
    assert r['isolated'] and r['checks'][0]['afterError'] and not r['checks'][0]['outputUnchanged']
    with state.db_pools.get('hr').connect() as c:assert c.execute(text('SELECT salary FROM employees WHERE id=4')).scalar()==12000
    r=await RehearsalService(state).run({'connectionId':'hr','ddl':'ALTER TABLE employees ADD COLUMN active INTEGER DEFAULT 1','queries':[{'name':'Boundary assertion','sql':'SELECT id FROM employees WHERE salary > 8000 ORDER BY id','expectedRows':[{'id':3},{'id':4}]}]})
    assert r['checks'][0]['assertionPassed'] is True
    for ddl in ['DROP TABLE employees','ALTER TABLE employees DROP COLUMN salary','UPDATE employees SET salary=0']:
        with pytest.raises(ValueError):await RehearsalService(state).run({'connectionId':'hr','ddl':ddl})

@pytest.mark.asyncio
async def test_reconcile_periods_conflicts_guarded_repairs_and_ambiguity(client):
    from services.reconciliation_service import ReconciliationService
    state=client.app.state.qm
    with state.db_pools.get('other').begin() as c:
        c.execute(text('CREATE TABLE payroll(id INTEGER, annual_salary REAL)'))
        c.execute(text('INSERT INTO payroll VALUES(1,90000),(2,96000),(3,108000),(4,144000),(6,12000)'))
    p={'left':{'connectionId':'hr','sql':'SELECT id,salary FROM employees','key':'id'},'right':{'connectionId':'other','sql':'SELECT id,annual_salary FROM payroll','key':'id'},'fields':[{'left':'salary','right':'annual_salary','leftPeriod':'monthly','rightPeriod':'annual','leftCurrency':'INR','rightCurrency':'INR'}]}
    svc=ReconciliationService(state);r=await svc.run(p)
    assert r['conflictCount']==1 and r['conflicts'][0]['key']==3
    assert r['repairs'][0]['old']==8001 and r['repairs'][0]['new']==9000
    assert ':old_value' in r['repairs'][0]['sql'] and r['missingCount']==2
    with state.db_pools.get('other').begin() as c:c.execute(text('INSERT INTO payroll VALUES(3,96000)'))
    r=await svc.run(p);assert r['ambiguous'][0]['key']==3 and not r['repairs']
    p['fields'][0]['rightPeriod']='unknown'
    with pytest.raises(ValueError,match='Confirm periods'):await svc.run(p)


def test_cross_file_orm_model_refresh_and_private_configuration(state):
    root=state.workspace_path.parent
    (root/'models.py').write_text('class Employee(Base):\n __tablename__="employees"\n salary=Column(Integer)\n')
    (root/'service.py').write_text('from models import Employee\nimport sqlalchemy as sa\nengine=sa.create_engine("postgresql://user:PRIVATE_PASSWORD@localhost/payroll")\ndef salaries(session):\n return session.execute(sa.select(Employee.salary))\n')
    svc=NavigatorService(state);result=svc.scan()
    assert any(e['table']=='employees' and e['symbol']=='salaries' for e in result['entries'])
    assert 'PRIVATE_PASSWORD' not in json.dumps(result) and 'PRIVATE_PASSWORD' not in svc.store.path.read_text()
    (root/'models.py').write_text((root/'models.py').read_text().replace('employees','workers'))
    result=svc.scan()
    assert any(e['table']=='workers' and e['symbol']=='salaries' for e in result['entries'])
    assert not any(e['table']=='employees' for e in result['entries'])

def test_project_file_limit_also_bounds_model_discovery(state):
    root=state.workspace_path.parent
    (root/'0000.py').write_text('def report(session):\n session.execute(select(Excluded.salary))\n')
    for i in range(1,2000):(root/f'{i:04}.py').write_text('# fixture\n')
    (root/'zz_model.py').write_text('class Excluded(Base):\n __tablename__="outside_limit"\n')
    svc=NavigatorService(state);result=svc.scan()
    assert len(svc.store.read({})['files'])==2000
    assert any('2,000' in e['reason'] for e in result['unresolved'])
    assert any('Excluded' in e['reason'] for e in result['unresolved'])
    assert not any(e['table']=='outside_limit' for e in result['entries'])

@pytest.mark.asyncio
async def test_forensics_deliberate_interpretation_preview(client):
    from services.forensics_service import ForensicsService
    r=await ForensicsService(client.app.state.qm,'hr').diagnose({'sql':'SELECT id FROM employees WHERE salary > :threshold','comparisonSql':'SELECT id FROM employees WHERE salary >= :threshold','parameters':{'threshold':8000},'entityKey':2})
    preview=r['interpretationPreview']
    assert preview['original']['rows']==[{'id':3},{'id':4}]
    assert preview['alternative']['rows']==[{'id':2},{'id':3},{'id':4}]
    assert preview['completeComparison'] and '> :threshold' in r['originalSql']

@pytest.mark.asyncio
async def test_reconciliation_explicit_date_formats(client):
    from services.reconciliation_service import ReconciliationService
    state=client.app.state.qm
    with state.db_pools.get('hr').begin() as c:
        c.execute(text('CREATE TABLE dated(id INTEGER PRIMARY KEY, payday TEXT)'))
        c.execute(text("INSERT INTO dated VALUES(1,'2026-02-01'),(2,'2026-03-01')"))
    with state.db_pools.get('other').begin() as c:
        c.execute(text('CREATE TABLE dates_csv(id INTEGER, payday TEXT)'))
        c.execute(text("INSERT INTO dates_csv VALUES(1,'01/02/2026'),(2,'02/03/2026')"))
    p={'left':{'connectionId':'hr','sql':'SELECT id,payday FROM dated','key':'id'},'right':{'connectionId':'other','sql':'SELECT id,payday FROM dates_csv','key':'id'},'fields':[{'left':'payday','right':'payday','type':'date','leftPeriod':'none','rightPeriod':'none','leftDateFormat':'%Y-%m-%d','rightDateFormat':'%d/%m/%Y'}]}
    r=await ReconciliationService(state).run(p)
    assert r['conflictCount']==1 and r['repairs'][0]['new']=='2026-03-02'
    del p['fields'][0]['rightDateFormat']
    with pytest.raises(ValueError,match='explicit formats'):await ReconciliationService(state).run(p)

@pytest.mark.asyncio
async def test_reconciliation_previews_saved_reports_without_mutating_source(client):
    from services.reconciliation_service import ReconciliationService
    from api.routes.schema import schema_result
    state=client.app.state.qm
    with state.db_pools.get('other').begin() as c:
        c.execute(text('CREATE TABLE payroll(id INTEGER, annual_salary REAL)'))
        c.execute(text('INSERT INTO payroll VALUES(3,108000),(4,144000)'))
    info=await schema_result(state,'hr')
    analyses=AnalysisService(state)
    analyses.save({'name':'Payroll total','sql':'SELECT SUM(salary) AS total FROM employees','connectionId':'hr'},info,{'revision':'1','terms':[]})
    analyses.save({'name':'IT salaries','sql':'SELECT salary FROM employees WHERE department=:department','parameters':{'department':'IT'},'connectionId':'hr'},info,{'revision':'1','terms':[]})
    p={'left':{'connectionId':'hr','sql':'SELECT id,salary FROM employees WHERE salary > :threshold','parameters':{'threshold':8000},'key':'id'},'right':{'connectionId':'other','sql':'SELECT id,annual_salary FROM payroll WHERE id >= :minimum','parameters':{'minimum':3},'key':'id'},'fields':[{'left':'salary','right':'annual_salary','leftPeriod':'monthly','rightPeriod':'annual','leftCurrency':'INR','rightCurrency':'INR'}]}
    # Client-supplied SQL proposals are ignored: preview regenerates exact guards.
    p['repairs']=[{'sql':'DELETE FROM employees'}]
    result=await ReconciliationService(state).preview(p)
    assert result['isolated'] and result['proposalsTested']==1
    total=next(r for r in result['reports'] if r['name']=='Payroll total')
    assert total['outputChanged'] and total['comparisonComplete']
    assert total['before']['rows']==[{'total':35501}] and total['after']['rows']==[{'total':36500}]
    assert next(r for r in result['reports'] if r['name']=='IT salaries')['outputChanged'] is False
    with state.db_pools.get('hr').connect() as c:assert c.execute(text('SELECT salary FROM employees WHERE id=3')).scalar()==8001

@pytest.mark.asyncio
async def test_reconciliation_snapshot_guards_reject_source_drift(client):
    from services.reconciliation_service import ReconciliationService
    state=client.app.state.qm
    with state.db_pools.get('other').begin() as c:
        c.execute(text('CREATE TABLE payroll(id INTEGER, salary REAL)'));c.execute(text('INSERT INTO payroll VALUES(3,9000)'))
    p={'left':{'connectionId':'hr','sql':'SELECT id,salary FROM employees','key':'id'},'right':{'connectionId':'other','sql':'SELECT id,salary FROM payroll','key':'id'},'fields':[{'left':'salary','right':'salary','leftPeriod':'monthly','rightPeriod':'monthly'}]}
    svc=ReconciliationService(state);original=svc.run
    async def change_after_review(payload):
        result=await original(payload)
        with state.db_pools.get('hr').begin() as c:c.execute(text('UPDATE employees SET salary=8500 WHERE id=3'))
        return result
    svc.run=change_after_review
    with pytest.raises(ValueError,match='Source changed'):await svc.preview(p)
    with state.db_pools.get('hr').connect() as c:assert c.execute(text('SELECT salary FROM employees WHERE id=3')).scalar()==8500
