# Verbis — Database Workspace for VS Code

Verbis generates schema-grounded SQL, runs reviewed queries, imports CSV datasets
and connects analysis results to Python/SQLAlchemy source references. Version
1.5.0 is a development build; see [the work log](docs/WORK-LOG.md) for verified
behavior and outstanding release checks.

## Start

1. Open a trusted project folder in VS Code.
2. Run **Verbis: Install / Reinstall Backend**. Python 3.11–3.13 is required.
   Installation uses pinned dependencies in an isolated environment in VS Code
   global storage. A failed reinstall preserves the previous environment.
3. Run **Verbis: Open Database Workspace**. Add and validate a SQLite,
   PostgreSQL or MySQL connection, or import a CSV in **Datasets**.
4. Choose the provider in `verbis.llm.provider`: Gemini, Groq, OpenRouter or local Ollama.
   Cloud keys can be securely saved or kept in memory for one assistant session.
   Local mode requires an OpenAI-compatible Ollama endpoint at
   `127.0.0.1:11434/v1`; it requires no cloud key.
   OpenRouter uses `thinkingmachines/inkling:free` by default. Its model setting
   accepts `:free` variants or `openrouter/free`; paid slugs are rejected before
   sending a request, and SDK retries are disabled. The [Inkling free endpoint](https://openrouter.ai/thinkingmachines/inkling:free)
   logs prompts/outputs for research and restricts use to agentic harnesses; use
   synthetic or nonconfidential requirements when testing it.
5. Ask in **Analysis**, review the SQL and its connection, then **Run reviewed
   SQL**. Follow-ups preserve prior query context. Save a named analysis with
   explicit `:named` parameters and export results or a readable report.

The terminal assistant remains available as **Verbis: Open Assistant**.
`/run`, `/cancel`, `/reset`, `/history`, `/model` and Ctrl+C are supported.
Terminal output shows at most 50 rows; the Analysis workspace paginates the
loaded result. Query result limits are configurable up to 10,000 rows.

## Available modules

| Module | First supported slice |
|---|---|
| Datasets | CSV preview, explicit column/type/date/currency/period mappings, NULL and duplicate reports, transactional create/append/replace, saved import provenance |
| Project | Static Python/SQLAlchemy models, SQL/ORM read/write references, source links, unresolved dynamic-query evidence, incremental refresh by file hashes |
| Analysis | Bound SQL, follow-ups, real results, pagination, aggregate bar charts, named parameters, schema/definition revision checks, CSV/report export |
| Forensics | Single-table predicate truth/NULL checks by primary key, common join expansion, missing join partners, ungrouped aggregate contributions |
| Rehearsal | SQLite ADD COLUMN / RENAME COLUMN on a disposable snapshot, saved-query checks, explicit expected-row assertions, source references and candidate saved-query patches |
| Reconcile | SQL plus imported CSV, exact-key matching, duplicate/NULL ambiguity, explicit annual/monthly normalization, guarded SQLite correction proposals, isolated affected-report previews and review export |
| Schema / Tree / Glossary | Live schema and ER diagram, persisted query tree, reviewed versioned business definitions used in generation |

Robustness's legacy static heuristic is labelled as a simulation. Use Rehearsal
for measured supported migration checks. Excel import, other project adapters,
group-specific aggregate forensics, richer transformations and SQL Test Lab are
later slices, not advertised as finished functionality.

## Execution and privacy

Read-only mode is on by default. The backend checks the complete SQL AST and
also enables supported database read-only controls. Mutating CTEs, SELECT INTO,
locking reads and unsafe/unknown functions are rejected. Set operations remain
available. Execution runs off the HTTP event loop with bounded fetches,
server/driver timeouts and cancellation. Use a database account with permissions
appropriate to your project.

The extension authenticates its loopback backend with a per-process token. API
keys and remote database passwords use VS Code SecretStorage; session-only keys
are discarded on close/reset/reload/provider switch. Saving a key confirms
storage; provider usability is established by a successful request, not the key's
prefix. If the OS keyring is unavailable, use the session-only flow.

Cloud generation with Privacy Shield enabled anonymizes schema identifiers,
question identifiers, glossary definitions and prior SQL before transmission.
Coarse semantic roles from conventional column names help distinguish an
organizational unit from an entity label; they do not establish salary units.
Maps are discarded after each request. Clarifications display restored names.
Dataset rows are not sent to the model.
Result and file previews mask recognized PII while preserving numeric amounts and
ordinary department labels. Detection has limits; it is not a universal PII
classifier.

Workspace state lives in `.qmind/`. Managed imported data is under
`.qmind/databases/datasets.db`; existing external database files are preserved.
Review workspace state before sharing or committing it.

## Development and verification

```bash
npm ci
npm ci --prefix webview
python3 -m venv .venv
.venv/bin/pip install -r python_backend/requirements-dev.txt
npm run compile
npm run lint
npm test
npm run typecheck:webview
npm run build:webview
.venv/bin/python -m pytest python_backend/tests -q
npm run package
```

Use Node 22+ for VSIX packaging (`@vscode/vsce` 4). CI runs the backend suite on
Python 3.11/3.12/3.13 and builds/tests the extension with Node 24. Controller tests
and controlled-provider fixtures are labelled; they do not replace installed
VS Code, OS keyring, real-provider or real database-engine acceptance tests.
