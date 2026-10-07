"""CSV profiling and transactional import into a workspace-owned SQLite database."""
import csv
import math
import hashlib
import io
import re
import sqlite3
from datetime import datetime
from decimal import Decimal,InvalidOperation
from pathlib import Path
from services.workspace_store import WorkspaceStore
from core.db_pool import build_connection_url
IDENT=re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,62}$')
MAX_BYTES=10*1024*1024
MAX_ROWS=100000

def identifier(name):
    if not IDENT.fullmatch(name or ''):raise ValueError('Use letters, digits and underscores; start with a letter or underscore (max 63).')
    return '"'+name+'"'

def convert(value,spec):
    if value.strip()=='':
        if not spec.get('nullable',True):raise ValueError('NULL is not permitted')
        return None
    kind=spec.get('type','TEXT')
    if kind=='TEXT':return value
    if kind=='DATE':
        fmt=spec.get('dateFormat')
        if not fmt:raise ValueError('Choose an explicit date format')
        return datetime.strptime(value.strip(),fmt).date().isoformat()
    clean=value.strip()
    if spec.get('currency'):
        symbol={'INR':'₹','USD':'$','EUR':'€','GBP':'£'}.get(spec['currency'])
        if symbol:clean=clean.removeprefix(symbol).strip()
        if any(c in clean for c in '₹$€£'):raise ValueError('Currency does not match the mapping')
    if spec.get('groupSeparator'):
        separator=spec['groupSeparator']
        # Explicit parsing rule; do not guess grouping or decimal conventions.
        clean=clean.replace(separator,'')
    if spec.get('decimalSeparator', '.')==',':clean=clean.replace(',','.')
    if not re.fullmatch(r'[+-]?\d+(?:\.\d+)?',clean):raise ValueError('Not a number under the selected mapping')
    number=Decimal(clean)
    if not number.is_finite():raise ValueError('Non-finite number')
    if kind=='INTEGER':
        if number!=number.to_integral_value() or not -(2**63)<=number<2**63:raise ValueError('Not a 64-bit integer')
        return int(number)
    if kind=='REAL':
        value=float(number)
        if not math.isfinite(value):raise ValueError('Amount exceeds numeric range')
        return value
    raise ValueError('Unsupported column type')

class DatasetService:
    def __init__(self,state):
        self.state=state
        self.store=WorkspaceStore(state.workspace_path/'datasets.json')
        self.database=state.workspace_path/'databases'/'datasets.db'
    def profile(self,payload):
        content=payload.get('content','')
        if not isinstance(content,str) or len(content.encode())>MAX_BYTES:raise ValueError('CSV limit is 10 MB')
        dialect=payload.get('delimiter')
        if dialect not in (None,'',',',';','\t','|'):raise ValueError('Unsupported delimiter')
        if not dialect:
            try:dialect=csv.Sniffer().sniff(content[:10000],delimiters=',;\t|').delimiter
            except csv.Error:dialect=','
        reader=csv.reader(io.StringIO(content.lstrip('\ufeff')),delimiter=dialect,strict=True)
        try:headers=next(reader)
        except StopIteration:raise ValueError('CSV is empty')
        if not headers or len(headers)!=len(set(headers)) or any(not h.strip() for h in headers):raise ValueError('Headers must be unique and non-empty')
        rows=[]
        for line,row in enumerate(reader,2):
            if not row:continue
            if len(row)!=len(headers):raise ValueError(f'CSV row {line} has {len(row)} fields; expected {len(headers)}')
            rows.append(row)
            if len(rows)>MAX_ROWS:raise ValueError('CSV limit is 100,000 rows')
        mapping=payload.get('mapping')
        if mapping is None:
            mapping=[]
            for i,header in enumerate(headers):
                values=[r[i] for r in rows if r[i].strip()]
                kind='INTEGER' if values and all(re.fullmatch(r'[+-]?\d+',v.strip()) for v in values) else 'REAL' if values and all(re.fullmatch(r'[+-]?\d+(?:\.\d+)?',v.strip()) for v in values) else 'TEXT'
                name=re.sub(r'\W','_',header.strip())[:63]
                if not name or not name[0].isalpha():name='column_'+name
                mapping.append({'source':header,'name':name,'type':kind,'nullable':True,'currency':'','period':'unknown','groupSeparator':'','decimalSeparator':'.','dateFormat':''})
        if len(mapping)!=len(headers) or {m['source'] for m in mapping}!=set(headers):raise ValueError('Map each CSV header exactly once')
        if len({m['name'] for m in mapping})!=len(mapping):raise ValueError('Destination column names must be unique')
        for m in mapping:
            identifier(m['name'])
            if m.get('type') not in ('TEXT','INTEGER','REAL','DATE'):raise ValueError('Unsupported type')
            if m.get('period') not in ('unknown','monthly','annual','none'):raise ValueError('Choose monthly, annual, none or unknown units')
            if m.get('currency','') not in ('','INR','USD','EUR','GBP'):raise ValueError('Unsupported currency')
            if m.get('groupSeparator','') not in ('',',',' ','.'):raise ValueError('Unsupported grouping separator')
            if m.get('decimalSeparator','.') not in ('.',','):raise ValueError('Unsupported decimal separator')
            if m.get('groupSeparator')==m.get('decimalSeparator','.'):raise ValueError('Group and decimal separators must differ')
        nulls={m['name']:0 for m in mapping};errors=[];converted=[]
        for line,row in enumerate(rows,2):
            values={}
            for m in mapping:
                try:v=convert(row[headers.index(m['source'])],m)
                except (ValueError,InvalidOperation) as exc:
                    errors.append({'row':line,'column':m['name'],'reason':str(exc)});v=None
                if v is None:nulls[m['name']]+=1
                values[m['name']]=v
            converted.append(values)
        key=payload.get('key','');duplicates=[];seen=set()
        if key:
            if key not in nulls:raise ValueError('Key must be a mapped column')
            for i,row in enumerate(converted,2):
                value=row[key]
                if value is None:errors.append({'row':i,'column':key,'reason':'Key cannot be NULL'})
                elif value in seen:duplicates.append(i)
                seen.add(value)
        relationships=payload.get('relationships',[])
        if not isinstance(relationships,list) or len(relationships)>len(mapping):raise ValueError('Confirm one relationship per mapped column at most')
        catalogue=self.store.read({'tables':[]})['tables'];sources=set()
        for rel in relationships:
            source=next((m for m in mapping if m['name']==rel.get('column')),None)
            target=next((t for t in catalogue if t['table']==rel.get('table')),None)
            if not source or source['name'] in sources or not target or not target.get('key') or rel.get('targetColumn')!=target['key']:raise ValueError('Choose a mapped source column and an imported table primary key')
            dest=next(m for m in target['mapping'] if m['name']==target['key'])
            if source['type']!=dest['type']:raise ValueError('Relationship column types must agree')
            sources.add(source['name'])
        report={'rowCount':len(rows),'nulls':nulls,'duplicateKeyRows':duplicates,'conversionErrors':errors[:100],'conversionErrorCount':len(errors),'delimiter':dialect,'mapping':mapping,'relationships':relationships,'sourceHash':hashlib.sha256(content.encode()).hexdigest(),'preview':converted[:30]}
        return report,converted
    def import_csv(self,payload):
        with self.store.lock:
            return self._import_csv(payload)
    def _import_csv(self,payload):
        report,rows=self.profile(payload)
        if payload.get('previewHash')!=hashlib.sha256(__import__('json').dumps(report,sort_keys=True).encode()).hexdigest():raise ValueError('Preview this mapping before importing')
        if report['conversionErrorCount'] or report['duplicateKeyRows']:raise ValueError('Resolve conversion errors and duplicate keys before importing')
        table=payload.get('table','');quoted=identifier(table)
        policy=payload.get('policy','create')
        if policy not in ('create','append','replace'):raise ValueError('Choose create, append or replace')
        mappings=report['mapping'];key=payload.get('key','')
        relationships=payload.get('relationships',[])
        catalogue=self.store.read({'tables':[]})
        old=next((t for t in catalogue['tables'] if t['table']==table),None)
        if policy in ('append','replace') and not old:raise ValueError('Append/replace is limited to previously imported tables')
        if policy=='append' and (old['mapping']!=mappings or old.get('key','')!=key or old.get('relationships',[])!=relationships):raise ValueError('Append mapping, key and relationships must match the saved import configuration')
        self.database.parent.mkdir(parents=True,exist_ok=True)
        with self.store.lock,sqlite3.connect(self.database) as conn:
            conn.execute('PRAGMA foreign_keys=ON');conn.execute('BEGIN IMMEDIATE')
            exists=conn.execute('SELECT 1 FROM sqlite_master WHERE type=? AND name=?',('table',table)).fetchone()
            if exists and policy=='create':raise ValueError('Table exists. Review append or replace explicitly')
            if policy=='replace' and exists:conn.execute(f'DROP TABLE {quoted}')
            definitions=[identifier(m['name'])+' '+('TEXT' if m['type']=='DATE' else m['type'])+(' NOT NULL' if not m.get('nullable',True) or m['name']==key else '') for m in mappings]
            if key:definitions.append('PRIMARY KEY ('+identifier(key)+')')
            for rel in relationships:
                if rel['column'] not in {m['name'] for m in mappings}:raise ValueError('Relationship source is not mapped')
                target=identifier(rel['table']);col=identifier(rel['targetColumn'])
                definitions.append(f'FOREIGN KEY ({identifier(rel["column"])}) REFERENCES {target} ({col})')
            if policy!='append':conn.execute(f'CREATE TABLE {quoted} ({",".join(definitions)})')
            cols=','.join(identifier(m['name']) for m in mappings)
            conn.executemany(f'INSERT INTO {quoted} ({cols}) VALUES ({",".join("?" for _ in mappings)})',[[row[m['name']] for m in mappings] for row in rows])
            total=conn.execute(f'SELECT count(*) FROM {quoted}').fetchone()[0]
        entry={k:v for k,v in report.items() if k!='preview'}
        entry.update({'table':table,'key':key,'relationships':relationships,'source':payload.get('source','pasted CSV'),'encoding':payload.get('encoding','utf-8'),'policy':policy,'totalRows':total})
        # Database transaction is committed before provenance. Preserve visible recovery evidence on file-write failure.
        def save(cat):cat['tables'][:]=[t for t in cat['tables'] if t['table']!=table]+[entry]
        self.store.update({'tables':[]},save)
        self.state.db_pools.register('datasets',build_connection_url('sqlite','',0,str(self.database),'',''),validate=True)
        self.state.extra.setdefault('schemas',{}).pop('datasets',None)
        return {'report':entry,'connection':{'id':'datasets','name':'Workspace datasets','dialect':'sqlite','database':str(self.database),'host':'','port':0,'user':'','ssl':False}}
    def preview(self,payload):
        report,_=self.profile(payload)
        # PII masking applies to file previews as well as query results.
        columns=[m['name'] for m in report['mapping']]
        _,report['preview'],_=self.state.pii_masker.mask_results(columns,report['preview'])
        # Hash the unmasked report so masking cannot change import semantics.
        unmasked,_=self.profile(payload)
        report['previewHash']=hashlib.sha256(__import__('json').dumps(unmasked,sort_keys=True).encode()).hexdigest()
        return report
