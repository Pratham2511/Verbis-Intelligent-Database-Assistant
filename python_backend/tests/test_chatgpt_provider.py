"""Responses stream and no-retry contracts; no real OAuth credentials or calls."""
import sys
from pathlib import Path
from types import SimpleNamespace as N
sys.path.insert(0,str(Path(__file__).parents[1]))
import pytest
from services import llm_service as llm
from services import schema_creator_service as schema
from api.routes.generate import _friendly_generation_error

class Stream:
    def __init__(self,events):self.events=events;self.closed=False
    def __aiter__(self):return self.iterate()
    async def iterate(self):
        for event in self.events:yield event
    async def close(self):self.closed=True

class Client:
    def __init__(self,events):self.responses=self;self.stream=Stream(events);self.calls=[];self.closed=False
    async def create(self,**kwargs):self.calls.append(kwargs);return self.stream
    async def close(self):self.closed=True

def complete(text):return [N(type='response.output_text.delta',delta=text),N(type='response.completed',response=N(output_text=text))]

def test_requires_bearer_and_explicit_model_before_client_creation(monkeypatch):
    calls=[];monkeypatch.setattr(llm,'AsyncOpenAI',lambda **kw:calls.append(kw))
    for token,model in [('', 'fixture'),('fixture-token',None)]:
        with pytest.raises(llm.ProviderConfigurationError):llm._get_client('chatgpt',token,model)
    assert calls==[]
    llm._get_client('chatgpt','fixture-token','fixture-model')
    assert calls==[dict(api_key='fixture-token',timeout=60.0,max_retries=0,base_url='https://api.openai.com/v1')]

@pytest.mark.asyncio
async def test_sql_uses_one_completed_responses_stream_without_unsupported_parameters(monkeypatch):
    text='{"query":"SELECT id FROM employees WHERE salary>:threshold","parameters":{"threshold":8000}}'
    client=Client(complete(text));monkeypatch.setattr(llm,'_get_client',lambda *args:(client,'fixture-model'))
    assert await llm.generate_sql('employees above 8000','[]',provider='chatgpt',api_key='fixture-token',model='fixture-model')==text
    assert len(client.calls)==1 and client.closed and client.stream.closed
    request=client.calls[0]
    assert set(request)=={'model','instructions','input','store','stream'}
    assert request['store'] is False and request['stream'] is True
    assert all(m['role']!='system' for m in request['input'])

@pytest.mark.asyncio
@pytest.mark.parametrize('events',[
    [N(type='response.output_text.delta',delta='partial SQL')],
    [N(type='response.incomplete',response=N())],
    [N(type='response.completed',response=N(output_text=''))],
])
async def test_partial_incomplete_or_empty_output_is_never_success(events):
    client=Client(events)
    with pytest.raises(llm.ModelOutputError):await llm.generate_text(client,'chatgpt','fixture',[])
    assert len(client.calls)==1 and client.stream.closed

@pytest.mark.asyncio
async def test_late_usage_error_discards_partial_sql_without_retry():
    client=Client([N(type='response.output_text.delta',delta='SELECT id FROM employees'),
        N(type='response.failed',response=N(error=N(code='subscription_sharing_usage_limit_exceeded')))])
    with pytest.raises(llm.ChatGPTRequestError) as error:await llm.generate_text(client,'chatgpt','fixture',[])
    http=_friendly_generation_error(error.value,'chatgpt','fixture')
    assert http.status_code==429 and 'Manage usage' in http.detail and 'settings/usage' in http.detail
    assert len(client.calls)==1 and client.stream.closed

@pytest.mark.asyncio
async def test_schema_create_and_refine_use_responses_and_close_clients(monkeypatch):
    text='{"tables":[{"name":"staff","columns":[{"name":"id","type":"INT","primary_key":true}]}],"relationships":[]}'
    clients=[]
    def factory(*args):
        client=Client(complete(text));clients.append(client);return client,'fixture'
    monkeypatch.setattr(schema,'_get_client',factory)
    result=await schema.generate_schema_from_nl('staff',provider='chatgpt',api_key='fixture-token',model='fixture')
    await schema.refine_schema(result,'keep staff',provider='chatgpt',api_key='fixture-token',model='fixture')
    assert len(clients)==2 and all(c.closed and c.stream.closed and len(c.calls)==1 for c in clients)
