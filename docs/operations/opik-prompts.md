# Bundled prompts and Opik versions

The repository is the authoritative source for formal prompts. Each prompt is
an editable TypeScript file in `apps/agent/src/prompts/`; the catalogue in
`apps/agent/src/prompts.ts` gives its stable name and source path. Builds package
the text with the application. The local loader captures immutable snapshots
without a network request, environment lookup, refresh timer or runtime fallback.

Opik is the version mirror and experiment workspace. Its publications do not
change running services. This supersedes the earlier dynamic registry design;
see [the decision](../decisions/0013-bundle-prompts-with-code.md).

For private runtime observation, feedback-driven comparisons and delegated
candidate releases, use the [phase-one playbook](opik-phase-one.md). Those
explicit controller settings are separate from the prompt-mirroring commands.

## Edit, compare and release

1. Edit the relevant source file, or import an explicitly selected Opik draft.
2. Review the source diff and test the affected Agent behavior.
3. Run `pnpm prompts:sync` to mirror source versions and their content hashes.
4. Build and deploy the application. For the local TestFlight backend, run
   `./scripts/deploy/testflight-local.sh`.
5. Roll back through the matching source/application release. Changing an Opik
   environment label alone does not roll back running code.

Opik synchronization is explicit tooling, outside application startup and model
requests. An unavailable Opik leaves application builds and execution independent.
Existing tasks and Lab experiments retain the snapshot captured when they started,
including historical Opik snapshots. New tasks use the installed local text.

## Source map

| Name | Source under `apps/agent/src/prompts/` |
| --- | --- |
| `assistant/workspace` | `assistant-workspace.ts` |
| `assistant/relationship` | `assistant-relationship.ts` |
| `assistant/conversation` | `assistant-conversation.ts` |
| `capture/contact` | `capture-contact.ts` |
| `capture/transcription` | `capture-transcription.ts` |
| `capture/screenshot` | `capture-screenshot.ts` |
| `capture/screenshot-preprocess` | `capture-screenshot-preprocess.ts` |
| `capture/text` | `capture-text.ts` |
| `pursuit/proposal` | `pursuit-proposal.ts` |
| `research/company` | `research-company.ts` |
| `research/person` | `research-person.ts` |

Tool descriptions, terminal protocols and schemas remain with their implementations.
Native offline Foundation Models prompts continue to ship with iOS. Moving text
between the repository and Opik does not change a model's authority or tool access.

## Opik and CLI

Open [the local library](http://localhost:5173/default/projects/01a074d8-f6b1-729e-ab38-c0c933af27de/prompts)
in project `talent-signal-prompts`, workspace `default`. Edit and **Create new
version** to prepare a draft. Import the exact visible version number:

```sh
pnpm prompts:import assistant/workspace v3
```

Replace `v3` with the selected version. Import changes only that registered source
file; it escapes text as a string literal, preserves the exact content and refuses
an incompatible template or a file changed during download. It does not build the
imported change, deploy it, or overwrite other source files. Review the printed
path and diff, then follow the release steps above. The wrapper builds the current
catalogue before import; a subsequent build is necessary to package the draft.

```sh
pnpm prompts:sync
pnpm prompts:status
node scripts/prompts/opik.mjs sync /absolute/path/prompt-versions.json
node scripts/prompts/opik.mjs export /absolute/path/prompts-backup.json
```

The `pnpm` wrappers build the catalogue first. Direct Node commands require an
up-to-date Agent build. Text is read from current source files, avoiding stale
compiled text in a mirror. `status` compares source to the `repository` label and
fails on missing/different versions. `sync` creates that label if needed, mirrors
changed text, and verifies the result. It never promotes a draft into application
execution. Existing labels on a reused version are preserved.

Receipts associate source paths and SHA-256 hashes with Opik version IDs, the Git
commit and whether the worktree was dirty. The hash identifies actual content;
a dirty checkout is not represented as a clean reproducible commit. `export`
backs up current local text without contacting Opik. Git remains the source history.

CLI settings are `TALENT_SIGNAL_PROMPT_REGISTRY_URL` (default local API),
`TALENT_SIGNAL_PROMPT_PROJECT`, `OPIK_WORKSPACE` and optional `OPIK_API_KEY`.
Existing Infisical `/shared` values support this developer tooling. Application
containers receive no prompt-registry settings. The internal TestFlight API
joins the private Opik network only for source-bound runtime observation.
Legacy registry settings in a host shell cannot enable remote runtime loading.

## Local service

Start the persistent instance with `./scripts/prompts/start-opik.sh`. Its pinned
images and named volumes preserve the library. Stop with
`docker compose -f deploy/opik/compose.json stop`; preserve volumes to retain
history. The UI binds to Mac loopback on port 5173.

The one-shot bucket initializer uses the `mc` binary bundled in the same
pinned MinIO server image as the storage service. This avoids a separate
client-image pull while preserving the existing idempotent bucket setup and
policy. Initialization must still exit successfully before the backend starts.
Use a clean deployment checkout with VM-readable bind mounts as described in
[the local backend runbook](testflight-local-backend.md).

The installation provides Prompt Library and the core UI/API. Python evaluation
workers and Playground model connections remain unconfigured. No application
model key or private conversation is copied into Opik by these prompt commands.
Only prompt configuration, source identifiers and version metadata are synced.

Compose and supporting files are adapted from the official
[Opik repository](https://github.com/comet-ml/opik/tree/main/deployment/docker-compose).
See [verification evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-opik-prompts/bundled-runtime.md).
