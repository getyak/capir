import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import type { ChatMediaStorage } from "./chatMediaStorage.js";

export interface OperatorTestDeployment {
  enabled: boolean;
  webOrigin: string | null;
  backendOrigin: string | null;
}

/** Nonsecret serving scope shared by session and MCP-bearer resolvers. */
export function operatorTestDeployment(config?: BackendConfig): OperatorTestDeployment {
  return {
    enabled: config?.internalLabEnabled === true && config.capirTests?.enabled === true,
    webOrigin: config?.capirTests?.webOrigin ?? null,
    backendOrigin: config?.capirTests?.backendOrigin ?? null,
  };
}

/** Token lookup parameters 2–4: enabled, exact Web origin, exact backend origin.
 * Human-parent Lab entries retain their existing canonical authority. */
export const operatorLabDeploymentActiveSQL = `(NOT EXISTS (
  SELECT 1 FROM lab_test_workspace_entries e
  WHERE e.session_id=sessions.id AND e.owner_principal_id IS NOT NULL
) OR ($2::boolean AND EXISTS (
  SELECT 1 FROM capir_test_runs r
  WHERE r.account_id=sessions.account_id AND r.user_id=sessions.user_id
    AND r.web_origin=$3 AND r.backend_origin=$4
)))`;

// Called only in queries whose aliases are the actual users/sessions tables.
// One shared authority predicate governs every Lab API/session read. A
// lab_human session is active through exactly one lineage: either its existing
// human parent session, or an operator-principal entry that matches its run's
// workspace while the principal remains enabled at the recorded generation for
// the run's exact registered origin pair. Principal revocation or rotation
// invalidates operator entries even while cleanup is pending.
export const labWorkspaceSessionActiveSQL = `(users.kind <> 'lab_human' OR EXISTS (
  SELECT 1 FROM lab_test_workspaces w
  JOIN lab_test_workspace_entries e ON e.workspace_id=w.id AND e.session_id=sessions.id
  JOIN sessions parent ON parent.id=e.owner_session_id
    AND parent.account_id=w.owner_account_id AND parent.user_id=w.owner_user_id
  JOIN users owner ON owner.account_id=parent.account_id AND owner.id=parent.user_id
  WHERE w.target_account_id=users.account_id AND w.target_user_id=users.id
    AND w.state='active' AND w.expires_at>clock_timestamp()
    AND e.revoked_at IS NULL AND e.expires_at>clock_timestamp()
    AND parent.revoked_at IS NULL AND parent.expires_at>clock_timestamp()
    AND owner.status='active' AND owner.kind<>'lab_human'
) OR EXISTS (
  SELECT 1 FROM lab_test_workspaces w
  JOIN lab_test_workspace_entries e ON e.workspace_id=w.id AND e.session_id=sessions.id
  JOIN capir_test_runs r ON r.workspace_id=w.id AND r.principal_id=e.owner_principal_id
  JOIN capir_test_provisioners p ON p.id=r.principal_id
  WHERE w.target_account_id=users.account_id AND w.target_user_id=users.id
    AND w.owner_principal_id=r.principal_id
    AND w.owner_account_id IS NULL AND w.owner_user_id IS NULL
    AND r.account_id=w.target_account_id AND r.user_id=w.target_user_id
    AND w.state='active' AND w.expires_at>clock_timestamp()
    AND e.revoked_at IS NULL AND e.expires_at>clock_timestamp()
    AND e.owner_session_id IS NULL
    AND e.principal_generation=r.principal_generation
    AND p.state='enabled' AND p.generation=e.principal_generation
    AND p.web_origin=r.web_origin AND p.backend_origin=r.backend_origin
))`;

export async function lockLabMediaWorkspace(client: PoolClient, auth: AuthContext,
  storage: ChatMediaStorage): Promise<string> {
  const row = (await client.query<{id:string;state:string;active:boolean;media_scope_hash:string}>(
    `SELECT id,state,expires_at>clock_timestamp() AS active,media_scope_hash
     FROM lab_test_workspaces WHERE target_account_id=$1 AND target_user_id=$2 FOR SHARE`,
    [auth.accountId,auth.userId])).rows[0];
  if (!row || row.state!=="active" || !row.active) {
    throw new ApiError(410,"LAB_TEST_WORKSPACE_CLOSED","This test workspace no longer accepts uploads.");
  }
  if (!storage.labScopeID || row.media_scope_hash!==storage.labScopeID) {
    throw new ApiError(503,"LAB_WORKSPACE_MEDIA_SCOPE_CHANGED","Restore the workspace's original media storage before uploading.");
  }
  return row.id;
}

export async function trackedLabMediaPut(pool: Pool, workspaceId: string, mediaId: string,
  storage: ChatMediaStorage, objectKey: string, body: Uint8Array, contentType: string): Promise<void> {
  const id=randomUUID();
  // Separate committed intent: a process crash during PUT must not erase the
  // evidence that remote bytes could still arrive after cleanup begins.
  await pool.query(`INSERT INTO lab_test_workspace_media_writes(id,workspace_id,media_id)
    VALUES ($1,$2,$3)`,[id,workspaceId,mediaId]);
  try {
    await storage.put(objectKey,body,contentType);
  } catch (error) {
    await pool.query(`UPDATE lab_test_workspace_media_writes SET state=$2,
      settled_at=CASE WHEN $2='settled' THEN now() ELSE NULL END WHERE id=$1`,
      [id,storage.provider==="local"?"settled":"unknown"]);
    throw error;
  }
  await pool.query("UPDATE lab_test_workspace_media_writes SET state='settled',settled_at=now() WHERE id=$1",[id]);
}
