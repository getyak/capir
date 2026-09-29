# Unified product release identity

## Outcome

A person opening GitHub Releases can identify one `vMAJOR.MINOR.PATCH` product
release and find the platform assets produced from that exact tagged commit.
The macOS app displays that product version and a separate monotonic native build
number. Sparkle still compares the native build number, not the marketing string.

## Current evidence

- iOS publishes `v0.1.91` with an IPA. macOS publishes a separate
  `macos-<run>-<attempt>` Release whose app is `0.1.0 (33)`. The Mac release is
  present but invisible inside the selected iOS release.
- The just-merged macOS settings commit has no GitHub asset yet because the
  current main CI is still running its iOS smoke job; the Mac workflow starts
  only after successful exact-main CI.
- `scripts/macos/package.sh` defaults to `0.1.0 (1)` locally and the Mac
  workflow overrides only the build number. iOS derives the next `v` tag from
  `scripts/ci/next-ios-version.sh`.

## Decision

Keep independent iOS/TestFlight and macOS/Sparkle delivery gates, but share one
product version and GitHub Release namespace. `vX.Y.Z` is the user-facing
version and tag. Each platform retains its own numeric build number. A release
may contain one or both platform assets; its asset list states what was
actually built. Neither workflow may label unbuilt platform assets as ready.

Both workflows use the same version resolver. It reuses an existing `v` tag
only when that tag resolves to the exact build commit; otherwise it allocates
the next unused patch version. Publication verifies that the tag points to the
exact verified commit, then creates or extends the same `v` Release. Asset
names are unique by platform. Mac assets are never replaced or duplicated under
one product tag; complete iOS
releases are immutable, while a partial IPA without a TestFlight receipt keeps
the existing explicit recovery path. Mac's signed Sparkle feed continues to point at the same
versioned, notarized ZIP and keeps its independent monotonic build number.

A separate `macos-...` GitHub Release is no longer created. Existing releases
and update feeds remain immutable history. The first unified release compares
against the last historical Mac release so a Mac-only change still publishes.

## Milestones and proof

1. Version resolver handles no tag, same-SHA tag, another-SHA tag, override and
   race-adjacent cases; tests pass against an isolated Git remote.
2. Mac release policy finds the last actual Mac asset across old and new release
   formats; path detection and trust-boundary tests pass.
3. Mac workflow injects `MACOS_VERSION` from the product tag and creates/uploads
   only verified assets on the exact commit, preserving signed appcast behavior.
   iOS finalize safely shares the release without clobbering an existing IPA.
4. Documentation reflects the one visible release, distinct build numbers and
   platform availability; `pnpm docs:check` passes.
5. After merge and successful CI, read back the GitHub release tag, target commit,
   Mac DMG/ZIP checksums and bundle version. Report any signing or CI blocker
   without publishing an ad-hoc build as a production download.

## Boundaries

No existing release, tag, feed entry or artifact is rewritten. No new
credential scope is added. A Mac preview remains clearly marked as a preview;
only Developer ID signed and notarized archives enter Sparkle's production feed.
The current signed Mac release for the previous commit remains the rollback.
