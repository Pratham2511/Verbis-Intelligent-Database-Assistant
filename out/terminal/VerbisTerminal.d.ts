import * as vscode from 'vscode';
import { AssistantSession } from '../assistant/AssistantSession';
import { BackendStatus } from '../types';
export declare class VerbisTerminal implements vscode.Pseudoterminal {
    private readonly session;
    private readonly getStatus;
    private readonly onExit;
    private readonly writeEmitter;
    readonly onDidWrite: vscode.Event<string>;
    private inputBuffer;
    private lastSql;
    private disposed;
    constructor(session: AssistantSession, getStatus: () => BackendStatus, onExit: () => void);
    open(): void;
    /**
     * Render the restored transcript so the user actually sees their prior
     * conversation (not just a notice). Bounded to the most recent turns to
     * keep reopening fast; /history shows the full log.
     */
    private renderRestoredTranscript;
    providerChanged(): void;
    close(): void;
    /**
     * Load a recalled SQL statement (from Recent Queries) as the pending
     * executable SQL and show it, so the user can review and /run it directly.
     */
    recallSql(sql: string, connectionId?: string, parameters?: Record<string, unknown>, schemaFingerprint?: string): void;
    private cursor;
    private escapeBuffer;
    private inputHistory;
    private historyCursor;
    private redraw;
    handleInput(data: string): void;
    private evaluate;
    private renderReply;
    private handleCommand;
    private runLastSql;
    private printBanner;
    /**
     * Render the live status block (connection, dialect, schema, provider, model,
     * mode). Everything is read from current app state via getStatusSnapshot(), so
     * it reflects provider/model/connection/schema/mode changes immediately.
     */
    private renderStatusLines;
    private printHelp;
    private printStatus;
    private printHistory;
    private printResultTable;
    private cellText;
    private highlightSql;
    private indent;
    private prompt;
    private writeln;
    private write;
}
