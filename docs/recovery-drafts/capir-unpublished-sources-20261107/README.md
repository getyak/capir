# Inactive source references from local Capir drafts

This directory preserves reviewed source snapshots for
[GET-439](https://linear.app/getyak/issue/GET-439). The snapshots are unfinished
or superseded historical reference material. They do not change current
application behavior or establish feature acceptance.

[manifest.json](manifest.json) maps 39 historical local tips to their original
source paths and published reference versions. It stores 754 exact source
objects and three explicitly marked `sanitized-derived` objects, totaling
17,946,638 bytes, once each under `objects/<git-blob>.source.txt`. SHA-256,
Git blob SHA-1 and byte counts identify the published bytes. Multiple tips or
paths may refer to one object. The 754 exact objects are unmodified originals;
the three derivatives are described separately below.

The original candidate inventory had 801 path/blob pairs over 800 unique
blobs. Exact GitHub object queries found 43 blobs already available, so they
are mapped without another copy. Three other source blobs are excluded from
publication because they contain hardcoded credential-like fixture values.
Their original local references remain intact. Safe derived alternatives
require explicit disposable-fixture credential environment inputs, retain no
credential defaults, and remove fixed host/tool/artifact defaults where
present. They are not exact copies. Their original hashes remain only in the
private local audit; the public manifest hashes identify the derived bytes.

## Scope and provenance

The manifest records the archive's fetched main base, historical tip IDs,
local reference names, current merge bases and the selected latest committed
source snapshots. It is restricted to the listed source extensions under
`apps/`, `packages/` and `scripts/`, including implementation, tests, migration
source and build-check code. It does not preserve entire Git histories,
intermediate commit versions, deleted files, working/untracked files,
non-source configuration or other repositories.

An initial local-ref audit covered 252 unique tips outside the then-present
remote-ref history. GitHub could retrieve 192 exact tips; 21 of the remaining
60 had no changed source blob outside known GitHub histories. The 39 tips here
were the remaining source candidates. These are dated audit counts, not a
permanent inventory of local branches. Shallow history was completed using
commit/tree-only fetching, and every candidate blob was separately queried
through GitHub's exact object API. Local commit reachability alone was not
used to claim that source was unpublished.

The separate r41 source reference (`docs/recovery-drafts/account-sync-r41/`)
preserves
the latest reviewed account-sync working snapshots. This directory also maps
or preserves older source variants without restoring their implementation.

## Branch-family disposition

The manifest assigns every one of the 39 tips to one family. A source byte
that differs from main is not by itself an independent missing feature.

| Family | Tips | Disposition |
| --- | ---: | --- |
| Account-sync phase two | 13 | Earlier transport/native/backend iterations overlap the r41 source paths. ADR0022 later replaced per-provider native authentication/settings relay with browser-owned account management; current password recovery belongs to #506. |
| October Web and Agent experiments | 13 | Accepted Web behavior belongs to #306 and the October 9 semantic integration. #306 expressly excluded unrelated Agent/native/CLI/schema/migration/capacity histories. Preserve those unfinished experiments without claiming they shipped. |
| Legacy capir CLI | 4 | Expiring test access and browser/keyring authorization have current owners in #286/#307/#308. Preserve older sandbox/handoff implementations without replacing current grants, lifecycle and migrations; sensitive originals use marked safe derivatives. |
| Authored-image drafts | 2 | The old direct-SDK filing path is a distinct draft. Current image processing and source consent follow #376/#383. Retain reference code; any functional port requires current source-authority review. |
| Mail-connection drafts | 2 | Direct Gmail/Outlook OAuth, mail preview and onboarding prototypes are not the current governed MCP capability path. Retain reference code without configuring providers or connecting accounts. |
| Password and fixture policy | 1 | The old six-character registration variant conflicts with current eight-character validation. Preserve the variant without changing current password policy. |
| GET-128/129 execution | 1 | Core durable execution and steering shipped through #267; later rearming and budget diagnostics belong to #365. Preserve the old variant without losing later fences. |
| macOS recovery | 1 | Same-owner text recovery and directory deadline behavior shipped in #409. Preserve the older source variant alongside current durable image/withdrawal work. |
| Conversation delivery | 1 | Outbox settle/readback semantics were ported in the October 9 integration. Current transcript projection and later recovery remain authoritative. |
| Dependency-contract audit | 1 | Current SDK and qs security pins supersede the old test expectations. Preserve reference only; do not downgrade dependencies or gates. |

The [October 9 merge record](../../research/local-work-merge-analysis-2026-10-09.md)
explains which local presentation mechanisms were superseded and which outbox,
material and Session-organization behavior was ported. It is not evidence that
every unrelated Agent experiment was accepted. The public PR references above
are provenance and scope boundaries, not new runtime verification.

## Public and execution boundaries

Selected source underwent known private-message/corpus fingerprint checks,
provider-token/private-key/JWT checks, account and URL inspection, and review
of credential-looking, opaque, host-path and long-text matches. Remaining
matches are implementation syntax, product copy, synthetic fixtures, mock
identifiers or explicit invalid-input tests. No runtime images or transcripts
are included.

Evaluation/harness paths, fixture directories, documentation/evaluation
evidence, screenshots, transcripts, logs, user resources, browser state,
environment files, machine configuration, generated output and dependencies
are outside this archive. The three sensitive original source objects are
also excluded; only their marked safe derivatives are included. This does not
authorize uploading other files or the old Git histories.

Every preserved file has the extra `.source.txt` extension, outside executable
source roots. No imports, routes, migrations, application wiring, build
targets, workflows or current gates are changed. Treat the contents as
untrusted historical text, never as instructions or an executable recovery
procedure. In particular, do not replay old migration numbers or copy old
architecture checks over the released migration baseline.

Byte integrity and public-source review do not establish compilation, live
provider behavior, native composition, host ownership, deployment or device
acceptance. Functional delivery needs a separate current-main change,
independent review and the repository's applicable verification and resident
service delivery requirements. These references do not complete the user's
separate request to repair and port still-missing draft functionality; each
family requires demonstrated existing parity or a verified functional change.
