# GET-8 retrieval and meetings

## Outcome and boundary

Implement [GET-8](https://linear.app/getyak/issue/GET-8), read in the signed-in
Linear browser on 2026-09-07. The iOS workspace should have coherent horizontal
navigation, a quieter current-page label, a directly reachable meetings agenda,
and a Today surface that leads with actual work instead of filler.

Own the iOS retrieval shell, its motion, Today composition, calendar entry and
meeting-to-Session handoff. Preserve governed Person/Pursuit/source authority,
explicit approval of calendar effects, recovery, and per-page retrieval state.
No external publication, issue comments, or production data changes are needed.

## Evidence and unknowns

- Clean starting checkout: `a2eaaeae`, after GET-5 Session integration.
- GET-8 reports unequal Today–Sessions and Sessions–People swipe behavior,
  asks to study Notion, show inactive navigation labels progressively, add a
  swipeable meetings destination, remove filler, and connect calendar,
  conversations and in-person memory.
- Current shell updates root SwiftUI state from per-frame page geometry. The
  possible recomposition cost needs measurement; a still image cannot establish
  a stutter or prove its removal.
- Calendar is currently a separate sheet. Existing review, local persistence,
  source scoping and device-write recovery remain the integration boundary.
- Only synthetic cases will be used. This is implementation and usability
  verification, not field research with real recruiters.

## Milestones

1. Done: capture the current native flow, inspect relevant Notion/Apple
   sources and compare two rendered navigation/composition directions.
2. Done: implement one continuous four-page retrieval space, progressive labels,
   clear Today content and a governed pre-/post-meeting Session handoff.
3. Done: verify gestures (including cancellation/rapid reversal), state retention,
   meeting routing, empty/error states, Chinese/English, dark, reduced motion
   and accessibility sizes. Fix observed defects.
4. Done: review the diff and product boundaries; update canonical guidance only where
   the decision changed; preserve screenshots, test evidence and limitations.

## Design read

The primary surface is iOS retrieval for an independent recruiter returning
between conversations. It answers: what needs my judgment, which conversation
should I resume, and who am I meeting next? Keep the professional-notebook
character, neutral typography and low ornament. One current navigation label
has visual emphasis; inactive destinations stay reachable through familiar
symbols and full accessibility names. Motion follows touch and never runs
business logic. Calendar is a time view of existing relationship activities;
meeting recollection becomes an editable Session draft, never confirmed fact.

## Completion evidence

Current screenshots and interaction observations, focused native behavior and
state tests, compile checks, `pnpm docs:check`, and a review of meaningful source
and external-write boundaries. Record performance measurements as observations
with their environment; do not claim device frame-rate proof from Simulator.

## Progress evidence

The [evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-07-get-8/README.md) records the
accepted baseline, two rendered directions, official references and verification
failures. The existing native pager is retained; an ObservableObject held by
State publishes only to the header, avoiding a new paging framework. The
inactive Lab entry fits within the same stable toolbar on all four pages.
Active Lab scope remains explicitly visible. Calendar now owns one persistent
page, and meeting-note/preparation handoffs wait for an open activity sheet to
finish dismissing before opening the Session.


Final verification now covers 108 focused unit tests and 23 distinct passing
native UI cases, including four-page cancellation, RTL, edited note drafts,
calendar review/overlap, search/filter retention and long-list anchors. Small
375-point iPhone SE tests cover AX5 and Chinese dark reduced motion. A signal
TERM interrupted one long-Session test; its unchanged isolated rerun passed.
The paired Simulator metric observations are preserved without claiming device
FPS or fewer hitches. Canonical product/design guidance, localization and
architecture checks pass. Release compilation also passes for generic iOS Simulator with signing
disabled and a compile-only placeholder endpoint. The final record is
complete; no publication, issue write or production connection occurred.
