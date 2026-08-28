"""Regression tests for SQLite database path resolution.

Defect: a relative SQLite ``database`` value (e.g. ``"Tables"``) was turned
into ``sqlite:///Tables`` and, because the backend process runs with
``cwd = <extension>/python_backend``, the database file was silently created
inside the installed VS Code extension directory instead of the user's
workspace.

The fix anchors relative paths to the active workspace via
``resolve_sqlite_path`` / ``build_connection_url(..., workspace_path=...)``.

Run with the project venv:
    venv/bin/python -m pytest python_backend/tests/test_sqlite_path.py -q
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

# Make the backend importable when run directly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from core.db_pool import (  # noqa: E402
    build_connection_url,
    detect_legacy_extension_db,
    migrate_legacy_sqlite_db,
    resolve_sqlite_path,
)


def _make_db_with_table(path: Path) -> Path:
    """Create a real SQLite database containing one user table.

    Legacy detection only treats a file as data-bearing when it actually
    contains a user table, so tests must write a genuine database rather
    than a placeholder byte.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f'sqlite:///{path}')
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE School (ID INTEGER, Name TEXT)'))
        conn.execute(text("INSERT INTO School VALUES (1, 'Luca')"))
    return path


# ─── resolve_sqlite_path ─────────────────────────────────────────────────────
def test_bare_name_goes_to_qmind_databases_with_db_extension(tmp_path):
    ws = tmp_path / 'workspace'
    ws.mkdir()
    resolved = resolve_sqlite_path('Tables', ws)
    assert resolved == str((ws / '.qmind' / 'databases' / 'Tables.db').resolve())
    assert os.path.isabs(resolved)
    # The databases directory must be created so SQLite can write the file.
    assert (ws / '.qmind' / 'databases').is_dir()


def test_bare_name_with_extension_keeps_extension(tmp_path):
    ws = tmp_path / 'workspace'
    ws.mkdir()
    resolved = resolve_sqlite_path('app.sqlite', ws)
    assert resolved == str((ws / '.qmind' / 'databases' / 'app.sqlite').resolve())


def test_relative_nested_path_resolves_against_workspace_root(tmp_path):
    ws = tmp_path / 'workspace'
    ws.mkdir()
    resolved = resolve_sqlite_path('data/app.db', ws)
    assert resolved == str((ws / 'data' / 'app.db').resolve())


def test_absolute_path_is_unchanged(tmp_path):
    abs_path = str((tmp_path / 'abs.db').resolve())
    assert resolve_sqlite_path(abs_path, tmp_path / 'ws') == os.path.normpath(abs_path)


def test_absolute_path_unchanged_even_without_workspace():
    abs_path = os.path.abspath('some.db')
    assert resolve_sqlite_path(abs_path, None) == os.path.normpath(abs_path)


def test_tilde_is_expanded():
    resolved = resolve_sqlite_path('~/mydb.db', Path('/ws'))
    assert os.path.isabs(resolved)
    assert not resolved.startswith('~')
    assert resolved == os.path.normpath(os.path.expanduser('~/mydb.db'))


def test_no_workspace_bare_name_uses_cwd_qmind(tmp_path, monkeypatch):
    # Headless/test runs without a workspace: still use .qmind/databases under
    # the CWD (absolute), never a hidden/extension location.
    monkeypatch.chdir(tmp_path)
    resolved = resolve_sqlite_path('local', None)
    assert resolved == str((tmp_path / '.qmind' / 'databases' / 'local.db').resolve())


def test_empty_database_passthrough():
    assert resolve_sqlite_path('', Path('/ws')) == ''


# ─── build_connection_url ────────────────────────────────────────────────────
def _sqlite_path_from_url(url: str) -> str:
    assert url.startswith('sqlite:///')
    return url[len('sqlite:///'):]


def test_build_url_bare_name_uses_qmind_databases(tmp_path):
    ws = tmp_path / 'ws'
    ws.mkdir()
    url = build_connection_url('sqlite', '', 0, 'Tables', '', '', workspace_path=ws)
    assert _sqlite_path_from_url(url) == str((ws / '.qmind' / 'databases' / 'Tables.db').resolve())


def test_build_url_absolute_unchanged(tmp_path):
    abs_path = str((tmp_path / 'abs.db').resolve())
    url = build_connection_url('sqlite', '', 0, abs_path, '', '', workspace_path=tmp_path / 'ws')
    assert _sqlite_path_from_url(url) == os.path.normpath(abs_path)


def test_build_url_without_workspace_uses_cwd_qmind(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    url = build_connection_url('sqlite', '', 0, 'x.db', '', '')
    assert _sqlite_path_from_url(url) == str((tmp_path / '.qmind' / 'databases' / 'x.db').resolve())


def test_non_sqlite_dialects_ignore_workspace(tmp_path):
    ws = tmp_path / 'ws'
    pg = build_connection_url('postgresql', 'h', 5432, 'db', 'u', 'p', workspace_path=ws)
    my = build_connection_url('mysql', 'h', 3306, 'db', 'u', 'p', workspace_path=ws)
    assert pg == 'postgresql+psycopg2://u:p@h:5432/db'
    assert my == 'mysql+pymysql://u:p@h:3306/db'


# ─── Physical file creation (end-to-end) ─────────────────────────────────────
def test_sqlite_file_created_in_workspace_not_extension(tmp_path):
    """Physically create a table via the resolved URL and assert the file lands
    in the workspace, and that nothing is created under a fake extension dir."""
    ws = tmp_path / 'workspace'
    ws.mkdir()
    fake_extension = tmp_path / 'extension' / 'python_backend'
    fake_extension.mkdir(parents=True)

    url = build_connection_url('sqlite', '', 0, 'Tables', '', '', workspace_path=ws)
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE School (ID INTEGER, Name TEXT, Depart TEXT)'))
        conn.execute(text("INSERT INTO School VALUES (1, 'Luca', 'IT')"))

    expected = (ws / '.qmind' / 'databases' / 'Tables.db').resolve()
    assert expected.exists(), 'database must be created under .qmind/databases in the workspace'
    assert not (fake_extension / 'Tables').exists(), 'must NOT be created under the extension dir'

    # Reopen and confirm data persists.
    engine2 = create_engine(url)
    with engine2.connect() as conn:
        rows = conn.execute(text('SELECT * FROM School')).all()
    assert rows == [(1, 'Luca', 'IT')]


# ─── Legacy detection ────────────────────────────────────────────────────────
def test_detect_legacy_db_present_only_in_extension(tmp_path):
    ws = tmp_path / 'ws'
    ws.mkdir()
    backend_dir = tmp_path / 'extension' / 'python_backend'
    backend_dir.mkdir(parents=True)
    legacy = _make_db_with_table(backend_dir / 'Tables')

    found = detect_legacy_extension_db('Tables', ws, backend_dir=backend_dir)
    assert found == legacy.resolve()


def test_detect_legacy_db_none_when_canonical_copy_exists(tmp_path):
    ws = tmp_path / 'ws'
    canonical = ws / '.qmind' / 'databases' / 'Tables.db'
    _make_db_with_table(canonical)  # already migrated/present with data
    backend_dir = tmp_path / 'extension' / 'python_backend'
    backend_dir.mkdir(parents=True)
    _make_db_with_table(backend_dir / 'Tables')

    assert detect_legacy_extension_db('Tables', ws, backend_dir=backend_dir) is None


def test_detect_legacy_db_at_workspace_root(tmp_path):
    # Intermediate fix left a file at <workspace>/<name>; detect it too.
    ws = tmp_path / 'ws'
    ws.mkdir()
    legacy = _make_db_with_table(ws / 'Tables')
    backend_dir = tmp_path / 'extension' / 'python_backend'
    backend_dir.mkdir(parents=True)

    found = detect_legacy_extension_db('Tables', ws, backend_dir=backend_dir)
    assert found == legacy.resolve()


def test_empty_canonical_does_not_shadow_legacy_with_data(tmp_path):
    # Regression: an empty 0-byte canonical placeholder must not shadow a
    # legacy file that actually holds the user's tables.
    ws = tmp_path / 'ws'
    canonical = ws / '.qmind' / 'databases' / 'Tables.db'
    canonical.parent.mkdir(parents=True)
    canonical.write_bytes(b'')  # empty placeholder, no tables
    backend_dir = tmp_path / 'extension' / 'python_backend'
    backend_dir.mkdir(parents=True)
    legacy = _make_db_with_table(backend_dir / 'Tables')

    # Detection still finds the legacy DB (canonical has no data).
    assert detect_legacy_extension_db('Tables', ws, backend_dir=backend_dir) == legacy.resolve()
    # And resolution opens the legacy file in place rather than the empty file.
    resolved = resolve_sqlite_path('Tables', ws, backend_dir=backend_dir)
    assert resolved == str(legacy.resolve())


def test_detect_legacy_db_none_for_absolute(tmp_path):
    assert detect_legacy_extension_db(str(tmp_path / 'abs.db'), tmp_path, backend_dir=tmp_path) is None


def test_detect_legacy_db_none_when_no_legacy_file(tmp_path):
    ws = tmp_path / 'ws'
    ws.mkdir()
    backend_dir = tmp_path / 'extension' / 'python_backend'
    backend_dir.mkdir(parents=True)
    assert detect_legacy_extension_db('Tables', ws, backend_dir=backend_dir) is None


# ─── legacy-preference resolution (data preservation) ───────────────────────
def _make_legacy_db(path: Path) -> None:
    """Create a real SQLite DB with a School table and one row of user data."""
    path.parent.mkdir(parents=True, exist_ok=True)
    eng = create_engine(f'sqlite:///{path}')
    with eng.begin() as c:
        c.execute(text('CREATE TABLE School (ID INTEGER PRIMARY KEY, Name TEXT, Depart TEXT)'))
        c.execute(text("INSERT INTO School (ID, Name, Depart) VALUES (1, 'Luca', 'IT')"))
    eng.dispose()


def test_resolve_prefers_legacy_extension_db_over_new_canonical(tmp_path, monkeypatch):
    """A bare name with an existing legacy DB must resolve to the legacy file,
    NOT a fresh canonical path — so existing user data is opened, not shadowed."""
    ws = tmp_path / 'ws'
    ws.mkdir()
    backend_dir = tmp_path / 'extension' / 'python_backend'
    legacy = backend_dir / 'Tables'
    _make_legacy_db(legacy)
    # Run as if the backend CWD is the extension dir (production launch).
    monkeypatch.chdir(backend_dir)

    resolved = resolve_sqlite_path('Tables', ws)
    assert resolved == str(legacy.resolve())
    # No empty canonical file may be created.
    assert not (ws / '.qmind' / 'databases' / 'Tables.db').exists()


def test_resolve_prefers_legacy_workspace_root_db(tmp_path, monkeypatch):
    """Intermediate-fix location (<workspace>/<name>) is also preferred."""
    ws = tmp_path / 'ws'
    ws.mkdir()
    legacy = ws / 'Tables'
    _make_legacy_db(legacy)
    # CWD is some unrelated place with no legacy file.
    other = tmp_path / 'elsewhere'
    other.mkdir()
    monkeypatch.chdir(other)
    monkeypatch.setattr(Path, 'cwd', lambda: other)  # ensure no cwd collision

    resolved = resolve_sqlite_path('Tables', ws)
    assert resolved == str(legacy.resolve())


def test_resolve_uses_canonical_when_no_legacy(tmp_path, monkeypatch):
    """With no legacy file anywhere, a bare name uses the canonical location."""
    ws = tmp_path / 'ws'
    ws.mkdir()
    clean = tmp_path / 'clean_cwd'
    clean.mkdir()
    monkeypatch.chdir(clean)

    resolved = resolve_sqlite_path('Tables', ws)
    assert resolved == str((ws / '.qmind' / 'databases' / 'Tables.db').resolve())


def test_resolve_uses_canonical_when_it_already_exists(tmp_path, monkeypatch):
    """If the canonical file already exists, it wins (already migrated) — the
    legacy file is left alone and not re-opened."""
    ws = tmp_path / 'ws'
    canonical = ws / '.qmind' / 'databases' / 'Tables.db'
    _make_legacy_db(canonical)  # canonical has its own data
    backend_dir = tmp_path / 'extension' / 'python_backend'
    _make_legacy_db(backend_dir / 'Tables')  # legacy also exists
    monkeypatch.chdir(backend_dir)

    resolved = resolve_sqlite_path('Tables', ws)
    assert resolved == str(canonical.resolve())


def test_legacy_db_data_accessible_through_full_flow(tmp_path, monkeypatch):
    """End-to-end: legacy DB -> build_connection_url -> engine -> user data."""
    ws = tmp_path / 'ws'
    ws.mkdir()
    backend_dir = tmp_path / 'extension' / 'python_backend'
    legacy = backend_dir / 'Tables'
    _make_legacy_db(legacy)
    monkeypatch.chdir(backend_dir)

    url = build_connection_url('sqlite', '', 0, 'Tables', '', '', workspace_path=ws)
    eng = create_engine(url)
    from sqlalchemy import inspect as sa_inspect
    insp = sa_inspect(eng)
    assert 'School' in insp.get_table_names()
    with eng.connect() as c:
        rows = c.execute(text('SELECT * FROM School')).fetchall()
    eng.dispose()
    assert rows == [(1, 'Luca', 'IT')]
    # Legacy file still present and unmodified (not deleted/moved).
    assert legacy.is_file()


def test_legacy_file_never_deleted_or_overwritten(tmp_path, monkeypatch):
    """Resolving + opening must not modify the legacy file's data."""
    ws = tmp_path / 'ws'
    ws.mkdir()
    backend_dir = tmp_path / 'extension' / 'python_backend'
    legacy = backend_dir / 'Tables'
    _make_legacy_db(legacy)
    before = legacy.read_bytes()
    monkeypatch.chdir(backend_dir)

    url = build_connection_url('sqlite', '', 0, 'Tables', '', '', workspace_path=ws)
    eng = create_engine(url)
    with eng.connect() as c:
        c.execute(text('SELECT * FROM School')).fetchall()
    eng.dispose()

    assert legacy.is_file()
    # Data rows still intact (file may change header bytes on open, but data persists).
    eng2 = create_engine(f'sqlite:///{legacy}')
    with eng2.connect() as c:
        assert c.execute(text('SELECT * FROM School')).fetchall() == [(1, 'Luca', 'IT')]
    eng2.dispose()


# ─── safe copy-migration ─────────────────────────────────────────────────────
def test_migrate_copies_legacy_to_canonical_preserving_data(tmp_path, monkeypatch):
    """Migration copies the legacy DB into the canonical workspace location,
    preserves all rows, and leaves the legacy file untouched as a backup."""
    ws = tmp_path / 'ws'
    ws.mkdir()
    backend_dir = tmp_path / 'extension' / 'python_backend'
    legacy = backend_dir / 'Tables'
    _make_legacy_db(legacy)
    monkeypatch.chdir(backend_dir)

    migrated = migrate_legacy_sqlite_db('Tables', ws, backend_dir=backend_dir)
    canonical = (ws / '.qmind' / 'databases' / 'Tables.db').resolve()
    assert migrated == canonical
    assert canonical.is_file()

    # Data preserved in the canonical copy.
    eng = create_engine(f'sqlite:///{canonical}')
    with eng.connect() as c:
        assert c.execute(text('SELECT * FROM School')).fetchall() == [(1, 'Luca', 'IT')]
    eng.dispose()

    # Legacy backup still present with its data intact.
    assert legacy.is_file()
    eng2 = create_engine(f'sqlite:///{legacy}')
    with eng2.connect() as c:
        assert c.execute(text('SELECT * FROM School')).fetchall() == [(1, 'Luca', 'IT')]
    eng2.dispose()


def test_migrate_noop_when_canonical_already_has_data(tmp_path, monkeypatch):
    """If the canonical DB already holds data, migration is a no-op (returns
    None) so an existing workspace database is never overwritten."""
    ws = tmp_path / 'ws'
    canonical = ws / '.qmind' / 'databases' / 'Tables.db'
    _make_legacy_db(canonical)
    backend_dir = tmp_path / 'extension' / 'python_backend'
    _make_legacy_db(backend_dir / 'Tables')
    monkeypatch.chdir(backend_dir)

    assert migrate_legacy_sqlite_db('Tables', ws, backend_dir=backend_dir) is None


def test_migrate_noop_when_no_legacy(tmp_path, monkeypatch):
    """No legacy file anywhere -> nothing to migrate -> None."""
    ws = tmp_path / 'ws'
    ws.mkdir()
    clean = tmp_path / 'clean'
    clean.mkdir()
    monkeypatch.chdir(clean)
    assert migrate_legacy_sqlite_db('Tables', ws, backend_dir=tmp_path / 'ext') is None
