# Talent Signal iOS R8 design study

Date: 2026-10-02. Authority: a dated design proposal and evaluation, not an implementation decision. Scope: the requested Figma file and the installed iOS synthetic preview. No production code, real relationship records, external messages, account permissions, or public sharing changed.

## Deliverable

The editable R8 section is in the existing [Figma Mobile page](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=574-4389). The [connected prototype](https://www.figma.com/proto/7Z8yHplvwjVhpq8IuKv87f?node-id=574-4489&starting-point-node-id=574%3A4489&page-id=28%3A62&scaling=scale-down) starts at Today. The original supplied node `28:66` is a Mobile Web study; the native R5 section is `326:2791`. R8 preserves those originals and uses their existing variables, iconography, brand mark, and synthetic portrait.

There are 17 screens: Today, Sessions, People, Meetings, session reading, person context, full composer, editable voice transcript, independent confirmation, no-action Today, retained-draft recovery, light Today, welcome, source excerpt, follow-up draft, demonstration confirmation receipt, and an original-navigation comparison. Twelve local components cover eight selected-navigation appearances, two intent ribbons, and two retrieval rows with editable Title, Context, and Meta properties.

The wording about “Black-related” design was ambiguous. A clarification was requested but had not been answered at delivery. Charcoal is the provisional main visual direction. Black cultural product references are covered separately through SPILL; neither skin tone nor ethnicity is treated as a UI style. The study reuses the file's authorized synthetic portrait rather than importing personal photography or inventing demographic representation.

## Reference evidence and transfer

| Reference | What the source supports | Transfer to Talent Signal | What is not established |
| --- | --- | --- | --- |
| [Linear Mobile](https://linear.app/mobile) | A mobile workflow centered on quick capture and reviewing work, including swipe interactions | Keep capture continuously reachable; distinguish a short list of meaningful next steps from a dashboard full of metrics | Exact spring constants, latency, or gesture recognition thresholds |
| [Spotify Design: iPad experience](https://medium.com/spotify-design/a-new-experience-for-spotify-for-ipad-f80d2477d488) and [Spotify design history](https://newsroom.spotify.com/2026-04-23/spotify-design-history/) | Dark surfaces support the prominence of artwork and content; the visual language evolved over time | Use restrained charcoal surfaces and a narrow accent, with content carrying hierarchy | That an entertainment feed or album grid is appropriate for relationship intelligence |
| [Apple Motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion) | Motion can explain spatial relationships and feedback while respecting accessibility | Make direction follow navigation, allow interruption, and specify a reduced-motion alternative | Native frame pacing or haptic quality in this Figma prototype |
| [App Store editorial: SPILL](https://apps.apple.com/us/iphone/story/id1720179920?l=zh-Hant-TW), [SPILL news](https://www.spill.com/news), and [SPILL support](https://support.spill.com/en/support/solutions) | A community product with Black and queer cultural context, multimedia expression, and named gathering formats | Study recognizable community language, participation context, readable media, and ownership of expression | A universal “Black aesthetic,” a race-based preference, or independently measured animation behavior |

These are workflow and visual inferences from official or author-published material. They are not a claim to have tested each reference application's gestures. No third-party motion values were fabricated.

## Source and simulator comparison

The source R5 navigation makes the selected destination expand into a labeled capsule while other destinations remain compact. This communicates selection, but changing widths can shift the user's next target. R8 A keeps all four labels visible and all target positions stable. The R8 B screen retains the original expanding treatment so the difference remains reviewable.

The installed application was observed on Primary iPhone, iPhone 17 Pro with iOS 26.5, in Synthetic preview. Today, Sessions, People, Meetings, an active session, and return navigation were opened. The preview exposed meaningful context and proposal boundaries. No account login or consequential action was needed. One automated horizontal drag opened a session; that observation does not establish a swipe defect or its cause.

The current implementation's motion configuration was inspected: welcome uses a spring with response 0.62 and damping 0.86, reduced motion uses ease-out 0.18; navigation selection uses interactive spring 0.22/0.82 with blend 0.08; the primary workspace uses page-style TabView; reply ribbon uses 0.34/0.84 and listening expansion uses 0.42/0.88. These are source parameters, not video-derived frame measurements. The preserved recording covers launch and a limited transition into Sessions; the full observed interaction sequence is not all present in that recording.

R8 changes the visual emphasis from controls and repeated containers to a clear heading, relationship context, time, source, and the next reviewable decision. The 390 × 844 frames use PingFang SC, 24-point content padding, a 54-point status region, a 60-point navigation region, and a 106-point bottom region. The list content viewport is 624 points; detail content is 684. Navigation targets occupy approximately 79.5 × 44 points. Lists use subtle separators and typographic hierarchy; strong surface contrast is reserved for the current decision and primary action. The red mark is locally corrected for dark-surface contrast without changing the source component.

Source, interpretation, confirmation, draft, and receipt remain separate screens. The excerpt only supports willingness to discuss a trial; it does not confirm scope, contribution, or timing. A draft does not imply a sent message. Recovery retains input and cannot navigate from an unknown result into fabricated success.

## Motion and scrolling specification

All timings below are design proposals unless explicitly labeled as existing source configuration.

| Situation | Intended feel and rule | Figma study | Native acceptance still needed |
| --- | --- | --- | --- |
| Welcome | Let the brand resolve briefly, then enter the workspace without forced waiting; preserve the current 0.62/0.86 spring as a baseline | Editable welcome and explicit entry link | Actual cold start, restored state, interruptibility, accessibility |
| Module change | Labels and targets stay stable; selection moves with restrained elasticity; content follows the destination's spatial direction | 240 ms ease-out Push; tab connections point left or right according to module order | Interactive paging, velocity threshold, cancellation, destination scroll restoration |
| Long list | Content moves vertically while status, navigation, and capture remain fixed; use platform deceleration | Sessions has seven fictional rows, a 624-point clipped vertical viewport, and preserved siblings outside the scrolling frame | Inertia, edge bounce, diagonal gesture arbitration, pagination, large text |
| Detail and source | Preserve identity and time; push inward, return in the reverse direction | 280 ms ease-out Push, rightward return routes | Edge-back gesture, interrupted transitions, reading-position restoration |
| Composer | Expand the intent into a full task without losing the draft | 280 ms upward Push into the full composer | Keyboard avoidance, caret position, genuine field editing and attachment handling |
| Voice | Keep recording, transcript review, and sending distinct; use 0.34/0.84 for the ribbon and 0.42/0.88 for listening as initial native baselines | Static editable waveform and transcript; connected review routes | Hold, release, lock, cancel, audio permission, actual transcription and accessible feedback |
| Reduced motion | Preserve continuity through a short fade, about 180 ms, instead of travel or bounce | Written specification; no system-setting-aware prototype variant | Reduce Motion and VoiceOver behavior |

The three remaining drag triggers are illustrative next-module transitions; Figma does not implement direction- and velocity-aware native paging here. Sessions has no such drag reaction, so vertical scrolling is not intercepted by a synthetic navigation jump. The prototype remains a navigation demonstration: text fields, search, voice capture, confirmation persistence, and external writes are not live services.

## Verification and evidence

The desktop Figma presentation was actually clicked through Today → Sessions → session reading → source. The Sessions list was scrolled until the later rows were visible; status, navigation, and bottom capture stayed in place. An initial auto-layout prototype rendering issue hid status and capture after scrolling. Moving the Sessions root to a fixed-position viewport resolved it; its content remains an auto-layout scroll frame.

Structural readback confirms 17 frames at 390 × 844, 12 components, 298 text nodes, 77 instances, 72 reaction-bearing targets, and a vertical Sessions viewport. The only image fill in the delivered section/library is the existing 56 × 56 synthetic portrait; the interface is not a flattened screenshot. The three sampled source frames remain 390 × 844. Full source immutability is supported by the scoped mutation scripts, not asserted merely from these dimensions.

[Final audit](../../plans/local/ios-figma-refresh-2026-10-02/final-audit.json) contains screen IDs, fonts, image bounds, original-frame checks, and reaction readbacks. [Task plan](../../plans/local/ios-figma-refresh-2026-10-02/plan.md) contains execution scope. Visual exports and the simulator recording are local delivery artifacts outside the repository at `/Users/cubxxw/.codex/visualizations/2026/10/02/01a0fbbd-8c2c-7003-a62a-f0beac861075/ios-refresh/`.

Only the allowed Primary iPhone was used. The simulator session was released and the device shut down because this task started it. The owned temporary artifact directory was removed after preserving the recording and screenshot. No other task's artifacts or simulator data were removed.

Figma's official MCP was blocked by the Starter quota. The already-installed Figwright plugin was used with the requested file's pinned session, and the actual presentation was verified through the desktop app. No subscription, sharing permission, or plugin installation was changed. This design deliverable does not claim native performance, keyboard, haptic, network, live data, or production implementation validation.
