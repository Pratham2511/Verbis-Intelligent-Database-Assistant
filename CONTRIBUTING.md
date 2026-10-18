# Developing Verbis

Use Node 24 and Python 3.11–3.13. Open a disposable project for testing. The
extension runs Python from an isolated environment; your development test venv
is separate. No real provider key is needed for the automated suites.

## Install and check

Run from the repository root:

```bash
npm ci
npm ci --prefix webview
python3 -m venv .venv
.venv/bin/python -m pip install -r python_backend/requirements-dev.txt
npm run compile
npm run lint
npm test
npm run typecheck:webview
npm run build:webview
.venv/bin/python -m pytest python_backend/tests -q
npm run package
```

On Windows use `py -3 -m venv .venv` and `.venv\Scripts\python.exe`.
Optional live-engine tests skip unless disposable fixture URLs are configured;
see [the evidence guide](tests/evidence/README.md). OAuth tests bind ephemeral
localhost ports but use controlled tokens/network adapters, not the user's
account. They need local socket permission.

## Run in VS Code

Build the extension and webview first. From the repository root:

```bash
code --extensionDevelopmentPath=. /path/to/disposable/workspace
```

Use **Verbis: Install / Reinstall Backend** in that window, then
**Verbis: Open Database Workspace**. The command palette opens with
Ctrl+Shift+P (Cmd+Shift+P on macOS). **Verbis: Open Assistant** opens the terminal
assistant; Ctrl+Shift+Q/Cmd+Shift+Q is its registered shortcut.

`npm run watch` recompiles extension TypeScript. `npm run watch:webview` starts
Vite for browser development, but the installed extension loads `webview/dist`:
run `npm run build:webview` and **Developer: Reload Window** to test packaged UI.
A browser without a VS Code host cannot execute backend actions.

Use separate `--user-data-dir` and `--extensions-dir` folders for packaged VSIX
acceptance, then install with `code --install-extension path/to/verbis.vsix` using
those same directories. Do not reuse a debugging port on an everyday profile.

## Backend debugging

Output → **Verbis** records setup/readiness errors. The extension's managed
backend binds to loopback and requires its per-process bearer token. Do not copy
that token into source, logs, example commands or screenshots.

For a standalone disposable development server, with no credentials:

```bash
.venv/bin/python python_backend/main.py --port 8765 --workspace /path/to/disposable/workspace --log-level DEBUG
```

Without `QM_BACKEND_TOKEN`, this explicitly launched development server has no
bearer-token check. Keep its default loopback host and stop it afterward. The
extension supplies a token for its own backend. Never point write tests at an
existing personal database.

## Current implementation boundaries

- React uses the single API wrapper in `webview/src/vscode.ts`. `VerbisPanel`
  routes messages to `AssistantSession` or workspace/backend operations.
- Active generation is `python_backend/api/routes/generate.py`: shared LLM
  service, live schema, reviewed definitions and SQL validation. Older generator,
  optimizer/confidence helpers are not proof of an active feature.
- **Write SQL myself** resolves the selected schema without provider credentials.
  Execution retains connection/revision checks, read-only policy, result limits,
  timeout/cancel and honest manual history.
- Privacy Shield keeps identifier maps in backend memory for one generation and
  discards them afterward. The active path does not persist encrypted maps or
  depend on a stored privacy-map salt.
- The schema index is offline and lexical. No embedding download or measured
  plan-similarity optimization is part of the supported query path.
- PII masking uses current type/name-aware rules in `pii_service.py`; it is not
  a universal classifier. The audit records column/type without source values.
  Editing a legacy `pii_rules.json` does not configure these active rules.
- Provider keys/passwords use VS Code SecretStorage when available. Session keys
  and OAuth tokens remain in memory; reload requires ChatGPT sign-in again.
  Never read/reuse Codex's own account credentials.
- `.qmind/` contains connection metadata, SQL/history, definitions, analyses and
  managed imported data. It is excluded from Git and packages.

## Changing a workflow

Trace the actual UI → host → API → service path first. Retain connection ids,
named values and revision/provenance fields. Test observable behavior and
error/cancel paths. Show unsupported cases honestly. A controlled provider
response does not prove live model quality or account eligibility.

Use [the synthetic demo](examples/college-demo/README.md), and update the
[issue ledger](docs/ISSUE-LEDGER.md) and [work log](docs/WORK-LOG.md).
For the college scope, finish existing workflows rather than adding new modules.

## Packaging

Use the locked `@vscode/vsce` through `npm run package`, with Node 24. Include
rebuilt `out`, `webview/dist`, Python runtime/requirements and the JWT dependency.
Exclude tests, profiles, examples, databases, credentials and dev environments.
Verify the actual installed VSIX.

The verified GitHub workflow builds a downloadable VSIX. The legacy tag publishing
workflow has an unverified toolchain and needs review before Marketplace use.
Do not create release tags or publish during testing. `main` remains the stable
release; development is on its separate branch.
