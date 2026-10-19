# Verbis implementation and acceptance log

## Marketplace publication checkpoint — 19 October 2026

At the user's explicit request, prepared a stable 1.5.0 upload while preserving
GitHub main at the 1.4.0 baseline. Runtime code is unchanged from the passing
implementation/CI checkpoint. All 215 runtime files in the final release VSIX
match that verified package byte for byte; stable metadata and source links are
checked. Marketplace exposed two icon limits: maximum 1024 KB and 1024 square.
The existing artwork was reduced proportionally and visually checked; both
constraints now pass (N46). The upload was accepted at 17:46 IST. At 17:54 IST the public latest manifest
and catalog confirm validated stable 1.5.0; the downloaded VSIX hash and all
215 runtime files match the upload. The listing page initially retained cached
1.4.0 history, separately disclosed in the release record.

The temporary user-supplied publishing PAT passed through hidden terminal input
and child-process memory, without being stored in files or Git. No API-provider
inference was used during publication. The user was told to revoke the PAT.
See [the release record](MARKETPLACE-RELEASE.md) and
[publication evidence](../tests/evidence/marketplace-release-checks.json).

## Current checkpoint — 18 October 2026 (Asia/Kolkata)

The user authorized the finite college-submission scope and limited real Plus
testing. No later roadmap expansion was added. The historical sections below
retain their original dates, counts and pending conditions; this checkpoint
supersedes their current-status claims.

Implemented an explicit **Write SQL myself** route using the selected database's
real schema revision, without credential acquisition or generation. Clearing SQL
retains the editor. Results are loaded deliberately rather than overwriting a new
draft at mount. Busy controls protect reviewed values, saved analyses restore
the visible database and latest stored definition, and successful execution adds
the actual SQL/values to follow-up context without result rows (N41–N44).

Added a synthetic college demo with CSV/schema/application examples, safe setup
that refuses an existing destination, seven exact expected-result checks and an
independent CSV calculation. A deliberately incorrect `>=` query is detected.
The backend evaluation also verifies save/chart/filter diagnostics, an isolated
rename breaking a query, read-only rejection and unchanged source database bytes.
The five-minute guide, architecture/diagram, short report and corrected developer
instructions provide the remaining submission material (N39).

Fresh verification on 17–18 October:

| Check | Result / boundary |
|---|---|
| Extension | 88 passed across 13 suites, 7.17 seconds; controlled host/OAuth/subprocess fixtures, no live inference. |
| Backend | 135 passed, 12 skipped, 65.51 seconds; Python 3.13.5. Opt-in live engines not configured in this run; previous actual engine/TLS evidence remains separate. |
| Build | TypeScript compilation, ESLint, webview typecheck and production build pass. Node 24.19.0 used for VSIX packaging. |
| Demo verifier | Seven reviewed cases pass; source unchanged; overwrite refusal and strict-boundary mutation checks pass. |
| Controlled UI | Manual entry/empty editor/no automatic run/save reopen/required connection at widths 1100, 480 and 360; all 13 pages/type inputs/provider/import fixture checks also pass. Fixtures are not live-provider evidence. |
| Actual installed VS Code | 1.141.0 in an isolated profile. Fresh normal backend installation completed; observed runtime file bytes 152,825,942. Manual threshold 8000 returns ids 3/4; changing to 9000 returns 4; saved reopen restores 8000; empty editor and department payroll chart pass. |
| Real Plus | Actual browser authorization and model catalog, then three requests with `gpt-6-luna`: salary-unit clarification clears old SQL; confirmed monthly INR produces ids 3/4; “Only those in IT” retains threshold and returns id 4. SQL was reviewed/executed against synthetic SQLite; no simulated response was counted. |

The first real-provider probe incorrectly waited for SQL without recognizing a
valid clarification. Its timeout was a driver error, not another provider call
or a product failure. The corrected probe captured clarification and both exact
execution results. No fourth request was made. The user later requested Gemini
setup after its quota reset; no key was reused from chat or embedded in fixtures.

The user subsequently supplied a new disposable Gemini key. One request through
the final installed backend's real ASGI generation endpoint, with Privacy Shield
enabled and `gemini-3.6-flash`, returned schema-validated SQL binding threshold
8000. The real execution endpoint returned exactly Cara/8001/Finance and
Dev/12000/IT; source database bytes were unchanged. Hidden terminal input kept
the key in process memory, logging was suppressed, and there were no retries.
The process exited and the user was told the key could be revoked. This is a
real-provider backend retest, not a new installed-UI or browser-auth acceptance.

An actual cold backend import exceeded the old ten-second startup deadline and
became healthy afterward while the app remained crashed. Manual Restart Backend
recovered it. N45 raises the bounded deadline to 45 seconds, cleans an unready
child, prevents cleanup from overwriting a newer startup and reports the actual
initial status. Four relevant controlled startup/panel regressions pass; final
installed-build acceptance is distinguished in the current JSON evidence.

A temporary Codex automatic-approval outage reported a revoked refresh token;
the affected CSV attempt did not execute. A later authorized retry passed the
approval service. This was an environment interruption, not a Verbis defect.

Final artifact hashes, installed checks and publication status are in
[college-implementation-checks.json](../tests/evidence/college-implementation-checks.json).
The final VSIX has 224 entries / 2,375,236 bytes; 215 packaged and installed
runtime files match source/assets byte for byte. Final installed startup reaches
Ready in a fresh account-free profile reusing only the verified Python runtime;
this is separate from the initial fresh installation. CSV import stores all five
expected rows and INR/monthly metadata; reopening the analysis restores College
demo. The actual saved report retains threshold 8000 and ids 3/4, excluding a
later question draft. The native dialog had already closed when inspected, so
no scripted native input was sent. A screenshot shows the actual result rows.

Automatic approval rejected reopening the old authenticated debug profile. The
safe replacement copied no authentication storage and used a new account-free
profile. Debugging was closed before normal Gemini key entry. The subsequent
single Gemini backend request is recorded separately above.
Credentialed profiles, runtime environments, databases, raw logs and keys remain
ignored. `main` is preserved at the original baseline; only the development
branch is intended for publication. OS keyring, Windows/macOS desktop, optional
provider acceptance and the legacy Marketplace workflow remain unverified.

Implementation commit `ed5fd51dd84a6b466acaf940d489877f94aa1f95` was pushed to
the development branch. [GitHub verification run 39133121287](https://github.com/Pratham2511/Verbis-Intelligent-Database-Assistant/actions/runs/39133121287)
passed all five jobs: Python 3.11/3.12/3.13 each 135 passed / 12 skipped,
88 extension tests plus compile/lint/typecheck/build and 224-entry VSIX packaging,
and PostgreSQL/MySQL integration 10 passed / 2 TLS cases skipped. The final
checkpoint only updates documentation/evidence; code and runtime files are
unchanged after that verified commit. The working tree and remote main are
checked after publication. No tag or Marketplace release is created.

## Historical implementation record

7–8 October 2026 (Asia/Kolkata), branch `work/verbis-1.5-verified-workflows`.
Baseline: `77b1422fcac2e205cd6d5ef39c0df94a4b2b3cb5`, extension 1.4.0.
The complete readable handoff was read: 1,091 lines. No AGENTS.md was found.

Implementation is present in source and rebuilt assets, saved on a separate
development branch at the user's request. GitHub `main` was verified at the
original baseline before branch publication. The development VSIX is
under `.local-test/verbis-1.5.0-dev.vsix`. This is an unreleased 1.5.0 build;
remaining acceptance checks below must not be treated as passed. Packaging compares
129 runtime files byte for byte with current source/assets; 138 package entries.
The built third-party Mermaid bundle retains upstream template-string whitespace;
source-only diff whitespace checks pass.

## Verification

| Check | Result and scope |
|---|---|
| Original backend suite | 56 passed, 26.74 seconds |
| Independent original safety/data probes | Reproduced nested-write acceptance, UNION rejection, negative row-limit acceptance, numeric/department masking and missed sixth-row email |
| Backend suite before ChatGPT additions | 138 passed, 45.06 seconds; Python 3.13.5; local real-engine fixtures enabled |
| Extension suite before ChatGPT/UI additions | 46 passed across nine suites, including controller, connection transactions, transport/persistence, PTY input, subprocess lifecycle, exports, slow-dialog webview deadlines, DDL acknowledgements and provider secret isolation; controlled hosts |
| Build | TypeScript compile, webview typecheck, ESLint and production webview build pass |
| Real engines | PostgreSQL 17.11 and MySQL 8.4.11, disposable loopback databases; named parameters, bounded results, read-only transactions, set operations, timeout/cancel, generated DDL/index and verified TLS/hostname failures |
| Installed VS Code | 1.140.0, commit 07f806f999227108933c2e30515b26eecc1fda74; isolated profiles, real Electron renderer and extension host |
| Packaging | VSIX approximately 2.18 MB; no test profiles, imported databases, caches, evidence or test credentials included |
| Fresh packaged installer | Later leaves commands available; subsequent actual installer reaches ready; observed venv file bytes 162,928,049 |
| Failed reinstall | Injected invalid dependency in isolated installed copy; visible failure; working manifest unchanged; failed staging removed; injected requirement restored |
| Backend recovery | Actual process killed: ready → crashed → starting → ready; second crash stays crashed; manual restart returns ready |
| Cloud authentication negative case | Actual Gemini rejects known-invalid public fixture key after actual no-key/session prompt/resume; user-supplied key not used |

Controlled local-provider desktop checks establish wiring and state. Captured
outbound cloud payload tests also use controlled responses. Separate real Gemini
session-only generation and execution passed the strict salary boundary, IT
follow-up, reviewed 9000 glossary and ambiguity clarification.
Initial timeout and schema rejection are retained in the evidence. Supported
Gemini reasoning is bounded; SDK retries no longer outlast the extension deadline.
The rebuilt real Gemini terminal first request, IT follow-up and clarification
pass with Privacy Shield enabled. Coarse roles resolve anonymous-column ambiguity;
clarifications restore names. Installed correction preview changes a saved total
35501→36500 on a snapshot while the source salary remains 8001. Actual real Gemini
two-table schema generation/ER rendering and confirmed SQLite DDL application/
refresh pass; read-only rejection also passes. Final tab-navigation/dialect guards
pass using a separately labelled controlled local schema response. Actual reload
restores eight conversation turns while /run refuses stale SQL. A delayed session
credential choice reaches the real provider rate-limit error; SQL/bindings/results
clear and Run is disabled. That error is not successful clarification evidence.

## OpenRouter integration

OpenRouter testing followed Gemini quota exhaustion. The live
public catalog confirms `thinkingmachines/inkling:free` has zero prompt/completion
prices. Verbis now exposes OpenRouter in provider/model settings, native key
management, session choice, webview settings and SQL/schema request contracts.
Its key uses a distinct SecretStorage identifier. Paid model slugs are rejected
before creating a client; SDK retries are zero, and Inkling reasoning is low.
The duplicated legacy intent client also delegates to this bounded shared client.
Provider tests use controlled clients and do not consume the supplied quota.
Real installed acceptance made one inference call with synthetic/nonconfidential
inputs. Analysis returned the generic provider-failure message; no successful SQL
generation or schema retest is claimed. The underlying OpenRouter failure has
not been diagnosed. Further calls stopped while a ChatGPT route was investigated.
See `tests/evidence/desktop-openrouter-final.json` for the recorded failure.
See [OpenRouter model details](https://openrouter.ai/thinkingmachines/inkling:free)
and the captured public catalog in the evidence directory.

## ChatGPT sign-in feasibility — 8 October 2026

The official
[Sign in with ChatGPT quickstart](https://developers.openai.com/siwc/quickstart)
lists eligible Plus and Pro subscriptions for plan-backed inference in local
open-source clients. Go is not listed as eligible for this integration. The
[Codex pricing page](https://learn.chatgpt.com/docs/pricing) currently lists Go
access to GPT-6 Luna in the desktop app, subject to rollout; that does not establish
eligibility for Verbis's direct integration or a CLI test bridge.

At that checkpoint no ChatGPT provider or OAuth login had been implemented.

## ChatGPT browser sign-in — 9 October 2026

Implemented the official local open-source token-sharing flow, exposed as
**Continue with ChatGPT** in Connections and the command palette. Browser login
uses a loopback callback, PKCE, state and nonce checks, the issued application
client ID, and signed ID-token verification against OpenAI's published keys.
OAuth credentials stay in extension-host memory. Only registration identifiers
and a stable installation identifier persist; existing Codex credentials are not
reused. Reload requires signing in again. Sign-out discards the local session and
attempts remote refresh-token revocation.

SQL and schema generation use the account's visible model catalog and streamed
Responses requests with `store: false`, zero SDK retries, and no API-key fallback.
Login and model listing make no AI inference request. Generation requires an
explicit model selection and starts with one attempted request per window; each
additional attempt requires **Allow one more AI request**. Failed attempts count
because partial output can consume usage. Incomplete or failed streams are
discarded rather than treated as valid SQL/schema output.

Real requests consume shared plan allowance. Purchased ChatGPT credits may also
be used if the account permits them; **Manage usage** opens ChatGPT settings so
the user can disable credit use. This is a request-count guard, not an account
billing guarantee. See the official [sign-in flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
and [models/inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

Controlled verification passes: 60 extension tests, including actual ephemeral
JWT signature checks and loopback OAuth fixtures; 133 backend tests pass and 12
opt-in database integration cases skip because their services are not running.
Compile, lint, webview type checking and production build pass. These checks make
no real AI calls. The verified package includes its JWT runtime dependency and
matches the rebuilt runtime source. Installed VS Code 1.140.0 activates it in a
separate visible profile with a reused verified backend runtime and a synthetic
SQLite fixture. Connections shows the new controls and 0/1 attempted requests.
**Continue with ChatGPT** opens the browser and enters the cancellable waiting
state without an inference request. At that initial checkpoint, user authorization and a completed real
ChatGPT response were pending; implementation alone does not establish account
eligibility or real-provider success. Sanitized results are recorded in
`tests/evidence/chatgpt-controlled-checks.json`.

## Simpler workspace interface — 9 October 2026

The user's installed ChatGPT connection received plan permission and its real
visible-model catalog, with zero ChatGPT inference attempts. Real inference is
paused until the user confirms purchased-credit use is disabled. No account
identity or OAuth credentials are included in evidence.

Replaced the twelve-tab bar with five everyday pages (Start, Ask your data,
Import CSV, Tables, Settings) and a More tools menu with descriptive action names.
Start explains the data → AI → question flow. The selected database and remaining
allowed AI attempts stay visible. AI generation buttons explain allowance use and
pause when sign-in, model selection, or another allowed attempt is needed.

Settings shows one AI provider and its relevant controls. Provider/model choices
can be changed there without finding VS Code settings; changing them performs no
inference. SQLite offers a native file picker. Connection editing is opened only
when needed. Sign-in, model choice, allowance, credit settings and account details
have separate, short explanations. N38 fixes the blocking welcome and stale busy
reply discovered after actual sign-in.

Ask and CSV import use numbered steps. Query values preserve numeric/boolean/NULL
types in ordinary fields, and invalid numeric drafts block execution. Comparison
column mappings and business units also use fields; expert JSON editing remains
available. Business definition editing is inline. Table keys, query-history
actions, saved analyses, code references, and static predictions have plain labels,
helpful empty states and visible keyboard focus. Theme colors follow VS Code.

77 extension regressions pass, including login completion without dismissing the
welcome, invalid provider/model rejection, and value-type preservation. Compile,
lint and webview type checking pass. Browser fixture checks cover all 13 pages,
preview/import, reviewed query execution, AI attempt exhaustion, definition saving,
selected-provider controls and a SQLite picker response. All 13 pages fit at
360 pixels; the main pages also pass at 480 and 1100 pixels. The keyboard skip
link moves focus into the workspace. Synthetic browser
responses are labelled and do not establish real AI or database execution.
The final VSIX was installed and reloaded in VS Code 1.140.0. The actual renderer
shows the new navigation and Start screen with the backend ready. Actual CSV
preview/import passes with three synthetic rows and a selected unique identifier;
read-only SQLite inspection confirms exact imported values and that the separate
five-row source fixture remains unchanged. No AI was used. Reload discards the
window-only OAuth session, so the existing sign-in registration is resumed through
the browser; real inference still requires the credit-setting confirmation.


## College scope audit — 9 October 2026

The user revised the objective to a manageable college project for approximately
two months, rather than completion of every long-term roadmap expansion.
[COLLEGE-READINESS-AUDIT.md](COLLEGE-READINESS-AUDIT.md) inventories the wired
features, counts original checklist items separately from verification, identifies
unconnected legacy services, and recommends a finite seven-requirement finish
line. No additional product feature or provider call was made for this audit.

Fresh source checks pass: 77 extension tests (12 suites, 4.38 seconds), 133 backend
tests (12 live-engine cases skipped, 39.43 seconds), compile, lint and webview
typecheck. Local fixture access was required: the initial sandbox extension run
could not bind OAuth callbacks and the sandbox backend run was interrupted after
making no progress. The reruns with fixture access passed.

Remote CI is now confirmed, superseding earlier pending-CI notes. For source
`1bc9fddb7f58c180c7c835f69f4b86c859733023`,
[Verify Verbis run 37932735837](https://github.com/Pratham2511/Verbis-Intelligent-Database-Assistant/actions/runs/37932735837)
passed all five jobs: Python 3.11/3.12/3.13 (133 passed, 12 skipped each), extension
build/test/typecheck/package (77 tests), and PostgreSQL/MySQL integration (10
passed, 2 TLS cases skipped). Desktop OS/keyring and real ChatGPT inference checks
remain distinct and pending. N39/N40 record stale contributor documentation and
the unverified legacy tag-publishing workflow; neither was changed in this audit.

## Branch publication hygiene

Source, required rebuilt runtime assets, dependency locks, regression tests, CI
and reviewed verification evidence are included in the development branch.
Local acceptance profiles, runtimes, imported databases, packages, logs and
credentials remain ignored. `.qmind/` is ignored in full because it can contain
workspace queries and connection metadata. Evidence uses synthetic data; a local
absolute path was removed, and two screenshots that did not show their named
feature were retained only in the ignored acceptance directory. Credential-pattern
and hardcoded-literal review found no supplied provider keys in publishable files.

## Working product slices

- Dataset Workspace imports reviewed CSV into managed SQLite. Type/date/currency/
  period mappings, key/FK confirmation, NULL/conversion/duplicate reports,
  transactional create/append/replace and retained refresh mappings are present.
- Analysis Workspace has visible bound SQL, named parameters, retained follow-ups,
  real paginated results, appropriate aggregate charts, saved/reopened analyses,
  schema/definition drift checks and CSV/report export. Exports capture the
  measured execution rather than an edited next-question draft.
- Project Navigator parses Python/SQLAlchemy and static SQL without executing
  application code. It links known reads/writes/models/unit-conversion evidence,
  opens source, refreshes changed models and labels unresolved dynamic patterns.
- Result Forensics covers primary-key predicate truth, equality/NULL boundaries,
  common join expansion/missing partners and ungrouped aggregate contributions.
  An explicit alternative SQL interpretation has a separate bounded preview.
- Change Rehearsal tests SQLite column additions/renames on a disposable snapshot,
  checks saved/supplied queries and expected outputs, identifies source references,
  and exports reviewed migration/candidate query patches.
- Reconciliation compares SQL/imported CSV using exact keys and visible period,
  currency and date rules; ambiguous keys remain unresolved. Guarded correction
  proposals are reviewed/exported separately. Corrections can be tested on a
  temporary snapshot with measured before/after saved-report results; source data
  is unchanged and incomplete comparisons make no equivalence claim.

## Actual desktop acceptance

Synthetic employee fixture: Alice 7500, Bob 8000, Cara 8001, Dev 12000 and Esha
NULL. The real terminal receives the salary question and `/run` returns Cara and
Dev. “Only IT” retains the threshold and returns Dev. Named saved analysis retains
bindings; definition changes block a run until reviewed and saved again.

Actual Schema renders employees/primary key and Mermaid SVG. Navigator shows
known payroll read/write/divide-by-12 evidence plus unresolved dynamic SQL and
opens payroll.py at the correct line. Forensics reports equality false and NULL
unknown. A real isolated rename breaks the unchanged payroll query as expected.

Packaged UI verifies stored tree nodes/fork/checkpoint/comparison, glossary save
and reopen, report/CSV Save dialogs, and cancellation of a long recursive SQLite
query followed immediately by a successful COUNT. Connection form add/edit works
without SQLite credentials; a second schema shows products rather than employees.
Native confirmed deletion removes only the disposable configuration and preserves
its database file. The final virtual-display profile reused the verified installed runtime; it
is not another fresh-installer test. X11 dialog interaction was restricted to
the verified isolated window. A still-open old-build restart exception supplied additional N10 evidence.

Test-driver errors (disabled duplicate Save button selection, remount timing,
`row(s)` spelling and native dialog handling) were corrected and distinguished
from product failures. See the issue ledger and checked-in evidence.

## Remaining checks and inputs

- Real Gemini salary/follow-up/glossary/terminal clarification, schema generation
  and SQLite application passed. Actual provider switching discards the session
  key. The final Analysis clarification retry is pending available quota: the
  supplied key became rate limited, and an additional disposable Gemini key has
  been requested. The error path passes; it is not counted as clarification.
  Groq inference, expired-key cases and a broad real-model matrix remain. The
  supplied key is excluded from files, screenshots and evidence.
- Actual employee dataset/connection and salary currency/monthly-or-annual units.
  All salary results here use labelled synthetic data.
- KDE currently lacks a working OS keyring. Persisted secure SecretStorage and
  remote-password desktop reload/rotation checks remain pending. Session-only
  flow works; no plaintext keychain override was used.
- Missing/unsupported Python desktop injection, complete remote credential wizard
  matrix, Windows/macOS and Python 3.11/3.12 have not been executed here. CI is
  configured, not run remotely; CI engine services do not enable TLS fixtures.
- Later slices: Excel, additional ORM stacks, selected-group aggregate diagnostics,
  application-test execution/richer migrations, view/application dependency previews,
  PDF/scanned sources and SQL Test Lab.

Detailed F01–F33, A01–A08 and new findings: [ISSUE-LEDGER.md](ISSUE-LEDGER.md).
Reproduction commands and evidence boundaries: [tests/evidence/README.md](../tests/evidence/README.md).
Historical release claims are preserved in HISTORICAL-CHANGELOG.md, separately
from fresh acceptance results.
