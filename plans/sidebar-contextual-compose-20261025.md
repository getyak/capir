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
   margin clipping the target was fixed and rechecked; no findings remain.
   PR430 current-head checks passed and merged at 518fea00. A later screenshot
   reinspection found fixed heading line-height clipping 200% text before any
   activation. The one-line unitless fix passed actual 150/200% rendering and
   independent re-review; its follow-up PR/CI is pending. Do not claim full
   sidebar 200% acceptance: existing brand/row clipping is outside this change.
3. Pending: coordinate the sole shared-service deployment owner, verify final
   live revision/behavior and complete owned-resource cleanup.

## Environment and ownership

Base is latest remote main a0895d45 in an isolated managed worktree. The earlier
footer worktree has unrelated completed-plan changes and is preserved.
Resource sample: 127 Node/npm processes, 19.87GiB swap and 32.36GiB disk free;
the latest audit reports31GiB free. No overlapping heavy build is started.
Read-only dependency trees are reused from the retained e70 release after exact
lock/manifest/shared-source comparison. Test caches go to the registered artifact
`/private/tmp/ai-test-sidebar-contextual-compose-20261025.BkNjie`, not that release.

The login-policy chat remains active on Web cookie/revocation repair. It has
been notified under the existing human release-coordination authorization.
Do not switch shared services or occupy its Mac window without coordination.
Evidence and selected-image mapping live under
`/Users/cubxxw/ops/runs/sidebar-contextual-compose-20261025/`.

## Verification

See `design-qa.md` for source/render comparison, intentional token constraints,
and state coverage. Real-component fixture used actual navigation, browse
provider/context, rows and footer with synthetic directory/routing adapters.
Verified 200/248/420px, five locales, dark/light, keyboard, 200% text, reduced
motion, forced colors, empty/loading/retry and collapsed states. This is not
live-service or native-app acceptance. The fixture server belongs only to this
task: PID32576, started 2026-10-25 16:16:21, port8769; stop before cleanup.

That first fixture server exited. Heading-fix verification uses a second owned
server PID41761, started 2026-10-25 16:41:24 on the same port; stop it too.

Changed-file ESLint and direct documentation/wiki/architecture checks pass.
The pnpm wrapper attempted dependency synchronization and aborted before
installation (no TTY); its equivalent scripts were run directly to preserve
the borrowed rollback dependencies. No install or heavy build was performed.
