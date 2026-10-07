"""Exact-key SQL/CSV reconciliation with explicit units and exportable guarded corrections."""
import json
from datetime import datetime
from decimal import Decimal,InvalidOperation
import sqlglot
from sqlglot import exp
from sqlalchemy import inspect
from services.execution_service import ExecutionService
from services.validator_service import Validator
from services.dataset_service import identifier
from services.workspace_store import WorkspaceStore
class ReconciliationService:
    def __init__(self,state):self.state=state
    async def preview(self,payload):
        """Regenerate guards, then measure affected saved reports on a snapshot."""
        import asyncio,sqlite3,tempfile,time
        from sqlalchemy import create_engine
        from services.analysis_service import AnalysisService
        review=await self.run(payload)
        if review['partial'] or not review['repairs']:
            raise ValueError('A complete comparison with guarded corrections is required for preview')
        if len(review['repairs'])!=review['conflictCount']:
            raise ValueError('Some conflicts cannot produce safe corrections; resolve them before preview')
        source=payload['left'];engine=self.state.db_pools.get(source['connectionId'])
        if engine is None or engine.dialect.name!='sqlite':raise ValueError('Correction preview currently supports SQLite only')
        tables={r['table'] for r in review['repairs']}
        analyses=[]
        for a in AnalysisService(self.state).list()['analyses']:
            if a['connectionId']!=source['connectionId']:continue
            try:references={t.name for t in sqlglot.parse_one(a['sql'],read='sqlite').find_all(exp.Table)}
            except Exception:continue
            if references & tables:analyses.append(a)
        if len(analyses)>20:raise ValueError('Preview supports at most 20 affected saved analyses')
        with tempfile.TemporaryDirectory(prefix='verbis-correction-preview-') as directory:
            database=directory+'/snapshot.db'
            def backup():
                deadline=time.monotonic()+20
                with engine.connect() as original,sqlite3.connect(database) as target:
                    def progress(*args):
                        if time.monotonic()>deadline:raise TimeoutError('Snapshot timed out')
                    original.connection.driver_connection.backup(target,pages=100,progress=progress)
            await asyncio.to_thread(backup)
            sandbox=create_engine('sqlite:///'+database)
            deadline=time.monotonic()+30
            async def capture(analysis):
                remaining=deadline-time.monotonic()
                if remaining<=0:raise TimeoutError('Saved-report preview timed out')
                if not Validator('sqlite').is_read_only_script(analysis['sql']):return {'error':'Saved analysis is not read-only'}
                try:
                    result=await ExecutionService(sandbox,timeout_seconds=min(5,remaining),row_limit=1000,read_only=True).execute(analysis['sql'],analysis['parameters'])
                    canonical=sorted(json.dumps(row,sort_keys=True,default=str) for row in result['rows'])
                    _,masked,_=self.state.pii_masker.mask_results(result['columns'],result['rows'][:10])
                    return {'columns':result['columns'],'rows':masked,'rowCount':result['rowCount'],'truncated':result['truncated'],'canonical':canonical}
                except Exception:return {'error':'Saved analysis could not run on the isolated snapshot'}
            try:
                before=[await capture(a) for a in analyses]
                def apply_guards():
                    with sqlite3.connect(database) as conn:
                        conn.execute('PRAGMA foreign_keys=ON')
                        conn.set_progress_handler(lambda:int(time.monotonic()>deadline),1000)
                        for repair in review['repairs']:
                            if time.monotonic()>deadline:raise TimeoutError('Correction preview timed out')
                            changed=conn.execute(repair['sql'],repair['parameters']).rowcount
                            if changed!=1:raise ValueError('Source changed during review; compare again before preview')
                await asyncio.to_thread(apply_guards)
                after=[await capture(a) for a in analyses]
                reports=[]
                for a,b,c in zip(analyses,before,after):
                    complete='canonical' in b and 'canonical' in c and not b['truncated'] and not c['truncated']
                    changed=b.get('canonical')!=c.get('canonical') if complete else None
                    for result in (b,c):result.pop('canonical',None)
                    reports.append({'name':a['name'],'sql':a['sql'],'parameters':a['parameters'],'before':b,'after':c,'comparisonComplete':complete,'outputChanged':changed})
                return {'isolated':True,'connectionId':source['connectionId'],'proposalsTested':len(review['repairs']),'repairs':review['repairs'],'reports':reports,'limitations':['Corrections were applied only to a temporary snapshot. The source database is unchanged.','Direct table references in saved analyses; view dependencies and application code are not covered.','Comparisons load at most 1,000 rows; previews show at most 10 masked rows per report. Limited comparisons do not establish equivalence.']}
            finally:sandbox.dispose()
    async def run(self,payload):
        left=payload.get('left',{});right=payload.get('right',{});fields=payload.get('fields',[])
        if not 1<=len(fields)<=20:raise ValueError('Map 1–20 fields explicitly')
        normalization=payload.get('keyNormalization','exact')
        if normalization not in ('exact','text','trimmed-text'):raise ValueError('Unsupported key normalization')
        results=[]
        for source in (left,right):
            engine=self.state.db_pools.get(source.get('connectionId'))
            if engine is None:raise ValueError('A source connection is unavailable')
            sql=source.get('sql','')
            if not Validator(engine.dialect.name).is_read_only_script(sql):raise ValueError('Source queries must be read-only')
            r=await ExecutionService(engine,timeout_seconds=min(20,self.state.settings.execution_timeout_seconds),row_limit=min(10000,self.state.settings.row_limit_max),read_only=True).execute(sql,source.get('parameters',{}))
            if source.get('key') not in r['columns']:raise ValueError('Key is missing from source output')
            for mapping in fields:
                if mapping['left' if source is left else 'right'] not in r['columns']:raise ValueError('A mapped field is missing from source output')
            results.append(r)
        for field in fields:
            lp,rp=field.get('leftPeriod','unknown'),field.get('rightPeriod','unknown')
            if lp not in ('monthly','annual','none') or rp not in ('monthly','annual','none'):raise ValueError('Confirm periods for both mapped fields; unknown units cannot be compared')
            if (lp=='none')!=(rp=='none'):raise ValueError('A unitless field cannot be compared with a salary period')
            if field.get('leftCurrency','')!=field.get('rightCurrency',''):raise ValueError('Currency conversion requires a reviewed exchange rate and is not supported here')
            if field.get('type')=='date' and (lp!='none' or rp!='none' or not field.get('leftDateFormat') or not field.get('rightDateFormat')):raise ValueError('Date fields require explicit formats for both sources and period none')
            for source,label in ((left,'left'),(right,'right')):
                if source.get('connectionId')=='datasets':
                    q=sqlglot.parse_one(source['sql'],read='sqlite');tables=list(q.find_all(exp.Table))
                    if len(tables)==1:
                        cat=WorkspaceStore(self.state.workspace_path/'datasets.json').read({'tables':[]})
                        table=next((t for t in cat['tables'] if t['table']==tables[0].name),None)
                        col=next((m for m in table['mapping'] if m['name']==field[label]),None) if table else None
                        if col and col.get('period') not in ('unknown','none',None) and col['period']!=field[label+'Period']:raise ValueError('Period mapping conflicts with imported provenance')
                        if col and col.get('currency') and col['currency']!=field.get(label+'Currency'):raise ValueError('Currency mapping conflicts with imported provenance')
        def token(value):
            if normalization=='text':return str(value)
            if normalization=='trimmed-text':return str(value).strip()
            return json.dumps(value,sort_keys=True,default=str)
        maps=[];ambiguous=[]
        for source,r in zip((left,right),results):
            grouped={}
            for row in r['rows']:grouped.setdefault(token(row[source['key']]),[]).append(row)
            maps.append(grouped)
            for k,rows in grouped.items():
                if len(rows)>1 or rows[0][source['key']] is None:ambiguous.append({'source':source['connectionId'],'key':self.mask(source['key'],rows[0][source['key']])[0],'count':len(rows),'reason':'Duplicate or NULL key'})
        a,b=maps;conflicts=[];missing=[];repairs=[];unresolved=[]
        repair_target=self._repair_target(left)
        for k in sorted(set(a)|set(b)):
            aa,bb=a.get(k,[]),b.get(k,[])
            if len(aa)>1 or len(bb)>1 or (aa and aa[0][left['key']] is None) or (bb and bb[0][right['key']] is None):continue
            row=aa[0] if aa else bb[0];key_name=left['key'] if aa else right['key'];key_value=row[key_name];masked_key,key_sensitive=self.mask(key_name,key_value)
            if not aa or not bb:missing.append({'key':masked_key,'missingFrom':'SQL source' if not aa else 'comparison source'});continue
            for index,field in enumerate(fields):
                av,bv=aa[0][field['left']],bb[0][field['right']]
                try:
                    an,bn=self.normalize(av,field['leftPeriod'],field.get('leftDateFormat') if field.get('type')=='date' else None),self.normalize(bv,field['rightPeriod'],field.get('rightDateFormat') if field.get('type')=='date' else None)
                    equal=an==bn
                except (ValueError,InvalidOperation):unresolved.append({'key':masked_key,'field':field['left'],'reason':'Value does not match the explicit unit rule'});continue
                if equal:continue
                shown_a,sa=self.mask(field['left'],av);shown_b,sb=self.mask(field['right'],bv)
                rule=f"Explicit dates: {field.get('leftDateFormat')} vs {field.get('rightDateFormat')}" if field.get('type')=='date' else f"{field['leftPeriod']} vs {field['rightPeriod']}; normalized to monthly when periods apply"
                conflicts.append({'key':masked_key,'field':field['left'],'left':shown_a,'right':shown_b,'rule':rule,'normalizedLeft':str(an) if not sa else 'masked','normalizedRight':str(bn) if not sb else 'masked'})
                if repair_target and not(key_sensitive or sa or sb) and not any(r['truncated'] for r in results):
                    new=bv if field['leftPeriod']=='none' else None if bn is None else float(bn*12 if field['leftPeriod']=='annual' else bn)
                    if field.get('type')=='date':new=None if bn is None else datetime.strptime(bn,'%Y-%m-%d').strftime(field['leftDateFormat'])
                    table=identifier(repair_target);column=identifier(field['left']);key_column=identifier(left['key'])
                    repairs.append({'table':repair_target,'key':key_value,'field':field['left'],'old':av,'new':new,'sql':f'UPDATE {table} SET {column} = :new_value WHERE {key_column} = :entity_key AND ({column} = :old_value OR ({column} IS NULL AND :old_value IS NULL));','parameters':{'new_value':new,'old_value':av,'entity_key':key_value},'expectedAffectedRows':1,'reviewRequired':True})
        return {'conflicts':conflicts[:1000],'conflictCount':len(conflicts),'missing':missing[:1000],'missingCount':len(missing),'ambiguous':ambiguous[:1000],'unresolved':unresolved[:1000],'repairs':repairs[:1000],'partial':any(r['truncated'] for r in results),'sources':[{'connectionId':s['connectionId'],'rowCount':r['rowCount'],'truncated':r['truncated']} for s,r in zip((left,right),results)],'rules':fields,'limitations':['Exact supplied keys; duplicate/NULL keys remain unresolved.','Corrections are guarded proposals for review and export. No production apply operation.','PII is masked; sensitive keys/fields and incomplete sources do not produce repair scripts.']}
    def mask(self,column,value):
        cols,rows,_=self.state.pii_masker.mask_results([column],[{column:value}]);return rows[0][column],bool(cols)
    def normalize(self,value,period,date_format=None):
        if value is None:return None
        if date_format:return datetime.strptime(str(value),date_format).date().isoformat()
        if period=='none':return value
        number=Decimal(str(value))
        if not number.is_finite():raise ValueError('Invalid numeric amount')
        return number/12 if period=='annual' else number
    def _repair_target(self,source):
        try:
            engine=self.state.db_pools.get(source['connectionId'])
            if engine.dialect.name!='sqlite':return None
            q=sqlglot.parse_one(source['sql'],read='sqlite' if engine.dialect.name=='sqlite' else engine.dialect.name)
            if not isinstance(q,exp.Select) or q.args.get('joins') or q.args.get('with_') or q.args.get('group') or list(q.find_all(exp.Subquery)):return None
            table=q.args['from_'].this
            if not isinstance(table,exp.Table) or table.db or table.catalog:return None
            pk=inspect(engine).get_pk_constraint(table.name).get('constrained_columns',[])
            if pk!=[source['key']]:return None
            # Repairs require direct output columns, not aliased/calculated expressions.
            if not all(isinstance(c,(exp.Column,exp.Star)) for c in q.expressions):return None
            return table.name
        except Exception:return None
