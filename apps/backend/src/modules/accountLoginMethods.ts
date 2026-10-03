import { randomBytes, randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  type CompleteCredentialChangeRequest,
  type CredentialChangeAttempt,
  type CredentialChangeIntent,
  type CredentialChangeResult,
  type ProviderChallenge,
  type SignInMethodProvider,
  type StartCredentialChangeRequest,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import {
  EmailClaimConflict,
  normalizeEmail,
  providerSubjectHash,
  readEmailReservation,
  reserveVerifiedEmail,
} from "./accountIdentity.js";
import { readAccountSettingsWith } from "./accountManagement.js";
import {
  consumeAppleProof,
  createAppleLoginChallenge,
  verifyAppleIdentityRequest,
  type AppleTokenVerifying,
  type AuthContext,
} from "./auth.js";
import {
  consumeGoogleProof,
  createGoogleChallenge,
  verifyGoogleIdentity,
  type GoogleVerifier,
} from "./googleAuth.js";
import {
  consumeDummyPasswordWork,
  encodePasswordCredential,
  verifyPasswordCredential,
} from "./passwordCredential.js";

/**
 * Step-up bound, intent-scoped credential changes (ADR 0018).
 *
 * Every change requires recent explicit proof of the CURRENT identity (the
 * account password or a fresh provider assertion for an already-linked
 * provider) plus independent proof of the NEW provider credential. Attempts
 * are single-use, short-lived, and bound to the authenticated account, user,
 * auth session, provider, intent, backend origin, nonce and revisions, all
 * rechecked at commit. These functions are the reusable proof/attempt
 * interfaces for the later macOS authentication handoff as well.
 */

export const CREDENTIAL_ATTEMPT_TTL_SECONDS = 300;

export type ProviderId = "apple" | "google";
export type UnlinkProviderId = ProviderId | "password";

export type ProviderProofRequest = {
  challenge_id: string;
  identity_token: string;
};

export type VerifiedProviderProof = {
  provider: ProviderId;
  subjectHash: string;
  email: string | null;
  emailVerified: boolean;
  expiresAt: Date;
  identityToken: string;
};

export type CredentialChangeDeps = {
  appleVerifier?: AppleTokenVerifying;
  googleVerify?: GoogleVerifier;
};

/**
 * Verify a provider assertion (validated issuer/subject, nonce, audience) and
 * consume its challenge and exact assertion once. Identity is the provider
 * subject; email is a hint that never grants authority.
 */
export async function verifyAndConsumeProviderProof(
  client: PoolClient,
  config: BackendConfig,
  provider: ProviderId,
  request: ProviderProofRequest,
  clientLabel: string,
  deps: CredentialChangeDeps = {},
): Promise<VerifiedProviderProof> {
  if (provider === "apple") {
    const proof = await verifyAppleIdentityRequest(
      client,
      config,
      {
        challenge_id: request.challenge_id,
        identity_token: request.identity_token,
        client_label: clientLabel,
      },
      deps.appleVerifier,
    );
    await consumeAppleProof(
      client,
      {
        challenge_id: request.challenge_id,
        identity_token: request.identity_token,
        client_label: clientLabel,
      },
      proof,
    );
    return {
      provider: "apple",
      subjectHash: proof.subjectHash,
      email: proof.token.email,
      emailVerified: proof.token.emailVerified,
      expiresAt: proof.token.expiresAt,
      identityToken: request.identity_token,
    };
  }
  const verify = deps.googleVerify ?? verifyGoogleIdentity;
  let identity;
  try {
    identity = await verify(request.identity_token, config.googleSignInAudiences ?? []);
  } catch {
    throw new ApiError(
      401,
      "GOOGLE_TOKEN_INVALID",
      "The Google identity could not be verified. Start sign-in again.",
    );
  }
  await consumeGoogleProof(
    client,
    {
      challenge_id: request.challenge_id,
      identity_token: request.identity_token,
      client_label: clientLabel,
    },
    identity,
  );
  return {
    provider: "google",
    subjectHash: providerSubjectHash(
      "google",
      "https://accounts.google.com",
      identity.subject,
    ),
    email: identity.email,
    emailVerified: true,
    expiresAt: identity.expiresAt,
    identityToken: request.identity_token,
  };
}

type AttemptRow = {
  id: string;
  account_id: string;
  user_id: string;
  session_id: string;
  intent: CredentialChangeIntent;
  provider: SignInMethodProvider | null;
  origin: string;
  client_label: string;
  attempt_secret_hash: string;
  nonce_hash: string;
  expected_revision: number;
  expected_user_revision: number;
  provider_challenge_id: string | null;
  expires_at: Date;
  consumed_at: Date | null;
};

function invalidAttempt(): ApiError {
  return new ApiError(
    409,
    "CREDENTIAL_ATTEMPT_INVALID",
    "This sign-in method change is expired, already used, or bound to another session. Start again from Settings.",
  );
}

async function loadContext(
  client: PoolClient,
  auth: AuthContext,
  write: boolean,
): Promise<{ settingsRevision: number; userRevision: number }> {
  const account = await client.query<{ settings_revision: number; retired_at: Date | null }>(
    `SELECT settings_revision, retired_at FROM accounts WHERE id = $1 FOR ${write ? "UPDATE" : "SHARE"}`,
    [auth.accountId],
  );
  const user = await client.query<{ profile_revision: number; status: string }>(
    `SELECT profile_revision, status FROM users
     WHERE account_id = $1 AND id = $2 FOR UPDATE`,
    [auth.accountId, auth.userId],
  );
  const session = await client.query(
    `SELECT id FROM sessions
     WHERE id = $1 AND account_id = $2 AND user_id = $3
       AND revoked_at IS NULL AND expires_at > now()`,
    [auth.sessionId, auth.accountId, auth.userId],
  );
  const accountRow = account.rows[0];
  const userRow = user.rows[0];
  if (!accountRow || !userRow || userRow.status !== "active" || !session.rowCount) {
    throw new ApiError(401, "SESSION_INVALID", "Sign in again to change sign-in methods.");
  }
  if (accountRow.retired_at !== null) {
    throw new ApiError(
      409,
      "ACCOUNT_RETIRED",
      "This account's sign-in methods were transferred to your canonical account. Nothing was written here.",
    );
  }
  return {
    settingsRevision: accountRow.settings_revision,
    userRevision: userRow.profile_revision,
  };
}

async function verifyStepUp(
  client: PoolClient,
  config: BackendConfig,
  auth: AuthContext,
  request: StartCredentialChangeRequest,
  deps: CredentialChangeDeps,
): Promise<void> {
  const stepUp = request.step_up;
  if (stepUp.kind === "password") {
    const credential = await client.query<{
      password_scrypt: string;
      failed_attempts: number;
      locked_until: Date | null;
    }>(
      `SELECT password_scrypt, failed_attempts, locked_until
       FROM password_credentials
       WHERE account_id = $1 AND user_id = $2
       FOR UPDATE`,
      [auth.accountId, auth.userId],
    );
    const row = credential.rows[0];
    if (!row) {
      await consumeDummyPasswordWork(stepUp.password);
      throw new ApiError(
        401,
        "STEP_UP_FAILED",
        "Current identity could not be verified.",
      );
    }
    const matches = await verifyPasswordCredential(stepUp.password, row.password_scrypt);
    const locked = row.locked_until !== null && row.locked_until > new Date();
    if (!matches || locked) {
      if (!locked) {
        await client.query(
          `UPDATE password_credentials
           SET failed_attempts = failed_attempts + 1,
               locked_until = CASE WHEN failed_attempts + 1 >= 6
                 THEN now() + interval '15 minutes' ELSE NULL END
           WHERE account_id = $1 AND user_id = $2`,
          [auth.accountId, auth.userId],
        );
      }
      throw new ApiError(
        401,
        "STEP_UP_FAILED",
        "Current identity could not be verified.",
      );
    }
    await client.query(
      `UPDATE password_credentials SET failed_attempts = 0, locked_until = NULL
       WHERE account_id = $1 AND user_id = $2`,
      [auth.accountId, auth.userId],
    );
    return;
  }
  // Provider step-up must prove an identity ALREADY linked to this user; a
  // fresh assertion for an unlinked provider is new-method proof, not step-up.
  const proof = await verifyAndConsumeProviderProof(
    client,
    config,
    stepUp.provider,
    {
      challenge_id: stepUp.challenge_id,
      identity_token: stepUp.identity_token,
    },
    request.client_label,
    deps,
  );
  const linked = await client.query(
    `SELECT 1 FROM auth_identities
     WHERE account_id = $1 AND user_id = $2
       AND provider = $3 AND subject_hash = $4`,
    [auth.accountId, auth.userId, proof.provider, proof.subjectHash],
  );
  if (!linked.rowCount) {
    throw new ApiError(
      401,
      "STEP_UP_FAILED",
      "Current identity could not be verified.",
    );
  }
}

/**
 * Create one short-lived, single-use credential-change attempt bound to the
 * current authenticated session. The attempt secret is returned exactly once;
 * only its hash is stored. The trusted origin is derived from the actual
 * server request, never from client JSON.
 *
 * Step-up is verified and its outcome (including persisted password failures
 * and lockout) committed in its own transaction before any attempt exists, so
 * a wrong proof can never be rolled back or mint an attempt.
 */
export async function startCredentialChange(
  pool: Pool,
  config: BackendConfig,
  auth: AuthContext,
  request: StartCredentialChangeRequest,
  trustedOrigin: string,
  deps: CredentialChangeDeps = {},
): Promise<CredentialChangeAttempt> {
  const intent = request.intent;
  const provider = request.provider ?? null;
  if (intent === "link_provider" && (provider !== "apple" && provider !== "google")) {
    throw new ApiError(400, "CREDENTIAL_CHANGE_INVALID", "Choose Apple or Google to connect.");
  }
  if (intent === "unlink_provider" && !provider) {
    throw new ApiError(400, "CREDENTIAL_CHANGE_INVALID", "Choose the sign-in method to remove.");
  }
  if (
    (intent === "set_password" || intent === "change_password") &&
    provider
  ) {
    throw new ApiError(400, "CREDENTIAL_CHANGE_INVALID", "Password changes do not use a provider.");
  }

  // One transaction covers the successful step-up proof AND the attempt: the
  // attempt is bound to the account/user revisions the proof was checked
  // against, so a rival credential change can never rebind an old proof to new
  // revisions or a fresh TTL. A rejected password persists only its failure
  // bookkeeping (committed alone) and mints no attempt.
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const context = await loadContext(client, auth, true);
    // The attempt is minted only against the exact revisions the caller was
    // authorized for. Web prechecks are advisory; this comparison is the
    // authority, so a staged proof can never be rebound to newer settings.
    if (
      context.settingsRevision !== request.expected_account_revision ||
      context.userRevision !== request.expected_user_revision
    ) {
      throw new ApiError(
        409,
        "CREDENTIAL_ATTEMPT_STALE",
        "Account settings changed since this was authorized. Refresh Settings and start again.",
      );
    }
    try {
      await verifyStepUp(client, config, auth, request, deps);
    } catch (error) {
      if (error instanceof ApiError && error.code === "STEP_UP_FAILED") {
        await client.query("COMMIT");
        committed = true;
      }
      throw error;
    }

    let providerChallenge: ProviderChallenge | null = null;
    let providerChallengeId: string | null = null;
    if (intent === "link_provider" && (provider === "apple" || provider === "google")) {
      if (provider === "google") {
        const challenge = await createGoogleChallenge(
          client,
          config,
          request.client_label,
        );
        providerChallengeId = challenge.challenge_id;
        providerChallenge = {
          challenge_id: challenge.challenge_id,
          nonce: challenge.nonce,
          expires_at: challenge.expires_at,
        };
      } else {
        const challenge = await createAppleLoginChallenge(
          client,
          config,
          { client_label: request.client_label },
        );
        providerChallengeId = challenge.challenge_id;
        providerChallenge = {
          challenge_id: challenge.challenge_id,
          nonce: challenge.nonce,
          expires_at: challenge.expires_at,
        };
      }
    }

    const attemptId = randomUUID();
    const attemptSecret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + CREDENTIAL_ATTEMPT_TTL_SECONDS * 1_000);
    await client.query(
      `INSERT INTO credential_change_attempts(
         id, account_id, user_id, session_id, intent, provider, origin,
         client_label, attempt_secret_hash, nonce_hash, expected_revision,
         expected_user_revision, provider_challenge_id, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        attemptId,
        auth.accountId,
        auth.userId,
        auth.sessionId,
        intent,
        provider,
        trustedOrigin,
        request.client_label,
        sha256(attemptSecret),
        sha256(randomBytes(32).toString("base64url")),
        context.settingsRevision,
        context.userRevision,
        providerChallengeId,
        expiresAt,
      ],
    );
    await client.query("COMMIT");
    return {
      contract_version: CONTRACT_VERSION,
      attempt_id: attemptId,
      attempt_secret: attemptSecret,
      intent,
      provider,
      expires_at: expiresAt.toISOString(),
      provider_challenge: providerChallenge,
    };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completeLink(
  client: PoolClient,
  config: BackendConfig,
  auth: AuthContext,
  attempt: AttemptRow,
  request: CompleteCredentialChangeRequest,
  deps: CredentialChangeDeps,
): Promise<CredentialChangeResult["status"]> {
  const provider = attempt.provider;
  if ((provider !== "apple" && provider !== "google") || !attempt.provider_challenge_id) {
    throw invalidAttempt();
  }
  if (!request.identity_token) {
    throw new ApiError(
      400,
      "CREDENTIAL_CHANGE_INVALID",
      "Complete this change with the provider sign-in.",
    );
  }
  const proof = await verifyAndConsumeProviderProof(
    client,
    config,
    provider,
    {
      challenge_id: attempt.provider_challenge_id,
      identity_token: request.identity_token,
    },
    attempt.client_label,
    deps,
  );

  // A VERIFIED provider email different from the primary becomes a secondary
  // reservation for this canonical account inside THIS transaction, under the
  // same email lock and arbitration as every signup. Same-owner claims are
  // idempotent; foreign or historical-conflict addresses fail closed before
  // any hint is written. Unverified hints are never claims, and the primary
  // email never changes here.
  const provenEmail = proof.emailVerified && proof.email
    ? normalizeEmail(proof.email)
    : null;
  const provenance = {
    source: `provider:${proof.provider}` as string,
    verifiedAt: new Date(),
  };
  if (provenEmail) {
    try {
      await reserveVerifiedEmail(
        client,
        provenEmail,
        { accountId: auth.accountId, userId: auth.userId },
        provenance,
        "secondary",
      );
      if (provenEmail === normalizeEmail(auth.userEmail)) {
        await client.query(
          `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now())
           WHERE account_id = $1 AND id = $2`,
          [auth.accountId, auth.userId],
        );
      }
    } catch (error) {
      if (error instanceof EmailClaimConflict) {
        // Truthful conflict: no claim, no hint write, credential untouched.
        throw new ApiError(
          409,
          "LOGIN_METHOD_EMAIL_CONFLICT",
          "This provider email belongs to another capri account. Email equality grants no access; the credential is unchanged.",
        );
      }
      throw error;
    }
  }

  // Provider identity is the validated issuer/subject. The same subject is
  // idempotent; another user's subject is a protected conflict; a second
  // subject for the same provider on this user is rejected so one row per
  // provider holds going forward (historical multiplicity is preserved).
  const existing = await client.query<{ account_id: string; user_id: string }>(
    `SELECT account_id, user_id FROM auth_identities
     WHERE provider = $1 AND subject_hash = $2`,
    [proof.provider, proof.subjectHash],
  );
  const owner = existing.rows[0];
  if (owner) {
    if (owner.account_id !== auth.accountId || owner.user_id !== auth.userId) {
      throw new ApiError(
        409,
        "LOGIN_METHOD_CONFLICT",
        "This provider account is already connected to another capri account. Authenticated recovery explains the exact conflict; nothing was merged.",
      );
    }
    // Reassertion with a newly verified address follows the same arbitration
    // BEFORE the hint is updated.
    await client.query(
      `UPDATE auth_identities
       SET last_authenticated_at = now(), email_hint = COALESCE($3, email_hint)
       WHERE provider = $1 AND subject_hash = $2`,
      [proof.provider, proof.subjectHash, proof.email],
    );
    return "already_linked";
  }
  const sameProvider = await client.query(
    `SELECT 1 FROM auth_identities
     WHERE account_id = $1 AND user_id = $2 AND provider = $3
     LIMIT 1`,
    [auth.accountId, auth.userId, proof.provider],
  );
  if (sameProvider.rowCount) {
    throw new ApiError(
      409,
      "LOGIN_METHOD_CONFLICT",
      "This account already has a login from that provider. Remove it first to connect a different provider account.",
    );
  }


  await client.query(
    `INSERT INTO auth_identities(id, account_id, user_id, provider, subject_hash, email_hint)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), auth.accountId, auth.userId, proof.provider, proof.subjectHash, proof.email],
  );
  return "linked";
}

async function completePassword(
  client: PoolClient,
  auth: AuthContext,
  attempt: AttemptRow,
  request: CompleteCredentialChangeRequest,
): Promise<CredentialChangeResult["status"]> {
  if (!request.password) {
    throw new ApiError(
      400,
      "CREDENTIAL_CHANGE_INVALID",
      "Provide the new password to finish this change.",
    );
  }
  if (attempt.intent === "change_password") {
    // Changing an existing password already required password or equivalent
    // verified provider step-up at attempt creation; the old password is
    // replaced, never reused or inherited elsewhere.
    const existingCredential = await client.query(
      `SELECT 1 FROM password_credentials WHERE account_id = $1 AND user_id = $2`,
      [auth.accountId, auth.userId],
    );
    if (!existingCredential.rowCount) {
      throw new ApiError(
        409,
        "PASSWORD_NOT_SET",
        "This account has no password yet. Set one instead.",
      );
    }
  }
  // Setting a password requires the normalized email to have exactly this
  // canonical owner. A historical conflict must be resolved by reviewed
  // reconciliation first; email_verified alone grants nothing.
  const userRow = await client.query<{ email: string }>(
    `SELECT email FROM users WHERE account_id = $1 AND id = $2`,
    [auth.accountId, auth.userId],
  );
  const normalizedEmail = normalizeEmail(userRow.rows[0]?.email ?? "");
  const reservation = await readEmailReservation(client, normalizedEmail);
  if (
    !reservation ||
    reservation.state !== "owned" ||
    reservation.account_id !== auth.accountId ||
    reservation.user_id !== auth.userId
  ) {
    throw new ApiError(
      409,
      "EMAIL_OWNERSHIP_UNRESOLVED",
      "This email is in historical conflict. Resolve it with the reviewed reconciliation flow before setting a password.",
    );
  }
  const scrypt = await encodePasswordCredential(request.password);
  await client.query(
    `INSERT INTO password_credentials(account_id, user_id, password_scrypt)
     VALUES ($1, $2, $3)
     ON CONFLICT (account_id, user_id) DO UPDATE
       SET password_scrypt = EXCLUDED.password_scrypt,
           password_changed_at = now(),
           failed_attempts = 0,
           locked_until = NULL`,
    [auth.accountId, auth.userId, scrypt],
  );
  // Provenance is preserved: the user keeps its historical kind and IDs.
  return "password_set";
}

async function completeUnlink(
  client: PoolClient,
  auth: AuthContext,
  attempt: AttemptRow,
): Promise<CredentialChangeResult["status"]> {
  const provider = attempt.provider;
  if (!provider) throw invalidAttempt();
  if (provider === "password") {
    const existing = await client.query(
      `SELECT 1 FROM password_credentials WHERE account_id = $1 AND user_id = $2`,
      [auth.accountId, auth.userId],
    );
    if (!existing.rowCount) {
      throw new ApiError(
        409,
        "LOGIN_METHOD_NOT_FOUND",
        "That sign-in method is not connected.",
      );
    }
  } else {
    const existing = await client.query(
      `SELECT 1 FROM auth_identities
       WHERE account_id = $1 AND user_id = $2 AND provider = $3`,
      [auth.accountId, auth.userId, provider],
    );
    if (!existing.rowCount) {
      throw new ApiError(
        409,
        "LOGIN_METHOD_NOT_FOUND",
        "That sign-in method is not connected.",
      );
    }
  }

  // At least one usable login method must remain AFTER the proposed removal,
  // serialized against concurrent removals by the user row lock in the caller.
  // Historical multiplicity (several subjects of one provider) counts as one
  // usable provider method only when rows survive the deletion.
  const remaining = await client.query<{ count: string }>(
    `SELECT ((SELECT count(*) FROM auth_identities
                WHERE account_id = $1 AND user_id = $2
                  AND provider IS DISTINCT FROM $3)
           + (SELECT count(*) FROM password_credentials
                WHERE account_id = $1 AND user_id = $2 AND $3 <> 'password'))::text AS count`,
    [auth.accountId, auth.userId, provider],
  );
  if (Number(remaining.rows[0]?.count ?? 0) < 1) {
    throw new ApiError(
      409,
      "LAST_LOGIN_METHOD",
      "Keep at least one sign-in method. Set another method before removing this one.",
    );
  }
  if (provider === "password") {
    await client.query(
      `DELETE FROM password_credentials WHERE account_id = $1 AND user_id = $2`,
      [auth.accountId, auth.userId],
    );
  } else {
    await client.query(
      `DELETE FROM auth_identities
       WHERE account_id = $1 AND user_id = $2 AND provider = $3`,
      [auth.accountId, auth.userId, provider],
    );
  }
  return "unlinked";
}

/**
 * Consume one attempt and commit its intent. Session validity, account
 * ownership, revisions and origin are rechecked inside the transaction; any
 * failure rolls back and leaves the account unchanged with a recoverable error.
 */
export async function completeCredentialChange(
  pool: Pool,
  config: BackendConfig,
  auth: AuthContext,
  request: CompleteCredentialChangeRequest,
  requestOrigin: string | null,
  deps: CredentialChangeDeps = {},
  labEnabled = false,
): Promise<CredentialChangeResult> {
  void config;
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const attemptResult = await client.query<AttemptRow>(
      `SELECT * FROM credential_change_attempts
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [request.attempt_id],
    );
    const attempt = attemptResult.rows[0];
    // The operation origin is rederived from the actual request: a browser
    // must repeat the origin the attempt was bound to, and a native client is
    // bound to its own client label.
    const expectedOrigin = attempt
      ? (requestOrigin ?? `client:${attempt.client_label}`)
      : "";
    if (
      !attempt ||
      attempt.attempt_secret_hash !== sha256(request.attempt_secret) ||
      attempt.account_id !== auth.accountId ||
      attempt.user_id !== auth.userId ||
      attempt.session_id !== auth.sessionId ||
      attempt.origin !== expectedOrigin
    ) {
      throw invalidAttempt();
    }

    const context = await loadContext(client, auth, true);
    if (
      context.settingsRevision !== attempt.expected_revision ||
      context.userRevision !== attempt.expected_user_revision
    ) {
      throw new ApiError(
        409,
        "CREDENTIAL_ATTEMPT_STALE",
        "Account settings changed while this was open. Refresh Settings and start again.",
      );
    }

    let status: CredentialChangeResult["status"];
    if (attempt.intent === "link_provider") {
      status = await completeLink(client, config, auth, attempt, request, deps);
    } else if (
      attempt.intent === "set_password" ||
      attempt.intent === "change_password"
    ) {
      status = await completePassword(client, auth, attempt, request);
    } else {
      status = await completeUnlink(client, auth, attempt);
    }

    await client.query(
      `UPDATE credential_change_attempts
       SET consumed_at = now() WHERE id = $1`,
      [attempt.id],
    );
    await client.query(
      `INSERT INTO account_access_events(id, account_id, actor_user_id, kind, request_hash, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        attempt.id,
        auth.accountId,
        auth.userId,
        attempt.intent,
        sha256(
          JSON.stringify({
            attempt: attempt.id,
            provider: attempt.provider,
            origin: attempt.origin,
          }),
        ),
        JSON.stringify({
          target_provider: attempt.provider,
          revision_before: attempt.expected_revision,
          revision_after: context.settingsRevision,
          target_user_id: auth.userId,
          outcome: status,
        }),
      ],
    );
    await client.query(
      `UPDATE accounts SET settings_revision = settings_revision + 1 WHERE id = $1`,
      [auth.accountId],
    );
    const settings = await readAccountSettingsWith(client, auth, labEnabled);
    await client.query("COMMIT");
    committed = true;
    return {
      contract_version: CONTRACT_VERSION,
      status,
      settings,
    };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
