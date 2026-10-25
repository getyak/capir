import { createHmac } from "node:crypto";
import { CONTRACT_VERSION, type PersistentSessionEnrollRequest,
  type PersistentSessionProof, type PersistentSessionResponse, type PersistentSessionRevokeRequest } from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";
import type { BackendConfig } from "../config.js";
import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";
import { REAL_USER_KINDS } from "./accountIdentity.js";

type Generation = { generation: number; expiresAt: Date };

/** Database locks choose one bounded generation, including lost-response retries. */
export function persistentAccessRenewal(secret: string, sessionId: string,
  current: Generation, now: Date, ttlSeconds: number) {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0
    || !Number.isSafeInteger(current.generation) || current.generation < 0
    || current.generation >= 2_147_483_647
    || !Number.isFinite(current.expiresAt.getTime()) || !Number.isFinite(now.getTime())) {
    throw new Error("Invalid persistent access policy.");
  }
  const rotate = current.generation === 0
    || current.expiresAt.getTime() - now.getTime() <= ttlSeconds * 500;
  const generation = current.generation + (rotate ? 1 : 0);
  const expiresAt = rotate ? new Date(now.getTime() + ttlSeconds * 1_000) : current.expiresAt;
  const accessToken = createHmac("sha256", secret)
    .update(`capri:first-party-access:v1:${sessionId}:${generation}`).digest("base64url");
  return { generation, expiresAt, accessToken, rotate };
}

type Binding = { session_id: string; account_id: string; user_id: string };
type Credential = Binding & { credential_hash: string; client_kind: "web" | "ios"; access_generation: number };
type SessionRow = { id: string; token_hash: string; expires_at: Date; revoked_at: Date | null };
type Identity = { account: PersistentSessionResponse["account"]; user: PersistentSessionResponse["user"] };
const revoked = () => new ApiError(401, "PERSISTENT_SESSION_REVOKED",
  "This login is no longer authorized. Sign in again.");
const ineligible = () => new ApiError(403, "PERSISTENT_SESSION_INELIGIBLE",
  "An active ordinary real-user session is required for login continuation.");

function validateSecret(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new ApiError(400, "PERSISTENT_SESSION_PROOF_INVALID", "The login continuation proof is invalid.");
  }
}
function admitAudience(accountId: string, audience?: readonly string[]): void {
  if (audience && !audience.includes(accountId)) throw new ApiError(403,
    "DEPLOYMENT_WORKSPACE_NOT_ADMITTED", "This workspace is outside this deployment's configured audience.");
}
async function lockIdentity(client: PoolClient, binding: Binding): Promise<Identity> {
  // Account, user, session: consistent with membership, retirement and sign-out.
  const account = (await client.query<PersistentSessionResponse["account"] & { retired_at: Date | null }>(
    "SELECT id,name,slug,retired_at FROM accounts WHERE id=$1 FOR SHARE", [binding.account_id])).rows[0];
  if (!account || account.retired_at) throw revoked();
  const user = (await client.query<PersistentSessionResponse["user"] & { status: string }>(
    "SELECT id,email,display_name,kind,account_role AS role,username,status FROM users WHERE account_id=$1 AND id=$2 FOR SHARE",
    [binding.account_id, binding.user_id])).rows[0];
  if (!user || user.status !== "active"
    || !REAL_USER_KINDS.includes(user.kind as typeof REAL_USER_KINDS[number])) throw revoked();
  const { status: _status, ...publicUser } = user;
  return { account: { id: account.id, name: account.name, slug: account.slug }, user: publicUser };
}
async function lockSession(client: PoolClient, binding: Binding): Promise<SessionRow> {
  const row = (await client.query<SessionRow>(
    "SELECT id,token_hash,expires_at,revoked_at FROM sessions WHERE id=$1 AND account_id=$2 AND user_id=$3 FOR UPDATE",
    [binding.session_id, binding.account_id, binding.user_id])).rows[0];
  if (!row || row.revoked_at) throw revoked();
  return row;
}
async function databaseNow(client: PoolClient): Promise<Date> {
  return (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
}
async function credentialFor(client: PoolClient, sessionId: string): Promise<Credential | undefined> {
  return (await client.query<Credential>(
    "SELECT * FROM persistent_session_credentials WHERE session_id=$1 FOR UPDATE", [sessionId])).rows[0];
}
async function issue(client: PoolClient, config: BackendConfig, secret: string,
  credential: Credential, session: SessionRow, identity: Identity): Promise<PersistentSessionResponse> {
  const next = persistentAccessRenewal(secret, session.id,
    { generation: credential.access_generation, expiresAt: session.expires_at },
    await databaseNow(client), config.sessionTtlSeconds);
  if (next.rotate) {
    // Retain the previous generation only until its own original deadline.
    await client.query(`UPDATE sessions SET previous_token_hash=token_hash,
      previous_token_expires_at=expires_at,token_hash=$2,expires_at=$3 WHERE id=$1`,
    [session.id, sha256(next.accessToken), next.expiresAt]);
    await client.query(`UPDATE persistent_session_credentials
      SET access_generation=$2,updated_at=clock_timestamp() WHERE session_id=$1`, [session.id, next.generation]);
  } else if (session.token_hash !== sha256(next.accessToken)) {
    throw revoked();
  }
  return { contract_version: CONTRACT_VERSION, access_token: next.accessToken,
    expires_at: next.expiresAt.toISOString(), session_id: session.id,
    account: identity.account, user: identity.user };
}

export async function enrollPersistentSession(pool: Pool, config: BackendConfig, auth: AuthContext,
  input: PersistentSessionEnrollRequest, audience?: readonly string[]): Promise<PersistentSessionResponse> {
  validateSecret(input.renewal_secret);
  if (input.client_kind !== "web" && input.client_kind !== "ios") {
    throw new ApiError(400, "PERSISTENT_SESSION_PROOF_INVALID", "The login continuation client is invalid.");
  }
  if (!REAL_USER_KINDS.includes(auth.userKind as typeof REAL_USER_KINDS[number])) throw ineligible();
  admitAudience(auth.accountId, audience);
  const binding = { session_id: auth.sessionId, account_id: auth.accountId, user_id: auth.userId };
  return inTransaction(pool, async client => {
    const identity = await lockIdentity(client, binding);
    const session = await lockSession(client, binding);
    if (session.expires_at <= await databaseNow(client)) throw ineligible();
    // These protocols have their own enrollment proof and renewal ownership.
    // A client label cannot grant authority to replace either one, including a
    // consumed Mac login that has not enrolled its device capability yet.
    const conflicting = await client.query(`SELECT 1 WHERE
      EXISTS (SELECT 1 FROM desktop_persistent_session_credentials WHERE session_id=$1)
      OR EXISTS (SELECT 1 FROM desktop_browser_login_attempts WHERE device_session_id=$1 AND state='consumed')
      OR EXISTS (SELECT 1 FROM capir_auth_grants WHERE backing_session_id=$1)`, [session.id]);
    if (conflicting.rowCount) throw ineligible();
    let credential = await credentialFor(client, session.id);
    if (credential) {
      if (credential.credential_hash !== sha256(input.renewal_secret)
        || credential.client_kind !== input.client_kind) throw ineligible();
    } else {
      credential = { ...binding, client_kind: input.client_kind,
        credential_hash: sha256(input.renewal_secret), access_generation: 0 };
      await client.query(`INSERT INTO persistent_session_credentials
        (session_id,account_id,user_id,credential_hash,client_kind) VALUES($1,$2,$3,$4,$5)`,
      [session.id, auth.accountId, auth.userId, credential.credential_hash, credential.client_kind]);
    }
    return issue(client, config, input.renewal_secret, credential, session, identity);
  });
}

async function withProof<T>(pool: Pool, input: PersistentSessionProof, audience: readonly string[] | undefined,
  operation: (client: PoolClient, credential: Credential, session: SessionRow, identity: Identity) => Promise<T>): Promise<T> {
  validateSecret(input.renewal_secret);
  const hash = sha256(input.renewal_secret);
  const binding = (await pool.query<Binding>(`SELECT session_id,account_id,user_id
    FROM persistent_session_credentials WHERE credential_hash=$1`, [hash])).rows[0];
  // UUID spelling is case-insensitive (including Swift/Foundation encoders).
  if (!binding || binding.session_id !== input.session_id.toLowerCase()
    || binding.account_id !== input.account_id.toLowerCase()
    || binding.user_id !== input.user_id.toLowerCase()) throw revoked();
  admitAudience(binding.account_id, audience);
  return inTransaction(pool, async client => {
    const identity = await lockIdentity(client, binding);
    const session = await lockSession(client, binding);
    const credential = await credentialFor(client, session.id);
    if (!credential || credential.credential_hash !== hash) throw revoked();
    return operation(client, credential, session, identity);
  });
}
export function renewPersistentSession(pool: Pool, config: BackendConfig,
  input: PersistentSessionProof, audience?: readonly string[]): Promise<PersistentSessionResponse> {
  return withProof(pool, input, audience, (client, credential, session, identity) =>
    issue(client, config, input.renewal_secret, credential, session, identity));
}
export async function revokePersistentSession(pool: Pool, _config: BackendConfig,
  input: PersistentSessionRevokeRequest, audience?: readonly string[]): Promise<{ revoked: true }> {
  validateSecret(input.renewal_secret);
  if (input.original_access_token !== undefined) validateSecret(input.original_access_token);
  const binding: Binding = { session_id: input.session_id.toLowerCase(),
    account_id: input.account_id.toLowerCase(), user_id: input.user_id.toLowerCase() };
  return inTransaction(pool, async client => {
    // Revoke starts from the exact pending identity, not a pre-transaction
    // capability lookup. An enrollment may still own this session's row lock
    // while its capability is invisible to other transactions.
    const account = (await client.query<{ id: string; retired_at: Date | null }>(
      "SELECT id,retired_at FROM accounts WHERE id=$1 FOR SHARE", [binding.account_id])).rows[0];
    if (!account) throw revoked();
    const user = (await client.query<{ id: string; kind: string; status: string }>(
      "SELECT id,kind,status FROM users WHERE account_id=$1 AND id=$2 FOR SHARE",
      [binding.account_id, binding.user_id])).rows[0];
    if (!user) throw revoked();
    const session = (await client.query<{ id: string; token_hash: string;
      previous_token_hash: string | null; revoked_at: Date | null }>(
      "SELECT id,token_hash,previous_token_hash,revoked_at FROM sessions WHERE id=$1 AND account_id=$2 AND user_id=$3 FOR UPDATE",
      [binding.session_id, binding.account_id, binding.user_id])).rows[0];
    if (!session) throw revoked();
    const credential = await credentialFor(client, session.id);
    const capabilityMatches = credential?.credential_hash === sha256(input.renewal_secret);
    const originalHash = input.original_access_token === undefined ? null : sha256(input.original_access_token);
    const originalMatches = originalHash !== null
      && (session.token_hash === originalHash || session.previous_token_hash === originalHash);
    if (!capabilityMatches && !originalMatches) {
      // Failed proof is not a receipt that this still-existing family ended.
      // Keep it distinct so a pending logout journal can preserve its intent.
      throw new ApiError(401, "PERSISTENT_SESSION_PROOF_INVALID",
        "The revocation proof does not authorize this login.");
    }
    admitAudience(binding.account_id, audience);
    if (session.revoked_at) return { revoked: true };
    // Retired accounts cannot receive writes and cannot be reactivated by this
    // protocol. Disabled members may still destructively fence their own login;
    // reenabling membership must not resurrect a deliberately signed-out family.
    if (account.retired_at) throw revoked();
    if (!REAL_USER_KINDS.includes(user.kind as typeof REAL_USER_KINDS[number])) throw ineligible();
    await client.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [session.id]);
    return { revoked: true };
  });
}
