import { randomBytes, randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  type AppleLoginChallengeRequest,
  type AppleLoginChallengeResponse,
  type AppleLoginRequest,
  type CurrentSessionResponse,
  type LogoutResponse,
  type PasswordLoginRequest,
  type SessionResponse,
  type SimulatedLoginRequest,
} from "@talent-signal/contracts";
import type { preHandlerHookHandler } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Pool, PoolClient } from "pg";

import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import {
  EmailClaimConflict,
  assertAccountActive,
  createRealIdentity,
  emailClaimConflictError,
  newAccountSlug,
  normalizeEmail,
  reserveVerifiedEmail,
} from "./accountIdentity.js";
import { labWorkspaceSessionActiveSQL, operatorLabDeploymentActiveSQL, operatorTestDeployment } from "./labWorkspaceAccess.js";
import { LabPasswordRejection, admitLabPasswordLogin, lockLabRunForAdmission } from "./capirTestSessions.js";
import {
  consumeDummyPasswordWork,
  verifyPasswordCredential,
} from "./passwordCredential.js";

type UserKind = "simulated_human" | "apple_human" | "password_human" | "lab_human" | "google_human";
type UserRole = "admin" | "member";

export interface AuthContext {
  accountId: string;
  accountSlug: string;
  userId: string;
  userEmail: string;
  userKind: UserKind;
  sessionId: string;
}

export interface AppleIdentityToken {
  audience: string;
  email: string | null;
  emailVerified: boolean;
  expiresAt: Date;
  issuer: "https://appleid.apple.com";
  nonce: string;
  subject: string;
}

export interface AppleTokenVerifying {
  verify(identityToken: string, audiences: string[]): Promise<AppleIdentityToken>;
}

const appleJwks = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);

export const appleTokenVerifier: AppleTokenVerifying = {
  async verify(identityToken, audiences) {
    const result = await jwtVerify(identityToken, appleJwks, {
      algorithms: ["RS256"],
      audience: audiences,
      issuer: "https://appleid.apple.com",
    });
    const { aud, email, email_verified: emailVerified, exp, iss, nonce, sub } =
      result.payload;
    const audience = Array.isArray(aud) ? aud[0] : aud;
    if (
      !audience ||
      !exp ||
      iss !== "https://appleid.apple.com" ||
      typeof nonce !== "string" ||
      typeof sub !== "string"
    ) {
      throw new ApiError(
        401,
        "APPLE_TOKEN_INVALID",
        "The Apple identity token is missing required claims.",
      );
    }
    return {
      audience,
      email: typeof email === "string" && email.length > 0 ? email : null,
      emailVerified: emailVerified === true || emailVerified === "true",
      expiresAt: new Date(exp * 1_000),
      issuer: "https://appleid.apple.com",
      nonce,
      subject: sub,
    };
  },
};

function requireAppleAuth(config: BackendConfig): void {
  if (!config.appleSignInEnabled) {
    throw new ApiError(
      404,
      "APPLE_SIGN_IN_DISABLED",
      "Sign in with Apple is not configured for this service.",
    );
  }
}

function sessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function boundedName(request: AppleLoginRequest): string {
  const name = [request.given_name, request.family_name]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .trim();
  return name || "capri User";
}

export async function insertSession(
  client: Pick<Pool, "query"> | PoolClient,
  config: BackendConfig,
  identity: {
    accountId: string;
    accountName: string;
    accountSlug: string;
    displayName: string;
    role: UserRole;
    userEmail: string;
    userId: string;
    userKind: UserKind;
    username: string | null;
  },
  clientLabel: string,
): Promise<SessionResponse> {
  // New auth sessions are governed writes: fence the account for the whole
  // transaction so a concurrent retirement cannot admit a stale session.
  await assertAccountActive(client, identity.accountId);
  const accessToken = sessionToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlSeconds * 1_000);
  await client.query(
    `INSERT INTO sessions(
       id, account_id, user_id, token_hash, client_label, expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      randomUUID(),
      identity.accountId,
      identity.userId,
      sha256(accessToken),
      clientLabel,
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

export async function createAppleLoginChallenge(
  pool: Pick<Pool, "query">,
  config: BackendConfig,
  request: AppleLoginChallengeRequest,
): Promise<AppleLoginChallengeResponse> {
  requireAppleAuth(config);
  const nonce = randomBytes(32).toString("base64url");
  const expectedNonceHash = sha256(nonce);
  const challengeId = randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1_000);
  await pool.query(
    `INSERT INTO apple_login_challenges(
       id, expected_nonce_hash, client_label, expires_at
     ) VALUES ($1, $2, $3, $4)`,
    [challengeId, expectedNonceHash, request.client_label, expiresAt],
  );
  return {
    contract_version: CONTRACT_VERSION,
    challenge_id: challengeId,
    nonce,
    expires_at: expiresAt.toISOString(),
  };
}

export type AppleProof = {
  token: AppleIdentityToken;
  subjectHash: string;
};

/**
 * Validate an Apple identity request before any transaction: challenge
 * binding, signature/issuer/expiry, nonce, and audience. Provider identity is
 * the verified `(issuer, subject)` pair; email is only a visible hint.
 */
export async function verifyAppleIdentityRequest(
  pool: Pick<Pool, "query">,
  config: BackendConfig,
  request: AppleLoginRequest,
  verifier: AppleTokenVerifying = appleTokenVerifier,
): Promise<AppleProof> {
  requireAppleAuth(config);
  const challengeResult = await pool.query<{
    client_label: string;
    expected_nonce_hash: string;
  }>(
    `SELECT client_label, expected_nonce_hash
     FROM apple_login_challenges
     WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()`,
    [request.challenge_id],
  );
  const challenge = challengeResult.rows[0];
  if (!challenge || challenge.client_label !== request.client_label) {
    throw new ApiError(
      409,
      "APPLE_CHALLENGE_INVALID",
      "The Apple sign-in challenge is expired, consumed, or belongs to another client.",
    );
  }

  let token: AppleIdentityToken;
  try {
    token = await verifier.verify(
      request.identity_token,
      config.appleSignInAudiences,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      401,
      "APPLE_TOKEN_INVALID",
      "The Apple identity token could not be verified.",
    );
  }
  if (token.nonce !== challenge.expected_nonce_hash) {
    throw new ApiError(
      401,
      "APPLE_NONCE_MISMATCH",
      "The Apple identity token does not belong to this sign-in attempt.",
    );
  }
  if (!config.appleSignInAudiences.includes(token.audience)) {
    throw new ApiError(
      401,
      "APPLE_AUDIENCE_MISMATCH",
      "The Apple identity token was issued for another application.",
    );
  }
  return { token, subjectHash: sha256(`${token.issuer}:${token.subject}`) };
}

/** Consume the challenge and the exact assertion once (anti-replay). */
export async function consumeAppleProof(
  client: PoolClient,
  request: AppleLoginRequest,
  proof: AppleProof,
): Promise<void> {
  const consumed = await client.query(
    `UPDATE apple_login_challenges
     SET consumed_at = now()
     WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
     RETURNING id`,
    [request.challenge_id],
  );
  if (!consumed.rows[0]) {
    throw new ApiError(
      409,
      "APPLE_CHALLENGE_REPLAYED",
      "This Apple sign-in attempt has already been used. Start again.",
    );
  }
  const assertion = await client.query(
    `INSERT INTO consumed_auth_assertions(
       id, provider, assertion_hash, challenge_id, expires_at
     ) VALUES ($1, 'apple', $2, $3, $4)
     ON CONFLICT (assertion_hash) DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      sha256(request.identity_token),
      request.challenge_id,
      proof.token.expiresAt,
    ],
  );
  if (!assertion.rows[0]) {
    throw new ApiError(
      409,
      "APPLE_TOKEN_REPLAYED",
      "This Apple identity token has already been used. Start again.",
    );
  }
}

export async function createAppleSession(
  pool: Pool,
  config: BackendConfig,
  request: AppleLoginRequest,
  verifier: AppleTokenVerifying = appleTokenVerifier,
): Promise<SessionResponse> {
  const proof = await verifyAppleIdentityRequest(pool, config, request, verifier);
  const { token, subjectHash } = proof;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await consumeAppleProof(client, request, proof);

    // Serialize first sign-ins for the same subject before checking/creating
    // identity, mirroring the Google flow so concurrent Apple callbacks cannot
    // race a duplicate auth_identities insert.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `apple:${subjectHash}`,
    ]);
    const existing = await client.query<{
      account_id: string;
      account_name: string;
      account_slug: string;
      account_role: UserRole;
      display_name: string;
      username: string | null;
      user_email: string;
      user_id: string;
    }>(
      `SELECT
         auth_identities.account_id,
         accounts.name AS account_name,
         accounts.slug AS account_slug,
         users.account_role,
         users.display_name,
         users.username,
         users.email AS user_email,
         auth_identities.user_id
       FROM auth_identities
       JOIN accounts ON accounts.id = auth_identities.account_id
       JOIN users
         ON users.account_id = auth_identities.account_id
        AND users.id = auth_identities.user_id
       WHERE auth_identities.provider = 'apple'
         AND auth_identities.subject_hash = $1
         AND users.status = 'active'`,
      [subjectHash],
    );

    let identity = existing.rows[0];
    if (!identity) {
      const accountId = randomUUID();
      const userId = randomUUID();
      const displayName = boundedName(request);
      // A verified Apple email claim is evidence of ownership; an absent or
      // unverified claim gets a synthetic private address. Either way the
      // visible email never grants authority over another account.
      const verifiedEmail = token.emailVerified && token.email;
      const email = verifiedEmail
        ? normalizeEmail(token.email as string)
        : `apple-${subjectHash.slice(0, 24)}@private.talentsignal.invalid`;
      const accountName = `${displayName}'s workspace`;
      const accountSlug = newAccountSlug();
      try {
        await createRealIdentity(client, {
          accountId,
          userId,
          accountName,
          accountSlug,
          email,
          displayName,
          kind: "apple_human",
          emailVerifiedAt: verifiedEmail ? new Date() : null,
        });
      } catch (error) {
        if (error instanceof EmailClaimConflict) {
          throw emailClaimConflictError(error, "apple");
        }
        throw error;
      }
      await client.query(
        `INSERT INTO auth_identities(
           id, account_id, user_id, provider, subject_hash, email_hint
         ) VALUES ($1, $2, $3, 'apple', $4, $5)`,
        [randomUUID(), accountId, userId, subjectHash, token.email],
      );
      identity = {
        account_id: accountId,
        account_name: accountName,
        account_slug: accountSlug,
        account_role: "member",
        display_name: displayName,
        username: null,
        user_email: email,
        user_id: userId,
      };
    } else {
      // Established Apple subjects keep login authority across provider email
      // changes; a verified secondary address is claimed best-effort only.
      if (token.emailVerified && token.email) {
        try {
          await reserveVerifiedEmail(
            client,
            token.email,
            { accountId: identity.account_id, userId: identity.user_id },
            { source: "provider:apple", verifiedAt: new Date() },
            "secondary",
          );
        } catch {
          // Truthful conflict handling: no claim, credential untouched.
        }
      }
      await client.query(
        `UPDATE auth_identities
         SET last_authenticated_at = now(), email_hint = COALESCE($2, email_hint)
         WHERE provider = 'apple' AND subject_hash = $1`,
        [subjectHash, token.email],
      );
    }

    const session = await insertSession(
      client,
      config,
      {
        accountId: identity.account_id,
        accountName: identity.account_name,
        accountSlug: identity.account_slug,
        displayName: identity.display_name,
        role: identity.account_role ?? "member",
        userEmail: identity.user_email,
        userId: identity.user_id,
        userKind: "apple_human",
        username: identity.username ?? null,
      },
      request.client_label,
    );
    await client.query("COMMIT");
    return session;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createSimulatedSession(
  pool: Pool,
  config: BackendConfig,
  request: SimulatedLoginRequest,
): Promise<SessionResponse> {
  if (!config.simulatedAuthEnabled) {
    throw new ApiError(
      404,
      "SIMULATED_AUTH_DISABLED",
      "Simulated authentication is not available.",
    );
  }

  const result = await pool.query<{
    account_id: string;
    account_name: string;
    account_slug: string;
    account_role: UserRole;
    user_id: string;
    user_email: string;
    display_name: string;
    username: string | null;
  }>(
    `SELECT
       accounts.id AS account_id,
       accounts.name AS account_name,
       accounts.slug AS account_slug,
       users.account_role,
       users.id AS user_id,
       users.email AS user_email,
       users.display_name,
       users.username
     FROM accounts
     JOIN users ON users.account_id = accounts.id
     WHERE accounts.slug = $1
       AND users.email = $2
       AND users.status = 'active'
       AND users.kind = 'simulated_human'`,
    [request.account_slug, request.user_email],
  );
  const identity = result.rows[0];
  if (!identity) {
    throw new ApiError(
      401,
      "SIMULATED_IDENTITY_NOT_FOUND",
      "The local fixture account or user was not found.",
    );
  }

  return insertSession(
    pool,
    config,
    {
      accountId: identity.account_id,
      accountName: identity.account_name,
      accountSlug: identity.account_slug,
      displayName: identity.display_name,
      role: identity.account_role,
      userEmail: identity.user_email,
      userId: identity.user_id,
      userKind: "simulated_human",
      username: identity.username,
    },
    request.client_label,
  );
}

type PasswordIdentityRow = {
  account_id: string;
  account_name: string;
  account_role: UserRole;
  account_slug: string;
  display_name: string;
  failed_attempts: number;
  locked_until: Date | null;
  password_scrypt: string;
  user_email: string;
  user_id: string;
  user_kind: UserKind;
  username: string;
};

function requirePasswordAuth(config: BackendConfig): void {
  if (!config.passwordAuthEnabled) {
    throw new ApiError(
      404,
      "PASSWORD_AUTH_DISABLED",
      "Username and password sign-in is not configured for this service.",
    );
  }
}

const PASSWORD_IDENTITY_SELECT = `
       SELECT
         accounts.id AS account_id,
         accounts.name AS account_name,
         accounts.slug AS account_slug,
         users.id AS user_id,
         users.email AS user_email,
         users.kind AS user_kind,
         users.username,
         users.display_name,
         users.account_role,
         password_credentials.password_scrypt,
         password_credentials.failed_attempts,
         password_credentials.locked_until
       FROM users
       JOIN accounts ON accounts.id = users.account_id
       JOIN password_credentials
         ON password_credentials.account_id = users.account_id
        AND password_credentials.user_id = users.id`;

export async function createPasswordSession(
  pool: Pool,
  config: BackendConfig,
  request: PasswordLoginRequest,
): Promise<SessionResponse> {
  requirePasswordAuth(config);
  const identifier = request.identifier.trim().toLowerCase();
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;
    // Isolated test identities establish the canonical operator lock order
    // (Lab-stop advisory key -> workspace row -> credential rows) so password
    // admission and stop/verified cleanup never invert locks. The preview is
    // an unlocked kind read; every authoritative decision still happens under
    // the locked lookups below.
    const kindPreview = await client.query<{ user_kind: UserKind }>(
      `SELECT DISTINCT users.kind AS user_kind FROM users
        WHERE lower(users.username) = $1 OR lower(btrim(users.email)) = $1`,
      [identifier],
    );
    if (kindPreview.rows.some((row) => row.user_kind === "lab_human")) {
      if (kindPreview.rows.length > 1) {
        await consumeDummyPasswordWork(request.password);
        await client.query("COMMIT");
        transactionOpen = false;
        throw new ApiError(
          409,
          "PASSWORD_SIGN_IN_AMBIGUOUS",
          "More than one account matches this email. Sign in with your username, or resolve the duplicate in Settings.",
        );
      }
      const labResult = await client.query<PasswordIdentityRow>(
        `${PASSWORD_IDENTITY_SELECT}
       WHERE users.status = 'active'
         AND (
           lower(users.username) = $1 OR lower(btrim(users.email)) = $1
         )`,
        [identifier],
      );
      const labIdentity = labResult.rows[0];
      if (
        !labIdentity ||
        labResult.rows.length !== 1 ||
        labIdentity.user_kind !== "lab_human"
      ) {
        await consumeDummyPasswordWork(request.password);
        await client.query("COMMIT");
        transactionOpen = false;
        throw new ApiError(
          401,
          "PASSWORD_SIGN_IN_FAILED",
          "The username, email, or password is not recognized.",
        );
      }
      const admissionIdentity = {
        accountId: labIdentity.account_id,
        accountName: labIdentity.account_name,
        accountSlug: labIdentity.account_slug,
        displayName: labIdentity.display_name,
        role: labIdentity.account_role,
        userEmail: labIdentity.user_email,
        userId: labIdentity.user_id,
        userKind: "lab_human" as const,
        username: labIdentity.username,
      };
      let session: SessionResponse;
      try {
        session = await admitLabPasswordLogin(
          client,
          config,
          admissionIdentity,
          request.password,
          request.client_label,
        );
      } catch (error) {
        // A rejected password mints no session or entry: roll back everything,
        // then commit ONLY the intended lockout bookkeeping before surfacing
        // the same generic failure as the ordinary password path.
        await client.query("ROLLBACK");
        transactionOpen = false;
        if (error instanceof LabPasswordRejection) {
          await client.query("BEGIN");
          transactionOpen = true;
          await lockLabRunForAdmission(client, config, admissionIdentity);
          if (!error.credentialLocked) {
            await client.query(
              `UPDATE password_credentials
                  SET failed_attempts = failed_attempts + 1,
                      locked_until = CASE
                        WHEN failed_attempts + 1 >= 6
                          THEN now() + interval '15 minutes'
                        ELSE NULL
                      END
                WHERE account_id = $1 AND user_id = $2`,
              [labIdentity.account_id, labIdentity.user_id],
            );
          }
          await client.query("COMMIT");
          transactionOpen = false;
          throw new ApiError(
            401,
            "PASSWORD_SIGN_IN_FAILED",
            "The username, email, or password is not recognized.",
          );
        }
        throw error;
      }
      await client.query("COMMIT");
      transactionOpen = false;
      return session;
    }
    const result = await client.query<PasswordIdentityRow>(
      `${PASSWORD_IDENTITY_SELECT}
       WHERE users.status = 'active'
         AND (
           lower(users.username) = $1 OR lower(btrim(users.email)) = $1
         )
       FOR UPDATE OF password_credentials`,
      [identifier],
    );
    // Historical same-email duplicates can leave more than one password-bearing
    // user. Ambiguity fails closed with a recoverable error; the first row is
    // never selected arbitrarily and unambiguous credentials keep working.
    if (result.rows.length > 1) {
      await consumeDummyPasswordWork(request.password);
      await client.query("COMMIT");
      transactionOpen = false;
      throw new ApiError(
        409,
        "PASSWORD_SIGN_IN_AMBIGUOUS",
        "More than one account matches this email. Sign in with your username, or resolve the duplicate in Settings.",
      );
    }
    const identity = result.rows[0];
    if (!identity) {
      await consumeDummyPasswordWork(request.password);
      await client.query("COMMIT");
      transactionOpen = false;
      throw new ApiError(
        401,
        "PASSWORD_SIGN_IN_FAILED",
        "The username, email, or password is not recognized.",
      );
    }

    const passwordMatches = await verifyPasswordCredential(
      request.password,
      identity.password_scrypt,
    );
    const isLocked =
      identity.locked_until !== null && identity.locked_until > new Date();
    if (!passwordMatches || isLocked) {
      if (!isLocked) {
        await client.query(
          `UPDATE password_credentials
           SET
             failed_attempts = failed_attempts + 1,
             locked_until = CASE
               WHEN failed_attempts + 1 >= 6
                 THEN now() + interval '15 minutes'
               ELSE NULL
             END
           WHERE account_id = $1 AND user_id = $2`,
          [identity.account_id, identity.user_id],
        );
      }
      await client.query("COMMIT");
      transactionOpen = false;
      throw new ApiError(
        401,
        "PASSWORD_SIGN_IN_FAILED",
        "The username, email, or password is not recognized.",
      );
    }

    await client.query(
      `UPDATE password_credentials
       SET failed_attempts = 0, locked_until = NULL
       WHERE account_id = $1 AND user_id = $2`,
      [identity.account_id, identity.user_id],
    );
    // Isolated test identities were admitted above under the canonical
    // operator lock order. The ordinary path below is unchanged: a password
    // credential resolves the login regardless of the user's historical kind;
    // attaching a password never rewrites provenance.
    const session = await insertSession(
      client,
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
      request.client_label,
    );
    await client.query("COMMIT");
    transactionOpen = false;
    return session;
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function currentSession(
  pool: Pool,
  auth: AuthContext,
): Promise<CurrentSessionResponse> {
  const result = await pool.query<{
    account_role: UserRole;
    account_name: string;
    account_slug: string;
    display_name: string;
    expires_at: Date;
    user_email: string;
    user_kind: UserKind;
    username: string | null;
  }>(
    `SELECT
       accounts.name AS account_name,
       accounts.slug AS account_slug,
       users.account_role,
       users.display_name,
       users.email AS user_email,
       users.kind AS user_kind,
       users.username,
       sessions.expires_at
     FROM sessions
     JOIN accounts ON accounts.id = sessions.account_id
     JOIN users
       ON users.account_id = sessions.account_id
      AND users.id = sessions.user_id
     WHERE sessions.id = $1
       AND sessions.account_id = $2
       AND sessions.user_id = $3
       AND sessions.revoked_at IS NULL
       AND sessions.expires_at > now()
       AND users.status = 'active'
       AND ${labWorkspaceSessionActiveSQL}`,
    [auth.sessionId, auth.accountId, auth.userId],
  );
  const session = result.rows[0];
  if (!session) {
    throw new ApiError(401, "SESSION_INVALID", "The session is no longer active.");
  }
  return {
    contract_version: CONTRACT_VERSION,
    expires_at: session.expires_at.toISOString(),
    account: {
      id: auth.accountId,
      slug: session.account_slug,
      name: session.account_name,
    },
    user: {
      id: auth.userId,
      email: session.user_email,
      display_name: session.display_name,
      kind: session.user_kind,
      role: session.account_role,
      username: session.username,
    },
  };
}

export async function revokeCurrentSession(
  pool: Pool,
  auth: AuthContext,
): Promise<LogoutResponse> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Consistent lock order with every governed write and reconciliation:
    // the existing account row is locked first, then session rows, so session
    // revocation and transfer commit in one linear order without deadlocks.
    await client.query(`SELECT retired_at FROM accounts WHERE id = $1 FOR SHARE`, [
      auth.accountId,
    ]);
    const result = await client.query<{ revoked_at: Date }>(
      `WITH revoked AS (
       UPDATE sessions SET revoked_at = now()
       WHERE id = $1 AND account_id = $2 AND user_id = $3 AND revoked_at IS NULL
       RETURNING revoked_at
     ), recorded AS (
       UPDATE lab_test_workspace_entries SET revoked_at = revoked.revoked_at
       FROM revoked WHERE session_id = $1 AND lab_test_workspace_entries.revoked_at IS NULL
       RETURNING lab_test_workspace_entries.id
     )
     SELECT revoked_at FROM revoked`,
      [auth.sessionId, auth.accountId, auth.userId],
    );
    const revokedAt = result.rows[0]?.revoked_at;
    if (!revokedAt) {
      await client.query("ROLLBACK");
      throw new ApiError(401, "SESSION_INVALID", "The session is no longer active.");
    }
    await client.query("COMMIT");
    return {
      contract_version: CONTRACT_VERSION,
      revoked_session_id: auth.sessionId,
      revoked_at: revokedAt.toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function createAuthGuard(pool: Pool, deploymentWorkspaceIds?: readonly string[], config?: BackendConfig): preHandlerHookHandler {
  const audience = deploymentWorkspaceIds ? new Set(deploymentWorkspaceIds) : null;
  const deployment = operatorTestDeployment(config);
  return async function authGuard(request): Promise<void> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new ApiError(
        401,
        "AUTHENTICATION_REQUIRED",
        "A bearer session is required.",
      );
    }
    const accessToken = authorization.slice("Bearer ".length);
    const result = await pool.query<{
      account_id: string;
      account_slug: string;
      user_id: string;
      user_email: string;
      user_kind: UserKind;
      session_id: string;
    }>(
      `SELECT
         sessions.id AS session_id,
         sessions.account_id,
         accounts.slug AS account_slug,
         users.id AS user_id,
         users.email AS user_email,
         users.kind AS user_kind
       FROM sessions
       JOIN accounts ON accounts.id = sessions.account_id
       JOIN users
         ON users.account_id = sessions.account_id
        AND users.id = sessions.user_id
       WHERE sessions.token_hash = $1
         AND sessions.revoked_at IS NULL
         AND sessions.expires_at > now()
         AND users.status = 'active'
         AND ${labWorkspaceSessionActiveSQL}
         AND ${operatorLabDeploymentActiveSQL}`,
      [sha256(accessToken), deployment.enabled, deployment.webOrigin, deployment.backendOrigin, deployment.userAuthEnabled === true],
    );
    const auth = result.rows[0];
    if (!auth) {
      throw new ApiError(
        401,
        "SESSION_INVALID",
        "The session is invalid, expired, or revoked.",
      );
    }
    if (audience && !audience.has(auth.account_id)) {
      throw new ApiError(403, "DEPLOYMENT_WORKSPACE_NOT_ADMITTED", "This workspace is outside this deployment's configured audience.");
    }
    request.auth = {
      accountId: auth.account_id,
      accountSlug: auth.account_slug,
      userId: auth.user_id,
      userEmail: auth.user_email,
      userKind: auth.user_kind,
      sessionId: auth.session_id,
    };
  };
}
