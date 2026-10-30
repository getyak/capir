# GET-343: Start the queue expiry UI test from a visible observation

## Outcome and boundary

Make the synthetic queued-expiry UI test begin its single observation only
after navigation has reached a visible, operable fixture. The real production
progress component must then expire that observation without a later store
update, revealing the same-message recovery action.

Only the DEBUG conversation fixture and its UI test are in scope. Production
queue state, the 65-second observation lifetime, TimelineView, retry policy,
provider behavior, account data and installed binaries are unchanged. This is
test-lifecycle repair, not live product acceptance.

## Evidence and unknowns

- Main `c1073b38531b84cfab6d19629d4ec9bb1464acdc` CI `41058033862`
  failed the initial `Queued for processing` assertion at line 126 in
  `testQueuedStatusNaturallyExpiresWithoutAnotherObservation`. Its later
  expiry and recovery assertions did not run.
- The old fixture initialized a timestamp during view construction and aged
  it by 45 seconds, leaving only 20 seconds before the unchanged 65-second
  production expiry. The job log shows about 41 seconds from entry tap to
  the first queued-text query. Exact state-mount time and the alternative
  rendered label were not observed.
- PR quick and main smoke selectors already include this exact UI case.
  No selector broadening, retry, skip or gate exemption is needed.
- The original failure log and independent diagnosis remain in the local
  video-review evidence; this plan does not reproduce private raw logs.

## Approach

1. The flagged fixture starts with no queue observation. Its normal
   production component displays the admitted-message waiting state while
   navigation, scrolling and XCTest quiescence finish.
2. A DEBUG-only, fixture-local `Observe queued status` button publishes one
   fresh observation after the UI test has verified that the control is
   hittable and at least 44 points tall. The control keeps its identity and
   layout but becomes disabled. A guard also prevents a second observation.
3. The same production progress view now receives the fixed timestamp, with
   no 45-second backdating. The test verifies queued status and absence of
   the recovery action, then waits for the unchanged real lifetime. Its
   90-second bound covers the full 65 seconds plus scheduling slack; this
   bound accompanies the lifecycle change and does not itself repair it.
4. No tap, timer or callback publishes another observation to force expiry.
   The existing production TimelineView must reveal `Check status`, retain
   the original message identity and provide its existing 44-point target.

Moving Date only to `onAppear`, shortening production TTL, overriding
XCTest quiescence, increasing the old timeout alone, or retrying/skipping
the assertion were rejected because they leave the setup race or weaken
the property under test.

## Milestones and verification

1. Updated the UI regression first. On the old fixture the new observe
   control is absent; no new native RED execution was run. The original
   main failure remains the observed RED evidence.
2. Added the smallest DEBUG-only one-shot observation fixture control after
   the parent accepted the design. It retains a fixed label/identity/layout,
   disables after use, and guards the action against later renewal.
3. **Active:** Parent runs relevant lightweight policy/docs checks, independent review,
   then the exact UI selector through the approved native/CI boundary. Keep
   original production-state tests and all same-message recovery assertions.
4. After candidate gates pass, parent performs normal merge and reads the
   new main CI result. Keep the previous main failure as historical evidence.

No tests, native build, simulator operation, service deployment, network call,
account operation or Git publication has been performed by this plan's author.
The parent owns all execution and final acceptance.
