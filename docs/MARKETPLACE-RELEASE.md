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

The initial stable artifact was 2,375,218 bytes with 224 entries; all 215 runtime files
match the verified college VSIX. SHA-256:
`230ebde88ee087d2dfeeaa3f5a2f6876c54b6b9d64b65e9d1b89c7f847c8388c`.
Source links are pinned to `0d7eb88089f5dd8eea37214306b082e29a49b105`.
The initial comparison is recorded in
[marketplace-release-checks.json](../tests/evidence/marketplace-release-checks.json).

## Publication status

The user chose a temporary publishing PAT, supplied through hidden input without
saving it. Marketplace authenticated the first upload but rejected the icon:
the 2,048-square PNG exceeded the 1 MB limit. Lossless IDAT recompression keeps
the palette, header and decompressed scanline bytes identical while bringing
the icon under the limit. Rebuild/retry uses the same verified runtime files;
the second upload then exposed the separate 1,024-square dimension limit.
The same artwork is proportionally reduced to 1,024 square, visually inspected
and checked against both limits before the next build. This dimension reduction
resamples pixels; the preceding lossless claim applies only to the intermediate
compression attempt. The final artifact hash and public availability must be
checked again. The old
tag workflow is not used: it has unverified tooling and omits runtime dependency
detection. No release tag is needed to upload an already verified VSIX.

The authorized operation is to publish exactly
`pratham2511.verbis-db-assistant` version `1.5.0` as stable, then independently
verify the public version manifest and compare downloaded runtime bytes. Do not
infer public availability from a successful upload alone. Record the final VSIX
hash and live result here after publication. The limited college scope and
documented platform/provider acceptance limits remain unchanged.
