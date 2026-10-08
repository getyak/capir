import { randomBytes, randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  type SessionResponse,
} from "@talent-signal/contracts";
import type { PoolClient } from "pg";

import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import { assertUserTestAuthorityLocked, type CapirUserTestAuthority } from "./capirAuth.js";
import { assertAccountActive } from "./accountIdentity.js";
import { labStopAuthorityKeySQL } from "./labStopAuthority.js";
import {
  consumeDummyPasswordWork,
  verifyPasswordCredential,
} from "./passwordCredential.js";

/**
 * Atomic password admission for operator-provisioned test identities (Task 1).
 *
 * Canonical lock order shared with stop, verified cleanup, creation and
 * principal rotation: the Lab-stop advisory key, then the provisioning
 * principal row, then the workspace row, then credential/entry rows. Holding
 * the principal lock across credential verification serializes admission with
 * rotation: an admission that commits before a rotation is legitimate, while a
 * rotation that completed first can never be followed by an unusable "ready"
 * success. Only an active, unexpired run whose owner/run/target lineage all
 * match is admitted, and the same transaction creates both the session and its
 * matching operator-lineage Lab entry with TTL clamped to the run deadline.
 */

export interface LabPasswordIdentity {
  accountId: string;
  accountName: string;
  accountSlug: string;
  displayName: string;
  role: "admin" | "member";
  userEmail: string;
  userId: string;
  userKind: "lab_human";
  username: string | null;
}

/** A password rejection. The caller commits the intended lockout bookkeeping
 * only; no session or entry is ever minted for a rejected password. */
export class LabPasswordRejection extends Error {
  constructor(readonly credentialLocked: boolean) {
    super("LAB_PASSWORD_REJECTED");
    this.name = "LabPasswordRejection";
  }
}

interface LockedRun {
  run_id: string;
  workspace_id: string;
  principal_id: string;
  principal_generation: number;
  run_account_id: string;
  run_user_id: string;
  run_owner_kind: "operator" | "user_grant";
  run_owner_grant_id: string | null;
  run_owner_account_id: string | null;
  run_owner_user_id: string | null;
  owner_backing_session_id: string | null;
  owner_authority_live: boolean;
  workspace_state: "active" | "deleting" | "deleted";
  workspace_expires_at: Date;
  database_now: Date;
  lineage_ok: boolean;
  principal_state: "enabled" | "revoked" | null;
  principal_generation_current: number | null;
  principal_web_origin: string | null;
  principal_backend_origin: string | null;
  run_web_origin: string;
  run_backend_origin: string;
}

/**
 * Shared admission gate: canonical lock order and full lineage/clock recheck
 * for both direct password login and the private handoff exchange.
 */
export async function lockLabRunForAdmission(
  client: PoolClient,
  config: BackendConfig,
  identity: LabPasswordIdentity,
  authorizingGrantId?: string,
): Promise<LockedRun> {
  if (config.internalLabEnabled !== true || config.capirTests?.enabled !== true) {
    throw new ApiError(403, "CAPIR_TESTS_DISABLED", "Internal test-account access is disabled on this service.");
  }
  if (identity.userKind !== "lab_human") {
    throw new ApiError(
      400,
      "LAB_TEST_SESSION_ADMISSION_INVALID",
      "Operator-run admission applies only to isolated test identities.",
    );
  }
  const located = (
    await client.query<{ workspace_id: string; principal_id: string; owner_kind:string; owner_account_id:string; owner_user_id:string }>(
      `SELECT w.id AS workspace_id, r.principal_id, r.owner_kind, r.owner_account_id, r.owner_user_id
         FROM lab_test_workspaces w
         JOIN capir_test_runs r ON r.workspace_id = w.id
        WHERE w.target_account_id = $1 AND w.target_user_id = $2`,
      [identity.accountId, identity.userId],
    )
  ).rows[0];
  if (!located) {
    throw new ApiError(
      401,
      "LAB_TEST_SESSION_ADMISSION_DENIED",
      "The username, email, or password is not recognized.",
    );
  }
  let userAuthority: CapirUserTestAuthority | null = null;
  if (located.owner_kind === 'user_grant') {
    const settings=config.capirAuth;
    if (!settings?.enabled || settings.webOrigin!==config.capirTests.webOrigin || settings.backendOrigin!==config.capirTests.backendOrigin)
      throw new ApiError(403,'CAPIR_AUTH_DISABLED','CLI authorization is unavailable.');
    // A handoff is pinned to its actual authorizing grant. Password admission
    // uses this owner's most recent currently entitled grant, not the creator
    // forever. Revoked old entries remain attached to the old backing session.
    const candidate=(await client.query<{id:string;backing_session_id:string}>(`SELECT g.id,g.backing_session_id
      FROM capir_auth_grants g JOIN capir_user_test_entitlements t ON t.account_id=g.account_id AND t.user_id=g.user_id
      JOIN sessions s ON s.id=g.backing_session_id
      WHERE g.account_id=$1 AND g.user_id=$2 AND ($3::uuid IS NULL OR g.id=$3)
        AND g.state='active' AND g.absolute_expires_at>clock_timestamp()
        AND g.web_origin=$4 AND g.backend_origin=$5
        AND t.state='active' AND t.generation=g.test_entitlement_generation
        AND 'test.handoff'=ANY(g.scopes) AND 'test.handoff'=ANY(t.scopes)
        AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
      ORDER BY g.created_at DESC LIMIT 1`,[located.owner_account_id,located.owner_user_id,authorizingGrantId??null,settings.webOrigin,settings.backendOrigin])).rows[0];
    if (!candidate) throw new ApiError(401,'LAB_TEST_SESSION_ADMISSION_DENIED','The username, email, or password is not recognized.');
    userAuthority={grantId:candidate.id,accountId:located.owner_account_id,userId:located.owner_user_id,
      backingSessionId:candidate.backing_session_id,webOrigin:settings.webOrigin,backendOrigin:settings.backendOrigin};
    await assertUserTestAuthorityLocked(client,userAuthority,'test.handoff');
  }
  // Serialize with stop/expiry: the stop transaction publishes its intent under
  // the same advisory lock before taking the workspace row lock.
  await client.query(`SELECT pg_advisory_xact_lock(${labStopAuthorityKeySQL})`, [
    identity.accountId,
  ]);
  // Canonical order (principal row before workspace row) matches creation and
  // principal rotation: holding this share lock across verification makes a
  // concurrent rotation wait for the admission decision instead of racing it.
  await client.query(
    "SELECT id FROM capir_test_provisioners WHERE id = $1 FOR SHARE",
    [located.principal_id],
  );
  const run = (
    await client.query<LockedRun>(
      `SELECT r.id AS run_id, r.workspace_id, r.principal_id, r.principal_generation,
              r.account_id AS run_account_id, r.user_id AS run_user_id,
              r.owner_kind AS run_owner_kind, r.owner_grant_id AS run_owner_grant_id,
              r.owner_account_id AS run_owner_account_id, r.owner_user_id AS run_owner_user_id,
              g.backing_session_id AS owner_backing_session_id,
              r.web_origin AS run_web_origin, r.backend_origin AS run_backend_origin,
              w.state AS workspace_state, w.expires_at AS workspace_expires_at,
              clock_timestamp() AS database_now,
              ((r.owner_kind = 'operator' AND w.owner_principal_id = r.principal_id
                AND w.owner_account_id IS NULL AND w.owner_user_id IS NULL
                AND r.account_id = w.target_account_id
                AND r.user_id = w.target_user_id)
               OR (r.owner_kind = 'user_grant' AND r.owner_grant_id IS NOT NULL
                AND w.owner_account_id = r.owner_account_id
                AND w.owner_user_id = r.owner_user_id
                AND w.owner_principal_id IS NULL
                AND r.account_id = w.target_account_id
                AND r.user_id = w.target_user_id)) AS lineage_ok,
              (r.owner_kind <> 'user_grant' OR EXISTS (
                 SELECT 1 FROM capir_auth_grants ag
                 JOIN capir_user_test_entitlements te
                   ON te.account_id = ag.account_id AND te.user_id = ag.user_id
                  AND te.state = 'active'
                WHERE ag.id = r.owner_grant_id
                  AND ag.state = 'active'
                  AND ag.absolute_expires_at > clock_timestamp()
                  AND ag.backing_session_id IS NOT NULL)) AS owner_authority_live,
              p.state AS principal_state, p.generation AS principal_generation_current,
              p.web_origin AS principal_web_origin, p.backend_origin AS principal_backend_origin
         FROM lab_test_workspaces w
         JOIN capir_test_runs r ON r.workspace_id = w.id
         LEFT JOIN capir_auth_grants g ON g.id = r.owner_grant_id
         LEFT JOIN capir_test_provisioners p ON p.id = r.principal_id
        WHERE w.id = $1 AND w.target_account_id = $2 AND w.target_user_id = $3
        FOR UPDATE OF w`,
      [located.workspace_id, identity.accountId, identity.userId],
    )
  ).rows[0];
  if (
    !run ||
    !run.lineage_ok ||
    (run.run_owner_kind !== "user_grant" && !run.owner_authority_live) ||
    run.run_account_id !== identity.accountId ||
    run.run_user_id !== identity.userId
  ) {
    throw new ApiError(
      401,
      "LAB_TEST_SESSION_ADMISSION_DENIED",
      "The username, email, or password is not recognized.",
    );
  }
  if (run.run_web_origin !== config.capirTests.webOrigin || run.run_backend_origin !== config.capirTests.backendOrigin) {
    throw new ApiError(403, "CAPIR_TEST_ORIGIN_DENIED", "This test run belongs to a different serving origin pair.");
  }
  const principalActive =
    run.principal_state === "enabled" &&
    run.principal_generation_current === run.principal_generation &&
    run.principal_web_origin === run.run_web_origin &&
    run.principal_backend_origin === run.run_backend_origin;
  if (!principalActive) {
    throw new ApiError(
      403,
      "CAPIR_TEST_PRINCIPAL_INACTIVE",
      "This test run's provisioning principal is no longer active.",
    );
  }
  if (run.workspace_state !== "active") {
    throw new ApiError(
      410,
      "LAB_TEST_WORKSPACE_CLOSED",
      "This test workspace is closed or being cleaned up.",
    );
  }
  if (run.workspace_expires_at.getTime() <= run.database_now.getTime()) {
    throw new ApiError(
      410,
      "LAB_TEST_WORKSPACE_CLOSED",
      "This test workspace is closed or being cleaned up.",
    );
  }
  await assertAccountActive(client, identity.accountId);
  if (userAuthority) run.owner_backing_session_id=userAuthority.backingSessionId;
  return run;
}

/** Insert the session and its matching operator-lineage Lab entry. */
async function insertAdmittedSession(
  client: PoolClient,
  config: BackendConfig,
  run: LockedRun,
  identity: LabPasswordIdentity,
  clientLabel: string,
): Promise<SessionResponse> {
  const active = (
    await client.query<{ count: string }>(
      `SELECT count(*) AS count FROM lab_test_workspace_entries e
        JOIN sessions s ON s.id = e.session_id
       WHERE e.workspace_id = $1
         AND e.revoked_at IS NULL AND e.expires_at > clock_timestamp()
         AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()`,
      [run.workspace_id],
    )
  ).rows[0]!;
  if (Number(active.count) >= 5) {
    throw new ApiError(
      409,
      "LAB_WORKSPACE_ENTRY_LIMIT",
      "Leave an existing test session before starting another.",
    );
  }
  const accessToken = randomBytes(32).toString("base64url");
  const sessionId = randomUUID();
  // Clamp the TTL to the run deadline using the database clock that decided
  // admission, so session and entry can never outlive the run.
  const expiresAt = new Date(
    Math.min(
      run.database_now.getTime() + config.sessionTtlSeconds * 1_000,
      run.workspace_expires_at.getTime(),
    ),
  );
  await client.query(
    `INSERT INTO sessions(id, account_id, user_id, token_hash, client_label, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      sessionId,
      identity.accountId,
      identity.userId,
      sha256(accessToken),
      clientLabel,
      expiresAt,
    ],
  );
  await client.query(
    `INSERT INTO lab_test_workspace_entries(
       id, workspace_id, owner_session_id, owner_principal_id, principal_generation,
       session_id, token_hash, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      run.workspace_id,
      // Entry lineage: an operator run descends from its provisioning
      // principal; a user-grant run descends from the grant's backing session
      // so revoking that grant invalidates exactly its derived entries.
      run.run_owner_kind === "user_grant" ? run.owner_backing_session_id : null,
      run.run_owner_kind === "user_grant" ? null : run.principal_id,
      run.run_owner_kind === "user_grant" ? null : run.principal_generation,
      sessionId,
      sha256(accessToken),
      expiresAt,
    ],
  );
  return {
    contract_version: CONTRACT_VERSION,
    access_token: accessToken,
    expires_at: expiresAt.toISOString(),
    account: {
      id: identity.accountId,
      slug: identity.accountSlug,
      name: identity.accountName,
    },
    user: {
      id: identity.userId,
      email: identity.userEmail,
      display_name: identity.displayName,
      kind: identity.userKind,
      role: identity.role,
      username: identity.username,
    },
  };
}

/** Private handoff admission: no password, same lineage/expiry recheck. */
export async function admitLabPasswordSession(
  client: PoolClient,
  config: BackendConfig,
  identity: LabPasswordIdentity,
  clientLabel: string,
  authorizingGrantId?: string,
): Promise<SessionResponse> {
  const run = await lockLabRunForAdmission(client, config, identity, authorizingGrantId);
  return insertAdmittedSession(client, config, run, identity, clientLabel);
}

/**
 * Direct password admission. The stored scrypt credential is locked and
 * verified inside the admission transaction; a rejection throws
 * `LabPasswordRejection` so the login route can roll back everything and
 * commit only the intended lockout bookkeeping before the generic failure.
 */
export async function admitLabPasswordLogin(
  client: PoolClient,
  config: BackendConfig,
  identity: LabPasswordIdentity,
  password: string,
  clientLabel: string,
): Promise<SessionResponse> {
  const run = await lockLabRunForAdmission(client, config, identity);
  const credential = (
    await client.query<{
      password_scrypt: string;
      failed_attempts: number;
      locked_until: Date | null;
    }>(
      `SELECT password_scrypt, failed_attempts, locked_until
         FROM password_credentials
        WHERE account_id = $1 AND user_id = $2
        FOR UPDATE`,
      [identity.accountId, identity.userId],
    )
  ).rows[0];
  if (!credential) {
    await consumeDummyPasswordWork(password);
    throw new LabPasswordRejection(false);
  }
  const passwordMatches = await verifyPasswordCredential(password, credential.password_scrypt);
  const isLocked = credential.locked_until !== null && credential.locked_until > new Date();
  if (!passwordMatches || isLocked) {
    throw new LabPasswordRejection(isLocked);
  }
  await client.query(
    `UPDATE password_credentials
        SET failed_attempts = 0, locked_until = NULL
      WHERE account_id = $1 AND user_id = $2`,
    [identity.accountId, identity.userId],
  );
  return insertAdmittedSession(client, config, run, identity, clientLabel);
}
