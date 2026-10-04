# capri

Build a quiet, evidence-first personal Agent for important people and unfinished
work in conversations. Support client work, partnerships, collaboration, and
recruiting. Optimize for trustworthy momentum,
not feature volume or agent theater.

## Start with context

Read [`docs/README.md`](docs/README.md) and follow its task-based routing. Do not
front-load the repository or ask the user to repeat context it already owns.

For substantial or uncertain work, use [`PLANS.md`](PLANS.md). Review completed
work through [`REVIEW.md`](REVIEW.md).

## Non-negotiable boundaries

- Treat personal conversations and screenshots as sensitive, purpose-bound
  evidence.
- Keep evidence, confirmed state, interpretation, action, and observed outcome
  distinct.
- Require a human decision before consequential external writes; generated
  pages, summaries, memories, and proposals carry no execution authority.
- Preserve identity, provenance, time, authorization scope, and reversibility.
- Rank work attention, never a person's worth, personality, protected traits,
  culture fit, or acceptance probability.

## Code Review Rules

- Flag any path that promotes interpretation to confirmed state, ranks a
  person, or triggers an external action without message-level evidence,
  provenance, and explicit human authorization.
- Flag any person-data path that broadens collection, retention, model
  exposure, or logging beyond the stated purpose, especially when raw
  conversations or screenshots can escape their authorized boundary.
- Flag state transitions, retries, merges, or deletion flows that can lose
  identity, time, idempotency, reversibility, or the evidence required to audit
  the resulting state.

## Work to proof

1. Define one outcome, its boundary, and observable completion evidence.
2. Inspect existing state, expose important unknowns, and preserve unrelated
   user changes.
3. Deliver the smallest complete slice that can test the direction.
4. Verify the state that matters from the real surface; an edit, build, model
   response, or connector call is not proof by itself.
5. Re-plan when evidence invalidates the approach, then route durable learning
   before handoff.

## AI product acceptance

For AI product acceptance, inspect `capir help test create`, then use
`capir test create --env <test-env> --preset daily --open web`. Reuse the
returned run/request ID; credentials belong only to that expiring test
account. Retain sanitized evidence, then verify `capir test stop` cleanup.
[Account and workspace access](docs/operations/account-access.md) owns the
full provisioning and test-command procedures.

Prefer the narrowest relevant checks. For documentation changes, also run
`pnpm docs:check`. Test ambiguity, no-action, failure, stale state, retry,
recovery, and deletion when they are relevant to the outcome.

## Keep knowledge lean

- Keep canonical repository documentation in English.
- Maintain one authoritative home per claim. Put stable judgment in canonical
  docs, rationale in an ADR, reusable method in `.agents/skills/`, active state
  in a plan, and deterministic behavior in code or tests.
- Capture new human or LLM-authored articles in `_index/`; never hand-edit a
  `wiki-generated` page.
- Use `$project-knowledge-steward` after a repeated or consequential correction
  to encode the narrowest durable prevention and remove superseded guidance.

Follow [`docs/documentation.md`](docs/documentation.md). Do not expand this
always-on file for one ambiguous incident.

## Isolate concurrent work

- Keep resumable progress in plans and inspectable artifacts, not only in chat.
- Isolate independent write work with worktrees or non-overlapping ownership.
- Keep one owner for each source or external state and one owner for synthesis
  and final verification.
- More time or agents does not broaden authorization, evidence access, or the
  definition of done.
