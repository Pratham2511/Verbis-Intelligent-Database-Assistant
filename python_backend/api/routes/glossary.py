"""Validated, versioned business definitions. Expressions are reviewed, never executed on save."""
import hashlib
import json
import time
import sqlglot
from sqlglot import exp
from fastapi import APIRouter, Request, HTTPException
from models.requests import GlossaryTerm
from services.glossary_service import GlossaryService
from services.validator_service import Validator
from api.routes.schema import schema_result
router=APIRouter()

def revision(store):
    return hashlib.sha256(json.dumps(store.model_dump(),sort_keys=True).encode()).hexdigest()[:16]

@router.get('/glossary')
async def get_glossary(request:Request):
    store=GlossaryService(request.app.state.qm.workspace_path/'glossary.json').read()
    return {**store.model_dump(),'revision':revision(store)}

@router.post('/glossary')
async def save_glossary_term(term:GlossaryTerm,request:Request):
    if not term.term.strip() or not term.sqlTemplate.strip():raise HTTPException(422,detail='A term and read-only SQL definition are required.')
    validator=Validator(term.dialect)
    sql=term.sqlTemplate.strip()
    if not sql.lower().startswith(('select','with')):sql='SELECT '+sql
    if not validator.is_read_only_script(sql):raise HTTPException(422,detail='Definitions must be read-only SQL queries or expressions.')
    if term.connectionId:
        info=await schema_result(request.app.state.qm,term.connectionId)
        parsed=sqlglot.parse_one(sql,read=validator.dialect)
        if list(parsed.find_all(exp.Table)):
            if not validator.validate_semantic(sql,info['tables']):raise HTTPException(422,detail='Definition uses unknown or ambiguous columns/tables.')
        else:
            known={c['name'] for t in info['tables'] for c in t['columns']}
            if any(c.name not in known for c in parsed.find_all(exp.Column)):raise HTTPException(422,detail='Definition uses an unknown column.')
    svc=GlossaryService(request.app.state.qm.workspace_path/'glossary.json')
    old=next((t for t in svc.read().terms if (t.term,t.connectionId)==(term.term,term.connectionId)),None)
    term.revision=(old.revision+1) if old else 1
    svc.upsert(term)
    return {'success':True,'revision':revision(svc.read())}
