# macOS Candidate Follow-up Companion

Status: active
Owner: Codex
Started: 2026-09-01

## Outcome

Reset the native Mac product around one recruiter outcome:

> From one deliberately selected candidate conversation, understand what
> changed and complete one evidence-backed follow-up in under one minute.

The Quick Panel becomes the first-value surface, Today becomes the default
home, the relationship workspace becomes progressive detail, and review or
recovery navigation appears only when real work requires it. Safety and
recovery machinery stays intact but moves behind consequence instead of
preceding value.

## User question

“What did this conversation change, and what is the smallest thing I should
complete now?”

## Boundary

In scope:

- deliberate selected-text, service/share, file, screenshot, and chosen-window
  intake without ambient monitoring or clipboard polling;
- a provisional, evidence-backed first read before full Person/Pursuit binding;
- one change, one unresolved dependency, one smallest next move, and duplicate
  owned-action awareness;
- delayed identity, attribution, source, and retention review at save/effect
  time;
- editable local drafts that may be copied or opened as a system mail draft but
  are never sent;
- one real EventKit reminder/calendar effect with exact preview, explicit
  approval, stable operation identity, destination readback, duplicate
  prevention, unknown-result reconciliation, and human-language receipt;
- Today as default retrieval and conditional “Needs your review” navigation;
- progressive governance details and complete ambiguity, no-action, stale,
  failed, unknown, expired, superseded, and deletion states;
- instrumentation for first-value time, understanding, adoption/editing,
  completed draft/reminder, and pre-value abandonment.

Out of scope:

- ambient collection, clipboard polling, automatic message delivery, ATS/CRM
  writes, candidate ranking, acceptance prediction, or protected-trait
  inference;
- expanding fixture scores, Agent surfaces, provider orchestration, or generic
  computer use;
- claiming product-market validation without 5–8 authorized target recruiters
  completing the real loop.

## Canonical meaning

`Pursuit`, stable `Person`, governed Evidence, reviewed fact versions,
`Proposal`, `Action`, and observed outcome remain canonical. Provisional insight,
Quick Panel, Today, relationship cards, draft previews, and recovery lists are
views or local proposals. Reading and provisional interpretation grant no write
authority. Saving state and executing a reminder remain separate, exact human
decisions.

## Experience contract

```text
deliberate selected input
→ provisional change + exact evidence + unresolved dependency + next move
→ optional draft preparation without identity binding
→ consequence chosen
→ exact Person/Pursuit/source/retention review
→ separate fact or effect approval
→ deterministic local/system execution
→ destination readback or truthful unknown
→ Today continuity
```

## Current evidence

- The existing Quick Panel requires complete relationship scope and candidate
  attribution before `submitCapsule`, so it places governance before first
  value.
- `prepareLocalDraft` only toggles an enum and `copyPreparedDraft` copies fixed
  fixture text; there is no editable draft owner.
- The Mac target has no EventKit reminder/calendar service.
- Relationship Workspace is the default scene and Action Center is permanently
  visible even when its projection is empty.
- The shared backend already supports a real governed selected-text capture,
  evidence readback, Task, Decision Bundle, no-action, and canonical Receipt,
  but its current Mac adapter requires confirmed scope before analysis.
- The prior visual refinement improves composition and adaptive appearance but
  does not change this value order.

## Milestones

### 1. First-value Quick Panel

Status: complete in code and native render

- introduce a typed provisional insight compiled from the exact selected input;
- display value before scope review;
- show supported change, evidence, unresolved dependency, one next move, and
  visible ambiguity/no-signal;
- preserve the exact included input locally and make source boundaries
  inspectable only when needed.

Exit evidence: a user-selected non-fixture excerpt produces input-specific
content without Person/Pursuit confirmation, while empty, ambiguous, and
insufficient inputs produce no invented action.

Delivered evidence:

- `CandidateFollowUpCompiler` produces a typed, exact-evidence local preview
  from the newest deliberately selected text derivative before scope review.
- Unsupported input fails closed to no action; relative dates and tentative
  wording remain visibly unresolved; confirmed candidate attribution clears
  only the speaker unknown.
- The native Quick Panel render now shows What changed, Before → Proposed,
  exact evidence, Still unresolved, Smallest next step, and the three relevant
  follow-up choices.
- After first value appears, the full intake form now collapses into one
  inspectable source row with `Review another…`. The 560-point result leads
  with change, exact evidence, one action-controlling unresolved dependency,
  the smallest next step, and all three consequence choices without scrolling.
  Before → Proposed, attribution/time checks, relationship-history status, and
  evidence feedback remain under `Review interpretation`; none are discarded.
- The macOS Service `Review Selection with Talent Signal` accepts only the
  explicitly invoked selected-text pasteboard and opens the Quick Panel without
  reading the general clipboard. Its declaration supports both modern and
  legacy plain-text pasteboard types for source-app compatibility.
- macOS registers the service but leaves the third-party Text service disabled
  until the user enables it. The Quick Panel and app menu now open Keyboard
  Shortcuts and explain the exact Services › Text setting without changing the
  preference on the user's behalf. Provider selector, metadata, exact transfer,
  and empty-input behavior are covered by unit tests; enabled-menu invocation
  remains real-surface evidence to collect.
- The Quick Panel now accepts an explicitly chosen or dropped image, PDF, or
  plain-text document. Images use local Vision OCR, PDFs read at most the first
  25 local text-layer pages, and text files are decoded locally; each source is
  capped at 25 MB and every derivative at 20,000 characters. Unsupported files
  are not retained.
- Processed files keep their raw bytes encrypted and local-only by default.
  Only the visible text derivative can cross the Capsule boundary, and only
  after independent speaker attribution, Person/Pursuit review, and an explicit
  boundary change. Metadata-only legacy file items remain fail-closed.
- Chinese and Chinese-dominant mixed input now stays in the same provisional
  evidence-review path but presents its change, modality, unresolved items,
  next step, and action draft in Chinese. The compiler recognizes the target
  WeChat phrasing, full-width speaker labels, and strict Chinese explicit dates;
  multi-speaker and expired-date cases still abstain from proposing an action.

### 2. Useful local draft

Status: complete in code and native default-Mail observation

- generate an editable candidate follow-up, client clarification, meeting
  question, or short client update from the provisional insight;
- allow edit, copy, discard, and optional system-mail draft handoff;
- keep `prepared`, `copied`, and `opened` distinct from `sent`;
- recover the unsent draft within the account boundary.

Exit evidence: edited text is the exact text copied/opened, nothing is sent,
and relaunch recovery never crosses accounts.

Delivered evidence:

- Input-specific client questions and candidate follow-ups are editable in the
  Quick Panel and the exact edited value is copied.
- All four supported recruiting purposes share one local editor instead of
  competing for primary-action space. Changing purpose replaces only the
  unsent local text and subject; it does not change the evidence or open Mail.
- Draft composition fails closed without a supported provisional signal. Exact
  source quotes remain visible in the evidence card but are not copied into an
  outgoing message by default, and the selected draft purpose recovers with
  the account- and source-bound draft.
- Clipboard success and failure remain distinct and neither claims a message
  was sent.
- The reviewed subject and exact edited body can be handed to the system Mail
  composer with no recipient. An accepted open request is shown as “Mail draft
  opened — nothing was sent”; a rejected open remains fail-closed.
- Unit tests use a deterministic system-handoff boundary to prove exact subject
  and body transfer and truthful failure language without opening or sending
  mail during tests.
- The unsent draft is stored only inside the encrypted, account-partitioned
  local Capsule. Recovery requires the same source item and digest and expires
  with that source’s one-hour or twenty-four-hour TTL; copied/opened receipts do
  not survive relaunch.
- Recovery also requires the exact provisional compiler derivation version.
  Drafts from an older interpretation rule set are cleared instead of being
  silently restored after a compiler upgrade.
- Discard removes only the unsent draft and preserves the selected conversation.
  Tests prove cross-account isolation, ciphertext contains no private
  source/subject/body sentinel, and expiry removes the draft without deleting a
  still-retained source.
- The actual Quick Panel handed a synthetic, recruiter-edited subject and body
  to the Mac's default Mail app. Native accessibility readback matched both
  values exactly, the recipient field was empty, Send remained disabled, and
  Talent Signal reported only “Mail draft opened — nothing was sent.” The
  synthetic draft was then discarded without touching existing mail.

### 3. Real reminder/calendar effect

Status: implemented; real EventKit write observation pending

- create an exact effect preview with title, due time, destination, evidence,
  and identity/scope review;
- require separate approval;
- persist a stable operation ID before EventKit;
- read back the exact destination object and store a human-language result;
- reconcile ambiguous outcomes and prevent duplicate retry.

Exit evidence: one approved reminder or event exists once in the intended
destination, readback matches the operation, response loss cannot duplicate it,
and failure/denial/unknown paths remain recoverable.

Delivered evidence:

- Choosing Reminder or Save now replaces the full first-value card with one
  focused consequence surface instead of appending a governance form below
  the fold. Exact evidence stays visible, the proposed reminder title/date
  comes first, and relationship, source-authority, duplicate-action, and
  destination approval follow in causal order.
- The Quick Panel relationship picker uses user language and keeps the exact
  Pursuit, Person, and relationship context visible without expanding the full
  canonical preflight card. Source review is reduced to `Who said this?`, with
  privacy, retention, and redaction one disclosure deeper.
- Relationship selection invalidates any stale destination preview but
  preserves the recruiter-edited reminder title and due time. A focused model
  test and native interaction prove the proposal is not erased by the
  authority-review step.
- Apple Reminders destination, title, and future due time are previewed only
  after relationship scope and candidate attribution review.
- Selecting a relationship now exposes a read-only canonical consequence
  preflight with milestone, target date, evidence availability, open gaps, and
  recruiter-owned actions. Selection remains distinct from confirmation.
- If the loaded Pursuit has an open recruiter-owned action, destination preview
  fails closed until the recruiter explicitly chooses either to reuse that
  action (no EventKit call) or confirms that the proposed reminder is separate.
  A missing preflight also fails closed instead of assuming no duplicate work.
- The native live contract suite now decodes the backend's nested milestone
  evidence authority, selects the exact seeded Pursuit instead of relying on
  UUID ordering, and proves the seeded existing action reaches this preflight.
- The exact preview requires a separate Approve and create decision.
- An opaque operation identity is persisted before EventKit; normal first
  writes do not enumerate unrelated reminders, while uncertain recovery may
  search only the reviewed list for the opaque recovery URL.
- Success appears only after destination readback matches title, due time,
  list, and operation identity. Response loss becomes outcome unknown and can
  reconcile without a second create call.
- A second destructive confirmation removes only the receipt-bound reminder;
  success requires absence readback and uncertain removal has a separate
  reconcile path.
- A content-free reminder lifecycle ledger preserves pending, verified,
  unknown, reconciled, removal-requested, removal-unknown/still-present, and
  removed transitions. It is partitioned by a one-way account digest, bounded
  to 100 events/30 days, and cleared for the current account on sign-out.
- The exact approved operation now has a separate AES-GCM encrypted,
  account-partitioned recovery capsule with a 30-day bound. It retains the
  source identity/digest, edited title and due time, reviewed destination,
  execution stage, and verified receipt, but never the conversation quote.
  `execution_pending` and `outcome_unknown` recover after relaunch as one
  reconcile-only operation; `verified` recovers the exact removal path.
- The external write fails closed when this protected operation capsule cannot
  be saved. Focused tests prove zero create calls on persistence failure, zero
  second create calls after relaunch, exact-ID reconciliation, verified
  recovery after a second relaunch, account isolation, expiry, and deletion.
  An unreadable encrypted recovery remains consequence-bearing, blocks both a
  new write and blind reconciliation, and stays visible until account-scoped
  recovery is explicitly cleared on sign-out.
- Every non-live `AppModel` defaults to a preview-only reminder provider; only
  the explicit connected-workspace bootstrap constructs EventKit.
  Destination preview, create, reconcile, remove, and removal reconciliation
  all reject before EventKit. A native Quick Panel pass reached the final
  destination gate and showed `Synthetic preview never writes to Apple
  Reminders` without a permission prompt or system write. Artifact:
  [`preview-only reminder`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-macos-candidate-follow-up-companion/system/native-quick-panel/reminder-fixture-preview-only.png).

Remaining: observe and record one authorized write, denial, and uncertain
recovery against a real Apple Reminders account rather than a stub service.

### 4. Today and conditional recovery

Status: complete in code, native route, and loopback contract; authorized live
workspace observation pending

- make Today the default window surface;
- show only current evidence-backed attention with why now, unresolved, owner,
  due, and one next move;
- keep no-action work out of the queue while preserving its count/history;
- show “Needs your review” only for a real pending decision, active effect,
  unknown outcome, failure, stale approval, or reversible completion.

Exit evidence: the main window opens to actionable continuity rather than an
empty workbench or synthetic queue and routes to the exact governed object.

Delivered evidence:

- Today is the default and renders only the current reviewed conversation plus
  real pending/recovery/reversible states; it does not manufacture a three-item
  queue.
- A screenshot-first native audit found that the current reviewed conversation
  still appeared below a wall of equally emphasized canonical cards. Today now
  gives exactly one item raised vermilion attention: the active conversation
  when present, otherwise the highest-ranked canonical item. Remaining work
  stays semantically complete in one neutral continuation list. The same order
  remained legible in dark appearance, Reduced Motion, and 200 percent text.
  Evidence: [`native product audit R2`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-macos-candidate-follow-up-companion/system/native-product-audit-r2/audit.md).
- A second native flow audit found that opening Alex Chen from Today discarded
  the selected dependency and landed on a generic local-deletion, scope, and
  empty-intake workbench. Today now opens the exact current projection as a
  read-only relationship explanation with why now, unresolved dependency,
  owner, due, evidence availability, and one next move. The projection cannot
  select or confirm relationship scope, and stale item identifiers fail closed.
  Dark appearance, Reduced Motion, and 200 percent text remain vertically
  reachable without horizontal clipping. Evidence: [`native product audit R3`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-macos-candidate-follow-up-companion/system/native-product-audit-r3/audit.md).
- Proposal-led Today detail now shows the exact cited candidate evidence only
  after deliberate navigation. The live adapter admits a fragment only when a
  Proposal item cites it, its attribution is confirmed, its review status is
  reviewed, and current non-empty text is present; all other fragments remain
  absent. Normal, dark, Reduced Motion, and 200-percent native renders keep the
  quote, unresolved state, next move, and actions legible by vertical reflow.
- The current follow-up exposes Why now, Unresolved, Owner, Due, exact eligible
  Proposal evidence, and one Next move. A Proposal item now opens its exact
  existing decision gate instead of starting another conversation review.
- The exact route requires one active Task and open Decision Bundle for the
  Proposal, one authorized Person/relationship Resource for its Capture, the
  current cited reviewed fragments, and the same Pursuit revision. Missing,
  stale, revoked, or ambiguous correlation fails closed before a decision.
- The decision gate reuses the existing atomic review, idempotent Receipt, and
  unknown-outcome recovery path. No choice is preselected; the save action is
  disabled until every proposed change has an explicit decision.
- Pending review hides the unrelated Capsule intake, narrows Action Center to
  the one real proposal, and replaces Manual intake in the sidebar with the
  current decision boundary. The completed state likewise removes the second
  intake path.
- Action Center remains absent from navigation until a real pending, executing,
  failed, unknown, stale, or reversible object exists.
- The Mac live adapter now reads canonical Pursuits and Pursuit Proposals in
  parallel and projects up to six real attention items using the same work-first
  order as Web: pending/conflicting proposal review, overdue/near recruiter-owned
  action, then open dependency. It never assigns a person score.
- Each canonical item shows why now, unresolved, owner, exact action due time or
  honest date-only Pursuit target, one next move, and evidence availability;
  active Pursuits with no review/action/gap are counted as no action.
- Unit tests cover proposal, overdue/future action, open gap, no-action count,
  unavailable evidence, conflict, and the rule that a date-only target cannot
  become an invented exact time. A clearly labeled synthetic render was used
  only to inspect the three-card layout, not as usefulness proof.
- The screenshot-first R4 native audit exercised the whole Today Proposal
  route through an explicit decision and human-language saved result. Evidence:
  [`native product audit R4`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-macos-candidate-follow-up-companion/system/native-product-audit-r4/audit.md).
- The same route is now operable through app-owned keyboard commands without
  requiring macOS Full Keyboard Access. A native accessibility pass verified
  one-window navigation, unselected/selected decision values, disabled/enabled
  save state, a current `Saved` status, and return-to-Today continuity. The
  completed Proposal leaves the pending queue, increases the no-action count,
  and remains available only as a reversible result in Needs your review.
  Evidence: [`native keyboard and accessibility audit R1`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-macos-candidate-follow-up-companion/system/native-keyboard-accessibility-r1/audit.md).
- After a relationship review is saved, Today now transitions the active
  conversation from `Review in progress` to `Next move ready` and
  `Relationship saved`. Its action prepares the evidence-bound client question,
  candidate follow-up, or reminder review instead of reopening the completed
  receipt. No-action results remain view-only so Today cannot manufacture
  duplicate work.
- The resulting local draft uses a focused Quick Panel state: exact evidence,
  the unresolved dependency, editable body, subject, Discard, Copy, and Open in
  Mail all remain visible at the 560 × 640 product size. The completed Receipt
  stays independently available as a reversible Action Center result.

Remaining proof: observe the projection against an authorized live workspace
with multiple current Pursuits.

### 5. Human language and progressive governance

Status: complete for the first-value loop

- replace default internal labels with user language;
- move operation ID, revision, Receipt, derivative ledger, and effect arrays
  into Details and recovery;
- retain precise before/after, provenance, deletion, and authority state.

Exit evidence: ordinary success reads as “Draft copied”, “Reminder created”, or
“Relationship updated”; technical identifiers remain inspectable one step
away.

Delivered evidence:

- The decision surface leads with `Review proposed changes` and `Save reviewed
  changes`; bundle expiry, Pursuit revision, and synthetic/canonical
  classification moved under `Review details`.
- The relationship result leads with `Relationship updated after your review`
  and `Nothing was sent or scheduled.` Receipt, operation ID, relationship
  version, changed fields, and external-effect count moved under `Details`.
- Decision and saved-result sidebars explain the current consequence instead
  of exposing a competing intake workflow.

### 6. Real-surface and field validation

Status: in progress

- verify real selected text and one system/browser entry;
- cover long names, missing identity, ambiguous speaker/time, no signal,
  duplicate action, stale evidence, permission denial, response loss,
  relaunch, deletion, dark, reduced motion, keyboard, and 200 percent text;
- instrument time-to-first-value and adoption without logging conversation
  content;
- run the loop with 5–8 authorized target recruiters and record only the
  agreed outcome metrics.

Exit evidence: repository checks and real native renders pass, at least one
real draft/reminder loop is independently observed, and field evidence—not a
custom synthetic score—shows whether recruiters understand and adopt it.

Verification on 2026-09-01:

- `scripts/macos/check.sh` passed build, all Mac unit tests, and UI-test
  compilation.
- `pnpm docs:check` passed documentation, wiki, and architecture checks.
- 560-point Quick Panel renders were inspected in adaptive light and dark
  appearance. Narrow layout stacks the state difference and preserves readable
  evidence/status contrast.
- Unit coverage proves pre-scope first value, no-signal abstention,
  preference/constraint separation, multi-signal separation, relative-date
  ambiguity, exact editable draft copy, scope/attribution gates, verified
  reminder readback, stable operation identity, reconcile-without-retry, and
  fail-closed duplicate-action review against canonical Pursuit context.
- In-memory field-trial measures now record first-value, draft-prepared, and
  reminder-verified elapsed time; scope-start/scope-confirmed and relationship
  review time; consequence-review cancellation; completed action type; direct
  versus edited adoption; and recruiter Yes/No/Not sure understanding,
  evidence, and reuse judgments.
- A content-free JSON export copies only elapsed times, boolean/enum judgments,
  and completed action kinds. Tests seed private source, identity, pursuit, and
  edited-draft sentinels and prove none enter the export.
- A local field-trial summarizer accepts only the exact schema-v2 allowlist,
  rejects unknown fields and duplicate sessions, and emits aggregate timings,
  judgments, action adoption/editing, completion, and scope-review outcomes
  without reproducing session IDs. The focused
  [field-trial guide](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-macos-candidate-follow-up-companion/field-trial-guide.md)
  keeps raw conversation content on the recruiter's Mac.
- A conservative local Person/Pursuit suggestion appears only when a visible
  candidate-name term uniquely distinguishes one connected scope. Same-name
  scopes abstain, and suggestions never select or confirm a binding.
- The Today native render was inspected after the relationship-follow-up reset;
  it shows the honest one-item state and leaves the rest of the window quiet.
- A native 200-percent/reduced-motion Quick Panel render was inspected. The
  header, selection intake, local-boundary status, controls, and scroll
  continuation remain readable without horizontal clipping.
- A native relationship-consequence render was inspected at 1,280 × 820. The
  selected scope, canonical milestone/target/evidence, existing owned action,
  open gap, unresolved escape hatch, and explicit confirmation remain legible
  without turning the preflight into a competing dashboard.
- The isolated loopback canonical contract suite passed 5/5 on macOS. It
  covered real Pursuit/Person/Proposal decoding, the existing-action preflight,
  immutable Capsule submission, clarification, proposal review, response-loss
  reconciliation, evidence revocation, and version isolation with zero external
  effects. Evidence is under
  `docs/evaluations/2026-09-01-macos-candidate-follow-up-companion/system/canonical-contract/`;
  it remains synthetic contract proof, not recruiter-usefulness evidence.
- The updated loopback suite again passed 5/5 after exercising Today’s exact
  Proposal route. The new path correlated Proposal, active Task and Decision
  Bundle, authorized Person/relationship Resource, Capture, cited evidence,
  and Pursuit revision before reusing the existing decision and response-loss
  recovery chain. Evidence is under
  `docs/evaluations/2026-09-01-macos-candidate-follow-up-companion/system/canonical-today-review-route-r2/`.
- The R4 native accessibility pass followed Today → Proposal detail → exact
  review → explicit choice → saved result. Save was disabled before the choice,
  enabled after it, and the final page removed the second Capsule intake while
  retaining technical proof under collapsed Details.
- A fresh no-mouse pass continued from the saved result back to Today and
  caught stale queue and accessibility semantics. Both were corrected: the
  resolved Proposal is no longer pending, the no-action/total counts remain
  truthful, Action Center retains the reversible completion, and the toolbar
  accessibility state changes cleanly from `Needs decision` to `Saved`.
- The same pass continued from saved Today state through `⌘⌥N` into an
  evidence-linked editable client question. Native accessibility readback
  confirmed the exact source, unresolved dependency, editable body, mail
  subject, local-only status, Copy, and Open in Mail controls; same-size visual
  comparison confirmed the actions are no longer below the fold.
- A bounded XCTest UI attempt compiled successfully but the current host's
  runner stayed at `waiting for workers to materialize`; it was interrupted
  after 76.762 seconds with zero product assertions executed. This is recorded
  as host-infrastructure evidence rather than a product pass. The independent
  native keyboard/accessibility route and screenshots are under
  `system/native-keyboard-accessibility-r1/`.
- The actual debug app opened Quick Panel from `⌘⇧Space`, produced first value
  from a synthetic TextEdit-style selection in about one second, and kept exact
  evidence, unresolved state, the smallest next step, and editable draft in the
  native accessibility tree. A multi-signal excerpt now names the signals
  separately and prioritizes the exact client clarification over a generic
  follow-up.
- TextEdit and System Settings observation showed the declared service under
  Keyboard Shortcuts › Services › Text with its checkbox off. The resulting
  product correction exposes a visible setup row and opens Keyboard Shortcuts
  without silently enabling the service. The system preference was not changed
  during validation.
- AppKit inspection confirmed that `NSUpdateDynamicServices()` is only needed
  for services added dynamically outside executable metadata, not this
  plist-declared Service. The unnecessary launch call was removed. Read-only
  LaunchServices inspection also found multiple temporary debug copies sharing
  `com.talentsignal.macos`; the enabled-menu gap therefore remains an
  installation/user-setting proof requirement rather than being hidden behind
  a process-local refresh call.
- A generated high-contrast chat screenshot now runs through the same local
  Vision OCR used by the system-window route. Two native tests prove explicit
  top-to-bottom message order and that an OCR result with Candidate and
  Recruiter speaker labels produces no action. OCR observations are sorted
  deterministically before compilation and language detection stays on-device.
- Real native interaction exposed that the ScreenCaptureKit overlay is not in
  the app's accessibility tree. The Quick Panel now changes its window button
  into an accessible `Cancel window choice` action while the picker is active;
  cancellation deactivates the picker, resumes the suspended capture safely,
  creates no Capsule item, and shows `Nothing was captured or retained` in the
  same panel. The unit path and actual debug surface both verify this state.
- Eight focused native tests pass for exact text-file extraction, stable raw-file
  fingerprinting, screenshot Vision OCR, unsupported-file abstention,
  local-first AppModel integration, the reviewed derivative boundary, encrypted
  raw-file expiry, and invalidation of a late extraction after local deletion.
  Actual Quick Panel file-picker observation then proved both sides: an
  explicitly chosen synthetic text document produced its exact evidence and
  client-policy next step, while a synthetic Mail screenshot with surrounding
  UI was treated as multi-speaker/conflicting and produced no action.
- File imports stage all decoded results before one MainActor commit. Clear,
  pause, stop, sign-out, and a newer explicit selection invalidate the active
  transaction, so delayed OCR/PDF work cannot repopulate a cleared Capsule.
- Focused unit tests prove all four draft purposes remain evidence-bound,
  editable, local, and unable to open Mail implicitly; empty or no-signal input
  cannot be promoted into a fabricated fallback draft. A native Quick Panel
  pass verified switching from client clarification to client update in the
  same editor while the exact evidence remained unchanged and Mail stayed
  closed.
- Native Quick Panel observation verified that trial feedback is absent during
  first value and appears only after a completed action or a cancelled
  consequence review. The compact feedback records understanding and reuse;
  its disclosure states the content exclusions before any explicit copy.
- Focused native tests now cover Chinese-dominant and mixed WeChat-style input,
  Chinese no-signal output, full-width multi-speaker labels, expired Chinese
  dates, English-dominant text containing a Chinese name, all four Chinese
  draft purposes, and fail-closed recovery across compiler versions.
- A same-size native before/after comparison showed the expanded intake form
  pushing evidence and action below the 560 × 640 fold. The compact direction
  keeps change, exact evidence, the primary unresolved dependency, next step,
  and three actions in the first viewport. Its restrained vermilion mark is a
  causal redline rather than a full decorative card border. Artifacts:
  [`expanded baseline`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-macos-candidate-follow-up-companion/system/native-quick-panel/first-value-expanded-baseline.png)
  and [`compact result`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-macos-candidate-follow-up-companion/system/native-quick-panel/first-value-compact-final.png).
- A second 560 × 640 native pass followed the Reminder action. The former
  layout left the entire first-value card above a below-fold governance form;
  the revised layout gives the consequence the foreground, keeps exact
  evidence and the editable effect together, and progressively reveals the
  exact relationship and source-authority gates. Artifacts:
  [`reminder consequence`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-macos-candidate-follow-up-companion/system/native-quick-panel/consequence-reminder-final.png)
  and [`source authority`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-macos-candidate-follow-up-companion/system/native-quick-panel/consequence-source-review-final.png).
- Quick Panel scenes now use their 560 × 640 content size as the window size,
  so a restored workspace frame cannot turn the focused companion into a
  resizable, empty-canvas shell.

Remaining: the current host's Text service is registered but disabled; no
setting was changed, so an installed/enabled source-app invocation remains
pending alongside XCTest UI execution on an authorized host, one real EventKit
loop, an authorized multi-Pursuit Today readback, and 5–8 authorized recruiter
trials.

## Completion rule

This plan is not complete when a fixture looks convincing. Completion requires
the full selected-input-to-adopted-draft-or-verified-reminder loop, safety and
recovery coverage proportional to the effect, Today continuity, and 5–8
authorized recruiter trials. Missing field participants remain a stated
external validation requirement rather than being converted into a code-only
success claim.
