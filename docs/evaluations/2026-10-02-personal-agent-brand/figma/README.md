# Figma brand migration verification

The existing Figma document is now **capri · macOS 工作区视觉方案**.

Target file: https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f

## Verified changes

| Surface | Before | After |
| --- | --- | --- |
| Former full-brand text nodes | 162 | 5 existing domain-address displays retained |
| Avatar initials `TS` | 19 | 0; replaced by `c` |
| Former full-brand layer/component names | 142 | 0 |
| Former `TS` layer/component/instance prefixes | 125 | 0 |
| Former `TS` paint style names | 10 | 0 |
| Former `TS` variable collection names | 6 | 0 |
| Document title | Talent Signal · macOS 工作区视觉方案 | capri · macOS 工作区视觉方案 |

Four pages and 6,513 text nodes were read before and after. Precisely 157 brand text nodes, 19 avatar text nodes, and 267 design names were updated. One historical design note was adjusted to describe preserving shared variable identity without using the obsolete `TS` brand name.

No headhunter, recruiting, or candidate wording was found in this file's text-node inventory. Page names already describe Guide/System, Desktop/Web, Mobile, and Explore, so their names remain applicable.

## Identity and compatibility

All 181 inventoried brand/avatar/address nodes still exist under their original node IDs; fonts, variable bindings, and text-style IDs match the before snapshot. Local variables match the original snapshot exactly, including values, aliases, IDs, keys, modes, and code syntax. Variable collection and paint style snapshots match after excluding their intentionally changed names. Components and instances were renamed in place; no instance was detached, no node was deleted, and no layout/prototype properties were written. Ordinary text reflow may reflect the shorter display name.

Five address nodes still display `talentsignal.app`: the browser-chrome source component and four mobile instances. This is an existing service address, not a new brand claim. Existing `--ts-*` code syntax and stable keys likewise remain for compatibility. The logo's geometry remains unchanged.

## Visual evidence

The Guide, desktop header, and mobile entry were exported before/after and inspected. Their updated labels are readable, and the unchanged visual hierarchy remains intact.

- [Guide after](after/32-803.png)
- [Desktop header after](after/392-2135.png)
- [Mobile entry after](after/574-4932.png)
- `inventory-before.json`: targeted full-brand nodes and the original style/variable snapshots.
- `ts-layer-names-before.json`: additional brand-prefix design names.
- `verification-after.json`: counts, exact target readback, stable identity checks, and final global snapshots.

Repository checks: `pnpm docs:check` and `git diff --check` passed after these artifacts were added.

## Access and remaining scope

The official Figma MCP reports its Starter plan tool limit. The already-running local Figwright plugin provided read/write operations. Its missing file-title and collection-rename capabilities were completed through Figma's ordinary UI, then verified through plugin readback. A transient connection failure was resolved by activating the existing design editor instead of the prototype tab.

This completes the brand migration in the named Figma document. It does not claim a production deployment, domain migration, new app identifier, publication of a design library, or a new Figma website redesign. Those external states are outside this document's brand-migration scope.
