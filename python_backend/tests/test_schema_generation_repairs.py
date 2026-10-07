"""Executable schema and completed-provider regressions; no cloud credentials."""
import sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).parents[1]))
import pytest
from sqlalchemy import create_engine,text
from services.schema_creator_service import schema_to_ddl,schema_to_mermaid
from services import llm_service
from services.execution_service import ExecutionService


def relationship_schema():
    # A child deliberately precedes its parent; SQL keywords need quoting.
    return {'tables':[
        {'name':'order','columns':[{'name':'id','type':'INT','constraints':['PRIMARY KEY','AUTO_INCREMENT']},{'name':'select','type':'INT','constraints':[],'foreign_key':{'references_table':'group','references_column':'id'}},{'name':'amount','type':'DECIMAL(12, 2)','constraints':[]}]},
        {'name':'group','columns':[{'name':'id','type':'INT','constraints':['PRIMARY KEY','AUTO_INCREMENT']},{'name':'created_at','type':'TIMESTAMP','constraints':['DEFAULT CURRENT_TIMESTAMP']}]}],
        'relationships':[{'from_table':'order','to_table':'group','type':'many_to_one'}]}


@pytest.mark.asyncio
async def test_sqlite_keyword_names_and_safe_timestamp_default(tmp_path):
    engine=create_engine(f'sqlite:///{tmp_path}/schema.db')
    await ExecutionService(engine).execute(schema_to_ddl(relationship_schema(),'sqlite'))
    with engine.begin() as c:
        c.execute(text('INSERT INTO "group" (id) VALUES (1)'))
        c.execute(text('INSERT INTO "order" ("select",amount) VALUES (1,42.25)'))
        assert c.execute(text('SELECT amount,created_at FROM "order" JOIN "group" ON "order"."select"="group".id')).one()[0]==42.25
    engine.dispose()


@pytest.mark.parametrize('dialect',['postgresql','mysql'])
def test_parent_tables_are_created_before_children(dialect):
    ddl=schema_to_ddl(relationship_schema(),dialect)
    quote='`' if dialect=='mysql' else '"'
    assert ddl.index(f'CREATE TABLE IF NOT EXISTS {quote}group{quote}')<ddl.index(f'CREATE TABLE IF NOT EXISTS {quote}order{quote}')
    schema=relationship_schema()
    schema['tables'][1]['columns'].append({'name':'child_id','type':'INT','constraints':[],'foreign_key':{'references_table':'order','references_column':'id'}})
    with pytest.raises(ValueError,match='Cyclic foreign keys'):schema_to_ddl(schema,dialect)


def test_schema_rejects_unsafe_defaults_and_nonunique_foreign_key_targets():
    schema=relationship_schema();schema['tables'][1]['columns'][1]['constraints']=['DEFAULT CURRENT_TIMESTAMP; DROP TABLE employees']
    with pytest.raises(ValueError,match='Unsupported constraint'):schema_to_ddl(schema)
    schema=relationship_schema();schema['tables'][1]['columns'][0]['constraints']=[]
    with pytest.raises(ValueError,match='primary or unique'):schema_to_ddl(schema)
    diagram=schema_to_mermaid(relationship_schema());assert 'DECIMAL amount' in diagram and 'DECIMAL(12, 2)' not in diagram


@pytest.mark.parametrize('finish,content,reason',[('length','{"query":','truncated'),('stop',None,'empty'),('stop','  ','empty')])
@pytest.mark.asyncio
async def test_incomplete_provider_output_is_not_used_and_client_closes(monkeypatch,finish,content,reason):
    calls=[]
    class FakeClient:
        def __init__(self):self.chat=SimpleNamespace(completions=self);self.closed=False
        async def create(self,**kwargs):calls.append(kwargs);return SimpleNamespace(choices=[SimpleNamespace(finish_reason=finish,message=SimpleNamespace(content=content))])
        async def close(self):self.closed=True
    client=FakeClient();monkeypatch.setattr(llm_service,'_get_client',lambda *args:(client,'gemini-3.6-flash'))
    with pytest.raises(llm_service.ModelOutputError,match=reason):await llm_service.generate_sql('employees','[]',provider='gemini',api_key='not-real')
    assert client.closed and calls[0]['reasoning_effort']=='low'
    assert llm_service.generation_options('groq','llama-3.3')=={}


@pytest.mark.asyncio
async def test_schema_disconnect_cancels_provider_operation():
    import asyncio
    from api.routes.schema_create import while_connected
    closed=asyncio.Event()
    async def disconnected():return True
    async def provider():
        try:await asyncio.sleep(10)
        finally:closed.set()
    with pytest.raises(asyncio.CancelledError):await while_connected(SimpleNamespace(is_disconnected=disconnected),provider())
    assert closed.is_set()
