# PRD-01: Pursuit CRM domain and OpenAPI

## Problem and user outcome

Relationship history alone cannot tell a recruiter which outcome is blocked.
The system needs one canonical Pursuit that makes target outcome, time, current
milestone, contextual roles, criteria, evidence-backed gaps, and owned actions
readable and safely revisioned.

## In-scope requirements

- `V1-CRM-001` through `V1-CRM-005`;
- `V1-REV-003` stale-revision conflict;
- `V1-REV-005` structured receipt;
- Pursuit-path contribution to `V1-SEC-001` and `V1-AGT-005`.

## Out of scope

- Signal ingestion and Agent Proposal review;
- external effects or sent outreach;
- a configurable CRM object builder;
- candidate score, fit, personality, protected-trait, or acceptance inference;
- iOS rendering, Today ranking, and field-research claims.

## Personas and entrypoints

An independent recruiter creates and revises a recruiting Pursuit. A sales
fixture exercises the same kernel without gaining a second domain model. API
entrypoints are authenticated list, create, detail, revision, and operation
readback.

## Screen and interaction states

Later UI must cover loading, empty, active, paused, terminal, stale, conflict,
failed, offline, and receipt readback. This PRD owns the canonical states that
those screens render; it does not count a SwiftUI state as completion.

## Canonical owner and data model

Migration `020_pursuit_domain` adds Organization, Pursuit, PursuitRole,
Criterion, Gap, internal PursuitAction, PursuitOperation, and PursuitReceipt.
Person remains the existing stable subject. Roles are contextual and may differ
for the same person across Pursuits. Gap stores basis and close condition.
Action stores owner, status, optional due time, and a database-enforced empty
external-effects array.

## State transitions and invariants

- Pursuit is `draft → active ↔ paused → succeeded | failed | cancelled`;
- terminal states cannot reopen through the revision endpoint;
- revision begins at one and every actual change increments exactly once;
- stale revision returns conflict and never overwrites newer state;
- duplicate operation returns the same body and receipt;
- Gap basis is either explicit user authorship or active reviewed evidence;
- an Action owner must be an active user in the same workspace;
- recruiting and sales types share schema and code paths.

## HTTP, event, and tool contracts

Contract version `2026-08-24.1` adds:

- `GET /v1/pursuits`;
- `POST /v1/pursuits`;
- `GET /v1/pursuits/{id}`;
- `POST /v1/pursuits/{id}/revisions`;
- `GET /v1/operations/{id}`.

TypeBox is the OpenAPI source and `TalentSignalClient` is the shared generated-
boundary client. Audit events publish `pursuit.created` and `pursuit.revised` to
the existing account sequence.

## Permission and privacy boundary

Every query binds authenticated `account_id`. Person, organization, evidence,
and Action owner references are validated in that workspace. Evidence-supported
roles or gaps accept only active, reviewed evidence fragments. No request field
can add an external effect.

## Failure, retry, conflict, and delete behavior

Duplicate identical requests replay. Key reuse with another payload is rejected.
Concurrent writes lock the Pursuit and exactly one expected revision wins.
Stale writes return `PURSUIT_REVISION_CONFLICT` with current revision. Pursuit
deletion is deferred until PRD-07 defines evidence and projection lineage; no
unsafe hard-delete endpoint is exposed here.

## Deterministic tests

Schema and contract tests verify entities, tenant foreign keys, allowed states,
empty external effects, common recruiting/sales shape, revision request, and
receipt shape. The runtime evaluation verifies idempotency, concurrent conflict,
readback, contextual Person roles, cross-workspace rejection, and unsupported
evidence claims on fresh PostgreSQL.

## Agent SDK evaluation cases

No Agent runs in this PRD. Later tools may read a scoped Pursuit snapshot or
stage a proposal; they cannot call create/revise as direct business authority.
The external-effects invariant remains empty in every Agent case.

## Simulator and full-stack journeys

Backend full-stack proof is
[`pursuit-domain-runtime.json`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-08-24-v1-prd-01/pursuit-domain-runtime.json).
The iOS Today → Pursuit → Review → readback journey remains a required PRD-05
artifact and is not claimed by this proof.

## Metrics, rollout, and rollback

The hard metrics are zero cross-workspace access, duplicate entities, stale
overwrites, or non-empty external effects. Rollout begins with synthetic
fixtures, then design-partner workspaces after retention decisions. Rollback
disables the routes and client feature while preserving forward-compatible rows,
receipts, and audit history.

## Open decisions and falsifiers

Recruiting milestone vocabulary and collaboration roles remain product-owner
decisions. Milestone is therefore template-owned text, not a universal enum.
Reconsider the shared kernel if recruiting needs repeated type checks or cannot
express its complete flagship journey without template-specific canonical
tables.
