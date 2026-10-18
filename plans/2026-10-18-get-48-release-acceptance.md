# GET-48 isolated published-app acceptance addendum

The original [fixed acceptance](2026-10-18-get-48-install-onboarding.md) remains unchanged. A local preflight proved that `CFFIXED_USER_HOME` redirects Foundation file paths but not the macOS preferences daemon. Its one synthetic suite/key was removed and read back absent. Never launch the unmodified production-identity release beside the user's installed client using temporary HOME as a claimed preferences boundary.

Use the existing GitHub-hosted, disposable macOS job instead. Compile a small native first-run UI regression class; run it in PR CI with Keyboard Navigation enabled only on that disposable runner. After normal release publication, download and verify the exact ZIP against its manifest, expand it into a task-owned installation directory, verify its unchanged signature/notarization, and launch that exact app through `XCUIApplication(url:)`. The runner must reject local/self-hosted execution before changing any setting. Restore its previous keyboard setting in a trap. Never delete a product preferences domain; fail if a saved workspace already exists.

The app remains unmodified: no test-only product mode, new authentication bypass, renamed identifier or ad-hoc re-signing. The test runner gets only the explicit app path through Apple's documented `TEST_RUNNER_` environment contract; signing/provider/GitHub secrets are stripped before launching tests. Test content is fictional; no probe, save, login, model or real workspace request is performed.

Additional acceptance, before implementation:

| ID | Expected result | Verification / failure |
| --- | --- | --- |
| R1 | Local/self-hosted invocation cannot mutate preferences or launch tests. | Behavioral shell test with boundary spies; fail if any defaults/xcodebuild action happens before refusal. |
| R2 | Tab/Space opens optional example and inspects its source; Cmd-Return applies an explicit correction; Escape remains page-local. | Native XCTest UI actions on the disposable Mac; no missing automation/AX capability may be counted as a pass. |
| R3 | Hidden connection input cannot receive a key or save on Return; an unapplied example draft cannot change connection Escape behavior. | Native UI regression against real controls, asserting unchanged address and visible page. |
| R4 | Downloaded production bytes map to exact merge/tag/build and remain signed/notarized after copying to the isolated installation. | Existing publication readback plus download checksums, strict codesign and staple verification, actual signed-app UI run. Local preview is insufficient. |
| R5 | The new check is blocking and retains exact-source evidence. | PR native CI and release workflow fail on any UI failure; retain xcresult/summary/screenshots as bounded Actions artifacts, no credentials. Final parent verifies receipt and actual final DMG in Finder before Linear Done. |

Source API: [Apple XCUIApplication](https://developer.apple.com/documentation/xcuiautomation/xcuiapplication), [test runner environment](https://developer.apple.com/documentation/xcode/environment-variable-reference), [test-without-building](https://developer.apple.com/library/archive/technotes/tn2339/_index.html). GitHub-hosted jobs [start in fresh runner instances](https://docs.github.com/en/enterprise-cloud@latest/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job).

This moves a test environment; it does not treat unchanged waits or partial CI as delivery and does not weaken I1–I10. Native local source/AX/rendering evidence remains separately identified. No user system preference change is required.
