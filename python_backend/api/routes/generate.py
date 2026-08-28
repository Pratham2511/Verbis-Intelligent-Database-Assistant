from fastapi import APIRouter, HTTPException, Request
from models.requests import GenerateRequest
from services.llm_service import (
    DEFAULT_GEMINI_MODEL,
    RETIRED_GEMINI_MODELS,
    generate_sql,
    generate_nosql,
)
from services.intent_service import classify_intent, clear_intent_cache
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
                "(Google retired it for new users). "
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
    msg = str(exc).lower()

    # Retired / unknown model (provider 404, "no longer available", "not found").
    # Detect BEFORE the generic 502 so users get an actionable message.
    if (
        "no longer available" in msg
        or "is not found" in msg
        or "model not found" in msg
        or ("404" in msg and "model" in msg)
        or (model and model in RETIRED_GEMINI_MODELS)
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
    return HTTPException(status_code=502, detail=f"The LLM provider returned an error: {exc}")


@router.post("/generate")
async def generate(req: GenerateRequest, request: Request):
    # ── Intent Guard: block off-topic queries before SQL generation ──
    intent, offtopic_msg = await classify_intent(
        user_message=req.nl_query,
        provider=req.provider,
        api_key=req.api_key,
        model=req.model,
    )
    if intent == "OFFTOPIC":
        return {
            "query": None,
            "confidence": 0.0,
            "alternatives": [],
            "offtopic": True,
            "message": offtopic_msg,
        }

    # ── Normal SQL/NoSQL generation ──────────────────────────────────
    try:
        if req.query_type == "nosql":
            result = await generate_nosql(
                nl_query=req.nl_query,
                schema_context=req.schema_context,
                provider=req.provider,
                api_key=req.api_key,
                model=req.model,
            )
        else:
            result = await generate_sql(
                nl_query=req.nl_query,
                schema_context=req.schema_context,
                dialect=resolve_dialect(
                    request.app.state.qm.db_pools, req.db_config_id, req.dialect
                ),
                provider=req.provider,
                api_key=req.api_key,
                model=req.model,
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise _friendly_generation_error(exc, req.provider, req.model or "")
    return {"query": result, "confidence": 0.9, "alternatives": []}


# ── Cache invalidation endpoint (Fix B) ──────────────────────────────
# Called by extension.ts when user sets/clears API key or switches provider.
# Without this, stale cached classifications persist for up to 200 queries
# after a provider or key switch.

@router.post("/intent/cache/clear")
async def clear_intent_cache_endpoint():
    clear_intent_cache()
    return {"status": "cleared", "entries_removed": "all"}
