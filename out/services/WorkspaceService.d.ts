import * as vscode from 'vscode';
import { DBConfig, SchemaInfo, MemoryStore, QueryTree, Annotation, GlossaryTerm, PerfLogEntry } from '../types';
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
export declare class WorkspaceService {
    private readonly workspaceRoot;
    /** Extension's python_backend dir — used to detect legacy SQLite files. */
    private readonly extensionBackendDir?;
    private qmindPath;
    /**
     * Fired whenever persisted query history or conversations change, so UI
     * providers (Recent Queries, etc.) can refresh immediately without a reload.
     */
    private static readonly changeEmitter;
    /** Subscribe to persistence changes (history + conversations). */
    static get onDidChangeData(): vscode.Event<void>;
    /** Notify listeners that persisted data changed. */
    static notifyDataChanged(): void;
    constructor(workspaceRoot: string, 
    /** Extension's python_backend dir — used to detect legacy SQLite files. */
    extensionBackendDir?: string | undefined);
    private ensureStructure;
    private readJson;
    private writeJson;
    readConfig(): Promise<{
        connections: DBConfig[];
        backendPort?: number;
        llm: {
            mode: string;
            cloudEndpoint?: string;
            cloudModel?: string;
            localModel?: string;
        };
        rowLimit: number;
        timeoutSeconds: number;
        readOnlyByDefault: boolean;
    }>;
    writeConfig(cfg: unknown): Promise<void>;
    readSchemaCache(): Promise<SchemaInfo[]>;
    writeSchemaCache(schema: SchemaInfo[]): Promise<void>;
    readMemory(): Promise<MemoryStore>;
    writeMemory(memory: MemoryStore): Promise<void>;
    readHistory(): Promise<Array<{
        id: string;
        timestamp: number;
        nlInput: string;
        sql: string;
        success: boolean;
        executionTimeMs?: number;
        rowCount?: number;
        connectionId?: string;
        connectionName?: string;
    }>>;
    appendHistory(entry: {
        id: string;
        timestamp: number;
        nlInput: string;
        sql: string;
        success: boolean;
        executionTimeMs?: number;
        rowCount?: number;
        connectionId?: string;
        connectionName?: string;
    }): Promise<void>;
    readQueryTree(): Promise<QueryTree>;
    writeQueryTree(tree: QueryTree): Promise<void>;
    readAnnotations(): Promise<Annotation[]>;
    writeAnnotations(annotations: Annotation[]): Promise<void>;
    readGlossary(): Promise<{
        terms: GlossaryTerm[];
        joinPaths: Array<{
            from: string;
            to: string;
            via: string;
        }>;
    }>;
    writeGlossary(data: {
        terms: GlossaryTerm[];
        joinPaths: Array<{
            from: string;
            to: string;
            via: string;
        }>;
    }): Promise<void>;
    readPerfLog(): Promise<PerfLogEntry[]>;
    appendPerfLog(entry: PerfLogEntry): Promise<void>;
    readPiiRules(): Promise<Record<string, {
        pattern: string;
        mask: string;
    }>>;
    appendPiiAudit(line: string): Promise<void>;
    writeErDiagram(svg: string): Promise<void>;
    saveSession(date: string, messages: unknown[]): Promise<void>;
    readSession<T = unknown>(date: string): Promise<T[]>;
    /** List available session dates (YYYY-MM-DD), most recent last. */
    listSessionDates(): Promise<string[]>;
    /**
     * Reads the multi-conversation store. On first read, migrates any legacy
     * per-date `sessions/<date>.json` transcripts into a single archived
     * conversation so no prior chat is lost. Never throws — returns an empty
     * store on any error.
     */
    readConversations(): Promise<ConversationStore>;
    writeConversations(store: ConversationStore): Promise<void>;
    /**
     * Upsert a conversation (by id) and mark it active. Creates it when absent.
     * Keeps the store bounded to MAX_SESSIONS conversations (oldest archived
     * first) and each conversation to MAX_TURNS turns.
     */
    upsertConversation(id: string, turns: ConversationTurn[], opts?: {
        title?: string;
        connectionId?: string;
    }): Promise<void>;
    /** The active conversation, or undefined when none exists. */
    getActiveConversation(): Promise<Conversation | undefined>;
    /** List conversations, most recently updated first. */
    listConversations(): Promise<Conversation[]>;
    /** Set the active conversation pointer (no turn changes). */
    setActiveConversation(id: string | null): Promise<void>;
    /** Workspace root on disk (parent of .qmind/). */
    get workspaceRootPath(): string;
    /**
     * Resolve a SQLite `database` config value to an absolute path, mirroring
     * the backend's resolve_sqlite_path. Absolute paths are returned as-is.
     * A bare database name (no directory component) is placed in the
     * workspace-controlled `.qmind/databases/` directory and given a `.db`
     * extension when it has none. A relative path with a directory component is
     * anchored to the workspace root. The database always lives in the user's
     * project — never the extension install directory.
     */
    resolveSqlitePath(database: string): string;
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
    private siblingExtensionBackendDirs;
    /**
     * Return the path of an existing legacy SQLite file, or undefined. Checks,
     * in priority order (mirroring the backend's `_find_legacy_sqlite_file`):
     *   1. the extension's current python_backend dir,
     *   2. the workspace root,
     *   3. each sibling installed-version python_backend dir (extension upgrades
     *      leave the old file behind; discovered dynamically, never hard-coded).
     * Detection only — the file is opened in place, never modified.
     */
    private findLegacySqliteFile;
    /** Just the resolved SQLite file name (e.g. `Tables.db`) for display. */
    resolveSqliteFileName(database: string): string;
    writeEncryptedPrivMap(buf: Buffer): Promise<void>;
    readEncryptedPrivMap(): Promise<Buffer | null>;
    get qmindDir(): string;
}
