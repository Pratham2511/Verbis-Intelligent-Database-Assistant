import sys, os, asyncio, time, threading
sys.path.insert(0,os.path.join(os.path.dirname(__file__),'..'))
import pytest
from sqlalchemy import create_engine,text
from services.validator_service import Validator
from services.pii_service import PIIMasker
from services.execution_service import ExecutionService
from models.requests import ExecuteRequest

@pytest.mark.parametrize('sql',[
 'SELECT id INTO salary_copy FROM employees',
 'WITH x AS (DELETE FROM employees RETURNING *) SELECT * FROM x',
 'EXPLAIN ANALYZE DELETE FROM employees', 'SELECT nextval(\'seq\')',
 'SELECT evil_function()', 'SELECT 1; DELETE FROM employees', 'SELECT * FROM employees FOR UPDATE'])
def test_nested_mutations_blocked(sql):assert not Validator().is_read_only_script(sql)
@pytest.mark.parametrize('op',['UNION','INTERSECT','EXCEPT'])
def test_set_reads_allowed(op):assert Validator().is_read_only(f'SELECT 1 {op} SELECT 2')
def test_semantic_qualification():
 v=Validator('sqlite');schema=[{'tableName':'employees','columns':[{'name':'id','type':'INTEGER'},{'name':'salary','type':'REAL'}]}]
 assert v.validate_semantic('WITH x AS (SELECT salary AS amount FROM employees) SELECT SUM(amount) AS total FROM x',schema)
 assert not v.validate_semantic('SELECT invented FROM employees',schema)
 assert not v.validate_semantic('SELECT * FROM invented',schema)
def test_pii_all_rows_types_and_no_input_mutation():
 rows=[{'total':50000005000000,'department':'Human Resources','value':'safe'} for _ in range(5)]+[{'value':'person@example.com'}]
 cols,out,audit=PIIMasker().mask_results(['total','department','value'],rows)
 assert out[0]['total']==50000005000000 and out[0]['department']=='Human Resources'
 assert out[5]['value']=='xxx@xxx.com' and rows[5]['value']=='person@example.com'
 assert 'person@example.com' not in str(audit)
@pytest.mark.parametrize('kw',[{'row_limit':-1},{'row_limit':10001},{'timeout_seconds':0},{'timeout_seconds':601}])
def test_execution_bounds(kw):
 with pytest.raises(ValueError):ExecuteRequest(sql='SELECT 1',connection_id='hr',**kw)
def test_timeout_responsive_and_no_following_write(tmp_path):
 engine=create_engine(f'sqlite:///{tmp_path}/timeout.db');svc=ExecutionService(engine,timeout_seconds=1,row_limit=5)
 async def run():
  start=time.monotonic()
  task=asyncio.create_task(svc.execute('WITH RECURSIVE t(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM t WHERE x<100000000) SELECT sum(x) FROM t; CREATE TABLE should_not_exist(id INT)'))
  await asyncio.sleep(.05);assert time.monotonic()-start<.5
  with pytest.raises(TimeoutError):await task
  assert time.monotonic()-start<2
 asyncio.run(run())
 with engine.connect() as c:assert c.execute(text("SELECT name FROM sqlite_master WHERE name='should_not_exist'")).fetchall()==[]
 engine.dispose()
def test_real_sqlite_read_only_defense(tmp_path):
 engine=create_engine(f'sqlite:///{tmp_path}/readonly.db')
 with engine.begin() as c:c.exec_driver_sql('CREATE TABLE t(id INT)')
 with pytest.raises(RuntimeError):asyncio.run(ExecutionService(engine,read_only=True).execute('INSERT INTO t VALUES(1)'))
 assert asyncio.run(ExecutionService(engine).execute('SELECT * FROM t'))['rowCount']==0
 engine.dispose()

def test_generated_semantics_rejects_second_statement_and_nested_write():
 schema=[{'tableName':'employees','columns':[{'name':'id','type':'INTEGER'}]}]
 v=Validator('postgres')
 for sql in ['SELECT id FROM employees; SELECT invented FROM employees','SELECT id FROM employees; DELETE FROM employees','SELECT id INTO copied FROM employees']:
  assert not v.validate_semantic(sql,schema)
