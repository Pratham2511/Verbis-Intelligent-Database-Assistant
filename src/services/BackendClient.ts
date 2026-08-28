// ============================================================================
// BackendClient — HTTP client for the Python FastAPI backend
// src/services/BackendClient.ts
//
// All requests use AbortController (90s end-to-end timeout per Part 9).
// Errors are translated into a typed BackendClientError so callers can
// distinguish 401 (invalid key), 429 (rate limit), 5xx, and network errors.
// ============================================================================

// Uses Node's built-in global fetch (VS Code 1.85+ extension host = Node 18+).
// Keep this extension dependency-free: node-fetch@3 is ESM-only and cannot be
// required from the CommonJS out/ bundle.
import {
  ChatMessage,
  ExecutionResult,
  SchemaInfo,
  SchemaChangeImpact,
  RobustnessReport,
  GlossaryTerm,
  BackendStatus,
} from '../types';

export class BackendClientError extends Error {
  constructor(
    message: string,
    public readonly kind: 'timeout' | 'auth' | 'rate_limit' | 'network' | 'server' | 'unknown',
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'BackendClientError';
  }
}

export class BackendClient {
  constructor(
    private readonly baseUrl: string,        // e.g., http://127.0.0.1:8765
    private readonly defaultTimeoutMs: number = 90_000
  ) {}

  // ─── Health Check ────────────────────────────────────────────────────
  async health(): Promise<{ status: string; version: string }> {
    return this.requestJson('/api/health', 'GET');
  }

  // ── Intent cache invalidation (Fix B) ──────────────────────────────
  async clearIntentCache(): Promise<{ status: string }> {
    return this.requestJson('/api/intent/cache/clear', 'POST');
  }

  // ── Text2Schema (Novel #4 — arXiv 2503.23886) ──────────────────────
  async createSchema(payload: {
    description: string;
    dialect: string;
    provider: string;
    apiKey: string;
    model?: string;
  }): Promise<{ schema: unknown; ddl: string; mermaid: string; table_count: number }> {
    return this.requestJson('/api/schema/create', 'POST', {
      description: payload.description,
      dialect: payload.dialect,
      provider: payload.provider,
      api_key: payload.apiKey,
      model: payload.model,
    });
  }

  async refineSchema(payload: {
    schema: unknown;
    refinement: string;
    dialect: string;
    provider: string;
    apiKey: string;
    model?: string;
  }): Promise<{ schema: unknown; ddl: string; mermaid: string; table_count: number }> {
    return this.requestJson('/api/schema/refine', 'POST', {
      existing_schema: payload.schema,
      refinement: payload.refinement,
      dialect: payload.dialect,
      provider: payload.provider,
      api_key: payload.apiKey,
      model: payload.model,
    });
  }

  // ── Schema refresh after DDL (Fix C + Fix F) ────────────────────────
  // Forces schema.py to delete stale schema_cache.json and re-index ChromaDB.
  // Called after SCHEMA_EXECUTE creates new tables. POST endpoint (not GET).
  async refreshSchema(dbConfigId: string): Promise<{ tables: unknown[]; indexed: boolean }> {
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
  async generate(payload: {
    nlInput: string;
    dbConfigId: string;
    sessionId: string;
    llmMode?: 'cloud' | 'local' | 'auto';
    disambiguationAnswers?: Record<string, string>;
    apiKey?: string;     // resolved from SecretStorage by caller
    provider?: string;   // 'gemini' | 'groq' | 'local' — from verbis.llm.provider
    model?: string;      // user-configured model — from verbis.llm.geminiModel / groqModel
  }): Promise<{
    /** Generated SQL, normalized from the backend's `query` field. Undefined when off-topic. */
    sql?: string;
    confidence: number;
    alternatives: Array<{ sql: string; interpretation: string; confidence: number }>;
    explanation?: string;
    narrative?: string;
    planExplanation?: string;
    ambiguityQuestions?: Array<{ id: string; question: string; options: string[] }>;
    queryNodeId?: string;
    /** True when the intent guard rejected the request as off-topic. */
    offtopic?: boolean;
    /** Polite off-topic / informational message from the backend. */
    message?: string;
  }> {
    // Translate our internal field names to the Python backend's expected
    // request body shape (per python_backend/models/requests.py).
    const backendPayload = {
      nl_query: payload.nlInput,
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
    const raw = await this.requestJson<{
      query?: string | null;
      confidence?: number;
      alternatives?: Array<{ sql: string; interpretation: string; confidence: number }>;
      explanation?: string;
      narrative?: string;
      planExplanation?: string;
      ambiguityQuestions?: Array<{ id: string; question: string; options: string[] }>;
      queryNodeId?: string;
      offtopic?: boolean;
      message?: string;
    }>('/api/generate', 'POST', backendPayload);

    return {
      sql: raw.query ?? undefined,
      confidence: raw.confidence ?? 0,
      alternatives: raw.alternatives ?? [],
      explanation: raw.explanation,
      narrative: raw.narrative,
      planExplanation: raw.planExplanation,
      ambiguityQuestions: raw.ambiguityQuestions,
      queryNodeId: raw.queryNodeId,
      offtopic: raw.offtopic,
      message: raw.message,
    };
  }

  // ─── SQL Execution ──────────────────────────────────────────────────
  async execute(payload: {
    sql: string;
    dbConfigId: string;
    rowLimit?: number;
    readOnly?: boolean;
    timeoutSeconds?: number;
  }): Promise<ExecutionResult> {
    // Translate to the Python backend's ExecuteRequest field names
    // (snake_case per python_backend/models/requests.py).
    return this.requestJson('/api/execute', 'POST', {
      sql: payload.sql,
      connection_id: payload.dbConfigId,
      row_limit: payload.rowLimit ?? 500,
      read_only: payload.readOnly,
      timeout_seconds: payload.timeoutSeconds,
    });
  }

  // ─── Schema Introspection + ChromaDB Indexing ───────────────────────
  async getSchema(dbConfigId: string): Promise<{ tables: SchemaInfo[]; indexed: boolean }> {
    return this.requestJson(`/api/schema?dbConfigId=${encodeURIComponent(dbConfigId)}`, 'GET');
  }

  // ─── Schema Change Impact Analysis (#9) ─────────────────────────────
  async analyzeImpact(payload: {
    ddl: string;
    dbConfigId: string;
  }): Promise<SchemaChangeImpact> {
    return this.requestJson('/api/schema/impact', 'POST', payload);
  }

  // ─── EvoSchema Robustness Test (#16) ────────────────────────────────
  async runRobustness(payload: {
    dbConfigId: string;
    querySet: Array<{ id: string; sql: string; nlInput: string }>;
  }): Promise<RobustnessReport> {
    return this.requestJson('/api/robustness', 'POST', payload);
  }

  // ─── Business Glossary CRUD (#10) ──────────────────────────────────
  async getGlossary(): Promise<{ terms: GlossaryTerm[] }> {
    return this.requestJson('/api/glossary', 'GET');
  }

  async saveGlossaryTerm(term: GlossaryTerm): Promise<{ success: boolean }> {
    return this.requestJson('/api/glossary', 'POST', term);
  }

  // ─── Shutdown ────────────────────────────────────────────────────────
  async shutdown(): Promise<void> {
    try {
      await this.requestJson('/api/shutdown', 'DELETE');
    } catch {
      // Best-effort
    }
  }

  // ─── Core fetch wrapper ──────────────────────────────────────────────
  private async requestJson<T>(path: string, method: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.defaultTimeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
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
          throw new BackendClientError('Invalid API key', 'auth', 401);
        }
        if (res.status === 429) {
          throw new BackendClientError('Rate limited by LLM provider', 'rate_limit', 429);
        }
        if (res.status === 404) {
          throw new BackendClientError(
            `The backend does not recognize this request (${method} ${path}). ` +
            'The extension and backend may be out of sync — try "Verbis: Restart Python Backend".',
            'unknown', 404,
          );
        }
        if (res.status >= 500) {
          throw new BackendClientError(`Backend error: ${detail}`, 'server', res.status);
        }
        throw new BackendClientError(
          `Request failed (${res.status}) on ${method} ${path}: ${detail}`,
          'unknown', res.status,
        );
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof BackendClientError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new BackendClientError('Request timed out', 'timeout');
      }
      throw new BackendClientError(`Network error: ${(err as Error).message}`, 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Pull a clean message out of an error response body. FastAPI returns
   * {"detail":"..."} for HTTP errors and {"detail":[...]} for validation
   * errors; anything else is returned trimmed. Never returns raw JSON braces
   * for the common FastAPI shapes.
   */
  private static extractDetail(text: string): string {
    const trimmed = (text ?? '').trim();
    if (!trimmed) { return 'no details provided'; }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
        const d = (parsed as { detail: unknown }).detail;
        if (typeof d === 'string') { return d; }
        if (Array.isArray(d)) {
          // FastAPI validation errors: [{loc, msg, type}, ...]
          // Include location info so the user can see WHICH field failed.
          return d
            .map((e: any) => {
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
    } catch {
      // Not JSON — fall through to the trimmed text.
    }
    return trimmed.length > 300 ? trimmed.slice(0, 297) + '…' : trimmed;
  }
}
