# GET-39 Today consumption implementation plan

> **For agentic workers:** Use `superpowers:executing-plans`; the parent implements this plan, then an independent Codex reviewer checks the entire branch. The user's continuous-delivery authorization supplies this execution method and routine design authority.

**Goal:** Make Today a dated, bounded consumption surface for currently authorized work, unread conversations and actual user-authored arrangements across Web, the shared Mac product and native iOS.

**Architecture:** Preserve the existing governed Pursuit projection. Add a read-only, credential-bound context projection from the existing Time and Session contracts. Web and Mac share the actual authenticated page; iOS reads the same canonical Time schedule metadata instead of treating a device-local calendar as shared truth. Views never generate a model brief, confirm a fact, send a message or create a calendar effect.

**Tech stack:** Next.js 16.3.8 / React 19.3, existing TypeBox contracts and refresh coordinator, SwiftUI with iOS 16-compatible `ObservableObject`, existing authenticated URLSession transport.

**Spec:** [GET-39](https://linear.app/getyak/issue/GET-39/today-的设计), `docs/product.md`, `docs/design-system.md`, `docs/operations/time-workspace.md`, ADR 0016, and the fixed acceptance matrix below.

## Current evidence and scope

Base `94bf30500d9056e014445e985d301fec95ead01a`; branch `codex/get-39-today-consumption`. The original checkout has unrelated untracked files; this task has an independent worktree. GET-48 remains open while exact main CI and signed-package acceptance run. Do not merge this next branch until that publication is verified.

The signed-in deployed Web Today was actually observed using the authorized default account: duplicate Today titles and a generic slogan, no date, and an empty state derived only from Pursuits. The integration branch is enabled on that deployment; the source's disabled-mode redirect alone is not a runtime observation. Native iOS already has a date, unread entry and calendar peek, but canonical `RelationshipCalendarProjection.activities` returns no shared schedules and the peek combines device-local records. Mac's ordinary product window uses the shared authenticated Web; native tools are not a second product implementation.

Baseline: 22 focused Web tests pass; all 806 locked packages reused offline, with a task-owned virtual store and workspace links resolving this checkout. Actual default-account and empty isolated `capir test` identity/readback are retained in the task record. No model was called.

### Decisions and alternatives

1. Consume existing authorized information; do not invent a daily AI brief or infer relationship value from inactivity. Existing source-backed review items remain the insight/decision producer. A person with no actual supported change does not acquire a fabricated follow-up.
2. Include only an existing unread conversation continuation, not the full Session directory. Titles remain display-only and unconfirmed; opening its exact Session is the place to inspect the result. Reading Today never marks a Session read or grants old answer citations/execution authority.
3. Read planned, user-authored canonical schedules within seven local dates including today. Include ongoing/all-day items, exclude completed/cancelled entries, and do not treat elapsed time as completion. Display the next item plus honest coverage; do not claim the whole calendar was searched beyond this range.
4. Preserve local iOS calendar records and their separate authority. Do not migrate, relabel as shared or silently delete them. A canonical Today schedule opens an explicitly read-only native detail; Web links to the exact existing time-workspace item.
5. Make the authorized Today consumption shell reachable even when legacy Pursuit integration is disabled. In that mode, omit the disabled Pursuit producer rather than enabling fixture authentication or failing the available schedule/Session surfaces.

Rejected: static mock production cards; enabling fixture mode as the feature; a new canonical Today database; reading raw conversations into a model; automatic follow-ups; full cross-device calendar editing/migration; arbitrary external calendar writes; taking over the running user's Mac profile.

## Global constraints

- Only this Linear issue, its PR and delivery evidence may be written externally.
- Default real application account is `test@cubxxw.com`; verify exact current account/user/origin before writes. Use the named disposable test space for synthetic data and verify cleanup.
- Do not use Pi, MiMo, paid model fallback or a new timer. This feature calls no model.
- No provider credentials, private conversation text or passwords enter source, public evidence or test logs.
- Keep metadata memory-only and credential-bound. Reject mismatched response bindings/scopes and discard late responses after account, date or zone changes.
- Reuse the existing active-refresh coordinators; pause hidden work, coalesce in-flight reads and use bounded requests. Never add a parallel polling system.
- Maximum three Time pages of 100 items per refresh; stop on complete, repeated cursor, scope mismatch or failure. Session coverage remains that of its bounded returned directory; no global count is inferred.
- All requests have bounded cancellation; error/partial/loading are not verified empty states. One failed source does not erase independently valid content from another source.
- Preserve browser sign-in, effects approval, existing Pursuit review, privacy and account isolation. No data migration is required.
- Run storage audit before tests and resources before heavy builds. One local heavy build at a time; native runs use `dev-ios-session` and the existing device pool.

## Fixed acceptance matrix before implementation

| ID | Scenario and expected result | Verification; failure condition |
| --- | --- | --- |
| T1 | Authenticated Today is reachable with either Pursuit mode. The disabled mode reads no fixture/Pursuit source and still shows its independent authorized consumption shell. | Execute route branch tests and real default entry. Redirect to conversation, fixture fallback or data from another identity fails. |
| T2 | Header leads with the actual local calendar date and weekday, without the old generic slogan. Midnight, foreground return and DST keep the correct date/zone. | Literal timezone/date boundary tests and rendered date readback; UTC substitution, hydration mismatch or stale date after refresh fails. |
| T3 | One next planned user-authored canonical arrangement is shown within the stated seven-local-date range, including ongoing and all-day events. | Hand-derived fixtures against TS and Swift projections, then same actual schedule on Web/Mac/iOS. Cancelled/completed/unconfirmed meeting draft presented as an arrangement fails. |
| T4 | The arrangement displays title, day, time/all-day and explicit zone/source; clicking reaches that exact record and revalidates authority. | Real Web source navigation and native read-only detail. Wrong ID, stale removed content or implicit calendar write fails. |
| T5 | Existing governed Pursuit review/action/gap items retain evidence availability, due time and explicit review authority. | Existing real component and projection regressions, revoked/partial fixtures. Interpretation promoted to confirmed state or an automatic external effect fails. |
| T6 | Only existing active, unexpired unread Session metadata becomes one continuation. No full-history dump, body copying, implicit mark-read or execution authority. | Strict real-response projection tests, actual seeded unread/read state and exact navigation. Expired/foreign/stale response, message body in Today or changed read state on viewing fails. |
| T7 | Verified complete empty sources yield a calm scoped no-action state; loading, unavailable and partial responses remain distinct. | Deferred reads, malformed data, timeout and incomplete-page tests plus actual empty space. A missing read presented as no work fails. |
| T8 | Pagination is bounded and preserves useful returned records while honestly stating incomplete coverage. | 0/1/3-page, repeated-cursor, changed-scope and over-limit fixtures. Unbounded reads or a false complete result fails. |
| T9 | Account/user/token switch, logout and expiry clear old private content and invalidate copied/late callbacks before publication. | Deferred real consumers with identity A/B and coordinator release. Any old title, link or request revived in B fails. |
| T10 | Date/zone change, source deletion/cancellation and permission withdrawal remove obsolete current claims after a fresh read; failures offer retry. | Actual own synthetic mutation/readback and focused recovery tests. Stale claim retained as current or retry using an old credential fails. |
| T11 | Existing shared refresh coalesces active reads and stops hidden/released work. No timer duplication or stale body completion. | Behavioral coordinator/store tests; check requests on real foreground/retry. Concurrent duplicate in-flight requests, hidden polling or publication after release fails. |
| T12 | Web/Mac consume the same production route and iOS reads the same exact canonical arrangement, including its ID/revision/zone and user authorship. Local records remain separate. | Cross-client real synthetic fixture and source/readback binding. A native preview/local copy substituted for canonical integration fails. |
| T13 | Desktop and 390 px Web are readable with keyboard Tab/Enter and visible focus; long labels and errors do not overflow. | Actual rendered screenshots, full target/scroll bounds, keyboard source/retry navigation and console checks. Obstruction, clipping, blank/overlay or broken navigation fails. |
| T14 | Native primary iPhone supports Dynamic Type, VoiceOver labels, reduced motion and recoverable read-only detail dismissal. | Focused native tests and actual primary-device rendering; use compact only for a demonstrated small-layout/keyboard concern. New Simulator, hidden content or lost retrieval state fails. |
| T15 | Reading and retrying Today cause only bounded reads, with no model invocation, message, fact, schedule write or new persisted Today store. | Request/consumer effects assertions and actual before/after record/read-state receipts. Any undisclosed write or model call fails. |
| T16 | Full requested slice passes independent review, current-head CI/protection, normal merge and affected existing-service deployment; native production acceptance remains explicit. | Bind every source/test/review/CI/merge/live revision and real behavior. No early Linear Done; a partial native or production proof stays incomplete. |

## Review focus

- Partial pages and source outages must not become claims of absence.
- The actual configured production route and authenticated constructor must use the new producer; a preview or alternate flag is insufficient.
- Repeated/cancelled requests across scope and date boundaries must not repaint old titles or start writes.
- Native device-local activities must not silently become canonical cross-device arrangements.
- Unread Session labels and authored schedules carry their own authority, never relationship fact or external action permission.

## Task 1: Web/Mac dated consumption

**Files:** create `apps/web/lib/today-context.ts`, its tests, `apps/web/components/today-context.tsx` and behavioral tests; modify `components/pursuit-today-page.tsx`, its CSS/tests and `app/workspace/today/page.tsx`; add route tests. Reuse `time-workspace-client`, `recentSessionRows`, exact time-workspace `item` deep links and `subscribeWorkspaceRefresh`.

**Interfaces:** pure `todayScope(now: Date, timeZone: string): TimeScope`; `projectTodaySchedules(pages, scope, now)` returns next item, completeness and coverage; `projectTodayUnread(payload, binding, now)` returns one valid continuation and coverage. A client context hook owns bounded reads and returns independent schedule/Session states plus a retry, keyed by binding/date/zone. The page supplies an authenticated binding and whether the existing Pursuit producer is enabled.

- [ ] Write literal T1–T11/T15 behavioral tests first; watch each meaningful failure before production code.
- [ ] Implement the bounded projections, source-specific failure states and one shared-coordinator client owner.
- [ ] Render date, next arrangement and unread continuation before existing governed attention. Remove contradictory Pursuit-only global empty copy.
- [ ] Run focused tests, full Web suite, lint/types, docs and one production build serially. Validate actual desktop/mobile/keyboard interactions and preserve failure evidence.

## Task 2: Native canonical arrangement consumption

**Files:** create focused `apps/ios/Sources/Services/TodayScheduleClient.swift`, `Features/TodayScheduleStore.swift`, `Features/TodayScheduleView.swift` and corresponding targeted tests; wire `RelationshipArchiveView.swift` to the actual authenticated session/current-identity closure and existing refresh registry. Regenerate the Xcode project with the existing generator if needed. Preserve the existing unread and governed attention producers.

**Interfaces:** an authenticated `TodayScheduleServing` reads the same bounded canonical Time scope; `TodayScheduleStore` owns independent loading/ready/partial/unavailable state, current clock, cancellation/generation, explicit refresh and invalidation. The view consumes state and a read-only selected-record detail; it never constructs auth or calls services from `body`. Source metadata and current-identity readback remain intact.

- [ ] Write T2–T4/T7–T12/T15 client/store tests, including deferred release and malformed/changed-scope pages; observe RED first.
- [ ] Implement the native projection/client/store and register it in the existing active-refresh system only while Today is active. Preserve preview/local calendar authority separately.
- [ ] Compose the small native peek/detail with existing theme and accessibility conventions, then compile before additional callsite edits.
- [ ] Through `dev-ios-session`, run the affected native tests and necessary primary-device UI acceptance. Record exact live canonical fixture readback; no preview-as-production claim.

## Task 3: Review and real delivery

- [ ] Compare the full implementation with the original issue and every fixed T criterion; record any genuine unmet requirement instead of narrowing the matrix.
- [ ] Run an independent Codex sub-agent review of the exact complete diff and evidence; fix/verify/re-review all confirmed P0/P1 and other accepted findings.
- [ ] Commit/push, create/attach an issue-linked PR and satisfy all latest-head gates without bypass. Keep GET-48's publication base stable until its signed acceptance is finished.
- [ ] Normal merge, read back the issue, deploy all affected existing services from clean source, verify live revision/real cross-client behavior, then mark Done only after all required evidence passes.
- [ ] Stop/read back the owned test run, close only owned browser/context/processes, preserve formal evidence, and reclaim only exact registered recreatable artifacts.

## Execution notes

Implementation has not started at plan freeze. The native parent execution method and independent-review gate are already authorized. Do not insert a generic brainstorming or plan-approval pause. Real missing permissions or necessary product inputs remain explicit; keep progressing on independent work while those are resolved.
