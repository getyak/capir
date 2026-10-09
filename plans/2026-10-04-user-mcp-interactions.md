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
- [x] Implement contracts/persistence, guarded MCP calls, Nango adapter, Agent integration and shared cards/catalog.
- [x] Focused meaningful tests including DB-backed lifecycle, independent review and fixes.
- [x] Deploy clean reviewed backend and Web; verify real anonymous services from the activated runtime and preserve local ordinary-chat/refresh proof.
- [x] Complete post-deployment authenticated Web acceptance through the installed capir test CLI and ordinary password login. Real bearer/provider OAuth grants remain unverified.
- [x] Record release proof and update/read back Notion addresses with accurate acceptance limits.
- [x] Complete actual chat/catalog/restore acceptance, preserve proof and clean owned fixtures.

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

- Pi task `20261004-020353-5e29b5f6` was cancelled at 475 cumulative
  turns and 8 repair batches after repeated failures demonstrated fixture and
  lifecycle defects. Provider/model, session history and usage accounting are
  preserved; no budget increase or provider fallback is in effect. Root now
  owns backend cleanup and adoption. Native `mcp_frontend_complete` owns Web
  directory/cards and `mcp_review` owns the atomic OAuth publication correction
  and its focused lifecycle tests in the same implementation worktree with
  non-overlapping files. A separate independent review is required afterward.
  Parent owns deployment, Notion and final acceptance. Product rollout remains
  incomplete.
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

Batch6 added the shared locked settlement guard, legitimate null-session result
retention and atomic OAuth publication. Pi reports 26 integration cases passing,
including SQL barriers; final independent closure is still required. Parent
paused at turn436 after that checkpoint because a separate narrow review
confirmed missing OAuth broker credential cleanup on disconnect/replacement and
Lab stop. Ordinary disconnect retains secondary recovery identity, but Lab bulk
deletion removes it. No account-retirement defect was confirmed. Scope and
synthetic-proof limits are recorded in `independent-review-checkpoint-4.md`.

Repair7 resumes the same history and accounting to add durable exact broker
cleanup, honest local/Nango/provider status, late-grant handling, and the pending
single-page/theme/readiness work. The page must expose schema-driven parameter
controls for ordinary tools, such as DeepWiki repoName, before exact approval.
Parent added only `environment:connections:delete` to the existing dedicated
service key and read back its exact five-scope set. No key rotation was needed.
A never-created synthetic identity returned the pinned DELETE handler's HTTP
400 `unknown_connection`; protected integration detail access remained HTTP 403.
Evidence is `preflight/nango-cleanup-key-scope-proof.json`. The earlier `/config`
probe was an SPA fallback, not a permission check, and was corrected to the
source-verified `/integrations/mcp-generic` route. No real provider credential
was read or deleted, and provider grant completion remains unverified.

### Cleanup draft checkpoint and final budgeted repair

At turn450, independent synthetic production-function review confirmed four
structural P1 in the cleanup draft: failure treated as authenticated absence,
destructive fallback on reused identity/unfrozen scope, no ordinary background
pump, and lost Lab association when reusing a prior pending attempt intent.
Detailed source hashes and synthetic-proof limits are recorded in
`independent-review-checkpoint-5.md`. Parent verified the pinned broker's callback
session lookup has no expiry check; a 30-minute Connect token does not prove
already-started callback closure. Repair8 must retain an honest late-grant watch
instead of inventing capability closure, and complete the pending page/form work.
The same task/provider/model/history/accounting resumed; the existing cumulative
600-turn/8-repair ceiling was not increased. No final approval is recorded.

Storage audit now reports 67 GiB free against the user-authorized 30 GiB minimum.
Its nonzero result concerns other owners' lifecycle inventory, not a space
failure; those active/unreviewed directories remain untouched. `capir auth`
still reports no grant for the exact configured test origins; local synthetic
Web acceptance remains isolated from the shared staging database.

Parent subsequently verified the actual supported `DELETE /connect/session`
route, using the owning Connect token (not an environment/admin key): fresh
synthetic session read200 -> delete204 -> read401
`unknown_connect_session_token`. No provider grant or existing user session was
touched. Evidence: `preflight/nango-connect-session-delete-proof.json`. This
corrects any assumption that no session-deletion API exists; it still does not
prove already-in-flight callback closure. Product integration of that supported
mechanism must be assessed at the next checkpoint; do not equate indefinite
watch status with a completed deletion or invent a callback grace period.

### Root cleanup correction after delegation cancellation

The root corrected cleanup to validate complete account/user/provider/attempt/URL
metadata and frozen broker/environment before DELETE. It watches all owned
connections in the frozen attempt, including grants arriving after removal of
the initial ID. A claim token and generation revision prevent stale workers
from overwriting a late binding or emitting false confirmation audit records.
Metadata malformed/unauthorized/truncated responses remain unresolved. Migration
094 follows the already-applied migrations instead of rewriting their checksums.
The background pump now waits for outstanding work during shutdown.

Focused synthetic PostgreSQL/wire tests currently pass 20 tests across cleanup
and Nango adapter suites, including multiple grants, changed owners, incomplete
metadata pages, a real database late-binding barrier, and an actual Lab data wipe
with its control-scope cleanup ledger surviving. This is intermediate regression
evidence, not final source review, real provider authorization or product proof.
The pinned Connect session DELETE capability is documented separately; its 204
and subsequent GET401 do not prove closure of a callback already in flight.

### Native completion and real product proof, 07:55 CST

The frozen Pi task was cancelled after 475 turns and eight repair attempts;
no provider, model or budget increase occurred. Root and native agents now own
the implementation. Cleanup has complete frozen identity, generation CAS and
control-scope per-dispatch effect receipts (migration095), including partial
remote success and stale-claim barriers. Its isolated PostgreSQL/wire suite
passes21 tests. Independent review closes prior cleanup, atomic OAuth, exact
broker binding, generic rejection and scoped private choice retention defects.
The latest interaction suite passes63 PostgreSQL tests.

The actual local Web/BFF/API directory added DeepWiki, discovered three tools,
staged and manually approved read_wiki_structure for public facebook/react, and
rendered a genuine successful receipt. Refresh and fresh browser context restored
the result;375px light/dark views had no horizontal overflow. These observations
are directory product proof, not real OAuth grant proof or release proof.

The actual ordinary chat staged its inline connection card using the configured
Anthropic Agent. After real approval and discovery, its host-result continuation
failed before model execution. Independent production-service read-only PG proof
identifies22P02: nullable stored login-session identity becomes a queue sentinel,
then the production Lab provider selector treats it as UUID. A narrow explicit
null-login/default-provider fix and construction-path regression are in progress.
This remains an open P1; no completed full chat acceptance, PR or rollout is
claimed. Scoped MCP chat token allowance was raised to96k after measured33679
input tokens exceeded the32k ordinary-chat allowance; cost, turns and tool limits
remain unchanged.53 targeted provider tests pass independently.

Latest storage audit reports about65GiB above the authorized30GiB floor. Other
owners' active evidence and unrelated source edits remain preserved.

### Final local ordinary-chat proof and adoption, 08:20 CST

Independent review closes all confirmed P0/P1/P2 in the scoped implementation,
including the production Lab selector, immutable host objectives and approved
full-receipt readback. Its frozen hashes and evidence limits are preserved in
`output/evaluation/user-mcp-interactions-20261004/independent-review-cleanup-and-final.md`.
Source commit b1f3aae1 was cleanly adopted as821b2e74 with no conflicts.

A fresh ordinary Web conversation ff06ac28-5efd-4210-8e26-933f0f042baf
added DeepWiki Final Chat Proof through its actual form, completed real discovery,
staged exact read_wiki_structure(repoName=facebook/react), received explicit UI
approval, returned a genuine result and continued with the configured Anthropic
Agent. The answer lists Repository Overview, Core Reconciler Architecture and
Rendering Targets correctly. Refresh and a fresh375px browser context restore
the cards and final answer without exposing internal continuation instructions.
Formal screenshots and canonical queue/call proof reside in the same ignored
evaluation directory. This is full local product proof, not staging rollout.

Post-adoption combined isolated PG check reports82/83 passed: one initial queue
completion wait timed out after staging the card. Native owner is diagnosing
controlled liveness metadata; no blind timeout increase or live DB testing.
PR/remote checks, clean revision deployment and post-deployment acceptance remain
pending. Real provider OAuth login/grant remains unverified.

### CI repair and second real catalog provider, 08:37 CST

PR284 is attached to this task. Latest local combined MCP PostgreSQL suites
pass83/83 after scoped diagnostic metadata was added without increasing the
15-second queue wait. The earlier intermittent wait has no confirmed root cause;
the diagnostics preserve only owned identity, status, timing and failure codes.

First remote CI identified a separate compatibility regression: adding a null
host_request_id changed pre-deployment human-message idempotency hashes. The
field is now included only for genuine host results; independent source review
confirms ordinary text/image identity matches origin/main. The existing old
receipt regression and all56 conversation queue PostgreSQL tests pass.

First CodeQL reported three input-dependent cleanup/prototype assignment issues;
the implementation now derives cleanup from persisted transitions and creates
redacted/tagged maps without dynamic property assignment.22 unit regressions
pass. An independently reviewed real PostgreSQL transition probe verifies OAuth
rename, endpoint/credential replacement, replay and stale-revision behavior.
The fourth alert followed a fixture random Session ID through a helper named
seed, not a password; renaming it createMcpFixture clarifies its actual role
without suppressing the security rule. Fresh latest-head scanning remains required.

The actual local Context7 catalog discovered two tools and completed an approved
resolve-library-id call, returning genuine React documentation library matches.
Its rendered receipt is preserved alongside the DeepWiki and ordinary-chat proof.
Storage reports59GiB above the authorized30GiB floor. Clean release rollout,
post-deployment real-surface acceptance and Notion readback remain pending.

### Remaining scanner fixture classification, 08:47 CST

The latest remote Backend/Web quality, macOS boundary and security jobs pass;
CodeQL removes alerts82-84 but still classifies the returned fixture Session ID
as a password. Independent review confirms no password/token in its SHA256
idempotency path. The primary CodeQL SensitiveCall implementation classifies a
whole function result when any literal argument resembles sensitive data;
all nine reported calls use oauth-* test slug labels. Those nonsecret fixture
labels now describe broker-* scenarios. OAuth modes, test names, provider
metadata, assertions, hashing and scanner rules are unchanged. No alert was
dismissed. Fresh scanning must demonstrate whether this naming clarification
closes the false positive; release activation still waits for all current gates.

### Reviewed release deployed, 09:20 CST

All 20 latest-head PR checks have no pending/failed entries, including required
CI/Security, Backend/Web quality, iOS smoke and macOS boundary. CodeQL has 0
results; no alert was dismissed. PR 284 is confirmed merged as
dbf47826a6e43cb0f0f064134fe4c4bc752520fc; its source tree equals the reviewed
f05c84b5 head. The actual backend and resident Web now run the merged revision.
Web build ID is 1GQHw9BrqxEruNnhTZ4nL. Production simulated authentication remains
false; the deployed database includes migration 095.

The initial release attempted Opik bind mounts from the Codex checkout, outside
this host's configured Colima mounts. Initialization failed before API activation.
The existing operational runbook already describes this exact boundary; no new
global rule is needed. The corrected immutable release lives under an existing
mounted data root. Web is at
/Users/cubxxw/data/talent-signal-releases/mcp-dbf47826; its separate clean backend
recovery checkout is /Users/cubxxw/data/talent-signal-runtime-releases/dbf47826.
The live releases must remain unchanged. Deployment notes are written in this
separate worktree. Resident data volumes are preserved; the VM was not restarted.

Actual activated-container production transport completed genuine DeepWiki
read_wiki_structure(facebook/react) and Context7 resolve-library-id(React):
succeeded, effectSent=true, discovery of 3/2 tools. This proves released transport
and networking, not authenticated Web cards or OAuth authorization. Actual HTTPS
Web login/providers and API readiness were read back. Backend recovery image,
revision and checkout pointer were aligned after deployment probes. The existing
health keeper was temporarily unloaded for that serialized update and restored
with last exit 0. Opik, Apple, silent-voice and configured-model deployment probes
passed. 11 served HTTPS Extensions assets match the immutable Web build hashes.

The task-specific capir environment exists, but auth status confirms no scoped
credential for the exact staging origin. The documented development fixture
password is not a shared-staging login. A valid human login was requested while
independent delivery continued. Post-deployment authenticated isolated-space
proof and actual vendor OAuth login/grant remain pending; they are not replaced
by local proof, transport calls or a login page 200. Owned 3300/44317 listeners
are stopped and formal evidence is preserved in the parent evaluation directory.
Notion page 3d6a444a-6c00-8173-818f-d5e492982356 now records deployed addresses,
merged revision, real local/activated-runtime evidence and the remaining login/
OAuth limits; the page was read back after writing. Other service entries and
credentials were not changed. Superseded task images were removed; the previous
deployed image and resident volumes remain for recovery.


### Final authenticated release acceptance, 2026-10-04

Completed requested chat/catalog acceptance on the real tailnet staging surface.
The approved capir test implementation removes the earlier missing-login blocker:
installed CLI provisioned a synthetic daily identity, entered it through the
private headed-browser handoff, and passed ordinary password login. Web/backend/
CLI use immutable revision d9153b46445d842b4e9e649089f59b708fc54583 after protected
PR 286/287 merges and independent exact-source review.

Ordinary chat session 4beb05b3-a2c4-4eac-87ca-cd3847ae2aa8 added DeepWiki through
its actual form, discovered three tools and obtained human approval for
read_wiki_structure(repoName=facebook/react). Real succeeded call
1bb72f04-ec54-4daa-bcb9-8dc366f66db8 is durably linked to the original session's
Agent continuation. The response uses the actual React repository result.
The catalog added Context7, discovered two tools and completed approved
resolve-library-id(libraryName=React, query=Find official React documentation
for useState examples); succeeded call 39bca0b7-ff1c-410f-a0f9-ca0b92a9ed58
returned genuine official-documentation matches. Refresh, a fresh ordinary
password login and 375px light/dark rendering restore the real state.
No completed vendor or Agent call was repeated to repair a proof-harness error.

Notion page 3d6a444a-6c00-8173-818f-d5e492982356 now contains actual addresses,
final release, usable CLI commands and the staged proof; readback at
2026-10-04T09:06:30.507Z confirms the old missing-login blocker was removed.
The earlier provider OAuth limitation remains explicit: no vendor consent or
OAuth Proxy tool call is claimed. Anonymous service acceptance does not grant
access to a user's Notion/Linear account.

The owned staging accounts stopped to deleted; password/session denial and run
keyring pruning were verified. The isolated mcp_interactions_proof_20261004 and
mcp_cleanup_proof_20261004 databases had no active connections before removal.
The registered private artifacts were removed only after formal evidence was
preserved in the original project's ignored output/evaluation directories:
user-mcp-interactions-20261004 (earlier implementation/transport proof) and
capir-test-create-20261004 (final deployed chat/catalog/login/cleanup proof).
Real accounts, resident Nango/DB services and immutable current/rollback releases
remain. Historical checkpoints above retain their original scope and are
superseded by this completion record.
