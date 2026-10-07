"""SQLite add/rename rehearsals on a disposable backup; production is never mutated."""
import json
import sqlite3
import tempfile
import time
import sqlglot
from sqlglot import exp
from sqlalchemy import create_engine
from services.execution_service import ExecutionService
from services.validator_service import Validator
from services.analysis_service import AnalysisService
from services.navigator_service import NavigatorService
class RehearsalService:
    def __init__(self,state):self.state=state
    async def run(self,payload):
        connection=payload.get('connectionId');engine=self.state.db_pools.get(connection)
        if engine is None or engine.dialect.name!='sqlite':raise ValueError('This rehearsal slice supports SQLite only')
        ddl=payload.get('ddl','');trees=sqlglot.parse(ddl,read='sqlite')
        if not trees or len(trees)>10:raise ValueError('Provide 1–10 ADD COLUMN or RENAME COLUMN statements')
        changes=[]
        for tree in trees:
            if not isinstance(tree,exp.Alter) or tree.args.get('kind')!='TABLE':raise ValueError('Only ALTER TABLE ADD COLUMN and RENAME COLUMN are supported')
            actions=tree.args.get('actions',[])
            if not actions or any(not isinstance(a,(exp.ColumnDef,exp.RenameColumn)) for a in actions):raise ValueError('Only simple additions and column renames are supported')
            changes.append({'table':tree.this.name,'ddl':tree.sql(dialect='sqlite')})
        analyses=[a for a in AnalysisService(self.state).list()['analyses'] if a['connectionId']==connection]
        supplied=payload.get('queries',[])
        if len(supplied)>20:raise ValueError('Select at most 20 queries')
        queries=supplied or [{'name':a['name'],'sql':a['sql'],'parameters':a['parameters']} for a in analyses[:20]]
        for q in queries:
            if not Validator('sqlite').is_read_only_script(q['sql']):raise ValueError('Rehearsal queries must be read-only')
        with tempfile.TemporaryDirectory(prefix='verbis-rehearsal-') as directory:
            database=directory+'/snapshot.db'
            # Backup runs off the event loop and is bounded independently.
            import asyncio
            def backup():
                deadline=time.monotonic()+20
                with engine.connect() as source,sqlite3.connect(database) as target:
                    def progress(*args):
                        if time.monotonic()>deadline:raise TimeoutError('Snapshot timed out')
                    source.connection.driver_connection.backup(target,pages=100,progress=progress)
            await asyncio.to_thread(backup)
            sandbox=create_engine('sqlite:///'+database)
            try:
                executor=ExecutionService(sandbox,timeout_seconds=10,row_limit=1000,read_only=True)
                async def capture(q):
                    try:return {'result':await executor.execute(q['sql'],q.get('parameters',{}))}
                    except Exception as exc:return {'error':str(exc)[:500]}
                before=[await capture(q) for q in queries]
                migration=await ExecutionService(sandbox,timeout_seconds=10,read_only=False).execute(ddl)
                after=[await capture(q) for q in queries]
                checks=[]
                for q,a,b in zip(queries,before,after):
                    limited=a.get('result',{}).get('truncated') or b.get('result',{}).get('truncated')
                    equal='result' in a and 'result' in b and not limited and _canonical(a['result'])==_canonical(b['result'])
                    expected=q.get('expectedRows')
                    assertion= None if expected is None else 'result' in b and not limited and _canonical({'rows':expected})==_canonical(b['result'])
                    checks.append({'name':q.get('name','Query'),'sql':q['sql'],'beforeError':a.get('error'),'afterError':b.get('error'),'beforeRows':a.get('result',{}).get('rowCount'),'afterRows':b.get('result',{}).get('rowCount'),'outputUnchanged':equal,'comparisonComplete':not limited,'assertionPassed':assertion})
                refs=NavigatorService(self.state).scan()
                affected=[e for e in refs['entries'] if any(e.get('table')==c['table'] for c in changes)]
                candidates=[]
                for tree in trees:
                    for change in tree.args['actions']:
                        if isinstance(change,exp.RenameColumn):
                            old,new=change.this.name,change.args['to'].name
                            for a in analyses:
                                parsed=sqlglot.parse_one(a['sql'],read='sqlite')
                                tables=list(parsed.find_all(exp.Table))
                                if len(tables)==1 and tables[0].name==tree.this.name:
                                    edited=parsed.copy();found=False
                                    for col in edited.find_all(exp.Column):
                                        if col.name==old:col.set('this',exp.to_identifier(new));found=True
                                    if found:candidates.append({'analysis':a['name'],'before':a['sql'],'candidateSql':edited.sql(dialect='sqlite'),'reviewRequired':True})
                return {'dialect':'sqlite','isolated':True,'ddl':ddl,'changes':changes,'checks':checks,'affectedReferences':affected,'candidatePatches':candidates,'limitations':['Current database snapshot; application code is not executed.','Only simple column additions/renames. Finite result comparisons do not prove equivalence.','No production apply operation. Export and review changes separately.']}
            finally:sandbox.dispose()
def _canonical(result):return sorted(json.dumps(row,sort_keys=True,default=str) for row in result['rows'])
