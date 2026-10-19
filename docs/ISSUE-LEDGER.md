# Issue ledger — Verbis 1.5 development

7–8 October 2026. Baseline: `77b1422fcac2e205cd6d5ef39c0df94a4b2b3cb5` (1.4.0).
The full handoff was read. Historical observations are leads, not new test results.

**Evidence labels:** baseline = independently executed against original code;
source = independently traced in original code; HTTP/unit = regression against
repaired code with controlled provider/host where stated; desktop = installed
VS Code 1.140.0; engine = disposable PostgreSQL 17.11 / MySQL 8.4.11.
“Implemented” does not mean the entire release acceptance matrix is complete.

## Historical issues

| ID | Independent finding and repair | Verification / remaining check |
|---|---|---|
| F01 | Baseline AST accepted SELECT INTO, mutating CTE and EXPLAIN ANALYZE DELETE. Full-tree/script validation rejects nested writes, locks, opaque commands and unknown functions; database read-only controls add a second boundary. | Unit/HTTP, actual SQLite defense, real PostgreSQL rejection with unchanged rows/no created table; both remote engines reject direct UPDATE in read-only transaction. |
| F02 | Source confirmed generation bypassed the shield. Active route now anonymizes schema, question identifiers, previous SQL and definitions; maps are discarded; rows/default values are omitted. | Captured outbound HTTP fixture, deanonymization and bound execution on both real engines. Real privacy-enabled Gemini terminal salary/follow-up/clarification pass; coarse semantic roles are described in N33. |
| F03 | Installed development host exposed duplicate API acquisition, including SchemaCreator; panel failed to render. All components use one wrapper. | Actual rebuilt panel, datasets, analysis, schema, navigator and diagnostics; packaged panel renders. |
| F04 | Source confirmed separate active-connection choices. Sidebar, terminal, panels and reopened analyses use the shared workspace pointer; pending SQL remains bound to its original target. | Controller target-switch test and connection-specific schema HTTP tests. Complete two-connection desktop wizard matrix remains. |
| F05 | Source confirmed workspace-wide schema cache reuse. Backend schema/index entries and fingerprints are connection scoped; live introspection detects external changes. | HTTP two schemas + external DDL refresh, real schema desktop rendering. |
| F06 | Source confirmed credential management abandoned the first question. Credential selection/save returns to the same request once. | Controller no-key/save/resume exactly-once. Actual no-key session prompt resumes request and real Gemini rejects known-invalid fixture key. Actual supplied Gemini session-only key resumes the first question and returns executable SQL. |
| F07 | Source confirmed local mode required a key. Local bypasses cloud credential selection. | Controller plus actual terminal and Analysis local fixture, no key. |
| F08 | Source confirmed keys lacked provider binding. Keys are bound to the chosen provider and discarded on switch/reset/close; mid-prompt provider changes abort selection. | Controller between-request and mid-prompt switch tests. Actual Gemini → Groq → Gemini switch asks for a new provider-specific credential each time; both replacement prompts cancelled without sending the Gemini key to Groq. |
| F09 | Source confirmed optimistic key-save success. Save waits for SecretStorage acknowledgement and explicitly says inference verification is pending; successful requests record verification in memory. | Controller flow and host acknowledgement. KDE OS keyring unavailable; persisted secure save/reload pending. |
| F10 | Source confirmed raw/fenced/prose output and invented confidence. Normalize fences, validate structured output and exact bindings, ground one read-only query to live schema; show validation rather than 90% accuracy. | HTTP malformed/empty/prose/invented-column/wrong-table/fence tests, generated parameter test, real-engine controlled cloud envelope. |
| F11 | Source confirmed missing history. Connection-scoped bounded conversation is forwarded; close/reopen restores SQL/bindings. | HTTP captured conversation, controller follow-ups, real terminal and Analysis follow-ups; reopened named analysis run. |
| F12 | Source confirmed glossary omitted from active generation. Matched reviewed definitions and units are included and retained for follow-ups; saved analyses retain definition revisions. | HTTP captured definition payload and update/reopen; actual stale-definition run blocks until reviewed save. |
| F13 | Source confirmed cancellation did not reach transport/database. Abort signals cancel HTTP; request ids and disconnect monitors cancel SQL; database driver/server controls interrupt work. | Transport/controller cancellation, actual SQLite timeout/cancel, both remote engine cancellation and usable connection afterwards. Actual packaged Cancel interrupts a real SQLite recursive query; immediate follow-up COUNT succeeds. |
| F14 | Source confirmed nominal timeout/blocking execution. Work runs off the HTTP event loop with server/driver deadlines and bounded fetches. | Responsive SQLite regression; both real remote engines terminate a 10-second operation under a 1-second deadline. |
| F15 | Source and desktop activation showed setup lifecycle problems. Recovery commands register before setup, and setup notification does not block activation. | Packaged clean profile: choose Later, open workspace, invoke installer, ready backend. Failed reinstall recovery verified. Unsupported/missing Python desktop injection still pending. |
| F16 | Source confirmed stale readiness after crash. Clear client/readiness on exit, bound shutdown, retry once, require manual recovery after repeated crash, reject obsolete startup completion. | Three lifecycle regressions pass; actual packaged first/repeated crash and manual restart pass. Shutdown race N10 reproduced in old package and repaired. |
| F17 | Source confirmed escape bytes corrupted input. Parse split escape sequences, cursor editing, history, delete and Unicode code points; accept cancellation while busy. | Three PTY input tests; actual question/follow-up and /run terminal flow. Wide-character/grapheme cursor positioning is not fully covered. |
| F18 | Source confirmed read/modify/write races and swallowed errors. Serialize host writes, use atomic unique temp files and shared per-file backend locks; preserve corrupt data with visible error. Query tree has one backend writer. | Concurrent history/conversation tests, separate backend store-instance writers, glossary reopen in actual packaged UI, corrupt-file preservation. Cross-process simultaneous workspace writers remain outside this test claim. |
| F19 | Baseline masked numeric totals and Human Resources while leaking sixth-row email. Mask per cell using types/column evidence across all loaded rows; audit omits source values. | Unit/HTTP/file preview, financial/boundary results and diagnostic evidence. This is a limited PII detector, not universal classification. |
| F20 | Source confirmed dedicated schema path did not load/render. Commands open the unified workspace; live schema tables and strict Mermaid SVG render. Old dead panel removed. | Actual Schema tab loads employees/PK and renders SVG. Generated-schema preview uses the same renderer. |
| F21 | Source confirmed missing dedicated tree asset. Tree command opens the built workspace ReactFlow view with real stored nodes; fork/checkpoint go through backend. Old dead panel removed. | Actual packaged tree renders stored nodes, adds one fork, persists checkpoint and compares SQL/connection/measured status. |
| F22 | Source confirmed incompatible impact field names. Client sends proposed_ddl and bound db_config_id. | Transport contract and HTTP impact test. |
| F23 | Source confirmed inconsistent creation error/settings handling. Shared credentials/busy/cancel flow; acknowledged errors; explicit DDL review, native confirmation, execution read-only/timeout settings and schema refresh. | DDL executed on both real engines; MySQL index syntax tested. Real Gemini schema generation exposed a 422; bounded retry produced valid schema. Actual packaged Gemini SQLite schema/ER diagram, read-only rejection and confirmed application/schema refresh pass; full DDL apply/error matrix remains. |
| F24 | Source confirmed file-only connection saves. Dry-run validate, store password if needed, register live pool then atomically persist config; failed edits retain prior pool. | Dataset import registers immediately and queries in desktop. Actual PostgreSQL/MySQL TLS routes and failed edits preserve pools. Actual SQLite form add/edit, second-schema selection and native confirmed delete pass; database file retained. Remote-password desktop cases remain blocked by OS keyring. |
| F25 | Source confirmed fixed robustness samples. UI requests current scoped history; legacy heuristic is explicitly labelled a static simulation. Measured supported migration checks live in Rehearsal. | Source/build checked, real rename rehearsal produces measured failure. Legacy simulation is not a robustness accuracy claim. |
| F26 | Baseline blocked UNION. Read-only Query AST includes set operations. | HTTP and both real engines: UNION, INTERSECT and EXCEPT pass. |
| F27 | Source confirmed Run Last used default. Reexecution uses saved connection, named bindings, schema revision and current execution policy. Deleted targets give an error. | Controller original target/schema tests, saved desktop parameter run. Actual packaged Run Last reexecutes threshold/department bindings and returns Dev on datasets. |
| F28 | Baseline accepted negative limits. Typed bounds enforce rows 1–10,000 and timeout 1–600; reject malformed settings. | Request-boundary tests and real bounded fetch/truncation. |
| F29 | Source confirmed optimistic index flag/full reindex per question. Connection fingerprints control offline lexical rebuild; status reports success/failure truthfully. | HTTP external DDL refresh, actual Schema index-ready display. No embedding/model download. |
| F30 | Source confirmed ignored SSL flag. PostgreSQL verify-full with optional CA; MySQL verified SSLContext. Invalid CA errors are actionable. | Both actual engines: TLS connection, cipher/SSL evidence, hostname mismatch rejected, failed edit retains working pool. |
| F31 | Source confirmed unsupported MongoDB/SQL Server choices. UI/API permit SQLite, PostgreSQL, MySQL only. | Typed route validation and actual connection form choices; unsupported drivers are not advertised. |
| F32 | Source confirmed missing meaningful extension/main-flow quality gates. Added controller, transport, PTY, lifecycle, HTTP, safety, workspace and real-engine tests; CI compiles/lints/builds/packages. | Backend 138 passed including real engines/TLS; extension 46 passed (nine suites); CI defined but not run remotely. Actual desktop evidence is separate from mocks. |
| F33 | Source confirmed fragile setup/dependency/size contract. Lean pinned runtime, Python 3.11–3.13 check, staged checked venv + hashed manifest, failed-stage cleanup and command deduplication. | Fresh installed VS Code installer and forced invalid dependency failure. Observed packaged venv ~163 MB file bytes; VSIX ~2.18 MB, with caches/profiles/data/tests excluded. Package update/reload preserved the working manifest before the final requirements-comment correction. Other OS/Python versions await CI/live checks. |

## Additional historical observations

| ID | Result |
|---|---|
| A01 | MySQL generator no longer emits CREATE INDEX IF NOT EXISTS. Generated schema/index executes on actual MySQL 8.4.11. |
| A02 | Narrow obvious off-topic filter no longer accepts list/from alone; plural jokes/recipes are rejected before provider access. One structured generation call decides ambiguous scope. Actual Gemini salary/follow-up and ambiguity responses are recorded separately; broad real-model loophole matrix remains. Historical fixed salary response is not inference evidence. |
| A03 | Non-loopback middleware returns clean JSON HTTP 403; token boundary returns 401. Boundary tests pass. |
| A04 | Busy is set before credential selection; duplicate submit blocked; mid-prompt provider change aborts safely. Controlled-host tests pass. |
| A05 | Preserve original discrepancy: raw save=500/read reset versus narrative successful glossary. Fresh HTTP save/read/update/reopen passes now; desktop secure/provider path not inferred from that narrative. |
| A06 | Preserve original normal-cancel result; do not infer a crash. Current reset aborts transport and ignores late completion; execution attempts still enter history honestly. Controller tests pass. |
| A07 | Backend and extension development version both 1.5.0. Authenticated health version test passes. |
| A08 | Numerical narrative now states measured returned row count/limit; timing alerts need meaningful duration and absolute change. Controlled fixture narrative is not treated as a model defect. |

## Newly found issues

| ID | Finding / fix / evidence |
|---|---|
| N01 | Awaited setup notice left activation pending. Fire-and-forget notice; installed host activation and command inventory complete before dismissal. |
| N02 | Third duplicate API acquisition in SchemaCreator. Shared wrapper; actual exception captured then panel rendered. |
| N03 | Import-time argparse interfered with embedding/tests. CLI parsing moved to entry point; backend HTTP suite passes. |
| N04 | Identical SQL on different connections updated the wrong query node/performance baseline. Connection added to matching/fingerprint. |
| N05 | Follow-up context could cross a connection switch. Start a new scoped conversation; controller test passes. |
| N06 | Old execution completion after reset could restore state. Record attempt without attaching it to new session; controlled regression. |
| N07 | Duplicate joined column names overwrote values. Reject duplicate output names and request explicit aliases. |
| N08 | Actual PostgreSQL test exposed pyformat rendering being escaped again by SQLAlchemy. Keep :named bindings through splitting/deanonymization; both actual engines and controlled cloud envelopes pass. |
| N09 | CSV refresh cleared saved mapping on file/paste change. Retain explicit saved mapping until user starts a new mapping; actual replace refresh imports exactly five rows. |
| N10 | Actual packaged restart exposed child exit during shutdown wait. Capture process/client, invalidate old start and avoid touching a replaced child after await; three lifecycle regressions plus actual packaged crash/restart pass; old native error dialog captured as evidence. |
| N11 | Named bindings were lost in history/Run Last/diagnostics. Carry parameters and schema revision; actual reopened parameter analysis and diagnostics pass. |
| N12 | Corrupt history could be silently replaced by a new empty history. Raise visible preservation error; corrupt bytes unchanged after attempted append. |
| N13 | Cross-file ORM model changes left cached usages stale. Resolve unambiguous model symbols, include model revision in cache; cross-file refresh test passes and configuration URLs are omitted. Model discovery now shares the 2,000-file bound; excluded-model regression passes. |
| N14 | Provider switching during a password prompt could retain a key for the wrong provider. Check provider again before retaining/sending; controlled-host regression. |
| N15 | Missing MySQL CA failed before route error handling. Move context creation into validation try; actual missing-CA route returns 400 and preserves pool. |
| N16 | Schema descriptions could inject new DDL lines through a comment. Collapse description newlines before emitting comments. |
| N17 | Async conversation restore could overwrite recalled SQL or a reset. State revision guards protect newer actions; recall/bindings/reset regression passes. |
| N18 | Export could combine previously executed rows with edited parameters/question/definitions. Capture immutable execution provenance; export tests and actual report Save dialog prove it retains executed bindings/question/Dev row after next-question draft. |
| N19 | Quoted CSV strings beginning with a spreadsheet formula could still execute on opening. Neutralize formula-like text while preserving numeric values; quote/newline/formula regression passes. |
| N20 | Glossary rows used term-only React keys and same-term editing could retain another scope's unit draft. Use connection+term keys and initialize units on explicit edit. Source/typecheck verified; duplicate-scope desktop case remains. |
| N21 | Reviewed DDL ignored its generated dialect and allowed dialect selection to relabel old SQL. Retain generated dialect and reject mismatched active target before confirmation. Actual installed target-switch check rejects SQLite DDL on PostgreSQL before write confirmation; real Gemini creation/application is recorded separately. |
| N22 | Robustness command still used default connection and presented static values as measured accuracy. Command opens real Rehearsal; legacy panel omits invented model-accuracy columns. Actual packaged command opens Change Rehearsal. |
| N23 | New-connection Save did not retain returned id, allowing repeated saves to create another entry. Retain acknowledged id, provide explicit Add another action; actual packaged repeated-save case retains one id, edits its name, and creates no duplicate. |
| N24 | Failed generation could leave old result rows visible under the new question. Clear results/status when generation/execution begins. Found during actual invalid-key desktop case; actual packaged off-topic case clears old rows; stale SQL separately tracked in N26. |
| N25 | Delete had no acknowledgement/busy state, allowing repeated confirmation requests. Acknowledge completion/cancel and disable actions while pending; clear removed form. Actual repeated-delete actions disabled until native confirmation finishes; acknowledged deletion clears the form and preserves the database file. |
| N26 | A new clarification/off-topic/error could retain previous executable SQL in Analysis and terminal. Actual Gemini ambiguity reproduced it. Clear SQL/binding/result/selection when asking and invalidate session pending SQL; controller and PTY regressions pass. Actual privacy-enabled Gemini terminal clarification clears SQL; /run refuses the previous query. Final Analysis rate-limit error clears old SQL and disables Run. Real Plus Analysis clarification on 17 October also clears the old executable SQL; confirmed units then produce the correct reviewed result. |
| N27 | Deterministic off-topic rejection could mark an untested key verified. Backend distinguishes provider access; client and session mark only real responses. HTTP and controller regressions pass. |
| N28 | Generated DDL could create children before parents, leave reserved names unquoted, accept nonunique FK targets, and pass comma-containing DECIMAL types to Mermaid. Quote/order/validate DDL, bound object names and normalize diagram types. Executable SQLite and actual PostgreSQL/MySQL regressions pass; cycles are explicitly unsupported on the latter engines. |
| N29 | Provider SDK could retry a 60-second request past the extension deadline and truncated/empty output looked like an ordinary schema-validation error. Disable hidden SDK retries, bound supported Gemini reasoning, reject incomplete output with actionable messages and align the schema prompt with allowed constraints. First cloud timeout/422 preserved; bounded direct retry and actual packaged two-table schema/ER diagram succeeded. |
| N30 | Reconciliation UI discarded named bindings despite retaining them in Use Last. Expose/forward bindings for both sources. Parameterized regression and actual installed source/report preview pass with bindings on both sources; payroll changes 35501→36500 only on snapshot. |
| N31 | Schema completion could return after cancellation/provider switch, and schema routes did not stop cloud work after disconnect. Guard late completion and cancel provider tasks on disconnect. Controller and async provider-cancellation regressions pass. |
| N32 | DDL success claimed schema refresh succeeded even when refresh failed. Acknowledge applied DDL separately from refresh and show an explicit retry message when needed. Controller regression distinguishes applied DDL/failed refresh and verifies write-error/cancel acknowledgements; actual successful apply/refresh passes. Refresh-failure desktop injection remains. |
| N33 | Actual Gemini privacy-enabled terminal follow-up could not distinguish anonymous text columns and displayed col_1/col_3 to the user. Add coarse conventional semantic roles without sending source identifiers/rows, restore names in clarification text, and prefer the explicitly requested source. Captured-envelope/privacy cleanup regression passes; actual packaged privacy-enabled Gemini first question, IT follow-up and clarification now pass; SQL uses the requested employee source. |
| N34 | Conversation reload searched for any earlier SQL and could revive it after a newer clarification/failed question. Restore only SQL after the latest user question; execution-status turns retain valid bindings. Three reload regressions and actual installed conversation reload followed by stale /run refusal pass. |
| N35 | Actual target-switch test found schema creation was unmounted on tab navigation, discarding generated DDL/requirements before database selection. Retain the visited schema-creation view like Analysis; actual installed navigation preserves requirements/DDL and mismatched dialect is rejected before confirmation; controlled local schema response is labelled separately from prior real Gemini generation. |
| N36 | The Analysis request timed out while the host still owned credential/provider work. A 95-second webview clock included user dialogs, breaking first-question resume and acknowledgements after slow choices. Let interactive operations use host deadlines after input; retain a bounded execution fallback. Slow-choice/exactly-once and bounded execution regressions pass. Actual delayed credential choice reaches a provider rate-limit error and clears old SQL. Real Plus Analysis clarification and subsequent generation/follow-up pass on 17 October; this does not repeat every delayed-dialog scenario with a live provider. |

| N37 | Source investigation found unknown provider names fell back to a Gemini stored key. Explicit known-provider lookup now returns no key for unknown/local providers, and OpenRouter has a separate secret identifier. Provider-isolation/deletion and OpenRouter session/model forwarding regressions pass. |

| N38 | Installed ChatGPT sign-in showed a connected account while model selection remained disabled. The welcome dialog held login open; independently, the returned snapshot was captured before `finally` cleared its busy state and could overwrite the final status event. Make the welcome nonblocking and clear busy before returning. A regression with an undismissed welcome now completes login and returns `busy:false`, with zero inference calls. |
| N39 | Fixed 17 October — documentation mismatch originally source-confirmed at 1bc9fdd. Rewrote CONTRIBUTING.md around the active request-scoped privacy maps, built-in masking, lexical index, real development paths, authenticated backend and packaged testing. Removed obsolete salt/custom-rule/plan-similarity instructions. Local documentation links resolve. |
| N40 | Open — release tooling review, source-confirmed on 9 October at 1bc9fdd. Legacy tag-triggered publish.yml uses Node 20, unlocked installs and a globally installed publisher, unlike verified Node 24 packaging, and does not run the complete checks before publishing. That publishing route is unverified. No tag or Marketplace release attempted. A verified VSIX is sufficient for the narrowed college scope; repair this workflow only before using it. |
| N41 | Fixed 17 October — the SQL editor existed only after generation/recall and disappeared when its last character was deleted. Added explicit Write SQL myself with actual schema/connection binding and no credential acquisition, plus independent editor visibility. Host/session and browser checks cover empty recovery, no automatic execution, connection/revision guards and zero AI requests; installed manual execution also passes. |
| N42 | Fixed 17 October — opening an analysis did not broadcast its selected database, and the UI reused its stale list entry instead of the host's returned saved definition. Broadcast connections after opening and use the returned entry. Controlled message-handler regression passes; installed acceptance is recorded separately. |
| N43 | Fixed 17 October — initial last-result loading could complete after a new draft and overwrite it. Restore last results only through the deliberate button, with busy state; disable SQL/value edits during execution. Controlled browser/manual workflow passes. |
| N44 | Fixed 17 October — follow-ups could use previously generated SQL/values after manual edits or omit newly written SQL. Successful execution now records the actual reviewed SQL and bound values in conversation context, without result rows. A regression verifies changed threshold 9000 and manual context; generation still consumes no allowance during local tests. |
| N45 | Fixed in source 18 October — installed VS Code cold startup exceeded the old ten-second readiness deadline; Python became healthy later but the UI remained crashed with no usable client. Allow a bounded 45 seconds, stop a server that never becomes ready, protect newer startup state during cleanup and send the actual initial backend status to the panel. Controlled regressions cover readiness after twelve seconds, timeout cleanup, concurrent restart and initial starting state. Final installed-build acceptance is recorded in the current evidence; the original failure and manual recovery remain disclosed. |

| N46 | Found during authorized Marketplace publication on 19 October — the 2048-square indexed PNG icon was 1,059,456 bytes and Marketplace rejected it above the 1 MB limit. Lossless recompression passed the size limit but the second attempt exposed a separate maximum 1024-square dimension limit. The same artwork is proportionally reduced to 1024 square and visually inspected; both constraints are checked before another upload. This resize resamples pixels; only the intermediate compression was pixel-identical. Runtime code stays unchanged; the third upload succeeded. Public catalog validation, latest stable 1.5.0 manifest and byte-identical download now pass, recorded in MARKETPLACE-RELEASE.md. |

## Release inputs and limits

- OpenRouter's first installed Analysis call failed with a generic provider error;
  root cause remains undiagnosed and successful OpenRouter inference is pending.
  ChatGPT browser sign-in and SQL/schema Responses integration are implemented
  with controlled OAuth/JWT, stream and one-attempt-budget checks passing. Actual
  account authorization succeeded in installed VS Code: the granted plan scope
  and real visible-model catalog were received. Following the user's explicit
  authorization, three small real Plus requests using `gpt-6-luna` passed on
  17 October: unit clarification, strict-threshold SQL and a department follow-up,
  followed by exact SQLite results. No further AI calls were needed for local
  packaging checks. Official
  SIWC documentation lists Plus/Pro and does not list Go as eligible. Existing
  Codex credentials are not reused; tokens remain in extension-host memory.
  Real requests consume plan usage and may use purchased ChatGPT credits if the
  account allows them. The UI links to usage settings and requires explicit
  allowance for each extra attempt; no API-key billing fallback exists.
- Disposable provider key identified as Gemini by the user. Real session-only
  inference passed: salary boundary, IT follow-up, reviewed 9000 glossary and clarification. Initial timeout/schema 422 and final provider rate limit remain recorded; its value is absent from files/evidence. The final Analysis clarification path has now passed using Plus. On 18 October one new-key Gemini request through the final installed backend also passed schema validation and exact threshold execution with Privacy Shield enabled, no retries and unchanged source data. This did not repeat the whole Gemini desktop matrix.
- Actual employee dataset/connection and salary currency/period remain unknown.
  All salary acceptance so far uses the explicitly labelled synthetic fixture.
- KDE has no working OS keyring. Persisted SecretStorage save/reload remains
  pending; session-only flow exists. No plaintext password-store override used.
- Windows/macOS desktop acceptance remains unexecuted. Remote Ubuntu CI is now
  verified for Python 3.11/3.12/3.13, extension tests/build/package and real
  PostgreSQL/MySQL integration. Run 39133121287 passed for source ed5fd51:
  each Python job 135 passed / 12 skipped, extension 88 passed and packaged,
  engine job 10 passed / two TLS cases skipped. This does not verify desktop installers
  on those platforms/interpreters or OS SecretStorage.
- Broader roadmap slices remain: Excel, additional ORMs, selected-group aggregate
  diagnostics, application-test execution and richer migration transformations,
  view/application dependency previews, PDF/scanned sources and later SQL Test Lab.

The user's 9 October college-project scope supersedes automatic expansion of the
broader roadmap. See [COLLEGE-READINESS-AUDIT.md](COLLEGE-READINESS-AUDIT.md) for
the finite recommended submission requirements and intentionally deferred work.
