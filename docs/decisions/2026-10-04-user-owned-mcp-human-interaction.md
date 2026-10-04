# User-owned MCP and durable human participation

Status: accepted, 2026-10-04. Plan stays active until real deployment proof.

## Context

Users want their own remote MCP servers (documentation, workspace tools)
available to the personal Agent, without granting the model any external
execution authority. Remote descriptors are untrusted: a `readOnlyHint` is
advertising, not authorization. Humans decide across refresh and devices, so
decisions must be durable state, not UI snapshots.

## Choice

1. One durable typed request envelope (`mcp_interaction_requests`, call id
   bound to `mcp_tool_calls`) owns every human participation kind: exact
   tool-call approval, choice, form, transient secret, and Nango-mediated
   OAuth. Renderers own no authority and reload the canonical row.
2. Approvals are single-use and bind the exact validated arguments
   byte-for-byte. Secret-shaped parameters are rejected, never rewritten;
   secret values live only in the consuming transaction and the outgoing
   request. Execution is claimed atomically, runs outside long database locks,
   and settles a public receipt with provenance. An unreadable outcome after
   send is `outcome_unknown`, never retried.
3. Adding a connection runs the real `initialize`/`initialized`/`tools/list`
   handshake before the request settles; a saved row is not success. Endpoint,
   credential and disconnect changes bump the connection revision and
   invalidate stale approvals.
4. The ordinary workspace Agent gains the `mcp_connections` tool (list,
   connect, propose_add, propose_call, propose_choice, read_receipt) on the
   existing host tool seam. Staged references ride answer blocks and Session
   parts; resolved results re-enter the same queued conversation so the Agent
   continues the original task.
5. OAuth is optional and Nango-mediated: server-generated `connect_request_id`
   tags bind identity and the approved URL; HMAC webhooks plus the
   credential-free `GET /connections` readback (production envelope
   `{ "connections": [...] }`) verify completion; calls travel through the
   frozen Nango proxy with `Retries: 0`. Missing configuration is an explicit
   unavailable state.

## Consequences

- The schema validator only decides a bounded structural subset; unsupported
  schemas fail closed instead of being guessed.
- Crashed `submitting` resolutions expire truthfully instead of resurrecting.
- Nango is deployment infrastructure with its own secret group (`/nango`);
  the backend consumes only four optional fields.

## Reconsideration signals

- If MCP elicitation becomes a supported product path, the choice/form kinds
  can host it with the same envelope instead of new transport.
- If real usage shows long-lived approvals matter, expiry policy can widen
  without changing the single-use, exact-bound claim.
