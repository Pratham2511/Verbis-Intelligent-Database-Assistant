# Verbis: feature audit and college submission scope

Audited 9 October 2026. Source: `1bc9fddb7f58c180c7c835f69f4b86c859733023`,
development version 1.5.0, branch `work/verbis-1.5-verified-workflows`.

## Implementation checkpoint — 18 October 2026

The inventory below preserves the 9 October audit. Its then-pending items are
superseded by this checkpoint and [the current work log](WORK-LOG.md).

- Real Plus inference now passes in installed VS Code: salary-unit clarification,
  correct strict-threshold SQL and an IT follow-up. Three small requests used
  `gpt-6-luna`; all data was synthetic. Gemini-specific retries and other provider
  matrices are not required for the chosen demonstration route.
- Manual SQL now has an explicit no-AI entry, a persistent empty editor and
  real connection/schema binding. Installed threshold/value/save/reopen/chart
  checks pass. Executed edits and values are retained for subsequent follow-ups.
- The synthetic demo kit, seven independent expected-result checks, five-minute
  guide, architecture diagram, short report and corrected contributor guide are
  implemented. The fixture deliberately exposes equality, NULL and join expansion.
- Current local suites pass: 88 extension tests; 135 backend tests, with 12
  opt-in engine cases skipped. Build, lint, typecheck and packaging are verified
  separately from actual installed behavior. A cold-start timeout discovered in
  the presentation window is fixed with bounded readiness and cleanup regressions.

Final package/desktop/publication status is recorded in
[college-implementation-checks.json](../tests/evidence/college-implementation-checks.json).
The narrowed implementation is now pushed at `ed5fd51`; all five jobs in
[run 39133121287](https://github.com/Pratham2511/Verbis-Intelligent-Database-Assistant/actions/runs/39133121287)
pass. One subsequent Gemini request through the installed backend also produces
the exact expected threshold rows. Final installed CSV/unit/save/export checks
pass, and a verified VSIX plus committed-source submission bundle is prepared.
Windows/macOS acceptance, OS keyring persistence, optional providers and the
legacy Marketplace publisher remain separate limits. The original roadmap
percentages have not been inflated to imply those checks passed.

## Assessment

Verbis already has enough feature breadth for a substantial college project.
The remaining priority should be a dependable demonstration, clear evidence,
and a reproducible installation. Finishing every expansion in the original
handoff would add considerable work without being necessary for the user's
two-month submission scope. This is an engineering assessment of this repository,
not a comparative ranking or a prediction of a college grade.

The recommended product is **a schema-aware database assistant in VS Code**:
connect or import data, ask a question, review SQL, run it safely, continue the
analysis, and save/export the result. Business definitions and supported result
diagnostics provide useful depth. The other working advanced tools can remain
under More tools with their current limits.

This audit does not implement additional features or remove existing ones.
The wider handoff remains a historical roadmap; the narrower finish line below
is the recommendation for the user's revised scope.

## How completion is reported

**Implemented** means the supported behavior has a real UI/command, request
handler, and implementation. It does not mean every provider, platform or input
has passed acceptance. **Limited version** means an intentionally restricted
workflow exists. **Pending verification** means source or controlled tests
exist but the specified real-world check is outstanding.

For the six roadmap modules, percentages below count fully implemented bullets
in the handoff's "First implementation" checklist. Partial bullets receive no
credit. Each bullet has equal weight only for this inventory. These figures are
not estimates of development effort, model accuracy, test coverage, or remaining
time. A later expansion can lower the original checklist percentage even when
the useful college scope is already complete. There is no meaningful single
percentage for the whole project without a fixed release checklist.

## Existing feature inventory

| Feature | Implementation state | Evidence and remaining boundary | College decision |
|---|---|---|---|
| VS Code extension and workspace | Implemented | Actual packaged VS Code activation; commands, sidebar, terminal and webview. Five primary pages and eight More tools pages. | Keep as the delivery platform. |
| Backend installation and recovery | Implemented; acceptance partly complete | Pinned isolated Python runtime, staged reinstall, preserved working environment, Later/retry, crash/restart. Actual Linux installation and failure/recovery evidence; missing/unsupported-Python desktop cases and other OS installations remain. | Finish on the presentation machine; no installer redesign needed. |
| Database connections | Implemented | SQLite, PostgreSQL and MySQL; live validation, shared selection, add/edit/delete and TLS. Real engines exercised. Desktop remote-password persistence awaits a working keyring. | SQLite is sufficient for the main demo; other engines are additional support. |
| English to SQL | Implemented; final provider acceptance pending | Schema-grounded generation, malformed/fenced output handling, unknown/ambiguous object rejection, named values and clarification. Real Gemini threshold/follow-up/clarification worked earlier; current ChatGPT inference is unverified. | Essential: verify one current provider through the final UI. |
| Review and safe execution | Implemented | Bound database/schema/parameters, explicit Run, read-only default, AST plus engine controls, bounded rows, timeout/cancel and stale-query guards. Backend/controller and engine tests pass. | Essential; preserve these protections. |
| Follow-ups and conversations | Implemented | Retained question/SQL context, connection scope, reload durability and clearing SQL after failed/ambiguous questions. Final successful Analysis clarification after N36 still needs a real-provider retest. | Essential; a small final demo is enough. |
| CSV import and profiling | Implemented for CSV | Preview, types, explicit currency/period/date rules, NULL/conversion/duplicate reports, keys/FKs, create/append/replace, provenance and refresh choices. Actual final UI CSV import checked against stored rows. | Essential and sufficient; Excel is unnecessary. |
| Tables and ER diagram | Implemented | Live schema, primary/foreign keys, refresh and Mermaid rendering. Actual installed diagram evidence. Complex naming/relationship combinations are not exhaustively tested. | Essential for explaining schema grounding. |
| Results and charts | Implemented, deliberately limited | Paginated loaded rows; aggregate bar chart only for a suitable two-column grouping result. Visible truncation. Charts are not a general visualization platform. | Essential results; one meaningful aggregate chart is sufficient. |
| Saved analyses and parameters | Implemented | Named SQL/connection/definitions/values, reopen and revision guards; scalar value editor. Tests and installed desktop evidence. | Essential for a complete analysis workflow. |
| CSV and readable report export | Implemented | Executed result snapshot, question/SQL/definitions/bindings/timing, spreadsheet formula protection. Controlled regression and installed Save dialog evidence. | Essential for a tangible project output. |
| Business definitions and units | Implemented | Reviewed, persisted glossary used in active generation; aliases, scope and explicit units. Real Gemini definition test. Broader semantic modelling is outside this slice. | Keep; a strong, manageable differentiator. |
| Query history and tree | Implemented | Real stored nodes, recall, connection/binding preservation, fork/checkpoint and comparison. Installed evidence. No collaborative version-control claim. | Keep; avoid adding a second history system. |
| Privacy and credential boundaries | Implemented; secure persistence partly unverified | Cloud schema/context anonymization, request-scoped maps, recognized PII masking, provider-specific SecretStorage/session keys, authenticated loopback backend. No universal PII or security guarantee. KDE keyring persistence remains untested. | Essential; demonstrate session-only operation and document limits. |
| Gemini provider | Implemented; positive historical inference | Real SQL/follow-up/definitions/schema generation worked; supplied quota exhausted. Final current Analysis clarification needs retest with an available provider. | No additional Gemini work if another provider is chosen for the demo. |
| ChatGPT sign-in and provider | Implemented; inference pending | Actual authorization/plan permission/model catalog received. Controlled JWT/OAuth/stream/budget tests pass. Window reload requires sign-in again. No completed real generation yet. | Finish this route if it is the chosen demo provider; do not add more providers. |
| Groq, OpenRouter and local Ollama | Implemented routes; uneven acceptance | Groq/local positive real inference pending. One installed OpenRouter call failed; root cause unresolved. Controlled fixtures establish wiring, not real model success. | Optional; clearly label unverified routes rather than expanding the matrix. |
| Project Navigator | Limited version | Python/SQLAlchemy/static SQL, model/read/write/function/file evidence, source links, dynamic-query warnings and hash-based refresh. No full application dependency graph or arbitrary framework support. | Keep as an optional demonstration; one labelled application fixture is sufficient. |
| Result Forensics | Limited version | Single-key filter/NULL checks, common join expansion/missing partners, basic ungrouped aggregate contributions and reviewed alternative query preview. CTEs, subqueries, group-specific tracing and complex joins are unsupported. | Best optional feature to demonstrate after the core workflow. |
| Change Rehearsal | Limited version | SQLite ADD/RENAME COLUMN on a disposable current-database backup; SQL checks, expected rows, before/after output, source refs and candidate saved-query patches/export. Application code is not executed. | Keep the rename demo; do not build a migration framework. |
| Dataset comparison and correction preview | Implemented for the first SQL/CSV slice | Explicit keys/fields/periods/dates; conflicts, missing/ambiguous records; guarded SQLite correction proposals and affected saved-report checks on a snapshot. Export/review, no production apply. | Optional; current slice is enough. |
| New-table designer | Implemented; limited acceptance | AI schema/DDL/ER generation, quoting/order/FK validation, explicit confirmation, target-dialect guards and refresh acknowledgements. Real Gemini SQLite apply and real-engine generated DDL tests. | Optional; no expansion needed. |
| Change-impact predictions | Static heuristic only | Current saved-query history is used and UI says these are estimates. This is not measured model robustness or a complete dependency analysis. Rehearsal provides the measured supported checks. | Low priority; do not present as a headline result. Consider hiding the redundant prediction page at final polish. |
| Tests, build and installable package | Implemented | Current local suites and remote verification pass; VSIX packaging and prior real host evidence. Automated host UI tests are not part of every CI run. | Essential; use a verified VSIX for submission. |

## Original roadmap checklist coverage

| Module | Fully implemented checklist items | Coverage | What remains in the broader original scope | Needed for college? |
|---|---:|---:|---|---|
| Dataset Workspace | 6 / 7 | 86% | Excel was the seventh, later item. The CSV workflow is implemented. | No Excel needed. |
| Project Navigator | 5 / 7 | 71% | Framework/configuration discovery and related migration/business-document mapping are partial; no complete dependency graph. More ORM adapters are later scope. | No broad expansion needed. |
| Analysis Workspace | 8 / 8 | 100% implementation | Final live provider/clarification acceptance still pending; charts and exports have stated limits. | Verify it; no new feature category needed. |
| Result Forensics | 4 / 6 | 67% | Selection/tracing of arbitrary returned aggregates and full calculation explanations are partial. Current key-based/basic aggregate slice works. | Supported filter/join examples are enough. |
| Change Rehearsal | 4 / 7 | 57% | Full schema-diff planning and application-code patches are partial; rebuilding from migrations/fixtures is absent. Query tests run, application tests do not. | Current SQLite ADD/RENAME slice is enough. |
| Reconciliation first SQL/CSV slice | 7 / 7 | 100% implementation | PDF/scans, fuzzy matching, currency exchange and broader dependencies are later or unsupported. Production application was not required because reviewed export is supported. | No expansion needed. |
| Later SQL Test Lab | 0 / 6 | 0% | Dedicated fixture-generation/counterexample/regression-export workspace. Existing regression tests and rehearsal assertions do not implement this product. | Omit entirely from the submission scope. |

Counting details:

- Dataset: import, preview/mapping, formats, issue reports, keys/relationships,
  and repeatable refresh are implemented. Excel is absent.
- Project: SQL/common ORM parsing, function/file links, read/write evidence,
  incremental rescan and unresolved-pattern reporting are implemented. Discovery
  and linked migration/definition understanding are partial. Markdown mentions
  and parsed SQL migration entries do not establish a full dependency map.
- Analysis: target/run, results/pagination/export, suitable chart, follow-ups,
  reviewed definitions, saved parameters, reopen/revision checks and readable
  report are implemented. This count separates source implementation from
  model/provider acceptance.
- Forensics: predicate checks, supported join checks, alternative interpretation
  preview and permission/limit enforcement are implemented. Entity selection
  covers a supplied primary key, not arbitrary group selection; aggregate
  evidence covers bounded inputs/results rather than a general calculation trace.
- Rehearsal: affected saved queries/source references, selected SQL tests,
  output comparison and export are implemented. Change lists/candidate query
  patches only partly satisfy full schema/code planning. Snapshot backup is not
  rebuilding a database from migrations and fixtures.
- Reconciliation: both sources, mappings, missing/conflicting values, explicit
  normalization, evidence, correction/report preview and reviewed export are
  implemented within the declared limits.

## Source files that must not be counted as finished features

The current generation route calls the structured provider pipeline and schema
validator; it is not the older `SQLGenerator` candidate/ranking pipeline.
There are older helpers for optimization, confidence ranking, federation, NoSQL,
EXPLAIN explanation, AI narratives, adaptive memory and annotation persistence.
Their existence is not evidence of a complete current user workflow.

In particular:

- NoSQL generation is explicitly rejected by the active route. MongoDB and SQL
  Server are not supported connection types.
- `Optimizer` is not called by the active query path. It does not establish
  measured speedups or true query-plan similarity.
- Execution uses a measured row-count narrative, not a demonstrated general
  AI explanation of numerical causes. Imports of narrative/plan helpers do not
  establish that they run.
- The current schema index is offline and lexical. It is not an embedding RAG
  benchmark or a model download feature.
- Memory/annotation storage and older "novel contribution" comments do not
  prove learning, collaboration or an exposed feature.

Do not expand these helpers just to increase the feature count.

## Essential, finite finish line for the college project

| Requirement | Current position | Remaining action and completion condition |
|---|---|---|
| One dependable real AI route | Gemini worked earlier; ChatGPT authorization works, generation unverified. | Pick one current provider. In the installed final UI, verify generation, follow-up, clarification/error handling and reviewed execution on synthetic data. No broad provider benchmark needed. |
| Safe, correct main workflow | Implemented and extensively regression-tested. | Final packaged run: import/connect → tables → question → SQL review → Run → exact expected rows. Confirm equality/NULL cases and no source mutation. |
| Reusable analysis | Implemented. | In the final demo, save/reopen a parameterized analysis, change a value deliberately, render one suitable aggregate chart, and export actual executed results/report. |
| Understandable setup | Simplified UI and Linux setup/recovery verified. | Rehearse a clean installation on the actual presentation machine. Make backend/provider/connection failures actionable. Do not claim desktop platforms that have not been tested. |
| One or two convincing engineering examples | Definitions, forensics, rehearsal and reconciliation already available. | Demonstrate the reviewed definition plus either a missing-row/join diagnostic or an isolated rename breaking a saved query. Explain each supported limit accurately. |
| Reproducible demo and evidence | Tests and evidence exist, but no curated submission/demo kit was found. | Add one small synthetic CSV/database/application fixture, independently written expected-result checks, a short demo script and screenshots/video. Provide an explicitly labelled saved-query/offline demonstration if provider quota is unavailable; never present it as live AI. |
| Installable deliverable and concise documentation | Development VSIX and README exist; documentation has stale sections. | Produce a final VSIX, current quick start, architecture/data-flow explanation, feature/support limits, evaluation table and short project report. Correct stale contributor instructions. |

The first requirement may consume provider allowance. This audit used **zero AI
requests**. Real ChatGPT testing remains paused under the existing usage-setting
condition; no account or provider credentials belong in the submission material.

VSIX distribution is enough for submission. Marketplace publication is not
required: [VS Code's packaging documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
explicitly supports installation/testing/private distribution of a VSIX.
Real host checks complement unit tests; [VS Code's testing documentation](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
distinguishes Extension Development Host integration tests from unit tests.

## Work to stop adding

For this submission, defer Excel, PDF/scanned invoices, more frameworks/ORMs,
general dependency lineage, complex aggregate tracing, arbitrary migration/data
transformations, application-test orchestration, SQL Test Lab, NoSQL federation,
automatic optimization and additional providers. Do not add a separate web app,
team accounts, collaboration, deployment infrastructure or a research benchmark.

Existing advanced features can stay, provided their supported slice and limits
remain clear. A broader feature should not become an essential requirement merely
because a service file or roadmap heading already exists.

## Verification reviewed and repeated

Fresh checks on 9 October, without real inference:

| Check | Result |
|---|---|
| Extension regressions | 77 passed, 12 suites, 4.38 seconds; controlled host/OAuth fixtures. |
| Backend regressions | 133 passed, 12 skipped, 39.43 seconds; live engines were not configured in this local run. |
| TypeScript compilation | Passed. |
| ESLint | Passed. |
| Webview type checking | Passed. |
| GitHub verification for audited commit | Passed: Python 3.11/3.12/3.13, extension build/test/typecheck/package, real database jobs. |
| CI backend counts | Each Python job: 133 passed, 12 skipped. |
| CI PostgreSQL/MySQL integration counts | 10 passed, 2 TLS cases skipped. Earlier local TLS evidence is separate. |

CI evidence: [Verify Verbis run 37932735837](https://github.com/Pratham2511/Verbis-Intelligent-Database-Assistant/actions/runs/37932735837).
Local initial sandbox execution could not bind OAuth callback fixtures, and the
backend run was interrupted after making no progress. Both suites were rerun
with local fixture access and passed; these environment-limited attempts are
not counted as product failures or successful test runs.

Previous installed VS Code 1.140.0 evidence, real Gemini sessions, real-engine TLS,
installer/recovery, privacy envelope checks, snapshot/source comparisons and
controlled browser UI checks were reviewed; they were not all repeated in this
audit. See [WORK-LOG.md](WORK-LOG.md), [ISSUE-LEDGER.md](ISSUE-LEDGER.md), and
[evidence boundaries](../tests/evidence/README.md).

## Remaining issues and acceptance boundaries

- Current real ChatGPT generation and final real Analysis clarification are
  unverified. OpenRouter's recorded real failure is unresolved. Groq/local real
  positive inference is unverified. Only the selected demo route needs to be
  finished for the narrowed scope.
- Persisted SecretStorage and desktop remote-password reload/rotation need a
  working OS keyring. Session-only operation is available. This is a validation
  gap, not proof that persisted storage is broken.
- Windows/macOS desktop setup remains untested. Ubuntu CI now confirms the
  Python 3.11/3.12/3.13 suite; it does not prove those desktop installers.
- Actual user employee data/units were never established; current acceptance
  uses synthetic data. A synthetic, disclosed submission fixture is sufficient.
- The committed README is useful, but a curated demo kit, architecture write-up,
  submission report and final release package have not been completed.
- Contributor instructions still describe an encrypted persistent privacy map
  and salt, customizable masking rules and plan similarity that do not match the
  active implementation. They also contain stale development/debug examples.
  Correct those before submission; do not build the old described systems.
- The legacy tag publishing workflow uses Node 20, unlocked installs and a
  globally installed publishing tool, unlike the verified Node 24 packaging
  workflow. It does not run the full gates before publishing. Marketplace
  publication via this route is unverified; use the verified VSIX workflow for
  the college deliverable. No release/tag was created during this audit.

The recommended stopping point is completion of the seven finite requirements
above. Additional roadmap breadth should remain deferred after that point.
