# Contextual sidebar creation control

## Outcome and boundary

Implement the user's selected first sidebar concept: a quiet Recent
conversations heading with a trailing compose icon, replacing the orphan plus.
The refined image was shown before implementation. Keep existing conversation
dispatch, drafts, identity, history, account controls and footer behavior intact.
This is shared Web/macOS Web presentation; no native build is required.

## Approach

- Use the existing localized recent-section label and Phosphor NotePencil.
- Keep a 44px action target with a restrained 32px hover surface, clear focus,
  secondary heading typography and stable row alignment.
- Retain the platform tooltip. Advertise Command-N only when the existing
  desktop host is present; ordinary Web must not claim a browser shortcut.
- Verify default/narrow/collapsed layouts, locales, keyboard, reduced motion,
  dark/forced-color states and the unchanged new-conversation action.

## Milestones

1. Complete: localized heading, NotePencil, native-only hint and quiet 44/32px
   action; unchanged dispatch/routing. Focused tests pass 38/38.
2. Complete: actual-component visual QA and independent review. A P2 negative
   margin clipping the target was fixed and rechecked; no actionable findings
   remain in the changed heading and action.
   [PR #430](https://github.com/getyak/capir/pull/430) current-head checks passed
   and merged at `518fea00`. A later screenshot
   reinspection found fixed heading line-height clipping 200% text before any
   activation. The one-line unitless fix passed actual 150/200% rendering and
   independent re-review. [PR #431](https://github.com/getyak/capir/pull/431)
   merged at `998caed1`; both PR heads and that main revision's CI/security
   passed. Do not claim full
   sidebar 200% acceptance: existing brand/row clipping is outside this change.
3. Pending: coordinated activation and live behavior acceptance. At the
   2026-10-25 remote-submission checkpoint, live remained `fbf7ef07` / build
   `igNwY0Yjh1c9Bd8xa6mnX`. Its inspected clean source/receipt still contains
   the old Plus and no heading; neither feature commit is an ancestor. Preserve
   that live work rather than activating an older baseline over it.

## Confirmed publication ownership

The human-authorized login-policy chat has confirmed sole ownership of the
coordinated Web/API/native/CLI build and activation. It reports incorporating
`main` at `998caed1` and merging live `fbf7ef07`, preserving the earlier
localization and draft-recovery work. That is the owner's reported preparation,
not verified activation or CI evidence for the eventual combined revision.

This task keeps the Web activation window free and starts no production build
or service switch. After the owner returns the exact final revision/build ID,
verify inclusion of `4637b496` and `b8f7ab11`, then exercise the real sidebar and
new-conversation entry in an isolated test workspace. Publication and live
acceptance remain incomplete until those receipts and behaviors are checked.

## Environment and ownership

Implementation began from remote main `a0895d45` in an isolated managed
worktree. The earlier footer worktree has unrelated completed-plan changes and
is preserved.
Initial resource sample: 127 Node/npm processes, 19.87 GiB swap and 32.36 GiB
disk free; the initial audit reported 31 GiB free. No overlapping heavy build
was started.
Read-only dependency trees were reused from the retained e70 release after exact
lock/manifest/shared-source comparison. Test caches went to the registered artifact
`/private/tmp/ai-test-sidebar-contextual-compose-20261025.BkNjie`, not that release.
Both dependency symlinks were unlinked without removing the release targets.
The registered artifact was removed after formal evidence and reproduction
sources were saved; its measured directory footprint was 3976 KiB (0.00379 GiB),
not a measured net physical-disk gain.

The login-policy chat was notified under the existing human
release-coordination authorization and has acknowledged publication ownership.
Do not switch shared services or occupy its Mac window without coordination.
Evidence and selected-image mapping live under
`/Users/cubxxw/ops/runs/sidebar-contextual-compose-20261025/`.

## Verification

See `design-qa.md` for source/render comparison, intentional token constraints,
and state coverage. Real-component fixture used actual navigation, browse
provider/context, rows and footer with synthetic directory/routing adapters.
Verified 200/248/420px widths, five locales, dark/light, keyboard, scaled heading
text, reduced motion, forced colors, empty/loading/retry and collapsed states.
The 200% text claim covers the corrected heading, not the whole sidebar. This
is not live-service or native-app acceptance. The fixture server belongs only to this
task: PID 32576, started 2026-10-25 16:16:21, port 8769; it exited after SIGTERM.

That first fixture server exited. Heading-fix verification uses a second owned
server PID 41761, started 2026-10-25 16:41:24 on the same port; it also exited
after SIGTERM. Both owned tabs closed and their media/device overrides cleared.
Keep this active worktree/branches for pending publication and live acceptance.
No test workspace was provisioned for an unchanged live build; no live behavior
acceptance is claimed. The login-policy chat has the final source revisions,
the inspected live `fbf7ef07` receipt and a request to return the serial
publication result.

Changed-file ESLint and direct documentation/wiki/architecture checks pass.
The pnpm wrapper attempted dependency synchronization and aborted before
installation (no TTY); its equivalent scripts were run directly to preserve
the borrowed rollback dependencies. No install or heavy build was performed.
