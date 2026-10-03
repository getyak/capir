# Independent review — detail polish

Date: 2026-10-02. Scope: four CSS modules, current measured Figwright references,
and isolated synthetic production Web utility/person-preview surfaces.

## Findings and closure

| Finding | Resolution and evidence |
| --- | --- |
| Close focus ring clipped after short-window scroll | Inset outline; actual desktop close y2 with full visible target and hit test |
| Body text visible behind sticky close/header | Opaque header extension and solid close surface; actual bottom-scroll screenshots |
| Details delete partly covered by bottom navigation | Mobile viewport budget and bounded overflow; actual 640x220, 320x321 and 640x400 rectangle/corner hits |
| Short-window details covered their summary toggle | Horizontal space beside the summary; ordinary second click closes the popup |
| Mobile utility action below touch target | 44px minimum detail actions and image close; real computed geometry |
| Popup screenshot sampled during entry transition | Animation completion awaited before stable source comparison |
| Mobile receipt claimed bottom scroll at scrollTop 0 | Fixture load and positive actual scroll required; final 320/390 snapshots have scrollTop 231 |
| Dark settings preview used before saving | Ordinary save preference action; dark palette survives route navigation |

The independent code reviewer re-read the final four modules, actual rectangles,
corner-hit checks and screenshots. Final conclusion: no unresolved P0/P1/P2.
Mobile drawer Escape removes private content; menu Escape and opener focus
recovery, reduced motion, IME composition and multiline draft checks also pass.

## Visual judgment

**98/100**, independent final Web visual assessment. The first final checkpoint
scored 97 because ordinary motion lacked continuous evidence. A supplemental
normal-motion recording and real animation-frame samples closed that evidence
gap; the reviewer independently re-read the samples before revising only motion.
No previous-round score is carried forward.

| Dimension | Score | Evidence / remaining deduction |
| --- | --- | --- |
| Structure | 29.5/30 | Measured composer, menu and drawer geometry; extreme-height information compression |
| Type / hierarchy | 19.5/20 | Measured primary/secondary rhythm; dense synthetic text in very short windows |
| Navigation / interaction | 20/20 | Click toggles, search focus, Escape, draft retention and unobscured actions |
| Responsive | 14.5/15 | Actual 320/390 scroll and 220/321/400 height checks; very short viewport compresses context |
| Motion | 9.5/10 | 220/160/150ms actual samples, monotonic opacity, converging displacement, stable width; reviewer did not watch video pixels |
| Identity / provenance | 5/5 | Synthetic identity, user opinion, unknown time and source distinctions retained |

Final visual conclusion: no new blocking findings. This is aesthetic judgment
about the observed slice, not objective certification. The normal animation
receipt supplements static screenshots and reduced-motion proof; it cannot
establish all browser frame delivery or rule out every painting artifact.

## Limits

This is production-mode Web proof using synthetic people, a real saved user
opinion with unknown time, and a public test icon. No model understanding,
external action or customer-data acceptance is inferred. Native OS IME,
universal browser/zoom coverage and signed native login are not established.
Resident account/capir setup and original GET-129 native acceptance remain open.
The local source/screenshot archive is linked and hash-bound by the evaluation.

## Merge-time test re-review

The three cancellation/stop integration fixtures have an independent code review:
no unresolved P0/P1/P2, with stale-result, partial ownership and no inherited auto-continue assertions
retained and five targeted rounds of all three cases confirmed. See [CI repair](ci-repair.md) for the cause and proof.
This test-only correction does not change the reviewed Web CSS or score.
