# Figma design audit and revision

Status: Design audit and revision complete; product decisions remain for review.

## Outcome and scope

Audit the current four-page Figma file using Figwright, repair confirmed design
defects, add missing current-design compositions, and leave contextual review
notes for unresolved decisions. This task changes design artifacts, not product
code, deployment, or live relationship records.

File: https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f

## Evidence and ownership

- Initial inventory: 11,589 nodes across Guide (174), Desktop/Web (8,011),
  Mobile (1,313), and Explore (2,091).
- Existing styles and variable collections were read before editing.
- Desktop settings section `47:4593` overlaps later sections; current indexes
  omit R4 and September 29 designs.
- Memory `313:2148` uses preselected folded items and a combined contact/Memory
  action; the approved Session-card specification describes independent decisions.
  Preserve both artifacts and expose the conflict for human review.
- Canonical design guidance assigns device controls to native Mac settings and
  account management to the browser. Existing `210:1469` depicts embedded account
  management and must not remain an unqualified current native reference.
- The desktop companion chat is active. Do not edit its v3 source frames
  `301:1536`, `301:1716`, or `305:1897`.

## Design approach

Retain warm neutrals, existing typography and variable bindings. Correct canvas
organization and obsolete current labels first. Reuse existing editable shells
and components. Add a current native-settings/browser-handoff composition and
missing mobile navigation/intent states. Compare atomic Memory decisions with
the preserved grouped proposal rather than silently deciding product semantics.

## Milestones

1. Inventory all pages and inspect representative current and boundary screens.
2. Repair confirmed organizational, clipping, hierarchy and terminology defects.
3. Add missing designs and contextual review notes with explicit proposal status.
4. Read back changes, inspect rendered screens, verify prototype destinations,
   and record coverage and remaining limitations.

## Verification boundary

Figma screenshots prove static composition only. Native behavior, accessibility
runtime, persistence, external effects and successful production deployment are
not claimed by this design audit. Historical screenshots remain historical.

## Delivery evidence — 2026-09-30

The four-page structural inventory covered 11,589 initial nodes. Rendered review
was focused on representative current screens and changed compositions, not a
pixel-by-pixel inspection of every historical node.

- R5 desktop review hub: `326:2792`; mobile section: `326:2791`.
- Repositioned six desktop sections following the oversized settings section;
  corrected obsolete current labels and page navigation. Preserved historical
  compositions and the concurrently owned desktop companion v3 frames.
- Corrected ten clipped avatar initials, three clipped badges, a mobile sheet
  action label, and misleading cross-device copy. Hid an empty overlapping guide
  section without deleting its source.
- Added native device settings (`326:2809`), independent browser account identity
  (`326:2843`), and offline/recovery review notes (`326:2870`).
- Added atomic Memory alternative A (`326:2889`), preserved grouped alternative B
  (`326:2970`), and separate confirmed-save, unknown-result and missing-source
  states (`326:3087`, `326:3096`, `326:3102`).
- Added seven mobile compositions: Today, no-action, Meetings, New Session,
  dark Today, active Session, and enlarged-text Session. Reused file components
  and color variables; corrected dark navigation and brand-mark contrast.
- Native Figma comments were posted and read back: #1 / R-03 mobile behavior;
  #2 / R-02 Memory decision boundaries; #3 / R-01 settings/browser identity.
  Comments are English because native automation dropped Chinese input;
  corresponding canvas explanations are Chinese.

Read-back geometry checks found no child-boundary overflow in the new R5
sections after excluding intentionally hidden reference nodes. Final screenshots
were inspected for native settings, browser identity, atomic Memory, dark Today,
Meetings and enlarged text. Representative prototype reactions were read back:
review-index destinations, settings-to-browser, Memory-to-confirmed receipt, and
Today-to-New-Session. These are illustrative navigation links, not proof of
working persistence or complete interactive prototypes.

Eight final PNG exports are stored locally at
`/Users/cubxxw/.local/share/figwright/artifacts/design-audit-20260930/`.
The authoritative editable delivery is the Figma file.

## Remaining human review

1. Decide whether grouped Memory is browsing-only. Default approval of hidden
   items and combining contact creation with Memory approval conflict with the
   atomic-decision specification; neither is silently accepted by this revision.
2. Review the device-settings/browser-account handoff and identity mismatch copy.
3. Validate mobile keyboard clearance, IME send guard, draft recovery, pager
   state, Dynamic Type and reduced motion on the implemented native surface.

No product code or live records were changed. No simulator or build was started.
The storage audit reported 72 GiB free and unrelated existing artifact/Compose
warnings; no cross-task cleanup was attempted. Only lightweight documentation
validation applies to this local evidence record.
