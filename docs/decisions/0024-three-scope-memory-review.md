# 0024 — Three-scope Memory review domain

Date: 2026-09-22
Status: Accepted

## Context

GET-40 asks for one real Memory loop shared by Chat, People, and
relationship/Pursuit surfaces. The Notion v0.2 source fixes three logical
scopes — about me (`self`), about a contact (`person`), and between us
(`relationship`) — and requires progressive confirmation, exact provenance,
per-item judgment, versioned correction, undo, and immediate deletion
propagation. The existing repository keeps conversation Sessions, the Agent
Wiki, fact versions, screenshot review, and per-user preferences in separate
stores; none of them can express a private self scope, a frozen review
snapshot, or independently retained minimal evidence.

## Decision

Add one bounded Memory review domain inside the existing PostgreSQL/Fastify
backend.

- Accepted memory is one independently understandable statement in exactly one
  logical scope. `self` memory is private to the acting user; `person` and
  `relationship` memory needs an active subject and, for relationship memory,
  an exact relationship context.
- A proposal is proposal-only. Models stage candidates through a typed Agent
  tool from a host-admitted source (current user message and ordered admitted
  images). The server verifies grounding, dependence, duplicate suppression,
  admission, and target revisions. A model cannot accept memory, assert a
  resolved identity, or create a contact.
- A review scope is server-issued and purpose-bound: it binds the reader, the
  frozen proposal revision, the surface, and the exact visible/can-submit item
  set, plus a one-time credential. Restricted surfaces never see private self
  text, ids, or hidden counts.
- Commit is all-or-none per review scope, mints an immutable receipt, and is
  the only path that creates a Person, an assignment, or accepted memory.
  Eligible items default to selected; conflicting, sensitive, and
  ambiguously-attributed items need an explicit per-item decision
  (`accept`, `keep_old`, `accept_new`, `retain_conflict`, `skip`). Any edited
  display text is conservatively marked user-edited while the original quote
  stays retained.
- The accepted minimal excerpt is retained independently of the temporary
  Session/image. Natural TTL expiry does not revoke it. Explicit Session,
  capture, or source deletion, authorization revocation, and identity rebind
  immediately remove dependent memory from every read and recall path.
- Accepted changes supersede affected knowledge snapshots, enqueue a Wiki/index
  projection job, and invalidate hidden SDK working context so a fresh Session
  cannot read stale derived understanding.

## Consequences

- The Memory backend is authoritative; the Agent Wiki and index remain
  rebuildable derivatives.
- A partial relationship save never concludes Chat items: the remaining items
  rebase to the next proposal revision and prior local selections are
  preserved by proposal, not by surface scope.
- Undo is a version-bound compensation. It never overwrites a later accepted
  version and never revives evidence whose source is no longer authorized.
- The shared Web review component, native-client compatibility, real-model
  value evaluation, and production deployment remain separate work.

## Reconsideration signals

Reconsider if a single source snapshot must be shared by several concurrent
reviewers, if native clients need offline commit authority, or if retained
minimal evidence must follow a different retention policy than the accepted
memory it supports.
