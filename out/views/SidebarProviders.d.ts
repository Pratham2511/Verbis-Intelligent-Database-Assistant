import * as vscode from 'vscode';
import { WorkspaceService } from '../services/WorkspaceService';
import { BackendClient } from '../services/BackendClient';
import { BackendStatus } from '../types';
export declare class ConnectionsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly workspace;
    private readonly onChange;
    readonly onDidChangeTreeData: vscode.Event<void>;
    constructor(workspace: WorkspaceService);
    refresh(): void;
    getTreeItem(item: vscode.TreeItem): vscode.TreeItem;
    getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]>;
}
export declare class SchemaTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly getClient;
    private readonly getStatus;
    private readonly workspace?;
    private readonly onChange;
    readonly onDidChangeTreeData: vscode.Event<void>;
    /** Explicitly selected connection id (set via verbis.selectConnection). */
    private selectedConnectionId?;
    constructor(getClient: () => BackendClient | null, getStatus: () => BackendStatus, workspace?: WorkspaceService | undefined);
    refresh(): void;
    /** Record the user-selected connection so the schema view follows it. */
    setActiveConnection(id: string): void;
    getTreeItem(item: vscode.TreeItem): vscode.TreeItem;
    /** Active connection id — the explicitly selected one if set, else the most
     * recently added connection (mirrors AssistantSession). */
    private activeConnectionId;
    getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]>;
}
export declare class HistoryProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly workspace;
    private readonly onChange;
    readonly onDidChangeTreeData: vscode.Event<void>;
    constructor(workspace: WorkspaceService);
    refresh(): void;
    getTreeItem(item: vscode.TreeItem): vscode.TreeItem;
    getChildren(): Promise<vscode.TreeItem[]>;
}
