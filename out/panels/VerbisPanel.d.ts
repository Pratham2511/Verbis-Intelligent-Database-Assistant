import * as vscode from 'vscode';
import { DBConfig, BackendStatus } from '../types';
import { BackendClient } from '../services/BackendClient';
import { WorkspaceService } from '../services/WorkspaceService';
import { SecretsService } from '../services/SecretsService';
export declare class VerbisPanel {
    private readonly context;
    private initialClient;
    private readonly workspace;
    private readonly secrets;
    private readonly getClient?;
    private readonly getBackendStatus?;
    static currentPanel: VerbisPanel | undefined;
    private static readonly viewType;
    private panel;
    private disposables;
    private session;
    private restored;
    private activeConnectionId;
    static createOrShow(context: vscode.ExtensionContext, client: BackendClient | null, workspace: WorkspaceService, secrets: SecretsService, getClient?: () => BackendClient | null, getBackendStatus?: () => BackendStatus): VerbisPanel;
    private constructor();
    /**
     * Resolve the user-configured model for the active provider
     * (`verbis.llm.geminiModel` / `verbis.llm.groqModel`). Returns undefined for
     * the local provider or blank values so the backend applies its default.
     */
    private resolveModel;
    private get client();
    private requestedTab;
    private requestedConnection?;
    editConnection(connection: DBConfig): void;
    providerChanged(): void;
    openTab(tab: string): void;
    /** Called by extension.ts when user selects a connection (verbis.selectConnection
     *  command) or after verbis.addConnection creates a new connection. */
    setActiveConnection(connectionId: string): void;
    /** Resolve active connection with fallback to first connection in config.json. */
    private resolveConnectionId;
    private onMessage;
    postMessage(message: unknown): void;
    /** Push the current connection list to the webview (chat DB selector). */
    pushProviderSettings(requestId?: string): void;
    pushConnections(): Promise<void>;
    private sendError;
    private getHtml;
    dispose(): void;
}
