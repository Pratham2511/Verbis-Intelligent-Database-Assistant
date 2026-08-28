"use strict";
// ============================================================================
// Verbis — TerminalManager
// src/terminal/TerminalManager.ts
//
// Owns the lifecycle of the Verbis assistant terminal: creates it on demand,
// reuses the existing one if it's still open, and cleans up when it closes.
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
exports.TerminalManager = void 0;
const vscode = __importStar(require("vscode"));
const VerbisTerminal_1 = require("./VerbisTerminal");
const AssistantSession_1 = require("../assistant/AssistantSession");
class TerminalManager {
    getClient;
    getStatus;
    secrets;
    workspace;
    terminal = null;
    pty = null;
    closeSubscription = null;
    constructor(getClient, getStatus, secrets, workspace) {
        this.getClient = getClient;
        this.getStatus = getStatus;
        this.secrets = secrets;
        this.workspace = workspace;
    }
    /**
     * Open the assistant terminal, focusing the existing one if present.
     * When `recallSql` is given (from Recent Queries), it is loaded into the
     * terminal as the pending executable SQL, ready to review and /run.
     */
    open(recallSql) {
        if (this.terminal) {
            // Reveal the existing terminal rather than spawning a duplicate.
            this.terminal.show();
            if (recallSql) {
                this.pty?.recallSql(recallSql);
            }
            return;
        }
        const session = new AssistantSession_1.AssistantSession(this.getClient, this.secrets, this.workspace);
        const pty = new VerbisTerminal_1.VerbisTerminal(session, this.getStatus, () => this.disposeTerminal());
        this.pty = pty;
        this.terminal = vscode.window.createTerminal({
            name: 'Verbis Assistant',
            pty,
            iconPath: new vscode.ThemeIcon('comment-discussion'),
        });
        // Clear our reference when the user closes the terminal panel.
        this.closeSubscription = vscode.window.onDidCloseTerminal(t => {
            if (t === this.terminal) {
                this.disposeTerminal();
            }
        });
        this.terminal.show();
        // Apply any recalled SQL once the terminal is ready.
        if (recallSql) {
            pty.recallSql(recallSql);
        }
    }
    disposeTerminal() {
        this.closeSubscription?.dispose();
        this.closeSubscription = null;
        this.pty = null;
        if (this.terminal) {
            // dispose() on an already-closed terminal is a no-op.
            this.terminal.dispose();
            this.terminal = null;
        }
    }
    dispose() {
        this.disposeTerminal();
    }
}
exports.TerminalManager = TerminalManager;
//# sourceMappingURL=TerminalManager.js.map