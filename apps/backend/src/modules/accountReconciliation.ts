import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  ErrorResponseSchema,
  ReconciliationActionRequestSchema,
  ReconciliationPrepareRequestSchema,
  ReconciliationRecordSchema,
  type ReconciliationActionRequest,
  type ReconciliationPrepareRequest,
  type ReconciliationProof,
  type ReconciliationRecord,
} from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Pool, PoolClient } from "pg";

import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import { digestValue, sha256 } from "../lib/hash.js";
import {
  classifyAccountDataInventory,
  type AccountDataInventory,
  type ClassifyInventoryOptions,
} from "./accountIdentity.js";
import type { AuthContext } from "./auth.js";
import {
  verifyAndConsumeProviderProof,
  type CredentialChangeDeps,
} from "./accountLoginMethods.js";
import { verifyPasswordCredential } from "./passwordCredential.js";

/**
 * Reviewed historical-duplicate resolution (ADR 0018).
 *
 * Dual proof is mandatory: the canonical side re-proves the current identity
 * (step-up) and the duplicate side presents one of its own credentials. Only
 * an entirely empty duplicate (full classified inventory, validated identity
 * baseline, no indirect ownership or history) may be transferred, and the
 * transfer is one atomic transaction: credentials move to the explicitly
 * selected canonical user, the redundant login is retired with an auditable
 * alias/tombstone, its sessions are revoked, and the source account is retired
 * so no admitted-but-late write can add data afterwards. Non-empty duplicates
 * stay review-required with their inventory; nothing is re-parented here.
 */

export const RECONCILIATION_TTL_SECONDS = 15 * 60;

type ProofDescriptor =
  | { kind: "password"; user_id: string }
  | { kind: "provider"; provider: "apple" | "google"; subject_hash: string };

type FrozenPartyState = {
  account_revision: number;
  user_revision: number;
  user_status: string;
};

/**
 * Dual-proof freshness freeze (ADR 0018). Both parties' account/profile
 * revisions and proof descriptors are captured at prepare under stable locks;
 * confirm refuses any drift before a credential can move or retire.
 */
type FrozenEmailClaim = {
  normalized_email: string;
  state: string;
  account_id: string | null;
  user_id: string | null;
  claim_kind: string;
  verification_source: string | null;
  verified_at: string | null;
  revision: number;
};

type FrozenProofState = {
  prepared_at: string;
  source: FrozenPartyState;
  canonical: FrozenPartyState;
  duplicate_proof: ProofDescriptor;
  canonical_proof: ProofDescriptor;
  /** Every email reservation related to both parties, with provenance. */
  source_reservations: FrozenEmailClaim[];
  canonical_reservations: FrozenEmailClaim[];
};

type ReconciliationRow = {
  id: string;
  account_id: string;
  actor_user_id: string;
  actor_session_id: string;
  duplicate_account_id: string;
  duplicate_user_id: string;
  kind: "empty_duplicate_transfer" | "review_required";
  state: "prepared" | "confirmed" | "committed" | "cancelled";
  frozen_revision: number;
  frozen_state: FrozenProofState;
  inventory: AccountDataInventory;
  request_hash: string;
  result: unknown;
  expires_at: Date;
  created_at: Date;
};

function toRecord(row: ReconciliationRow): ReconciliationRecord {
  return {
    contract_version: CONTRACT_VERSION,
    id: row.id,
    kind: row.kind,
    state: row.state,
    frozen_revision: row.frozen_revision,
    inventory: row.inventory,
    ...(row.result === null || row.result === undefined ? {} : { result: row.result }),
    expires_at: row.expires_at.toISOString(),
    created_at: row.created_at.toISOString(),
  };
}

type DuplicateProofTarget = {
  accountId: string;
  userId: string;
  descriptor: ProofDescriptor;
};

/**
 * Resolve WHICH account/user a duplicate proof points at (read-only). The
 * identity is then verified against locked rows below; a same-email provider
 * owner without a password can never hide the actual password duplicate, and
 * genuine ambiguity fails explicitly instead of selecting an arbitrary row.
 */
async function resolveDuplicateTarget(
  client: PoolClient,
  config: BackendConfig,
  proof: ReconciliationProof,
  deps: CredentialChangeDeps,
): Promise<DuplicateProofTarget> {
  if (proof.kind === "password") {
    const result = await client.query<{
      account_id: string;
      user_id: string;
    }>(
      `SELECT pc.account_id, pc.user_id
       FROM password_credentials pc
       JOIN users u ON u.account_id = pc.account_id AND u.id = pc.user_id
       WHERE u.status = 'active'
         AND (lower(u.username) = $1 OR lower(btrim(u.email)) = $1)`,
      [proof.identifier.trim().toLowerCase()],
    );
    if (result.rows.length > 1) {
      throw new ApiError(
        409,
        "RECONCILIATION_PROOF_AMBIGUOUS",
        "More than one password login matches. Use the username of the duplicate account.",
      );
    }
    const candidate = result.rows[0];
    if (!candidate) {
      await verifyPasswordCredential(
        proof.password,
        `scrypt$v1$${"0".repeat(32)}$${"0".repeat(128)}`,
      ).catch(() => undefined);
      throw new ApiError(
        401,
        "RECONCILIATION_PROOF_FAILED",
        "The duplicate account's credential could not be verified.",
      );
    }
    return {
      accountId: candidate.account_id,
      userId: candidate.user_id,
      descriptor: { kind: "password", user_id: candidate.user_id },
    };
  }

  const verified = await verifyAndConsumeProviderProof(
    client,
    config,
    proof.provider,
    {
      challenge_id: proof.challenge_id,
      identity_token: proof.identity_token,
    },
    "talent-signal-reconciliation",
    deps,
  );
  const owner = await client.query<{ account_id: string; user_id: string }>(
    `SELECT account_id, user_id FROM auth_identities
     WHERE provider = $1 AND subject_hash = $2`,
    [verified.provider, verified.subjectHash],
  );
  const identity = owner.rows[0];
  if (!identity) {
    throw new ApiError(
      401,
      "RECONCILIATION_PROOF_FAILED",
      "The duplicate account's credential could not be verified.",
    );
  }
  return {
    accountId: identity.account_id,
    userId: identity.user_id,
    descriptor: {
      kind: "provider",
      provider: verified.provider,
      subject_hash: verified.subjectHash,
    },
  };
}

/**
 * Verify a proof against the LOCKED credential rows (READ COMMITTED alone is
 * not enough): the proof must match the credential exactly as it exists after
 * the stable locks, so a change committed between lookup and locking can never
 * be rebound to a newer revision.
 */
async function verifyDuplicateProofLocked(
  client: PoolClient,
  proof: ReconciliationProof,
  target: DuplicateProofTarget,
): Promise<void> {
  const stale = new ApiError(
    401,
    "RECONCILIATION_PROOF_FAILED",
    "The duplicate account's credential could not be verified.",
  );
  if (proof.kind === "password") {
    const row = await client.query<{ password_scrypt: string; user_id: string }>(
      `SELECT password_scrypt, user_id FROM password_credentials
       WHERE account_id = $1 AND user_id = $2
       FOR SHARE`,
      [target.accountId, target.userId],
    );
    const credential = row.rows[0];
    if (!credential) throw stale;
    const matches = await verifyPasswordCredential(
      proof.password,
      credential.password_scrypt,
    );
    if (!matches) throw stale;
    return;
  }
  const identity = await client.query<{ account_id: string; user_id: string }>(
    `SELECT account_id, user_id FROM auth_identities
     WHERE provider = $1 AND subject_hash = $2
     FOR SHARE`,
    [
      target.descriptor.kind === "provider" ? target.descriptor.provider : "",
      target.descriptor.kind === "provider" ? target.descriptor.subject_hash : "",
    ],
  );
  const row = identity.rows[0];
  if (!row || row.account_id !== target.accountId || row.user_id !== target.userId) {
    throw stale;
  }
}

async function loadRequest(
  client: Pick<Pool, "query"> | PoolClient,
  auth: AuthContext,
  id: string,
  lock: boolean,
): Promise<ReconciliationRow> {
  const result = await client.query<ReconciliationRow>(
    `SELECT * FROM account_reconciliation_requests
     WHERE id = $1 AND account_id = $2 AND actor_user_id = $3
     ${lock ? "FOR UPDATE" : ""}`,
    [id, auth.accountId, auth.userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      404,
      "RECONCILIATION_NOT_FOUND",
      "This reconciliation is not available.",
    );
  }
  return row;
}

/**
 * Prepare a reconciliation for one authenticated direction. Both credentials
 * are verified here; the classified inventory runs before anything is shown.
 */
export async function prepareReconciliation(
  pool: Pool,
  config: BackendConfig,
  auth: AuthContext,
  request: ReconciliationPrepareRequest,
  deps: CredentialChangeDeps = {},
): Promise<ReconciliationRecord> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Resolve which account the duplicate proof names (read-only; ambiguity
    // fails explicitly). The proof itself is verified against LOCKED rows
    // below, so a credential change committed in between can never rebind an
    // old proof to newer revisions.
    const duplicate = await resolveDuplicateTarget(client, config, request.proof, deps);
    if (duplicate.accountId === auth.accountId && duplicate.userId === auth.userId) {
      throw new ApiError(
        400,
        "RECONCILIATION_SAME_ACCOUNT",
        "Choose the other historical account's credential.",
      );
    }

    // Stable lock order for both parties, then both proofs under those locks.
    await lockBothParties(
      client,
      { accountId: duplicate.accountId, userId: duplicate.userId },
      { accountId: auth.accountId, userId: auth.userId },
      "SHARE",
    );
    const canonicalProof = await verifyStepUpProofLocked(client, config, auth, request, deps);
    await verifyDuplicateProofLocked(client, request.proof, duplicate);

    const sourceAccount = await client.query<{ settings_revision: number }>(
      `SELECT settings_revision FROM accounts WHERE id = $1`,
      [duplicate.accountId],
    );
    const canonicalAccount = await client.query<{ settings_revision: number }>(
      `SELECT settings_revision FROM accounts WHERE id = $1`,
      [auth.accountId],
    );
    const sourceUser = await client.query<{ profile_revision: number; status: string }>(
      `SELECT profile_revision, status FROM users WHERE account_id = $1 AND id = $2`,
      [duplicate.accountId, duplicate.userId],
    );
    const canonicalUser = await client.query<{ profile_revision: number; status: string }>(
      `SELECT profile_revision, status FROM users WHERE account_id = $1 AND id = $2`,
      [auth.accountId, auth.userId],
    );
    const sourceRevision = sourceAccount.rows[0]?.settings_revision;
    const canonicalRevision = canonicalAccount.rows[0]?.settings_revision;
    // The rendered authorization must still describe the canonical account:
    // a stale recovery screen can never freeze a newer revision.
    if (
      canonicalRevision !== request.expected_account_revision ||
      canonicalUser.rows[0]?.profile_revision !== request.expected_user_revision
    ) {
      throw new ApiError(
        409,
        "RECONCILIATION_PROOF_STALE",
        "Account settings changed since this screen was opened. Refresh and start again.",
      );
    }
    const sourceUserRow = sourceUser.rows[0];
    const canonicalUserRow = canonicalUser.rows[0];
    if (
      sourceRevision === undefined ||
      canonicalRevision === undefined ||
      !sourceUserRow ||
      !canonicalUserRow ||
      sourceUserRow.status !== "active" ||
      canonicalUserRow.status !== "active"
    ) {
      throw new ApiError(
        404,
        "RECONCILIATION_DUPLICATE_NOT_FOUND",
        "The duplicate account is not available.",
      );
    }
    const sourceReservations = await client.query<FrozenEmailClaim>(
      `SELECT normalized_email, state, account_id, user_id, claim_kind,
              verification_source, verified_at::text AS verified_at, revision
       FROM account_email_reservations
       WHERE account_id = $1 AND user_id = $2
       ORDER BY normalized_email`,
      [duplicate.accountId, duplicate.userId],
    );
    const canonicalReservations = await client.query<FrozenEmailClaim>(
      `SELECT normalized_email, state, account_id, user_id, claim_kind,
              verification_source, verified_at::text AS verified_at, revision
       FROM account_email_reservations
       WHERE account_id = $1 AND user_id = $2
       ORDER BY normalized_email`,
      [auth.accountId, auth.userId],
    );
    const frozenState: FrozenProofState = {
      prepared_at: new Date().toISOString(),
      source: {
        account_revision: sourceRevision,
        user_revision: sourceUserRow.profile_revision,
        user_status: sourceUserRow.status,
      },
      canonical: {
        account_revision: canonicalRevision,
        user_revision: canonicalUserRow.profile_revision,
        user_status: canonicalUserRow.status,
      },
      duplicate_proof: duplicate.descriptor,
      canonical_proof: canonicalProof,
      source_reservations: sourceReservations.rows,
      canonical_reservations: canonicalReservations.rows,
    };
    const inventory = await classifyAccountDataInventory(
      client,
      duplicate.accountId,
      duplicate.userId,
    );
    const kind: ReconciliationRow["kind"] = inventory.entirely_empty
      ? "empty_duplicate_transfer"
      : "review_required";
    const requestHash = digestValue({
      canonical: [auth.accountId, auth.userId],
      duplicate: [duplicate.accountId, duplicate.userId],
      kind,
    });
    const id = request.id;
    const expiresAt = new Date(Date.now() + RECONCILIATION_TTL_SECONDS * 1_000);
    await client.query(
      `INSERT INTO account_reconciliation_requests(
         id, account_id, actor_user_id, actor_session_id, duplicate_account_id, duplicate_user_id,
         kind, state, frozen_revision, frozen_state, inventory, request_hash, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'prepared', $8, $9, $10, $11, $12)`,
      [
        id,
        auth.accountId,
        auth.userId,
        auth.sessionId,
        duplicate.accountId,
        duplicate.userId,
        kind,
        sourceRevision,
        JSON.stringify(frozenState),
        JSON.stringify(inventory),
        requestHash,
        expiresAt,
      ],
    );
    await client.query(
      `INSERT INTO account_access_events(id, account_id, actor_user_id, kind, request_hash, details)
       VALUES ($1, $2, $3, 'reconciliation', $4, $5)`,
      [
        randomUUID(),
        auth.accountId,
        auth.userId,
        sha256(`prepare:${requestHash}`),
        JSON.stringify({
          reconciliation_id: id,
          kind,
          duplicate_account_id: duplicate.accountId,
          duplicate_user_id: duplicate.userId,
          frozen_revision: sourceRevision,
          prepared_at: frozenState.prepared_at,
        }),
      ],
    );
    await client.query("COMMIT");
    return toRecord(
      (await client.query<ReconciliationRow>(
        `SELECT * FROM account_reconciliation_requests WHERE id = $1`,
        [id],
      )).rows[0]!,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function verifyStepUpProofLocked(
  client: PoolClient,
  config: BackendConfig,
  auth: AuthContext,
  request: ReconciliationPrepareRequest,
  deps: CredentialChangeDeps,
): Promise<ProofDescriptor> {
  const stale = new ApiError(
    401,
    "STEP_UP_FAILED",
    "Current identity could not be verified.",
  );
  const stepUp = request.step_up;
  if (stepUp.kind === "password") {
    const credential = await client.query<{ password_scrypt: string }>(
      `SELECT password_scrypt FROM password_credentials
       WHERE account_id = $1 AND user_id = $2
       FOR SHARE`,
      [auth.accountId, auth.userId],
    );
    const row = credential.rows[0];
    const matches =
      row && (await verifyPasswordCredential(stepUp.password, row.password_scrypt));
    if (!matches) throw stale;
    return { kind: "password", user_id: auth.userId };
  }
  const verified = await verifyAndConsumeProviderProof(
    client,
    config,
    stepUp.provider,
    {
      challenge_id: stepUp.challenge_id,
      identity_token: stepUp.identity_token,
    },
    "talent-signal-reconciliation",
    deps,
  );
  const linked = await client.query(
    `SELECT 1 FROM auth_identities
     WHERE account_id = $1 AND user_id = $2
       AND provider = $3 AND subject_hash = $4
     FOR SHARE`,
    [auth.accountId, auth.userId, verified.provider, verified.subjectHash],
  );
  if (!linked.rowCount) throw stale;
  return {
    kind: "provider",
    provider: verified.provider,
    subject_hash: verified.subjectHash,
  };
}

/** Stable lock order for both parties: accounts, then users. */
async function lockBothParties(
  client: PoolClient,
  first: { accountId: string; userId: string },
  second: { accountId: string; userId: string },
  mode: "SHARE" | "UPDATE",
): Promise<void> {
  for (const accountId of [first.accountId, second.accountId].sort()) {
    await client.query(
      `SELECT settings_revision FROM accounts WHERE id = $1 FOR ${mode}`,
      [accountId],
    );
  }
  for (const party of [first, second]) {
    const user = await client.query<{ kind: string }>(
      `SELECT profile_revision, kind FROM users WHERE account_id = $1 AND id = $2 FOR ${mode}`,
      [party.accountId, party.userId],
    );
    if (user.rows[0]?.kind === "lab_human") {
      throw new ApiError(403, "TEST_ACCOUNT_READ_ONLY", "Test accounts cannot transfer permanent sign-in methods.");
    }
  }
}

/**
 * Recheck the frozen dual-proof state inside the confirm transaction. Any
 * revision drift, removed credential, inactive user, retired account, or
 * expired request rejects the transfer before anything moves.
 */
function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJSON(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function recheckFrozenState(
  client: PoolClient,
  row: ReconciliationRow,
): Promise<void> {
  const frozen = row.frozen_state;
  const stale = new ApiError(
    409,
    "RECONCILIATION_PROOF_STALE",
    "Account or credentials changed after verification. Prepare the reconciliation again.",
  );
  const sourceAccount = await client.query<{
    settings_revision: number;
    retired_at: Date | null;
  }>(
    `SELECT settings_revision, retired_at FROM accounts WHERE id = $1`,
    [row.duplicate_account_id],
  );
  const canonicalAccount = await client.query<{
    settings_revision: number;
    retired_at: Date | null;
  }>(
    `SELECT settings_revision, retired_at FROM accounts WHERE id = $1`,
    [row.account_id],
  );
  const sourceUser = await client.query<{ profile_revision: number; status: string }>(
    `SELECT profile_revision, status FROM users WHERE account_id = $1 AND id = $2`,
    [row.duplicate_account_id, row.duplicate_user_id],
  );
  const canonicalUser = await client.query<{ profile_revision: number; status: string }>(
    `SELECT profile_revision, status FROM users WHERE account_id = $1 AND id = $2`,
    [row.account_id, row.actor_user_id],
  );
  const sourceAccountRow = sourceAccount.rows[0];
  const canonicalAccountRow = canonicalAccount.rows[0];
  const sourceUserRow = sourceUser.rows[0];
  const canonicalUserRow = canonicalUser.rows[0];
  if (
    !sourceAccountRow ||
    !canonicalAccountRow ||
    !sourceUserRow ||
    !canonicalUserRow ||
    sourceAccountRow.retired_at !== null ||
    canonicalAccountRow.retired_at !== null ||
    sourceAccountRow.settings_revision !== frozen.source.account_revision ||
    canonicalAccountRow.settings_revision !== frozen.canonical.account_revision ||
    sourceUserRow.profile_revision !== frozen.source.user_revision ||
    canonicalUserRow.profile_revision !== frozen.canonical.user_revision ||
    sourceUserRow.status !== frozen.source.user_status ||
    canonicalUserRow.status !== frozen.canonical.user_status ||
    sourceUserRow.status !== "active" ||
    canonicalUserRow.status !== "active"
  ) {
    throw stale;
  }

  // Every frozen email claim must stand unchanged (address, owner, state,
  // revision and provenance). A changed claim or an unexplained third-party
  // claim demands renewed preparation; nothing moves on stale ownership.
  for (const [claimAccountId, claimUserId, frozenClaims] of [
    [row.duplicate_account_id, row.duplicate_user_id, frozen.source_reservations],
    [row.account_id, row.actor_user_id, frozen.canonical_reservations],
  ] as const) {
    const currentClaims = await client.query<FrozenEmailClaim>(
      `SELECT normalized_email, state, account_id, user_id, claim_kind,
              verification_source, verified_at::text AS verified_at, revision
       FROM account_email_reservations
       WHERE account_id = $1 AND user_id = $2
       ORDER BY normalized_email`,
      [claimAccountId, claimUserId],
    );
    if (canonicalJSON(currentClaims.rows) !== canonicalJSON(frozenClaims)) {
      throw stale;
    }
  }

  // The proven credentials must still exist and still belong to the same
  // users; an emptied inventory is not proof freshness.
  for (const [accountId, userId, descriptor] of [
    [row.duplicate_account_id, row.duplicate_user_id, frozen.duplicate_proof],
    [row.account_id, row.actor_user_id, frozen.canonical_proof],
  ] as const) {
    if (descriptor.kind === "password") {
      const credential = await client.query(
        `SELECT 1 FROM password_credentials WHERE account_id = $1 AND user_id = $2`,
        [accountId, userId],
      );
      if (!credential.rowCount) throw stale;
    } else {
      const identity = await client.query(
        `SELECT 1 FROM auth_identities
         WHERE account_id = $1 AND user_id = $2
           AND provider = $3 AND subject_hash = $4`,
        [accountId, userId, descriptor.provider, descriptor.subject_hash],
      );
      if (!identity.rowCount) throw stale;
    }
  }
}

export async function readReconciliation(
  pool: Pool,
  auth: AuthContext,
  id: string,
): Promise<ReconciliationRecord> {
  return toRecord(await loadRequest(pool, auth, id, false));
}

/**
 * Confirm and commit one prepared, entirely-empty duplicate transfer. The
 * source and destination accounts are locked FOR UPDATE in stable id order,
 * the full inventory is rechecked, then credentials transfer, the redundant
 * login is retired with a tombstone, its sessions are revoked, and the source
 * account is retired in the same transaction.
 */
export async function confirmReconciliation(
  pool: Pool,
  config: BackendConfig,
  auth: AuthContext,
  request: ReconciliationActionRequest,
  deps: CredentialChangeDeps = {},
): Promise<ReconciliationRecord> {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const row = await loadRequest(client, auth, request.id, true);
    // Prepared state is bound to the auth session that created it; a different
    // or renewed session must re-prove and prepare again.
    if (row.actor_session_id !== auth.sessionId) {
      throw new ApiError(
        409,
        "RECONCILIATION_NOT_PENDING",
        "This reconciliation belongs to another sign-in session. Prepare it again.",
      );
    }
    if (row.state === "committed") {
      // Idempotent readback of the completed operation.
      await client.query("COMMIT");
      committed = true;
      return toRecord(row);
    }
    if (row.state !== "prepared" || row.expires_at <= new Date()) {
      throw new ApiError(
        409,
        "RECONCILIATION_NOT_PENDING",
        "This reconciliation is no longer pending. Prepare it again.",
      );
    }
    if (row.kind !== "empty_duplicate_transfer") {
      await client.query(
        `UPDATE account_reconciliation_requests
         SET state = 'confirmed', updated_at = now(), result = $2
         WHERE id = $1`,
        [row.id, JSON.stringify({ protected: true, reason: "review_required" })],
      );
      await client.query("COMMIT");
      committed = true;
      throw new ApiError(
        409,
        "RECONCILIATION_REVIEW_REQUIRED",
        "Both accounts contain governed data. A reviewed reconciliation is required; nothing was merged or re-parented.",
      );
    }

    // Stable lock order (accounts, then users) prevents reconciliation and
    // self-deadlocks and matches the order every credential mutation uses.
    await lockBothParties(
      client,
      { accountId: row.duplicate_account_id, userId: row.duplicate_user_id },
      { accountId: row.account_id, userId: row.actor_user_id },
      "UPDATE",
    );
    // Revocation linearization: the admitted context is rechecked against the
    // live session row AFTER owning the account locks, with a row lock held to
    // commit. Session revocation takes the same account lock first, so either
    // the revocation committed before (rejected here) or waits behind this
    // transaction; a request admitted before revocation can never commit.
    const liveSession = await client.query(
      `SELECT id FROM sessions
       WHERE id = $1 AND account_id = $2 AND user_id = $3
         AND revoked_at IS NULL AND expires_at > now()
       FOR SHARE`,
      [auth.sessionId, auth.accountId, auth.userId],
    );
    if (!liveSession.rowCount) {
      throw new ApiError(
        401,
        "SESSION_INVALID",
        "The sign-in session for this reconciliation is no longer active. Sign in again and prepare it anew.",
      );
    }
    const sourceState = await client.query<{ retired_at: Date | null }>(
      `SELECT retired_at FROM accounts WHERE id = $1`,
      [row.duplicate_account_id],
    );
    if (sourceState.rows[0]?.retired_at) {
      throw new ApiError(
        409,
        "ACCOUNT_RETIRED",
        "This account was already transferred.",
      );
    }

    // Freshness gate: both parties' frozen revisions and the proven
    // credentials are revalidated before any inventory verdict or transfer.
    await recheckFrozenState(client, row);

    const inventoryOptions: ClassifyInventoryOptions = {
      excludeReconciliationId: row.id,
    };
    const inventory = await classifyAccountDataInventory(
      client,
      row.duplicate_account_id,
      row.duplicate_user_id,
      inventoryOptions,
    );
    if (
      !inventory.entirely_empty ||
      inventory.account_id !== row.inventory.account_id ||
      inventory.expected_user_id !== row.inventory.expected_user_id
    ) {
      await client.query(
        `UPDATE account_reconciliation_requests
         SET state = 'confirmed', updated_at = now(), result = $2
         WHERE id = $1`,
        [
          row.id,
          JSON.stringify({ protected: true, reason: "inventory_changed" }),
        ],
      );
      await client.query("COMMIT");
      committed = true;
      throw new ApiError(
        409,
        "RECONCILIATION_NOT_EMPTY",
        "The duplicate account is no longer empty. A reviewed reconciliation is required; nothing was merged or re-parented.",
      );
    }

    // Transfer provider logins to the explicitly selected canonical user.
    const movedIdentities = await client.query<{ provider: string; subject_hash: string }>(
      `UPDATE auth_identities
       SET account_id = $3, user_id = $4
       WHERE account_id = $1 AND user_id = $2
       RETURNING provider, subject_hash`,
      [row.duplicate_account_id, row.duplicate_user_id, row.account_id, row.actor_user_id],
    );
    // A password credential moves only when the canonical user has none; it is
    // never merged, overwritten, or inherited by an email match.
    const duplicatePassword = await client.query(
      `SELECT 1 FROM password_credentials
       WHERE account_id = $1 AND user_id = $2`,
      [row.duplicate_account_id, row.duplicate_user_id],
    );
    const canonicalPassword = await client.query(
      `SELECT 1 FROM password_credentials WHERE account_id = $1 AND user_id = $2`,
      [row.account_id, row.actor_user_id],
    );
    const movedPassword =
      duplicatePassword.rowCount && !canonicalPassword.rowCount
        ? await client.query(
            `UPDATE password_credentials
             SET account_id = $3, user_id = $4
             WHERE account_id = $1 AND user_id = $2
             RETURNING account_id`,
            [row.duplicate_account_id, row.duplicate_user_id, row.account_id, row.actor_user_id],
          )
        : null;
    // Rows currently being revoked elsewhere are left to that transaction:
    // both paths end with the session revoked and no lock-order inversion.
    const revocableSessions = await client.query<{ id: string }>(
      `SELECT id FROM sessions
       WHERE account_id = $1 AND user_id = $2 AND revoked_at IS NULL
       FOR UPDATE SKIP LOCKED`,
      [row.duplicate_account_id, row.duplicate_user_id],
    );
    const retiredSessions = revocableSessions.rows.length
      ? await client.query<{ id: string }>(
          `UPDATE sessions SET revoked_at = COALESCE(revoked_at, now())
           WHERE account_id = $1 AND user_id = $2 AND revoked_at IS NULL
             AND id = ANY($3::uuid[])
           RETURNING id`,
          [
            row.duplicate_account_id,
            row.duplicate_user_id,
            revocableSessions.rows.map((session) => session.id),
          ],
        )
      : { rows: [] as Array<{ id: string }> };
    await client.query(
      `UPDATE users SET status = 'revoked'
       WHERE account_id = $1 AND id = $2`,
      [row.duplicate_account_id, row.duplicate_user_id],
    );

    const retiredProviders: string[] = [
      ...movedIdentities.rows.map((identity) => identity.provider),
      // Every redundant login the duplicate actually had is retired with a
      // tombstone, whether its credential transferred or was discarded because
      // the canonical user already had one.
      ...(duplicatePassword.rowCount ? ["password"] : []),
    ];
    for (const provider of new Set(retiredProviders)) {
      await client.query(
        `INSERT INTO retired_login_aliases(
           id, account_id, user_id, canonical_account_id, canonical_user_id,
           provider, subject_hash, reconciliation_id, retired_session_ids
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          row.duplicate_account_id,
          row.duplicate_user_id,
          row.account_id,
          row.actor_user_id,
          provider,
          movedIdentities.rows.find((identity) => identity.provider === provider)?.subject_hash ?? null,
          row.id,
          retiredSessions.rows.map((session) => session.id),
        ],
      );
    }

    // Transfer every reservation UNAMBIGUOUSLY owned by the retiring user to
    // the canonical user in this same transaction: no verified alias stays
    // attached to a retired login. Changed or foreign claims already failed
    // the frozen recheck above, so nothing foreign is ever grabbed.
    await client.query(
      `UPDATE account_email_reservations
       SET account_id = $3, user_id = $4, revision = revision + 1, updated_at = now()
       WHERE account_id = $1 AND user_id = $2 AND state = 'owned'`,
      [row.duplicate_account_id, row.duplicate_user_id, row.account_id, row.actor_user_id],
    );

    // Resolve the historical email collision only when the transfer leaves one
    // canonical owner; otherwise the conflict reservation stays explicit.
    const duplicateUser = await client.query<{ email: string }>(
      `SELECT email FROM users WHERE account_id = $1 AND id = $2`,
      [row.duplicate_account_id, row.duplicate_user_id],
    );
    const normalizedEmail = (duplicateUser.rows[0]?.email ?? "").trim().toLowerCase();
    if (normalizedEmail) {
      await client.query(
        `UPDATE account_email_reservations
         SET state = 'owned', account_id = $2, user_id = $3, revision = revision + 1,
             updated_at = now()
         WHERE normalized_email = $1 AND state = 'conflict'
           AND NOT EXISTS (
             SELECT 1 FROM users u
             WHERE lower(btrim(u.email)) = $1
               AND u.kind IN ('password_human', 'google_human', 'apple_human')
               AND u.status = 'active'
               AND u.id NOT IN ($3, $4)
           )`,
        [normalizedEmail, row.account_id, row.actor_user_id, row.duplicate_user_id],
      );
    }

    for (const [accountId, actorUserId] of [
      [row.duplicate_account_id, row.duplicate_user_id],
      [row.account_id, row.actor_user_id],
    ] as const) {
      await client.query(
        `INSERT INTO account_access_events(id, account_id, actor_user_id, kind, request_hash, details)
         VALUES ($1, $2, $3, 'reconciliation', $4, $5)`,
        [
          randomUUID(),
          accountId,
          actorUserId,
          sha256(`commit:${row.id}:${accountId}`),
          JSON.stringify({
            reconciliation_id: row.id,
            outcome: "empty_duplicate_transfer",
            transferred_providers: [...new Set(retiredProviders)],
            retired_session_count: retiredSessions.rows.length,
          }),
        ],
      );
    }

    const result = {
      outcome: "empty_duplicate_transfer" as const,
      transferred_providers: [
        ...movedIdentities.rows.map((identity) => identity.provider),
        ...(movedPassword?.rowCount ? ["password"] : []),
      ],
      retired_providers: [...new Set(retiredProviders)],
      retired_session_ids: retiredSessions.rows.map((session) => session.id),
    };
    // The destination's credentials changed: advance both credential-bearing
    // revisions and consume every older bound operation, so an earlier
    // change-password attempt can never complete against the transferred state.
    await client.query(
      `UPDATE accounts SET settings_revision = settings_revision + 1 WHERE id = $1`,
      [row.account_id],
    );
    await client.query(
      `UPDATE users SET profile_revision = profile_revision + 1
       WHERE account_id = $1 AND id = $2`,
      [row.account_id, row.actor_user_id],
    );
    await client.query(
      `UPDATE credential_change_attempts
       SET consumed_at = now()
       WHERE account_id = $1 AND consumed_at IS NULL`,
      [row.account_id],
    );
    // Retirement is last: the fence then blocks every admitted-but-late write
    // to the source without redirecting it into the canonical account.
    await client.query(
      `UPDATE account_reconciliation_requests
       SET state = 'committed', updated_at = now(), result = $2
       WHERE id = $1`,
      [row.id, JSON.stringify(result)],
    );
    await client.query(
      `UPDATE accounts SET retired_at = now() WHERE id = $1`,
      [row.duplicate_account_id],
    );
    await client.query("COMMIT");
    committed = true;
    return toRecord(await loadRequest(client, auth, request.id, false));
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelReconciliation(
  pool: Pool,
  auth: AuthContext,
  request: ReconciliationActionRequest,
): Promise<ReconciliationRecord> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await loadRequest(client, auth, request.id, true);
    if (row.state !== "prepared") {
      throw new ApiError(
        409,
        "RECONCILIATION_NOT_PENDING",
        "This reconciliation is no longer pending.",
      );
    }
    await client.query(
      `UPDATE account_reconciliation_requests
       SET state = 'cancelled', updated_at = now() WHERE id = $1`,
      [row.id],
    );
    await client.query("COMMIT");
    return toRecord(await loadRequest(client, auth, request.id, false));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function registerAccountReconciliationRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: BackendConfig,
  authenticate: preHandlerHookHandler,
  labEnabled: boolean,
): void {
  void labEnabled;
  const security = [{ bearerSession: [] }];
  app.post<{ Body: ReconciliationPrepareRequest }>(
    "/v1/account/reconciliations/prepare",
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
      schema: {
        tags: ["account"],
        security,
        body: ReconciliationPrepareRequestSchema,
        response: { 201: ReconciliationRecordSchema, "4xx": ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      return reply
        .status(201)
        .send(await prepareReconciliation(pool, config, request.auth, request.body));
    },
  );
  app.get<{ Params: { id: string } }>(
    "/v1/account/reconciliations/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["account"],
        security,
        response: { 200: ReconciliationRecordSchema, "4xx": ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      return readReconciliation(pool, request.auth, request.params.id);
    },
  );
  app.post<{ Body: ReconciliationActionRequest; Params: { id: string } }>(
    "/v1/account/reconciliations/:id/confirm",
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["account"],
        security,
        body: ReconciliationActionRequestSchema,
        response: { 200: ReconciliationRecordSchema, "4xx": ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      return confirmReconciliation(pool, config, request.auth, {
        id: request.params.id,
      });
    },
  );
  app.post<{ Body: ReconciliationActionRequest; Params: { id: string } }>(
    "/v1/account/reconciliations/:id/cancel",
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["account"],
        security,
        body: ReconciliationActionRequestSchema,
        response: { 200: ReconciliationRecordSchema, "4xx": ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      return cancelReconciliation(pool, request.auth, {
        id: request.params.id,
      });
    },
  );
}
