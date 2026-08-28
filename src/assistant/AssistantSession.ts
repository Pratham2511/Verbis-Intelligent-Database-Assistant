// ============================================================================
// Verbis — AssistantSession
// src/assistant/AssistantSession.ts
//
// UI-independent conversational agent controller. Owns one conversation's
// state (session id, history, busy flag, cancellation) and delegates ALL
// intelligence to the existing backend pipeline via BackendClient.
//
// This is the single source of truth for "what a conversation with Verbis
// means". The terminal REPL (and any future UI) drives this class; it never
// re-implements SQL generation, execution, or provider routing itself.
// ============================================================================

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { BackendClient, BackendClientError } from '../services/BackendClient';
import { SecretsService } from '../services/SecretsService';
import { WorkspaceService } from '../services/WorkspaceService';
import { ExecutionResult } from '../types';

// ─── Result types surfaced to the UI layer ────────────────────────────────

export interface AssistantReply {
  kind: 'sql' | 'message' | 'offtopic' | 'error' | 'cancelled';
  /** Generated SQL, when kind === 'sql'. */
  sql?: string;
  /** Plain-English explanation from the backend. */
  explanation?: string;
  /** 0.0 – 1.0 confidence from the backend. */
  confidence?: number;
  /** Alternative interpretations, if the backend produced any. */
  alternatives?: Array<{ sql: string; interpretation: string; confidence: number }>;
  /** Clarifying questions when the request is ambiguous. */
  ambiguityQuestions?: Array<{ id: string; question: string; options: string[] }>;
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

export class AssistantSession {
  private sessionId: string;
  private history: HistoryEntry[] = [];
  /** The most recent user question — used to label persisted query history. */
  private lastUserQuestion = '';
  /** Connection this conversation is bound to (for restore + history context). */
  private activeConnectionId: string | undefined;
  private busy = false;
  private abortController: AbortController | null = null;

  /**
   * Session-scoped API key, held ONLY in memory. Never written to
   * SecretStorage or disk. Set when the user explicitly chooses "use a
   * different key for this session"; discarded on /reset, /exit, terminal
   * close, and window reload.
   */
  private sessionApiKey: string | null = null;
  private credentialSource: CredentialSource = 'unset';
  /** True once the user has made (or skipped) the explicit key-source choice. */
  private credentialChoiceMade = false;
  /** True once we've warned about an explicitly-configured retired model. */
  private retiredModelWarned = false;

  /**
   * Gemini models Google has retired for new users. Kept in sync with the
   * backend's RETIRED_GEMINI_MODELS. Used only to show a helpful warning —
   * we NEVER overwrite the user's setting.
   */
  private static readonly RETIRED_GEMINI_MODELS = new Set([
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-pro',
  ]);

  constructor(
    private readonly getClient: () => BackendClient | null,
    private readonly secrets: SecretsService,
    private readonly workspace: WorkspaceService,
  ) {
    this.sessionId = AssistantSession.newSessionId();
  }

  private static newSessionId(): string {
    return crypto.randomUUID();
  }

  /** Stable id for this conversation — forwarded to the backend on every turn. */
  get id(): string {
    return this.sessionId;
  }

  /** True while a backend request is in flight. */
  get isBusy(): boolean {
    return this.busy;
  }

  /** Read-only view of the local transcript (for /history). */
  get transcript(): ReadonlyArray<HistoryEntry> {
    return this.history;
  }

  /** Active LLM provider label (from settings), for display. */
  get providerLabel(): string {
    return vscode.workspace
      .getConfiguration('verbis')
      .get<string>('llm.provider', 'gemini');
  }

  /**
   * Resolve the model to send to the backend for the active provider.
   * Reads the user-configured `verbis.llm.geminiModel` / `verbis.llm.groqModel`
   * setting. Returns undefined for the local provider (backend uses its own
   * default) or when the setting is blank — the backend then applies its
   * current default. This is what actually reaches the LLM API.
   */
  private resolveModel(): string | undefined {
    const cfg = vscode.workspace.getConfiguration('verbis');
    const provider = this.providerLabel;
    if (provider === 'gemini') {
      return cfg.get<string>('llm.geminiModel', 'gemini-3.6-flash').trim() || undefined;
    }
    if (provider === 'groq') {
      return cfg.get<string>('llm.groqModel', 'llama-3.3-70b-versatile').trim() || undefined;
    }
    return undefined; // local — backend default (sqlcoder)
  }

  /**
   * Migration-safe handling for users who EXPLICITLY set a now-retired Gemini
   * model. We detect an explicit user/workspace setting (not the default) and
   * show ONE clear, actionable warning. We never modify or overwrite the
   * setting — the user stays in control. The backend will also reject the
   * retired model with a descriptive 400 if the request is still sent.
   */
  private warnIfRetiredGeminiModel(): void {
    if (this.retiredModelWarned) {
      return;
    }
    if (this.providerLabel !== 'gemini') {
      return;
    }
    const inspected = vscode.workspace
      .getConfiguration('verbis')
      .inspect<string>('llm.geminiModel');
    const explicit =
      inspected?.globalValue ?? inspected?.workspaceValue ?? inspected?.workspaceFolderValue;
    if (!explicit || !AssistantSession.RETIRED_GEMINI_MODELS.has(explicit.trim())) {
      return;
    }
    this.retiredModelWarned = true;
    const configured = explicit.trim();
    vscode.window
      .showWarningMessage(
        `Verbis: your configured Gemini model "${configured}" was retired by Google ` +
        `for new users, so requests will fail. Update the setting ` +
        `"verbis.llm.geminiModel" to "gemini-3.6-flash" (the current default) or another ` +
        `supported model.`,
        'Open Settings',
      )
      .then((choice) => {
        if (choice === 'Open Settings') {
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'verbis.llm.geminiModel',
          );
        }
      });
  }

  /** Human-readable credential source for /status — never reveals the key. */
  get credentialSourceLabel(): string {
    switch (this.credentialSource) {
      case 'configured': return 'Existing configured key';
      case 'session':    return 'Session-specific key (not saved)';
      default:           return 'Not chosen yet';
    }
  }

  /**
   * Resolve the API key for this turn. A session-specific key (if the user
   * set one) takes precedence over the configured key; otherwise the
   * configured key from SecretStorage is used.
   */
  private async resolveApiKey(): Promise<string | undefined> {
    if (this.credentialSource === 'session' && this.sessionApiKey) {
      return this.sessionApiKey;
    }
    return this.secrets.getActiveApiKey();
  }

  /**
   * Explicit API-key source choice (P2). Runs once per session, before the
   * first backend request. If a configured key exists, the user must choose
   * how to authenticate — Verbis never silently consumes a stored key.
   *
   * Returns true when a usable credential is available; false when the user
   * cancelled or no key exists (caller should surface the returned message).
   */
  async ensureCredentialChoice(): Promise<{ ok: boolean; message?: string }> {
    // Surface a one-time, non-destructive warning if the user has explicitly
    // configured a retired Gemini model. Does not block; the backend enforces.
    this.warnIfRetiredGeminiModel();

    if (this.credentialChoiceMade) {
      // Choice already made this session — just verify a key is present.
      const key = await this.resolveApiKey();
      return key
        ? { ok: true }
        : { ok: false, message: 'No API key available. Run "Verbis: Set API Key".' };
    }

    const configuredKey = await this.secrets.getActiveApiKey();
    const provider = this.providerLabel;

    if (!configuredKey) {
      // No stored key — nothing to choose between; guide the user to set one.
      this.credentialSource = 'unset';
      // Don't mark choice made: if they later set a key, we prompt then.
      return {
        ok: false,
        message: `No ${provider} API key is configured. Run "Verbis: Set API Key" first, then ask again.`,
      };
    }

    // A stored key exists — require an explicit, informed choice.
    const USE_EXISTING = 'Use existing configured key';
    const USE_SESSION  = 'Use a different key for this session only';
    const MANAGE       = 'Manage keys…';
    const pick = await vscode.window.showQuickPick(
      [
        { label: USE_EXISTING, description: `Use the ${provider} key stored in VS Code SecretStorage` },
        { label: USE_SESSION,  description: 'Paste a key used only for this terminal session — never saved' },
        { label: MANAGE,       description: 'Set or remove stored keys' },
      ],
      {
        title: 'Verbis: API Key Source',
        placeHolder: 'A configured API key was found. How should Verbis authenticate this session?',
        ignoreFocusOut: true,
      },
    );

    if (!pick) {
      // Cancelled — no silent consumption.
      return { ok: false, message: 'Cancelled — no API key was used. Ask again when ready.' };
    }

    if (pick.label === MANAGE) {
      await vscode.commands.executeCommand('verbis.setApiKey');
      // Re-resolve after management; treat as configured if a key now exists.
      const nowKey = await this.secrets.getActiveApiKey();
      if (nowKey) {
        this.credentialSource = 'configured';
        this.credentialChoiceMade = true;
        return { ok: true };
      }
      return { ok: false, message: 'No API key configured. Run "Verbis: Set API Key".' };
    }

    if (pick.label === USE_SESSION) {
      const key = await vscode.window.showInputBox({
        title: `Verbis — Session-only ${provider} API Key`,
        prompt: 'This key is kept in memory for this terminal session only and is never saved.',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'Paste your API key',
        validateInput: (v: string) =>
          v.trim().length < 10 ? 'Key looks too short — paste the full API key' : null,
      });
      if (!key) {
        return { ok: false, message: 'Cancelled — no session key set. Ask again when ready.' };
      }
      this.sessionApiKey = key.trim();
      this.credentialSource = 'session';
      this.credentialChoiceMade = true;
      return { ok: true };
    }

    // USE_EXISTING
    this.credentialSource = 'configured';
    this.credentialChoiceMade = true;
    return { ok: true };
  }

  /**
   * Submit one natural-language turn. Routes through the EXISTING
   * BackendClient.generate() pipeline — no SQL logic lives here.
   *
   * Throws nothing; all failure modes are folded into the returned reply so
   * the REPL can keep running.
   */
  async ask(nlInput: string): Promise<AssistantReply> {
    if (this.busy) {
      return { kind: 'message', message: 'Still working on the previous request. Use /cancel or wait.' };
    }
    const client = this.getClient();
    if (!client) {
      return { kind: 'error', message: 'Backend is not running. Start it with "Verbis: Restart Python Backend".' };
    }

    // Explicit credential-source choice (P2) — never silently consume a key.
    const cred = await this.ensureCredentialChoice();
    if (!cred.ok) {
      return { kind: 'message', message: cred.message ?? 'No API key available.' };
    }

    this.busy = true;
    this.abortController = new AbortController();
    this.lastUserQuestion = nlInput;
    this.history.push({ role: 'user', content: nlInput, timestamp: Date.now() });
    this.persistTurn('user', nlInput);

    try {
      const provider = this.providerLabel;
      const apiKey = await this.resolveApiKey();
      const model = this.resolveModel();
      const dbConfigId = await this.resolveActiveConnectionId();

      const res = await client.generate({
        nlInput,
        dbConfigId: dbConfigId ?? 'default',
        sessionId: this.sessionId,
        apiKey,
        provider,
        model,
      });

      if (this.abortController.signal.aborted) {
        return { kind: 'cancelled', message: 'Request cancelled.', wasCancelled: true };
      }

      // Scope restriction: the intent guard rejected this as off-topic.
      // Surface the polite refusal — never as a fake SQL success, and never
      // touch the previously stored executable SQL.
      if (res.offtopic) {
        const msg = res.message
          ?? "I'm Verbis — a database assistant. I can only help with database/SQL questions.";
        this.history.push({ role: 'assistant', content: msg, timestamp: Date.now() });
        this.persistTurn('assistant', msg);
        return { kind: 'offtopic', message: msg };
      }

      // Ambiguity: backend wants clarification before producing SQL.
      if (res.ambiguityQuestions && res.ambiguityQuestions.length > 0) {
        const msg = res.ambiguityQuestions
          .map((q, i) => `${i + 1}. ${q.question}\n   Options: ${q.options.join(' | ')}`)
          .join('\n');
        this.history.push({ role: 'assistant', content: msg, timestamp: Date.now() });
        this.persistTurn('assistant', msg);
        return {
          kind: 'message',
          message: `I need clarification:\n${msg}\n\nAnswer and re-ask, or /cancel.`,
          ambiguityQuestions: res.ambiguityQuestions,
        };
      }

      // Informational / explanatory response with no executable SQL.
      // Display it as a message — do NOT pretend SQL is ready to run.
      if (!res.sql) {
        const msg = res.explanation ?? res.message ?? '(no SQL generated)';
        this.history.push({ role: 'assistant', content: msg, timestamp: Date.now() });
        this.persistTurn('assistant', msg);
        return { kind: 'message', message: msg };
      }

      // Real SQL was generated.
      const confidencePct = Math.round((res.confidence ?? 0) * 100);
      this.history.push({
        role: 'assistant',
        content: res.sql,
        timestamp: Date.now(),
      });
      this.persistTurn('assistant', res.sql);

      return {
        kind: 'sql',
        sql: res.sql,
        explanation: res.explanation,
        confidence: res.confidence,
        alternatives: res.alternatives,
        message: `Confidence: ${confidencePct}%`,
      };
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        return { kind: 'cancelled', message: 'Request cancelled.', wasCancelled: true };
      }
      return { kind: 'error', message: AssistantSession.describeError(err) };
    } finally {
      this.busy = false;
      this.abortController = null;
    }
  }

  /**
   * Execute SQL through the EXISTING BackendClient.execute() path. This is a
   * distinct, explicit action — generation never implies execution.
   */
  async execute(sql: string): Promise<ExecuteOutcome> {
    if (this.busy) {
      return { kind: 'error', message: 'Busy — wait for the current request.' };
    }
    const client = this.getClient();
    if (!client) {
      return { kind: 'error', message: 'Backend is not running.' };
    }

    this.busy = true;
    this.abortController = new AbortController();
    try {
      const dbConfigId = await this.resolveActiveConnectionId();
      if (!dbConfigId) {
        return { kind: 'error', message: 'No active database connection. Add one from the Verbis sidebar.' };
      }
      // Read execution settings fresh on every /run so changes take effect
      // immediately without a backend restart.
      const verbisCfg = vscode.workspace.getConfiguration('verbis');
      const rowLimit = verbisCfg.get<number>('query.rowLimit', 500);
      const readOnly = verbisCfg.get<boolean>('execution.readOnlyByDefault', true);
      const timeoutSeconds = verbisCfg.get<number>('execution.timeoutSeconds', 60);

      const result = await client.execute({ sql, dbConfigId, rowLimit, readOnly, timeoutSeconds });

      if (this.abortController.signal.aborted) {
        return { kind: 'cancelled', message: 'Execution cancelled.' };
      }

      // Resolve connection context for Recent Queries (never secrets).
      const connName = await this.resolveConnectionName(dbConfigId);

      // Persist to history via the existing workspace service. Use the real
      // user question (not a placeholder) so Recent Queries is meaningful.
      await this.workspace.appendHistory({
        id: crypto.randomUUID(),
        nlInput: this.lastUserQuestion || '(query)',
        sql,
        timestamp: Date.now(),
        success: true,
        executionTimeMs: result.executionTimeMs,
        rowCount: result.rowCount,
        connectionId: dbConfigId,
        connectionName: connName,
      });

      // Persist a concise execution summary as an assistant turn so the
      // restored conversation reflects what actually ran (no row data, so no
      // sensitive values are stored).
      const summary = `✓ Executed (${result.executionTimeMs}ms, ${result.rowCount} row${result.rowCount === 1 ? '' : 's'})`;
      this.history.push({ role: 'assistant', content: summary, timestamp: Date.now() });
      this.persistTurn('assistant', summary);

      return { kind: 'result', result };
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        return { kind: 'cancelled', message: 'Execution cancelled.' };
      }
      return { kind: 'error', message: AssistantSession.describeError(err) };
    } finally {
      this.busy = false;
      this.abortController = null;
    }
  }

  /** Request cancellation of the in-flight operation. */
  cancel(): void {
    this.abortController?.abort();
  }

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
  reset(): void {
    this.cancel();
    // Archive the current conversation before switching to a new id.
    if (this.history.length > 0) {
      const turns = this.history.map(h => ({
        role: h.role,
        content: h.content,
        timestamp: h.timestamp,
      }));
      void this.workspace
        .upsertConversation(this.sessionId, turns, { connectionId: this.activeConnectionId })
        .catch(() => { /* best-effort */ });
    }
    this.sessionId = AssistantSession.newSessionId();
    this.history = [];
    this.lastUserQuestion = '';
    this.activeConnectionId = undefined;
    this.busy = false;
    this.discardSessionKey();
    // Point the active pointer at the new (empty) conversation.
    void this.workspace.setActiveConversation(this.sessionId).catch(() => { /* best-effort */ });
  }

  /**
   * Persist the full transcript into the active conversation. Fire-and-forget:
   * failures are swallowed so a disk hiccup never breaks the chat flow.
   * Writing the whole array (rather than appending) keeps the operation
   * atomic and avoids read-modify-write races between rapid turns.
   */
  private persistTurn(_role: 'user' | 'assistant', _content: string): void {
    const turns = this.history.map(h => ({
      role: h.role,
      content: h.content,
      timestamp: h.timestamp,
    }));
    void this.workspace
      .upsertConversation(this.sessionId, turns, {
        connectionId: this.activeConnectionId,
      })
      .catch(() => {
        /* fail-safe: persistence is best-effort */
      });
  }

  /**
   * Restore the active persisted conversation into the local transcript and
   * adopt its session id so the backend keeps conversational continuity.
   * Returns the number of turns restored (0 when none). Fail-safe: any read
   * error yields an empty transcript rather than throwing.
   */
  async restoreLastSession(): Promise<number> {
    try {
      const conv = await this.workspace.getActiveConversation();
      if (!conv || !Array.isArray(conv.turns) || conv.turns.length === 0) return 0;
      // Adopt the persisted session id so the backend continues this thread.
      this.sessionId = conv.id;
      this.activeConnectionId = conv.connectionId;
      this.history = conv.turns.map(t => ({
        role: t.role,
        content: t.content,
        timestamp: t.timestamp,
      }));
      // Seed lastUserQuestion from the most recent user turn so a follow-up
      // /run is labelled correctly.
      const lastUser = [...conv.turns].reverse().find(t => t.role === 'user');
      this.lastUserQuestion = lastUser?.content ?? '';
      return conv.turns.length;
    } catch {
      return 0;
    }
  }

  /**
   * Discard the session-specific API key (if any) and reset the credential
   * choice. Called on /reset, /exit, terminal close, and window reload so a
   * session-only key never outlives its session.
   */
  discardSessionKey(): void {
    this.sessionApiKey = null;
    this.credentialSource = 'unset';
    this.credentialChoiceMade = false;
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async resolveActiveConnectionId(): Promise<string | undefined> {
    // Prefer the connection this conversation is bound to (restored or set).
    if (this.activeConnectionId) return this.activeConnectionId;
    const config = await this.workspace.readConfig();
    // The workspace config has no explicit "active" pointer; the most recently
    // added connection is treated as active, consistent with the sidebar.
    const id = config.connections[config.connections.length - 1]?.id;
    this.activeConnectionId = id;
    return id;
  }

  /** Human-readable connection name for history context (never secrets). */
  private async resolveConnectionName(id: string): Promise<string | undefined> {
    try {
      const config = await this.workspace.readConfig();
      return config.connections.find(c => c.id === id)?.name;
    } catch {
      return undefined;
    }
  }

  /**
   * @deprecated `/clear` only clears the visible screen now — it must NOT
   * delete persisted conversation history. Retained as a no-op for backward
   * compatibility with the terminal's /clear handler.
   */
  async clearPersistedSession(): Promise<void> {
    /* no-op: /clear is screen-only; history is preserved */
  }

  private static describeError(err: unknown): string {
    if (err instanceof BackendClientError) {
      switch (err.kind) {
        case 'auth':       return 'Invalid API key. Run "Verbis: Set API Key".';
        case 'rate_limit': return 'Rate limited by the LLM provider. Wait a moment and retry.';
        case 'timeout':    return 'The backend took too long to respond. Try a simpler question.';
        case 'network':    return 'Could not reach the backend. Is it running? Try "Verbis: Restart Python Backend".';
        case 'server':     return err.message; // already cleaned by extractDetail
        default:           return err.message; // 404 + other: cleaned by extractDetail
      }
    }
    return err instanceof Error ? err.message : String(err);
  }
}
