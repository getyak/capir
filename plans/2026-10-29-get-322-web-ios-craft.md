# GET-322: Web and iOS craft loop

## Outcome and authority

Reshape the existing relationship workspace into a coherent, quiet professional
notebook. People, conversation context, exact evidence and the next useful step
must become easier to read and operate. The user authorized independent design
choices, subagents, implementation and iterative delivery until **2026-10-30
02:00 Asia/Shanghai (2026-10-29 18:00 UTC)**.

Linear: [GET-322](https://linear.app/getyak/issue/GET-322/reshape-web-and-ios-into-a-calm-coherent-relationship-workspace).
Branch: `codex/get-322-web-ios-craft`. Original checkout changes are preserved.

## Design judgment

Operate and Read modes govern these surfaces. Follow `docs/product.md` and
`docs/design-system.md`: warm near-white neutrals, existing system typography,
scarce vermilion for consequential attention, a stable reading axis, and native
affordances. The signature is the traceable seam between evidence and a proposed
change, rather than decorative containers. Agent infrastructure stays secondary.

Alternatives considered: a broad new visual theme would conflict with the
established evidence-first identity; micro-polish alone would leave incoherent
recovery and retrieval states. The selected approach reshapes complete existing
paths and their boundary states, preserving their product meaning.

## Boundaries

- No new integrations, provider/model/spend scope, person scoring or data collection.
- Preserve identity, provenance, uncertainty, approval, draft continuity and recovery.
- Existing source inspection and reversible decisions remain reachable.
- Runtime deployments require clean committed source, current checks and live readback.
- Simulator, browser, CI, merge, resident deployment and physical-device acceptance
  are distinct evidence. Never infer one from another.

## Ownership

- Parent: direction, this plan, integration, browser/native validation, PR/CI,
  deployments, Linear status, deadline and final evidence.
- `web_craft`: Web components and their existing style owners; no native files.
- `ios_craft`: `apps/ios` presentation and focused tests; no shared contracts/Web.
- Independent reviewer: read-only correctness, safety and missing-state review.
- Heavy Web and native builds run serially on the shared 16 GiB host.

## Milestones

- [x] Fetch latest remote main; create isolated managed worktree and issue.
- [x] Read product/design, operations and task-specific skill owners.
- [x] Audit and compare rendered directions; freeze first coherent batch.
- [x] Implement the first two coherent Web/iOS batches and resolve the observed
  native failure; preserve direct evidence and explicit coverage gaps.
- [ ] Verify desktop/narrow, light/dark, keyboard/reduced motion; native primary
  iPhone and relevant Dynamic Type/compact coverage with direct evidence.
- [x] Independent review and focused corrections for both Web batches and native
  increments; applicable final-head CI remains part of the release milestone.
- [ ] **Active: release** — PR linked to GET-322; latest-head CI; normal merge; resident Web deployment
  and changed-behavior/version readback when applicable.
- [ ] Continue only into remaining high-value gaps; at deadline preserve evidence,
  clean owned temporary resources, pause heartbeat and report exact remaining work.

## Evidence and current unknowns

Initial resource audit: roughly 59 GiB free, 3.83 GiB swap, Primary iPhone already
booted; no pause marker observed. Resource warnings are diagnostic, not permission
to terminate unrelated processes. Registered task artifact: `GET-322.Qdd48J`.

Existing Impeccable v4.8.0 is already in the repository;
its product/design adapters route to canonical docs, so no replacement install
or competing design document is needed. Browser plugin is unavailable; use
the existing Playwright tooling for browser verification.

### Round 1, 21:15 Asia/Shanghai

Implemented: single-layer Web Memory review, explicit previous/proposed/saved
values, fully inspectable quotes, editor focus/IME/Escape boundaries, menu Escape
ownership, localized Person context panel; native compact truthful status pages,
readable failure recovery, accessible unread rows and metadata.

Independent review found no confirmed P0/P1/P2 in this scope and preferred the
open-seam composition over the framed alternative. Equal-content desktop renders
and 375/320px dark renders are retained in the task's durable visualization
directory (`get322`). Actual component interactions verified auto-focus, Escape
focus restoration, full short multiline quote, long quote expansion, simulated
IME protection, 44px actions, no horizontal overflow, and reduced-motion state.
Measured painted dark text/control contrast minimum was 6.74:1. These are
synthetic component observations, not Memory persistence or physical IME proof.
The temporary component route was removed after capturing evidence.

Web focused suite: 154 passed; locale coverage/runtime: 25 passed; lint and
`pnpm docs:check` passed. Broader Web typecheck and all 387 files / 3,535 tests also passed on the first checkpoint.
Impeccable targeted scan returned no findings.

Native build succeeded; seven focused Simulator checks yielded six passes and
one retained failure in interrupted-response recovery. Follow-up focused unit
and host probes rejected the initial transparent-URLSession-retry hypothesis.
The isolated Lab fault store appears to join global active refresh and recover
before manual Retry; a red/green isolation test is being added. Diagnosis is
still in progress. Chinese AX5 Lab diagnostic
chrome also consumes too much space; error-body completeness is unverified.
Today unread and review-error Dismiss currently have source-only evidence.

The real Person-page journey exposed a second issue: its related-conversation
CTA opens the legacy relationship workspace. Round 2 will show exact recent
Session targets with truthful empty/unavailable/partial-directory states and
offer ordinary unscoped new chat when appropriate. It will not invent scoped
chat authority or silently choose among sessions.

One isolated daily test run is ready: `cac24d04-576f-4bc7-a2de-d18511eb1e41`,
request `0310a5e0-2db9-4954-a860-04ddc8ef53c3`, environment `staging`.
Reuse it through the deadline; private credentials and browser state remain only
in the registered temporary artifact. Stop it and verify cleanup at closeout.

### Round 2, 21:38 Asia/Shanghai

Web related-session navigation is committed as `afdfae84`. Its 111 focused tests,
locale checks and typecheck passed. Actual Person → New conversation navigation
reached a queued composer with no Person/context query scope; the 375px CTA is
44px high and no overflow or console/page error was observed. Empty-state focus
now shares the fixed chrome scroll margins. Populated related-session lists
remain unit/source evidence because the daily account contains no such Sessions.

Native recovery regression is fixed and independently reviewed. Round 2 passed
five checks (three unit, two UI); final Chinese copy readback passed one UI check.
Both result sets have zero skips. The AX5 screenshot contains the complete error
reason and the correct Retry action. Initial failures and the red regression
remain retained.

Draft PR: [#485](https://github.com/getyak/capir/pull/485), first checkpoint
`28777508`. Current-head CI is running; first security gates passed. This does
not establish the final head, merge or deployment.

Pending: final committed source, latest-main integration and CI/merge, clean
resident Web build/activation/readback, then remaining direct native evidence
and further high-value loops before the deadline. Formal evidence is kept in
the task visualization directory under `get322/verification.md` and `get322/ios`.

## Resume and stopping rule

Heartbeat `capri-web-ios` returns to this chat hourly. Read this plan and existing
agent progress before starting more work. At/after the deadline start no new
implementation or long-running jobs. Record truthful work state, outstanding
acceptance and blockers, then pause the heartbeat and read back its status.
Do not close GET-322 until requested acceptance is complete.
