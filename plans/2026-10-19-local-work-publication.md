# Publish reviewed local work

Status: complete.

## Outcome and boundary

Publish useful unpublished source through focused pull requests after auditing
all linked worktrees, local branches, existing pull requests and remote main.
Keep the primary checkout byte-identical. Do not merge pull requests, reset, clean, or replay
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
3. Done: pushed reviewed branches, created pull requests and verified
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

## Publication and resident readback

- Product pull requests: #386 (prepared dependency caches) and #387 (contact
  intake and source authority); private design-history pull request: capir-evals
  #21. All remote heads were read back. Existing Memory tool work stays in #385.
- All 427 primary-checkout files match the original protected hashes. Historical
  runtime branches were reconciled against merged paths instead of replayed.
- The private archive preserves 171 original files plus an index and digest
  manifest. Existing archive files and the maintained Studio were unchanged;
  root checks passed with 164 core and 397 Studio tests (two explicit skips).
- Real-browser synthetic component inspection found misleading required-identity
  and failed-lookup copy after the logic gates were removed. The hints now state
  that matching is optional. A visible namesake leaves creation enabled with
  only a name, no relationship/source and no inert checkbox.
- Security review removed an optional-Session condition from historical-source
  authority selection. Historical sources always resolve persistent authority;
  a missing Session gets empty authority. Authored-current/steering compatibility
  and all identity/source protections remain. The final focused unit checks
  passed 144 tests and both PostgreSQL integration suites passed 163 tests.
- M4 resident Web is clean source 20c0d64a. API and Agent Host are clean
  integration source 6c7e5a88, combining only the two product pull requests.
  Web, Agent, shared packages and Web-deployment inputs were unchanged by the
  backend-only authority correction, so the verified Web artifact was reused.
  The backend image/revision recovery pair and source pointer were read back.
- Deployment verified actual Linux arm64 SDK execution, HTTPS/authentication,
  healthy resident services and container-to-Opik synthetic write/read/delete.
  No Opik scope or retention policy changed. This is separate from the earlier
  model-driven card/Save/reload acceptance; no new production-owner conversation
  was used in this publication audit.
- Owned synthetic databases, local fixture server/browser and temporary
  deployment jobs were removed. Detailed sanitized receipts stay in ignored
  task output; no private operational history was pushed to the public repo.

No pull request was merged. Current remote CI and review state remain visible
in each pull request; source checks and deployment readback are distinct from
merge approval.
