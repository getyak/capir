# Design measurements used — GET-128 / GET-129

Read-only sources (never copied here, never write targets):

- Figma node trees: `design-sourceContext.json` (overview 31:135),
  `design-404-2268.json` (sidebar), `design-404-2307.json` (conversation),
  kept beside the delivery plan under the read-only planning worktree.
- Reference screenshots `31-135.png` and `31-137.png` (visual reference only).

Values below are the measured layout and text styles taken from those trees
and mapped onto existing project tokens. Where the running product already
owned a stronger rule (touch targets, account footer geometry), the existing
rule is kept and noted.

## Sidebar (404:2268)

| Element | Measured | Implementation |
| --- | --- | --- |
| Sidebar width | 248px | `--workspace-sidebar-width: 248px` |
| Collapsed rail | 64px | `var(--ts-rail-width, 64px)` |
| Sidebar fill | `#F4F3EF` | `var(--workspace-chrome-surface)` |
| Workspace header | 224×44 at 12px inset | 12px sidebar padding |
| Search field | 224×36, radius 8, `#FCFBF7` | full field trigger opens the existing scoped search modal |
| Primary destination row | 40px tall, radius 10 | `navLink` min-height 40px |
| Section labels (置顶 / 最近会话 / 联系人) | 12px Regular, 19px line, `#6A675F` | `groupTitle` 0.75rem |
| Session row | 224×40, radius 8, one line | `sessionRow` 40px, `sessionTitle` ellipsis |
| Session row title | 13px Regular, 20px line, `#171715` | 0.8125rem |
| Session row avatar | 24px at 10px inset, 10px gap to title | `PersonDirectoryAvatar` `data-size="small"` |
| Person-less session | 24px brand mark | `sessionMark` (brand image, no fixture face) |
| Footer account photo | 36px, Connect apps pill 176×40 | existing 216px footer strip kept (GET-126 geometry pinned by tests) |

## Conversation canvas (404:2307)

| Element | Measured | Implementation |
| --- | --- | --- |
| Floating title bar | 68px, no divider | `header` min-height 68px |
| Session title | 15px Medium, 23px line, centered | `header h1` 15px/23px/500 |
| Title action | 44px target, 18px glyph | `details summary` 44px with `DotsThree` |
| Shared reading axis | 880px centered in the canvas | `content` and `dock` max-width 880px |
| Centered send time | 12px Regular, 19px line, `#6A675F` | `sendTime` 12px muted |
| User bubble | ≤540px, radius 16, `#ECEAE4`, 14px/22px, 12/16px padding | `userMessage` |
| Agent identity | 20px brand mark, content offset 34px | `answer` grid `20px / 14px gap` |
| Agent lead | 15px Medium, 23px line | `answer h3`, response `lead` |
| Agent body | visible IM style 14px Regular, 22px line | conversation-scoped `.response` 14px/22px |
| Milestone bubble | radius 14, `#F4F3EF` fill, 12px padding, 14px/22px | `milestone` + `[data-run-update]` response sizing |
| Folded execution detail | 28px row, 12px/18px, muted `#73736C` | `executionSummary` 28px, 12px |
| Composer | 880×62, radius 16, 1px `#E2E0D8`, 44px icon targets | opt-in inline layout; functional attachment and send controls; no unimplemented voice glyph |
| Source excerpt / pending line | 14px excerpt, 13px `#BC3827` pending | existing provenance and decision blocks |

## Deliberate deviations

- The account footer keeps the constant 216px hosted strip from GET-126
  (avatar 40px + Connect apps pill 120px + entry 40px) instead of the
  reference's 36px + 176px pair, because that geometry is pinned by the
  shipped footer behavior and tests.
- Mobile keeps 44px targets and the existing bottom navigation, so the 40px
  desktop row rhythm is a desktop-only density change.
- Execution elapsed time is measured from message admission because the queue
  contract exposes no separate run-start timestamp; the record names what it
  measures instead of guessing.
