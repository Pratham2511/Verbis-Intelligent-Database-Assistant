// ============================================================================
// extension.ts — VS Code Extension Activation Entry Point
// src/extension.ts
//
// Activation sequence:
//   0. Initialize SecretsService + first-run Gemini API key prompt
//   1. Initialize WorkspaceService (.qmind/ folder)
//   2. Start BackendManager (Python subprocess on localhost, cross-platform venv)
//   3. Register all commands (verbis.*) and keybindings
//   4. On deactivate: graceful backend shutdown
// ============================================================================

import * as vscode from 'vscode';
import * as path from 'path';
import { BackendManager } from './BackendManager';
import { BackendInstaller } from './services/BackendInstaller';
import { VerbisPanel } from './panels/VerbisPanel';
import { SchemaPanel } from './panels/SchemaPanel';
import { QueryTreePanel } from './panels/QueryTreePanel';
import { WorkspaceService } from './services/WorkspaceService';
import { SecretsService } from './services/SecretsService';
import { ConnectionsProvider, SchemaTreeProvider, HistoryProvider } from './views/SidebarProviders';
import { TerminalManager } from './terminal/TerminalManager';

let backendManager: BackendManager | undefined;
let workspaceService: WorkspaceService | undefined;
let secretsService: SecretsService | undefined;
let terminalManager: TerminalManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.info('[Verbis] Activating extension v1.1.0…');

  // ── Auto-install backend on first run (Fix D — Task 2.3) ────────────
  const installer = new BackendInstaller(context);

  if (!installer.isReady()) {
    const choice = await vscode.window.showInformationMessage(
      'Verbis needs to install its Python backend (~120MB, one-time setup, ~60 seconds).',
      'Install Now',
      'Later'
    );
    if (choice === 'Install Now') {
      try {
        await installer.installWithProgress();
        vscode.window.showInformationMessage('✅ Verbis is ready!');
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Verbis backend setup failed: ${err.message}. ` +
          `Run "Verbis: Install / Reinstall Backend" from the Command Palette to retry.`
        );
        return;
      }
    } else {
      vscode.window.showWarningMessage(
        'Verbis needs the backend to work. Run "Verbis: Install / Reinstall Backend" when ready.'
      );
      return;
    }
  }

  // ── Register reinstall command (Task 2.3) ──────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('verbis.installBackend', async () => {
      try {
        await installer.installWithProgress();
        vscode.window.showInformationMessage('✅ Verbis backend reinstalled.');
      } catch (err: any) {
        vscode.window.showErrorMessage(`Reinstall failed: ${err.message}`);
      }
    })
  );

  // ─── 0. Initialize SecretsService (VS Code SecretStorage) ─────────────
  secretsService = new SecretsService(context);

  // ── First-run prompt ──────────────────────────────────────────────────
  const existingKey = await secretsService.getGeminiKey();
  if (!existingKey) {
    const action = await vscode.window.showInformationMessage(
      'Welcome to Verbis! A free Gemini API key is required to generate queries.',
      'Set API Key',
      'Get Free Key',
      'Later'
    );
    if (action === 'Set API Key') {
      await promptForKey(secretsService, 'gemini');
    } else if (action === 'Get Free Key') {
      vscode.env.openExternal(
        vscode.Uri.parse('https://aistudio.google.com/app/apikey')
      );
    }
  }

  // ─── 1. Determine workspace root ────────────────────────────────────
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage(
      'Verbis requires an open workspace folder. Open a folder and try again.'
    );
    return;
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  // ─── 2. Initialize workspace service + backend manager ────────────────
  const backendDir = path.join(context.extensionPath, 'python_backend');
  workspaceService = new WorkspaceService(workspaceRoot, backendDir);

  const config = vscode.workspace.getConfiguration('verbis');
  const startPort = config.get<number>('backend.startPort', 8765);
  const backendScriptPath = path.join(backendDir, 'main.py');

  // Task 2.3: pass installer.pythonExe to BackendManager (4th param)
  backendManager = new BackendManager(
    backendScriptPath,
    backendDir,
    workspaceRoot,
    installer.pythonExe,
    startPort,
    async () => {
      const envVars: Record<string, string> = {};
      try {
        if (workspaceService && secretsService) {
          const cfg = await workspaceService.readConfig();
          for (const conn of cfg.connections) {
            const pw = await secretsService.getDbPassword(conn.id);
            if (pw) {
              envVars[`QM_DB_PASSWORD_${conn.id}`] = pw;
            }
          }
        }
      } catch (err) {
        console.error('Failed to load DB passwords for backend env', err);
      }
      return envVars;
    }
  );

  // Fire-and-forget — don't block activation on backend ready
  backendManager.start().then(status => {
    vscode.window.setStatusBarMessage(
      `Verbis backend: ${status.state}${status.port ? ` (port ${status.port})` : ''}`,
      3000
    );
  });

  // ─── 2b. Register sidebar view providers ─────────────────────────────
  // package.json declares verbis.connections / verbis.schema / verbis.history
  // under the Verbis activity bar container. Without these registrations the
  // sidebar renders permanently empty sections.
  const connectionsProvider = new ConnectionsProvider(workspaceService);
  const schemaTreeProvider = new SchemaTreeProvider(
    () => backendManager?.getClient() ?? null,
    () => backendManager?.getStatus() ?? { state: 'stopped' },
    workspaceService,
  );
  const historyProvider = new HistoryProvider(workspaceService);

  backendManager.on('status', (status) => {
    VerbisPanel.currentPanel?.postMessage({
      type: 'BACKEND_STATUS',
      payload: status,
    });
  });

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('verbis.connections', connectionsProvider),
    vscode.window.registerTreeDataProvider('verbis.schema', schemaTreeProvider),
    vscode.window.registerTreeDataProvider('verbis.history', historyProvider),
  );

  // Refresh Recent Queries (and related views) immediately whenever persisted
  // history or conversations change — no reload or backend restart required.
  context.subscriptions.push(
    WorkspaceService.onDidChangeData(() => {
      historyProvider.refresh();
      connectionsProvider.refresh();
    }),
  );

  // Refresh schema tree when backend becomes ready
  backendManager.on('status', (status) => {
    if (status.state === 'ready') {
      schemaTreeProvider.refresh();
      connectionsProvider.refresh();
      historyProvider.refresh();
    }
  });

  // ─── 2c. Terminal assistant (primary conversational interface) ────────
  terminalManager = new TerminalManager(
    () => backendManager?.getClient() ?? null,
    () => backendManager?.getStatus() ?? { state: 'stopped' },
    secretsService,
    workspaceService
  );
  context.subscriptions.push(terminalManager);

  // ─── 3. Register commands ───────────────────────────────────────────
  context.subscriptions.push(

    vscode.commands.registerCommand('verbis.openAssistant', () => {
      terminalManager?.open();
    }),

    vscode.commands.registerCommand('verbis.setApiKey', async () => {
      const provider = await vscode.window.showQuickPick(
        [
          { label: 'Google Gemini', description: 'Recommended — free tier', value: 'gemini' },
          { label: 'Groq',          description: 'Alternative — free tier', value: 'groq'   }
        ],
        { title: 'Verbis: Which provider?' }
      );
      if (provider && secretsService) {
        await promptForKey(secretsService, provider.value as 'gemini' | 'groq');
        // Fix B: clear intent cache after setting a new key
        const client = backendManager?.getClient();
        if (client) {
          try {
            await client.clearIntentCache();
          } catch (err) {
            console.warn('[Verbis] Intent cache clear failed after setApiKey:', err);
          }
        }
      }
    }),

    vscode.commands.registerCommand('verbis.clearApiKey', async () => {
      const confirmed = await vscode.window.showWarningMessage(
        'Remove your stored Verbis API key?',
        { modal: true },
        'Remove'
      );
      if (confirmed === 'Remove' && secretsService) {
        await secretsService.deleteGeminiKey();
        await secretsService.deleteGroqKey();
        // Fix B: clear intent cache after deleting the key
        const client = backendManager?.getClient();
        if (client) {
          try {
            await client.clearIntentCache();
          } catch (err) {
            console.warn('[Verbis] Intent cache clear failed after clearApiKey:', err);
          }
        }
        vscode.window.showInformationMessage('Verbis: API key removed.');
      }
    }),

    // Fix D (Task 3.5 Step 2) — verbis.selectConnection command.
    // Accepts an optional connection id (from the sidebar tree item); otherwise
    // shows a QuickPick. Selecting a connection refreshes the Schema view.
    vscode.commands.registerCommand('verbis.selectConnection', async (connId?: string) => {
      if (!workspaceService) return;
      const cfg = await workspaceService.readConfig();
      if (cfg.connections.length === 0) {
        vscode.window.showInformationMessage('No connections saved. Run "Verbis: Add Database Connection" first.');
        return;
      }

      let selectedId = connId;
      let selectedName = cfg.connections.find(c => c.id === connId)?.name;

      if (!selectedId) {
        const items = cfg.connections.map(c => ({
          label: c.name,
          description: c.dialect,
          detail: `${c.user}@${c.host}:${c.port}/${c.database}`,
          id: c.id,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          title: 'Select Database Connection',
          placeHolder: 'Choose which database to query',
        });
        if (!picked) return;
        selectedId = picked.id;
        selectedName = picked.label;
      }

      VerbisPanel.currentPanel?.setActiveConnection(selectedId);
      // Make the Schema view reload for the newly selected connection.
      schemaTreeProvider.setActiveConnection(selectedId);
      schemaTreeProvider.refresh();
      vscode.window.setStatusBarMessage(`Verbis: active connection → ${selectedName}`, 3000);
    }),

    // ── Database access UX: reveal / copy / open the resolved SQLite file ──
    vscode.commands.registerCommand('verbis.revealDatabase', async (arg?: unknown) => {
      const resolved = await resolveSqliteArg(arg);
      if (!resolved) return;
      // Built-in, cross-platform reveal (no OS-specific shell).
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(resolved));
    }),

    vscode.commands.registerCommand('verbis.copyDatabasePath', async (arg?: unknown) => {
      const resolved = await resolveSqliteArg(arg);
      if (!resolved) return;
      await vscode.env.clipboard.writeText(resolved);
      vscode.window.setStatusBarMessage(`Verbis: database path copied — ${resolved}`, 3000);
    }),

    vscode.commands.registerCommand('verbis.openDatabase', async (arg?: unknown) => {
      const resolved = await resolveSqliteArg(arg);
      if (!resolved) return;
      // Reveal is the safest cross-platform "open" for a binary SQLite file.
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(resolved));
    }),

    // Clicking a Recent Query copies its SQL to the clipboard and opens the
    // assistant, so the user can paste + review + re-run it. Clipboard is the
    // reliable, UI-agnostic handoff (works for both terminal and webview).
    vscode.commands.registerCommand('verbis.recallQuery', async (sql?: string) => {
      if (!sql) return;
      // Open/focus the assistant and load the recalled SQL as the pending
      // executable statement, ready to review and /run. Also copy to the
      // clipboard as a convenience fallback.
      await vscode.env.clipboard.writeText(sql);
      terminalManager?.open(sql);
      vscode.window.setStatusBarMessage('Verbis: query loaded — type /run to execute', 3000);
    }),

    vscode.commands.registerCommand('verbis.runLastQuery', async () => {
      if (!workspaceService || !backendManager?.getClient()) return;
      const history = await workspaceService.readHistory();
      if (history.length === 0) {
        vscode.window.showInformationMessage('No previous queries to re-run.');
        return;
      }
      const last = history[history.length - 1];
      const client = backendManager.getClient()!;
      try {
        const result = await client.execute({ sql: last.sql, dbConfigId: 'default' });
        vscode.window.showInformationMessage(
          `Query executed in ${result.executionTimeMs}ms — ${result.rowCount} rows.`
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Re-execution failed: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('verbis.showSchema', () => {
      if (!backendManager) return;
      SchemaPanel.createOrShow(context, backendManager.getClient());
    }),

    vscode.commands.registerCommand('verbis.openTree', () => {
      if (!workspaceService) return;
      QueryTreePanel.createOrShow(context, workspaceService);
    }),

    vscode.commands.registerCommand('verbis.addConnection', async () => {
      if (!workspaceService || !secretsService) return;
      const name = await vscode.window.showInputBox({ prompt: 'Connection name', placeHolder: 'Production Postgres' });
      if (!name) return;
      const dialect = await vscode.window.showQuickPick(
        ['postgresql', 'mysql', 'sqlite', 'mssql', 'mongodb'],
        { placeHolder: 'Database dialect' }
      );
      if (!dialect) return;
      const host = await vscode.window.showInputBox({ prompt: 'Host', placeHolder: 'localhost' });
      if (host === undefined) return;
      const portStr = await vscode.window.showInputBox({ prompt: 'Port', placeHolder: '5432' });
      if (portStr === undefined) return;
      const database = await vscode.window.showInputBox({ prompt: 'Database name' });
      if (database === undefined) return;
      const user = await vscode.window.showInputBox({ prompt: 'User' });
      if (user === undefined) return;
      const password = await vscode.window.showInputBox({
        prompt: 'Password (will be stored in OS keychain, never on disk)',
        password: true,
      });
      const id = crypto.randomUUID();
      if (password) {
        await secretsService.storeDbPassword(id, password);
      }
      const cfg = await workspaceService.readConfig();
      cfg.connections.push({
        id, name, dialect: dialect as any, host: host || 'localhost',
        port: parseInt(portStr || '5432', 10), database, user,
      });
      await workspaceService.writeConfig(cfg);
      connectionsProvider?.refresh();
      
      if (backendManager) {
        await backendManager.restart();
        vscode.window.showInformationMessage('Connection added. Backend restarted to apply changes.');
      }
      // Fix D + Fix G: auto-set the new connection as active.
      // `id` is the existing variable declared above as `const id = crypto.randomUUID()`.
      // Do NOT invent a new variable name — use `id` directly.
      VerbisPanel.currentPanel?.setActiveConnection(id);
      await VerbisPanel.currentPanel?.pushConnections();
      connectionsProvider.refresh();
      vscode.window.setStatusBarMessage(`Verbis: active connection → ${name}`, 3000);
      vscode.window.showInformationMessage(`Connection "${name}" saved.`);
    }),

    vscode.commands.registerCommand('verbis.runRobustnessTest', async () => {
      if (!backendManager?.getClient() || !workspaceService) return;
      const history = await workspaceService.readHistory();
      if (history.length === 0) {
        vscode.window.showWarningMessage('No saved queries to test. Run some queries first.');
        return;
      }
      const report = await backendManager.getClient()!.runRobustness({
        dbConfigId: 'default',
        querySet: history.map(h => ({ id: h.id, sql: h.sql, nlInput: h.nlInput })),
      });
      vscode.window.showInformationMessage(
        `Robustness score: ${report.overallScore}% (${report.survivedAll}/${report.totalQueries} survived all perturbations).`
      );
      vscode.window.showTextDocument(
        vscode.Uri.parse(
          `verbis://robustness/${encodeURIComponent(JSON.stringify(report))}`
        )
      );
    }),

    vscode.commands.registerCommand('verbis.restartBackend', async () => {
      if (!backendManager) return;
      vscode.window.showInformationMessage('Restarting Verbis backend…');
      await backendManager.restart();
    }),

    vscode.commands.registerCommand('verbis.openGlossaryEditor', () => {
      if (!workspaceService || !backendManager) return;
      VerbisPanel.createOrShow(
        context,
        backendManager.getClient(),
        workspaceService,
        secretsService!
      );
      // Switch webview to glossary tab via postMessage
      VerbisPanel.currentPanel?.postMessage({
        type: 'GLOSSARY_SAVED',
        payload: { openEditor: true },
      });
    })
  );

  // ─── 4. Register URI handler for robustness report ─────────────────
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('verbis', {
      provideTextDocumentContent(uri: vscode.Uri): string {
        const json = decodeURIComponent(uri.path.slice(1));
        try {
          const obj = JSON.parse(json);
          return [
            '# Schema Evolution Robustness Report',
            '',
            `Overall Robustness Score: ${obj.overallScore}%  (${obj.survivedAll} of ${obj.totalQueries} queries survive all perturbations)`,
            '',
            `Most fragile perturbation type: ${obj.mostFragile}`,
            `Most resilient perturbation type: ${obj.mostResilient}`,
            '',
            '## Per-Perturbation Breakdown',
            '',
            ...obj.perPerturbation.map((p: any) =>
              `- **${p.perturbationType}**: breakage ${p.breakageRate}%, hallucination ${p.hallucinationRate}%`
            ),
            '',
            '## Recommendations',
            '',
            ...(obj.recommendations || []).map((r: string) => `- ${r}`),
          ].join('\n');
        } catch {
          return 'Invalid robustness report payload.';
        }
      },
    })
  );

  // ── Fix E (Task 1.4) — Configuration change listener for provider switches ──
  // CRITICAL: use a SYNC callback. onDidChangeConfiguration's signature is
  // (e: ConfigurationChangeEvent) => any — it does NOT await the callback.
  // An async callback would create a floating promise (eslint flags this),
  // and any rejection would be silently swallowed. Use the explicit
  // .then(noop, errHandler) pattern instead:
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('verbis.llm.provider')) {
        backendManager?.getClient()?.clearIntentCache()
          ?.then(
            () => { /* cache cleared successfully */ },
            err => console.warn('[Verbis] Intent cache clear failed after provider change:', err)
          );
      }
    })
  );

  console.info('[Verbis] Extension activated successfully.');
}

export async function deactivate(): Promise<void> {
  console.info('[Verbis] Deactivating extension…');
  await backendManager?.stop();
}

// Generic sanity check only — no provider-specific prefix validation.
// Keys from any provider (Gemini, Claude, Kimi, OpenAI, …) are accepted.
const looksLikeApiKey = (v: string): string | null =>
    v.trim().length < 10 ? 'Key looks too short — paste the full API key' : null;

// ── Helper — reusable key prompt ─────────────────────────────────────
async function promptForKey(
    secrets: SecretsService,
    provider: 'gemini' | 'groq'
): Promise<void> {
    const config = {
        gemini: {
            title: 'Verbis — Gemini API Key',
            prompt: 'Free key from aistudio.google.com → Create API Key',
            placeholder: 'Paste your API key',
            validate: looksLikeApiKey
        },
        groq: {
            title: 'Verbis — Groq API Key',
            prompt: 'Free key from console.groq.com → API Keys',
            placeholder: 'Paste your API key',
            validate: looksLikeApiKey
        }
    }[provider];

    const key = await vscode.window.showInputBox({
        title:         config.title,
        prompt:        config.prompt,
        password:      true,
        ignoreFocusOut: true,
        placeHolder:   config.placeholder,
        validateInput: config.validate
    });

    if (!key) { return; }
    if (provider === 'gemini')      { await secrets.storeGeminiKey(key); }
    else                            { await secrets.storeGroqKey(key); }
    vscode.window.showInformationMessage(`Verbis: ${provider} key saved securely ✓`);
}

// ── Database access UX helper ────────────────────────────────────────────────
// Resolves the SQLite file path for the active connection (or a connection
// passed from the sidebar context menu). Returns undefined with a user-facing
// message when the path cannot be determined.
async function resolveSqliteArg(arg?: unknown): Promise<string | undefined> {
  if (!workspaceService) {
    vscode.window.showWarningMessage('Verbis: workspace not ready.');
    return undefined;
  }

  // A TreeItem from the Connections sidebar carries `id: "conn:<id>"`.
  let connId: string | undefined;
  if (arg && typeof arg === 'object' && 'id' in arg) {
    const id = (arg as { id?: string }).id;
    if (id?.startsWith('conn:')) connId = id.slice('conn:'.length);
  }

  const cfg = await workspaceService.readConfig();
  const connections = cfg.connections ?? [];

  // Fall back to the active connection (last in list) when no id was given.
  const conn = connId
    ? connections.find(c => c.id === connId)
    : connections[connections.length - 1];

  if (!conn) {
    vscode.window.showWarningMessage('Verbis: no connection selected.');
    return undefined;
  }
  if (conn.dialect !== 'sqlite') {
    vscode.window.showInformationMessage(
      `Verbis: "${conn.name}" is a ${conn.dialect} connection — no local file to reveal.`
    );
    return undefined;
  }

  const resolved = workspaceService.resolveSqlitePath(conn.database);
  return resolved;
}
