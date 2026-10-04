# Settings coherence and version truth

## Outcome

The macOS Settings window has one navigation owner and one coherent content pane. Account and security controls remain real, editable and backend-owned, but no workspace header, bottom navigation, second settings navigation or generic Web page appears inside the native window. The Web settings page retains one navigation inside the Web workspace. Diagnostics is clearly a support destination, and users can inspect the actual version and freshness evidence for each component without being told that unrelated build numbers must match.

## Boundary

Preserve account authorization, existing mutation and recovery flows, WebKit cookie isolation, draft recovery, and the current signed-client update contract. Do not infer that an iOS app or browser extension is installed from a release manifest, or mark a component current merely because its request is healthy. Expose only bounded release metadata, not credentials, hosts, account content or private evidence. Keep the resident Web and backend release pointers unchanged until a prepared release has approval and authenticated readback.

## Evidence and unknowns

- The user's screenshots show an older native Settings rail rendering an older full Web workspace in its right pane. The current installed Mac client is build 29, while the configured resident Web checkout is revision `26a664bb`; merged GET-51 Web source is `a12d51bc`. The resident build is blocked by Infisical login-keyring access over SSH. This deployment mismatch explains the visible extra Web header, bottom navigation and old account tabs, but does not make the experience acceptable.
- Merged source already has one Web settings rail, an `embedded` account panel that hides its inner tabs, and CSS for the macOS Settings surface. The host does not currently prove that a remote Web release supports this surface before showing it.
- `SystemHealthResponse` proves request-path health but carries no release identity. Web builds write a revision/build-ID receipt; backend deployment injects a revision; macOS reads its bundle version and Sparkle offer; iOS reads a local bundle version; the browser extension has a manifest version. No existing account-bound source proves the version installed on another iPhone or in another browser.

## Design decision

Use the project's quiet neutral system and Apple's stable Settings-pane model. The left rail owns category navigation; the right side shows only the selected content and its direct edit/save/recovery controls. An incompatible resident Web release produces a native explanation and a direct, clearly labeled workspace handoff instead of embedding its full product shell. Account data remains backend-owned; the host does not duplicate account mutations or claim Web form state as native authority.

Create one calm **Versions & status** destination. Each row separates the observed version, its source and check time, and its update/compatibility status. A component is only labeled outdated when an authoritative latest version or minimum compatibility rule is available. Otherwise show `not verified` and a useful check action. iOS and extension installed versions on other devices remain unknown until those clients report them through an authorized, scoped mechanism. A shared product release label may help recognition, but never replaces each component's actual build identity.

## Milestones

1. Complete: the user's screenshots were reviewed as the failing old-resident surface; [two synthetic rendered directions](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-28-settings-coherence/README.md) compare native summary/handoff with guarded embedded account forms. Choose guarded forms because they preserve the one backend-owned writer, editing continuity and recovery. The explicit Web root marker and hidden-chrome checks are the supported-surface proof.
2. Complete for the implemented slice: the Mac host hides the Settings WebView until the root marker and effective chrome visibility pass a bounded, generation-guarded probe. A loopback old-Web surface displayed native recovery with no Web chrome. Help/Diagnostics is native and hands protected subpages to the main window. The authenticated current Web account page has one navigation and uses disclosure for optional login methods, sync explanation and other sessions. The current-Web Mac pane could not be rechecked after the native UI pipe closed; WebKit policy tests and browser CSS readback cover it, and this limit stays explicit.
3. Complete for the available sources: Web and backend expose validated release identities with source and time; Mac sends its installed bundle version/update state into the Web pane, and keeps local Mac Update offline. iOS and browser extension show their own installed versions; the extension responds to Chrome's update-available event without forcing a reload. Cross-device installed status stays unknown without client evidence. The version list and account page were inspected at full and narrow widths, in light and dark modes; the Mac old-Web gate was inspected in an isolated unsigned host build. The native UI pipe prevented a later current-Web Mac/Help capture, so this remains a separate limitation.
4. Active: final Web suite passed 1,466 tests with 1 skip; Web lint had 0 errors and 5 pre-existing warnings; production Web build, macOS and iOS builds, backend focused tests, extension package/test, documentation and architecture checks passed. Finish the final diff review, prepare a PR stacked on GET-51 avatar routing, and preserve the resident release unchanged. Promotion needs the normal Infisical build, rollback protection and protected-page readback; SSH keyring access currently blocks it.

## Completion evidence

The real macOS Settings window shows exactly one rail and no Web workspace chrome at first paint or after navigating account/security/diagnostics; old resident Web shows a native compatibility state. Account edits still save and read back through their existing owner. Web and Mac version rows show actual local/service identities with source, observed time and honest outdated/unknown states; iOS and extension show their local installed version without false cross-device inference. Deployed status remains separate from merged source and preview status.
