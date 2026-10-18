"use strict";
// ============================================================================
// BackendManager — Python subprocess lifecycle
// src/BackendManager.ts
//
// The venv is created by BackendInstaller (stored in globalStorageUri, survives
// extension updates). BackendManager receives the resolved `pythonExe` path
// as a constructor parameter — it does NOT look for venv inside python_backend/.
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
exports.BackendManager = void 0;
const child_process_1 = require("child_process");
const crypto = __importStar(require("crypto"));
const net = __importStar(require("net"));
const events_1 = require("events");
const vscode = __importStar(require("vscode"));
const BackendClient_1 = require("./services/BackendClient");
const MAX_PORT_RETRIES = 10;
const HEALTH_CHECK_INTERVAL_MS = 500;
// Cold imports can exceed ten seconds on a busy presentation machine.
const HEALTH_CHECK_TIMEOUT_MS = 45_000;
const CRASH_RESTART_WINDOW_MS = 30_000;
class BackendManager extends events_1.EventEmitter {
    backendScriptPath;
    backendDir;
    workspacePath;
    pythonExe;
    startPort;
    getEnvVars;
    process = null;
    port = null;
    client = null;
    crashTimestamps = [];
    status = { state: 'stopped' };
    stopping = false;
    epoch = 0;
    startTask;
    token = crypto.randomBytes(32).toString('hex');
    output = vscode.window.createOutputChannel('Verbis Backend');
    constructor(backendScriptPath, backendDir, workspacePath, pythonExe, // ← from BackendInstaller
    startPort = 8765, getEnvVars) {
        super();
        this.backendScriptPath = backendScriptPath;
        this.backendDir = backendDir;
        this.workspacePath = workspacePath;
        this.pythonExe = pythonExe;
        this.startPort = startPort;
        this.getEnvVars = getEnvVars;
    }
    setPythonExe(exe) { this.pythonExe = exe; }
    // ─── Startup ────────────────────────────────────────────────────────
    async start() {
        if (this.startTask)
            return this.startTask;
        this.stopping = false;
        const task = this.startInternal(++this.epoch);
        this.startTask = task;
        try {
            return await task;
        }
        finally {
            if (this.startTask === task)
                this.startTask = undefined;
        }
    }
    async startInternal(epoch) {
        if (this.status.state === 'ready')
            return this.status;
        this.setStatus({ state: 'starting' });
        // Find free port
        const port = await this.findFreePort(this.startPort);
        if (epoch !== this.epoch)
            return this.status;
        this.port = port;
        if (!port) {
            const msg = `Cannot start backend — ports ${this.startPort}-${this.startPort + MAX_PORT_RETRIES} all in use.`;
            this.setStatus({ state: 'crashed', lastError: msg });
            vscode.window.showErrorMessage(msg);
            return this.status;
        }
        this.client = new BackendClient_1.BackendClient(`http://127.0.0.1:${this.port}`, 90_000, this.token);
        // Spawn Python process using the resolved pythonExe from BackendInstaller
        const extraEnv = this.getEnvVars ? await this.getEnvVars() : {};
        if (epoch !== this.epoch)
            return this.status;
        this.process = (0, child_process_1.spawn)(this.pythonExe, [this.backendScriptPath, '--port', String(this.port), '--workspace', this.workspacePath], { cwd: this.backendDir, env: { ...process.env, ...extraEnv, QM_BACKEND_TOKEN: this.token }, detached: false });
        const child = this.process;
        child.on('error', err => { if (this.process !== child || epoch !== this.epoch)
            return; this.setStatus({ state: 'crashed', lastError: err.message }); this.output.appendLine(err.message); });
        this.process.on('exit', (code, signal) => {
            if (this.process !== child)
                return;
            const wasReady = this.status.state === 'ready' && !this.stopping;
            this.process = null;
            this.client = null;
            if (!this.stopping)
                this.setStatus({ state: 'crashed', lastError: `Backend exited (${code ?? signal})` });
            console.warn(`[Verbis] Python backend exited: code=${code} signal=${signal}`);
            if (wasReady) {
                this.handleCrash();
            }
        });
        this.process.stderr?.on('data', (chunk) => {
            this.output.append(chunk.toString());
        });
        // Health check polling
        const ready = await this.waitForHealth(epoch);
        if (epoch !== this.epoch)
            return this.status;
        if (ready && !this.stopping && this.process === child && child.exitCode === null) {
            this.setStatus({ state: 'ready', port, pid: child.pid });
        }
        else {
            // A late server must not keep running on an inaccessible occupied port.
            if (this.process === child) {
                const stopping = this.stop(), stopEpoch = this.epoch;
                await stopping;
                if (this.epoch !== stopEpoch)
                    return this.status;
            }
            this.setStatus({
                state: 'crashed',
                lastError: 'Health check timeout — backend was not ready within 45s. Check the Verbis Backend output and retry.',
            });
            vscode.window.showErrorMessage('Verbis backend failed to start. Click "Restart Backend" to retry.', 'Restart Backend').then(action => {
                if (action === 'Restart Backend')
                    this.restart();
            });
        }
        return this.status;
    }
    // ─── Health Polling ─────────────────────────────────────────────────
    async waitForHealth(epoch) {
        if (!this.client)
            return false;
        const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (epoch !== this.epoch || !this.process || this.process.exitCode !== null)
                return false;
            try {
                const h = await this.client.health();
                if (h.status === 'ok')
                    return true;
            }
            catch (err) {
                this.output.appendLine('Health check: ' + err.message);
                // Still starting
            }
            await new Promise(r => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
        }
        return false;
    }
    // ─── Crash Recovery ────────────────────────────────────────────────
    async handleCrash() {
        const now = Date.now();
        this.crashTimestamps = this.crashTimestamps.filter(t => now - t < CRASH_RESTART_WINDOW_MS);
        this.crashTimestamps.push(now);
        if (this.crashTimestamps.length === 1) {
            console.warn('[Verbis] Auto-restarting backend (first crash)...');
            await new Promise(r => setTimeout(r, 1000));
            if (!this.stopping)
                await this.start();
        }
        else {
            this.setStatus({ state: 'crashed', lastError: 'Backend crashed twice within 30s. Manual restart required.' });
            vscode.window.showErrorMessage('Verbis backend crashed twice within 30s. Click "Restart Backend" to retry manually.', 'Restart Backend').then(action => {
                if (action === 'Restart Backend')
                    this.restart();
            });
        }
    }
    // ─── Restart (manual) ──────────────────────────────────────────────
    async restart() {
        await this.stop();
        this.crashTimestamps = [];
        return this.start();
    }
    // ─── Shutdown ───────────────────────────────────────────────────────
    async stop() {
        this.stopping = true;
        const epoch = ++this.epoch;
        this.startTask = undefined;
        const child = this.process, client = this.client;
        this.process = null;
        this.client = null;
        this.setStatus({ state: 'stopped' });
        if (client)
            await Promise.race([client.shutdown(), new Promise(r => setTimeout(r, 1000))]);
        if (child && child.exitCode === null && child.signalCode === null) {
            await new Promise(resolve => { const timer = setTimeout(done, 500); function done() { clearTimeout(timer); child?.removeListener('exit', done); resolve(); } child.once('exit', done); });
            if (child.exitCode === null && child.signalCode === null) {
                child.kill('SIGTERM');
                setTimeout(() => { if (child.exitCode === null && child.signalCode === null)
                    child.kill('SIGKILL'); }, 1500);
            }
        }
        if (epoch === this.epoch)
            this.setStatus({ state: 'stopped' });
    }
    // ─── Port Scanner ──────────────────────────────────────────────────
    findFreePort(start) {
        return new Promise(resolve => {
            const tryPort = (port, attemptsLeft) => {
                const srv = net.createServer();
                srv.unref();
                srv.on('error', () => {
                    if (attemptsLeft > 0)
                        tryPort(port + 1, attemptsLeft - 1);
                    else
                        resolve(null);
                });
                srv.listen(port, '127.0.0.1', () => {
                    srv.close(() => resolve(port));
                });
            };
            tryPort(start, MAX_PORT_RETRIES);
        });
    }
    // ─── Status ─────────────────────────────────────────────────────────
    getClient() {
        return this.status.state === 'ready' ? this.client : null;
    }
    getStatus() {
        return this.status;
    }
    setStatus(s) {
        this.status = s;
        this.emit('status', s);
    }
}
exports.BackendManager = BackendManager;
//# sourceMappingURL=BackendManager.js.map