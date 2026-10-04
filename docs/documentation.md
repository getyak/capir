# Documentation system

> Documentation should improve future judgment, not preserve every past
> thought.

## Purpose

Project documentation exists so a capable human or agent can recover intent,
make a sound decision, and verify work without replaying old conversations.

The system optimizes for:

- high signal per token;
- one canonical home per claim;
- progressive disclosure;
- durable reasoning rather than transient implementation detail;
- explicit authority and lifecycle;
- easy removal when knowledge becomes stale.

## Knowledge layers

### Always-on guidance

`AGENTS.md` contains only repository-wide invariants, routing, and recurring
gotchas. Every line consumes attention on every task, so it has the highest bar
for inclusion.

### Canonical foundation

Top-level canonical documents define stable product judgment:

- principles and product scope;
- system and agent boundaries;
- experience character;
- strategic delivery direction.

They explain what must remain true and why. They avoid schemas, endpoint lists,
function signatures, provider configuration, exact parameters, and code
walkthroughs.

### Decisions

An ADR records one consequential choice, the alternatives that mattered, its
consequences, and evidence that would justify reconsideration.

An ADR is historical rationale. Once accepted, its current conclusion should
also be reflected in the relevant canonical document.

### Skills and operational playbooks

Repository Skills live under `.agents/skills/`. A Skill contains a reusable
method that an agent should apply to a recognizable task. Operational documents
contain recurring human or system procedures that do not justify a Skill.

Method belongs here, not in foundational product prose.

### Research and evaluations

Research preserves evidence and uncertainty. Evaluations preserve dated
observations. Both may be detailed because they are loaded only when needed.

The evaluation corpus, historical evaluation evidence, and the evaluation
harness live in the private `getyak/capir-evals` repository; the product keeps
only the [evaluations index](../evals/README.md). Product prose links to
extracted artifacts through their private repository paths and never replaces
removed historical evidence with fabricated stub receipts. New evaluation
output goes to ignored `output/evaluation/` or the private `runs/` directory,
never into tracked documentation.

Neither becomes product truth merely by existing.

### Plans and temporary state

Plans, implementation notes, and task artifacts coordinate active work. They
must be consolidated, archived, or removed when the task ends.

Chat history is not a durable project record.

### Raw intake and compiled wiki

`_index/` preserves repository-safe sources, personal notes, article drafts,
and the editable form of publishable operational knowledge. Raw material does
not become authoritative merely because it is tracked or model-readable.

Reviewed `_index/pages/` sources may compile into concise `docs/` pages. A page
with a `wiki-generated` marker is edited only through its source. The curated
knowledge map remains human-maintained so task routing expresses judgment
rather than a filesystem inventory. See the
[Wiki authoring workflow](wiki-workflow.md) for the operational method.

### Language lifecycle

Language follows the authority boundary instead of being normalized at intake:

- `_index/sources/` preserves the source language and wording whenever rights,
  privacy, and repository safety allow. A translation is labeled and never
  replaces the source record.
- `_index/notes/` and `_index/inbox/` use the language that best preserves the
  author's thinking. Mixed-language working material is acceptable.
- `_index/pages/` is the reviewed publication layer. A page may remain a draft
  in another language, but it must declare `language: en` and have an English
  body before its status becomes `published`.
- Wiki-generated pages in `docs/` are English. Non-English source titles may be
  named when necessary, but the governing prose remains English.

Translation is an editorial step before publication, not a compiler side
effect. The reviewer compares the English page with its source-language
material, preserves claim scope, uncertainty, citations, and authority, and
records any meaning that cannot be translated safely. `pnpm wiki:build` remains
deterministic: it validates and projects reviewed pages but never calls a model
or silently translates content.

### Executable truth

Code, types, schemas, tests, fixtures, generated references, and automated
checks own implementation detail. When prose would merely restate executable
behavior, link to the owning artifact or let the artifact speak for itself.

## Routing a new insight

Ask five questions:

1. Must this affect almost every task? Put only the smallest invariant in
   `AGENTS.md`.
2. Is it a stable product or system judgment? Update one canonical document.
3. Is it a repeatable way of working? Update or create a focused Skill.
4. Is it the rationale for one consequential choice? Write an ADR.
5. Is it temporary, evidentiary, or executable? Use a plan, research,
   evaluation, test, or code.

If none apply, the insight probably does not need to be stored.

## Writing principles

### Write at the decision level

Prefer:

> External effects require a reviewable proposal and independent verification.

Avoid documenting the current request shape, route name, database column, or
vendor-specific call unless the document is explicitly operational.

### Give judgment, not exhaustive rules

Describe the desired boundary and the factors that matter. Use rigid language
only for safety, privacy, authorization, data integrity, or a repeatedly
observed failure.

### Design interfaces, not tutorials

Name a document's purpose, authority, inputs, outputs, and relationships. Do
not fill foundational docs with worked examples that narrow future solutions.

### Use progressive disclosure

Start with the map, load the canonical branch, then load a decision, research
source, Skill reference, or code only when the task requires it.

Do not solve retrieval anxiety by copying the same rule into several files.

### Separate truth from evidence

Canonical docs state the current decision. Research explains the evidence.
ADRs explain why the decision changed. Evaluations show whether reality still
supports it.

### Make uncertainty durable

Label assumptions, open questions, and reconsideration signals. Do not turn a
tentative research inference into a permanent product rule.

## Document shape

Most durable documents should answer:

- Purpose: why this document exists.
- Decision: what is currently true.
- Boundaries: what must not be confused or combined.
- Consequences: what this means for product or system choices.
- Reconsider when: what evidence would justify change.
- Related sources: where deeper evidence or executable truth lives.

Use only the sections that help. A short document is preferable to a complete
template filled with low-value prose.

## Maintenance

When updating documentation:

1. read the knowledge map and the current canonical source;
2. identify whether the new information changes truth, method, evidence, or
   temporary state;
3. update one canonical location;
4. replace duplicated prose with links;
5. remove obsolete detail rather than appending a correction;
6. verify local links and the knowledge contract;
7. record a repeated process failure in a Skill or deterministic check.

Review the system periodically for:

- bloated always-on guidance;
- canonical documents that exceed their conceptual scope;
- duplicate or contradictory claims;
- stale plans and historical implementation notes;
- Skills that no longer trigger or add value;
- prose that should have become a test or tool.

The goal is not more documentation. The goal is less rediscovery.
