"""POST /api/execute — Safe query execution.

Enforces:
- Read-only by default (Part 9, #2)
- Row limit (default 500, max 10,000)
- Timeout (60s default)
- PII masking on results (Novel #13)
- Performance regression detection (Novel #11)
- EXPLAIN plan explainer (Novel #6) — best-effort, non-blocking
- Analytical narrative generation (Novel #12) — best-effort, non-blocking
"""

from __future__ import annotations

import time
from typing import Any, Dict, List

from fastapi import APIRouter, Request, HTTPException
from loguru import logger
import hashlib
import json

from models.requests import ExecuteRequest
from services.execution_service import ExecutionService
from services.plan_explainer import PlanExplainer
from services.narrative_service import NarrativeEngine
from services.perf_tracker import PerfTracker

router = APIRouter()


@router.post('/execute')
async def execute(req: ExecuteRequest, request: Request) -> Dict[str, Any]:
    state = request.app.state.qm
    pool = state.db_pools.get(req.connection_id)
    if pool is None:
        raise HTTPException(404, detail=f'No DB connection registered for id={req.connection_id}')

    # ─── Read-only enforcement (Layer 1) ────────────────────────────────
    # Explicit None check: req.read_only may legitimately be False, so `or`
    # would be wrong here. Request value wins; backend Settings is the fallback.
    effective_read_only = (
        req.read_only
        if req.read_only is not None
        else state.settings.read_only_by_default
    )
    if effective_read_only:
        from services.validator_service import Validator
        # Use the connection's real dialect so the read-only classification
        # parses the script correctly (sqlglot name: 'postgres' not 'postgresql').
        try:
            engine_dialect = pool.dialect.name
        except Exception:
            engine_dialect = 'postgresql'
        sqlglot_dialect = 'postgres' if engine_dialect == 'postgresql' else engine_dialect
        validator = Validator(dialect=sqlglot_dialect)
        # Script-aware: EVERY statement must be read-only, not just the first.
        if not validator.is_read_only_script(req.sql):
            raise HTTPException(
                403,
                detail=(
                    'Write queries are blocked because the Verbis read-only setting is on. '
                    'Disable "verbis.execution.readOnlyByDefault" in VS Code settings to run '
                    'INSERT/UPDATE/DELETE/DROP.'
                ),
            )

    # ─── Execute ────────────────────────────────────────────────────────
    row_limit = min(req.row_limit or state.settings.row_limit_default,
                    state.settings.row_limit_max)
    timeout = (
        req.timeout_seconds
        if req.timeout_seconds is not None
        else state.settings.execution_timeout_seconds
    )

    svc = ExecutionService(pool, timeout_seconds=timeout, row_limit=row_limit)
    try:
        result = await svc.execute(req.sql)
    except TimeoutError:
        raise HTTPException(504, detail='Query timed out. Consider adding a LIMIT or WHERE clause.')
    except Exception as exc:
        logger.error(f'Execution error: {exc}')
        raise HTTPException(500, detail=f'Execution failed: {exc}')

    # ─── PII Masking (Novel #13) ────────────────────────────────────────
    masked_columns, masked_rows, audit_lines = state.pii_masker.mask_results(
        result['columns'], result['rows']
    )
    if audit_lines:
        audit_path = state.workspace_path / 'pii_audit.log'
        with open(audit_path, 'a') as f:
            f.writelines(line + '\n' for line in audit_lines)

    result['rows'] = masked_rows
    if masked_columns:
        result['piiColumnsMasked'] = masked_columns

    # ─── Performance Regression Detection (Novel #11) ───────────────────
    fingerprint = _fingerprint(req.sql)
    regression_alert = state.perf_tracker.record(
        fingerprint=fingerprint,
        execution_time_ms=result['executionTimeMs'],
        rows_scanned=result.get('rowsScanned'),
    )
    if regression_alert:
        result['regressionAlert'] = regression_alert

    # ─── Plan Explainer (Novel #6) — best-effort ────────────────────────
    try:
        explain = await svc.explain(req.sql)
        if explain:
            explainer = PlanExplainer(state.llm)
            result['planExplanation'] = await explainer.explain(explain)
    except Exception as exc:
        logger.warning(f'Plan explainer skipped: {exc}')

    # ─── Analytical Narrative (Novel #12) — best-effort ──────────────────
    try:
        narrative_engine = NarrativeEngine(state.llm)
        result['narrative'] = await narrative_engine.summarize(
            columns=result['columns'],
            rows=result['rows'][:100],
        )
    except Exception as exc:
        logger.warning(f'Narrative engine skipped: {exc}')

    # ─── Update Query Tree node status ─────────────────────────────────
    state.history_store.update_query_tree_node_status(
        sql=req.sql,
        status='success' if not regression_alert else 'warning',
        execution_time_ms=result['executionTimeMs'],
        row_count=result['rowCount'],
    )

    return result


def _fingerprint(sql: str) -> str:
    """Normalize SQL and hash it for the regression baseline."""
    normalized = ' '.join(sql.lower().split())
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]
