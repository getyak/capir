# Contributing

## Development checks

Install the toolchain declared by the repository, then run:

```bash
pnpm install --frozen-lockfile
pnpm wiki:build
pnpm wiki:test
pnpm check
```

`pnpm wiki:build` must produce no uncommitted generated changes after the
source and compiled wiki are committed. Install the local push gate once with
`pnpm hooks:install`; CI runs the same read-only wiki check.

When changing the product or system architecture diagrams, regenerate the
editable scenes and rendered assets, then run the structural check:

```bash
pnpm architecture:generate
pnpm architecture:check
```

`pnpm architecture:generate` composes both diagram generators (product/system
and Agent families); `pnpm architecture:agent-generate` runs only the Agent
generator.

Commit the `.excalidraw`, `.svg`, and `.png` outputs together.

For iOS changes, also run:

```bash
./scripts/ios/check.sh
```

Validate CI policy locally with:

```bash
./scripts/ci/check-actions-pinned.sh
./scripts/ci/check-secrets.sh
./scripts/ci/install-actionlint.sh /tmp/talent-signal-bin
/tmp/talent-signal-bin/actionlint
```

## Pull requests

Keep a pull request focused on one outcome. Describe the product impact, the
evidence and safety implications, and the checks you ran. Never add real
candidate data, access tokens, signing certificates, or private conversation
content to source, fixtures, screenshots, logs, or artifacts.

Batch locally verified fixes before pushing. Run the narrow deterministic
scripts for the changed surface, use `pnpm check` when the change crosses
several runtime boundaries, and run `./scripts/ios/check.sh` for iOS changes so
one push carries a coherent change set instead of speculative pushes.

After pushing, wait for the required checks with the bounded command instead of
polling repeatedly by hand:

```bash
./scripts/ci/wait-for-required-checks.sh [PR_NUMBER] [TIMEOUT_SECONDS]
```

It reads only `gh pr checks` for the stable `CI required` and `Security
required` contexts, fails clearly on a failed check or a timeout, and never
mutates the repository, the pull request, or any check. Inspect a failure's
logs once with `gh pr checks <PR>` and `gh run view <RUN_ID> --log-failed`.

Documentation-only changes skip the Web, Backend, Phase one, macOS Hybrid, and
JS/Actions CodeQL jobs. Unrelated runtime changes also skip macOS Hybrid unless
its app, shared UI, tooling, or dependency inputs changed. Repository policy,
docs, and secret-hygiene gates always run. Never weaken or disable a required
gate to make a change pass.

First-pass pull-request review follows the canonical
[User-directed model review](docs/operations/ci-cd.md#user-directed-model-review)
procedure: one user-directed local MiMo review on the stable current head,
inspected before it is published as a scoped comment. Independent Codex
judgment stays mandatory for security, migration, and architecture issues, and
a model comment is never a required approval or a CI success.

New knowledge articles begin in `_index/inbox/`, and reviewed source pages live
in `_index/pages/`. Generated `docs/` pages must be changed through their
source and compiler.

The `main` branch requires the stable `CI required` and `Security required`
checks. iOS TestFlight publication is a separate protected deployment and is
not performed by pull-request code.
