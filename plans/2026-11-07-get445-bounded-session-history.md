# Bounded Session History Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Independent review is required before integration.

**Goal:** Let an ordinary authenticated workspace Agent retrieve earlier or longer canonical dialogue without expanding its inline context budget.

**Architecture:** Retain the existing inline 6-turn / 2,000-character / 12,000-character projection. The host separately freezes complete authorized dialogue and registers a read-only page/search/read tool with bounded UTF-16 continuations. Existing source-generation and Session-content guards, live actor/session checks and source-retention checks fence every tool response before and after access.

**Tech stack:** Existing TypeScript, Zod, HarnessTool and PostgreSQL authority checks. No dependency, migration or provider changes.

**Spec:** [GET-445](https://linear.app/getyak/issue/GET-445/read-earlier-conversation-history-through-a-bounded-authorized-tool), [GitHub #518](https://github.com/getyak/capir/issues/518). The coordinating owner explicitly approved this scope on 2026-11-07 after confirming the current production truncation and reviewing the historical tool's intent.

## Design and alternatives

The chosen approach adds on-demand access over the same admitted canonical snapshot. Sending complete history inline would increase model exposure and discard current resource budgets. Restoring the old delta-sync protocol would change native persistence and is a separate capability, not necessary for this outcome. Restoring unlimited Agent quotas is also out of scope.

The tool has no account/Session selector, file path, arbitrary SQL, pixel read or external action. Literal search is explicitly not semantic proof of absence. Prior assistant text remains generated, unconfirmed dialogue. A tool read never becomes a current authored-message source for Memory, identity lookup or approval. Cursors bind a per-tool snapshot and content version; no mutable backing array is exposed.

## Global constraints

- Keep current inline/model, source, actor, Session, retention and withdrawal boundaries.
- Preserve GET-350/GET-353 and selected Person Memory draft behavior; selected-target messages do not gain history access.
- Use a fresh isolated `codex/get-445-bounded-session-history` worktree from main `d74162fcd6907c0d5bf7b4708e08d452faf61109`.
- Data is below 10 GiB: no installation, package-manager wrapper, local build, native run, provider/network acceptance or resident rebuild. Only one small pure-test process at a time.
- Host tests, hosted CI, resident deployment and real acceptance are separate evidence. Required service deployment remains incomplete until resource/deployment gates allow it.

## Review focus

1. Source revocation or auth expiry during an await returns no dialogue.
2. A cursor from another snapshot/version or selection cannot read or skip arbitrary text.
3. Long Unicode messages remain reachable without splitting a surrogate pair or looping forever.
4. Earlier assistant prose and history tool data cannot become authored source authority.
5. Default callers and inline budgets remain unchanged, including selected-person Memory requests.

## Task 1: Bounded history tool

Files: create `apps/agent/src/conversationHistoryTools.ts` and its focused test; export through `apps/agent/src/index.ts`.

- [x] Write and run a failing synthetic test for an early message and a long Unicode continuation.
- [x] Add page/search/read with strict mutually exclusive input, 20-entry pages, 16,000 default and 64,000 maximum UTF-16 text units, snapshot/version-bound cursors and before/after authority checks.
- [x] Verify cancellation, stale cursor, malformed offset, selection isolation, immutable input and partial-coverage labels.

## Task 2: Authorized host snapshot and production wiring

Files: narrowly extend `apps/backend/src/modules/agentSessions.ts` complete-dialogue projection, add a bounded authority adapter if needed, wire `unscopedChat.ts` through `workspaceConversationAgent.ts`, and add focused regressions.

- [x] Add failing synthetic reader/wiring tests for history older than six turns, long canonical text, unchanged default projection, foreign owner, source expiry and revoked auth.
- [x] Build the complete snapshot only for the admitted ordinary workspace SDK path, while preserving bounded inline history.
- [x] Check live authenticated actor/session plus existing Session content/source generation and inherited-source availability before/after every response.
- [x] Ensure root/current message exclusion and no new Memory-source authority; selected-target messages receive no history tool.

## Task 3: Verification and handoff

- [x] Run focused pure regressions sequentially with existing read-only dependency resolution; capture commands and results in a registered artifact.
- [ ] Check exact diff, owning architecture/dependency contracts and static TypeScript diagnostics where lightweight.
- [ ] Request independent review; fix confirmed P0/P1.
- [ ] Report exact source/base, remaining CI and resident deployment gates; no claim of functional release before those gates pass.

## Review ledger and current evidence

Ruling: Keep the admitted capability snapshot as a conservative reply dependency,
including unread pages, so withdrawal cannot strand a reply whose earlier context
was reachable only through the tool. This costs some availability when an unused
source later expires; it does not add source or action authority.

Ruling: Bounded tool output does not establish bounded host construction. The
existing database payload CHECK is 262,144 bytes, but related canonical results
and screenshot state live elsewhere. Complete snapshot construction therefore
admits at most 200 turns, 4,400 messages, 4,000 scanned source-metadata rows, 200 result
rows / 1 MiB of result JSON, and 1 MiB of UTF-8 dialogue text before fingerprint
copies. Canonical result aggregation is guarded inside one SQL statement;
screenshot fields are projected to the existing bounded canonical summary in
SQL, and inherited source metadata is batch-read. Exceeding a budget disables
the history capability with an explicit limitation while preserving ordinary
bounded chat. Authority and SQL failures are never downgraded to this state.

Independent review found two authority mismatches and both are corrected. The
complete+inline dependency union must fit the shared existing 20-source
reply-persistence limit before model execution; 21 sources explicitly disable
history without adding those dependencies. Captured original task IDs, canonical
turns/scope stamp and source generation are rechecked in one final SQL envelope
with live owner and screenshot authority after all other awaited guards. A final
database-clock check observes the shortest auth/Session/task/source deadline.
Original task/source expiry also narrows observation and SDK continuation clocks.

Current local evidence: 171 pure backend regressions across eight files and 11
pure Agent regressions across two files passed sequentially. Reader, tool
construction, pre-snapshot auth ordering, host budgets and honest unavailability
have observed failing-then-passing checks. Five new real PostgreSQL cases are in
the existing integration suite but have not run locally. Syntax-only TypeScript
transpilation is not semantic type-check evidence. The independent reviewer is
the coordinator; final review, full CI and source-bound resident deployment are
still pending. No build, install, provider or native acceptance was run.
