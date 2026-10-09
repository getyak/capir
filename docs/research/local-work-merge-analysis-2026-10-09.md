# Local work batch analysis and merge record — 2026-10-09

Dated engineering research record for the uncommitted work batch that lived on
`codex/macos-material-motion`, its integration with `main`, and the
supersession decisions that integration required. This is research: evidence
and reasoning loaded selectively. It does not override canonical product
decisions, and where a claim is unverified it is marked as such.

## Scope and method

- Checkout inspected: branch `codex/macos-material-motion`, HEAD `6c061b07`
  ("Collapse recent conversations by default"), 2026-10-09, Asia/Shanghai.
- Compared against `origin/main` `1fff66c6` and the merge base `ca552679`.
- Method: full diff and untracked inventory, plan cross-read, safety review
  against the repository code-review rules, deterministic local checks, and an
  experimental merge-tree run. No production surface, real account, or external
  system was used.

## 1. Repository state before integration

| Fact | Observed |
| --- | --- |
| Relationship to `origin/main` | local branch was 92 commits behind and 1 commit ahead of the merge base |
| Uncommitted tracked edits | 28 files, +1290 / −240 lines |
| Untracked work | 21 source/test files (~1370 new source lines), 3 plans, dated evaluation evidence, 1 `_index/` note, plus `plans/local/` and browser artifacts |
| Highest release tag | `v0.1.101` |

The local work was genuinely additive: no untracked source path existed in
`origin/main`, and none of its three feature areas appeared there. The risk was
not duplication but divergence — `origin/main` refactored 233 files in the same
Web surfaces (+17392 / −5562) while the work developed against `ca552679`.

## 2. Work stream A — macOS material and workspace organization

Plan: [`plans/2026-10-01-macos-material-motion.md`](../../plans/2026-10-01-macos-material-motion.md).

**What it delivers.** Native AppKit material behind transparent Web chrome,
and reversible device-local Session list organization with position-explaining
motion.

| Area | Key files | Behavior |
| --- | --- | --- |
| Native material | `WorkspaceMaterialSurface.swift`, `QuietWorkspaceView.swift`, regenerated `project.pbxproj` | `.sidebar` / `.behindWindow` material under `WKWebView`; one guarded, isolated `_setDrawsBackground:` KVC path with an opaque fallback; no new page capability |
| Local organization | `lib/workspace-session-organization.ts`, `workspace-session-row.tsx` | Archive/Pin store session IDs, booleans and timestamps only, partitioned by the server-computed 64-hex account scope; storage failure degrades to truthful in-memory state |
| List motion | `lib/workspace-list-motion` helpers, `workspace-selection-highlight.tsx`, `workspace-session-row.tsx` | position springs, one-time row arrivals, moving selection highlight, swipe Archive/Pin with a named menu fallback, reduced-motion fallbacks |
| Reading gestures | `conversation-response.tsx`, `lib/conversation-extractive-preview.ts` | ctrl-wheel/pinch folds only completed answer text into an extractive preview; code, tables, selections, streaming and pending decision blocks are never folded; full text returns on expansion |
| Dev-only preview | `app/dev/material-motion/` | synthetic controls on production components; never connects an account or writes |

**Boundary review.** No backend mutation, no Agent execution, no evidence
deletion, no extra model call, and no external write. Archive is reversible and
never deletes a Session. Storage holds no titles or conversation content.

## 3. Work stream B — conversation delivery truthfulness

Plan:
[`plans/2026-10-05-capir-message-feedback.md`](../../plans/2026-10-05-capir-message-feedback.md);
dated rendered evidence lives in the private
[`capir-evals`](https://github.com/getyak/capir-evals/tree/main/evidence)
repository (`evidence/2026-10-05-capir-message-feedback/`).

**Problem confirmed in code.** Accepted local messages previously rendered with
no status until an active stream snapshot arrived; `useConversation.reconcile`
removed local rows and attachment bytes before canonical history readback, so a
slow or failed read could leave a blank handoff that looked like success.

**Safety properties delivered.** Canonical-history settle with the same ordered
image manifests is the only thing that retires an outbox row; a server
active/queued row only represents the message for rendering. Handoff rows stay
readable through the active-to-history gap with bounded passive readback;
observed Stop never reads as completion; an unknown delivery requires an
explicit same-ID check and a confirmed receipt can never resend; recovery reads
are bounded and never send a second message; already streamed text survives the
history handoff even when preview and completion frames share one network
chunk.

## 4. Work stream C — capir personal Agent transition

Plan:
[`plans/2026-10-02-capir-personal-agent-transition.md`](../../plans/2026-10-02-capir-personal-agent-transition.md).
A dated draft recommendation only: no product implementation, no migration, no
publication, and no execution authority. Its old-name findings predate the
capri rebrand and are a snapshot.

## 5. Verification before integration (2026-10-09)

| Check | Result |
| --- | --- |
| `vitest run` (full Web suite) | 216 files / 1633 tests passed, 1 skipped |
| Focused conversation + workspace suites | 22 files / 180 tests passed |
| `pnpm --filter @talent-signal/web typecheck` | passed |
| `pnpm docs:check` (docs, wiki, architecture boundaries and diagrams) | passed |

## 6. Code review findings

Against the repository code-review rules:

- **No interpretation promoted to confirmed state.** Delivery states derive
  from observed queue/stream receipts; organization flags are explicitly local.
- **No external write path.** The diff adds no fetch, no message send, no
  calendar/contact write, and no authorization bypass. The only new writes are
  bounded `localStorage` keys, and their failure state is visible.
- **No person ranking or prohibited inference.** The changes affect
  presentation, ordering and status wording only.
- **Identity and time preserved.** Organization entries are account-scoped and
  timestamped; delivery retry keeps exact run/message IDs.

Local artifacts (`plans/local/`, browser automation output, raw evaluation
logs) are operator evidence, not product documentation, and stay out of the
shared tree.

## 7. Merge surface

An experimental `git merge-tree --write-tree` of the full local work against
`origin/main` reported content conflicts in exactly 14 files: the conversation
surface (`use-conversation.ts`, `queued-conversation.tsx/.css`,
`session-message-parts.tsx`, `private-conversation.tsx`,
`conversation-response.module.css`), the Workspace shell
(`layout.tsx`, `workspace-shell-nav.tsx`, `workspace-shell.module.css`,
`workspace-account-menu.tsx`, `workspace-recent-sessions.tsx`,
`lib/workspace-recent-sessions.ts`, `session-directory.tsx`) and
`docs/design-system.md`. All untracked new files merged cleanly.

## 8. Merge resolution record (2026-10-09)

The conflicts were resolved semantically. Two local designs overlapped with
newer `main` work on the same surfaces; the resolution rule was: keep the
newest settled design for presentation, keep the local work wherever it adds
behavior `main` does not have, and record every supersession instead of
shipping two competing mechanisms.

| Area | Resolution | Why |
| --- | --- | --- |
| Sidebar rail and collapse | `main`'s settled GET-129 compact rail (248px/72px, avatar shortcuts) won; the local spring rail and floating edge reveal (`workspace-sidebar.tsx`, `workspace-rail-preference.ts`) were removed | `main` kept refining the settled rail through `#306`; the local variant was a competing implementation of the same control |
| Conversation transcript architecture | `main`'s projection won (execution records, milestones, images, MCP cards, send-time, user bubbles) | 92 commits of newer, feature-complete work the local branch did not have |
| Outbox delivery semantics | Local work won and was ported into `main`'s hook (settle, readback, handoff retention, Stop outcome, same-ID receipt confirmation, distinct-capacity counting) | `main` deleted outbox rows on queue receipt, allowing a blank handoff and losing local image bytes before history readback |
| Send/readback gap presentation | Local `ConversationWorkRow` renders only for messages with no canonical or live representation (waiting, unknown/rejected delivery, readback, stopped) | Fills the exact windows `main` leaves blank without duplicating its execution records |
| Recent Sessions list | Both: `main`'s person avatars, brand marks, new-conversation action plus local collapse disclosure, Archive/Pin, arrival motion, sliding selection highlight | Disjoint behaviors on the same rows |
| macOS material, folding, organization | Local work kept unchanged | No overlap |

Evidence for the merged tree: full Web vitest 267 files / 2091 tests passed,
Web typecheck passed, ESLint 0 errors (6 pre-existing warnings in untouched
files), `pnpm docs:check` and `node scripts/check-repository-hygiene.mjs`
passed. Four local test files were adapted where presentation moved to `main`'s
execution records and the product name moved to `capri`; every truthfulness
assertion (no false success, no resend, no blank handoff, no animation on
terminal states, exact message identity) was kept.

## 9. Release

Tags are `v0.1.x`; the owner selected `v0.2.0` for this merged batch. Local
source health is not a production release: deployed Web is a separate release
identity and remains unverified by this analysis.

## 10. Limits and unknowns

- Native physical trackpad history gestures, row swipe, pinch, and desktop
  vibrancy with reduce-transparency disabled remain unverified (reported by the
  material motion task and not re-verified here).
- No iOS simulator run, no macOS application build/XCTest, and no production
  Next build were performed for this analysis.
- This analysis never authenticated a real account and must not be cited as
  production acceptance.
