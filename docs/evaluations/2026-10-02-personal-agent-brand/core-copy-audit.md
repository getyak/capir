# Core copy audit — 2026-10-02

## Outcome and boundary

Generic account, relationship, Wiki, identity review, and operational Agent copy
must not assume that the authenticated user is a recruiter. The user-visible
display brand is `capri`, following the user's latest explicit instruction. This slice changes
copy only; it does not implement a new screenshot pipeline or continuing-work
state machine.

Ownership: `apps/agent`, `apps/agent-host`, `apps/backend/src/modules`, and
`packages`, excluding `packages/workspace-ui`. Other contributors own clients,
marketing, canonical documentation, external updates, and final integration.

## Changed surfaces

- Verification emails, sign-in conflict messages, new unnamed Apple/Google user
  display fallbacks, Lab status, time coverage, source rights, Chat image-handling
  notices, and MCP instructions use capri. OpenRouter receives the new display
  title; its request schema, keys, referer, and authorization are unchanged.
  Existing saved user names are not rewritten.
- Agent Host README and contract comments use capri while preserving executable
  package names, environment variables, paths, and protocol identifiers.
- Formal Pursuit proposal and text extraction prompts address the user while
  retaining exact quotes, speaker uncertainty, no-action, and human-review rules.
- Generic time review describes the user's own activity metadata.
- Wiki projections label personal notes as Personal note and keep their author
  distinct from the other person's testimony. Document and public-page claims
  still require review and confirmation; dependencies remain source-linked.
- Relationship Agent History uses Review note, Decision basis, human override,
  and user follow-up. Historical reasons are interpolated verbatim, not rewritten.
- Generic identity and source validation messages address human review or the
  user. Their actual guards, actor types, timestamps, and state changes are intact.
- Operational gap/action proposals and task briefs describe the person and
  user-owned work. They retain duplicate prevention, evidence scope, no-action,
  and exact human-review authority.
- Public research authorization and Chat context explain the user's explicit
  bounded objective. MCP workspace metadata does not claim to include private
  person or relationship evidence.

## Deliberate compatibility and safety exclusions

| Retained item | Reason |
| --- | --- |
| `actor_kind: recruiter`, role/speaker literals, action owner literals | Executable compatibility contracts; a copy change must not migrate persisted ownership or attribution. |
| `recruiter_task`, `requires_recruiter_decision`, `recruiter_reviewability`, source authorization event values | Wire keys and audit/state contracts; consumers and persisted data depend on them. |
| `TalentSignalClient`, `TalentSignalHttpError`, package/import names, CLI binary and provider model identifiers | Technical/public integration identifiers, beyond display-copy scope. |
| Existing `capir` CLI, MCP `serverInfo.name`, network domains and environment names | Public or persisted compatibility identities; no aliases or new interfaces were introduced. |
| Research/local-Agent HTTP User-Agent headers | Remote integration identity; changing them is not necessary to change human-visible branding. |
| Screenshot transcription role prohibitions and candidate-quality/hiring-inference prohibitions | These reject unsafe inferred roles or assessments; replacing them would weaken a real recruiting boundary. |
| Recruiting synthetic fixtures, quotations, and the deterministic recruiting E2E branch | Purpose-specific inputs and historical utterances are not generic product positioning. |
| Already compiled Wiki snapshots and existing saved profile names | Stored historical state is not rewritten by source-copy edits; current compilation uses the new labels. |

No SQL, schemas, API/tool names, actor kinds, ownership, crypto, retention,
authorization, network policy, runtime transitions, or publication capability
were changed.

## Verification

- Storage audit: 71 GiB free against an 80 GiB threshold; 3 allowed simulators,
  none outside the allowlist. No simulator, Docker stack, or unrelated artifact
  was created, started, stopped, or deleted by this slice.
- Small host-only TypeScript builds: contracts, Agent, and evaluation passed.
- Agent focused tests: prompt registry and workspace prompt suites, 10 passed.
- Backend first attempt: no tests executed because fresh worktree package `dist`
  entry points were missing. Built the required packages before retrying.
- Backend focused retry: 69 of 70 passed; one Agent History expectation still
  asserted the old override caption. Updated that expected caption; all 6 Agent History tests passed on the focused
  rerun. Across the final affected suites, all 70 backend tests passed.
- After the capri display-brand changes: 7 affected backend suites / 79 tests
  passed, plus 7 OpenRouter provider tests passed. These runs overlap the earlier
  suites and are not additive counts.
- Backend `tsc6 -p tsconfig.json --noEmit`: passed both before and after the
  final display-brand edit.
- `pnpm docs:check`: passed (documentation, Wiki, architecture boundaries and
  diagram checks).
- Owned diff whitespace check: passed.

Backend `AGENTS.md` also requires `./scripts/deploy/testflight-local.sh` after
backend edits. This audit is host-unit/source evidence, not installed-iOS or
production evidence. The integration owner must coordinate the final deploy,
readback, and external delivery; the shared local backend was not redeployed by
this worker.
