# User-owned MCP and durable human participation

## Outcome and completion evidence

Users can add their own remote MCP from an ordinary conversation, finish authentication in an inline card, and continue the same task with a real tool receipt. A composed Extensions directory offers useful remote services and the same successful connection/call path. Typed human participation is persisted by call identity and restored after refresh and across devices. Deploy the reviewed backend and Web, verify the real surfaces, and update the existing Notion service ledger with usable addresses and evidence.

## Scope and boundaries

Remote HTTPS Streamable HTTP; anonymous and encrypted bearer connections; Nango-mediated OAuth when runtime configuration exists; curated remote catalog; typed approval, choice, form, secret and oauth requests; governed tool calls and durable results. Retain inbound/outbound separation. No stdio process execution, account-wide implicit permission, provider fallback, private candidate evidence export or arbitrary external write. Unknown remote read-only annotations grant no authority. Exact connection/tool/arguments require explicit human approval, even for generic remote reads. Unknown outcomes are never automatically retried.

## Existing evidence

- Fresh origin/main baseline 3d35363aac3e29e9212e0013f06393fd60b7fc14. Original checkout contains unrelated macOS/Web design changes and stays untouched.
- Managed worktree: /Users/cubxxw/.codex/worktrees/user-mcp-interactions/talent-signal.
- Existing modules: mcpClient, mcpConnections, mcpSecurity/mcpHttp, mcpRoutes; /workspace/extensions and /api/extensions management adapter. Existing handshake discards input schemas and does not execute tools or OAuth.
- Ordinary workspace Agent has supplementalTools plus invokeTool; durable Session answer blocks and assistant-ui data parts already exist. Reuse rather than introducing another orchestration framework.
- Nango prerequisites are resolved: parent deployed the free Auth/Proxy service on the existing host. API https://smile-m4-minimac-mini.tail25e61f.ts.net:15443 and Connect UI :16443 return HTTP 200. Workload secrets are isolated in staging:/nango; backend receives only a scoped API key, actual webhook signing key, trusted origin and environment from staging:/backend. No credentials are recorded here. Actual generic/Notion/Linear Connect sessions succeeded through the worker adapter; provider authorization has not yet completed.
- Resident Web: https://smile-m4-minimac-mini.tail25e61f.ts.net:10443. Backend: https://smile-m4-minimac-mini.tail25e61f.ts.net. Internal tailnet deployment, not public production.
- Notion target: Talent Signal · 三方服务台账, page 3d6a444a-6c00-8173-818f-d5e492982356; fetched before editing.

## Architecture decision

1. Backend owns a durable human request envelope: version, call_id, kind (approval|choice|form|secret|oauth), account/user/session/message identity, revision, parameter schema, purpose and exact target, expiry, lifecycle, public result receipt. Renderers never own authority. Persist no raw secrets or connect tokens in conversation/history/audit/idempotency snapshots.
2. One registry maps kind to restrained accessible cards on chat and Extensions. Pending, submitting, submitted, expired, rejected, failed and outcome_unknown are text-labelled. Refresh queries canonical records rather than rebuilding a decision from local state.
3. Adding/discovering a connection grants discovery only. Agent can list account-owned connections, stage connection requests and exact tool-call proposals, and read already approved receipts. Backend validates original bounded input schema, connection revision and ownership on each execution; approvals are single-use and args-bound. Claim execution transactionally before network effects. Credential or endpoint changes invalidate stale approval.
4. MCP client retains negotiated session/headers and original input schemas; calls use the existing public-DNS pinning, no redirects, total deadlines/response limits, sanitized errors and credential redaction. No replay of an uncertain effect. JSON-RPC error and tool isError are failures.
5. Nango is optional authorization infrastructure, not product truth. Server-generated connect_request_id binds account/user/connection/approved URL/provider. Create short-lived sessions with allowed_integrations and fixed mcp_server_url; verify completion using trusted backend readback and/or raw-body HMAC webhook plus authoritative metadata. Never accept a client-supplied connectionId as authority. Proxy only the frozen MCP target/POST/selected headers with retries zero. Missing config shows unavailable, never fake success. Disconnect/revoke stops future use.
6. Human results are durable tool results with call_id/source and re-enter the same Agent conversation, with secrets redacted; support lost response, duplicate submit, stale revisions and expired session. A generic form/choice API must have a host-registered handler; a model-provided schema is not arbitrary effect authority.

## Design read

Desktop knowledge workspace for users deciding which external capability to grant. Use the existing warm neutral, restrained vermilion visual system. Directory entries emphasize service name, verified domain, usefulness and authentication action. Connected entries show discovered tools and real invocation receipts with progressive details. Chat cards make the one pending action prominent; target and consequence precede confirmation. Preserve keyboard focus, dark/light themes, narrow layouts, reduced motion and refusal/recovery paths.

## Milestones

- [x] Inspect article, current architecture, isolation, credentials and Notion destination.
- [ ] Implement contracts/persistence, guarded MCP calls, Nango adapter, Agent integration and shared cards/catalog.
- [ ] Focused meaningful tests including DB-backed lifecycle, independent review and fixes.
- [ ] Deploy clean reviewed revision; verify anonymous/Bearer live services and real ordinary chat, refresh and one tool call. Verify OAuth only against real configured Nango/provider.
- [ ] Record proof and update Notion addresses; close only when requested acceptance actually holds.

## Sources

- https://cubxxw.com/zh/ai-agent/posts/nango-user-defined-mcp-integration/ (retrieved with Exa after web open failed)
- https://nango.dev/docs/guides/auth/mcp-auth.md
- https://nango.dev/docs/reference/backend/http-api/connect/sessions/create
- https://nango.dev/docs/guides/platform/self-hosting#free-self-hosting
- https://nango.dev/docs/reference/backend/http-api/api-keys
- https://github.com/NangoHQ/nango/blob/153f8c5450e7dd7049504df4a323e25499369002/packages/server/lib/utils/auth.ts
- https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
- https://www.assistant-ui.com/docs/tools

## Active state

- Pi task `20261004-020353-5e29b5f6` owns product implementation in its isolated
  worktree, frozen to `xiaomi-token-plan-cn/mimo-v2.6-pro`. Five consolidated
  repair batches preserve history and accounting; current ceilings are 600
  cumulative turns and 8 repairs. Parent owns this plan, deployment, Notion,
  independent review and acceptance. Product rollout remains incomplete.
- Parent infrastructure and fixture commits are preserved on
  `codex/user-mcp-interactions`; Pi must not edit `compose.nango.yaml`,
  `deploy/nango/**`, `docs/operations/nango-local.md`, this plan or
  `accountMcpLifecycle.integration.test.ts`. Reviewed Nango runtime and final
  real pre-grant proof are recorded below and in the runbook. OAuth grants are
  still unverified; no webhook callback was configured, so polling is required.
- Test database `mcp_interactions_proof_20261004` is isolated and synthetic.
  Owned Web/API proof listeners on 3300/44317 are stopped during repairs.
  Artifact root `/private/tmp/ai-test-user-mcp-interactions.r3u7UF` remains
  registered until formal evidence is preserved and cleanup is safe. No iOS
  simulator was started by this task.
- Parent independently ran seven MCP suites: 67 passed, no skips, before the
  latest repairs. Baseline authority fixture setup was fixed in `632543fa`;
  its two tests passed and independent review closed with no findings. Pi's
  subsequent 17 lifecycle and 4 queued-chat passes are intermediate evidence,
  not final source-bound acceptance. Transport-only DeepWiki proof negotiated
  2025-11-25, discovered three original schemas and genuinely called
  `read_wiki_structure` for public `facebook/react`. The configured staging
  Anthropic provider probe also passed. Full UI/approval/Agent acceptance is pending.
- Formal redacted proof lives in ignored
  `output/evaluation/user-mcp-interactions-20261004/`. The existing Notion service
  ledger was updated and read back with actual tailnet addresses; it explicitly
  marks product rollout and provider grant incomplete. The storage floor is
  30 GiB at the user's direction. Latest free space is 70 GiB; approximately
  1.058 GB disposable build cache and 386321920 bytes of task-owned image
  transfer archives were removed. Imported images and rollback evidence remain;
  unrelated tasks' artifacts and active workloads are preserved.

## Real UI review checkpoint

The parent authenticated the new implementation against the owned synthetic database and loaded `/workspace/extensions` through the real Web BFF. The new directory rendered zero entries; all four directory/card reads returned `409 session_stale` because the new clients omitted the existing canonical `x-workspace-session` header. The BFF guard remains valid and must not be weakened. Screenshot and redacted response proof are retained in ignored evaluation output. Owned Web/API processes on 3300/44317 were stopped before repairs.

Independent product review also confirmed OAuth terminal-state/concurrency violations, missing OAuth handshake and original-Agent continuation, absent UI polling, lost durable continuation recovery, in-flight expiry truth errors, and private conversation ownership gaps. Choice-card attachment, schema/component registry, truthful secret copy and theme/layout remain acceptance repairs. The same Pi task resumed with consolidated feedback3; the cumulative turn ceiling increased to600 and repair ceiling to8 for this diagnosed batch, preserving history/provider/model and credit accounting. Product rollout remains incomplete until repaired behavior is independently reviewed and tested from real surfaces.

The final review addendum confirmed additional source boundaries: session deletion/retention must revoke pending MCP authority and clear private derived content; legacy client saves must preserve server-issued card references; asynchronous human results must carry host-only typed provenance rather than become invented human-authored messages. Remote schema regex and unimplemented validation constraints must fail closed. Consolidated feedback4 resumed the same Pi task at282 cumulative turns, with all earlier repairs retained. Origin/main was fetched again and remains3d35363a; no upstream merge change is pending. Notion readback now uses the actual Nango `/ready` startup check and distinguishes Connect UI static access from an OAuth grant. Task-owned image transfer archives were removed after verified imported images/source and redacted receipts were retained;386321920 bytes released. The latest audit reports62GiB free against30GiB; unrelated artifact/simulator tasks remain preserved.

Independent live transport preflight succeeded through the new MCP client: DeepWiki negotiated2025-11-25, exposed three original input schemas, and `read_wiki_structure` for public `facebook/react` returned a genuine2967-character success result. This is transport proof only, not the UI/approval/Agent chain. The configured staging chat-provider synthetic probe also passed through claude-agent-sdk/anthropic/claude-sonnet-5 (9331 input/303 output tokens). Redacted proof is retained in the same ignored preflight directory; no provider credentials or private candidate data were retained.


### Connect UI origin repair (2026-10-04)

A fresh, unexpired self-hosted Connect session rendered an expiry error in the
real browser. Static HTML was 200, but the pinned SPA requested `api.nango.dev`
and received 401. Source inspection confirmed the store initializer is hardcoded
and the server removes base URL query parameters when constructing session links.
Runtime origin configuration and a query suffix are insufficient.

The native wrapper now applies one guarded initializer replacement at image build
time and gives the modified entry asset a new content hash. The image
`talent-signal-nango:153f8c54-node22-arm64-connect1` built successfully and
passed independent review and a real pre-grant browser readback. No provider grant or
product acceptance is inferred from this build. The prior compatible image and
resident encrypted database are preserved.

The bounded Connect UI patch passed independent review with no confirmed
P0/P1/P2 and all five targeted signature/origin/cache guard checks. Reviewed
revision `73ae00a2` was applied to the same resident database. A fresh real
Notion MCP session now renders “Link Notion (MCP) Account”; API requests hit the
self-hosted port 15443 with HTTP 200, no cloud API request and zero page errors.
Evidence: `output/evaluation/user-mcp-interactions-20261004/preflight/`
`nango-connect-ui-fixed-proof.json` and `nango-connect-ui-fixed.png`. This closes
the pre-grant UI routing defect only. No provider grant was executed.

Storage audit now reports 70 GiB free against the user-authorized 30 GiB
minimum. Other tasks' registered artifacts remain untouched. Audit exit 2
reflects their lifecycle inventory, not inadequate free space.

### Second backend review checkpoint

At 354 cumulative Pi turns, independent review confirmed seven remaining P1:
host results still becoming human history/steering evidence; non-UUID strings
used as trusted host authority; incomplete Session private-data/replay cleanup;
delete-versus-in-flight settlement failure; abandoned connection/handshake claims
without recovery; late OAuth callbacks after membership revocation; and polling
that ignored the owner argument. The same task resumed with consolidated
feedback5 and unchanged provider/model/history/accounting. No final review or
product rollout has passed. Detailed redacted findings and source hashes are in
`output/evaluation/user-mcp-interactions-20261004/independent-review-checkpoint-2.txt`.

Parent selected the narrow fix: host result continuations enter independent queue
entries, and MCP staging receives the existing server-owned queue run fence.
Staging verifies the live claim in the same transaction, while human decisions
always revalidate a real login session. A string format cannot confer authority.
The already repaired immutable PUT provenance remains valid.

A separate real Proxy preflight attempted a temporary synthetic credential on
`mcp-generic`; the API correctly rejected manual OAUTH2 import because the pinned
provider uses `MCP_OAUTH2_GENERIC`. No connection was created. This did not test
Proxy transport or a provider grant and is not acceptance evidence. The rejected
preflight is preserved as `preflight/nango-proxy-transport-proof.json`. OAuth must
be validated through the real Connect flow rather than inferred from a synthetic
import.

### Private generic OAuth selection policy

Live public metadata for Notion and Linear advertises both DCR and CIMD. Pinned
Nango generic OAuth prefers CIMD whenever its HTTPS server URL generates a
client metadata document URL; it does not distinguish an unreachable tailnet
address. The dedicated `notion-mcp` and `linear-mcp` integrations use upstream
MCP_OAUTH2 DCR directly, but user-defined generic OAuth requires an explicit
private deployment policy.

Parent added a guarded method patch and `TALENT_SIGNAL_NANGO_DCR_ONLY=true`.
Generic OAuth chooses a validated registration endpoint or fails explicitly;
CIMD-only services require a separately authorized public metadata arrangement.
No Funnel was enabled. Eight targeted policy cases and independent review passed
with no confirmed P0/P1/P2. Revision `8014d233` built and deployed the resident
`153f8c54-node22-arm64-connect1-dcr1` image with healthy database, Redis and API.
A fresh real generic Connect session for the Notion MCP endpoint reached the
Notion login page after clicking Connect. Self-hosted API returned successful
responses including the OAuth redirect; browser page errors were zero. Evidence:
`preflight/nango-generic-dcr-redirect-proof.json`. No provider login or grant was
performed, and this proves the pre-grant flow only, not Proxy/tool-call completion.

### Third intermediate review and repair scope

Pi batch5 finished at 408 turns. Its wrapper rejected a mechanical migration
freeze update outside the original allowlist. Parent inspected the exact count
92→94 and digest change and allowed that single checker path; no checks were
weakened. The same task resumed as repair6 with unchanged provider/model/limits.

Independent production-function VM probes with synthetic database returns
confirmed late private result/outbox restoration after deletion and lost results
for legitimate sessionless directory calls. Source review also confirmed a
non-atomic OAuth revocation/publication window. These three P1 require actual
PostgreSQL barrier regressions, not only sequential lifecycle assertions. The
report with source hashes and precise validation limits is preserved in
`output/evaluation/user-mcp-interactions-20261004/independent-review-checkpoint-3.md`.

Repair6 also completes the outstanding single-page inbound catalog composition,
canonical light/dark tokens, readiness gating and accurate secret contracts.
Batch5's claim that tokens were corrected was contradicted by source readback;
its tests do not prove visual acceptance. No final product rollout or PR exists.
