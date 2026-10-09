# Talent Signal for iOS

The native SwiftUI client opens on Pursuit-first Today. Today, Pursuits, and
People are projections of the same account-scoped canonical workspace; Inbox
opens the Proposal, item decision, revision, Receipt, and readback loop. Failed
reads do not substitute preview facts, and attention ranks work rather than a
person.

Ask opens as a focused, Pursuit-scoped AI conversation with canonical Person
and context lookup, compact prompt tools, capture, and direct record navigation.
Today keeps one decision visually primary and renders later work as quiet
continuations; it has no separate feed or generic search panel.

The bottom Capture control opens one purpose-bound chooser for Text Signal,
conversation screenshot, or Audio Signal. The `Capture Signal` App Shortcut is
suitable for an Action button configuration and only foregrounds that chooser.
`Record Signal` only opens the foreground audio surface. Neither intent starts
the microphone. Audio requires a non-empty purpose, explicit authorization,
system permission, an active foreground scene, available input, and recorder
success before the UI can say `Recording now`. Completed audio stays protected
on-device with a checksum and deletion path; this slice has no upload,
transcription, Proposal, confirmed-state, or external-write authority.

Intentional screenshot import still provides on-device text review, temporal
identity comparison, explicit relationship attachment, and a compiled-Wiki
receipt. Photos selection and the `Review screenshot` Shortcuts action enter
the same resumable review. For one-press capture, the user creates a personal
Shortcut with `Take Screenshot` followed by `Review screenshot`, then assigns
that personal Shortcut to the Action Button in system Settings. Talent Signal
cannot capture another app's screen or inspect or change that assignment. The
app action runs quietly in the background: it atomically adds the received
image to the local FIFO review queue only after content decoding plus byte and
pixel bounds succeed, then returns without network work, an app launch, or a
Live Activity. An exact retry reuses the still-pending queue item,
while a later import after completion starts a new purpose-scoped review. The
original image stays on-device in this slice; the local backend receives
recruiter-reviewed text and governed source metadata.

The app also retains the synthetic candidate-momentum fixture loop for bounded
review and action testing. The eight-case evaluation corpus itself is not
bundled in the app (GET-134); its only authoritative home is the private
[getyak/capir-evals](https://github.com/getyak/capir-evals) repository. Private,
disposable evaluation runs may inject the canonical
`evals/candidate-momentum-v1.json` as `Resources/candidate-momentum-v1.json`,
and the localhost fixture sync reads the same file served directly from a
loopback root (default `http://127.0.0.1:8787/candidate-momentum-v1.json`,
configurable via `--endpoint` or `TS_IOS_FIXTURE_URL` in UI tests). Without that
optional resource the fixture picker shows a clear corpus-unavailable state,
fixture imports fail truthfully without creating review state, and dedicated
fixture UI tests skip explicitly instead of claiming unavailable coverage. It
keeps provider keys out of the app bundle and never performs a candidate-facing
or external-system write from screenshot capture. Deterministic launch routing
and localhost sessions are compiled out of Release; a Release-specific test
verifies those arguments are inert.

## Talent Signal Lab

The native Lab has three paths: **AI experiments**, **device tools**, and
**deterministic scenarios**. Debug builds expose device tools in the workspace
and at sign-in even when the backend is unavailable. Internal Release builds
may explicitly set `TALENT_SIGNAL_DEVICE_LAB_ENABLED=YES`; the default is `NO`.
That flag grants no remote capability and enables no simulated authentication.

Device tools show build/environment metadata, make a read-only connection
probe, inspect compiled page states and display settings, and provide scoped
maintenance with reviewed effects. The isolated onboarding preview preserves
account state, pending evidence, recovery records and saved onboarding progress.
The app cannot reset iOS system permission decisions.

**Data & restart → Restart a device test** selects shared URL-cache cleanup,
display defaults, local diagnostic history, synthetic Demo reset, saved local
onboarding progress, canonical workspace refresh and current-session sign-out. The confirmation
names retained data, destination and current system permission status. The
authenticated API session itself has no URL cache. Onboarding reset changes
only the Welcome route and introduction flag; it never deletes recordings or
replaces the saved account, evidence or decisions. A server-created empty test
workspace remains a separate pending capability.

**Reset the saved synthetic Demo** also appears in the existing Debug-only
standalone Settings, independently of server sign-in and the internal Lab flag. It recognizes an
unchanged catalog example; personal captures, recordings, mixed sources and
edited proposals are ineligible. Review binds the exact saved state. Replacement
preserves imported-source ownership, queued capture IDs, calendar choices and all
media files. The replacement session ID reconciles a lost receipt without
resetting later work. Standalone Welcome can reopen the retained reset history.
Its protected journal uses the same bounded, explicit retry lifecycle as Lab
maintenance. Demo reset does not clear global Live Activity stop requests.

Reset intent and each step result use a protected, bounded non-content journal.
Relaunch never silently repeats a step. Review can resume the original operation
or stop further steps while retaining uncertain outcomes. Active writes and
recording block maintenance. The original environment/account must match before
pending device steps resume; an earlier logout targets only its old credential.

Sign-out records protected intent before closing account views and shortcut
recovery. Late validation cannot reopen that session. Local credential removal
and server revocation have separate receipts, accessible at sign-in and in Lab.
Failed remote revocation retains a protected, revocation-only credential until
resolved or its reported expiry; expiry is not a fresh server verification.
Retry preserves a newer sign-in and can remove an old identity slot after its
revocation credential has been discarded. Normal sign-out preserves scoped
drafts and operation recovery rather than treating them as caches. These records
never enter diagnostic exports. See the [reset evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-reset/README.md).

**Appearance & accessibility** opens the actual People, Today, Sessions,
concise review, full-evidence review and onboarding components with synthetic
fixtures. Relevant pages offer loading, empty, failed, stale, incomplete and
long-content states. Selection, retry, session deletion and review stay in the
preview's memory; this route neither loads canonical workspace content nor
starts a provider request.

Theme, English/Chinese, Dynamic Type, card density, reduced app motion,
opaque surfaces, contrast rendering and component outlines are independent
controls. System accessibility sizes and reduced-motion/transparency settings
remain authoritative. Contrast is explicitly a rendering simulation, not a
system-setting override or an accessibility certificate. Bounds outline the
page and shared People, Sessions and Today decision cards; they do not measure
all UIKit hit regions or text baselines.

A display trial applies to the current app for 5, 15, 30 or 60 minutes. Its
in-memory, sleep-aware monotonic deadline is independent of wall-clock changes.
Restore, expiry, account/environment change or relaunch returns to the saved
preferences. A visible trial banner provides a direct restore action. Up to ten
named device-only presets can be saved; loading a preset never auto-applies it.
The separate **Save theme, language & density** action confirms and reads back
those personal preferences. Accessibility simulations remain temporary. Normal
Settings also exposes the persistent theme preference.

**Performance & diagnostics** records an explicit device session for at most
ten minutes. Choose a task, close Lab, reproduce it, and use the visible marker
and stop controls. Reports contain closed task/route/method/error categories,
monotonic offsets, client request duration and available URLSession transaction
phases. The per-task metrics delegate preserves the runtime's no-redirect rule.
No request or response body, raw header, full URL, account identity, source
content, raw error or screenshot is included. Requests finishing after stop cannot
rewrite a saved report or another session. An unauthenticated health probe is
available from configured environments, including sign-in.

Client spans associate workspace reads, relationship/conversation tasks, image
research, media upload, common request encoding/decoding and workspace state
updates with their requests. Capture coverage also includes protected image
preparation, capture-review preparation, audio-session preparation, audio
payload finalization and voice transcription. Concurrent tasks retain separate
ancestry. Failed, cancelled and unfinished work retains that outcome.

Key capture and Agent views record the first display-link callback after the
surface is presented. This confirms one main-run-loop callback only; it does not
prove that pixels reached the display, measure GPU work, represent a usable
screen or provide first-token timing. A state update still measures store
publication rather than a rendered frame. See the
[automatic-stage evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-automatic-stages/README.md).

During explicit capture, admitted runtime requests carry a random correlation
UUID. A capability-enabled backend can return bounded typed stage metadata for
authenticated work or read-only health. The client retains only a validated,
matching trace. Context, model adapter, Agent tool/schema validation and database
connection/commit stages use actual code boundaries. The model adapter includes
its own preparation/validation and may overlap tool work; it is not first-token
timing. Server offsets use a separate monotonic clock and cannot be subtracted
from device timestamps. Missing/unsupported stages remain missing. Synthetic
proof servers retain their explicit origin. No server trace is written to a
backend database or log by this collector.

Every two seconds, a recording samples physical memory footprint, thermal and
low-power state, and display-link callback cadence. This is not rendered FPS,
GPU time, a leak diagnosis or cold-launch timing. Manual
first-content/usable/problem markers record the tester's observation.
`LabDiagnosticSession`, `LabClientStage` and `LabDiagnosticMarker` signposts support a separate
Instruments investigation; the app cannot launch Instruments from TestFlight.
Sampling/checkpoint work is measured separately, not claimed as total overhead.

The device retains at most five reports for 24 hours, pruned on launch,
foreground and Lab access. Each report bounds requests to 160, manual markers
to 60, device samples to 301 and client spans to 120. Each request retains at
most 16 server spans from a header of at most 4,096 characters; dropped-event
counts disclose partial data. The complete local archive is capped at 6 MB.
Protected app-private storage is excluded from backup and read back after
atomic writes. Six-second checkpoints recover as interrupted after relaunch,
with unfinished attempts preserved and no automatic recording restart.
Background or account/environment change ends recording and closes an export
preview. Storage failure stops recording with a retryable local result; corrupt
files cannot be overwritten by starting or exporting a report.

Review the exact JSON before exporting a separate copy. Clearing diagnostics
verifies removal of the diagnostic file only. It preserves experiments,
captures, drafts and independently exported copies.

**MetricKit history** receives typed summaries on a physical device after an
explicit start. Reception lasts until pause, process exit, account/environment
change or a 24-hour monotonic limit. It never resumes automatically on relaunch.
Delivery while backgrounded depends on iOS. The Simulator exposes an explicitly
synthetic, memory-only layout example; it cannot start a system subscriber.

The projection retains report begin/end, receipt time, an admitted app-version
string and multi-version flag when provided; available cumulative CPU/GPU and
foreground/background time; peak memory; bounded first-draw/hang histograms;
and available crash/hang/CPU/disk/launch diagnostic-entry counts. Missing fields
remain unavailable. These totals and distributions are not live utilization,
crash-free rates, per-task timing or proof of a model/backend cause. Raw payload
JSON, metadata, signposts, exception text and call-stack trees are never retained.

At most 20 summaries covering the last seven days fit a 1 MB archive, with at
most 64 buckets per histogram. App-private atomic/readback storage is protected
and excluded from backup. Loading, foreground and Lab access prune old entries.
Corrupt files remain preserved until an explicit clear; failed saving pauses
reception and keeps a retryable in-memory result. Reviewed exports contain one
typed summary and use the same save/readback flow as diagnostic exports.

Clear pauses reception and atomically replaces saved summaries with a small
deletion watermark. Old queued callbacks and system-held past payloads cannot
repopulate the cleared history, including after relaunch. The watermark expires
once its window is outside retention. It does not delete system-held reports or
independent exported files. Current native/source proof and the separate
physical-device delivery gate are recorded in the
[MetricKit evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-metrickit/README.md).

**Isolated fault tests** opens a read-only synthetic workspace through the
actual workspace client, decoder, store and compiled People/Today pages.
Presets cover offline reads, two-second latency, one 401/429/500 response,
an interrupted JSON response and unavailable evidence references. Choose one
or five minutes; stop the fault and reload to compare the healthy fixture.
One-shot faults affect the People endpoint once, so parallel reads cannot
consume the fault unpredictably. The request trace retains at most 120 events
in memory and shows the response status separately from transport delivery.

This uses a dedicated ephemeral session and a custom `lab-fixture` scheme;
only three fixed GET routes and synthetic credentials are accepted before
dispatch. It never changes the normal runtime session, account or backend.
Expiry stops new fault injection; an already delayed request can still finish.
Stop/background cancels the current read. Closing cancels and discards the
entire session, and relaunch never restores it. Model calls and writes are
unavailable. Diagnostic reports label these requests as synthetic; their
timing is not real server performance. System history and task diagnostics
remain independent of this synthetic transport.

AI experiments require a signed-in, capability-enabled backend and migrations
through `044_lab_ci_verifications`, also required by backend readiness. Select
relationship text, relationship image understanding, or Workspace Agent, then
registered synthetic cases, two admitted model/prompt configurations,
repetitions, and a call limit. The server freezes the reviewed catalog and
inputs before dispatch, owns the batch while the app is closed, and preserves
each execution's output, checks, actual configuration, time, and reported usage.
Case counts and repeated runs stay distinct. Same-model/same-prompt runs measure
repeatability.

Stable IDs recover lost responses without starting a second paid batch. Cancel
stops unissued calls; a dispatched request may finish and be charged. Worker
loss after reservation becomes unknown and cannot automatically repeat that
call. Graceful shutdown resumes only unissued attempts. Results expire after
seven days, with non-content tombstones preventing late replay. Batch reviews
record preference and typed issues separately from correctness or release
approval. Existing single-case comparisons remain a secondary history path.

`TALENT_SIGNAL_LAB_DAILY_CALL_LIMIT` bounds reserved batch calls per workspace
and UTC day (default 240). It does not claim to cap monetary spending or normal
product task usage. Image jobs bind a registered fixture identifier and digest
in the immutable definition, then materialize verified bytes only at provider
dispatch. Workspace Agent jobs reuse the product executor against a closed,
read-only synthetic contact directory. Local-only tool resolutions record zero
remote requests and no actual model; remote execution records the admitted
actual configuration. All tasks retain zero business-write authority. See the
[text batch evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-batches/README.md)
and [image/Agent parity evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-batch-task-parity/README.md).

Open a completed case output to **Save this failure as a regression**. Choose
typed issues and the expected behavior; the server retains that exact attempt,
input and configuration snapshot for 90 days. A rerun uses the same input and
reference time with currently admitted configurations. Expected behavior and
review notes never become model input. Pending mutations recover by stable ID
in a protected, environment/account/user-scoped file; confirmed content stays
server-owned. Deleting a case clears its saved content, derived cases and rerun
results, including results that arrive late. Export is a separately reviewed
copy with no execution authority. See the [regression evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-regressions/README.md)
and [evaluation consumption command](https://github.com/getyak/capir-evals/blob/main/evals/v2/README.md#consume-a-lab-regression).
The saved case's **CI verification** page reads a trusted GitHub workflow's
existing report for one selected rerun. It shows record integrity separately
from output quality and release enforcement, preserves lost-response recovery,
and makes unconfigured or stale verification visible. A local report or workflow
configuration alone never verifies remote execution. Operators configure the
[CI trust and readback workflow](../../docs/operations/lab-ci-verification.md).

Backend operators use the existing admitted Chat configuration and optionally
set `TALENT_SIGNAL_LAB_CHAT_MODELS` to up to four additional pinned model IDs.
Alternatives require `TALENT_SIGNAL_INTERNAL_LAB_ENABLED=true`. Set
`TALENT_SIGNAL_BACKEND_REVISION` to the deployed revision; otherwise the UI
reports it as unavailable. Secrets stay server-side.

**Models & session trials** uses the same admitted catalog and migration
`041_lab_task_trials`. Select relationship
text, image understanding, or workspace conversation, then an available model,
curated prompt preset, and 5–60 minute duration. Only this authenticated sign-in
is affected. Other sign-ins for the same user keep their default configuration.
Expiry or **Return to default** restores new tasks; accepted tasks retain their
original configuration. Image choices require the existing sensitive-processing
admission and an actual configured image model.

Before activation, the tester freezes a question, 5–60 minute observation
window, minimum unique-request sample target, product-adoption success signal,
fallback/failure guardrail, and automatic stop threshold. Replaying the same
product request does not add a sample. The result reports accepted, fallback,
failed, and unverified counts with explicit uncertainty; it never authorizes a
causal claim. Guardrail, expiry, manual stop, and replacement restore the task
default for new work.

Trials preserve the product's governed Agent tools and scope. Execution records
separate provider completion from whether the product used the result or fell
back. They contain configuration, timing, and reported usage metadata, never
task content or hidden reasoning. A trial makes no model call until a normal
product task runs. Unknown configuration responses recover by their saved ID;
changing sign-in cannot replay a previous session's pending request. These
personal trials are distinct from online A/B assignment and experiment reviews.
See [session-trial proof](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-task-trials/README.md).
See [controlled-observation proof](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-controlled-observation/README.md)
for the signed product journey and bounded database evaluation.

**Feature overrides** exposes a closed, revisioned catalog rather than an
arbitrary flag editor. The first admitted feature changes relationship citation
presentation from a source-only card to an inline exact excerpt. It reuses the
same reviewed, authorized citation and does not change evidence availability,
confirmed state, identity, ranking, or action authority. The page shows the
server value, this sign-in's override, the actually effective value, dependency,
definition revision, and expiry.

Overrides use migration `046_lab_feature_overrides`, one active value per
feature and authenticated session, exact replacement IDs, bounded expiry, and
stable mutation IDs for lost-response recovery. A new relationship task freezes
an adoption receipt into its context manifest after idempotency replay has been
resolved. Stopping or expiry restores the server value for later tasks; an
earlier answer retains its original receipt. Account, session, catalog, or
backend revision changes cannot carry an active override forward. See the
[feature-override proof](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-feature-overrides/README.md).

**Build & environment → Environment & version** switches only among compiled,
approved targets. Supply `TALENT_SIGNAL_ENVIRONMENT_PROFILES_JSON` to
`ios:configure` as an array of `{id, name, endpoint, expectedDeploymentID}`.
The generator writes an encoded `TALENT_SIGNAL_ENVIRONMENT_PROFILES_BASE64URL`
value; it rejects extra fields and credentials. Release endpoints require
HTTPS. Each target must expose `/v1/runtime/manifest` and `/health/ready`; set
`TALENT_SIGNAL_DEPLOYMENT_ID`, `TALENT_SIGNAL_BACKEND_REVISION`, and
`TALENT_SIGNAL_DATA_DOMAIN` on the backend. Missing production deployment
identity blocks switching. A revision describes an already deployed backend;
it does not install an app binary or roll back a database.

The selector verifies identity and contract before sending target credentials,
rechecks on activation and saved-target relaunch, partitions credentials and
recovery by environment/account/user, and rebuilds the workspace. Pending
sources stay in their original scope; active writes or recording block the
switch. Return through the same selector. See the
[runtime evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-runtime/README.md)
for the Simulator proof and its live-deployment limits.

The original five synthetic replay scenarios, Signal Lens, Reality Receipts,
and explicit Eval promotions remain under **Deterministic scenarios**, sharing
the same contracts with Web. These fixed outputs are not live model results.
For Simulator verification, the existing Debug-only `--workspace-backend-url`
route authenticates through the same loopback fixture account. See
[ADR 0012](../../docs/decisions/0012-useful-device-lab-and-real-experiments.md)
for the product and isolation decision.

## Requirements

- Xcode 26 or newer
- XcodeGen 2.45 or newer
- An Apple Development team with access to `com.talentsignal.app`, its App
  Group `group.com.talentsignal.app`, and the embedded Share/Live Activity
  extension identifiers

## Generate and run

```sh
cp .env.example .env
pnpm ios:generate
open apps/ios/TalentSignal.xcodeproj
```

Set `TALENT_SIGNAL_API_BASE_URL` in the ignored root `.env`, then select the
`TalentSignal` scheme and an iOS 16+ simulator or device. The shared Debug
scheme enables `--preview-workspace`, and a no-argument Debug relaunch from the
Simulator or device icon keeps opening the synthetic relationship workspace.
This local design default never applies to Release. `ios:generate` parses
the value as data, validates it, and writes an ignored
`apps/ios/Config/Environment.local.xcconfig`; it never sources `.env` as shell
code. Re-run `pnpm ios:configure` after changing the URL without regenerating
the Xcode project. UI tests can still inject the same preview boundary through
a Debug-only launch environment. Explicit fixture and showcase routes remain
available without authentication.

Release builds require an HTTPS `TALENT_SIGNAL_API_BASE_URL` and use
Sign in with Apple before opening the workspace. Configure the App ID capability
and set the backend's `APPLE_SIGN_IN_AUDIENCES` to the same client identifier.
The backend verifies the Apple assertion and issues the application session;
the app stores that session in the device Keychain. Debug builds can override
the preview default and show the real login surface against localhost with
`--show-login --auth-backend-url <loopback-url>`, but deterministic simulated
login remains a Debug-only fixture path.

## Standalone onboarding showcase

The Debug app includes a backend-independent onboarding adapter for the first
verified-progress journey. It is isolated from the authenticated canonical
workspace and never appears because a backend read failed.

Add these scheme launch arguments to start a fresh deterministic showcase:

```text
--standalone-onboarding-reset
--standalone-demo
--demo-proposal-engine
--simulate-action-button
```

The journey creates a protected local session and Pursuit, labels every Demo
Meeting, Demo engine result, and simulated Action Button event, and reaches a
persisted local Today projection only after the user confirms a sourced change
or accepts a next action. Remove `--standalone-onboarding-reset` to verify
relaunch recovery. Settings inside standalone Today can replay onboarding or
review a synthetic Demo reset. Neither path deletes recordings, user-authored
Share captures, system permission decisions or Calendar events. The explicit
clean-launch argument resets only its local session file and preserves media;
it is not the reviewed Demo-reset command.

Calendar is outbound-only. A recruiter confirms the final title and time in
Talent Signal; the app persists the relationship-scoped event first, then uses
EventKit write-only access to add it to the system default calendar. Settings
can disable this projection. Talent Signal never imports, listens to, or
rechecks Apple Calendar events, and a failed device write leaves the in-app
event available for retry.

For real voice proof on iOS 26+, choose Voice, confirm the purpose-bound capture
authorization, and start the recorder while the app is foregrounded. The Draft
exists before the microphone prompt. Audio is atomically finalized under
Application Support. When available, `SpeechAnalyzer` and `SpeechTranscriber`
receive the foreground audio stream and progressively update the editable
transcript. When permission, locale, model assets, or device support is
unavailable, the same local Draft remains editable as text and the recorder
falls back without inventing a transcript.

While that foreground recorder is active, the embedded Live Activity shows
only `Recording Signal`, elapsed time, and Stop. It then moves through
`Saved · Organizing` to `Ready to Review`; it never exposes a name, meeting
title, transcript, or Proposal on the Lock Screen or Dynamic Island. Its Stop
control writes a draft-scoped request through the App Group. The recorder and
persisted Draft remain authoritative if Live Activities are disabled.

The app exposes `Capture Signal`, `Review Signal`, and `Open Pursuit` first in
App Shortcuts, followed by the foreground-recording helper. `Review screenshot`
remains available as a Shortcuts action with a required image input so it can
receive the output of `Take Screenshot`; it is intentionally not advertised as
a one-step App Shortcut. Only the user can map a resulting personal Shortcut in
system Settings. The Simulator `Simulate Action Button` control is Debug-only,
visible as `Simulated`, and is not physical-device proof.

## Agent lifecycle showcase

Add `--agent-work-showcase` to the Debug scheme to open the synthetic Agent
handoff directly. The showcase uses real ActivityKit surfaces and manual,
deterministic stage controls:

```text
Signal received → Read evidence → Check identity → Prepare actions → Actions ready
```

It includes two synthetic paths. One proposes separate update-contact and
create-meeting cards for an existing person; the other requires explicit name
and channel review before a create-contact card can appear. The Dynamic Island
and Lock Screen expose only task phase, attention, and an opaque exact-instance
route. Candidate details and every consequential decision remain in the app.
No demo card writes to Contacts, Calendar, ATS, CRM, or a messaging service;
the final state is a local review handoff rather than a claimed external result.

Relationship Ask uses the global composer as a direct voice ribbon. Tap the
home text surface to type or touch and hold it to enter voice immediately. Hold
an empty Session composer to speak, release to create an editable transcript,
and tap Send only after reviewing the provider-final words. Slide up to continue
hands-free, or slide left to cancel. A tap on the connection mark starts the
same hands-free path for accessibility. When the device supports on-device
Speech recognition, partial words stay inside the ribbon while recording;
Doubao produces the provider-final editable draft under the first-use disclosure.
Temporary audio is deleted after transcription or cancellation.

An admitted remote Ask starts a separate private Live Activity. Its payload is
limited to opaque workspace, Session, and activity-instance identifiers plus
phase and revision. Waiting is shown by the animated connection mark; completion
shows `Review`; failure or timeout shows one concise retry entry. The Activity
never carries the question, transcript, person, relationship, answer, or
evidence, and its deep link returns to the exact protected Session. For
Simulator visual inspection, launch Debug with
`--fixture-agent-ask-activity --fixture-agent-ask-phase thinking`; phases also
accept `review`, `failed`, and `timedOut`.

The controls advance only when tapped, so this route proves UI projection and
state ordering, not background delivery, APNs, elapsed time, or an ETA. Starting
a new synthetic run closes an older run for the same task and assigns a new
Activity instance so a completed revision cannot block the new lifecycle.

The `Talent Signal` Share Extension accepts one image, text item, or web URL.
After the user taps Post, it writes the payload first and atomically appends a
versioned `CaptureEnvelope` to `group.com.talentsignal.app`. The containing app
imports each stable envelope ID once and opens the same editable Signal →
Proposal → Review path. For an image without a note, the user must add a Signal
before processing; the app does not claim the Action Button can read another
app's screen. Verify on a signed device by sharing from Photos, Safari, or a
text selection, then reopening the standalone Debug showcase.

## Verify

```sh
pnpm ios:check
```

When `TS_IOS_BACKEND_URL` points the check at an existing backend, also set
the backend's matching `DATABASE_URL` through its governed secret boundary.
The check fails before building when this explicit pairing is absent, rather
than allowing canonical fixture setup to fall back to the default local
PostgreSQL port. Omit both variables to let `ios:check` create and clean up its
own isolated backend and database.

To prove the signed-in, canonical Ask journey reaches the admitted Zhipu
provider and renders its answer in the current viewport, run:

```bash
pnpm ios:e2e:remote-chat
```

This focused test injects the development secret at process start, enables
remote Chat processing only for its isolated backend, and fails unless the
UI exposes the provider-neutral `Agent answer` provenance label. The regular
`ios:check` remains deterministic and does not require or invoke a remote
model. Treat the test
result and its screenshot attachment as proof: reopening the installed test app
does not retain the test's temporary backend session and returns to account
setup instead of silently opening Preview data.

The check script builds Release without signing, boots an available iPhone
simulator, and runs the unit and UI tests. When Docker is available it starts
an isolated local backend and synthetic fixtures for backend-dependent
journeys; otherwise those journeys may skip.

Dynamic Type UI tests use `UIContentSizeCategory` raw values rather than
hand-written category strings. Enable the existing Debug display probe and
read back the effective size before claiming AX5 coverage: an invalid launch
value can silently render the default size. Audit each required text and
result in its actual visible viewport; a label's existence does not prove its
body is readable. Retain overlapping screenshots for content taller than one
viewport, and keep geometry/ownership from before an audit that may scroll
while collecting issue screenshots.

The release identity is:

- App name: `Talent Signal`
- Bundle ID: `com.talentsignal.app`
- Team ID: `6RG2F8YY59`

The core AX5 audit repositions and captures one immutable hierarchy before each
of the same four audit types. A repeated offscreen Dynamic Type finding may be
covered only by an explicit anchor that already passed every type and every
visible segment in the same unchanged UI stage, with matching type, identity,
label, value, display configuration and dimensions. Confirmation clears that
coverage and reaudits the source/proposal context. Current visible anchors,
unknown identities, oversized visible text and previously failed anchors never
receive this coverage exception. Retain original audit failures as evidence.

A XCTest accessibilityAudit-56 timeout fails the test without an in-process
retry. Observed timed-out contrast work continued consuming CPU inside
`testmanagerd`; retrying added more work. Preserve the bundle and diagnostics
first. Recover only the owned test Simulator after the test run ends; do not
report this test-infrastructure recovery as application lifecycle correctness.
AX snapshot descendants are not a VoiceOver focus traversal: redundant-looking
text nodes alone do not prove separate accessibility stops.

Treat the first XCTest failure as terminal for later interaction evidence.
XCTest may return from an audit after recording failure while suppressing later
UI events. Later query/assertion log lines or named screenshots are not proof
that a keyboard opened, a tap executed, or navigation returned. Place independent
interaction checks before the audit and stop the path if its failure count rises.
Use terminating guards for audit/interaction prerequisites, including existence
and viewport geometry; a recorded assertion can return without stopping control
flow.
Keep interaction and audit outcomes separate. The dedicated AX5 keyboard/draft/
Back case exercises the same journey without calling the scoped screen audit;
it cannot close a failure in the original required, unfiltered audit case.
For navigation/keyboard anomalies, pair application images with
`XCUIScreen.main.screenshot()` and window/control geometry before interpreting
missing pixels as a hidden navigation state.
Compare AX values by typed content, not `String(describing: Any?)`: NSString and
Swift.String can have unequal Optional debug descriptions for identical values.
Compare snapshot values with snapshot values across all successful audit segments;
check live element values separately before/after. Unknown types acquire no
coverage, and a changing snapshot value fails the anchor.

## TestFlight

The repository uses Fastlane Match and the isolated private certificate
repository at `getyak/talent-signal-certs`. It contains only encrypted Talent
Signal signing assets on `main`. CI accesses it with a dedicated read-only
deploy key. `MATCH_GIT_BRANCH` may override the branch for a deliberate
migration, but release jobs default explicitly to `main` rather than Fastlane's
legacy `master` default.

```sh
bundle exec fastlane ios prepare_signing
bundle exec fastlane ios beta
```

`prepare_signing` is an explicit provisioning or rotation step. CI runs Match
in read-only mode, archives, attests, and preserves the exact IPA before any
Apple upload. A separate retryable job uploads that same IPA without coupling
the runner to Fastlane's processing watcher, then verifies the exact App Store
Connect build before the final job creates the matching release tag and
receipt. See the
[CI/CD operations guide](../../docs/operations/ci-cd.md#release-gates) for the
authoritative release trust and recovery rules. Uploads require:

- the public `TALENT_SIGNAL_API_BASE_URL` Actions variable in the `testflight`
  GitHub Environment;

- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_CONTENT`
- `DEVELOPMENT_TEAM`
- `MATCH_DEPLOY_KEY`
- `MATCH_GIT_URL`
- `MATCH_KEYCHAIN_PASSWORD`
- `MATCH_PASSWORD`

The release job validates the URL, requests a current Apple authentication
challenge with the repository contract, and only then begins signing. The API
origin is public app metadata and must stay an Actions variable. Credentials,
tokens, database URLs, and provider keys must never be compiled into the app.

Signing assets remain encrypted through Fastlane Match. Never commit the
API key, match password, deploy key, certificates, or provisioning profiles to
this repository.

The `testflight` GitHub Environment accepts only `main` and has no reviewer, so
a successful `main` CI run with iOS release-input changes publishes
automatically. App Store Connect must separately keep an internal testing group
with automatic distribution enabled; that group plus an invited-device install
is the proof that a processed build is available on a phone.
