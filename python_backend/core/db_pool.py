"""DB connection pool manager — one SQLAlchemy Engine per DBConfig.

Per Part 8 of spec:
    pool_size=5, max_overflow=10, pool_timeout=30,
    pool_recycle=1800, pool_pre_ping=True
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Optional
from urllib.parse import quote_plus

from sqlalchemy import create_engine, Engine
from sqlalchemy.pool import QueuePool
from loguru import logger


def _sqlite_file_has_tables(path: Path) -> bool:
    """Return True if a SQLite file exists and contains at least one user table.

    A 0-byte placeholder or a database with no tables is treated as "no real
    data" so it never shadows a legacy file that actually holds the user's
    tables. Fail-safe: any read error returns False (treated as empty).
    """
    try:
        if not path.is_file() or path.stat().st_size == 0:
            return False
        import sqlite3
        conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
        try:
            row = conn.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%'"
            ).fetchone()
            return bool(row and row[0] > 0)
        finally:
            conn.close()
    except Exception:
        return False


def resolve_sqlite_path(database: str, workspace_path: Optional[Path] = None,
                        backend_dir: Optional[Path] = None) -> str:
    """Resolve a SQLite ``database`` value to a deterministic absolute path.

    Rules:
      * Absolute paths are returned unchanged (explicit user intent).
      * Relative paths resolve against the *active user workspace* — never the
        extension install dir, the backend CWD, /tmp, or any hidden location.
      * A bare database *name* (no directory component, e.g. ``Tables``) is
        placed in the workspace-controlled ``.qmind/databases/`` directory and
        given a ``.db`` extension when it has none, so the location is
        predictable and user-owned:
        ``<workspace>/.qmind/databases/Tables.db``.
      * A relative path that already contains a directory component
        (e.g. ``data/app.db``) is anchored to the workspace root as-is.
      * When no workspace is available, fall back to the current working
        directory (preserves pre-existing behaviour for headless/test runs)
        but resolve it to an absolute path so the location is explicit.

    The backend process is spawned with ``cwd = <extension>/python_backend``,
    so a bare relative path would otherwise silently create the database
    inside the installed extension directory. Anchoring to the workspace keeps
    the user's data inside the user's project.
    """
    if not database:
        return database
    # Expand ~ and env vars, then normalise.
    expanded = os.path.expandvars(os.path.expanduser(database))
    if os.path.isabs(expanded):
        return os.path.normpath(expanded)

    base = Path(workspace_path) if workspace_path else Path.cwd()

    # Bare name (no directory component) → .qmind/databases/<name>[.db]
    if os.path.dirname(expanded) == '':
        name = expanded if os.path.splitext(expanded)[1] else f'{expanded}.db'
        target = base / '.qmind' / 'databases' / name

        # ── Legacy-data preservation ──────────────────────────────────────
        # Older Verbis versions created the DB relative to the backend CWD
        # (the extension install dir) or the workspace root. If the canonical
        # file does NOT exist yet — OR exists but holds no real data (an empty
        # placeholder created on a prior connect) — while a legacy file DOES
        # contain tables, open the legacy file so existing user data is never
        # shadowed by an empty database. We never copy, move, overwrite, or
        # delete anything here — we simply point the engine at the file that
        # already holds the data.
        canonical_has_data = target.exists() and _sqlite_file_has_tables(target)
        if not canonical_has_data:
            legacy = _find_legacy_sqlite_file(expanded, workspace_path, backend_dir)
            if legacy is not None and _sqlite_file_has_tables(legacy):
                logger.info(
                    f'SQLite "{expanded}": using existing legacy database at '
                    f'{legacy} (canonical {target} has no data). Data preserved.'
                )
                return str(legacy)
    else:
        # Relative path with a directory component → anchor to workspace root.
        target = base / expanded

    target = target.resolve()
    # Ensure the parent directory exists so SQLite can create the file.
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    return str(target)


def _sibling_extension_backend_dirs(backend_dir: Path) -> list[Path]:
    """Return ``python_backend`` dirs of *other installed versions* of this ext.

    The backend runs from ``<extensions>/<publisher>.<name>-<version>/python_backend``.
    When the user upgrades (e.g. 1.2.7 → 1.2.8), the new version's ``python_backend``
    becomes the CWD, but a legacy SQLite file created by the *previous* version stays
    behind in the old version's directory. To find that data without hard-coding any
    version, derive the extension's version-less prefix from the current dir name and
    glob for sibling ``<prefix>-*`` directories, yielding their ``python_backend`` dirs.

    Returns an empty list when the layout doesn't match an installed-extension dir
    (e.g. running from a dev repo), so this is a no-op outside the Marketplace layout.
    """
    try:
        ext_dir = backend_dir.resolve().parent  # <publisher>.<name>-<version>/
        parent = ext_dir.parent                  # the extensions/ folder
        name = ext_dir.name
        # Strip a trailing "-<version>" (e.g. "-1.2.8") to get the stable prefix.
        # Version = last dash-separated segment that starts with a digit.
        if '-' not in name:
            return []
        prefix, _, ver = name.rpartition('-')
        if not prefix or not ver or not ver[0].isdigit():
            return []
        siblings: list[Path] = []
        for cand in sorted(parent.glob(f'{prefix}-*')):
            if cand == ext_dir or not cand.is_dir():
                continue
            pb = cand / 'python_backend'
            if pb.is_dir():
                siblings.append(pb)
        return siblings
    except OSError:
        return []


def _find_legacy_sqlite_file(database: str,
                             workspace_path: Optional[Path] = None,
                             backend_dir: Optional[Path] = None) -> Optional[Path]:
    """Return the path of an existing legacy SQLite file, or ``None``.

    Checks, in priority order:
      1. ``<backend_dir>/<database>`` — the original extension-dir bug.
      2. ``<cwd>/<database>`` — the process working dir. The backend is spawned
         with ``cwd = <extension>/python_backend``, which is exactly where the
         pre-fix bug created bare-name databases. This makes detection robust
         regardless of where the source file lives (dev repo vs installed ext).
      3. ``<workspace>/<database>`` — the intermediate workspace-root location.
      4. ``<sibling installed-version python_backend>/<database>`` — after an
         extension upgrade, the previous version's directory still holds the
         legacy file. Discovered dynamically, never hard-coded to a version.

    Detection only: the file is opened in place, never moved or modified.
    """
    if not database:
        return None
    if backend_dir is None:
        backend_dir = Path(__file__).resolve().parent.parent  # python_backend/
    candidates = [backend_dir / database, Path.cwd() / database]
    if workspace_path:
        candidates.append(Path(workspace_path) / database)
    # Sibling installed-version dirs (extension upgrades leave the old file behind).
    for sib in _sibling_extension_backend_dirs(backend_dir):
        candidates.append(sib / database)
    seen = set()
    for cand in candidates:
        try:
            rc = cand.resolve()
            if rc in seen:
                continue
            seen.add(rc)
            if cand.is_file():
                return rc
        except OSError:
            continue
    return None


def detect_legacy_extension_db(database: str, workspace_path: Optional[Path],
                               backend_dir: Optional[Path] = None) -> Optional[Path]:
    """Detect a legacy SQLite database left behind by an older path bug.

    Two historical locations are checked, in priority order:
      1. The extension install dir (``<extension>/python_backend/<name>``) —
         the original bug where the backend CWD was the extension directory.
      2. The workspace root (``<workspace>/<name>``) — an intermediate fix
         that anchored bare names to the workspace root instead of
         ``.qmind/databases/``.

    Returns the legacy path only if that file exists AND the new canonical
    workspace-local file (``.qmind/databases/<name>.db``) does not yet exist.
    Never moves, deletes, or overwrites anything — detection only, so the
    caller can surface a recovery hint to the user.
    """
    if not database:
        return None
    expanded = os.path.expandvars(os.path.expanduser(database))
    if os.path.isabs(expanded):
        return None

    # Compute the canonical location directly (NOT via resolve_sqlite_path,
    # which may itself resolve to the legacy file). Only a bare name has a
    # canonical .qmind/databases location; anything else has no legacy form.
    if os.path.dirname(expanded) != '':
        return None
    base = Path(workspace_path) if workspace_path else Path.cwd()
    name = expanded if os.path.splitext(expanded)[1] else f'{expanded}.db'
    canonical = (base / '.qmind' / 'databases' / name).resolve()
    # Only report a legacy DB when the canonical location has no real data
    # (missing OR an empty placeholder) AND the legacy file actually has data.
    if _sqlite_file_has_tables(canonical):
        return None  # already migrated / using the canonical location

    legacy = _find_legacy_sqlite_file(expanded, workspace_path, backend_dir)
    if legacy is not None and _sqlite_file_has_tables(legacy):
        return legacy
    return None


def migrate_legacy_sqlite_db(database: str, workspace_path: Optional[Path],
                             backend_dir: Optional[Path] = None) -> Optional[Path]:
    """Copy a legacy SQLite database into the canonical workspace location.

    Safe migration strategy:
      * COPY, never move — the legacy file is left untouched as a backup.
      * Only runs when the canonical location has no real data and the legacy
        file actually contains tables (otherwise returns None, no-op).
      * Writes to a temp file then atomically renames, so an interrupted copy
        never leaves a half-written canonical database.

    Returns the canonical path on success, or ``None`` when migration was not
    needed or not possible. Never overwrites a canonical file that has data.
    """
    legacy = detect_legacy_extension_db(database, workspace_path, backend_dir)
    if legacy is None:
        return None
    expanded = os.path.expandvars(os.path.expanduser(database))
    base = Path(workspace_path) if workspace_path else Path.cwd()
    name = expanded if os.path.splitext(expanded)[1] else f'{expanded}.db'
    canonical = (base / '.qmind' / 'databases' / name).resolve()
    try:
        canonical.parent.mkdir(parents=True, exist_ok=True)
        tmp = canonical.with_suffix(canonical.suffix + '.migrating')
        import shutil
        shutil.copyfile(legacy, tmp)
        os.replace(tmp, canonical)  # atomic on POSIX
        logger.info(
            f'Migrated legacy SQLite database {legacy} → {canonical}. '
            f'Original left in place as a backup.'
        )
        return canonical
    except OSError as exc:
        logger.warning(f'Legacy SQLite migration failed (kept legacy in use): {exc}')
        return None


class DBPoolManager:
    def __init__(self) -> None:
        self._pools: Dict[str, Engine] = {}

    def register(self, db_config_id: str, connection_url: str, pool_size: int = 5) -> Engine:
        engine = create_engine(
            connection_url,
            poolclass=QueuePool,
            pool_size=pool_size,
            max_overflow=10,
            pool_timeout=30,
            pool_recycle=1800,
            pool_pre_ping=True,
        )
        self._pools[db_config_id] = engine
        logger.info(f'Registered DB pool for {db_config_id}')
        return engine

    def get(self, db_config_id: str) -> Optional[Engine]:
        return self._pools.get(db_config_id)

    def dispose(self, db_config_id: str) -> None:
        engine = self._pools.pop(db_config_id, None)
        if engine:
            engine.dispose()

    def dispose_all(self) -> None:
        for engine in self._pools.values():
            engine.dispose()
        self._pools.clear()


def build_connection_url(dialect: str, host: str, port: int,
                         database: str, user: str, password: str,
                         ssl: bool = False,
                         workspace_path: Optional[Path] = None) -> str:
    """Build a SQLAlchemy connection URL.

    Passwords come from VS Code SecretStorage via env var QM_DB_PASSWORD_<ID>.

    For SQLite, ``workspace_path`` anchors relative database paths to the
    active user workspace so the database file lives in the user's project —
    not the extension install directory. Absolute SQLite paths are untouched.
    """
    pwd = quote_plus(password) if password else ''
    auth = f'{user}:{pwd}' if pwd else user

    if dialect == 'postgresql':
        return f'postgresql+psycopg2://{auth}@{host}:{port}/{database}'
    if dialect == 'mysql':
        return f'mysql+pymysql://{auth}@{host}:{port}/{database}'
    if dialect == 'sqlite':
        resolved = resolve_sqlite_path(database, workspace_path)
        return f'sqlite:///{resolved}'  # database = file path
    if dialect == 'mssql':
        return f'mssql+pyodbc://{auth}@{host}:{port}/{database}'
    raise ValueError(f'Unsupported dialect: {dialect}')
