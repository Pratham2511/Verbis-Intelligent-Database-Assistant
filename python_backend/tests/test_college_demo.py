"""Submission fixture through real backend operations, without a model or user data."""
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest
from test_http_repairs import client
from core.db_pool import build_connection_url
from api.routes import workspace

DEMO = Path(__file__).resolve().parents[2] / 'examples' / 'college-demo'


def module(name):
    spec = importlib.util.spec_from_file_location('college_demo_' + name, DEMO / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def test_demo_is_independent_repeatable_and_never_overwrites(tmp_path):
    target = tmp_path / 'demo'
    module('prepare').prepare(target)
    result = module('verify').verify(target)
    assert len(result['passed']) == 7 and result['sourceUnchanged'] and result['realAIRequests'] == 0
    before = (target / 'employees.db').read_bytes()
    with pytest.raises(FileExistsError):
        module('prepare').prepare(target)
    assert (target / 'employees.db').read_bytes() == before
    # A >= regression is exposed by the equality row, not by comparing SQL text.
    queries = json.loads((target / 'queries.json').read_text())
    queries[0]['sql'] = queries[0]['sql'].replace(' > ', ' >= ')
    (target / 'queries.json').write_text(json.dumps(queries))
    with pytest.raises(AssertionError, match='above-8000'):
        module('verify').verify(target)


def test_demo_sql_save_chart_diagnostics_rehearsal_and_source_preservation(client, tmp_path):
    target = module('prepare').prepare(tmp_path / 'demo')
    database = target / 'employees.db'
    digest = hashlib.sha256(database.read_bytes()).hexdigest()
    client.app.state.qm.db_pools.register('college', build_connection_url('sqlite', '', 0, str(database), '', ''))
    client.app.include_router(workspace.router, prefix='/api')
    queries = json.loads((target / 'queries.json').read_text())
    expected = json.loads((target / 'expected-results.json').read_text())
    for query in queries:
        response = client.post('/api/execute', json={'sql': query['sql'], 'connection_id': 'college', 'parameters': query['parameters'], 'read_only': True})
        assert response.status_code == 200, response.text
        assert response.json()['rows'] == expected[query['id']]
        if query['id'] == 'payroll-chart':
            assert response.json()['chart']['kind'] == 'bar'
    query = queries[0]
    saved = client.post('/api/workspace/analysis_save', json={'payload': {**query, 'connectionId': 'college', 'id': 'college-threshold'}})
    assert saved.status_code == 200, saved.text
    assert saved.json()['schemaFingerprint'] and saved.json()['parameters'] == {'threshold': 8000}
    listed = client.post('/api/workspace/analysis_list', json={'payload': {}}).json()['analyses']
    assert listed[0]['sql'] == query['sql'] and listed[0]['connectionId'] == 'college'
    diagnostic = client.post('/api/workspace/forensics', json={'payload': {'connectionId': 'college', 'sql': query['sql'], 'parameters': query['parameters'], 'entityKey': 2}})
    assert diagnostic.status_code == 200, diagnostic.text
    assert diagnostic.json()['evidence'][0]['statuses']['predicate_1'] == 'fail'
    rehearsal = client.post('/api/workspace/rehearsal', json={'payload': {'connectionId': 'college', 'ddl': 'ALTER TABLE employees RENAME COLUMN salary TO base_salary'}})
    assert rehearsal.status_code == 200, rehearsal.text
    assert rehearsal.json()['isolated'] and rehearsal.json()['checks'][0]['afterError']
    rejected = client.post('/api/execute', json={'sql': 'DELETE FROM employees', 'connection_id': 'college', 'read_only': True})
    assert rejected.status_code == 403
    assert hashlib.sha256(database.read_bytes()).hexdigest() == digest
    assert len(module('verify').verify(target)['passed']) == 7
