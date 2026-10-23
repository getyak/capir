# GET-205 — Settings content first

## Outcome and boundary

Keep all Settings destinations discoverable without a multi-row narrow navigation
block. The selected category, URL, keyboard focus and unsaved editors stay coherent.
Account settings and native device settings retain their existing ownership.

## Approach

- Start from the refreshed main baseline in the isolated GET-205 checkout.
- Keep one navigation inventory: persistent desktop rail and a disclosure below
  900px, showing the current category, search and full translated labels. Preserve
  real Next links, validated server section routing and the conditional Lab entry.
- Retain visited editors with React Activity inside the authenticated Settings
  scope. Hidden effects suspend; drafts stay in memory and never cross account,
  workspace or authenticated-session boundaries. Unavailable account reads show
  recovery controls rather than presenting cached permissions as current.
- Freeze the reviewed revision for dirty or uncertain mutations. Preserve existing
  retry operation identity, authorization and native handoff rules.
- Revert unsaved theme previews while away, restoring the preview on return.
  Keep explicit save/cancel and browser-storage failure behavior.

## Alternatives

A horizontal scrolling track would conceal destinations and long labels. A native
select would obscure search and duplicate the destination inventory. The chosen
labelled disclosure keeps the full names, search and selected check together.

## Verification and delivery

Host takeover on 2026-10-20 replaces the previous restricted Symphony execution.
Symphony remains paused; delivery uses the host Git, GitHub and Linear tools.

- 31 shell/draft tests passed, including navigation, focus, long labels, IME,
  identity boundaries, theme preview and draft retention. A missing App Router
  test seam for the new unavailable-state reload control was corrected.
- 13 existing account/language/editor tests passed. Changed-file ESLint and
  git diff whitespace validation passed.
- Documentation, Wiki and architecture boundary/diagram checks passed.
- Independent reviewer found no confirmed P0/P1/P2 in the implementation.
- PR391 merged2bb1ee62 and the clean resident release was built and activated.
  Actual1280/390/320px light/dark/forced-color comparisons have no overflow or
  JavaScript errors. Narrow content headings move from503.89px to269.5–292px.
  Actual Next navigation and browser Back retain unsaved appearance drafts;
  previews revert away and restore on return. Forward, refresh, full category
  discovery, search keyboard navigation and content focus passed before resize.
- Real resizing exposed a missing case: CSS hides a focused desktop rail before
  the media event, leaving body active. Retain the last navigation focus until
  the user chooses another region, reopen the narrow chooser and restore it.
  The regression failed before the fix;47 focused tests pass afterwards and
  independent review found no confirmed P0/P1/P2. Actual postdeploy resize
  acceptance remains pending for the followup patch.
- Pending: PR at refreshed main, current-head CI and review disposition, normal
  protected merge, then clean resident Web deployment and live revision readback.
- Keep GET-205 open until required actual-surface acceptance is complete.

Reference checks used the installed Next16.4.2 Link guide and router state-key
implementation, [React Activity](https://react.dev/reference/react/Activity), and
[Linear preferences](https://linear.app/docs/account-preferences).
