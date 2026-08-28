"use strict";
// ============================================================================
// WorkspaceService — .qmind/ file I/O wrapper
// src/services/WorkspaceService.ts
//
// Implements Novel Contribution #8 (Project-Scoped Persistent Workspaces).
// All .qmind/ files are written atomically (write-tmp + rename) to prevent
// corruption if VS Code crashes mid-write.
// ============================================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceService = void 0;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const QMIND_DIR = '.qmind';
const SESSIONS_FILE = 'sessions.json';
/** Max retained conversations and turns-per-conversation (bounded growth). */
const MAX_SESSIONS = 50;
const MAX_TURNS = 200;
/** Derive a short human title from the first user message. */
function makeTitle(seed) {
    const clean = seed.replace(/\s+/g, ' ').trim();
    if (!clean)
        return 'Conversation';
    return clean.length <= 40 ? clean : clean.slice(0, 39) + '…';
}
class WorkspaceService {
    workspaceRoot;
    extensionBackendDir;
    qmindPath;
    /**
     * Fired whenever persisted query history or conversations change, so UI
     * providers (Recent Queries, etc.) can refresh immediately without a reload.
     */
    static changeEmitter = new vscode.EventEmitter();
    /** Subscribe to persistence changes (history + conversations). */
    static get onDidChangeData() {
        return WorkspaceService.changeEmitter.event;
    }
    /** Notify listeners that persisted data changed. */
    static notifyDataChanged() {
        WorkspaceService.changeEmitter.fire();
    }
    constructor(workspaceRoot, 
    /** Extension's python_backend dir — used to detect legacy SQLite files. */
    extensionBackendDir) {
        this.workspaceRoot = workspaceRoot;
        this.extensionBackendDir = extensionBackendDir;
        this.qmindPath = path.join(workspaceRoot, QMIND_DIR);
        this.ensureStructure();
    }
    // ─── Directory Initialization ─────────────────────────────────────
    ensureStructure() {
        const subdirs = ['sessions', 'databases'];
        try {
            if (!fs.existsSync(this.qmindPath)) {
                fs.mkdirSync(this.qmindPath, { recursive: true });
            }
            for (const sub of subdirs) {
                const p = path.join(this.qmindPath, sub);
                if (!fs.existsSync(p))
                    fs.mkdirSync(p, { recursive: true });
            }
        }
        catch (err) {
            vscode.window.showWarningMessage(`Verbis: Could not initialize .qmind/ at ${this.qmindPath}: ${err.message}`);
        }
    }
    // ─── Atomic JSON read/write helpers ────────────────────────────────
    async readJson(file, fallback) {
        const fp = path.join(this.qmindPath, file);
        try {
            const raw = await fs.promises.readFile(fp, 'utf8');
            return JSON.parse(raw);
        }
        catch {
            return fallback;
        }
    }
    async writeJson(file, data) {
        const fp = path.join(this.qmindPath, file);
        const tmp = `${fp}.tmp`;
        const content = JSON.stringify(data, null, 2);
        await fs.promises.writeFile(tmp, content, 'utf8');
        await fs.promises.rename(tmp, fp); // atomic on POSIX
    }
    // ─── config.json ───────────────────────────────────────────────────
    async readConfig() {
        return this.readJson('config.json', {
            connections: [],
            llm: { mode: 'auto' },
            rowLimit: 500,
            timeoutSeconds: 60,
            readOnlyByDefault: true,
        });
    }
    async writeConfig(cfg) {
        await this.writeJson('config.json', cfg);
    }
    // ─── schema_cache.json ────────────────────────────────────────────
    async readSchemaCache() {
        return this.readJson('schema_cache.json', []);
    }
    async writeSchemaCache(schema) {
        await this.writeJson('schema_cache.json', schema);
    }
    // ─── memory.json — Adaptive Preference Memory (#1) + Disambiguation (#7)
    async readMemory() {
        return this.readJson('memory.json', {
            domainVocabulary: {},
            preferredPatterns: [],
            disambiguationRules: {},
            sqlCorrectionHistory: [],
            lastUpdated: Date.now(),
        });
    }
    async writeMemory(memory) {
        memory.lastUpdated = Date.now();
        await this.writeJson('memory.json', memory);
    }
    // ─── history.json — Query Genealogy (#3) ───────────────────────────
    async readHistory() {
        return this.readJson('history.json', []);
    }
    async appendHistory(entry) {
        const history = await this.readHistory();
        history.push(entry);
        // Keep last 5000 entries to avoid unbounded growth
        const trimmed = history.slice(-5000);
        await this.writeJson('history.json', trimmed);
        // Notify UI (Recent Queries) to refresh immediately.
        WorkspaceService.notifyDataChanged();
    }
    // ─── query_tree.json — Interactive DAG (#14) ───────────────────────
    async readQueryTree() {
        return this.readJson('query_tree.json', {
            nodes: {},
            rootIds: [],
            checkpoints: [],
        });
    }
    async writeQueryTree(tree) {
        await this.writeJson('query_tree.json', tree);
    }
    // ─── annotations.json — Collaborative Annotations (#15) ────────────
    async readAnnotations() {
        return this.readJson('annotations.json', []);
    }
    async writeAnnotations(annotations) {
        await this.writeJson('annotations.json', annotations);
    }
    // ─── glossary.json — Business Glossary (#10) ───────────────────────
    async readGlossary() {
        return this.readJson('glossary.json', { terms: [], joinPaths: [] });
    }
    async writeGlossary(data) {
        await this.writeJson('glossary.json', data);
    }
    // ─── perf_log.json — Performance Regression Detector (#11) ─────────
    async readPerfLog() {
        return this.readJson('perf_log.json', []);
    }
    async appendPerfLog(entry) {
        const log = await this.readPerfLog();
        log.push(entry);
        // Keep last 10000 entries
        const trimmed = log.slice(-10000);
        await this.writeJson('perf_log.json', trimmed);
    }
    // ─── pii_rules.json — Configurable masking rules (#13) ─────────────
    async readPiiRules() {
        return this.readJson('pii_rules.json', {
            email: { pattern: '^[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}$', mask: 'xxx@xxx.com' },
            phone: { pattern: '^\\+?\\d{10,15}$', mask: 'XXX-XXX-XXXX' },
            ssn: { pattern: '^\\d{3}-?\\d{2}-?\\d{4}$', mask: 'XXX-XX-XXXX' },
            credit_card: { pattern: '^\\d{4}[ -]?\\d{4}[ -]?\\d{4}[ -]?\\d{4}$', mask: '****-****-****-1234' },
        });
    }
    // ─── pii_audit.log — Compliance audit trail ─────────────────────────
    async appendPiiAudit(line) {
        const fp = path.join(this.qmindPath, 'pii_audit.log');
        await fs.promises.appendFile(fp, line + '\n', 'utf8');
    }
    // ─── er_diagram.svg — Auto-generated ER diagram (#3c) ──────────────
    async writeErDiagram(svg) {
        const fp = path.join(this.qmindPath, 'er_diagram.svg');
        await fs.promises.writeFile(fp, svg, 'utf8');
    }
    // ─── sessions/<date>.json — Legacy per-date chat transcripts ──────
    async saveSession(date, messages) {
        await this.writeJson(`sessions/${date}.json`, messages);
    }
    async readSession(date) {
        return this.readJson(`sessions/${date}.json`, []);
    }
    /** List available session dates (YYYY-MM-DD), most recent last. */
    async listSessionDates() {
        const dir = path.join(this.qmindPath, 'sessions');
        try {
            const files = await fs.promises.readdir(dir);
            return files
                .filter(f => f.endsWith('.json'))
                .map(f => f.replace(/\.json$/, ''))
                .sort();
        }
        catch {
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
    async readConversations() {
        const store = await this.readJson(SESSIONS_FILE, {
            version: 1,
            activeSessionId: null,
            sessions: [],
        });
        if (!Array.isArray(store.sessions))
            store.sessions = [];
        if (store.activeSessionId === undefined)
            store.activeSessionId = null;
        // One-time migration of legacy per-date transcripts.
        if (!store.migratedFromLegacy) {
            const dates = await this.listSessionDates();
            for (const date of dates) {
                const turns = await this.readSession(date);
                if (!Array.isArray(turns) || turns.length === 0)
                    continue;
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
    async writeConversations(store) {
        store.version = 1;
        await this.writeJson(SESSIONS_FILE, store);
    }
    /**
     * Upsert a conversation (by id) and mark it active. Creates it when absent.
     * Keeps the store bounded to MAX_SESSIONS conversations (oldest archived
     * first) and each conversation to MAX_TURNS turns.
     */
    async upsertConversation(id, turns, opts = {}) {
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
        if (opts.title)
            conv.title = opts.title;
        if (opts.connectionId)
            conv.connectionId = opts.connectionId;
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
    async getActiveConversation() {
        const store = await this.readConversations();
        return store.sessions.find(s => s.id === store.activeSessionId);
    }
    /** List conversations, most recently updated first. */
    async listConversations() {
        const store = await this.readConversations();
        return [...store.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    }
    /** Set the active conversation pointer (no turn changes). */
    async setActiveConversation(id) {
        const store = await this.readConversations();
        store.activeSessionId = id;
        await this.writeConversations(store);
    }
    /** Workspace root on disk (parent of .qmind/). */
    get workspaceRootPath() {
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
    resolveSqlitePath(database) {
        if (!database)
            return database;
        const expanded = database.replace(/^~(?=$|\/|\\)/, os.homedir());
        if (path.isAbsolute(expanded))
            return path.normalize(expanded);
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
                if (legacy)
                    return legacy;
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
    siblingExtensionBackendDirs() {
        if (!this.extensionBackendDir)
            return [];
        try {
            const extDir = path.dirname(path.resolve(this.extensionBackendDir)); // <publisher>.<name>-<version>/
            const parent = path.dirname(extDir); // the extensions/ folder
            const name = path.basename(extDir);
            // Strip a trailing "-<version>" (e.g. "-1.2.8") to get the stable prefix.
            // Version = last dash-separated segment that starts with a digit.
            const idx = name.lastIndexOf('-');
            if (idx <= 0)
                return [];
            const prefix = name.slice(0, idx);
            const ver = name.slice(idx + 1);
            if (!prefix || !ver || !/^\d/.test(ver))
                return [];
            const siblings = [];
            for (const entry of fs.readdirSync(parent).sort()) {
                if (!entry.startsWith(`${prefix}-`) || entry === name)
                    continue;
                const cand = path.join(parent, entry);
                if (cand === extDir)
                    continue;
                try {
                    if (!fs.statSync(cand).isDirectory())
                        continue;
                    const pb = path.join(cand, 'python_backend');
                    if (fs.statSync(pb).isDirectory())
                        siblings.push(pb);
                }
                catch {
                    /* ignore */
                }
            }
            return siblings;
        }
        catch {
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
    findLegacySqliteFile(database) {
        const candidates = [];
        if (this.extensionBackendDir) {
            candidates.push(path.join(this.extensionBackendDir, database));
        }
        candidates.push(path.join(this.workspaceRoot, database));
        // Sibling installed-version dirs (extension upgrades leave the old file behind).
        for (const sib of this.siblingExtensionBackendDirs()) {
            candidates.push(path.join(sib, database));
        }
        const seen = new Set();
        for (const cand of candidates) {
            try {
                const rc = path.resolve(cand);
                if (seen.has(rc))
                    continue;
                seen.add(rc);
                if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
                    return rc;
                }
            }
            catch {
                /* ignore */
            }
        }
        return undefined;
    }
    /** Just the resolved SQLite file name (e.g. `Tables.db`) for display. */
    resolveSqliteFileName(database) {
        return path.basename(this.resolveSqlitePath(database));
    }
    // ─── priv_map.enc — AES-256-GCM encrypted schema tokenization map ──
    async writeEncryptedPrivMap(buf) {
        const fp = path.join(this.qmindPath, 'priv_map.enc');
        await fs.promises.writeFile(fp, buf);
    }
    async readEncryptedPrivMap() {
        const fp = path.join(this.qmindPath, 'priv_map.enc');
        try {
            return await fs.promises.readFile(fp);
        }
        catch {
            return null;
        }
    }
    get qmindDir() {
        return this.qmindPath;
    }
}
exports.WorkspaceService = WorkspaceService;
//# sourceMappingURL=WorkspaceService.js.map