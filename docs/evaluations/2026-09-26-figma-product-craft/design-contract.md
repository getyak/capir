# Product craft contract

Status: selected direction; implementation and acceptance pending.

## Source and judgment

[People A: selected composition](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=63-1198)
keeps identity, relationship context, and update time visible in one calm list.
[People B: retained comparison](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=63-1314)
uses a persistent preview but narrows evidence and identity columns. Choose A:
comparison and finding someone are the directory's primary jobs. Detail remains
one explicit navigation away. The source contains synthetic illustrative data.

The original Figma mixes 220px and 276px sidebars and different page densities.
Runtime already owns a shared 236px sidebar; retain that coherent architecture.
The new source adopts 236px expanded / 56px collapsed navigation, a 58px location
bar, and one consistent page rhythm. Do not add unsupported search scopes or
pretend that updatedAt means last contact. Label it Update / 更新.

## Foundation

- Light: canvas #FCFBF7; chrome #F4F3EF; panel #FFFFFF; ink #171715;
  secondary #6A675F; divider #E2E0D8; selected #E8E6DF; accent #BC3827.
- Warm dark: canvas #171816; chrome #20211E; panel #24251F; ink #F2F0E9;
  secondary #B2AFA5; divider #3B3D35; selected #34362E; accent #F18F7D.
  Verify text/focus contrast; do not rely on hue to explain a state.
- Preserve one canonical shared token owner; Web maps tokens, never duplicates
  palette overrides. Keep explicit light/dark and OS mode working.
- Titles 24/34, object titles 22/32, section 18/28, body 15/24, nav 14/20,
  supporting text 13/20. Essential content must not be pushed into tiny type.
- Page content: desktop 40px horizontal and top padding, max 1040px; reduce to
  24px medium and 20px narrow. Conversation reading width remains 720–760px.
- Control radius 8px, bounded focus/review panel 12px. Use hairline rows and
  unboxed sections for ordinary information. No decorative glass, gradients,
  dashboard cards, artificial scores, or ornamental red rules.
- Motion is short, local, and respects reduced motion. Focus remains visible.
  Keep mobile controls 44px and touch targets distinct from dense readable text.

## First implementation batch: foundation, shell, directory

Own shared theme tokens, Web theme adapter, shell CSS, directory CSS and minimal
semantic markup. Preserve all behavior and page routes. Use installed Phosphor
icons; preserve branded asset and real avatar edit affordances.

Directory: 40px avatar, 15px name, 13px role, 14px relationship, 13px source
summary. Rows approximately 84px, aligned dividers, explicit column labels.
Search is a bounded field that can grow on narrow screens; keep the real
supported name/email/phone query and existing submit behavior. Count is text,
not an invented filter button. Preserve populated, empty, loading, failure,
search/no-result, long names, focus, and editable avatar states. Do not hide
relationship identity on mobile merely to fit a desktop table.

Keep shell's actual destinations, recent sessions, frequent people, account,
search and collapse behavior. A selected item should be restrained but clear.
No framework migration, backend changes, API additions, or new permissions.

## Subsequent module pass

- Conversation: preserve immediate local echo, FIFO, streaming/recovery and
  composer ownership. Improve readable rhythm, context chips and grounded
  attachments without making every response a card.
- Today / Pursuit: one primary next step; distinguish source, interpretation,
  pending review and confirmed state. Accent only a consequential pending review.
  Format dates for humans with the existing user timezone semantics. Do not
  expose raw ISO timestamps or internal architecture labels in ordinary copy.
- Person: stable identity header, named relationship scopes, concise current
  context, evidence one step away. Never collapse contexts or person identity.
- Time: readable calendar labels and event hierarchy, accessible editor and
  timezone clarity; keep schedule semantics, no external scheduling changes.
- Sources: review state, provenance, scope and recovery before decorative chrome.
- Extensions: connected/needs action/unavailable states from real capability
  data, clear setup steps, no claim of connectivity based solely on design.
- Settings: consistent section hierarchy and compact profile rows, keep real
  save/cancel/readback, identity linking and destructive confirmations intact.

## Acceptance

Synthetic preview only, ports Web3038/backend4338/Postgres55438. Compare rendered
Figma and actual Web at 1280x820 plus a narrow viewport, dark appearance and
keyboard navigation. A screenshot proves only the shown state. Shared Web also
feeds macOS WKWebView; it does not prove native iOS or separate native settings.
Run focused existing tests, Web lint/typecheck/build and docs check. Behavioral
fixes need meaningful regression coverage. No snapshot test merely mirroring CSS.
Independent review and final visual adjudication remain the parent agent's job.
