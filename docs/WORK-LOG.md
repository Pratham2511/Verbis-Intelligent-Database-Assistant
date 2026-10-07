# Verbis implementation and acceptance log

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
| Current backend suite | 138 passed, 45.06 seconds; Python 3.13.5 |
| Current extension suite | 46 passed across nine suites, including controller, connection transactions, transport/persistence, PTY input, subprocess lifecycle, exports, slow-dialog webview deadlines, DDL acknowledgements and provider secret isolation; controlled hosts |
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

No ChatGPT provider has been implemented, no OAuth login has been started and no
existing Codex account credentials have been reused. Real-provider retests remain
pending an eligible account/provider. This eligibility limitation is separate
from the completed backend and extension regression results.

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
