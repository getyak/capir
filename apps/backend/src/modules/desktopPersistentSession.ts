import { createHmac } from "node:crypto";
import { CONTRACT_VERSION, type DesktopPersistentSessionEnrollRequest,
  type DesktopPersistentSessionProof, type DesktopPersistentSessionResponse,
  type DesktopPersistentSessionStatus, type DesktopPersistentSessionRevokeRequest } from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";
import type { BackendConfig } from "../config.js";
import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import { currentSession, type AuthContext } from "./auth.js";
import { REAL_USER_KINDS } from "./accountIdentity.js";
import { requireAllowedWebOrigin } from "./desktopBrowserLogin.js";

type Generation = { generation: number; expiresAt: Date };
/** Pure policy; database locks select exactly one generation for all retries. */
export function desktopAccessRenewal(secret: string, sessionId: string,
  current: Generation, now: Date, ttlSeconds: number) {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0
    || !Number.isSafeInteger(current.generation) || current.generation < 0
    || current.generation >= 2_147_483_647) throw new Error("Invalid desktop access policy.");
  const rotate = current.generation === 0
    || current.expiresAt.getTime() - now.getTime() <= ttlSeconds * 500;
  const generation = current.generation + (rotate ? 1 : 0);
  const expiresAt = rotate ? new Date(now.getTime() + ttlSeconds * 1_000) : current.expiresAt;
  const accessToken = createHmac("sha256", secret)
    .update(`capri:macos-access:v1:${sessionId}:${generation}`).digest("base64url");
  return { generation, expiresAt, accessToken, rotate };
}

type Binding = { session_id: string; account_id: string; user_id: string };
type Credential = Binding & { credential_hash: string; origin: string; access_generation: number };
type SessionRow = { id: string; token_hash: string; expires_at: Date; revoked_at: Date | null };
type Identity = { account: { id: string; name: string; slug: string };
  user: DesktopPersistentSessionResponse["user"] };
const revoked = () => new ApiError(401, "DESKTOP_SESSION_REVOKED",
  "This Mac session is no longer authorized. Sign in again.");
const ineligible = () => new ApiError(403, "DESKTOP_SESSION_INELIGIBLE",
  "A live browser-authorized Mac session is required.");

function validateSecret(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new ApiError(400, "DESKTOP_SESSION_PROOF_INVALID", "The device proof is invalid.");
  }
}
function admitAudience(accountId: string, audience?: readonly string[]): void {
  if (audience && !audience.includes(accountId)) throw new ApiError(403,
    "DEPLOYMENT_WORKSPACE_NOT_ADMITTED", "This workspace is outside this deployment's configured audience.");
}
async function lockIdentity(client: PoolClient, binding: Binding): Promise<Identity> {
  // Same order as membership, account retirement and sign-out: account first.
  const account = (await client.query<{ id: string; name: string; slug: string; retired_at: Date | null }>(
    "SELECT id,name,slug,retired_at FROM accounts WHERE id=$1 FOR SHARE", [binding.account_id])).rows[0];
  if (!account || account.retired_at) throw revoked();
  const user = (await client.query<DesktopPersistentSessionResponse["user"] & { status: string }>(
    "SELECT id,email,display_name,kind,account_role AS role,username,status FROM users WHERE account_id=$1 AND id=$2 FOR SHARE",
    [binding.account_id, binding.user_id])).rows[0];
  if (!user || user.status !== "active"
    || !REAL_USER_KINDS.includes(user.kind as typeof REAL_USER_KINDS[number])) throw revoked();
  const { status: _status, ...publicUser } = user;
  return { account: { id: account.id, name: account.name, slug: account.slug }, user: publicUser };
}
async function lockSession(client: PoolClient, binding: Binding): Promise<SessionRow> {
  const session = (await client.query<SessionRow>(
    "SELECT id,token_hash,expires_at,revoked_at FROM sessions WHERE id=$1 AND account_id=$2 AND user_id=$3 FOR UPDATE",
    [binding.session_id, binding.account_id, binding.user_id])).rows[0];
  if (!session || session.revoked_at) throw revoked();
  return session;
}
async function databaseNow(client: PoolClient): Promise<Date> {
  return (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
}
async function credentialFor(client: PoolClient, sessionId: string): Promise<Credential | undefined> {
  return (await client.query<Credential>(
    "SELECT * FROM desktop_persistent_session_credentials WHERE session_id=$1 FOR UPDATE", [sessionId])).rows[0];
}
async function issue(client: PoolClient, config: BackendConfig, secret: string,
  credential: Credential, session: SessionRow, identity: Identity): Promise<DesktopPersistentSessionResponse> {
  const next = desktopAccessRenewal(secret, session.id,
    { generation: credential.access_generation, expiresAt: session.expires_at },
    await databaseNow(client), config.sessionTtlSeconds);
  if (next.rotate) {
    // The previous generation's deadline is copied, never extended.
    await client.query(`UPDATE sessions SET previous_token_hash=token_hash,
      previous_token_expires_at=expires_at,token_hash=$2,expires_at=$3 WHERE id=$1`,
    [session.id, sha256(next.accessToken), next.expiresAt]);
    await client.query(`UPDATE desktop_persistent_session_credentials
      SET access_generation=$2,updated_at=clock_timestamp() WHERE session_id=$1`, [session.id, next.generation]);
  } else if (session.token_hash !== sha256(next.accessToken)) {
    throw revoked();
  }
  return { contract_version: CONTRACT_VERSION, access_token: next.accessToken,
    expires_at: next.expiresAt.toISOString(), session_id: session.id,
    account: identity.account, user: identity.user };
}

export async function enrollDesktopPersistentSession(pool: Pool, config: BackendConfig, auth: AuthContext,
  input: DesktopPersistentSessionEnrollRequest, audience?: readonly string[]): Promise<DesktopPersistentSessionResponse> {
  validateSecret(input.device_secret);
  const origin = requireAllowedWebOrigin(config, input.web_origin);
  if (!REAL_USER_KINDS.includes(auth.userKind as typeof REAL_USER_KINDS[number])) throw ineligible();
  admitAudience(auth.accountId, audience);
  const binding = { session_id: auth.sessionId, account_id: auth.accountId, user_id: auth.userId };
  return inTransaction(pool, async client => {
    const identity = await lockIdentity(client, binding);
    const session = await lockSession(client, binding);
    if (session.expires_at <= await databaseNow(client)) throw ineligible();
    let credential = await credentialFor(client, session.id);
    if (credential) {
      if (credential.credential_hash !== sha256(input.device_secret) || credential.origin !== origin) throw ineligible();
    } else {
      // Enrollment is authority promotion; a label or User-Agent is not proof.
      const grant = await client.query(`SELECT id FROM desktop_browser_login_attempts
        WHERE device_session_id=$1 AND account_id=$2 AND user_id=$3 AND origin=$4
          AND state='consumed'`, [session.id, auth.accountId, auth.userId, origin]);
      if (!grant.rowCount) throw ineligible();
      credential = { ...binding, origin, credential_hash: sha256(input.device_secret), access_generation: 0 };
      await client.query(`INSERT INTO desktop_persistent_session_credentials
        (session_id,account_id,user_id,credential_hash,origin) VALUES($1,$2,$3,$4,$5)`,
      [session.id, auth.accountId, auth.userId, credential.credential_hash, origin]);
    }
    return issue(client, config, input.device_secret, credential, session, identity);
  });
}

async function withDevice<T>(pool: Pool, config: BackendConfig, input: DesktopPersistentSessionProof,
  audience: readonly string[] | undefined,
  operation: (client: PoolClient, credential: Credential, session: SessionRow, identity: Identity) => Promise<T>): Promise<T> {
  validateSecret(input.device_secret);
  const origin = requireAllowedWebOrigin(config, input.web_origin);
  const hash = sha256(input.device_secret);
  const binding = (await pool.query<Binding>(`SELECT session_id,account_id,user_id
    FROM desktop_persistent_session_credentials WHERE credential_hash=$1`, [hash])).rows[0];
  if (!binding || binding.account_id !== input.account_id || binding.user_id !== input.user_id) throw revoked();
  admitAudience(binding.account_id, audience);
  return inTransaction(pool, async client => {
    const identity = await lockIdentity(client, binding);
    const session = await lockSession(client, binding);
    const credential = await credentialFor(client, session.id);
    if (!credential || credential.credential_hash !== hash || credential.origin !== origin) throw revoked();
    return operation(client, credential, session, identity);
  });
}
export function renewDesktopPersistentSession(pool: Pool, config: BackendConfig,
  input: DesktopPersistentSessionProof, audience?: readonly string[]): Promise<DesktopPersistentSessionResponse> {
  return withDevice(pool, config, input, audience, (client, credential, session, identity) =>
    issue(client, config, input.device_secret, credential, session, identity));
}
export async function revokeDesktopPersistentSession(pool: Pool, config: BackendConfig,
  input: DesktopPersistentSessionRevokeRequest, audience?: readonly string[]): Promise<{ revoked: true }> {
  validateSecret(input.device_secret);
  if (input.original_access_token !== undefined) validateSecret(input.original_access_token);
  const origin = requireAllowedWebOrigin(config, input.web_origin);
  const invalid = () => new ApiError(401, "DESKTOP_SESSION_PROOF_INVALID", "The revocation proof could not be verified.");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.account_id) || !uuid.test(input.user_id) || (input.session_id !== undefined && !uuid.test(input.session_id))) throw invalid();
  if ((input.session_id === undefined) !== (input.original_access_token === undefined)) throw invalid();
  // Legacy enrolled clients have only the device proof. Its lookup cannot
  // certify that an unknown pending enrollment has ended.
  const binding = input.session_id ? { session_id: input.session_id.toLowerCase(),
    account_id: input.account_id.toLowerCase(), user_id: input.user_id.toLowerCase() }
    : (await pool.query<Binding>(`SELECT session_id,account_id,user_id
      FROM desktop_persistent_session_credentials WHERE credential_hash=$1`, [sha256(input.device_secret)])).rows[0];
  if (!binding || binding.account_id !== input.account_id.toLowerCase() || binding.user_id !== input.user_id.toLowerCase()) throw invalid();
  admitAudience(binding.account_id, audience);
  return inTransaction(pool, async client => {
    // Lock the canonical row BEFORE reading capability state: an enrollment
    // may hold this row while its INSERT remains invisible until COMMIT.
    const account = (await client.query("SELECT id FROM accounts WHERE id=$1 FOR SHARE", [binding.account_id])).rows[0];
    const user = (await client.query<{ kind: string }>("SELECT kind FROM users WHERE account_id=$1 AND id=$2 FOR SHARE",
      [binding.account_id, binding.user_id])).rows[0];
    if (!account || !user || !REAL_USER_KINDS.includes(user.kind as typeof REAL_USER_KINDS[number])) throw invalid();
    const session = (await client.query<SessionRow & { previous_token_hash: string | null }>(
      "SELECT id,token_hash,previous_token_hash,expires_at,revoked_at FROM sessions WHERE id=$1 AND account_id=$2 AND user_id=$3 FOR UPDATE",
      [binding.session_id, binding.account_id, binding.user_id])).rows[0];
    if (!session) throw invalid();
    const credential = await credentialFor(client, session.id);
    const capabilityMatches = credential?.credential_hash === sha256(input.device_secret) && credential.origin === origin;
    const originalHash = input.original_access_token === undefined ? null : sha256(input.original_access_token);
    let originalMatches = originalHash !== null && (session.token_hash === originalHash || session.previous_token_hash === originalHash);
    if (originalMatches) {
      const grant = await client.query(`SELECT id FROM desktop_browser_login_attempts
        WHERE device_session_id=$1 AND account_id=$2 AND user_id=$3 AND origin=$4 AND state='consumed'`,
      [session.id, binding.account_id, binding.user_id, origin]);
      originalMatches = !!grant.rowCount;
    }
    if (!capabilityMatches && !originalMatches) throw invalid();
    if (!session.revoked_at) await client.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [session.id]);
    return { revoked: true };
  });
}
export async function readDesktopPersistentSessionStatus(pool: Pool, auth: AuthContext): Promise<DesktopPersistentSessionStatus> {
  const live = await currentSession(pool, auth);
  return { contract_version: CONTRACT_VERSION, status: "authenticated", account_id: live.account.id,
    user_id: live.user.id, session_id: auth.sessionId, session_expires_at: live.expires_at };
}
