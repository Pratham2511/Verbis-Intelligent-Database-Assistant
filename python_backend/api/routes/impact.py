"""POST /api/schema/impact — Schema Change Impact Predictor (Novel #9)."""

from __future__ import annotations

from typing import Dict, Any, List

from fastapi import APIRouter, Request, HTTPException
from loguru import logger
from pydantic import BaseModel

from services.schema_impact import SchemaImpactPredictor

router = APIRouter()


class ImpactRequest(BaseModel):
    proposed_ddl: str
    schema_context: str = ''


@router.post('/impact')
async def analyze_impact(req: ImpactRequest, request: Request) -> Dict[str, Any]:
    state = request.app.state.qm
    predictor = SchemaImpactPredictor(state.history_store)
    try:
        impact = predictor.predict(req.proposed_ddl, db_config_id='default')
        # predict() returns an ImpactResponse Pydantic model; serialize to a dict
        # to satisfy the Dict[str, Any] response type.
        return impact.model_dump()
    except Exception as exc:
        logger.error(f'Impact analysis failed: {exc}')
        raise HTTPException(500, detail=f'Impact analysis failed: {exc}')
