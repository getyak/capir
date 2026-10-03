# 2026-08-30 — First verified progress onboarding

## Selected direction and implementation

The selected Causal Ledger direction replaces the visible nine-step setup tour
with a three-stage first-progress path: Start, Review, Done. A fresh user can
open one synthetic, clearly labelled Signal without granting Calendar,
Microphone, Contacts, or account permissions; review one sourced fact; and
create verified local progress only after an explicit Confirm decision.

The implemented review keeps source, proposed fact, unresolved question, and
confirmed state visually and behaviorally distinct. The exact source quote is
shown above a narrow causal seam. One focused fact offers full-width Confirm,
Edit, and Keep unresolved controls. Pursuit correction remains available, while
inference, optional next action, and discard are placed in a disclosure below
the first decision. The own-Signal path now recommends typed capture first and
requests permissions only when the recruiter chooses a permissioned source.

The reference line `Nothing is saved until you confirm` was intentionally not
copied because the product durably saves Source and Draft before the decision.
The truthful implementation says `Nothing becomes current until you confirm.
Nothing is sent.`

## Evidence

- Visual reference:
  `/Users/cubxxw/data/talent-signal/output/onboarding-direction-2026-08-30/selected/option-1-causal-ledger.png`
  at 853 × 1844.
- Final welcome:
  `/Users/cubxxw/data/talent-signal/output/onboarding-direction-2026-08-30/implementation/welcome.png`
  at 1206 × 2622.
- Final focused fact review:
  `/Users/cubxxw/data/talent-signal/output/onboarding-direction-2026-08-30/implementation/focused-review.png`
  at 1206 × 2622.
- Final Today readback:
  `/Users/cubxxw/data/talent-signal/output/onboarding-direction-2026-08-30/implementation/today.png`
  at 1206 × 2622.
- Executable iPhone 17 Pro Simulator, iOS 26.5, evidence level 1.
- Focused domain suite: 53/53 tests passing.
- Standalone onboarding UI suite: 7/7 journeys passing, including standard
  first progress, arbitrary manual Signal, Calendar disclosure, retained and
  queued source deletion/recovery, and Simplified-Chinese mixed-script dark AX5.
- Localization boundary: passed with 740 catalog keys.

## Side-by-side adjudication

The final implementation preserves the reference's warm canvas, serif decision
title, exact-source hierarchy, red causal seam, quiet rounded fact card,
full-width decision stack, compact unresolved row, and low-noise trust receipt.
It adds two product-required details: a compact synthetic-fixture provenance
label and a correctable matched-Pursuit row. The proposed value remains ink,
not confirmed green, until the recruiter acts. No P0, P1, or P2 visual or
interaction mismatch remains at the tested viewport.

## Mobile UX rubric

- Task legibility: 3 — one CTA reaches one evidence-backed decision.
- Hierarchy: 3 — source, proposal, uncertainty, decision, and receipt are
  distinct.
- Platform interaction: 3 — native scrolling, disclosure, text editing, and
  minimum-size full-width actions.
- Accessibility: 3 — dark AX5 mixed-script flow, keyboard exit, wrapping, and
  Today readback passed.
- Visual craft: 3 — selected causal-ledger composition retained with brand
  tokens and no setup-progress chrome.
- Safety/provenance: 3 — exact source, synthetic fixture label, explicit human
  authorization, reversible unresolved path, and no external writes.
- Vetoes: none.

final result: passed

# Design QA — iOS natural contact understanding

## Evidence

- Surface and persona: global iOS Agent input for a time-constrained recruiter
  capturing a person from an ordinary note.
- Evidence level: 1, executable iPhone 17 Pro Simulator interaction on iOS 26.5
  plus canonical fixture-backed identity operations.
- Natural English contact review:
  `/tmp/contact-intent-proof.5tkONZ/base/54FDDA33-AA61-4FB0-8A48-46420246D8E8.png`
- Ordinary identity question routed to relationship clarification:
  `/tmp/contact-intent-proof.5tkONZ/base/105AEB7E-E14F-4359-80A7-D3678969FE59.png`
- Simplified Chinese, dark appearance, AX5 contact review:
  `/tmp/contact-intent-proof.5tkONZ/ax5/2E3A4072-4BBB-4E8D-ABD1-ADE075078AEB.png`
- Simplified Chinese, dark appearance, AX5 contact edit:
  `/tmp/contact-intent-proof.5tkONZ/ax5/931DC7CF-C09D-455C-ABC6-EADA779005D7.png`
- Focused interaction bundle:
  `/tmp/talent-signal-contact-intent-ui-complete.xcresult`
- Final single-spinner progress and cancellation render:
  `/tmp/contact-intent-final.KlGGWf/878E7739-4FE1-4F60-9E28-D430ED0303AE.png`
- Final cancellation result bundle:
  `/tmp/talent-signal-contact-intent-cancel-final-ui.xcresult`
- Final exact-source model-validation suite, 22/22 passing:
  `/tmp/talent-signal-contact-intent-unit-literal-proof.xcresult`
- Focused Chinese AX5 bundle:
  `/tmp/talent-signal-contact-intent-ax5-zh-ui.xcresult`
- Canonical create/attach bundle:
  `/tmp/talent-signal-contact-intent-canonical-live-ui.xcresult`
- Canonical identity-conflict bundle:
  `/tmp/talent-signal-contact-intent-conflict-live-proof2-ui.xcresult`

## Finding and resolution

The remaining input friction was semantic rather than visual: the compact
composer still expected command-like phrasing before it would stage a contact.
That made the recruiter learn the implementation vocabulary and made the
experience feel like a form hidden inside chat.

The finished input accepts a short ordinary note with name, exact email, phone,
or LinkedIn clue, and optional relationship context. It immediately echoes the
immutable source and presents one quiet contact-review card. A deterministic
high-precision parser owns obvious notes; a bounded on-device model may propose
narrative extraction, but every field must occur verbatim in the source. The
model has no identity or write authority.

Questions remain questions. An unscoped identity question advances to the
existing `Who is this about?` clarification while retaining the exact composer
text. During bounded interpretation, one left-hand progress row exposes a
44-point Cancel action; cancellation restores the untouched note. The familiar
Send symbol remains visually stable, avoiding a second routing metaphor.

The established Today / Sessions / People navigation and original bottom
global input were not moved or restyled. The contact card, edit disclosure, and
terminal receipt remain inside the conversation above that composer.

## Behavioral, safety, and accessibility proof

- No-match, confirmed current owner, and current-versus-historical conflict
  paths used canonical backend lookup and explicit confirmation. No candidate
  was preselected, and the conflict could remain unresolved without inheriting
  a relationship scope.
- Create and attach returned canonical readback and a Session-restorable
  receipt. Merge remained a separate reversible preview and was not exercised
  as an automatic consequence of interpretation.
- The exact source note remains visible and stored with interpreter provenance.
  Proposed interpretation, identity decision, action, and receipt are distinct
  states.
- Chinese dark AX5 keeps review and edit controls reachable, text wrapping
  complete, and the pinned composer visible. The new progress/cancel semantics
  expose separate accessibility elements.
- No visual confidence, quality, fit, protected-trait, personality, or
  acceptance-probability score is produced.
- The compatible physical-device Foundation Models runtime has not yet been
  executed; Simulator proof covers deterministic behavior, injected structured
  model validation, cancellation, failure, and unavailable-model fallback.

## Mobile UX rubric

- Task legibility: 3 — one ordinary message leads directly to one review.
- Hierarchy: 3 — source, proposal, decision, and receipt remain distinct.
- Platform interaction: 3 — native text entry, progress, cancellation, and
  disclosure behavior.
- Accessibility: 3 — Chinese dark AX5, 44-point actions, wrapping, and child
  semantics verified.
- Visual craft: 3 — no form chrome, command chips, duplicate spinner, or routing
  icon change competes with the contact decision.
- Safety/provenance: 3 — exact-source validation and explicit tool authority.
- Vetoes: none in Simulator scope; physical-device model availability remains
  an explicit proof gap.

final result: pass with physical-device follow-up

---

# Design QA — iOS explicit global Agent scope

## Finding and selected direction

The bottom entry was visually global, but a new Ask silently selected the first
available relationship. A concise contact intent could therefore appear to
target Leila Hartmann before the Agent had analyzed the message. That mixed a
global IM interaction with form-style preselection and created a wrong-target
risk.

The selected direction starts a new global Ask with no relationship selected.
Contact-shaped language can proceed to the existing reviewable contact proposal
without inventing a relationship. A generic relationship question now advances
to one lightweight Agent clarification only after the recruiter taps the arrow:
`Who is this about?` The message remains editable and is not sent until the
recruiter explicitly chooses a Person and context and confirms Send. Selecting
one moves the exact draft atomically; if protected persistence fails, the draft
remains recoverable as a global draft and the UI explains the boundary.

Three structures were compared. A persistent empty relationship selector was
rejected because it still made a global message look like a form. Inline
horizontal chips were retained at standard sizes, but rejected at AX5 after the
first render clipped the Pursuit context. The selected responsive structure
puts complete, full-width relationship rows in the conversation scroll at
accessibility sizes while the composer remains pinned. The selector's complete
44-point row is tappable, no-match search has an explicit clear recovery, and
scope animation follows Reduce Motion. Existing contextual Sessions remain
scoped and do not steal keyboard focus. The Today / Sessions / People
navigation and bottom global input were not moved or restyled.

## Evidence

- Evidence level: 1, fixture-backed iPhone 17 Pro Simulator on iOS 26.5.
- Rejected implicit-scope state:
  `/tmp/talent-signal-global-input-focus.ooNbRf/0E30CC00-5541-4DC3-BA0E-A3D7703FFDE6.png`.
- Empty explicit global state:
  `/tmp/talent-signal-global-scope-ui-v2.MUWJ4t/33C72746-7A2E-4511-A43F-5C943FC9B9B3.png`.
- Restored unscoped contact intent:
  `/tmp/talent-signal-global-scope-ui-v2.MUWJ4t/3B37D620-EF52-4EFD-9356-E72B9F865DC8.png`.
- Standard global-intent result bundle:
  `/tmp/talent-signal-global-scope-ui-v2.xcresult`.
- Contextual Session scope regression bundle:
  `/tmp/talent-signal-contextual-session-scope-ui.xcresult`.
- Simplified Chinese, dark appearance, AX5 result bundle:
  `/tmp/talent-signal-global-scope-ax5-zh.xcresult`.
- Atomic global-draft transition model bundle:
  `/tmp/talent-signal-global-draft-atomic-model-v2.xcresult`.
- Input-first, draft restoration, contact intent, and progressive clarification
  result bundle: `/tmp/talent-signal-progressive-scope-ui.xcresult`.
- Rejected AX5 horizontal-chip render:
  `/tmp/talent-signal-progressive-scope-detail-artifacts.MjYCtT/595D732F-2477-4E79-93DD-0C344C3369B2.png`.
- Selected AX5 full-width relationship rows:
  `/tmp/talent-signal-progressive-scope-scroll-artifacts.GPlXUC/726BDB65-92AC-4E66-B50C-B2DD8B2E3012.png`.
- Final standard and Simplified Chinese dark AX5 clarification bundle:
  `/tmp/talent-signal-progressive-scope-scroll-ui.xcresult`.
- Unified final six-journey bundle on the current implementation:
  `/tmp/talent-signal-progressive-scope-final-ui.xcresult`.
- Contextual Session regression bundle after one infrastructure-only SIGTERM
  retry: `/tmp/talent-signal-progressive-scope-context-ui-retry.xcresult`.

The standard journey verifies empty, direct-contact, relaunch, and generic
relationship-question states. The model journey verifies rollback and exact
relaunch recovery for both global-to-relationship and global-to-contact
proposal transitions. The AX5 journey keeps the unselected scope, preview
boundary, capture controls, and composer readable without clipping.

## Mobile UX rubric

- Task legibility: 3 — global means unscoped until the message supplies intent.
- Hierarchy: 3 — contact review and relationship context remain distinct.
- Platform interaction: 3 — one-tap typing, progressive clarification, and a
  full-row native selector.
- Accessibility: 3 — 44-point targets, Reduce Motion, no-match recovery, and
  complete AX5 context rows verified.
- Visual craft: 3 — no new form, modal, navigation, or bottom-bar treatment.
- Vetoes: none.

final result: passed

---

# 2026-08-30 — Focused New Chat Markdown composer

## Evidence

- Visual reference supplied by the user:
  `/Users/cubxxw/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_aslpezxtl8oa22_7d14/temp/RWTemp/2026-08/95c328cbec59b3402d7d2e6c06b16c0a/891dc477c75cdd7024a87e184d02bce6.jpg`.
- Final empty, focused state on iPhone 17 Pro Simulator:
  `/Users/cubxxw/.codex/visualizations/2026/08/30/01a05225-8b22-7d53-9a12-a452cc7eed24/new-chat-markdown-final/bottom-final/0FB144E7-CE0A-44C8-ADFB-4489E80AFE54.png`.
- Same-viewport reference comparison:
  `/Users/cubxxw/.codex/visualizations/2026/08/30/01a05225-8b22-7d53-9a12-a452cc7eed24/new-chat-markdown-final/reference-vs-final.png`.
- Final standard focused-input journey:
  `/tmp/talent-signal-new-chat-bottom-20260830-2125.xcresult`.
- Markdown insertion and adaptive primary-control journey:
  `/tmp/talent-signal-new-chat-locked-detent-20260830-2119.xcresult`.
- Direct photo-entry journey:
  `/tmp/talent-signal-new-chat-attachment-final-20260830-2107.xcresult`.
- Simplified Chinese dark AX5 input, send, and inline relationship-recall
  journey: `/tmp/talent-signal-new-chat-ax5-final-20260830-2129.xcresult`.

## Finding and selected direction

The earlier compact row looked like an upload affordance, not the beginning of
a conversation. The selected direction treats New Chat as a focused writing
surface: opening it places a large multiline editor immediately above the
keyboard, preserves quiet space above the task, and keeps the composer inside
the same sheet that later becomes the Chat session.

The right control is a microphone while the draft is empty. The same position
animates to Send after text or an attachment is present. The editor exposes
native heading, photo, bold, list, and overflow controls; every action inserts
editable Markdown syntax rather than rendering or committing hidden state.
Photo selection enters directly from the visible toolbar.

The input phase does not offer the large Chat detent. Sending creates the
Session, changes the state boundary, and then expands the same sheet to the
large conversation surface. This prevents keyboard presentation from silently
turning an empty New Chat into a near-full-screen Chat before the first send.
The relationship remains unselected at entry; after send, the Agent may recall
relevant existing relationships and keeps ambiguity correctable rather than
requiring a contact up front or merging automatically.

## Behavioral and accessibility proof

- The standard journey verifies initial keyboard focus, the empty microphone
  state, voice-to-send conversion, multiline Markdown content, and the larger
  editor geometry.
- The Markdown journey verifies heading, bold, and list insertion while focus
  and the keyboard remain active.
- The direct photo control opens the system picker without routing through the
  screenshot-capture hub.
- The first AX5 pass exposed a transformed 42.25-point photo target. Compact
  Markdown controls now increase to 52 points in accessibility layouts; the
  final Chinese dark AX5 journey passes the 44-point minimum, sends successfully,
  and reaches the inline relationship-recall state without clipping.
- The visual comparison uses the supplied reference and final implementation at
  the same 1206 × 2622 viewport. The implementation intentionally adds the
  product's New Chat label and truthful relationship-recall boundary while
  retaining the reference's large writing area, bottom toolbar, microphone,
  and keyboard-first composition.

## Mobile UX rubric

- Task legibility: 3 — opening New Chat means writing immediately.
- Hierarchy: 3 — writing, formatting, recall disclosure, and Chat are distinct.
- Platform interaction: 3 — native keyboard focus, Photos picker, Menu, and
  sheet expansion.
- Accessibility: 3 — Chinese dark AX5 and 44-point controls verified.
- Visual craft: 3 — one formal editor, one adaptive primary action, quiet
  spacing, and no upload-first chrome.
- Safety/provenance: 3 — recall remains proposed and correctable; no automatic
  merge or external write.
- Vetoes: none.

final result: passed

---

# 2026-08-30 — Input-first Agent Chat and relationship recall

## Evidence

- Source visual truth:
  `/Users/cubxxw/.codex/generated_images/01a05225-8b22-7d53-9a12-a452cc7eed24/exec-1c602847-8779-4e63-8002-367b3a7741c1.png`
- Final implementation screenshot:
  `/Users/cubxxw/.codex/visualizations/2026/08/30/01a05225-8b22-7d53-9a12-a452cc7eed24/chat-session-final/custom-header/3A9E317A-57EB-4ED8-9DE8-5F11F21822D2.png`
- Same-input comparison:
  `/Users/cubxxw/.codex/visualizations/2026/08/30/01a05225-8b22-7d53-9a12-a452cc7eed24/chat-session-final/comparison-custom-header-final.png`
- Viewport: iPhone 17 Pro, 402 × 874 points at 3×; implementation capture
  1206 × 2622 pixels.
- Source normalization: the original board is 1295 × 1215 pixels. Its
  648 × 1215 Chat panel was cropped, resized to 1206 × 2262, and top-aligned
  on a 1206 × 2622 white canvas before comparison. The implementation was
  captured at matching 3× density, so no density-only differences were filed.
- State: the recruiter's first message has created a Session, the Agent has
  recalled one relationship, the match remains correctable, and the Agent is
  reading that relationship's current record.
- Full-view evidence: the final composite compares the entire normalized Chat
  panel and implementation in one image. The title, context subtitle, question
  bubble, match receipt, correction action, reading state, and pinned composer
  remain legible at that scale. A separate focused crop was not needed.

## Findings and comparison history

- [P2, resolved] A relationship selector remained visible after automatic
  recall, making the result look like a manual form instead of a continuous
  Chat. The selector is now hidden during recall and reading; `Change` is the
  only correction action in the conversation. The three focused UI journeys
  passed after this change.
- [P2, resolved] The first revised capture used the native iOS toolbar's large
  glass `Close` pill, which outweighed the conversation title. Replacing its
  text with an `xmark` preserved the glass circle, so the second pass moved the
  action into a custom 48-point header target. The final screenshot shows the
  quiet source-like × plus a two-line person/context title, and the exact
  matched-and-reading UI test still passes.
- The source retains `Finding the right relationship…` as a historical row;
  the implementation replaces it with the confirmed match receipt. This is an
  intentional state transition, avoiding a completed loading row that could
  be misread as still active.
- `Preview data · connect a workspace to send` appears only in the fixture
  workspace used for screenshot proof. It is truthful environment disclosure,
  not production Chat copy.

## Required fidelity surfaces

- Fonts and typography: native Dynamic Type provides body and control text;
  the header uses headline/caption optical hierarchy and both title lines avoid
  truncation in the tested state. No display font substitution was introduced.
- Spacing and layout rhythm: the custom header balances equal 48-point side
  regions, the message and recall receipt retain quiet vertical grouping, and
  the composer remains pinned without overlap at 402 × 874 points.
- Colors and visual tokens: the implementation uses existing `tsSurface`,
  `tsInk`, `tsMutedInk`, and vermilion progress tokens. Contrast and state
  semantics remain consistent with the existing iOS product.
- Image quality and assets: this state contains no raster product art. All
  visible icons are SF Symbols at native resolution; no placeholder, custom
  SVG, CSS art, or text-glyph substitute is present.
- Copy and content: `Matched from your relationship history`, `Change`, and
  `Reading the current record…` explain inference, correction, and progress
  without claiming that a merge or external write occurred.

## Behavioral and safety proof

- Three focused UI journeys passed: compact new-Chat entry, unscoped first
  question with inline relationship choices, and unique recall remaining
  correctable while the Agent reads.
- The final custom-header matched-state rerun passed separately after the
  visual fix.
- Focused unit coverage passed for immediate Session persistence/restoration,
  unique recall, same-name ambiguity and merge-review staging, recent-context
  fallback, and exact identity-clue extraction.
- A suspected duplicate never merges automatically. Choosing a result binds
  only the current Session context; merge remains a separate evidence review.

## Follow-up polish

- P3: the final implementation intentionally uses a single live reading row
  instead of the source's decorative three-dot timeline. This keeps status
  semantic and accessible, but the motion language can be revisited with a
  reduced-motion equivalent if the broader Chat system later adopts timelines.

final result: passed

---

# Design QA — iOS one-tap global Agent input

## Finding and selected direction

The persistent bottom capsule looked like a message field but opening a new
Agent conversation left the real composer unfocused. A recruiter therefore had
to tap the global input and then tap again before typing, breaking the immediate
IM expectation established by the visual treatment.

Two directions were compared. A root-level `TextField` would make the first
surface literally editable, but would duplicate draft, photo, voice, pending
intent, and restoration state between Today and Ask. The selected direction
keeps one canonical composer: tapping the unchanged global capsule opens a new
Ask and places the insertion point in that composer as soon as it is mounted.
The top Today / Sessions / People navigation and the bottom input styling were
not moved or restyled.

Autofocus is deliberately limited to a brand-new, unseeded global intent. An
existing Session, a seeded continuation, or a restored contact proposal opens
without a keyboard so review and recovery remain the visual lead. VoiceOver
also suppresses autofocus to avoid moving accessibility focus without an
explicit decision.

## Evidence

- Evidence level: 1, fixture-backed iPhone 17 Pro Simulator interaction on
  iOS 26.5.
- Direct typing after one tap, standard English:
  `/tmp/talent-signal-global-input-focus.ooNbRf/0E30CC00-5541-4DC3-BA0E-A3D7703FFDE6.png`.
- Restored contact decision without focus theft:
  `/tmp/talent-signal-global-input-focus.ooNbRf/803A4CA4-EABE-4525-A256-E6824723389C.png`.
- Standard focus and restored-decision result bundle:
  `/tmp/talent-signal-global-input-focus-ui.xcresult`.
- Simplified Chinese, dark appearance, AX5 single-column layout:
  `/tmp/talent-signal-global-input-focus-ax5.c8aEHD/FA57579C-3F34-4446-9772-F980473F1AE8.png`.
- AX5 layout result bundle:
  `/tmp/talent-signal-global-input-focus-ax5-zh.xcresult`.

The standard journey proves that a direct `typeText` succeeds after tapping
only the global capsule and that the keyboard, editable message, and Send action
are simultaneously present. The recovery journey proves that a restored
consequential contact decision does not summon the keyboard. The AX5 journey is
layout evidence rather than keyboard evidence: it verifies the single-column
scope and preview hierarchy, 44-point photo and voice targets, and an uncropped
composer in Simplified Chinese dark appearance.

## Mobile UX rubric

- Task legibility: 3 — one global intent threshold leads directly to typing.
- Hierarchy: 3 — a restored decision still leads when it needs review.
- Platform interaction: 3 — native focus and keyboard behavior, one composer.
- Accessibility: 3 — VoiceOver focus is not moved; AX5 controls remain usable.
- Visual craft: 3 — no extra field, modal, navigation, or restyling was added.
- Vetoes: none.

final result: passed

---

# Design QA — iOS persistent contact-tool receipts and People continuity

## Evidence

- Evidence level: 1, fixture-backed iPhone 17 Pro Simulator interaction on
  iOS 26.5.
- Restored created-contact receipt:
  `/tmp/talent-signal-contact-receipts.mmEVVi/939F10FF-6A16-477F-A2AC-7B436B49EA4E.png`
- Restored identity-review receipt:
  `/tmp/talent-signal-contact-receipts.mmEVVi/DA62C139-EBD4-4556-848E-A59CDDF9440B.png`
- Focused create and identity-review result bundle:
  `/tmp/talent-signal-contact-receipt-ui-v2.xcresult`.
- Focused confirmed-match and response-loss result bundle:
  `/tmp/talent-signal-contact-receipt-retry-ui.xcresult`.
- Before direct continuity, the restored receipt stopped at a verification
  warning:
  `/tmp/talent-signal-contact-receipts.mmEVVi/939F10FF-6A16-477F-A2AC-7B436B49EA4E.png`.
- Standard restored receipt with the current-person action:
  `/tmp/talent-signal-contact-people.SrwlhR/FB8EFF83-AFB0-403E-9B08-9C97BA2020FB.png`.
- Standard canonical People destination:
  `/tmp/talent-signal-contact-people.SrwlhR/EDCF7399-9ADB-4CC4-B5B7-557CC1526706.png`.
- Simplified Chinese, dark appearance, AX5 restored receipt:
  `/tmp/talent-signal-contact-people-ax5.JRPj46/210EFE9A-A5C3-48FE-B5C4-CA07CB8609EA.png`.
- Simplified Chinese, dark appearance, AX5 People destination:
  `/tmp/talent-signal-contact-people-ax5.JRPj46/F731C7D1-D101-45D5-8F0A-790E3A6378C0.png`.
- Standard create and identity-review continuity result bundle:
  `/tmp/talent-signal-contact-receipt-people-ui.xcresult`.
- Simplified Chinese dark AX5 continuity result bundle:
  `/tmp/talent-signal-contact-receipt-people-ax5-zh.xcresult`.
- Exact-reference and migration model result bundle:
  `/tmp/talent-signal-contact-receipt-people-model.xcresult`.

## Finding and resolution

A canonical contact write previously ended in a compact success card that
disappeared when the proposal was dismissed. Sessions retained Agent answers,
but not confirmed tool outcomes, so a recruiter could not recover what the
tool created, attached, or left for identity review after interruption.

The finished conversation records a restrained contact-tool receipt only after
canonical readback succeeds. Person and relationship context lead; the source
receipt and optional identity-review case remain subordinate monospace
references. Relaunched receipts state that they are restored references and
direct the recruiter to People for current state instead of presenting cached
history as live truth. Original contact prose and identity clues do not appear
in the receipt or its persisted Session envelope.

Two structural directions were compared. The warning-only direction kept the
receipt visually minimal, but made the recruiter close the Session, switch to
People, and search for an object the Agent had already identified. The selected
direction adds one native, full-width `Open in People` row to a bound receipt.
It dismisses the focused Agent surface and opens the exact living Person inside
the existing People page, without adding a modal, duplicating contact detail,
or increasing the receipt's authority.

The action is derived only from a canonical Person ID that still exists in the
current workspace snapshot. It never falls back to a display name. A restored
identity-review receipt has no Person action, and a receipt whose Person was
deleted says that the Person is no longer available and removes the action.
This keeps history inspectable without risking a wrong-target transition.

Identity-review Sessions deliberately show `Choose a relationship`. They retain
the canonical resolution case but no person or relationship IDs, and therefore
cannot send a relationship question until the recruiter explicitly chooses a
real scope. Receipt-only Session titles, context labels, and previews are
localized at render time so Simplified Chinese does not expose English storage
grammar.

The established Today / Sessions / People navigation and bottom global Agent
input were not moved or restyled.

## Behavioral, safety, and accessibility proof

- No-match creation and current-versus-historical identity conflict both pass
  save, dismiss, process termination, Sessions retrieval, and restored receipt
  verification against the canonical fixture.
- Confirmed existing-person attachment and a committed-but-response-lost create
  pass the same recovery path. The latter replays the protected operation,
  reconciles canonical readback, and restores one receipt after relaunch.
- Unit coverage verifies minimal-reference persistence, exact idempotent retry,
  mismatched-readback refusal, version 3 relationship-session migration, and
  the absence of a fake relationship scope for unresolved identity. It also
  verifies exact current-snapshot Person resolution and no destination for a
  missing Person.
- English and Simplified Chinese semantic projections are asserted without
  translating person labels or canonical identifiers.
- The standard screenshots show one readable single-column card, complete
  labels, subordinate receipt IDs, at least 44-point controls, and a reachable
  pinned composer. No duplicate form, hero treatment, or Agent theater was
  introduced.
- Standard and Simplified Chinese dark AX5 journeys pass save, dismiss,
  termination, Session reopen, exact-Person transition, and destination
  verification. The latter visually preserves an uncropped receipt action and
  vertically stacks reference metadata at accessibility text sizes.
- The destination remains the original People projection: Today / Sessions /
  People stay in the established top navigation and the bottom global Agent
  input remains visible and reachable.

## Mobile UX rubric

- Task legibility: 3 — the confirmed tool outcome and destination lead.
- Hierarchy: 3 — identity, context, receipt, and refresh warning are distinct.
- Platform interaction: 3 — native Session retrieval, one-step canonical
  continuity, and pinned composition.
- Accessibility: 3 — semantic controls, complete labels, localized rows, and
  an uncropped 44-point action at AX5.
- Visual craft: 3 — quiet bordered card, scarce accent, stable single column.
- Vetoes: none.

final result: passed

---

# Design QA — iOS canonical contact conversation

## Evidence

- Evidence level: 1, canonical local-backend interaction on an iPhone 17 Pro
  Simulator running iOS 26.5 in portrait.
- Seven-journey result bundle:
  `/tmp/talent-signal-ios-contact-conversation-final.xcresult`.
- Standard contact turn:
  `/tmp/talent-signal-ios-contact-conversation-final-artifacts.CEsqmS/62C03B66-1C2B-4E6E-A7D0-B479E4CAA4DE.png`.
- Simplified Chinese, dark appearance, AX5 Dynamic Type:
  `/tmp/talent-signal-ios-contact-conversation-final-artifacts.CEsqmS/EC50FFC7-410B-4A4F-96C1-09D7A7F186EE.png`.
- Lookup recovery:
  `/tmp/talent-signal-ios-contact-conversation-final-artifacts.CEsqmS/6AEA4484-DCD7-4707-9691-05938DB1AB4F.png`.
- Unknown-result recovery after relaunch:
  `/tmp/talent-signal-ios-contact-conversation-final-artifacts.CEsqmS/0D38CFB9-BB56-46AB-A5B3-BA468A19012D.png`.
- Final conflict-wrap result bundle:
  `/tmp/talent-signal-ios-contact-conflict-wrap-retry.xcresult`; review render:
  `/tmp/talent-signal-ios-contact-conflict-wrap-retry-artifacts.1vHN9a/49AC6531-1A27-4857-A68B-5798B06CB305.png`.
- Four terminal create, attach, conflict, and response-loss receipts:
  `/tmp/talent-signal-ios-contact-receipt.xcresult`.
- Final full-wrap receipt:
  `/tmp/talent-signal-ios-contact-receipt-wrap.xcresult`.
- Composer-continuity result bundle:
  `/tmp/talent-signal-ios-contact-continuity.xcresult`; final render:
  `/tmp/talent-signal-ios-contact-continuity-artifacts.jL49B9/5945E96A-6FC1-412C-ADAD-2EC5D6E11589.png`.
- Bound create and attach continuation scopes:
  `/tmp/talent-signal-ios-contact-scope-continuity.xcresult`; create render:
  `/tmp/talent-signal-ios-contact-scope-artifacts.TiyOFi/87565B0D-B98E-4A38-A0E8-F41271751176.png`.
- Unresolved and response-loss continuation safety:
  `/tmp/talent-signal-ios-contact-unresolved-continuity.xcresult`.
- Final unresolved terminal render and interaction proof:
  `/tmp/talent-signal-ios-contact-unresolved-final.xcresult`;
  `/tmp/talent-signal-ios-contact-unresolved-final-artifacts.6xymOB/86F72B3C-09EB-4019-9D6B-11B6A114473C.png`.

## Finding and resolution

The earlier proposal proved the visual direction but still stopped short of a
canonical create, attach, and conflict receipt. Its identity-conflict sentence
could also truncate at the exact point where the recruiter needed to understand
the choice. The finished contact interaction is an Agent tool turn rather than
an upload or contact form: the recruiter's exact input remains an immutable
right-hand message, and a quiet left-hand contact card progressively discloses
only the identity decision and editable details needed for confirmation.

The contact draft and tool card are projections, not relationship truth.
Person, Pursuit or relationship context, governed source, explicit Action, and
Receipt remain canonical. Identity search is automatic and account scoped;
no-match proposes create, a confirmed current owner proposes attach, and a
current-versus-historical conflict remains unselected. Merge is never inferred
from conversation and continues through the existing reversible merge tool.

The conflict explanation now expands vertically instead of truncating. The
current owner is selectable, the historical owner remains visible but locked,
and saving an unresolved identity case is a first-class choice. The familiar
Today / Sessions / People navigation is unchanged. The bottom global composer
also remains visible; it becomes temporarily unavailable while the current
decision is unresolved so a second intent cannot obscure the first.

Canonical completion now changes the tool turn into a compact terminal receipt
instead of leaving a disabled review form on screen. The receipt is a separate
projection from the mutable proposal: it retains the saved contact summary,
whether the identity clue entered the governed source, the canonical receipt,
and the traceability boundary, while removing the identity picker, edit toggle,
and confirmation control. Receipt text expands vertically rather than
ellipsizing. Once canonical completion is known, the global text, photo, and
voice inputs resume immediately; only pending, failed, or unresolved decisions
continue to block a competing intent.

The first terminal receipt pass made the composer look continuous but still
left its relationship scope at the value selected before contact intake. That
could make a follow-up Ask appear to concern the saved contact while actually
targeting an unrelated relationship. Completion now rebinds from the exact
canonical `person_id` and `relationship_context_id` returned by the save, using
the refreshed workspace rather than the presentation's initial snapshot. The
scope selector returns above the receipt so the next destination is visible.
An unresolved identity case clears the prior scope; another contact intent
remains possible, but an ordinary Ask cannot send until the recruiter chooses a
relationship. Its compact placeholder stays fully readable on iPhone width.

## Behavioral, safety, and accessibility proof

- All seven canonical UI journeys passed: editable relaunch restoration,
  no-match create after explicit confirmation, lookup failure and retry,
  confirmed-match attach without preselection, current/historical conflict,
  response-loss reconciliation using the same operation, and Simplified
  Chinese dark AX5 reachability.
- Create, attach, and unresolved-conflict paths each returned a canonical
  receipt or resolution case. No test treated model prose as a write.
- Create, attach, unresolved conflict, and response-loss reconciliation each
  collapse to the same terminal receipt grammar. The final create test asserts
  that dead proposal controls are absent and that text and voice input are
  enabled again after the receipt becomes canonical.
- Create, attach, and response-loss recovery assert the exact post-save Person
  relationship scope from canonical readback. The unresolved path asserts
  `None`, types a generic follow-up, and verifies that Send remains disabled
  with an explicit accessible reason instead of inheriting stale scope.
- Lookup failure and unknown-result recovery retain the exact recruiter message
  and proposal. Relaunch cannot silently recompute a different destination.
- The focused conflict test asserts the complete consequence sentence, no
  default candidate selection, locked historical ownership, absence of a
  create-separate shortcut, and the explicit unresolved-review route.
- A Simulator keyboard-focus race was made deterministic by waiting for an
  actual keyboard before typing; the experience was not accepted on a blind
  rerun.
- Capturing the composer's optical control size outside the Photos picker's
  sendable label closure removes the Swift 6 actor-isolation warning without
  changing its layout.

## Mobile UX rubric

- Task legibility: 3 — one exact message leads to one reviewable tool turn.
- Hierarchy: 3 — identity result, consequence, details, and receipt stay
  distinct.
- Platform interaction: 3 — native scrolling, controls, keyboard, and pinned
  composer behavior are executable.
- Accessibility: 3 — AX5, dark mode, Chinese, wrapping, locked state, and
  control reachability are verified.
- Visual craft: 3 — quiet IM authorship, progressive details, and no duplicate
  upload surface.
- Performance feel: 3 — checking, retry, restore, and unknown-result states
  preserve continuity rather than resetting the flow.
- Vetoes: none. Level 4 remains intentionally unclaimed without a real
  recruiter and assistive-technology user evaluation.

final result: passed

---

# Design QA — iOS Today evidence-first decision frame

## Evidence

- Evidence level: 1, executable iPhone 17 Pro Simulator interaction on iOS
  26.5.
- Before, standard English:
  `/tmp/talent-signal-ios-today-baseline-artifacts.euUrFd/EA20EEC6-0D22-4734-B392-3A066BE3298C.png`
- After, standard English:
  `/tmp/talent-signal-ios-today-evidence-first-v4-artifacts.RTOcPH/662BAAD9-D2C0-4194-8877-BDC3F078CEF9.png`
- After, Simplified Chinese, dark appearance, AX5 Dynamic Type, initial frame:
  `/tmp/talent-signal-ios-today-evidence-first-v6-artifacts.eSjsqf/515F1CC9-41D7-4FDE-A478-0BE632CD90C9.png`
- After, Simplified Chinese, dark appearance, AX5 Dynamic Type, action after
  evidence:
  `/tmp/talent-signal-ios-today-evidence-first-v6-artifacts.eSjsqf/460F0F63-2F50-4CDF-A7CE-0EF1FB39032D.png`
- Full focused result bundle:
  `/tmp/talent-signal-ios-today-evidence-first-v4.xcresult`
- Final AX5 visual rerun:
  `/tmp/talent-signal-ios-today-evidence-first-v6.xcresult`

## Structural comparison

Two directions were compared. Direction A retained the early review button,
single-line owner/evidence metadata, redundant Open Pursuit action, and
AI-branded eyebrow. Direction B ordered the decision as change, target outcome,
target date, evidence/owner, then action; it removed redundant navigation and
described the proposed work instead of advertising AI. Direction B was
selected because Today must answer what deserves attention and why before it
asks the recruiter to commit.

## Finding and resolution

The prior focus card led AX5 users to the consequence before showing its target
date or evidence, could truncate its authority metadata, and labeled the item
as an AI insight. Its secondary Open Pursuit button was partly obscured by the
persistent global input and duplicated the primary route.

The finished card leads with Proposed change, then preserves canonical target
outcome, date, evidence freshness, and owner before Review proposal. Raw dates
and evidence state remain canonical in the projection and are formatted only
at the language boundary. Known workspace vocabulary is localized for display;
recruiter-authored content remains untouched.

The first AX5 render was rejected even after tests passed: the calendar glance
expanded into a clipped wall and mixed English remained in the Chinese target
outcome. The calendar is now a bounded secondary glance with a complete
VoiceOver label, a numeric decorative date mark that cannot clip, and a compact
optical scale. The decision body continues to honor uncapped AX5 text and can
scroll behind the unchanged global composer.

## Behavioral and accessibility proof

- Three focused model/localization tests and two standard/AX5 UI tests passed
  with zero failures in the full result bundle.
- The final AX5 rerun passed independently after the date-mark correction.
- Tests assert target outcome, date, and evidence precede the action in visual
  geometry; the date is localized; English workspace vocabulary is absent from
  the Chinese outcome; and the action remains reachable after scrolling.
- The compact calendar remains below 180 pt at AX5 and the decision card begins
  in the initial viewport. Its accessibility label retains the full next-event
  person, kind, and date/time even when visible copy is truncated.
- The original Today / Sessions / People navigation and bottom global Agent
  input remain in their prior positions and styles. No route change or preview
  interaction gains write authority.

## Mobile UX rubric

- Task legibility: 3 — one supported decision leads Today.
- Hierarchy: 3 — consequence follows target and evidence.
- Platform interaction: 3 — native scroll, button, date, and VoiceOver behavior.
- Accessibility: 3 — Chinese, dark appearance, AX5, ordering, and reachability
  are executable.
- Visual craft: 3 — no clipped date tile, mixed-language workspace copy, or
  redundant action.
- Vetoes: none.

final result: passed

---

# Design QA — iOS Proposal evidence-to-decision review

## Evidence

- Evidence level: 1, executable iPhone 17 Pro Simulator interaction on iOS
  26.5 with a real local Proposal fixture and canonical backend readback.
- Before, Simplified Chinese, dark appearance, AX5 evidence frame:
  `/tmp/talent-signal-ios-proposal-baseline-artifacts.BVJlt7/D12A9F56-1CF6-45B3-B3B4-071379076C5F.png`.
- Before, Simplified Chinese, dark appearance, AX5 decision frame:
  `/tmp/talent-signal-ios-proposal-baseline-artifacts.BVJlt7/BBAC99C1-92DD-4717-8F0A-B65F54F58999.png`.
- After, standard English evidence and change frame:
  `/tmp/talent-signal-ios-proposal-final-artifacts.1Hkxn1/3306F61C-F565-4E51-ABD0-3B0387952D33.png`.
- After, Simplified Chinese, dark appearance, AX5 evidence frame:
  `/tmp/talent-signal-ios-proposal-final-artifacts.1Hkxn1/DCD74D84-A319-4210-A98F-AD3AFE9FFB4D.png`.
- After, Simplified Chinese, dark appearance, AX5 decision frame:
  `/tmp/talent-signal-ios-proposal-final-artifacts.1Hkxn1/FAD78AF3-F293-455B-9D3F-850ADB50A7A8.png`.
- After, canonical receipt readback:
  `/tmp/talent-signal-ios-proposal-final-artifacts.1Hkxn1/6BE02DFA-2A02-4555-A703-7B5AB1192CAF.png`.
- Final result bundle:
  `/tmp/talent-signal-ios-proposal-final.xcresult`.

## Structural comparison

Direction A retained the form-like composition: one dense provenance sentence,
nested proposal cards, and a fixed two-column decision grid. Direction B keeps
one ordered review: exact evidence, compact source summary, optional audit
details, current and proposed values, suggestion rationale, evidence authority,
then one explicit decision. Direction B was selected because the screen is a
human decision gate, not an upload form or an Agent transcript.

## Finding and resolution

The baseline passed behavior tests but failed visual review at AX5. Exact
evidence and every provenance attribute were fused into an oversized card, the
four decisions collapsed into narrow columns with broken words, and a Chinese
interface still exposed English controls.

The finished review preserves exact evidence verbatim and keeps source,
observed time, and timezone visible. Lower-frequency identity, channel,
attribution, review, and fragment details remain one native disclosure away.
Proposal items are no longer nested cards: current value, proposed value,
reason, effect, and evidence authority form one continuous reading order.
Confirm, correct, reject, and leave unresolved are full-width native choices
with no default selection. The consequential apply control appears only after
all item decisions and still cannot perform an external write.

At AX5, the exact quote intentionally receives the initial viewport instead of
being truncated or reduced below the user's text setting. The prior provenance
wall is gone, all four decisions remain complete and full width, the surface
scrolls natively, and the Chinese interface boundary is executable.

## Behavioral and accessibility proof

- The preview journey keeps the exact evidence visible but exposes no apply
  control and cannot claim canonical success.
- The connected journey requires an explicit item decision, applies once, and
  presents success only after Proposal, Pursuit, and receipt readback agree.
- The Chinese dark AX5 test asserts localized navigation, evidence, disclosure,
  decision title and choice copy; the confirm row occupies more than 78% of the
  viewport width and remains hittable after scrolling.
- The existing store suite retains edit validation, unavailable-evidence
  blocking, response-loss locking, relaunch reconciliation, malformed readback
  rejection, retry, conflict, and no-external-effect invariants.
- The original Today / Sessions / People navigation and bottom global Agent
  input were not changed; this remains a focused review sheet over that shell.

## Mobile UX rubric

- Task legibility: 3 — one evidence-backed decision flow.
- Hierarchy: 3 — evidence and effect precede authority and apply.
- Platform interaction: 3 — native navigation, scrolling, disclosure, selection,
  and button behavior.
- Accessibility: 3 — uncapped AX5 content, full-width choices, localized labels,
  minimum targets, and inspectable provenance.
- Visual craft: 3 — one calm material evidence block and no nested card wall.
- Vetoes: none.

final result: passed

---

# Design QA — iOS Pursuit room global continuity

## Evidence

- Evidence level: 1, executable iPhone 17 Pro Simulator interaction on iOS
  26.5.
- Final standard English:
  `/tmp/talent-signal-pursuit-global-frame-artifacts.ZqbgZx/5BC16BB8-A928-4942-9DB8-E5D83E1F1928.png`.
- AX5 veto before optical-scale correction:
  `/tmp/talent-signal-pursuit-global-frame-artifacts.ZqbgZx/CD2202E0-7C88-45BC-955F-5737BA7563D1.png`.
- Final Simplified Chinese, dark appearance, AX5 Dynamic Type:
  `/tmp/talent-signal-pursuit-global-frame-v2-artifacts.TzneyL/DDF2E4DB-499D-4007-BBF4-4AD4FCC9FAC9.png`.
- Final localized Simplified Chinese, dark appearance, AX5 Dynamic Type:
  `/tmp/talent-signal-pursuit-localized-v2-artifacts.K0ZYL1/2446F017-4CBB-449C-BB1D-48F6F11EF636.png`.
- Final localized standard English:
  `/tmp/talent-signal-pursuit-localized-standard-artifacts.iywpQ5/938F46D4-3F60-49EE-B20B-2DB0EABF19DD.png`.
- Standard and AX5 continuity result bundle:
  `/tmp/talent-signal-ios-pursuit-global-frame.xcresult`.
- Final AX5 result bundle:
  `/tmp/talent-signal-ios-pursuit-global-frame-v2.xcresult`.
- Final localized AX5 and standard result bundles:
  `/tmp/talent-signal-ios-pursuit-localized-v2.xcresult` and
  `/tmp/talent-signal-ios-pursuit-localized-standard.xcresult`.

## Structural comparison and resolution

The old iOS Pursuit destination was a separate sheet with its own
`NavigationStack` and Close control. Opening it from Today or from a living
Person removed the familiar Today / Sessions / People navigation and the
bottom global Agent input. A smaller sheet could reduce visual weight but
would preserve that context break.

The implemented direction keeps Pursuit inside the archive's page-content
layer. The unchanged global top navigation and bottom input remain outside it
as safe-area chrome. The underlying People state stays alive but is hidden from
accessibility and hit testing while the Pursuit room is open, so Back returns
to the same Person rather than rebuilding the directory. Choosing another
global tab dismisses the room. Proposal review remains a separate focused
sheet because it is a consequential human-decision boundary.

For the final AX5 hierarchy, two rendered structures were compared. Direction
A kept Target outcome as a standalone full-width paragraph before Current
frame. Direction B made Target outcome the first governed row inside Current
frame, followed by Target date, Milestone, Current blocker, and Next action.
Direction B was selected: it gives the large accessibility-sized evidence a
clear semantic anchor before it fills the viewport, preserves the full text,
and produces a more precise scan path at standard size.

## Hierarchy, action safety, and accessibility

- The first working frame is Target outcome, Target date, Milestone, Current
  blocker, and Next action. Evidence authority, confirmation, and Pursuit type
  move to a quiet Decision record after the work and outcome controls.
- Standard definition rows use an aligned grid. Accessibility Dynamic Type
  changes each row to a vertical label/value stack without clipping or
  horizontal compression.
- The initial AX5 render failed visual review: the editorial title and status
  chrome consumed the viewport. Their optical scale is now capped at the
  largest standard Dynamic Type size, while the target outcome and other body
  evidence continue to honor AX5 without truncation. Current frame begins in
  the first viewport and the rest remains scrollable above the global input.
- The inline Back control is at least 44 pt, route arrival focuses the Pursuit
  heading for accessibility, and the title stays inside the viewport in both
  tested states.
- Pursuit interface chrome is localized through the app language boundary:
  headings, field labels, dates, evidence authority, action states, receipts,
  warnings, and recovery controls use Simplified Chinese while recruiter-owned
  titles and evidence remain unchanged source content.
- Owned-action outcome recording retains its existing draft, recovery,
  canonical receipt, and explicit no-external-write language. Proposal review
  still requires a separate explicit decision; no route transition executes a
  write.
- The final localized AX5 and standard runs each passed one executable UI test
  with zero failures. A real-device VoiceOver journey remains outside this
  evidence.

## Mobile UX rubric

- Task legibility: 3 — the five-part current frame leads with outcome.
- Information hierarchy: 3 — current work precedes audit detail.
- Evidence/control: 3 — authority and receipts remain inspectable; action and
  Proposal boundaries are unchanged.
- Platform interaction: 3 — persistent global chrome, inline Back, native
  scroll, and focused decision sheet.
- Accessibility: 3 — AX5, dark mode, Simplified Chinese geometry, 44 pt target,
  route focus, wrapping, and adaptive rows verified at Level 1.
- State completeness: 3 for the changed route — Today/People entry, Person
  return, tab escape, Proposal continuation, refresh, no-gap, no-action, and
  recovery states remain represented.
- Visual craft: 3 — the original navigation is untouched, the composer stays
  global, and oversized AX5 chrome was corrected without shrinking body copy.
- Vetoes: none after correction.

final result: passed

---

# Design QA — iOS Sessions and People retrieval hierarchy

## Evidence

- Evidence level: 1, executable iPhone 17e Simulator interaction on iOS 26.5.
- Before Sessions:
  `/tmp/talent-signal-ios-retrieval.naCgFR/74065744-92B8-420A-9F07-B57010B8E100.png`
- Before People:
  `/tmp/talent-signal-ios-retrieval.naCgFR/DB8B98BF-202D-42D0-BCB3-EDD054BA6C99.png`
- After Sessions, standard English:
  `/tmp/talent-signal-retrieval-rerun-export.Y4wU7M/73E3F61E-8CF5-461D-99CC-BD0AACC965AA.png`
- After People, standard English:
  `/tmp/talent-signal-retrieval-rerun-export.Y4wU7M/169F2ABB-67D5-4B47-B244-6A65833228E8.png`
- After Sessions, Simplified Chinese, dark appearance, AX5 Dynamic Type:
  `/tmp/talent-signal-retrieval-rerun-export.Y4wU7M/02CB0D23-58D8-475C-A551-0025E5939902.png`
- After People, Simplified Chinese, dark appearance, AX5 Dynamic Type:
  `/tmp/talent-signal-retrieval-rerun-export.Y4wU7M/10445075-F482-4EE5-82C8-864102570E5D.png`
- Search-clear recovery with keyboard and global input visible:
  `/tmp/talent-signal-search-proof.eMoCPE/7F766561-0F17-4D59-8D4A-9B902A9051D5.png`
- Focused result bundles:
  `/tmp/talent-signal-ios-retrieval-complete.xcresult` and
  `/tmp/talent-signal-ios-retrieval-search-semantic.xcresult`.

## Finding and chosen direction

Sessions and People were retrieval surfaces presented as editorial landing
pages. Repeated large titles and explanatory copy consumed the first viewport.
Sessions used generic Agent symbols, long relative timestamps, and a one-line
question that hid the decisive phrase. People exposed no direct search and
showed only two partial identity rows below its introduction.

Two directions were compared: retain the large headers with reduced spacing,
or make retrieval the first interaction with a shared search field, compact
result header, and identity-led rows. The second direction was selected because
it supports the recruiter's immediate task without creating a new navigation or
input model.

## Resolution

- Sessions and People now begin with direct search and compact result counts.
- Search covers person, role or Pursuit, question, context, and latest preview;
  no-match and clear-recovery states are explicit.
- Session rows use person initials, compact relative time, a complete two-line
  question when needed, relationship context, and a bounded preview.
- People rows retain stable person identity, Pursuit context, governed-source
  count, and confirmed-identity clue count. Search changes no canonical state.
- The preview authority boundary remains visible in plain language.
- The original Today / Sessions / People navigation remains at the top, and the
  original global Agent input remains at the bottom.

## Accessibility correction and proof

The first AX5 run was a release veto: navigation and search chrome scaled into
the content, initials became ellipses, and the People name wrapped by letter.
Fixed optical symbol and initials sizes, capped chrome-only Dynamic Type, and
uncapped wrapping body text removed that failure. At final AX5, the navigation,
search, and global input remain stable while the session question, person name,
role, and evidence metadata enlarge and scroll normally.

Search result headers expose localized labels and counts as stable accessibility
elements. The final tests cover filter, no-match, clear recovery, 44 pt search
and clear targets, standard layout, Chinese dark AX5, Today regression, and
opening an existing Agent Session. Simulator proof does not replace a manual
VoiceOver journey on a real recruiter device.

## Mobile UX rubric

- Task legibility: 3 — search and the current directory are immediate.
- Hierarchy: 3 — identity or question leads; metadata remains subordinate.
- Platform interaction: 3 — native search, List, swipe, and navigation behavior.
- Accessibility: 3 — AX5, dark mode, Chinese, target sizes, wrapping, and result
  count semantics verified.
- State completeness: 3 — normal, filter, no-match, clear, and reopen covered.
- Visual craft: 3 — restrained editorial rows without marketing-page overhead.
- Vetoes: none after correction.

final result: passed

---

# Design QA — iOS living-person detail continuity

## Evidence

- Evidence level: 1, executable iPhone 17e Simulator interaction on iOS 26.5.
- Before, standard English:
  `/tmp/talent-signal-person-detail-baseline.b3pkqN/CA9AB99B-4938-4CA5-A100-47B1E0F08F1A.png`
- Before, Simplified Chinese, dark appearance, AX5 Dynamic Type:
  `/tmp/talent-signal-person-detail-baseline.b3pkqN/60A42DC1-D2B3-4E7E-9531-6DCA69CDF137.png`
- After, standard English:
  `/tmp/talent-signal-person-detail-final.g5RZOl/B0F95F74-29D4-49D9-94B7-E32D27D31789.png`
- After, Simplified Chinese, dark appearance, AX5 Dynamic Type:
  `/tmp/talent-signal-person-detail-final.g5RZOl/AA7C6177-F809-44FF-9616-71B7E7DE45E4.png`
- Focused result bundle:
  `/tmp/talent-signal-ios-person-detail-final.xcresult`.
- Navigation and retrieval regression bundle:
  `/tmp/talent-signal-ios-person-detail-regression.xcresult`.
- Preview identity-semantics result bundle:
  `/tmp/talent-signal-ios-person-detail-semantics.xcresult`.

## Mobile task and design read

The recruiter starts in People, opens one stable identity, identifies the
current Pursuit context, optionally continues into that Pursuit, returns to the
same person, and then returns to the directory. The person is canonical; role,
status, target outcome, and evidence authority are Pursuit-scoped projections.
The page is read-only and performs no create, attach, merge, or external write.

The surface uses the restrained iOS retrieval character: identity leads,
current work is the only visual dependency, evidence authority is secondary,
and governed identity counts remain inspectable without becoming metrics or a
person score.

## Structural comparison and resolution

Direction A retained the Person sheet and reduced its title. It could improve
spacing but still removed Today / Sessions / People and the global Agent input,
making a living identity feel like a temporary inspector. Direction B replaced
the sheet route with an inline People detail. It preserves the user's familiar
global frame, gives the directory a direct 44 pt back transition, and opens a
Pursuit only when that contextual row is explicitly chosen. Direction B was
implemented.

The old page also led with a large vermilion `Stable person identity` label and
an explanatory paragraph before showing any actual relationship context. The
finished hierarchy removes both, uses the person's name once, leads immediately
into Current work, and keeps Sources, Identity clues, and Contexts as quiet
definition rows. Duplicate count copy under the name was removed after AX5
visual review showed it delayed the current Pursuit.

## Accessibility and behavioral proof

- Standard interaction proves People → person → Pursuit → person → directory,
  with the top navigation and bottom global input restored throughout the
  inline person states.
- The role row exposes Pursuit title, target outcome, role/status, evidence
  authority, and a stable identifier as one button; its evidence state never
  uses color alone.
- Sources, Identity clues, and Contexts retain distinct labels, values, and
  horizontal separation in executable preview data.
- Chinese dark AX5 keeps the person name and current Pursuit visible before the
  persistent global input. Body content remains uncapped and scrollable; only
  navigation and section chrome retain a stable optical scale.
- The regression bundle passed six preview-backed tests and skipped two
  canonical fixture tests because that backend fixture was not configured.
  Those skips are not presented as canonical-data proof.
- Simulator accessibility hierarchy was inspected. A real-device VoiceOver
  linear journey and recruiter field study remain outside this evidence.

## Mobile UX rubric

- Task legibility: 3 — identity and the current Pursuit are immediate.
- Information hierarchy: 3 — one person, one contextual continuation, quiet
  identity metadata.
- Evidence/control: 3 — evidence authority is named and the governed Pursuit is
  one tap away; no consequence is staged here.
- Platform interaction: 3 — persistent tabs, inline back, native scroll, and a
  focused Pursuit transition behave predictably.
- Accessibility: 3 — AX5, dark mode, Chinese, 44 pt back target, wrapping, and
  semantic row separation are verified at Level 1.
- State completeness: 3 for the changed read-only path — optional profile,
  no-role copy, available/partial/unavailable/recruiter-authored evidence copy,
  and back recovery are implemented; canonical fixture execution is noted
  separately.
- Visual craft: 3 — scarce vermilion, no modal hero, no duplicate identity copy,
  and no person-ranking device.
- Vetoes: none after correction.

final result: passed

---

# Design QA — iOS progressive screenshot review

## Evidence

- Evidence level: 1, executable iPhone Simulator interaction.
- Standard English, light appearance:
  `/tmp/talent-signal-ios-capture-progressive-final-v2.png`
- Simplified Chinese, dark appearance, AX5 Dynamic Type:
  `/tmp/talent-signal-ios-capture-localized-ax5-final.png`
- Focused UI result bundle:
  `/tmp/talent-signal-ios-capture-progressive-v3.xcresult`
- Localized evidence-boundary result bundle:
  `/tmp/talent-signal-ios-capture-localization-v4.xcresult`
- Device: iPhone 17e Simulator, 390 × 844 pt at 3×.

## Finding and resolution

The review previously presented evidence, identity clues, and relationship
scope as three equally prominent cards. It read like an upload form and repeated
speaker state in several controls before the recruiter reached the identity
decision.

The finished surface has two progressive steps. Reviewed OCR and original-image
inspection remain first. Name and one visible identity clue form the second
step, while optional relationship fields stay behind a concise 44 pt disclosure
row. Speaker provenance is one compact menu and still permits an explicitly
unresolved result. No field, source metadata, identity review, or consequential
write gate was removed.

Executable testing found that the first `DisclosureGroup` implementation looked
correct but did not reliably reveal its fields through the accessibility tree.
It was replaced with an explicit stateful button that reports collapsed or
expanded state and makes the entire row tappable.

## Behavioral proof

- The default review exposes inspectable source, editable OCR, unresolved
  speaker status, name, handle, and handle type without preselecting a Person.
- Relationship label, purpose, and role do not crowd the initial view; tapping
  Relationship details reveals all three fields.
- Identity review is absent before Save and check identity. The existing later
  create, attach, conflict, merge, and receipt boundaries remain unchanged.
- The familiar Today / Sessions / People navigation and bottom global composer
  were not modified by this review-surface change.

## Accessibility and limits

The standard small-screen capture has no clipped speaker label. In the AX5 dark
capture, the evidence editor, speaker state, 44 pt menu, guidance, and second-step
heading remain readable without horizontal overflow. All 89 static interface
keys used by `RelationshipCaptureView` now resolve through the catalog, including
source inspection, progress, identity decisions, completion, recovery, field
labels, menu roles, and accessibility names and values. Choosing Unresolved in
the speaker menu preserves the unresolved state language instead of presenting
the contradictory `reviewed · unresolved` label.

The Chinese AX5 test deliberately supplies an English conversation sentence.
The controls become Chinese while the editable evidence stays byte-for-byte
equal to the supplied sentence. This is the intended locale boundary, not mixed
interface copy. Free-form backend or provider diagnostics may still arrive in
their source language; this run does not claim structured localization for all
remote error payloads or VoiceOver-user research.

final result: passed

---

# Design QA — Cross-surface voice composer continuity

## Evidence

- Evidence level: 1, executable Web workspace and iPhone Simulator interaction.
- Web state: signed-in synthetic fixture workspace, narrow Agent rail, light
  appearance, scoped relationship.
- iOS result bundle:
  `/tmp/talent-signal-ios-input-continuity.xcresult`
- Web automated proof: 48 passed files plus one intentionally skipped file; 266
  passed tests plus one intentionally skipped test.
- iOS automated proof: 12 voice lifecycle unit tests and 3 composer UI tests.

## Finding and resolution

The first Web implementation placed microphone and Send beside the attachment
control and textarea. In the narrow Agent rail this became four columns, reduced
the useful writing area, and let the first-use disclosure extend beyond the
composer boundary.

The finished control uses the same compact state grammar as iOS. When the draft
is empty, the trailing primary position is voice; after typed or transcribed
text appears, that position becomes Send. The disclosure is contained inside
the composer width. Today / Agent / People navigation and the existing global
input location do not change.

## Behavioral proof

- First use states that temporary audio is sent to Doubao, is not retained by
  Talent Signal, and cannot reach the Agent until Send.
- Recording is foreground-only, capped at 60 seconds, locally converted to a
  bounded 16 kHz mono WAV, and cancellable before and during transcription.
- The server rejects invalid WAV data and cross-origin requests before remote
  transcription.
- The client accepts only the matching draft receipt with
  `temporary_audio_stored_by_talent_signal: false`.
- The in-app browser had no microphone device; the rendered failure named that
  condition, preserved the empty composer, and offered a dismissible recovery.
- Typing a message replaced the microphone with Send in place and performed no
  write.
- On iPhone, deterministic voice stopped into an editable composer draft and
  did not create an Agent response. AX5 kept Photos, composer, and the review
  boundary in one vertical flow.

## Accessibility and limits

The Web microphone exposes a pressed recording state, polite status updates,
named cancellation controls, visible failure text, and keyboard focus styling.
The iPhone run verified 48 pt voice control height and AX5 reachability. This run
does not claim physical microphone quality, VoiceOver-user research, or field
latency; the browser environment exposed no hardware microphone, and the iOS
voice transcript used the deterministic test adapter.

final result: passed

---

# Design QA — iOS conversation-first contact recovery

## Evidence

- Unknown outcome:
  `/tmp/talent-signal-contact-response-loss-readonly-attachments/D7C9540A-6CE7-4553-B0CA-8ED66C5DFF8F.png`
- Reconciled receipt:
  `/tmp/talent-signal-contact-response-loss-readonly-attachments/06213498-FF07-4163-BC43-E7BA221BF598.png`
- Executable result bundle:
  `/tmp/talent-signal-contact-response-loss-e2e-final-readonly.xcresult`
- Device: iPhone 17 Simulator, 1206 × 2622 pixels, light appearance, English.
- Additional regression: AX5 dark Simplified Chinese contact review in
  `/tmp/talent-signal-contact-localized-ui.xcresult`.

## Finding and resolution

A committed contact creation can lose its network response. On relaunch the
new person then appears in identity search, so recomputing the destination from
the latest result could silently turn the original create into attach. The
finished recovery state preserves the exact recruiter-confirmed operation,
shows refreshed lookup as read-only context, and labels the only primary action
Retry same operation. The successful state changes to completed language and a
canonical receipt; its controls are read-only.

The familiar top Today / Sessions / People navigation was not changed. The
global message, attachment, and voice input remains anchored at the bottom and
reachable throughout review.

## Behavioral proof

- The proxy committed the first resource capture and deliberately dropped its
  response.
- Relaunch restored the proposal under the signed-in account and showed the
  newly created identity without allowing it to change the target.
- Retry sent the same idempotency key and byte-equivalent semantic request: both
  canonical JSON hashes were identical and the proxy reported no differing
  path.
- The backend returned the original canonical result; the UI showed one source
  receipt and retained the original note as provenance.
- No merge or external Contacts write occurred.

final result: passed

---

# Design QA — iOS conversation-first contact proposal

## Evidence

- Default light proposal:
  `/tmp/talent-signal-contact-ui-final-attachments/287C4E39-B835-47D7-9AC7-3D88DCD17C08.png`
- AX5 dark Simplified Chinese proposal:
  `/tmp/talent-signal-contact-ui-final-attachments/CE25CF7D-3A9F-4644-B805-A2D472D52521.png`
- Focused result bundle:
  `/tmp/talent-signal-contact-final-suite.xcresult`
- Device: iPhone 17 Pro Simulator, portrait, 1206 × 2622 pixels.

## Finding and resolution

The proposal card previously treated an exact local name match as its duplicate
check. A name is not identity evidence, and a connected workspace failure was
not represented as a distinct lookup state. The contact write also described
the governed source as a personal note even when it confirmed an email, phone,
or LinkedIn handle.

The iOS path now performs a read-only account-scoped search using the parsed
identity clue, accepts only current or expired governed handle matches as
authoritative candidates, and keeps same-name results visibly non-authoritative
when no clue exists. Checking, no-match, conflict, failure, retry, and explicit
separate-person choices remain inside the same proposal card. Save stays
disabled until checking completes. The reviewed source is encoded as a
`contact_record` / `contact_field`, and the success state includes the retained
person and source-receipt suffix.

## Mobile review

The top session control and bottom global composer were unchanged. The contact
operation remains the visual lead without replacing the familiar navigation or
introducing another form. The identity clue is included by default but remains
reversible before the one final confirmation. At AX5 in dark Simplified
Chinese, the editable name, relationship, identity clue, workspace status,
50-point confirmation control, safety boundary, and bottom composer all remain
visible and reachable without horizontal clipping.

## Behavioral proof and limit

- 9 focused iOS domain/decoding tests passed for English, Chinese, ordinary
  questions, missing names, phone, LinkedIn, source preservation, same-name
  caution, and governed identity-match decoding.
- 2 focused iOS UI tests passed, including relaunch recovery and AX5 dark
  Simplified Chinese; the identity clue remains included after proposal staging.
- The backend suite passed 173 tests, including confirmed/expired handle search
  behavior and privacy-preserving hashed lookup.
- The Simulator proof intentionally used the disconnected preview safety state,
  so it does not claim a live canonical create/attach receipt. That final
  authorized end-to-end proof remains required before the broader plan closes.

final result: passed with canonical receipt proof pending

---

# Design QA — iOS global screenshot handoff and Ask continuity

## Evidence

- Before: `/tmp/talent-signal-ios-paperclip-before.pLX9Sm/attachments/6AAD7ADB-95CA-45B0-80AF-3EA00ABBCD02.png`
- After cancellation: `/tmp/talent-signal-ios-paperclip-after.LZT45P/attachments/2E5DB363-3199-4FBB-A755-8CAA0C5E4E61.png`
- Direct system Photos picker: `/tmp/talent-signal-ios-paperclip-after.LZT45P/attachments/70503033-13BF-4034-847E-864FE40F4D70.png`
- Governed source review: `/tmp/talent-signal-ios-paperclip-ax-after/attachments/13333B25-0EEA-4537-85A8-66B10FFF52C2.png`
- AX5 dark Simplified Chinese cancellation:
  `/tmp/talent-signal-ios-paperclip-ax-final2-attachments/C6822CF1-F977-431C-BF87-4B77409F0DA8.png`
- AX5 dark Simplified Chinese localized recovery:
  `/tmp/talent-signal-ios-paperclip-ax-final2-attachments/FED07A74-CCD0-41FE-B630-A5706DD11254.png`
- Before/after comparison:
  `/tmp/talent-signal-ios-paperclip-before-after.png`
- Device: iPhone 17 Pro Simulator, 1206 × 2622 pixels.
- Current Ask-to-system-picker proof:
  `/tmp/talent-signal-global-paperclip-artifacts.NKemaU/82909FE1-8469-441F-8367-B883E86E93FD.png`
- Current governed-review cancellation state:
  `/tmp/talent-signal-global-paperclip-artifacts.NKemaU/B97497E6-E6C6-4D51-A0D7-F32E22887327.png`
- Current protected-draft return state:
  `/tmp/talent-signal-global-paperclip-artifacts.NKemaU/43A1EFDB-8499-4D76-BF3C-C29C10A30152.png`
- Current five-journey navigation, input, AX5, and contextual-Session bundle:
  `/tmp/talent-signal-global-paperclip-ui.xcresult`.
- Current picker-cancel and exact-draft recovery bundle:
  `/tmp/talent-signal-global-paperclip-recovery-ui-retry.xcresult`.

## Finding and resolution

The paperclip previously opened a second capture workbench containing both a
text Signal form and an image-import card. That duplicated the persistent
global Agent input and made a simple attachment action feel like an upload
workflow.

The paperclip now directly opens the system Photos picker. Cancelling returns
to one quiet Open Photos row, never to the text Signal form. Selecting an image
continues into the existing on-device text and identity review, with no contact
or external write from selection alone. Interrupted screenshot review remains
recoverable through the existing pending-capture handoff.

The same rule now continues inside the focused Ask composer. Leaving its
paperclip disabled until a relationship was selected was rejected because it
quietly reintroduced the form-first dependency the global input removed. An
intermediate Text / Photo / Voice chooser was also rejected because it
duplicated intent already visible in the composer. The selected contextual
semantics keep one visual control: without relationship scope it opens one
conversation screenshot for governed review; inside an existing relationship
Session it remains the task-image attachment control and may select up to ten
non-evidence images. The two routes use an Ask-local semantic event rather than
adding another state to the global App Intent router.

Cancellation is interruption-safe. A typed global draft is persisted before
the system picker appears, the focused Ask closes cleanly into screenshot
review, and closing that review returns to Today. Reopening the unchanged
bottom global input restores the exact message with no implicit Person or
relationship. The first attempt to verify this path exposed that the system
picker still covered the review page; the final test cancels that native layer
before exercising the in-app close action, matching the real user sequence.

Visual QA found and fixed a second-order iOS defect: the scaled screenshot
thumbnail could draw outside its layout frame and collide with source text at
AX5. The final source card clamps the thumbnail to a 76-point rounded frame,
replaces the generated filename with a stable conversation-screenshot label,
and localizes the review, safety, and no-text recovery states in Simplified
Chinese.

## Behavioral and accessibility proof

- Today / Sessions / People remain in the existing top navigation; the bottom
  global input remains the only creation surface.
- The system picker opens directly and cancellation performs no write.
- The selected image reaches governed review; the generated technical filename
  is absent from the visible hierarchy.
- The Open Photos target remains at least 55.5 points high at AX5 and is
  hittable in dark appearance.
- The AX5 dark Simplified Chinese run verifies readable source layout, localized
  failure recovery, and absence of the text Signal controls.
- All evidence is local Simulator state; no contact, message, meeting, ATS,
  CRM, reminder, canonical record, or external system was written.
- In a scoped calendar-preparation Session, `ask-add-photos` remains enabled
  and the unscoped screenshot-review action is absent. In a new global Ask,
  `ask-review-screenshot` is enabled at 44 points while no scope selector is
  shown.
- The current matrix passed five of five journeys; the recovery rerun passed
  one of one after correcting the test to cancel the native Photos layer.

final result: passed

---

# Design QA — iOS global input and retrieval hierarchy

## Evidence

- Sessions before: `/tmp/talent-signal-ios-shared-sessions-export/B13DA727-E80B-4BAB-8A86-113BC880715D.png`
- Sessions after: `/tmp/talent-signal-ios-people-after.qWNR70/attachments/2C1A3724-7ADF-40AC-AB66-AA654B20CCD2.png`
- Sessions comparison: `/tmp/talent-signal-ios-sessions-before-after.png`
- People divider before: `/tmp/talent-signal-ios-nav-after.Gda6k3/attachments/FA8AF66A-608D-4AA9-96B5-3AEC3A7DCFA2.png`
- People divider after: `/tmp/talent-signal-ios-people-after.qWNR70/attachments/FAF133E3-E0D2-4530-B24A-1AD8B638C32A.png`
- People comparison: `/tmp/talent-signal-ios-people-divider-before-after.png`
- Result bundles:
  `/tmp/talent-signal-ios-nav-after.Gda6k3/nav-after.xcresult` and
  `/tmp/talent-signal-ios-people-after.qWNR70/people-after.xcresult`
- Device and state: iPhone 17 Pro Simulator, 1206 × 2622 pixels, light
  appearance, synthetic preview workspace.

## Findings and resolution

Sessions exposed a second creation intent through a high-emphasis upper-right
plus button even though the global Agent input was persistently reachable at
the bottom. The redundant control is removed. Today / Sessions / People remain
unchanged in the top rail, Sessions remains a retrieval surface, and new work
starts only through the bottom global input.

Visual inspection also found that the People row `Divider` inherited vertical
orientation and crossed identity content. It now uses an explicit one-point
horizontal rule, preserving row density and stable identity metadata without
changing any person, role, or evidence state.

## Behavioral and accessibility proof

- Three focused iOS UI tests passed: direct Sessions/People retrieval, paging
  Today → Sessions → People in both directions, and top navigation remaining
  above the screenshot-capable global input.
- A regression assertion verifies that `new-agent-session` is absent while
  `relationship-guide` remains present on Sessions and People.
- Release and Debug Simulator builds succeeded.
- The iOS localization boundary passed with 315 catalog keys, 172 transitional
  inline bilingual calls, and 210 raw SwiftUI literals.
- Opening these retrieval surfaces performed no canonical or external write.

final result: passed

---

# Design QA — Dark appearance and review targets

## Evidence

- Today: `/tmp/talent-signal-dark-audit-01-today.png`
- People: `/tmp/talent-signal-dark-audit-02-people.png`
- Agent workspace: `/tmp/talent-signal-dark-audit-03-agent.png`
- Pursuit decision controls:
  `/tmp/talent-signal-dark-audit-04-proposal-controls.png`
- Viewport: in-app browser, 1280 × 720 CSS pixels.

## Findings and resolution

Today, People, and Agent retained the same attention order in dark appearance:
warm-black canvas, scarce vermilion, readable secondary metadata, and no new
elevation or glow. The Pursuit decision choices were semantically clear but
used 35 px pills, below the product's mobile/touch target standard.

Confirm, Edit, Reject, and Keep unresolved now use 44 px minimum targets.
Review submission, recovery, and next-review controls use the same minimum.
The selected Confirm state was verified in dark appearance; no submission was
attempted and the canonical write remained disabled without a decision basis.

## Evidence limits

This run verifies rendered light/dark states, visible focus, DOM semantics, and
minimum CSS target geometry. It does not claim full color-contrast or
screen-reader certification across every browser and platform.

final result: passed

---

# Design QA — Today to Pursuit decision continuity

## Evidence

- Step 1, Today before correction:
  `/tmp/talent-signal-pursuit-audit-01-today.png`
- Step 2, prior Pursuit arrival:
  `/tmp/talent-signal-pursuit-audit-02-room.png`
- Step 3, Today after correction:
  `/tmp/talent-signal-pursuit-audit-03-today-after.png`
- Step 4, exact review arrival:
  `/tmp/talent-signal-pursuit-audit-05-review-focused.png`
- Before/after arrival comparison:
  `/tmp/talent-signal-pursuit-audit-comparison.png`
- Viewport: in-app browser, 1280 × 720 CSS pixels.
- State: light appearance, synthetic fixture, one review-ready Proposal.

## Finding and resolution

Today correctly gave the Proposal visual priority, but its primary Open
Pursuit room action landed at the top of a large overview. The decision Today
had just highlighted was below the first viewport, forcing the recruiter to
rediscover it inside the governed object.

Review-ready items now say Review proposal and link to the exact Proposal.
Action- and gap-led items still open the Pursuit overview. The proposal is a
named region, receives programmatic focus after fragment navigation, and uses
the existing consequential focus token. Raw target-outcome and milestone enums
are also presented as readable phrases without changing canonical values.

## Behavioral proof

- The Today focus item and compact review continuations use the Proposal
  fragment only when the attention kind is review and status is needs_review.
- The browser arrived with the Proposal visible, the exact evidence and
  before/proposed values in the first viewport, and the Proposal region as the
  active element.
- A review-ready Today item exposes only Review proposal; it no longer also
  presents a second Agent-run input while the human decision is pending.
- No decision was preselected and Submit exact review remained disabled.
- The transition performed no canonical or external write.

## Accessibility evidence and limit

DOM inspection confirmed a labeled Proposal region and programmatic focus on
arrival. The radio group retained distinct Confirm, Edit, Reject, and Keep
unresolved choices. This run does not claim full screen-reader or platform
accessibility compliance; it verifies the rendered DOM, focus destination, and
visible focus treatment only.

final result: passed

---

# Design QA — People directory hierarchy

## Evidence

- Before: `/tmp/talent-signal-web-people-audit.png`
- After: `/tmp/talent-signal-web-people-after.png`
- Combined comparison: `/tmp/talent-signal-web-people-comparison.png`
- Viewport: in-app browser, 1280 × 720 CSS pixels.
- State: light appearance, synthetic fixture directory, no active query.

## Finding and resolution

The prior three-line display heading consumed most of the first viewport and
made People materially denser to enter than Today or Agent. Only one directory
row was partly visible, so a retrieval surface behaved like a marketing hero.

The finished hierarchy uses the same single-word product title pattern as
Today, keeps the safety boundary in the supporting sentence, aligns content to
the shared 1260 px editorial measure, and reduces the transition into results.
Two complete relationship rows are now visible without reducing their 44 px
open controls or compressing identity and evidence metadata.

## Implementation checklist

- [x] Preserve the existing People route and search behavior.
- [x] Preserve Today / Agent / People navigation and the global New action.
- [x] Preserve distinct same-name records instead of visually merging them.
- [x] Keep context, source count, and confirmed-identity count visible.
- [x] Match the Today page's title, measure, and vertical rhythm.
- [x] Verify the finished hierarchy in the real browser.

final result: passed

---

# Design QA — Web Agent input consolidation

## Evidence

- Before: `/tmp/talent-signal-web-before-input-consolidation.png`
- After: `/tmp/talent-signal-web-after-input-consolidation.png`
- Combined comparison:
  `/tmp/talent-signal-web-input-consolidation-comparison.png`
- Viewport: in-app browser, 1280 × 720 CSS pixels.
- State: light appearance, synthetic fixture relationship, Agent composer idle.

## Findings and resolution

The previous workspace exposed four capture concepts at once: a high-emphasis
Add source rail action, Import screenshot in the page bar, image attachment in
Chat, and a persistent Choose source launcher inside the contact page. This
made the governed evidence model feel like an upload workflow instead of an
Agent conversation.

The finished state has one primary intent surface. The quiet New rail action
focuses the existing Agent composer, including on a same-route transition. The
composer's single attachment disclosure separates temporary task images from
governed sources with plain authority copy. The full source composer remains
available only after the recruiter explicitly chooses Governed source; no
source or contact write occurs from opening it.

## Browser behavioral proof

- Activating Start a new Agent message moved focus to
  `relationship-agent-composer` and removed the transient compose intent from
  the URL.
- Opening Add an attachment or governed source exposed exactly Task images and
  Governed source.
- Choosing Governed source opened the existing provenance-aware source
  composer with Note, Transcript, File, Link, and Screenshot modes.
- The default contact page no longer exposed Import screenshot, Choose source,
  Add another governed source, or the high-emphasis Add source rail control.

## Implementation checklist

- [x] Preserve Today / Agent / People navigation.
- [x] Route the global New action to one Agent composer.
- [x] Keep temporary task media distinct from governed evidence.
- [x] Preserve provenance, authorization, review, and deletion paths.
- [x] Keep consequential writes behind their existing explicit review steps.
- [x] Remove redundant capture launchers from the default page hierarchy.
- [x] Verify focus, progressive disclosure, and governed-source expansion in
      the real browser.

final result: passed

---

# Design QA — Web natural contact intake and duplicate bridge

## Evidence

- Contact proposal:
  `/tmp/talent-signal-web-contact-proposal-final.png`
- Reversible merge preview:
  `/tmp/talent-signal-web-contact-merge-preview-final.png`
- Viewport: in-app browser, 1280 × 720 CSS pixels.
- State: signed-in synthetic fixture workspace, light appearance.

## Finding and resolution

The compact contact card initially kept a sticky disabled commit action in the
first viewport while its identity result sat below the fold. That made the
consequence look more important than the evidence used to choose it. The
finished card lets identity check lead, keeps extracted details and source
details collapsed when the message is complete, and places the final action at
the end of review.

`Add Noor Vega for Design` now reads back exactly `Noor Vega` and `Design`; it
does not require form-like `search` or `role` suffixes. When an exact-name page
matches the person already open and at least one other page exists, the card
offers Review possible duplicate. This opens the current reversible merge
preview. For an unrelated current page the bridge remains absent.

## Behavioral proof

- One message staged the contact card and cleared the composer without a write.
- Name and relationship were extracted independently and the original message
  remained visible as the source note.
- Account-scoped search showed distinct matching pages and left create disabled
  until the recruiter made an identity decision.
- The duplicate bridge opened Identity maintenance with the current page as the
  stable target; no merge decision was selected or submitted.
- Today / Agent / People navigation and the global bottom composer were
  preserved.

final result: passed

---

# Design QA — iOS Ask input-first empty session

## Evidence

- Evidence level: 1, executable iPhone 17e Simulator interaction on iOS 26.5.
- Before, standard English:
  `/tmp/talent-signal-ask-audit.iIw8Py/5C291ED3-AF84-4B15-9D24-D94886FE2CA9.png`
- Before, AX5 Dynamic Type:
  `/tmp/talent-signal-ask-audit.iIw8Py/B27EA86E-F7D9-4034-AF8F-B2DB96C215AB.png`
- After, standard English:
  `/tmp/talent-signal-ask-final.wDU0sZ/1B533C6F-8ED0-4BDE-AB7F-39F754C1231E.png`
- After, Simplified Chinese, dark appearance, AX5 Dynamic Type:
  `/tmp/talent-signal-ask-final.wDU0sZ/29FFEEF0-8DAB-4822-9D56-1514D26EE192.png`
- Focused result bundle:
  `/tmp/talent-signal-ios-ask-simplification-v2.xcresult`

## Finding and resolution

The prior empty session repeated the selected person as a large editorial
heading, then exposed three equally weighted horizontal prompt pills. The
standard layout clipped the last prompt, while AX5 turned the prompts into a
stack of oversized rows that displaced the conversation and made a simple
message entry feel like another form. At AX5 the attachment and voice symbols
also scaled beyond their fixed circular controls.

The finished session keeps the relationship selector as the only context
header, moves the three optional starters into one native menu, and leaves the
conversation and bottom composer as the visual lead. The menu still requires
an explicit choice before sending and remains disabled for preview data. SF
Symbols use a fixed optical size inside controls that expand from 44 to 52 pt
at accessibility categories, so the target grows without icon overflow.

The familiar Today / Sessions / People navigation and the global input entry
were not moved or restyled. This change is scoped to the Ask sheet opened from
that existing entry.

## Behavioral and accessibility proof

- Standard and Chinese dark AX5 tests verify the relationship scope, optional
  prompt menu, attachment, voice, composer, and preview authority boundary all
  remain reachable in one column.
- Voice input still produces an editable draft and does not create an Agent
  response until Send is tapped.
- The canonical prompt-menu path is encoded in the fixture-backed UI test. Its
  current local run skipped because the Pursuit backend fixture was unavailable;
  the preview, AX5, and voice paths executed successfully.
- Dynamic Type enlarges conversation content. Persistent relationship-selector
  chrome is optically capped at XXXL while its complete value remains exposed
  to assistive technology; no text or control crosses the viewport, and both
  media controls retain at least a 44 pt target.

## Mobile UX rubric

- Task legibility: 3 — the composer is the unmistakable primary action.
- Hierarchy: 3 — relationship context appears once; starters are progressive.
- Platform interaction: 3 — native Menu, PhotosPicker, text, and voice patterns.
- Accessibility: 3 — AX5, dark mode, Chinese, target size, and wrapping verified.
- Visual craft: 3 — no clipped prompt strip, icon spill, or competing title.
- Vetoes: none.

final result: passed

---

# Design QA — iOS Agent evidence-bound conversation

## Evidence

- Evidence level: 1, fixture-backed iPhone 17 Pro Simulator interaction on
  iOS 26.5.
- Before, standard English response:
  `/tmp/talent-signal-ios-ask-response-baseline-artifacts.LUK2kR/F916899D-B2E3-4EE8-9405-92B2586DC7DD.png`
- Before, Simplified Chinese, dark appearance, AX5 Dynamic Type:
  `/tmp/talent-signal-ios-ask-response-ax5-baseline-artifacts.aI8vsy/2A805D50-B4CE-4DF1-9A2E-9297E2404AA6.png`
- After, standard English response:
  `/tmp/talent-signal-ios-ask-response-final3-artifacts.SamdXm/CA637797-9A64-450D-9B7E-5251349CA0F2.png`
- After, Simplified Chinese, dark appearance, AX5 Dynamic Type:
  `/tmp/talent-signal-ios-ask-response-final3-artifacts.SamdXm/86F61D35-0717-4D61-9521-5A6E12334147.png`
- Final micro-craft pass, standard English response:
  `/tmp/talent-signal-ios-ask-bubble-final-artifacts.0wmh0K/592257BB-140B-4539-844E-61A8FCA4B2A9.png`
- Final micro-craft pass, Simplified Chinese, dark appearance, AX5 Dynamic
  Type:
  `/tmp/talent-signal-ios-ask-bubble-final-artifacts.0wmh0K/19FD8B48-E635-4E1D-8E7F-A2B367C721B8.png`
- Exact evidence detail:
  `/tmp/talent-signal-ios-ask-bubble-final-artifacts.0wmh0K/A4D67804-1CB6-4F2A-84DE-F57769887C5B.png`
- Focused result bundle:
  `/tmp/talent-signal-ios-ask-bubble-final.xcresult`

## Finding and resolution

The populated conversation was functionally sound but did not yet read like a
quiet IM tool. A solid graphite user bubble was the heaviest element; the first
answer heading repeated the selected person's name; review state was icon-only;
and controlled Agent headings plus citation provenance remained English in a
Chinese interface. At AX5, relationship-selector chrome and a hidden verbose
starter instruction consumed nearly the whole first viewport, then automatic
bottom anchoring opened a long response at its conclusion.

The finished response uses a quiet bordered question bubble and shows the exact
short starter the recruiter chose. Accessibility-size responses anchor at the
beginning of the new turn. The relationship selector stays compact as persistent
chrome, while the conversation keeps full Dynamic Type. The response now leads
with `Current understanding`, keeps exact evidence content unchanged, exposes a
text-and-symbol `Needs review` state, and localizes controlled block titles,
dates, actor kind, and review status. Existing owned work remains distinct from
a proposed action and still declares that it creates no external effect.

The final micro-craft pass removes the fixed 330-point question width. A short
message now shrink-wraps its content like a quiet IM bubble; `ViewThatFits`
switches longer messages and accessibility sizes to a wrapping layout bounded
at 330 points. The standard fixture's `What changed?` bubble is under 280 points,
while the Chinese AX5 bubble remains within the viewport without truncating its
question or reducing Dynamic Type.

The send moment now follows the same conversation hierarchy. Two structures
were compared: embedding a mutable progress/error state inside the recruiter's
right-hand bubble, or treating the recruiter message as an immediate immutable
echo while the Agent reports its own state in a separate left-hand row. The
second direction was selected because it preserves authorship and never makes
the recruiter's words look as though the Agent can edit their state. On send,
the composer clears visually, the exact question and any task-image thumbnails
appear immediately at the right, and a quiet `Reading the record…` row appears
at the left. This pending turn is only an ephemeral projection; a canonical
`AgentSessionTurn` is recorded after the validated response returns.

Failure restores the exact question and retained media to the composer while
keeping the existing idempotency intent available for retry. The failure card
scrolls into view and exposes `Retry` as a distinct accessible child. The first
focused failure run revealed that the row-level accessibility identifier was
overwriting the child button identifier despite a visually visible control;
the final container preserves child semantics, and the same-intent retry now
passes end to end.

The established Today / Sessions / People navigation and bottom global Agent
entry were not moved or restyled.

## Behavioral, safety, and accessibility proof

- Three UI tests passed against the canonical fixture: the standard cited
  answer and evidence-dispute recovery, the Chinese dark AX5 populated answer,
  and the AX5 input-first empty session.
- The AX5 test verifies the short Chinese question, localized response headings,
  localized candidate/review provenance, bounded bubble width, citation
  reachability, and persistent bottom composer.
- The standard test verifies the exact user-message label and content-sized
  geometry, preventing a short prompt from regressing to a form-like full row.
- The standard path still opens the exact cited fragment, marks the saved answer
  stale after a dispute, and opens the referenced existing Pursuit action.
- One unit test verifies source-timezone boundaries and localized citation
  provenance. Release build and the localization boundary passed.
- The send-state verification covers standard English, Simplified Chinese dark
  AX5 with Reduce Motion, a five-task-image message, and failure recovery. The
  three non-failure journeys passed in
  `/tmp/talent-signal-ios-ask-pending-final.xcresult`; the corrected focused
  failure and same-intent retry passed in
  `/tmp/talent-signal-ios-ask-pending-failure-v3.xcresult`.
- Final send-state renders are:
  `/tmp/talent-signal-ios-ask-pending-artifacts.wkm72W/main/5EC40826-F1A5-454E-8126-76243111B046.png`
  (standard pending),
  `/tmp/talent-signal-ios-ask-pending-artifacts.wkm72W/main/E2120393-85EE-40FF-8F15-BA8BD9052094.png`
  (Chinese dark AX5 pending),
  `/tmp/talent-signal-ios-ask-pending-artifacts.wkm72W/main/3C522C53-2DCB-465F-B313-3B8AA13C1F77.png`
  (five-image pending), and
  `/tmp/talent-signal-ios-ask-pending-artifacts.wkm72W/failure/D2929875-1CBA-4280-B3D6-4DCD60A7DA19.png`
  (failure restoration).
- Exact excerpts, person names, and backend evidence content are never silently
  translated. No contact, message, calendar event, or external system write is
  authorized by this presentation layer.

## Mobile UX rubric

- Task legibility: 3 — the selected question and beginning of the answer lead.
- Hierarchy: 3 — understanding, evidence, and owned work are distinguishable.
- Platform interaction: 3 — native scrolling, sheets, Menu, and pinned composer.
- Accessibility: 3 — AX5, dark mode, Chinese, wrapping, and provenance verified.
- Visual craft: 3 — quiet bubble, compact chrome, and no duplicate person title.
- Vetoes: none.

final result: passed

---

# Design QA — iOS Today inline decisions

## Source truth and implementation evidence

- Selected visual direction: option 2,
  [selected-direction-2.png](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-02-ios-today-inline-decisions/selected-direction-2.png).
- Implemented iPhone 17 Pro Simulator surface:
  [implementation-final.png](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-02-ios-today-inline-decisions/implementation-final.png).
- Same-state combined comparison:
  [source-vs-implementation.png](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-02-ios-today-inline-decisions/source-vs-implementation.png).
- Reference source: 852 × 1844 pixels. The comparison pads it to the
  implementation viewport without cropping.
- Implementation viewport: 1206 × 2622 pixels at iPhone 17 Pro Simulator
  density, iOS 26.5, Simplified Chinese, light appearance, standard Dynamic
  Type.
- Compared state: synthetic preview, next relationship moment visible, two
  pending inline decisions, evidence collapsed.
- Focused approved-contact receipt:
  [contact-approved-receipt.png](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-02-ios-today-inline-decisions/contact-approved-receipt.png).
- Focused dismissed-calendar receipt:
  [calendar-dismissed-receipt.png](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-02-ios-today-inline-decisions/calendar-dismissed-receipt.png).

## Finding and resolution

The first implementation pass preserved the selected card hierarchy but made
the calendar rail too wide, exposed a redundant activity-count badge, truncated
the relationship moment, used 10:00 after the afternoon cutoff, and inherited
generic Chinese labels (`日历`, `修正`, `关闭`) that did not match the selected
decision language. The final pass narrows the time rail, removes the badge,
localizes the preview relationship context, keeps Singapore time visible, and
projects the next preview moment at 15:00. Card labels now read `日程`, `编辑`,
and `忽略`.

The native Talent Signal navigation and global Agent composer intentionally
remain around the selected content. Within that real shell, both decision cards
fit in the initial viewport with their complete three-option controls. The
source's quiet surface, serif decision question, vermilion category, evidence
row, light border, and black primary action are preserved. The compact
`合成预览` marker is an intentional authority boundary absent from the visual
concept.

Approval and dismissal replace a proposal with a compact local receipt and an
Undo control. The receipts explicitly say that Contacts or Apple Calendar were
not written. Editing changes preview proposal fields only. Evidence expansion
shows the exact synthetic conversation excerpt and does not promote it to
confirmed state.

## Behavioral, safety, and accessibility proof

- Release simulator build passed.
- Three focused UI tests passed: the complete default Today hierarchy; the
  evidence, edit, approve, dismiss, receipt, and undo journey; and the same
  interaction controls in Simplified Chinese, dark appearance, AX5 Dynamic
  Type, and Reduce Motion.
- Two focused relationship-calendar unit tests passed, including the preview
  projection and canonical no-invention boundary.
- All six inline action buttons retain an effective 44-point target (XCTest
  tolerance accounts for fractional simulator coordinates).
- New Today copy is routed through `Localizable.xcstrings`, and the repository
  localization boundary passes.
- The synthetic decisions cannot write to Contacts or Calendar. Canonical Today
  continues to render only typed backend attention and governed calendar state;
  it does not infer an external-write proposal from summary text.

## Mobile UX rubric

- Task legibility: 3 — date, next moment, decision count, and exact effect lead.
- Hierarchy: 3 — two cards carry the work; secondary context is visually quiet.
- Platform interaction: 3 — native sheet editing, buttons, scrolling, and Undo.
- Accessibility: 3 — semantic labels, evidence state, receipts, and 44 pt targets.
- Visual craft: 3 — selected direction matched inside the established app shell.
- Vetoes: none.

final result: passed

---

# Stable iOS navigation design QA

## Comparison target

- Source visual truth: `/Users/cubxxw/Downloads/IMG_6984.PNG`
- Implementation screenshot: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v2/final-v9/6053BAE1-8579-44D8-BA73-C6934B6D9DAF.png`
- Viewport: iPhone 17 Pro simulator, 402 x 874 points, light appearance, Sessions selected
- Source pixels: 1206 x 2622; implementation pixels: 1206 x 2622
- Logical size and density: both normalized to a 402 x 874 point viewport at 3x. CSS size is not applicable to this native SwiftUI surface. The source's 144 DPI file metadata was normalized when composing the comparison and did not change its pixel dimensions.
- State: signed-in synthetic preview with Sessions selected. The reference provides interaction and navigation-state direction; its app content, Dynamic Island, avatar, and product-specific destinations are not implementation targets.

## Evidence

- Full-view comparison: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v2/final-v9/full-view-comparison.png`
- Focused navigation comparison: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v2/final-v9/focused-navigation-comparison.png`
- Additional final states:
  - Today: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v2/final-v9/F2841851-9A01-4037-B10B-888C0B496297.png`
  - People: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v2/final-v9/6A5EDBE2-62AD-4C01-99E8-3C26A30FE33B.png`
  - Meetings: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v2/final-v9/B7BBF61F-9448-4938-B937-EF906F4A8F88.png`
  - Chinese dark mode with reduced motion: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v2/final-v9/E684098B-0544-454B-9A78-45FE4B77C9F1.png`
  - AX5 LTR: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v2/final-v9/C9123A3C-150A-45B5-A61F-ABE3CD2D8B08.png`
  - AX5 RTL: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v2/final-v9/711125EC-E2D9-46C7-8CBB-CD543DAE4486.png`
  - Internal testing in Workspace settings: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v2/final-v9/BBCE483E-80AB-41AF-8A51-6D6A99C905A6.png`

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- Typography: the implementation uses the native system family, 16-point Medium weight for the selected label, regular weight for inactive symbols, and one-line scaling for localized or enlarged text. The hierarchy is quieter than the reference while preserving the requested icon-plus-label selected state; no clipping or awkward wrapping appears in default, Chinese, dark, AX5, or RTL evidence.
- Spacing and layout: the logo and four destination controls keep fixed accessibility frames and fixed center positions while the selected visual capsule overflows its slot. The middle capsule is 112 points and edge capsules are 96 points at the tested width. The selected visual grows without reflowing the navigation skeleton or page content.
- Colors and tokens: one existing muted warm surface token supplies the selected fill, inactive controls share one muted foreground treatment, and the selected foreground gains contrast. The result retains Talent Signal's quiet warm surface rather than copying the reference app's cooler component styling.
- Image quality and assets: SF Symbols remain sharp at native resolution. The reference avatar is intentionally replaced by the existing Talent Signal brand mark because identity and app-specific imagery are outside the target behavior; no placeholder, raster substitute, or custom-drawn icon was introduced.
- Copy and content: `Sessions`, `People`, and `Meetings` preserve the product's established taxonomy while matching the reference's active-label behavior. Internal testing is absent from primary navigation and appears only in Workspace settings when the build or workspace enables it.
- Interaction and accessibility: selected state changes only after the destination changes; swipe progress changes bounded symbol emphasis without resizing controls. Tests cover exact frame stability, 44-point targets, cancelled and rapid paging, RTL, AX5 text, reduced motion, Chinese dark mode, and the internal-settings route.

## Comparison history

1. Iteration 1 found a P2 stability defect: the active item participated in the horizontal layout and moved neighboring controls by as much as 37.9 points. The fix gave every destination a fixed slot and drew the active capsule as an overflowing visual layer. Post-fix UI assertions hold every control's `midX`, width, vertical position, and height within 0.5 points across selection changes.
2. Iteration 2 found a P2 edge-spacing defect: the 112-point Meetings capsule crowded the trailing edge. The fix uses 96-point capsules for Today and Meetings while preserving 112 points for Sessions and People. The final Meetings screenshot shows the label and icon fully visible without moving the other controls.
3. Final comparison found no actionable P0, P1, or P2 issue. The focused comparison confirms the intended stable shell, one enlarged selected capsule, consistent icon family, and lower-noise brand treatment.

## Implementation checklist

- [x] Keep destination frames and centers fixed across all selected states.
- [x] Show the selected icon and text in one 44-point muted capsule.
- [x] Keep inactive symbols at 24 points with uniform weight and color.
- [x] Remove the flask from primary navigation and expose internal testing from Workspace settings only when enabled.
- [x] Verify default, dark, Chinese, reduced-motion, AX5, LTR, RTL, cancelled-swipe, and rapid-navigation states.

final result: passed

---

# Design QA — adjacent-borrowing iOS navigation correction

## Outcome and visual truth

- Source screenshot: `/Users/cubxxw/Downloads/IMG_6984.PNG`
- Source interaction recording: `/Users/cubxxw/Downloads/ScreenRecording_09-07-2026 21-57-59_1.MP4`
- Final focused comparison: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v3/final-v4/focused-navigation-comparison.png`
- Final motion recording: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v3/final-v4/navigation-breathing.mp4`
- Final screenshots and export manifest: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v3/final-v4/validation-screens/`
- Viewport: iPhone 17 Pro simulator, 402 × 874 points at 3×, light appearance for the primary comparison.

The earlier fixed-slot overflow direction was functionally stable, but the user
rejected it because selection still felt component-heavy and the visual change
was too large. The corrected direction treats Today, Sessions, People, and
Meetings as four equal base units. Selection expands one destination by taking
width from one adjacent donor; the pair retains its total width and distant
destinations stay in place.

At the tested width the base unit is about 73.5 points, the selected control is
104 points, and the adjacent donor remains 44 points. The selected visual is a
40-point muted capsule inside the control. Selected symbols are 24 points,
inactive symbols are 22 points, and the selected title is 16-point Medium. All
four controls retain at least a 44-point target.

## Motion inspection

Selection uses a 0.28-second ease-in-out transition. One capsule moves between
destinations while only the selected/donor pair redistributes width. The
outgoing title clears at transition start; the destination title begins a
0.12-second fade after 0.22 seconds, when the capsule is settling. Frame review
of Today → Sessions and Sessions → People confirmed that the capsule stays
fully rounded, no title appears outside it, no old and new titles overlap, and
the distant destination remains stable. The temporary recording-only test was
removed before final verification.

Internal testing is absent from the primary header and remains reachable from
Workspace Settings when enabled.

## Verification

- Five focused UI tests passed in
  `/tmp/talent-signal-stable-navigation-v27/navigation.xcresult`: four-page
  navigation and state preservation, AX5 LTR, AX5 RTL, reduced motion with
  Chinese dark appearance, and the Workspace Settings internal-testing route.
- Release simulator build passed with derived data at
  `/tmp/talent-signal-stable-navigation-release-v3`.
- `pnpm docs:check` passed, including canonical documentation, generated wiki,
  localization boundaries, and architecture diagrams.
- `git diff --check` passed.

## Mobile UX rubric

- Navigation clarity: 3 — one expanded destination carries icon and title.
- Spatial stability: 3 — only the selected/donor pair changes width.
- Motion quality: 3 — one continuous capsule and sequenced title reveal.
- Accessibility: 3 — 44-point targets, selected traits, AX5, RTL, and Reduce Motion.
- Product fit: 3 — quiet warm surface and no internal-testing destination.
- Vetoes: none.

final result: passed


---

# Design QA — reciprocal local navigation morph

## Outcome and visual truth

- Source interaction recording: `/Users/cubxxw/Downloads/ScreenRecording_09-07-2026 21-57-59_1.MP4`
- Same-state motion comparison: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v4/notion-motion-comparison.png`
- Final executable recording: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v4/final/notion-local-morph.mp4`
- Final screenshots and manifest: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v4/final/validation/`
- Decision contract and comparative result: `/Users/cubxxw/.codex/visualizations/2026/09/07/01a07bb9-5bd0-7c52-b82d-5bcaa46c2969/stable-navigation-v4/motion-study.md`
- Viewport: iPhone 17 Pro simulator, 402 × 874 points at 3×.

The prior implementation preserved adjacent-borrowing geometry but moved one
shared capsule between destinations and hid both names through most of the
transition. The user rejected that motion because it lacked the reciprocal,
contained breathing visible in the Notion reference.

The final implementation gives every destination its own faint rounded
surface. On selection, the outgoing capsule contracts where it is while the
destination capsule expands where it is. Both labels stay mounted, so the old
name is progressively clipped and the new name is progressively revealed by
the animated capsule boundary. The selected icon gains fill and contrast
without changing its 24-point layout frame. A selected 104-point control still
borrows only from its adjacent donor; all controls retain at least 44-point
targets.

## Motion inspection

The width and layout changes share a 0.22-response interactive spring with 0.82
damping and 0.08 blending. The selected/donor pair therefore preserves motion
when the user retargets before settlement. Pressing scales only that control to
0.965 with a shorter spring and a selection haptic. Reduce Motion applies the
new geometry directly.

Frame comparison of Today → Sessions shows the same interaction structure as
the source: early destination emphasis, local reciprocal width change, two
briefly coexisting names, rounded clipping, and a settled destination in about
a quarter second. Sessions → People and the rapid four-destination pass settle
without detached text, residual glyphs, rectangular clipping, or a shifted
far-edge destination. The temporary recording-only test was removed before
the final suite.

## Verification

- Five focused UI tests passed in
  `/tmp/talent-signal-notion-motion-final-ui.xcresult`: four-page navigation and
  retained state, AX5 LTR, AX5 RTL, Chinese dark Reduce Motion, and internal
  testing in Workspace Settings.
- Same-reference comparison was inspected at six 0.05-second intervals.
- The final executable recording includes ordinary adjacent transitions and a
  rapid interrupted sequence.
- Release simulator build passed with derived data at
  `/tmp/talent-signal-notion-motion-release`.
- `pnpm docs:check` passed across 11 canonical documents, 495 Markdown files,
  three published wiki pages, and all architecture diagrams.
- `git diff --check` passed.

## Mobile UX review

- Evidence level: 1 — executable Simulator build with direct interaction,
  geometry assertions, accessibility traits, and captured transitions.
- Platform interaction: 3 — local press acknowledgement, interruptible spring,
  page swipe/tap continuity, and stable final selection.
- Accessibility: 3 — 44-point targets, full labels and selected traits, AX5,
  RTL, Chinese, dark appearance, and Reduce Motion are verified.
- Visual craft: 3 — one focus, continuous rounded boundaries, no stale text,
  and low-noise inactive states across the tested variants.
- Performance feel: 3 — immediate press response and continuous captured
  frames; no visible header jump in ordinary or interrupted transitions.
- Vetoes: none.
- Remaining limit: Simulator evidence cannot judge the physical strength of
  the UIKit selection haptic.

final result: passed
