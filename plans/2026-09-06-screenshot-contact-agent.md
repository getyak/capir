# Screenshot contact Agent delivery

## Outcome

Deliver two real product cases: a new-contact chat screenshot is understood,
searched against the account, stored with IM evidence, and returned as a contact
and analysis card; a subsequent screenshot reuses the existing contact and lets
the Agent choose public research, fetch sources, and update the sourced profile.
Exa supplies LinkedIn and web search; TikHub supplies multiple public platforms.
Contact tools include search, read, create, update, and reversible deletion.

The user explicitly authorizes automatic internal contact filing, evidence
storage, research, profile updates, and provider configuration for this flow.
An intentional import supplies the operation authority; model content cannot
extend it. Preserve uncertain identity, source statements, and interpretations
without calling them human-confirmed facts. Ambiguity asks within the same task.
Cards are returned inside Talent Signal. iPhone Contacts synchronization is an
optional pending clarification; no candidate-facing communication is requested.

## Snapshot and ownership

Start from the existing working tree on 2026-09-06. Substantial unrelated Lab,
capture-review, and iOS changes are already present. Preserve them. Prefer new
modules for the task and provider work, with narrow edits to shared contracts,
routes, deployment, and UI integration. This task owns final verification.

## Milestones

1. Complete: Exa search/fetch and all four TikHub platform searches work live;
   replacement credentials are stored in Infisical and active in the host.
2. Complete: durable model-driven contact/evidence/profile task and scoped
   research tools, exact-source readback, recovery, and reversible archive.
3. Complete: Web import/contact page/history/recovery and iOS Send/cards/history/
   source pages, including native same-image reattachment. Native build passed;
   no new TestFlight binary was published.
4. Complete: new/existing contact cases passed through the real Web UI and real
   providers, with database receipts; seven authority/lifecycle tests passed.
5. Complete: archive/reload/undo passed through the Web UI; the final backend
   revision is deployed and its source hashes match. Documentation checks and
   the delivery review passed.

## Architectural direction

The backend owns authenticated scope, contact/evidence state and receipts. The
Agent Host owns open-web credentials and guarded search/fetch. Model-selected
tools receive typed, bounded arguments and current execution grants. Evidence
is stored before a derived profile is compiled. Confirmed fields keep their
authority; sourced observations and analysis are distinct profile sections.
Source deletion must retract all active derivatives. Duplicate submissions and
unknown responses reuse immutable intent and do not create duplicate contacts.

## Cases and proof

- New contact: one realistic chat screenshot with a visible name and identity
  clue creates one internal contact, ordered source messages, supported analysis,
  and a receipt linking the actual contact and source.
- Existing contact: a new screenshot with the same identity reuses that contact;
  the Agent may search LinkedIn/web or TikHub, fetch a discovered source, and
  save a sourced profile update. Repeating the request changes nothing twice.
- Negative cases: same-name ambiguity, group/forwarded/partial chat, unknown
  speaker/date, no readable signal, irrelevant or malicious webpage, unavailable
  provider, cancellation, stale target, correction, deletion, and unauthorized
  cross-account access.

## Evidence and remaining work

The [delivery evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-screenshot-contact-agent/README.md)
is the authoritative case/check/deployment record. Initial API Lin case and
both new/existing Andrew cases are complete. Web recovery preserves capture IDs
and message counts. Mobile Web was inspected at 390 pixels with no horizontal
overflow. Native Debug Simulator build and localization check passed.

Live output exposed two repair needs: URL provenance comes from both page
metadata and exact body excerpts, and long source IDs/repeated payloads made
model correction unreliable. Short governed source references and deduplicated
context now resolve to the same durable source IDs. Models still have bounded
failure/partial states rather than fabricated success.

The deployed TestFlight service passed health, Apple auth, voice, chat, and
HTTPS probes. Its Unix socket returned two live observations from each of the
four TikHub platforms using the replacement key. Docker Hub TLS failed twice;
a newly compiled image based on the verified prior local runtime was deployed
through the normal script. The final archive-reload refinement passed the real UI check and is deployed.
The canonical Agent document retains the boundaries; dated provider, field,
and implementation details live in the linked evaluation record.

## Completion rule

Keep the goal active until both cases work through the real user surface with
canonical contact/evidence/profile readback. Do not substitute a draft-only
research result, mock-provider success, or tool registry for the requested loop.

## Completion review

Both requested cases are implemented and observed through the real Web surface
with database readback. The Agent chooses typed tools and revises rejected
calls; domain authority, source provenance, budgets, and recovery remain
independent of model output. Thirty focused tests (5 provider, 18 host, 7
database) passed, along with Web/backend typechecks, targeted lint, native
Simulator build/localization, and documentation/architecture checks.

The native client integration is built, but no new TestFlight binary or native
UI-trial claim is included. The proof Web/API/database remain running for local
review and contain synthetic evidence only. Existing unrelated changes remain
untouched. No user decision is outstanding for this delivered internal-filing
scope; optional iPhone Contacts synchronization is outside it.
