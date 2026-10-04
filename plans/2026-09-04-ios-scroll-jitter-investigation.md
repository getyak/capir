# iOS scroll jitter investigation

## Outcome and boundary

Identify the cause of the reported up/down scrolling jitter from the running
iPhone 17 Pro simulator and the matching SwiftUI implementation. Deliver
reproduction evidence, ranked causes, and a narrow correction/verification path.
This is diagnosis: do not modify production behavior or unrelated in-progress work.
Use synthetic preview data; no contact/calendar writes or data resets.

## Current evidence and unknowns

- iPhone 17 Pro, iOS 26.5, portrait, English, synthetic preview.
- Today uses a ScrollView with a non-lazy VStack and fixed header/guide insets.
- People and Sessions use List, per-row global GeometryReader preferences,
  parent-bound scroll anchors, and a pressed-state scale animation.
- The user has not yet identified the most affected page. Start with Today
  and compare People/Sessions; current simulator initially showed Calendar.
- The working tree contains substantial concurrent changes. Preserve them.

## Milestones

1. [complete with limitation] Inspect both directions and resting states.
   Automated gestures did not yield a useful continuous-scroll recording;
   no frame-pacing reproduction is claimed.
2. [complete] Measure the running scroll views and trace relevant code paths.
   Today has 110 points of scroll travel and lacks the guide's bottom clearance;
   the short People list still enables vertical bounce. Geometry observation
   and row scale animation remain unmeasured performance/symptom candidates.
3. [complete] Record findings and limitations. `pnpm docs:check` passed,
   including wiki and architecture checks. Simulator returned to Today;
   no business code was edited and no jitter fix is claimed.

## Findings

The [evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-ios-scroll-jitter.md) owns the
measurements, correction candidates, exact reproduction limitations, and
verification path. No production source was changed. A definitive cause for
sustained interior-scroll hitches still requires successful gesture capture
and an isolated performance comparison; this diagnosis must not be described
as a verified jitter fix.

## Completion evidence

Direct simulator interaction plus recordings/screenshots when useful, exact
source locations, and explicit observed-versus-inferred confidence. Do not
claim a fix, FPS measurement, or physical-device result without that evidence.
