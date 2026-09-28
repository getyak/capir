# GET-51 avatar Settings entry: deployed-surface check

## Reproduction

The installed macOS client reports `0.1.0 (29)`, but its configured resident Web service is still built from `26a664bb`. In that service's avatar menu, `设置` is a Next client link to `/workspace/settings`; a second `连接与调试 ⌘,` link targets `talentsignal-desktop://settings`. The first stays in the main workbench WebView and shows a Web settings page. The second opens the native Settings scene. This reproduces the user's report without touching account data.

Merged GET-51 source at `a12d51bc` already composes the avatar menu from a single `DesktopSettingsLink`: a supported macOS host receives the native scheme and a browser receives a document link to the Web settings route. The running service has not received that source revision. A component-only or `⌘,` check would have missed this deployment mismatch.

## Release preparation

A clean detached Web release checkout for `a12d51bca9ba65011e0c6be49720c9c3b40c9c3c` was created under the resident host's normal releases directory, and `pnpm install --frozen-lockfile` completed. The current `26a664bb` release remains active. `web-local.sh build` failed closed while Infisical attempted to read its `/web` credentials from the macOS keyring over SSH (`exit status 36`), both with and without a TTY. No secret was copied, printed, or substituted; no service pointer was switched. The prepared checkout has no build receipt yet.

## Compatibility verification

The follow-up native host observes main-WebView URL changes and routes an exact, same-origin `/workspace/settings` section into the native Settings scene. A real WebKit test established that `history.pushState` updates `WKWebView.url` and creates a matching back item; the host uses that same-document back path without a timer or reload. When no safe back item exists, it reloads a known workspace URL and explicitly warns that unsaved input may not have survived.

An isolated Debug client was connected to a loopback-only synthetic workbench with an avatar link that uses `history.pushState` rather than document navigation. A draft field was edited before the click. The click opened the native `Talent Signal Settings` window with `连接与权限` selected. After closing it, the main WebView was back at `/workspace`, the synthetic draft value was unchanged, and the page reported its popstate recovery. Repeating the click reused the native Settings scene. The synthetic server and test clients were stopped afterward; the installed production client and resident Web process were not changed.

## Verification boundary

The active release must remain the reported old revision until an authorized build gets the normal Infisical environment and the installer passes its port ownership, authentication readiness, and rollback checks. After promotion, verify the active release receipt, a protected page with the existing account, and the actual macOS avatar-menu click. Separately verify the signed client's displayed build. Do not infer a live fix from the merged PR, a preview deployment, or the `⌘,` shortcut alone.
