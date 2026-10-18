# Changelog

## 1.5.0 — development, unreleased

- Add manual SQL entry with no provider allowance, retaining database/revision
  binding and execution safeguards.
- Keep an empty editor open, prevent initial last-result loading from replacing
  a new draft, and update the visible connection when reopening a saved analysis.
- Add a synthetic college demo, independent expected-result checks, presentation
  guide, architecture/report and corrected developer instructions.
- Allow bounded cold backend startup beyond ten seconds, clean up timed-out
  processes and show the actual starting state in a newly opened workspace.
- Retain executed SQL and values for follow-ups after manual query edits.

- Add OpenRouter with provider-specific secrets/session keys and configurable free model slugs; default Inkling free, paid slugs rejected before network access, no SDK retries.

- Repair SQL safety, privacy payload handling, schema/connection scope,
  credential resume/local mode, cancellation, timeouts and backend lifecycle.
- Share one webview API, render live schema/tree/glossary, validate live
  connections, acknowledge persistence and label simulated robustness output.
- Add CSV Dataset Workspace, Python/SQLAlchemy Project Navigator and persistent
  parameterized Analysis Workspace with paginated results and export.
- Add bounded Result Forensics, isolated SQLite change rehearsals and explicit
  unit-aware reconciliation with reviewed correction export and isolated saved-report previews.
- Add regression tests and CI; preserve remaining release acceptance checks in
  `docs/WORK-LOG.md`.
