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
import { WorkspaceService } from './services/WorkspaceService';
import { SecretsService } from './services/SecretsService';
import { ConnectionsProvider, SchemaTreeProvider, HistoryProvider } from './views/SidebarProviders';
import {AssistantSession} from './assistant/AssistantSession';
import { TerminalManager } from './terminal/TerminalManager';
import {ChatGPTService} from './services/ChatGPTService';

let backendManager: BackendManager | undefined;
let workspaceService: WorkspaceService | undefined;
let secretsService: SecretsService | undefined;
let terminalManager: TerminalManager | undefined;
let chatgptService: ChatGPTService | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.info(`[Verbis] Activating ${context.extension.packageJSON.version}…`);

  // ── Auto-install backend on first run (Fix D — Task 2.3) ────────────
  const installer = new BackendInstaller(context);

  // ── Register reinstall command (Task 2.3) ──────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('verbis.installBackend', async () => {
      try {
        await installer.installWithProgress();
        if (backendManager) {backendManager.setPythonExe(installer.pythonExe);const status=await backendManager.restart();if(status.state!=='ready')throw new Error(status.lastError??'Backend failed readiness check');}
        vscode.window.showInformationMessage('Verbis backend installed and restarted.');
      } catch (err: any) {
        vscode.window.showErrorMessage(`Reinstall failed: ${err.message}`);
      }
    })
  );

  // ─── 0. Initialize SecretsService (VS Code SecretStorage) ─────────────
  chatgptService = new ChatGPTService(context);
  secretsService = new SecretsService(context,chatgptService);
  let authRevision=chatgptService.snapshot().revision;
  context.subscriptions.push(chatgptService,chatgptService.onDidChange(status=>{
    if(status.revision!==authRevision){authRevision=status.revision;terminalManager?.providerChanged();VerbisPanel.currentPanel?.providerChanged();}
    VerbisPanel.currentPanel?.postMessage({type:'CHATGPT_STATUS',payload:status});
  }));
  context.subscriptions.push(
    vscode.commands.registerCommand('verbis.chatgpt.signIn',async()=>{
      try {
        const status=await chatgptService!.signIn();
        if(status.planEnabled)await vscode.workspace.getConfiguration('verbis').update('llm.provider','chatgpt',vscode.ConfigurationTarget.Workspace);
        if(workspaceService&&secretsService)VerbisPanel.createOrShow(context,backendManager?.getClient()??null,workspaceService,secretsService,()=>backendManager?.getClient()??null).openTab('connections');
        return status;
      }catch(error){await vscode.window.showErrorMessage((error as Error).message);throw error;}
    }),
    vscode.commands.registerCommand('verbis.chatgpt.signOut',()=>chatgptService!.signOut()),
    vscode.commands.registerCommand('verbis.chatgpt.manageUsage',()=>vscode.env.openExternal(vscode.Uri.parse('https://chatgpt.com/settings/usage'))),
  );

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
      const envVars: Record<string, string> = {QM_PRIVMAP_SALT: crypto.randomUUID()};
      try {
        if (workspaceService && secretsService) {
          const cfg = await workspaceService.readConfig();
          for (const conn of cfg.connections) {
            if(conn.dialect==='sqlite')continue;
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
  if (installer.isReady()) backendManager.start().then(status => {
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
      schemaTreeProvider.refresh();
      void VerbisPanel.currentPanel?.pushConnections();
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

    vscode.commands.registerCommand('verbis.setApiKey', async (requestedProvider?: 'gemini'|'groq'|'openrouter') => {
      const provider = requestedProvider ? {value: requestedProvider} : await vscode.window.showQuickPick(
        [
          { label: 'Google Gemini', description: 'Recommended — free tier', value: 'gemini' },
          { label: 'Groq',          description: 'Alternative — free tier', value: 'groq'   },
          { label: 'OpenRouter',    description: 'Free models only', value: 'openrouter' }
        ],
        { title: 'Verbis: Which provider?' }
      );
      if (provider && secretsService) {
        await promptForKey(secretsService, provider.value as 'gemini' | 'groq' | 'openrouter');
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
        await secretsService.deleteOpenRouterKey();
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

      await workspaceService.setActiveConnection(selectedId);
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
    vscode.commands.registerCommand('verbis.recallQuery', async (sql?: string, connectionId?: string,parameters?:Record<string,unknown>,schemaFingerprint?:string) => {
      if (!sql) return;
      // Open/focus the assistant and load the recalled SQL as the pending
      // executable statement, ready to review and /run. Also copy to the
      // clipboard as a convenience fallback.
      await vscode.env.clipboard.writeText(sql);
      terminalManager?.open(sql, connectionId,parameters,schemaFingerprint);
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
        if (!last.connectionId || !(await workspaceService.readConfig()).connections.some(c=>c.id===last.connectionId)) {
          throw new Error('The saved query’s connection is unavailable. Select a connection and regenerate.');
        }
        const session=new AssistantSession(()=>client,secretsService!,workspaceService);
        session.bindSql(last.sql,last.connectionId,last.schemaFingerprint,last.parameters);
        const outcome=await session.execute(last.sql);if(outcome.kind!=='result')throw new Error(outcome.message||'Execution failed');
        VerbisPanel.createOrShow(context,client,workspaceService,secretsService!,()=>backendManager?.getClient()??null).openTab('analysis');
        vscode.window.showInformationMessage(`Query executed: ${outcome.result?.rowCount} rows.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Re-execution failed: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('verbis.showSchema', () => {
      if (!backendManager) return;
      VerbisPanel.createOrShow(context, backendManager.getClient(), workspaceService!, secretsService!,()=>backendManager?.getClient()??null).openTab('schema');
    }),

    vscode.commands.registerCommand('verbis.openTree', () => {
      if (!workspaceService) return;
      VerbisPanel.createOrShow(context,backendManager?.getClient()??null,workspaceService,secretsService!,()=>backendManager?.getClient()??null).openTab('tree');
    }),

    vscode.commands.registerCommand('verbis.addConnection', async () => {
      if (!workspaceService || !secretsService) return;
      VerbisPanel.createOrShow(context,backendManager?.getClient()??null,workspaceService,secretsService,()=>backendManager?.getClient()??null).openTab('connections');
    }),

    // ── Edit an existing connection: prefill the shared form, update in ──
    //    place (same id), persist, refresh, and reconnect if it was active.
    vscode.commands.registerCommand('verbis.editConnection', async (arg?: unknown) => {
      if (!workspaceService || !secretsService) return;
      const conn=await resolveConnectionArg(arg);if(!conn)return;
      VerbisPanel.createOrShow(context,backendManager?.getClient()??null,workspaceService,secretsService,()=>backendManager?.getClient()??null).editConnection(conn);
    }),

    // ── Delete a connection: confirm, remove config + secret, refresh. ──
    //    Never touches the underlying database or any files.
    vscode.commands.registerCommand('verbis.deleteConnection', async (arg?: unknown) => {
      if (!workspaceService || !secretsService) return;
      const conn = await resolveConnectionArg(arg);
      if (!conn) return;

      const confirm = await vscode.window.showWarningMessage(
        `Delete connection "${conn.name}"?\n\n` +
        `This removes only the saved Verbis connection configuration. ` +
        `It does NOT delete the underlying database or any database files.`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') return;

      if(conn.dialect!=='sqlite')await secretsService.deleteDbPassword(conn.id);
      await workspaceService.removeConnection(conn.id);
      await backendManager?.getClient()?.deleteConnection(conn.id);
      const nextActiveId=await workspaceService.getActiveConnectionId();
      if(nextActiveId){VerbisPanel.currentPanel?.setActiveConnection(nextActiveId);schemaTreeProvider.setActiveConnection(nextActiveId);}
      else await workspaceService.writeSchemaCache([]);
      await VerbisPanel.currentPanel?.pushConnections();
      schemaTreeProvider.refresh();
      connectionsProvider.refresh();
      vscode.window.showInformationMessage(`Connection "${conn.name}" deleted.`);
    }),

    vscode.commands.registerCommand('verbis.runRobustnessTest', () => {
      if (!workspaceService || !secretsService) return;
      VerbisPanel.createOrShow(context,backendManager?.getClient()??null,workspaceService,secretsService,()=>backendManager?.getClient()??null).openTab('rehearsal');
    }),

    vscode.commands.registerCommand('verbis.openWorkspace', () => {
      if (workspaceService && secretsService) VerbisPanel.createOrShow(context, backendManager?.getClient() ?? null,workspaceService,secretsService, () => backendManager?.getClient() ?? null);
    }),
    vscode.commands.registerCommand('verbis.restartBackend', async () => {
      if (!backendManager) return;
      vscode.window.showInformationMessage('Restarting Verbis backend…');
      if (!installer.isReady()) await installer.installWithProgress();
      await backendManager.restart();
    }),

    vscode.commands.registerCommand('verbis.openGlossaryEditor', () => {
      if (!workspaceService || !backendManager) return;
      VerbisPanel.createOrShow(
        context,
        backendManager.getClient(),
        workspaceService,
        secretsService!,
        ()=>backendManager?.getClient()??null
      );
      VerbisPanel.currentPanel?.openTab('glossary');
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
        terminalManager?.providerChanged();VerbisPanel.currentPanel?.providerChanged();
        if(chatgptService)VerbisPanel.currentPanel?.postMessage({type:'CHATGPT_STATUS',payload:chatgptService.snapshot()});
        VerbisPanel.currentPanel?.pushProviderSettings();
        backendManager?.getClient()?.clearIntentCache()
          ?.then(
            () => { /* cache cleared successfully */ },
            err => console.warn('[Verbis] Intent cache clear failed after provider change:', err)
          );
      }
    })
  );

  console.info('[Verbis] Extension activated successfully.');
  if (!installer.isReady()) {
    void vscode.window.showInformationMessage('Verbis needs Python 3.11–3.13 and a backend environment. Download size depends on platform.', 'Install Now', 'Later')
      .then(choice => { if(choice==='Install Now') return vscode.commands.executeCommand('verbis.installBackend'); });
  }
}

export async function deactivate(): Promise<void> {
  console.info('[Verbis] Deactivating extension…');
  await backendManager?.stop();
  chatgptService?.dispose();
}

// Generic sanity check only — no provider-specific prefix validation.
// Keys from any provider (Gemini, Claude, Kimi, OpenAI, …) are accepted.
const looksLikeApiKey = (v: string): string | null =>
    v.trim().length < 10 ? 'Key looks too short — paste the full API key' : null;

// ── Helper — reusable key prompt ─────────────────────────────────────
async function promptForKey(
    secrets: SecretsService,
    provider: 'gemini' | 'groq' | 'openrouter'
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
        },
        openrouter: {
            title: 'Verbis — OpenRouter API Key',
            prompt: 'Key from openrouter.ai/keys. Verbis accepts free model slugs only.',
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
    if (provider === 'gemini')      { await secrets.storeGeminiKey(key.trim()); }
    else if(provider === 'groq')     { await secrets.storeGroqKey(key.trim()); }
    else                            { await secrets.storeOpenRouterKey(key.trim()); }
    await vscode.workspace.getConfiguration('verbis').update('llm.provider',provider,vscode.ConfigurationTarget.Workspace);
    vscode.window.showInformationMessage(`Verbis: ${provider} key saved securely. Provider usability is verified on your next request.`);
}

// ── Connection form helper ───────────────────────────────────────────────────
// Shared input flow for Add and Edit. When `existing` is provided every field
// is pre-populated with the current values; otherwise sensible defaults are
// used. Returns the collected values, or undefined if the user cancelled.
// The password field is optional — leaving it blank keeps the current secret
// (on edit) or stores none (on add).
async function promptConnectionForm(
  existing?: import('./types').DBConfig,
  existingPassword?: string,
): Promise<{
  name: string; dialect: string; host: string; port: number;
  database: string; user: string; password?: string;
} | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: 'Connection name',
    placeHolder: 'Production Postgres',
    value: existing?.name ?? '',
    ignoreFocusOut: true,
  });
  if (!name) return undefined;

  // Put the current dialect first when editing so pressing Enter keeps it.
  const allDialects = ['postgresql', 'mysql', 'sqlite'];
  const dialectChoices = existing
    ? [existing.dialect, ...allDialects.filter(d => d !== existing.dialect)]
    : allDialects;
  const dialect = await vscode.window.showQuickPick(dialectChoices, {
    placeHolder: existing ? `Database dialect (current: ${existing.dialect})` : 'Database dialect',
    title: 'Database dialect',
  });
  if (!dialect) return undefined;

  const host = dialect === 'sqlite' ? '' : await vscode.window.showInputBox({
    prompt: 'Host',
    placeHolder: 'localhost',
    value: existing?.host ?? '',
    ignoreFocusOut: true,
  });
  if (host === undefined) return undefined;

  const portStr = dialect === 'sqlite' ? '0' : await vscode.window.showInputBox({
    prompt: 'Port',
    placeHolder: '5432',
    value: existing ? String(existing.port) : '',
    ignoreFocusOut: true,
  });
  if (portStr === undefined) return undefined;

  const database = await vscode.window.showInputBox({
    prompt: 'Database name',
    value: existing?.database ?? '',
    ignoreFocusOut: true,
  });
  if (database === undefined) return undefined;

  const user = dialect === 'sqlite' ? '' : await vscode.window.showInputBox({
    prompt: 'User',
    value: existing?.user ?? '',
    ignoreFocusOut: true,
  });
  if (user === undefined) return undefined;

  const password = dialect === 'sqlite' ? undefined : await vscode.window.showInputBox({
    prompt: existing
      ? 'Password (leave blank to keep current; stored in OS keychain, never on disk)'
      : 'Password (will be stored in OS keychain, never on disk)',
    password: true,
    ignoreFocusOut: true,
  });

  return {
    name,
    dialect,
    host,
    port: parseInt(portStr || String(existing?.port ?? 5432), 10),
    database,
    user,
    // On edit, a blank password means "keep the existing secret".
    password: password || (existing ? existingPassword : undefined),
  };
}

// ── Connection argument resolver ─────────────────────────────────────────────
// Resolves a DBConfig from a sidebar context-menu TreeItem (id "conn:<id>"),
// falling back to a QuickPick when invoked from the Command Palette.
async function resolveConnectionArg(
  arg?: unknown,
): Promise<import('./types').DBConfig | undefined> {
  if (!workspaceService) {
    vscode.window.showWarningMessage('Verbis: workspace not ready.');
    return undefined;
  }

  let connId: string | undefined;
  if (arg && typeof arg === 'object' && 'id' in arg) {
    const id = (arg as { id?: string }).id;
    if (id?.startsWith('conn:')) connId = id.slice('conn:'.length);
  }

  const cfg = await workspaceService.readConfig();
  const connections = cfg.connections ?? [];
  if (connections.length === 0) {
    vscode.window.showInformationMessage('No connections saved. Run "Verbis: Add Database Connection" first.');
    return undefined;
  }

  if (connId) {
    return connections.find(c => c.id === connId);
  }

  const picked = await vscode.window.showQuickPick(
    connections.map(c => ({
      label: c.name,
      description: c.dialect,
      detail: `${c.user}@${c.host}:${c.port}/${c.database}`,
      id: c.id,
    })),
    { title: 'Select Database Connection', placeHolder: 'Choose a connection' }
  );
  if (!picked) return undefined;
  return connections.find(c => c.id === picked.id);
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
  const activeId=await workspaceService.getActiveConnectionId();
  const conn = connections.find(c => c.id === (connId ?? activeId));

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
