# Verification evidence — 7–8 October 2026

Baseline code: 77b1422 (1.4.0). Development branch:
work/verbis-1.5-verified-workflows (1.5.0).
`baseline-backend.json` and `baseline-suite.txt` record independent original-code
probes. `current-backend.txt` and `current-extension.txt` record current suites.
Desktop JSON/images come from the user's installed VS Code 1.140.0 in disposable
profiles, rather than a mocked VS Code API. All displayed employee data is synthetic.

Controlled desktop inference uses a labelled local HTTP fixture. Real Gemini
results are separately recorded in desktop-gemini.json: actual threshold/follow-up
execution, reviewed glossary and ambiguity; initial timeout and schema rejection
are retained. The negative Gemini case uses a known-invalid public fixture key.
The final packaged real terminal checks are in desktop-terminal-gemini.json.
Real two-table schema generation/ER rendering, native read-only rejection and
confirmed SQLite application/refresh are in desktop-gemini-ui-final.json. Its
Analysis timeout is explicitly not counted as successful clarification.
desktop-analysis-rate-limit-final.json captures the final rebuilt Analysis error
path after a delayed credential choice; real successful clarification retry awaits
provider quota. desktop-ddl-target-final.json and schema-navigation-controlled.png
use a labelled local schema fixture to verify retained navigation and rejection of
SQLite DDL on PostgreSQL before confirmation. desktop-reload-guard.json verifies
conversation restore and stale /run refusal. desktop-correction-preview.json
records a measured saved-report change on an isolated snapshot with unchanged
source data. desktop-delete-switch-final.json records acknowledged deletion and
Gemini/Groq credential-source prompts; it does not claim Groq inference.

desktop-openrouter-final.json records the single real OpenRouter Inkling call in
installed Analysis. It returned a generic provider failure; the cause is not
diagnosed and no positive inference acceptance is claimed. ChatGPT browser sign-in
and SQL/schema Responses integration were implemented on 9 October. Controlled
OAuth/JWT, request-budget and stream-completion tests pass (60 extension tests;
133 backend tests pass, 12 opt-in engine cases skip). No real ChatGPT inference
has been performed at that checkpoint. Go subscriptions are not listed as
eligible for SIWC plan-backed inference in the official documentation.
`chatgpt-controlled-checks.json` records the new controlled checks, verified
package contents and installed controls/backend. The browser was launched from
the installed extension. The user subsequently completed account authorization;
plan scope and the real model catalog were received. Real inference remains
paused pending purchased-credit setting confirmation and is unverified. No login credentials or account identity appear in
that evidence.

These final checks used the actual installed VS Code on a private Xvfb display.
That final profile reused an already verified extension runtime; clean-installer
acceptance is separate in package-install.json. No supplied user key is in this evidence. OS SecretStorage persistence remains
pending because the KDE session has no working keyring.

Run extension verification with `npm ci`, `npm ci --prefix webview`, then
`npm run compile`, `npm run typecheck:webview`, `npm run lint`, `npm test`,
`npm run build:webview` and `npm run package` (Node 22+ for packaging).
Install requirements-dev.txt in an isolated Python 3.11–3.13 venv, then run
`python -m pytest python_backend/tests -q`. Without opt-in real-engine environment
variables, those cases skip explicitly.

For disposable engine tests set VERBIS_TEST_POSTGRES_URL and
VERBIS_TEST_MYSQL_URL to SQLAlchemy URLs whose database names begin `verbis_`.
They CREATE/DROP fixture tables in those databases. Do not point them at user or
production data. TLS cases additionally require VERBIS_TEST_POSTGRES_CA and
VERBIS_TEST_MYSQL_CA certificate paths. Run `test_live_engines.py`; the local run
used PostgreSQL 17.11/MySQL 8.4.11 and a disposable localhost-only certificate.
Negative hostname checks use 127.0.0.1 to verify rejection. CI defines non-TLS
engine service fixtures, so its TLS cases will skip.

To repeat desktop acceptance, install the VSIX with VS Code CLI's
`--user-data-dir` and `--extensions-dir` pointing at newly created disposable
folders. Open a disposable workspace. Choose Later, confirm commands are
available, then install. Import the five-row employee fixture from the handoff;
inspect schema and run the question/follow-up in the real assistant terminal.
Exercise saved parameters, definition drift, exports, long-query Cancel, and a
second SQLite connection. Delete only the disposable connection and verify its
file remains. Use the same intentional process boundary for crash testing: kill
only the backend whose interpreter belongs to that disposable profile.

Desktop drivers and environments are under ignored .local-test in this checkout.
They use Playwright/CDP for the actual renderer. Native confirmation evidence was
captured from a window whose PID/profile and transient parent were checked before
X11 keyboard input. Never launch debugging ports on an everyday credentialed
profile or reuse these fixture paths for production.

The final development package can be rebuilt after any source change. Remaining
release inputs and unexecuted cases are recorded in docs/ISSUE-LEDGER.md; passing
controller tests do not establish cross-platform or real-provider acceptance.

`simple-ui-checks.json` records 77 extension tests and labelled browser fixture
checks for the simplified interface, including all 13 pages at narrow width,
keyboard focus, parameter types, import preview and provider selection. These
responses are synthetic and do not consume provider allowance.
