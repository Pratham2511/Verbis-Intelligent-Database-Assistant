"""Bounded SQL diagnostics for simple SELECT predicates, joins and aggregates."""
import sqlglot
from sqlglot import exp
from sqlalchemy import inspect
from services.execution_service import ExecutionService
from services.validator_service import Validator
from services.dataset_service import identifier
class ForensicsService:
    def __init__(self,state,connection):
        self.state=state;self.engine=state.db_pools.get(connection)
        if self.engine is None:raise ValueError('Connection is unavailable')
        self.dialect='postgres' if self.engine.dialect.name=='postgresql' else self.engine.dialect.name
        self.validator=Validator(self.dialect)
        self.svc=ExecutionService(self.engine,timeout_seconds=min(20,state.settings.execution_timeout_seconds),row_limit=100,read_only=True)
    async def diagnose(self,payload):
        sql=payload.get('sql','');parameters=payload.get('parameters',{})
        if not self.validator.is_read_only_script(sql):raise ValueError('Diagnostics require read-only SQL')
        trees=sqlglot.parse(sql,read=self.dialect)
        if len(trees)!=1 or not isinstance(trees[0],exp.Select):return {'supported':False,'reason':'Only a single SELECT is supported in this slice'}
        q=trees[0]
        if q.args.get('with_') or list(q.find_all(exp.Subquery)) or q.args.get('qualify'):return {'supported':False,'reason':'CTEs, subqueries and QUALIFY are not supported yet'}
        base=q.args.get('from_')
        if not base or not isinstance(base.this,exp.Table):return {'supported':False,'reason':'A concrete base table is required'}
        table=base.this;alias=table.alias_or_name
        pk=inspect(self.engine).get_pk_constraint(table.name).get('constrained_columns',[])
        if len(pk)!=1:return {'supported':False,'reason':'A single-column primary key is required for row evidence'}
        key=pk[0];key_sql=exp.column(key,table=alias).sql(dialect=self.dialect)
        result={'supported':True,'originalSql':sql,'evidence':[],'limitations':[]}
        where=q.args.get('where')
        if 'entityKey' in payload:
            if q.args.get('joins'):result['limitations'].append('Entity predicate diagnostics currently support a single table. Join evidence is separate.')
            else:
                predicates=_predicates(where.this) if where else []
                expressions=[key_sql]+[f'CASE WHEN ({p.sql(dialect=self.dialect)}) THEN \'pass\' WHEN NOT ({p.sql(dialect=self.dialect)}) THEN \'fail\' ELSE \'unknown (NULL)\' END AS "predicate_{i+1}"' for i,p in enumerate(predicates)]
                diagnostic='SELECT '+','.join(expressions)+' FROM '+table.sql(dialect=self.dialect)+' WHERE '+key_sql+' = :verbis_entity'
                r=await self.svc.execute(diagnostic,{**parameters,'verbis_entity':payload['entityKey']})
                result['evidence'].append({'kind':'predicates','sql':diagnostic,'entityFound':bool(r['rows']),'predicates':[p.sql(dialect=self.dialect) for p in predicates],'statuses':r['rows'][0] if r['rows'] else {},'explanation':'A WHERE clause retains TRUE. FALSE is excluded; UNKNOWN from NULL is also excluded. Strict > excludes equality.'})
        if q.args.get('joins'):
            probe=q.copy()
            for name in ('group','having','order','limit','offset','distinct'):probe.set(name,None)
            probe.set('expressions',[sqlglot.parse_one(key_sql),sqlglot.parse_one('COUNT(*) AS joined_rows')]);probe.set('group',exp.Group(expressions=[sqlglot.parse_one(key_sql)]));probe.set('having',exp.Having(this=sqlglot.parse_one('COUNT(*) > 1')))
            r=await self.svc.execute(probe.sql(dialect=self.dialect),parameters)
            result['evidence'].append({'kind':'join-expansion','sql':probe.sql(dialect=self.dialect),'rows':r['rows'],'truncated':r['truncated'],'explanation':'These base keys produce multiple joined rows under the original filters. A total over the base value can multiply; DISTINCT is not applied automatically.'})
            if len(q.args['joins'])==1 and not where:
                j=q.args['joins'][0];target=j.this
                if isinstance(target,exp.Table):
                    partner_pk=inspect(self.engine).get_pk_constraint(target.name).get('constrained_columns',[])
                    if len(partner_pk)==1:
                        missing=q.copy();join=missing.args['joins'][0];join.set('side','LEFT');join.set('kind',None)
                        for name in ('group','having','order','limit','offset','distinct'):missing.set(name,None)
                        missing.set('expressions',[sqlglot.parse_one(key_sql)]);missing.set('where',exp.Where(this=exp.Is(this=exp.column(partner_pk[0],table=target.alias_or_name),expression=exp.Null())))
                        r=await self.svc.execute(missing.sql(dialect=self.dialect),parameters)
                        result['evidence'].append({'kind':'missing-join-partners','sql':missing.sql(dialect=self.dialect),'rows':r['rows'],'truncated':r['truncated']})
            else:result['limitations'].append('Missing-partner probes with joined WHERE filters or multiple joins require further review.')
        aggregates=list(q.find_all(exp.AggFunc))
        if aggregates:
            if q.args.get('group') or q.args.get('having'):result['limitations'].append('Contributions to a selected GROUP BY group are not supported yet; narrow the original query explicitly.')
            else:
                original=await self.svc.execute(sql,parameters)
                probe=q.copy()
                for name in ('group','having','order','limit','offset','distinct'):probe.set(name,None)
                cols=[key_sql]
                for i,a in enumerate(aggregates):
                    if isinstance(a.this,exp.Column):cols.append(a.this.sql(dialect=self.dialect)+f' AS "input_{i+1}"')
                probe.set('expressions',[sqlglot.parse_one(c) for c in cols]);r=await self.svc.execute(probe.sql(dialect=self.dialect),parameters)
                result['evidence'].append({'kind':'aggregate-contributions','sql':probe.sql(dialect=self.dialect),'aggregateRows':original['rows'],'rows':r['rows'],'truncated':r['truncated'],'explanation':'Measured aggregate result and bounded contributing rows. NULL inputs are ignored by SUM/AVG/COUNT(column); COUNT(*) counts rows. A limited contribution list is not the complete total.'})
        if not result['evidence']:result['limitations'].append('Specify an entity primary key, or use a supported join/aggregate query.')
        alternative=payload.get('comparisonSql','').strip()
        if alternative:
            if not self.validator.is_read_only_script(alternative) or len([t for t in sqlglot.parse(alternative,read=self.dialect) if t])!=1:raise ValueError('Interpretation preview requires one reviewed read-only query')
            original=await self.svc.execute(sql,parameters)
            compared=await self.svc.execute(alternative,parameters)
            for run in (original,compared):
                _,run['rows'],_=self.state.pii_masker.mask_results(run['columns'],run['rows'])
            result['interpretationPreview']={'alternativeSql':alternative,'original':original,'alternative':compared,'completeComparison':not(original['truncated'] or compared['truncated']),'explanation':'Both queries were executed read-only under the same bounds. The original query and saved analysis were unchanged. A difference does not decide which interpretation is correct.'}
        for evidence in result['evidence']:
            if evidence.get('statuses'):
                _, masked, _ = self.state.pii_masker.mask_results(list(evidence['statuses']), [evidence['statuses']])
                evidence['statuses'] = masked[0]
            for field in ('rows','aggregateRows'):
                if evidence.get(field):_,evidence[field],_=self.state.pii_masker.mask_results(list(evidence[field][0]),evidence[field])
        return result

def _predicates(e):
    if isinstance(e,exp.And):return _predicates(e.this)+_predicates(e.expression)
    return [e]
