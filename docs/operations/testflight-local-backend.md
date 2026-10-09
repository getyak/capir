# Internal TestFlight backend on Tailscale

## Purpose

Run the account-scoped iOS backend on an operator-owned Mac for owner-only or
small, explicitly authorized internal TestFlight testing. Tailscale Serve
terminates HTTPS and forwards only to the API on Mac loopback. PostgreSQL stays
inside the Docker network and has no host or tailnet port.

This topology is an internal release bridge, not the production backend
decision. It requires the Mac, Docker, the API containers, and Tailscale to stay
online. Every testing iPhone must run Tailscale and join the authorized tailnet.
Use the public production topology before external TestFlight or App Store use.

## Configure

Create the backend names from `deploy/testflight/environment.example` under
`staging:/backend` in Infisical and the Relationship Ask and recruiter-
dictation names from the same example under `staging:/shared`. Put the TikHub
credential and base URL only under `staging:/agent-host`. Give staging a
provider credential authorized for this environment. The Zhipu configuration
in the example remains supported; the Claude Harness uses the settings below. Keep
`TALENT_SIGNAL_ALLOW_REMOTE_CHAT_PROCESSING=false` until the selected credential exists and
the operator intends to admit the documented minimized context. Replace the
PostgreSQL value, and set
`TALENT_SIGNAL_API_BASE_URL` and `ALLOWED_ORIGINS` to this Mac's exact Tailscale
MagicDNS HTTPS origin. Generate a URL-safe PostgreSQL password such as
`openssl rand -hex 24`. Authenticate the operator with `infisical login`; the
deployment script injects the values only into its child process.

For the Claude Agent SDK, set both `TALENT_SIGNAL_AGENT_PROVIDER` and
`TALENT_SIGNAL_CHAT_PROVIDER` to `claude`. Pin `TALENT_SIGNAL_AGENT_MODEL`;
that shared Harness model governs chat as well. Set `TALENT_SIGNAL_CHAT_MODEL`
to the same value for operator clarity. `ANTHROPIC_BASE_URL` must match the
server's admitted endpoint list in
[`claudeHarnessConfiguration.ts`](../../apps/agent/src/claudeHarnessConfiguration.ts).
Hao requires its dedicated `HAO_ANTHROPIC_API_KEY`; another gateway's ambient
`ANTHROPIC_API_KEY` is never reused. Other admitted Anthropic endpoints require
exactly one of `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`. Credentials stay in
`staging:/shared`, never in clients or repository files.

The GET-9 Hao probe uses `https://api.hao.ai/anthropic` and
`anthropic/claude-sonnet-5`, with `TALENT_SIGNAL_CLAUDE_TASK_BUDGET_ENABLED=false`
for gateway compatibility. Host time, tool, token and cost limits still apply.
There is no automatic provider fallback. An operator can explicitly set
`TALENT_SIGNAL_CLAUDE_HTTPS_PROXY` to an HTTP(S) proxy URL when the deployment
network requires it. Credentials, path, query and fragment are rejected; ambient
proxy, bypass and TLS-override variables remain excluded from the SDK process.
The transport is frozen with configuration and fingerprinted for Session reuse;
diagnostics record only direct/proxy mode. This adds the selected proxy to the
transport trust boundary. Verify it with synthetic traffic before admitting
private data; a loopback proxy can still forward traffic remotely.
 The deployment validator and synthetic
probe must pass for the selected runtime; configuration alone is not proof.
See [GET-9 acceptance evidence](https://github.com/getyak/capir-evals/blob/main/evidence/get9-harness/README.md) for actual
model receipts and the still-open native reliability gate.

The TestFlight Compose boundary differs from synthetic development:

- simulated authentication is always disabled;
- Sign in with Apple is enabled for `com.talentsignal.app`;
- no synthetic seed runs;
- PostgreSQL is internal-only;
- the API publishes only on `127.0.0.1`;
- the API has explicit runtime DNS for Apple public-key verification;
- Relationship Ask has its own remote-processing gate, fixed provider/model,
  server-owned endpoint allowlist, server-only key, and synthetic provider probe;
- screenshot public-profile research has a separate disabled-by-default gate,
  a credential-isolated Agent Host sidecar, an owner-only Unix socket, bounded
  TikHub tools, and no identity or effect authority; the authenticated API's
  `/v1/person-research/tasks` route accepts one bounded base64 image, redacts it
  from logs, verifies its hash/size, and retains only the zero-retention
  receipt and normalized result;
- workspace conversation public research has its own explicit
  `TALENT_SIGNAL_WORKSPACE_PUBLIC_RESEARCH_ENABLED` flag in `staging:/backend`.
  It defaults to false. Enabling it passes the gate into the API container;
  public search credentials remain in the existing Agent Host sidecar. When
  enabled, first-contact proposals trigger host-owned bounded search and fetch,
  independent of the model calling tools. Queries use the observed name and
  admitted public context; genuine completions appear in the Session Tools
  record. Both the flag and socket are required. Missing configuration or
  provider failures produce an explicit research status, never invented context;
- recruiter dictation has its own admission gate and server-only provider
  credential boundary;
- Docker logs rotate locally.

Before starting, configure the owner-scoped private observation policy described
in [Product runs and feedback](product-feedback.md#internal-testing-delivery-default).
It is a required part of internal product testing, including a durable outbox
and a container-to-Opik write/read/delete probe.

## Start and verify

With Tailscale connected and Docker running:

```bash
./scripts/deploy/testflight-local.sh
```

The script validates that the configured URL exactly matches the Mac's current
MagicDNS hostname, builds the shared API/Agent Host image, starts PostgreSQL,
applies migrations, starts the API and Agent Host sidecar, configures Tailscale
Serve, and verifies the Apple authentication
challenge through HTTPS. Before reporting success, it also requires the API
container to retrieve a non-empty Apple public-key set; this catches a Docker
or Colima DNS failure that local database health checks cannot detect. It stops
before GitHub or TestFlight configuration if any boundary fails. The deployment
also sends one synthetic silent WAV from inside the API container to the real
ASR provider. An accepted no-speech response proves credentials, entitlement,
DNS, and provider reachability without sending candidate or recruiter speech.
When Relationship Ask is admitted, the deployment also sends one clearly
synthetic relationship block and question to the selected provider. It requires a typed,
evidence-cited response before the runtime is reported ready; the probe prints
only provider/model and token counts. When the gate is explicitly disabled,
the probe records a safe skip and the existing deterministic Ask path remains
available.

GitHub Actions remains scoped to `staging:/release`. It receives the HTTPS
origin, signing material, App Store Connect credentials, and an ephemeral
Tailscale CI identity, but never reads the backend database or provider
credentials. No deployment path exports Infisical values to a persistent
`.env` file.

For an ordinary restart with an already verified local image, skip the network
build without changing the runtime boundary:

```bash
TS_TESTFLIGHT_REBUILD=false \
  ./scripts/deploy/testflight-local.sh
```

Rebuild after backend or contract code changes.

Only after that probe succeeds, store the same HTTPS URL as
`staging:/release/TALENT_SIGNAL_API_BASE_URL`. It is a build-time value, but the
endpoint remains tailnet-only.

GitHub-hosted runners are not tailnet members by default. Create a dedicated
Tailscale OAuth trust credential with only `Devices > Core > Write` and
`Keys > Auth Keys > Write`, restricted to an admin-owned `tag:ci`. Store its
client ID and secret as `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET` under
`staging:/release`. The release workflow joins each runner as an ephemeral
`tag:ci` node, proves tailnet reachability, probes the Apple authentication
contract, and logs out the node when the job finishes. Never store those values
in repository variables, files, or logs.

Changing backend code does not require a new iOS archive while the origin and
API contract remain compatible. Changing the origin requires a new archive.

## Resident Web and coordinated updates

The resident Web uses a production build on `127.0.0.1:3000`, exposed through
Tailscale Serve at `https://<Mac-MagicDNS-name>:10443`. This is a private
tailnet endpoint, not a physical-LAN address or public Funnel. Browser requests
use Web session authentication; only the Web server talks to the loopback API
at `http://127.0.0.1:4317`. Keep developer and fixture servers separate.

Configure `staging:/web` in Infisical with a stable `AUTH_SECRET`,
`AUTH_URL=https://<Mac-MagicDNS-name>:10443`, `AUTH_TRUST_HOST=true`,
`TALENT_SIGNAL_BACKEND_URL=http://127.0.0.1:4317`,
`TALENT_SIGNAL_ALLOW_LAN_HTTP=false`, and enabled password authentication/registration. The resident
launcher disables default-account quick login and explicitly enables
`TALENT_SIGNAL_INTEGRATION_MODE=true`. Despite its name, that flag selects the
real authenticated backend workspace; `false` selects the legacy synthetic
demo. Verify a protected business page after login, not just the login response.
Never write credentials into a LaunchAgent or source checkout.

Before each host production build, apply the local storage guard. Check actual
free bytes again after dependency preparation; a printed audit warning is not
a gate and an unrelated log warning must not be mistaken for sufficient space.
When local policy requires 30 GiB, stop below that threshold. Do not chain an
unchecked audit and build. Follow the global artifact-cleanup policy: independently
verify that a task is complete and its output is reproducible before removing
registered artifacts, including completed work from other projects. Preserve
formal evidence, source, active tasks, databases, and live and immediate rollback
releases. Ask only when those safeguards cannot be established.

Build each approved revision in a clean detached worktree under
`~/Library/Application Support/Talent Signal/web/releases/<revision>`:

```sh
pnpm install --frozen-lockfile
./scripts/deploy/web-local.sh build
python3 scripts/deploy/install-web-launch-agent.py "$PWD"
```

Keep a clean, detached backend/Opik deployment checkout in a directory shared with Colima,
such as `~/data/talent-signal-runtime-releases/<revision>`. Web builds run on
the host, but Opik's ClickHouse and nginx configuration use Docker bind mounts.
A host-readable `~/Library` release is not necessarily readable inside Colima;
an empty bind mount can fail initialization after an existing container has
already been recreated. Before running Compose, resolve the checkout with
`pwd -P` and verify its bind-mounted files from inside Colima. Do not expand VM
filesystem sharing or restart unrelated containers to make a release readable.

The backend keeper should resolve its own deployed checkout through
`~/Library/Application Support/Talent Signal/backend/current` with `pwd -P`,
independently of `web/current`. Advance that backend pointer only after the
prepared image passes deployment probes and its image/revision pair is saved.
Before any recovery deployment, the keeper must compare the resolved checkout's
HEAD with the revision injected by Infisical and fail closed on a mismatch.
This check covers interruption between saving the image/revision and advancing
the checkout pointer; never combine an old Compose definition with a new image.
Keep the prior checkout available for recovery. Before building or deploying,
require `git status --porcelain` to be empty, require detached HEAD, and verify
HEAD matches the intended approved revision. Never build or deploy from a dirty
checkout: the backend revision records HEAD, while Docker builds the working tree.

The build writes a revision/build-ID receipt from clean source. The installer
checks that receipt and the listener process ownership, replaces the
`web/current` symlink, and registers `com.talentsignal.web` with `RunAtLoad`
and `KeepAlive`. It refuses to take over an unrelated port-3000 listener and
restores the previous release/LaunchAgent if authentication readiness fails.
Logs are under `~/Library/Logs/Talent Signal/web`; the active revision is in
`web/active-release.json`. Retain the previous release for rollback. Do not
rebuild, modify, or remove the live release worktree. After switching, verify
Tailscale HTTPS login, an authenticated workspace request, and launchd restart
recovery. The Mac must be awake and the owning user logged in; clients must
join the authorized tailnet. Physical Wi-Fi/LAN address changes do not change
`AUTH_URL`. Never automatically replace it with a `192.168.x.x` address.

Inspect `tailscale serve status --json` before installing the owned handler:

```sh
tailscale serve --bg --yes --https=10443 http://127.0.0.1:3000
```

Refuse an occupied 10443 handler belonging to another service. Preserve API
443, n8n 8443, Opik 9443, and other existing routes. Verify the exact HTTPS
origin and Secure session cookies. The resident launcher disables the legacy
LAN HTTP cookie exception below; it remains available only for separately
authorized non-resident test deployments.

For ongoing updates, use the authorized scheduled Codex heartbeat to compare
remote main with the active Web revision and deployed backend revision. Only
activate relevant main changes after their current Web/backend quality and
security checks pass. Build before switching; preserve existing data, Opik
policy, and parallel worktrees. Serialize deployment with the existing backend
health keeper, and resume it afterward. Use a unique backend image tag and
explicit revision with `TS_TESTFLIGHT_REBUILD=false` for the prepared image.
After all deployment probes pass, persist `BACKEND_IMAGE` and
`TALENT_SIGNAL_BACKEND_REVISION` together in `staging:/backend`; otherwise the
health keeper could restore a stale image. Keep the previous image available
and examine migration compatibility before rollback. Do not roll back data.
Report successful version changes or actionable failures; stay quiet for
unchanged healthy state. A scheduler trigger alone is not update proof.

Next.js documents production binding in its [CLI reference](https://nextjs.org/docs/app/api-reference/cli/next#next-start-options).
Opik initialization jobs must be checked for successful completion separately
from long-running services: Compose [`--wait`](https://docs.docker.com/reference/cli/docker/compose/up/)
requires running or healthy service state.

## Opt-in private-LAN HTTP cookie policy

Auth.js session, nonce, and Google challenge cookies are `Secure` in
production by default. Keep that default. The only exception is an explicitly
enabled private-LAN HTTP Web deployment used for trusted local-network testing:
set `TALENT_SIGNAL_ALLOW_LAN_HTTP=true` **and** set `AUTH_URL` to a plain-http
origin whose host is a literal loopback (`127.0.0.1`, `localhost`, `::1`) or a
literal RFC1918 IPv4 address (`10/8`, `172.16/12`, `192.168/16`). The origin
must have no userinfo, query, hash, or non-root path, and its host text must be
canonical — values the URL parser silently rewrites, such as `0x7f000001`,
`127.1`, `2130706433`, `0177.0.0.1`, expanded IPv6, or percent-encoded hosts,
are rejected. Public IPs, arbitrary DNS names, link-local `169.254/16`, the
broad `172/8` range, and `https` origins always keep `Secure`. An invalid
opt-in fails closed: `Secure` stays enabled and `decideAuthCookieSecure`
returns an actionable reason. This exception is for an owner-authorized trusted
private LAN. HTTP does not encrypt traffic; use HTTPS on other networks.

## Operating boundary

Keep the Mac awake and on power, start Docker after login or reboot, and verify
`tailscale serve status` plus the HTTPS health endpoint before testing. Docker's
`unless-stopped` policy restarts the database and API after its runtime starts;
Tailscale stores the Serve configuration on the node.

If the Mac uses a local HTTP proxy, exclude the MagicDNS hostname when probing
from the Mac. The deployment script already bypasses process proxy variables
for its tailnet health and Apple challenge checks.

To pause this backend without deleting PostgreSQL data or changing other Serve handlers:

```bash
./scripts/infisical/run.sh staging /shared /backend /agent-host -- \
  docker compose --project-name talent-signal-testflight-local \
    --file compose.testflight.yaml down
```

The owned Serve endpoint will return unavailable while the containers are stopped.
Inspect `tailscale serve status --json` before removing that exact handler; do
not reset node-wide Serve configuration because other paths or ports may be owned
by unrelated services.

The database volume remains candidate-data storage subject to the repository's
authorization, retention, deletion, and access boundaries. Never use Funnel for
real candidate evidence without a separate public exposure and security review.
