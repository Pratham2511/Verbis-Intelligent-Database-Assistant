import * as vscode from 'vscode';
import { BackendClient } from '../services/BackendClient';
import { SecretsService } from '../services/SecretsService';
import { WorkspaceService } from '../services/WorkspaceService';
import { BackendStatus } from '../types';
export declare class TerminalManager implements vscode.Disposable {
    private readonly getClient;
    private readonly getStatus;
    private readonly secrets;
    private readonly workspace;
    private terminal;
    private pty;
    private closeSubscription;
    constructor(getClient: () => BackendClient | null, getStatus: () => BackendStatus, secrets: SecretsService, workspace: WorkspaceService);
    /**
     * Open the assistant terminal, focusing the existing one if present.
     * When `recallSql` is given (from Recent Queries), it is loaded into the
     * terminal as the pending executable SQL, ready to review and /run.
     */
    open(recallSql?: string): void;
    private disposeTerminal;
    dispose(): void;
}
