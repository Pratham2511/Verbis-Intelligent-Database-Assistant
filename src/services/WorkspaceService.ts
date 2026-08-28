// ============================================================================
// WorkspaceService — .qmind/ file I/O wrapper
// src/services/WorkspaceService.ts
//
// Implements Novel Contribution #8 (Project-Scoped Persistent Workspaces).
// All .qmind/ files are written atomically (write-tmp + rename) to prevent
// corruption if VS Code crashes mid-write.
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  DBConfig,
  SchemaInfo,
  MemoryStore,
  QueryTree,
  Annotation,
  GlossaryTerm,
  PerfLogEntry,
} from '../types';

const QMIND_DIR = '.qmind';
const SESSIONS_FILE = 'sessions.json';
/** Max retained conversations and turns-per-conversation (bounded growth). */
const MAX_SESSIONS = 50;
const MAX_TURNS = 200;

/** A single chat turn within a persisted conversation. */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Generated SQL, when this assistant turn produced any. */
  sql?: string;
}

/** A named, resumable conversation. */
export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  connectionId?: string;
  turns: ConversationTurn[];
}

/** The on-disk multi-conversation store (.qmind/sessions.json). */
export interface ConversationStore {
  version: number;
  activeSessionId: string | null;
  sessions: Conversation[];
  /** Set once legacy per-date transcripts have been folded in. */
  migratedFromLegacy?: boolean;
}

/** Derive a short human title from the first user message. */
function makeTitle(seed: string): string {
  const clean = seed.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Conversation';
  return clean.length <= 40 ? clean : clean.slice(0, 39) + '…';
}

export class WorkspaceService {
  private qmindPath: string;

  /**
   * Fired whenever persisted query history or conversations change, so UI
   * providers (Recent Queries, etc.) can refresh immediately without a reload.
   */
  private static readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Subscribe to persistence changes (history + conversations). */
  static get onDidChangeData(): vscode.Event<void> {
    return WorkspaceService.changeEmitter.event;
  }
  /** Notify listeners that persisted data changed. */
  static notifyDataChanged(): void {
    WorkspaceService.changeEmitter.fire();
  }

  constructor(
    private readonly workspaceRoot: string,
    /** Extension's python_backend dir — used to detect legacy SQLite files. */
    private readonly extensionBackendDir?: string,
  ) {
    this.qmindPath = path.join(workspaceRoot, QMIND_DIR);
    this.ensureStructure();
  }

  // ─── Directory Initialization ─────────────────────────────────────
  private ensureStructure(): void {
    const subdirs = ['sessions', 'databases'];
    try {
      if (!fs.existsSync(this.qmindPath)) {
        fs.mkdirSync(this.qmindPath, { recursive: true });
      }
      for (const sub of subdirs) {
        const p = path.join(this.qmindPath, sub);
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
      }
    } catch (err) {
      vscode.window.showWarningMessage(
        `Verbis: Could not initialize .qmind/ at ${this.qmindPath}: ${(err as Error).message}`
      );
    }
  }

  // ─── Atomic JSON read/write helpers ────────────────────────────────
  private async readJson<T>(file: string, fallback: T): Promise<T> {
    const fp = path.join(this.qmindPath, file);
    try {
      const raw = await fs.promises.readFile(fp, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJson<T>(file: string, data: T): Promise<void> {
    const fp = path.join(this.qmindPath, file);
    const tmp = `${fp}.tmp`;
    const content = JSON.stringify(data, null, 2);
    await fs.promises.writeFile(tmp, content, 'utf8');
    await fs.promises.rename(tmp, fp); // atomic on POSIX
  }

  // ─── config.json ───────────────────────────────────────────────────
  async readConfig(): Promise<{
    connections: DBConfig[];
    backendPort?: number;
    llm: { mode: string; cloudEndpoint?: string; cloudModel?: string; localModel?: string };
    rowLimit: number;
    timeoutSeconds: number;
    readOnlyByDefault: boolean;
  }> {
    return this.readJson('config.json', {
      connections: [],
      llm: { mode: 'auto' },
      rowLimit: 500,
      timeoutSeconds: 60,
      readOnlyByDefault: true,
    });
  }

  async writeConfig(cfg: unknown): Promise<void> {
    await this.writeJson('config.json', cfg);
  }

  // ─── schema_cache.json ────────────────────────────────────────────
  async readSchemaCache(): Promise<SchemaInfo[]> {
    return this.readJson<SchemaInfo[]>('schema_cache.json', []);
  }

  async writeSchemaCache(schema: SchemaInfo[]): Promise<void> {
    await this.writeJson('schema_cache.json', schema);
  }

  // ─── memory.json — Adaptive Preference Memory (#1) + Disambiguation (#7)
  async readMemory(): Promise<MemoryStore> {
    return this.readJson<MemoryStore>('memory.json', {
      domainVocabulary: {},
      preferredPatterns: [],
      disambiguationRules: {},
      sqlCorrectionHistory: [],
      lastUpdated: Date.now(),
    });
  }

  async writeMemory(memory: MemoryStore): Promise<void> {
    memory.lastUpdated = Date.now();
    await this.writeJson('memory.json', memory);
  }

  // ─── history.json — Query Genealogy (#3) ───────────────────────────
  async readHistory(): Promise<Array<{
    id: string;
    timestamp: number;
    nlInput: string;
    sql: string;
    success: boolean;
    executionTimeMs?: number;
    rowCount?: number;
    connectionId?: string;
    connectionName?: string;
  }>> {
    return this.readJson('history.json', []);
  }

  async appendHistory(entry: {
    id: string;
    timestamp: number;
    nlInput: string;
    sql: string;
    success: boolean;
    executionTimeMs?: number;
    rowCount?: number;
    connectionId?: string;
    connectionName?: string;
  }): Promise<void> {
    const history = await this.readHistory();
    history.push(entry);
    // Keep last 5000 entries to avoid unbounded growth
    const trimmed = history.slice(-5000);
    await this.writeJson('history.json', trimmed);
    // Notify UI (Recent Queries) to refresh immediately.
    WorkspaceService.notifyDataChanged();
  }

  // ─── query_tree.json — Interactive DAG (#14) ───────────────────────
  async readQueryTree(): Promise<QueryTree> {
    return this.readJson<QueryTree>('query_tree.json', {
      nodes: {},
      rootIds: [],
      checkpoints: [],
    });
  }

  async writeQueryTree(tree: QueryTree): Promise<void> {
    await this.writeJson('query_tree.json', tree);
  }

  // ─── annotations.json — Collaborative Annotations (#15) ────────────
  async readAnnotations(): Promise<Annotation[]> {
    return this.readJson<Annotation[]>('annotations.json', []);
  }

  async writeAnnotations(annotations: Annotation[]): Promise<void> {
    await this.writeJson('annotations.json', annotations);
  }

  // ─── glossary.json — Business Glossary (#10) ───────────────────────
  async readGlossary(): Promise<{ terms: GlossaryTerm[]; joinPaths: Array<{ from: string; to: string; via: string }> }> {
    return this.readJson('glossary.json', { terms: [], joinPaths: [] });
  }

  async writeGlossary(data: { terms: GlossaryTerm[]; joinPaths: Array<{ from: string; to: string; via: string }> }): Promise<void> {
    await this.writeJson('glossary.json', data);
  }

  // ─── perf_log.json — Performance Regression Detector (#11) ─────────
  async readPerfLog(): Promise<PerfLogEntry[]> {
    return this.readJson<PerfLogEntry[]>('perf_log.json', []);
  }

  async appendPerfLog(entry: PerfLogEntry): Promise<void> {
    const log = await this.readPerfLog();
    log.push(entry);
    // Keep last 10000 entries
    const trimmed = log.slice(-10000);
    await this.writeJson('perf_log.json', trimmed);
  }

  // ─── pii_rules.json — Configurable masking rules (#13) ─────────────
  async readPiiRules(): Promise<Record<string, { pattern: string; mask: string }>> {
    return this.readJson('pii_rules.json', {
      email: { pattern: '^[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}$', mask: 'xxx@xxx.com' },
      phone: { pattern: '^\\+?\\d{10,15}$', mask: 'XXX-XXX-XXXX' },
      ssn: { pattern: '^\\d{3}-?\\d{2}-?\\d{4}$', mask: 'XXX-XX-XXXX' },
      credit_card: { pattern: '^\\d{4}[ -]?\\d{4}[ -]?\\d{4}[ -]?\\d{4}$', mask: '****-****-****-1234' },
    });
  }

  // ─── pii_audit.log — Compliance audit trail ─────────────────────────
  async appendPiiAudit(line: string): Promise<void> {
    const fp = path.join(this.qmindPath, 'pii_audit.log');
    await fs.promises.appendFile(fp, line + '\n', 'utf8');
  }

  // ─── er_diagram.svg — Auto-generated ER diagram (#3c) ──────────────
  async writeErDiagram(svg: string): Promise<void> {
    const fp = path.join(this.qmindPath, 'er_diagram.svg');
    await fs.promises.writeFile(fp, svg, 'utf8');
  }

  // ─── sessions/<date>.json — Legacy per-date chat transcripts ──────
  async saveSession(date: string, messages: unknown[]): Promise<void> {
    await this.writeJson(`sessions/${date}.json`, messages);
  }

  async readSession<T = unknown>(date: string): Promise<T[]> {
    return this.readJson<T[]>(`sessions/${date}.json`, [] as unknown as T[]);
  }

  /** List available session dates (YYYY-MM-DD), most recent last. */
  async listSessionDates(): Promise<string[]> {
    const dir = path.join(this.qmindPath, 'sessions');
    try {
      const files = await fs.promises.readdir(dir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/, ''))
        .sort();
    } catch {
      return [];
    }
  }

  // ─── sessions.json — Multi-conversation chat store ─────────────────
  /**
   * Reads the multi-conversation store. On first read, migrates any legacy
   * per-date `sessions/<date>.json` transcripts into a single archived
   * conversation so no prior chat is lost. Never throws — returns an empty
   * store on any error.
   */
  async readConversations(): Promise<ConversationStore> {
    const store = await this.readJson<ConversationStore>(SESSIONS_FILE, {
      version: 1,
      activeSessionId: null,
      sessions: [],
    });
    if (!Array.isArray(store.sessions)) store.sessions = [];
    if (store.activeSessionId === undefined) store.activeSessionId = null;

    // One-time migration of legacy per-date transcripts.
    if (!store.migratedFromLegacy) {
      const dates = await this.listSessionDates();
      for (const date of dates) {
        const turns = await this.readSession<{
          role: 'user' | 'assistant';
          content: string;
          timestamp: number;
          sessionId?: string;
        }>(date);
        if (!Array.isArray(turns) || turns.length === 0) continue;
        const first = turns[0];
        const last = turns[turns.length - 1];
        const firstUser = turns.find(t => t.role === 'user');
        store.sessions.push({
          id: first.sessionId ?? `legacy-${date}`,
          title: makeTitle(firstUser?.content ?? 'Conversation'),
          createdAt: first.timestamp ?? Date.now(),
          updatedAt: last.timestamp ?? Date.now(),
          turns: turns.map(t => ({
            role: t.role,
            content: t.content,
            timestamp: t.timestamp,
          })),
        });
      }
      if (dates.length > 0) {
        store.migratedFromLegacy = true;
        // Point the active session at the most recent migrated conversation.
        store.activeSessionId = store.sessions[store.sessions.length - 1]?.id ?? null;
        await this.writeConversations(store);
      }
    }
    return store;
  }

  async writeConversations(store: ConversationStore): Promise<void> {
    store.version = 1;
    await this.writeJson(SESSIONS_FILE, store);
  }

  /**
   * Upsert a conversation (by id) and mark it active. Creates it when absent.
   * Keeps the store bounded to MAX_SESSIONS conversations (oldest archived
   * first) and each conversation to MAX_TURNS turns.
   */
  async upsertConversation(
    id: string,
    turns: ConversationTurn[],
    opts: { title?: string; connectionId?: string } = {},
  ): Promise<void> {
    const store = await this.readConversations();
    const now = Date.now();
    let conv = store.sessions.find(s => s.id === id);
    if (!conv) {
      conv = {
        id,
        title: opts.title ?? makeTitle(turns.find(t => t.role === 'user')?.content ?? 'Conversation'),
        createdAt: now,
        updatedAt: now,
        connectionId: opts.connectionId,
        turns: [],
      };
      store.sessions.push(conv);
    }
    if (opts.title) conv.title = opts.title;
    if (opts.connectionId) conv.connectionId = opts.connectionId;
    conv.turns = turns.slice(-MAX_TURNS);
    conv.updatedAt = now;
    store.activeSessionId = id;
    // Bound the number of retained conversations (drop oldest).
    if (store.sessions.length > MAX_SESSIONS) {
      store.sessions = store.sessions.slice(-MAX_SESSIONS);
    }
    await this.writeConversations(store);
    WorkspaceService.notifyDataChanged();
  }

  /** The active conversation, or undefined when none exists. */
  async getActiveConversation(): Promise<Conversation | undefined> {
    const store = await this.readConversations();
    return store.sessions.find(s => s.id === store.activeSessionId);
  }

  /** List conversations, most recently updated first. */
  async listConversations(): Promise<Conversation[]> {
    const store = await this.readConversations();
    return [...store.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Set the active conversation pointer (no turn changes). */
  async setActiveConversation(id: string | null): Promise<void> {
    const store = await this.readConversations();
    store.activeSessionId = id;
    await this.writeConversations(store);
  }

  /** Workspace root on disk (parent of .qmind/). */
  get workspaceRootPath(): string {
    return this.workspaceRoot;
  }

  /**
   * Resolve a SQLite `database` config value to an absolute path, mirroring
   * the backend's resolve_sqlite_path. Absolute paths are returned as-is.
   * A bare database name (no directory component) is placed in the
   * workspace-controlled `.qmind/databases/` directory and given a `.db`
   * extension when it has none. A relative path with a directory component is
   * anchored to the workspace root. The database always lives in the user's
   * project — never the extension install directory.
   */
  resolveSqlitePath(database: string): string {
    if (!database) return database;
    const expanded = database.replace(/^~(?=$|\/|\\)/, os.homedir());
    if (path.isAbsolute(expanded)) return path.normalize(expanded);

    // Bare name (no directory component) → .qmind/databases/<name>[.db]
    if (!expanded.includes('/') && !expanded.includes('\\')) {
      const name = path.extname(expanded) ? expanded : `${expanded}.db`;
      const canonical = path.join(this.qmindPath, 'databases', name);
      // Legacy-data preservation: if the canonical file does NOT exist yet but
      // a legacy file (extension dir or workspace root) DOES, the backend opens
      // the legacy file in place. Mirror that here so the sidebar shows the
      // ACTUAL path in use — never claim the canonical path while the backend
      // is connected to a legacy one. Nothing is copied/moved/deleted.
      if (!fs.existsSync(canonical)) {
        const legacy = this.findLegacySqliteFile(expanded);
        if (legacy) return legacy;
      }
      return canonical;
    }
    // Relative path with a directory component → anchor to workspace root.
    return path.resolve(this.workspaceRoot, expanded);
  }

  /**
   * Return the `python_backend` dirs of *other installed versions* of this
   * extension, mirroring the backend's `_sibling_extension_backend_dirs`.
   *
   * The backend runs from `<extensions>/<publisher>.<name>-<version>/python_backend`.
   * On upgrade (e.g. 1.2.7 → 1.2.8) the new version's `python_backend` becomes
   * the backend CWD, but a legacy SQLite file created by the *previous* version
   * stays behind in the old version's directory. To find that data without
   * hard-coding any version, derive the extension's version-less prefix from the
   * current dir name and scan for sibling `<prefix>-*` directories, returning
   * their `python_backend` dirs.
   *
   * Returns an empty array when the layout doesn't match an installed-extension
   * dir (e.g. running from a dev repo), so this is a no-op outside the
   * Marketplace layout.
   */
  private siblingExtensionBackendDirs(): string[] {
    if (!this.extensionBackendDir) return [];
    try {
      const extDir = path.dirname(path.resolve(this.extensionBackendDir)); // <publisher>.<name>-<version>/
      const parent = path.dirname(extDir); // the extensions/ folder
      const name = path.basename(extDir);
      // Strip a trailing "-<version>" (e.g. "-1.2.8") to get the stable prefix.
      // Version = last dash-separated segment that starts with a digit.
      const idx = name.lastIndexOf('-');
      if (idx <= 0) return [];
      const prefix = name.slice(0, idx);
      const ver = name.slice(idx + 1);
      if (!prefix || !ver || !/^\d/.test(ver)) return [];
      const siblings: string[] = [];
      for (const entry of fs.readdirSync(parent).sort()) {
        if (!entry.startsWith(`${prefix}-`) || entry === name) continue;
        const cand = path.join(parent, entry);
        if (cand === extDir) continue;
        try {
          if (!fs.statSync(cand).isDirectory()) continue;
          const pb = path.join(cand, 'python_backend');
          if (fs.statSync(pb).isDirectory()) siblings.push(pb);
        } catch {
          /* ignore */
        }
      }
      return siblings;
    } catch {
      return [];
    }
  }

  /**
   * Return the path of an existing legacy SQLite file, or undefined. Checks,
   * in priority order (mirroring the backend's `_find_legacy_sqlite_file`):
   *   1. the extension's current python_backend dir,
   *   2. the workspace root,
   *   3. each sibling installed-version python_backend dir (extension upgrades
   *      leave the old file behind; discovered dynamically, never hard-coded).
   * Detection only — the file is opened in place, never modified.
   */
  private findLegacySqliteFile(database: string): string | undefined {
    const candidates: string[] = [];
    if (this.extensionBackendDir) {
      candidates.push(path.join(this.extensionBackendDir, database));
    }
    candidates.push(path.join(this.workspaceRoot, database));
    // Sibling installed-version dirs (extension upgrades leave the old file behind).
    for (const sib of this.siblingExtensionBackendDirs()) {
      candidates.push(path.join(sib, database));
    }
    const seen = new Set<string>();
    for (const cand of candidates) {
      try {
        const rc = path.resolve(cand);
        if (seen.has(rc)) continue;
        seen.add(rc);
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          return rc;
        }
      } catch {
        /* ignore */
      }
    }
    return undefined;
  }

  /** Just the resolved SQLite file name (e.g. `Tables.db`) for display. */
  resolveSqliteFileName(database: string): string {
    return path.basename(this.resolveSqlitePath(database));
  }

  // ─── priv_map.enc — AES-256-GCM encrypted schema tokenization map ──
  async writeEncryptedPrivMap(buf: Buffer): Promise<void> {
    const fp = path.join(this.qmindPath, 'priv_map.enc');
    await fs.promises.writeFile(fp, buf);
  }

  async readEncryptedPrivMap(): Promise<Buffer | null> {
    const fp = path.join(this.qmindPath, 'priv_map.enc');
    try {
      return await fs.promises.readFile(fp);
    } catch {
      return null;
    }
  }

  get qmindDir(): string {
    return this.qmindPath;
  }
}
