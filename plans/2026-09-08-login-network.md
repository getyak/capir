# Login network refinement

## Outcome and boundary

Make the native signed-out home quiet and let the user continuously pull the
fictional relationship illustration into place. Preserve the existing first
meeting (no portraits or edges before intent), provider/email authentication,
and reachable recovery for failed or unknown sign-out. No real contacts enter
the illustration; no authentication/backend authority changes are intended.

## Evidence and design decision

Baseline: `7146d1f3`, isolated in `codex/login-network-gesture`.
The previous view commits during dragging at 70 pt and delays login another
1,050 ms. SpriteKit launches independently of the gesture; retained successful
sign-out receipts and Lab chrome occupy the ordinary home.

References inspected September 8, 2026:
- https://partiful.com/about — people and shared moments carry the promise.
- https://www.are.na/about — a small content/connection grammar carries complexity.
- https://www.cosmos.so/ — references themselves supply visual identity.

These are design interpretations, not causal conversion claims.

D0: a relationship owner should feel agency before choosing sign-in. The
illustration introduces connection without pretending to be the user's data.
D1 A: orbit around a central brand; D1 B: a network drawn out by the hand.
D2 A: symmetric radial expansion; D2 B: staged vertical emergence, then edges,
then an immediately available sign-in area. B matches the explicit brief;
A remains a visual challenger. Avoid dashboard graphs and autoplay spectacles.
D3: `output/login-network/directions.html` compares both compositions with the
same bundled portraits. Native renders will verify the chosen motion.

## Milestones

1. [done] Inspect references and rendered A/B; select B. A forms a decorative ring; B makes a growing connection structure legible.
2. [done] Implement reversible gesture progress, quiet home, and contextual recovery.
3. [done] Verify small pull, completed pull, repeat entry, failed authentication,
   sign-out recovery, dark/reduced motion, and accessibility text size.

## Completion evidence

Preserve before/after native screenshots and focused XCTest results. Run
localization and documentation checks. Simulator observation cannot establish
physical-device haptic quality or sustained device frame rate. Do not claim a
TestFlight release or actual third-party login from local fixture validation.

## Completion

Implemented and verified. See
[the evidence record](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-08-login-network/README.md).
Native tests exposed a tap/drag conflict in the initial short-pull implementation;
local drag priority fixed it, and both iPhone 17 Pro and SE replay passed.
The final AX5 layout gives login actions priority over the decorative hero.
Final signed build, localization, docs and fixture type checks passed.
Changes remain on the isolated task branch; no release was requested or claimed.
