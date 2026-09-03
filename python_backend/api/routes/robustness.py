"""POST /api/robustness — Schema Evolution Robustness Testing Suite (Novel #16)."""

from __future__ import annotations

from typing import List, Dict, Any

from fastapi import APIRouter, Request, HTTPException
from loguru import logger
from pydantic import BaseModel

from services.robustness_service import RobustnessTester

router = APIRouter()


class RobustnessQueryItem(BaseModel):
    id: str
    sql: str
    nlInput: str = ''


class RobustnessRequest(BaseModel):
    querySet: List[RobustnessQueryItem]


@router.post('/robustness')
async def run_robustness(req: RobustnessRequest, request: Request) -> Dict[str, Any]:
    state = request.app.state.qm
    tester = RobustnessTester(state.history_store)
    try:
        # RobustnessTester.run_perturbations accesses .id/.sql/.nlInput attributes,
        # so pass the parsed RobustnessQueryItem models directly (not plain dicts).
        report = tester.run_perturbations(list(req.querySet))
        return report.model_dump()
    except Exception as exc:
        logger.error(f'Robustness test failed: {exc}')
        raise HTTPException(500, detail=f'Robustness test failed: {exc}')
