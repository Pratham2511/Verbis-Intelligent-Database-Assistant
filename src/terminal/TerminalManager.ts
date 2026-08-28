// ============================================================================
// Verbis — TerminalManager
// src/terminal/TerminalManager.ts
//
// Owns the lifecycle of the Verbis assistant terminal: creates it on demand,
// reuses the existing one if it's still open, and cleans up when it closes.
// ============================================================================

import * as vscode from 'vscode';
import { VerbisTerminal } from './VerbisTerminal';
import { AssistantSession } from '../assistant/AssistantSession';
import { BackendClient } from '../services/BackendClient';
import { SecretsService } from '../services/SecretsService';
import { WorkspaceService } from '../services/WorkspaceService';
import { BackendStatus } from '../types';

export class TerminalManager implements vscode.Disposable {
  private terminal: vscode.Terminal | null = null;
  private pty: VerbisTerminal | null = null;
  private closeSubscription: vscode.Disposable | null = null;

  constructor(
    private readonly getClient: () => BackendClient | null,
    private readonly getStatus: () => BackendStatus,
    private readonly secrets: SecretsService,
    private readonly workspace: WorkspaceService,
  ) {}

  /**
   * Open the assistant terminal, focusing the existing one if present.
   * When `recallSql` is given (from Recent Queries), it is loaded into the
   * terminal as the pending executable SQL, ready to review and /run.
   */
  open(recallSql?: string): void {
    if (this.terminal) {
      // Reveal the existing terminal rather than spawning a duplicate.
      this.terminal.show();
      if (recallSql) {
        this.pty?.recallSql(recallSql);
      }
      return;
    }

    const session = new AssistantSession(this.getClient, this.secrets, this.workspace);
    const pty = new VerbisTerminal(session, this.getStatus, () => this.disposeTerminal());
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

  private disposeTerminal(): void {
    this.closeSubscription?.dispose();
    this.closeSubscription = null;
    this.pty = null;
    if (this.terminal) {
      // dispose() on an already-closed terminal is a no-op.
      this.terminal.dispose();
      this.terminal = null;
    }
  }

  dispose(): void {
    this.disposeTerminal();
  }
}
