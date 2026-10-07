"""OpenRouter compatibility and free-only cost boundary; no live key or calls."""
import sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).parents[1]))
import pytest
from services import llm_service
from api.routes.generate import _friendly_generation_error
from api.routes.schema_create import SchemaCreateRequest, SchemaRefineRequest
from models.requests import GenerateRequest


def test_free_openrouter_default_uses_only_its_endpoint_and_disables_retries(monkeypatch):
    calls=[]
    monkeypatch.setattr(llm_service,'AsyncOpenAI',lambda **kwargs:calls.append(kwargs) or SimpleNamespace())
    _,model=llm_service._get_client('openrouter','not-a-real-key')
    assert model=='thinkingmachines/inkling:free'
    assert calls==[{'api_key':'not-a-real-key','timeout':60.0,'max_retries':0,'base_url':'https://openrouter.ai/api/v1'}]
    assert llm_service.generation_options('openrouter',model)=={'reasoning_effort':'low'}
    assert llm_service.generation_options('openrouter','openrouter/free')=={}


@pytest.mark.parametrize('model',['thinkingmachines/inkling','thinkingmachines/inkling-small','openai/paid-model','thinkingmachines/inkling:free:online'])
def test_paid_or_modified_model_is_rejected_before_any_client_creation(monkeypatch,model):
    calls=[]
    monkeypatch.setattr(llm_service,'AsyncOpenAI',lambda **kwargs:calls.append(kwargs))
    with pytest.raises(llm_service.ProviderConfigurationError,match='free models') as error:
        llm_service._get_client('openrouter','not-a-real-key',model)
    assert calls==[]
    http=_friendly_generation_error(error.value,'openrouter',model)
    assert http.status_code==422 and 'free models' in http.detail


def test_sql_create_and_refine_request_contracts_accept_openrouter():
    assert GenerateRequest(nl_query='employee salaries',provider='openrouter').provider=='openrouter'
    assert SchemaCreateRequest(description='departments',provider='openrouter').provider=='openrouter'
    assert SchemaRefineRequest(existing_schema={},refinement='departments',provider='openrouter').provider=='openrouter'


@pytest.mark.asyncio
async def test_openrouter_sql_json_uses_one_bounded_call_and_closes_client(monkeypatch):
    calls=[]
    class Client:
        def __init__(self):self.chat=SimpleNamespace(completions=self);self.closed=False
        async def create(self,**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content='{"query":"SELECT id FROM employees WHERE salary>:threshold","parameters":{"threshold":8000}}'))])
        async def close(self):self.closed=True
    client=Client()
    monkeypatch.setattr(llm_service,'_get_client',lambda *args:(client,'thinkingmachines/inkling:free'))
    result=await llm_service.generate_sql('employees above 8000','[]',provider='openrouter',api_key='not-a-real-key')
    assert 'threshold' in result and client.closed and len(calls)==1
    assert calls[0]['model']=='thinkingmachines/inkling:free' and calls[0]['max_tokens']==2048
    assert calls[0]['reasoning_effort']=='low' and 'response_format' not in calls[0]
