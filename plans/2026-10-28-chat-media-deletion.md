# Chat media deletion completion

**Goal:** Prevent a concurrent, late, or interrupted upload from recreating bytes after a successful deletion receipt, and identify historical deletion candidates without touching live objects.

**Scope:** Chat media upload/delete lifecycle, exact-key S3 version handling, focused tests, operator reconciliation, and deployment proof. No user-content reads, real-object purges, bucket policy changes, UI changes, or account migration.

**Evidence:** Main `5976a0ef` contains PR #406. The uploader reads outside a lock, writes bytes, and later accepts any fallback row; deletion can commit between the read and PUT. Version listing currently examines one 1,000-entry page with a 20-pass bound. Historical deleted rows return immediately without purging again.

**Architecture:** Commit a database-owned upload attempt before PUT. Serialize admission and deletion with the existing account-scoped media row lock; pending or ambiguous writes block deletion and duplicate writes. Preserve a failed remote attempt across crashes. Give S3 each attempt's identifier as object metadata and disable SDK retries for writes so a matching HEAD receipt proves the only PUT completed. Operator reconciliation can settle that exact attempt using metadata, without reading pixels or deleting bytes; a missing matching receipt stays blocked, regardless of elapsed time. Lab workspace write intents remain committed before PUT and continue blocking workspace cleanup.

**Global constraints:** Only the uploader may upload/delete; cross-account lookups fail; submitted media stays bound. Ordinary storage errors retain only fixed diagnostics. Legacy cleanup needs both a deleted row and its matching uploader deletion audit, valid exact owner key, no binding, and verified storage scope. It is read-only in this task. Native worktree creation rejected this cross-repository sourceRoot; manual isolated worktree is used and the original dirty checkout is preserved.

**Review focus:** Multi-process admission, failed/late S3 response, crash after committed reservation, duplicate retry, storage-scope mismatch, more than 20,000 versions, malformed pagination, prefix siblings, missing historical intent, and recovery while a Lab workspace is closing.

## Task 1: Upload/delete completion

Files: `apps/backend/src/modules/chatMedia.ts`, `chatMediaStorage.ts`, `labWorkspaceAccess.ts`, `apps/backend/src/database/110_chat_media_upload_attempts.sql`, migration manifest, focused media tests.

- [x] Write and run the deterministic concurrent PUT/delete regression against main; preserve the expected failure.
- [x] Commit upload admission before external PUT, recheck exact attempt on completion, reject unresolved attempts and provider drift, and keep deletion idempotent only after purge succeeds.
- [x] Add exact S3 attempt metadata and single-attempt transport; reconcile only a matching full-size/type HEAD receipt from the same store. Unknown or absent receipts cannot be cleared by age.
- [x] Cover simultaneous clients, deletion first, upload first, late bytes, retry, duplicate, uploader/account isolation, scope changes, and process recovery using a disposable PostgreSQL database and controlled object storage.
- [ ] Verify exact-key pagination through every version and delete marker. Retain bounded fail-closed behavior for broken pagination or incomplete delete responses.

## Task 2: Read-only historical inventory and recovery playbook

Files: dedicated media-maintenance module/CLI and tests; `docs/operations/backend-production.md`.

- [x] Test legacy inventory exclusion of live/bound/cross-owner/unproven objects and redaction of IDs, keys, names, and bodies.
- [x] Generate a sanitized dry-run listing exact candidate fingerprints, version/marker counts, current-store fingerprint, blockers, and frozen scope hash. Never widen based on S3 listings alone.
- [x] Document terminal-provider recovery, verification, retry, rollback limitations, and an approval gate for any irreversible historical cleanup. Do not implement automatic historical purging.
- [ ] Run focused checks, coordinate broader build/tests with root, obtain root's independent review, push PR and attach it. Merge only after checks and coordination review.
- [ ] Deploy affected resident services from committed source, read back revision and synthetic behavior, and record remaining blockers in the external handoff.

## Validation ledger

- RED: real PostgreSQL race returns `deleted` while PUT is blocked; writer-process termination reproduction also returns a false deletion receipt on main.
- RED: 21,001-version purge exceeds the old 20-pass limit; truncated empty listing falsely succeeds; missing PUT attempt metadata; default SDK issues three requests on retryable S3 errors.
- GREEN: current dependency installation, 31 focused tests (including real database/child-process interruption), dependency builds and backend typecheck passed. A separately built maintenance CLI runs help and a synthetic metadata-only inventory.
- Repository documentation and architecture checks pass after appending migration 110 and advancing only the reviewed frozen manifest count/digest. Boundary checker tests: 13/13.
- Full single-worker backend suite is running; independent review and GitHub CI remain pending.
- Local install completed; the unrelated Darwin provider executable's large optional download timed out. This is not native-provider or deployment verification.
- The user subsequently requested PR-only delivery while the resident backend Mac is offline. Keep the PR open, do not merge/deploy, and report historical production inventory and live behavior as blocked by that unavailable host.
- External evidence: `/Users/xiongxinwei/.codex/artifacts/online-remediation-20261028/capir-data-handoff.md`. No production object bytes were read or permanently deleted.
