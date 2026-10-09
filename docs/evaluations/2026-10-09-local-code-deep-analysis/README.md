# Local code deep analysis — 2026-10-09

Dated review evidence for the uncommitted local work on
`codex/macos-material-motion`, its readiness to merge into `main`, and the
release and local-service consequences of merging. This is an evaluation, not
product truth. Where a claim is unverified it is marked as such.

## Scope and method

- Checkout inspected: branch `codex/macos-material-motion`, HEAD `6c061b07`
  ("Collapse recent conversations by default"), 2026-10-09, Asia/Shanghai.
- Compared against `origin/main` `1fff66c6` and the merge base `ca552679`.
- Method: full diff and untracked inventory, plan and evaluation cross-read,
  safety review against the repository code-review rules, deterministic local
  checks, and an experimental merge-tree run. No production surface, real
  account, or external system was used.

## 1. Repository state

| Fact | Observed |
| --- | --- |
| Relationship to `origin/main` | local branch is 92 commits behind and 1 commit ahead of the merge base |
| Uncommitted tracked edits | 28 files, +1290 / −240 lines |
| Untracked work | 21 source/test files (~1370 new source lines), 3 plans, 2 evaluation folders, 1 `_index/` note, plus `plans/local/` and `.playwright-mcp/` artifacts |
| Highest release tag | `v0.1.101` |
| Unpushed local commit | `6c061b07` collapses recent conversations by default |

The local work is genuinely additive: no untracked source path exists in
`origin/main`, and none of the three feature areas below appears there. The
risk is not duplication but divergence — `origin/main` refactored 233 files in
the same Web surfaces (+17392 / −5562) while this work was developed against
`ca552679`.

## 2. Work stream A — macOS material and workspace organization

Plan: [`plans/2026-10-01-macos-material-motion.md`](../../../plans/2026-10-01-macos-material-motion.md).

**What it delivers.** Native AppKit material behind transparent Web chrome,
and reversible device-local Session list organization with position-explaining
motion.

| Area | Key files | Behavior |
| --- | --- | --- |
| Native material | `WorkspaceMaterialSurface.swift`, `QuietWorkspaceView.swift`, regenerated `project.pbxproj` | `.sidebar` / `.behindWindow` material under `WKWebView`; one guarded, isolated `_setDrawsBackground:` KVC path with an opaque fallback; no new page capability |
| Local organization | `lib/workspace-session-organization.ts`, `workspace-session-row.tsx` | Archive/Pin store session IDs, booleans and timestamps only, partitioned by the server-computed 64-hex account scope; storage failure degrades to truthful in-memory state (`persistence: "memory"`, `pendingInMemory`) |
| Rail and motion | `lib/workspace-rail-preference.ts`, `workspace-list-motion.tsx`, `workspace-selection-highlight.tsx`, `workspace-sidebar.tsx` | fixed symbol geometry, shared `layoutId` highlight, position springs, one-time row arrivals, reduced-motion fallbacks |
| Reading gestures | `conversation-response.tsx`, `lib/conversation-extractive-preview.ts` | ctrl-wheel/pinch folds only completed answer text into an extractive preview; code, tables, selections, streaming and pending decision blocks are never folded; full text returns on expansion |
| Dev-only preview | `app/dev/material-motion/` | synthetic controls on production components; never connects an account or writes |

**Boundary review.** No backend mutation, no Agent execution, no evidence
deletion, no extra model call, and no external write. Archive is reversible and
never deletes a Session. Storage holds no titles or conversation content. This
matches the repository rule that display state must not become canonical state.

## 3. Work stream B — conversation feedback lifecycle

Plan and evidence:
[`plans/2026-10-05-capir-message-feedback.md`](../../../plans/2026-10-05-capir-message-feedback.md),
[`docs/evaluations/2026-10-05-capir-message-feedback/`](../2026-10-05-capir-message-feedback/README.md).

**Problem confirmed in code.** Accepted local messages previously rendered with
no status until an active stream snapshot arrived; `useConversation.reconcile`
removed local rows and attachment bytes before canonical history readback, so a
slow or failed read could leave a blank handoff that looked like success.

**Delivered states.** `conversation-feedback.ts` / `conversation-feedback-row.tsx`
keep admission, waiting, processing, paused, reconnecting, stopped, failed and
readback distinct, with `answer-seam.ts` bounding completion sweeps to one per
message.

**Safety properties worth keeping.** Unknown delivery requires an explicit
check; a confirmed same-ID receipt can never resend after a failed history read;
local images and drafts survive until canonical history carries the same
ordered manifest; recovery reads are bounded and never send a second message;
rejected Stop intent is not reported as an outcome.

## 4. Work stream C — capir personal Agent transition

Plan:
[`plans/2026-10-02-capir-personal-agent-transition.md`](../../../plans/2026-10-02-capir-personal-agent-transition.md).
This is a dated draft recommendation only: no product implementation, no
migration, no publication. Its main findings are that canonical product
language still says Talent Signal, that the smallest useful release is one
proven meeting-continuity loop, and that persistent technical identifiers
should stay stable absent demonstrated need. It carries no execution authority.

## 5. Verification performed on this checkout (2026-10-09)

| Check | Result |
| --- | --- |
| `vitest run` (full Web suite) | 216 files / 1633 tests passed, 1 skipped |
| Focused conversation + workspace suites | 22 files / 180 tests passed |
| `pnpm --filter @talent-signal/web typecheck` | passed |
| `pnpm docs:check` (docs, wiki, architecture boundaries and diagrams) | passed |

Earlier plan records report additional focused runs (128 tests for the material
motion patch, 136 for the feedback patch) and rendered light/dark/390px
evidence. Those runs are reported by their tasks; this analysis re-ran the
checks above against the integrated working tree and does not restate the
earlier numbers as its own.

## 6. Code review findings

Against the repository code-review rules:

- **No interpretation promoted to confirmed state.** Feedback states derive
  from observed queue/stream receipts; organization flags are explicitly local.
- **No external write path.** The diff adds no fetch, no message send, no
  calendar/contact write, and no authorization bypass. The only new writes are
  bounded `localStorage` keys, and their failure state is visible.
- **No person ranking or prohibited inference.** The changes affect
  presentation, ordering and status wording only.
- **Identity and time preserved.** Organization entries are account-scoped and
  timestamped; delivery retry keeps exact run/message IDs.

Remaining caution: `plans/local/` and `.playwright-mcp/` contain operator
receipts and browser artifacts with local paths. They are working evidence, not
product documentation, and should stay out of the shared tree unless the owner
decides otherwise.

## 7. Merge and release readiness

Experimental `git merge-tree --write-tree` of the full local work against
`origin/main` reported content conflicts in exactly these 14 files:

```
apps/web/app/workspace/layout.tsx
apps/web/components/conversation-response.module.css
apps/web/components/conversation/private-conversation.tsx
apps/web/components/conversation/queued-conversation.module.css
apps/web/components/conversation/queued-conversation.tsx
apps/web/components/conversation/session-message-parts.tsx
apps/web/components/conversation/use-conversation.ts
apps/web/components/session-workbench/session-directory.tsx
apps/web/components/workspace-account-menu.tsx
apps/web/components/workspace-recent-sessions.tsx
apps/web/components/workspace-shell-nav.tsx
apps/web/components/workspace-shell.module.css
apps/web/lib/workspace-recent-sessions.ts
docs/design-system.md
```

All untracked new files merge cleanly; `AGENTS.md`, the macOS sources and the
remaining Web files auto-merge.

**Interpretation.** The conflicts are the expected consequence of two
independent craft passes over the same shell and conversation components. They
must be resolved semantically, keeping both sides' behavior, not by picking one
side. After resolution, the merged tree needs its own full-suite evidence; the
green results in section 5 describe the pre-merge working tree only.

## 8. Merge resolution record (2026-10-09)

The merge was resolved semantically. Two local designs overlapped with newer
`main` work on the same surfaces; the resolution rule was: keep the newest
settled design for presentation, keep the local work wherever it adds behavior
`main` does not have, and record every supersession instead of shipping two
competing mechanisms.

| Area | Resolution | Why |
| --- | --- | --- |
| Sidebar rail and collapse | `main`'s settled GET-129 compact rail (248px/72px, avatar shortcuts) wins; the local spring rail, floating edge reveal (`workspace-sidebar.tsx`, `workspace-rail-preference.ts`) were removed | `main` kept refining the settled rail through `#306`; the local variant was a competing implementation of the same control |
| Conversation transcript architecture | `main`'s projection wins (execution records, milestones, images, MCP cards, send-time, user bubbles) | 92 commits of newer, feature-complete work the local branch does not have |
| Outbox delivery semantics | Local work wins and was ported into `main`'s hook: canonical-history settle with same ordered image manifests, bounded passive readback, retained handoff rows, observed Stop outcome, same-ID receipt confirmation without resend, one-shot completion seam, distinct-capacity counting | `main` deleted local outbox rows on queue receipt, which allowed a blank handoff and lost local image bytes before history readback |
| Send/readback gap presentation | Local `ConversationWorkRow` renders only for messages with no canonical or live representation (waiting, unknown/rejected delivery, readback, stopped) | Fills the exact windows `main` leaves blank without duplicating its execution records |
| Recent Sessions list | Both: `main`'s person avatars, brand marks, new-conversation action and person rows plus local collapse disclosure, Archive/Pin, arrival motion, sliding selection highlight | Disjoint behaviors on the same rows |
| macOS material, folding, organization | Local work kept unchanged | No overlap |

Evidence for the merged tree: full Web vitest 267 files / 2091 tests passed,
Web typecheck passed, ESLint 0 errors (6 pre-existing warnings in untouched
files), `pnpm docs:check` passed. Four local test files were adapted where the
presentation moved to `main`'s execution records and the product name moved to
`capri`; every truthfulness assertion (no false success, no resend, no blank
handoff, no animation on terminal states, exact message identity) was kept.

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
