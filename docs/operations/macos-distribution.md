# macOS download and distribution

Talent Signal is a relationship workspace for client work, partnerships,
collaboration, and recruiting. The downloadable client is `apps/macos`.
`apps/macos-hybrid` remains a separate experimental capability shell.

## Install on another Mac

1. Open [macOS releases](https://github.com/getyak/talent-signal/releases?q=macos-)
   and select a macOS release. Download its Universal `.dmg` (Apple silicon and
   Intel, macOS 14 or later). Preview releases are explicitly labeled.
2. Compare the downloaded file with its `SHA256SUMS.txt` using
   `shasum -a 256 <downloaded-file>`. Drag **Talent Signal** to Applications.
3. Open the app and enter the HTTPS workspace origin supplied by the workspace
   owner, or paste a full `/workspace/...` link. The app shows the normalized origin.
   Sign in with your own account.

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
client build before declaring the experience updated. In the running client,
open the avatar menu and click its **Settings** entry: it must raise the same
independent window as `⌘,` while preserving the main workspace. A shortcut-only
check cannot verify the avatar path. If the resident Web is older, keep its
release active until a clean replacement build and authenticated readback pass.

## Connection and diagnostics

The optional menu-bar capture entry uses the same configured Web workspace login. On first use it discloses the current workspace and available image processors before an intentional selection can upload. The device-owned capture permission is separate from that login. The ordinary path is configurable shortcut, region selection and release; the Agent then processes an image-only Session message. Settings → This device controls the menu-bar icon, shortcut, default preview choice and optional top status hint. Hiding the icon leaves the main window and Settings reachable. An unadmitted screenshot is encrypted for bounded device recovery, while an admitted image follows the workspace Session/source lifecycle.

**Settings (⌘ ,) → Connection**, the native toolbar and the Web account menu open
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

## Automated publication

`.github/workflows/release-macos.yml` runs after successful trusted `main` CI.
It compares macOS source, approved icon, packaging, and release policy with the
last macOS tag and skips unrelated changes. It builds and tests the native app
at the exact verified revision before publishing a unique `macos-<run>-<attempt>`
release, Universal DMG/ZIP, and SHA-256 manifest. Preview releases never become
GitHub's general latest release (which is also used by iOS).

Default mode is `preview`. Set repository variable `MACOS_RELEASE_MODE=signed`
only after provisioning Developer ID signing and notarization. Signed mode
fails closed on missing credentials, signing, notarization, staple validation,
or Gatekeeper assessment. It never falls back to a preview silently.
Manual dispatch accepts only the current default branch and requires successful
push CI for that exact revision.

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
MACOS_OUTPUT_DIR=/absolute/task-artifact scripts/macos/package.sh
```

The package script verifies both architectures, icon presence, absence of a
bundled private origin, and bundle signature. Preserve requested deliverables
before removing task build products through the storage guard. Native unit tests
run through `scripts/macos/check.sh`; no iOS simulator is needed.

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
