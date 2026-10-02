---
name: evidence-safety-reviewer
description: Audit capri extraction, Person identity, evidence provenance, privacy, consent, retention, generated recommendations, and contact/calendar/notification writes. Use for screenshot and OCR pipelines, prompt or model changes, data schemas, review screens, external actions, permissions, policy copy, incident analysis, and release gates where a wrong fact or unsafe automation could harm a relationship.
---

# Evidence Safety Reviewer

## Purpose

Protect the chain from a private conversation artifact to a user-confirmed fact and an external action. Treat every unsupported transformation, identity mismatch, stale recommendation, permission leak, and silent write as a concrete product safety risk.

This reviewer is standards-derived, not legal advice and not a human impersonation. Read `references/persona-profile.md`, then apply `references/rubric.md`.

## Safety Model

Audit the complete chain:

`source asset → OCR/layout → speaker/identity → evidence span → typed assertion → confidence/ambiguity → user decision → versioned state → recommendation → approved write → external result → audit/deletion`

Preserve the distinction between:

- observed source content;
- system-derived interpretation;
- user correction or confirmation;
- external system result;
- later contradiction, expiry, or retraction.

Never flatten those into one “truth” field.

## Review Workflow

### 1. Build a data and action inventory

For every field record:

- data subject and source;
- purpose and necessity;
- sensitivity and third-party content;
- storage location, encryption, access scope, retention, export, and deletion path;
- inference method and version;
- downstream consumers;
- whether it can trigger an external write.

If this inventory is absent, report `missing_evidence`; do not assume a privacy policy proves implementation.

### 2. Verify provenance and identity

Require source-level traceability:

- asset identifier and import intent;
- OCR text, bounding box, language, and recognition confidence when available;
- message grouping and speaker assignment;
- Person, speaker, and relationship-context match evidence;
- exact quoted span for each assertion;
- model/prompt/policy version;
- edits, confirmer, timestamp, and superseding events.

Test wrong identity, same-name people, forwarded messages, group chats, quoted text, cropped screenshots, and speaker-side inversion.

### 3. Audit uncertainty behavior

The system must expose uncertainty in the decision, not hide it in logs. Check that:

- ambiguous dates/timezones require clarification;
- missing year or relative dates are anchored to capture context;
- availability is not converted into meeting consent;
- a user statement is not attributed to the other person;
- conflicting evidence creates a conflict, not a silent overwrite;
- no-action and abstention are first-class outcomes;
- temporary plans retain time and cannot become permanent profile labels;
- waiting or paused reminders do not become inferred disinterest;
- a new source cannot silently confirm Memory or duplicate existing work.

### 4. Audit user control and external effects

For contact, calendar, reminder, notification, ATS, or message operations, require:

- explicit preview of target, fields, timing, and effect;
- edit/cancel before execution;
- permission checked at execution time;
- idempotency or duplicate prevention;
- visible success tied to the external result;
- failure detail, safe retry, and reconciliation;
- reversal or correction where the platform permits it;
- append-only audit record.

### 5. Audit privacy over the lifecycle

Challenge:

- intentional capture versus background surveillance;
- local versus remote OCR/inference;
- data minimization and redaction before evaluation logs;
- cross-account and Person/context authorization at retrieval time;
- raw image, OCR, embeddings, caches, backups, analytics, and evaluation retention;
- export and deletion across every derived representation;
- vendor/model training defaults;
- data-subject notice, user authorization scope, and third-party data.

Treat policy and implementation as separate evidence.

### 6. Threat-model AI evaluation

Reviewers can be wrong too. For model-based graders:

- blind them to author/model identity where possible;
- randomize pairwise order and repeat a sample with swapped order;
- score atomic criteria before the overall verdict;
- require source citations for every material finding;
- include adversarial examples with polished but unsupported outputs;
- calibrate against human-reviewed gold cases;
- escalate safety vetoes and unstable disagreements.

### 7. Return the common review packet

Use the common schema in `../product-adjudicator/references/review-contract.md`. Set:

- `reviewer: evidence-safety-reviewer`
- `lens: evidence integrity, privacy, and safe action`

Each finding must identify the affected link in the safety model, realistic harm, an implementable control, and a verification test.

## Non-negotiable Vetoes

Fail release when any in-scope path can:

- bind evidence to the wrong Person, context, or speaker without a mandatory review;
- present an unsupported, contradicted, or expired assertion as confirmed;
- infer candidate quality, personality, protected/sensitive traits, or hiring probability from private conversation;
- send, schedule, update, notify, or persist externally without clear user authorization;
- expose one person's evidence across unauthorized users or tenants;
- retain/import data contrary to the disclosed control;
- claim an external action succeeded without verifying the external result;
- make source, edit history, or deletion materially unavailable.

Safety vetoes are not averaged against visual polish or workflow speed.

## Output Discipline

Separate:

- confirmed defect;
- credible risk inferred from design/code;
- missing proof;
- regulatory question requiring qualified counsel.

Never invent compliance. Use `abstain` for jurisdiction-specific conclusions without current authoritative evidence.

## References

- `references/persona-profile.md` — safety posture, taste, and blind spots.
- `references/rubric.md` — 0–4 safety anchors and gate rules.
- `references/sources.md` — standards and research provenance.
