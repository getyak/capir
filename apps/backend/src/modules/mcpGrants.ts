import { randomBytes, randomUUID } from "node:crypto";

import type {
  McpClientGrant,
  McpClientGrantCreateRequest,
  McpClientGrantCreateResponse,
  McpClientGrantListResponse,
  McpClientGrantResponse,
  McpClientGrantRevokeRequest,
  McpEndpointsResponse,
  McpGrantScope,
} from "@talent-signal/contracts";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import { sha256 } from "../lib/hash.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import { labWorkspaceSessionActiveSQL, operatorLabDeploymentActiveSQL, type OperatorTestDeployment } from "./labWorkspaceAccess.js";
import type { AuthContext } from "./auth.js";

/**
 * Outbound MCP client grants.
 *
 * A token is random, workspace-scoped, and stored only as a SHA-256 hash. The
 * raw value is returned exactly once at creation. Revocation is checked on
 * every authenticated MCP request. Login session tokens are never accepted by
 * the MCP endpoint because only this table is consulted.
 */

const TOKEN_PREFIX = "tsmcp_";
const MAX_EXPIRY_DAYS = 30;
const LAST_USED_REFRESH_MS = 60_000;

export interface McpGrantContext {
  accountId: string;
  createdByUserId: string;
  grantId: string;
  name: string;
  scopes: McpGrantScope[];
}

export interface McpGrantAuthority {
  deploymentWorkspaceIds?: readonly string[];
  operatorTestDeployment?: OperatorTestDeployment;
}

interface McpGrantRow {
  account_id: string;
  created_at: Date;
  created_by_user_id: string;
  expires_at: Date;
  id: string;
  last_used_at: Date | null;
  name: string;
  revoked_at: Date | null;
  revision: number;
  scopes: string[];
  token_hint: string;
}

const GRANT_COLUMNS = `id, name, token_hint, scopes, expires_at, revoked_at,
  last_used_at, revision, created_at, created_by_user_id, account_id`;

function grantStatus(row: McpGrantRow): McpClientGrant["status"] {
  if (row.revoked_at) return "revoked";
  if (row.expires_at.getTime() <= Date.now()) return "expired";
  return "active";
}

function grantRecord(row: McpGrantRow): McpClientGrant {
  return {
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    id: row.id,
    last_used_at: row.last_used_at?.toISOString() ?? null,
    name: row.name,
    revoked_at: row.revoked_at?.toISOString() ?? null,
    revision: row.revision,
    scopes: row.scopes.filter(
      (scope): scope is McpGrantScope =>
        scope === "workspace_metadata_read" || scope === "people_directory_read",
    ),
    status: grantStatus(row),
    token_hint: row.token_hint,
  };
}

function issueToken(): { hint: string; token: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    hint: `${token.slice(0, 6)}…${token.slice(-4)}`,
    token,
  };
}

export function publicMcpEndpoint(
  publicOrigin: string | null,
): McpEndpointsResponse {
  return {
    authorization_scheme: publicOrigin ? "Bearer" : null,
    configured: Boolean(publicOrigin),
    contract_version: CONTRACT_VERSION,
    note: publicOrigin
      ? "The published endpoint is served by this deployment. Each client uses its own scoped bearer token; browser login cookies are not accepted here."
      : "This deployment has not published an MCP endpoint yet, so no endpoint is shown. Ask the operator to enable it before creating a client.",
    public_origin: publicOrigin,
    streamable_http_url: publicOrigin ? `${publicOrigin}/api/mcp` : null,
  };
}

export function endpointDescriptor(
  publicOrigin: string,
  token: string,
): McpClientGrantCreateResponse["endpoint"] {
  const url = `${publicOrigin}/api/mcp`;
  return {
    authorization_scheme: "Bearer",
    configuration_json: JSON.stringify(
      {
        headers: { Authorization: `Bearer ${token}` },
        transport: "streamable-http",
        url,
      },
      null,
      2,
    ),
    streamable_http_url: url,
  };
}

export async function listMcpClientGrants(
  pool: Pool,
  auth: AuthContext,
): Promise<McpClientGrantListResponse> {
  const result = await pool.query<McpGrantRow>(
    `SELECT ${GRANT_COLUMNS} FROM mcp_client_grants
     WHERE account_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 200`,
    [auth.accountId],
  );
  return {
    contract_version: CONTRACT_VERSION,
    grants: result.rows.map(grantRecord),
  };
}

export async function createMcpClientGrant(
  pool: Pool,
  auth: AuthContext,
  input: McpClientGrantCreateRequest,
  publicOrigin: string | null,
): Promise<McpClientGrantCreateResponse> {
  if (!publicOrigin) {
    throw new ApiError(
      409,
      "MCP_ENDPOINT_NOT_CONFIGURED",
      "No published MCP endpoint is configured for this deployment, so a client token cannot be issued yet.",
    );
  }
  const scopes = [...new Set(input.scopes)] as McpGrantScope[];
  const { hint, token } = issueToken();
  const tokenHash = sha256(token);
  const id = randomUUID();
  return inTransaction(pool, async (client) => {
    // Re-derive authority inside the transaction before inserting. A request
    // authenticated before a member suspension or session revocation must not
    // be able to insert a grant that a later reactivation would revive.
    await assertIssuingAuthority(client, auth);
    const actor = { accountId: auth.accountId, actorUserId: auth.userId };
    const row = (
      await client.query<McpGrantRow>(
        `INSERT INTO mcp_client_grants(
           account_id, id, created_by_user_id, name, token_hash, token_hint,
           scopes, expires_at, creation_idempotency_key, issuing_lab_session_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7::text[],
           clock_timestamp() + ($8::integer * interval '1 day'), $9, $10
         )
         ON CONFLICT (account_id, created_by_user_id, creation_idempotency_key)
         DO NOTHING
         RETURNING ${GRANT_COLUMNS}`,
        [
          auth.accountId,
          id,
          auth.userId,
          input.name,
          tokenHash,
          hint,
          scopes,
          input.expires_in_days,
          input.idempotency_key,
          auth.userKind === "lab_human" ? auth.sessionId : null,
        ],
      )
    ).rows[0];
    if (!row) {
      // The same creation request was already fulfilled. The raw token was
      // revealed once and is intentionally unrecoverable.
      throw new ApiError(
        409,
        "MCP_CLIENT_TOKEN_ALREADY_REVEALED",
        "This creation request already produced a token. Create a new client to reveal a new token.",
      );
    }
    await appendAudit(client, actor, "mcp_client_grant.created", "mcp_client_grant", id, {
      expires_in_days: input.expires_in_days,
      external_effect_count: 0,
      scopes,
    });
    return {
      contract_version: CONTRACT_VERSION,
      endpoint: endpointDescriptor(publicOrigin, token),
      grant: grantRecord(row),
      token,
    };
  });
}

export async function revokeMcpClientGrant(
  pool: Pool,
  auth: AuthContext,
  id: string,
  input: McpClientGrantRevokeRequest,
): Promise<McpClientGrantResponse> {
  return inTransaction(pool, async (client) => {
    const actor = { accountId: auth.accountId, actorUserId: auth.userId };
    const claim = await claimIdempotency(
      client,
      actor,
      `revoke_mcp_client_grant:${id}`,
      input.idempotency_key,
      input,
    );
    if (claim.replay) {
      return claim.replay.body as McpClientGrantResponse;
    }
    const row = (
      await client.query<McpGrantRow>(
        `UPDATE mcp_client_grants
         SET revoked_at = clock_timestamp(), revision = revision + 1
         WHERE account_id = $1 AND id = $2 AND revision = $3
           AND revoked_at IS NULL
         RETURNING ${GRANT_COLUMNS}`,
        [auth.accountId, id, input.expected_revision],
      )
    ).rows[0];
    if (!row) {
      const existing = (
        await client.query<McpGrantRow>(
          `SELECT ${GRANT_COLUMNS} FROM mcp_client_grants
           WHERE account_id = $1 AND id = $2`,
          [auth.accountId, id],
        )
      ).rows[0];
      if (!existing) {
        throw new ApiError(404, "MCP_CLIENT_NOT_FOUND", "This client grant no longer exists.");
      }
      if (!existing.revoked_at) {
        throw new ApiError(
          409,
          "MCP_CLIENT_CHANGED",
          "The client grant changed before it could be revoked. Read it again.",
        );
      }
      const body: McpClientGrantResponse = {
        contract_version: CONTRACT_VERSION,
        grant: grantRecord(existing),
      };
      await completeIdempotency(client, claim, 200, body);
      return body;
    }
    await appendAudit(
      client,
      actor,
      "mcp_client_grant.revoked",
      "mcp_client_grant",
      id,
      { external_effect_count: 0 },
    );
    const body: McpClientGrantResponse = {
      contract_version: CONTRACT_VERSION,
      grant: grantRecord(row),
    };
    await completeIdempotency(client, claim, 200, body);
    return body;
  });
}

/**
 * Locks the account then the issuing user, matching the account-management
 * suspension order, and requires a still-live browser session plus lab
 * authority before a grant may be created. Runs inside the caller's
 * transaction.
 */
async function assertIssuingAuthority(
  client: PoolClient,
  auth: AuthContext,
): Promise<void> {
  const account = await client.query(
    "SELECT id FROM accounts WHERE id = $1 FOR UPDATE",
    [auth.accountId],
  );
  if (!account.rowCount) {
    throw new ApiError(
      401,
      "MCP_ISSUER_NOT_ACTIVE",
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
      "MCP_ISSUER_NOT_ACTIVE",
      "The issuing member is no longer active, so no client token was created.",
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
      "MCP_ISSUER_NOT_ACTIVE",
      "The issuing session is no longer active, so no client token was created.",
    );
  }
}

/**
 * Resolves an MCP bearer token. Session tokens never reach this table and are
 * rejected by the required prefix before any hash lookup.
 *
 * A grant is only usable while its issuing user is active, while the account
 * is inside the deployment audience, and, for a lab issuer, while its test
 * workspace is still active and unexpired. The lab check is the stateless
 * translation of the session-bound lab authority: an MCP request has no
 * browser session, so it validates the workspace that owns the issuer instead.
 */
export async function resolveMcpGrant(
  pool: Pool,
  authorization: string | undefined,
  authority: McpGrantAuthority = {},
): Promise<McpGrantContext | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = (
    await pool.query<McpGrantRow & { token_hash: string }>(
      `SELECT mcp_client_grants.* FROM mcp_client_grants
       JOIN users
         ON users.account_id = mcp_client_grants.account_id
        AND users.id = mcp_client_grants.created_by_user_id
       WHERE mcp_client_grants.token_hash = $1
         AND mcp_client_grants.revoked_at IS NULL
         AND mcp_client_grants.expires_at > statement_timestamp()
         AND users.status = 'active'
         AND (
           users.kind <> 'lab_human'
           OR EXISTS (
             SELECT 1 FROM sessions
             WHERE sessions.account_id = users.account_id
               AND sessions.user_id = users.id
               AND (mcp_client_grants.issuing_lab_session_id IS NULL OR sessions.id=mcp_client_grants.issuing_lab_session_id)
               AND ${labWorkspaceSessionActiveSQL}
               AND ${operatorLabDeploymentActiveSQL}
           )
         )`,
      [sha256(token), authority.operatorTestDeployment?.enabled === true,
        authority.operatorTestDeployment?.webOrigin ?? null, authority.operatorTestDeployment?.backendOrigin ?? null, authority.operatorTestDeployment?.userAuthEnabled === true],
    )
  ).rows[0];
  if (!row) return null;
  if (
    authority.deploymentWorkspaceIds &&
    authority.deploymentWorkspaceIds.length > 0 &&
    !authority.deploymentWorkspaceIds.includes(row.account_id)
  ) {
    return null;
  }
  if (
    !row.last_used_at ||
    Date.now() - row.last_used_at.getTime() > LAST_USED_REFRESH_MS
  ) {
    await pool
      .query(
        `UPDATE mcp_client_grants SET last_used_at = clock_timestamp()
         WHERE account_id = $1 AND id = $2 AND revoked_at IS NULL`,
        [row.account_id, row.id],
      )
      .catch(() => undefined);
  }
  return {
    accountId: row.account_id,
    createdByUserId: row.created_by_user_id,
    grantId: row.id,
    name: row.name,
    scopes: row.scopes.filter(
      (scope): scope is McpGrantScope =>
        scope === "workspace_metadata_read" || scope === "people_directory_read",
    ),
  };
}

export const MCP_TOKEN_PREFIX = TOKEN_PREFIX;
export const MCP_MAX_EXPIRY_DAYS = MAX_EXPIRY_DAYS;
