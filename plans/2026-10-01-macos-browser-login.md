# Browser-owned macOS sign-in

## Outcome and authorization

The user requests complete implementation, replacement of the earlier desktop-login design, elegant boundaries, explicit successful-chain standards, and no username/password entry in the Mac application. Browser authentication may use the existing Web methods. Codex owns architecture, integration, independent acceptance and delivery; Pi/MiMo owns a bounded implementation and first local checks. Do not touch unrelated worktrees, accounts or evidence. Do not re-enter the incomplete September 25 linking protocol as a prerequisite.

## Baseline and scope

Fresh origin/main: `127600957161ac52f910ac05f1aeb77b1daf9490`. Parent worktree: `/Users/cubxxw/.codex/worktrees/macos-browser-sign-in/talent-signal`, branch `codex/macos-browser-sign-in`. Original checkout has unrelated untracked documents and plans, preserved. GET-43 belongs to IMStage and is unrelated; do not edit it.

In scope: browser-owned primary login, durable one-use backend grant, first-party browser confirmation, authenticated WebKit cookie installation, native recovery and origin/store ownership, relevant tests, updated canonical documents. Existing account methods, onboarding, Web sign-in, account identity and retention remain authoritative. Account settings remain in the external browser; no new native credential-linking protocol. No passkey registration, global account migration, copied browser cookies, broad native bridge, provider secret changes, iOS Simulator or new token lifetime policy.

## Decision

[ADR 0022](../docs/decisions/0022-browser-owned-macos-login.md) replaces ADR0019's per-provider primary-login protocol. A single first-party browser flow uses the current verified Web account with explicit approval and issues a separate Mac device session. Provider/password authentication stays entirely in that browser. ASWebAuthenticationSession owns callback delivery; PKCE binds exchange to the initiating app operation. Native never receives provider credentials or copies authentication cookies. A new identified WebKit store isolates each new primary login; durable selection and unresolved markers protect restart and late responses.

## Milestones

1. Active: implement backend grant, Web confirmation/exchange/status, and native user flow on the frozen baseline with Pi.
2. Pending: independently inspect diff and run backend/PostgreSQL, Web, real WebKit and native acceptance; close confirmed P0/P1 findings with independent reviewer.
3. Pending: run current-head required checks; create reviewable PR; rebuild/redeploy local backend as required by apps/backend/AGENTS.md and verify affected Web/native surfaces without claiming a production release or modifying provider accounts.
4. Pending: route final decisions/operations evidence, preserve formal receipts and clean only task-owned temporary artifacts.

## Successful chain and failure evidence

Success requires all of: the real native login entry; browser identity read from the live backend; intentional browser approval for this Mac operation; correctly bound one-use callback; atomic backend device-session creation; normal HttpOnly session cookie installed in the selected WK store; no-cookie-write live backend status identifying the exact approved account AND user; original workspace/onboarding opened with the same canonical identity. An HTTP call, callback, DOM flag, auth JWT decode alone or helper test is insufficient.

Exercise wrong state/verifier/code/origin, arbitrary redirect, expired/replayed/cancelled grants, browser-session revocation, Lab refusal, double-click/concurrent operations, delayed cookie responses, account and endpoint switches, cancellation before/after possible exchange, restart with unresolved selection, network loss and exact read-only recovery. Never replay a potentially consumed grant to manufacture success. Existing valid Mac sessions reopen without launching the browser; expired sessions expose the same browser-only entry and preserve recoverable drafts.

## Environment and receipts

Storage audit initially reports 76 GiB free against the 80 GiB heavyweight-build threshold. No iOS Simulator is required. Inspect reclaimable package caches safely before native heavyweight builds, preserve active task artifacts and repositories. Pi preflight is offline only: Pro credential present, no active Pi writer found. Relevant sources: Codex and Claude Code official browser-auth docs, RFC8252, Apple ASWebAuthenticationSession and identified WK data stores, installed Next.js route/cookie guides and Auth.js supported Credentials signIn APIs.

## Open uncertainties

Actual provider/password interaction may require the human's credentials or OS confirmation; do not fake it. Controlled account/browser/WebKit proof can establish protocol mechanics separately. Installed-app and production-release changes need an independently verified source/binary boundary; do not claim the user's installed app changed after only building test source. Source implementation and deployed acceptance are separate.
