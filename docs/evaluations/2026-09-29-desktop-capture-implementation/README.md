# Desktop screenshot-to-Agent implementation evidence

Status: implementation in the managed `codex/mac-screenshot-agent` worktree. This record separates source/build evidence from real user-surface proof. No private user screenshot was taken or uploaded for verification.

## What is wired

- The shipping Mac app's menu-bar item now opens a compact screenshot-first panel and can be hidden from native device settings. The default capture path is an explicit region release; Space opens a window picker, P opens the optional crop/redaction preview, and the global shortcut defaults to Control-Option-S.
- Native capture state pins the selected image to one origin, owner scope, processing policy, Session ID, message ID and image hash. An AES-GCM and Keychain-backed local outbox stores the PNG before transmission. A 24-hour sweep uses the original capture timestamp even if a retry rewrites the encrypted file.
- A content-free WebKit host submits same-origin requests from a named isolated world. It shares the configured origin's WebKit cookie store but has no page-callable screenshot command and does not copy a cookie or bearer token to URLSession. Web middleware and the authenticated route both check the workspace account; the route checks the login binding and current processor policy before delegating to the existing durable image-only conversation queue.
- The backend receipt projects the exact message and image manifest without answer text. The native coordinator compares Session/message/attachment IDs, byte length and hash before reporting an admitted or viewable result. Result navigation enters that same Session. First use via a global shortcut has its own disclosure window.

## Observed checks

- Existing conversation queue Web suite plus new context/admission/receipt tests: 24 tests passed on the focused run before the later account-header correction. After that correction, both affected context and submission files passed all 8 tests, including the real Web middleware gate.
- Backend processor-policy and receipt projection suites: 6 tests passed. Backend TypeScript check passed before the final native-only changes.
- Native application `xcodebuild ... build` passed after the independent review's five P1/P2 fixes. Earlier focused macOS unit runs passed the new capture-intent, encrypted-store, selection geometry, image encoder, payload, preview redaction and coordinator tests before one additional coordinator status test was added.
- A separate compiled native probe exercised the production `CaptureIntent` and `CaptureRecoveryStore` sources: scoped AES-GCM round-trip, cross-owner isolation, transport JSON decoding, and 24-hour sweep all passed.
- Separate off-screen WebKit probes confirmed that an isolated content world could run under the content-free host's CSP, GET same-origin context, and POST same-origin JSON with an automatic `Origin` plus the account header.
- A compiled probe using the production `CaptureCoordinator` and `CaptureIntent` sources suspended receipt context readback, deleted the local intent, resumed the read, and observed no second submission or receipt read. This pins the review-found deletion race without depending on Xcode's stuck XCTest host.
- `pnpm docs:check` passed, including wiki and architecture-boundary/diagram checks, after the feature docs were linked. `git diff --check` and staged diff whitespace checks passed.
- Independent read-only review identified five initial problems. Follow-up reviews found a deletion-failure action, a failed-recapture menu path, incomplete shortcut remapping, and a deletion-versus-retry race. These were corrected; the latest native build passed after those changes. Static review and native probes do not replace the real Mac interaction test.

## Verification still required before release

1. Real Mac click-through: menu/shortcut → OS permission → selected pixels → one canonical admission → actual Agent answer → exact Session and original image. The Codex computer-use service timed out twice while attaching to the built app; it did not provide UI proof.
2. Run the complete new macOS XCTest set after the host recovers. Later `xcodebuild test` invocations stayed in Xcode's test-start/save stage with zero tests recorded, including a run from fresh derived data, while ordinary app builds succeeded. The in-flight attempts were stopped; this is not a passing or failing test result.
3. Native multi-display/mixed-scale and window-pixel QA, OS permission denied/revoked, menu-hidden/closed-window capture, live network loss, lost response across relaunch, deleted Session, and independent login changes. Unit/probe cases cover selected transformations, not all OS behavior.
4. Real isolated PostgreSQL conversation-queue and model execution. `conversationQueue.integration.test.ts` requires `CONTACT_AGENT_TEST_DATABASE_URL` pointing to a disposable localhost database; no such environment was supplied. Do not treat a synthetic WebKit fixture as proof of canonical Agent execution.
5. Web TypeScript check was previously green for the initial context/receipt slice. The later full check did not finish under extreme host load and was terminated after roughly 28 minutes; run it again before merging.
