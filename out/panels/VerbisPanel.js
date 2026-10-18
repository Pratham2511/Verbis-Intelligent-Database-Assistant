"use strict";
// ============================================================================
// VerbisPanel — Main webview panel (chat + SQL + results)
// src/panels/VerbisPanel.ts
//
// Hosts the React webview that contains ChatPanel, SQLCodeBlock,
// ResultTable, NarrativeCard, ConfidenceBar. All postMessage traffic
// between the webview and the extension host is routed through here.
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
exports.VerbisPanel = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const ConnectionService_1 = require("../services/ConnectionService");
const AssistantSession_1 = require("../assistant/AssistantSession");
class VerbisPanel {
    context;
    initialClient;
    workspace;
    secrets;
    getClient;
    getBackendStatus;
    static currentPanel;
    static viewType = 'verbis.panel';
    panel;
    disposables = [];
    session;
    restored;
    // Fix D — active connection tracking (replaces hardcoded 'default')
    activeConnectionId = null;
    static createOrShow(context, client, workspace, secrets, getClient, getBackendStatus) {
        if (VerbisPanel.currentPanel) {
            VerbisPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
            return VerbisPanel.currentPanel;
        }
        const panel = vscode.window.createWebviewPanel(VerbisPanel.viewType, 'Verbis — Database Workspace', vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(context.extensionPath, 'webview', 'dist')),
            ],
        });
        VerbisPanel.currentPanel = new VerbisPanel(panel, context, client, workspace, secrets, getClient, getBackendStatus);
        return VerbisPanel.currentPanel;
    }
    constructor(panel, context, initialClient, workspace, secrets, getClient, getBackendStatus) {
        this.context = context;
        this.initialClient = initialClient;
        this.workspace = workspace;
        this.secrets = secrets;
        this.getClient = getClient;
        this.getBackendStatus = getBackendStatus;
        this.panel = panel;
        this.session = new AssistantSession_1.AssistantSession(() => this.client, this.secrets, this.workspace);
        this.restored = this.session.restoreLastSession().catch(e => { vscode.window.showWarningMessage(`Conversation restore failed: ${e.message}`); return 0; });
        this.panel.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'media', 'icon.png'));
        this.panel.webview.html = this.getHtml();
        // Seed the webview with the saved connections once it has loaded.
        setTimeout(() => { void this.pushConnections(); }, 500);
        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg), undefined, this.disposables);
        this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.{py,sql,md}');
        let changed;
        const notify = () => { if (changed)
            clearTimeout(changed); changed = setTimeout(() => this.postMessage({ type: 'PROJECT_CHANGED', payload: {} }), 500); };
        this.disposables.push(watcher, watcher.onDidChange(notify), watcher.onDidCreate(notify), watcher.onDidDelete(notify), { dispose: () => { if (changed)
                clearTimeout(changed); } });
    }
    /**
     * Resolve the user-configured model for the active provider
     * (`verbis.llm.geminiModel` / `verbis.llm.groqModel`). Returns undefined for
     * the local provider or blank values so the backend applies its default.
     */
    resolveModel(provider) {
        const cfg = vscode.workspace.getConfiguration('verbis');
        if (provider === 'gemini') {
            return cfg.get('llm.geminiModel', 'gemini-3.6-flash').trim() || undefined;
        }
        if (provider === 'groq') {
            return cfg.get('llm.groqModel', 'llama-3.3-70b-versatile').trim() || undefined;
        }
        if (provider === 'openrouter') {
            return cfg.get('llm.openrouterModel', 'thinkingmachines/inkling:free').trim() || undefined;
        }
        return undefined;
    }
    get client() { return this.getClient ? this.getClient() : this.initialClient; }
    requestedTab = 'home';
    requestedConnection;
    editConnection(connection) { this.requestedConnection = connection; this.openTab('connections'); this.postMessage({ type: 'EDIT_CONNECTION', payload: connection }); }
    providerChanged() { this.session.cancel(); this.session.discardSessionKey(); }
    openTab(tab) { this.requestedTab = tab; this.postMessage({ type: 'OPEN_TAB', payload: { tab } }); }
    // ── Fix D — Connection selection helpers ────────────────────────────
    /** Called by extension.ts when user selects a connection (verbis.selectConnection
     *  command) or after verbis.addConnection creates a new connection. */
    setActiveConnection(connectionId) {
        this.activeConnectionId = connectionId;
        void this.pushConnections();
    }
    /** Resolve active connection with fallback to first connection in config.json. */
    async resolveConnectionId() {
        return (await this.workspace.getActiveConnectionId()) ?? null;
    }
    // ─── Message Routing ───────────────────────────────────────────────
    async onMessage(msg) {
        // ─── Handle settings / external-link messages WITHOUT requiring the
        //     Python backend to be ready (these are pure host-side operations).
        try {
            if (msg.type === 'PANEL_READY') {
                await this.restored;
                await this.pushConnections();
                this.postMessage({ type: 'OPEN_TAB', payload: { tab: this.requestedTab } });
                if (this.requestedConnection)
                    this.postMessage({ type: 'EDIT_CONNECTION', payload: this.requestedConnection });
                if (this.secrets.chatgpt)
                    this.postMessage({ type: 'CHATGPT_STATUS', payload: this.secrets.chatgpt.snapshot() });
                this.pushProviderSettings();
                this.postMessage({ type: 'BACKEND_STATUS', payload: this.getBackendStatus?.() ?? { state: this.client ? 'ready' : 'stopped' } });
                return;
            }
            if (msg.type === 'GET_PROVIDER_SETTINGS' || msg.type === 'UPDATE_PROVIDER_SETTINGS') {
                if (msg.type === 'UPDATE_PROVIDER_SETTINGS') {
                    const { provider, model } = msg.payload;
                    if (!['chatgpt', 'gemini', 'groq', 'openrouter', 'local'].includes(provider))
                        throw new Error('Choose a listed AI provider.');
                    const cfg = vscode.workspace.getConfiguration('verbis');
                    const modelKey = { gemini: 'llm.geminiModel', groq: 'llm.groqModel', openrouter: 'llm.openrouterModel' }[provider];
                    if (model !== undefined) {
                        if (!modelKey || typeof model !== 'string' || !model.trim() || model.length > 120)
                            throw new Error('Enter a model name for the selected provider.');
                        if (provider === 'openrouter' && !(model.trim().endsWith(':free') || model.trim() === 'openrouter/free'))
                            throw new Error('Choose an OpenRouter :free model or openrouter/free. Paid models are not allowed.');
                        await cfg.update(modelKey, model.trim(), vscode.ConfigurationTarget.Workspace);
                    }
                    await cfg.update('llm.provider', provider, vscode.ConfigurationTarget.Workspace);
                }
                this.pushProviderSettings(msg.requestId);
                return;
            }
            if (msg.type.startsWith('CHATGPT_')) {
                const auth = this.secrets.chatgpt;
                if (!auth)
                    throw new Error('ChatGPT sign-in is unavailable.');
                let result = auth.snapshot();
                switch (msg.type) {
                    case 'CHATGPT_GET_STATUS': break;
                    case 'CHATGPT_SIGN_IN':
                        result = await vscode.commands.executeCommand('verbis.chatgpt.signIn');
                        break;
                    case 'CHATGPT_CANCEL_LOGIN':
                        auth.cancelSignIn();
                        break;
                    case 'CHATGPT_SIGN_OUT':
                        result = await auth.signOut();
                        break;
                    case 'CHATGPT_REFRESH_MODELS':
                        result = await auth.refreshModels();
                        break;
                    case 'CHATGPT_SELECT_MODEL':
                        result = auth.selectModel(msg.payload.model);
                        break;
                    case 'CHATGPT_ALLOW_REQUEST':
                        result = auth.allowOneMoreRequest();
                        break;
                    case 'CHATGPT_MANAGE_USAGE':
                        await vscode.commands.executeCommand('verbis.chatgpt.manageUsage');
                        break;
                    default: throw new Error('Unknown ChatGPT action.');
                }
                this.postMessage({ type: 'CHATGPT_STATUS', requestId: msg.requestId, payload: result });
                return;
            }
            if (msg.type === 'STORE_API_KEY') {
                const { provider, key } = msg.payload;
                if (!['gemini', 'groq', 'openrouter'].includes(provider) || key.trim().length < 10)
                    throw new Error('Choose a supported provider and paste the full key.');
                if (provider === 'gemini') {
                    await this.secrets.storeGeminiKey(key.trim());
                }
                if (provider === 'groq') {
                    await this.secrets.storeGroqKey(key.trim());
                }
                if (provider === 'openrouter') {
                    await this.secrets.storeOpenRouterKey(key.trim());
                }
                this.panel.webview.postMessage({
                    type: 'SETTINGS_UPDATED',
                    requestId: msg.requestId,
                    payload: { saved: true, provider, verified: false },
                });
                return;
            }
            if (msg.type === 'OPEN_EXTERNAL') {
                const url = msg.payload;
                if (typeof url === 'string') {
                    vscode.env.openExternal(vscode.Uri.parse(url));
                }
                return;
            }
            // ─── Connection management (host-side; no backend needed) ─────────
            if (msg.type === 'GET_CONNECTIONS') {
                await this.pushConnections();
                return;
            }
            if (msg.type === 'CONNECTION_FORM_SAVE') {
                const { password = '', ...form } = msg.payload;
                if (!form.name || !form.database || (form.dialect !== 'sqlite' && !form.user))
                    throw new Error('Connection name, database and a user for remote databases are required.');
                const id = form.id || crypto.randomUUID();
                const connection = { ...form, id };
                if (!this.client)
                    throw new Error('Start the backend before validating a connection.');
                await (0, ConnectionService_1.saveConnection)(this.client, this.workspace, this.secrets, connection, password);
                await this.pushConnections();
                this.postMessage({ type: 'SETTINGS_UPDATED', requestId: msg.requestId, payload: { saved: true, connectionId: id } });
                return;
            }
            if (msg.type === 'DELETE_CONNECTION') {
                const { id } = msg.payload;
                await vscode.commands.executeCommand('verbis.deleteConnection', { id: `conn:${id}` });
                await this.pushConnections();
                this.postMessage({ type: 'SETTINGS_UPDATED', requestId: msg.requestId, payload: { deleted: !(await this.workspace.readConfig()).connections.some(c => c.id === id) } });
                return;
            }
            if (msg.type === 'OPEN_SOURCE') {
                const { path: source, line } = msg.payload;
                const resolved = path.resolve(this.workspace.workspaceRootPath, source);
                if (!resolved.startsWith(this.workspace.workspaceRootPath + path.sep))
                    throw new Error('Source link is outside this workspace.');
                const doc = await vscode.workspace.openTextDocument(resolved);
                await vscode.window.showTextDocument(doc, { selection: new vscode.Range(Math.max(0, line - 1), 0, Math.max(0, line - 1), 0) });
                return;
            }
            if (msg.type === 'PICK_DATABASE_FILE') {
                const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'SQLite database': ['db', 'sqlite', 'sqlite3'] }, title: 'Choose an existing SQLite database' });
                this.postMessage({ type: 'WORKSPACE_RESULT', requestId: msg.requestId, payload: files?.[0] ? { path: files[0].fsPath } : { cancelled: true } });
                return;
            }
            if (msg.type === 'PICK_CSV') {
                const { encoding = 'utf-8' } = msg.payload;
                const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { CSV: ['csv', 'tsv', 'txt'] }, title: 'Select a dataset (10 MB maximum)' });
                if (!files) {
                    this.postMessage({ type: 'WORKSPACE_RESULT', requestId: msg.requestId, payload: { cancelled: true } });
                    return;
                }
                const stat = await fs.promises.stat(files[0].fsPath);
                if (stat.size > 10 * 1024 * 1024)
                    throw new Error('CSV limit is 10 MB');
                const bytes = await fs.promises.readFile(files[0].fsPath);
                const content = new TextDecoder(encoding, { fatal: true }).decode(bytes);
                this.postMessage({ type: 'WORKSPACE_RESULT', requestId: msg.requestId, payload: { source: files[0].fsPath, encoding, content } });
                return;
            }
            if (msg.type === 'EXPORT_FILE') {
                const { content, name } = msg.payload;
                if (typeof content !== 'string' || content.length > 20 * 1024 * 1024)
                    throw new Error('Export exceeds 20 MB');
                const file = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(this.workspace.workspaceRootPath, path.basename(name))) });
                if (file)
                    await fs.promises.writeFile(file.fsPath, content, 'utf8');
                this.postMessage({ type: 'WORKSPACE_RESULT', requestId: msg.requestId, payload: { saved: !!file } });
                return;
            }
            if (msg.type === 'CANCEL_REQUEST') {
                this.session.cancel();
                return;
            }
            // All remaining message types require the backend to be ready.
            if (!this.client) {
                this.sendError('Backend not ready. Run Verbis: Install / Reinstall Backend.', msg.requestId);
                return;
            }
            switch (msg.type) {
                case 'START_SQL_EDITOR': {
                    const id = await this.resolveConnectionId();
                    if (!id)
                        throw new Error('Connect a database or import a CSV before writing SQL.');
                    const schema = await this.client.getSchema(id);
                    if (await this.resolveConnectionId() !== id)
                        throw new Error('The selected database changed. Open the SQL editor again.');
                    const binding = this.session.startSqlEditor(id, schema.fingerprint);
                    this.postMessage({ type: 'WORKSPACE_RESULT', requestId: msg.requestId, payload: binding });
                    break;
                }
                case 'OPEN_ANALYSIS': {
                    const { id } = msg.payload;
                    const data = await this.client.workspaceAction('analysis_list', {});
                    const entry = data.analyses.find((a) => a.id === id);
                    if (!entry)
                        throw new Error('Saved analysis no longer exists');
                    await this.workspace.setActiveConnection(entry.connectionId);
                    this.session.restoreAnalysis(entry);
                    await this.pushConnections();
                    this.postMessage({ type: 'WORKSPACE_RESULT', requestId: msg.requestId, payload: entry });
                    break;
                }
                case 'GENERATE_SQL': {
                    const { input } = msg.payload;
                    const reply = await this.session.ask(input);
                    if (reply.kind === 'error')
                        throw new Error(reply.message);
                    this.postMessage({ type: 'SQL_GENERATED', requestId: msg.requestId, payload: reply });
                    break;
                }
                case 'EXECUTE_SQL': {
                    const { sql, dbConfigId, schemaFingerprint, parameters = {} } = msg.payload;
                    this.session.bindSql(sql, dbConfigId, schemaFingerprint);
                    const outcome = await this.session.execute(sql, parameters);
                    if (outcome.kind !== 'result')
                        throw new Error(outcome.message ?? 'Execution cancelled.');
                    this.postMessage({ type: 'EXECUTION_COMPLETE', requestId: msg.requestId, payload: outcome.result });
                    break;
                }
                case 'AMBIGUITY_ANSWERED': {
                    const payload = msg.payload;
                    const memory = await this.workspace.readMemory();
                    memory.disambiguationRules[payload.ruleKey] = payload.ruleValue;
                    await this.workspace.writeMemory(memory);
                    this.panel.webview.postMessage({
                        type: 'SETTINGS_UPDATED',
                        requestId: msg.requestId,
                        payload: { saved: true },
                    });
                    break;
                }
                case 'ANNOTATION_ADDED': {
                    const payload = msg.payload;
                    const annotations = await this.workspace.readAnnotations();
                    annotations.push(payload.annotation);
                    await this.workspace.writeAnnotations(annotations);
                    this.panel.webview.postMessage({
                        type: 'ANNOTATION_ADDED',
                        requestId: msg.requestId,
                        payload: { saved: true },
                    });
                    break;
                }
                case 'GLOSSARY_SAVED': {
                    const term = msg.payload;
                    await this.client.saveGlossaryTerm(term);
                    this.panel.webview.postMessage({
                        type: 'GLOSSARY_SAVED',
                        requestId: msg.requestId,
                        payload: { saved: true },
                    });
                    break;
                }
                // ── Fix D — SELECT_CONNECTION: forward to extension host command ──
                case 'SELECT_CONNECTION': {
                    await vscode.commands.executeCommand('verbis.selectConnection', msg.payload?.id);
                    break;
                }
                // ── Fix C — Text2Schema: NL → schema JSON → DDL → Mermaid ──────
                case 'LOAD_SCHEMA': {
                    const id = await this.resolveConnectionId();
                    if (!id)
                        throw new Error('Select a connection.');
                    const result = await this.client.getSchema(id);
                    await this.workspace.writeSchemaCache(result.tables);
                    this.postMessage({ type: 'SCHEMA_LOADED', requestId: msg.requestId, payload: { ...result, connectionId: id } });
                    break;
                }
                case 'LOAD_TREE': {
                    this.postMessage({ type: 'TREE_UPDATED', requestId: msg.requestId, payload: await this.workspace.readQueryTree() });
                    break;
                }
                case 'GET_GLOSSARY': {
                    this.postMessage({ type: 'GLOSSARY_LOADED', requestId: msg.requestId, payload: await this.client.getGlossary() });
                    break;
                }
                case 'ROBUSTNESS_REQUESTED': {
                    const id = await this.resolveConnectionId();
                    if (!id)
                        throw new Error('Select a connection.');
                    const history = (await this.workspace.readHistory()).filter(h => h.connectionId === id);
                    this.postMessage({ type: 'ROBUSTNESS_RESULT', requestId: msg.requestId, payload: await this.client.runRobustness({ dbConfigId: id, querySet: history }) });
                    break;
                }
                case 'WORKSPACE_ACTION': {
                    const { action, payload } = msg.payload;
                    const result = await this.client.workspaceAction(action, payload);
                    if (action === 'dataset_import' && result.connection) {
                        await this.workspace.upsertConnection(result.connection);
                        await this.pushConnections();
                    }
                    this.postMessage({ type: 'WORKSPACE_RESULT', requestId: msg.requestId, payload: result });
                    break;
                }
                case 'SCHEMA_CREATE': {
                    const { description, dialect } = msg.payload;
                    try {
                        const result = await this.session.withProvider((client, options, signal) => client.createSchema({ description, dialect, ...options }, signal));
                        this.panel.webview.postMessage({ type: 'SCHEMA_RESULT', requestId: msg.requestId, payload: result });
                    }
                    catch (e) {
                        this.sendError(e.message, msg.requestId);
                    }
                    break;
                }
                case 'SCHEMA_REFINE': {
                    const { schema, refinement, dialect } = msg.payload;
                    try {
                        const result = await this.session.withProvider((client, options, signal) => client.refineSchema({ schema, refinement, dialect, ...options }, signal));
                        this.panel.webview.postMessage({ type: 'SCHEMA_RESULT', requestId: msg.requestId, payload: result });
                    }
                    catch (e) {
                        this.sendError(e.message, msg.requestId);
                    }
                    break;
                }
                case 'SCHEMA_EXECUTE': {
                    const { ddl, dialect } = msg.payload;
                    const connectionId = await this.resolveConnectionId();
                    if (!connectionId) {
                        this.panel.webview.postMessage({
                            type: 'ERROR', requestId: msg.requestId,
                            payload: { message: 'No database connection active. Add a connection first via Verbis: Add Database Connection.' },
                        });
                        break;
                    }
                    const target = (await this.workspace.readConfig()).connections.find(c => c.id === connectionId);
                    if (!target || target.dialect !== dialect) {
                        this.sendError('The reviewed DDL dialect does not match the active connection. Select the intended database or generate again for its dialect.', msg.requestId);
                        break;
                    }
                    const confirmed = await vscode.window.showWarningMessage(`Apply the displayed schema DDL to ${connectionId}?`, { modal: true }, 'Apply DDL');
                    if (confirmed !== 'Apply DDL') {
                        this.sendError('Cancelled.', msg.requestId);
                        break;
                    }
                    try {
                        await this.client.execute({
                            sql: ddl,
                            dbConfigId: connectionId, // ← RESOLVED, not hardcoded 'default'
                            rowLimit: 500,
                            readOnly: vscode.workspace.getConfiguration('verbis').get('execution.readOnlyByDefault', true),
                            timeoutSeconds: vscode.workspace.getConfiguration('verbis').get('execution.timeoutSeconds', 60)
                        });
                        // Fix C: refresh schema cache + ChromaDB index so chat knows
                        // about the new tables. Wrapped in try/catch — non-fatal.
                        let refreshed = true;
                        try {
                            await this.client.refreshSchema(connectionId);
                        }
                        catch (refreshErr) {
                            refreshed = false;
                            console.warn('[Verbis] Schema refresh after DDL failed (non-fatal):', refreshErr);
                        }
                        this.panel.webview.postMessage({ type: 'SCHEMA_EXECUTED', requestId: msg.requestId, payload: { refreshed } });
                    }
                    catch (e) {
                        this.panel.webview.postMessage({ type: 'ERROR', requestId: msg.requestId, payload: { message: e.message } });
                    }
                    break;
                }
                default:
                    console.warn(`[Verbis] Unhandled message type: ${msg.type}`);
            }
        }
        catch (err) {
            this.sendError(err.message, msg.requestId);
        }
    }
    // Public so extension.ts can broadcast to the webview
    postMessage(message) {
        this.panel.webview.postMessage(message);
    }
    /** Push the current connection list to the webview (chat DB selector). */
    pushProviderSettings(requestId) {
        const provider = vscode.workspace.getConfiguration('verbis').get('llm.provider', 'gemini');
        this.postMessage({ type: 'PROVIDER_SETTINGS', requestId, payload: { provider, model: this.resolveModel(provider) } });
    }
    async pushConnections() {
        const cfg = await this.workspace.readConfig();
        this.panel.webview.postMessage({
            type: 'CONNECTIONS_UPDATED',
            payload: { connections: cfg.connections, activeConnectionId: await this.workspace.getActiveConnectionId() },
        });
    }
    sendError(message, requestId) {
        this.panel.webview.postMessage({
            type: 'ERROR', requestId,
            payload: { message },
        });
    }
    // ─── HTML Shell ────────────────────────────────────────────────────
    getHtml() {
        const nonce = getNonce();
        // Vite outputs assets/index.js + assets/index.css (see webview/vite.config.ts).
        // Previously this pointed at main.js/main.css which do not exist — the
        // chat webview rendered a blank page because the script 404'd.
        const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'dist', 'assets', 'index.js')));
        const styleUri = this.panel.webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'dist', 'assets', 'index.css')));
        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 img-src ${this.panel.webview.cspSource} https:;
                 script-src 'nonce-${nonce}' ${this.panel.webview.cspSource};
                 style-src ${this.panel.webview.cspSource} 'unsafe-inline';" />
  <title>Verbis</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
    // ─── Dispose ───────────────────────────────────────────────────────
    dispose() {
        VerbisPanel.currentPanel = undefined;
        this.session.cancel();
        this.session.discardSessionKey();
        this.panel.dispose();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
exports.VerbisPanel = VerbisPanel;
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
function hashSql(sql) {
    // Simple FNV-1a hash for query fingerprinting
    let h = 0x811c9dc5;
    const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
    for (let i = 0; i < normalized.length; i++) {
        h ^= normalized.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16);
}
//# sourceMappingURL=VerbisPanel.js.map