# Design system

> Quiet relational intelligence for evidence-first relationships.
## Design thesis

capri should feel like a well-edited professional notebook with the precision of an evidence instrument.

It is not an ATS dashboard, an AI command center, a sales CRM with candidate labels, or a collection of decorative cards.

The design helps the user move through:

> evidence → change → dependency → next action → outcome

without making the system feel more important than the relationship.
## Ownable causal grammar

Public storytelling makes the visitor's transformation visible: capture a person,
reconcile scattered context, then discover a meaningful relationship or intent path.
Motion communicates continuity and discovery; source inspection sits one deliberate
step from the claim. Removing evidence retracts all dependent interpretations and
paths. Clearly distinguish synthetic future experiences from available integrations.
Functional checks establish reliability, not aesthetic success or user acceptance.

The vermilion redline is that seam. It marks a consequential, reviewable change
between what was said and what may become current understanding. It is not a
decorative progress indicator, generic brand stripe, or confidence signal.

Prefer product behavior as trust evidence. Photography, abstract diagrams, and
polished containers cannot substitute for showing provenance, correction,
separate fact confirmation, separate action approval, and observed outcome.

## Experience principles

### Evidence before interpretation

Show what was observed before what the system thinks it means. Decision-relevant
claims should open their source and history without forcing the user into an
audit interface for ordinary work.

### Change before completeness

Lead with what changed since the user last understood the relationship.
Do not require a complete profile before the next useful decision can be made.

### Dependency before score

Make the current unresolved dependency legible. Never compress a person into a
quality, fit, risk, or probability score.

### One calm next step

Prefer one timely action with a clear reason over a wall of recommendations.
`no_action` should feel intentional, not empty.

### Control at consequence

Keep routine reading light. Increase explicitness as consequence increases:
evidence correction, fact confirmation, action approval, and recovery deserve
progressively stronger attention.

### History without clutter

The current state stays simple; history remains available on demand. On the signed-out home, a brief automatic introduction reveals the person and useful relationship before requiring input. It stops on the result; explicit interaction owns subsequent playback and exploration. Reduced motion shows the complete static discovery. Successful receipts, diagnostics and repeated reassurance stay off the home; failed or unknown operations retain visible recovery until resolved.

Calendar scanning leads with time, person, and activity. Keep secondary
properties and inactive filters behind a named control; reveal an active filter
where it affects the view. Avoid repeating time, normal sync status, and scope
across stacked chrome and cards. Compactness removes repetition and framing,
not readable type or touch targets. Calendar views change time layout; filters
change which records appear. Preserve that distinction, and keep conflicts,
uncertain writes, and recovery visible when metadata is collapsed.

Web and desktop conversations use one readable transcript and a stable reply composer. Text, images, or both form one message: choosing, dropping, or pasting images previews them in the composer, and Send places them in the conversation for the Agent to analyze and answer inline. Attachment processing must not redirect ordinary chat through a source-intake modal or require a separate save-and-organize action. An explicit thumbnail action may open the original for inspection. Message images remain untrusted conversation input; consequential writes still require their own review. Sending releases the input immediately; durable admission, forming output, and completion remain distinct. Before genuine output arrives, show observed processing state with restrained identity motion; never insert a fabricated acknowledgement or first-person reply. Keep detailed progress available on demand. Later messages enter a visible, editable queue; Stop pauses it until explicit continuation. Growing a draft follows the latest reply only when the reader was already there. Keep title, content, and input primary; technical scope and draft utilities belong in named details. Unresolved errors, conflicts, and deletion consequences remain visible. Primary work destinations stay direct; hide successfully empty auxiliary groups, place account utilities with the account, and preserve explicit narrow-screen entries for hidden rail destinations.
Desktop composition is fixed and quiet: a 68px centered lightweight Session title with details in a named disclosure, one 880px reading and composer axis, centered per-send timestamps, trailing user bubbles, and leading Agent semantic blocks. Live runs show a quiet identity/status row with a collapsible execution record of observed milestones and elapsed time — never a percentage of unknown total work — and the final semantic result stands alone after persisted readback, with pending memory or calendar decisions kept distinct from completed execution. Reopened history keeps that order; a preview never becomes the result.

### Space is part of the hierarchy

Breathing room gives each mobile viewport one visual resting point and open space before the next decision. Avoid feed frames, generic search, repeated
boundary prose, or decorative cards; prefer interaction when copy adds no decision.

## Information model

The canonical working object is a Pursuit with a target outcome, time horizon,
and governed resources. People are stable identities whose roles and evidence
remain scoped to each Pursuit.

The primary surfaces answer different questions:

| Surface | Question |
| --- | --- |
| Today | What deserves attention now? |
| Sessions | Which recent Agent conversation should I resume? |
| Pursuits | Which outcome am I trying to advance? |
| People | Who or what am I looking for? |
| Time | What happened in this period, and what should I prepare for the next contact? |
| Pursuit page | What outcome, milestone, gap, and action are current? |
| Candidate page | What is currently true for this person in this Pursuit? |
| Timeline | How did understanding and action change? |
| Evidence review | What supports or contradicts this state? |
| Relationship graph | Which connections matter to this question? |

Internal Lab surfaces use named scenarios and progressive explanation rather than loose flags; Signal Lens preserves the same evidence-before-interpretation grammar described in [ADR 0011](decisions/0011-product-native-internal-lab.md).

On mobile, Today is the default return surface when unread Agent work or an
evidence-supported Pursuit dependency deserves judgment. Sessions preserves
recent conversational intent, and People remains the stable cross-goal
retrieval destination. Pursuit rooms remain directly reachable without
competing for primary navigation. Evidence opens from its claim or record;
Today stays sparse with one lead dependency and a complete no-action state.

The Agent is a contextual threshold; Sessions retrieves conversations without owning truth or execution authority. On mobile, familiar top navigation owns retrieval and one bottom global composer owns intent; never combine them. The bottom control is a launch rail, not the editing surface: text, attachment, and voice entry open one full-screen New Session with an explicit close path. Its text entry is a visibly bounded multiline editor with direct image and formatting controls. The first send changes that same surface into the active Session with native navigation and interactive back; it does not begin in a partial-height sheet or open a second conversation modal. Scope, capture, and record navigation follow intent. Text, an ordered image set, or voice becomes proposed structure before consequential review stays explicit.
Mobile and Web composers treat multi-stage marked text as provisional: input methods own candidate selection, and Send remains unavailable until the text is committed. Draft recovery preserves committed whitespace and line breaks, coalesces persistence for responsive input, and flushes at true lifecycle boundaries. A system permission overlay is not itself a background cancellation; protected capture begins only after authorization and an active foreground, while real backgrounding or audio interruption stops capture with truthful recovery feedback. Diagnostics record only closed lifecycle states, never message, transcript, person, or relationship content.

Within an active Session, the mobile reply composer is one quiet ribbon rather than a persistent formatting panel. On the global rail, tap opens the full-screen text composer while touch-and-hold enters the same protected voice mode as the visible waveform control; both retain accessible explicit actions. Its connection mark represents the missing piece between people and morphs across listening, transcript finalization, waiting, `Review`, failure, and timeout. Voice expands inside the ribbon so provisional live words, elapsed time, cancel, lock, and stop remain one gesture-local surface while the relationship workspace stays visible. Stopping creates an editable provider-final draft; `Send` remains independent and partial words never enter Agent reasoning. Waiting uses restrained motion without status prose; reduced motion preserves the same state through geometry. Failure and timeout use the changed mark plus one short recovery action. An Ask Live Activity begins only after explicit Send and extends the same mark to Dynamic Island and the Lock Screen. The compact waiting state is mark and motion only; a completed response uses `Review`; failure and timeout stay brief. The system surface contains no relationship content and always returns to the exact protected Session, where evidence, recovery, and decisions remain available. The empty Session input area supports touch-and-hold for voice while committed text, IME composition, and explicit controls retain their own gestures. Replies use semantic Markdown with selectable text, bounded code and table scrolling, and a vertical table alternative at accessibility sizes. Small message icons retain full touch targets for copy, regeneration and reversible feedback. The Session menu opens a scoped share preview before the system share sheet: a compact card is the default, a readable conversation copy is secondary, and visible copy names the omitted sources, pending decisions, and action authority. The readable copy is bounded to 12 safe messages and 4,000 characters, renders the complete exported range in the scrollable preview, and visibly states when the limit applies. Identity-review Sessions never expose a person label or full conversation through this flow. The same menu owns fork; screenshot results belong in the chronological conversation with source details on demand.

## Agent-operated relationship workspace

On desktop, the default working composition pairs a persistent, Pursuit-scoped
Agent surface with the Pursuit room and selected living person page. The Agent
owns intent and coordination; the governed pages own structured understanding
and review. Neither may obscure the other at the moment of a material decision.

Agent operations follow a visible consequence ladder:

- navigation and scoped reading may happen directly;
- compilation produces cited, snapshot-bound artifacts;
- internal relationship changes are staged on the affected object and remain
  reviewable and reversible;
- device or external writes require a separate exact-effect approval and
  verified result.

The interface should show the affected object and a compact operation receipt,
not hidden DOM automation or theatrical chains of thought. On small screens,
the Agent may expand into a focused temporary surface after explicit intent,
while stable navigation preserves direct access to Today, People, Library,
sources, and review state.

The rationale and rejected workspace structures are recorded in
[ADR 0005](decisions/0005-agent-operated-relationship-workspace.md).

### Inline identity comparison

Identity resolution is an Agent operation on the living relationship, not a
separate contact-management destination. When one clue yields several temporal
owners, use one compact comparison inside the Agent rail:

- order current source-linked authority before historical evidence;
- label the reason as `Current clue` or `Historical clue`, never as a person
  score or confidence ranking;
- do not preselect a person;
- keep historical evidence visible, but disable relationship and source
  attachment while another person is current;
- offer `Save for identity review` as a normal outcome when the user
  cannot decide;
- keep `Create new person` unavailable while a current owner conflict exists;
- after explicit selection, change the staged operation and consequence copy
  before enabling submission.

On narrow screens, both temporal roles and their consequences should remain
visible without horizontal scrolling. State must use text and iconography in
addition to color. Wider comparison belongs in progressive disclosure only
when the compact decision lacks enough governed distinguishing evidence.

## Attention hierarchy

Prioritize identity and current context, then meaningful change or dependency,
exact supporting evidence, and the smallest next action. History, alternatives,
and deeper analysis follow.

AI provenance stays secondary. Attachments and sending show selected images and meaningful progress; omit routine footnotes and success notices. Disclose sources
on demand and highlight actionable errors or identity questions.

## Visual character

Use:

- quiet warm neutrals;
- one restrained vermilion accent for consequential attention;
- soft semantic distinction for evidence, confirmation, uncertainty, and
  verified outcome;
- strong typography and spacing before borders or elevation;
- surfaces that feel composed rather than tiled;
- motion only when it explains a state transition.

Exact tokens, breakpoints, and component behavior belong in implementation;
the surrounding product is the reference for density and idiom.

Mobile reading preferences keep `Text size` and `Card density` independent. Text shifts only standard Dynamic Type categories and never reduces an accessibility category.
Density changes card spacing, shape, and avatars without shrinking controls below 44 points; Settings previews the result and compact is the retrieval default.
People and Sessions share quiet search and filter controls, with the active filter named and directly clearable. Rows prioritize title, identity, context, and recency; identity keeps the same scan position across attention states. People use a quiet directory rhythm. Unread Sessions alone receive restrained elevation, stronger type, and quiet visible and accessible read-state labels; operational attention remains a separate label. At accessibility sizes, identity and context use the full row width. Utility chrome must leave room for that content, with complete navigation names, practical symbols, and large-content alternatives for bounded controls where they do not replace an existing hold gesture. Session titles use at most 32 user-perceived characters, stay on one line, and name the concrete topic or task in the user's language. Prefer a recognizable verb-object phrase. Never use placeholders such as `Reply`, `Answer`, `Hello`, `回复`, `回答`, `你好`, or `工作台对话`; a person returning weeks later should know which conversation to open without reading its latest message.

On working surfaces, headings name the current object, date, state, or
decision within a bounded operational scale. Page and object titles never
behave like marketing heroes, and metadata remains legible rather than tiny.
Reserve narrative promises and oversized type for public proof or onboarding;
there too, evidence and interaction must carry the depth instead of empty space.

Avoid:

- generic gradients and glowing AI decoration;
- excessive glass, shadows, and floating panels;
- large KPI dashboards for a relationship workflow;
- unexplained color as the only state signal;
- animated confidence or candidate ranking;
- hiding critical evidence behind novelty interactions.

## State language

The design must distinguish:

- proposed;
- ambiguous;
- edited;
- confirmed;
- dismissed;
- approved;
- executing;
- verified;
- failed;
- unknown;
- expired;
- contested;
- superseded.

Use plain language that describes what the user can do next. Never make a failed or uncertain state look complete. A forming streamed reply is not a citation, card, or completed answer; only validated blocks replace it, and a stopped run stays visibly incomplete.

## Pursuit and candidate pages

The Pursuit page explains one target outcome. It leads with outcome, deadline, milestone, supported blockers, and the smallest next step before the broader resource map.

The living candidate page is a current, Pursuit-scoped explanation of the relationship. It should combine:

- the current dependency;
- confirmed decision drivers;
- open questions and contradictions;
- recent meaningful changes;
- action and outcome history;
- one next step when appropriate.

It is a governed projection, not a permanent generated essay. Every important claim should reach exact evidence and earlier state.

## Timeline

The timeline is the trust surface: what was observed, what changed, who decided, what action occurred, and what result was seen.

Group low-value system mechanics so human decisions and relationship changes remain legible.

## Relationship graph

Use the graph only when connections answer a real question, such as influence,
introduction path, prior collaboration, or assignment context.

The graph should reveal provenance and scope. It should not imply social value
or turn weak associations into authoritative relationships.

## Surface adaptation

### Mobile

Optimize for capture, one-thumb review, Today, interruption, and device-owned action.

Today, Sessions, People, and Meetings form one horizontal pager. The header begins with four equal navigation units. The selected destination expands into one quiet capsule with its symbol and name by borrowing width from one adjacent unit; that pair keeps its combined width, so distant destinations do not move. Unselected symbols retain faint local capsule boundaries, at least 44-point targets, and never disappear. During selection, the old capsule contracts in place while the destination capsule expands in place with one interruptible spring. Both names remain mounted: the shrinking rounded boundary truncates the old name while the widening boundary reveals the new one. The destination gains symbol emphasis early, press feedback remains local, and rapid retargeting preserves spring velocity without leaving stale text. Page content does not reflow with the header. Reduced motion applies the selected state directly; full accessibility names, selected traits, and large-content labels remain available. Internal testing belongs in workspace settings when the build or workspace enables it, never as another primary-navigation destination. Page search, filters, scroll and calendar disclosure persist.
Rows reserve horizontal movement for paging: tap opens, while visible menus, context menus and accessibility actions expose the same commands. See the [iOS gesture research](research/ios-relationship-library-design-benchmark.md#sixth-iteration-pages-own-the-horizontal-axis).
Calendar leads with the selected time horizon and relationship agenda. Menus expose edit, open, preparation and Person; editing fixes relationship scope and reviews changed fields plus external effect. A linked EventKit event updates by saved identifier only; missing never creates a replacement.
Today uses one page identity and leads with its date, the next meeting's day and time, and reviewable decisions. Avoid duplicate titles, generic attention slogans and decorative urgency; keep preview and external-effect disclosures where they affect judgment.

Treat screenshot intake as one progressive decision, not a miniature contact form or a success toast:

1. show the device-owned source and editable recognized text;
2. mark unsupported speaker attribution explicitly;
3. collect a minimal identity clue and relationship purpose;
4. compare current and historical owners without preselection;
5. enable only a temporally valid binding or an unresolved outcome;
6. finish with the actual Wiki quality, affected identifiers, and a direct
   return to the person.

At accessibility text sizes, preserve this order in a vertical scroll rather
than compressing evidence, identity, and consequence into columns. The primary
action belongs after the information it commits.

### Desktop

Desktop starts with the conversation canvas; Today stays directly reachable. Optimize for comparison, provenance, conflict resolution, research, and longitudinal editing.
Source intake gives material and its next action the main canvas; an empty history does not reserve a second navigation column. Populated records earn an inbox and detail composition.
Optional intent stays secondary; permission, uncertain saves, and recovery remain visible where they affect a decision.
Verify rendered structure and interaction in both empty and populated full viewports; a CSS reskin alone is not fidelity. Settings uses stable named sections, a readable edit pane and explicit Edit, Save and Cancel actions. Failures retain drafts. Optional explanations and diagnostics sit behind named disclosures; unresolved failures remain visible. Web settings stays inside the workspace; macOS uses one independent settings window that preserves the main conversation and keeps device controls available offline. That window has one navigation owner and holds device controls only; account, appearance and account-connection management open in the default browser, which keeps the client independent of the Web release. A Web surface never redirects into the native window, the embedded workbench never paints the Web settings routes while the browser opens, and an ordinary route change or a refused history call stays visible instead of blanking the workbench. Version status distinguishes installed apps, running services and published releases, with source and check time; independently released components never become "current" merely because their numbers match or a health request succeeded.

### Channel

Optimize for concise capture, status, and handoff. Do not compress high-risk
review into a chat reply.

## Accessibility and privacy

- Avatars aid recognition without verifying identity: authorized photo, readable name initials, then a stable abstract fallback. Account-scoped local choices support preview, cancel, save and reset. Explain the local-only persistence scope on demand and preserve source provenance, readable contrast and reduced motion.
- Preserve meaning without relying on color alone.
- Keep text and controls legible at platform accessibility sizes.
- Make focus, keyboard, screen-reader, and reduced-motion behavior first-class.
- Avoid private conversation content in generic notifications or previews.
- Let the user understand retention, source access, and deletion consequences.

## Review questions

- Can the user identify what changed within a few seconds?
- Can they inspect why the system believes it?
- Is fact review distinct from action approval?
- Is one current dependency more prominent than broad analysis?
- Can the user correct, decline, recover, and delete?
- Does the design preserve human dignity and avoid person-scoring?
- Does the surface feel specific to trusted relationship work?

Functional audits gate release but do not establish design quality or
preference. For a consequential visual change, compare at least two rendered
directions against product truth, logo-off ownability, five-second clarity, and
accessibility risk before micro-detail. Review the uncropped viewport across themes, text sizes, and crossed attention states. Independent craft scores use frozen criteria and preserved deductions; they are subjective evidence and never replace functional proof or user judgment.

See the [brand system](../brand/README.md) for approved marks and usage, and the
[Design reference catalog](research/design-reference-catalog.md) and
[iOS relationship library benchmark](research/ios-relationship-library-design-benchmark.md) for borrowing boundaries.
