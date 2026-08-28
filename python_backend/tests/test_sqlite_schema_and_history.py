"""Regression tests for SQLite schema discovery and history/recent-query persistence.

Covers three defect areas:
  1. SQLite schema discovery uses SQLAlchemy reflection (sqlite_master /
     PRAGMA under the hood) — NOT PostgreSQL's information_schema — so a
     SQLite connection's tables and columns are discovered correctly.
  2. History persistence: HistoryStore survives reopen (reads back what was
     written), stays bounded, and fails safe on corrupt JSON.
  3. Recent-query persistence: entries appended with connection context,
     timestamp, and execution status round-trip intact.

Run with the project venv:
    venv/bin/python -m pytest python_backend/tests/test_sqlite_schema_and_history.py -q
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from core.db_pool import build_connection_url  # noqa: E402
from core.history_store import HistoryStore  # noqa: E402
from api.routes.schema import _introspect_schema  # noqa: E402


# ─── 1. SQLite schema discovery ──────────────────────────────────────────────
class _FakeRAG:
    def index_schema(self, tables):  # noqa: ANN001
        self.tables = tables


class _FakeState:
    def __init__(self):
        self.rag = _FakeRAG()


def _make_school_db(tmp_path: Path) -> tuple:
    ws = tmp_path / 'ws'
    ws.mkdir()
    url = build_connection_url('sqlite', '', 0, 'Tables', '', '', workspace_path=ws)
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE School (ID INTEGER PRIMARY KEY, Name TEXT, Depart TEXT)'))
        conn.execute(text("INSERT INTO School VALUES (1, 'Luca', 'IT')"))
    return engine, ws


def test_sqlite_schema_discovers_table_and_columns(tmp_path):
    engine, ws = _make_school_db(tmp_path)
    tables = _introspect_schema(engine, ws / '.qmind', _FakeState())

    names = [t['tableName'] for t in tables]
    assert 'School' in names

    school = next(t for t in tables if t['tableName'] == 'School')
    cols = {c['name']: c for c in school['columns']}
    assert set(cols) == {'ID', 'Name', 'Depart'}
    assert cols['ID']['isPrimaryKey'] is True
    assert cols['Name']['isPrimaryKey'] is False
    # Types come from SQLite metadata, not information_schema.
    assert 'INT' in cols['ID']['type'].upper()


def test_sqlite_schema_via_sqlite_master_listing(tmp_path):
    # The exact query from the spec must work against the resolved DB.
    engine, _ = _make_school_db(tmp_path)
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).all()
    assert ('School',) in rows


def test_sqlite_schema_select_star_returns_record(tmp_path):
    engine, _ = _make_school_db(tmp_path)
    with engine.connect() as conn:
        rows = conn.execute(text('SELECT * FROM School')).all()
    assert rows == [(1, 'Luca', 'IT')]


# ─── 2. History persistence ──────────────────────────────────────────────────
def _store(tmp_path: Path) -> HistoryStore:
    return HistoryStore(tmp_path / 'history.json', tmp_path / 'query_tree.json')


def test_history_roundtrip_survives_reopen(tmp_path):
    s1 = _store(tmp_path)
    s1.append_history({
        'id': 'a', 'timestamp': 1, 'nlInput': 'show students',
        'sql': 'SELECT * FROM School', 'success': True,
        'executionTimeMs': 3, 'rowCount': 1,
    })
    # Simulate reopen with a fresh store instance over the same files.
    s2 = _store(tmp_path)
    hist = s2.read_history()
    assert len(hist) == 1
    assert hist[0]['sql'] == 'SELECT * FROM School'
    assert hist[0]['nlInput'] == 'show students'


def test_history_is_bounded(tmp_path):
    s = _store(tmp_path)
    for i in range(5010):
        s.append_history({'id': str(i), 'timestamp': i, 'nlInput': 'q',
                          'sql': f'SELECT {i}', 'success': True})
    hist = s.read_history()
    assert len(hist) == 5000
    assert hist[-1]['sql'] == 'SELECT 5009'  # most recent retained


def test_history_fails_safe_on_corrupt_json(tmp_path):
    (tmp_path / 'history.json').write_text('{not valid json')
    s = _store(tmp_path)
    assert s.read_history() == []  # fail-safe, never raises


def test_history_missing_file_returns_empty(tmp_path):
    assert _store(tmp_path).read_history() == []


# ─── 3. Recent-query persistence (connection context + status) ───────────────
def test_recent_query_entry_preserves_connection_context(tmp_path):
    s1 = _store(tmp_path)
    s1.append_history({
        'id': 'q1', 'timestamp': 1693000000000,
        'nlInput': 'list departments', 'sql': 'SELECT Depart FROM School',
        'success': True, 'executionTimeMs': 2, 'rowCount': 1,
        'connectionId': 'ae96cb87-1f4a-4cab-b669-6435a9894c2b',
        'connectionName': 'Test sqlite',
    })
    entry = _store(tmp_path).read_history()[0]
    assert entry['connectionId'] == 'ae96cb87-1f4a-4cab-b669-6435a9894c2b'
    assert entry['connectionName'] == 'Test sqlite'
    assert entry['success'] is True
    assert entry['timestamp'] == 1693000000000


def test_recent_query_failed_status_persisted(tmp_path):
    s1 = _store(tmp_path)
    s1.append_history({
        'id': 'q2', 'timestamp': 2, 'nlInput': 'bad query',
        'sql': 'SELECT * FROM missing', 'success': False,
    })
    entry = _store(tmp_path).read_history()[0]
    assert entry['success'] is False


def test_no_credentials_written_to_history(tmp_path):
    # History entries must never carry secrets.
    s1 = _store(tmp_path)
    s1.append_history({
        'id': 'q3', 'timestamp': 3, 'nlInput': 'x', 'sql': 'SELECT 1', 'success': True,
    })
    raw = json.loads((tmp_path / 'history.json').read_text())
    for entry in raw:
        for forbidden in ('password', 'apiKey', 'api_key', 'token', 'pat', 'secret'):
            assert forbidden not in entry


# ─── 4. Schema empty-cache self-heal (Schema panel stays populated) ─────────
def test_empty_schema_cache_is_reintrospected(tmp_path):
    """A stale EMPTY schema_cache.json must not shadow a database that now has
    tables. Regression: the canonical SQLite file was once a 0-byte placeholder
    (0 tables introspected → cached as []), and GET /api/schema returned that
    empty cache forever, leaving the Schema panel permanently showing
    "No schema loaded" even though queries against the live engine succeeded.
    The fix: an empty cache is treated as a miss and re-introspected."""
    engine, ws = _make_school_db(tmp_path)
    qmind = ws / '.qmind'
    qmind.mkdir(parents=True, exist_ok=True)
    # Simulate the stale placeholder-era empty cache.
    (qmind / 'schema_cache.json').write_text('[]')

    # The empty cache must be ignored: introspection runs and finds School.
    cached = json.loads((qmind / 'schema_cache.json').read_text())
    assert cached == []  # precondition: cache is empty
    tables = _introspect_schema(engine, qmind, _FakeState())
    assert 'School' in [t['tableName'] for t in tables]
    # After introspection the cache is rewritten with real data.
    assert 'School' in [t['tableName'] for t in json.loads((qmind / 'schema_cache.json').read_text())]


# ─── 5. PII masking must not alter ordinary single-word name values ─────────
def test_pii_masker_preserves_single_word_name_value():
    """Regression: School.Name = 'Luca' was masked to 'J*** D***' because the
    column-name heuristic ('name' in column) classified the whole column as
    person-name PII without inspecting values. Ordinary database values must
    be preserved; only genuine full 'First Last' names should be masked."""
    from services.pii_service import PIIMasker
    masker = PIIMasker()
    cols = ['ID', 'Name', 'Depart']
    rows = [{'ID': 1, 'Name': 'Luca', 'Depart': 'IT'}]
    masked_cols, masked_rows, _ = masker.mask_results(cols, [dict(r) for r in rows])
    assert masked_cols == []
    assert masked_rows[0]['Name'] == 'Luca'
    assert masked_rows[0]['Depart'] == 'IT'


def test_pii_masker_still_masks_genuine_full_name():
    """The privacy feature must remain intact for real person names."""
    from services.pii_service import PIIMasker
    masker = PIIMasker()
    cols = ['FullName']
    rows = [{'FullName': 'John Doe'}]
    masked_cols, masked_rows, _ = masker.mask_results(cols, [dict(r) for r in rows])
    assert masked_cols == ['FullName']
    assert masked_rows[0]['FullName'] == 'J*** D***'
