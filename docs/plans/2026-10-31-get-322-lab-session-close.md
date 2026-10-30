# GET-322 Lab session close implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this
> single lifecycle change after the parent reviews the design. The parent owns
> all test execution, review dispatch, Git, CI, Linear and delivery operations.

**Goal:** Closing an isolated Lab preview rejects new reads, cancels and joins
every admitted read, and only then invalidates its URLSession once.

**Architecture:** An instance-owned internal `LabFaultSessionLifecycle` actor
registers the complete workspace operation before its first suspension and owns
one coalesced close task. `LabFaultWorkspaceService` routes its only read entry
through this owner; the existing client still performs its three real synthetic
URLSession requests and JSON decoding. `LabFaultStore.close` first joins its
captured old read, then closes its captured old service.

**Tech stack:** Existing Swift 5, Swift concurrency, Foundation URLSession and
XCTest. No new dependency or shared networking change.

**Spec:** The parent task's GET-322 follow-up scope and the sanitized diagnosis
at `main6c217-native-urlsession-crash-diagnosis.json` in the parent evidence
directory. This is follow-up ownership under
[GET-322](https://linear.app/getyak/issue/GET-322/reshape-web-and-ios-into-a-calm-coherent-relationship-workspace),
not a claim that PR #485 introduced the bug.

## Current evidence and authorization

- Parent-created worktree: `get-322-lab-session-close/talent-signal`, branch
  `codex/get-322-lab-session-close`, based on freshly fetched `origin/main`
  `6c21720f5ebf13a3950a44d8bf9a35d4a704485e`; parent confirmed clean.
- Real main CI run `41083144604`, native job `124157436113`, crashes in
  `LabFaultTests.testOldPreviewCloseDoesNotCloseANewSessionAndBackgroundStopsFault`.
  URLSession raises `NSGenericException` for task creation after invalidation.
  The log SHA256 is
  `852eb559a601b3e148681e7d457dce991f34179195d78e0c37324c288f2d6a27`.
- The strict quoted-test-name status parser found 822 starts, 820 passes and one
  skip. That Lab test alone has no terminal status. Final failing-tests summary
  names it and the job exits 65. UI journeys did not begin.
- `LabFaultStore.close` currently cancels the old read, invalidates its service,
  and then joins the read. `LabFaultWorkspaceService.close` neither closes
  admission nor drains concurrent loads. The synthetic permission check is not
  atomic with subsequent URLSession task creation.
- The exact close invocation and scheduler interleaving are inferred, not
  recorded by the stack. The unsafe lifecycle is visible in application source.
  `stop(.background)` does not invalidate the session.
- The old main crash is the observed RED. New regression tests are authored
  before production changes but **have not been run or compiled**. Do not
  intentionally crash another local runner to recreate already saved evidence.
- The initial phase authorized only this plan and tests. The parent subsequently
  accepted this design and authorized the local source implementation. No tests,
  builds, Maven, Xcode, device, Simulator, network, Git, service or account
  commands are authorized here; all execution remains parent-owned.

## Global constraints

- Keep changes within `LabFaultStore.swift`, `LabFaultTransport.swift` and
  adjacent Lab lifecycle tests. Preserve unrelated work and existing asserts.
- Keep actual URLSession, LabFaultURLProtocol, the three client requests,
  decoder, task-local diagnostic ancestry, identity and registry isolation.
- No production test-only hook, memory-only replacement, timeout expansion,
  retry, skipped case, auth/provider change or experiment authorization change.
- Reject post-close reads with the existing `URLError(.unsupportedURL)` contract;
  do not attempt to catch the Objective-C exception after invalidation.
- Background stop ends injection and cancels/joins its current read, while
  leaving that session usable for an explicit reload.
- No mutable state lookup after an old close's suspension may clear or close a
  newer session. Capture old references before the first await.
- All application reads admitted by this service must use the lifecycle owner.
  Actor isolation alone is insufficient across awaits.

## Chosen design and alternatives

Add this internal, application-used owner in `LabFaultTransport.swift`:

```swift
actor LabFaultSessionLifecycle {
    init(onClose: @escaping @Sendable () async -> Void)
    func load(_ operation: @escaping @Sendable () async throws
              -> PursuitWorkspaceSnapshot) async throws -> PursuitWorkspaceSnapshot
    func close() async
}
```

`load` checks open admission and registers a typed operation task before any
await. The task inherits task-local diagnostics, checks cancellation before
entering the client, and retains the client/session until the whole workspace
operation and its structured request children finish. A cancellation handler
forwards caller cancellation to this task. Its result is awaited and its
registration is removed on either success or error.

`close` marks admission closed before its first suspension, captures all
registered tasks, and cancels them. It installs one shared close task before
awaiting anything. That task awaits all captured results, then invokes
`onClose` exactly once. Every concurrent or later `close` awaits the same task.
A cancelled close waiter does not cancel the shared cleanup task. No task
registered after closing can exist, so the captured set is complete.

The service owns this lifecycle and supplies the actual cleanup closure:
`engine.end(.closed)`, `session.invalidateAndCancel()`, registry removal.
`loadWorkspace` supplies the existing `client.loadWorkspace()` closure. The
owner must not capture the service itself: capture the engine and an internal
`LabFaultSessionResources` instance to avoid a service-owner-closure retain
cycle. That resource retains the session/host, guards one-time invalidation with
a lock, and calls the same guarded cleanup from deinit if close was omitted.
The owner's active `load` calls retain the actor through their deferred
registration removal, keeping resources alive until admitted tasks settle.
Keep the ordinary shared session untouched.

Cancellation is cooperative: the real URLSession async call responds to task
cancellation and structured async-let children must settle before the parent
operation returns. A test continuation deliberately ignores cancellation until
released, proving that close waits rather than assuming cancellation joined it.
Tests always release those continuations, including failure cleanup. No
production timeout or detached cleanup is added to conceal non-settling work.

For the store, retain its generation/expected-ID check and detach old published
state synchronously. Cancel and await the captured old read, then close the
captured old service. Do not re-read `self.read` or `self.service` after awaits.
No new store injection surface is needed.

Rejected alternatives:

- Reordering store teardown alone leaves direct service close/load concurrency
  unsafe, although the reorder is still required for caller ownership.
- A cancellation check or earlier registry removal alone retains the
  check-to-task-creation race.
- Replacing the real transport or adding a sleep only hides the CI failure.
- Changing generic networking or authenticated session resolution broadens this
  local ownership repair without improving its lifecycle proof.

## Review focus

1. Several admitted loads and their structured children must all settle before
   cleanup; `testCloseRejectsNewReadsAndDrainsEveryAdmittedReadBeforeInvalidating`.
2. A cancelled caller must cancel its registered operation without closing the
   usable session; `testCallerCancellationReachesOwnedReadAndAllowsRealRetry`.
3. Concurrent/cancelled close waiters must share one non-cancelled cleanup and
   may not return before cleanup; `testConcurrentCloseWaitersShareOneCleanup`.
4. A stale preview close or late callback cannot alter a replacement preview;
   retain the original failing Lab test and its identity asserts unchanged.
5. Background stop/reload, synthetic isolation and diagnostic cancellation must
   remain intact; retain existing LabFault and LabClientSpan tests and run them
   together under the parent-owned native session.

## Milestones

### 1. Design and regression contract — complete

**Files:** This plan and
`apps/ios/Tests/LabFaultSessionLifecycleTests.swift`.

- [x] Preserve the real old-main CI RED and distinguish it from unrun new tests.
- [x] Write deterministic owner tests using test-local continuation barriers.
- [x] Parent reviewed and accepted the owner API and test contract, authorizing
  the implementation after the plan and tests were written.

The tests exercise the owner that the application will use. Their suspended
operation bodies are scheduling controls, not substitutes for the transport;
their success/retry path calls the actual service, and existing transport
decoder tests remain required. These tests were written before the owner
existed. Missing-symbol compilation was not used as a RED and no compile or test
was run.

### 2. Implement one lifecycle contract — complete, verification pending

**Files:** `apps/ios/Sources/Services/LabFaultTransport.swift`,
`apps/ios/Sources/Features/LabFaultStore.swift` and adjacent tests if needed.

- [x] Implement the exact owner API above with before-await admission, explicit
  cancellation forwarding, registered-task drain and one shared cleanup task.
- [x] Wire every service read and close to that owner; preserve real cleanup and
  make deinit fallback idempotent without a retain cycle or async deinit work.
- [x] Join the store's captured old read before closing its captured old service.
- [x] Re-read the owned source for reentrancy, task-local ancestry, registration cleanup,
  structured-child completion and old/new preview ownership.

### 3. Parent-owned verification and delivery — active

- [ ] Parent checks resource guards and existing native session ownership, then
  runs the narrow `LabFaultSessionLifecycleTests`, `LabFaultTests` and
  `LabClientSpanTests` checks through `dev-ios-session run -- <repo command>`.
- [ ] Parent runs `pnpm docs:check` and applicable repository gates, records exact
  command/head/results, and obtains independent review for this concurrency fix.
- [ ] Parent handles the one GET-322-associated PR, latest-head CI, normal merge
  and any required native acceptance. Do not infer UI journeys from unit green.
- [ ] Parent restores Linear write/readback when available; no alternate account
  or new issue. Do not mark completion before applicable acceptance is real.

Proposed narrow command after the parent selects/holds the existing primary
session and assigns exact artifact paths:

```bash
dev-ios-session run -- env \
  IOS_ONLY_TESTING=TalentSignalTests/LabFaultSessionLifecycleTests,TalentSignalTests/LabFaultTests,TalentSignalTests/LabClientSpanTests \
  scripts/ios/check.sh
```

This command is a recommendation, not a recorded run. The fixture itself uses
only a random `lab-fixture` origin, its instance-specific URLProtocol and
`LabFaultFixtures` credentials. Its client is already authenticated with those
synthetic values and the synthetic transport bypasses real-session preflight;
the added tests do not read or write a local user's account or call a model.

## Completion evidence

The saved CI RED remains linked; the new tests compile and pass on the exact
reviewed revision; the original failure case passes without timing mitigation;
real transport decoding, cancelled diagnostics, background recovery, stale
preview IDs and shared-session isolation remain covered. The source review
confirms no path can create a session task after close invalidates that session,
and every close waiter observes completed cleanup. Report local tests, review,
CI, merge and native acceptance separately.
