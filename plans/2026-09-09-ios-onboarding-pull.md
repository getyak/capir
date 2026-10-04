# iOS onboarding: pull a source into its relationships

## Outcome

Make the first upward pull visibly manipulate a bundled example link, revealing
its connections continuously with threshold feedback, reversible spring return,
and an equivalent accessible tap. Publish the verified revision to TestFlight.

## Scope and boundary

Refine AuthenticationWelcomeView and its portrait scene. The source and people
are illustrative, clearly labeled as an example; no clipboard, contacts, network
import, confirmed relationship, or authentication authority is introduced.
Preserve sign-in, recovery, replay, reduced motion, and large text.

## Evidence and approach

Baseline: a88cae9 (latest main, clean checkout). Existing gestures drive portraits
but begin with an abstract mark; edges start after 44% progress and touch feedback
only occurs after release. Add a visible example link with a shared source-to-
network reveal, a progress ring, threshold haptic with hysteresis, and stable
coordinate-space handling. Retain the existing network composition rather than
replace the login flow. Compare baseline and resulting native renders.

Apple references: [transient gesture state](https://developer.apple.com/documentation/swiftui/gesture/updating(_:body:)),
[spring animation](https://developer.apple.com/documentation/swiftui/animation/spring(response:dampingfraction:blendduration:)),
[reduced motion](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion),
[impact feedback](https://developer.apple.com/documentation/uikit/uiimpactfeedbackgenerator).

## Milestones

1. Complete: source-led drag, bounded resistance, feedback and regression coverage.
2. Complete: final iPhone 17 Pro 7/7 tests; iPhone SE 7/7 tests; native renders
   reviewed in light, dark and AX5, plus English iPad introduction. Self-review
   found and fixed source/portrait overlap and fixed-position thread alignment.
   Motion-frame review also removed the inherited CTA fade to preserve release-
   hint contrast. All seven cases passed on that binary; email recovery needed
   its synthetic loopback service restarted before its successful rerun.
3. Active: PR, current-commit CI, merge, TestFlight processing and receipt readback.

## Completion evidence

Native results and screenshot evidence are recorded in
[the evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-09-onboarding-pull/README.md). Simulator tests
cannot establish physical-device haptic quality; report that limit explicitly.
