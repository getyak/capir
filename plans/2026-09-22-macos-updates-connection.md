# macOS updates and connection controls

## Outcome

Make the installed macOS workspace easy to connect, diagnose and update. A quiet
update button sits beside the Web account avatar only when Sparkle has an update.
Native settings own connection changes and diagnostics. Completion requires
rendered interaction, failure recovery and an actual old-to-new update rehearsal.

## Boundary

Worktree: `codex/macos-updates-connection`. Preserve the primary checkout's edits.
Do not move business data or give remote pages capture, filesystem, credentials,
configuration-write or installation authority. Workspace switching is a native
human action. Public releases contain no private workspace origin or secrets.

## Evidence and unknowns

- Baseline `b5f85a5e1`: WKWebView product; separate loopback-only native tools.
- Existing preview build 9 has no updater. CI already produces Universal packages.
- Local host has Xcode 26.4 and development/distribution identities, but no
  Developer ID Application identity. Formal credentials requested from owner.
- Both Tailscale peers online; the final packaged app reached the remote HTTPS
  service and displayed its login page.
- Storage guard is unavailable on this host; use a task-owned temporary directory.

## Approach

Use pinned Sparkle 2 and its standard user driver with gentle reminders. Publish
signed updates through a dedicated macOS appcast, never the mixed iOS latest feed.
Expose only version/update display metadata to the workspace. Two exact,
user-activated navigation links may open native settings or Sparkle's review UI;
they cannot install or accept configuration. Keep native menu fallbacks for old Web.
Connection settings accept HTTPS origins or workspace links, offer explicit
loopback-only development mode and cookie-free, same-origin connection probes.
Do not add arbitrary update feeds or weaken TLS validation.

## Milestones

1. Done: implement updater, connection settings and bounded desktop chrome.
2. Done: package signing/appcast automation and negative-path tests.
3. Done: rendered controls, signed local upgrade and corrupted archive rejection.
4. Done: Universal preview packaging, verification evidence and
   [draft PR #236](https://github.com/getyak/talent-signal/pull/236).

## Outstanding acceptance gates

- Provide the production Developer ID, notarization and durable Sparkle signing
  credentials, then verify the signed release/feed publication from trusted main.
- Deploy the Web account-footer changes with the normal service release before
  expecting the quiet update control on the remote workspace. Native menu and
  settings controls remain available with the previous Web deployment.
- The owner must sign in to the real workspace for authenticated acceptance.
  Reaching the login page does not establish authenticated business behavior.

## Verification

Test rejected origins/actions, redirects, stale probes, update trust configuration,
no-update/failure/reminder states, settings persistence and switching. Run focused
native/Web/release checks and `pnpm docs:check`. Exercise the real app and a
synthetic local service without accessing relationship content. Developer ID
notarization and remote workspace login remain separate acceptance evidence.

## Sources

- https://sparkle-project.org/documentation/gentle-reminders/
- https://sparkle-project.org/documentation/programmatic-setup/
- https://sparkle-project.org/documentation/publishing/
- https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution

Sparkle's gentle-reminder API informs the quiet indicator; existing product account
controls determine its visual placement. Progressive disclosure keeps developer
configuration out of ordinary work. Standard installer UI retains explicit consent.

## Verification readback

See [verification evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-22-macos-updates/README.md).
Local update 900001 → 900002 succeeded. A corrupted 900003 archive was rejected;
restoring signed bytes allowed recovery to 900003. Connection/settings and the
account-footer integration were observed in the actual host. Production credentials
have not been supplied. The packaged app subsequently reached the remote 10443
service (HTTP 200) and loaded its workspace entry; authenticated business acceptance
is still a separate gate.
