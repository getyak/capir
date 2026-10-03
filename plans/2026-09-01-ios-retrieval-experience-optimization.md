# iOS retrieval experience optimization

## Outcome

Make the People and Sessions retrieval loop feel calm, predictable, and fast
under real iOS interaction: explicit top navigation owns destination changes;
rows own their secondary gestures; opening, returning, dismissal, accessibility,
and interruption preserve context and authority.

Completion is observable when the frozen post-change build passes the gesture,
recovery, accessibility, visual, and latency gates recorded in
[`docs/evaluations/2026-09-01-ios-retrieval-experience/README.md`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-ios-retrieval-experience/README.md),
and the independent panel contains no active safety veto.

## Scope

In scope:

- the iOS Today / Sessions / People retrieval shell;
- Session and People row tap, swipe, long-press, and VoiceOver actions;
- transient reveal dismissal, opening and returning, and scroll continuity;
- removal consequence copy and confirmation;
- light, dark, Simplified Chinese, Dynamic Type, Reduce Motion, and supported
  small/large Simulator sizes;
- deterministic UI tests, agentic interaction probes, E2E timing, and an
  independent code and product review panel.

Out of scope:

- new candidate ranking, relationship scores, bulk actions, or CRM features;
- autonomous external writes;
- redesigning Today, the person detail, or the Agent conversation beyond what
  is required to preserve retrieval continuity;
- claims of recruiter time saved without field evidence.

## Frozen baseline

- Artifact: `ios-retrieval-baseline-2026-09-01-a`
- Repository commit: `90dd83d68749f057203cc91b39429763885df124`
- Target-file diff SHA-256:
  `8d32a04cd6b21b9211869759555f10775586f05a6448e6f0758789a29404cdb9`
- Simulator binary SHA-256:
  `66215f3e4e340b7a87350edb8826236b5d10d212d5d5471ac7e72f334ffbebcd`
- Device: iPhone 17 Pro Simulator, iOS 26.5, portrait
- Evidence: the four baseline screenshots and the five-test passing result
  summarized in the linked evaluation packet.

Current evidence shows polished rows and a passing tap/navigation smoke path,
but the page-style container still competes with row swipes. People lacks native
row gestures and the Session removal label does not state its local consequence.
The current tests do not prove reveal, mutual exclusion, dismissal, long press,
VoiceOver alternatives, interruption, or interaction latency.

## Design decision

Use a non-paging selection host that keeps each retrieval surface alive. Keep
native `List` mechanics for row gestures. Give secondary gestures only actions
that already have governed destinations, and require exact-effect confirmation
before removing a local Session shortcut.

Rejected:

- tuning page-swipe thresholds, because it preserves two horizontal owners;
- a custom drag engine, because it adds physics, RTL, accessibility, and
  toolchain debt before native behavior is disproven;
- long press alone, because it hides the common shortcut;
- adding favorite, priority, or relationship-health state merely to fill an
  edge.

## Milestones

1. Completed: froze and independently reviewed the baseline through workflow,
   safety, mobile UX, and code-correctness lenses.
2. Completed: replaced content-wide paging, added native People parity and an
   explicit Session-removal consequence, and preserved primary tap behavior.
3. Completed: added deterministic gesture, dismissal, scope-safety,
   long-list-continuity, accessibility-reachability, transactional deletion,
   and machine-readable E2E timing tests.
4. Completed: ran the iPhone 17 Pro core gate and iPhone SE visual matrix,
   retained light and Simplified Chinese dark AX5 directions, and sent the
   final frozen hashes and results to independent reviewers.
5. Completed for deterministic release evidence: bound the product source,
   App, UI-test runner, xctestrun, result bundles, raw latency, and screenshots
   in the evaluation manifest. Physical assistive-technology testing and
   blinded recruiter field research remain explicitly outside this result.

## Final deterministic result

- Candidate: `ios-retrieval-post-change-2026-09-02-r4`
- Core tests: 13 passed, 0 failed, 0 skipped.
- Compact visual tests: 2 passed, 0 failed, 0 skipped.
- Destination readiness: 30 warmed samples, p95 496.50 ms against 900 ms.
- Session-open readiness: 30 warmed samples, p95 950.29 ms against 1,200 ms.
- Long-list continuity: the same tagged visible row remains within one row
  after tested intent resets for both 50-row fixtures.
- Preferred-person multi-context Ask: zero backend requests and no pending
  submission before explicit context selection.
- Evidence:
  [`docs/evaluations/2026-09-01-ios-retrieval-experience/README.md`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-ios-retrieval-experience/README.md)

## Verification gates

- 0 destination changes across short, medium, full, slow, fast, and diagonal
  row swipes in repeated trials.
- 100% correct action reveal and 100% correct primary row opening in the frozen
  synthetic fixture.
- Exactly one revealed row; every tested new-intent and interruption path
  returns the row to rest.
- Session removal is never committed by full swipe, names local scope, and
  leaves Person, Pursuit, evidence, and confirmed relationship state intact.
- Every shortcut has a named accessibility action and all interactive targets
  are at least 44 by 44 points.
- Warmed Simulator navigation and row-open latency are recorded as p50/p95;
  release targets are p95 <= 900 ms for destination readiness and p95 <= 1,200
  ms for row-to-detail readiness under XCTest automation.
- Light and dark, English and Simplified Chinese, default and AX5, normal and
  reduced motion show no clipped identity or action-effect text.
- Build, focused unit/UI tests, `git diff --check`, panel validation, and
  `pnpm docs:check` pass.

## Important unknowns

- Native iOS 16-compatible `swipeActions` dismissal behavior must be observed
  before introducing any coordinator.
- XCTest timing includes automation overhead; the recorded numbers compare
  frozen builds but do not claim physical-device frame or touch latency.
- Recruiter five-second findability and real-world time saving still require a
  blinded field study after the deterministic experience gate passes.
