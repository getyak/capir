# Owner-operated Nango Auth/Proxy

## Runtime and boundary

The free self-hosted Auth/Proxy service owns OAuth credentials and refresh.
Talent Signal owns request scope, exact tool approval, connection state, durable
results and audit. No Nango dashboard key or user OAuth credential belongs in
the Web, model, conversation or a deployment receipt.

The resident staging service uses the existing owner-operated Mac and tailnet:

| Surface | Address | Loopback |
| --- | --- | --- |
| API | https://smile-m4-minimac-mini.tail25e61f.ts.net:15443 | 127.0.0.1:4303 |
| Connect UI | https://smile-m4-minimac-mini.tail25e61f.ts.net:16443 | 127.0.0.1:4309 |

These addresses require Tailscale access. Dynamic client registration (DCR) works without exposing the dashboard publicly.
The pinned generic client prefers CIMD whenever the server URL is HTTPS, including
a tailnet-only URL. This wrapper applies a guarded method patch and explicitly
sets `TALENT_SIGNAL_NANGO_DCR_ONLY=true`: generic OAuth selects a validated DCR
endpoint or fails with `MCP_DCR_REQUIRED_FOR_PRIVATE_DEPLOYMENT`. CIMD-only and
unsupported static-client services cannot connect in this deployment. A provider
requiring public client metadata retrieval cannot reach tailnet-only metadata;
admit that provider only after a separately authorized public HTTPS metadata
arrangement and deliberate removal of the private DCR policy. Do not
silently enable Funnel.

The resident Docker project `talent-signal-nango` is explicitly allowlisted by
the host storage guard. Its isolated database volume holds encrypted OAuth
credentials; preserve it during updates. Do not run `down -v` on this resident
workload. Redis is disposable and has no persistence. Ports are loopback-only,
logs rotate at 10 MB times three, memory is bounded, and outbound OAuth/proxy
policy blocks private and link-local IPs with at most three redirects.

## Image provenance

Application source is `153f8c5450e7dd7049504df4a323e25499369002` (0.71.12).
`deploy/nango/Dockerfile.arm64` pins the official hosted AMD64 application and
native ARM64 Node 22.22.2 images by manifest digest. The upstream application's
compiled server JS and dependencies are copied with the two bounded patches
described here; the dependency tree
contains no `.node` native modules. The pinned Connect UI store defaults to
`https://api.nango.dev`, even when runtime `NANGO_SERVER_URL` points elsewhere.
`configure-connect-ui.mjs` replaces exactly that store initializer with the
bare HTTPS `NANGO_CONNECT_API_ORIGIN` (the API address above by default). It
fails if the pinned signature or entry references change, leaves SDK defaults
untouched, and renames the patched asset using its content hash to avoid stale
browser caches. This is a bounded patch to the pinned prebuilt UI, not an
upstream server change. `configure-private-oauth.mjs` separately inserts the
explicit private-deployment DCR policy into the unique pinned generic selection
method; all other OAuth logic stays upstream, and the dedicated Notion/Linear
MCP provider DCR flows are unchanged. The native wrapper is needed because
the official image failed to initialize its HTTP parser under this host's AMD64
emulator; disabling V8 JIT also disables the WebAssembly parser and is not a
working workaround.

The owner host's Docker daemon could not reach the registry on the first
deployment. A verified crane release fetched the pinned images through the
host proxy, then `docker load` imported them. Verification compared archive
config bytes with registry config digests and every imported rootfs diff ID.
Docker's containerd image ID is not always the registry config digest. Keep
those checks separate. Local offline aliases are:

- `nangohq/nango-server:hosted-153f8c5450e7dd7049504df4a323e25499369002`;
- `node:talent-signal-nango-22.22.2-arm64`;
- `postgres:talent-signal-nango-16`, from PostgreSQL 16 Alpine ARM64 manifest
  `sha256:2c942175a1255a9abe0366e48c1b401d9f50f835b04dfea13f111609b5530df7`;
- `redis:7.4.6-alpine`, repository digest
  `sha256:3b73847e72874be07e6657b129a94761662b79bc0f679273757d4218573b2a98`.

Verify those exact local images before offline deployment. Override only the
nonsecret `NANGO_UPSTREAM_IMAGE` and `NANGO_NODE_IMAGE` build inputs with these
verified aliases when using the offline import path; defaults remain immutable
registry digests. Set `NANGO_POSTGRES_IMAGE=postgres:talent-signal-nango-16`
when using the verified offline PostgreSQL alias. Do not retag an unrelated shared image. The resulting image
is `talent-signal-nango:153f8c54-node22-arm64-connect1-dcr1`.

## Secret delivery

`staging:/nango` is separate from product workloads. It supplies encryption,
PostgreSQL, dashboard and administrative session secrets through transient
Infisical injection. Never regenerate the encryption key on restart: persisted
credentials would become unreadable. Leave `RECORDS_DATABASE_URL` unset: the
pinned upstream defaults URL-encode the username/password and use the same
configured database, preserving passwords with URL-reserved characters. Back up the encrypted database and its
separately protected key under the owner's recovery policy before upgrades.

`staging:/backend` receives a dedicated environment service key with exactly
`environment:connect_sessions:write`, `environment:connections:list`,
`environment:connections:read`, `environment:proxy` and
`environment:connections:delete`, plus the actual Nango
webhook signing key, trusted API origin and environment `dev`. Nango `dev` is
this self-hosted environment name; the Talent Signal deployment remains staging.
The service key cannot manage integrations. Never copy dashboard/admin keys
into the product backend. Create the configured `mcp-generic`, `notion-mcp`
and `linear-mcp` integrations using the protected administrator path once;
ordinary sessions do not need that privilege.

The delete scope is required to remove the broker-held credential after a
disconnect or replacement. Changing only local connection state does not erase
Nango's credential. The dedicated service key's five scopes were read back after
updating that existing key without rotation. A DELETE for a never-created
synthetic connection reached the pinned handler and returned HTTP 400
`unknown_connection`; integration detail access remained HTTP 403. This proves
the delete permission, not deletion of a real user credential. Nango connection
deletion and provider-side OAuth grant revocation are distinct; universal vendor
revocation is not established by this deployment.

## Deployment and recovery

Run from a reviewed checkout after validating the local pinned images:

```sh
./scripts/infisical/run.sh staging /nango -- node scripts/infisical/verify-contract.mjs localNango
./scripts/infisical/run.sh staging /nango -- docker compose -f compose.nango.yaml build server
./scripts/infisical/run.sh staging /nango -- docker compose -f compose.nango.yaml up --detach --wait
curl --fail http://127.0.0.1:4303/ready
curl --fail http://127.0.0.1:4309/
```

Configure only the two service ports while preserving every other Serve mapping:

```sh
tailscale serve --bg --yes --https=15443 http://127.0.0.1:4303
tailscale serve --bg --yes --https=16443 http://127.0.0.1:4309
```

Read back the HTTPS API `/ready`, the Connect UI static page and an actual
backend-created Connect session in a browser. Confirm the session/configuration
requests reach the owning API on port 15443 and the provider selection appears;
a static HTTP 200 alone can hide a cloud-API 401 displayed as session expiry. `/ready` checks the initial database connection
and shutdown state, then caches success; it is not ongoing database monitoring.
The Connect UI `/health` route returns the SPA HTML, not a database probe.
Health alone is not authorization proof. A successful Connect session
is not a completed provider grant or MCP tool execution. Authoritative polling
must bind the server-generated request tag, account, user, provider and approved
endpoint before recording an OAuth connection. The observed session expiry is
30 minutes; use the returned expiry rather than assuming a fixed lifetime.

The pinned runtime also supports `DELETE /connect/session` authenticated by the
owning Connect session token, with no body or query. A fresh synthetic session
was read with HTTP 200, deleted with HTTP 204, then refused with HTTP 401
`unknown_connect_session_token`. This does not use the environment service key
and does not delete a provider credential. It is a supported session-deletion
mechanism, not proof that an already-running OAuth callback has finished: the
pinned callback reads the Connect session after exchanging the provider token,
and its session lookup does not check token expiry. Preserve a durable late-grant
watch whenever callback closure remains unverified. See the
[official session deletion reference](https://nango.dev/docs/reference/backend/http-api/connect/session/delete).

Optional webhooks require the actual signing key and reachable callback route.
No webhook callback was configured in the initial deployment; polling remains
the completion path. Keep raw callback bodies, OAuth tokens and session links
out of logs and general proof. The proxy disables retries for tool execution;
an ambiguous post-dispatch timeout remains unknown until reconciled.

For updates preserve the database and encryption key, build the reviewed image,
apply upstream migrations through the server's entrypoint, and repeat readiness,
protected API, scoped service-key and browser Connect-session checks. Roll back the
application image only when compatible with the migrated database; database
rollback requires the owner's protected backup, never an empty replacement.
