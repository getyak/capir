# Shared product release identity across iOS and macOS

## Context

The iOS workflow publishes `vX.Y.Z` releases, while the macOS workflow has
published separate `macos-<run>-<attempt>` releases whose app still showed
`0.1.0` plus an independent build number. Selecting the newest iOS release on
GitHub therefore hid the Mac download and made it hard to tell which builds
belonged to the same source revision. The macOS workflow also waits for the
entire trusted `main` CI result, so a still-running unrelated CI job delays its
publication. A locally installed preview is not a public release.

## Decision

Use one `vMAJOR.MINOR.PATCH` product tag and GitHub Release per verified source
revision. Each platform app built from that revision uses the tag's numeric
version as its user-visible version. iOS and Mac retain independent numeric
build numbers because their delivery systems use them to distinguish successive
binaries. A release lists only assets actually built and verified for that
revision; an absent asset never implies that a platform was released.

The workflows remain independent: Mac delivery does not require a TestFlight
upload, and iOS delivery does not require notarization. Both resolve an
already-existing product tag only when it targets the exact build commit.
The first platform may create the release; the other adds distinct assets.
Re-running a workflow checks complete-release bytes and never silently
clobbers them. A partial iOS release without a TestFlight receipt retains the
existing explicit recovery path: after a new exact TestFlight build is
validated, it may replace an incomplete IPA and attach the receipt. Once that
receipt exists, byte changes require a new version. Mac assets are immutable
from their first publication.
Mac's signed Sparkle feed continues to use a monotonic native build number and
links to the notarized ZIP on the shared version release.

Historical `macos-...` releases and existing Sparkle feed entries are left
intact. The first shared release detects the last published Mac asset across
old and new formats, so unrelated changes do not publish another Mac build.

## Alternatives

- Keeping separate release names while only changing the Mac bundle version
  would still hide the download inside a different GitHub release.
- Requiring every change to rebuild and publish both platforms would couple
  Mac distribution to TestFlight processing and consume release credentials
  and runner time even when that platform did not change.
- Reusing an older `v` tag for a newer Mac binary would misrepresent the
  tagged source and undermine release verification.

## Reconsider when

If the product requires every `v` tag to contain both platforms, introduce a
single coordinator that verifies both artifacts before publishing a release.
Do not simulate that guarantee by copying an older platform binary into a
new tag. If release cadence diverges substantially, explicitly separate
platform version streams instead of making the shared tag ambiguous.

## Sources

- [Apple: preparing an app for distribution](https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution)
- [GitHub: managing releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [Sparkle: publishing an update](https://sparkle-project.org/documentation/publishing/)
