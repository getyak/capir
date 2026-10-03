# GET-129 compact workspace evaluation

Date: 2026-10-02. [Active plan](../../../plans/2026-10-02-get-129-visual-experience.md).
This evaluation supersedes the older GET-129 sidebar measurements only;
GET-128 conversation-runtime evidence remains in its existing evaluation.

## Design source and deliberate adaptations

Figwright read the Talent Signal Figma file
[`7Z8yHplvwjVhpq8IuKv87f`](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f)
through the open local plugin. Frames 31:135 and 551:5816 describe expanded
navigation; 31:137 describes the collapsed rail; 31:584 and drawer 31:696
describe person context. Measurements come from full design trees, not
coordinates estimated from screenshots. Hidden old layers are excluded.

| Element | Grounded value |
| --- | --- |
| Expanded sidebar / collapsed rail | 248px / 72px |
| Sidebar inset / header | 12px / 36px |
| Compact navigation | 36px controls, 74px selected pill, 18px radius |
| Conversation rows | 40px, 24px avatar, 13px/20px title |
| Related person chip | 32px, 22px avatar, 12px/20px text |
| Footer account / connect | 28px visual avatar, 40px connect pill |
| Native update | 40px entry, real host update state |
| Person drawer | 336px, 24px inset, warm surface and hairline |
| Person identity | 48px avatar, 20px/32px name |
| Memory text / provenance | 14px/24px / 12px/20px |
| Conversation / composer axis | 880px maximum, 62px initial composer |

The product retains Talent Signal identity rather than the Figma demo's capir
wordmark. Person avatars and labels come from account-scoped data, never demo
photos. Generic icon mapping to the Next metadata icon route is a false match;
existing Phosphor controls supply actual interactive icons. Session history is
labeled as conversation history rather than invented contact events. Empty
identity metadata remains absent rather than filled with fictional facts.

## Acceptance method

Compare the previous vertical sidebar (direction A) with compact navigation
and contextual person preview (direction B), rendered against one isolated
synthetic database. Synthetic Sessions and accepted Memory use existing
domain authorization, source authority and confirmation transitions. A
deterministic no-network provider supports fixture interaction only and does
not establish model quality. No customer data, credentials or raw Figma trees
are published.

Independent judgment uses 30 points for composition/reference fidelity,
20 for typography/spacing/material, 20 for navigation/interaction continuity,
15 for responsive/accessibility, 10 for motion/state handling and 5 for
identity/evidence clarity. A score is a reviewer judgment, not certification.
An unresolved P0/P1 or missing required acceptance prevents delivery at any
score. The target is strictly above 97/100.

## Current evidence

Independent code review passed after closing two authorization/deletion P1s
and the canonical return, theme scope and statement-label P2s. A further
legacy Session review passed 65 tests after the shared canvas adaptation.
Local focused regression passed 103 tests across 16 files; typecheck, lint
(0 errors, 6 pre-existing warnings) and documentation checks pass.

[Independent review](review.md) and [browser receipt](browser-receipt.json) records actual rendered geometry and
behavior: 68px header, 880px by 62px composer, 396px by 46px user bubble,
336px desktop drawer, no 390px horizontal overflow, all four mobile routes,
modal focus containment, canonical destination visibility, Escape focus
restore and an unchanged typed draft. The canonical People page preserves the
Session through its relation-context link. Root font 24px checks rem-based
layout; pixel-based text sizes are unchanged, so it does not establish universal
150% text zoom. Normal drawer entry is 220ms; reduced motion removes animation.
An empty synthetic directory retains history and new-conversation destinations.

Fixture expiry was changed only in the isolated disposable database to observe
zero visible Sessions. No real customer or deployed state was changed. Early
development screenshots caught theme transitions and hydration before settled
state; stable final images below replace them. Browser screenshots use initial
caret to avoid screenshot-induced hydration attributes.

| Surface | Settled synthetic evidence |
| --- | --- |
| Home / collapsed | [Home](home.png), [Rail](collapsed.png) |
| Conversation / contextual preview | [Session](session.png), [Preview](drawer.png), [Bottom and focus](drawer-bottom.png) |
| Canonical person / search / account | [Person](person.png), [Search](search.png), [Account](account.png) |
| Dark / mobile | [Dark](dark.png), [Mobile home](mobile-home.png), [Mobile Session](mobile-session.png), [Mobile preview](mobile-drawer.png) |
| Empty / root text scale | [Empty history](empty-history.png), [24px root](text-scale.png) |

Independent visual review: **98.0/100**, strictly above the requested 97.
Composition 29.2/30, type/material 19.6/20, navigation 20/20,
responsive/accessibility 14.8/15, motion/states 9.4/10 and identity 5/5.
Remaining minor differences are timestamp placement, selected-row material,
11px secondary provenance, early chip truncation and direct close/rail motion.
No visual P0/P1 remains. This is an independent aesthetic judgment on the
recorded fixtures, not an objective quality certification.

Production build passed with the required isolated test AUTH_SECRET. This slice
was delivered in [PR 270](https://github.com/getyak/talent-signal/pull/270),
merged at 964eb29e after its applicable checks. The resident Web activation
was separately read back. The [deep alignment follow-up](../2026-10-02-get-129-deep-alignment/README.md)
records subsequent refinement; signed native login acceptance remains pending.
