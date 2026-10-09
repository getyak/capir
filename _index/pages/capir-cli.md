---
id: capir-cli
title: capir CLI reference
summary: The capir command surface for test accounts, model commands, strict-replay sandboxes and standalone managed releases.
status: published
language: en
target: docs/operations/capir-cli.md
---

# capir CLI reference

Concise reference for the `capir` CLI. [Account and workspace access](../../docs/operations/account-access.md)
owns the operational procedures; `capir help` is the offline entry point and
renders this surface without configuration, network access or credential reads.

## Browser login

```bash
capir auth login --env <name>       # browser consent or verified credential reuse
capir auth status --env <name>      # read-only, no rotation
capir auth logout --env <name>      # revoke this grant and its entries
capir help auth login              # offline
```

`--server <origin>` takes priority over `CAPIR_SERVER` and the selected named
environment, but must match its pre-registered exact backend/Web pair. A v2
login uses PKCE and a versioned OS-keyring-only record with rotating refresh
credentials. `CAPIR_TOKEN` is ephemeral. Status never refreshes; an uncertain
refresh requires reauthorization. Server test entitlement is explicit and deny
by default; denied user credentials never fall back to operator credentials.
The [access procedure](../../docs/operations/account-access.md#ai-acceptance-entry)
owns lifetimes, revocation, recovery and operator registry administration.

## Test accounts

```bash
capir help test create                  # offline: arguments, defaults, errors
capir test create --env <name>          # generated username + password, daily, 4h
capir test create --env <name> --preset daily --open web
capir test create --env <name> --username qa-mcp --password-stdin --expires-in 4h
capir test status <run-id> --env <name>
capir test stop <run-id> --env <name>
```

- `--env <name>` is always explicit; help never resolves an environment.
- `--preset daily` seeds 12 contacts, 30 observations and 4 tasks; `--preset
  empty` seeds nothing. Creation invokes no model, email or OAuth flow.
- `--expires-in` accepts `1h`, `4h`, `24h` and the equivalent `1d`; the
  default is `4h`. No account is non-expiring.
- `--password` and `--password-stdin` are exclusive. A generated password has
  at least 128 bits of OS cryptographic entropy and is printed exactly once by
  the dedicated success projection; supplied passwords are never echoed.
- `--request-id <uuid>` resumes the exact recorded operation and reuses its
  preserved credential. Recovery never rotates, resets or allocates another run.
- `--open web` opens a fresh isolated browser context through a one-use
  private handoff; the secret never appears in a URL.
- Provisioned identities enter the workspace directly. Permanent sign-in
  method changes and account reconciliation reject test identities on either
  side of the transaction.
- `stop` revokes access first. Cleanup failures return exit code `3`, the
  canonical run and the same recoverable request id. External cleanup still
  pending without a failure is reported separately in human output.

Machine callers add `--json` for the stable help schema (arguments, defaults,
examples, error codes) and for operation envelopes. Plain help is readable
text; it never reads stdin, loads a credential, uses the network or writes an
operation journal, even with hostile-looking flags present.

## Credentials

The operator provisioning credential is service material distinct from the
human `CAPIR_TOKEN`: the OS keyring service `talent-signal.capir-test-operator`
with account `capir-test-operator:<backend-origin>|<web-origin>`, or the
ephemeral `CAPIR_TEST_OPERATOR_TOKEN`. Run passwords live in run-specific
keyring items (service `talent-signal.capir-test-run`) bound to the stable user authority or operator
credential fingerprint, the exact origin pair and the request id, and are
removed on stop or expiry.

## Model and sandbox commands

`capir ask`, `capir chat` and `capir models` run explicitly configured text
models. `capir auth` negotiates `capir-auth.v2`; legacy v1 credentials do not refresh.
`capir sandbox` keeps its strict-replay semantics.
Actual server capability discovery lists legacy scopes that the current
service does not implement as unsupported; they are never silently emulated.

## Standalone install and update

The standalone release is a self-contained portable package: bundled Node
22.23.2, production dependencies, compiled contracts, the CLI, the
`@napi-rs/keyring` native package, Playwright libraries (browser download
stays explicit) and licenses. No source checkout, pnpm or system Node is
needed at runtime.

```bash
curl -fsSL https://github.com/getyak/capir/releases/download/capir-stable/install.sh -o capir-install.sh
sh capir-install.sh                    # newest verified stable
sh capir-install.sh --version 0.2.0    # one signed immutable release
sh capir-install.sh --replace-existing # back up an unrelated launcher first

capir update --check [--json]   # current/latest/update_available/install_method/source
capir update [--json]           # transactional update (human output is the default)
capir update --rollback [--json]
```

- Managed root `~/.local/share/capir` (override `CAPIR_INSTALL_DIR`);
  `versions/<version>/`, an atomically switched `current` symlink, and the
  launcher `~/.local/bin/capir` (override `CAPIR_BIN_DIR`). The launcher
  resolves `current` to one physical version before exec, so a switch cannot
  mix runtime and JS versions; running sessions keep their version and the
  update applies to the next invocation.
- Every update verifies the signed manifest (RSA-SHA256 against the committed
  public key) before parsing, then the archive sha256 and byte size before
  extraction, then archive paths and the physical symlink/hardlink graph, and
  finally smokes the bundled CLI (`--version`, `--help`, native keyring) from
  a clean environment before publishing. Any failure preserves the previous
  install; old versions are never auto-deleted and stay rollback targets.
- Source checkouts and package-manager installs are never updated in place:
  `capir update` detects an unmanaged install (metadata binds the invoked
  physical binary and platform to the install root) and fails with the exact
  safe installation guidance above.
- `--replace-existing` backs up an existing user launcher; the installer
  refuses unrelated or custom launchers by default. Only one install/update/
  rollback runs at a time (crash-recoverable OS lock); retries and interrupted
  activations recover from the recorded state without downgrading a newer
  committed version.

### Platforms and limits

- Supported: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`
  (glibc). Windows is source-install only and has no native updater support.
- Playwright browser binaries are not bundled; `npx playwright install`
  remains explicit when a browser surface is needed.
- `capir update` needs no `--env` and no credential; it never touches the
  keyring. Machine callers add `--json` for the stable envelope.

### Automatic update notice

Ordinary interactive commands and the chat TUI may print a one-line notice to
stderr when a newer stable release exists: bounded to 2 seconds, cached about
24 hours, offline-safe, stderr only, never an automatic install. Help,
`--version`, `doctor`, `update`, `--json`, `--noninteractive` and non-TTY
runs never initiate the check. Set `CAPIR_DISABLE_UPDATE_CHECK=1` to disable
it entirely.

### Release trust and provenance

- Releases are immutable tags `capir-vX.Y.Z` in `getyak/capir`; the dedicated
  non-latest `capir-stable` channel release holds the verified newest stable
  `manifest.json`, `manifest.json.sig` and `install.sh`. GitHub
  `releases/latest` is never used or changed because desktop releases share
  the repository.
- The manifest is signed RSA-SHA256 with the `CAPIR_RELEASE_SIGNING_KEY`
  secret from the Infisical `staging:/release` store (OIDC, scoped to the
  `capir-release` environment). The private key never exists in the
  repository or any client; the matching public key is committed in the
  updater and the shell bootstrap. Release builds verify the official Node
  archives against nodejs.org `SHASUMS256.txt`, and release notes record the
  runtime version and source revision.


Version releases contain the four archives, the signed manifest pair and the
installer. A publish retry may rebuild an unpublished draft only after verifying
the entire asset cohort. A promotion checkpoint is saved before replacing
channel assets and authenticated against the immutable signed release during
recovery, including failure after deletion of an old asset. Once public, a version release is read-only: retries
verify and reuse its original signed assets, even if a rebuild produces different
archive bytes. All stable-channel promotions share one workflow lock, verify the
source tag against the frozen source commit, and refuse to move the channel to an
older version. Bootstrap downloads are bounded while streaming, including
responses without a Content-Length header. Custom relative installation paths
are saved as absolute paths; different-filesystem staging is copied and smoke
checked on the destination filesystem before activation.


A custom launcher directory may be inside the managed root (for example
`<root>/bin`). The `versions`, `current` and `staging` paths are reserved and
rejected before replacement. Installer metadata and launcher content bind to
one physical installation root, including when the requested path is a symlink.
PR package smoke runs in a separate read-only workflow. Signed publication runs
only for validated `capir-v*` tag events; retries use GitHub workflow rerun.
Builds install the exact pnpm JavaScript distribution from a committed npm lock
with SHA512 integrity so Intel macOS needs no native pnpm binary.
