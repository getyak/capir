# GET-128 / GET-129 — delivery evaluation

Date: 2026-10-01
Plan: [`GET-128 / GET-129 plan`](../../../plans/2026-09-30-get-128-129-macos-conversation.md)

## Current state

The Web layout is integrated and under acceptance. GET-128 backend steering is
still being implemented. Neither issue is complete; review, current-head CI,
merge and resident-surface verification remain required.

## Design and authority

The authenticated Web surface supplies the macOS workspace. The reference
composition uses a 248px sidebar / 64px rail, single-line rows, a 68px centered
conversation header and an 880px transcript/composer axis. The composer starts
at 62px and grows for multiline input; leading Agent replies use warm semantic
bubbles and user messages use trailing bubbles with per-send timestamps.
Measured values are in [`design-measurements.md`](design-measurements.md).

Canonical history supplies final answers; live forming text remains a whole
Markdown draft inside folded execution detail. It is not split into speech
milestones, persisted by the presentation layer, or promoted to evidence.
Observed stages report observations, never completed tool work. Queued,
running, failed and interrupted entries retain the same message identity and
execution projection. A completed queue receipt alone does not prove a final
answer. Memory and calendar cards report actual decision readback to the
execution surface; a historical proposal reference alone does not mean a
pending decision.

## Verification so far

- First delegated Web slice: 1,605 tests passed, one existing skip; typecheck,
  lint (zero errors, six existing warnings), docs checks and production build
  passed in its frozen worktree. These do not establish the final integrated
  commit or original backend steering acceptance.
- Integration corrections: focused execution/projection/pacing observation
  checks and Web typecheck passed. Markdown code, lists, tables and long text
  stay whole; more than twelve observations continue publishing.
- Synthetic browser at 1280x820 measured sidebar 248px, rail 64px, conversation
  header 68px and composer 880x62px. Completed response rendered with a folded
  execution record and separate semantic reply; no horizontal overflow.
- Independent review of e506810 found one P1: original tool-checkpoint steering
  and rapid-fragment batching were absent. Other confirmed findings include
  structured-text splitting, stale decisions and incomplete lifecycle wiring.
  Corrections require independent re-review of the new frozen commit.

Only synthetic seed data and a deterministic no-network provider are used for
local proof. Raw Figma trees, customer content, credentials and execution logs
are excluded from this document.

## Remaining acceptance

Backend current-tool completion / steering / fragment coalescing with durable
identity, authorization and retry fences; completed tool metadata readback;
canonical decision resolution; stop/continue and failure recovery; dark,
compact, low-height, reduced-motion, IME and reader scroll; final independent
review; latest-head repository gates; merge and resident macOS verification.
