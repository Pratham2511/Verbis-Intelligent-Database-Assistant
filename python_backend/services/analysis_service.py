"""Connection-bound named analyses. Save SQL/definitions, not result rows or credentials."""
import time
import uuid
import sqlglot
from sqlglot import exp
from services.workspace_store import WorkspaceStore
from services.validator_service import Validator
class AnalysisService:
    def __init__(self,state):self.state=state;self.store=WorkspaceStore(state.workspace_path/'analyses.json')
    def list(self):return self.store.read({'analyses':[]})
    def save(self,payload,info,glossary):
        sql=payload.get('sql','');name=payload.get('name','').strip();connection=payload.get('connectionId')
        engine=self.state.db_pools.get(connection)
        if not name or len(name)>120:raise ValueError('Name the analysis (1–120 characters)')
        validator=Validator(engine.dialect.name)
        if not validator.is_read_only_script(sql) or not validator.validate_semantic(sql,info['tables']):raise ValueError('Saved analyses require schema-valid, read-only SQL')
        parameters=payload.get('parameters',{})
        parsed=sqlglot.parse_one(sql,read=validator.dialect)
        names={p.name for p in parsed.find_all(exp.Placeholder)}
        if set(parameters)!=names:raise ValueError('Parameters must match the SQL :named placeholders exactly')
        if any(not isinstance(v,(str,int,float,bool,type(None))) for v in parameters.values()):raise ValueError('Parameters must be scalar values')
        entry={'id':payload.get('id') or str(uuid.uuid4()),'name':name,'question':payload.get('question',''), 'sql':sql,'connectionId':connection,'schemaFingerprint':info['fingerprint'],'glossaryRevision':glossary['revision'],'definitions':glossary['terms'],'parameters':parameters,'updatedAt':int(time.time()*1000)}
        def save(store):store['analyses'][:]=[a for a in store['analyses'] if a['id']!=entry['id']]+[entry]
        self.store.update({'analyses':[]},save)
        return entry
    def delete(self,id):
        def remove(store):store['analyses'][:]=[a for a in store['analyses'] if a['id']!=id]
        self.store.update({'analyses':[]},remove);return {'deleted':True}

def chart_suggestion(sql,columns,rows):
    try:parsed=sqlglot.parse_one(sql)
    except Exception:return None
    if not parsed.args.get('group') or not list(parsed.find_all(exp.AggFunc)) or len(columns)!=2 or not rows or len(rows)>50:return None
    x,y=columns
    if not all(isinstance(r.get(y),(int,float)) and not isinstance(r.get(y),bool) and r[y]>=0 and isinstance(r.get(x),(str,int,float)) for r in rows):return None
    return {'kind':'bar','labelColumn':x,'valueColumn':y,'reason':'One grouping dimension and one measured numeric aggregate','points':[{x:r[x],y:r[y]} for r in rows]}
