# GET-235 account menu

## Outcome and boundary

Make the lower-left avatar account menu compact and legible on Web and the
installed macOS hosted workspace. Preserve all account actions, honest usage
states, external-browser and native-settings boundaries, navigation and drafts.
Authentication, service connectivity, chat media and other issues are out of scope.

## Evidence

- Baseline: `fa01bb1c5555c1ad41fcb3e9626d1317388da3eb`, freshly fetched from
  `getyak/capir` main. Isolated branch: `codex/get-235-work`.
- Native Linear MCP confirms GET-235 is In Progress in GET, with no relations
  or attachments beyond the inline screenshot. The original image is private
  local diagnostic material; it must not enter the public repository or PR.
- `workspace-shell.module.css` sets account popovers to 82% surface. A later
  macOS selector overrides this to 62% and disables backdrop filtering. The
  screenshot's underlying conversation text is therefore expected to show.
- The existing Radix portal owns positioning and dismissal. Existing tests
  cover usage retry, theme lifetime, locale and avatar-modal focus.
- Initial resources: 58.32 GiB free, 10.37 GiB swap, 121 Node/npm processes.
  Warnings require serial builds and reuse of existing browsers/services.
  Existing native app, browser and production servers are shared, not task-owned.

## Approach

Use the existing neutral surface with an opaque menu only; leave other native
material surfaces alone. Reduce redundant framing and boundary-copy layout,
retain readable text and input-appropriate targets. Keep Radix lifecycle and
all authentication handlers unchanged. Compare rendered alternatives before
finalizing density.

## Milestones

1. Complete: reproduce baseline and save synthetic before evidence; establish a
   behavioral regression for opacity and menu bounds.
2. Complete: implement menu-only changes and verify themes, locales, long identity,
   narrow/zoomed layouts, keyboard, disclosure and usage error/retry.
3. Active: independent sub-agent review; address confirmed P0/P1; PR and exact-head CI.
4. Merge normally, deploy affected resident Web from clean source, verify live
   revision and behavior and installed macOS surface; determine native release
   applicability from the actual diff.
5. Read back Linear Done only after acceptance, save separate delivery receipts,
   record Symphony event using the existing claim and actual turn, and reclaim
   only task-owned rebuildable artifacts without active references.

## Evidence storage

Private task diagnostics and screenshots: `.symphony/evidence/` (ignored).
Permanent sanitized delivery record: this plan and its final verification links.
CI, deployment, changed native acceptance and completion remain pending.

## Verification progress

- Real Chromium reproduced the original native selector at alpha `0.62`,
  width `316px`, height `545px`; the opaque compact direction renders at
  `288px` by `449.6px` with unchanged `12px` metadata. Both opaque spacious
  and compact directions were rendered; compact keeps the same reading size
  and reserves 44px targets for narrow/coarse input.
- The fixture matrix passed 28 records: five existing locales, both themes,
  browser/native CSS modes, long identity at 900/657/390/320px, 200% English
  error/retry, loading, expanded usage/help and keyboard/outside dismissal.
  It asserts opaque backgrounds, viewport bounds, no horizontal overflow and
  screenshot pixel dimensions. Theme changes followed system media with no
  saved override. These are browser observations, not native app proof.
- The 200% error case initially failed with scrollWidth `343 > 286`; error
  status and retry now wrap together without hiding either. Preserve the
  failed capture separately from the corrected matrix.
- Initial full Web suite: 355 files and 3,125 tests passed; one i18n extraction
  test failed on newly added development fixture literals. New fixture labels
  were corrected and the focused i18n/account suite passes 25/25. A fresh full
  suite is running; the initial failure is not reported as green.
- Independent sub-agent source review found no P0/P1. A StrictMode lifecycle
  finding in the expanded dev fixture was corrected with resource-free static
  presentation stores and re-reviewed closed.
  A second review accepted the usage wrapping delta. Private review receipts
  are stored separately from runtime observations.
- Installed baseline app is `/Users/cubxxw/Applications/Talent Signal.app`,
  version `0.2.36 (202)`, PID `25389`, window `493`. The local verified owner
  matches the default test account. Actual foreground, pointer and settled
  screen captures reproduce conversation text through the old account menu;
  capture data remains private. A newer native update offer is shown truthfully
  and has not been installed as part of this Web change.

- Final source review has zero confirmed P0/P1; reviewed diff SHA-256: `23842e7f4f29fdbf4d6be7f4d84e1642558dd7541d3caf84cb2861b15bd5c052`.
