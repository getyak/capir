# capri local Agent host

This executable runs public company/market research and separately authorized
screenshot-driven public-profile research on the user's machine. It owns
provider credentials, guarded network access, restartable local state, and
draft artifacts. The standalone commands require no product runtime. The same
host can run as a credential-isolated sidecar that accepts one governed Run
over an owner-only Unix socket; it never calls the backend itself.

## Run

Build and inject the model-provider values from `/shared` plus search and fetch
provider values from `/agent-host`:

```sh
pnpm secrets:check:agent-host
./scripts/infisical/run.sh dev /shared /agent-host -- \
  pnpm agent:research -- \
  --objective "Research Example Company's public market update" \
  --subject company \
  --anchor "Example Company" \
  --allow-domain example.com
```

Use one to five `--anchor` flags to bind every model-generated query to the
authorized company or market subject. Use repeated `--allow-domain` flags for an allowlist. Unrestricted public-web
discovery requires the explicit `--open-web` flag. The host rejects implicit
open-web access and person, candidate, contact-detail, and profile queries.

`fetch_web` sends only an exact same-Run `search_web` result to Firecrawl v2.
Configure `FIRECRAWL_API_KEY` in `/agent-host`; the standalone command still
requires no capri product runtime, while unreliable anonymous access is
rejected at startup. No backend, Web, iOS, prompt, or standalone Run output
receives the credential. The adapter requests main-content
Markdown with PDF parsing, disables provider caching, requests zero data
retention only when the provider account has been enabled for it and
`TALENT_SIGNAL_FIRECRAWL_ZERO_DATA_RETENTION=true`, checks both the provider
response and target-page status, and rejects source substitution. The standalone
`pnpm agent:research` command still runs without a capri product runtime.

Person research is a different definition; it does not weaken that
company/market rule. With the Exa and TikHub values in `/agent-host`, a pinned vision
model in `/shared`, and the remote-sensitive-processing admission enabled, the
caller supplies only one local screenshot:

```sh
pnpm secrets:check:person-research
./scripts/infisical/run.sh dev /shared /agent-host -- \
  pnpm agent:person-research -- --image /absolute/path/to/screenshot.png
```

The model reads visible display-name, handle, profile-URL, or platform clues
and can search LinkedIn, Web, Xiaohongshu, Reddit, Douyin, TikTok, Weibo,
Threads, and Instagram in one bounded call. No
platform or candidate selection is required before the read-only Run. A
photo-only input returns `no_action`: the host does not expose face recognition,
reverse-face search, contact-detail lookup, private-account access, background
checks, candidate scoring, or sensitive-trait inference.

For Relationship Ask ingress, start the bounded local service instead:

```sh
pnpm agent:person-research:serve
```

The service accepts only governed `person-research-service.v1` and
`contact-research-tools.v3` JSON over the configured
absolute Unix socket. The API sends one bound PNG/JPEG/WebP task asset and gets
back a zero-effect receipt plus an unconfirmed draft, `no_action`, or an
unavailable result. The API process never receives `EXA_API_KEY` or `TIKHUB_API_KEY`; Compose
mounts only the socket between the API and Agent Host containers.

The v3 contact-research contract batches at most five same-task Exa source
reads into one contents request and returns one bounded outcome per source.
TikHub profile observations never fall through to Exa; rendered social content
continues through the anonymous isolated-browser boundary.

Select exactly one model provider with `TALENT_SIGNAL_AGENT_PROVIDER` and one
search provider with `TALENT_SIGNAL_AGENT_WEB_SEARCH_PROVIDER`. General research search supports
`brave`, `tavily`, and `exa`; model execution supports `claude`, `openrouter`, and
`zhipu`. Providers never fall back silently.

Screenshot person research uses `EXA_API_KEY`, `TIKHUB_API_KEY`, `TIKHUB_BASE_URL`, and the
separately pinned `TALENT_SIGNAL_AGENT_VISION_MODEL`. It also fails closed
unless `TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING=true`; configuring a vision
model is not provider admission by itself. TikHub has no automatic fallback.

## Local state

State defaults to `~/.talent-signal/agent/runs/<run-id>/` with owner-only
directory (0700) and file (0600) permissions. Each Run contains its immutable
scope (`run.json`), a mutable checkpoint, append-only events and outputs,
terminal receipt, and either a draft artifact or `no_action`. Drafts declare
`publicationAuthority: "none"`.

Immutable records (run, terminal receipt, artifact, and no-action) are written
to complete same-directory temporary files (0600) and published atomically with
a hard link that never replaces an existing record. An equivalent replay keeps
the original artifact or no-action ID and the original `startedAt`/`createdAt`
values, and `startedAt` is excluded from Run identity. A conflicting candidate
or terminal receipt, a corrupt/invalid envelope or ID, a non-regular target, or
an existing record symlink fails closed without overwriting or regenerating
anything. Checkpoints are the only records replaced by atomic rename. Persisted
JSON is read with `O_NOFOLLOW` from a verified regular file; malformed JSON
produces one fixed content-free error, so persisted person/provider payload
never reaches logs or CLI stderr.

Each Run directory also holds `admission.sqlite`, a per-Run coordination
database containing no person, provider, or schema data. One SQLite
`BEGIN IMMEDIATE` transaction is held across the whole command (terminal read
and identity replay, provider construction, and runner execution), admitting at
most one live process per Run: a second invocation of the same Run fails closed
as busy before any model or network call, while different Runs stay
independently executable and the person server's same-process dedup is
unchanged. The busy timeout is zero; SQLite corruption and I/O failures are
never reported as busy or success; the database is never deleted or renamed
while active. Kernel/SQLite locks release when a process dies, so a fresh
invocation reacquires without lock stealing, stale-pid unlinking, or rename
recovery. This coordination uses Node's built-in experimental `node:sqlite`
(requires Node >= 22.19) and the local filesystem: it is single-host
coordination only, not a distributed lock, and immutable file writes alone do
not serialize a Run.

Pass `--run-id <uuid>` to resume or replay a Run and `--state-dir <path>` to
choose another local root. A Run ID cannot be reused with a different objective
or authorization. Completed-terminal replay constructs no providers and makes
no model or network call. Deleting local state is a local user operation; no
backend copy exists.

Tool execution inside one Run is serialized in-process on a small
per-invocation FIFO chain: authorization-counter pre-save, gateway/provider
dispatch, result checkpoint, and journal append run one at a time, so concurrent
provider tool callbacks cannot interleave journal sequences or checkpoint
snapshots. Different Runs stay independent, a fatal journal-write failure
blocks later queued executions, and provider/terminal settlement is recorded
only after all in-flight tool writes drain. The consumed search, fetch, or
profile-call counter is checkpointed before its gateway dispatch: a possibly
dispatched call consumes its allowance conservatively across interruption and
is never refunded or replayed automatically merely because its result is
absent, so a restarted Run reaches the existing cap-denial outcome instead of
issuing a second provider operation. If that pre-dispatch checkpoint write
fails, the dispatch does not run and the Run fails closed. All of this is
explicit local-filesystem state on one host: it does not establish exactly-once
remote effects, distributed locking, or cumulative model billing across power
failure.

Person-research state uses the sibling
`~/.talent-signal/agent/person-runs/<run-id>/` tree. It stores only the image
manifest and content hash, normalized public provider observations,
fingerprints, checkpoints, receipts, and an unconfirmed draft or `no_action`.
Raw screenshot bytes and credentials are not persisted. Drafts declare
`identityAuthority: "unconfirmed"`, `publicationAuthority: "none"`, and
`externalEffectAuthority: "none"`.

## Verify

```sh
pnpm agent:check
```

The deterministic suite verifies same-Run search/Firecrawl fetch handles, restart
checkpoints, local draft creation, idempotent terminal replay, provider
normalization, query privacy, budgets, claim-level citations, DNS/IP rejection,
provider/target status, source readback, cancellation, and byte/content limits
without using live vendor credentials. The isolated-browser resource broker
retains its separate direct-fetch redirect and robots checks.

The same suite covers autonomous platform-tool selection, photo-only
abstention, hostile screenshot instructions, immutable image manifests,
same-Run profile citations, owner-only files, replay drift, and absence of raw
image bytes and secrets from local state. Real forked processes on freshly
built host modules prove one-winner immutable publishing for conflicting starts
and terminal receipts, duplicate artifact/no-action convergence on one
persisted ID, fixed content-free malformed-record failures, and per-Run
admission: busy rejection before any provider call, independent Runs, release
on callback error and on process death, and provider-once command concurrency.
Live TikHub verification uses the non-billable liveness and account-envelope
endpoints; it does not issue a profile search merely to test a credential.
