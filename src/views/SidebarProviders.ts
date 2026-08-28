// ============================================================================
// SidebarProviders — TreeDataProviders for the Verbis activity bar container
// src/views/SidebarProviders.ts
//
// package.json declares three views under the "verbis-explorer" container:
//   - verbis.connections  → database connections from .qmind/config.json
//   - verbis.schema       → tables of the active connection (via backend)
//   - verbis.history      → recent queries from .qmind/history.json
//
// Without these registrations the sidebar renders three empty sections and
// users conclude "there is no interface". Chat itself lives in VerbisPanel
// (editor area) — these views provide quick access to it and to connections.
// ============================================================================

import * as path from 'path';
import * as vscode from 'vscode';
import { WorkspaceService } from '../services/WorkspaceService';
import { BackendClient } from '../services/BackendClient';
import { BackendStatus } from '../types';

// ─── Connections ───────────────────────────────────────────────────────────

export class ConnectionsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onChange.event;

  constructor(private readonly workspace: WorkspaceService) {}

  refresh(): void { this.onChange.fire(); }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    // Expanding a SQLite connection → inline detail + action items.
    if (element instanceof ConnectionItem) {
      return element.detailItems;
    }

    const cfg = await this.workspace.readConfig();
    if (cfg.connections.length === 0) {
      const add = new vscode.TreeItem('Add Database Connection…');
      add.command = { command: 'verbis.addConnection', title: 'Add Connection' };
      add.iconPath = new vscode.ThemeIcon('add');
      return [add];
    }
    return cfg.connections.map(c => new ConnectionItem(c, this.workspace));
  }
}

/** A connection tree node. SQLite connections are collapsible and expose the
 * resolved database file location + reveal/copy actions as child items. */
class ConnectionItem extends vscode.TreeItem {
  readonly detailItems: vscode.TreeItem[] = [];

  constructor(
    public readonly conn: import('../types').DBConfig,
    workspace: WorkspaceService,
  ) {
    super(
      conn.name,
      conn.dialect === 'sqlite'
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.description = conn.dialect;
    this.iconPath = new vscode.ThemeIcon('database');
    this.id = `conn:${conn.id}`;
    // Clicking the connection selects it (and refreshes the Schema view).
    this.command = {
      command: 'verbis.selectConnection',
      title: 'Select Connection',
      arguments: [conn.id],
    };

    if (conn.dialect === 'sqlite') {
      const resolved = workspace.resolveSqlitePath(conn.database);
      const fileName = workspace.resolveSqliteFileName(conn.database);
      const isWorkspace = resolved.startsWith(workspace.workspaceRootPath);
      this.contextValue = 'verbisConnectionSqlite';
      this.tooltip = new vscode.MarkdownString(
        `**${conn.name}** (sqlite)\n\n` +
        `Database: \`${fileName}\`\n\n` +
        `Location: ${isWorkspace ? 'Workspace (.qmind/databases)' : 'External'}\n\n` +
        `Path: \`${resolved}\``
      );

      // Child: resolved file name.
      const fileItem = new vscode.TreeItem(fileName, vscode.TreeItemCollapsibleState.None);
      fileItem.iconPath = new vscode.ThemeIcon('file-binary');
      fileItem.tooltip = 'SQLite database file';
      fileItem.contextValue = 'verbisDbFile';

      // Child: compact resolved path (workspace-relative when possible).
      const compact = isWorkspace
        ? path.relative(workspace.workspaceRootPath, resolved)
        : resolved;
      const pathItem = new vscode.TreeItem(compact, vscode.TreeItemCollapsibleState.None);
      pathItem.iconPath = new vscode.ThemeIcon('folder-library');
      pathItem.tooltip = `Full path: ${resolved}`;
      pathItem.contextValue = 'verbisDbFile';

      // Child: reveal action.
      const reveal = new vscode.TreeItem('Reveal Database', vscode.TreeItemCollapsibleState.None);
      reveal.iconPath = new vscode.ThemeIcon('folder-opened');
      reveal.command = { command: 'verbis.revealDatabase', title: 'Reveal Database', arguments: [this] };

      // Child: copy path action.
      const copy = new vscode.TreeItem('Copy Path', vscode.TreeItemCollapsibleState.None);
      copy.iconPath = new vscode.ThemeIcon('clippy');
      copy.command = { command: 'verbis.copyDatabasePath', title: 'Copy Database Path', arguments: [this] };

      this.detailItems = [fileItem, pathItem, reveal, copy];
    } else {
      this.contextValue = 'verbisConnection';
      this.tooltip = `${conn.user}@${conn.host}:${conn.port}/${conn.database}`;
    }
  }
}

// ─── Schema ────────────────────────────────────────────────────────────────

export class SchemaTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onChange.event;

  /** Explicitly selected connection id (set via verbis.selectConnection). */
  private selectedConnectionId?: string;

  constructor(
    private readonly getClient: () => BackendClient | null,
    private readonly getStatus: () => BackendStatus,
    private readonly workspace?: WorkspaceService,
  ) {}

  refresh(): void { this.onChange.fire(); }

  /** Record the user-selected connection so the schema view follows it. */
  setActiveConnection(id: string): void {
    this.selectedConnectionId = id;
  }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

  /** Active connection id — the explicitly selected one if set, else the most
   * recently added connection (mirrors AssistantSession). */
  private async activeConnectionId(): Promise<string | undefined> {
    if (this.selectedConnectionId) return this.selectedConnectionId;
    if (!this.workspace) return undefined;
    const cfg = await this.workspace.readConfig();
    return cfg.connections[cfg.connections.length - 1]?.id;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const client = this.getClient();
    if (!client) {
      const state = this.getStatus().state;
      // Only show the spinner while the backend is genuinely starting up.
      // When stopped/crashed, a perpetual "Backend starting…" is misleading —
      // show an actionable restart item instead.
      if (state === 'starting') {
        const item = new vscode.TreeItem('Backend starting…');
        item.iconPath = new vscode.ThemeIcon('loading~spin');
        return [item];
      }
      const item = new vscode.TreeItem(
        state === 'crashed' ? 'Backend crashed — restart' : 'Backend not running — start'
      );
      item.command = { command: 'verbis.restartBackend', title: 'Restart Backend' };
      item.iconPath = new vscode.ThemeIcon(state === 'crashed' ? 'error' : 'debug-start');
      return [item];
    }

    // Expanding a table node → list its columns.
    if (element instanceof SchemaTableItem) {
      return element.table.columns.map(col => {
        const colItem = new vscode.TreeItem(col.name, vscode.TreeItemCollapsibleState.None);
        colItem.description = col.type;
        colItem.iconPath = new vscode.ThemeIcon(
          col.isPrimaryKey ? 'key' : col.isForeignKey ? 'link' : 'symbol-field'
        );
        return colItem;
      });
    }
    if (element) return [];

    const connId = (await this.activeConnectionId()) ?? 'default';
    try {
      const schema = await client.getSchema(connId);
      const tables = schema?.tables ?? [];
      if (tables.length === 0) {
        const item = new vscode.TreeItem('No schema loaded — open the assistant and connect');
        item.command = { command: 'verbis.openAssistant', title: 'Open Assistant' };
        return [item];
      }
      return tables.slice(0, 200).map(t => new SchemaTableItem(t));
    } catch {
      const item = new vscode.TreeItem('Schema unavailable — select a connection');
      item.command = { command: 'verbis.selectConnection', title: 'Select Connection' };
      item.iconPath = new vscode.ThemeIcon('warning');
      return [item];
    }
  }
}

/** A schema table tree node that carries its column metadata for expansion. */
class SchemaTableItem extends vscode.TreeItem {
  constructor(public readonly table: import('../types').SchemaInfo) {
    super(table.tableName, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('symbol-class');
    this.tooltip = `${table.columns.length} columns`;
  }
}

// ─── Recent Queries ────────────────────────────────────────────────────────

export class HistoryProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onChange.event;

  constructor(private readonly workspace: WorkspaceService) {}

  refresh(): void { this.onChange.fire(); }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const history = await this.workspace.readHistory();
    if (history.length === 0) {
      const item = new vscode.TreeItem('No queries yet — open the assistant to start');
      item.command = { command: 'verbis.openAssistant', title: 'Open Assistant' };
      item.iconPath = new vscode.ThemeIcon('comment-discussion');
      return [item];
    }
    return history.slice(-25).reverse().map(h => {
      const label = h.nlInput?.trim() && h.nlInput !== '(terminal)'
        ? h.nlInput.slice(0, 60)
        : h.sql.slice(0, 60);
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      const time = new Date(h.timestamp).toLocaleString();
      const status = h.success ? 'ok' : 'failed';
      const parts = [status];
      if (h.connectionName) parts.push(h.connectionName);
      if (h.executionTimeMs != null) parts.push(`${h.executionTimeMs}ms`);
      if (h.rowCount != null) parts.push(`${h.rowCount} rows`);
      item.description = parts.join(' · ');
      item.tooltip = new vscode.MarkdownString(
        `**${h.nlInput && h.nlInput !== '(terminal)' ? h.nlInput : '(query)'}**\n\n` +
        '```sql\n' + h.sql + '\n```\n\n' +
        `$(clock) ${time}  ·  status: ${status}` +
        (h.connectionName ? `  ·  $(database) ${h.connectionName}` : '') +
        (h.rowCount != null ? `  ·  ${h.rowCount} rows` : '')
      );
      item.iconPath = new vscode.ThemeIcon(h.success ? 'check' : 'error');
      // Clicking restores the SQL into the assistant for review/re-execution.
      item.command = {
        command: 'verbis.recallQuery',
        title: 'Recall Query',
        arguments: [h.sql],
      };
      return item;
    });
  }
}
