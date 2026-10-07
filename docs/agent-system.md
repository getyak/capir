# Agent system

## Purpose

capri uses agents to extend human judgment, not replace ownership of relationship truth or consequential action.

## Architecture

![capri agent control plane](talent-signal-agent-control-plane.png)

The control plane separates four concerns:

- method: reusable Skills and policies;
- context: authorized evidence and current state;
- runtime: the process performing the work;
- effect: a governed capability with independent verification.

This separation allows models, agent providers, and channels to change without
changing product truth or authorization.

## Two runtime classes

### Governed workflow

Use a governed workflow when the stages, review points, and outcome checks are
known.

The capture-to-action loop retains deterministic identity, evidence, permission,
recovery and effect gates. Inside an admitted Agent task, the Claude Agent SDK
owns planning, model/tool iteration, context management and delegated work.
Domain tools validate capabilities; the SDK remains the only model planner.

### Open-ended agent task

Use an open-ended agent when the sources or number of steps cannot be known in
advance and partial artifacts remain useful.

Good uses include company and market research, meeting preparation,
contradiction investigation, client-update/interview drafts and product work.

An open-ended agent may produce an artifact or proposal. A task may also grant
specific reversible internal filing operations, enforced by domain tools. It
cannot confirm a fact, merge identity, or grant itself consequential actions.

Workspace image runs have a bounded allowance for repeated visual context. Conversation deadlines cover inspection, model startup and tool turns together, independently of HTTP admission. Cancellation and source revocation remain immediate. See [product run operations](operations/product-feedback.md) for current limits and trace coverage.
Public-web research has a separate definition, explicit company/market purpose, domain and usage budgets, and no conversation evidence or attachments.
Search discovers untrusted leads; every draft claim cites only same-Run fetched sources and gains no truth or action authority.
The legacy screenshot public-person definition is read-only: one intentional
image authorizes a local Run using visible text clues and bounded profile tools
to emit an unconfirmed cited draft or `no_action`. It has no internal filing
grant. The separately gated contact-filing task below adds that explicit grant.

### Runtime placement

The backend owns authenticated scope, canonical evidence, filing, review, confirmed
state, effects and audit. The SDK provides image understanding and reviewable drafts;
recognition is optional. The Agent Host owns web credentials and network policy,
without database or filing authority. Only public anchors, typed research calls
and legacy process-only images cross to it. The Agent core owns schemas, policy
and orchestration, not secrets or canonical state.

Scoped chat traces admitted Memory to original screenshot tiles. Input and tool images
share ephemeral processing policy. Source guards cover the Run and final commit;
the shortest image expiry bounds derivatives. Diagnostics retain metadata, not pixels.
Receipts and artifacts establish no confirmation, new source or publication authority; a read proves scoped access, not visual correctness.
Uncertainty binds original regions and fields. Corrected model readings or reader disagreement are not source conflicts;
readable nearby text cannot resolve uncertain speaker, time or identity fields.

## Governed loop

![capri agent runtime flow](talent-signal-agent-runtime-flow.png)

1. authorize one immutable objective, Pursuit or subject scope, and budget;
2. compile the smallest relevant context;
3. choose or revise a short plan;
4. request one bounded read, artifact, clarification, proposal, or stop;
5. validate the request outside the model;
6. record the observation and checkpoint;
7. continue, wait for a decision, or stop.

The runtime stops when the outcome is complete, a human decision is required, authority changes,
the budget ends, repeated failure exceeds policy, or the task is cancelled.

## Agent control plane

The control plane owns these concepts independently of provider sessions:

| Concept | Meaning |
| --- | --- |
| Definition | Versioned job, eligible capabilities, context policy, output expectations, and stop conditions. |
| Task | User-authorized objective, subject scope, purpose, retention, budget, and time horizon. |
| Run | One attempt against an immutable task version; it may wait, resume, branch, finish, fail, expire, or be cancelled. |
| Checkpoint | Restorable progress, current plan, unresolved questions, observations, artifacts, and remaining budget. |
| Artifact | Useful output without truth authority: a brief, packet, question set, proposed patch, or playbook. |
| Proposal | Provenance-bearing request for a fact, action, or learning decision; no execution authority. |

## Capability boundary

Capabilities progress through increasing consequence:

| Class | Meaning | Default posture |
| --- | --- | --- |
| Scoped read | Retrieve authorized evidence or state | Automatic within task scope |
| Internal reversible | Create attention or an artifact | Reviewable and undoable |
| Device or external write | Change Contacts, Calendar, ATS, CRM, or communication | Exact-effect approval and verification |
| Prohibited | Judge people, infer protected traits, or expose generic production access | Never available |

The model proposes intent. The control plane decides whether a capability exists, is in scope, is currently allowed, and can execute safely.

Validate original tool arguments before provider normalization discards unknown fields.
Repair hints use bounded schema-owned names/codes, never rejected values or unknown keys; diagnostic failures preserve denial. Per-Run SDK observations may omit identical successful state metadata; changed/error state and source evidence remain intact, and tool authority is checked anew.

Fact confirmation, exact-effect approval and destination verification remain independent decisions; passing one never substitutes for another. User-owned remote MCP rides `mcp_connections` in this class: staging executes nothing, every call needs the human's exact single-use approval bound to the original input schema regardless of remote read-only hints, and resolved receipts return to the same conversation as provenance, never confirmed relationship evidence.

## Context engineering

Support natural conversation around the user's current intent; load relevant
task context and match the requested form and depth. Formal prompts ship with
code and load locally; each task and experiment freezes its selected version.
Opik mirrors versions for experiments, with selected drafts imported as source
changes. Tool descriptions own usage, the host owns authorization and validation,
and adapters add terminal protocol. Give useful partial answers and clarify
material gaps. See [prompt operations](operations/opik-prompts.md).

Conversation uses natural prose. Streaming exposes filtered visible text and bounded stage codes; cancellation never starts a second provider run. Typed data belongs at tool and durable artifact boundaries, where product validation can act on it. Skills do not add permissions, evidence access, or execution authority.

An intentionally shared conversation screenshot should yield useful relationship context and reviewable changes, rather than repeat every visible bubble. Preserve the owner's introduction, acquaintance source, and relationship events with their speakers and unresolved dates. Public place clues support separate cited research, not proof of presence. Name-only lookup supplies candidates for human review, not authority to read private memory or bind identity. Changes remain unsaved until successful human commit.

Use this order:

1. immutable platform and safety boundaries;
2. current objective, scope, budget, and completion criteria;
3. eligible capability interfaces;
4. current plan and unresolved questions;
5. relevant confirmed state;
6. clearly labeled interpretations;
7. exact evidence excerpts;
8. prior observations and artifacts.

Every included item should have a reason, version, authorization scope, and
restorable reference. Large observations belong in artifacts, not the active
prompt.

Each run records a knowledge snapshot and context manifest: task version,
Pursuit and subject scope, references, inclusion reasons, authorization and
content identity. The manifest references governed content for replay instead
of copying an unbounded transcript.

Screenshots, web pages, files, connector results, and generated wiki text remain
untrusted content. They cannot modify policy, permissions, or approval
requirements.

SDK working context is an expendable derivative of one authenticated product
Session, not long-term relationship Memory. Continuation binds its owner,
scope, runtime configuration and source generation. It preserves the earliest
source and identity deadline; a lifecycle worker's delay never extends access.
Correction, rebinding, revocation, deletion or scope change invalidates hidden
summaries and subagent copies as well as the visible transcript. Concurrent
turns and source changes must fail safely at commit without blocking revocation.
Authority checks must not roll back unrelated writes in the product transaction.

Local SDK files require explicit ownership and crash recovery, including
copies created before an initialization hook runs. Retaining a successful SDK
turn is conditional on the product accepting the reply; interrupted or rejected
turns cannot advance its durable checkpoint. A fresh Session recovers sourced
Memory through current domain reads, never by inheriting an old transcript.

Response style is a user-owned, revisioned preference in the product database.
The host supplies the verified setting before each answer; scoped reads remain
available. Current instructions take precedence. Saving or resetting invalidates
working context. Web reads, turns, and preference writes bind the initiating login before
forwarding its credential; stale tabs cannot act under a replacement account.
Clients verify a matching readback before displaying a saved setting.

Calendar preparation is a typed, human-reviewed draft with a host reference clock, client timezone and literal user source. The Agent cannot execute it. Natural chat
may end after a validated draft, an explicit whole-task finish choice and the full tool batch; source, cancellation,
budget and genuine SDK usage checks remain. New original steering continues the Run
discards old prepared output and disables early stopping. Failed tools or unrequested hook stops never confirm preparation.
Clients separate source text from editable title/time: Web exports ICS for calendar-app
review; iOS requires exact confirmation before EventKit writes and persists a write claim.
Unknown outcomes survive reconstruction and cannot silently retry creation. Saved UI uses the actual event receipt, including reviewed fields, rather than the original draft.

## Memory and Agent Wiki

Source memory preserves captures; episodic memory preserves event order;
semantic memory represents current understanding. Procedural and operational
memory describe reusable action and task methods without granting authority.

New model output enters as a proposal. Accepted facts, source statements, and
user opinion stay distinct across the self, person, and relationship scopes.
Repeated corrections may propose a playbook, but learning remains reviewable.

The Agent Wiki is the primary shared, versioned compilation of governed state
for longitudinal retrieval. Pages support search and citations, and rebuild
after correction, conflict, expiry, permission changes or deletion. They never
replace source evidence, fact versions, outcomes or approved procedures.

Pages contain addressable knowledge blocks rather than one generated essay.
Material blocks preserve status, time, authorization scope, provenance, and
references. They may combine confirmed understanding, relevant history,
explicit interpretations and conflicts, approved procedures, and
freshness-bounded research without sharing one permission or retention rule.

```text
workspace or subject map
→ compact page summary
→ relevant knowledge blocks
→ supporting fact or event versions
→ exact source evidence when verification requires it
```

The context assembler combines relevant structured state, Wiki blocks and exact
evidence; whole-Wiki prompts and vector similarity alone are insufficient.

Private workspace turns preload bounded self memory with provenance, time,
conflicts and versions; scoped recall pages recover omitted detail and excerpts.
Business views never receive self content or coverage. Current person/relationship
Memory pages accompany Wiki reads; empty snapshots do not establish absence.
Preserve attribution and explicit page coverage, including unavailable self context. A successful nonempty domain read supports recollection without unrelated Wiki citations; it does not verify statements or prose. Memory stays separate from service settings; source guards apply before reads and answer acceptance.

Each run reads an immutable knowledge snapshot, whether exposed through a
service or an Agent-readable file bundle. A provider session, compacted chat,
or sandbox is working state, not long-term product memory.

Agents write artifacts and proposed knowledge patches against the snapshot.
They do not silently overwrite a page or promote their own summary to fact.
Validation checks identity, provenance, conflict, time, scope, and deletion.
Facts require confirmation, external results require observation, and
procedural learning requires review. Accepted changes update governed state
before compiling a new Wiki version; temporary scratchpads and hypotheses
expire unless preserved as reviewable artifacts.

Identity retrieval applies both source authorization and identity-handle
freshness at use time. An expired handle may supply a masked, account-scoped
candidate for structured human review, but it cannot act as confirmed identity
context for an Agent run. Reconfirmation requires a fresh governed source and a
human binding decision; an Agent may open and explain that review but cannot
extend the deadline or promote the clue itself.

For a handle with current and expired historical owners, the Agent preserves
the service's temporal order and reasons; it may explain and open review but
cannot preselect, collapse records, bind to history, or retry after failure.

## External agents and channels

Codex, Claude, Cursor, Manus, OpenClaw, and future runtimes should connect through one provider-neutral capri boundary.

Initial external abilities are scoped reads, intentional capture, artifacts,
fact/action proposals, internal attention, and signed review handoffs.

External agents should not directly confirm facts, merge identities, send
messages, change calendars or contacts, update an ATS, query the production
database, or obtain a generic browser or shell over person and relationship data.

Channels such as WeChat are capture and attention surfaces, not tenant
boundaries or systems of record.

## Bounded product tasks

Each definition receives a small host-enforced capability manifest. The backend
freezes scope, objective, context and budget, then retains validated artifacts,
usage and terminal receipts. Workspace contact search uses current-message
clues; ambiguity requires clarification. Proposals retain exact source excerpts
and current-target revisions. Public research has no publication authority.

### Authorized screenshot contact filing

An intentional import grants internal filing, IM storage, analysis, and optional
sourced professional observations. The model chooses tools; the backend owns
validation, writes, checkpoints, and readback. Ambiguity requires clarification.
Filing never confirms actors, dates, real-world identity, or interpreted claims.

An ordered image set is one immutable import intent. Each message retains image
provenance; conflicting visible identities stop filing, and overlapping messages
are not repeated commitments. Private originals stay outside model/task state
and expire with the task. New tasks run the pinned, no-OCR `screenshot-preprocess.v3` contract first; recovery reuses stored originals and per-image provider checkpoints, downstream models receive an original again only for a recorded multimodal follow-up region, and the authenticated monitor shows this unconfirmed packet beside the bounded seven-day visual Memory. A packet can request at most 24 follow-up regions across all source images, and each region names the exact baseline uncertainty plus the message, identity clue, contact name, or source gap that it may refine; a text region also binds the exact unique proper old substring it may replace, never the entire message. Reviewed iOS capture preserves the preprocessing message and source-image locators, while discard or completion deletes only the preprocessing copy at its exact revision before local source removal; a linked canonical capture and its derived review remain intact.
Source invalidation denies access and queues retryable permanent cleanup;
reversible archive hides sources without extending retention. See the
[storage playbook](operations/backend-production.md#chat-media-object-storage).

Profile observations preserve provenance and conflicts without overwriting
confirmed facts. Cancellation fences work; expiry and invalidation retract derivatives.
Deletion needs a separate current-target grant with reversal. Imports never
grant identity merges, device writes, or messaging.

Every catalog entry declares its capability class, consequence, approval,
reversibility, idempotency, read-only behavior, and open-world behavior. These
host-enforced descriptors keep provider adapters thin and make authority
boundaries inspectable without asking the model to infer them from prose.

The governed Pursuit Task adds durable attempts, snapshots, checkpoints, artifacts, and events with authoritative readback. Interactive surfaces consume an account-scoped cursor projection and recover from canonical snapshots, never from provider tokens, private reasoning, or a live session. Progressive semantic blocks remain projections of the authoritative Artifact, Proposal, decision, and terminal Receipt. PostgreSQL notification, Redis, or another broker may accelerate fan-out but must remain disposable: its loss degrades to bounded readback without losing, duplicating, or widening the task. Decisions retain domain owners; resume and effects remain targets.

## Evaluation

Evaluate evidence, identity and temporal correctness separately from proposal
usefulness, review effort and user control. Check effect reconciliation, Memory
grounding/deletion, trajectory quality and budget alongside workflow outcomes.

Evaluate both trajectory and outcome. An agent saying it is finished is not evidence that the environment is correct.
Internal evaluation binds frozen inputs, lineage, reference time and actual configuration; real corrections, Agent judgments and human gold remain distinct.
Codex may review independently verified candidates within explicit budget and release scope; generators cannot see holdouts or approve releases, and business-action authority is unchanged. See [ADR 0015](decisions/0015-private-evaluation-and-delegated-prompt-improvement.md).

Release boundaries include:
- every consequential write has specific approval and provenance;
- ambiguous identity, speaker, date, or scope cannot trigger an automatic
  write;
- unsupported or prohibited inference cannot become active state;
- duplicate and unknown-result writes remain safe;
- source deletion reaches every governed derivative.

Deterministic and credentialed trials share the real database protocol; neither authorizes production data or broader tools. See [Wiki rationale](decisions/0004-agent-wiki-knowledge-layer.md)
and [Agent systems research](research/agent-systems.md).

## Reconsider when

Revisit this design when evidence shows that a governed workflow cannot express
the core product, users can safely delegate a broader consequence class, or a
runtime-specific capability creates durable value that a provider-neutral
boundary cannot preserve.
