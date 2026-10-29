# GET-322: interaction continuity and direct native evidence

## Outcome

Continue the authorized design loop until 2026-10-30 02:00 Asia/Shanghai.
Make retrieval and queued editing preserve a person's intent through slow
responses, composition and cancellation; directly verify the changed native
unread and notice controls in their real presentation scope.

This follows [the initial craft plan](2026-10-29-get-322-web-ios-craft.md).
PR #485 remains frozen at `8b960e2d` while its current CI and clean resident Web
release are completed. This branch starts from that reviewed source dependency:
`codex/get-322-interaction-boundaries`. Integrate latest main after #485 merges,
then create a separate PR linked to GET-322. Never push this batch to #485.

## Scope and ownership

- Parent: release #485 independently, this plan, integration, browser acceptance,
  independent review, current-head CI, merge and affected resident deployments.
- `web_craft`: People search/query parsing/empty-result return, queued message
  editor and their focused tests/locales. Preserve ownership and draft fences.
- `ios_craft`: actual DEBUG Lab/Conversation fixtures and probes for unread and
  review-notice callbacks; diagnose/clamp invalid transient header dimensions
  with direct geometry evidence. Preserve production refresh and data behavior.
- Workers are not alone; do not revert each other, commit, push or run overlapping
  heavy builds. Parent serializes native and production Web work.

## Design and boundaries

Retain the chosen quiet reading system. Separate a draft search from its submitted
query and results, expose truthful pending state, and keep native GET/history
behavior. Composition owns candidate keys; local editors own cancellation.
Reject ambiguous query shapes before reading the directory. Do not convert an
invalid query or an unavailable read into a full directory or zero-result claim.

Native fixtures must render actual production views, state and callbacks behind
existing DEBUG/preview gates. Read the effective size/theme/language inside the
configured presentation. They prove presentation and callback behavior, not a
real backend failure or mutation. No model, new account, provider, permission or
external-action scope is added.

## Milestones

- [x] Read-only diagnosis and minimal approaches completed for both platforms.
- [x] Implement focused red/green regressions and complete boundaries.
- [x] Verify delayed search, two submissions, clear/focus, history and repeated query
  in the actual browser; queue IME/Escape has focused unit/source evidence.
- [x] Verify actual native unread/notice controls, scoped display probes and
  finite header geometry; seven unique green cases across retained focused runs.
- [ ] **Active: latest-main integration and linked PR.** Independent review passed
  after fixing the same-query draft-loss P2; Web 110 focused checks and typecheck
  passed. Current-head CI is still required.
- [ ] Current-head required CI, normal merge and clean resident Web readback;
  separately inspect automatic iOS distribution status if a release occurs.
- [ ] At deadline preserve remaining evidence and stop expansion; clean the exact
  owned test run and temporary resources, then pause the heartbeat.

## Current evidence and open work

Source audit confirms missing search pending/IME handling, `key={query}` input
replacement, unequal clear-focus paths, non-string repeated query risk and a
queued editor Escape/composition gap. Browser reproduction of late-response
draft loss is still required before claiming that behavior observed.

The retained native startup log has 24 invalid-frame warnings before the fault
preview opens. A pre-existing header formula admits negative zero/narrow-width
frames; exact runtime attribution remains an inference until numeric sampling.
The proposed fixture/probe method and warning evidence are in the durable task
visualization directory under `get322/ios/next-native-evidence-plan.md` and
`frame-warning-readonly.json`.

Reuse the existing daily run `cac24d04-576f-4bc7-a2de-d18511eb1e41` and registered
artifact `GET-322.Qdd48J`; do not create another account or duplicate builds.

## First release readback

PR #485 merged as `b5a9048d` after exact-head required CI/security passed. A clean
resident Web build was activated through the owning installer. Revision/build
receipt and authenticated Person → new conversation → composer readback passed.
The previous release is retained. Optional Vercel web preview remains rate limited
for 24h and is not a required branch gate. Native distribution is separate.
