# iOS row gesture ownership research

## Outcome

Decide how Session and People rows should reveal shortcuts, dismiss revealed
state, animate, and coexist with the `Today / Sessions / People` navigation.
The result must be specific enough to implement and verify without promoting a
shortcut into relationship truth or an external effect.

Completion is observable when the current executable behavior has been tested,
the gesture ownership and dismissal state machine is recorded in selective
research, and the verification matrix covers row swipe, page navigation,
long-press alternatives, accessibility, interruption, and reduced motion.

## Boundary

In scope:

- the iOS retrieval shell and Session and People list rows;
- horizontal gesture arbitration, long press, feedback, animation, dismissal,
  accessibility alternatives, and UI-test evidence;
- proposal-only semantics for any People shortcut.

Out of scope:

- executing messages, calendar writes, contact writes, or canonical
  relationship changes from a row gesture;
- redesigning the whole Today, Session, or living-person surface;
- adopting an iOS 27-only API while the project builds with Xcode 26.6 and
  deploys to iOS 16.

## Current evidence and unknowns

- The outer retrieval shell is a page-style `TabView`, so the full content area
  owns horizontal drag for destination changes.
- Session rows are native `List` rows with leading `Unread` and trailing
  `Remove` swipe actions. People rows are buttons inside a `ScrollView` and have
  no row actions.
- Existing UI tests prove page swiping in both directions, but do not exercise
  row actions, mutual exclusion, dismissal, long press, VoiceOver actions, or
  page-switch recovery.
- The repository's prior navigation decision selected simultaneous explicit
  tabs and page swiping before row-level gesture competition was evaluated.
- Direct iPhone 17 Pro Simulator probes show standard and short-fast Session-row
  left swipes navigating to People, while a slower medium drag stays in
  Sessions without revealing an action. No tested drag produced a stable row
  reveal.

## Working direction

Give horizontal gesture ownership to the most local visible object: a row may
reveal its shortcuts, while primary destination changes use the explicit top
control. Use native list behavior and context menus where available instead of
a custom drag engine. Treat revealed controls as transient UI state owned by
one row and dismiss them on any new intent outside that row.

This direction is selected. The research rejects threshold tuning inside the
pager because the current build already exhibits both a navigation zone and a
no-result zone for the same intended row action.

## Milestones

1. [x] Inspect current source and prior navigation decisions.
2. [x] Run focused Simulator probes for row reveal, page conflict, and dismissal.
3. [x] Compare Apple gesture, context-menu, motion, and accessibility guidance.
4. [x] Record the chosen state machine, action semantics, animation, and test
   matrix in the existing iOS relationship-library research.
5. [x] Run `pnpm docs:check` and inspect the final diff.

## Proof

- focused XCUITest or equivalent executable interaction on an available iPhone
  Simulator;
- source locators for the outer pager and both row implementations;
- Apple primary-source links for standard gestures, context menus, motion,
  accessibility, and the relevant SwiftUI APIs;
- an explicit pass/fail/not-run matrix, including Reduce Motion and assistive
  alternatives;
- documentation checks after research changes.

## Reconsider when

- field testing demonstrates that destination swiping is materially more
  valuable than row shortcuts;
- navigation moves to a system tab component that can arbitrate the gestures
  without ambiguity;
- the minimum toolchain and OS support the new container-level swipe-action
  coordination APIs and they pass final-release testing.

## Completion evidence

- The detailed decision and verification matrix live in
  [`docs/research/ios-relationship-library-design-benchmark.md`](../docs/research/ios-relationship-library-design-benchmark.md#fifth-iteration-row-gesture-ownership).
- The synthetic baseline screenshot and bounded interpretation live in
  [`docs/evaluations/2026-09-01-ios-row-gesture-research/`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-ios-row-gesture-research/README.md).
- The canonical design system now keeps the narrow gesture-ownership invariant
  and routes detail to the research instead of growing always-loaded guidance.
- Temporary failing UI probes were removed after evidence capture. The user's
  unrelated existing UI-test edit remains untouched.
- `pnpm docs:check` passes. Gesture implementation and post-fix executable proof
  intentionally remain a separate delivery slice.
