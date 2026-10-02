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
directory and file permissions. Each Run contains its immutable scope,
checkpoint, append-only events and outputs, terminal receipt, and either a
draft artifact or `no_action`. Drafts declare `publicationAuthority: "none"`.

Pass `--run-id <uuid>` to resume or replay a Run and `--state-dir <path>` to
choose another local root. A Run ID cannot be reused with a different objective
or authorization. Deleting local state is a local user operation; no backend
copy exists.

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
image bytes and secrets from local state. Live TikHub verification uses the
non-billable liveness and account-envelope endpoints; it does not issue a
profile search merely to test a credential.
