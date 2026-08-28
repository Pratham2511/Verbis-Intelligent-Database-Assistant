import { BackendClient } from '../services/BackendClient';
import { SecretsService } from '../services/SecretsService';
import { WorkspaceService } from '../services/WorkspaceService';
import { ExecutionResult } from '../types';
export interface AssistantReply {
    kind: 'sql' | 'message' | 'offtopic' | 'error' | 'cancelled';
    /** Generated SQL, when kind === 'sql'. */
    sql?: string;
    /** Plain-English explanation from the backend. */
    explanation?: string;
    /** 0.0 – 1.0 confidence from the backend. */
    confidence?: number;
    /** Alternative interpretations, if the backend produced any. */
    alternatives?: Array<{
        sql: string;
        interpretation: string;
        confidence: number;
    }>;
    /** Clarifying questions when the request is ambiguous. */
    ambiguityQuestions?: Array<{
        id: string;
        question: string;
        options: string[];
    }>;
    /** Human-readable message for kind === 'message' | 'error'. */
    message?: string;
    /** True when the reply was produced while cancellation was requested. */
    wasCancelled?: boolean;
}
export interface ExecuteOutcome {
    kind: 'result' | 'error' | 'cancelled';
    result?: ExecutionResult;
    message?: string;
}
interface HistoryEntry {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}
/**
 * One conversational session. A new instance is created per terminal (or per
 * explicit /reset). Conversation context is preserved server-side via the
 * stable `sessionId`; this class mirrors a lightweight local transcript for
 * /history and display purposes only.
 */
/** Where the API key used for this session came from. */
export type CredentialSource = 'configured' | 'session' | 'unset';
export declare class AssistantSession {
    private readonly getClient;
    private readonly secrets;
    private readonly workspace;
    private sessionId;
    private history;
    /** The most recent user question — used to label persisted query history. */
    private lastUserQuestion;
    /** Connection this conversation is bound to (for restore + history context). */
    private activeConnectionId;
    private busy;
    private abortController;
    /**
     * Session-scoped API key, held ONLY in memory. Never written to
     * SecretStorage or disk. Set when the user explicitly chooses "use a
     * different key for this session"; discarded on /reset, /exit, terminal
     * close, and window reload.
     */
    private sessionApiKey;
    private credentialSource;
    /** True once the user has made (or skipped) the explicit key-source choice. */
    private credentialChoiceMade;
    /** True once we've warned about an explicitly-configured retired model. */
    private retiredModelWarned;
    /**
     * Gemini models Google has retired for new users. Kept in sync with the
     * backend's RETIRED_GEMINI_MODELS. Used only to show a helpful warning —
     * we NEVER overwrite the user's setting.
     */
    private static readonly RETIRED_GEMINI_MODELS;
    constructor(getClient: () => BackendClient | null, secrets: SecretsService, workspace: WorkspaceService);
    private static newSessionId;
    /** Stable id for this conversation — forwarded to the backend on every turn. */
    get id(): string;
    /** True while a backend request is in flight. */
    get isBusy(): boolean;
    /** Read-only view of the local transcript (for /history). */
    get transcript(): ReadonlyArray<HistoryEntry>;
    /** Active LLM provider label (from settings), for display. */
    get providerLabel(): string;
    /**
     * Resolve the model to send to the backend for the active provider.
     * Reads the user-configured `verbis.llm.geminiModel` / `verbis.llm.groqModel`
     * setting. Returns undefined for the local provider (backend uses its own
     * default) or when the setting is blank — the backend then applies its
     * current default. This is what actually reaches the LLM API.
     */
    private resolveModel;
    /**
     * Migration-safe handling for users who EXPLICITLY set a now-retired Gemini
     * model. We detect an explicit user/workspace setting (not the default) and
     * show ONE clear, actionable warning. We never modify or overwrite the
     * setting — the user stays in control. The backend will also reject the
     * retired model with a descriptive 400 if the request is still sent.
     */
    private warnIfRetiredGeminiModel;
    /** Human-readable credential source for /status — never reveals the key. */
    get credentialSourceLabel(): string;
    /**
     * Resolve the API key for this turn. A session-specific key (if the user
     * set one) takes precedence over the configured key; otherwise the
     * configured key from SecretStorage is used.
     */
    private resolveApiKey;
    /**
     * Explicit API-key source choice (P2). Runs once per session, before the
     * first backend request. If a configured key exists, the user must choose
     * how to authenticate — Verbis never silently consumes a stored key.
     *
     * Returns true when a usable credential is available; false when the user
     * cancelled or no key exists (caller should surface the returned message).
     */
    ensureCredentialChoice(): Promise<{
        ok: boolean;
        message?: string;
    }>;
    /**
     * Submit one natural-language turn. Routes through the EXISTING
     * BackendClient.generate() pipeline — no SQL logic lives here.
     *
     * Throws nothing; all failure modes are folded into the returned reply so
     * the REPL can keep running.
     */
    ask(nlInput: string): Promise<AssistantReply>;
    /**
     * Execute SQL through the EXISTING BackendClient.execute() path. This is a
     * distinct, explicit action — generation never implies execution.
     */
    execute(sql: string): Promise<ExecuteOutcome>;
    /** Request cancellation of the in-flight operation. */
    cancel(): void;
    /**
     * Start a fresh conversation (new session id, cleared local transcript).
     * Also discards any session-specific API key and resets the credential
     * choice, so the next session re-prompts for the key source.
     */
    /**
     * Start a NEW conversation. The current conversation is archived (persisted
     * under its own id) so it remains resumable — /reset never deletes prior
     * chat history. A fresh session id is generated for the new thread.
     */
    reset(): void;
    /**
     * Persist the full transcript into the active conversation. Fire-and-forget:
     * failures are swallowed so a disk hiccup never breaks the chat flow.
     * Writing the whole array (rather than appending) keeps the operation
     * atomic and avoids read-modify-write races between rapid turns.
     */
    private persistTurn;
    /**
     * Restore the active persisted conversation into the local transcript and
     * adopt its session id so the backend keeps conversational continuity.
     * Returns the number of turns restored (0 when none). Fail-safe: any read
     * error yields an empty transcript rather than throwing.
     */
    restoreLastSession(): Promise<number>;
    /**
     * Discard the session-specific API key (if any) and reset the credential
     * choice. Called on /reset, /exit, terminal close, and window reload so a
     * session-only key never outlives its session.
     */
    discardSessionKey(): void;
    private resolveActiveConnectionId;
    /** Human-readable connection name for history context (never secrets). */
    private resolveConnectionName;
    /**
     * @deprecated `/clear` only clears the visible screen now — it must NOT
     * delete persisted conversation history. Retained as a no-op for backward
     * compatibility with the terminal's /clear handler.
     */
    clearPersistedSession(): Promise<void>;
    private static describeError;
}
export {};
