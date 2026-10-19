# Publish reviewed local work

## Outcome and boundary

Publish useful unpublished source through focused pull requests after auditing
all linked worktrees, local branches, existing pull requests and remote main.
Keep the primary checkout byte-identical. Do not merge, reset, clean, or replay
already-integrated historical work. The product repository is public; raw
operational evidence and private evaluation material stay outside it.

## Decisions

- Snapshot the current verified contact-intake source onto fresh main, excluding
  private operational plan history. Preserve the original release branch.
- Keep dependency-cache preparation in a separate build pull request.
- Existing Memory tool-contract work has its own open pull request; do not
  publish the larger integration candidate as a duplicate.
- Exclude the old People CSS override, broad test-directory ignore, duplicate
  Opik ADR and superseded design drafts.
- Classify remaining research, design assets and evaluation material against
  their current owners before publishing anything.

## Milestones

1. Done: capture file hashes and audit all worktrees, branches and pull requests.
2. Done: sanitized source snapshots, relevant checks and independent review.
   Added owned-handle/mixed-source regressions and removed the inert namesake
   confirmation control; a stale database assertion now checks the actual card hint.
3. Active: push reviewed branches, create or update pull requests and verify
   their remote heads; prove the primary file hashes remain unchanged.

## Verification

Check contact-only and historical-image drafts, no-action/lookup refusals,
private identity boundaries, streaming/final answer and title handling. Run
Agent and Web tests, backend regressions, types and documentation gates.
Existing deployed behavior has separate live proof; publication alone does not
claim a new deployment or authorize any production configuration change.

## Source verification

Fresh checks: Agent 586 passed (16 explicit skips), Web 2556 passed, relevant
backend unit checks 188 passed, added source checks 32 passed, affected Web
checks 50 passed, and both database integration suites 163 passed against an
isolated PostgreSQL 17 instance. Types, lint, production builds and docs/Wiki/
architecture checks passed. The database suite uses a bounded 20-second
operation budget on the forwarded local container transport. No live provider
or real account data is used by these deterministic checks.

Independent source, test, maintainability and adversarial reviews completed.
The host deliberately retains earlier authored context; deterministic short
contact prose is limited to unsolicited image-only intake. Private inspection
admission, existing identity authority and manual Save remain separate gates.
