"""Evidence-only Python/SQLAlchemy adapter. Never imports or executes project code."""
import ast
import os
import hashlib
import json
import re
from pathlib import Path
import sqlglot
from sqlglot import exp
from services.workspace_store import WorkspaceStore
SKIP={'.git','.qmind','.local-test','.venv','venv','node_modules','dist','out','__pycache__','.aws','.codex','.agents'}
class NavigatorService:
    def __init__(self,state):
        self.root=state.workspace_path.parent.resolve();self.store=WorkspaceStore(state.workspace_path/'project-index.json')
    def scan(self):
        old=self.store.read({'files':{}})['files'];files={};unsupported=[]
        paths=[]
        # Bound both model discovery and usage indexing to the same file set.
        capped=False
        for base,dirs,names in os.walk(self.root):
            dirs[:]=sorted(d for d in dirs if d not in SKIP and not d.startswith('.') and not (Path(base)/d).is_symlink())
            for name in sorted(names):
                path=Path(base)/name
                if name.startswith('.') or path.suffix not in ('.py','.sql','.md') or path.is_symlink():continue
                if len(paths)>=2000:capped=True;break
                paths.append(path)
            if capped:break
        if capped:unsupported.append({'path':'','reason':'Index limited to 2,000 supported files, including model discovery'})
        # Resolve unambiguous SQLAlchemy model symbols across source files.
        model_tables={}
        for model_path in paths:
            if model_path.suffix!='.py' or model_path.is_symlink() or model_path.stat().st_size>512000:continue
            try:tree=ast.parse(model_path.read_text(errors='replace'))
            except (SyntaxError,OSError):continue
            for cls in (n for n in ast.walk(tree) if isinstance(n,ast.ClassDef)):
                for node in cls.body:
                    if isinstance(node,ast.Assign) and isinstance(node.value,ast.Constant) and isinstance(node.value.value,str) and any(isinstance(t,ast.Name) and t.id=='__tablename__' for t in node.targets):model_tables.setdefault(cls.name,set()).add(node.value.value)
        shared_models={name:next(iter(tables)) for name,tables in model_tables.items() if len(tables)==1}
        model_hash=hashlib.sha256(json.dumps(shared_models,sort_keys=True).encode()).hexdigest()
        for path in paths:
            if any(part in SKIP or part.startswith('.') for part in path.relative_to(self.root).parts) or path.is_symlink():continue
            if not path.is_file() or path.suffix not in ('.py','.sql','.md'):continue
            if path.stat().st_size>512000:unsupported.append({'path':str(path.relative_to(self.root)),'reason':'File exceeds 500 KB'});continue
            rel=str(path.relative_to(self.root));source=path.read_text(errors='replace');digest=hashlib.sha256(source.encode()).hexdigest()
            if old.get(rel,{}).get('hash')==digest and old.get(rel,{}).get('modelHash')==model_hash:files[rel]=old[rel];continue
            entries=[];unresolved=[]
            if path.suffix=='.py':
                try:tree=ast.parse(source)
                except SyntaxError as e:unresolved.append({'line':e.lineno,'reason':'Python syntax unsupported'})
                else:
                    models=dict(shared_models)
                    for cls in (n for n in ast.walk(tree) if isinstance(n,ast.ClassDef)):
                        table=None;columns=[]
                        for node in cls.body:
                            if isinstance(node,ast.Assign):
                                if any(isinstance(t,ast.Name) and t.id=='__tablename__' for t in node.targets) and isinstance(node.value,ast.Constant) and isinstance(node.value.value,str):table=node.value.value
                                if isinstance(node.value,ast.Call) and _call_name(node.value.func).endswith(('Column','mapped_column')):columns.extend(t.id for t in node.targets if isinstance(t,ast.Name))
                            if isinstance(node,ast.AnnAssign) and isinstance(node.target,ast.Name) and isinstance(node.value,ast.Call) and _call_name(node.value.func).endswith(('Column','mapped_column')):columns.append(node.target.id)
                        if table:models[cls.name]=table;entries.append({'table':table,'columns':columns,'kind':'model','symbol':cls.name,'line':cls.lineno,'evidence':'SQLAlchemy __tablename__ and mapped fields'})
                    parents={child:node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
                    def location(node):
                        p=node
                        while p in parents:
                            p=parents[p]
                            if isinstance(p,(ast.FunctionDef,ast.AsyncFunctionDef)):return p.name
                        return '<module>'
                    for node in ast.walk(tree):
                        if isinstance(node,ast.Call):
                            name=_call_name(node.func)
                            operation=name.rsplit('.',1)[-1]
                            if operation=='create_engine':entries.append({'table':None,'columns':[],'kind':'configuration','symbol':location(node),'line':node.lineno,'evidence':'SQLAlchemy engine configuration. URL and credentials are kept private.'})
                            if name.endswith(('execute','text')) and node.args:
                                arg=node.args[0]
                                if isinstance(arg,ast.Constant) and isinstance(arg.value,str):
                                    entries.extend(self.sql_entries(arg.value,node.lineno,location(node)))
                                elif name.endswith('execute') and not (isinstance(arg,ast.Call) and _call_name(arg.func).endswith(('text','select','update','insert','delete'))):unresolved.append({'line':node.lineno,'reason':'Dynamic SQL cannot be resolved statically','symbol':location(node)})
                            if operation in ('select','update','insert','delete','query'):
                                for arg in node.args:
                                    model=_call_name(arg).split('.')[0]
                                    if model in models:entries.append({'table':models[model],'columns':[],'kind':'read' if operation in ('select','query') else 'write','symbol':location(node),'line':node.lineno,'evidence':'Static ORM operation '+name})
                                    elif model:unresolved.append({'line':node.lineno,'symbol':location(node),'reason':'ORM model symbol is unresolved or ambiguous: '+model})
                        if isinstance(node,ast.BinOp) and isinstance(node.op,ast.Div) and isinstance(node.right,ast.Constant) and node.right.value==12 and 'salary' in ast.unparse(node.left).lower():
                            entries.append({'table':None,'columns':[],'kind':'definition','symbol':location(node),'line':node.lineno,'evidence':'Salary expression divides by 12. Period conversion requires confirming input units.'})
            elif path.suffix=='.sql':entries=self.sql_entries(source,1,path.stem)
            elif path.suffix=='.md':
                for line,text in enumerate(source.splitlines(),1):
                    if re.search(r'salary|payroll|monthly|annual',text,re.I):entries.append({'table':None,'columns':[],'kind':'documentation','symbol':path.name,'line':line,'evidence':'Documentation mentions salary/payroll units; open source to review.'})
            files[rel]={'hash':digest,'modelHash':model_hash,'entries':entries,'unresolved':unresolved}
        result={'adapter':'Python / SQLAlchemy + static SQL','files':files,'unsupported':unsupported,'coverage':'Static references only; dynamic queries and external models may be unresolved.'}
        self.store.write(result)
        return self.flatten(result)
    def sql_entries(self,sql,line,symbol):
        try:trees=sqlglot.parse(sql)
        except Exception:return []
        entries=[]
        for tree in trees:
            if tree is None:continue
            kind='read' if isinstance(tree,exp.Query) else 'migration' if isinstance(tree,(exp.Create,exp.Alter,exp.Drop)) else 'write'
            columns=sorted({c.name for c in tree.find_all(exp.Column)})
            for table in tree.find_all(exp.Table):entries.append({'table':table.name,'columns':columns,'kind':kind,'symbol':symbol,'line':line,'evidence':'Parsed SQL AST'})
        return entries
    def flatten(self,index):
        return {'adapter':index['adapter'],'coverage':index['coverage'],'entries':[{**e,'path':path} for path,f in index['files'].items() for e in f['entries']], 'unresolved':[{**u,'path':path} for path,f in index['files'].items() for u in f['unresolved']]+index.get('unsupported',[])}
def _call_name(node):
    if isinstance(node,ast.Name):return node.id
    if isinstance(node,ast.Attribute):return _call_name(node.value)+'.'+node.attr
    return ''
