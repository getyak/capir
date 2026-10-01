import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  CONTRACT_VERSION,
  DESKTOP_BROWSER_LOGIN_PROTOCOL_VERSION,
  DESKTOP_BROWSER_LOGIN_PURPOSE,
  type DesktopBrowserLoginApproveRequest,
  type DesktopBrowserLoginApproveResponse,
  type DesktopBrowserLoginCancelRequest,
  type DesktopBrowserLoginCancelResponse,
  type DesktopBrowserLoginConsumeRequest,
  type DesktopBrowserLoginGrantResultRequest,
  type DesktopBrowserLoginGrantResultResponse,
  type DesktopBrowserLoginGrantView,
  type DesktopBrowserLoginPrepareRequest,
  type DesktopBrowserLoginPrepareResponse,
  type DesktopBrowserLoginStatusResponse,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import { insertSession, type AuthContext } from "./auth.js";

/**
 * Browser-owned macOS primary login (ADR 0022).
 *
 * One generic first-party grant carries every existing Web login method.
 * Preparation is anonymous and bounded; approval is an intentional,
 * CSRF-protected act of a live authenticated browser session; the callback
 * holds opaque attempt/code/state only; the exchange runs once inside the
 * selected WKWebView context and creates one ordinary, independently
 * revocable device session. Only hashes of state, cancellation secret and
 * exchange code are stored. No secret is ever logged or echoed.
 */

export const DESKTOP_BROWSER_LOGIN_GRANT_TTL_MS = 5 * 60_000;
export const DESKTOP_BROWSER_LOGIN_CODE_TTL_MS = 60_000;
export const DESKTOP_BROWSER_LOGIN_CALLBACK_URL = "com.talentsignal.macos.auth://complete";
export const DESKTOP_BROWSER_LOGIN_CLIENT_LABEL = "talent-signal-macos";

export type DesktopBrowserLoginState =
  | "prepared"
  | "approved"
  | "consumed"
  | "cancelled";

export type DesktopBrowserLoginAttemptRow = {
  id: string;
  protocol_version: number;
  purpose: string;
  origin: string;
  state_hash: string;
  challenge: string;
  cancel_secret_hash: string;
  code_hash: string | null;
  matching_hint: string;
  state: DesktopBrowserLoginState;
  account_id: string | null;
  user_id: string | null;
  browser_session_id: string | null;
  device_session_id: string | null;
  failed_proof_count: number;
  created_at: Date;
  approved_at: Date | null;
  consumed_at: Date | null;
  cancelled_at: Date | null;
  expires_at: Date;
  code_expires_at: Date | null;
};

/** Minimal query surface shared by the pool and one transaction client. */
export interface DesktopBrowserLoginQueryable {
  query<R = unknown>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface DesktopBrowserLoginDb extends DesktopBrowserLoginQueryable {
  transaction<T>(run: (tx: DesktopBrowserLoginQueryable) => Promise<T>): Promise<T>;
}

function asPoolQuery(
  query: DesktopBrowserLoginQueryable["query"],
): Pick<Pool, "query"> {
  return { query: query as unknown as Pick<Pool, "query">["query"] };
}

export function postgresDesktopBrowserLoginDb(pool: Pool): DesktopBrowserLoginDb {
  return {
    query: (text, params) =>
      pool.query(text, params as unknown[]).then((result) => ({ rows: result.rows })),
    async transaction(run) {
      const client: PoolClient = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await run({
          query: (text, params) =>
            client.query(text, params as unknown[]).then((result) => ({ rows: result.rows })),
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export type DesktopBrowserLoginClock = () => Date;

type PreparedSecrets = {
  challenge: string;
  state: string;
  cancelSecret: string;
};

const SECRET_PATTERN = /^[A-Za-z0-9_-]+$/;

function requireBoundedSecret(value: string | undefined, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 256 ||
    !SECRET_PATTERN.test(value)
  ) {
    throw new ApiError(
      400,
      "DESKTOP_BROWSER_LOGIN_SECRET_INVALID",
      `The ${field} is not a well-formed operation secret.`,
    );
  }
  return value;
}

/** The exact allowlisted Web origin; no path, query, fragment or credentials. */
export function requireAllowedWebOrigin(
  config: BackendConfig,
  candidate: string,
): string {
  if (typeof candidate !== "string" || candidate.length > 200) {
    throw new ApiError(
      400,
      "DESKTOP_BROWSER_LOGIN_ORIGIN_INVALID",
      "The Web origin is not well formed.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ApiError(
      400,
      "DESKTOP_BROWSER_LOGIN_ORIGIN_INVALID",
      "The Web origin is not well formed.",
    );
  }
  const exact =
    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
    parsed.username === "" &&
    parsed.password === "" &&
    (parsed.pathname === "" || parsed.pathname === "/") &&
    parsed.search === "" &&
    parsed.hash === "" &&
    config.allowedOrigins.includes(candidate);
  if (!exact) {
    throw new ApiError(
      403,
      "DESKTOP_BROWSER_LOGIN_ORIGIN_NOT_ALLOWED",
      "This Web origin may not own a Mac primary login.",
    );
  }
  return candidate;
}

/** Human-readable pairing hint shown on Mac and in the browser; never a proof. */
export function newMatchingHint(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let hint = "";
  for (let index = 0; index < 4; index += 1) {
    hint += alphabet[(bytes[index] ?? 0) % alphabet.length];
  }
  return `${hint}-${String((bytes[4] ?? 0) % 10)}${String((bytes[5] ?? 0) % 10)}`;
}

function hashHex(secret: string): string {
  return sha256(secret);
}

/** PKCE S256: challenge = BASE64URL(SHA256(ASCII(verifier))). */
export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function hashMatchesHex(secret: string, expectedHex: string | null | undefined): boolean {
  if (!expectedHex) return false;
  const actual = Buffer.from(hashHex(secret), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashMatchesDigest(secret: string, expectedDigest: string | null | undefined): boolean {
  if (!expectedDigest) return false;
  const actual = Buffer.from(pkceS256(secret));
  const expected = Buffer.from(expectedDigest);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Fixed-scheme native callback carrying opaque attempt, code and state only.
 * Scheme, host and path are immutable; nothing else may ride along.
 */
export function desktopBrowserLoginCallbackUrl(
  attemptId: string,
  code: string,
  state: string,
): string {
  const query = new URLSearchParams({ attempt: attemptId, code, state });
  return `${DESKTOP_BROWSER_LOGIN_CALLBACK_URL}?${query.toString()}`;
}

export function desktopBrowserLoginAuthorizationUrl(
  origin: string,
  attemptId: string,
  state: string,
): string {
  const query = new URLSearchParams({ attempt: attemptId, state });
  return `${origin}/desktop-auth/authorize?${query.toString()}`;
}

async function lockActiveAccount(
  tx: DesktopBrowserLoginQueryable,
  accountId: string,
): Promise<void> {
  // Account-before-session lock ordering, identical to session revocation and
  // account retirement, so a revocation that already acquired its write lock
  // serializes before this transaction can observe the session as live. The
  // retirement state is read AFTER the awaited lock, never before it.
  const rows = await tx.query<{ id: string; retired_at: Date | null }>(
    `SELECT id, retired_at FROM accounts WHERE id = $1 FOR SHARE`,
    [accountId],
  );
  const account = rows.rows[0];
  if (!account) {
    throw new ApiError(
      404,
      "DESKTOP_BROWSER_LOGIN_IDENTITY_GONE",
      "The approved account identity is no longer active.",
    );
  }
  if (account.retired_at !== null) {
    throw new ApiError(
      409,
      "ACCOUNT_RETIRED",
      "This account's sign-in methods were transferred to your canonical account. Nothing was written here.",
    );
  }
}

async function lockLiveBrowserSession(
  tx: DesktopBrowserLoginQueryable,
  binding: { sessionId: string; accountId: string; userId: string },
  now: Date,
): Promise<{ id: string; expires_at: Date } | undefined> {
  const rows = await tx.query<{ id: string; expires_at: Date }>(
    `SELECT id, expires_at FROM sessions
     WHERE id = $1 AND account_id = $2 AND user_id = $3
       AND revoked_at IS NULL AND expires_at > $4
     FOR SHARE`,
    [binding.sessionId, binding.accountId, binding.userId, now],
  );
  return rows.rows[0];
}

/** Grant expiry is decided only against the caller's CURRENT time. */
function requireLiveGrant(row: DesktopBrowserLoginAttemptRow, now: Date): void {
  if (now.getTime() >= row.expires_at.getTime()) {
    throw new ApiError(
      410,
      "DESKTOP_BROWSER_LOGIN_GRANT_EXPIRED",
      "This Mac login request expired. Start a new login on the Mac.",
    );
  }
}

/** One-use code expiry is decided only against the caller's CURRENT time. */
function requireLiveCode(row: DesktopBrowserLoginAttemptRow, now: Date): void {
  if (row.code_expires_at && now.getTime() >= row.code_expires_at.getTime()) {
    throw new ApiError(
      410,
      "DESKTOP_BROWSER_LOGIN_CODE_EXPIRED",
      "This one-use code expired before it was exchanged. Start again on the Mac.",
    );
  }
}

/**
 * Post-lock truth for the browser session: the row returned by the awaited
 * lock is compared against a FRESH time, so waiting out the session expiry
 * inside the lock queue can never be observed as live.
 */
function requireLiveSessionAfterWait(
  browserSession: { id: string; expires_at: Date } | undefined,
  now: Date,
  message: string,
): asserts browserSession is { id: string; expires_at: Date } {
  if (!browserSession || browserSession.expires_at.getTime() <= now.getTime()) {
    throw new ApiError(409, "DESKTOP_BROWSER_LOGIN_BROWSER_SESSION_GONE", message);
  }
}

async function requireActiveRealUser(
  tx: DesktopBrowserLoginQueryable,
  accountId: string,
  userId: string,
): Promise<void> {
  // The database decides: a disabled or retired user, or a Lab/simulated
  // identity, never enters this flow even if stale caller context says so.
  const rows = await tx.query<{ status: string; kind: string }>(
    `SELECT status, kind FROM users WHERE account_id = $1 AND id = $2`,
    [accountId, userId],
  );
  const user = rows.rows[0];
  if (!user || user.status !== "active") {
    throw new ApiError(
      409,
      "DESKTOP_BROWSER_LOGIN_IDENTITY_GONE",
      "The approved account identity is no longer active.",
    );
  }
  if (user.kind === "lab_human" || user.kind === "simulated_human") {
    throw new ApiError(
      403,
      "DESKTOP_BROWSER_LOGIN_IDENTITY_REFUSED",
      "Test identities cannot approve a Mac login.",
    );
  }
}

function requireExactGrantOrigin(
  config: BackendConfig,
  row: DesktopBrowserLoginAttemptRow,
  webOrigin: unknown,
): void {
  // The BFF derives the deployment origin server-side; the grant stands only
  // for the exact origin it was prepared against, never mere allowlist
  // inclusion and never a body-chosen authority.
  if (
    typeof webOrigin !== "string" ||
    webOrigin !== row.origin ||
    !config.allowedOrigins.includes(row.origin)
  ) {
    throw new ApiError(
      409,
      "DESKTOP_BROWSER_LOGIN_ORIGIN_NOT_ALLOWED",
      "This Mac login request does not belong to this Web origin.",
    );
  }
}

const ATTEMPT_COLUMNS = `id, protocol_version, purpose, origin, state_hash, challenge,
  cancel_secret_hash, code_hash, matching_hint, state, account_id, user_id,
  browser_session_id, device_session_id, failed_proof_count, created_at,
  approved_at, consumed_at, cancelled_at, expires_at, code_expires_at`;

async function lockAttempt(
  tx: DesktopBrowserLoginQueryable,
  attemptId: string,
): Promise<DesktopBrowserLoginAttemptRow> {
  const result = await tx.query<DesktopBrowserLoginAttemptRow>(
    `SELECT ${ATTEMPT_COLUMNS} FROM desktop_browser_login_attempts
     WHERE id = $1 FOR UPDATE`,
    [attemptId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      404,
      "DESKTOP_BROWSER_LOGIN_ATTEMPT_NOT_FOUND",
      "This Mac login request no longer exists.",
    );
  }
  return row;
}

export async function prepareDesktopBrowserLogin(
  db: DesktopBrowserLoginDb,
  config: BackendConfig,
  request: DesktopBrowserLoginPrepareRequest,
  now: DesktopBrowserLoginClock = () => new Date(),
): Promise<DesktopBrowserLoginPrepareResponse> {
  if (request.protocol_version !== DESKTOP_BROWSER_LOGIN_PROTOCOL_VERSION) {
    throw new ApiError(
      400,
      "DESKTOP_BROWSER_LOGIN_PROTOCOL_UNSUPPORTED",
      "This Mac login protocol version is not supported.",
    );
  }
  if (request.purpose !== DESKTOP_BROWSER_LOGIN_PURPOSE) {
    throw new ApiError(
      400,
      "DESKTOP_BROWSER_LOGIN_PURPOSE_INVALID",
      "This grant is not a macOS primary login.",
    );
  }
  const origin = requireAllowedWebOrigin(config, request.web_origin);
  const challenge = requireBoundedSecret(request.challenge, "challenge");
  const state = requireBoundedSecret(request.state, "state");
  const cancelSecret = requireBoundedSecret(request.cancel_secret, "cancel secret");
  const createdAt = now();
  const attemptId = randomUUID();
  const matchingHint = newMatchingHint();
  await db.query(
    `INSERT INTO desktop_browser_login_attempts(
       id, protocol_version, purpose, origin, state_hash, challenge,
       cancel_secret_hash, matching_hint, state, created_at, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'prepared', $9, $10)`,
    [
      attemptId,
      DESKTOP_BROWSER_LOGIN_PROTOCOL_VERSION,
      DESKTOP_BROWSER_LOGIN_PURPOSE,
      origin,
      hashHex(state),
      challenge,
      hashHex(cancelSecret),
      matchingHint,
      createdAt,
      new Date(createdAt.getTime() + DESKTOP_BROWSER_LOGIN_GRANT_TTL_MS),
    ],
  );
  return {
    contract_version: CONTRACT_VERSION,
    attempt_id: attemptId,
    authorization_url: desktopBrowserLoginAuthorizationUrl(origin, attemptId, state),
    expires_at: new Date(createdAt.getTime() + DESKTOP_BROWSER_LOGIN_GRANT_TTL_MS).toISOString(),
    matching_hint: matchingHint,
  };
}

export type DesktopBrowserLoginApproveDeps = {
  now?: DesktopBrowserLoginClock;
};

export async function approveDesktopBrowserLogin(
  db: DesktopBrowserLoginDb,
  config: BackendConfig,
  attemptId: string,
  auth: AuthContext,
  request: DesktopBrowserLoginApproveRequest,
  deps: DesktopBrowserLoginApproveDeps = {},
): Promise<DesktopBrowserLoginApproveResponse> {
  const now = deps.now ?? (() => new Date());
  const state = requireBoundedSecret(request.state, "state");
  // Lab and simulated identities never issue real Mac sessions. Synthetic
  // evidence must use a disposable real account inside an isolated test.
  if (auth.userKind === "lab_human" || auth.userKind === "simulated_human") {
    throw new ApiError(
      403,
      "DESKTOP_BROWSER_LOGIN_IDENTITY_REFUSED",
      "Test identities cannot approve a Mac login.",
    );
  }
  return db.transaction(async (tx) => {
    const row = await lockAttempt(tx, attemptId);
    if (!hashMatchesHex(state, row.state_hash)) {
      throw new ApiError(
        403,
        "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH",
        "This confirmation does not belong to the Mac login request.",
      );
    }
    requireExactGrantOrigin(config, row, request.web_origin);
    requireLiveGrant(row, now());
    if (row.state === "consumed") {
      throw new ApiError(
        409,
        "DESKTOP_BROWSER_LOGIN_GRANT_CONSUMED",
        "This Mac login request was already completed.",
      );
    }
    if (row.state === "cancelled") {
      throw new ApiError(
        409,
        "DESKTOP_BROWSER_LOGIN_GRANT_CANCELLED",
        "This Mac login request was cancelled.",
      );
    }
    const requestedAt = now();
    // The approving browser session is locked and re-verified inside this
    // transaction with the account-before-session ordering, so a revocation
    // that already acquired its write lock wins and this approval fails.
    await lockActiveAccount(tx, auth.accountId);
    const browserSession = await lockLiveBrowserSession(
      tx,
      { sessionId: auth.sessionId, accountId: auth.accountId, userId: auth.userId },
      requestedAt,
    );
    // Expiry is re-decided with a FRESH reading taken after the awaited locks:
    // waiting out the grant or code window inside the lock queue must never
    // approve stale work, and this fresh time stamps the approval and code.
    const approvedAt = now();
    requireLiveGrant(row, approvedAt);
    requireLiveSessionAfterWait(
      browserSession,
      approvedAt,
      "The browser session is no longer signed in. Sign in again, then continue.",
    );
    await requireActiveRealUser(tx, auth.accountId, auth.userId);
    if (row.state === "approved") {
      // Idempotent confirmation: a second intentional Continue never mints
      // another one-use code, and only the exact account, user and approving
      // session that bound this grant may read its confirmation back.
      if (
        row.account_id !== auth.accountId ||
        row.user_id !== auth.userId ||
        row.browser_session_id !== auth.sessionId
      ) {
        throw new ApiError(
          409,
          "DESKTOP_BROWSER_LOGIN_BINDING_MISMATCH",
          "This Mac login request was already confirmed for another account or session.",
        );
      }
      return {
        contract_version: CONTRACT_VERSION,
        attempt_id: row.id,
        state: "approved" as const,
        code: null,
        code_expires_at: (row.code_expires_at ?? row.expires_at).toISOString(),
        callback_url: DESKTOP_BROWSER_LOGIN_CALLBACK_URL,
        matching_hint: row.matching_hint,
        account_id: row.account_id,
        user_id: row.user_id,
        already_approved: true,
      };
    }
    const code = randomBytes(32).toString("base64url");
    const codeExpiresAt = new Date(
      Math.min(
        approvedAt.getTime() + DESKTOP_BROWSER_LOGIN_CODE_TTL_MS,
        row.expires_at.getTime(),
      ),
    );
    const updated = await tx.query<{ id: string }>(
      `UPDATE desktop_browser_login_attempts
       SET state = 'approved', account_id = $2, user_id = $3,
           browser_session_id = $4, approved_at = $5, code_hash = $6,
           code_expires_at = $7, matching_hint = matching_hint
       WHERE id = $1 AND state = 'prepared'
       RETURNING id`,
      [
        row.id,
        auth.accountId,
        auth.userId,
        auth.sessionId,
        approvedAt,
        hashHex(code),
        codeExpiresAt,
      ],
    );
    if (!updated.rows[0]) {
      throw new ApiError(
        409,
        "DESKTOP_BROWSER_LOGIN_GRANT_CONSUMED",
        "This Mac login request was already completed.",
      );
    }
    return {
      contract_version: CONTRACT_VERSION,
      attempt_id: row.id,
      state: "approved" as const,
      code,
      code_expires_at: codeExpiresAt.toISOString(),
      callback_url: desktopBrowserLoginCallbackUrl(row.id, code, state),
      matching_hint: row.matching_hint,
      account_id: auth.accountId,
      user_id: auth.userId,
      already_approved: false,
    };
  });
}

async function recordFailedProof(
  db: DesktopBrowserLoginQueryable,
  attemptId: string,
): Promise<void> {
  // Recorded outside the failing transaction so a refused proof is honestly
  // observable without letting it consume, lock or mutate the grant itself.
  await db.query(
    `UPDATE desktop_browser_login_attempts
     SET failed_proof_count = failed_proof_count + 1
     WHERE id = $1`,
    [attemptId],
  );
}

async function withFailedProofTracking<T>(
  db: DesktopBrowserLoginDb,
  attemptId: string,
  run: (tx: DesktopBrowserLoginQueryable) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(run);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH"
    ) {
      await recordFailedProof(db, attemptId);
    }
    throw error;
  }
}

export async function consumeDesktopBrowserLogin(
  db: DesktopBrowserLoginDb,
  config: BackendConfig,
  request: DesktopBrowserLoginConsumeRequest,
  deps: DesktopBrowserLoginApproveDeps = {},
) {
  const now = deps.now ?? (() => new Date());
  const code = requireBoundedSecret(request.code, "code");
  const verifier = requireBoundedSecret(request.verifier, "verifier");
  const state = requireBoundedSecret(request.state, "state");
  return withFailedProofTracking(db, request.attempt_id, async (tx) => {
    const row = await lockAttempt(tx, request.attempt_id);
    if (row.state === "consumed") {
      // A consumed grant can never mint a second session; the caller must use
      // the secret-bound read-only result instead of replaying it.
      throw new ApiError(
        409,
        "DESKTOP_BROWSER_LOGIN_GRANT_CONSUMED",
        "This Mac login request was already completed.",
      );
    }
    if (row.state === "cancelled") {
      throw new ApiError(
        409,
        "DESKTOP_BROWSER_LOGIN_GRANT_CANCELLED",
        "This Mac login request was cancelled.",
      );
    }
    if (row.state !== "approved") {
      throw new ApiError(
        409,
        "DESKTOP_BROWSER_LOGIN_GRANT_NOT_APPROVED",
        "This Mac login request has not been confirmed in the browser.",
      );
    }
    // Cheap early fail before the lock queue; the authoritative expiry
    // decision is re-taken with a fresh reading AFTER the awaited locks below,
    // because SQL predicates can be evaluated before a lock wait completes.
    const requestedAt = now();
    requireLiveGrant(row, requestedAt);
    requireLiveCode(row, requestedAt);
    // Wrong proofs never consume the grant or lock out the correct proof; they
    // only record bounded observability and refuse the exchange.
    const proofsMatch =
      hashMatchesHex(state, row.state_hash) &&
      hashMatchesHex(code, row.code_hash) &&
      hashMatchesDigest(verifier, row.challenge);
    if (!proofsMatch) {
      throw new ApiError(
        403,
        "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH",
        "This exchange does not belong to the Mac login request.",
      );
    }
    // The approving browser session must still be live inside this
    // transaction; a signed-out or revoked browser cannot finish a grant. The
    // account-before-session ordering serializes against a revocation that
    // already acquired its write lock, so a revoked session is never observed
    // as live and no session can be minted after revocation.
    await lockActiveAccount(tx, row.account_id!);
    const browserSession = await lockLiveBrowserSession(
      tx,
      {
        sessionId: row.browser_session_id!,
        accountId: row.account_id!,
        userId: row.user_id!,
      },
      requestedAt,
    );
    // FRESH expiry truth after the awaited locks, compared against the
    // actually returned expires_at values: an exchange that waited out the
    // code, grant or session window mints no device session and leaves the
    // grant exactly as it was.
    const consumedAt = now();
    requireLiveGrant(row, consumedAt);
    requireLiveCode(row, consumedAt);
    requireLiveSessionAfterWait(
      browserSession,
      consumedAt,
      "The approving browser session is no longer active. Start again on the Mac.",
    );
    // The exact prepared origin, checked against the BFF-derived origin, not
    // body authority or mere allowlist inclusion.
    requireExactGrantOrigin(config, row, request.web_origin);
    // Recheck the approved identity from the database: active and a real
    // human kind, never a Lab or simulated identity.
    await requireActiveRealUser(tx, row.account_id!, row.user_id!);
    const identityRow = await tx.query<{
      user_id: string;
      account_id: string;
      account_name: string;
      account_slug: string;
      account_role: "admin" | "member";
      display_name: string;
      user_email: string;
      user_kind: "apple_human" | "google_human" | "password_human";
      username: string | null;
    }>(
      `SELECT users.id AS user_id, users.account_id, accounts.name AS account_name,
              accounts.slug AS account_slug, users.account_role,
              users.display_name, users.email AS user_email,
              users.kind AS user_kind, users.username
       FROM users
       JOIN accounts ON accounts.id = users.account_id
       WHERE users.account_id = $1 AND users.id = $2 AND users.status = 'active'`,
      [row.account_id, row.user_id],
    );
    const identity = identityRow.rows[0];
    if (!identity) {
      throw new ApiError(
        409,
        "DESKTOP_BROWSER_LOGIN_IDENTITY_GONE",
        "The approved account is no longer active.",
      );
    }
    // One ordinary device session with the existing TTL and session policy;
    // it is independently revocable like every other session.
    const session = await insertSession(
      asPoolQuery((text, params) => tx.query(text, params)),
      config,
      {
        accountId: identity.account_id,
        accountName: identity.account_name,
        accountSlug: identity.account_slug,
        displayName: identity.display_name,
        role: identity.account_role,
        userEmail: identity.user_email,
        userId: identity.user_id,
        userKind: identity.user_kind,
        username: identity.username,
      },
      DESKTOP_BROWSER_LOGIN_CLIENT_LABEL,
    );
    const sessionIdRow = await tx.query<{ id: string }>(
      `SELECT id FROM sessions WHERE token_hash = $1`,
      [sha256(session.access_token)],
    );
    const deviceSessionId = sessionIdRow.rows[0]?.id;
    if (!deviceSessionId) {
      throw new ApiError(
        500,
        "DESKTOP_BROWSER_LOGIN_SESSION_UNTRACEABLE",
        "The Mac session could not be correlated to this login request.",
      );
    }
    const updated = await tx.query<{ id: string }>(
      `UPDATE desktop_browser_login_attempts
       SET state = 'consumed', consumed_at = $2, device_session_id = $3
       WHERE id = $1 AND state = 'approved'
       RETURNING id`,
      [row.id, consumedAt, deviceSessionId],
    );
    if (!updated.rows[0]) {
      throw new ApiError(
        409,
        "DESKTOP_BROWSER_LOGIN_GRANT_CONSUMED",
        "This Mac login request was already completed.",
      );
    }
    return session;
  });
}

export async function cancelDesktopBrowserLogin(
  db: DesktopBrowserLoginDb,
  attemptId: string,
  request: Omit<DesktopBrowserLoginCancelRequest, "attempt_id">,
  deps: DesktopBrowserLoginApproveDeps = {},
): Promise<DesktopBrowserLoginCancelResponse> {
  const now = deps.now ?? (() => new Date());
  const cancelSecret = requireBoundedSecret(request.cancel_secret, "cancel secret");
  return withFailedProofTracking(db, attemptId, async (tx) => {
    const row = await lockAttempt(tx, attemptId);
    if (!hashMatchesHex(cancelSecret, row.cancel_secret_hash)) {
      // A wrong cancellation secret never consumes or locks out the correct
      // proof; it only fails closed.
      throw new ApiError(
        403,
        "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH",
        "This cancellation does not belong to the Mac login request.",
      );
    }
    if (row.state === "consumed") {
      // A consume may already have installed a session. Cancellation is
      // unresolved afterwards and never claims a rollback.
      return {
        contract_version: CONTRACT_VERSION,
        attempt_id: row.id,
        state: "consumed" as const,
        cancellation_recorded: false,
      };
    }
    if (row.state === "cancelled") {
      return {
        contract_version: CONTRACT_VERSION,
        attempt_id: row.id,
        state: "cancelled" as const,
        cancellation_recorded: false,
      };
    }
    if (now().getTime() >= row.expires_at.getTime()) {
      return {
        contract_version: CONTRACT_VERSION,
        attempt_id: row.id,
        state: "expired" as const,
        cancellation_recorded: false,
      };
    }
    await tx.query(
      `UPDATE desktop_browser_login_attempts
       SET state = 'cancelled', cancelled_at = $2
       WHERE id = $1 AND state IN ('prepared', 'approved')`,
      [row.id, now()],
    );
    return {
      contract_version: CONTRACT_VERSION,
      attempt_id: row.id,
      state: "cancelled" as const,
      cancellation_recorded: true,
    };
  });
}

/**
 * Intentional browser decline: authenticated and state-bound like approval,
 * it cancels a prepared or approved grant without attaching identity or
 * minting a code. A consumed grant reports its truth instead of a rollback.
 */
export async function declineDesktopBrowserLogin(
  db: DesktopBrowserLoginDb,
  config: BackendConfig,
  attemptId: string,
  auth: AuthContext,
  request: { state: string; web_origin: string },
  deps: DesktopBrowserLoginApproveDeps = {},
): Promise<DesktopBrowserLoginCancelResponse> {
  const now = deps.now ?? (() => new Date());
  const state = requireBoundedSecret(request.state, "state");
  if (auth.userKind === "lab_human" || auth.userKind === "simulated_human") {
    throw new ApiError(
      403,
      "DESKTOP_BROWSER_LOGIN_IDENTITY_REFUSED",
      "Test identities cannot resolve a Mac login request.",
    );
  }
  return db.transaction(async (tx) => {
    const row = await lockAttempt(tx, attemptId);
    if (!hashMatchesHex(state, row.state_hash)) {
      throw new ApiError(
        403,
        "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH",
        "This decline does not belong to the Mac login request.",
      );
    }
    requireExactGrantOrigin(config, row, request.web_origin);
    if (row.state === "consumed") {
      return {
        contract_version: CONTRACT_VERSION,
        attempt_id: row.id,
        state: "consumed" as const,
        cancellation_recorded: false,
      };
    }
    if (row.state === "cancelled") {
      return {
        contract_version: CONTRACT_VERSION,
        attempt_id: row.id,
        state: "cancelled" as const,
        cancellation_recorded: false,
      };
    }
    if (now().getTime() >= row.expires_at.getTime()) {
      return {
        contract_version: CONTRACT_VERSION,
        attempt_id: row.id,
        state: "expired" as const,
        cancellation_recorded: false,
      };
    }
    await tx.query(
      `UPDATE desktop_browser_login_attempts
       SET state = 'cancelled', cancelled_at = $2
       WHERE id = $1 AND state IN ('prepared', 'approved')`,
      [row.id, now()],
    );
    return {
      contract_version: CONTRACT_VERSION,
      attempt_id: row.id,
      state: "cancelled" as const,
      cancellation_recorded: true,
    };
  });
}

/**
 * Read-only browser inspection of one grant for the confirmation page:
 * lifecycle state and matching hint against a live signed-in identity. It
 * never reveals proof material and never attaches identity.
 */
/**
 * Bounded cleanup of expired anonymous grants and terminal metadata past the
 * recovery window. A consumed grant is kept while its device-session
 * correlation may still be required by native readback; nothing live is ever
 * pruned.
 */
export async function sweepDesktopBrowserLoginAttempts(
  db: DesktopBrowserLoginQueryable,
  now: DesktopBrowserLoginClock = () => new Date(),
): Promise<number> {
  const observedAt = now();
  const result = await db.query(
    `DELETE FROM desktop_browser_login_attempts
     WHERE (
         state IN ('prepared', 'approved')
         AND expires_at < $1::timestamptz - interval '1 hour'
       )
       OR (
         state IN ('cancelled')
         AND expires_at < $1::timestamptz - interval '24 hours'
       )
       OR (
         state = 'consumed'
         AND expires_at < $1::timestamptz - interval '24 hours'
         AND NOT EXISTS (
           SELECT 1 FROM sessions s
           WHERE s.id = desktop_browser_login_attempts.device_session_id
             AND s.revoked_at IS NULL
             AND s.expires_at > $1::timestamptz
         )
       )
     RETURNING id`,
    [observedAt],
  );
  return result.rows.length;
}

export async function readDesktopBrowserLoginGrant(
  db: DesktopBrowserLoginQueryable,
  config: BackendConfig,
  attemptId: string,
  auth: AuthContext,
  request: { state: string; web_origin: string },
  deps: DesktopBrowserLoginApproveDeps = {},
): Promise<DesktopBrowserLoginGrantView> {
  const now = deps.now ?? (() => new Date());
  if (auth.userKind === "lab_human" || auth.userKind === "simulated_human") {
    throw new ApiError(
      403,
      "DESKTOP_BROWSER_LOGIN_IDENTITY_REFUSED",
      "Test identities cannot inspect a Mac login request.",
    );
  }
  const result = await db.query<DesktopBrowserLoginAttemptRow>(
    `SELECT ${ATTEMPT_COLUMNS} FROM desktop_browser_login_attempts WHERE id = $1`,
    [attemptId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      404,
      "DESKTOP_BROWSER_LOGIN_ATTEMPT_NOT_FOUND",
      "This Mac login request no longer exists.",
    );
  }
  // The preview checks the exact prepared origin and the operation state
  // before it reveals anything: a wrong-state or foreign-origin reader learns
  // no hint, lifecycle or identity authority.
  if (!hashMatchesHex(requireBoundedSecret(request.state, "state"), row.state_hash)) {
    throw new ApiError(
      403,
      "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH",
      "This preview does not belong to the Mac login request.",
    );
  }
  requireExactGrantOrigin(config, row, request.web_origin);
  const observedAt = now();
  let state: DesktopBrowserLoginGrantView["state"];
  if (row.state === "consumed") state = "consumed";
  else if (row.state === "cancelled") state = "cancelled";
  else if (observedAt.getTime() >= row.expires_at.getTime()) state = "expired";
  else state = row.state;
  return {
    contract_version: CONTRACT_VERSION,
    attempt_id: row.id,
    state,
    matching_hint: row.matching_hint,
    expires_at: row.expires_at.toISOString(),
  };
}

export async function readDesktopBrowserLoginGrantResult(
  db: DesktopBrowserLoginDb,
  attemptId: string,
  request: Omit<DesktopBrowserLoginGrantResultRequest, "attempt_id">,
  deps: DesktopBrowserLoginApproveDeps = {},
): Promise<DesktopBrowserLoginGrantResultResponse> {
  const now = deps.now ?? (() => new Date());
  const verifier = request.verifier ? requireBoundedSecret(request.verifier, "verifier") : null;
  const cancelSecret = request.cancel_secret
    ? requireBoundedSecret(request.cancel_secret, "cancel secret")
    : null;
  if (!verifier && !cancelSecret) {
    throw new ApiError(
      400,
      "DESKTOP_BROWSER_LOGIN_SECRET_INVALID",
      "A proof secret is required to read this login result.",
    );
  }
  return withFailedProofTracking(db, attemptId, async (tx) => {
    const row = await lockAttempt(tx, attemptId);
    const proofMatches =
      (verifier !== null && hashMatchesDigest(verifier, row.challenge)) ||
      (cancelSecret !== null && hashMatchesHex(cancelSecret, row.cancel_secret_hash));
    if (!proofMatches) {
      throw new ApiError(
        403,
        "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH",
        "This proof does not belong to the Mac login request.",
      );
    }
    const observedAt = now();
    let state: DesktopBrowserLoginGrantResultResponse["state"];
    if (row.state === "consumed") state = "consumed";
    else if (row.state === "cancelled") state = "cancelled";
    else if (observedAt.getTime() >= row.expires_at.getTime()) state = "expired";
    else state = row.state;
    return {
      contract_version: CONTRACT_VERSION,
      attempt_id: row.id,
      state,
      account_id: row.account_id,
      user_id: row.user_id,
      committed: row.state === "consumed" && row.device_session_id !== null,
      expires_at: row.expires_at.toISOString(),
    };
  });
}

export async function readDesktopBrowserLoginStatus(
  db: DesktopBrowserLoginQueryable,
  attemptId: string,
  auth: AuthContext,
  deps: DesktopBrowserLoginApproveDeps = {},
): Promise<DesktopBrowserLoginStatusResponse> {
  const now = deps.now ?? (() => new Date());
  const result = await db.query<DesktopBrowserLoginAttemptRow>(
    `SELECT ${ATTEMPT_COLUMNS} FROM desktop_browser_login_attempts WHERE id = $1`,
    [attemptId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      404,
      "DESKTOP_BROWSER_LOGIN_ATTEMPT_NOT_FOUND",
      "This Mac login request no longer exists.",
    );
  }
  // Readback is only truthful for the exact session that grant created, bound
  // to the exact approved account and user.
  const correlated =
    row.state === "consumed" &&
    row.device_session_id === auth.sessionId &&
    row.account_id === auth.accountId &&
    row.user_id === auth.userId &&
    row.consumed_at !== null;
  if (!correlated) {
    throw new ApiError(
      409,
      "DESKTOP_BROWSER_LOGIN_SESSION_MISMATCH",
      "The current session does not belong to this Mac login request.",
    );
  }
  return {
    contract_version: CONTRACT_VERSION,
    attempt_id: row.id,
    state: "consumed",
    account_id: row.account_id!,
    user_id: row.user_id!,
    device_session_id: row.device_session_id!,
    consumed_at: row.consumed_at!.toISOString(),
  };
}

/** The proof secrets of one native operation; held in memory only. */
export type DesktopBrowserLoginNativeSecrets = PreparedSecrets;

export function newDesktopBrowserLoginSecrets(): DesktopBrowserLoginNativeSecrets {
  return {
    challenge: randomBytes(32).toString("base64url"),
    state: randomBytes(32).toString("base64url"),
    cancelSecret: randomBytes(32).toString("base64url"),
  };
}
