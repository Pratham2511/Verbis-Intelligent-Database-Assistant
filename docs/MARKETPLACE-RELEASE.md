# Marketplace 1.5.0 release record

Prepared 19 October 2026 following the user's explicit request to make 1.5.0
the current stable VS Code Marketplace version. GitHub `main` stays at
`77b1422fcac2e205cd6d5ef39c0df94a4b2b3cb5` (1.4.0); source remains on
`work/verbis-1.5-verified-workflows`.

## Publication status

The stable upload was accepted on 19 October 2026 at 17:46 IST. Public
availability was independently verified at 17:54 IST: the latest manifest
reports 1.5.0, and the public catalog selects 1.5.0 with the validated flag set
and pre-release false. The public VSIX download is byte-identical to the uploaded
artifact, including all 215 runtime files. The catalog records validation at
17:53 IST. The exact result is in
[marketplace-release-checks.json](../tests/evidence/marketplace-release-checks.json).

[Open the Marketplace listing](https://marketplace.visualstudio.com/items?itemName=pratham2511.verbis-db-assistant).
The listing's version-history panel initially retained cached 1.4.0 content
while the public catalog and download already served validated stable 1.5.0.
A screenshot of the actual public 1.5.0 manifest is retained as direct proof.

The user chose a temporary Azure DevOps publishing PAT. Hidden terminal input
passed it only through process memory; it was not saved in files or Git. The
user was told to revoke it after the upload. No additional AI request was made.

## Verified code and artifact

Implementation is unchanged from `ed5fd51dd84a6b466acaf940d489877f94aa1f95`.
[GitHub verification run 39133121287](https://github.com/Pratham2511/Verbis-Intelligent-Database-Assistant/actions/runs/39133121287)
passed all five jobs: 88 extension tests, compile/lint/typecheck/build/package,
Python 3.11/3.12/3.13 with 135 passed / 12 skipped each, and PostgreSQL/MySQL
integration with 10 passed / two TLS cases skipped. Installed UI and real Plus/
Gemini acceptance remain separately recorded in
[college-implementation-checks.json](../tests/evidence/college-implementation-checks.json).

The uploaded VSIX has 224 entries / 2,020,340 bytes. SHA-256:
`d30d266efa697e2592324a9e539d27968dbb979aed126c61c21c6c6f71c046ec`.
Source links are pinned to `544f964b092c7e0332c689d285ef85404fb72c55`.
All 215 runtime files match the tested college package and current source byte
for byte. The package is stable, includes the jose runtime dependency, and
contains no test profiles, databases, credentials, local logs, demo sources or
evidence. Node 24 and the locked publisher built it with normal secret scanning.

## Packaging findings and safeguards

The first upload was rejected because the existing 2048-square icon was
1,059,456 bytes, above the 1024 KB limit. Lossless IDAT compression preserved
its exact scanline bytes and passed the size check, but the second attempt
exposed a separate maximum dimension of 1024 square. The final icon uses the
same artwork, proportionally reduced to 1024 square and visually inspected;
both size and dimension constraints pass. Resizing resamples pixels, so the
pixel-identity statement applies only to the intermediate compression attempt.
The third upload succeeded. Rejected artifact hashes are retained in the JSON
record; those attempts are not counted as public releases.

The old tag workflow was not used: its tooling and dependency handling remain
unverified. Direct upload of the reviewed VSIX created no tag and changed no
GitHub `main` files. Documented platform/provider acceptance limits remain.

## Public verification completed

- Public latest manifest: version 1.5.0, publisher pratham2511.
- Public catalog: newest version 1.5.0, validated flag 1, pre-release false.
- Public download: 2,020,340 bytes; SHA-256 equals the uploaded artifact above.
- All 215 runtime files equal the reviewed upload.
- Screenshot: [public 1.5.0 manifest](../tests/evidence/marketplace-live-manifest.png).

Earlier public asset requests returned 404 during Microsoft's validation;
these were pending distribution, not failed uploads. Validation and public
availability are now confirmed. No new inference or broad regression rerun was
needed because release changes affect only documentation and the icon.
