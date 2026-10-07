"""Verbis backend configuration.

Reads from CLI args, env vars, and an optional .env file. Settings flow:

    CLI flag  →  env var  →  .env  →  Pydantic default
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix='QM_',
        env_file='.env',
        env_file_encoding='utf-8',
        extra='ignore',
    )

    # ─── Server ──────────────────────────────────────────────────────────
    host: str = '127.0.0.1'           # ALWAYS localhost (Part 9 — Localhost Only)
    port: int = 8765
    workspace_path: Path = Path.cwd()
    log_level: Literal['DEBUG', 'INFO', 'WARNING', 'ERROR'] = 'INFO'

    # ─── LLM ──────────────────────────────────────────────────────────────
    llm_mode: Literal['cloud', 'local', 'auto'] = 'auto'
    cloud_endpoint: str = 'https://api.example.com/v1/chat/completions'
    cloud_model: str = 'llama-3-70b-instruct'
    cloud_api_key: str = ''             # Falls back to env QM_CLOUD_API_KEY
    local_endpoint: str = 'http://127.0.0.1:11434/api/generate'  # Ollama default
    local_model: str = 'mistral:7b'
    llm_timeout_seconds: int = 30

    # ─── Privacy ──────────────────────────────────────────────────────────
    privacy_shield_enabled: bool = True
    priv_map_path: Path = Path('.qmind/priv_map.enc')

    # ─── Execution ────────────────────────────────────────────────────────
    row_limit_default: int = 500
    row_limit_max: int = 10_000
    execution_timeout_seconds: int = 60
    read_only_by_default: bool = True

    # ─── ChromaDB ─────────────────────────────────────────────────────────
    chroma_path: Path = Path('.qmind/chromadb')

    # ─── Performance Regression ───────────────────────────────────────────
    regression_threshold_pct: float = 20.0
    regression_baseline_window: int = 10    # Last N executions per fingerprint


def parse_args() -> Settings:
    parser = argparse.ArgumentParser(description='Verbis FastAPI backend')
    parser.add_argument('--port', type=int, default=None)
    parser.add_argument('--workspace', type=Path, default=None)
    parser.add_argument('--host', type=str, default=None)
    parser.add_argument('--log-level', type=str, default=None)
    args = parser.parse_args()

    settings = Settings()

    if args.port is not None:
        settings.port = args.port
    if args.workspace is not None:
        settings.workspace_path = args.workspace
    if args.host is not None:
        settings.host = args.host
    if args.log_level is not None:
        settings.log_level = args.log_level

    # Resolve workspace-relative paths
    settings.priv_map_path = settings.workspace_path / '.qmind' / 'priv_map.enc'
    settings.chroma_path = settings.workspace_path / '.qmind' / 'chromadb'

    # Ensure .qmind/ exists
    qmind_dir = settings.workspace_path / '.qmind'
    qmind_dir.mkdir(parents=True, exist_ok=True)
    (qmind_dir / 'sessions').mkdir(exist_ok=True)

    return settings


# Singleton
settings = Settings()
