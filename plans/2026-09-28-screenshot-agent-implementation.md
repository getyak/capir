# Screenshot-to-Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Execution method is awaiting user selection; inline execution is recommended because the capture, authentication and receipt interfaces are tightly coupled.

**Goal:** Deliver the approved Mac menu-bar design so an explicitly selected screenshot automatically becomes one recoverable Agent conversation, with no second Send on the normal path.

**Architecture:** Native SwiftUI/AppKit owns capture intent, selection, preview, encrypted recovery and presentation. A native-initiated, isolated WebKit transport uses the configured workspace's existing cookies internally to reach bounded BFF endpoints; it exposes no page-callable native API and exports no cookies or backend tokens. Existing conversation image admission, durable queue execution, Session storage and source deletion remain canonical.

**Tech Stack:** Swift 5.9, macOS 14+, SwiftUI, AppKit, ScreenCaptureKit, WebKit, CryptoKit/Keychain, ServiceManagement; Next.js 16.3.4 BFF; existing TypeScript contracts and Fastify/PostgreSQL conversation queue.

**Spec:** [Approved screenshot-first design](../_index/notes/2026-09-28-screenshot-to-agent-design.md), [Figma implementation reference](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=220-1991), and [design verification](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-28-menu-bar-capture/README.md).

## Global Constraints

- Shipping client: `apps/macos`; do not implement this in the experimental hybrid shell.
- Keep macOS 14.0 and Swift 5.9 compatibility. No paid screenshot dependency, image host, new generic Agent runtime, or database-backed task subsystem.
- Normal flow: configurable Control-Option-S → drag region → release → automatic upload and Agent admission. Menu action has the same behavior.
- Space selects a window; P or a visible Preview control enters preview; Escape before submission sends nothing. Always-preview remains a user preference.
- Menu width starts at 320 logical points. Commands: Screenshot to Agent, Continue last conversation, Open workspace, Settings, Quit. No current-task section or text composer.
- First use names the workspace and actual configured processing scope before enabling automatic submission. OS screen permission remains an independent user decision.
- Raw local recovery expires 24 hours after capture. Retry cannot extend the deadline. Admitted server images follow the existing Session lifecycle, not the local 24-hour rule.
- Native capture and upload must not reuse the old local-only window-capture contract silently. Preserve `SystemWindowCaptureService` and separate native tools.
- One capture creates a new Session unless explicitly initiated within a named Session. No inferred binding to the last open conversation.
- Hide-menu, close-window, quit, cancel-work, and delete-source are different operations. Existing reviewed external effects remain independent of screenshot analysis.
- Preserve all unrelated user changes. At execution time use a managed worktree based on verified current main; transfer only the approved plan/design artifacts if untracked.

## Review Focus

1. Account, workspace origin, processing policy or login changes between selection and upload: reject stale delivery and never replay into the new account (Tasks 1, 3, 5).
2. Lost admission response after the server accepted the image: reconcile the exact message before replay and never create another Session/task (Tasks 2, 3, 5).
3. Mixed-DPI displays, negative coordinates, changing display topology and oversized text images: upload only the selected pixels with readable resolution (Task 4).
4. Closed main window, terminated WebKit process, cancelled preview or failed disk encryption: preserve truthful state without hidden upload or lost recovery (Tasks 3, 5, 7).
5. Deleted/expired Session or raw-image recovery, including failure at the expiry boundary: no resurrection, falsely viewable result or extended retention (Tasks 2, 3, 7).

## Existing evidence and decisions

- `TalentSignalMacApp.swift` already owns a command-style `MenuBarExtra`, currently always inserted. `WorkspaceDesktopSettings.swift` provides a native device pane.
- `QuietWorkspaceView.swift` creates an origin-partitioned `WKWebsiteDataStore`, restricts navigation and currently grants only a bounded isolated update-click exception. Keep update behavior working when adding the new transport.
- ADR 0016 prohibits credential forwarding and a general native bridge. Therefore reject copying WebKit cookies into `URLSession`, putting credentials into local storage, page-supplied capture commands and DOM-driven clicks.
- `conversationQueueRoute` already checks the exact login binding, creates an unscoped Session if absent, accepts images and returns a 202 receipt. `ConversationQueueRunner` executes independently of the visible Web page. Use these rather than the manual screenshot-filing pipeline.
- `ConversationImageUploadSchema` caps one image at 10,000,000 bytes and a batch at ten images/30,000,000 bytes. This feature submits one PNG with exact byte length and SHA-256.
- `LocalCapsuleStore.swift` supplies encryption/Keychain patterns; do not put capture recovery into the unrelated capsule record.
- `readConversationQueueEntryStatus` and queue-result helpers already exist in the backend. Add a bounded authenticated projection for native receipt reconciliation instead of returning conversation text into menu presentation.
- Lab execution can select a different provider. The processing disclosure must cover that actual allowed provider set or refuse automatic capture; do not label every deployment as one assumed model provider.

## File ownership and interfaces

All new native feature files live under `apps/macos/Sources/Capture/` and their tests under `apps/macos/Tests/`. Keep each below responsibility focused; avoid extending `AppModel` with a second account or Agent state model.

| Unit | Files and responsibility |
| --- | --- |
| Capture contracts and context | New `packages/contracts/src/desktopCaptureSchemas.ts`; exports in `packages/contracts/src/index.ts`; typed client methods in `packages/contracts/src/client.ts`. New `apps/backend/src/modules/desktopCaptureContext.ts` and registration in `apps/backend/src/app.ts`. |
| BFF context and receipts | New `apps/web/lib/server/desktopCapture.ts`, `apps/web/app/api/desktop-capture/context/route.ts`, `apps/web/app/api/desktop-capture/[sessionId]/[messageId]/route.ts`; reuse `conversationQueue.ts` admission and existing auth/bindings. |
| Backend receipt projection | New `apps/backend/src/modules/desktopCaptureReceipt.ts`; route registration beside existing conversation routes; use existing queue/session/image state without new persistence. |
| Native transport | New `CaptureTransport.swift`, `CaptureTransportScript.swift`, `CaptureContext.swift`; narrow integration with `QuietWorkspaceView.swift` and `WorkspaceConnection.swift`. |
| Recovery | New `CaptureIntent.swift`, `CaptureRecoveryStore.swift`; reuse the existing `CapsuleKeyProviding` protocol implementation with a capture-specific key namespace. |
| Capture and preview | New `CaptureSelection.swift`, `CaptureOverlayController.swift`, `CaptureImageEncoder.swift`, `CapturePreviewView.swift`, `CaptureShortcut.swift`. |
| Lifecycle and UI | New `CaptureCoordinator.swift`, `CapturePreferences.swift`, `CaptureMenuView.swift`, `CaptureHintController.swift`, `CaptureOnboardingView.swift`, `CaptureDeviceSettings.swift`; wire the existing app scene and native settings. |
| Proof | New native test files named for each unit, `apps/macos/UITests/ScreenshotCaptureUITests.swift`, Web/backend contract tests and a synthetic end-to-end scenario. |

### Task 1: Define authenticated capture context and truthful processing disclosure

**Files:** contracts and context units above; tests `apps/backend/src/modules/desktopCaptureContext.test.ts`, `apps/web/lib/server/desktopCapture.test.ts`, `apps/web/app/api/desktop-capture/context/route.test.ts`.

**Interfaces:** `DesktopCaptureContext` contains `protocol_version: 1`, an opaque stable `owner_scope`, exact `login_binding`, ISO `expires_at`, and `processing: { policy_version, workspace_label, processor_labels: string[], source_retention_days: number, available: boolean }`. No credentials, provider endpoints, prompts or conversation content. Backend `describeDesktopCaptureContext(auth, runtimePolicy)` projects existing authenticated ownership and loaded processor configuration; Web `desktopCaptureContextRoute(request)` supplies the existing chat binding. Context expiry is the earlier of login expiry and five minutes. Scope identity uses keyed HMAC over account and user IDs; it does not embed a rotating access token.

- [ ] Write failing tests: unauthenticated/expired login returns 401; same owner with refreshed credentials has equal `owner_scope` and changed binding; another account differs; unavailable processor policy disables automatic capture; runtime/Lab labels reflect the real allowed processors without exposing secrets.
- [ ] Run focused Web/backend tests and verify the expected missing-contract failures.
- [ ] Add the typed contract, authenticated backend projection, BFF route and client method. Derive retention from the existing Session policy and processor information from loaded runtime inputs; do not expose the Lab configuration endpoint to ordinary users.
- [ ] Run contract builds and focused tests; validate complete response shapes with TypeBox rather than assertions alone.
- [ ] Commit the context/contract slice with only its owned files.

### Task 2: Reuse image admission and add exact receipt readback

**Files:** BFF receipt and backend projection units; tests `apps/backend/src/modules/desktopCaptureReceipt.test.ts`, `apps/backend/src/modules/conversationQueue.integration.test.ts`, `apps/web/lib/server/desktopCapture.test.ts`.

**Interfaces:** `POST /api/desktop-capture/:sessionId/:messageId` accepts the existing `ConversationQueueAdmitRequest`, one image, and the reviewed processing-policy version; it validates origin, current login binding, policy and IDs, then delegates to existing admission. `GET` returns `DesktopCaptureReceipt { session_id, message_id, queue_entry_id, status, image_manifest, observed_at, result_recorded }` or a truthful not-found/deleted/unauthorized result. Status is the existing queue status; `result_recorded` means the exact completed answer is in its canonical Session. No answer text is returned.

- [ ] Write failing tests for wrong owner/binding, changed policy, malformed PNG/hash/size, body overflow, mismatched response IDs, and two identical requests producing the same message/queue receipt.
- [ ] Add a lost-response integration case: admit one synthetic PNG, discard the response, read its status, retry the same immutable payload, assert one queue entry and one Session message.
- [ ] Bound the actual incoming request stream to 13,500,000 bytes before JSON parsing; do not rely only on `Content-Length`. Delegate admission through the existing queue path; do not duplicate Session creation or provider invocation.
- [ ] Implement receipt lookup through existing owner-checked queue state, image manifest and completed-result state. Deleted/expired Sessions cannot return a usable receipt or be recreated by native recovery.
- [ ] Run focused BFF/backend tests, including deletion and a worker-completed answer readback; commit the slice.

### Task 3: Implement isolated transport and encrypted local recovery

**Files:** native context/transport/recovery units; `QuietWorkspaceView.swift`, `WorkspaceConnection.swift`; tests `CaptureTransportTests.swift`, `CaptureRecoveryStoreTests.swift`.

**Interfaces:** `@MainActor protocol CaptureTransporting { func context() async throws -> CaptureContext; func admit(_ intent: CaptureIntent, context: CaptureContext) async throws -> CaptureReceipt; func receipt(for intent: CaptureIntent, context: CaptureContext) async throws -> CaptureReceipt? }`. `CaptureIntent` pins origin, owner scope, capture time, Session/message/attachment UUIDs, immutable PNG/hash/length, processing-policy version and recovery phase. `CaptureRecoveryPersisting` provides `save`, `load(origin:ownerScope:now:)`, `remove`, and `purgeExpired(now:)`.

- [ ] Write failing tests for account/origin changes, off-origin navigation, WebKit termination, malformed receipts, tampered ciphertext, unavailable Keychain and exact 24-hour expiry. Assert no raw PNG, token or source text reaches logs/preferences.
- [ ] Implement `WKWebView.callAsyncJavaScript` in a named isolated `WKContentWorld`, main frame only, using argument binding rather than interpolated source. The fixed script permits only the capture-context/admission/receipt paths and same-origin credentials, rejecting redirects. Native checks the configured origin before and after each asynchronous result. Page JavaScript gets no message handler, capture method or callback authority.
- [ ] Retain the origin-specific workspace browser independently of window visibility. Isolated requests can fail recoverably if WebKit is unavailable; do not switch to another account, general-purpose native HTTP session or direct backend bearer token.
- [ ] Store AES-GCM encrypted, account/origin-partitioned recovery files atomically with restrictive permissions and backup exclusion. Pin expiry to `capturedAt + 86_400 seconds`. Persist IDs before any upload; reject upload if durable staging failed.
- [ ] Run the focused native tests, including process-relaunch recovery with the same IDs; commit the slice.

### Task 4: Native selection, shortcut and optional preview

**Files:** selection/preview/shortcut units; tests `CaptureSelectionTests.swift`, `CaptureImageEncoderTests.swift`, `CaptureShortcutTests.swift`.

**Interfaces:** `@MainActor protocol CaptureSelecting { func select() async throws -> CaptureSelectionResult; func cancel() }`; result contains a selected `CGImage`, capture time and `.direct`/`.preview` intent. `CaptureImageEncoder.encodePNG(_:) throws -> EncodedCapture` produces exact PNG bytes/dimensions/hash. `CaptureShortcut.register(_:) throws` owns one configurable global shortcut and reports conflicts without taking over system shortcuts.

- [ ] Write geometry tests for a 2× display left of a 1× main display, out-of-bounds selections, zero-area selection and a display removed mid-selection. Assert crop pixels and Retina dimensions, not only overlay coordinates.
- [ ] Implement native one-shot screen capture with ScreenCaptureKit and a temporary AppKit selection overlay. Request OS permission only after explicit capture intent. Hide Talent Signal presentation before the capture; discard surrounding screen buffers on selection/cancellation. Capture one display per region; reject accidental cross-display drags with a recoverable selection prompt rather than stitching at inconsistent scale.
- [ ] Register Control-Option-S by default using the OS hot-key facility, with user remapping/conflict feedback. Space selects a window; Escape cancels; P and a visible control enter preview. Always-preview preference follows the same branch.
- [ ] Implement preview cropping and opaque rectangular redaction. Rasterize the final redaction before producing immutable upload bytes; do not send hidden original pixels. The final message identity/hash is frozen only when the image is submitted.
- [ ] Preserve native resolution for ordinary images. If lossless PNG exceeds 10,000,000 bytes, retain it locally and ask for a smaller crop; do not silently make text unreadable to fit. Add exact-limit tests.
- [ ] Run native unit tests and inspect a synthetic selection on the real desktop; commit the slice.

### Task 5: Connect the complete lifecycle without a task center

**Files:** `CaptureCoordinator.swift`, `CaptureIntent.swift`, `CaptureHintController.swift`; tests `CaptureCoordinatorTests.swift`.

**Interfaces:** `CaptureCoordinator.startCapture()`, `retry(intentID:)`, `discardLocal(intentID:)`, `openResult(intentID:)`, `resumeLastConversation()`; published `CapturePresentation` is content-free. Dependencies are the Task 3 transport/store, Task 4 selector, injected clock and presentation/navigation adapters.

- [ ] Write state-transition tests: consent/context → selection → preview or durable staging → upload → admitted processing → verified viewable result; include cancel, failure, unknown receipt, session deletion and relaunch.
- [ ] Fresh context and processing policy must agree with the capture intent before upload. Reauthentication into the same owner can refresh an expired binding only after readback; another owner or changed processing policy requires review and never automatically replays the image.
- [ ] Offline capture may stage locally only under a previously verified owner/origin and recorded disclosure. Display it as not uploaded; reconnect must obtain fresh context before any send. With no verified prior identity, open sign-in instead of collecting an unowned screenshot.
- [ ] Admit using one stable message/idempotency key and verify all receipt IDs plus image length/hash. On uncertainty, read the exact receipt first; retry uses the same bytes and IDs only after definitive absence. A status-read failure remains unknown.
- [ ] Observe admitted work while this app is running; the existing backend worker owns execution if the window closes or the app quits. Remove local raw bytes only after canonical admission/image-manifest readback; keep content-free references for result navigation and unresolved recovery.
- [ ] Show a short generic hint without taking focus. Treat close-hint as presentation dismissal, not cancellation. Unresolved failures remain reachable via one contextual recovery item or the original Session, never a general task list.
- [ ] Implement optional top activity hint, off by default, with a menu-anchored fallback on no-notch/external screens, safe-area placement, fullscreen suppression and reduced motion. It carries no person/message text and is mutually exclusive with the ordinary hint for the same event.
- [ ] Test the real production constructor wiring, not a test-only substitute that supplies missing authentication or receipts. Commit the lifecycle slice.

### Task 6: Match the Figma menu and native preferences

**Files:** menu/preferences/onboarding/settings units; modify `TalentSignalMacApp.swift` and `WorkspaceDesktopSettings.swift`; tests `CapturePreferencesTests.swift`, `ScreenshotCaptureUITests.swift`.

**Interfaces:** `CapturePreferences` owns `showMenuBar = true`, configurable shortcut, `afterSelection = .direct`, `topHint = .off`, and the origin/owner/policy-bound onboarding acknowledgement. Login-item state comes from `SMAppService.mainApp.status`, not a fake saved Boolean.

- [ ] Add preferences tests for persist/relaunch, immediate menu insertion/removal, origin/account/policy changes invalidating only the appropriate consent, and declined login-item registration.
- [ ] Replace the existing menu body with the 320-point `.window` presentation, approved monochrome mark and shared commands. Remove the task section and composer. Continue-last opens an account-scoped Session only after current authorization readback; if unavailable, show a truthful disabled/empty state.
- [ ] Wire native Settings → This device to immediate menu visibility, shortcut recorder, direct/preview mode, optional top hint, independent login-item registration and actual processing/retention details. Main window and Command-comma remain usable when the menu is hidden.
- [ ] First-use view names the real workspace and allowed processor labels, explains release-to-submit and links processing/retention detail. The app does not simulate the OS permission dialog or claim permission before the OS grants it.
- [ ] Verify light/dark, reduced transparency/motion, keyboard navigation, Escape/outside click, close/reopen, sign-out, menu hidden and no recent Session. Compare the real 320-point panel against the Figma reference at the same logical scale; commit the UI slice.

### Task 7: End-to-end proof and documentation handoff

**Files:** `apps/macos/UITests/ScreenshotCaptureUITests.swift`; new synthetic capture scenario in `scripts/macos/`; focused existing Web/backend conversation tests; update `docs/capture-to-action.md`, `docs/operations/macos-distribution.md`, and a narrow ADR amendment for native-initiated isolated capture submission.

- [ ] Run focused tests as each task changes its layer. Commands: `pnpm --filter @talent-signal/web test lib/server/desktopCapture.test.ts app/api/desktop-capture/context/route.test.ts`; `pnpm --filter @talent-signal/backend test src/modules/desktopCaptureContext.test.ts src/modules/desktopCaptureReceipt.test.ts src/modules/conversationQueue.integration.test.ts`.
- [ ] Run `pnpm macos:check`, Web/backend type checks and the affected regression suites once all wiring is complete. Native focused debugging may use `xcodebuild ... -only-testing:TalentSignalMacTests/CaptureCoordinatorTests test` with a task-specific derived-data path; generate the project through `pnpm macos:generate` first.
- [ ] Prove on the actual native surface with synthetic data: shortcut → selected pixels → canonical one-image admission → backend Agent result → exact Session opened with original screenshot. A mock reply or build alone is insufficient. If model/network access is unavailable, retain that release limitation rather than claim completion.
- [ ] Exercise lost admission response, offline staging/relaunch/retry, identity switch before upload, permission denial/revocation, close-window and menu-off recovery, preview cancellation, local expiry, remote source deletion and same-intent recovery without duplicates.
- [ ] Record before/after native screenshots and Figma comparisons, supported OS/display coverage and remaining gaps. Run `pnpm docs:check`; separate existing failures from new ones.
- [ ] Apply `REVIEW.md` to the full loop and have one independent final review after the chosen execution workflow. Commit the final verified changes; publishing, merging and release distribution require their own user instruction.

## Self-review and handoff

The plan covers the approved screenshot flow, optional preview, menu simplification, settings, top hint, first use, original-image continuity and failure recovery. Source inspection changed the transport choice: use a fixed native-initiated isolated WebKit request path rather than exporting login credentials or attaching a page-callable bridge. This is a narrow amendment to the desktop authority boundary, not a new domain state owner.

Review-focus cases are assigned to the responsible tasks. Existing native capture remains local-only. New admission uses existing conversation contracts and runner; all background/recovery claims require end-to-end proof. The current workspace has unrelated modified and untracked files, so execution must isolate changes and preserve those files.

**Status:** The user selected native inline execution, with a small capture-preference unit delegated to Pi CLI's goal workflow. Tasks 1 and 2 are committed and checked; native capture/menu, recovery, preview and documentation code is implemented in the managed worktree. [Dated verification](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-29-desktop-capture-implementation/README.md) records the real native settings toggle, full `pnpm macos:check` (206 passed native tests after the latest menu/WebKit patch, 8 skipped, UI tests compiled), 3 passing native-to-disposable-backend integration XTests, 13 passing focused Web capture tests plus 5 passing recent-Session tests, 6 passing backend policy/receipt tests, 4 passing disposable-PostgreSQL queue/image integration tests, a real BFF/backend synthetic round trip, Web/backend type checks, independent review and compiled probes. The review-found deletion and concurrent-selection races and same-owner login change were fixed; explicit retry now reconciles the exact receipt before controlled replay. Continue-last is disabled until a current owner-scoped Session is found, and an incomplete directory scan cannot claim empty. Real signed-in Mac screen selection through the status item, a configured live Agent answer, original-image readback in its Session, and OS/display QA remain active before release. Do not mark this plan complete or call the feature release-ready yet.
