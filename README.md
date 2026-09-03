# Verbis — Intelligent Database Assistant (VS Code Extension)

**Publisher:** pratham2511 · **License:** MIT
**Repository:** https://github.com/Pratham2511/Verbis-Intelligent-Database-Assistant

Verbis is an AI database assistant that lives inside VS Code. You ask questions in plain English; Verbis generates optimized SQL (or NoSQL), explains the results, tracks query history, and protects your data — without leaving your workspace.

The conversational interface is a **terminal-based assistant** hosted in VS Code's integrated terminal (a Claude Code–style REPL). A Python FastAPI backend runs on `127.0.0.1` and does all the heavy lifting (schema introspection, SQL generation, execution, privacy).

The default LLM provider is **Google Gemini** (`gemini-3.6-flash`, free tier available — see [Get a free API key](https://aistudio.google.com/app/apikey)). **Groq** and **Ollama (local, offline)** are also supported. Your API key is stored in the OS keychain via VS Code SecretStorage and is **never written to any file on disk**.

---

## Features

- **Natural-language → SQL / NoSQL.** Ask a question, get a precise, dialect-aware query with a confidence score.
- **Terminal assistant.** A fast REPL in the integrated terminal with slash commands, cancellation, and per-session conversation context.
- **Generate vs. execute stay distinct.** Verbis generates SQL; you explicitly run it with `/run` (row limits, read-only guard, history logging apply).
- **SQL/database scope guard.** Off-topic requests (jokes, poems, weather) are rejected before any LLM call; obvious database questions are fast-pathed.
- **Text2Schema.** Describe a system in plain English ("a school management app with students, teachers, courses…") and Verbis produces a normalized schema, DDL, and a live ER diagram, then iteratively refines it.
- **Schema explorer + ER diagram.** Browse your live schema and an auto-generated Mermaid ER diagram.
- **Query tree (DAG).** Visualize and branch your query history with ReactFlow.
- **Business glossary.** Define terms once ("MRR", "active user") and reuse them across queries.
- **Privacy Shield + PII masking.** Schema names are anonymized before reaching a cloud LLM; result PII is masked and audit-logged.
- **Multi-database.** PostgreSQL, MySQL, and SQLite are fully supported for live connection, introspection, and execution. (MongoDB appears as a connection option but is not yet wired for live execution.) Switch connections from the sidebar or a quick-pick.

---

## Installation

### From the Marketplace / `.vsix` (end users)

1. Install the extension.
2. On first activation Verbis offers to **auto-install the Python backend** — it creates a venv in the extension's global storage (~120 MB, ~60 s, using `uv` when available, falling back to `pip`). You do **not** need to install Python dependencies manually.
3. When prompted, set your LLM API key (see below).

### From source (development)

Prerequisites: **Node.js 20+**, **Python 3.11+**, **VS Code 1.85+**.

```bash
git clone https://github.com/Pratham2511/Verbis-Intelligent-Database-Assistant.git
cd Verbis-Intelligent-Database-Assistant

npm install                 # extension host
cd webview && npm install && cd ..   # webview (React)

# Python backend — only needed for local dev (end users get the auto-installer)
cd python_backend && pip install -r requirements.txt && cd ..
```

---

## Quick start

1. **Build** (from source):
   ```bash
   cd webview && npm run build && cd ..   # produces webview/dist/
   npm run compile                        # produces out/
   ```
2. **Run:** open the folder in VS Code and press `F5` to launch an Extension Development Host. (End users: just install the `.vsix`.)
3. **Set your API key** when prompted, or run **`Verbis: Set API Key`**.
4. **Add a database connection** with **`Verbis: Add Database Connection`** (optional — needed only for live execution).
5. **Open the assistant** with `Ctrl+Shift+Q` / `Cmd+Shift+Q` and ask a question.

---

## How to open and use Verbis Assistant

The assistant runs in the VS Code **integrated terminal**.

- **Open:** `Verbis: Open Assistant` from the Command Palette, or press `Ctrl+Shift+Q` / `Cmd+Shift+Q`. Re-running it focuses the existing assistant terminal instead of spawning duplicates.
- **Type** a natural-language database question and press **Enter**. Verbis displays the generated SQL before showing its confidence score and `/run` guidance.
- **Run** the most recently generated SQL with `/run`. `/run` does not accept a natural-language argument; ask the question first, then run `/run`.
- **Cancel** an in-flight request with `Ctrl+C` (or `/cancel`). When idle, `Ctrl+C` clears the current line.
- **One request at a time:** while Verbis is working, further Enter presses are ignored with a notice.

Generation and execution are separate: asking a question never runs SQL against your database. Execution only happens when you explicitly invoke `/run`, and it goes through the existing safe-execution path (row limit, timeout, read-only guard, history logging).

### Terminal slash commands

Slash commands are handled locally in the terminal — they never reach the backend or the LLM.

| Command | Action |
|---------|--------|
| `/help`   | Show the help text |
| `/run`    | Execute the last generated SQL |
| `/status` | Show backend + session status |
| `/model`  | Show the active LLM provider |
| `/history`| Show this conversation's turns |
| `/clear`  | Clear the screen |
| `/reset`  | Start a new conversation (fresh session id) |
| `/cancel` | Cancel the in-flight request |
| `/exit`   | Close the assistant |

Conversation context is preserved per terminal via a stable `sessionId` sent to the backend on every turn; `/reset` starts a fresh session.

---

## Database workflow

1. **Connect.** `Verbis: Add Database Connection` opens a wizard (host, port, database, credentials). Passwords go to the OS keychain; the new connection becomes active automatically. Switch later with `Verbis: Select Database Connection` or from the **Connections** view in the Verbis sidebar.
   - **Edit / Delete a connection.** Right-click a connection in the **Connections** sidebar (or run `Verbis: Edit Database Connection` / `Verbis: Delete Database Connection`) to update its details or remove it. Editing prefills the existing values and keeps the same connection; leaving the password blank keeps the stored one. Deleting removes the connection from Verbis and its stored password — it does **not** delete the underlying database or any database files.
2. **Inspect schema.** `Verbis: Show Schema & ER Diagram` (`Ctrl+Alt+S` / `Cmd+Alt+S`) opens the schema explorer and ER diagram. The backend introspects your live schema and indexes it locally (ChromaDB) so generated SQL only references real tables/columns.
3. **Ask.** In the assistant terminal, ask in plain English. Verbis retrieves the relevant schema, generates SQL, and returns it with a confidence score.
4. **Run.** `/run` executes the statement against the active connection. Results render in a paginated grid; the query is appended to your history (see the **Recent Queries** view).
5. **Create a schema (optional).** Describe a new system in natural language; Verbis generates schema JSON → DDL → ER diagram, refines it iteratively, and can execute the DDL on your database.

---

## LLM and API configuration

Verbis supports three providers, selected with the `verbis.llm.provider` setting:

| Provider | Setting value | Default model | Notes |
|----------|---------------|---------------|-------|
| Google Gemini (default) | `gemini` | `gemini-3.6-flash` | Free tier at [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| Groq | `groq` | `llama-3.3-70b-versatile` | Fast cloud alternative |
| Ollama (local) | `local` | `sqlcoder:latest` | Fully offline; no API key needed |

The model actually sent to the provider is the value of the corresponding model setting (`verbis.llm.geminiModel` or `verbis.llm.groqModel`), forwarded per-request to the backend. For `local`, the backend uses its own Ollama model.

> **Gemini model note.** Google retired `gemini-2.5-flash` and earlier 2.x/1.x models for new users. Verbis defaults to `gemini-3.6-flash`. If you have an older model explicitly set in `verbis.llm.geminiModel`, Verbis shows a one-time warning and the backend returns a clear, actionable error telling you which setting to update — your setting is never changed for you.

### Configuration settings

| Setting | Values | Default |
|---------|--------|---------|
| `verbis.llm.provider` | `gemini` \| `groq` \| `local` | `gemini` |
| `verbis.llm.geminiModel` | any Gemini model tag | `gemini-3.6-flash` |
| `verbis.llm.groqModel` | any Groq model tag | `llama-3.3-70b-versatile` |
| `verbis.privacy.enableShield` | `true` \| `false` | `true` |
| `verbis.query.rowLimit` | `10`–`10000` | `500` |
| `verbis.execution.timeoutSeconds` | int (seconds) | `60` |
| `verbis.execution.readOnlyByDefault` | `true` \| `false` | `true` |
| `verbis.backend.startPort` | int | `8765` |

### Local (offline) mode

```bash
# Install Ollama from https://ollama.com, then:
ollama pull sqlcoder
ollama serve
```

Set `verbis.llm.provider` to `local`. No API key is required.

---

## API key behavior

Verbis needs an LLM API key to generate queries (except in `local` mode). Keys are stored in the **OS keychain** via VS Code SecretStorage — never in `.qmind/`, `config.json`, or any file on disk. The backend receives the key **per-request** in the `/api/generate` body, uses it for one LLM call, and discards it.

You can set a key three ways:

- **First-run prompt** — click **Set API Key** on the welcome message.
- **Command Palette** — `Verbis: Set API Key` (choose `gemini` or `groq`, then paste).
- **Webview settings** — the API Keys card in the Verbis panel.

Remove a key with `Verbis: Remove API Key` (confirmation required).

### Existing key vs. session-specific key

The first time you ask a question in a session, Verbis asks how to authenticate:

- **Existing configured key** — use the key stored in the OS keychain.
- **Session-specific key** — paste a key held **only in memory** for this session. It is never saved and is discarded on `/reset`, `/exit`, terminal close, or window reload.
- **Manage keys…** — jump to the key-setting command.

Cancelling aborts the request — a stored key is never consumed silently. `/status` shows which credential source is active (without revealing the key).

---

## SQL/database scope restriction

Verbis only answers database questions. A two-layer guard runs before any SQL generation:

1. **Deterministic pre-filter** — obvious off-topic requests (jokes, poems, weather, greetings, and general chit-chat) are rejected instantly with zero API cost; obvious database questions skip the classifier entirely.
2. **Few-shot LLM classifier** — ambiguous input falls through to a lightweight classifier. It **fails open** (treats input as database-related) so a valid query is never blocked by a classifier hiccup.

Off-topic requests get a polite refusal and produce no SQL and no LLM generation cost. Classifications are cached (200-entry LRU) and the cache is cleared automatically when you set/clear an API key or switch provider.

---

## Commands

| Command | Purpose | Keybinding |
|---------|---------|------------|
| `Verbis: Open Assistant` | Open the assistant terminal | `Ctrl+Shift+Q` / `Cmd+Shift+Q` |
| `Verbis: Run Last Query` | Re-execute the most recent saved query | `Ctrl+Shift+R` / `Cmd+Shift+R` |
| `Verbis: Show Schema & ER Diagram` | Open the schema explorer panel | `Ctrl+Alt+S` / `Cmd+Alt+S` |
| `Verbis: Open Query Tree` | Open the ReactFlow DAG of query history | `Ctrl+Alt+T` / `Cmd+Alt+T` |
| `Verbis: Set API Key` | Set or replace your Gemini / Groq key | — |
| `Verbis: Remove API Key` | Remove the stored key from the OS keychain | — |
| `Verbis: Add Database Connection` | New connection wizard | — |
| `Verbis: Edit Database Connection` | Edit an existing connection (prefilled) | — |
| `Verbis: Delete Database Connection` | Remove a connection (does not delete the database) | — |
| `Verbis: Select Database Connection` | Quick-pick to switch the active connection | — |
| `Verbis: Install / Reinstall Backend` | Manually trigger Python venv setup | — |
| `Verbis: Restart Python Backend` | Restart the FastAPI subprocess | — |
| `Verbis: Run Schema Evolution Robustness Test` | EvoSchema perturbation suite | — |
| `Verbis: Open Business Glossary Editor` | Glossary CRUD UI | — |

The Verbis activity-bar container also provides **Connections**, **Schema**, and **Recent Queries** sidebar views.

---

## Development

```bash
npm run compile          # TypeScript → out/
npm run watch            # TypeScript (watch)
npm run build:webview    # React webview → webview/dist/
npm run watch:webview    # webview (watch)
npm run lint             # eslint
npm test                 # vitest (unit)
npm run package          # vsce package --no-yarn → .vsix
```

Python backend tests:

```bash
cd python_backend
pytest -v
```

### Repository layout

```
├── package.json              # Extension manifest
├── src/                      # Extension host (TypeScript)
│   ├── extension.ts          # Activation + command registration
│   ├── BackendManager.ts     # Python subprocess lifecycle
│   ├── assistant/AssistantSession.ts   # UI-independent conversation controller
│   ├── terminal/             # Pseudoterminal REPL + terminal lifecycle
│   ├── panels/               # Webview panels (schema, query tree, main)
│   ├── services/             # BackendClient, SecretsService, WorkspaceService, …
│   └── views/                # Sidebar tree providers
├── webview/                  # React app (Vite)
└── python_backend/           # FastAPI backend (Python 3.11+)
    ├── main.py
    ├── config.py
    ├── api/routes/           # /api/generate, /api/execute, /api/schema, …
    ├── models/requests.py
    └── services/             # llm_service, intent_service, sql_generator, …
```

---

## Troubleshooting

- **"The configured Gemini model '…' is no longer available."** Google retired that model. Set `verbis.llm.geminiModel` to `gemini-3.6-flash` (the default) or another supported model, then retry.
- **"No valid API key for the selected provider."** Run `Verbis: Set API Key`, or choose a session key when prompted.
- **Backend won't start / 404s.** Run `Verbis: Restart Python Backend`. If it persists, run `Verbis: Install / Reinstall Backend` to rebuild the venv.
- **Off-topic questions are refused.** That's by design — Verbis only handles database/SQL requests. See the scope-restriction section.
- **Local mode does nothing.** Make sure `ollama serve` is running and you've pulled the model (`ollama pull sqlcoder`).

---

## Security model

- **Credentials never on disk.** API keys and DB passwords live only in VS Code SecretStorage (OS keychain).
- **Per-request keys.** The backend receives the API key in the request body, uses it once, and discards it.
- **Localhost only.** The backend binds to `127.0.0.1` and refuses non-loopback requests.
- **Read-only by default.** `INSERT`/`UPDATE`/`DELETE`/`DROP` are rejected unless `verbis.execution.readOnlyByDefault` is `false`.
- **Row limit + timeout.** 500 rows / 60 s by default (configurable).
- **Privacy Shield + PII masking.** Schema anonymization before cloud LLM calls; result PII masked and audit-logged.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT. See [LICENSE](./LICENSE) for details.

---

## Changelog

Per-version changes are recorded in [CHANGELOG.md](./CHANGELOG.md).
