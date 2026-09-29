# Personal settings: native device controls and browser account management

Status: Proposed; awaiting written-spec review. No product implementation yet.

## Outcome and scope

A person can configure this Mac even when the remote Web is unavailable, and
can intentionally open account management in their default browser. No embedded
account settings page or DOM/CSS compatibility probe can block native Settings.

The user selected native device settings plus browser-based account settings.
Multi-tenancy means existing account-bound data isolation; it does not authorize
team collaboration, invitations, roles UI, or multiple-workspace switching.
Preserve existing account/workspace identifiers and ownership; do not migrate,
merge, delete, or reassign data to simplify labels.

## Evidence and integration boundary

The installed Mac build 33 shows an unsupported settings surface. Its matching
implementation exists in the mac-screenshot-agent worktree, whereas the inspected
main checkout has an earlier settings implementation. Before implementation,
resolve the integration base and concurrent ownership; do not copy entire files
from another active worktree.

The existing surface probe checks a settings-root marker and computed visibility
of nested navigation. It does not compare release versions. The observed message
therefore does not prove an old server. The new design removes this dependency
rather than weakening its checks.

Relevant existing contracts:

- [Account and workspace access](../../operations/account-access.md)
- [macOS distribution](../../operations/macos-distribution.md)
- [Architecture](../../architecture.md)
- [Design system](../../design-system.md)

## Information architecture

The app menu Settings command and Command-comma open one native window titled
“此 Mac 设置”. The window preserves the main conversation and its drafts.
Use standard native form rows, restrained grouping, keyboard navigation and
system appearance. Do not create a sidebar full of account sections that open
blank intermediate panes.

| Destination | Owner | Behavior |
| --- | --- | --- |
| General and shortcuts | Mac | Existing supported launch, menu-bar and shortcut controls |
| Permissions | Mac/OS | Real permission status and intentional System Settings links |
| Connection and diagnostics | Mac | Existing service configuration under an advanced disclosure; no secret-bearing diagnostics |
| Software updates | Mac | Installed version always visible; network-dependent checks have local errors |
| Account and preferences | Web | Explicit “在浏览器中管理账号与偏好 ↗” link |

The account menu exposes “账号与偏好 ↗” and “此 Mac 设置…”. A browser-opening
label is visible before the click. Web settings identifies the currently signed-in
person and groups profile, security, preferences and existing personal connections.
Do not add team sections. Audit each existing workspace-labeled control before
renaming: retain needed personal controls, preserve any existing restricted
administration behavior, and do not weaken permission enforcement.

## Browser handoff and authentication

Use the currently configured trusted origin and a fixed allowlist of account
settings destinations. Reuse the existing settings route and authentication
flows; no new account backend or token transfer is required. Production uses
HTTPS; preserve the existing explicit loopback development exception.

The native Settings window opens without a network probe. A click asks the OS to
open the approved URL. Report local browser-launch failure inline with Retry.
Do not claim the page loaded or a setting saved merely because the OS accepted it.

Browser and app sessions are independent. An authenticated browser opens settings;
an unauthenticated browser signs in and returns to the validated settings target.
Preserve allowlisted section selection through login. Reject external or malformed
return destinations. Never copy WebView cookies or put tokens, email addresses,
or account identifiers in the handoff URL.

The browser page clearly identifies the account it will modify and provides the
existing sign-out/sign-in route. Explain at the handoff that the browser uses its
own signed-in account. Without a verified cross-session identity protocol, do not
claim automatic app/browser account matching. Such a protocol and automatic SSO
are out of scope. Sensitive changes retain existing reauthentication requirements.

On returning to the app, use the existing authenticated refresh mechanism for
relevant profile/preferences. Keep current drafts and selections. A failed refresh
never claims synchronization; responses from a prior account or origin are ignored.
Preferences stored only in a browser must be labeled as such, not advertised as
cross-device settings. Device settings remain owned by the device.

## Failure behavior

- Offline or unreachable server: native controls remain usable; account pages may
  show browser network errors, without replacing native Settings.
- Old server: open its ordinary supported settings route, without an embedded
  surface requirement. A genuinely unavailable route needs a clear Web recovery
  link; do not assert compatibility with every historical server release.
- Expired login: authenticate in the browser and return to the intended section.
- Account read failure: show a local retry state, never fixture or stale identity.
- Save failure: retain editable Web drafts; show success only after canonical readback.
- Update check failure: show installed version and check failure; do not say current.
- Endpoint change: preserve the established explicit change flow and discard stale
  results; never silently fall back to a different service.

## Architecture and migration

Keep main-workspace WKWebView and its governed native features. Remove only the
settings-specific embedded browser, probing, unsupported-version fallback and
settings-chrome integration that becomes unused. Retain shared helpers still used
by the main workspace. Use one native destination resolver and browser opener for
all account-settings links so origin validation and error handling stay consistent.

Continue server-side authorization on every account read and write. Browser
storage boundaries are not tenant authorization. Add two-account regression cases
for the settings paths touched by this work, without claiming a full-system
isolation audit. No team tables, membership invitations or workspace switcher.

Update canonical settings/distribution guidance when implementation lands; this
proposal does not represent shipped behavior or supersede those documents yet.

## Acceptance evidence

1. Launch the installed candidate build with networking disabled: Command-comma
   opens usable native settings and preserves an unsent conversation draft.
2. Point an isolated test configuration at the prior Web build: native settings
   has no compatibility overlay and account links open the ordinary Web route.
3. Test authenticated and unauthenticated browsers, section-preserving login,
   cancel, expired session and a browser signed in as a different synthetic user.
   Verify visible account identity and that only that authenticated account changes.
4. Test rejected external return URLs, browser-launch failure and retry.
5. Save a harmless synthetic profile change, reload its Web page and return to the
   app; verify readback and refresh without draft loss. Test failed save and refresh.
6. Verify two synthetic accounts cannot read or mutate each other's settings by
   changing identifiers. Retain existing sensitive-operation step-up coverage.
7. Verify Settings in light/dark mode, keyboard navigation and VoiceOver; capture
   real native and browser evidence, not just a successful build.
8. Run focused native routing/settings tests, Web auth/settings tests, relevant
   checks/builds and pnpm docs:check. Preserve evidence before packaging delivery.

## Delivery stages

Written-spec approval precedes a repository-grounded implementation plan. Then:
resolve checkout ownership; implement native/browser separation; verify login and
account boundaries; exercise failure matrix; update docs and deliver a verified
build. The implementation plan must explicitly identify the candidate binary and
Web revision used for acceptance. Installation/relaunch must preserve user drafts.

## Alternatives rejected

Keeping embedded settings with a looser DOM check preserves the failure class.
Rewriting all account security forms natively duplicates existing validated flows.
Introducing team management expands scope without a demonstrated user need.
