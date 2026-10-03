# GET-129 deep Figma alignment evaluation

Date: 2026-10-02. [Plan](../../../plans/2026-10-02-get-129-deep-alignment.md).
This dated follow-up supersedes the typography, timestamp, selected-row,
chip-width and drawer geometry observations in the [earlier evaluation](../2026-10-02-get-129/README.md).
It does not establish signed native login acceptance.

## Source and bounded outcome

Figwright read the current visible section 31:68 of the
[Talent Signal design](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=31-68).
Current descendants 404:2307 (canvas), 404:2268 (sidebar), and 31:696 / 537:3423
(drawer) ground the values below. Hidden historical frames were excluded.
Compare baseline main b0912030 with the refined implementation on the same
isolated synthetic account. Actual Talent Signal branding, authorized person
identities, source distinctions and canonical fallback text remain intact.

| Detail | Implemented source value |
| --- | --- |
| Expanded / rail navigation | 248px / 72px |
| Desktop header / title | 68px; centered 15px/23px |
| Header actions | Named 44px targets |
| Transcript / composer axis | Shared 880px maximum; actual symmetric gutter compensation |
| Send time | Centered before user message; semantic ISO value; year retained when needed |
| User / assistant typography | 14px/22px / 15px/25px |
| Assistant identity | 20px mark, 14px gap |
| Selected conversation | Flat warm #E8E6DF surface |
| Related-person chip / label | 96px / 68px at 248px sidebar; full accessible identity retained |
| Context chrome / content start | Full-height 336px surface; 68px + 24px desktop inset |
| Memory / provenance | 14px/24px / 12px/20px |
| Short-window drawer header | Sticky, with complete visible close target at scroll bottom |

## Acceptance and evidence

The isolated disposable PostgreSQL fixture uses the normal password login,
real session/domain APIs, and an explicitly selected Memory review/commit.
Its username and email are both test@gmail.com. The deterministic no-network
provider supports synthetic fixture rendering only; this is not model-quality
or native authentication proof. `capir auth status --env local-test` found no
configured environment, so no reusable grant is claimed. No customer data,
auth material, cookies, raw Figma trees or Memory undo tokens are published.

[Browser receipt](browser-receipt.json) records production-mode desktop,
320/390/640px reflow, dark/reduced-motion, disclosure and panel Escape/focus,
unchanged draft and immediate closed-content removal. [Scrollbar receipt](classic-axis-receipt.json)
records a controlled Chromium custom classic scrollbar reserving 32px across
both edges at five widths in each renderer, with aligned axes and an unclipped
composer add menu. This is controlled browser layout evidence, not a claim
about every OS scrollbar configuration or browser.

The screenshot archive remains at
`/Users/cubxxw/.codex/visualizations/2026/10/02/get-129-deep-alignment`.
[Artifact manifest](artifact-manifest.json) identifies reviewed captures by hash;
images are kept out of the text-only PR review input. The normal desktop,
sidebar rail, drawer, narrow details, mobile drawer, dark state, short window
and classic-scrollbar add menu are independently inspected. Screenshots
alone do not establish frame rate, universal zoom or all product routes.

Focused tests: 50 passed across nine files, including actual scrollbar inset
updates and cleanup, observed send-time/year semantics, existing account
fences and draft/control behavior. Typecheck and production build passed.
Lint has no errors and six pre-existing warnings. Documentation checks and
latest PR-head gates are recorded at delivery rather than inferred from local
builds.

## Independent review and remaining scope

Independent code review closed the classic scrollbar P2; no unresolved
P0/P1/P2. Visual review findings prompted the sticky short-window header and
real rendered assistant typography fixes. Final visual judgment is recorded
in [review](review.md); the score is an independent assessment of this scope,
not a quality certification. Closing the context panel immediately removes
private content; entry is 220ms and reduced motion removes animation.

The separate signed native login acceptance remains outstanding. GET-129
must remain In Progress until that acceptance is actually complete. This
follow-up uses a related PR rather than a closing keyword.
