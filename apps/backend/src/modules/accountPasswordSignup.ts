import { randomBytes, randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  ErrorResponseSchema,
  PasswordRegistrationRequestSchema,
  PasswordRegistrationStartResponseSchema,
  PasswordVerificationConfirmRequestSchema,
  SessionResponseSchema,
  type PasswordRegistrationRequest,
  type PasswordVerificationConfirmRequest,
  type SessionResponse,
} from "@talent-signal/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import type { MailDelivery } from "../lib/mail.js";
import {
  EmailClaimConflict,
  claimEmailReservation,
  createRealIdentity,
  normalizeEmail,
  readEmailReservation,
} from "./accountIdentity.js";
import { insertSession } from "./auth.js";
import {
  consumeDummyPasswordWork,
  encodePasswordCredential,
  verifyPasswordCredential,
} from "./passwordCredential.js";

/**
 * Verified password signup (ADR 0018).
 *
 * A registration start is short-lived and generic: it stores only a password
 * hash and a verification-secret hash, never reserves an email, and never
 * returns or logs the code. Only the verified owner's confirmation may create
 * a canonical account, and if another verified owner won the race the pending
 * password is discarded rather than attached.
 */

export const VERIFICATION_TTL_SECONDS = 30 * 60;
export const VERIFICATION_MAX_ATTEMPTS = 5;
export const REGISTRATION_STARTS_PER_HOUR = 5;

export type PendingPasswordRegistration = {
  id: string;
  normalized_email: string;
  username: string;
  display_name: string;
  password_scrypt: string;
  attempts: number;
};

function requireRegistration(config: BackendConfig): void {
  if (!config.passwordAuthEnabled || !config.passwordRegistrationEnabled) {
    throw new ApiError(
      404,
      "PASSWORD_REGISTRATION_DISABLED",
      "Account registration is not open on this service.",
    );
  }
}

function verificationSecret(): string {
  return randomBytes(32).toString("base64url");
}

function verificationLink(config: BackendConfig, secret: string): string {
  const base = config.verificationBaseUrl ?? config.allowedOrigins[0];
  if (!base) {
    throw new ApiError(
      503,
      "EMAIL_DELIVERY_UNAVAILABLE",
      "Email verification is not configured for this service.",
    );
  }
  return `${base.replace(/\/$/, "")}/login?verification=${encodeURIComponent(secret)}`;
}

function verificationMessage(
  config: BackendConfig,
  secret: string,
): { subject: string; text: string } {
  const link = verificationLink(config, secret);
  return {
    subject: "Confirm your capri email",
    text: [
      "Confirm this email address to finish creating your capri account.",
      "",
      link,
      "",
      `If the link does not open, use this one-time code: ${secret}`,
      "",
      "If you did not request this, you can ignore this message.",
    ].join("\n"),
  };
}

function existingOwnerNotice(): { subject: string; text: string } {
  return {
    subject: "Your capri sign-in",
    text: [
      "Someone asked to create a capri account with this email,",
      "but it already has one. Sign in with the method you already use;",
      "you can connect additional sign-in methods in Settings.",
      "",
      "If you did not request this, you can ignore this message.",
    ].join("\n"),
  };
}

/**
 * Start a verified password registration. The response is identical for a new
 * email, a taken email, and an unreachable mailbox owner attempt, except for
 * the honest delivery failure when no transport exists.
 */
export async function startPasswordRegistration(
  pool: Pool,
  config: BackendConfig,
  mail: MailDelivery,
  request: PasswordRegistrationRequest,
): Promise<{ contract_version: string; status: "verification_sent" }> {
  requireRegistration(config);
  const email = normalizeEmail(request.email);
  const username = request.username.trim().toLowerCase();
  const displayName = request.display_name.trim();

  const recent = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pending_password_registrations
     WHERE normalized_email = $1 AND created_at > now() - interval '1 hour'`,
    [email],
  );
  if (Number(recent.rows[0]?.count ?? 0) >= REGISTRATION_STARTS_PER_HOUR) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Too many verification requests. Try again later.",
    );
  }

  // A username is a public login handle: its collision with an existing
  // account is disclosed exactly as before, while email ownership stays
  // undisclosed. Open pending rows never block a retry.
  const usernameTaken = await pool.query(
    `SELECT 1 FROM users WHERE lower(username) = $1 LIMIT 1`,
    [username],
  );
  if (usernameTaken.rows[0]) {
    throw new ApiError(
      409,
      "PASSWORD_ACCOUNT_EXISTS",
      "An account already uses that username or email.",
    );
  }

  const reservation = await readEmailReservation(pool, email);
  const legacyOwner = await pool.query(
    `SELECT 1 FROM users WHERE lower(btrim(email)) = $1 LIMIT 1`,
    [email],
  );
  if (reservation || legacyOwner.rows[0]) {
    // The address is already claimed or in historical conflict. Only a
    // non-secret notice is sent; no code is created, returned, or logged.
    await mail.send({
      to: request.email.trim(),
      ...existingOwnerNotice(),
      idempotencyKey: `password-registration-notice:${email}`,
    });
    return {
      contract_version: CONTRACT_VERSION,
      status: "verification_sent",
    };
  }

  // Safe resend/restart recovery: retrying the same unverified form rotates
  // the code on the existing pending row after re-verifying its password. A
  // different password starts a separate pending request; nothing overwrites
  // or inherits another request's unverified password.
  const openPending = await pool.query<{
    id: string;
    password_scrypt: string;
  }>(
    `SELECT id, password_scrypt FROM pending_password_registrations
     WHERE normalized_email = $1 AND lower(username) = $2
       AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [email, username],
  );
  const retry = openPending.rows[0];
  if (retry && (await verifyPasswordCredential(request.password, retry.password_scrypt))) {
    const secret = verificationSecret();
    await pool.query(
      `UPDATE pending_password_registrations
       SET verification_secret_hash = $2, attempts = 0,
           expires_at = now() + interval '1 second' * $3
       WHERE id = $1`,
      [retry.id, sha256(secret), VERIFICATION_TTL_SECONDS],
    );
    try {
      await mail.send({
        to: request.email.trim(),
        ...verificationMessage(config, secret),
        idempotencyKey: `password-registration:${retry.id}:${sha256(secret).slice(0, 12)}`,
      });
    } catch (error) {
      // Keep the previous code usable when the resend fails; report honestly.
      throw error;
    }
    return { contract_version: CONTRACT_VERSION, status: "verification_sent" };
  }

  const id = randomUUID();
  const secret = verificationSecret();
  const passwordScrypt = await encodePasswordCredential(request.password);
  await pool.query(
    `INSERT INTO pending_password_registrations(
       id, normalized_email, username, display_name, password_scrypt,
       verification_secret_hash, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, now() + interval '1 second' * $7)`,
    [
      id,
      email,
      username,
      displayName,
      passwordScrypt,
      sha256(secret),
      VERIFICATION_TTL_SECONDS,
    ],
  );
  try {
    await mail.send({
      to: request.email.trim(),
      ...verificationMessage(config, secret),
      idempotencyKey: `password-registration:${id}`,
    });
  } catch (error) {
    // An undelivered code must not linger as a usable challenge.
    await pool.query(
      `DELETE FROM pending_password_registrations WHERE id = $1`,
      [id],
    );
    throw error;
  }
  return { contract_version: CONTRACT_VERSION, status: "verification_sent" };
}

/**
 * Confirm a verified registration. Ownership arbitration happens in the same
 * transaction that consumes the challenge; a concurrently created owner wins
 * and the pending password is discarded, never attached.
 */
export async function confirmPasswordRegistration(
  pool: Pool,
  config: BackendConfig,
  request: PasswordVerificationConfirmRequest,
): Promise<SessionResponse> {
  requireRegistration(config);
  const secretHash = sha256(request.verification_secret);
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const found = await client.query<PendingPasswordRegistration>(
      `SELECT id, normalized_email, username, display_name, password_scrypt, attempts
       FROM pending_password_registrations
       WHERE verification_secret_hash = $1
       FOR UPDATE`,
      [secretHash],
    );
    const pending = found.rows[0];
    if (!pending || pending.attempts >= VERIFICATION_MAX_ATTEMPTS) {
      if (pending) {
        await client.query(
          `UPDATE pending_password_registrations
           SET attempts = attempts + 1 WHERE id = $1`,
          [pending.id],
        );
      }
      await client.query("COMMIT");
      committed = true;
      throw new ApiError(
        401,
        "VERIFICATION_INVALID",
        "This verification link is invalid or has expired. Start again.",
      );
    }
    const consumed = await client.query(
      `UPDATE pending_password_registrations
       SET consumed_at = now()
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING id`,
      [pending.id],
    );
    if (!consumed.rows[0]) {
      await client.query("COMMIT");
      committed = true;
      throw new ApiError(
        401,
        "VERIFICATION_INVALID",
        "This verification link is invalid or has expired. Start again.",
      );
    }

    const accountId = randomUUID();
    const userId = randomUUID();
    const accountName = `${pending.display_name}'s workspace`;
    const accountSlug = `personal-${pending.username}-${randomUUID().slice(0, 8)}`;
    try {
      await createRealIdentity(client, {
        accountId,
        userId,
        accountName,
        accountSlug,
        email: pending.normalized_email,
        displayName: pending.display_name,
        kind: "password_human",
        username: pending.username,
        emailVerifiedAt: new Date(),
      });
    } catch (error) {
      if (error instanceof EmailClaimConflict) {
        // A verified provider or another verified registration already owns the
        // normalized email. Roll the whole attempt back: the pending password
        // is never attached and no orphan account row survives.
        await client.query("ROLLBACK");
        committed = true;
        throw new ApiError(
          409,
          "PASSWORD_ACCOUNT_EXISTS",
          "A verified account already uses this email. Sign in with its existing method, then set a password in Settings.",
        );
      }
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        await client.query("ROLLBACK");
        committed = true;
        throw new ApiError(
          409,
          "PASSWORD_ACCOUNT_EXISTS",
          "An account already uses that username or email.",
        );
      }
      throw error;
    }
    await client.query(
      `INSERT INTO password_credentials(account_id, user_id, password_scrypt)
       VALUES ($1, $2, $3)`,
      [accountId, userId, pending.password_scrypt],
    );
    const session = await insertSession(
      client,
      config,
      {
        accountId,
        accountName,
        accountSlug,
        displayName: pending.display_name,
        role: "member",
        userEmail: pending.normalized_email,
        userId,
        userKind: "password_human",
        username: pending.username,
      },
      request.client_label,
    );
    await client.query("COMMIT");
    committed = true;
    return session;
  } catch (error) {
    if (!committed) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
}

export function registerPasswordSignupRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: BackendConfig,
  mail: MailDelivery | undefined,
): void {
  app.post<{ Body: PasswordRegistrationRequest }>(
    "/v1/auth/password/register",
    {
      config: { rateLimit: { max: 6, timeWindow: "1 hour" } },
      schema: {
        tags: ["auth"],
        body: PasswordRegistrationRequestSchema,
        response: {
          202: PasswordRegistrationStartResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!mail) {
        // Honest failure: never pretend an unconfigured transport sent mail.
        throw new ApiError(
          503,
          "EMAIL_DELIVERY_UNAVAILABLE",
          "Email verification is not configured for this service.",
        );
      }
      return reply
        .status(202)
        .send(await startPasswordRegistration(pool, config, mail, request.body));
    },
  );

  app.post<{ Body: PasswordVerificationConfirmRequest }>(
    "/v1/auth/password/register/confirm",
    {
      config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        body: PasswordVerificationConfirmRequestSchema,
        response: {
          200: SessionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      confirmPasswordRegistration(pool, config, request.body),
  );
}
