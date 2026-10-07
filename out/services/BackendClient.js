"use strict";
// ============================================================================
// BackendClient — HTTP client for the Python FastAPI backend
// src/services/BackendClient.ts
//
// All requests use AbortController (90s end-to-end timeout per Part 9).
// Errors are translated into a typed BackendClientError so callers can
// distinguish 401 (invalid key), 429 (rate limit), 5xx, and network errors.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackendClient = exports.BackendClientError = void 0;
class BackendClientError extends Error {
    kind;
    statusCode;
    constructor(message, kind, statusCode) {
        super(message);
        this.kind = kind;
        this.statusCode = statusCode;
        this.name = 'BackendClientError';
    }
}
exports.BackendClientError = BackendClientError;
class BackendClient {
    baseUrl;
    defaultTimeoutMs;
    token;
    constructor(baseUrl, // e.g., http://127.0.0.1:8765
    defaultTimeoutMs = 90_000, token) {
        this.baseUrl = baseUrl;
        this.defaultTimeoutMs = defaultTimeoutMs;
        this.token = token;
    }
    // ─── Health Check ────────────────────────────────────────────────────
    async health() {
        return this.requestJson('/api/health', 'GET', undefined, undefined, 1500);
    }
    // ── Intent cache invalidation (Fix B) ──────────────────────────────
    async clearIntentCache() {
        return this.requestJson('/api/intent/cache/clear', 'POST');
    }
    // ── Text2Schema (Novel #4 — arXiv 2503.23886) ──────────────────────
    async createSchema(payload, signal) {
        return this.requestJson('/api/schema/create', 'POST', {
            description: payload.description,
            dialect: payload.dialect,
            provider: payload.provider,
            api_key: payload.apiKey,
            model: payload.model,
        }, signal);
    }
    async refineSchema(payload, signal) {
        return this.requestJson('/api/schema/refine', 'POST', {
            existing_schema: payload.schema,
            refinement: payload.refinement,
            dialect: payload.dialect,
            provider: payload.provider,
            api_key: payload.apiKey,
            model: payload.model,
        }, signal);
    }
    // ── Schema refresh after DDL (Fix C + Fix F) ────────────────────────
    // Forces schema.py to delete stale schema_cache.json and re-index ChromaDB.
    // Called after SCHEMA_EXECUTE creates new tables. POST endpoint (not GET).
    async refreshSchema(dbConfigId) {
        return this.requestJson('/api/schema/refresh', 'POST', {
            db_config_id: dbConfigId,
        });
    }
    // ─── NL → SQL/NoSQL Generation ─────────────────────────────────────────
    //
    // `api_key` and `provider` are resolved by the caller (VerbisPanel.ts)
    // via SecretsService.getActiveApiKey() and VS Code's `verbis.llm.provider`
    // setting, then forwarded to the Python backend, which uses them for the
    // actual Gemini / Groq / Ollama API call. No API key is ever stored on
    // the Python side.
    async generate(payload, signal) {
        // Translate our internal field names to the Python backend's expected
        // request body shape (per python_backend/models/requests.py).
        const backendPayload = {
            nl_query: payload.nlInput,
            privacy_enabled: payload.privacyEnabled ?? true,
            conversation: payload.conversation ?? [],
            schema_context: payload.disambiguationAnswers
                ? JSON.stringify(payload.disambiguationAnswers)
                : '',
            dialect: 'postgresql',
            query_type: 'sql',
            provider: payload.provider ?? 'gemini',
            api_key: payload.apiKey ?? '',
            model: payload.model,
            session_id: payload.sessionId,
            db_config_id: payload.dbConfigId,
        };
        // The backend returns the generated SQL under `query` (NOT `sql`), and
        // signals off-topic rejections with `offtopic: true` + `message`.
        const raw = await this.requestJson('/api/generate', 'POST', backendPayload, signal);
        return {
            validation: raw.validation, connectionId: raw.connectionId, schemaFingerprint: raw.schemaFingerprint, parameters: raw.parameters ?? {},
            sql: raw.query ?? undefined,
            confidence: raw.confidence ?? 0,
            alternatives: raw.alternatives ?? [],
            explanation: raw.explanation,
            narrative: raw.narrative,
            planExplanation: raw.planExplanation,
            ambiguityQuestions: raw.ambiguityQuestions,
            queryNodeId: raw.queryNodeId,
            offtopic: raw.offtopic,
            providerVerified: raw.providerVerified === true,
            message: raw.message,
        };
    }
    // ─── SQL Execution ──────────────────────────────────────────────────
    async execute(payload, signal) {
        // Translate to the Python backend's ExecuteRequest field names
        // (snake_case per python_backend/models/requests.py).
        return this.requestJson('/api/execute', 'POST', {
            sql: payload.sql,
            request_id: payload.requestId,
            parameters: payload.parameters ?? {},
            connection_id: payload.dbConfigId,
            row_limit: payload.rowLimit ?? 500,
            read_only: payload.readOnly,
            timeout_seconds: payload.timeoutSeconds,
        }, signal, ((payload.timeoutSeconds ?? 60) + 5) * 1000);
    }
    // ─── Schema Introspection + ChromaDB Indexing ───────────────────────
    async getSchema(dbConfigId) {
        return this.requestJson(`/api/schema?dbConfigId=${encodeURIComponent(dbConfigId)}`, 'GET');
    }
    // ─── Schema Change Impact Analysis (#9) ─────────────────────────────
    async analyzeImpact(payload) {
        return this.requestJson('/api/schema/impact', 'POST', { proposed_ddl: payload.ddl, db_config_id: payload.dbConfigId });
    }
    // ─── EvoSchema Robustness Test (#16) ────────────────────────────────
    async runRobustness(payload) {
        return this.requestJson('/api/robustness', 'POST', payload);
    }
    // ─── Business Glossary CRUD (#10) ──────────────────────────────────
    async getGlossary() {
        return this.requestJson('/api/glossary', 'GET');
    }
    async saveGlossaryTerm(term) {
        return this.requestJson('/api/glossary', 'POST', term);
    }
    async cancelExecution(requestId) {
        await this.requestJson(`/api/execute/cancel/${encodeURIComponent(requestId)}`, 'POST');
    }
    async registerConnection(connection, password, validateOnly = false) {
        await this.requestJson('/api/connections', 'POST', { connection, password, validate_only: validateOnly });
    }
    async deleteConnection(id) {
        await this.requestJson(`/api/connections/${encodeURIComponent(id)}`, 'DELETE');
    }
    async workspaceAction(action, payload) {
        return this.requestJson(`/api/workspace/${action}`, 'POST', { payload: payload ?? {} });
    }
    // ─── Shutdown ────────────────────────────────────────────────────────
    async shutdown() {
        try {
            await this.requestJson('/api/shutdown', 'DELETE', undefined, undefined, 1500);
        }
        catch {
            // Best-effort
        }
    }
    // ─── Core fetch wrapper ──────────────────────────────────────────────
    async requestJson(path, method, body, signal, timeoutMs = this.defaultTimeoutMs) {
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted)
            controller.abort();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text();
                // Extract a clean, human-readable message from the response body.
                // FastAPI errors look like {"detail":"..."} — surface the detail, not
                // the raw JSON blob, so users never see `{"detail":"Not Found"}`.
                const detail = BackendClient.extractDetail(text);
                if (res.status === 401) {
                    throw new BackendClientError(detail, 'auth', 401);
                }
                if (res.status === 429) {
                    throw new BackendClientError('Rate limited by LLM provider', 'rate_limit', 429);
                }
                if (res.status >= 500) {
                    throw new BackendClientError(`Backend error: ${detail}`, 'server', res.status);
                }
                throw new BackendClientError(`Request failed (${res.status}) on ${method} ${path}: ${detail}`, 'unknown', res.status);
            }
            return (await res.json());
        }
        catch (err) {
            if (err instanceof BackendClientError)
                throw err;
            if (err.name === 'AbortError') {
                throw new BackendClientError(signal?.aborted ? 'Request cancelled' : 'Request timed out', signal?.aborted ? 'cancelled' : 'timeout');
            }
            throw new BackendClientError(`Network error: ${err.message}`, 'network');
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        }
    }
    /**
     * Pull a clean message out of an error response body. FastAPI returns
     * {"detail":"..."} for HTTP errors and {"detail":[...]} for validation
     * errors; anything else is returned trimmed. Never returns raw JSON braces
     * for the common FastAPI shapes.
     */
    static extractDetail(text) {
        const trimmed = (text ?? '').trim();
        if (!trimmed) {
            return 'no details provided';
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
                const d = parsed.detail;
                if (typeof d === 'string') {
                    return d;
                }
                if (Array.isArray(d)) {
                    // FastAPI validation errors: [{loc, msg, type}, ...]
                    // Include location info so the user can see WHICH field failed.
                    return d
                        .map((e) => {
                        const loc = Array.isArray(e?.loc)
                            ? e.loc.join(' → ')
                            : undefined;
                        const msg = e?.msg ?? JSON.stringify(e);
                        return loc ? `${loc}: ${msg}` : msg;
                    })
                        .join('; ');
                }
                return JSON.stringify(d);
            }
        }
        catch {
            // Not JSON — fall through to the trimmed text.
        }
        return trimmed.length > 300 ? trimmed.slice(0, 297) + '…' : trimmed;
    }
}
exports.BackendClient = BackendClient;
//# sourceMappingURL=BackendClient.js.map