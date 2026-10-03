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

Implementation is in progress in Pi task 20261004-020353-5e29b5f6, branch codex/pi-20261004-020353-5e29b5f6, with frozen xiaomi-token-plan-cn/mimo-v2.6-pro. Parent owns this plan, independent verification/review, resident services, delivery and Notion. The task was paused at 185 and 211 turns to deliver grounded corrections, then resumed with the same history and two feedback repairs; no source changes were discarded.

Confirmed pre-review gaps require correction before frontend acceptance: full endpoint paths were reduced to origin; adding only saved a disconnected record without handshake/tools discovery; submitted state preceded actual creation; secret-shaped arguments were silently altered; Nango proxy response limits were applied after full buffering; OAuth expiry ignored the actual session expiry. Verify an actual choice producer and the complete no-existing-connection queued-chat scenario. Preserve all unrelated work and other Pi tasks.

The parent baseline Web/API proof processes on 3300/44317 were stopped before the worker's DB tests. The isolated owned PostgreSQL database is mcp_interactions_proof_20261004 on the existing local fixture container. CONTACT_AGENT_TEST_DATABASE_URL selects it; skipped DB tests are never counted as passed. Baseline real UI connected DeepWiki and discovered three tools; this is preflight evidence, not proof of the new chat/card chain.

Nango uses upstream source153f8c5450e7dd7049504df4a323e25499369002/application0.71.12 with a native ARM64 Node22.22.2 runtime wrapper. The upstream hosted AMD64 runtime failed to initialize its WebAssembly HTTP parser under this host's emulator. The wrapper preserves the upstream compiled JS/static assets; no native .node modules existed. Registry config bytes and imported configurations/rootfs layers were verified against pinned manifests. Actual integrations are mcp-generic, notion-mcp and linear-mcp. The product service key has only connect_sessions:write, connections:list/read and proxy scopes. Session TTL observed on the actual runtime is 30 minutes. The resident Docker project talent-signal-nango is explicitly allowlisted and has a bounded restart/memory/logging policy.

The user corrected the global storage floor to 30 GiB; both the guard and global instruction now match. Removed approximately 1.058 GB of confirmed disposable Docker build cache. Latest disk audit reported 63 GiB. Other tasks' aged/unregistered/unsafe Git-root evidence remains preserved; the full audit is not represented as clean. No iOS simulator was started by this task.

Redacted preflight proof is preserved in ignored output/evaluation/user-mcp-interactions-20261004/preflight. Working temporary artifacts remain registered at /private/tmp/ai-test-user-mcp-interactions.r3u7UF until final proof is preserved and task cleanup is safe. No product rollout, merged PR or Notion address update has yet been claimed.

Parent real-service readback confirmed GET /connections uses a connections array, not data. This newly confirmed OAuth polling blocker plus choice/rejection continuation bypass and bearer rename-mode consistency were sent as the second grounded feedback batch. Parent owns compose.nango.yaml, deploy/nango/Dockerfile.arm64 and docs/operations/nango-local.md; Pi owns product configuration and remaining implementation. The native service source is now reviewable; no final rollout has been claimed.
