# Product

## Audience and job

Talent Signal is an evidence-first relationship CRM for context, trust, and
shared outcomes across client work, partnerships, consulting, collaboration, and recruiting.
Recruiting is one context, not the default identity of the product or its user.

A person represented in the CRM does not need a Talent Signal account or a
reciprocal platform relationship for an authorized user to preserve governed
context. Their absence from the account model does not remove their privacy
rights or turn their conversations into unrestricted customer property.

For each active relationship or Pursuit, and especially after a meaningful
conversation, the product helps the user answer:

> What outcome are we pursuing, what changed, what is blocking it now, and
> what is the smallest safe action that keeps the relationship moving?

## Promise
Never lose the context, commitment, or right moment that keeps a relationship
moving.

The product reduces reconstruction and missed timing. It does not replace the
user's relationship judgment.

## Product loop
![Talent Signal product architecture](talent-signal-product-architecture.png)

The loop is:

1. capture one meaningful source from the user's current surface;
2. separate explicit evidence from ambiguity and interpretation;
3. let the user correct and confirm what changed;
4. propose one smallest useful next step;
5. require a separate decision before consequential action;
6. observe the result and carry confirmed context forward.

The editable diagram is
[`talent-signal-product-architecture.excalidraw`](talent-signal-product-architecture.excalidraw).

## Canonical experience

The Agent is one recognizable assistant that interprets authorized signals,
maintains governed self, person, and relationship Memory, prepares proposals,
and explains its work. Separate from Today, its first level contains only
Memory, About you, Sources & imports, and Action permissions. Today is
attention; Agent is the control plane for identity, context, source state, and authority—not unsupported autonomy; its Sources page distinguishes profile references, file snapshots, scoped account reads, and independently approved projections rather than collapsing them into one “connected” badge.

The product is organized around a `Pursuit`: a concrete outcome with a time
horizon that requires people, organizations, evidence, criteria, and action.
A Pursuit may be a client engagement, partnership, shared project, or recruiting mandate.
Domain-specific criteria stay scoped to that outcome; a person need not be a candidate.

People remain stable identities across the product, while roles, criteria,
claims, gaps, and actions are scoped to a Pursuit. A person may be a candidate
in one search, a client stakeholder in another, and a referrer elsewhere
without becoming several unrelated identities. Cards, lists, timelines,
graphs, Today, Pursuit rooms, and living person pages are views of the same
governed state, not competing records.

Today, Sessions, People, and Meetings are the primary mobile retrieval surfaces. A Session groups user-initiated Agent tasks around a continuing objective;
it may begin without a relationship and bind one only when the Agent resolves
an exact account-scoped Person and context or the user chooses one.
This lets a recent conversation resume without making contact selection a
required field on every message. Its title is a human retrieval label for recognizing that continuing objective weeks later: one concrete, single-line phrase in the user's language, never a generic reply label or a summary of only the latest answer. The first completed answer may refine the local objective-derived label; retries and later turns do not silently rename the Session.
It is a projection, not a second record: Pursuit, evidence, Proposal, reviewed
state, Action, and Receipt continue to own goals, provenance, decisions, and
effects. Evidence remains one step from a consequential claim but does not
become a top-level library that asks the user to browse sources before
understanding the goal. Pursuits remain directly reachable from Today, a
Session, a person, and review context rather than consuming a higher-frequency
mobile retrieval position.

Meetings views existing relationship activities by time. Preparation and recollection open a scoped editable Session draft; existing drafts and pending work take precedence. The handoff never sends or confirms facts, and calendar effects retain explicit review.

Today continues unread Sessions and gives one supported dependency or
reviewable Agent insight a clear visual lead. Remaining attention-bearing
Pursuits stay compact continuations without an arbitrary data cap. Target
outcome and date, current blocker, evidence freshness, owned action, owner, and
due date remain available from the item or its Pursuit rather than being
repeated as dashboard chrome. Today is a flexible retrieval composition, not a
generic feed: it shows only unread conversation work and current governed
attention. A pending Proposal may change the primary decision, but it cannot
hide an owned action or gap from the same Pursuit. Pursuits with no pending
review, owned action, or evidence-backed gap remain an explicit no-action count
rather than invented work.

When Today leads with a review-ready Proposal, its primary transition lands on
and moves focus to the exact human decision gate in the Pursuit room. The
user should not have to rediscover the highlighted decision after opening
its governed object. Action- and gap-led items continue to open the Pursuit
overview because the room, not a Proposal, owns their current context. A
review-ready item does not also expose another Agent-run input: the pending
human decision is already the next step.

Evidence-backed is a live authority statement, not permanent copy. When a
source is deleted or loses authorization, the affected role, gap, Proposal,
and Today item visibly become partial or unavailable. An explicitly
user-authored note remains attributable to that user and says that
evidence is not required; it is never relabeled as source-supported. A Proposal
whose source authority is gone stays available only as superseded history and
cannot be confirmed.

A reviewed milestone remains a versioned historical fact after its source is
deleted, but its current evidence authority becomes unavailable. The readback
keeps the confirmer, decision time, Proposal, and Receipt so history is not
silently rewritten or presented as currently source-supported.

Chat is the primary intent surface for ordinary desktop work, not another
record. It stays beside the selected Pursuit and affected person so the
user can ask, navigate, compile, or stage a change while the governed
object remains visible. On mobile, the same tasks appear in manageable Sessions
because recent intent is retrieved more often than the full contact directory.
Structured review still happens on the affected object, and Chat or Session
returns an operation receipt rather than claiming that a page or external
system changed. An answer may cite only exact, currently available evidence
fragments from its account-, person-, relationship-, and snapshot-bound context.
The source name is visible in the conversation and opens an inspectable evidence
readback; a generic person page or an opaque evidence count is not a citation.
Mobile Sessions and their conversation drafts resume within the same signed-in account across devices. Follow-ups, screenshot results, contact drafts, and saving receipts remain in the originating Session. Prior dialogue provides conversational context without becoming evidence. Restored answers are visibly stale, hide their citations, and require a new Ask before source authority is claimed again. A submitted question remains recoverable until validated recording succeeds, and retry reuses the same task intent instead of creating duplicate work. A Session can be shared only after an explicit preview: the default is a compact static context card, while a readable conversation copy requires a separate scope choice. Both omit sources, pending decisions, action targets, and execution authority; that export classification survives persistence and legacy restored answers without a classification remain unavailable. The readable copy is bounded, and every exported message is fully visible in the scrollable review surface. Identity-review Sessions use generic context and cannot export a full conversation. System sharing sends a copy and never claims that access or permissions changed. A Session may also be forked into a separate conversation; a fork carries readable context without inheriting pending decisions or execution authority. Feedback is reversible message metadata. Web also offers a separate [private conversation](reference/private-conversation.md) with no saved history or Memory.

Conversation and execution remain separate: accepted input gets immediate feedback, one folded record reports actual state and elapsed time, and the standalone final answer follows the latest processed input. Rapid text fragments adjust the current task after its tools finish; original identities remain distinct. Stop preserves completed work and requires explicit continuation. Unsupported input stays whole as named later work. Silence is legal, structured Markdown stays whole, and notifications serve final results or required human decisions.

On mobile, voice is a direct path to an editable Agent-input draft. The global composer accepts a normal tap for text and touch-and-hold for voice; the Session composer shows best-effort on-device provisional words inside the same ribbon.
Releasing stops capture and requests one provider-final transcript, but never submits it: the exact final words remain editable until the user taps `Send`. Sliding up keeps capture hands-free and sliding left cancels.
First use explains the temporary audio processor and deletion boundary, and existing typed text is never replaced by a voice gesture. Voice input does not make a user recollection source evidence or grant downstream confirmation or action authority.
After an admitted Ask starts, a content-free Live Activity may carry only opaque workspace, Session, and activity identifiers plus lifecycle state. It opens the exact protected Session for `Review` or retry and never exposes the question, transcript, person, relationship, answer, or evidence.

When no relationship is selected, the user sends normally. The Agent may
answer from the submitted text, search the authenticated contact index with one
message-grounded clue, ask one clarification over minimal candidate labels, or
resolve exactly one Person and relationship context. Search never returns
messages or evidence. Private relationship evidence is read only after the
Session is bound to that unique scope through the existing governed Ask path.
If the message requests a contact create or update, the Agent may stage one
review card; it cannot apply, merge, message, schedule, publish, or report the
change as complete. The ordinary unscoped response still returns no external
effect.

A natural person note with a name and a stable identity clue may also prepare a contact draft without command wording. Each proposed field retains its exact source excerpt. Missing relationship purpose stays empty and prevents formal saving; ordinary questions, a name alone, third-party quotations, and unresolved multiple people do not justify silently creating a contact. One active draft stays beside its source message. Editing identity reruns lookup, declining preserves the message, and confirmation appends the canonical receipt to the same conversation.

Ask reconciles its answer with canonical work already owned in that exact
Pursuit. When an open action or evidence-backed gap exists, the response shows
its owner, due time, and close condition without creating another action; it
must not also claim `no_action`. The structured block can open that exact
Pursuit and action without recording a change. Relative dates without an
explicit calendar date and timezone stay in source review instead of appearing
as confirmed current state.

An exact citation can enter a scoped source review from the Agent response. A
user can dispute it with a reason; the source is rejected canonically, its
dependent knowledge is invalidated, and the current Agent turn becomes stale.
The conversation keeps a visible review state and offers a same-intent retry if
the outcome is unknown. A mistaken dispute can be corrected only through a new,
reasoned review decision: the prior dispute stays in the audit, the old answer
stays stale, and only a fresh Ask may cite the source again. No message or other
external effect is executed. If protected recovery cannot be saved, no source
review request is sent or presented as saved. Each review names the exact prior
review authority it observed. A same-intent replay succeeds only while its
result is still the fragment's current review; the client verifies both prior
and resulting review IDs before presenting the decision as applied. While the
original request is in flight, recovery is visible but cannot start a competing
reconciliation. A no-action result carries one evidence-state condition for
revisiting the decision without manufacturing urgency.

Mobile capture is the complementary intent surface. Selecting a screenshot in Photos or handing one in through a system shortcut immediately creates a recoverable Agent Session and authorizes purpose-bound processing.
On-device text recognition and bounded tools may run without another tap; extracted text crosses into shared storage only as a proposed, attributable source.
A sole match may be attached automatically only when a current confirmed identity clue resolves to one person and one existing relationship context. The product returns to the foreground when tools fail, identity or relationship context remains materially ambiguous, or an external effect needs approval.
Screenshot intent authorizes that bounded source attachment. Extracted text, speaker attribution, facts, and actions remain proposed until they receive their own authority.
Selected contact files follow the same rule: on-device staging exposes malformed and duplicate rows, each valid row receives an exact protected identity decision and canonical receipt, raw bytes are discarded, and unreviewed notes or mapped context gain no fact or Memory authority.

Relationship Ask also accepts a screenshot as a purpose-bound task attachment.
After Send, an admitted Agent may autonomously choose bounded public-profile
search tools from visible name, handle, URL, or platform clues—without asking
the user to select a relationship, platform, tool, or candidate first.
For a single unscoped PNG/JPEG/WebP, the image is processed for that Run without
being uploaded into relationship media or retained by the backend. Its possible
matches, biographies, and public links appear as an explicitly unconfirmed
draft and the normalized public result can survive in the protected Session
after the raw screenshot is discarded. This path cannot recognize a face,
confirm identity, update relationship state, or perform an external action; a
photo-only image ends in `no_action`.

An unconfirmed public result may offer `Review contact`, but never `Create`
directly. Review shows platform, handle, biography, match basis, and source
link together; lets the user edit a short People-card headline; then
reuses the normal identity lookup and exact create-or-attach decision. A source
avatar remains link-only unless its provider supplies an explicit display
license or the profile owner has consented; public visibility and user
confirmation alone grant neither right. Only the final contact confirmation
may store selected card fields. The resulting public-source headline remains
attributable to the reviewed URL and disappears from People when its governed
source is deleted or loses authorization.

Local typed-signal recovery follows the authenticated workspace. The app does
not display a restored payload until workspace readback agrees, so switching
accounts on a shared device cannot expose another workspace's draft. Retry and
deletion continue to use the original workspace and stable Signal ID.

Typed Signal uses a searchable, untruncated scope list with a stable Person
record clue beside the Pursuit and relationship context. Name alone never
selects a Person; canonical readback must return the same workspace, Person,
role, and context identifiers.

An owned internal action closes only when its owner records an observed outcome.
Before submission, the client persists the draft and a client-owned operation
ID that the backend must use for the canonical operation. An ambiguous response
locks the draft until exact-ID readback reconciles it, including after relaunch;
retry cannot mint a second operation. Completion is revisioned and idempotent,
returns a matching canonical Receipt and readback, and has no external effects.
It never implies that an email, meeting, ATS, CRM, or notification write occurred.

The user gets one contact entry without receiving one flattened context.
Every material item remains scoped to the relationship, assignment, purpose,
and time in which it is valid. Context-specific evidence must not leak merely
because identity is shared.

A contact identifier is not timeless identity. Current confirmed clues help
the user find an existing person; expired clues are labeled historical
and can only suggest whom to review. When a fresh contact card, screenshot, or
shared source contains an expired clue, the product stages an identity review
instead of silently binding or creating another person. Choosing an existing
relationship changes the operation to attaching the fresh governed source.
Only that explicit decision can reconfirm the masked clue for a new interval.
Choosing a different person requires an equally explicit decision and preserves
the prior owner as history.

When one clue has both a current and a historical owner, the Agent resolves it
inline beside the living person page rather than opening a generic search
result or silently choosing the first card. The current owner appears first
because of visible source-linked authority, while the historical owner remains
available for comparison with its relationship controls disabled. No person is
preselected. The user may choose the current relationship, remove the
clue, or preserve the source as an unresolved identity review; creating another
person stays unavailable while the conflict is active. The selected operation
then changes visibly from identity review to source attachment before any
state is committed.

Normal capture uses a plain-language default review date without asking the
user to configure policy. An exceptional custom date requires a visible
reason, appears in durable Agent history, and remains attributable to the
policy version active when it was chosen. Later policy learning can change new
confirmation without silently extending an old clue.

When the user discovers two entries for the same person, the product
repairs identity on the living person page rather than silently deduplicating a
directory. The review names the page that stays stable, shows every
relationship context and governed source that would move, exposes material
label, fact, and masked-identifier differences, and blocks on unresolved
identity or external effects. A current preview, recorded user basis, and
explicit confirmation are required. The result retains old-link continuity,
recompiles affected knowledge, produces an audit receipt, and remains
reversible while no new dependent evidence makes an automatic split unsafe.
The immediate receipt is not the only recovery path: an applied merge remains
reviewable from durable Agent history. Reopening history creates a fresh
reversal review from current canonical ownership and dependency state; history
never acts as authority to replay an old undo. If the relationship gained new
evidence or state after the merge, the product removes the automatic reversal
action and explains what now requires human resolution.

## What the product remembers

- explicit preferences, constraints, commitments, and deadlines;
- how current understanding changed over time;
- unresolved questions and dependencies;
- what action was proposed, approved, attempted, and observed;
- corrections, contradictions, and superseded state.

It distinguishes:

- source evidence;
- user-confirmed state;
- model interpretation;
- action intent;
- observed outcome.

## Attention model

The default unit of attention is not a score. It is a current dependency:

- what is blocking a decision;
- who controls it;
- when it matters;
- what evidence supports it;
- the smallest appropriate next step.

`no_action` is a valid and often valuable result.

## Shared foundation and specific contexts

Start from one meaningful conversation in a client engagement, partnership,
shared project, or recruiting mandate. Carry it through recoverable capture,
Pursuit and identity review, evidence-backed claims, one reviewable next action,
and an observed outcome.

Each context reuses Person identity, contextual relationships, Pursuits,
Memory, provenance, Proposals, Actions, and Receipts. Specialized workflows
must earn their own evidence and interaction; broader positioning does not
claim that every industry workflow or integration is already implemented.

## Non-goals
- a general autonomous user;
- a generic conversation summarizer;
- automatic candidate ranking or rejection;
- a full ATS or an ungoverned configurable field warehouse;
- a stage-first sales pipeline that reduces relationships to deal movement;
- ambient collection of private communication;
- message volume as a success metric;
- a generated wiki that becomes the system of record.

## Product success
Success means a relationship owner can act with less reconstruction and greater
confidence while the people involved experience more relevant, timely, and
human communication. The same standard applies to clients, partners,
collaborators, candidates, and the people maintaining those relationships.

See [Principles](principles.md), [Capture to action](capture-to-action.md), and
[Design system](design-system.md).
