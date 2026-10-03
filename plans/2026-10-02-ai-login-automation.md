# AI acceptance login automation

Outcome: remember the user's capir/CLI preference, reuse valid scoped test
authorization before browser entry, and use `test@gmail.com` as both the
development fixture username and email.

Boundary: named isolated environments only; no OAuth initiation from the
helper, no production auth bypass, no customer-data access or account rename.
The existing password is unchanged. Native macOS capir entry is not supported
by Stage A and must not be inferred from a Web sandbox proof.

Baseline: main `964eb29e`, isolated worktree `codex/ai-login-automation`.
The separate clean capir implementation is locally installed, but not merged
into main. Its shared backend module is deployed; server handoff keys and
registered origins remain unconfigured. This slice does not take ownership of
that pending implementation or alter shared service configuration.

Completed implementation: a grant-preflight command helper, argument/failure
tests, development fixture identifiers, an append-only username constraint
migration, real disposable PostgreSQL proof and CI coverage. Email-shaped
usernames must match the same user's normalized primary email; existing handles
remain valid and public signup retains its handle format.

The global preference is in the user's Codex AGENTS and memory. Operational
guidance belongs in `docs/operations/account-access.md`.

Verified: independent review closes the username-constraint P1 and positional
CLI-argument P2; no new blocking findings. Seven entry tests pass, including the
installed CLI's real parser; nine backend authentication tests, architecture
tests, backend build and docs checks pass. The real PostgreSQL proof verifies
repeat seeding, exact identifiers, normalized login, foreign/malformed alias
rejection, legacy handles, seed guards and own-database cleanup readback.

Remaining gates: current-head PR CI/security and merge. GET-129 keeps its separate
native acceptance gate open. Do not seed the shared TestFlight database or
deploy main over its pending capir runtime.
