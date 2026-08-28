"""
LLM Service — Gemini (primary) + Groq + Ollama local mode.
API key is passed per-request from VS Code SecretStorage. Nothing stored server-side.

Exposes two APIs:
- Module-level functions (generate_sql, generate_nosql, …) used by api/routes/*.
- LLMRouter class used by services/* via dependency injection (api/dependencies.py).
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Optional

from openai import AsyncOpenAI

from config import Settings

# ─── Default models ──────────────────────────────────────────────────────
# Single source of truth for the built-in model used per provider when the
# caller does not supply one. The extension's `verbis.llm.geminiModel` /
# `verbis.llm.groqModel` settings are forwarded per-request and override these.
DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"
DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile"
DEFAULT_LOCAL_MODEL = "sqlcoder:latest"

# Models that Google has retired for new users. If a user still has one of
# these configured, we surface a clear, actionable error instead of a raw
# provider 404. Kept as a set for O(1) lookup and easy extension.
RETIRED_GEMINI_MODELS = {
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-pro",
}


def _get_client(
    provider: str,
    api_key: str,
    model: Optional[str] = None,
) -> tuple[AsyncOpenAI, str]:
    """Build an OpenAI-compatible client + the model to call.

    `model` is the user-configured model forwarded from the extension. When
    omitted/blank, the provider's current default is used.
    """
    if provider == "gemini":
        return AsyncOpenAI(
            api_key=api_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        ), (model or DEFAULT_GEMINI_MODEL)
    elif provider == "groq":
        return AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.groq.com/openai/v1",
        ), (model or DEFAULT_GROQ_MODEL)
    else:  # local / ollama
        return AsyncOpenAI(
            api_key="not-needed",
            base_url="http://localhost:11434/v1",
        ), (model or DEFAULT_LOCAL_MODEL)


SQL_PROMPT = """You are Verbis, an expert database assistant.
Convert natural language questions into precise, optimized SQL.
Rules:
1. Use ONLY tables and columns present in the provided schema.
2. Always add LIMIT unless the user explicitly asks for all rows.
3. Add brief SQL comments for complex joins or subqueries.
4. If the question is ambiguous, ask a clarifying question instead of guessing.
5. Write SQL that is valid for the specified dialect. Use that dialect's catalog
   and metadata facilities (e.g. SQLite: sqlite_master/sqlite_schema; PostgreSQL:
   information_schema/pg_catalog; MySQL: information_schema; SQL Server:
   INFORMATION_SCHEMA/sys). Never use another dialect's catalog tables.
6. Return ONLY the SQL. No markdown fences. No explanation unless asked."""


async def generate_sql(
    nl_query: str,
    schema_context: str,
    dialect: str = "postgresql",
    provider: str = "gemini",
    api_key: str = "",
    model: Optional[str] = None,
) -> str:
    client, model = _get_client(provider, api_key, model)
    r = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SQL_PROMPT},
            {"role": "user", "content": (
                f"Dialect: {dialect}\nSchema:\n{schema_context}\n\nQuestion: {nl_query}\n\nSQL:"
            )},
        ],
        temperature=0.1,
        max_tokens=2048,
    )
    return r.choices[0].message.content.strip()


async def generate_nosql(
    nl_query: str,
    schema_context: str,
    provider: str = "gemini",
    api_key: str = "",
    model: Optional[str] = None,
) -> str:
    client, model = _get_client(provider, api_key, model)
    r = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content":
                "Convert natural language to a MongoDB query or aggregation pipeline. "
                "Return only valid JSON. No markdown."},
            {"role": "user", "content":
                f"Schema:\n{schema_context}\n\nQuestion: {nl_query}\n\nQuery:"},
        ],
        temperature=0.1,
        max_tokens=2048,
    )
    return r.choices[0].message.content.strip()


async def explain_plan(
    sql: str,
    execution_plan: str,
    provider: str = "gemini",
    api_key: str = "",
    model: Optional[str] = None,
) -> str:
    client, model = _get_client(provider, api_key, model)
    r = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content":
                "Translate this database execution plan into plain English. "
                "Identify the most expensive step. Suggest one concrete improvement."},
            {"role": "user", "content": f"SQL:\n{sql}\n\nPlan:\n{execution_plan}"},
        ],
        temperature=0.2,
        max_tokens=1024,
    )
    return r.choices[0].message.content.strip()


async def generate_narrative(
    results_summary: str,
    user_query: str,
    provider: str = "gemini",
    api_key: str = "",
    model: Optional[str] = None,
) -> str:
    client, model = _get_client(provider, api_key, model)
    r = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content":
                "You are a data analyst. Summarize query results into a clear narrative. "
                "State the top 3 findings, any anomalies, and one actionable recommendation."},
            {"role": "user", "content":
                f"Question: {user_query}\n\nResults:\n{results_summary}\n\nNarrative:"},
        ],
        temperature=0.4,
        max_tokens=1024,
    )
    return r.choices[0].message.content.strip()


# ─── LLMRouter — class-based API used via dependency injection ───────────
# Imported by api/dependencies.py and services/{sql_generator,nosql_generator,
# narrative_service,plan_explainer,federated_service}. Without this class the
# backend crashes at import time with:
#   ImportError: cannot import name 'LLMRouter' from 'services.llm_service'


@dataclass
class LLMResponse:
    """Result of a single LLM completion call."""
    text: str
    error: str
    mode: str  # 'cloud' | 'local'


class LLMRouter:
    """Routes completion requests to a cloud provider or a local model.

    Constructed once at startup with the app Settings. The API key is NOT
    stored — it is supplied per-call by the extension (thread-local override)
    or falls back to settings.cloud_api_key / QM_CLOUD_API_KEY env var.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._local = threading.local()

    def set_api_key(self, api_key: str, provider: str = '', model: str = '') -> None:
        """Set the request-scoped API key (called by route handlers).

        `model` is the optional user-configured model override forwarded from
        the extension; when blank the provider default is used.
        """
        self._local.api_key = api_key
        if provider:
            self._local.provider = provider
        if model:
            self._local.model = model

    def _resolve(self, use_cloud: bool) -> tuple[AsyncOpenAI, str, str]:
        """Pick client/model/mode based on settings + per-call overrides."""
        api_key = getattr(self._local, 'api_key', '') or self._settings.cloud_api_key
        provider = getattr(self._local, 'provider', '') or ''
        model_override = getattr(self._local, 'model', '') or None

        if not use_cloud or self._settings.llm_mode == 'local':
            client, model = _get_client('local', '', model_override)
            return client, model, 'local'

        if provider:
            client, model = _get_client(provider, api_key, model_override)
            return client, model, 'cloud'

        # Cloud mode via settings (generic OpenAI-compatible endpoint)
        if api_key:
            return (
                AsyncOpenAI(api_key=api_key, base_url=self._settings.cloud_endpoint),
                self._settings.cloud_model,
                'cloud',
            )

        # llm_mode == 'auto' with no key → fall back to local
        client, model = _get_client('local', '')
        return client, model, 'local'

    async def complete(
        self,
        system: str,
        user: str,
        use_cloud: bool = True,
        temperature: float = 0.1,
        max_tokens: int = 2048,
    ) -> LLMResponse:
        """Single chat completion. Never raises — errors land in .error."""
        client, model, mode = self._resolve(use_cloud)
        try:
            r = await client.chat.completions.create(
                model=model,
                messages=[
                    {'role': 'system', 'content': system},
                    {'role': 'user', 'content': user},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return LLMResponse(text=(r.choices[0].message.content or '').strip(),
                               error='', mode=mode)
        except Exception as exc:  # network, auth, model missing, …
            return LLMResponse(text='', error=str(exc), mode=mode)
