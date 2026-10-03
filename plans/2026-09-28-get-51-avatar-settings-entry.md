# GET-51 avatar Settings entry follow-up

## Outcome and boundary

Clicking **Settings** in the workspace avatar menu on macOS opens the single native Settings scene. The main workbench must not render a Web settings page. Web browsers keep the normal `/workspace/settings` destination. The fix must work when a signed Mac client temporarily connects to an older resident Web release, without exposing a new data or action authority.

No candidate content, account credentials, production data, or external effect is needed for verification. Preserve the current resident release until a prepared replacement passes checks; do not edit or remove its checkout.

## Evidence and unknowns

- The installed client's avatar menu currently shows both a Web `设置` link to `/workspace/settings` and a native `连接与调试 ⌘,` link. The latter opens a native Settings window; the former leaves the workbench on a Web settings page.
- The running macOS client reports version `0.1.0 (29)`. The resident Web release is still `26a664bb`, while merged GET-51 is `a12d51bc`. The old Web menu uses a Next client link for `/workspace/settings`. The merged Web menu has one `DesktopSettingsLink` and a document anchor fallback.
- A clean, detached `a12d51bc` Web release worktree exists on the resident host and dependencies are installed. Its production build cannot yet fetch `/web` secrets over the noninteractive SSH keyring session; it failed closed before building. The old release remains active.
- The native code intercepts document link navigations to settings, but observes client-side URL changes only in the Settings WebView. Whether main-WebView URL observation sees `history.pushState` and can restore the prior workbench state needs a real WebKit test.

## Approach

1. Add a narrow native compatibility path for same-origin main-WebView client navigation to an exact settings section. Prefer existing WebKit URL observation over a new privileged JavaScript bridge. Preserve the prior workspace route, focus, and unsent state where possible; never treat arbitrary URLs as a settings command.
2. Add a composition-level Web avatar-menu test that rejects duplicate Web/native Settings entries, and correct the stale account-access documentation. Keep the deployment mismatch as dated evaluation evidence.
3. Verify focused Web and macOS behavior, production builds, and a real isolated Mac surface where feasible. Prepare a reviewable PR. Recheck the resident Web release and signed Mac release separately before claiming that the installed experience changed.

## Progress

- Complete: reproduced the split avatar menu in the installed client and confirmed the native command works. The installed client is build 29; resident Web is revision `26a664bb`.
- Complete: added a Web avatar-menu composition test and a native compatibility path for legacy client-side settings links. WebKit tests verified URL observation and same-document back; an isolated real Mac click opened the native scene, selected the requested section, and preserved a synthetic unsent draft on return. Native unit tests, build and build-for-testing passed.
- Complete: corrected the canonical account-access claim and added a deployed-avatar verification step to the macOS operations guide. Dated runtime evidence lives in the evaluation packet.
- Pending: review and merge the follow-up PR, then install the signed client update before claiming the installed avatar entry is fixed. The prepared resident Web checkout cannot build over SSH until the owner restores Infisical keyring access; the active service remains on the prior release.

## Completion evidence

The Web avatar menu has one context-correct Settings entry; a same-origin client-side `/workspace/settings` transition in the Mac main WebView opens the native Settings scene and restores the main workspace; direct `⌘,` still reuses that scene; Web remains inside the workspace. The resident Web release is activated only after authorized promotion and authenticated readback. If keyring access or a release decision blocks activation, record the exact prepared revision and the user action required without claiming the live issue is fixed.
