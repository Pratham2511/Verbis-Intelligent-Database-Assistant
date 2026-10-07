from fastapi import APIRouter, HTTPException, Request
from models.requests import GenerateRequest
from services.llm_service import (
    DEFAULT_GEMINI_MODEL,
    generate_sql,
    generate_nosql,
)
from services.intent_service import clear_intent_cache
from services.dialect_service import resolve_dialect

router = APIRouter()


def _retired_model_error(provider: str, model: str) -> HTTPException:
    """Build a clear, actionable error for a model the provider has retired.

    Never includes the API key. Tells the user exactly which configured model
    failed, why, where to change it, and which supported model to use.
    """
    if provider == "gemini":
        return HTTPException(
            status_code=400,
            detail=(
                f"The configured Gemini model '{model}' is no longer available "
                "for this account. "
                f"Update the VS Code setting 'verbis.llm.geminiModel' to "
                f"'{DEFAULT_GEMINI_MODEL}' (the current default) or another supported model, "
                "then try again."
            ),
        )
    return HTTPException(
        status_code=400,
        detail=(
            f"The configured model '{model}' for provider '{provider}' was not found "
            "or is no longer available. Check the corresponding 'verbis.llm.*Model' "
            "setting and try again."
        ),
    )


def _friendly_generation_error(exc: Exception, provider: str = "", model: str = "") -> HTTPException:
    """
    Map low-level LLM client errors to actionable HTTP errors.

    Without this, a missing/invalid API key surfaces as a bare
    "500 Internal Server Error" — the terminal then shows a cryptic message.
    Instead we return a clean detail string the extension can display directly.
    """
    from services.llm_service import ProviderConfigurationError
    if isinstance(exc, ProviderConfigurationError):
        return HTTPException(status_code=422, detail=str(exc))
    msg = str(exc).lower()

    # Retired / unknown model (provider 404, "no longer available", "not found").
    # Detect BEFORE the generic 502 so users get an actionable message.
    if (
        "no longer available" in msg
        or "is not found" in msg
        or "model not found" in msg
        or ("404" in msg and "model" in msg)
    ):
        return _retired_model_error(provider, model or "(unknown)")

    if "missing credentials" in msg or "api_key" in msg or "api key" in msg or "unauthorized" in msg or "401" in msg:
        return HTTPException(
            status_code=401,
            detail=(
                "No valid API key for the selected provider. "
                "Run 'Verbis: Set API Key' (or choose a session key when prompted) and try again."
            ),
        )
    if "rate limit" in msg or "429" in msg or "quota" in msg:
        return HTTPException(
            status_code=429,
            detail="The LLM provider rate-limited the request. Wait a moment and try again.",
        )
    return HTTPException(status_code=502, detail='The LLM provider failed. Check provider/model availability and retry.')


@router.post("/generate")
async def generate(req: GenerateRequest, request: Request):
    import json
    import re
    import asyncio
    from services.intent_service import _deterministic_intent
    from services.validator_service import Validator
    from services.glossary_service import GlossaryService
    from api.routes.schema import schema_result
    state = request.app.state.qm
    if _deterministic_intent(req.nl_query) == 'OFFTOPIC':
        return {'query': None, 'confidence': 0, 'alternatives': [], 'offtopic': True,
                'message': 'Ask a question about your database.', 'providerVerified': False}
    if req.query_type != 'sql':
        raise HTTPException(422, detail='Live NoSQL generation/execution is not supported yet.')
    if not req.db_config_id:
        raise HTTPException(422, detail='Select a database connection before generating SQL.')
    info = await schema_result(state, req.db_config_id)
    tables = info['tables']
    dialect = resolve_dialect(state.db_pools, req.db_config_id, req.dialect)
    query = req.nl_query
    session_key = (req.session_id or '', req.db_config_id)
    previous = state.extra.setdefault('conversations', {}).get(session_key, [])
    history = [{ 'role': t['role'], 'content': str(t.get('content', ''))[:10000] }
               for t in (req.conversation or previous)[-10:] if t.get('role') in ('user', 'assistant')]
    terms = GlossaryService(state.workspace_path / 'glossary.json').read().terms
    # Follow-ups keep the reviewed definitions used by this conversation.
    terms_used=state.extra.setdefault('conversation_terms',{}).get(session_key,[])
    matched=[t for t in terms if t.dialect in (dialect,'postgresql' if dialect=='postgres' else dialect) and t.connectionId in (None,req.db_config_id) and (t.term in terms_used or any(a.lower() in query.lower() for a in [t.term,*t.aliases]))]
    state.extra['conversation_terms'][session_key]=[t.term for t in matched]
    from services.workspace_store import WorkspaceStore
    catalogue=WorkspaceStore(state.workspace_path/'datasets.json').read({'tables':[]})
    units=[{'table':t['table'],'columns':[{k:m.get(k) for k in ('name','currency','period')} for m in t['mapping']]} for t in catalogue['tables']] if req.db_config_id=='datasets' else []
    glossary = json.dumps({'definitions':[t.model_dump() for t in matched],'datasetUnits':units})
    original_history=history
    privacy_id = None
    validator = Validator(dialect)
    outbound_tables = tables
    if req.provider != 'local' and req.privacy_enabled:
        outbound_tables, privacy_id = state.privacy_shield.anonymize(tables)
        query = state.privacy_shield.anonymize_text(query, privacy_id)
        glossary = state.privacy_shield.anonymize_text(glossary, privacy_id)
        history = [{**t, 'content': state.privacy_shield.anonymize_text(t['content'], privacy_id)} for t in history]
    context = json.dumps(outbound_tables)
    async def watch_disconnect(task):
        while not task.done():
            if await request.is_disconnected(): task.cancel(); return
            await asyncio.sleep(0.1)
    task = asyncio.create_task(generate_sql(nl_query=query, schema_context=context,
                dialect=dialect, provider=req.provider, api_key=req.api_key, model=req.model,
                conversation=history, glossary=glossary))
    watcher = asyncio.create_task(watch_disconnect(task))
    try:
        raw = await task
        raw = re.sub(r'^```(?:sql|json)?\s*|\s*```$', '', raw.strip(), flags=re.I)
        try:envelope = json.loads(raw) if raw.startswith('{') else {'query': raw}
        except (ValueError,TypeError):raise HTTPException(422,detail='Model output was malformed JSON. Retry or refine the question.')
        if not isinstance(envelope,dict):raise HTTPException(422,detail='Model output must be a query or clarification object')
        if envelope.get('clarification'):
            message=str(envelope['clarification'])
            if privacy_id:message=state.privacy_shield.deanonymize_text(message,privacy_id)
            return {'query': None, 'confidence': 0, 'alternatives': [], 'message': message, 'providerVerified': True}
        if envelope.get('offtopic'):
            message=str(envelope.get('message','Ask a database question.'))
            if privacy_id:message=state.privacy_shield.deanonymize_text(message,privacy_id)
            return {'query': None, 'confidence': 0, 'alternatives': [], 'offtopic': True,
                    'message': message, 'providerVerified': True}
        sql = str(envelope.get('query') or '').strip()
        parameters=envelope.get('parameters') or {}
        import sqlglot
        from sqlglot import exp
        if not isinstance(parameters,dict) or any(not isinstance(v,(str,int,float,bool,type(None))) for v in parameters.values()):raise HTTPException(422,detail='Generated parameters must be scalar values')
        valid, _ = validator.validate_syntax(sql)
        if not valid or not validator.validate_semantic(sql, outbound_tables):
            raise HTTPException(422, detail='Model output failed SQL/schema validation. Refine the question and retry.')
        if privacy_id:
            sql = state.privacy_shield.deanonymize_sql(sql, privacy_id,validator.dialect)
        if not validator.validate_semantic(sql, tables):
            raise HTTPException(422, detail='Generated SQL refers to unknown or ambiguous database objects.')
        names={p.name for p in sqlglot.parse_one(sql,read=validator.dialect).find_all(exp.Placeholder)}
        if names!=set(parameters):raise HTTPException(422,detail='Generated SQL parameters are incomplete or inconsistent')
        state.extra['conversations'][session_key] = [*original_history[-8:],
                {'role': 'user', 'content': req.nl_query}, {'role': 'assistant', 'content': sql}]
        node = state.history_store.append_query_tree_node(req.nl_query, sql, 0,
                connection_id=req.db_config_id, session_id=req.session_id,
                schema_fingerprint=info['fingerprint'])
        return {'query': sql, 'confidence': 0, 'alternatives': [], 'validation': 'schema-validated',
                'readOnly': validator.is_read_only(sql), 'connectionId': req.db_config_id,
                'schemaFingerprint': info['fingerprint'], 'queryNodeId': node,'parameters':parameters,'providerVerified': True}
    except HTTPException: raise
    except Exception as exc:
        from services.llm_service import ModelOutputError
        if isinstance(exc, ModelOutputError): raise HTTPException(422, detail=str(exc))
        raise _friendly_generation_error(exc, req.provider, req.model or '')
    finally:
        watcher.cancel()
        if privacy_id: state.privacy_shield.discard(privacy_id)


# ── Cache invalidation endpoint (Fix B) ──────────────────────────────
# Called by extension.ts when user sets/clears API key or switches provider.
# Without this, stale cached classifications persist for up to 200 queries
# after a provider or key switch.

@router.post("/intent/cache/clear")
async def clear_intent_cache_endpoint():
    clear_intent_cache()
    return {"status": "cleared", "entries_removed": "all"}
