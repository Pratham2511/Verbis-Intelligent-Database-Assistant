import sys,os
sys.path.insert(0,os.path.join(os.path.dirname(__file__),'..'))
from fastapi.testclient import TestClient
import main

def test_non_loopback_is_clean_403(monkeypatch):
    monkeypatch.delenv('QM_BACKEND_TOKEN',raising=False)
    c=TestClient(main.app,client=('203.0.113.1',1234))
    r=c.get('/api/health');assert r.status_code==403 and r.json()['detail'].startswith('Forbidden')
def test_extension_token_required_and_version_consistent(monkeypatch):
    monkeypatch.setenv('QM_BACKEND_TOKEN','test-loopback-token')
    c=TestClient(main.app,client=('127.0.0.1',1234))
    assert c.get('/api/health').status_code==401
    r=c.get('/api/health',headers={'Authorization':'Bearer test-loopback-token'})
    assert r.status_code==200 and r.json()['version']=='1.5.0'
