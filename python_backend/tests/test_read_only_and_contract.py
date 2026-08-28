"""Regression tests for the /run read-only guard and execute request contract.

Covers two confirmed defects:
  1. sqlglot 30.x renamed dialect 'postgresql' → 'postgres', which made
     Validator.is_read_only() raise and return False for ALL SQL (including
     SELECT), so read-only SELECTs were blocked with 403.
  2. ExecuteRequest must carry optional read_only / timeout_seconds so the
     extension's VS Code settings reach the backend per request.

Run with the project venv:
    venv/bin/python -m pytest python_backend/tests/test_read_only_and_contract.py -q
or directly:
    venv/bin/python python_backend/tests/test_read_only_and_contract.py
"""

from __future__ import annotations

import os
import sys

# Make the backend importable when run directly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.validator_service import Validator  # noqa: E402
from models.requests import ExecuteRequest  # noqa: E402


# ─── Test D: validator classification ────────────────────────────────────────
def test_select_is_read_only():
    v = Validator()  # default dialect must be a valid sqlglot name
    for sql in ('SELECT 1', 'SELECT 1 AS x', 'WITH t AS (SELECT 1) SELECT * FROM t'):
        assert v.is_read_only(sql) is True, f'SELECT misclassified: {sql}'


def test_write_is_not_read_only():
    v = Validator()
    for sql in (
        "INSERT INTO t VALUES (1)",
        "UPDATE t SET a = 1",
        "DELETE FROM t",
        "DROP TABLE t",
        "CREATE TABLE t (id INT)",
    ):
        assert v.is_read_only(sql) is False, f'write misclassified as read-only: {sql}'


# ─── Test E: request contract / field mapping ────────────────────────────────
def test_execute_request_accepts_new_fields():
    req = ExecuteRequest(
        sql='SELECT 1',
        connection_id='c1',
        row_limit=500,
        read_only=True,
        timeout_seconds=60,
    )
    body = req.model_dump()
    # snake_case contract the backend expects — no camelCase regression.
    assert body['connection_id'] == 'c1'
    assert body['row_limit'] == 500
    assert body['read_only'] is True
    assert body['timeout_seconds'] == 60
    assert 'dbConfigId' not in body
    assert 'rowLimit' not in body
    assert 'readOnly' not in body
    assert 'timeoutSeconds' not in body


def test_execute_request_optional_fields_default_to_none():
    req = ExecuteRequest(sql='SELECT 1', connection_id='c1')
    assert req.read_only is None       # → backend Settings fallback
    assert req.timeout_seconds is None  # → backend Settings fallback
    assert req.row_limit == 500


def test_explicit_read_only_false_is_preserved():
    # False is a valid explicit value and must NOT be treated as "unset".
    req = ExecuteRequest(sql='INSERT INTO t VALUES (1)', connection_id='c1', read_only=False)
    assert req.read_only is False


if __name__ == '__main__':
    test_select_is_read_only()
    test_write_is_not_read_only()
    test_execute_request_accepts_new_fields()
    test_execute_request_optional_fields_default_to_none()
    test_explicit_read_only_false_is_preserved()
    print('ALL REGRESSION TESTS PASSED')
