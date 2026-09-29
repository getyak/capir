# Extensions workspace and quiet navigation

## Outcome

Replace the primary Sources destination with Extensions, following the rendered
OpenDesign direction switch and connection rows. Correct the account language
row, recent-session empty state and Sessions directory rather than reskinning
unrelated pages. Preserve source intake and provenance through utility links.

## Baseline and ownership

Base ecf97afa, clean isolated parent worktree codex/extensions-workspace.
Reference handoff fetched; source app.tsx contains inbound/outbound switch and
client configuration dialogs, while its transport/auth are explicitly mock.
Parent owns shell navigation, account menu, Sessions presentation, synthesis,
rendered review and deployment. Pi task 20260920-191340-aa9019cd owns scoped
backend/contracts/MCP API and extension page in its own worktree. No other
Talent Signal Pi writer was active at dispatch. Unrelated IMStage worker stays
untouched. Only owned artifacts may be cleaned.

## Architecture and limits

Persistent account-scoped connection and client-grant records live in PostgreSQL.
Incoming connections use bounded Streamable HTTP discovery, with encrypted
credential storage, guarded destinations, real handshake status and disconnect.
Discovery does not auto-authorize tool invocation or pass candidate evidence.
Outgoing clients receive dedicated expiring scoped tokens, stored hashed,
revealed once and individually revocable. Stateless MCP supports only governed
read tools, with current authorization on every call. Login credentials are not
exported. OAuth and stdio are not implied by a configuration screen.

## Milestones

1. Complete: real MCP implementation and parent shell refinements.
2. Complete: integration, isolated protocol/persistence tests and independent review.
3. Complete: reference/UI comparison, narrow/dark/keyboard and real browser states.
4. Pending: exact-head CI, merge, immutable deployment and actual service readback.

## Verification

Prove account separation, token expiry/revocation/scope, SSRF/redirect/DNS/response
bounds, error and in-flight disconnect behavior. Run genuine protocol roundtrip
with isolated synthetic services and meaningful database tests. No production
candidate fixtures or automatically granted external clients. Distinguish saved
configuration, verified connectivity and permitted tool execution in UI.

Check language icon alignment, accessible full-row conversation history link,
no empty placeholder clutter, reachable extensions in collapsed/mobile rails,
and calm Sessions empty/error states. User acceptance is not established by an
invented 95-point self-score.

## Review checkpoint

Parent shell/navigation SSR tests: 43 passed; Web typecheck, lint and docs checks
passed before MCP integration. Actual component preview was compared with the
local handoff at 1280px; 375px DOM reports no horizontal overflow. Synthetic
preview is presentation evidence, not authenticated production acceptance.

An isolated PostgreSQL 18 instance passed the initial five MCP persistence tests.
An independent official TypeScript SDK probe passed client-to-server
initialize/list/call and server-to-client JSON and SSE discovery. The SDK probe
is disposable acceptance tooling, not a production dependency.

Independent review identified three P1s (credential reuse across endpoint
changes, remote errors leaking bearer secrets, inactive member grants) and two
P2s (version negotiation and incomplete deadlines). Pi was resumed with exact
regression requirements. Parent additionally owns accountManagement.ts and the
account lifecycle regression: suspending or changing a member role permanently
revokes their MCP grants, so reinstatement cannot resurrect tokens. Two real
PostgreSQL lifecycle tests passed. Existing account evaluation expected audit
shape was updated accordingly. No production grant has been created.

## Combined verification

Pi was frozen after its second review iteration. Its final runner status was
scope-failed only because the explicitly approved migration manifest was absent
from the original path allowlist; no implementation failure was inferred from
that status. All 37 worker files were inspected and integrated into the parent.

Independent review closed all confirmed P1/P2 findings. Added strict JSON-RPC
response identity, complete pagination, Unicode normalization, credential
redaction before truncation, bounded normalized metadata and one DNS/handshake
deadline. Seven boundary regression tests and the two account lifecycle tests
pass. Lifecycle tests use a bounded dedicated pool; the first parallel run hit
its former five-second fixture timeout and was not counted as passing.

Web full suite after correcting an obsolete Sources navigation assertion:
869 passed, one pre-existing skip. Combined backend MCP and account lifecycle
suite: 92 passed. Focused helper/chrome tests passed (8). Web and backend typechecks,
Web lint and documentation/architecture checks passed. The migration freeze was
advanced to 76 after inspecting the additive schema. Production build passed using synthetic build-only authentication settings;
the first attempt correctly refused missing AUTH_SECRET.

Real isolated browser acceptance (Web 3085, backend 3086, official SDK server
3087, disposable PostgreSQL) passed: password sign-in, add server, 401 state,
edit bearer credential, real initialize/list discovery, tool expansion, reload
persistence, create scoped client token, Escape protection, explicit close,
reload persistence, revoke client, disconnect server and clear credential/tools.
No production identity or grant was used. Official SDK interop again passed
both JSON and SSE discovery and client initialize/list/call against the combined
implementation. Desktop rendered account menu was corrected for long workspace
names (clientWidth=scrollWidth=234); language icon and row alignment checked.

Remaining: latest-head CI and merged revision deployment/readback.

## 2026-09-30 authenticated Web checkpoint

Observed the deployed e3f5a96d Web in Chrome on the Tailnet origin using the
existing signed-in session. Desktop/light account security, account menu,
Extensions inbound empty state and outbound client empty state rendered.
The account language globe and history entry were present; both extension
modes were reachable without creating a connection, token or authorization.
No source conversation was opened and no private screenshots were persisted.
A initially blank restored settings tab recovered after browser reload; the
cause is not established, and route network continuity is not certified.

Confirmed craft deduction: ordinary Web account controls incorrectly announced
an external default-browser handoff and a separate application login session.
The small correction keeps that explanation and external arrow only for native
hosts; Web keeps its existing settings destination and a plain account label.
Independent code review found no confirmed P0/P1/P2 issues. Runtime acceptance
of the corrected build is pending. Narrow, dark, keyboard, failure and expired
states remain unverified for this checkpoint; no 95-point score is assigned.
