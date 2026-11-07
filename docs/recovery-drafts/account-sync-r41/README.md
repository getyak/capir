# Unfinished account-sync r41 source reference

This directory preserves selected unpublished source snapshots for
[GET-439](https://linear.app/getyak/issue/GET-439). It is historical reference
material. It is unfinished, inactive, and below current code and accepted
decisions in the repository's authority order.

The preserved TypeScript, Swift, SQL and JavaScript files use the extra
`.source.txt` extension under `source/`. They are plain reference text outside
application and package source roots. This change adds no imports, routes,
database migrations, build targets, native composition or deployment wiring.
Do not execute these files or copy them over current production files as a
recovery procedure.

## Exact scope and provenance

[manifest.json](manifest.json) records each original relative path, preserved
path, raw byte count, SHA-256 and Git blob SHA-1. The hashes identify the exact
bytes, including original line endings. No source bytes were reformatted or
redacted.

- Historical branch: `codex/account-sync-transport-r41`.
- Historical committed head:
  `4f85655560bbadf38f0d91bfdca3e6c2e46425cb`.
- Historical merge base with the archive base:
  `3ee66972bc94e4847fb22ae7bbd5c11b02376b23`.
- Archive base, freshly fetched `origin/main`:
  `e4465fb1f9b2be8be81211cb0c6c9f937f2b2559`.
- Snapshot date: 2026-11-07.
- Fifty source snapshots, totaling 1,118,939 bytes: 45 source paths changed
  by the eight listed commits, plus seven working-file snapshots, with two
  overlapping paths counted once.

For the seven working files, the latest reviewed working bytes take precedence
over their committed versions. The other 43 files come from the historical
head. Each entry distinguishes its snapshot kind and records the committed
head blob where one exists. The manifest also records the eight historical
commit IDs and their changed source paths. It does not import their Git objects
or intermediate source versions. This is a source snapshot, not a complete
backup of the branch or its history.

The selected exact blobs were absent from the inspected remote-ref history
and the locally present histories of 192 tips separately confirmed available
through GitHub's object API. The r41 head itself returned no GitHub object.
These are dated, bounded reachability observations; they do not prove that no
other hidden or unreachable GitHub object contains the same bytes.

## Public boundary

Only implementation source, source comments, product copy and synthetic test
fixtures are included. Test email addresses and mock credentials describe
isolated fixture inputs, not real accounts or usable provider credentials.
The fixture fallback address in the old macOS application model is preserved
as source code, not as a machine or account configuration record.

Evaluation payloads, receipts, screenshots, transcripts, runtime data, logs,
browser state, actual credentials, machine configuration, environment files,
generated `next-env.d.ts`, build output and dependencies are excluded. Their
contents were not used to prepare this reference. Public preservation of these
source files grants no authority to publish other files from the old branch.

## Relationship to current behavior

[PR #248](https://github.com/getyak/capir/pull/248) delivered the earlier account
sync scope while excluding phase-two macOS system-browser authentication. Its
[release boundary](https://github.com/getyak/capir/pull/248#issuecomment-5829533362)
and later
[shared-boundary review](https://github.com/getyak/capir/pull/248#issuecomment-5829885895)
do not establish acceptance of this unfinished draft.

[PR #506](https://github.com/getyak/capir/pull/506), GET-350, later delivered
password-result recovery in the current application files. The old r41
actions and staged forms overlap that work. They must not replace its sealed
operation identity, recovery readback, revision/session guards or fencing of
late results. The historical architecture checker is also reference text;
the current checker remains authoritative.

Preservation establishes byte integrity and provenance only. It does not
establish compilation, correct native composition, live OAuth, database or
provider behavior, host ownership, device acceptance, deployment, or readiness
to enable the feature. Any functional port needs a separate change based on
current main, an independent review, applicable tests and the repository's
runtime delivery requirements.
