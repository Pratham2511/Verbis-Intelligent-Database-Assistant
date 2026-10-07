// ============================================================================
// Verbis — VerbisTerminal
// src/terminal/VerbisTerminal.ts
//
// A Claude Code–style conversational REPL hosted in VS Code's integrated
// terminal via the Pseudoterminal API. This class owns ONLY terminal I/O:
// keystroke handling, line editing, output formatting, and the read-eval-print
// loop. All agent intelligence lives in AssistantSession → BackendClient.
//
// Design contract (per task spec):
//  - Real terminal: cursor, typing, backspace, Enter, Ctrl+C all behave like a
//    normal interactive CLI.
//  - One input at a time: while a request is in flight, further Enter presses
//    are ignored (with a notice); Ctrl+C cancels.
//  - Slash commands are handled locally and never reach the backend.
//  - Output is plain text with conservative ANSI color; no control sequences
//    that could corrupt the terminal.
// ============================================================================

import * as vscode from 'vscode';
import { AssistantSession, AssistantReply, ExecuteOutcome } from '../assistant/AssistantSession';
import { BackendStatus } from '../types';

// ─── ANSI helpers (conservative, widely-supported SGR codes only) ─────────
const ESC = '\u001b';
const ANSI = {
  reset:   `${ESC}[0m`,
  bold:    `${ESC}[1m`,
  dim:     `${ESC}[2m`,
  italic:  `${ESC}[3m`,
  fgCyan:  `${ESC}[36m`,
  fgGreen: `${ESC}[32m`,
  fgYellow:`${ESC}[33m`,
  fgRed:   `${ESC}[31m`,
  fgGray:  `${ESC}[90m`,
};

const c = (code: string, s: string) => `${code}${s}${ANSI.reset}`;

const PROMPT = `${c(ANSI.fgCyan + ANSI.bold, 'verbis')} ${c(ANSI.fgGray, '›')} `;
const MAX_RESULT_ROWS = 50;   // truncate large result sets
const MAX_CELL_WIDTH  = 40;   // truncate wide cells

export class VerbisTerminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  private inputBuffer = '';
  private lastSql: string | null = null;
  private disposed = false;

  constructor(
    private readonly session: AssistantSession,
    private readonly getStatus: () => BackendStatus,
    private readonly onExit: () => void,
  ) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  open(): void {
    this.printBanner();
    // Restore the active persisted conversation so chat survives close/reopen.
    // Fail-safe: resolves to 0 when nothing is stored.
    void this.session.restoreLastSession().then(restored => {
      this.lastSql = this.session.restoredSql ?? this.lastSql;
      if (restored > 0) {
        this.renderRestoredTranscript();
        this.writeln(c(ANSI.fgGray,
          `— Restored your last conversation (${restored} turn${restored === 1 ? '' : 's'}). ` +
          `/history for all · /reset for a new chat —`));
        this.writeln('');
      }
      this.prompt();
    }).catch(e=>{this.writeln(`Conversation restore failed: ${e.message}`);this.prompt()});
  }

  /**
   * Render the restored transcript so the user actually sees their prior
   * conversation (not just a notice). Bounded to the most recent turns to
   * keep reopening fast; /history shows the full log.
   */
  private renderRestoredTranscript(): void {
    const MAX_RENDER = 20;
    const t = this.session.transcript;
    const shown = t.slice(-MAX_RENDER);
    if (t.length > shown.length) {
      this.writeln(c(ANSI.fgGray, `(… ${t.length - shown.length} earlier turns hidden — /history to see all)`));
    }
    for (const turn of shown) {
      if (turn.role === 'user') {
        this.writeln(`${c(ANSI.fgCyan + ANSI.bold, 'you')} ${c(ANSI.fgGray, '›')} ${turn.content}`);
      } else {
        this.writeln(`${c(ANSI.fgGreen + ANSI.bold, 'verbis')} ${c(ANSI.fgGray, '›')} ${turn.content}`);
      }
    }
    this.writeln('');
  }

  providerChanged(){this.session.cancel();this.session.discardSessionKey();}

  close(): void {
    this.disposed = true;
    this.session.cancel();
    // Discard any session-only API key when the terminal closes.
    this.session.discardSessionKey();
  }

  /**
   * Load a recalled SQL statement (from Recent Queries) as the pending
   * executable SQL and show it, so the user can review and /run it directly.
   */
  recallSql(sql: string, connectionId?: string,parameters?:Record<string,unknown>,schemaFingerprint?:string): void {
    if (connectionId) this.session.bindSql(sql, connectionId,schemaFingerprint,parameters);
    this.lastSql = sql;
    this.writeln(c(ANSI.fgGray, 'Recalled query from Recent Queries:'));
    this.writeln(c(ANSI.fgCyan, sql));
    this.writeln(c(ANSI.fgGray, 'Type /run to execute it, or ask a new question.'));
    this.writeln('');
    this.prompt();
  }

  // ─── Input handling (keystroke-level, like a real CLI) ─────────────────

  private cursor = 0;
  private escapeBuffer = '';
  private inputHistory: string[] = [];
  private historyCursor = 0;
  private redraw(): void {
    this.write(`\r${ESC}[2K${PROMPT}${this.inputBuffer}`);
    const tail = Array.from(this.inputBuffer).length - this.cursor;
    if (tail) this.write(`${ESC}[${tail}D`);
  }
  handleInput(data: string): void {
    if (this.disposed) return;
    for (const ch of data) {
      if (ch === '\x03') {
        this.session.cancel(); this.inputBuffer = ''; this.cursor = 0;
        this.writeln('^C'); if (!this.session.isBusy) this.prompt(); continue;
      }
      if (ch === ESC || this.escapeBuffer) {
        this.escapeBuffer += ch;
        if (this.escapeBuffer === ESC || (this.escapeBuffer.startsWith(ESC+'[')&&Array.from(this.escapeBuffer.slice(2)).every(c=>'0123456789;'.includes(c)))) continue;
        const seq = this.escapeBuffer; this.escapeBuffer = '';
        if (seq === `${ESC}[D`) this.cursor = Math.max(0,this.cursor-1);
        else if (seq === `${ESC}[C`) this.cursor = Math.min(Array.from(this.inputBuffer).length,this.cursor+1);
        else if ([`${ESC}[H`,`${ESC}[1~`].includes(seq)) this.cursor=0;
        else if ([`${ESC}[F`,`${ESC}[4~`].includes(seq)) this.cursor=Array.from(this.inputBuffer).length;
        else if (seq === `${ESC}[3~`) { const chars=Array.from(this.inputBuffer);chars.splice(this.cursor,1);this.inputBuffer=chars.join(''); }
        else if (seq === `${ESC}[A` || seq === `${ESC}[B`) {
          this.historyCursor=Math.max(0,Math.min(this.inputHistory.length,this.historyCursor+(seq.endsWith('A')?-1:1)));
          this.inputBuffer=this.inputHistory[this.historyCursor]??'';this.cursor=Array.from(this.inputBuffer).length;
        }
        this.redraw(); continue;
      }
      if (ch === '\r' || ch === '\n') {
        const line=this.inputBuffer;this.inputBuffer='';this.cursor=0;
        if(this.session.isBusy){if(line.trim()==='/cancel')this.session.cancel();else this.writeln('Working — /cancel or Ctrl+C.');continue;}
        if(line.trim())this.inputHistory.push(line);this.historyCursor=this.inputHistory.length;
        this.writeln('');void this.evaluate(line);continue;
      }
      const chars=Array.from(this.inputBuffer);
      if(ch==='\x7f'||ch==='\b'){if(this.cursor>0)chars.splice(--this.cursor,1);}
      else if(ch>=' '){chars.splice(this.cursor++,0,ch);}
      else continue;
      this.inputBuffer=chars.join('');this.redraw();
    }
  }

  // ─── Read-Eval-Print Loop ───────────────────────────────────────────────

  private async evaluate(line: string): Promise<void> {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      this.prompt();
      return;
    }

    // Slash commands are handled locally — never sent to the backend.
    if (trimmed.startsWith('/')) {
      await this.handleCommand(trimmed);
      return;
    }

    // Regular natural-language turn → existing agent pipeline.
    this.lastSql = null;
    const reply = await this.session.ask(trimmed);
    this.renderReply(reply);
    this.prompt();
  }

  private renderReply(reply: AssistantReply): void {
    switch (reply.kind) {
      case 'sql': {
        // SQL was actually generated — store it and show it before /run guidance.
        if (reply.sql) {
          this.lastSql = reply.sql;
          this.writeln(`${c(ANSI.fgGreen, '✓')} ${c(ANSI.fgGray, 'SQL generated')}`);
          this.writeln(c(ANSI.fgCyan, '── SQL ────────────────────────────────'));
          this.writeln(this.indent(this.highlightSql(reply.sql)));
          this.writeln(c(ANSI.fgCyan, '────────────────────────────────────────'));
          this.writeln('');
        }
        if (reply.explanation) {
          this.writeln(c(ANSI.dim, this.indent(reply.explanation)));
          this.writeln('');
        }
        if (reply.message) {
          this.writeln(c(ANSI.fgGray, reply.message));
        }
        if (reply.alternatives && reply.alternatives.length > 0) {
          this.writeln(c(ANSI.fgGray, `${reply.alternatives.length} alternative interpretation(s) available.`));
        }
        // Only offer /run when there is real executable SQL stored.
        if (reply.sql) {
          this.writeln(c(ANSI.fgGray, 'Type /run to execute, or keep chatting.'));
        }
        break;
      }
      case 'offtopic':
        // Scope rejection — polite refusal, no fake confidence, no /run guidance.
        this.writeln(`${c(ANSI.fgYellow, '◇')} ${c(ANSI.fgYellow, reply.message
          ?? 'Verbis is restricted to database/SQL-related assistance.')}`);
        break;
      case 'message':
        if (reply.message) { this.writeln(reply.message); }
        break;
      case 'error':
        this.writeln(`${c(ANSI.fgRed, '✗')} ${c(ANSI.fgRed, reply.message ?? 'Unknown error')}`);
        break;
      case 'cancelled':
        this.writeln(c(ANSI.fgYellow, 'Cancelled.'));
        break;
    }
  }

  // ─── Slash commands (local only) ────────────────────────────────────────

  private async handleCommand(input: string): Promise<void> {
    const [cmd, ...rest] = input.split(/\s+/);
    const arg = rest.join(' ');

    switch (cmd.toLowerCase()) {
      case '/help':
        this.printHelp();
        break;

      case '/clear':
        // Clear scrollback + screen, then redraw the prompt. This is a
        // DISPLAY-ONLY operation: it must NOT delete the persisted
        // conversation or Recent Queries — reopening the assistant restores
        // the conversation exactly as it was.
        this.write(`${ESC}[2J${ESC}[3J${ESC}[H`);
        this.prompt();
        return; // prompt already printed

      case '/status':
        this.printStatus();
        break;

      case '/model': {
        const snap = await this.session.getStatusSnapshot();
        this.writeln(`  ${c(ANSI.fgGray, '◇')} ${c(ANSI.fgGray, 'provider'.padEnd(9))} ${snap.provider}`);
        this.writeln(`  ${c(ANSI.fgGray, '◇')} ${c(ANSI.fgGray, 'model'.padEnd(9))} ${snap.model}`);
        this.writeln(c(ANSI.fgGray, 'Change via "Verbis: Set API Key" or the verbis.llm.provider / model settings.'));
        break;
      }

      case '/history':
        this.printHistory();
        break;

      case '/reset':
        // Start a NEW conversation. The current one is archived (kept
        // resumable) — /reset never deletes prior chat or Recent Queries.
        this.session.reset();
        this.lastSql = null;
        this.writeln(c(ANSI.fgGreen, 'Started a new conversation. Your previous chats are saved.'));
        break;

      case '/cancel':
        if (this.session.isBusy) {
          this.session.cancel();
          this.writeln(c(ANSI.fgYellow, 'Cancelling…'));
        } else {
          this.writeln(c(ANSI.fgGray, 'Nothing in flight.'));
        }
        break;

      case '/run':
        if (arg.length > 0) {
          // /run does not take a natural-language argument — it only executes
          // the most recently generated SQL.
          this.writeln(c(ANSI.fgYellow,
            '/run executes the most recently generated SQL. Ask your question first, then run /run.'));
          this.prompt();
          return;
        }
        await this.runLastSql();
        return; // runLastSql prints the prompt when done

      case '/exit':
        this.writeln(c(ANSI.fgGray, 'Closing Verbis assistant…'));
        this.onExit();
        return;

      default:
        this.writeln(c(ANSI.fgRed, `Unknown command: ${cmd}`));
        this.writeln(c(ANSI.fgGray, 'Type /help for available commands.'));
    }
    this.prompt();
  }

  private async runLastSql(): Promise<void> {
    if (!this.lastSql) {
      this.writeln(c(ANSI.fgGray, 'No SQL to run yet — ask a question first.'));
      this.prompt();
      return;
    }
    // Client-side write-operation hint (the backend is the real enforcer). This
    // only affects how we PRESENT the outcome — never whether it runs.
    const isWrite = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE)\b/i
      .test(this.lastSql);
    if (isWrite && this.session.readOnlyMode) {
      this.writeln(`${c(ANSI.fgYellow, '⚠')} ${c(ANSI.fgYellow, 'Write operation detected')}`);
    }
    this.writeln(c(ANSI.fgGray, 'Executing…'));
    const outcome: ExecuteOutcome = await this.session.execute(this.lastSql);
    if (outcome.kind === 'result' && outcome.result) {
      this.printResultTable(outcome.result);
    } else if (outcome.kind === 'cancelled') {
      this.writeln(c(ANSI.fgYellow, 'Execution cancelled.'));
    } else {
      const msg = outcome.message ?? 'Execution failed';
      // Present read-only blocks distinctly from generic errors.
      if (/read-only|write queries are blocked/i.test(msg)) {
        this.writeln(`${c(ANSI.fgRed, '✗')} ${c(ANSI.fgRed, 'Execution blocked')}`);
        this.writeln(c(ANSI.fgGray, `  ${msg}`));
      } else {
        this.writeln(`${c(ANSI.fgRed, '✗')} ${c(ANSI.fgRed, 'Query failed')}`);
        this.writeln(c(ANSI.fgGray, `  ${msg}`));
      }
    }
    this.prompt();
  }

  // ─── Output rendering ───────────────────────────────────────────────────

  private printBanner(): void {
    const status = this.getStatus();
    const dot = status.state === 'ready'
      ? c(ANSI.fgGreen, '●')
      : status.state === 'starting'
        ? c(ANSI.fgYellow, '●')
        : c(ANSI.fgRed, '●');

    this.writeln(c(ANSI.fgCyan, '╭─────────────────────────────────────────────────────────╮'));
    this.writeln(c(ANSI.fgCyan, '│') + c(ANSI.bold + ANSI.fgCyan, '  Verbis Assistant') + c(ANSI.fgCyan, '                                         │'));
    this.writeln(c(ANSI.fgCyan, '│') + c(ANSI.fgGray, '  Ask questions in plain English — Verbis writes the SQL') + c(ANSI.fgCyan, '  │'));
    this.writeln(c(ANSI.fgCyan, '╰─────────────────────────────────────────────────────────╯'));
    this.writeln(`  ${dot} ${c(ANSI.fgGray, `backend ${status.state}`)}`);
    // Live status lines (provider/model/connection/schema/mode) are rendered
    // asynchronously from current state — never hardcoded.
    void this.renderStatusLines();
    this.writeln(c(ANSI.fgGray, '  /help commands · Ctrl+C cancel · /exit close'));
    this.writeln('');
  }

  /**
   * Render the live status block (connection, dialect, schema, provider, model,
   * mode). Everything is read from current app state via getStatusSnapshot(), so
   * it reflects provider/model/connection/schema/mode changes immediately.
   */
  private async renderStatusLines(): Promise<void> {
    const snap = await this.session.getStatusSnapshot();
    const line = (label: string, value: string) =>
      this.writeln(`  ${c(ANSI.fgGray, '◇')} ${c(ANSI.fgGray, label.padEnd(11))} ${value}`);

    if (snap.connectionName || snap.dialect) {
      const conn = [snap.connectionName, snap.dialect ? c(ANSI.fgGray, `(${snap.dialect})`) : '']
        .filter(Boolean).join(' ');
      line('Connection', conn);
    }
    if (snap.database) {
      line('Database', snap.database);
    }
    if (snap.tableCount !== undefined) {
      const cols = snap.columnCount !== undefined ? ` · ${snap.columnCount} columns` : '';
      line('Schema', `${snap.tableCount} table(s)${cols}`);
    }
    line('AI Provider', snap.provider);
    line('Model', snap.model);
    line('Mode', snap.readOnly
      ? c(ANSI.fgGreen, 'Read-only')
      : c(ANSI.fgYellow, 'Write enabled'));
  }

  private printHelp(): void {
    const rows: Array<[string, string]> = [
      ['/help',   'Show this help'],
      ['/run',    'Execute the last generated SQL'],
      ['/status', 'Show backend + session status'],
      ['/model',  'Show the active LLM provider + model'],
      ['/history','Show this conversation\'s turns'],
      ['/clear',  'Clear the screen (chat + Recent Queries kept)'],
      ['/reset',  'Start a new conversation (previous chats kept)'],
      ['/cancel', 'Cancel the in-flight request'],
      ['/exit',   'Close the assistant'],
    ];
    this.writeln(c(ANSI.fgCyan, '── Commands ────────────────────────────'));
    for (const [cmd, desc] of rows) {
      this.writeln(`  ${c(ANSI.fgCyan, cmd.padEnd(10))} ${c(ANSI.fgGray, desc)}`);
    }
    this.writeln('');
    this.writeln(c(ANSI.fgGray, 'Anything else is sent to the Verbis agent as a question.'));
  }

  private printStatus(): void {
    const s = this.getStatus();
    const dot = s.state === 'ready'
      ? c(ANSI.fgGreen, '●')
      : s.state === 'starting'
        ? c(ANSI.fgYellow, '●')
        : c(ANSI.fgRed, '●');
    this.writeln(c(ANSI.fgCyan, '── Status ──────────────────────────────'));
    this.writeln(`  ${dot} ${c(ANSI.fgGray, 'backend')}    ${s.state}${s.port ? c(ANSI.fgGray, ` (port ${s.port})`) : ''}`);
    // Live connection/provider/model/schema/mode lines from current state.
    void this.renderStatusLines();
    this.writeln(`  ${c(ANSI.fgGray, '◇')} ${c(ANSI.fgGray, 'credential'.padEnd(11))} ${this.session.credentialSourceLabel}`);
    this.writeln(`  ${c(ANSI.fgGray, '◇')} ${c(ANSI.fgGray, 'session'.padEnd(11))} ${this.session.id.slice(0, 8)}… · ${this.session.transcript.length} turn(s)`);
    this.writeln(`  ${c(ANSI.fgGray, '◇')} ${c(ANSI.fgGray, 'busy'.padEnd(11))} ${this.session.isBusy ? 'yes' : 'no'}`);
  }

  private printHistory(): void {
    const t = this.session.transcript;
    if (t.length === 0) {
      this.writeln(c(ANSI.fgGray, 'No history yet.'));
      return;
    }
    this.writeln(c(ANSI.bold, 'Conversation:'));
    for (const entry of t.slice(-20)) {
      const who = entry.role === 'user' ? c(ANSI.fgCyan, 'you') : c(ANSI.fgGreen, 'verbis');
      const snippet = entry.content.length > 80
        ? entry.content.slice(0, 77) + '…'
        : entry.content;
      this.writeln(`  ${who}: ${snippet}`);
    }
  }

  private printResultTable(r: import('../types').ExecutionResult): void {
    this.writeln(`${c(ANSI.fgGreen, '✓')} ${c(ANSI.fgGray, `${r.rowCount} row(s) in ${r.executionTimeMs} ms`)}`);
    if (r.columns.length === 0) {
      this.writeln(c(ANSI.fgGray, '  (no columns returned)'));
      return;
    }
    if (r.rowCount === 0) {
      this.writeln(c(ANSI.fgGray, '  (0 rows)'));
      return;
    }

    const rows = r.rows.slice(0, MAX_RESULT_ROWS);
    // Dynamic column widths from actual content, capped for readability.
    const widths = r.columns.map(col =>
      Math.min(
        MAX_CELL_WIDTH,
        Math.max(col.length, ...rows.map(row => this.cellText(row[col]).length)),
      ),
    );
    const trunc = (text: string, w: number) =>
      text.length > w ? text.slice(0, w - 1) + '…' : text.padEnd(w);

    const top = '┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐';
    const mid = '├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤';
    const bot = '└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘';

    this.writeln(c(ANSI.fgGray, top));
    this.writeln(
      c(ANSI.fgGray, '│') +
      r.columns.map((col, i) => ' ' + c(ANSI.bold, trunc(col, widths[i])) + ' ').join(c(ANSI.fgGray, '│')) +
      c(ANSI.fgGray, '│'),
    );
    this.writeln(c(ANSI.fgGray, mid));
    for (const row of rows) {
      this.writeln(
        c(ANSI.fgGray, '│') +
        r.columns.map((col, i) => {
          const text = this.cellText(row[col]);
          const rendered = text === 'NULL' ? c(ANSI.fgGray, trunc(text, widths[i])) : trunc(text, widths[i]);
          return ' ' + rendered + ' ';
        }).join(c(ANSI.fgGray, '│')) +
        c(ANSI.fgGray, '│'),
      );
    }
    this.writeln(c(ANSI.fgGray, bot));

    if (r.rowCount > MAX_RESULT_ROWS) {
      this.writeln(c(ANSI.fgGray, `  … ${r.rowCount - MAX_RESULT_ROWS} more row(s) truncated`));
    }
    if (r.truncated) {
      this.writeln(c(ANSI.fgYellow, '  ⚠ result truncated by row limit'));
    }
  }

  private cellText(v: unknown): string {
    if (v === null || v === undefined) { return 'NULL'; }
    if (typeof v === 'object') { return JSON.stringify(v); }
    return String(v);
  }

  private highlightSql(sql: string): string {
    // Very light keyword highlighting; safe because we only add SGR codes.
    return sql.replace(
      /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|GROUP BY|ORDER BY|LIMIT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|AND|OR|NOT|NULL|AS|ON|IN|EXISTS|BETWEEN|LIKE|HAVING|UNION)\b/gi,
      m => c(ANSI.fgCyan, m.toUpperCase()),
    );
  }

  private indent(s: string): string {
    return s.split('\n').map(l => `  ${l}`).join('\r\n');
  }

  // ─── Low-level output ───────────────────────────────────────────────────

  private prompt(): void {
    this.write(`\r\n${PROMPT}`);
  }

  private writeln(s: string): void {
    // Normalize to CRLF — terminals expect \r\n for new lines.
    this.write(s.replace(/\r?\n/g, '\r\n') + '\r\n');
  }

  private write(s: string): void {
    if (!this.disposed) {
      this.writeEmitter.fire(s);
    }
  }
}
