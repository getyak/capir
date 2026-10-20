# macOS download and distribution

Talent Signal is a relationship workspace for client work, partnerships,
collaboration, and recruiting. The downloadable client is `apps/macos`.
`apps/macos-hybrid` remains a separate experimental capability shell.

## Install on another Mac

1. Open [Talent Signal releases](https://github.com/getyak/talent-signal/releases)
   and select the newest `vX.Y.Z` release containing a macOS Universal `.dmg`
   (Apple silicon and Intel, macOS 14 or later). A release may contain only
   the platform that changed. Preview releases are explicitly labeled.
2. Compare the downloaded file with its `SHA256SUMS.txt` using
   `shasum -a 256 <downloaded-file>`. Drag **Talent Signal** to Applications.
3. Open the app and choose **连接你的工作区**, then enter the HTTPS workspace
   origin supplied by its owner, or paste a full `/workspace/...` link. The app
   shows the normalized origin. The optional **先体验一个示例** is a fictional,
   prewritten local example: inspect each result's exact words and explicitly
   correct an interpretation before connecting. Corrections remain in that
   example only; they neither contact a model nor create people, messages or
   schedules. Returning to connection keeps an unfinished address draft.
   Choose **Sign in in your browser**, authenticate or confirm your own account in the system browser, and return to the Mac workspace. The Mac window never asks for your username or password.

An already configured workspace opens normally. First-run motion never delays
the connect/sample controls, and Reduce Motion displays the invitation directly.

For an owner-operated private workspace, authorize the second Mac in the same
Tailscale network and connect Tailscale before opening the app. The package
contains no private server address, authentication state, or embedded account.
It does not deploy a server or make an existing private server publicly accessible.
The network button changes the workspace address. Loading failures remain
visible with retry; the app never bypasses TLS validation.

Preview packages are ad-hoc signed and **not Apple-notarized**. Gatekeeper may
block downloaded previews. Do not disable Gatekeeper or strip quarantine.
Ordinary external distribution requires a signed, notarized release. For a
preview you have independently verified and trust, Apple provides a per-app
**System Settings → Privacy & Security → Open Anyway** decision after the first
blocked launch. The device owner must make that decision themselves; the app
never changes security settings. See [Apple’s opening guidance](https://support.apple.com/102445).
Building from the tagged source is another option for preview evaluation.

## Update and rollback

Signed builds use Sparkle 2.10.0. Launch and hourly scheduled checks show a compact **Update and Restart** button
beside the account avatar only after a verified, applicable update is found. One
click authorizes that specific offer: download, verification, installation and
relaunch continue without a second application confirmation. Progress replaces
the button; failure keeps the current app usable and offers another check.
Checking alone never authorizes installation. The application menu and native
settings also offer checks and installation when the Web server is unavailable
or still runs an older Web version. Background download/installation is disabled.
The expanded workspace footer keeps the update label and Connect apps control
visible at fixed positions. Download and installation are non-actionable,
keyboard-focusable status controls; the collapsed rail retains their short
progress label, with details available on hover or focus.
Settings show the installed version, check status and last verified feed check.
A failed network or signature check is never reported as up to date. **Settings → Updates** controls
scheduled checks and opt-in preview releases. Production feeds contain only signed,
notarized packages, including packages in the optional preview channel.

Older pre-Sparkle builds need one manual installation. Unsigned preview builds show
that signed updating is not configured and retain the release-download link. Keep
the previous package for operator rollback; do not lower the feed's build number.
Hosted workspace changes remain independent of the desktop binary.

When a settings change spans the resident Web and macOS client, compare the
active Web release revision with the approved source and read the installed
client build before declaring the experience updated. Device settings are owned
by the macOS client alone: `⌘,` raises one independent **此 Mac 设置** window that
preserves the main workspace and stays usable while the Web server is unreachable
or was never configured. In the running client the avatar menu's **此 Mac 设置…**
entry must raise that same window, while its **账号与偏好 ↗** entry must open the
account pages in the default browser instead of raising a native window. A
shortcut-only check cannot verify the avatar path. The browser carries its own
session, so the handoff names a destination only and never a credential, cookie,
account identifier or email. If the resident Web is older, keep its release
active until a clean replacement build and authenticated readback pass.

## Connection and diagnostics

The optional menu-bar capture entry uses the same configured Web workspace login. On first use it discloses the current workspace and available image processors before an intentional selection can upload. The device-owned capture permission is separate from that login. The ordinary path is configurable shortcut, region selection and release; the Agent then processes an image-only Session message. Settings → This device controls the menu-bar icon, shortcut, default preview choice and optional top status hint. Hiding the icon leaves the main window and Settings reachable. An unadmitted screenshot is encrypted for bounded device recovery, while an admitted image follows the workspace Session/source lifecycle.

**Settings (⌘ ,) → Connection**, the Go menu and the Web account menu open
the same native controls. Enter an HTTPS origin or a `/workspace/...` link without
credentials, query parameters or fragments. Test the draft before saving; a stale
probe never applies to a changed address. A successful HEAD request to `/login`
proves HTTP reachability only, not login or API/database health.

Development controls allow HTTP only for `localhost`, `127.0.0.1` and `::1`, and
optionally enable WebKit inspection. There is no certificate bypass or editable
update-feed URL. Workspace API/provider configuration remains server-owned; the
client does not offer a misleading direct API override for server-rendered pages.
Cookie stores are partitioned by canonical scheme/host/port, including local ports.
The first upgrade from legacy default WebKit storage therefore requires a fresh
login. Switching services asks the user to finish input/uploads before reloading.
Copyable diagnostics omit origins, accounts, cookies and conversation content.

## Workspace appearance verification

The native **View → 工作区外观** menu offers **跟随系统**, **浅色** and **深色**.
It updates only the embedded origin's existing `talent-signal-theme` local
preference. The Web avatar theme action uses the same store. A separate browser
has its own preference and session. System removes the stored override and
clears `NSWindow.appearance`; subsequent OS appearance changes must repaint the
Web content as well as the material. Appearance save failures stay visible.
The display bridge accepts only a fixed enum from the configured main frame and
current origin. It grants no account, navigation or external-action authority.

For acceptance, obtain a storage-guard artifact directory before native builds.
Run the affected `WorkspaceAppearanceBridgeTests`, `WorkspaceMaterialSurfaceTests`
and `WorkspaceSettingsTests` with the same derived-data directory. The script
contract suite is `node --test scripts/macos/workspace-appearance.test.mjs`;
it also runs in `scripts/macos/check.sh`. The regression must include the real
SwiftUI host for confirmed preference changes: a material view tested alone
does not prove that a changed preference reaches its representable. Read back
both the surface and window overrides, WebKit media query and retained draft
after dark → light → System, without replacing the live WebView. Script checks,
menu checkmarks and compilation do not establish actual window behavior.

Preserve uncropped before/after captures using identical authorized synthetic
workspace content at 1280×820 and 900×720. Record actual window/image dimensions,
app build, source revision, Web revision and each setting. On the real window:

1. Select light, dark, then System, including reset when System currently
   resolves to the same color. Change macOS appearance again with the app open.
   Repeat after reload and reopening the workspace; retain an unsent draft.
2. Compare active and inactive windows at 90%, 100% and 150% content zoom.
   Verify readable sidebar controls and an opaque reading canvas. Repeat with
   Reduce Transparency and Increase Contrast, separately and together.
3. Drag only the native title bar; select text and operate Web controls beneath
   it. Exercise close/reopen, minimize/restore and zoom/full screen using the
   standard window buttons. Confirm no content is behind those buttons.
4. Exercise `⌘N`, `⌘[`, `⌘]`, `⌘R`, `⌘,`, native menu selection, Web keyboard
   traversal and back/forward gestures. Confirm one settings window and one
   navigation owner. Check preference persistence and a truthful save failure.

Record unavailable cases as blocked. Do not use fabricated theme metadata,
cropped images or an older installed build as proof of the changed client.
Restore any OS accessibility/appearance settings changed by the test.

## Automated publication

`.github/workflows/release-macos.yml` runs after successful trusted `main` CI.
It compares macOS source, approved icon, packaging, and release policy with the
last published Mac asset and skips unrelated changes. It builds and tests the
native app at the exact verified revision and uses the same `vX.Y.Z` product
tag as iOS when both are built from that commit. The user-visible Mac version
(`CFBundleShortVersionString`) matches the tag; its independent, increasing
`CFBundleVersion` identifies the native build for Sparkle. The workflow adds
Universal DMG/ZIP and a SHA-256 manifest to that one GitHub Release, or creates
it for a Mac-only revision. It never silently replaces published bytes.
Existing `macos-<run>-<attempt>` releases remain available as history and as
the migration baseline. Previews never become GitHub's general latest release.
The rationale and cross-platform boundary are in the
[shared release identity decision](../decisions/2026-09-29-shared-product-release-identity.md).

Default mode is `preview`. Set repository variable `MACOS_RELEASE_MODE=signed`
only after provisioning Developer ID signing and notarization. Signed mode
fails closed on missing credentials, signing, notarization, staple validation,
or Gatekeeper assessment. It never falls back to a preview silently.
Manual dispatch accepts only the current default branch and requires successful
push CI for that exact revision.

Publication also requires that the packaged revision still be the current
`main` revision. When landing consecutive changes during a signed Mac release, wait
for the signed downloads and latest appcast entry to be published and read back
before advancing `main`. If `main` moves during packaging, publication fails
closed and a later successful CI run evaluates the newer revision. Keep that
guard intact; do not retag stale source or replace published package bytes.

## Signing configuration

Infisical remains the canonical secret store. Configure a separate GitHub OIDC
identity restricted to this repository's `macos-release` environment, audience
`infisical://talent-signal/macos-release`, and `staging:/release` read scope.
The configured identity and exact claims are recorded under `githubMacosOidc` in
`config/infisical-secrets.json`; `INFISICAL_MACOS_IDENTITY_ID` is a repository
variable. The GitHub `macos-release` environment admits only `main`. Identity
base access is `no-access`; its additional privilege can only describe/read
the eight `macosRelease` names in `staging:/release`. OIDC also binds the immutable
repository/owner IDs, `refs/heads/main`, and the exact release workflow path;
its access token lasts 900 seconds. Configuration readback does not prove a
successful GitHub OIDC exchange.

Before requesting new credentials, resolve the existing release contract. A
missing `MACOS_*` name does not prove the underlying credential is absent.
The same folder may already contain `APP_STORE_CONNECT_API_KEY_CONTENT`,
`APP_STORE_CONNECT_API_KEY_ID`, and `APP_STORE_CONNECT_ISSUER_ID`. Validate those
credentials with a read-only `notarytool history` request before provisioning
new ones or binding them to the macOS names below. Keep any transient key file
mode `0600` and remove it immediately; never print its value. Authentication
success proves access, not notarization of a release.

Check configuration readiness against the injected names without printing
values:

```sh
./scripts/infisical/run.sh staging /release -- node scripts/macos/release-prerequisites.mjs
```

The read-only diagnostic prints fixed credential names and statuses, reports a
complete `APP_STORE_CONNECT_*` triplet as a recoverable notarization alias source
only when the `MACOS_NOTARY_*` names are absent, and exits nonzero until every
`MACOS_*` name below is present with a `Developer ID Application:` identity and a
canonical 32-byte Sparkle public key. Configuration readiness is not proof of
signing, notarization, or update-feed publication; recoverable aliases alone
never count as ready.

Check the certificate type separately: an encrypted Fastlane Match distribution
certificate or an installed Apple Distribution identity is not a Developer ID
Application identity. Inspect the local signing identities and the existing
certificate inventory before asking the owner to locate or create another key.

The scoped release environment needs:

- `MACOS_CERTIFICATE_P12_BASE64`: Developer ID Application certificate with its private key;
- `MACOS_CERTIFICATE_PASSWORD`: export password;
- `MACOS_SIGNING_IDENTITY`: exact `Developer ID Application: ...` identity;
- `MACOS_SPARKLE_PUBLIC_KEY`: base64 Ed25519 public key (32 decoded bytes);
- `MACOS_SPARKLE_PRIVATE_KEY`: corresponding Sparkle Ed25519 seed, used via stdin only;
- `MACOS_NOTARY_KEY_ID`, `MACOS_NOTARY_ISSUER_ID`, `MACOS_NOTARY_PRIVATE_KEY`:
  App Store Connect team API key authorized for notarization.

The production Sparkle key is stored in those two Infisical names. Its local
recovery copy is the login Keychain item for upstream `generate_keys` account
`getyak.talent-signal.macos.production`. Recover the existing key before creating
one: replacing it changes the update trust anchor of installed clients.

Generate the Sparkle key once using upstream `generate_keys`, retain the private
key in Infisical, and use the corresponding public key in every signed app. Do not
use a rehearsal key. Set optional repository variable `MACOS_UPDATE_CHANNEL` to
`preview` for signed prereleases; it defaults to `stable`. Each new workflow run
has a monotonically increasing build number; retries must not republish different
bytes with an already published build number.

After immutable downloads are published, `publish-appcast.sh` verifies the previous
feed, generates and signs the new feed with pinned upstream tools, validates its
archive URLs/channel/build, and publishes `appcast.xml` on the dedicated
`macos-updates` GitHub release. That release is never GitHub's general latest.
It preserves prior stable entries when adding a preview. Publication ends with a
fresh download and byte comparison. GitHub asset replacement can have a brief
unavailable interval; clients keep their installed app and retry later.

The runner imports credentials into an ephemeral keychain and removes it after
success or failure. Never commit credentials or publish signing inputs with
release artifacts. Apple Development and Apple Distribution identities are not
substitutes for Developer ID Application signing.

## Local verification

Run `dev-storage-guard audit`, then obtain a task-owned directory with
`dev-storage-guard new-artifact macos-distribution`. Pass that path explicitly:

```sh
MACOS_VERSION=<product-tag-version> MACOS_BUILD_NUMBER=<next-native-build> \
  MACOS_OUTPUT_DIR=/absolute/task-artifact scripts/macos/package.sh
```

The package script verifies both architectures, icon presence, absence of a
bundled private origin, and bundle signature. Preserve requested deliverables
before removing task build products through the storage guard. Native unit tests
run through `scripts/macos/check.sh`; no iOS simulator is needed.

The installer now builds a writable scratch image, mounts it under its explicit
output directory, and generates its paper background and Finder layout before
converting to the immutable compressed image. The build-only Swift package in
`scripts/macos/installer/` pins DSStore 1.0.0 and its resolved revision; it never
enters the installed app. Its Carbon Alias is made on the mounted deliverable
volume, so a staging-folder alias cannot substitute for real Finder acceptance.
Layout failure detaches only that scratch mount and retains failed build inputs
in the task artifact for diagnosis. Inspect the final image in Finder as well as
the generated metadata; a successful tool exit does not prove visual placement.

When a signed client is already running, local native tests must use a separate
test application identity; the production login registry correctly refuses a
second owner. For an isolated test build, pass a quoted build-setting override,
for example `'PRODUCT_BUNDLE_IDENTIFIER=com.getyak.acceptance.get48.$(TARGET_NAME)'`,
to `xcodebuild`, together with task-owned DerivedData. The per-target suffix keeps
app and test bundles distinct. Preserve the signed client's registry and running
session; do not terminate it to make a shared-store test green. This isolated
build is test evidence, not a replacement for the published signed app's release
and first-launch acceptance.

`CFFIXED_USER_HOME` alone is not a preferences boundary on macOS: the preferences
daemon can still use the real user's app domain. Published-app acceptance instead
runs on the existing disposable GitHub-hosted Mac. PR CI runs the bounded native
keyboard/hidden-input regressions, then a separate real Finder drag from an ad-hoc
compiled PR installer fixture. The release job downloads the published DMG and ZIP,
compares both verified downloads, and drags the actual mounted app icon onto its
actual Applications alias on the empty hosted Mac. It requires all bundle files
and symlinks to match, verifies the installed signature/notarization and ZIP
identity, then launches that exact installed app for the original first-run tests.
One real drag test and three first-run tests, with no failures or skips, must pass before the update feed
is promoted. `first-run-acceptance.sh` refuses local/self-hosted execution before
changing settings, refuses a preconfigured workspace, temporarily enables native
Keyboard Navigation on that disposable host and restores its prior setting. It
strips release/provider credentials before XCTest and retains the result bundle
and screenshots as bounded Actions evidence. It never resets a product domain or
re-signs the published app to manufacture an isolated identity.

`installer-drag-acceptance.sh` refuses local/self-hosted runs, a configured profile,
an existing Applications destination, and inputs outside runner temp. It never
removes an installed app. Its native XCTest uses Apple's
[`click(forDuration:thenDragTo:)`](https://developer.apple.com/documentation/xcuiautomation/xcuielement)
with real Finder elements and retains AX text, screenshots and installation
identity. Failed or unavailable dragging stays a failed gate: copying with a shell
or a keyboard command cannot substitute for this interaction. Cleanup detaches
only the helper's own mount, including on failure.
Finder's application accessibility root can have an empty frame despite visible,
hittable installer windows and icons. Capture the actual screen for its UI test
evidence; an application-root screenshot failure must not be mistaken for a failed
drag or repaired by weakening the drag/installation assertions.

For conditional first-run pages, request keyboard focus from the destination
view's lifecycle after its controls mount, with a current-page guard. An outgoing
button's focus assignment can leave focus on the window and swallow the next
Space. Keep the real Tab/Space regression; pointer clicks cannot prove this path.
Export the XCTest summary even after a failed invocation, preserve its nonzero
status, and reject missing, malformed, failed or skipped acceptance results.

Sources: [Apple Developer ID](https://developer.apple.com/developer-id/),
[notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow),
[GitHub workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

## Isolated update rehearsal

Use `scripts/macos/sparkle-tools.sh` with a task-owned `SPARKLE_TOOLS_DIR` to fetch
and checksum the pinned upstream distribution. With a fresh `MACOS_OUTPUT_DIR`,
run `scripts/macos/rehearse-update.sh`. It creates an isolated Debug application
(`com.talentsignal.macos.rehearsal`), a newer archive and a signed local appcast.
The ephemeral private key stays in that protected output directory, never in the
user Keychain or source. Remove it with the task artifacts after verification.

Run the Web development server on loopback port 4399, then
`python3 scripts/macos/serve-update-rehearsal.py <output>/updates` on port 4398.
Open `<output>/installed/Talent Signal Rehearsal.app`, enable local development,
and connect to `http://127.0.0.1:4399`. The Debug rehearsal opens the real account-footer
components with synthetic content at `/dev/desktop-chrome`; production returns
404 for that page. Verify the quiet indicator, one explicit update click, download, signature
check, automatic relaunch without another confirmation, new installed build and
preserved connection. A scripted `.click()` must not install; the native host
accepts only a trusted main-frame click through an isolated content world. Corrupt a
copy of the served archive to verify rejection and continued use of the old build.
Only Debug rehearsal bundles admit a loopback update feed; production does not.
