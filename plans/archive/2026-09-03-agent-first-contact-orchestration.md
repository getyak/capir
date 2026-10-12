> **Status: archived historical proposal (2026-09-03).** This brief was the
> slice definition for the delivered agent-first contact orchestration work and
> is kept as delivery evidence only; it is not current product authority. The
> owning plan is
> [`2026-08-28-conversation-first-contact-intake.md`](../2026-08-28-conversation-first-contact-intake.md)
> and the resumable delivery record is
> [`2026-09-03-agent-first-contact-orchestration.md`](../2026-09-03-agent-first-contact-orchestration.md).
> One proof boundary from the owning plan is still outstanding and was never
> accepted: the Apple Intelligence Foundation Models fallback needs a compatible
> physical-device run, so the deterministic parser and clarification fallback
> remain the production-safe behavior until that run happens.

# Agent-first contact orchestration

## Outcome

The iOS composer is one conversational entry. A recruiter sends a message
without first selecting a contact. The Agent decides whether the turn needs no
contact, a read-only contact lookup, a clarification, or a reviewable contact
change. The user only makes decisions that change canonical or external state.

The slice is complete when the real iOS surface demonstrates all of these
states:

- a general question receives a direct answer without contact UI;
- a uniquely identifiable contact is found by the Agent and shown as the
  answer's changeable context, without a pre-send picker;
- an ambiguous contact produces one compact clarification rather than reading
  several people's private relationship evidence;
- a requested contact create or update appears as an inline proposal card and
  changes nothing until the recruiter confirms it;
- confirmation uses an idempotent deterministic write, canonical readback, and
  a visible receipt; dismissing the card has no effect.

## Product answer

No, every message should not require contact selection. Contact is context the
Agent may need, not a required message field.

The main composer has one Send action. It can display an optional context chip
after the Agent has resolved a unique relationship or when the Session already
has one. Tapping the chip lets the user inspect or change it. The manual picker
remains a recovery control, not the primary route.

The Agent chooses semantic strategy and read-only tools. It does not receive
authority to silently create, update, merge, message, schedule, or publish.

## Interaction contract

### Before Send

- Do not require a contact or relationship picker.
- Keep an existing Session's confirmed scope visible as a compact chip.
- Label the button `Send`; do not claim that sending itself will bind a
  relationship.
- Attachments and dictated text remain task material, not confirmed evidence.

### After Send

The Agent chooses one of four paths:

1. `reply`: answer directly. No contact UI appears when contact context was not
   needed.
2. `reply_with_context`: search and read one uniquely resolved, account-scoped
   contact, answer from authorized relationship context, and show a compact
   `Using <name> · <context>` receipt with a Change action.
3. `clarification`: if identity or relationship context is ambiguous, ask one
   short question and show only minimal candidate rows. Do not load private
   evidence for every candidate.
4. `contact_change_proposal`: stage an exact create or update proposal and show
   an inline card with Confirm, Edit, and Dismiss. The Agent pauses at the card.

Tool activity is summarized as product state (`Searched contacts`, `Using…`,
`Change proposed`). Model reasoning and hidden chain-of-thought are never
shown.

## Contact Tool

The Agent receives one bounded `contact_workspace` Tool with a discriminated
`operation`. The tool enforces policy per operation; there is no model-callable
`apply` operation.

### `search`

Input:

- `query`: a non-empty name, handle, or relationship clue grounded in the
  current user message;
- `maximum_results`: 1–6.

Behavior:

- searches only the authenticated account;
- rejects empty, wildcard, or account-enumeration queries;
- returns opaque person/context references and minimal disambiguation metadata;
- returns no messages, evidence text, contact value, or unrelated profile
  detail.

### `read`

Input:

- one exact opaque person and relationship-context reference returned by
  `search` in this run.

Behavior:

- verifies account authorization and current identity state;
- returns only the exact identity and relationship header plus current
  revision needed to verify the selection; it does not return profile text,
  contact values, messages, or evidence;
- binds the Session to that scope, after which the existing governed Ask
  compiles the smallest authorized context and citation handles;
- fails closed on stale, deleted, merged, or unauthorized references.

### `propose_create`

Input:

- display name, relationship context, and optional identity clue copied from
  the user message or an authorized tool result;
- exact source excerpts and a plain-language reason.

Behavior:

- performs authoritative duplicate lookup;
- stages a discardable proposal, never a Person;
- returns a proposal event requiring human review.

### `propose_update`

Input:

- exact target Person reference, base revision, proposed display/context
  fields, source excerpts, and reason.

Behavior:

- keeps the resolved Person label unchanged;
- may keep the exact existing relationship label, or propose one new
  relationship context that is grounded in the current message;
- may attach only an identity clue copied from the current message;
- records conflicts and stale revisions instead of overwriting them;
- stages a discardable proposal event requiring human review.

Arbitrary renames and broad profile overwrites are outside this first slice.

Merges remain a separate higher-risk review flow. Message, calendar, CRM, and
notification writes are outside this Tool.

## Proposal event and confirmation

A contact proposal card carries in the current vertical slice:

- stable content fingerprint and idempotency key;
- `create` or `update` operation;
- exact target reference for updates;
- base revision plus proposed values;
- source excerpts, provenance, and Agent interpretation label;
- base-revision precondition for updates and a concise consequence summary.

`Confirm` calls the existing deterministic governed contact-capture executor.
Before the card is staged, the client refreshes canonical state and verifies
the exact target and base revision. The executor locks the selected identity
and context, writes once, reads canonical state back, and records a receipt.
`Edit` keeps the payload reviewable; the confirmation key binds the final
protected payload. `Dismiss` only discards the proposal.

A durable server-side proposal ID and expiry become necessary only when review
must cross devices or reviewers; they are not implied by the current local
Session card.

## Authority boundary

| Decision | Agent | Deterministic code | Recruiter |
| --- | --- | --- | --- |
| Answer without contact | chooses | validates output shape | observes |
| Search account contacts | chooses bounded query | authorizes and filters | observes receipt |
| Read one relationship | chooses exact result | authorizes and compiles evidence | can change scope |
| Clarify ambiguous identity | proposes question/options | limits candidate data | chooses or continues unscoped |
| Create/update contact | proposes exact change | stages, fingerprints, checks conflicts | confirms, edits, or dismisses |
| Apply canonical/external write | never | executes idempotently after approval | owns approval |

Agent freedom is freedom to choose a safe strategy, not freedom to widen data
access or effect authority.

## Failure and recovery

- No match: answer without relationship facts when possible; otherwise ask for
  one additional clue. Offer contact creation only when the user's intent
  supports it.
- Several matches: show minimal candidate rows; never silently select the most
  recent person.
- Tool/provider unavailable: preserve the user's message and show Retry plus a
  truthful local recovery; do not fabricate a lookup.
- Stale proposal: disable confirmation, explain what changed, and regenerate a
  fresh proposal.
- Lost response/retry: replay the same response or receipt from the same
  idempotency key.
- Deleted/merged target: fail closed and require a new selection.

## Visual direction

- The conversation, not a contact form, owns the screen.
- Use system typography, semantic colors, 16-point horizontal insets, and at
  least 44-by-44-point tap targets.
- Use glass only for floating navigation/control chrome. Answers and proposal
  cards are opaque content surfaces; never nest material effects.
- At accessibility Dynamic Type sizes, context chips and proposal actions stack
  vertically and body copy does not truncate.
- Every status uses text and a symbol, not color alone. VoiceOver labels state
  the proposed effect and whether confirmation is required.

## Non-goals

- ranking a candidate or predicting acceptance, performance, personality, or
  culture fit;
- searching every contact to infer who the user meant;
- exposing private evidence before a unique authorized scope exists;
- making the model the source of truth for identity, revisions, permissions, or
  write completion;
- auto-creating contacts from screenshots or auto-sending messages.

## Acceptance criteria

- Contract tests reject wildcard search, out-of-account references, stale
  revisions, unsupported patches, and model attempts to apply a change.
- Agent tests cover direct reply, unique match, ambiguous match, no match,
  create proposal, update proposal, provider failure, and tool-budget exhaustion.
- Backend tests prove idempotent proposal staging and confirmation replay.
- iOS tests prove no pre-send selection requirement, accessible clarification
  and proposal cards, dismiss/no-effect, retry, and confirmed receipt.
- The iPhone Simulator is exercised for general reply and contact proposal
  recovery; unique-context and ambiguity event boundaries are covered by
  backend and client validation tests. Light/dark and an accessibility Dynamic
  Type size are inspected.
