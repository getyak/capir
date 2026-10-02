---
name: project-knowledge-steward
description: Maintain capri's project knowledge system by routing durable learning to AGENTS.md, canonical docs, ADRs, Skills, plans, research, tests, or code while removing duplication and stale implementation detail. Use when updating or reorganizing repository documentation, capturing a retrospective or repeated correction, deciding where new project knowledge belongs, pruning agent context, or improving long-running Codex workflows.
---

# Project Knowledge Steward

Keep future agents effective without turning the repository into an instruction
dump. Preserve one canonical home for each durable claim and use the narrowest
surface that can retrieve or enforce it.

## Read first

Read:

- `docs/README.md`
- `docs/documentation.md`
- the canonical document currently owning the topic

Read `_index/README.md` when capturing a new article, raw source, personal note,
or LLM-authored draft, or when changing a `wiki-generated` page.

Read `docs/codex-work-system.md` when the request concerns Agent effectiveness,
continuity, planning, memory, worktrees, verification, or recurring work.

## Classify the learning

Classify each candidate insight before editing:

- Always-on invariant or repeated consequential gotcha: `AGENTS.md`.
- Stable product, architecture, agent, experience, or delivery judgment:
  exactly one canonical document.
- Rationale for one consequential choice: an ADR.
- Repeatable task method: a focused Skill.
- Active multi-step state: a plan.
- External evidence or dated finding: research or evaluation.
- Deterministic behavior: code, schema, test, lint rule, or script.
- Personal preference or helpful recall: memory, never required policy.

If the insight does not improve a future decision or verification loop, do not
store it.

## Maintain the system

1. Search for existing statements and contradictions.
2. Identify the single authoritative destination.
3. Update the decision, not the chronology of how it was discovered.
4. Replace duplicate explanations with links.
5. Remove stale implementation detail from foundational docs.
6. Preserve uncertainty and reconsideration signals.
7. Run the documentation checks and inspect the diff.

New standalone knowledge articles start in `_index/inbox/`. Repository-safe
evidence belongs in `_index/sources/`, and unresolved personal synthesis belongs
in `_index/notes/`. Promote reviewed operational articles to `_index/pages/`
and compile them with `pnpm wiki:build`. Existing human-maintained canonical
documents remain edited in place unless an explicit migration makes their
source ownership clear.

Never hand-edit a page with a `wiki-generated` marker. Use wiki links in the
source when the relationship is durable; compilation emits portable Markdown
links and backlinks. After an `_index/` change, run `pnpm wiki:test` and
`pnpm docs:check`.

Prefer editing an existing surface over creating a new file. Create a new
document only when it answers a distinct recurring question with clear
authority.

## Keep the right degree of detail

Foundational docs state purpose, decision, boundary, consequence, and
reconsideration signals. Remove endpoint inventories, function signatures,
configuration snapshots, implementation walkthroughs, and current vendor
parameters.

Research and operational artifacts may carry detail when selective retrieval or
execution requires it. Do not copy that detail back into always-on context.

Use judgment rather than adding exhaustive special-case rules. Encode rigid
constraints only when safety, privacy, authorization, data integrity, or
repeated evidence justifies them.

## Compound a correction

When a user correction or failed review reveals a repeated issue:

1. fix the immediate instance;
2. identify the failure class;
3. choose the least expensive durable prevention;
4. add a counterexample or verification where practical;
5. confirm the new guidance does not create noise in unrelated work;
6. remove superseded guidance.

Do not add a broad rule after one ambiguous event. Prefer an ADR, test, or
temporary note until the pattern is clear.

## Finish

Report:

- which knowledge changed;
- why that surface is authoritative;
- which duplication or stale detail was removed;
- how the change was verified;
- what intentionally remains temporary or uncertain.
