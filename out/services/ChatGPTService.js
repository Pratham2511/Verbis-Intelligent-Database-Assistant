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
exports.ChatGPTService = void 0;
exports.validateChatGPTIdentity = validateChatGPTIdentity;
const vscode = __importStar(require("vscode"));
const crypto = __importStar(require("crypto"));
const http = __importStar(require("http"));
const jose_1 = require("jose");
const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const jwks = (0, jose_1.createRemoteJWKSet)(new URL(`${ISSUER}/.well-known/jwks.json`));
async function validateChatGPTIdentity(token, clientId, nonce, keySet = jwks) {
    const { payload } = await (0, jose_1.jwtVerify)(token, keySet, {
        issuer: ISSUER, audience: clientId, algorithms: ['RS256'], clockTolerance: 5,
        requiredClaims: ['sub', 'exp', 'iat', 'nonce'], maxTokenAge: '1h',
    });
    if (payload.nonce !== nonce || !payload.sub ||
        (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) {
        throw new Error('ChatGPT identity validation failed.');
    }
    return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
}
/** The webview receives status only. All OAuth credentials stay in host memory. */
class ChatGPTService {
    context;
    changed = new vscode.EventEmitter();
    onDidChange = this.changed.event;
    active;
    registrations;
    models = [];
    selectedModel;
    used = 0;
    limit = 1;
    pending;
    revision = 0;
    deps;
    constructor(context, deps = {}) {
        this.context = context;
        this.registrations = context.globalState.get('verbis.chatgpt.registrations', []).filter(r => typeof r.clientId === 'string' && r.clientId.startsWith('oaiapp_') && typeof r.subject === 'string');
        this.deps = { fetch: globalThis.fetch, open: url => vscode.env.openExternal(vscode.Uri.parse(url)),
            verify: validateChatGPTIdentity, ...deps };
    }
    snapshot() {
        return { connected: !!this.active, planEnabled: this.hasPlan(this.active), busy: !!this.pending,
            account: this.active ? this.active.email ?? `ChatGPT account ${this.active.clientId.slice(-6)}` : undefined,
            model: this.selectedModel, models: [...this.models], requestsUsed: this.used,
            requestLimit: this.limit, sessionOnly: true, revision: this.revision,
            providerActive: vscode.workspace.getConfiguration('verbis').get('llm.provider') === 'chatgpt' };
    }
    emit() { this.changed.fire(this.snapshot()); }
    hasPlan(c) { return !!c && c.scopes.includes('chatgpt.tokens.use.direct') && c.scopes.includes('resource.invoke'); }
    async request(url, init = {}, signal) {
        try {
            return await this.deps.fetch(url, { ...init, redirect: 'error', signal: signal
                    ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
        }
        catch {
            throw new Error('ChatGPT connection failed or was cancelled. No automatic retry was made.');
        }
    }
    async json(response) {
        const text = await response.text();
        if (text.length > 1000000)
            throw new Error('ChatGPT returned an oversized response.');
        try {
            return JSON.parse(text);
        }
        catch {
            throw new Error('ChatGPT returned an invalid response.');
        }
    }
    async exchange(fields, signal) {
        const response = await this.request(`${ISSUER}/api/accounts/oauth/token`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(fields),
        }, signal);
        const data = await this.json(response);
        if (!response.ok) {
            const terminal = ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'];
            const error = new Error(terminal.includes(data.error)
                ? 'ChatGPT session expired or was revoked. Continue with ChatGPT again.'
                : `ChatGPT authorization failed (HTTP ${response.status}). No automatic retry was made.`);
            Object.assign(error, { terminal: terminal.includes(data.error) });
            throw error;
        }
        return data;
    }
    tokens(data) {
        if (typeof data.access_token !== 'string' || !data.access_token || data.token_type?.toLowerCase() !== 'bearer' ||
            !Number.isFinite(data.expires_in) || data.expires_in <= 0 || typeof data.scope !== 'string') {
            throw new Error('ChatGPT returned incomplete credentials. Sign in again.');
        }
        return { accessToken: data.access_token, refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
            expiresAt: Date.now() + Math.min(data.expires_in, 3600) * 1000, scopes: data.scope.split(/\s+/) };
    }
    async signIn() {
        if (this.pending)
            throw new Error('ChatGPT sign-in is already open. Finish or cancel it first.');
        let registration;
        if (this.registrations.length) {
            const choice = await vscode.window.showQuickPick([
                ...this.registrations.map(r => ({ label: `Continue with ChatGPT account ${r.clientId.slice(-6)}`, registration: r })),
                { label: 'Use a different ChatGPT account or workspace', registration: undefined },
            ], { title: 'Verbis: ChatGPT account', ignoreFocusOut: true });
            if (!choice)
                throw new Error('ChatGPT sign-in cancelled.');
            registration = choice.registration;
        }
        // A second call could arrive while the account picker was open.
        if (this.pending)
            throw new Error('ChatGPT sign-in is already open.');
        const controller = new AbortController();
        this.pending = controller;
        this.emit();
        const revision = this.revision;
        let server;
        let timer;
        try {
            let hostId = this.context.globalState.get('verbis.chatgpt.hostId');
            if (!hostId) {
                hostId = `urn:uuid:${crypto.randomUUID()}`;
                await this.context.globalState.update('verbis.chatgpt.hostId', hostId);
            }
            const state = crypto.randomBytes(32).toString('base64url');
            const nonce = crypto.randomBytes(32).toString('base64url');
            const verifier = crypto.randomBytes(48).toString('base64url');
            let complete;
            let fail;
            const callback = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
            // Attach before opening the browser so cancellation never creates an unhandled rejection.
            void callback.catch(() => { });
            let consumed = false;
            server = http.createServer((request, response) => {
                response.setHeader('Cache-Control', 'no-store');
                response.setHeader('Referrer-Policy', 'no-referrer');
                response.setHeader('Content-Security-Policy', "default-src 'none'");
                const url = new URL(request.url ?? '/', 'http://127.0.0.1');
                if (request.method !== 'GET' || url.pathname !== '/auth/callback') {
                    response.writeHead(404).end();
                    return;
                }
                const returnedState = url.searchParams.get('state') ?? '';
                if (consumed || Buffer.byteLength(returnedState) !== Buffer.byteLength(state) ||
                    !crypto.timingSafeEqual(Buffer.from(returnedState), Buffer.from(state)) ||
                    ['state', 'code', 'client_id', 'error'].some(k => url.searchParams.getAll(k).length > 1)) {
                    response.writeHead(400).end('Invalid or expired sign-in attempt. Return to Verbis.');
                    return;
                }
                consumed = true;
                response.setHeader('Content-Type', 'text/plain; charset=utf-8');
                response.end('Sign-in returned to Verbis. Check VS Code for the result. This page makes no AI requests.');
                complete(url.searchParams);
            });
            server.requestTimeout = 10000;
            await new Promise((resolve, reject) => { server.once('error', () => reject(new Error('Cannot open the local ChatGPT callback.'))); server.listen(0, '127.0.0.1', resolve); });
            const port = server.address().port;
            const redirect = `http://127.0.0.1:${port}/auth/callback`;
            const params = new URLSearchParams({ client_id: registration?.clientId ?? 'dynamic_agent_client',
                ext_agent_host_id: hostId, response_type: 'code', redirect_uri: redirect, scope: SCOPE,
                resource: RESOURCE, state, nonce, code_challenge_method: 'S256',
                code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') });
            if (!registration)
                params.set('agent_name_hint', 'Verbis');
            if (registration && this.active?.clientId === registration.clientId)
                params.set('id_token_hint', this.active.idToken);
            controller.signal.addEventListener('abort', () => fail(new Error('ChatGPT sign-in cancelled.')), { once: true });
            timer = setTimeout(() => controller.abort(), 600000);
            if (controller.signal.aborted)
                throw new Error('ChatGPT sign-in cancelled.');
            if (!await this.deps.open(`${ISSUER}/api/accounts/authorize?${params}`))
                throw new Error('The browser could not open. Try Continue with ChatGPT again.');
            const returned = await callback;
            if (returned.has('error'))
                throw new Error('ChatGPT sign-in or plan consent was declined. No AI request was made.');
            const clientId = returned.get('client_id') ?? registration?.clientId;
            const code = returned.get('code');
            if (!clientId?.startsWith('oaiapp_') || !code || (registration && clientId !== registration.clientId)) {
                throw new Error('ChatGPT registration was incomplete or changed. Sign in again.');
            }
            const data = await this.exchange({ grant_type: 'authorization_code', client_id: clientId, code,
                code_verifier: verifier, redirect_uri: redirect, resource: RESOURCE }, controller.signal);
            let identity;
            try {
                identity = await this.deps.verify(data.id_token, clientId, nonce);
            }
            catch {
                throw new Error('ChatGPT identity validation failed. No credentials were activated.');
            }
            if (registration && identity.subject !== registration.subject)
                throw new Error('ChatGPT returned a different account. Add it as a new account instead.');
            const credentials = { ...identity, clientId, idToken: data.id_token, ...this.tokens(data) };
            if (controller.signal.aborted || revision !== this.revision)
                throw new Error('ChatGPT sign-in cancelled.');
            if (!this.registrations.some(r => r.clientId === clientId)) {
                const updated = [...this.registrations, { clientId, subject: identity.subject }];
                await this.context.globalState.update('verbis.chatgpt.registrations', updated);
                this.registrations = updated;
            }
            if (controller.signal.aborted || revision !== this.revision)
                throw new Error('ChatGPT sign-in cancelled.');
            this.active = credentials;
            this.models = [];
            this.selectedModel = undefined;
            this.revision++;
            this.emit();
            if (this.hasPlan(credentials)) {
                // Catalog retrieval is metadata, never a Responses request.
                await this.refreshModels().catch(() => vscode.window.showWarningMessage('ChatGPT connected, but models could not be loaded. Use Refresh models before generating.'));
                const welcomed = this.context.globalState.get('verbis.chatgpt.welcomed', []);
                if (!welcomed.includes(clientId)) {
                    await this.context.globalState.update('verbis.chatgpt.welcomed', [...welcomed, clientId]);
                    // A welcome notice must not keep a successful login in the busy state.
                    void vscode.window.showInformationMessage('ChatGPT connected. Choose a model in Verbis Settings. AI generation uses your allowance; signing in makes no AI request. Sign in again after restarting VS Code.', 'Manage usage').then(choice => {
                        if (choice === 'Manage usage')
                            void vscode.commands.executeCommand('verbis.chatgpt.manageUsage');
                    });
                }
            }
            // Return the completed state too; otherwise the reply can overwrite the
            // final event with busy:true and leave model selection disabled.
            if (this.pending === controller) {
                this.pending = undefined;
                this.emit();
            }
            return this.snapshot();
        }
        finally {
            if (timer)
                clearTimeout(timer);
            server?.close();
            if (this.pending === controller) {
                this.pending = undefined;
                this.emit();
            }
        }
    }
    cancelSignIn() { this.pending?.abort(); }
    async accessToken() {
        const c = this.active;
        if (!c)
            throw new Error('Continue with ChatGPT in Verbis Connections first.');
        if (!this.hasPlan(c))
            throw new Error('ChatGPT is signed in, but plan usage was not granted. Continue with ChatGPT and approve Use your ChatGPT plan.');
        if (c.expiresAt <= Date.now() + 30000) {
            if (!c.refresh)
                c.refresh = (async () => {
                    if (!c.refreshToken)
                        throw new Error('ChatGPT session expired. Continue with ChatGPT again.');
                    try {
                        const data = await this.exchange({ grant_type: 'refresh_token', client_id: c.clientId, refresh_token: c.refreshToken, resource: RESOURCE });
                        const updated = this.tokens(data);
                        // Refresh must rotate the renewable credential as one operation.
                        if (!updated.refreshToken)
                            throw new Error('ChatGPT refresh did not return a replacement session. Sign in again.');
                        if (this.active !== c)
                            throw new Error('ChatGPT account changed while renewing. Retry with the selected account.');
                        Object.assign(c, updated);
                        this.emit();
                    }
                    catch (error) {
                        if (error.terminal && this.active === c) {
                            this.active = undefined;
                            this.models = [];
                            this.selectedModel = undefined;
                            this.revision++;
                            this.emit();
                        }
                        throw error;
                    }
                })().finally(() => { c.refresh = undefined; });
            await c.refresh;
        }
        if (this.active !== c || !this.hasPlan(c))
            throw new Error('ChatGPT account or permissions changed. Sign in again.');
        return c.accessToken;
    }
    async refreshModels() {
        const revision = this.revision;
        const bearer = await this.accessToken();
        const response = await this.request(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${bearer}` } });
        if (!response.ok)
            throw new Error(`ChatGPT model list failed (HTTP ${response.status}). No AI request was made.`);
        const data = await this.json(response);
        if (!Array.isArray(data.models))
            throw new Error('ChatGPT returned an invalid model catalog.');
        if (revision !== this.revision)
            throw new Error('ChatGPT account changed. Refresh models again.');
        this.models = data.models.filter((m) => m.visibility === 'list' && typeof m.slug === 'string' && typeof m.display_name === 'string')
            .map((m) => ({ slug: m.slug, name: m.display_name }));
        if (!this.models.some(m => m.slug === this.selectedModel))
            this.selectedModel = undefined;
        this.emit();
        return this.snapshot();
    }
    selectModel(slug) {
        if (!this.models.some(m => m.slug === slug))
            throw new Error('Choose a model from the selected ChatGPT account’s catalog.');
        this.selectedModel = slug;
        this.revision++;
        this.emit();
        return this.snapshot();
    }
    allowOneMoreRequest() {
        if (this.used < this.limit)
            throw new Error('The currently allowed AI request has not been used yet.');
        this.limit++;
        this.emit();
        return this.snapshot();
    }
    async claimRequest(model) {
        if (!model || model !== this.selectedModel || !this.models.some(m => m.slug === model))
            throw new Error('Select a ChatGPT model in Verbis Connections before generating.');
        const revision = this.revision;
        const bearer = await this.accessToken();
        if (revision !== this.revision || model !== this.selectedModel)
            throw new Error('ChatGPT account or model changed. Review it before generating.');
        if (this.used >= this.limit)
            throw new Error('ChatGPT test request limit reached. No request was sent. Use Allow one more AI request or Manage usage in Connections.');
        this.used++;
        this.emit();
        return bearer;
    }
    async signOut() {
        this.cancelSignIn();
        this.revision++;
        const c = this.active;
        this.active = undefined;
        this.models = [];
        this.selectedModel = undefined;
        this.emit();
        let revoked = false;
        if (c?.refreshToken) {
            try {
                const response = await this.request(`${ISSUER}/api/accounts/oauth/revoke`, { method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ token: c.refreshToken, token_type_hint: 'refresh_token', client_id: c.clientId }) });
                revoked = response.status === 200;
            }
            catch { /* Credentials are already discarded locally. */ }
        }
        if (c && !revoked)
            await vscode.window.showWarningMessage('Signed out locally. Remote revocation was not confirmed; disconnect Verbis in ChatGPT settings if needed.');
        return this.snapshot();
    }
    dispose() { this.cancelSignIn(); this.revision++; this.active = undefined; this.models = []; this.changed.dispose(); }
}
exports.ChatGPTService = ChatGPTService;
//# sourceMappingURL=ChatGPTService.js.map