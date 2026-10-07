"""Verbis — FastAPI application entry point.

Binds to 127.0.0.1 only (Part 9 — Localhost Only). Provides:

    POST /api/generate           NL → SQL pipeline
    POST /api/execute            Safe query execution
    GET  /api/schema             Schema introspection + ChromaDB indexing
    POST /api/schema/impact      DDL pre-execution impact analysis
    POST /api/robustness         EvoSchema perturbation test run
    POST /api/glossary           Add or update a business glossary term
    GET  /api/glossary           Retrieve all glossary terms
    GET  /api/health             Liveness check
    DELETE /api/shutdown          Graceful shutdown trigger
"""

from __future__ import annotations

import asyncio
import os
import secrets
import signal
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

# Make backend dir importable when run as a script
sys.path.insert(0, str(Path(__file__).parent))

from config import settings, parse_args  # noqa: E402
from api.dependencies import init_app_state, dispose_app_state, AppState  # noqa: E402
from api.routes import (  # noqa: E402
    generate,
    execute,
    schema,
    impact,
    robustness,
    glossary,
    health,
    schema_create,
    connections,
    workspace,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown lifecycle."""
    logger.info(f'Verbis backend starting on {settings.host}:{settings.port}')
    logger.info(f'Workspace: {settings.workspace_path}')
    app.state.qm = init_app_state(settings)
    yield
    logger.info('Verbis backend shutting down…')
    await dispose_app_state(app.state.qm)


app = FastAPI(
    title='Verbis Backend',
    description='LLM-Based Intelligent Database Assistant — FastAPI service',
    version='1.5.0',
    lifespan=lifespan,
)

# CORS — allow only the VS Code webview origin (essentially none, since it's same-origin).
# We add localhost origins for debugging via curl/browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://127.0.0.1', 'http://localhost'],
    allow_methods=['GET', 'POST', 'DELETE', 'OPTIONS'],
    allow_headers=['*'],
)


@app.middleware('http')
async def enforce_localhost(request, call_next):
    """Defense-in-depth: refuse non-loopback requests even if uvicorn is misconfigured."""
    client_host = request.client.host if request.client else ''
    if client_host not in ('127.0.0.1', '::1', 'localhost'):
        return JSONResponse({'detail': 'Forbidden: backend is localhost-only'}, status_code=403)
    token=os.environ.get('QM_BACKEND_TOKEN')
    if token and not secrets.compare_digest(request.headers.get('Authorization',''), 'Bearer '+token):
        return JSONResponse({'detail':'Backend authentication required'},status_code=401)
    return await call_next(request)


# ─── Route Registration ─────────────────────────────────────────────────
app.include_router(health.router, prefix='/api', tags=['health'])
app.include_router(generate.router, prefix='/api', tags=['generate'])
app.include_router(execute.router, prefix='/api', tags=['execute'])
app.include_router(schema.router, prefix='/api', tags=['schema'])
app.include_router(impact.router, prefix='/api/schema', tags=['impact'])
app.include_router(robustness.router, prefix='/api', tags=['robustness'])
app.include_router(glossary.router, prefix='/api', tags=['glossary'])
app.include_router(schema_create.router, prefix='/api', tags=['schema_create'])


app.include_router(connections.router,prefix='/api',tags=['connections'])
app.include_router(workspace.router,prefix='/api',tags=['workspace'])

# ─── Graceful Shutdown Endpoint ─────────────────────────────────────────
@app.delete('/api/shutdown')
async def shutdown():
    """Trigger graceful shutdown from the extension host."""
    logger.info('Shutdown requested via DELETE /api/shutdown')
    loop = asyncio.get_running_loop()
    loop.call_later(0.1, _raise_shutdown)
    return {'status': 'shutting_down'}


def _raise_shutdown():
    """Send SIGTERM to self to allow uvicorn to drain."""
    signal.raise_signal(signal.SIGTERM)


def main():
    """Entry point for `python main.py --port N --workspace PATH`."""
    parsed = parse_args()
    settings.__dict__.update(parsed.__dict__)
    uvicorn.run(
        'main:app',
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        reload=False,
        workers=1,
    )


if __name__ == '__main__':
    main()
