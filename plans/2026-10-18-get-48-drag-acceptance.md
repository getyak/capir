# GET-48 real Finder drag acceptance

The original I1–I10 and R1–R5 criteria remain frozen. Version 0.2.8 (125), merge
`f46f0c226b3ac4e9a38624d079a152c4932091ac`, passed real signed publication,
checksum/trust/signature/notarization/Gatekeeper checks, all 78 bundle file and
symlink comparisons, and three unchanged first-run UI tests. Independent review
correctly leaves I2's actual physical drag unverified: local native automation
only selected icons. Native Finder Copy/Move proves installation, not a drag.

## Decision and boundary

Add one separate native Finder UI test on the existing disposable GitHub-hosted
Mac. Mount this task's real installer, locate its actual App and Applications
icons, use Apple's click-and-hold/drag API, and wait for the actual destination
bundle to match the source file-for-file. Never substitute a shell copy or mouse
coordinates for a failed Finder drag. Retain Finder AX text, before/after
screenshots and source/destination identity. The helper refuses local/self-hosted
execution and an existing destination before any platform mutation; it never
deletes an app or resets a product preferences domain.

PR CI first runs the existing three native first-run tests unchanged, then builds
a clearly named ad-hoc PR fixture DMG and performs one real Finder drag. The
release job downloads and compares the immutable published DMG and ZIP, performs
the same drag from the downloaded DMG to the actual `/Applications` target on its
empty hosted Mac, compares the resulting bundle with the downloaded ZIP, and
runs the original three first-run tests against that unchanged installed app.
Both test groups must pass before the signed appcast is promoted. All UI subprocesses
receive an environment stripped of release/provider credentials. Failure retains
evidence and detaches only the task-owned mount. Existing signing, immutable
assets, production target and trust keys remain unchanged. A new normal PR and
release is required; do not overwrite v0.2.8 assets.

Rejected: claim Copy as drag; modify the frozen wording; overwrite the user's
running local app; temporary HOME as a preferences boundary; bypass the UI test
with a shell copy; overwrite an existing immutable version.

## Additional fixed verification before implementation

| ID | Expected observation | Verification and failure |
| --- | --- | --- |
| D1 | Local/self-hosted or configured profile refuses before mount/open/test or destination mutation. | Behavioral command spies; any side effect before refusal fails. |
| D2 | Actual Finder app icon is dragged onto the actual mounted Applications alias. | Separate native UI test, visible source/target, before/after AX/screenshots, destination absent beforehand and all source file/symlink bytes equal afterward. No successful drag or any copy fallback fails. |
| D3 | Published destination is the unchanged signed release and the same bundle as the downloaded ZIP. | Check published bytes, version/build, complete manifest, strict signature/staple/Gatekeeper, then original three first-run tests' real running-path/executable-hash receipts. A different/default app fails. |
| D4 | Failures/skips remain failures, artifacts survive, and only owned mounts are detached. | Strict separate one-test and three-test summaries; behavioral validator and cleanup tests; original first-run sequence unchanged. |
| D5 | Latest code independently reviewed and normal CI/release succeeds before Done. | Independent Codex review, current-head applicable checks/protection, normal merge/new immutable release, final DMG Finder readback. |

## Milestones

1. Active: implement and compile the bounded native drag test and guarded helper;
   exercise helper refusal/summary/owned-mount cleanup without running local UI.
2. Independent review, PR and actual PR Finder test; diagnose any real failure
   without substituting weaker assertions.
3. Normal merge/new signed release, real published drag plus original first-run
   gates, final download/Finder/trust readback, then close GET-48.

Official API: [Apple XCUIElement](https://developer.apple.com/documentation/xcuiautomation/xcuielement)
defines macOS `click(forDuration:thenDragTo:)`. Use an initial hold so Finder enters
dragging before moving; query the real element frames, not guessed screen points.
