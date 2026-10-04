import { randomUUID } from "node:crypto";

import type {
  McpAuthMode,
  McpCallOutcome,
  McpConnection,
  McpInteractionKind,
  McpInteractionRequest,
  McpInteractionResponse,
  McpInteractionListResponse,
  McpInteractionResolveRequest,
  McpToolCallProposeRequest,
  McpConnectionProposeRequest,
  McpHumanResult,
  McpToolCallReceipt,
} from "@talent-signal/contracts";
import { CONTRACT_VERSION, MCP_CONNECTION_ERROR_CODE_SET } from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import { inTransaction, type DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import { digestValue, sha256 } from "../lib/hash.js";
import { claimIdempotency, completeIdempotency, type IdempotencyClaim } from "../lib/idempotency.js";
import type { AuthContext } from "./auth.js";
import {
  performMcpHandshake,
  performMcpToolCall,
  mcpErrorCodeMessage,
  type McpToolCallInput,
  type McpToolCallResult,
} from "./mcpClient.js";
import {
  connectMcpConnection,
  createMcpConnection,
  type McpInboundDependencies,
} from "./mcpConnections.js";
import {
  McpTransportError,
  mcpPinnedExchange,
  type McpExchangeInput,
  type McpExchangeResponse,
} from "./mcpHttp.js";
import {
  assertSupportedInputSchema,
  displayJson,
  redactKnownSecrets,
  redactSecrets,
  sha256Hex,
  validateToolArguments,
} from "./mcpSchema.js";
import {
  decryptMcpCredential,
  encryptMcpCredential,
  loadMcpEncryptionKey,
  parseAllowedMcpOrigins,
  resolveMcpServerUrl,
  McpUrlRejectedError,
  type McpEncryptionKey,
  type McpResolvedTarget,
  type McpUrlPolicy,
} from "./mcpSecurity.js";
import {
  createNangoConnectSession,
  loadNangoConfig,
  NangoProxyOverflowError,
  nangoProxyPost,
  newConnectRequestId,
  listNangoConnectionsByTag,
  verifyNangoWebhookSignature,
  type NangoAuthWebhook,
  type NangoConfig,
  type NangoConnectionMetadata,
  NANGO_CONNECT_REQUEST_TAG,
} from "./nango.js";
import { labWorkspaceSessionActiveSQL } from "./labWorkspaceAccess.js";
import { assertConversationQueueOwnedClaim } from "./conversationQueueState.js";
import { recordOauthCleanup } from "./mcpOauthCleanup.js";
import { mcpDirectoryEntry } from "./mcpDirectory.js";

/**
 * Durable user-owned MCP human interactions.
 *
 * A staged request is the canonical record a card reads on every reload. An
 * approval binds exactly the staged arguments: the human can approve, reject
 * or choose, but cannot silently change what will execute. Execution is
 * claimed atomically once, runs outside any long database lock, and settles a
 * public receipt. A sent request whose outcome cannot be read settles as
 * `outcome_unknown` and is never retried. Secret values exist only inside the
 * consuming transaction and the outgoing request; every persisted, logged, or
 * model-visible surface is redacted.
 */

export const MCP_INTERACTION_TTL_MS = 60 * 60 * 1000;
export const MCP_TOOL_CALL_TIMEOUT_MS = 15_000;

const INTERACTION_COLUMNS = `account_id, id, created_by_user_id, call_id, kind, state,
  purpose, target, arguments_display, argument_schema, schema_unsupported_reason,
  choices, oauth, session_id, message_id, bound_arguments, arguments_hash,
  connection_id, connection_revision, schema_hash, resolution_display,
  resolved_by_user_id, resolved_at, expires_at, revision, created_at, updated_at`;

const TOOL_CALL_COLUMNS = `account_id, id, request_id, created_by_user_id, connection_id,
  connection_revision, tool_name, arguments, arguments_hash, schema_hash, state,
  claim_id, claimed_at, executed_at, is_error, error_code, result_summary,
  result_json, protocol_version, revision, created_at, updated_at`;

interface InteractionRow {
  account_id: string;
  arguments_display: string;
  arguments_hash: string | null;
  argument_schema: string | null;
  bound_arguments: string | null;
  call_id: string;
  choices: unknown;
  connection_id: string | null;
  connection_revision: number | null;
  created_at: Date;
  created_by_user_id: string;
  expires_at: Date;
  id: string;
  kind: McpInteractionKind;
  message_id: string | null;
  oauth: unknown;
  purpose: string;
  resolution_display: string | null;
  resolved_at: Date | null;
  resolved_by_user_id: string | null;
  revision: number;
  schema_hash: string | null;
  schema_unsupported_reason: string | null;
  session_id: string | null;
  state: McpInteractionRequest["state"];
  target: unknown;
  updated_at: Date;
}

interface ToolCallRow {
  account_id: string;
  arguments: string;
  arguments_hash: string;
  claimed_at: Date | null;
  claim_id: string | null;
  connection_id: string | null;
  connection_revision: number;
  created_at: Date;
  created_by_user_id: string;
  error_code: string | null;
  executed_at: Date | null;
  id: string;
  is_error: boolean;
  protocol_version: string | null;
  request_id: string;
  result_json: string | null;
  result_summary: string | null;
  revision: number;
  schema_hash: string | null;
  state: McpCallOutcome;
  tool_name: string;
  updated_at: Date;
}

/**
 * Server-owned staging authority: the live conversation-queue run claim from
 * the Runner's own fence. Staging inside a run validates this fence in the
 * same transaction; there is no string-format trust and no client-supplied
 * flag. Human ingress (no authority) always revalidates a real live login
 * session.
 */
export interface McpStagingAuthority {
  fence: import("./conversationQueueState.js").ConversationQueueRunFence;
  sessionId: string;
  messageId: string;
}

export interface McpInteractionContinuation {
  auth: AuthContext;
  sessionId: string;
  /** Stable queue identity: the same intent always reuses this message id. */
  messageId: string;
  /** Stable queue idempotency key: exactly-once admission across retries. */
  idempotencyKey: string;
  text: string;
  /** Host-only typed human result; never a user-authored claim. */
  result: McpHumanResult;
}

export interface McpInteractionDependencies {
  performCall?: (input: McpToolCallInput) => Promise<McpToolCallResult>;
  exchange?: typeof mcpPinnedExchange;
  encryptionKey?: McpEncryptionKey | null;
  allowedOrigins?: string[];
  resolver?: McpUrlPolicy["resolver"];
  allowInsecureTls?: boolean;
  requestTtlMs?: number;
  toolCallTimeoutMs?: number;
  /** Production continuation: re-enter the same conversation with the result. */
  continueConversation?: (input: McpInteractionContinuation) => Promise<void>;
  nangoConfig?: NangoConfig | null;
  fetcher?: typeof fetch;
  randomId?: () => string;
}

export function mcpInteractionDependencies(
  overrides: McpInteractionDependencies = {},
): McpInteractionDependencies {
  return {
    allowInsecureTls: false,
    allowedOrigins: parseAllowedMcpOrigins(),
    encryptionKey: loadMcpEncryptionKey(),
    nangoConfig: loadNangoConfig(),
    performCall: performMcpToolCall,
    requestTtlMs: MCP_INTERACTION_TTL_MS,
    toolCallTimeoutMs: MCP_TOOL_CALL_TIMEOUT_MS,
    ...overrides,
  };
}

function randomId(overrides: McpInteractionDependencies): string {
  return (overrides.randomId ?? randomUUID)();
}

function targetRecord(row: InteractionRow): McpInteractionRequest["target"] {
  const raw = (row.target ?? {}) as Record<string, unknown>;
  return {
    auth_mode:
      raw.auth_mode === "bearer" || raw.auth_mode === "oauth" || raw.auth_mode === "anonymous"
        ? raw.auth_mode
        : null,
    connection_id: row.connection_id,
    connection_label: String(raw.connection_label ?? "MCP server").slice(0, 120),
    server_origin: String(raw.server_origin ?? "").slice(0, 240),
    tool_name:
      typeof raw.tool_name === "string" ? raw.tool_name.slice(0, 128) : null,
  };
}

function choicesRecord(row: InteractionRow): McpInteractionRequest["choices"] {
  if (!Array.isArray(row.choices)) return [];
  return row.choices.flatMap((item) => {
    const value = item as Record<string, unknown>;
    if (typeof value?.id !== "string" || typeof value?.label !== "string") return [];
    return [
      {
        id: value.id.slice(0, 120),
        label: value.label.slice(0, 240),
        ...(typeof value.description === "string"
          ? { description: value.description.slice(0, 800) }
          : {}),
      },
    ];
  });
}

function oauthRecord(row: InteractionRow): McpInteractionRequest["oauth"] {
  const raw = row.oauth as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return null;
  return {
    available: raw.available === true,
    connect_request_id: String(raw.connect_request_id ?? "").slice(0, 120),
    connect_url:
      typeof raw.connect_url === "string" && raw.connect_url.startsWith("https://")
        ? raw.connect_url.slice(0, 2_048)
        : null,
    provider: String(raw.provider ?? "").slice(0, 80),
  };
}

function receiptRecord(row: ToolCallRow | null): McpToolCallReceipt | null {
  if (!row) return null;
  const outcome = row.state;
  return {
    call_id: row.id,
    connection_id: row.connection_id,
    error_code:
      row.error_code && MCP_CONNECTION_ERROR_CODE_SET.has(row.error_code)
        ? row.error_code
        : row.error_code
          ? "MCP_HANDSHAKE_FAILED"
          : null,
    executed_at: row.executed_at?.toISOString() ?? null,
    is_error: row.is_error,
    outcome,
    request_id: row.request_id,
    result_json: row.result_json,
    result_summary: row.result_summary,
    server_origin: "",
    source: {
      connection_id: row.connection_id,
      kind: "mcp_tool_result",
      protocol_version: row.protocol_version,
      server_origin: "",
      tool_name: row.tool_name,
    },
    tool_name: row.tool_name,
  };
}

function interactionRecord(
  row: InteractionRow,
  callRow: ToolCallRow | null,
): McpInteractionRequest {
  // A receipt exists only after execution settled. A pending or claimed call
  // is not a result and must never be rendered as one.
  const settled =
    callRow &&
    (callRow.state === "succeeded" ||
      callRow.state === "failed" ||
      callRow.state === "outcome_unknown")
      ? callRow
      : null;
  const receipt = receiptRecord(settled);
  const target = targetRecord(row);
  return {
    arguments_display: row.arguments_display,
    argument_schema: row.argument_schema,
    call_id: row.call_id,
    choices: choicesRecord(row),
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    id: row.id,
    kind: row.kind,
    message_id: row.message_id,
    oauth: oauthRecord(row),
    purpose: row.purpose,
    receipt: receipt
      ? {
          ...receipt,
          server_origin: target.server_origin,
          source: { ...receipt.source, server_origin: target.server_origin },
        }
      : null,
    resolved_at: row.resolved_at?.toISOString() ?? null,
    revision: row.revision,
    schema_unsupported_reason: row.schema_unsupported_reason,
    session_id: row.session_id,
    state: row.state,
    target,
    updated_at: row.updated_at.toISOString(),
  };
}

/** Re-derive authority inside the transaction before any state change. */
async function assertInteractionAuthority(
  client: PoolClient,
  auth: AuthContext,
  authority?: McpStagingAuthority,
): Promise<void> {
  const account = await client.query(
    "SELECT id FROM accounts WHERE id = $1 FOR UPDATE",
    [auth.accountId],
  );
  if (!account.rowCount) {
    throw new ApiError(
      401,
      "MCP_INTERACTION_SCOPE_MISMATCH",
      "The workspace is no longer available.",
    );
  }
  const user = await client.query<{ status: string }>(
    "SELECT status FROM users WHERE account_id = $1 AND id = $2 FOR SHARE",
    [auth.accountId, auth.userId],
  );
  if (user.rows[0]?.status !== "active") {
    throw new ApiError(
      401,
      "MCP_INTERACTION_SCOPE_MISMATCH",
      "The acting member is no longer active.",
    );
  }
  if (authority) {
    // Host staging authority is the live queue run claim itself: the same
    // transaction revalidates entry, run, lease generation and cancel state,
    // and binds the claiming user. A fabricated or stale AuthContext, an old
    // run, an expired lease or a canceled/reclaimed entry mints nothing.
    if (
      authority.fence.accountId !== auth.accountId ||
      authority.fence.sessionId !== authority.sessionId
    ) {
      throw new ApiError(
        409,
        "MCP_INTERACTION_SCOPE_MISMATCH",
        "This run claim does not bind the acting workspace.",
      );
    }
    try {
      const claim = await assertConversationQueueOwnedClaim(client, authority.fence, {
        allowCancelRequested: false,
      });
      if (claim.cancelRequested) {
        throw new ApiError(
          409,
          "MCP_INTERACTION_SCOPE_MISMATCH",
          "This run was stopped; it can no longer stage requests.",
        );
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        409,
        "MCP_INTERACTION_SCOPE_MISMATCH",
        "This run claim is no longer owned; it can no longer stage requests.",
      );
    }
    const entry = await client.query<{ created_by_user_id: string; message_id: string }>(
      `SELECT created_by_user_id, message_id FROM conversation_queue_entries
       WHERE account_id = $1 AND id = $2 AND session_id = $3 AND run_id = $4`,
      [auth.accountId, authority.fence.entryId, authority.fence.sessionId, authority.fence.runId],
    );
    if (
      !entry.rowCount ||
      entry.rows[0]!.created_by_user_id !== auth.userId ||
      entry.rows[0]!.message_id !== authority.messageId
    ) {
      throw new ApiError(
        409,
        "MCP_INTERACTION_SCOPE_MISMATCH",
        "This run claim does not bind the acting user's message.",
      );
    }
    return;
  }
  // Human ingress: a real live login session is always revalidated. A
  // fabricated or non-session context never mints staging authority.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      auth.sessionId,
    )
  ) {
    throw new ApiError(
      401,
      "MCP_INTERACTION_SCOPE_MISMATCH",
      "The acting session is no longer active.",
    );
  }
  const session = await client.query(
    `SELECT 1 FROM sessions
     JOIN users ON users.account_id = sessions.account_id
       AND users.id = sessions.user_id
     WHERE sessions.id = $3
       AND sessions.account_id = $1
       AND sessions.user_id = $2
       AND sessions.revoked_at IS NULL
       AND sessions.expires_at > clock_timestamp()
       AND users.status = 'active'
       AND ${labWorkspaceSessionActiveSQL}
     FOR SHARE OF sessions`,
    [auth.accountId, auth.userId, auth.sessionId],
  );
  if (!session.rowCount) {
    throw new ApiError(
      401,
      "MCP_INTERACTION_SCOPE_MISMATCH",
      "The acting session is no longer active.",
    );
  }
}

/**
 * Private conversation scope: a request is readable only by its account AND
 * the human who owns the conversation it was staged for. A shared directory
 * connection never implies shared private interactions; the same human may
 * still restore their own requests from any live device session.
 */
async function readInteraction(
  client: DatabaseClient,
  accountId: string,
  id: string,
  ownerUserId: string,
  forUpdate = false,
): Promise<InteractionRow | null> {
  const result = await client.query<InteractionRow>(
    `SELECT ${INTERACTION_COLUMNS} FROM mcp_interaction_requests r
     WHERE r.account_id = $1 AND r.id = $2 AND r.created_by_user_id = $3
       AND (r.session_id IS NULL OR EXISTS (
         SELECT 1 FROM agent_sessions s
         WHERE s.account_id = r.account_id AND s.id = r.session_id
           AND s.created_by_user_id = r.created_by_user_id
           AND s.deleted_at IS NULL AND s.expires_at > clock_timestamp()))${
       forUpdate ? " FOR UPDATE OF r" : ""
     }`,
    [accountId, id, ownerUserId],
  );
  return result.rows[0] ?? null;
}

/**
 * Internal settlement read: account+owner scoped but independent of public
 * read visibility, so a dispatched effect always settles its truthful outcome
 * even after the parent conversation session was deleted. It never restores
 * scrubbed content.
 */
async function readInteractionInternal(
  client: DatabaseClient,
  accountId: string,
  id: string,
  ownerUserId: string,
  forUpdate = false,
): Promise<InteractionRow | null> {
  const result = await client.query<InteractionRow>(
    `SELECT ${INTERACTION_COLUMNS} FROM mcp_interaction_requests
     WHERE account_id = $1 AND id = $2 AND created_by_user_id = $3${
       forUpdate ? " FOR UPDATE" : ""
     }`,
    [accountId, id, ownerUserId],
  );
  return result.rows[0] ?? null;
}

/**
 * Parent-live guard for settlement, taken under the SAME lock order the
 * deletion/retention scrub uses (session row first, then request rows), so a
 * concurrent deletion can never interleave between the liveness read and the
 * private writes: deleted private data cannot regrow under races.
 *
 * A NULL session is the legitimate page/directory scope, not a deleted
 * conversation: its genuine bounded redacted results are preserved.
 */
async function lockParentSessionForSettlement(
  client: DatabaseClient,
  accountId: string,
  sessionId: string | null,
): Promise<boolean> {
  if (sessionId === null) return true;
  const row = await client.query(
    `SELECT 1 FROM agent_sessions
     WHERE account_id = $1 AND id = $2
       AND deleted_at IS NULL AND expires_at > clock_timestamp()
     FOR SHARE`,
    [accountId, sessionId],
  );
  return Boolean(row.rowCount);
}

async function readToolCall(
  client: DatabaseClient,
  accountId: string,
  id: string,
  ownerUserId: string,
  forUpdate = false,
): Promise<ToolCallRow | null> {
  const result = await client.query<ToolCallRow>(
    `SELECT ${TOOL_CALL_COLUMNS} FROM mcp_tool_calls
     WHERE account_id = $1 AND id = $2 AND created_by_user_id = $3${
       forUpdate ? " FOR UPDATE" : ""
     }`,
    [accountId, id, ownerUserId],
  );
  return result.rows[0] ?? null;
}

/** Lazy expiry: a stale request is truthfully expired before any read. */
async function expireIfStale(
  client: DatabaseClient,
  row: InteractionRow,
): Promise<InteractionRow> {
  // Request TTL covers only undecided requests. A request already claimed for
  // execution keeps its truthful in-flight state until the real outcome (or
  // the abandoned-claim recovery) settles it; expiry can never swallow a
  // dispatched effect.
  if (
    (row.state === "waiting" || row.state === "pending") &&
    row.expires_at.getTime() <= Date.now()
  ) {
    const updated = (
      await client.query<InteractionRow>(
        `UPDATE mcp_interaction_requests
         SET state = 'expired', resolved_at = clock_timestamp(),
             resolution_display = 'expired', revision = revision + 1,
             updated_at = clock_timestamp()
         WHERE account_id = $1 AND id = $2
           AND state IN ('waiting','pending')
         RETURNING ${INTERACTION_COLUMNS}`,
        [row.account_id, row.id],
      )
    ).rows[0];
    if (updated && updated.kind === "oauth") {
      // Reject/expiry terminalizes the pending connect attempt so a late
      // completion can never claim it, and keeps its frozen identity for
      // safe external cleanup.
      await recordAttemptCleanup(client, updated, "session_ended");
      await client.query(
        `UPDATE mcp_oauth_connect_requests
         SET state = 'expired', revision = revision + 1, updated_at = clock_timestamp()
         WHERE account_id = $1 AND id = $2 AND state IN ('pending','waiting')
           AND nango_connection_id IS NULL`,
        [row.account_id, row.id],
      );
    }
    return updated ?? row;
  }
  return row;
}

interface ConnectionRow {
  auth_mode: McpAuthMode;
  credential_ciphertext: string | null;
  friendly_name: string;
  id: string;
  nango_connection_id: string | null;
  nango_provider: string | null;
  revision: number;
  server_url: string;
  status: McpConnection["status"];
  discovered_tools: unknown;
}

const CONNECTION_LOOKUP_COLUMNS = `id, friendly_name, server_url, credential_ciphertext,
  status, discovered_tools, revision, auth_mode, nango_connection_id, nango_provider`;

async function readConnection(
  client: DatabaseClient,
  accountId: string,
  id: string,
): Promise<ConnectionRow | null> {
  const result = await client.query<ConnectionRow>(
    `SELECT ${CONNECTION_LOOKUP_COLUMNS} FROM mcp_connections
     WHERE account_id = $1 AND id = $2`,
    [accountId, id],
  );
  return result.rows[0] ?? null;
}

function discoveredTool(
  connection: ConnectionRow,
  toolName: string,
): { name: string; input_schema: string | null; read_only: boolean } | null {
  if (!Array.isArray(connection.discovered_tools)) return null;
  for (const item of connection.discovered_tools) {
    const value = item as Record<string, unknown>;
    if (value?.name !== toolName) continue;
    const schema =
      typeof value.input_schema === "string"
        ? value.input_schema
        : typeof value.inputSchema === "string"
          ? value.inputSchema
          : null;
    return {
      input_schema: schema,
      name: toolName,
      read_only: value.read_only === true,
    };
  }
  return null;
}

function validatedUrl(raw: string, dependencies: McpInteractionDependencies) {
  return resolveMcpServerUrl(raw, {
    allowedOrigins: dependencies.allowedOrigins ?? [],
    ...(dependencies.resolver ? { resolver: dependencies.resolver } : {}),
  });
}

function safeOrigin(target: McpResolvedTarget): string {
  return target.origin.slice(0, 240);
}

/**
 * Every staging producer must bind to a real conversation the acting human
 * owns: the session must be theirs and the message must belong to that same
 * session. Wrong, deleted or foreign associations are rejected before
 * anything is staged.
 */
async function assertConversationBinding(
  client: DatabaseClient,
  auth: AuthContext,
  sessionId: string | undefined,
  messageId: string | undefined,
  authority?: McpStagingAuthority,
): Promise<void> {
  if (authority) {
    // Host staging may only bind the exact conversation and message of its
    // own live run claim.
    if (sessionId !== authority.sessionId || messageId !== authority.messageId) {
      throw new ApiError(
        409,
        "MCP_INTERACTION_SCOPE_MISMATCH",
        "This staged request does not bind this run's conversation message.",
      );
    }
    return;
  }
  if (!sessionId) {
    if (messageId) {
      throw new ApiError(
        422,
        "MCP_INTERACTION_SCOPE_MISMATCH",
        "A staged request cannot bind a message without its conversation session.",
      );
    }
    return;
  }
  const session = await client.query(
    `SELECT 1 FROM agent_sessions
     WHERE account_id = $1 AND id = $2 AND created_by_user_id = $3
       AND deleted_at IS NULL AND expires_at > clock_timestamp()`,
    [auth.accountId, sessionId, auth.userId],
  );
  if (!session.rowCount) {
    throw new ApiError(
      409,
      "MCP_INTERACTION_SCOPE_MISMATCH",
      "This conversation session is not yours or is no longer available.",
    );
  }
  if (messageId) {
    const message = await client.query(
      `SELECT 1 FROM conversation_queue_entries
       WHERE account_id = $1 AND session_id = $2 AND message_id = $3`,
      [auth.accountId, sessionId, messageId],
    );
    if (!message.rowCount) {
      throw new ApiError(
        422,
        "MCP_INTERACTION_SCOPE_MISMATCH",
        "This message does not belong to that conversation session.",
      );
    }
  }
}

/**
 * Stages one exact tool-call approval. The arguments are validated against the
 * original discovered input schema before anything is shown to the human, and
 * the exact bound arguments are persisted for a single-use approval.
 */
export async function proposeMcpToolCall(
  pool: Pool,
  auth: AuthContext,
  input: McpToolCallProposeRequest,
  dependencies: McpInteractionDependencies = mcpInteractionDependencies(),
  authority?: McpStagingAuthority,
): Promise<McpInteractionResponse> {
  let target: McpResolvedTarget;
  const requestId = randomId(dependencies);
  const callId = randomId(dependencies);
  return inTransaction(pool, async (client) => {
    await assertInteractionAuthority(client, auth, authority);
    await assertConversationBinding(client, auth, input.session_id, input.message_id, authority);
    const connection = await readConnection(client, auth.accountId, input.connection_id);
    if (!connection) {
      throw new ApiError(404, "MCP_CALL_TARGET_NOT_FOUND", "This connection no longer exists.");
    }
    if (connection.status !== "verified") {
      throw new ApiError(
        409,
        "MCP_CALL_CONNECTION_NOT_VERIFIED",
        "Connect the server before proposing a tool call.",
      );
    }
    const tool = discoveredTool(connection, input.tool_name);
    if (!tool) {
      throw new ApiError(
        404,
        "MCP_CALL_TARGET_NOT_FOUND",
        "This tool is not in the connection's current directory.",
      );
    }
    if (!tool.input_schema) {
      throw new ApiError(
        422,
        "MCP_INTERACTION_SCHEMA_UNSUPPORTED",
        "This tool's original input schema was not retained, so its arguments cannot be validated.",
      );
    }
    // An unsupported original schema fails closed with its own typed reason
    // (surfaced on the card), before any argument matching is attempted.
    try {
      assertSupportedInputSchema(JSON.parse(tool.input_schema));
    } catch {
      throw new ApiError(
        422,
        "MCP_INTERACTION_SCHEMA_UNSUPPORTED",
        "This tool's original input schema uses constructs this build cannot safely validate (for example regex patterns or unsupported formats).",
      );
    }
    const validated = validateToolArguments(tool.input_schema, input.arguments);
    if (!validated.ok) {
      throw new ApiError(
        422,
        "MCP_CALL_ARGUMENTS_INVALID",
        `${validated.message} (${validated.path})`,
      );
    }
    try {
      target = await validatedUrl(connection.server_url, dependencies);
    } catch (error) {
      if (error instanceof McpUrlRejectedError) {
        throw new ApiError(400, "MCP_ENDPOINT_REJECTED", error.message);
      }
      throw error;
    }
    const actor = { accountId: auth.accountId, actorUserId: auth.userId };
    const claim = await claimIdempotency(client, actor, "propose_mcp_tool_call", input.idempotency_key, {
      arguments_hash: sha256Hex(input.arguments),
      connection_id: input.connection_id,
      message_id: input.message_id ?? null,
      session_id: input.session_id ?? null,
      tool_name: input.tool_name,
    });
    if (claim.replay) return claim.replay.body as McpInteractionResponse;
    // Exact-bound approval: the validated arguments are stored byte-for-byte.
    // Secret-looking parameters are refused outright instead of being
    // silently rewritten, so no secret can enter storage, history,
    // idempotency or a model and every other approved value survives exactly.
    const parsedArguments = JSON.parse(input.arguments) as unknown;
    if (JSON.stringify(redactSecrets(parsedArguments)) !== JSON.stringify(parsedArguments)) {
      throw new ApiError(
        422,
        "MCP_CALL_SECRET_ARGUMENTS",
        "These tool arguments carry secret-looking fields or values. Remove them from the arguments; a secret is only ever typed by the user into a secret field.",
      );
    }
    const boundArguments = input.arguments;
    const schemaHash = sha256Hex(tool.input_schema);
    // A request must outlive its own creation instant, even under a caller
    // that asks for an effectively immediate expiry.
    const ttlMs = Math.max(dependencies.requestTtlMs ?? MCP_INTERACTION_TTL_MS, 1_000);
    const expiresAt = new Date(Date.now() + ttlMs);
    await client.query(
      `INSERT INTO mcp_interaction_requests(
         account_id, id, created_by_user_id, call_id, kind, state, purpose, target,
         arguments_display, argument_schema, choices, session_id, message_id,
         bound_arguments, arguments_hash, connection_id, connection_revision,
         schema_hash, expires_at
       ) VALUES ($1,$2,$3,$4,'approval','pending',$5,$6::jsonb,$7,$8,'[]'::jsonb,$9,$10,
         $11,$12,$13,$14,$15,$16)`,
      [
        auth.accountId,
        requestId,
        auth.userId,
        callId,
        input.purpose,
        JSON.stringify({
          auth_mode: connection.auth_mode,
          connection_label: connection.friendly_name,
          server_origin: safeOrigin(target),
          tool_name: input.tool_name,
        }),
        displayJson(validated.value, 6_000),
        tool.input_schema.slice(0, 20_000),
        input.session_id ?? null,
        input.message_id ?? null,
        boundArguments,
        sha256Hex(boundArguments),
        connection.id,
        connection.revision,
        schemaHash,
        expiresAt,
      ],
    );
    await client.query(
      `INSERT INTO mcp_tool_calls(
         account_id, id, request_id, created_by_user_id, connection_id,
         connection_revision, tool_name, arguments, arguments_hash, schema_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        auth.accountId,
        callId,
        requestId,
        auth.userId,
        connection.id,
        connection.revision,
        input.tool_name,
        boundArguments,
        sha256Hex(boundArguments),
        schemaHash,
      ],
    );
    await appendAudit(client, actor, "mcp_interaction.staged", "mcp_interaction_request", requestId, {
      arguments_hash: sha256Hex(boundArguments),
      call_id: callId,
      connection_id: connection.id,
      external_effect_count: 0,
      kind: "approval",
    });
    const row = await readInteraction(client, auth.accountId, requestId, auth.userId);
    const body: McpInteractionResponse = {
      contract_version: CONTRACT_VERSION,
      request: interactionRecord(row!, null),
    };
    await completeIdempotency(client, claim, 201, body);
    return body;
  });
}

/**
 * The normalized exact full endpoint (scheme, host, port and path). The bare
 * origin is used only for display, origin policy and Base-Url-Override; every
 * binding, storage and session default keeps this full endpoint so `/mcp` and
 * other nested paths survive.
 */
export function normalizedEndpoint(target: McpResolvedTarget): string {
  return target.url.href;
}

/** Endpoint identity comparison: origin plus normalized path. */
export function sameEndpoint(left: string, right: string): boolean {
  let a: URL;
  let b: URL;
  try {
    a = new URL(left);
    b = new URL(right);
  } catch {
    return false;
  }
  const trim = (u: URL) => `${u.origin}${u.pathname.replace(/\/+$/u, "")}`;
  return trim(a) === trim(b);
}

function boundedExpiry(raw: string | null | undefined): Date {
  const generic = new Date(Date.now() + MCP_INTERACTION_TTL_MS);
  if (!raw) return generic;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return generic;
  const now = Date.now();
  // The Nango session lifetime is authoritative for OAuth requests, bounded to
  // a sane window so neither an instant nor an unbounded expiry is accepted.
  return new Date(Math.min(Math.max(parsed, now + 60_000), now + 24 * 60 * 60 * 1000));
}

/**
 * Stages one connection proposal. `bearer` becomes a transient-secret request,
 * `anonymous` a form request, and `oauth` a Nango connect request when the
 * deployment configured Nango. OAuth is explicitly unavailable otherwise; no
 * fake connected state exists.
 */
export async function proposeMcpConnection(
  pool: Pool,
  auth: AuthContext,
  input: McpConnectionProposeRequest,
  dependencies: McpInteractionDependencies = mcpInteractionDependencies(),
  authority?: McpStagingAuthority,
): Promise<McpInteractionResponse> {
  let target: McpResolvedTarget;
  try {
    target = await validatedUrl(input.server_url, dependencies);
  } catch (error) {
    if (error instanceof McpUrlRejectedError) {
      throw new ApiError(400, error.code, error.message);
    }
    throw error;
  }
  // The exact full endpoint keeps its path; the bare origin never replaces it.
  const endpoint = normalizedEndpoint(target);
  const requestId = randomId(dependencies);
  const kind: McpInteractionKind =
    input.auth_mode === "oauth" ? "oauth" : input.auth_mode === "bearer" ? "secret" : "form";
  const connectRequestId =
    input.auth_mode === "oauth" ? newConnectRequestId() : null;
  const catalogEntry = mcpDirectoryEntry(input.directory_entry_id, (dependencies.nangoConfig ?? null) !== null);
  if (catalogEntry && !sameEndpoint(catalogEntry.server_url, endpoint)) {
    throw new ApiError(
      400,
      "MCP_ENDPOINT_REJECTED",
      "The staged URL does not match the directory entry; propose the exact approved URL.",
    );
  }
  const nangoProvider = catalogEntry?.nango_provider ?? "mcp-generic";
  let oauthPayload: Record<string, unknown> | null = null;
  let sessionExpiry: Date | null = null;
  if (input.auth_mode === "oauth") {
    const nango = dependencies.nangoConfig ?? null;
    if (!nango) {
      throw new ApiError(
        503,
        "MCP_OAUTH_UNAVAILABLE",
        "This deployment has not configured OAuth, so this server cannot be connected with OAuth yet.",
      );
    }
    const session = await createNangoConnectSession(
      nango,
      {
        accountId: auth.accountId,
        connectRequestId: connectRequestId!,
        provider: nangoProvider,
        sessionId: input.session_id ?? null,
        serverUrl: endpoint,
        userId: auth.userId,
      },
      dependencies.fetcher ?? fetch,
    );
    // The real session lifetime bounds the request: a short-lived connect
    // session must not leave a longer-lived pending authorization card.
    sessionExpiry = boundedExpiry(session.expiresAt);
    oauthPayload = {
      available: true,
      connect_request_id: connectRequestId,
      connect_url: session.connectLink,
      provider: nangoProvider,
    };
  }
  return inTransaction(pool, async (client) => {
    await assertInteractionAuthority(client, auth, authority);
    await assertConversationBinding(client, auth, input.session_id, input.message_id, authority);
    const actor = { accountId: auth.accountId, actorUserId: auth.userId };
    const claim = await claimIdempotency(client, actor, "propose_mcp_connection", input.idempotency_key, {
      auth_mode: input.auth_mode,
      message_id: input.message_id ?? null,
      server_endpoint: endpoint,
      session_id: input.session_id ?? null,
    });
    if (claim.replay) return claim.replay.body as McpInteractionResponse;
    const ttlMs = Math.max(dependencies.requestTtlMs ?? MCP_INTERACTION_TTL_MS, 1_000);
    const expiresAt = sessionExpiry ?? new Date(Date.now() + ttlMs);
    const targetDisplay = {
      auth_mode: input.auth_mode,
      connection_label: input.friendly_name,
      server_origin: safeOrigin(target),
      tool_name: null,
    };
    await client.query(
      `INSERT INTO mcp_interaction_requests(
         account_id, id, created_by_user_id, call_id, kind, state, purpose, target,
         arguments_display, argument_schema, choices, oauth, session_id, message_id,
         bound_arguments, expires_at
       ) VALUES ($1,$2,$3,$2,$4,'pending',$5,$6::jsonb,$7,NULL,'[]'::jsonb,$8::jsonb,$9,$10,
         $11,$12)`,
      [
        auth.accountId,
        requestId,
        auth.userId,
        kind,
        input.purpose,
        JSON.stringify(targetDisplay),
        displayJson(
          {
            auth_mode: input.auth_mode,
            friendly_name: input.friendly_name,
            server_url: endpoint,
          },
          6_000,
        ),
        oauthPayload ? JSON.stringify(oauthPayload) : null,
        input.session_id ?? null,
        input.message_id ?? null,
        JSON.stringify({
          auth_mode: input.auth_mode,
          friendly_name: input.friendly_name,
          server_url: endpoint,
        }),
        expiresAt,
      ],
    );
    if (oauthPayload && connectRequestId) {
      await client.query(
        `INSERT INTO mcp_oauth_connect_requests(
           connect_request_id, account_id, id, created_by_user_id, session_id,
           provider, mcp_server_url, expires_at, environment, broker_base_url,
           capability_expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          connectRequestId,
          auth.accountId,
          requestId,
          auth.userId,
          input.session_id ?? null,
          String(oauthPayload.provider),
          endpoint,
          expiresAt,
          // Frozen trusted broker facts and the ACTUAL returned session
          // expiry: provenance for later cleanup validation, never a closure
          // claim (the runtime does not validate TTL on a started callback).
          dependencies.nangoConfig?.environment ?? null,
          dependencies.nangoConfig?.baseUrl ?? null,
          sessionExpiry,
        ],
      );
    }
    await appendAudit(client, actor, "mcp_interaction.staged", "mcp_interaction_request", requestId, {
      external_effect_count: 0,
      kind,
      server_origin: safeOrigin(target),
    });
    const row = await readInteraction(client, auth.accountId, requestId, auth.userId);
    const body: McpInteractionResponse = {
      contract_version: CONTRACT_VERSION,
      request: interactionRecord(row!, null),
    };
    await completeIdempotency(client, claim, 201, body);
    return body;
  });
}

export interface McpChoiceOptionInput {
  id: string;
  label: string;
  description?: string;
}

export interface McpChoiceProposeRequest {
  purpose: string;
  options: McpChoiceOptionInput[];
  session_id?: string;
  message_id?: string;
  idempotency_key: string;
}

/**
 * Stages one bounded human choice (for example the authorization method for a
 * connection). The selected result re-enters the same conversation; staging
 * executes nothing.
 */
export async function proposeMcpChoice(
  pool: Pool,
  auth: AuthContext,
  input: McpChoiceProposeRequest,
  dependencies: McpInteractionDependencies = mcpInteractionDependencies(),
  authority?: McpStagingAuthority,
): Promise<McpInteractionResponse> {
  const options = input.options.slice(0, 6).map((option) => ({
    description: option.description ? option.description.slice(0, 800) : undefined,
    id: option.id.slice(0, 120),
    label: option.label.slice(0, 240),
  }));
  if (options.length < 2 || options.some((option) => !option.id || !option.label)) {
    throw new ApiError(
      422,
      "MCP_INTERACTION_INPUT_INVALID",
      "A choice needs two to six labelled options.",
    );
  }
  const requestId = randomId(dependencies);
  return inTransaction(pool, async (client) => {
    await assertInteractionAuthority(client, auth, authority);
    await assertConversationBinding(client, auth, input.session_id, input.message_id, authority);
    const actor = { accountId: auth.accountId, actorUserId: auth.userId };
    const claim = await claimIdempotency(client, actor, "propose_mcp_choice", input.idempotency_key, {
      message_id: input.message_id ?? null,
      option_ids: options.map((option) => option.id),
      session_id: input.session_id ?? null,
    });
    if (claim.replay) return claim.replay.body as McpInteractionResponse;
    const ttlMs = Math.max(dependencies.requestTtlMs ?? MCP_INTERACTION_TTL_MS, 1_000);
    await client.query(
      `INSERT INTO mcp_interaction_requests(
         account_id, id, created_by_user_id, call_id, kind, state, purpose, target,
         arguments_display, argument_schema, choices, session_id, message_id,
         bound_arguments, expires_at
       ) VALUES ($1,$2,$3,$2,'choice','pending',$4,$5::jsonb,$6,NULL,$7::jsonb,$8,$9,$10,$11)`,
      [
        auth.accountId,
        requestId,
        auth.userId,
        input.purpose,
        JSON.stringify({
          auth_mode: null,
          connection_label: "Choice",
          server_origin: "internal:choice",
          tool_name: null,
        }),
        displayJson({ options }, 6_000),
        JSON.stringify(options),
        input.session_id ?? null,
        input.message_id ?? null,
        JSON.stringify({ options }),
        new Date(Date.now() + ttlMs),
      ],
    );
    await appendAudit(client, actor, "mcp_interaction.staged", "mcp_interaction_request", requestId, {
      external_effect_count: 0,
      kind: "choice",
    });
    const row = await readInteraction(client, auth.accountId, requestId, auth.userId);
    const body: McpInteractionResponse = {
      contract_version: CONTRACT_VERSION,
      request: interactionRecord(row!, null),
    };
    await completeIdempotency(client, claim, 201, body);
    return body;
  });
}

export async function listMcpInteractions(
  pool: Pool,
  auth: AuthContext,
  options: { sessionId?: string | null } = {},
): Promise<McpInteractionListResponse> {
  const rows = await pool.query<InteractionRow>(
    `SELECT ${INTERACTION_COLUMNS} FROM mcp_interaction_requests r
     WHERE r.account_id = $1
       AND r.created_by_user_id = $2
       AND ($3::uuid IS NULL OR r.session_id = $3)
       AND (r.session_id IS NULL OR EXISTS (
         SELECT 1 FROM agent_sessions s
         WHERE s.account_id = r.account_id AND s.id = r.session_id
           AND s.created_by_user_id = r.created_by_user_id
           AND s.deleted_at IS NULL AND s.expires_at > clock_timestamp()))
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT 100`,
    [auth.accountId, auth.userId, options.sessionId ?? null],
  );
  const requests: McpInteractionRequest[] = [];
  for (const raw of rows.rows) {
    const row = await expireIfStale(pool, raw);
    const callRow = await readToolCall(pool, auth.accountId, row.call_id, auth.userId);
    requests.push(interactionRecord(row, callRow));
  }
  return { contract_version: CONTRACT_VERSION, requests };
}

export async function readMcpInteraction(
  pool: Pool,
  auth: AuthContext,
  id: string,
): Promise<McpInteractionResponse> {
  const current = await readInteraction(pool, auth.accountId, id, auth.userId);
  if (!current) {
    throw new ApiError(404, "MCP_INTERACTION_NOT_FOUND", "This request no longer exists.");
  }
  const row = await expireIfStale(pool, current);
  const callRow = await readToolCall(pool, auth.accountId, row.call_id, auth.userId);
  return {
    contract_version: CONTRACT_VERSION,
    request: interactionRecord(row, callRow),
  };
}

export async function readMcpToolCallReceipt(
  pool: Pool,
  auth: AuthContext,
  callId: string,
): Promise<McpToolCallReceipt | null> {
  const row = await readToolCall(pool, auth.accountId, callId, auth.userId);
  if (!row) return null;
  const request = await readInteraction(pool, auth.accountId, row.request_id, auth.userId);
  // A deleted or expired conversation session hides its private payloads and
  // receipts; only account-level accountability metadata survives.
  if (!request) return null;
  const target = targetRecord(request);
  const receipt = receiptRecord(row)!;
  return {
    ...receipt,
    server_origin: target?.server_origin ?? "",
    source: {
      ...receipt.source,
      server_origin: target?.server_origin ?? "",
    },
  };
}

interface ResolvedAction {
  body: McpInteractionResponse | null;
  execution: {
    callId: string;
    connection: ConnectionRow;
    argumentsText: string;
    toolName: string;
  } | null;
  connectionCreate: {
    friendly_name: string;
    server_url: string;
    bearer_secret: string | null;
  } | null;
  continuation: { sessionId: string; messageId: string | null; text: string } | null;
  /** Completed only after the post-commit effect settled. */
  claim: IdempotencyClaim | null;
}

/**
 * Resolves one human request. The human decision is bound exactly to the
 * staged record: approve executes exactly the staged arguments once, submit
 * consumes the transient secret, reject and expiry never execute anything.
 */
export async function resolveMcpInteraction(
  pool: Pool,
  auth: AuthContext,
  id: string,
  input: McpInteractionResolveRequest,
  dependencies: McpInteractionDependencies = mcpInteractionDependencies(),
): Promise<McpInteractionResponse> {
  // Idempotency identity never includes the secret or raw form values.
  const idempotencyIdentity = {
    action: input.action,
    choice_id: input.choice_id ?? null,
    expected_revision: input.expected_revision,
    secret_present: input.secret !== undefined && input.secret !== null,
    values_hash: input.values ? sha256Hex(input.values) : null,
  };
  const prepared = await inTransaction(pool, async (client): Promise<ResolvedAction> => {
    await assertInteractionAuthority(client, auth);
    const actor = { accountId: auth.accountId, actorUserId: auth.userId };
    // The canonical request and its live parent conversation are validated
    // BEFORE any replay: after deletion or retention a replay must never
    // return a pre-deletion snapshot.
    const current = await readInteraction(client, auth.accountId, id, auth.userId, true);
    if (!current) {
      throw new ApiError(404, "MCP_INTERACTION_NOT_FOUND", "This request no longer exists.");
    }
    const row = await expireIfStale(client, current);
    const claim = await claimIdempotency(
      client,
      actor,
      `resolve_mcp_interaction:${id}`,
      input.idempotency_key,
      idempotencyIdentity,
    );
    if (claim.replay) {
      const body = claim.replay.body as McpInteractionResponse;
      return {
        body,
        claim: null,
        connectionCreate: null,
        continuation: null,
        execution: null,
      };
    }
    // `row.session_id` names the conversation session that owns the staged
    // request and receives its continuation. Resolution may come from any live
    // login session of the same account (refresh and cross-device restore);
    // account, member and the acting login session were revalidated above.
    if (row.revision !== input.expected_revision) {
      throw new ApiError(
        409,
        "MCP_INTERACTION_CHANGED",
        "Read the current request before acting on it.",
      );
    }
    if (row.state === "expired") {
      throw new ApiError(409, "MCP_INTERACTION_EXPIRED", "This request has expired.");
    }
    if (row.state !== "pending" && row.state !== "waiting") {
      throw new ApiError(409, "MCP_INTERACTION_NOT_PENDING", "This request is no longer awaiting a decision.");
    }
    if (input.action === "reject") {
      const updated = (
        await client.query<InteractionRow>(
          `UPDATE mcp_interaction_requests
           SET state = 'rejected', resolved_at = clock_timestamp(),
               resolved_by_user_id = $3, resolution_display = 'rejected',
               revision = revision + 1, updated_at = clock_timestamp()
           WHERE account_id = $1 AND id = $2 AND revision = $4
           RETURNING ${INTERACTION_COLUMNS}`,
          [auth.accountId, id, auth.userId, input.expected_revision],
        )
      ).rows[0]!;
      if (row.kind === "oauth") {
        // The generic rejection branch is the actual production entry for
        // pending and waiting cards. Capture its durable late-grant watch in
        // the same transaction before closing the unbound capability.
        await recordAttemptCleanup(client, updated, "withdrawn");
        await client.query(
          `UPDATE mcp_oauth_connect_requests
           SET state = 'failed', revision = revision + 1, updated_at = clock_timestamp()
           WHERE account_id = $1 AND id = $2 AND state IN ('pending','waiting')
             AND nango_connection_id IS NULL`,
          [row.account_id, row.id],
        );
      }
      await enqueueContinuationIntent(
        client,
        updated,
        auth.userId,
        continuationText(updated, "rejected", null),
        humanResult(updated, auth.userId, "rejected"),
      );
      await appendAudit(client, actor, "mcp_interaction.rejected", "mcp_interaction_request", id, {
        external_effect_count: 0,
        kind: row.kind,
      });
      const body: McpInteractionResponse = {
        contract_version: CONTRACT_VERSION,
        request: interactionRecord(updated, null),
      };
      await completeIdempotency(client, claim, 200, body);
      return {
        body,
        claim: null,
        connectionCreate: null,
        continuation: row.session_id
          ? {
              messageId: row.message_id,
              sessionId: row.session_id,
              text: continuationText(row, "rejected", null),
            }
          : null,
        execution: null,
      };
    }

    let resolvedAction: ResolvedAction = {
      body: null,
      claim: null,
      connectionCreate: null,
      continuation: null,
      execution: null,
    };

    if (row.kind === "approval") {
      if (input.action !== "approve") {
        throw new ApiError(422, "MCP_INTERACTION_INPUT_INVALID", "This request is resolved by approving or rejecting it.");
      }
      const callRow = await readToolCall(client, auth.accountId, row.call_id, auth.userId, true);
      if (!callRow) {
        throw new ApiError(404, "MCP_CALL_TARGET_NOT_FOUND", "The staged tool call no longer exists.");
      }
      const connection = await readConnection(client, auth.accountId, callRow.connection_id!);
      if (!connection) {
        throw new ApiError(404, "MCP_CALL_TARGET_NOT_FOUND", "This connection no longer exists.");
      }
      // Credential, endpoint, disconnect or revision changes invalidate the
      // approval: the bound connection revision must still be current.
      if (connection.revision !== callRow.connection_revision) {
        await markTerminal(client, row, auth.userId, "failed", "stale_approval");
        await client.query(
          `UPDATE mcp_tool_calls SET state = 'failed', is_error = true,
             error_code = 'MCP_CALL_STALE_APPROVAL', executed_at = clock_timestamp(),
             revision = revision + 1, updated_at = clock_timestamp()
           WHERE account_id = $1 AND id = $2 AND state = 'pending'`,
          [auth.accountId, callRow.id],
        );
        const staleRow = await readInteraction(client, auth.accountId, id, auth.userId, true);
        if (staleRow) {
          await enqueueContinuationIntent(
            client,
            staleRow,
            auth.userId,
            continuationText(staleRow, "failed", null),
            humanResult(staleRow, auth.userId, "failed"),
          );
        }
        const body = await refreshBody(client, auth.accountId, auth.userId, id, callRow.id);
        await appendAudit(client, actor, "mcp_interaction.stale_approval", "mcp_interaction_request", id, {
          external_effect_count: 0,
          kind: row.kind,
        });
        await completeIdempotency(client, claim, 200, body);
        return {
          body,
          claim: null,
          connectionCreate: null,
          continuation: row.session_id
            ? {
                messageId: row.message_id,
                sessionId: row.session_id,
                text: continuationText(row, "failed", null),
              }
            : null,
          execution: null,
        };
      }
      if (callRow.state !== "pending") {
        throw new ApiError(409, "MCP_CALL_ALREADY_CLAIMED", "This approval was already used.");
      }
      const claimed = (
        await client.query<ToolCallRow>(
          `UPDATE mcp_tool_calls
           SET state = 'claimed', claim_id = $3, claimed_at = clock_timestamp(),
               revision = revision + 1, updated_at = clock_timestamp()
           WHERE account_id = $1 AND id = $2 AND state = 'pending'
           RETURNING ${TOOL_CALL_COLUMNS}`,
          [auth.accountId, callRow.id, randomId(dependencies)],
        )
      ).rows[0];
      if (!claimed) {
        throw new ApiError(409, "MCP_CALL_ALREADY_CLAIMED", "This approval was already used.");
      }
      await client.query(
        `UPDATE mcp_interaction_requests
         SET state = 'submitting', resolved_by_user_id = $3,
             resolution_display = 'approved', revision = revision + 1,
             updated_at = clock_timestamp()
         WHERE account_id = $1 AND id = $2 AND revision = $4`,
        [auth.accountId, id, auth.userId, input.expected_revision],
      );
      resolvedAction = {
        body: null,
        claim,
        connectionCreate: null,
        continuation: row.session_id
          ? {
              messageId: row.message_id,
              sessionId: row.session_id,
              text: "",
            }
          : null,
        execution: {
          argumentsText: claimed.arguments,
          connection,
          callId: claimed.id,
          toolName: claimed.tool_name,
        },
      };
    } else if (row.kind === "choice") {
      const choice = choicesRecord(row).find((item) => item.id === input.choice_id);
      if (!choice) {
        throw new ApiError(422, "MCP_INTERACTION_INPUT_INVALID", "Choose one of the offered options.");
      }
      const updated = await markTerminal(client, row, auth.userId, "submitted", `choice:${choice.id}`);
      await enqueueContinuationIntent(
        client,
        updated,
        auth.userId,
        continuationText(updated, "submitted", `The user chose: ${choice.label}`),
        humanResult(updated, auth.userId, "submitted", choice.id),
      );
      await appendAudit(client, actor, "mcp_interaction.submitted", "mcp_interaction_request", id, {
        choice_id: choice.id,
        external_effect_count: 0,
        kind: row.kind,
      });
      const body: McpInteractionResponse = {
        contract_version: CONTRACT_VERSION,
        request: interactionRecord(updated, null),
      };
      await completeIdempotency(client, claim, 200, body);
      return {
        body,
        claim: null,
        connectionCreate: null,
        continuation: row.session_id
          ? {
              messageId: row.message_id,
              sessionId: row.session_id,
              text: continuationText(row, "submitted", `The user chose: ${choice.label}`),
            }
          : null,
        execution: null,
      };
    } else if (row.kind === "form" || row.kind === "secret") {
      const bound = JSON.parse(row.bound_arguments ?? "{}") as {
        friendly_name?: unknown;
        server_url?: unknown;
        auth_mode?: unknown;
      };
      let values: { friendly_name?: string; server_url?: string } = {};
      if (input.values) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(input.values);
        } catch {
          throw new ApiError(422, "MCP_INTERACTION_INPUT_INVALID", "The form values must be JSON.");
        }
        const plain = redactSecrets(parsed) as Record<string, unknown>;
        if (typeof plain.friendly_name === "string") values.friendly_name = plain.friendly_name.slice(0, 80);
        if (typeof plain.server_url === "string") values.server_url = plain.server_url.slice(0, 2_048);
      }
      const friendlyName = (values.friendly_name ?? String(bound.friendly_name ?? "")).slice(0, 80);
      const serverUrl = String(bound.server_url ?? "");
      if (!friendlyName || !serverUrl) {
        throw new ApiError(422, "MCP_INTERACTION_INPUT_INVALID", "The connection request is incomplete.");
      }
      if (values.server_url && values.server_url !== serverUrl) {
        throw new ApiError(
          422,
          "MCP_INTERACTION_INPUT_INVALID",
          "The server URL is bound to this request; propose a new connection to change it.",
        );
      }
      let secret: string | null = null;
      if (row.kind === "secret") {
        if (input.action !== "submit" || typeof input.secret !== "string" || !input.secret) {
          throw new ApiError(422, "MCP_SECRET_UNAVAILABLE", "This connection needs its bearer secret to be submitted once.");
        }
        secret = input.secret;
        const key = dependencies.encryptionKey ?? loadMcpEncryptionKey();
        if (!key) {
          throw new ApiError(
            409,
            "MCP_CREDENTIAL_UNAVAILABLE",
            "This deployment has not enabled credential storage, so a bearer secret cannot be saved.",
          );
        }
        // Fail early on an unusable key; the plaintext leaves this function
        // only for the immediate ciphertext write below.
        encryptMcpCredential(secret, key);
      }
      // The request stays `submitting` until the connection exists and its
      // real handshake/discovery settled truth: a save-only record is never
      // success, and a failure settles as failure, not as submitted.
      await markSubmitting(client, row, input.expected_revision, "connection_add", auth.userId);
      resolvedAction = {
        body: null,
        claim,
        connectionCreate: {
          bearer_secret: secret,
          friendly_name: friendlyName,
          server_url: serverUrl,
        },
        continuation: row.session_id
          ? {
              messageId: row.message_id,
              sessionId: row.session_id,
              text: "",
            }
          : null,
        execution: null,
      };
    } else if (row.kind === "oauth") {
      const oauth = oauthRecord(row);
      if (input.action === "approve") {
        if (!oauth?.available) {
          throw new ApiError(
            503,
            "MCP_OAUTH_UNAVAILABLE",
            "OAuth is not configured for this deployment; no authorization was started.",
          );
        }
        // The human completes OAuth in the Nango Connect UI. Nothing executes
        // here; the verified webhook or polling readback completes the record.
        const updated = await markWaiting(client, row, input.expected_revision);
        const body: McpInteractionResponse = {
          contract_version: CONTRACT_VERSION,
          request: interactionRecord(updated, null),
        };
        await completeIdempotency(client, claim, 200, body);
        return {
          body,
          claim: null,
          connectionCreate: null,
          continuation: null,
          execution: null,
        };
      }
      throw new ApiError(422, "MCP_INTERACTION_INPUT_INVALID", "This OAuth request requires approve or reject.");
    } else {
      throw new ApiError(422, "MCP_INTERACTION_INPUT_INVALID", "This request cannot be resolved this way.");
    }
    return resolvedAction;
  });

  /** Deliver the resolved result back into the bound conversation session. */
  const finish = async (
    body: McpInteractionResponse,
    _text: string | null,
  ): Promise<McpInteractionResponse> => {
    // Delivery reads the durable outbox intent written at settle time, so a
    // crash or queue outage is recovered later instead of losing or
    // duplicating the continuation.
    await deliverMcpContinuation(pool, dependencies, auth, body.request.id);
    return body;
  };

  // Every supported human terminal outcome (reject, stale approval, choice,
  // OAuth reject, connection add, tool call) enters its bound conversation
  // exactly once here. A duplicate-submit replay returns the stored result
  // without a second continuation. Only an OAuth approval intentionally has
  // no continuation until the verified completion arrives.
  if (prepared.body) return finish(prepared.body, prepared.continuation?.text ?? null);

  if (prepared.connectionCreate) {
    // Real acceptance chain: create the connection, then run the actual
    // initialize/initialized/tools-list handshake so the record is a verified
    // usable connection with discovered tools, and only then settle the human
    // request with the true outcome. A save-only record is never success.
    const inbound: McpInboundDependencies = {
      allowInsecureTls: dependencies.allowInsecureTls === true,
      allowedOrigins: dependencies.allowedOrigins ?? [],
      encryptionKey: dependencies.encryptionKey ?? loadMcpEncryptionKey(),
      ...(dependencies.exchange ? { exchange: dependencies.exchange } : {}),
      ...(dependencies.resolver ? { resolver: dependencies.resolver } : {}),
    };
    let created: Awaited<ReturnType<typeof createMcpConnection>> | null = null;
    let createError: ApiError | null = null;
    try {
      created = await createMcpConnection(
        pool,
        auth,
        {
          ...(prepared.connectionCreate.bearer_secret !== null
            ? { bearer_secret: prepared.connectionCreate.bearer_secret }
            : {}),
          friendly_name: prepared.connectionCreate.friendly_name,
          idempotency_key: `mcp-add-${id}`,
          server_url: prepared.connectionCreate.server_url,
        },
        inbound,
      );
    } catch (error) {
      createError = error instanceof ApiError ? error : null;
      if (!createError) throw error;
    }
    if (created) {
      // Persist the stable work identity before any network work so crash
      // recovery reconciles this exact connection instead of creating a
      // duplicate or leaving the request submitting forever.
      await pool.query(
        `UPDATE mcp_interaction_requests
         SET work_connection_id = $2, updated_at = clock_timestamp()
         WHERE account_id = $1 AND id = $3`,
        [auth.accountId, created.connection.id, id],
      );
      try {
        const connectionRow = await readConnection(
          pool,
          auth.accountId,
          created.connection.id,
        );
        const oauthExchange = connectionRow
          ? oauthConnectionExchange(connectionRow, dependencies)
          : null;
        const checked = await connectMcpConnection(
          pool,
          auth,
          created.connection.id,
          {
            expected_revision: created.connection.revision,
            idempotency_key: `mcp-connect-${id}`,
          },
          oauthExchange ? { ...inbound, exchange: oauthExchange } : inbound,
        );
        created = checked;
      } catch {
        // The handshake failure is settled as the request outcome below from
        // the connection record; nothing is reported as success.
      }
    }
    const verified = created?.connection.status === "verified";
    const tools = created?.connection.tools.map((tool) => tool.name) ?? [];
    const outcomeState = verified ? "submitted" : "failed";
    const text = continuationTextForConnection(
      id,
      outcomeState,
      prepared.connectionCreate.friendly_name,
      verified,
      tools,
      createError,
    );
    const body = await settleConnectionRequest(pool, auth, id, {
      connectionId: created?.connection.id ?? null,
      continuationText: text,
      display: verified
        ? `connection_verified:${created?.connection.id ?? ""}`
        : createError
          ? `connection_create_failed:${createError.code}`
          : "connection_unverified",
      state: outcomeState,
    }, prepared.claim);
    return finish(body, text);
  }

  if (prepared.execution) {
    const { callId, connection, argumentsText, toolName } = prepared.execution;
    const args = JSON.parse(argumentsText) as Record<string, unknown>;
    const secretValues: string[] = [];
    let exchange: typeof mcpPinnedExchange | undefined;
    let target: McpResolvedTarget;
    try {
      target = await validatedUrl(connection.server_url, dependencies);
    } catch {
      const body = await settleToolCall(pool, auth, callId, id, {
        effectSent: false,
        errorCode: "MCP_ENDPOINT_REJECTED",
        isError: false,
        jsonrpcError: false,
        protocolVersion: null,
        resultText: null,
        status: "failed",
      }, [], connection, prepared.claim);
      return finish(body, body.request.receipt ? continuationTextFromReceipt(body.request.receipt) : null);
    }
    let bearerSecret: string | null = null;
    if (connection.auth_mode === "bearer") {
      const key = dependencies.encryptionKey ?? loadMcpEncryptionKey();
      let usable = Boolean(key && connection.credential_ciphertext);
      if (usable) {
        try {
          bearerSecret = decryptMcpCredential(connection.credential_ciphertext!, key!);
          secretValues.push(bearerSecret);
        } catch {
          usable = false;
        }
      }
      if (!usable) {
        const body = await settleToolCall(pool, auth, callId, id, {
          effectSent: false,
          errorCode: "MCP_CREDENTIAL_UNAVAILABLE",
          isError: false,
          jsonrpcError: false,
          protocolVersion: null,
          resultText: null,
          status: "failed",
        }, [], connection, prepared.claim);
        return finish(body, body.request.receipt ? continuationTextFromReceipt(body.request.receipt) : null);
      }
    } else if (connection.auth_mode === "oauth") {
      exchange = oauthConnectionExchange(connection, dependencies) ?? undefined;
      if (!exchange) {
        const body = await settleToolCall(pool, auth, callId, id, {
          effectSent: false,
          errorCode: "MCP_CREDENTIAL_UNAVAILABLE",
          isError: false,
          jsonrpcError: false,
          protocolVersion: null,
          resultText: null,
          status: "failed",
        }, [], connection, prepared.claim);
        return finish(body, body.request.receipt ? continuationTextFromReceipt(body.request.receipt) : null);
      }
    }
    const perform = dependencies.performCall ?? performMcpToolCall;
    const result = await perform({
      allowInsecureTls: dependencies.allowInsecureTls === true,
      bearerSecret,
      arguments: args,
      ...(exchange ? { exchange } : {}),
      target,
      timeoutMs: dependencies.toolCallTimeoutMs ?? MCP_TOOL_CALL_TIMEOUT_MS,
      toolName,
    });
    const body = await settleToolCall(
      pool,
      auth,
      callId,
      id,
      result,
      secretValues,
      connection,
      prepared.claim,
    );
    return finish(body, body.request.receipt ? continuationTextFromReceipt(body.request.receipt) : null);
  }

  throw new ApiError(
    500,
    "MCP_INTERACTION_INPUT_INVALID",
    "This request produced no resolvable outcome.",
  );
}

function continuationTextFromReceipt(receipt: McpToolCallReceipt): string {
  return [
    `MCP tool result (call_id ${receipt.call_id}, tool ${receipt.tool_name ?? "unknown"}, outcome ${receipt.outcome}${receipt.is_error ? ", tool error" : ""}).`,
    receipt.result_summary ? `Result: ${receipt.result_summary.slice(0, 400)}` : "No readable tool result.",
    "Continue the original task with this resolved result; the user already decided, so do not ask them to repeat it.",
  ]
    .join("\n")
    .slice(0, 1_000);
}

function continuationTextForConnection(
  requestId: string,
  state: string,
  label: string,
  verified: boolean,
  tools: readonly string[],
  createError: ApiError | null,
): string {
  return [
    `MCP connection result (request_id ${requestId}, outcome ${state}).`,
    verified
      ? `The user approved adding ${label}; it is verified and ready. Discovered tools: ${tools.slice(0, 10).join(", ") || "none"}.`
      : createError
        ? `Adding ${label} failed: ${createError.code}.`
        : `Adding ${label} could not be verified; the connection is not usable yet.`,
    "Continue the original task with this resolved result; the user already decided, so do not ask them to repeat it.",
  ]
    .join("\n")
    .slice(0, 1_000);
}

async function refreshBody(
  client: DatabaseClient,
  accountId: string,
  ownerUserId: string,
  requestId: string,
  callId: string,
): Promise<McpInteractionResponse> {
  const row = await readInteractionInternal(client, accountId, requestId, ownerUserId);
  const callRow = await readToolCall(client, accountId, callId, ownerUserId);
  return {
    contract_version: CONTRACT_VERSION,
    request: interactionRecord(row!, callRow),
  };
}

async function markTerminal(
  client: DatabaseClient,
  row: InteractionRow,
  userId: string,
  state: "submitted" | "rejected" | "failed" | "unknown",
  display: string,
): Promise<InteractionRow> {
  return (
    await client.query<InteractionRow>(
      `UPDATE mcp_interaction_requests
       SET state = $4, resolved_at = clock_timestamp(), resolved_by_user_id = $3,
           resolution_display = $5, revision = revision + 1,
           updated_at = clock_timestamp()
       WHERE account_id = $1 AND id = $2
       RETURNING ${INTERACTION_COLUMNS}`,
      [row.account_id, row.id, userId, state, display.slice(0, 6_000)],
    )
  ).rows[0]!;
}

async function markWaiting(
  client: DatabaseClient,
  row: InteractionRow,
  expectedRevision: number,
): Promise<InteractionRow> {
  return (
    await client.query<InteractionRow>(
      `UPDATE mcp_interaction_requests
       SET state = 'waiting', revision = revision + 1, updated_at = clock_timestamp()
       WHERE account_id = $1 AND id = $2 AND revision = $3
       RETURNING ${INTERACTION_COLUMNS}`,
      [row.account_id, row.id, expectedRevision],
    )
  ).rows[0]!;
}

function continuationText(
  row: InteractionRow,
  outcome: string,
  extra: string | null,
): string {
  const target = targetRecord(row);
  const lines = [
    `Human interaction result (call_id ${row.call_id}, kind ${row.kind}, outcome ${outcome}).`,
    `Request: ${row.purpose}`,
    `Target: ${target.connection_label} ${target.server_origin}${target.tool_name ? ` tool ${target.tool_name}` : ""}`,
  ];
  if (extra) lines.push(extra);
  lines.push("Continue the original task with this result; the user already decided, so do not ask them to repeat it.");
  return lines.join("\n").slice(0, 1_000);
}

/** The host-only typed result carried with every resolved interaction. */
function humanResult(
  row: InteractionRow,
  actingUserId: string,
  outcome: string,
  choiceId: string | null = null,
): McpHumanResult {
  return {
    actor_user_id: actingUserId,
    call_id: row.call_id,
    choice_id: choiceId,
    kind: row.kind,
    outcome: outcome.slice(0, 24),
    original_message_id: row.message_id,
    receipt_ref: row.kind === "approval" ? row.call_id : null,
    request_id: row.id,
  };
}

/**
 * Writes the continuation intent in the SAME transaction that settles the
 * request. The stable message id and idempotency key make queue admission
 * exactly-once across retries and restarts.
 */
async function enqueueContinuationIntent(
  client: DatabaseClient,
  row: InteractionRow,
  actingUserId: string,
  text: string,
  result: McpHumanResult,
): Promise<void> {
  if (!row.session_id) return;
  await client.query(
    `INSERT INTO mcp_continuation_outbox(
       account_id, request_id, created_by_user_id, call_id, session_id,
       message_id, idempotency_key, body, result_metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (account_id, request_id) DO NOTHING`,
    [
      row.account_id,
      row.id,
      actingUserId,
      row.call_id,
      row.session_id,
      randomId({}),
      `mcp-cont-${row.id}`.slice(0, 128),
      text.slice(0, 1_000),
      JSON.stringify(result).slice(0, 4_096),
    ],
  );
}

interface OutboxRow {
  account_id: string;
  created_by_user_id: string;
  message_id: string;
  idempotency_key: string;
  body: string;
  request_id: string;
  result_metadata: unknown;
  session_id: string;
}

function ownerAuth(accountId: string, ownerUserId: string): AuthContext {
  return {
    accountId,
    accountSlug: "",
    sessionId: "",
    userEmail: "",
    userId: ownerUserId,
    userKind: "simulated_human",
  };
}

async function deliverOutboxRow(
  pool: Pool,
  dependencies: McpInteractionDependencies,
  row: OutboxRow,
): Promise<void> {
  if (!dependencies.continueConversation) return;
  const result = (row.result_metadata ?? {}) as McpHumanResult;
  try {
    await dependencies.continueConversation({
      auth: ownerAuth(row.account_id, row.created_by_user_id),
      idempotencyKey: row.idempotency_key,
      messageId: row.message_id,
      result,
      sessionId: row.session_id,
      text: row.body,
    });
    await pool.query(
      `UPDATE mcp_continuation_outbox
       SET state = 'delivered', delivered_at = clock_timestamp(),
           attempts = attempts + 1, last_error = NULL, updated_at = clock_timestamp()
       WHERE account_id = $1 AND request_id = $2 AND state = 'pending'`,
      [row.account_id, row.request_id],
    );
  } catch (error) {
    // A transient enqueue failure stays pending and is retried by recovery;
    // an unsent continuation is never labelled delivered.
    await pool
      .query(
        `UPDATE mcp_continuation_outbox
         SET attempts = attempts + 1, last_error = $3, updated_at = clock_timestamp()
         WHERE account_id = $1 AND request_id = $2 AND state = 'pending'`,
        [row.account_id, row.request_id, String(error).slice(0, 240)],
      )
      .catch(() => undefined);
  }
}

/**
 * Delivers the durable continuation for one settled request exactly once
 * (queue idempotency makes retries no-ops) and never re-executes any remote
 * tool: only the stored host result re-enters the conversation.
 */
export async function deliverMcpContinuation(
  pool: Pool,
  dependencies: McpInteractionDependencies,
  auth: AuthContext,
  requestId: string,
): Promise<void> {
  const rows = await pool.query<OutboxRow>(
    `SELECT account_id, created_by_user_id, call_id, session_id, message_id,
            idempotency_key, body, request_id, result_metadata
     FROM mcp_continuation_outbox
     WHERE account_id = $1 AND request_id = $2 AND created_by_user_id = $3
       AND state = 'pending'`,
    [auth.accountId, requestId, auth.userId],
  );
  for (const row of rows.rows) await deliverOutboxRow(pool, dependencies, row);
}

/** Recovery: retries every undelivered continuation this human owns. */
export async function recoverMcpContinuations(
  pool: Pool,
  dependencies: McpInteractionDependencies,
  auth: AuthContext,
): Promise<void> {
  const rows = await pool.query<OutboxRow>(
    `SELECT account_id, created_by_user_id, call_id, session_id, message_id,
            idempotency_key, body, request_id, result_metadata
     FROM mcp_continuation_outbox
     WHERE account_id = $1 AND created_by_user_id = $2 AND state = 'pending'
       AND attempts < 100
     ORDER BY created_at
     LIMIT 20`,
    [auth.accountId, auth.userId],
  );
  for (const row of rows.rows) await deliverOutboxRow(pool, dependencies, row);
}

/**
 * Recovers an abandoned dispatched claim: a tool call claimed for execution
 * whose process died settles truthfully as `outcome_unknown` with no
 * automatic retry, and its continuation intent follows the same exactly-once
 * path.
 */
export async function recoverAbandonedMcpClaims(
  pool: Pool,
  dependencies: McpInteractionDependencies,
  auth: AuthContext,
  recoveryMs = 10 * 60 * 1000,
): Promise<void> {
  const abandoned = await pool.query<{
    call_id: string;
    request_id: string;
    connection_id: string | null;
  }>(
    `SELECT c.id AS call_id, c.request_id, c.connection_id
     FROM mcp_tool_calls c
     WHERE c.account_id = $1 AND c.created_by_user_id = $2
       AND c.state = 'claimed'
       AND c.claimed_at <= clock_timestamp() - ($3::bigint * interval '1 millisecond')
     LIMIT 5`,
    [auth.accountId, auth.userId, recoveryMs],
  );
  for (const row of abandoned.rows) {
    const connection = await readConnection(pool, auth.accountId, row.connection_id ?? "");
    await settleToolCall(pool, auth, row.call_id, row.request_id, {
      effectSent: true,
      errorCode: "MCP_TIMEOUT",
      isError: false,
      jsonrpcError: false,
      protocolVersion: null,
      resultText: null,
      status: "outcome_unknown",
    }, [], connection ?? {
      auth_mode: "anonymous",
      credential_ciphertext: null,
      discovered_tools: [],
      friendly_name: "",
      id: row.connection_id ?? "",
      nango_connection_id: null,
      nango_provider: null,
      revision: 1,
      server_url: "",
      status: "disconnected",
    }, null);
    await deliverMcpContinuation(pool, dependencies, auth, row.request_id);
  }
}

async function settleToolCall(
  pool: Pool,
  auth: AuthContext,
  callId: string,
  requestId: string,
  result: McpToolCallResult,
  secretValues: string[],
  connection: ConnectionRow,
  claim: IdempotencyClaim | null = null,
): Promise<McpInteractionResponse> {
  const redactedText = result.resultText
    ? redactKnownSecrets(result.resultText, secretValues)
    : null;
  let parsedRedacted: string | null = null;
  if (redactedText) {
    try {
      parsedRedacted = JSON.stringify(redactSecrets(JSON.parse(redactedText)));
    } catch {
      parsedRedacted = JSON.stringify(redactSecrets(redactedText));
    }
    if (parsedRedacted.length > 24_000) {
      parsedRedacted = `${parsedRedacted.slice(0, 23_999)}…`;
    }
  }
  const outcome: McpCallOutcome =
    result.status === "succeeded"
      ? "succeeded"
      : result.status === "outcome_unknown"
        ? "outcome_unknown"
        : "failed";
  const summary = parsedRedacted
    ? parsedRedacted.length > 4_000
      ? `${parsedRedacted.slice(0, 3_999)}…`
      : parsedRedacted
    : result.errorCode
      ? mcpErrorCodeMessage(result.errorCode)
      : "The tool returned no readable result.";
  const requestState =
    outcome === "succeeded" ? "submitted" : outcome === "outcome_unknown" ? "unknown" : "failed";
  return inTransaction(pool, async (client) => {
    // Lock order matches deletion: parent session first, then the request
    // row, so a concurrent scrub cannot interleave and regrow private data.
    const scoped = await readInteractionInternal(client, auth.accountId, requestId, auth.userId);
    const keepPayloads = scoped
      ? await lockParentSessionForSettlement(client, auth.accountId, scoped.session_id)
      : false;
    await client.query(
      `UPDATE mcp_tool_calls
       SET state = $3, executed_at = clock_timestamp(), is_error = $4,
           error_code = $5, result_summary = $6, result_json = $7,
           protocol_version = $8, revision = revision + 1, updated_at = clock_timestamp()
       WHERE account_id = $1 AND id = $2 AND state = 'claimed'`,
      [
        auth.accountId,
        callId,
        outcome,
        result.isError,
        result.errorCode,
        keepPayloads ? summary : "[removed]",
        keepPayloads ? parsedRedacted : null,
        result.protocolVersion,
      ],
    );
    await client.query(
      `UPDATE mcp_interaction_requests
       SET state = $3, resolved_at = clock_timestamp(),
           resolution_display = $4, revision = revision + 1, updated_at = clock_timestamp()
       WHERE account_id = $1 AND id = $2 AND state = 'submitting'`,
      [
        auth.accountId,
        requestId,
        requestState,
        // A dead parent keeps only the minimal real outcome label.
        keepPayloads ? `call:${outcome}` : `call:${outcome}`,
      ],
    );
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "mcp_tool_call.settled",
      "mcp_tool_call",
      callId,
      {
        connection_id: connection.id,
        external_effect_count: result.effectSent ? 1 : 0,
        outcome,
      },
    );
    const body = await refreshBody(client, auth.accountId, auth.userId, requestId, callId);
    const requestRow = await readInteractionInternal(client, auth.accountId, requestId, auth.userId);
    // A dead non-null parent keeps the minimal real outcome and audit only:
    // no new private receipt content and no continuation publication.
    if (requestRow && keepPayloads) {
      await enqueueContinuationIntent(
        client,
        requestRow,
        auth.userId,
        body.request.receipt
          ? continuationTextFromReceipt(body.request.receipt)
          : continuationText(requestRow, requestState, null),
        humanResult(requestRow, auth.userId, requestState),
      );
    }
    // Duplicate-submit replay carries the settled result; the claim is
    // completed in the same transaction as the terminal state so a crash can
    // never leave a half-settled result behind.
    if (claim) await completeIdempotency(client, claim, 200, body);
    return body;
  });
}

/**
 * Settles a connection-creation request with the true outcome after the real
 * handshake ran: `submitted` only for a verified usable connection, `failed`
 * otherwise. The idempotency claim completes atomically with the truth.
 */
async function settleConnectionRequest(
  pool: Pool,
  auth: AuthContext,
  requestId: string,
  outcome: {
    state: "submitted" | "failed";
    display: string;
    connectionId: string | null;
    continuationText: string | null;
  },
  claim: IdempotencyClaim | null,
): Promise<McpInteractionResponse> {
  return inTransaction(pool, async (client) => {
    // Internal settlement read under the same lock order as deletion: parent
    // session first, then the request row, so private content can never
    // regrow after a concurrent scrub.
    const current = await readInteractionInternal(client, auth.accountId, requestId, auth.userId);
    if (!current) {
      throw new ApiError(404, "MCP_INTERACTION_NOT_FOUND", "This request no longer exists.");
    }
    const parentAlive = await lockParentSessionForSettlement(
      client,
      auth.accountId,
      current.session_id,
    );
    const locked = await readInteractionInternal(client, auth.accountId, requestId, auth.userId, true);
    if (!locked) {
      throw new ApiError(404, "MCP_INTERACTION_NOT_FOUND", "This request no longer exists.");
    }
    // A dead non-null parent settles only the minimal real outcome: no
    // captured names, tool summaries or other private content anywhere.
    const updated = await markTerminal(
      client,
      locked,
      auth.userId,
      outcome.state,
      parentAlive ? outcome.display : `connection_settled:${outcome.state}`,
    );
    if (parentAlive) {
      await enqueueContinuationIntent(
        client,
        updated,
        auth.userId,
        outcome.continuationText ?? continuationText(updated, outcome.state, null),
        humanResult(updated, auth.userId, outcome.state),
      );
    }
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "mcp_interaction.submitted",
      "mcp_interaction_request",
      requestId,
      {
        connection_id: outcome.connectionId,
        external_effect_count: 0,
        kind: updated.kind,
        outcome: outcome.state,
      },
    );
    const body: McpInteractionResponse = {
      contract_version: CONTRACT_VERSION,
      request: interactionRecord(updated, null),
    };
    if (claim) await completeIdempotency(client, claim, 200, body);
    return body;
  });
}

/** Records cleanup for every frozen broker identity bound to one request. */
async function recordAttemptCleanup(
  client: DatabaseClient,
  row: { account_id: string; created_by_user_id: string; id: string; session_id: string | null },
  provenance: "session_ended" | "withdrawn" | "late_grant",
): Promise<void> {
  const attempts = await client.query<{
    broker_base_url: string | null;
    capability_expires_at: Date | null;
    connect_request_id: string;
    created_by_user_id: string;
    environment: string | null;
    mcp_server_url: string;
    nango_connection_id: string | null;
    provider: string;
  }>(
    `SELECT connect_request_id, created_by_user_id, environment, broker_base_url,
            capability_expires_at, mcp_server_url, nango_connection_id, provider
     FROM mcp_oauth_connect_requests WHERE account_id = $1 AND id = $2`,
    [row.account_id, row.id],
  );
  for (const attempt of attempts.rows) {
    await recordOauthCleanup(client, {
      accountId: row.account_id,
      brokerBaseUrl: attempt.broker_base_url,
      capabilityExpiresAt: attempt.capability_expires_at,
      connectRequestId: attempt.connect_request_id,
      createdByUserId: attempt.created_by_user_id,
      environment: attempt.environment,
      nangoConnectionId: attempt.nango_connection_id,
      provenance,
      provider: attempt.provider,
      targetOrigin: attempt.mcp_server_url,
    });
  }
}

/**
 * Session deletion and retention invalidation: undecidable human requests and
 * OAuth attempts close, private derived payloads are removed, and undelivered
 * continuations for the dead conversation can never resume it. A dispatched
 * call keeps its truthful metadata (settling as succeeded/failed/unknown later)
 * and is never retried; accountability is not erased.
 */
export async function invalidateMcpInteractionsForSession(
  client: DatabaseClient,
  accountId: string,
  sessionId: string,
): Promise<void> {
  // Same lock order as settlement: the parent session row is locked first so
  // an in-flight settlement cannot interleave and regrow scrubbed content.
  await client.query(
    `SELECT 1 FROM agent_sessions WHERE account_id = $1 AND id = $2 FOR UPDATE`,
    [accountId, sessionId],
  );
  const closingAttempts = await client.query<{
    account_id: string;
    created_by_user_id: string;
    id: string;
  }>(
    `SELECT DISTINCT account_id, created_by_user_id, id
     FROM mcp_oauth_connect_requests
     WHERE account_id = $1 AND session_id = $2`,
    [accountId, sessionId],
  );
  for (const closing of closingAttempts.rows) {
    // The frozen attempt identity is preserved for safe external cleanup even
    // if a late grant materializes after this conversation is gone.
    await recordAttemptCleanup(client, { ...closing, session_id: sessionId }, "session_ended");
  }
  await client.query(
    `UPDATE mcp_oauth_connect_requests
     SET state = 'expired', revision = revision + 1, updated_at = clock_timestamp()
     WHERE account_id = $1 AND session_id = $2
       AND state IN ('pending','waiting') AND nango_connection_id IS NULL`,
    [accountId, sessionId],
  );
  await client.query(
    `UPDATE mcp_interaction_requests
     SET state = 'expired', resolved_at = coalesce(resolved_at, clock_timestamp()),
         resolution_display = 'session_ended', revision = revision + 1,
         updated_at = clock_timestamp()
     WHERE account_id = $1 AND session_id = $2 AND state IN ('waiting','pending')`,
    [accountId, sessionId],
  );
  // Remove every private derived payload: tool arguments, OAuth links,
  // purpose, choices, resolution displays, receipts and delivered outbox
  // bodies. Minimal identity and truthful outcome metadata survive.
  await client.query(
    `UPDATE mcp_interaction_requests
     SET arguments_display = '[removed]', bound_arguments = NULL,
         purpose = '[removed]', choices = '[]'::jsonb,
         resolution_display = CASE WHEN resolution_display IN (
           'expired','rejected','approved','session_ended','owner_withdrawn',
           'stale_approval','connection_work_lost','oauth_work_lost',
           'connection_unverified','connection_reconciled_verified',
           'connection_reconciled_unverified','oauth_connecting','oauth_failed',
           'oauth_connection_changed','oauth_verified','oauth_unverified',
           'call:succeeded','call:failed','call:outcome_unknown')
           THEN resolution_display ELSE NULL END,
         oauth = CASE WHEN oauth IS NULL THEN NULL ELSE
           jsonb_build_object(
             'available', false,
             'connect_request_id', oauth->>'connect_request_id',
             'connect_url', NULL,
             'provider', oauth->>'provider') END,
         revision = revision + 1, updated_at = clock_timestamp()
     WHERE account_id = $1 AND session_id = $2`,
    [accountId, sessionId],
  );
  // Model-provided option identifiers can contain private free-form text.
  // Remove only that payload from this Session's exact request audits; retain
  // the actor, request/call identity, timestamps and outcome provenance.
  await client.query(
    `UPDATE audit_events SET metadata = metadata - 'choice_id'
     WHERE account_id = $1 AND entity_type = 'mcp_interaction_request'
       AND entity_id IN (
         SELECT id FROM mcp_interaction_requests
         WHERE account_id = $1 AND session_id = $2)
       AND metadata ? 'choice_id'`,
    [accountId, sessionId],
  );
  await client.query(
    `UPDATE mcp_tool_calls
     SET arguments = '[removed]', result_json = NULL, result_summary = NULL,
         revision = revision + 1, updated_at = clock_timestamp()
     WHERE account_id = $1
       AND request_id IN (
         SELECT id FROM mcp_interaction_requests
         WHERE account_id = $1 AND session_id = $2)`,
    [accountId, sessionId],
  );
  await client.query(
    `UPDATE mcp_continuation_outbox
     SET body = '[removed]', result_metadata = NULL, updated_at = clock_timestamp()
     WHERE account_id = $1 AND session_id = $2`,
    [accountId, sessionId],
  );
  await client.query(
    `DELETE FROM mcp_continuation_outbox
     WHERE account_id = $1 AND session_id = $2 AND state = 'pending'`,
    [accountId, sessionId],
  );
  // Replay snapshots must never return pre-deletion private payloads.
  await client.query(
    `DELETE FROM idempotency_records r
     WHERE r.account_id = $1 AND (
       r.operation_scope IN (
         SELECT 'resolve_mcp_interaction:' || id FROM mcp_interaction_requests
         WHERE account_id = $1 AND session_id = $2)
       OR EXISTS (
         SELECT 1 FROM mcp_interaction_requests m
         WHERE m.account_id = $1 AND m.session_id = $2
           AND (r.response_body::text LIKE '%' || m.id || '%'
             OR (m.work_connection_id IS NOT NULL
               AND r.response_body::text LIKE '%' || m.work_connection_id || '%')))
     )`,
    [accountId, sessionId],
  );
}

/** Marks a request as executing its resolution before post-commit work. */
/**
 * Marks a request as executing its resolution before post-commit work. The
 * acting user is preserved so a permitted cross-member action audits to the
 * human who actually made the decision.
 */
async function markSubmitting(
  client: DatabaseClient,
  row: InteractionRow,
  expectedRevision: number,
  display: string,
  actingUserId: string,
): Promise<InteractionRow> {
  return (
    await client.query<InteractionRow>(
      `UPDATE mcp_interaction_requests
       SET state = 'submitting', resolved_by_user_id = $3,
           resolution_display = $4, revision = revision + 1,
           updated_at = clock_timestamp()
       WHERE account_id = $1 AND id = $2 AND revision = $5`,
      [row.account_id, row.id, actingUserId, display.slice(0, 6_000), expectedRevision],
    )
  ).rows[0]!;
}

/**
 * The frozen Nango exchange for one OAuth connection: the approved endpoint
 * stays the fixed proxy target and the Nango connection identity is bound to
 * the stored connection row, never to client input.
 */
function oauthConnectionExchange(
  connection: { server_url: string; nango_connection_id: string | null; nango_provider: string | null },
  dependencies: McpInteractionDependencies,
): typeof mcpPinnedExchange | null {
  const nango = dependencies.nangoConfig ?? null;
  if (!nango || !connection.nango_connection_id || !connection.nango_provider) return null;
  let target: McpResolvedTarget;
  try {
    target = {
      ...resolvedTargetFromUrl(connection.server_url),
    };
  } catch {
    return null;
  }
  return nangoExchange(nango, {
    connectionId: connection.nango_connection_id,
    providerConfigKey: connection.nango_provider,
    target,
  }, dependencies.fetcher ?? fetch);
}

function resolvedTargetFromUrl(raw: string): McpResolvedTarget {
  const url = new URL(raw);
  return {
    address: "proxy",
    family: 4,
    origin: url.origin,
    trustedLocal: false,
    url,
  };
}

async function memberActive(
  client: DatabaseClient,
  accountId: string,
  userId: string,
): Promise<boolean> {
  // Account management and retirement take the account before the user. Hold
  // both rows through publication; a read of `active` alone is not authority.
  const account = await client.query<{ retired_at: Date | null }>(
    "SELECT retired_at FROM accounts WHERE id = $1 FOR SHARE",
    [accountId],
  );
  const row = await client.query(
    `SELECT status FROM users
     WHERE account_id = $1 AND id = $2 FOR SHARE`,
    [accountId, userId],
  );
  return Boolean(account.rowCount && account.rows[0]!.retired_at === null && row.rows[0]?.status === "active");
}

/**
 * Reconciles abandoned connection work to a truthful terminal state using the
 * stable recorded connection identity and the current authorized scope.
 * Discovery/handshake reconciliation never retries a tools/call effect, and a
 * lost work phase settles as failed instead of leaving `submitting` forever.
 */
export async function recoverAbandonedMcpConnectionWork(
  pool: Pool,
  dependencies: McpInteractionDependencies,
  auth: AuthContext,
  recoveryMs = 10 * 60 * 1000,
): Promise<void> {
  const stuck = await pool.query<{
    id: string;
    work_connection_id: string | null;
    kind: string;
  }>(
    `SELECT id, work_connection_id, kind FROM mcp_interaction_requests
     WHERE account_id = $1 AND created_by_user_id = $2
       AND state = 'submitting'
       AND kind IN ('form','secret','oauth')
       AND updated_at <= clock_timestamp() - ($3::bigint * interval '1 millisecond')
     LIMIT 5`,
    [auth.accountId, auth.userId, recoveryMs],
  );
  for (const row of stuck.rows) {
    if (!row.work_connection_id) {
      // No connection was ever created; nothing external happened. Settle as
      // failed instead of fabricating success or replaying the work.
      await settleConnectionRequest(pool, auth, row.id, {
        connectionId: null,
        continuationText: null,
        display: "connection_work_lost",
        state: "failed",
      }, null);
      await deliverMcpContinuation(pool, dependencies, auth, row.id);
      continue;
    }
    const connection = await readConnection(pool, auth.accountId, row.work_connection_id);
    if (!connection) {
      await settleConnectionRequest(pool, auth, row.id, {
        connectionId: null,
        continuationText: null,
        display: "connection_work_lost",
        state: "failed",
      }, null);
      await deliverMcpContinuation(pool, dependencies, auth, row.id);
      continue;
    }
    if (row.kind === "oauth") {
      const request = await readInteractionInternal(pool, auth.accountId, row.id, auth.userId);
      const attempt = (await pool.query<{
        connect_request_id: string; nango_connection_id: string | null; provider: string;
        mcp_server_url: string; broker_base_url: string | null; environment: string | null;
        capability_expires_at: Date | null;
      }>(`SELECT connect_request_id, nango_connection_id, provider, mcp_server_url,
            broker_base_url, environment, capability_expires_at
          FROM mcp_oauth_connect_requests WHERE account_id = $1 AND id = $2 AND created_by_user_id = $3`,
        [auth.accountId, row.id, auth.userId])).rows[0];
      if (request && attempt?.nango_connection_id) {
        await runOAuthConnectionWork(pool, {
          // The durable callback claim creates generation 1. A connection
          // edit before restart must not become a fresh authorization for this
          // abandoned request merely because recovery read its newer revision.
          request, localConnectionId: connection.id, connectionRevision: 1,
          connectRequestId: attempt.connect_request_id, nangoConnectionId: attempt.nango_connection_id,
          provider: attempt.provider, serverUrl: attempt.mcp_server_url,
          brokerBaseUrl: attempt.broker_base_url, environment: attempt.environment,
          capabilityExpiresAt: attempt.capability_expires_at,
        }, dependencies);
      } else {
        await settleConnectionRequest(pool, auth, row.id, {
          connectionId: connection.id, continuationText: null, display: "oauth_work_lost", state: "failed",
        }, null);
      }
      await deliverMcpContinuation(pool, dependencies, auth, row.id);
      continue;
    }
    // Reconciliation uses the stable original identity and current authorized
    // scope: only handshake/discovery, never a tool-call effect.
    let verified = false;
    let tools: string[] = [];
    try {
      const inbound: McpInboundDependencies = {
        allowInsecureTls: dependencies.allowInsecureTls === true,
        allowedOrigins: dependencies.allowedOrigins ?? [],
        encryptionKey: dependencies.encryptionKey ?? loadMcpEncryptionKey(),
        ...(dependencies.exchange ? { exchange: dependencies.exchange } : {}),
        ...(dependencies.resolver ? { resolver: dependencies.resolver } : {}),
      };
      const oauthExchange = oauthConnectionExchange(connection, dependencies);
      const checked = await connectMcpConnection(
        pool,
        auth,
        connection.id,
        {
          expected_revision: connection.revision,
          idempotency_key: `mcp-reconcile-${row.id}`.slice(0, 128),
        },
        oauthExchange ? { ...inbound, exchange: oauthExchange } : inbound,
      );
      verified = checked.connection.status === "verified";
      tools = checked.connection.tools.map((tool) => tool.name);
    } catch {
      verified = false;
    }
    const state = verified ? "submitted" : "failed";
    await settleConnectionRequest(pool, auth, row.id, {
      connectionId: connection.id,
      continuationText: continuationTextForConnection(
        row.id,
        state,
        connection.friendly_name,
        verified,
        tools,
        null,
      ),
      display: verified ? "connection_reconciled_verified" : "connection_reconciled_unverified",
      state,
    }, null);
    await deliverMcpContinuation(pool, dependencies, auth, row.id);
  }

  // Revocation recheck: a pending OAuth attempt whose owner is no longer an
  // active member is closed; a callback after withdrawal can never resurrect
  // authority or create a usable connection.
  await pool.query(
    `UPDATE mcp_oauth_connect_requests o
     SET state = 'failed', revision = revision + 1, updated_at = clock_timestamp()
     WHERE o.account_id = $1 AND o.state IN ('pending','waiting')
       AND o.nango_connection_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM users u JOIN accounts a ON a.id = u.account_id
         WHERE u.account_id = o.account_id AND u.id = o.created_by_user_id
           AND u.status = 'active' AND a.retired_at IS NULL)`,
    [auth.accountId],
  );
}

/**
 * Nango proxy exchange for OAuth connections. The target is frozen to the
 * approved origin; only MCP transport headers pass through and the proxy is
 * told not to retry.
 */
export function nangoExchange(
  config: NangoConfig,
  options: { connectionId: string; providerConfigKey: string; target: McpResolvedTarget },
  fetcher: typeof fetch = fetch,
): typeof mcpPinnedExchange {
  return async (input: McpExchangeInput): Promise<McpExchangeResponse> => {
    // The proxied request is dispatched here; anything unreadable afterwards
    // is an unknown outcome for a call leg, never a proven failure.
    input.onRequestSent?.();
    try {
      const response = await nangoProxyPost(
        config,
        {
          body: input.body ?? "",
          connectionId: options.connectionId,
          headers: input.headers,
          path: options.target.url.pathname,
          providerConfigKey: options.providerConfigKey,
          targetOrigin: options.target.origin,
          timeoutMs: input.timeoutMs ?? 15_000,
        },
        fetcher,
      );
      return {
        body: response.body,
        contentType: response.contentType,
        headers: response.headers,
        status: response.status,
      };
    } catch (error) {
      if (error instanceof NangoProxyOverflowError) {
        throw new McpTransportError(
          "MCP_RESPONSE_TOO_LARGE",
          "The MCP server response exceeded the size limit.",
        );
      }
      throw new McpTransportError(
        "MCP_HANDSHAKE_FAILED",
        "The MCP exchange could not be completed.",
      );
    }
  };
}

export interface NangoWebhookOutcome {
  status: "applied" | "ignored" | "unverified" | "unavailable";
  request?: McpInteractionRequest;
}

interface ConnectRequestRow {
  account_id: string;
  broker_base_url: string | null;
  capability_expires_at: Date | null;
  created_by_user_id: string;
  environment: string | null;
  id: string;
  mcp_server_url: string;
  provider: string;
  state: string;
  expires_at: Date;
}

async function readConnectRequest(
  pool: Pool,
  connectRequestId: string,
  accountId: string | null,
  ownerUserId: string | null = null,
): Promise<ConnectRequestRow | null> {
  const result = await pool.query<ConnectRequestRow>(
    `SELECT account_id, created_by_user_id, id, provider, mcp_server_url, state,
            expires_at, environment, broker_base_url, capability_expires_at
     FROM mcp_oauth_connect_requests
     WHERE connect_request_id = $1
       AND ($2::uuid IS NULL OR account_id = $2)
       AND ($3::uuid IS NULL OR created_by_user_id = $3)`,
    [connectRequestId, accountId, ownerUserId],
  );
  return result.rows[0] ?? null;
}

/** A provider template is descriptive metadata, never a broker/config identity. */
function matchesFrozenOAuthIdentity(
  config: NangoConfig,
  row: ConnectRequestRow,
  connectRequestId: string,
  metadata: NangoConnectionMetadata,
): boolean {
  return config.baseUrl === row.broker_base_url && config.environment === row.environment &&
    metadata.providerConfigKey === row.provider &&
    metadata.tags[NANGO_CONNECT_REQUEST_TAG] === connectRequestId &&
    metadata.tags["account_id"] === row.account_id &&
    metadata.tags["user_id"] === row.created_by_user_id &&
    metadata.tags["provider"] === row.provider &&
    metadata.tags["mcp_server_url"] === row.mcp_server_url;
}

/**
 * Completes one bound connect request from authoritative backend metadata.
 *
 * The completion claim is atomic across the connect attempt, the canonical
 * request and the single connection insert: concurrent polls or webhooks lose
 * the claim and create nothing, and a rejected, expired or already-settled
 * request is never overwritten by a late completion. Outside the transaction
 * the real OAuth-aware handshake and tool discovery run; only a verified
 * usable connection settles the request as success. The durable continuation
 * follows the same exactly-once outbox path, resuming the same Agent task.
 */
async function completeConnectRequest(
  pool: Pool,
  row: ConnectRequestRow,
  connectRequestId: string,
  connectionId: string,
  providerConfigKey: string,
  metadata: NangoConnectionMetadata,
  dependencies: McpInteractionDependencies,
): Promise<NangoWebhookOutcome> {
  const config = dependencies.nangoConfig ?? loadNangoConfig();
  if (!config || !matchesFrozenOAuthIdentity(config, row, connectRequestId, metadata) ||
      metadata.connectionId !== connectionId || providerConfigKey !== row.provider) {
    return { status: "ignored" };
  }
  const claimed = await inTransaction(pool, async (client) => {
    const active = await memberActive(client, row.account_id, row.created_by_user_id);
    const attempt = await client.query<{
      account_id: string;
      broker_base_url: string | null;
      capability_expires_at: Date | null;
      created_by_user_id: string;
      environment: string | null;
      id: string;
      mcp_server_url: string;
    }>(
      `UPDATE mcp_oauth_connect_requests
       SET nango_connection_id = $2, metadata = $3::jsonb,
           revision = revision + 1, updated_at = clock_timestamp()
       WHERE connect_request_id = $1 AND state IN ('pending','waiting')
         AND nango_connection_id IS NULL AND expires_at > clock_timestamp()
         AND account_id = $4 AND created_by_user_id = $5 AND id = $6
         AND provider = $7 AND mcp_server_url = $8 AND broker_base_url = $9
         AND environment IS NOT DISTINCT FROM $10::text
       RETURNING account_id, created_by_user_id, id, mcp_server_url, environment,
         broker_base_url, capability_expires_at`,
      [
        connectRequestId,
        connectionId.slice(0, 200),
        JSON.stringify({
          created_at: metadata.createdAt,
          provider: metadata.provider,
          provider_config_key: metadata.providerConfigKey,
          tags: metadata.tags,
        }).slice(0, 8_192),
        row.account_id, row.created_by_user_id, row.id, row.provider,
        row.mcp_server_url, config.baseUrl, config.environment,
      ],
    );
    if (!attempt.rowCount) return null;
    const attemptRow = attempt.rows[0]!;
    // Current authorized scope: the owning member must still be active in the
    // account at claim time, not only at request time.
    if (!active) {
      await client.query(
        `UPDATE mcp_oauth_connect_requests
         SET state = 'failed', revision = revision + 1, updated_at = clock_timestamp()
         WHERE connect_request_id = $1`,
        [connectRequestId],
      );
      await recordAttemptCleanup(client, { ...attemptRow, session_id: null }, "withdrawn");
      return null;
    }
    const request = await readInteraction(
      client,
      attemptRow.account_id,
      attemptRow.id,
      attemptRow.created_by_user_id,
      true,
    );
    if (!request || (request.state !== "pending" && request.state !== "waiting")) {
      // A late completion can never resurrect a rejected or expired decision.
      await client.query(
        `UPDATE mcp_oauth_connect_requests
         SET state = 'failed', revision = revision + 1, updated_at = clock_timestamp()
         WHERE connect_request_id = $1`,
        [connectRequestId],
      );
      await recordAttemptCleanup(client, { ...attemptRow, session_id: null }, "session_ended");
      return null;
    }
    const submitting = await client.query<InteractionRow>(
      `UPDATE mcp_interaction_requests
       SET state = 'submitting', resolved_by_user_id = $4,
           resolution_display = 'oauth_connecting', revision = revision + 1,
           updated_at = clock_timestamp()
       WHERE account_id = $1 AND id = $2 AND created_by_user_id = $3
         AND state IN ('pending','waiting')
       RETURNING ${INTERACTION_COLUMNS}`,
      [attemptRow.account_id, attemptRow.id, attemptRow.created_by_user_id, attemptRow.created_by_user_id],
    );
    if (!submitting.rowCount) {
      await client.query(
        `UPDATE mcp_oauth_connect_requests
         SET state = 'failed', revision = revision + 1, updated_at = clock_timestamp()
         WHERE connect_request_id = $1`,
        [connectRequestId],
      );
      return null;
    }
    const requestRow = submitting.rows[0]!;
    const newConnectionId = randomId(dependencies);
    await client.query(
      `UPDATE mcp_interaction_requests
       SET work_connection_id = $2, updated_at = clock_timestamp()
       WHERE account_id = $1 AND id = $3`,
      [attemptRow.account_id, newConnectionId, attemptRow.id],
    );
    await client.query(
      `INSERT INTO mcp_connections(
         account_id, id, created_by_user_id, friendly_name, server_url,
         status, auth_mode, nango_connection_id, nango_provider
       ) VALUES ($1,$2,$3,$4,$5,'disconnected','oauth',$6,$7)`,
      [
        attemptRow.account_id,
        newConnectionId,
        attemptRow.created_by_user_id,
        (JSON.parse(requestRow.bound_arguments ?? "{}") as { friendly_name?: string })
          .friendly_name?.slice(0, 80) ?? "OAuth MCP server",
        attemptRow.mcp_server_url,
        connectionId.slice(0, 200),
        providerConfigKey.slice(0, 80),
      ],
    );
    return {
      attemptRow,
      connectionId: newConnectionId,
      requestRow,
      serverUrl: attemptRow.mcp_server_url,
    };
  });
  if (!claimed) return { status: "ignored" };

  return runOAuthConnectionWork(pool, {
    request: claimed.requestRow,
    localConnectionId: claimed.connectionId,
    connectionRevision: 1,
    connectRequestId,
    nangoConnectionId: connectionId,
    provider: providerConfigKey,
    serverUrl: claimed.serverUrl,
    brokerBaseUrl: claimed.attemptRow.broker_base_url,
    environment: claimed.attemptRow.environment,
    capabilityExpiresAt: claimed.attemptRow.capability_expires_at,
  }, dependencies);
}

interface OAuthConnectionWork {
  request: InteractionRow;
  localConnectionId: string;
  connectionRevision: number;
  connectRequestId: string;
  nangoConnectionId: string;
  provider: string;
  serverUrl: string;
  brokerBaseUrl: string | null;
  environment: string | null;
  capabilityExpiresAt: Date | null;
}

async function readOAuthWorkConnection(client: DatabaseClient, work: OAuthConnectionWork, lock = false) {
  return (await client.query<ConnectionRow & { created_by_user_id: string }>(
    `SELECT ${CONNECTION_LOOKUP_COLUMNS}, created_by_user_id FROM mcp_connections
     WHERE account_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [work.request.account_id, work.localConnectionId],
  )).rows[0] ?? null;
}

function oauthWorkBindingMatches(connection: (ConnectionRow & { created_by_user_id: string }) | null, work: OAuthConnectionWork): boolean {
  return Boolean(connection && connection.created_by_user_id === work.request.created_by_user_id &&
    connection.auth_mode === "oauth" && connection.nango_connection_id === work.nangoConnectionId &&
    connection.nango_provider === work.provider && connection.server_url === work.serverUrl);
}

/** The callback and restart recovery share dispatch and one fenced publication. */
async function runOAuthConnectionWork(
  pool: Pool,
  work: OAuthConnectionWork,
  dependencies: McpInteractionDependencies,
): Promise<NangoWebhookOutcome> {
  const admitted = await inTransaction(pool, async (client) => {
    const active = await memberActive(client, work.request.account_id, work.request.created_by_user_id);
    const parentAlive = await lockParentSessionForSettlement(client, work.request.account_id, work.request.session_id);
    const request = await readInteractionInternal(client, work.request.account_id, work.request.id, work.request.created_by_user_id, true);
    const connection = await readOAuthWorkConnection(client, work, true);
    return active && parentAlive && request?.state === "submitting" &&
      oauthWorkBindingMatches(connection, work) && connection?.revision === work.connectionRevision;
  });
  let verified = false;
  let discovered: Awaited<ReturnType<typeof performMcpHandshake>>["tools"] = [];
  const config = dependencies.nangoConfig ?? loadNangoConfig();
  if (admitted && config && (!work.brokerBaseUrl || config.baseUrl === work.brokerBaseUrl) &&
      (!work.environment || config.environment === work.environment)) {
    try {
      const target = resolvedTargetFromUrl(work.serverUrl);
      const handshake = await performMcpHandshake({
        allowInsecureTls: dependencies.allowInsecureTls === true,
        bearerSecret: null,
        exchange: nangoExchange(config, {
          connectionId: work.nangoConnectionId, providerConfigKey: work.provider, target,
        }, dependencies.fetcher ?? fetch),
        target,
        timeoutMs: dependencies.toolCallTimeoutMs ?? MCP_TOOL_CALL_TIMEOUT_MS,
      });
      verified = handshake.status === "verified";
      discovered = handshake.tools;
    } catch { /* An unreadable handshake is never a verified connection. */ }
  }
  return inTransaction(pool, async (client) => {
    // Match account management's account -> user lock order, then deletion's
    // parent -> request order. Authority remains locked until all publication commits.
    const active = await memberActive(client, work.request.account_id, work.request.created_by_user_id);
    const parentAlive = await lockParentSessionForSettlement(client, work.request.account_id, work.request.session_id);
    const request = await readInteractionInternal(client, work.request.account_id, work.request.id, work.request.created_by_user_id, true);
    const connection = await readOAuthWorkConnection(client, work, true);
    const attempt = (await client.query<{ state: string; nango_connection_id: string | null }>(
      `SELECT state, nango_connection_id FROM mcp_oauth_connect_requests
       WHERE connect_request_id = $1 AND account_id = $2 AND created_by_user_id = $3
         AND id = $4 AND provider = $5 AND mcp_server_url = $6 FOR UPDATE`,
      [work.connectRequestId, work.request.account_id, work.request.created_by_user_id, work.request.id, work.provider, work.serverUrl],
    )).rows[0];
    if (!request || request.state !== "submitting") return { status: "ignored" };
    const bindingMatches = oauthWorkBindingMatches(connection, work);
    const generationMatches = bindingMatches && connection?.revision === work.connectionRevision;
    const attemptMatches = Boolean(attempt && ["pending", "waiting"].includes(attempt.state) &&
      attempt.nango_connection_id === work.nangoConnectionId);
    const publishable = active && parentAlive && generationMatches && attemptMatches;
    const state = publishable && verified ? "submitted" : "failed";
    if (generationMatches) {
      await client.query(
        `UPDATE mcp_connections SET status = $3, discovered_tools = $4::jsonb, tools_count = $5,
           last_checked_at = clock_timestamp(), last_error_code = NULL, last_error_message = NULL,
           revision = revision + 1, updated_at = clock_timestamp()
         WHERE account_id = $1 AND id = $2 AND revision = $6
           AND auth_mode = 'oauth' AND nango_connection_id = $7 AND nango_provider = $8 AND server_url = $9`,
        [work.request.account_id, work.localConnectionId, publishable && verified ? "verified" : "failed",
          publishable && verified ? JSON.stringify(discovered) : "[]", publishable && verified ? discovered.length : 0,
          work.connectionRevision, work.nangoConnectionId, work.provider, work.serverUrl],
      );
    }
    const display = !active ? "owner_withdrawn" : !parentAlive ? "session_ended" :
      !generationMatches || !attemptMatches ? "oauth_connection_changed" : verified ? "oauth_verified" : "oauth_unverified";
    const updated = await markTerminal(client, request, work.request.created_by_user_id, state, display);
    if (active && parentAlive) {
      const label = (JSON.parse(request.bound_arguments ?? "{}") as { friendly_name?: string }).friendly_name ?? "OAuth MCP server";
      await enqueueContinuationIntent(client, updated, work.request.created_by_user_id,
        continuationTextForConnection(request.id, state, label, state === "submitted", discovered.map(tool => tool.name), null),
        humanResult(updated, work.request.created_by_user_id, state));
    }
    if (!active || !parentAlive || !bindingMatches) {
      // A rename/recheck of the same live binding is not permission to remove
      // its credential. Detached or withdrawn original grants do need cleanup.
      await recordOauthCleanup(client, {
        accountId: work.request.account_id, createdByUserId: work.request.created_by_user_id,
        brokerBaseUrl: work.brokerBaseUrl, environment: work.environment,
        capabilityExpiresAt: work.capabilityExpiresAt, connectRequestId: work.connectRequestId,
        nangoConnectionId: work.nangoConnectionId, provenance: !active ? "withdrawn" : "session_ended",
        provider: work.provider, targetOrigin: work.serverUrl,
      });
    }
    if (attemptMatches) await client.query(
      `UPDATE mcp_oauth_connect_requests SET state = $2, revision = revision + 1, updated_at = clock_timestamp()
       WHERE connect_request_id = $1 AND nango_connection_id = $3`,
      [work.connectRequestId, state === "submitted" ? "completed" : "failed", work.nangoConnectionId],
    );
    await appendAudit(client, { accountId: work.request.account_id, actorUserId: work.request.created_by_user_id },
      "mcp_interaction.submitted", "mcp_interaction_request", request.id,
      { connection_id: work.localConnectionId, external_effect_count: 0, kind: "oauth", outcome: state });
    return { status: "applied", request: interactionRecord(updated, null) };
  });
}

/**
 * Verifies one raw Nango webhook: HMAC over the exact raw body, then event,
 * environment, provider and request identity, then the authoritative
 * credential-free backend readback. Nothing is acknowledged before it is
 * persisted.
 */
export async function applyNangoAuthWebhook(
  pool: Pool,
  rawBody: string,
  signatureHeader: string | string[] | undefined,
  webhook: NangoAuthWebhook | null,
  dependencies: McpInteractionDependencies = mcpInteractionDependencies(),
): Promise<NangoWebhookOutcome> {
  const config = dependencies.nangoConfig ?? loadNangoConfig();
  if (!config) return { status: "unavailable" };
  if (!verifyNangoWebhookSignature(config, rawBody, signatureHeader)) {
    return { status: "unverified" };
  }
  if (!webhook || webhook.type !== "auth") return { status: "ignored" };
  const connectRequestId = webhook.tags[NANGO_CONNECT_REQUEST_TAG];
  if (!connectRequestId) return { status: "ignored" };
  if (config.environment && webhook.environment && webhook.environment !== config.environment) {
    return { status: "ignored" };
  }
  const row = await readConnectRequest(pool, connectRequestId, null);
  const frozenBind = async () => {
    // A late grant for an attempt this product already closed: only when the
    // authoritative metadata identifies one of our frozen attempts by its own
    // server-generated tag is the materialized connection bound for cleanup.
    // Never a caller-supplied identity.
    const frozen = await pool.query<{
      id: string; target_origin: string; account_id: string;
      created_by_user_id: string; provider: string; broker_base_url: string | null;
      environment: string | null; capability_expires_at: Date | null;
    }>(`SELECT id, target_origin, account_id, created_by_user_id, provider,
        broker_base_url, environment, capability_expires_at
        FROM mcp_oauth_cleanup WHERE connect_request_id=$1 AND closure_state='open'`, [connectRequestId]);
    for (const attempt of frozen.rows) {
      if (attempt.broker_base_url !== config.baseUrl || attempt.environment !== config.environment ||
          attempt.provider !== webhook.providerConfigKey) continue;
      const matches = await listNangoConnectionsByTag(config,
        { [NANGO_CONNECT_REQUEST_TAG]: connectRequestId }, dependencies.fetcher ?? fetch);
      const mine = matches.find((entry) => entry.connectionId === webhook.connectionId &&
        entry.providerConfigKey === attempt.provider &&
        entry.tags[NANGO_CONNECT_REQUEST_TAG] === connectRequestId &&
        entry.tags["mcp_server_url"] === attempt.target_origin &&
        entry.tags["account_id"] === attempt.account_id &&
        entry.tags["user_id"] === attempt.created_by_user_id &&
        entry.tags["provider"] === attempt.provider);
      if (!mine) continue;
      await inTransaction(pool, async (client) => recordOauthCleanup(client, {
        accountId: attempt.account_id, createdByUserId: attempt.created_by_user_id,
        brokerBaseUrl: attempt.broker_base_url, environment: attempt.environment,
        capabilityExpiresAt: attempt.capability_expires_at, connectRequestId,
        nangoConnectionId: mine.connectionId, provenance: "late_grant",
        provider: attempt.provider, targetOrigin: attempt.target_origin,
      }));
    }
    return { status: "ignored" as const };
  };
  if (!row) {
    return frozenBind();
  }
  if (webhook.providerConfigKey !== row.provider || config.baseUrl !== row.broker_base_url ||
      config.environment !== row.environment) {
    return { status: "ignored" };
  }
  if (row.state !== "pending" && row.state !== "waiting") {
    // A terminal (rejected/expired/closed) attempt can still receive a late
    // grant; only its own frozen identity may be cleaned.
    return frozenBind();
  }
  if (row.expires_at.getTime() <= Date.now()) return frozenBind();
  const candidates = await listNangoConnectionsByTag(
    config,
    { [NANGO_CONNECT_REQUEST_TAG]: connectRequestId },
    dependencies.fetcher ?? fetch,
  );
  const match = candidates.find(
    (entry) =>
      entry.connectionId === webhook.connectionId &&
      matchesFrozenOAuthIdentity(config, row, connectRequestId, entry),
  );
  if (!match) return { status: "ignored" };
  if (!webhook.success) {
    await pool.query(
      `UPDATE mcp_oauth_connect_requests SET state = 'failed', revision = revision + 1,
         updated_at = clock_timestamp() WHERE connect_request_id = $1 AND state IN ('pending','waiting')
         AND nango_connection_id IS NULL`,
      [connectRequestId],
    );
    // The human decision settles truthfully as failed; nothing reconnects.
    await inTransaction(pool, async (client) => {
      const request = await readInteraction(client, row.account_id, row.id, row.created_by_user_id, true);
      if (request && (request.state === "pending" || request.state === "waiting")) {
        const updated = await markTerminal(client, request, row.created_by_user_id, "failed", "oauth_failed");
        await enqueueContinuationIntent(
          client,
          updated,
          row.created_by_user_id,
          continuationText(updated, "failed", "The authorization did not complete."),
          humanResult(updated, row.created_by_user_id, "failed"),
        );
      }
    });
    return { status: "ignored" };
  }
  return completeConnectRequest(
    pool,
    row,
    connectRequestId,
    match.connectionId,
    match.providerConfigKey,
    match,
    dependencies,
  );
}

/**
 * Polling supplement for a lost webhook. Discovery is server-side: the
 * authoritative backend list is searched by the bound connect_request_id tag,
 * and a client-supplied connection id is never authority.
 */
export async function pollNangoConnectRequest(
  pool: Pool,
  auth: AuthContext,
  connectRequestId: string,
  dependencies: McpInteractionDependencies = mcpInteractionDependencies(),
): Promise<NangoWebhookOutcome> {
  const config = dependencies.nangoConfig ?? loadNangoConfig();
  if (!config) return { status: "unavailable" };
  const row = await readConnectRequest(pool, connectRequestId, auth.accountId, auth.userId);
  if (!row) return { status: "ignored" };
  if (config.baseUrl !== row.broker_base_url || config.environment !== row.environment) return { status: "ignored" };
  if (row.state === "completed") return { status: "ignored" };
  if (row.expires_at.getTime() <= Date.now()) return { status: "ignored" };
  const candidates = await listNangoConnectionsByTag(
    config,
    { [NANGO_CONNECT_REQUEST_TAG]: connectRequestId },
    dependencies.fetcher ?? fetch,
  );
  const match = candidates.find(
    (entry) => matchesFrozenOAuthIdentity(config, row, connectRequestId, entry),
  );
  if (!match) return { status: "ignored" };
  return completeConnectRequest(
    pool,
    row,
    connectRequestId,
    match.connectionId,
    match.providerConfigKey,
    match,
    dependencies,
  );
}
