# Integration boundaries

## Purpose

Integrate another system only when it advances the evidence-to-action loop
without silently widening access to person and relationship data or bypassing review.

## Integration classes

### Local and device capabilities

Use the device when privacy, platform ownership, or user presence is part of
the trust boundary. Local processing may reduce exposure, while Contacts and
Calendar effects remain visible to the user and platform.

An iOS Shortcuts action may accept one user-selected image, validate its actual
decodable content plus byte and pixel bounds, and stage a device-owned capture
with a stable Agent Session identifier. The app resumes processing from that
protected queue and opens only when a concrete decision is blocked. One-press screenshot capture requires a user-owned
personal Shortcut that chains the system `Take Screenshot` action into that
image action; a required-image App Shortcut alone would still ask the user for
input. Only the user can assign the personal Shortcut to the Action Button in
system Settings. capri cannot capture another app's screen or inspect
or change that mapping. The screenshot choice authorizes purpose-bound
processing, reversible proposals, and source attachment when one current
confirmed identity clue resolves to one person with one existing relationship
context. It grants no fact confirmation, compilation, or external-write
authority.

A contacts CSV, LinkedIn `Connections.csv`, or vCard selected in the Agent's
Sources page is another local intake adapter, not a connected account. The
client limits size and row count, records a content hash, parses mapped contact
fields on device, exposes invalid and duplicate rows, and discards the raw file
after the review screen is gone. One reviewed row may reuse the governed
resource-intake contract to propose a Person create, exact source attachment, or
unresolved identity case. The client protects that decision and its stable
idempotency key before sending. Imported organization and position remain
source evidence; unreviewed notes and unmapped values receive no truth or Memory
authority. Recognized aliases cover LinkedIn, Google Contacts, Outlook, common
CRM export fields, and generic English or Simplified Chinese contact headers;
unrecognized columns remain named for review instead of being guessed.

The user's own multi-platform profile references are account-scoped local
configuration only. They grant no authentication, contact access, sync,
research, messaging, or publication capability. A future live adapter must
replace the reference state with a server-owned capability that names scope,
freshness, revocation, retention, and independently approved write behavior.

Sign in with Apple is an account-entry adapter. The iOS client requests a
nonce-bound identity assertion; the backend verifies it and owns account
binding, session issuance, replay prevention, and revocation. Apple profile
fields may be available only on the first authorization and are not evidence
about any relationship. Sign-out revokes the server session when
reachable, always clears the protected device credential, and returns to the
account boundary so a prior workspace cannot remain visible.

Calendar is an outbound device projection, not an intake source or a second
record. capri persists the user-confirmed event and its projection
state before requesting write-only access and adding one event to the system
default calendar. It does not import, browse, mirror, or listen to Apple
Calendar. After the user separately reviews an edit to an already linked event,
the app may request full access, resolve only the saved EventKit identifier,
update that exact event, and read it back to verify the result; it never scans
the surrounding calendar or creates a replacement when the identifier is
missing. Turning off default sync keeps new events local but does not override
an explicit reviewed update to an already linked event. A denied or failed
write leaves the capri event intact. Each reviewed edit retains an
append-only operation receipt with its before/after values, intended projection,
and observed EventKit outcome; an interrupted result remains unknown until the
user reconciles it. An edit or deletion made directly in Apple Calendar does
not mutate capri truth.

### Shared services

Use the shared backend for cross-surface identity, evidence, review, action,
outcome, and audit state.

### MCP extensions

Extensions distinguish connecting an external server from granting a client
access to capri. Saving a server address grants no execution authority:
verified connectivity establishes bounded capability discovery only. Remote tool
descriptions and read-only annotations are untrusted declarations, not permission.

Each external client receives an independently revocable, expiring grant for
explicit read scopes. Browser sessions and provider credentials are never
exported as client credentials. Member suspension or role changes revoke prior
grants permanently; reinstatement does not restore them. Published projections
exclude raw evidence, conversations, contact handles and external writes.
Remote tool calls need one exact, single-use human approval bound to the
original discovered input schema; resolved results re-enter the same
conversation as durable receipts with provenance and never become confirmed
relationship evidence. Optional Nango-mediated OAuth binds a server-generated
connect request to the approved endpoint and account identity; without
configuration OAuth is explicitly unavailable. Transport support and
deployment configuration live in the
[MCP operations guide](operations/mcp-extensions.md).

### Model providers

Models are bounded processors of authorized context. Provider choice may vary
by quality, language, latency, cost, and retention posture, but no provider
becomes canonical memory or permission authority.

A provider is not admitted for private conversation evidence until its
contract and observed configuration establish processing location,
subprocessors, training use, human access, operational logging, retention,
deletion propagation, incident notice, and commercial-use rights. A stateless
API flag or security marketing claim is not a substitute for that evidence.

Provider capabilities are admitted independently. Selecting a model for image
generation does not make that model, credential, or data path suitable for
understanding private conversation evidence.

Unscoped conversational Chat is admitted independently from relationship
answering. Its provider request starts with only the current submitted text and
an explicit account boundary. The model may answer directly or use the single
`contact_workspace` capability: a grounded search returns only minimal labels,
and a read is admitted only for one uniquely resolved same-Run Person/context.
The app then binds that scope and invokes the existing governed relationship
answer contract; the unscoped model never receives conversation evidence. A
create/update call yields only a review candidate. No operation can apply,
merge, message, schedule, publish, or return an external effect.

### Public-web providers

Public search is admitted separately from model processing and private
evidence. A search provider receives only a query formed inside an explicitly
authorized company/market research Run. capri normalizes provider
results, fetches only same-Run result handles through its own guarded HTTPS
boundary, and preserves cited output only as a draft artifact.

A local Agent-host registry owns stable capability contracts, provider
selection, budgets, and failure semantics for open-world reads. Infisical owns
scoped credential delivery and rotation; each vendor still owns its commercial
subscription and invoice. The shared backend receives neither these search
credentials nor implicit publication authority. A provider registry or MCP
catalog never grants runtime authority by discovery alone.

### Public-person profile providers

Public-person research is admitted separately from company/market search and
from private conversation processing. One intentional screenshot submission
may start one local read-only Run. A vision model can use only text visibly
present in that image—display name, handle, profile URL, or platform chrome—to
choose a bounded provider Tool. The query, platform, provider, budget, image
manifest, normalized observations, and draft citations remain inside that Run.

TikHub is the first adapter. Its credential and base URL live only in
`/agent-host`; neither reaches the shared API process, Web or mobile client, or
model prompt. A local Agent Host process or sidecar receives them and exposes
only a strict zero-effect service contract over an owner-only Unix socket.
TikHub platform calls are independently budgeted and never fall back to another
provider. A liveness response and authenticated account envelope prove
configuration without issuing a billable profile search.

Relationship Ask invokes this service automatically for exactly one
PNG/JPEG/WebP when the feature and sensitive-processing gates are both
admitted. If no relationship is selected, the image crosses the authenticated
API as a process-only, account-scoped task input rather than first forcing a
Person or relationship choice. Its declared size and SHA-256 hash must match;
the idempotency and audit records retain metadata and the zero-retention
receipt, not the base64 image. The user does not choose a relationship,
platform, tool, or candidate before the Run. The API returns the Agent's
unconfirmed public-source draft and clickable source references; it does not
promote them into canonical relationship evidence or a Person identity.

Provider output is public-source observation, not confirmed identity or
relationship evidence. The artifact must say `possible_match` or `ambiguous`,
carry same-Run source identities, and retain no publication or external-effect
authority. The capability excludes face matching, reverse-face search, private
accounts or cookies, contact details, background checks, protected/sensitive
traits, candidate scoring or ranking, and acceptance prediction. Binding a
result to a capri Person remains a separate human identity decision.
That decision starts from a visible review card, never from provider output
alone. The client may propose a short card headline, but the user can edit
or omit it and must still choose an exact existing Person or explicitly create
a new one. Provider biography text remains review-only and is not copied into
the confirmed Person projection. Public-source avatars remain link-only for
TikHub because its terms
do not grant capri display or storage rights and source-platform terms
still apply. A future avatar write requires a provider display license or
profile-owner consent, not user confirmation alone. The backend accepts a
reviewed card only on a governed contact record whose HTTPS profile URL and
content hash exactly match the same provider result. The durable projection
retains its confirming user, source resource, retrieval time, and revision,
and People returns it only while the linked source remains active and
authorized. Manual source deletion or a reached retention deadline removes the
reviewed profile derivative and records that removal in the source lineage.

LinkedIn discovery is available through the admitted Exa public-search adapter;
it is not a LinkedIn account integration and grants no authenticated member
profile API, private data, identity confirmation, or write authority. General
Web discovery uses the same Exa boundary. Xiaohongshu, Reddit, Douyin, TikTok,
Weibo, Threads, and Instagram profile discovery remain pinned to TikHub. One
explicit multi-channel call may run these adapters concurrently, but each
channel preserves its provider identity and failure; no provider silently
falls back to another.

### Connectors

ATS, CRM, calendar, contact, messaging, and automation platforms operate
through the governed capability boundary. They receive the minimum information
needed for one approved effect.

### External agents and channels

Codex, Claude, Cursor, Manus, OpenClaw, WeChat, browser capture, and future
clients may read scoped context, submit capture, create artifacts, and propose
work. They do not receive direct domain or external-write authority.

## Admission questions

Before adding an integration, ask:

- Which recurring user outcome does it improve?
- What new data becomes accessible?
- Where does authorization occur?
- What can it change?
- How is the destination result observed?
- What happens on timeout, duplicate, revocation, and deletion?
- Can the integration be replaced without changing product truth?
- Is a user-controlled handoff safer than direct execution?

If these questions do not have clear answers, keep the integration outside the
production path.

## Credential and data posture

- Keep provider credentials out of client-visible surfaces.
- Separate project credentials from unrelated personal credentials.
- Minimize private payloads in generic logs, events, analytics, and error
  systems.
- Record provider, purpose, scope, retention, and data location for
  consequential processing.
- Keep private evidence out of provider products that claim broad or
  irrevocable data rights for training or service improvement.
- Revoke retrieval before asynchronous deletion finishes.
- Treat all retrieved content as untrusted data.

## n8n

n8n is appropriate for connector prototypes, design-partner workflows, and
operations automation. It should invoke capri's governed interfaces and
must not own relationship truth, approval, or Agent lifecycle.

## Reconsider when

Add integration-specific design only after a real workflow demonstrates
recurring value, the consequence class is understood, and end-to-end
verification is possible.

See [Architecture](architecture.md) and [Agent system](agent-system.md).
