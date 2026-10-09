"use strict";
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
exports.AssistantSession = void 0;
const vscode = __importStar(require("vscode"));
const crypto = __importStar(require("crypto"));
class AssistantSession {
    getClient;
    secrets;
    workspace;
    sessionId = crypto.randomUUID();
    history = [];
    lastUserQuestion = '';
    conversationConnectionId;
    busy = false;
    abortController = null;
    executionId;
    sessionApiKey = null;
    credentialSource = 'unset';
    credentialProvider;
    pending;
    stateRevision = 0;
    constructor(getClient, secrets, workspace) {
        this.getClient = getClient;
        this.secrets = secrets;
        this.workspace = workspace;
    }
    get id() { return this.sessionId; }
    get isBusy() { return this.busy; }
    get transcript() { return this.history; }
    get providerLabel() { return vscode.workspace.getConfiguration('verbis').get('llm.provider', 'gemini'); }
    get modelLabel() { return this.resolveModel() ?? 'default'; }
    get readOnlyMode() { return vscode.workspace.getConfiguration('verbis').get('execution.readOnlyByDefault', true); }
    get credentialSourceLabel() { return this.providerLabel === 'chatgpt' ? 'ChatGPT plan (this window only)' : this.providerLabel === 'local' ? 'Local (no key)' : this.credentialSource === 'session' ? 'Session-specific key (not saved)' : this.credentialSource === 'configured' ? 'Existing configured key' : 'Not chosen yet'; }
    resolveModel() { if (this.providerLabel === 'chatgpt')
        return this.secrets.chatgpt?.snapshot().model; const c = vscode.workspace.getConfiguration('verbis'); return this.providerLabel === 'local' ? undefined : c.get(`llm.${this.providerLabel}Model`)?.trim() || undefined; }
    async resolveApiKey() { return this.credentialSource === 'session' ? this.sessionApiKey ?? undefined : this.secrets.getActiveApiKey(this.credentialProvider); }
    async ensureCredentialChoice() {
        const provider = this.providerLabel;
        if (this.credentialProvider !== provider) {
            this.discardSessionKey();
            this.credentialProvider = provider;
        }
        if (provider === 'local')
            return { ok: true };
        if (provider === 'chatgpt') {
            const status = this.secrets.chatgpt?.snapshot();
            if (!status?.connected || !status.planEnabled)
                return { ok: false, message: 'Continue with ChatGPT in Verbis Connections and approve Use your ChatGPT plan first.' };
            if (!status.model)
                return { ok: false, message: 'Select a ChatGPT model in Verbis Connections before generating.' };
            this.credentialSource = 'configured';
            return { ok: true };
        }
        if (this.credentialSource !== 'unset' && await this.resolveApiKey())
            return { ok: true };
        const configured = await this.secrets.getActiveApiKey(provider).catch(() => undefined);
        const pick = await vscode.window.showQuickPick([
            ...(configured ? [{ label: 'Use existing configured key', value: 'configured' }] : []),
            { label: 'Use a different key for this session only', value: 'session' },
            { label: configured ? 'Manage keys…' : 'Set and securely save an API key', value: 'manage' }
        ], { title: `Verbis: ${provider} API Key Source`, ignoreFocusOut: true });
        if (!pick)
            return { ok: false, message: 'Cancelled — no API key was used.' };
        if (this.providerLabel !== provider)
            return { ok: false, message: 'Provider changed. Ask again using the selected provider.' };
        if (pick.value === 'session') {
            const key = await vscode.window.showInputBox({ title: `Verbis — Session-only ${provider} API Key`, password: true,
                prompt: 'Kept only in memory until reset, close, reload or provider switch.', ignoreFocusOut: true,
                validateInput: v => v.trim().length < 10 ? 'Paste the full API key' : null });
            if (!key)
                return { ok: false, message: 'Cancelled — no session key was set.' };
            if (this.providerLabel !== provider)
                return { ok: false, message: 'Provider changed. No session key was retained.' };
            this.sessionApiKey = key.trim();
            this.credentialSource = 'session';
        }
        else if (pick.value === 'manage') {
            await vscode.commands.executeCommand('verbis.setApiKey', provider);
            if (this.providerLabel !== provider)
                return { ok: false, message: 'Provider changed. Ask again using the selected provider.' };
            if (!await this.secrets.getActiveApiKey(provider))
                return { ok: false, message: 'No API key saved.' };
            this.credentialSource = 'configured';
        }
        else
            this.credentialSource = 'configured';
        return { ok: true };
    }
    async getStatusSnapshot() {
        const cfg = await this.workspace.readConfig();
        const id = await this.workspace.getActiveConnectionId();
        const conn = cfg.connections.find(c => c.id === id);
        const schema = await this.workspace.readSchemaCache();
        return { provider: this.providerLabel, model: this.modelLabel, readOnly: this.readOnlyMode,
            connectionName: conn?.name, dialect: conn?.dialect, database: conn?.database,
            tableCount: schema.length || undefined, columnCount: schema.reduce((n, t) => n + t.columns.length, 0) || undefined };
    }
    async ask(nlInput) {
        if (this.busy)
            return { kind: 'message', message: 'Still working. Use /cancel or wait.' };
        const client = this.getClient();
        if (!client)
            return { kind: 'error', message: 'Backend is not running. Run Verbis: Install / Reinstall Backend.' };
        this.stateRevision++;
        this.busy = true;
        const controller = new AbortController();
        this.abortController = controller;
        let sessionId = this.sessionId;
        try {
            const dbConfigId = await this.workspace.getActiveConnectionId();
            if (!dbConfigId)
                return { kind: 'error', message: 'Add or import a database connection first.' };
            if (this.conversationConnectionId && this.conversationConnectionId !== dbConfigId) {
                this.history = [];
                this.sessionId = crypto.randomUUID();
                this.pending = undefined;
                this.lastUserQuestion = '';
                sessionId = this.sessionId;
            }
            this.conversationConnectionId = dbConfigId;
            const cred = await this.ensureCredentialChoice();
            if (!cred.ok)
                return { kind: 'message', message: cred.message };
            if (controller.signal.aborted)
                return { kind: 'cancelled', wasCancelled: true };
            const conversation = this.history.slice(-10).map(t => ({ role: t.role, content: t.content }));
            this.pending = undefined;
            this.lastUserQuestion = nlInput;
            this.history.push({ role: 'user', content: nlInput, timestamp: Date.now() });
            await this.persist();
            const provider = this.providerLabel, model = this.resolveModel();
            const usedKey = await this.secrets.claimProviderRequest?.(provider, model) ?? await this.resolveApiKey();
            if (controller.signal.aborted)
                return { kind: 'cancelled', wasCancelled: true };
            if (this.providerLabel !== provider || this.credentialProvider !== provider)
                throw new Error('Provider changed. Submit again using the selected provider.');
            const res = await client.generate({ nlInput, dbConfigId, sessionId, conversation,
                apiKey: usedKey, provider, model,
                privacyEnabled: vscode.workspace.getConfiguration('verbis').get('privacy.enableShield', true) }, controller.signal);
            if (controller.signal.aborted || sessionId !== this.sessionId)
                return { kind: 'cancelled', wasCancelled: true };
            if (usedKey && res.providerVerified)
                this.secrets.markVerified(provider, usedKey, model ?? 'default');
            if (!res.sql) {
                const msg = res.message ?? res.explanation ?? 'No SQL generated.';
                this.history.push({ role: 'assistant', content: msg, timestamp: Date.now() });
                await this.persist();
                return { kind: res.offtopic ? 'offtopic' : 'message', message: msg };
            }
            this.pending = { sql: res.sql, connectionId: dbConfigId, schemaFingerprint: res.schemaFingerprint, parameters: res.parameters };
            this.history.push({ role: 'assistant', content: res.sql, sql: res.sql, connectionId: dbConfigId,
                schemaFingerprint: res.schemaFingerprint, parameters: res.parameters, timestamp: Date.now() });
            await this.persist();
            return { kind: 'sql', sql: res.sql, connectionId: dbConfigId, schemaFingerprint: res.schemaFingerprint, parameters: res.parameters, explanation: res.explanation,
                message: `Schema validation passed. /run target: ${await this.connectionName(dbConfigId)} (${dbConfigId}).` };
        }
        catch (err) {
            return controller.signal.aborted ? { kind: 'cancelled', wasCancelled: true } : { kind: 'error', message: AssistantSession.describeError(err) };
        }
        finally {
            if (this.abortController === controller) {
                this.busy = false;
                this.abortController = null;
            }
        }
    }
    async withProvider(operation) {
        if (this.busy)
            throw new Error('Still working. Cancel or wait.');
        const client = this.getClient();
        if (!client)
            throw new Error('Backend is not running.');
        this.busy = true;
        const controller = new AbortController();
        this.abortController = controller;
        try {
            const credential = await this.ensureCredentialChoice();
            if (!credential.ok)
                throw new Error(credential.message);
            const provider = this.providerLabel, model = this.resolveModel(), apiKey = await this.secrets.claimProviderRequest?.(provider, model) ?? await this.resolveApiKey() ?? '';
            if (controller.signal.aborted)
                throw new Error('Cancelled.');
            if (this.providerLabel !== provider || this.credentialProvider !== provider)
                throw new Error('Provider changed. Retry using the selected provider.');
            const result = await operation(client, { provider, apiKey, model }, controller.signal);
            if (controller.signal.aborted)
                throw new Error('Cancelled.');
            if (this.providerLabel !== provider || this.credentialProvider !== provider)
                throw new Error('Provider changed. Retry using the selected provider.');
            if (apiKey)
                this.secrets.markVerified(provider, apiKey, model ?? 'default');
            return result;
        }
        finally {
            if (this.abortController === controller) {
                this.busy = false;
                this.abortController = null;
            }
        }
    }
    bindSql(sql, connectionId, schemaFingerprint, parameters) { this.stateRevision++; this.pending = { sql, connectionId, schemaFingerprint, parameters }; }
    restoreAnalysis(entry) {
        this.sessionId = entry.id;
        this.conversationConnectionId = entry.connectionId;
        this.lastUserQuestion = entry.question;
        this.history = [{ role: 'user', content: entry.question + '\nReviewed bindings: ' + JSON.stringify(entry.parameters), timestamp: Date.now() }, { role: 'assistant', content: entry.sql, sql: entry.sql, connectionId: entry.connectionId, schemaFingerprint: entry.schemaFingerprint, parameters: entry.parameters, timestamp: Date.now() + 1 }];
        this.bindSql(entry.sql, entry.connectionId, entry.schemaFingerprint, entry.parameters);
    }
    async execute(sql, parameters) {
        if (this.busy)
            return { kind: 'error', message: 'Busy — cancel or wait.' };
        const client = this.getClient();
        if (!client)
            return { kind: 'error', message: 'Backend is not running.' };
        const binding = this.pending;
        if (!binding || binding.sql !== sql)
            return { kind: 'error', message: 'This SQL has no database binding. Generate or recall a saved query first.' };
        const dbConfigId = binding.connectionId;
        this.busy = true;
        const controller = new AbortController();
        this.abortController = controller;
        this.executionId = crypto.randomUUID();
        const runSession = this.sessionId, runQuestion = this.lastUserQuestion;
        try {
            const cfg = await this.workspace.readConfig();
            if (!cfg.connections.some(c => c.id === dbConfigId))
                throw new Error('The query’s saved connection was deleted. Select a connection and regenerate.');
            if (binding.schemaFingerprint) {
                const schema = await client.getSchema(dbConfigId);
                if (schema.fingerprint !== binding.schemaFingerprint)
                    throw new Error('Schema changed since generation. Regenerate and review before running.');
            }
            const c = vscode.workspace.getConfiguration('verbis');
            const result = await client.execute({ sql, dbConfigId, requestId: this.executionId,
                parameters: parameters ?? binding.parameters ?? {}, rowLimit: c.get('query.rowLimit', 500), readOnly: this.readOnlyMode,
                timeoutSeconds: c.get('execution.timeoutSeconds', 60) }, controller.signal);
            await this.recordExecution(sql, dbConfigId, true, result, runQuestion, parameters ?? binding.parameters ?? {}, binding.schemaFingerprint);
            if (controller.signal.aborted || this.sessionId !== runSession)
                return { kind: 'cancelled', message: 'The completed attempt was recorded in history; this session was reset.' };
            this.history.push({ role: 'assistant', content: `Executed: ${result.rowCount} rows in ${result.executionTimeMs}ms.`, timestamp: Date.now() });
            await this.persist();
            return { kind: 'result', result };
        }
        catch (err) {
            await this.recordExecution(sql, dbConfigId, false, undefined, runQuestion, parameters ?? binding.parameters ?? {}, binding.schemaFingerprint).catch(() => { });
            return controller.signal.aborted ? { kind: 'cancelled', message: 'Execution cancellation requested.' } : { kind: 'error', message: AssistantSession.describeError(err) };
        }
        finally {
            this.busy = false;
            this.abortController = null;
            this.executionId = undefined;
        }
    }
    async recordExecution(sql, id, success, result, question = this.lastUserQuestion, parameters = {}, schemaFingerprint) { await this.workspace.appendHistory({ id: crypto.randomUUID(), timestamp: Date.now(), nlInput: question, sql, success, parameters, schemaFingerprint, connectionId: id, connectionName: await this.connectionName(id), executionTimeMs: result?.executionTimeMs, rowCount: result?.rowCount }); }
    async connectionName(id) { return (await this.workspace.readConfig()).connections.find(c => c.id === id)?.name ?? id; }
    cancel() {
        if (this.executionId)
            void this.getClient()?.cancelExecution(this.executionId).catch(() => { });
        this.abortController?.abort();
    }
    reset() {
        this.stateRevision++;
        this.cancel();
        this.sessionId = crypto.randomUUID();
        this.history = [];
        this.pending = undefined;
        this.lastUserQuestion = '';
        this.discardSessionKey();
        void this.workspace.setActiveConversation(this.sessionId).catch(e => vscode.window.showWarningMessage(`Conversation save failed: ${e.message}`));
    }
    discardSessionKey() { this.sessionApiKey = null; this.credentialSource = 'unset'; this.credentialProvider = undefined; }
    async persist() {
        try {
            await this.workspace.upsertConversation(this.sessionId, this.history, { connectionId: this.pending?.connectionId ?? await this.workspace.getActiveConnectionId() });
        }
        catch (err) {
            vscode.window.showWarningMessage(`Verbis conversation could not be saved: ${err.message}`);
        }
    }
    async restoreLastSession() {
        if (this.pending || this.history.length || this.busy)
            return 0;
        const revision = this.stateRevision;
        const conv = await this.workspace.getActiveConversation();
        if (!conv)
            return 0;
        // A recall, reset or first question can arrive while storage is loading.
        if (revision !== this.stateRevision || this.busy)
            return 0;
        this.stateRevision++;
        this.sessionId = conv.id;
        this.history = conv.turns;
        this.conversationConnectionId = conv.connectionId;
        const lastSqlIndex = this.history.map(t => !!(t.sql && t.connectionId)).lastIndexOf(true);
        const lastQuestionIndex = this.history.map(t => t.role === 'user').lastIndexOf(true);
        const last = this.history[lastSqlIndex];
        if (lastSqlIndex > lastQuestionIndex && last?.sql && last.connectionId)
            this.pending = { sql: last.sql, connectionId: last.connectionId, schemaFingerprint: last.schemaFingerprint, parameters: last.parameters };
        this.lastUserQuestion = [...this.history].reverse().find(t => t.role === 'user')?.content ?? '';
        return this.history.length;
    }
    get restoredSql() { return this.pending?.sql; }
    static describeError(err) { return err instanceof Error ? err.message : String(err); }
}
exports.AssistantSession = AssistantSession;
//# sourceMappingURL=AssistantSession.js.map