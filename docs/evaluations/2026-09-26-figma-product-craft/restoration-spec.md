# Figma restoration spec — implementation batches

Companion to `design-contract.md`. Every batch restores one Figma frame in the
real Web app while preserving existing behavior, routes, and honest state. When
this spec and a synthetic Figma value disagree with real data, render real data
in the spec's visual language. Source exports for reference (do not commit):
`/Users/cubxxw/.local/share/figwright/artifacts/product-craft-20260926/modules/`.

## Shared foundation (owned by the integrator, do not edit in batches)

- Canonical tokens live in `packages/workspace-ui/src/theme/tokens.css`
  (`--ts-*`). `apps/web/components/workspace-theme.css` only maps them into the
  Web token names (`--ink`, `--muted`, `--line`, ...). Batch code must use the
  Web token names and never hard-code a palette value.
- Type scale: page title 24/34 (600), object title 22/32 (600), section 18/28
  (600), body 15/24, nav 14/20, supporting/meta 13/20. No essential content
  below 13px. Numbers use tabular figures where aligned columns matter.
- Page frame: content max 1040px, 40px horizontal/top padding on desktop,
  24px medium, 20px narrow. Reading column (conversation) 720–760px.
- Radii: controls/buttons/inputs 8px, bounded panels 12px, avatars circular or
  8–12px. Hairline dividers `--line-soft`/`--line`. No gradients, glass,
  dashboard cards, decorative scores, or ornamental red rules.
- Accent (vermilion) only marks a consequential pending review or the brand
  mark. Ordinary metadata stays `--muted`.
- Buttons: primary = solid ink background, panel-colored text, 8px radius,
  min-height 40px (44px touch); secondary = 1px `--line` border, transparent;
  tertiary = text link. Focus-visible ring stays visible on both themes.
- Dark theme is first-class: verify text/contrast and never explain state by
  hue alone. Respect reduced motion.

## Shell (integrator-owned, batches must not edit)

Sidebar 236px expanded / 56px collapsed, chrome surface, route header 58px.
Brand row: mark + "Talent Signal" + collapse control. Nav: 新对话 / 今日 /
人物 / 时间 / 扩展 with restrained selected state. Recent sessions list and
frequent people list keep real data. Footer: workspace account row with avatar,
name, workspace label, menu.

## Module frames

### Today — `63:1453` (`pursuit-today-page.*`)

Header: title 今日, one-line subtitle ("把注意力留给现在值得推进的一步。"
pattern: attention on the next supported step). No stat counters.

Focus card (panel surface, 1px line, 12px radius, ~32px padding, no shadow
excess):
1. meta line 13px muted: `已分配行动 · 9 月 28 日 15:00 截止` =
   kindCopy · human deadline (use `PursuitDeadline`), kind not in accent.
2. object title 22px: `item.attentionTitle`.
3. context line 15px muted-strong: `personLabel · title`.
4. hairline divider.
5. two-column facts row: 目标结果 / 当前里程碑 (13px muted label, 15px value).
   Additional real facts (目标日期, 修订版本) fold into the footer meta line.
6. bounded muted panel (8px radius): 关闭条件 label + close condition text.
7. primary ink button 打开目标工作区 (or 审阅提案 for review items; review
   items may use accent treatment for the pending label only).
8. footer meta 13px muted: `负责人：X · 证据可查看 · 修订版本 N · 打开此视图
   不会改变任何状态。` (fold the parts that exist; keep honest no-action copy).
9. Agent composer keeps all behavior but renders as a quiet bounded panel in the
   same visual language (no dark decorative block, no gradient).

Right rail (min ~280px): section title 继续 18px + hairline. Quiet state copy:
"暂时没有其他事项需要你决定。" + "有新的变化时，会在这里出现。" in 13/15px
muted. Continuation entries keep kind, title, person, target date, deadline.

### Conversation — `63:1722` (`session-workbench/*`, `conversation-response.*`,
`new-conversation.*`)

Page title = session title (24px) + subtitle `personLabel · contextLabel` 13px
muted. Reading column 720–760px. User message = bounded muted panel (8px).
Assistant response unboxed: lead sentence 18px (600), body 15px, numbered
points `01`/`02` with bold 15px label + 15px muted explanation, provenance line
13px muted `依据 · 9 月 24 日试点合作讨论` with real source links preserved.
Composer: bounded panel 12px, textarea 15px, bottom row with add action,
context chip (`陈夏 · 设计合作`), primary 发送 button. Preserve FIFO, local
echo, streaming recovery, queue and ownership rules.

### People directory — `63:1198` (`people-directory-app.*`,
`people-directory-list.*`, `person-directory-avatar.*`)

Header row: title 人物 + secondary button 添加联系人 (8px radius, no pill).
Subtitle `4 位联系人 · 每段关系保留自己的上下文` (count is text).
Search: bounded field, magnifier icon, placeholder `按姓名、邮箱或电话查找...`,
supported query behavior unchanged, count text `N 位人物` right-aligned.
Column labels 13px muted: 人物 / 关系情境与资料 / 更新. Rows ≈84px with hairline
dividers: 40px avatar, name 15px (600), role/identity 13px muted, relationship
context 15px + summary 13px muted (`来源 3 · 已确认线索 2`), update date 13px
muted (label 更新, never "last contact"). Footer note: `每位联系人保留独立身
份，资料只在对应关系情境中使用。` Keep empty/loading/failure/search-no-result/
long-name/focus states and real avatar editing.

### Person memory — `63:1537` (`person-memory.*`, `context-contact-header.*`)

Identity header: 64px avatar (12px radius) with edit affordance, eyebrow
`人物记忆` 13px muted, name 24px. Hairline divider under header.
Two columns: left = 关系情境 (18px section), context chip rows (`设计合作`)
as 8px-radius bordered buttons with chevron + helper `进入对应关系继续查看资
料与对话。` and secondary button 返回人物目录. Right = eyebrow state
(`暂无待确认变化`), object title `已保存的记忆` 22px, grouped memory blocks
with 13px muted labels (`关于对方` / `我们之间`), 15px content, provenance
13px muted (`来源陈述 · 陈夏`, `已保存事实`). Never collapse identity or
contexts; evidence stays one step away.

### Pursuit room — `63:1631` (`pursuit-room.*`, `pursuit-agent-rail.*`,
`pursuit-proposal-review.*`, `pursuit-review-gate.*`)

Eyebrow (`客户合作目标` 13px muted) + title 24px + one-line target 15px muted.
Meta row: 目标结果 / 目标日期 / 状态 / 修订版本 (label 13px muted, value 15px
or 22px for dates in the frame — keep values aligned, tabular). Hairline.
Left column: 依赖项 section (label 13px muted + section title 18px + count
text right), gap rows (bold 15px title, muted close condition, right-aligned
state text), then 已分配工作 section with action rows (`整理一页方案，明确评
审重点`, owner · deadline 13px muted, state text right). Right rail: pending
review panel — accent-soft bounded panel 12px with accent `待你审阅` label,
18px title, 15px body, `尚未应用 · 审阅后由你决定` 13px, primary button
审阅建议. No fabricated proposals or scores.

### Time — `63:1804` (`workspace-meetings.*`, `meeting-month-grid.*`,
`time-meeting-inspector.*`)

Header: title 时间 + subtitle. Control row: current date `2026 年 9 月 26 日`
22px left; right = 今天 (secondary), 周 (secondary), 添加日程 (primary).
Week grid: 7 columns, day name 13px muted + date 22px (600), hairline under
header row, today column filled `--surface-muted`/selected, event chips (muted
panel 8px: time 13px + title 15px), empty cells say 没有安排 13px muted.
Keep hour grid, all-day region, timezone picker, inspector and timeline
behavior exactly as supported today.

### Sources — `63:1905` (`captures/*` page components)

Title 来源 + subtitle `截图与文字，整理成可追溯的人物线索。`
Mode switch: 截图 (primary) / 文字 (secondary) as two 8px-radius buttons.
Drop zone: bounded panel 12px with centered 18px title `拖入截图，或直接粘贴`,
13px muted `PNG、JPEG、WebP · 最多 10 张`, secondary button 选择截图.
Options below: text button `+ 添加整理要求`, checkbox 允许搜索公开职业资料,
13px muted retention line `原文与分析最多保留 30 天`, primary button 保存并整理.
Divider, then 最近来源 section (18px): rows with title 15px + `陈夏 · 设计合
作 · 9 月 24 日` 13px muted and right-aligned text link 查看结果.
Right rail 来源会如何整理: three items (保留原文 / 串起人物 / 把判断留给你)
bold 15px + 13px muted explanation. Keep real provenance, review state,
recovery and scope behavior.

### Extensions — `63:1997` (`workspace-extensions.*`, inbound/outbound tabs)

Title 扩展 + subtitle `连接常用工具，在熟悉的客户端使用工作区。`
Primary 连接服务 + secondary 接入客户端 (real setup flows preserved).
Divider. 当前连接 section 18px: empty state = muted bounded panel 12px with
18px title 还没有连接外部服务, 13px muted copy, primary button 添加连接.
Below: `资料仍可继续导入与核对` 13px muted + two secondary buttons
截图与文档 / 时间与安排. Connected states must come from verified capability
data; keep existing inbound/outbound tabs and states.

### Settings — `63:2075` (`settings-workspace.*`, `account-settings.*`)

Header: title 设置 + subtitle `管理账号、外观与工作偏好。`
Two-column: left section nav (个人资料 selected — muted fill 8px radius; 账号
与安全 / 外观与偏好 / 工作空间 / 连接与权限 / 更多设置), right detail column:
section title 22px, avatar 64px (12px radius), then hairline-separated rows:
label bold 15px + value 13px muted + right-aligned action (编辑 text link /
`编辑资料 →`), muted help line `头像保存在哪里？`. Keep real save/cancel/
readback, identity linking and destructive confirmations.

## Verification (each batch)

1. Render the real fixture app (`/Users/cubxxw/.local/share/figwright/artifacts/
   product-craft-20260926/runtime`, Web `http://127.0.0.1:3038`, login
   `cubxxw@talentsignal.local` / `cubxxw`) and screenshot the owned pages at
   1280x820 and one narrow viewport; compare against the module export.
2. Prove structure with DOM measurements (sidebar 236px, content max 1040px,
   type sizes, radii) — screenshots alone are not proof.
3. Run the focused existing tests for touched files plus `pnpm --filter
   @talent-signal/web typecheck`. No snapshot test that merely mirrors CSS.
4. Report changed files, verified states, and anything intentionally kept in
   the old visual language.
