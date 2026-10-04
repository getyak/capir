# Capture review implementation

## Outcome

Implement the reviewed Capture / Inbox / Identity Review loop in the existing
iOS capture surface and its canonical backend: separate identity attachment
from claim confirmation, preserve recoverable pending work, and report actual
confirmed and unresolved results. Keep Web resource-claim review compatible.

## Boundary

Reuse governed captures, evidence fragments, proposed assertions, fact decisions,
and confirmed state. No new model authority, candidate scoring, raw-image cloud
upload, or implicit external action. Existing unrelated Lab, calendar, and
runtime changes remain intact. No agents are delegated.

## Evidence and approach

- The current iOS store compiles Wiki immediately after identity binding and
  deletes pending queue data even for unresolved identity.
- The backend already has conservative resource claim proposals and independent
  fact decisions; screenshot claim authority and current-source checks need
  explicit integration.
- Add canonical capture readback, current review-basis tokens, source/speaker/date
  guards, durable iOS recovery, truthful receipts, and bounded local-source
  retention. Use the existing visual system and native vertical comparison.
- The previous [review](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-notion-capture-design/report.md)
  is the requirement source; this is implementation against existing UI, not a
  new visual direction.

## Milestones

1. Complete: backend claim preparation, authoritative review/readback and tests.
2. Complete: iOS two-stage review, protected recovery, retention and receipt UI.
3. Complete: Web compatibility, localizations, focused integration and Simulator proof.
4. Complete: documentation, review, local TestFlight backend rebuild/deploy, handoff.

## Result

Completed on 2026-09-05. Direct evidence and final boundaries are recorded in
[`implementation.md`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-notion-capture-design/implementation.md).

## Completion proof

- A supported fact can be confirmed while a relative date remains unresolved.
- Unknown speaker, wrong identity, revoked/deleted source, and stale review
  cannot confirm a claim; retries cannot duplicate a decision.
- Leaving and reopening identity/claim review preserves the same capture and
  draft without silently replaying changed intent.
- Local original retention is explicit and deletion does not claim server
  deletion; terminal and pending receipts remain distinguishable.
- Focused backend and iOS tests, real Simulator screenshots, Web typecheck,
  documentation check, and local backend health readback.
