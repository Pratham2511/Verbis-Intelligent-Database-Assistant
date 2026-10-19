# Marketplace 1.5.0 release record

Prepared 19 October 2026 following the user's explicit request to make 1.5.0
the current stable VS Code Marketplace version. GitHub `main` stays at
`77b1422fcac2e205cd6d5ef39c0df94a4b2b3cb5` (1.4.0); development source remains on
`work/verbis-1.5-verified-workflows`.

## Verified code and package

The implementation is unchanged from `ed5fd51dd84a6b466acaf940d489877f94aa1f95`.
[GitHub verification run 39133121287](https://github.com/Pratham2511/Verbis-Intelligent-Database-Assistant/actions/runs/39133121287)
passed all five jobs: 88 extension tests, compile/lint/typecheck/build/package,
Python 3.11/3.12/3.13 with 135 passed / 12 skipped each, and PostgreSQL/MySQL
integration with 10 passed / two TLS cases skipped. Installed UI and real Plus/
Gemini acceptance are separately recorded in
[college-implementation-checks.json](../tests/evidence/college-implementation-checks.json).

Marketplace preparation only removes the development label from the README and
changelog. The release VSIX is rebuilt with Node 24 and the locked local publisher,
with source links pinned to its release-source commit. All 215 runtime files must
match the previously verified package byte for byte. Test profiles, databases,
credentials, local logs, demo sources and evidence stay outside the VSIX.

## Publication status

Pending publisher authentication and upload. No Marketplace PAT is configured in
the current environment, local publisher store or repository secrets. The old
tag workflow is not used: it has unverified tooling and omits runtime dependency
detection. No release tag is needed to upload an already verified VSIX.

The authorized operation is to publish exactly
`pratham2511.verbis-db-assistant` version `1.5.0` as stable, then independently
verify the public version manifest and compare downloaded runtime bytes. Do not
infer public availability from a successful upload alone. Record the final VSIX
hash and live result here after publication. The limited college scope and
documented platform/provider acceptance limits remain unchanged.
