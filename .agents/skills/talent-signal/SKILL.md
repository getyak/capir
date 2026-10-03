---
name: talent-signal-conventions
description: Follow capri repository conventions for implementation, testing, documentation, and review. Use when changing this repository; its existing directory and package identifiers remain compatibility contracts.
---

# capri development conventions

## Load the relevant owners

Start with `../../../AGENTS.md` and `../../../docs/README.md`, then read only the
canonical branch needed by the task. Use `../../../PLANS.md` for substantial
work and `../../../REVIEW.md` for outcome verification.

Read the package manifest, adjacent implementation, and relevant tests before
choosing commands or conventions. Root scripts and package configuration own
current executable behavior; an old generated two-commit style sample does not.

## Product boundaries

Read `../../../docs/product.md` for current personal-Agent scope. A screenshot
is purpose-bound intake, not confirmation of every extracted field. Person,
Memory, continuing work, and an Agent execution state have different owners.
Use recruiting language only for actual recruiting work.

Preserve identity, evidence provenance, time, authorization, and recovery. A
model answer or saved page cannot authorize an external effect. Do not log raw
conversations, screenshots, credentials, or unbounded provider errors.

## Work and verification

- Preserve unrelated changes and isolate concurrent write work.
- Use patterns and commands from the affected package rather than imposing one
  universal filename, alias, framework, or logging convention.
- Run the narrowest relevant checks and the required repository gates.
- Verify changed persistence through the destination and reload; a receipt or
  helper test alone is insufficient.
- Run `pnpm docs:check` for documentation; edit generated Wiki pages through
  their `_index/` source.
- Use the documented native test session and storage guard only when native
  boundaries require testing.
- Keep display branding separate from package, database, Bundle ID, keychain,
  extension, and update-channel identities.

Commit descriptions explain the concrete user outcome and its verification.
Durable learning belongs in its authoritative document or focused method rather
than another copy of repository-wide instructions.
