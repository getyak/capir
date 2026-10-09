# Isolated public browser worker

This is a trusted Playwright driver for the shared Harness's
`browse_contact_source` tool. Production admission remains pending GET-9 review,
deployment and client verification. A successful image build is not admission.

Build this directory with Docker, inspect the resulting immutable local image ID,
and set `TALENT_SIGNAL_BROWSER_IMAGE=sha256:<image-id>` in the **browser executor**
environment. The backend uses its existing private research Unix socket.
Mutable tags are refused at execution; runtime cannot pull an image. The image
pins Playwright1.63.0 and the multi-platform upstream image digest. It contains no
SDK, API secrets or product data.

For direct local evaluations, select the intended Docker daemon with
`DOCKER_CONTEXT`; do not change the machine-wide active context. Production
uses an explicit socket and verified daemon identity instead. The daemon
and immutable image must already exist before startup. A dedicated
Colima profile with no host mounts provides local test capacity without stopping
unrelated containers. This is an operator-owned prerequisite, not an automatic
VM provisioning or public exposure capability.

## Private production transport

The model-credentialed research sidecar does not receive a Docker socket.
Its production browse path requires `TALENT_SIGNAL_BROWSER_EXECUTOR_URL`
(an explicit private IPv4 HTTP origin) and
`TALENT_SIGNAL_BROWSER_EXECUTOR_TOKEN` (a dedicated 256-bit hex token).
No configuration means no browser execution; there is no local fallback.
Store the caller token in the normal secret-delivery system. Do not put it
in a tracked file, command argument, URL, model prompt or diagnostic log.

Launch `apps/agent-host/dist/browserExecutorMain.js` as a separate trusted Mac
process with `env -i`, a PATH containing the installed Docker CLI, and:

- `TALENT_SIGNAL_BROWSER_DOCKER_SOCKET`: absolute dedicated daemon socket;
- `TALENT_SIGNAL_BROWSER_DAEMON_ID`: independently read `docker info` ID;
- `TALENT_SIGNAL_BROWSER_IMAGE`: the immutable image ID;
- `TALENT_SIGNAL_BROWSER_EXECUTOR_TOKEN_FILE`: absolute, owner-only file
  containing the same token, owned by the executor user (symlinks refused).

The entry point rejects unrelated inherited environment variables before
loading native dependencies. Docker receives an explicit `DOCKER_HOST`,
empty configuration/home, and the operator's absolute PATH; it never inherits
`DOCKER_CONTEXT`, proxies, model tokens or database configuration. This trusted
process still has its host user's filesystem privileges. Only the disposable
browser container is the untrusted-code isolation boundary.

The fixed `127.0.0.1:4319` listener is acquired before startup orphan cleanup,
preventing two production entry points from owning it. Do not expose it with
Tailscale Serve, a public port or a reverse proxy. In Lima/Colima deployments,
verify the private guest-to-host route from the actual sidecar before configuring
its IP; host aliases are not assumed to exist. Authenticated `GET /health/ready`
verifies daemon/image identity and cleanup health. `POST /v1/browse` accepts only
task/call/source/provider IDs, the discovered URL, and an absolute deadline.
No source title, candidate anchors, original messages or browser commands cross
this boundary. HTTP redirects are never followed by the RPC client.

Requests and responses are limited to4KiB and80kB. Two calls may execute;
there is no queue. The caller's deadline includes request handling and daemon
verification. Exact concurrent duplicates share execution; identity/deadline
conflicts fail. Terminal duplicates are rejected using content-free hashes kept
for five minutes, up to512 entries. The final disconnected subscriber cancels
execution; capacity returns only after verified browser cleanup. Startup or
cleanup failure does not grant admission. Recovery after unverified cleanup
requires restarting the executor and successful startup inspection.

## Managed Mac lifecycle

The [launchd template](../../../deploy/testflight/browser-executor.plist.example)
keeps only the trusted executor running in the signed-in operator's GUI domain.
Fill its explicit paths and independently verified daemon/image identity with a
plist-aware editor. Use a built, pinned release checkout and an absolute Node
binary; do not point a final deployment at an actively edited worktree. Keep the
token in an owner-only, non-symlink file in the operator's Application Support
directory, outside temporary storage. The plist contains its path, never its
value. The caller's Infisical token must match that file.

The PATH replacement is a colon-separated list of absolute **directories**
containing the Docker CLI and required executables, such as
`/Users/operator/.local/bin:/usr/bin:/bin`; it is not the path to the `docker`
executable itself. Node is launched by its separate absolute binary path.

Before installing, validate the plist with `plutil -lint`, ensure every
`REPLACE_` placeholder is gone, and run its exact `ProgramArguments` once in the
foreground. Check authenticated readiness and a real browse, then stop that
foreground process. Install the rendered file with mode0600 at
`~/Library/LaunchAgents/com.talentsignal.browser-executor.plist`. These commands
operate only on that service:

```bash
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.talentsignal.browser-executor.plist"
launchctl print "gui/$(id -u)/com.talentsignal.browser-executor"
# Stop and unregister before replacing its pinned build or configuration:
launchctl bootout "gui/$(id -u)/com.talentsignal.browser-executor"
```

`KeepAlive` restarts unexpected exits, with a ten-second throttle. A normal stop
allows45seconds for cancellation and cleanup before launchd may force termination.
Every restart revalidates the daemon/image and performs orphan inspection before
readiness. A cleanup-health latch in a still-running process requires an explicit
stop/start; process supervision alone does not clear it. Prove PID replacement,
readiness, real Chromium and empty worker inventory after restart. Never infer
health from launchd's running state.

This template discards stdout/stderr to avoid unbounded launch-loop logs; inspect
launchd's exit status and authenticated readiness. For startup diagnosis, stop
the service and run the same arguments in the foreground, preserving only
sanitized failure evidence. It starts after GUI login, not before login, and
does not start Colima or prevent Mac sleep. The dedicated daemon remains an
operator-managed prerequisite. No reboot or physical-device availability is
implied by a successful launch-agent test.

## Browser isolation

Each call creates a new non-persistent Chromium context in a fresh `pwuser`
container: no host mounts, network none, read-only root, all capabilities dropped,
no-new-privileges, two CPUs,768MiB memory,256PIDs,128MiB shared memory and256MiB
temporary storage. Chromium's separate renderer sandbox is disabled; the Docker
container is the OS boundary. Do not run `worker.mjs` directly on a credentialed host.

The host resolves only task-discovered public HTTPS sources. The browser receives
only a public URL and brokered public response bodies. Every broker request uses
the same origin, pinned public DNS, robots checks and anonymous GET. Cookies,
request bodies and browser headers never reach the network. WebSockets, private
addresses, foreign origins, child-frame navigation, forms and downloads are not
admitted. Public pages and their scripts remain untrusted evidence.

Limits per call:40 browser resource requests,6 concurrent broker operations,
80 total HTTP requests including robots/redirects,8MB consumed response-body
budget,1MB per resource,200kB per robots file,16k characters of rendered text.
The byte budget rejects the chunk that crosses its threshold and stops further
dispatch; it is not an exact bound on TCP/header bytes already in flight. The
direct local host has a30-second execution deadline and the worker25seconds;
the RPC caller further bounds its entire call to28seconds. Initial service
orphan inspection precedes admission; verified cleanup may finish after the
call deadline and must finish before capacity returns. DNS and resource
waiting respond to cancellation. DOM rendering waits at most two additional
seconds for idle; this is a bounded snapshot, not proof every dynamic resource loaded.

Top-level same-origin HTTP redirects re-enter as fresh browser pages, with up to
three hops. This avoids an intercepted redirect becoming an unmediated browser
request or an error-page navigation race. Subresource redirects are refused and
counted as blocked. The rendered source records initial/final URLs, discovery
source, browser version, time, content hash and both resource/HTTP counters.
Blocked resources can leave a page incomplete. No browser action grants contact
identity, confirmed facts or execution authority.

Normal disposal uses automatic removal plus a verified explicit cleanup path.
Containers carry purpose, host/user owner, PID and process-instance labels.
Startup removes only containers belonging to an abandoned local owner process;
it preserves foreign owners and live instances. An unverified cleanup fails
further admission closed in that service process. Docker daemon errors are not
treated as verified absence. Pending broker replies settle before Chromium closes.
Optional lifecycle diagnostics report fixed phases and elapsed milliseconds only;
they contain no page text. `close_failed` never implies successful disposal, and
both synchronous and asynchronous diagnostic callback failures are isolated.

Run `harness/scripts/evals/evaluate-isolated-browser.mjs IMAGE_ID OUTPUT.json`
from the private `capir-evals` checkout after
building agent-host. It distinguishes synthetic broker tests from a live public
HTTPS page. `evaluate-browser-product.mjs DATABASE_URL IMAGE_ID OUTPUT.json`
adds real SDK, product HTTP, Unix socket and PostgreSQL; its search discovery is
controlled and is not an Exa network test.
`evaluate-browser-recovery.mjs IMAGE_ID OUTPUT.json` exercises runaway page
JavaScript, request exhaustion and fresh-run admission after verified cleanup.
Request exhaustion closes Chromium before reporting a terminal failure; it
must never be returned as a truncated success with inconsistent counters.

Sources: [Playwright Docker guidance](https://playwright.dev/docs/docker),
[browser contexts and network routing](https://playwright.dev/docs/api/class-browsercontext),
[service-worker interception limits](https://playwright.dev/docs/service-workers).
