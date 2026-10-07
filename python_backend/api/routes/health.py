"""GET /api/health — Liveness check."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get('/health')
async def health():
    return {'status': 'ok', 'version': '1.5.0'}
