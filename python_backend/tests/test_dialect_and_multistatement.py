"""Regression tests for the two end-to-end SQLite defects.

Defect 1 — dialect-aware generation:
    The extension hard-coded ``dialect: 'postgresql'`` in the generate payload,
    so the LLM produced PostgreSQL-specific SQL (``information_schema.tables``)
    even for SQLite connections. The backend must derive the dialect from the
    registered connection's engine (via ``db_config_id``), not trust the
    request's dialect blindly.

Defect 2 — multi-statement execution:
    ``CREATE TABLE school (...); INSERT INTO school (...);`` failed with
    ``sqlite3.ProgrammingError: You can only execute one statement at a time.``
    because the whole script was sent in a single ``conn.execute(text(sql))``.
    The execution service must split the script safely (sqlglot — respecting
    string literals / quoted identifiers / comments) and run statements
    sequentially in one transaction.

Run with the project venv:
    venv/bin/python -m pytest python_backend/tests/test_dialect_and_multistatement.py -q
"""

from __future__ import annotations

import asyncio
import os
import sys

import pytest
from sqlalchemy import create_engine

# Make the backend importable when run directly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.execution_service import ExecutionService, _split_statements  # noqa: E402
from services.validator_service import Validator  # noqa: E402
from services.dialect_service import resolve_dialect  # noqa: E402


# ─── Defect 1: dialect resolution ────────────────────────────────────────────
class _FakePool:
    def __init__(self, dialect_name: str) -> None:
        self.dialect = type('D', (), {'name': dialect_name})()


class _FakePools:
    def __init__(self, pool) -> None:
        self._pool = pool

    def get(self, _id):
        return self._pool


def test_resolve_dialect_uses_engine_for_sqlite():
    # Extension sent the hard-coded 'postgresql', but the registered connection
    # is SQLite — the engine must win.
    pools = _FakePools(_FakePool('sqlite'))
    assert resolve_dialect(pools, 'c1', 'postgresql') == 'sqlite'


def test_resolve_dialect_uses_engine_for_mysql():
    pools = _FakePools(_FakePool('mysql'))
    assert resolve_dialect(pools, 'c1', 'postgresql') == 'mysql'


def test_resolve_dialect_falls_back_when_no_connection():
    # No registered connection (db_config_id None or pool missing) → fallback.
    assert resolve_dialect(_FakePools(None), None, 'postgresql') == 'postgresql'
    assert resolve_dialect(_FakePools(None), 'missing', 'sqlite') == 'sqlite'


# ─── Defect 2: safe statement splitting ──────────────────────────────────────
def test_split_respects_string_literals_and_comments():
    sql = (
        "CREATE TABLE school (id INT PRIMARY KEY, name VARCHAR(100));\n"
        "INSERT INTO school VALUES (1, 'Lu;ca', 'IT');\n"
        "-- a comment ; with semicolon\n"
        "SELECT * FROM school WHERE name = 'a;b';"
    )
    stmts = _split_statements(sql, dialect='sqlite')
    assert len(stmts) == 3
    # Semicolons inside string literals must NOT split statements.
    assert any("'Lu;ca'" in s for s in stmts)
    assert any("'a;b'" in s for s in stmts)


def test_split_single_statement_unchanged():
    stmts = _split_statements('SELECT 1', dialect='sqlite')
    assert len(stmts) == 1


# ─── Defect 2: multi-statement execution against real SQLite ─────────────────
def _run(coro):
    return asyncio.run(coro)


def test_multistatement_create_insert_select(tmp_path):
    db = tmp_path / 't.db'
    engine = create_engine(f'sqlite:///{db}')
    svc = ExecutionService(engine)
    sql = (
        "CREATE TABLE school (id INTEGER PRIMARY KEY, name TEXT, city TEXT);\n"
        "INSERT INTO school VALUES (1, 'Lu;ca', 'IT');\n"
        "SELECT * FROM school;"
    )
    result = _run(svc.execute(sql))
    assert result['rowCount'] == 1
    assert result['rows'][0]['name'] == 'Lu;ca'
    assert result['columns'] == ['id', 'name', 'city']
    assert result.get('statementsExecuted') == 3


def test_multistatement_stops_on_first_failure(tmp_path):
    db = tmp_path / 't.db'
    engine = create_engine(f'sqlite:///{db}')
    svc = ExecutionService(engine)
    # Second statement references a missing table → must fail and report index.
    sql = "CREATE TABLE a (id INTEGER); SELECT * FROM missing_table; SELECT 1;"
    with pytest.raises(RuntimeError) as excinfo:
        _run(svc.execute(sql))
    assert 'Statement 2 of 3 failed' in str(excinfo.value)


def test_single_statement_regression(tmp_path):
    db = tmp_path / 't.db'
    engine = create_engine(f'sqlite:///{db}')
    svc = ExecutionService(engine)
    _run(svc.execute("CREATE TABLE x (id INTEGER);"))
    result = _run(svc.execute("INSERT INTO x VALUES (1);"))
    assert result['rowCount'] == 0
    result = _run(svc.execute("SELECT * FROM x;"))
    assert result['rowCount'] == 1


# ─── Defect 2: read-only guard is script-aware ───────────────────────────────
def test_read_only_script_blocks_mixed_write():
    v = Validator(dialect='postgres')
    # First statement is CREATE (write) — must be blocked even though a SELECT follows.
    assert v.is_read_only_script("CREATE TABLE a (id INT); SELECT 1;") is False
    assert v.is_read_only_script("SELECT 1; INSERT INTO a VALUES (1);") is False


def test_read_only_script_allows_all_selects():
    v = Validator(dialect='postgres')
    assert v.is_read_only_script("SELECT 1; SELECT 2;") is True
    assert v.is_read_only_script("WITH x AS (SELECT 1) SELECT * FROM x;") is True
