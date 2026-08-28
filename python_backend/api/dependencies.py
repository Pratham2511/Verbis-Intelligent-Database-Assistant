"""Application-wide dependency injection and lifecycle.

Holds the AppState object that bundles:
- DB connection pools (one per DBConfig)
- ChromaDB client (schema RAG index)
- LLM client (cloud + local)
- Workspace path
- Active settings
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict
import json
import os

from config import Settings
from core.db_pool import DBPoolManager
from core.memory_store import MemoryStore
from core.history_store import HistoryStore
from services.rag_service import RAGService
from services.llm_service import LLMRouter
from services.privacy_shield import PrivacyShield
from services.pii_service import PIIMasker
from services.perf_tracker import PerfTracker


@dataclass
class AppState:
    settings: Settings
    workspace_path: Path
    db_pools: DBPoolManager
    memory_store: MemoryStore
    history_store: HistoryStore
    rag: RAGService
    llm: LLMRouter
    privacy_shield: PrivacyShield
    pii_masker: PIIMasker
    perf_tracker: PerfTracker
    extra: dict = field(default_factory=dict)


def init_app_state(settings: Settings) -> AppState:
    """Construct all backend services. Called once in FastAPI lifespan."""
    workspace = settings.workspace_path / '.qmind'
    workspace.mkdir(parents=True, exist_ok=True)

    db_pools = DBPoolManager()
    
    # Load connections from config.json and register them
    config_path = workspace / 'config.json'
    if config_path.exists():
        try:
            from loguru import logger
            from core.db_pool import (
                build_connection_url,
                detect_legacy_extension_db,
                migrate_legacy_sqlite_db,
            )

            config = json.loads(config_path.read_text())
            for conn in config.get('connections', []):
                db_id = conn.get('id')
                # Password is provided by the TS extension during startup
                password = os.environ.get(f'QM_DB_PASSWORD_{db_id}', '')
                try:
                    url = build_connection_url(
                        dialect=conn.get('dialect', ''),
                        host=conn.get('host', ''),
                        port=conn.get('port', 0),
                        database=conn.get('database', ''),
                        user=conn.get('user', ''),
                        password=password,
                        workspace_path=settings.workspace_path,
                    )
                    db_pools.register(db_id, url)
                    logger.info(f"Registered connection {db_id}")

                    # Surface where a SQLite connection actually resolved to.
                    # resolve_sqlite_path prefers an existing legacy DB (with
                    # data) over an empty canonical placeholder, so existing
                    # user data is opened in place and never shadowed.
                    if conn.get('dialect') == 'sqlite':
                        legacy = detect_legacy_extension_db(
                            conn.get('database', ''), settings.workspace_path
                        )
                        if legacy is not None:
                            # Attempt a safe, non-destructive COPY of the legacy
                            # database into the workspace-owned canonical
                            # location. The legacy file is left untouched as a
                            # backup. If the copy fails, the engine keeps using
                            # the legacy file in place — no data is ever lost.
                            migrated = migrate_legacy_sqlite_db(
                                conn.get('database', ''), settings.workspace_path
                            )
                            if migrated is not None:
                                # Re-register the engine against the canonical
                                # workspace copy so future runs are anchored to
                                # the user's project, not the extension dir.
                                url = build_connection_url(
                                    dialect='sqlite',
                                    host=conn.get('host', ''),
                                    port=conn.get('port', 0),
                                    database=conn.get('database', ''),
                                    user=conn.get('user', ''),
                                    password=password,
                                    workspace_path=settings.workspace_path,
                                )
                                db_pools.register(db_id, url)
                                logger.info(
                                    f"SQLite connection {db_id} migrated to "
                                    f"workspace database at {migrated}. "
                                    f"Legacy backup preserved at {legacy}."
                                )
                            else:
                                logger.info(
                                    f"SQLite connection {db_id} is using existing "
                                    f"legacy database at {legacy}. Your data is "
                                    f"preserved and opened in place."
                                )
                except Exception as e:
                    logger.error(f"Failed to register connection {db_id}: {e}")
        except Exception as e:
            from loguru import logger
            logger.error(f"Failed to parse config.json: {e}")

    return AppState(
        settings=settings,
        workspace_path=workspace,
        db_pools=db_pools,
        memory_store=MemoryStore(workspace / 'memory.json'),
        history_store=HistoryStore(workspace / 'history.json', workspace / 'query_tree.json'),
        rag=RAGService(persist_dir=str(settings.chroma_path)),
        llm=LLMRouter(settings),
        privacy_shield=PrivacyShield(salt_path=settings.priv_map_path),
        pii_masker=PIIMasker(),
        perf_tracker=PerfTracker(
            log_path=workspace / 'perf_log.json',
            baseline_window=settings.regression_baseline_window,
            threshold_pct=settings.regression_threshold_pct,
        ),
    )


async def dispose_app_state(state: AppState) -> None:
    """Dispose all resources on shutdown."""
    try:
        state.db_pools.dispose_all()
        state.rag.close()
    except Exception as exc:
        from loguru import logger
        logger.warning(f'Error during disposal: {exc}')
