# Session-native result cards with assistant-ui

Status: Approved baseline; 2026-09-29 expansion covers three Web/macOS cards

Date: 2026-09-28

Scope: First delivery slice for Talent Signal's Web conversation and the macOS Web workspace

## Outcome

A user reads an Agent reply and handles its useful result in the same Session. A card shows one concrete change, the short source passage that supports it, and specific actions immediately below it. The user can save, edit, or pass without opening a review page or a second card. After an action, that card shows the actual result. The conversation remains calm when a tool only read data or found nothing actionable.

The first delivery phase includes three Web Session card types: a new contact, an atomic Memory item, and a calendar draft. macOS gets the same behavior through its existing Web workspace. Each card has edit, pass, action, unknown-result recovery, and an effect-specific receipt. Native iOS and external MCP Apps remain separate platform slices using the same governed semantics; this phase does not claim they are converted.

User-facing copy is short and concrete. Do not label a card "AI suggestion", "tool result", "review required", or show internal IDs, scores, and diagnostic stages. The visible verbs name the effect: "Remember", "Edit", "Not now", "Add to calendar", or their localized equivalents.

## Current evidence and constraints

- Web already renders MemoryReviewCard inside the assistant turn in queued-conversation.tsx. It preserves proposal ID and revision in Session history and reads the current protected review on open. Its controller handles lost responses, undo, source loss, and account binding.
- The [GET-40 desktop card](../../evaluations/get40/runtime/desktop-final-card.png) shows 17 selected Memory items under one large commit action. That makes the decision hard to scan and invites blanket acceptance.
- The [iOS contact unknown-result card](../../evaluations/2026-09-07-get-5/screenshots/24-authenticated-unknown-save-v2.png) keeps the operation recoverable, but long technical copy and raw fields push the useful action down the screen.
- The project's [candidate momentum research](../../research/candidate-momentum-loop.md) calls for one atomic state change, a visible exact excerpt, and direct Confirm/Edit/Dismiss actions. Evidence and a human decision must remain distinct from a verified write.
- The existing Memory commit endpoint accepts a selected set and, for most contact decisions, marks visible unselected siblings skipped. It cannot be used as a one-click decision on one item while silently preserving its siblings. The new interaction needs an explicit item-decision contract.
- The existing account and Session synchronization work has separate active ownership. This slice leaves login, token issuance, Session persistence, and synchronization behavior unchanged. The later target of local-by-default Conversation and optional account-wide sharing is a separate design and implementation task.

## Chosen approach

Keep Talent Signal's domain objects and conversation controller as the owners of truth. Add assistant-ui as the Web transcript and message composition layer through ExternalStoreRuntime. Convert the app's existing committed turns and in-flight messages into assistant-ui message parts. A completed domain result becomes a named Data UI part carrying a narrow reference; assistant-ui mounts a Talent Signal component for that reference. Existing server APIs still decide whether the user may see or act on it.

Use assistant-ui primitives with the existing quiet visual system. Retain the current composer, queue, attachment handling, draft recovery, and admission identity during the first slice. Give either the existing conversation surface or the assistant-ui viewport sole ownership of scrolling in the mounted subtree; two independent scroll controllers must not compete.

Tool calls and business cards are different records. The model can request a tool, but it cannot select a confirmation UI or create a button with authority. The domain backend validates the tool output, persists a Proposal or Artifact where appropriate, and emits a card reference only after that result is stable. Routine tool stages remain short progress text; the first slice need not stream every internal tool call into assistant-ui.

### Card reference and readback

The message part contains only schema version, card kind, message ID, governed object ID, optional item ID, observed revision, and safe fallback text. It does not contain a review credential, raw screenshot, full conversation, contact handle, or authority-bearing action token. The renderer reads a current account- and purpose-bound projection before showing actionable controls.

The projection returns concise display content, exact source excerpt and source locator when authorized, current state, current revision, and available action hints. Action hints affect presentation only. Every action request independently verifies the live account session, scope, source, item and proposal revisions, idempotency key, and decision-specific permission. A stale client button cannot authorize a write.

An older client or unsupported Data UI part displays the safe fallback sentence and the current non-authoritative status. It does not offer a substitute confirmation button.

## Card grammar

One card represents one decision or one verifiable result. It has four visual zones:

1. A quiet type and state line, for example "Memory · Not saved".
2. One human-readable change or result. For an update, show old value to new value.
3. One or two lines of exact supporting source text, visibly attributed. A source control opens the original fragment or screenshot region without leaving the Session.
4. Two or three effect-specific actions immediately below the content. The primary action is reachable without opening another surface. Secondary actions are Edit and Pass; the exact labels follow the object and effect.

The card uses warm neutral surfaces, type hierarchy, and restrained vermilion for unresolved attention. Avoid a large black full-width button when the card is a short decision. No avatar, icon, border, or badge may imply a person's value or confidence. Do not repeat the assistant's prose inside the card.

### Memory example

> Memory · Not saved
>
> Send Chen Yu three examples by Tuesday
>
> "I promised to send Chen Yu three examples before next Tuesday."
>
> [Remember] [Edit] [Not now]

The exact locale, calendar date, time zone, and speaker must be resolved before a temporal commitment is offered as a durable fact. Otherwise the card says what is unknown and offers a clarification or pass action. A source statement is not silently rewritten as a mutual promise.

Remember commits this displayed item directly. Edit replaces the sentence with an inline editor in the same card, then shows Save and Cancel there. Not now dismisses only this item. No action first requires an "Open review" or "Expand review" click. The source may expand for inspection, but inspection is not a mandatory navigation step.

Show at most three decision cards initially for one assistant turn. If more pending items exist, show a small "More suggestions" control inside that Session; no item, visible or hidden, is selected or committed by default. The additional items use the same immediate-action card grammar. The new-contact card shows the identity clue, relationship purpose, exact source and the fields that will be created. Its direct Add/Edit/Pass decision creates only the contact; every Memory sibling remains pending for a separate decision. Ambiguous identity produces an in-Session comparison with no preselection. Contact creation never confirms a Memory item by implication.

### Contact and calendar examples

A contact card names the proposed person and relationship context, shows the exact excerpt, then offers Add contact, Edit and Not now. An existing possible match is shown without a preselected identity. Contact-only approval and its canonical receipt preserve every untouched Memory proposal item.

A calendar card names title, local date/time, IANA zone and destination. In this phase the destination is a calendar file for the user to confirm in their calendar app. The primary verb is Download calendar draft; Edit and Not now stay in the card. A fresh source- and revision-checked server read precedes export. The receipt says the file was generated or downloaded, never that an event was added. Reopening, editing, source loss, and repeated export retain their truthful states; an import in another app is not observable or undoable here.

### State transitions

- Proposed: content, exact source, and legal actions visible.
- Editing: one inline field, original value still inspectable, Save and Cancel visible.
- Saving: actions disabled for that exact operation; draft and context remain in place.
- Saved: the same card becomes a verified receipt with the final value, decision time, destination, and Undo if currently allowed.
- Passed: the same card says "Not saved"; the source message remains.
- Unknown result: the same card says the result needs checking and offers "Check result". It retains the original operation ID and never starts a fresh commit.
- Stale, expired, deleted, or source unavailable: old actions disappear; the card names the changed condition and a safe next step.
- Undoing and undone: show the real compensation result, including a retained contact or partial reversal.

Status is conveyed in text and control state, not color alone. A card may update in place after canonical readback; it must never display a success receipt from an optimistic click.

## Tool output to user surface

The following mapping covers the current Agent catalog and adjacent conversation tools. A tool name is diagnostic metadata, not the renderer key.

| Current tool or operation | Validated result | User surface |
| --- | --- | --- |
| read_pursuit, read_evidence, memory_review recall, contact_workspace read | Scoped snapshot, fragment, Memory page, or unique relationship header | Answer with exact citation; no decorative card |
| read_response_preference | Reply-format preference | No visible tool card |
| search_web, fetch_web | Untrusted public lead or fetched source | Brief progress while running; cited research answer or draft, never a confirmed fact card |
| search_douyin_profiles, search_tiktok_profiles, search_weibo_profiles, search_threads_profiles | Possible or ambiguous public match | Possible-match row with source; identity comparison only when a human choice is required |
| contact_workspace search | Limited account-scoped candidates | Inline comparison on ambiguity, with no preselected person; otherwise quiet handoff |
| contact_workspace propose_create or propose_update | Review-only contact candidate and fingerprint | One in-Session contact decision with proposed fields, exact excerpts, Add/Edit/Pass; contact-only commit preserves Memory siblings |
| memory_review propose | Proposal reference and item revisions | Atomic in-Session Memory decision cards |
| stage_pursuit_proposal | Review-only Pursuit proposal | One dependency or action decision card; no implied fact confirmation |
| stage_calendar_draft | Calendar draft reference | Time, zone, calendar-file destination and direct Download/Edit/Pass controls; importing remains the calendar app’s decision |
| create_research_artifact, create_person_research_artifact | Discardable cited draft | Draft artifact summary and source coverage; no confirmation or publication claim |
| Screenshot understanding and source-review tools | Bounded interpretation and source receipts | Short progress and answer citations; show a card only when a governed decision results |
| Domain commit, dismiss, reconcile, and undo | Verified receipt or unresolved operation | In-place state of the original card |

The public MCP tools talent_signal_workspace and talent_signal_people remain read-only and outside this delivery phase. A later MCP Apps slice can render a small people directory from the existing restricted projection, with a text fallback. It requires separate OAuth and UI-resource work; assistant-ui and the external host do not share login credentials or decision authority.

## Per-item Memory decision contract

Preserve the existing batch commit behavior for existing clients. Add a separate protected item-decision operation for the new Memory card and a contact-only decision that leaves Memory siblings pending. Its input identifies the frozen review scope, proposal item, expected proposal and item revisions, idempotency key, decision (accept, edited accept, or skip), and edited text only when needed. The server rechecks the current source and authorization in the same transaction as the decision.

Accept commits exactly the displayed item. Skip marks exactly that item skipped. All other pending items remain pending and visible in their existing cards. A successful decision returns an item-scoped receipt, the new proposal revision, and the remaining-item count. The client refreshes sibling cards against the new revision rather than replaying stale actions. If the proposal has an unresolved contact dependency, the operation returns a typed requirement for identity resolution; it never creates or binds a person by inference.

An unknown response is reconciled against the original idempotency key before another action is available. Undo acts against the exact recorded commit and reports what was actually reversed. A newer dependent change may prevent undo and must be explained.

The backend API name and persistence shape belong to the implementation plan; the observable semantics above are the contract. Meaningful tests must prove that deciding one item does not skip, duplicate, or overwrite its siblings.

## Platform and account boundaries

- Web: assistant-ui renders the transcript and named Data UI card parts; Talent Signal owns the card's content, action controller, and visual style.
- macOS: the main WKWebView uses the same Web result. Verify the card in the actual desktop window, including keyboard focus and a Settings/account switch.
- iOS: a later native SwiftUI renderer uses the same card semantics and governed readback. It presents direct buttons in the Session, with 44-point targets and one column at accessibility sizes. Matching pixels or embedding a Web card is not required.
- External MCP Apps: a later, separately reviewed HTML resource may use the same safe business projection in a sandboxed host. The external host's UI and OAuth permissions are separate from internal Session authority.
- Login: a change of authenticated account or workspace remounts the assistant-ui runtime and drops pending card projections from the former binding. No card payload stores a provider credential or a browser session token.

This slice does not change current Conversation synchronization. The requested future target is local display by default, with an account-level opt-in that covers only Conversations created after enablement; its storage migration and Lab/Settings controls need their own spec. Confirmed domain objects continue to follow their existing synchronization rules.

## Alternatives considered

1. Full assistant-ui runtime replacement: would simultaneously replace queue admission, drafts, attachments, stream recovery, and message history. It adds regression risk without proving the card experience first.
2. One card per tool call: makes the model's tool selection control the interface and creates cards for routine reads. The same business outcome could appear differently across tools.
3. Free-form generated UI or a generic A2UI layout for decisions: increases visual flexibility but makes exact permission and evidence states harder to audit. Static business components with dynamic, validated content fit this consequence level.

The selected approach uses assistant-ui for the Web message surface and Talent Signal components for governed decisions. It extracts shared card semantics only as the second card type needs them, avoiding a premature general UI language.

## Delivery and proof

The implementation plan should have independently verifiable milestones:

1. Render existing Session text, images, progress, and governed card references through an ExternalStoreRuntime adapter without changing send, queue, persistence, or login behavior.
2. Add protected per-item Memory and contact-only decisions that preserve untouched siblings and existing batch clients.
3. Replace the large in-chat Memory form with atomic direct-action cards and real in-place receipts.
4. Render new-contact and calendar-draft cards in the same Session, with direct actions and truthful calendar-file handoff.
5. Verify Web and macOS surfaces, accessibility, source loss and regression boundaries; record what is still pending for iOS and external MCP Apps.

Acceptance requires:

- A user sees a proposed item, its exact source, and legal action buttons in the same assistant turn without an intermediate review click.
- One Remember or Not now click decides only that item; contact-only creation also leaves untouched siblings pending and unselected.
- Edit stays inline and preserves the original proposal for audit.
- A confirmed write appears only after authoritative readback; an unknown result reconciles the original operation.
- Source revocation, stale revision, account switch, expiry, undo conflict, and retry have truthful, recoverable states.
- Long names and excerpts, narrow Web, keyboard focus, screen reader labels, reduced motion, and macOS WKWebView are checked on the real surface.
- A calendar-file receipt never claims an event was imported or saved in another app.
- Existing queue, draft, attachment, cancellation, and batch Memory flows still work.
- No test substitutes a helper fixture for the production entry, dispatch, transition, and readback chain.

Documentation edits pass pnpm docs:check. Product behavior is not considered complete from a schema, build, isolated component test, or screenshot alone.

## Sources

- [Talent Signal product semantics](../../product.md)
- [Talent Signal design system](../../design-system.md)
- [Agent system and authority boundary](../../agent-system.md)
- [MCP extension operations](../../operations/mcp-extensions.md)
- [assistant-ui ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store)
- [assistant-ui Data UI and Tool UI](https://www.assistant-ui.com/docs/tools/tool-ui)
- [MCP Apps overview](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html)
- [Current conversation Figma reference](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=210-1473)
