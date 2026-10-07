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
import threading
import asyncio
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

    cancel = threading.Event()
    jobs = state.extra.setdefault('executions', {})
    if req.request_id and req.request_id in jobs:
        raise HTTPException(409, detail='An execution with this request id is already running.')
    if req.request_id: jobs[req.request_id] = cancel
    svc = ExecutionService(pool, timeout_seconds=timeout, row_limit=row_limit,
                           read_only=effective_read_only, cancel_event=cancel)
    async def watch_disconnect():
        while True:
            if await request.is_disconnected():
                cancel.set()
                return
            await asyncio.sleep(0.1)
    watcher = asyncio.create_task(watch_disconnect())
    try:
        result = await svc.execute(req.sql, req.parameters)
    except TimeoutError:
        if cancel.is_set():raise HTTPException(499,detail='Query cancellation acknowledged.')
        raise HTTPException(504, detail='Query timed out. Consider adding a LIMIT or WHERE clause.')
    except Exception as exc:
        logger.error('Execution failed ({})', type(exc).__name__)
        raise HTTPException(500, detail=f'Execution failed: {exc}')

    finally:
        watcher.cancel()
        if req.request_id: jobs.pop(req.request_id, None)

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
    fingerprint = _fingerprint(req.connection_id+'\n'+req.sql)
    regression_alert = state.perf_tracker.record(
        fingerprint=fingerprint,
        execution_time_ms=result['executionTimeMs'],
        rows_scanned=result.get('rowsScanned'),
    )
    if regression_alert:
        result['regressionAlert'] = regression_alert

    # Numerical summaries come from measured results, without a hidden LLM call.
    result['narrative'] = f"{result['rowCount']} rows returned" + (' (limited).' if result['truncated'] else '.')

    # ─── Update Query Tree node status ─────────────────────────────────
    state.history_store.update_query_tree_node_status(
        sql=req.sql,
        status='success' if not regression_alert else 'warning',
        execution_time_ms=result['executionTimeMs'],
        row_count=result['rowCount'],
        connection_id=req.connection_id,
    )

    from services.analysis_service import chart_suggestion
    result['chart']=chart_suggestion(req.sql,result['columns'],result['rows'])
    state.extra['last_result']={'sql':req.sql,'connectionId':req.connection_id,'parameters':req.parameters,'result':result}
    return result


def _fingerprint(sql: str) -> str:
    """Normalize SQL and hash it for the regression baseline."""
    normalized = ' '.join(sql.lower().split())
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]

@router.post('/execute/cancel/{request_id}')
async def cancel_execution(request_id: str, request: Request):
    event = request.app.state.qm.extra.setdefault('executions', {}).get(request_id)
    if event: event.set()
    return {'cancelRequested': event is not None}
