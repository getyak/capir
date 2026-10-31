import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import type { BackendConfig } from "../config.js";
import { sha256 } from "../lib/hash.js";
import { createMemoryMailSink } from "../lib/mail.js";
import { ApiError } from "../lib/apiError.js";
import {
  EmailClaimConflict,
  assertAccountActive,
  claimEmailReservation,
  classifyAccountDataInventory,
  createRealIdentity,
  newAccountSlug,
  normalizeEmail,
  readEmailReservation,
  reportEmailOwnership,
} from "./accountIdentity.js";
import {
  completeCredentialChange,
  startCredentialChange as startCredentialChangeRaw,
} from "./accountLoginMethods.js";
import type { StartCredentialChangeRequest } from "@talent-signal/contracts";
import {
  confirmPasswordRegistration,
  startPasswordRegistration,
} from "./accountPasswordSignup.js";
import {
  cancelReconciliation,
  confirmReconciliation,
  prepareReconciliation as prepareReconciliationRaw,
  readReconciliation,
} from "./accountReconciliation.js";
import {
  createPasswordSession,
  insertSession,
  revokeCurrentSession,
  type AppleIdentityToken,
  type AppleTokenVerifying,
  type AuthContext,
} from "./auth.js";
import { encodePasswordCredential } from "./passwordCredential.js";
import type { GoogleVerifier } from "./googleAuth.js";
import { createGoogleChallenge, createGoogleSession } from "./googleAuth.js";

/**
 * Real PostgreSQL integration for account identity, verified signup,
 * step-up bound credential changes, and reviewed duplicate resolution.
 * All data is synthetic; provider proofs are injected verifier fixtures and
 * are never described as live Apple or Google evidence.
 */

const database = process.env.ACCOUNT_IDENTITY_TEST_DATABASE_URL;
const pool = database ? new Pool({ connectionString: database }) : null;
// Unique per run so repeated runs against one disposable database stay valid.
const RUN = randomUUID().slice(0, 8);

afterAll(async () => {
  await pool?.end();
});

const config: BackendConfig = {
  allowedOrigins: ["https://web.test"],
  appleSignInAudiences: ["com.talentsignal.app", "com.talentsignal.web"],
  appleSignInEnabled: true,
  googleSignInAudiences: ["ios-client", "web-client"],
  databaseUrl: database ?? "postgresql://synthetic-only",
  host: "127.0.0.1",
  passwordAuthEnabled: true,
  passwordRegistrationEnabled: true,
  port: 4317,
  retentionSweepIntervalMs: 60_000,
  sessionTtlSeconds: 28_800,
  simulatedAuthEnabled: true,
};

// Injected provider proofs: tokens are opaque fixture strings decoded by the
// fixture verifier. They exercise issuer/subject/nonce plumbing only.
function fakeAppleVerifier(): AppleTokenVerifying {
  return {
    async verify(identityToken: string): Promise<AppleIdentityToken> {
      const [subject, email, verified, nonceHash] = identityToken.split("|");
      if (!subject) throw new Error("fixture token missing subject");
      return {
        audience: "com.talentsignal.app",
        email: email && email !== "-" ? email : null,
        emailVerified: verified === "true",
        expiresAt: new Date(Date.now() + 3_600_000),
        issuer: "https://appleid.apple.com",
        nonce: nonceHash ?? "",
        subject,
      };
    },
  };
}

const fakeGoogleVerifier: GoogleVerifier = async (identityToken) => {
  const [subject, email, nonce] = identityToken.split("|");
  if (!subject || !email) throw new Error("fixture token missing claims");
  return {
    subject,
    email,
    name: "Fixture User",
    nonce: nonce ?? "",
    expiresAt: new Date(Date.now() + 3_600_000),
  };
};

const deps = { appleVerifier: fakeAppleVerifier(), googleVerify: fakeGoogleVerifier };

function appleToken(subject: string, nonceHash: string, email = "-", verified = "false") {
  return `${subject}|${email}|${verified}|${nonceHash}`;
}

function googleToken(subject: string, email: string, nonceHash: string) {
  return `${subject}|${email}|${nonceHash}`;
}

/** The delivered message carries the one-time code after the fixed label. */
function secretFromMessage(text: string): string {
  const match = /one-time code: (\S+)/.exec(text);
  if (!match?.[1]) throw new Error("verification message has no code");
  return match[1];
}

async function createAccount(options: {
  email: string;
  displayName?: string;
  kind?: "password_human" | "google_human" | "apple_human";
  password?: string;
}) {
  const client = await pool!.connect();
  const accountId = randomUUID();
  const userId = randomUUID();
  try {
    await client.query("BEGIN");
    await createRealIdentity(client, {
      accountId,
      userId,
      accountName: `${options.displayName ?? "Fixture"}'s workspace`,
      accountSlug: newAccountSlug(),
      email: options.email,
      displayName: options.displayName ?? "Fixture",
      kind: options.kind ?? "password_human",
      emailVerifiedAt: new Date(),
    });
    if (options.password) {
      await client.query(
        `INSERT INTO password_credentials(account_id, user_id, password_scrypt)
         VALUES ($1, $2, $3)`,
        [accountId, userId, await encodePasswordCredential(options.password)],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { accountId, userId };
}

async function sessionFor(
  accountId: string,
  userId: string,
  clientLabel: string,
): Promise<{ auth: SessionResponseLike; token: string }> {
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const identity = await pool!.query<{ display_name: string; email: string; kind: string; username: string | null; account_name: string; account_slug: string; account_role: "admin" | "member" }>(
      `SELECT users.display_name, users.email, users.kind, users.username,
              accounts.name AS account_name, accounts.slug AS account_slug,
              users.account_role
       FROM users JOIN accounts ON accounts.id = users.account_id
       WHERE users.account_id = $1 AND users.id = $2`,
      [accountId, userId],
    );
    const row = identity.rows[0]!;
    const session = await insertSession(
      client,
      config,
      {
        accountId,
        accountName: row.account_name,
        accountSlug: row.account_slug,
        displayName: row.display_name,
        role: row.account_role,
        userEmail: row.email,
        userId,
        userKind: row.kind as AuthContext["userKind"],
        username: row.username,
      },
      clientLabel,
    );
    await client.query("COMMIT");
    return {
      token: session.access_token,
      auth: {
        accountId,
        accountSlug: session.account.slug,
        userId,
        userEmail: session.user.email,
        userKind: session.user.kind as AuthContext["userKind"],
        sessionId: (await pool!.query<{ id: string }>(
          `SELECT id FROM sessions WHERE account_id = $1 AND user_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [accountId, userId],
        )).rows[0]!.id,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type SessionResponseLike = AuthContext;

/**
 * Seed the post-migration legacy shape (same normalized email owned by two
 * historical accounts). The reservation trigger guards live writes; legacy
 * rows predate it, so fixtures disable it exactly as history exists.
 */
async function seedLegacyCollision(rows: Array<{ email: string; kind: string; accountId: string; userId: string }>) {
  await pool!.query("ALTER TABLE users DISABLE TRIGGER enforce_account_email_reservation");
  try {
    for (const row of rows) {
      await pool!.query(
        `INSERT INTO accounts(id, slug, name) VALUES ($1, $2, $3)`,
        [row.accountId, `legacy-${row.accountId.slice(0, 8)}`, "Legacy workspace"],
      );
      await pool!.query(
        `INSERT INTO users(id, account_id, email, display_name, kind)
         VALUES ($1, $2, $3, 'Legacy', $4)`,
        [row.userId, row.accountId, row.email, row.kind],
      );
    }
  } finally {
    await pool!.query("ALTER TABLE users ENABLE TRIGGER enforce_account_email_reservation");
  }
  const normalized = normalizeEmail(rows[0]!.email);
  await pool!.query(
    `INSERT INTO account_email_reservations(normalized_email, state)
     VALUES ($1, 'conflict')
     ON CONFLICT (normalized_email) DO UPDATE SET state = 'conflict', account_id = NULL, user_id = NULL`,
    [normalized],
  );
}


/**
 * Real start with the revisions the caller is authorized against, exactly as
 * the settings UI does. A test that wants drift passes explicit expectations.
 */
async function revisionsFor(accountId: string, userId: string) {
  const row = (await pool!.query<{ account_revision: number; user_revision: number }>(
    `SELECT a.settings_revision AS account_revision, u.profile_revision AS user_revision
     FROM accounts a JOIN users u ON u.account_id = a.id AND u.id = $2
     WHERE a.id = $1`,
    [accountId, userId],
  )).rows[0]!;
  return {
    expected_account_revision: row.account_revision,
    expected_user_revision: row.user_revision,
  };
}

type StartChangeInput = Omit<
  StartCredentialChangeRequest,
  "expected_account_revision" | "expected_user_revision" | "origin"
> & { origin?: string };

async function startCredentialChange(
  client: Pool,
  config: BackendConfig,
  auth: SessionResponseLike,
  request: StartChangeInput,
  trustedOrigin: string,
  depsArg = deps,
) {
  return startCredentialChangeRaw(
    client,
    config,
    auth,
    {
      ...request,
      origin: request.origin ?? "ignored",
      ...(await revisionsFor(auth.accountId, auth.userId)),
    },
    trustedOrigin,
    depsArg,
  );
}


/** Real prepare carrying the revisions the recovery screen was rendered from. */
async function prepareReconciliation(
  client: Pool,
  config: BackendConfig,
  auth: SessionResponseLike,
  request: Omit<
    Parameters<typeof prepareReconciliationRaw>[3],
    'expected_account_revision' | 'expected_user_revision'
  >,
  depsArg = deps,
) {
  return prepareReconciliationRaw(client, config, auth, {
    ...request,
    ...(await revisionsFor(auth.accountId, auth.userId)),
  }, depsArg);
}

async function passwordHashFor(accountId: string, userId: string) {
  return (await pool!.query<{ password_scrypt: string }>(
    `SELECT password_scrypt FROM password_credentials WHERE account_id = $1 AND user_id = $2`,
    [accountId, userId],
  )).rows[0]?.password_scrypt ?? null;
}

describe.skipIf(!pool)("account identity ownership (PostgreSQL)", () => {
  it("claims one normalized email for one owner across case and whitespace variants", async () => {
    const tag = randomUUID().slice(0, 8);
    const first = randomUUID();
    const second = randomUUID();
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await createRealIdentity(client, {
        accountId: first,
        userId: randomUUID(),
        accountName: "Case workspace",
        accountSlug: newAccountSlug(),
        email: `  Case.Owner.${tag}@Example.Test `,
        displayName: "Case",
        kind: "google_human",
        emailVerifiedAt: new Date(),
      });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await expect(
      (async () => {
        const client2 = await pool!.connect();
        try {
          await client2.query("BEGIN");
          await createRealIdentity(client2, {
            accountId: second,
            userId: randomUUID(),
            accountName: "Case workspace two",
            accountSlug: newAccountSlug(),
            email: `case.owner.${tag}@example.test`,
            displayName: "Case",
            kind: "password_human",
            emailVerifiedAt: new Date(),
          });
          await client2.query("COMMIT");
        } finally {
          client2.release();
        }
      })(),
    ).rejects.toBeInstanceOf(EmailClaimConflict);
    const reservation = await readEmailReservation(pool!, `CASE.OWNER.${tag}@example.test`);
    expect(reservation).toMatchObject({
      state: "owned",
      account_id: first,
    });
    const owners = await pool!.query(
      `SELECT count(*)::text AS count FROM users WHERE lower(btrim(email)) = $1`,
      [`case.owner.${tag}@example.test`],
    );
    expect(owners.rows[0]!.count).toBe("1");
  });

  it("lets the database arbitrate concurrent first signup for one email", async () => {
    const email = `race-${randomUUID().slice(0, 8)}@example.test`;
    const attempt = async (kind: "password_human" | "google_human") => {
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await createRealIdentity(client, {
          accountId: randomUUID(),
          userId: randomUUID(),
          accountName: "Race workspace",
          accountSlug: newAccountSlug(),
          email,
          displayName: "Race",
          kind,
          emailVerifiedAt: new Date(),
        });
        await client.query("COMMIT");
        return "created";
      } catch (error) {
        await client.query("ROLLBACK");
        return error instanceof EmailClaimConflict ? "conflict" : "error";
      } finally {
        client.release();
      }
    };
    const results = await Promise.all([attempt("password_human"), attempt("google_human")]);
    expect(results.filter((result) => result === "created")).toHaveLength(1);
    expect(results.filter((result) => result === "conflict")).toHaveLength(1);
  });

  it("reports historical collisions as durable reservations without merging owners", async () => {
    const accountA = randomUUID();
    const accountB = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const email = `Shared.${randomUUID().slice(0, 8)}@Example.Test`;
    await seedLegacyCollision([
      { email, kind: "google_human", accountId: accountA, userId: userA },
      { email, kind: "password_human", accountId: accountB, userId: userB },
    ]);
    const report = await reportEmailOwnership(pool!, email);
    expect(report.state).toBe("conflict");
    expect(report.reservation_count_hint).toBe(2);
    const claimClient = await pool!.connect();
    try {
      await claimClient.query("BEGIN");
      await expect(
        claimEmailReservation(claimClient, email, {
          accountId: randomUUID(),
          userId: randomUUID(),
        }),
      ).rejects.toBeInstanceOf(EmailClaimConflict);
      await claimClient.query("ROLLBACK");
    } finally {
      claimClient.release();
    }
    const owners = await pool!.query<{ account_id: string }>(
      `SELECT account_id FROM users WHERE lower(btrim(email)) = lower(btrim($1)) ORDER BY account_id`,
      [email],
    );
    expect(owners.rows.map((row) => row.account_id).sort()).toEqual(
      [accountA, accountB].sort(),
    );
  });
});

describe.skipIf(!pool)("verified password signup (PostgreSQL)", () => {
  it("never returns or logs the code, activates once, and rejects replay", async () => {
    const sink = createMemoryMailSink();
    const email = `verify-${randomUUID().slice(0, 8)}@example.test`;
    const start = await startPasswordRegistration(pool!, config, sink.delivery, {
      username: `verify${randomUUID().slice(0, 8)}`,
      email,
      display_name: "Verified",
      password: "quiet-context-1",
      client_label: "web",
    });
    expect(start).toEqual({
      contract_version: expect.any(String),
      status: "verification_sent",
    });
    expect(start).not.toHaveProperty("verification_secret");
    expect(start).not.toHaveProperty("attempt_secret");
    expect(sink.messages).toHaveLength(1);
    const secret = secretFromMessage(sink.messages[0]!.text);
    expect(secret.length).toBeGreaterThanOrEqual(32);

    const session = await confirmPasswordRegistration(pool!, config, {
      verification_secret: secret,
      client_label: "web",
    });
    expect(session.user.email).toBe(email);
    expect(session.user.kind).toBe("password_human");
    await expect(
      confirmPasswordRegistration(pool!, config, {
        verification_secret: secret,
        client_label: "web",
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_INVALID" });
    const owner = await pool!.query(
      `SELECT 1 FROM account_email_reservations WHERE normalized_email = $1 AND state = 'owned'`,
      [email],
    );
    expect(owner.rowCount).toBe(1);
  });

  it("supports safe resend without inheriting an unverified password", async () => {
    const sink = createMemoryMailSink();
    const email = `resend-${randomUUID().slice(0, 8)}@example.test`;
    const username = `resend${randomUUID().slice(0, 8)}`;
    const form = {
      username,
      email,
      display_name: "Resend",
      password: "quiet-context-1",
      client_label: "web",
    };
    await startPasswordRegistration(pool!, config, sink.delivery, form);
    const firstSecret = secretFromMessage(sink.messages[0]!.text);
    // Retry the same unverified form: same pending row, rotated code.
    await startPasswordRegistration(pool!, config, sink.delivery, form);
    const secondSecret = secretFromMessage(sink.messages[1]!.text);
    expect(secondSecret).not.toBe(firstSecret);
    const rejectedFirst = await confirmPasswordRegistration(pool!, config, {
      verification_secret: firstSecret,
      client_label: "web",
    }).then(
      () => "resolved",
      (error: unknown) => error,
    );
    expect(rejectedFirst).toMatchObject({ code: "VERIFICATION_INVALID" });
    const session = await confirmPasswordRegistration(pool!, config, {
      verification_secret: secondSecret,
      client_label: "web",
    });
    expect(session.user.email).toBe(email);

    // A different password is a separate pending request and cannot inherit.
    const otherSink = createMemoryMailSink();
    const email2 = `resend2-${randomUUID().slice(0, 8)}@example.test`;
    await startPasswordRegistration(pool!, config, otherSink.delivery, {
      username: `resend2${randomUUID().slice(0, 8)}`,
      email: email2,
      display_name: "Resend Two",
      password: "quiet-context-1",
      client_label: "web",
    });
    await startPasswordRegistration(pool!, config, otherSink.delivery, {
      username: `resend2${randomUUID().slice(0, 8)}`,
      email: email2,
      display_name: "Resend Two",
      password: "different-password-2",
      client_label: "web",
    });
    expect(otherSink.messages).toHaveLength(2);
    const pendingPasswords = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pending_password_registrations
       WHERE normalized_email = $1 AND consumed_at IS NULL`,
      [email2],
    );
    expect(Number(pendingPasswords.rows[0]!.count)).toBe(2);
  });

  it("cleans up the pending challenge when delivery fails and fails honestly", async () => {
    const sink = createMemoryMailSink();
    sink.failNextSend(
      new ApiError(
        503,
        "EMAIL_DELIVERY_UNAVAILABLE",
        "Verification email delivery is temporarily unavailable.",
      ),
    );
    const email = `fail-${randomUUID().slice(0, 8)}@example.test`;
    await expect(
      startPasswordRegistration(pool!, config, sink.delivery, {
        username: `fail${randomUUID().slice(0, 8)}`,
        email,
        display_name: "Failure",
        password: "quiet-context-1",
        client_label: "web",
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/EMAIL_DELIVERY/) });
    const pending = await pool!.query(
      `SELECT 1 FROM pending_password_registrations WHERE normalized_email = $1`,
      [email],
    );
    expect(pending.rowCount).toBe(0);
  });

  it("expires challenges atomically and never reserves the email while pending", async () => {
    const sink = createMemoryMailSink();
    const email = `expire-${randomUUID().slice(0, 8)}@example.test`;
    await startPasswordRegistration(pool!, config, sink.delivery, {
      username: `expire${randomUUID().slice(0, 8)}`,
      email,
      display_name: "Expiry",
      password: "quiet-context-1",
      client_label: "web",
    });
    const secret = secretFromMessage(sink.messages[0]!.text);
    // The pending registration must not block a verified provider signup.
    const provider = await createAccount({ email, kind: "google_human" });
    expect(provider.accountId).toBeTruthy();
    await pool!.query(
      `UPDATE pending_password_registrations SET expires_at = now() - interval '1 minute'
       WHERE normalized_email = $1`,
      [email],
    );
    await expect(
      confirmPasswordRegistration(pool!, config, {
        verification_secret: secret,
        client_label: "web",
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_INVALID" });
    const passwords = await pool!.query(
      `SELECT 1 FROM password_credentials WHERE account_id = $1`,
      [provider.accountId],
    );
    expect(passwords.rowCount).toBe(0);
  });

  it("gives a concurrently verified duplicate to one owner and never inherits the loser password", async () => {
    const sink = createMemoryMailSink();
    const email = `dupe-${randomUUID().slice(0, 8)}@example.test`;
    await startPasswordRegistration(pool!, config, sink.delivery, {
      username: `dupe1${randomUUID().slice(0, 8)}`,
      email,
      display_name: "First",
      password: "quiet-context-1",
      client_label: "web",
    });
    await startPasswordRegistration(pool!, config, sink.delivery, {
      username: `dupe2${randomUUID().slice(0, 8)}`,
      email,
      display_name: "Second",
      password: "quiet-context-2",
      client_label: "web",
    });
    const secrets = sink.messages.map((message) => secretFromMessage(message.text));
    const session = await confirmPasswordRegistration(pool!, config, {
      verification_secret: secrets[0]!,
      client_label: "web",
    });
    await expect(
      confirmPasswordRegistration(pool!, config, {
        verification_secret: secrets[1]!,
        client_label: "web",
      }),
    ).rejects.toMatchObject({ code: "PASSWORD_ACCOUNT_EXISTS" });
    const credentials = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM password_credentials pc
       JOIN users u ON u.account_id = pc.account_id AND u.id = pc.user_id
       WHERE lower(btrim(u.email)) = $1`,
      [email],
    );
    expect(credentials.rows[0]!.count).toBe("1");
    const winner = await passwordHashFor(session.account.id, session.user.id);
    expect(winner).toContain("scrypt$v1$");
  });
});

describe.skipIf(!pool)("step-up bound credential changes (PostgreSQL)", () => {
  it("persists failed password step-up and locks out without minting an attempt", async () => {
    const account = await createAccount({
      email: `stepup-${randomUUID().slice(0, 8)}@example.test`,
      password: "quiet-context-1",
    });
    const { auth } = await sessionFor(account.accountId, account.userId, "web");
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expect(
        startCredentialChange(
          pool!,
          config,
          auth,
          {
            id: randomUUID(),
            intent: "set_password",
            origin: "ignored",
            client_label: "web",
            step_up: { kind: "password", password: "wrong-password" },
          },
          "https://web.test",
          deps,
        ),
      ).rejects.toMatchObject({ code: "STEP_UP_FAILED" });
    }
    const credential = await pool!.query<{ failed_attempts: number; locked_until: Date | null }>(
      `SELECT failed_attempts, locked_until FROM password_credentials
       WHERE account_id = $1 AND user_id = $2`,
      [account.accountId, account.userId],
    );
    expect(credential.rows[0]!.failed_attempts).toBe(6);
    expect(credential.rows[0]!.locked_until).not.toBeNull();
    const attempts = await pool!.query(
      `SELECT 1 FROM credential_change_attempts WHERE account_id = $1`,
      [account.accountId],
    );
    expect(attempts.rowCount).toBe(0);
  });

  it("returns the attempt secret once and links the same account and user", async () => {
    const account = await createAccount({
      email: `link-${randomUUID().slice(0, 8)}@example.test`,
      password: "quiet-context-1",
    });
    const { auth } = await sessionFor(account.accountId, account.userId, "web");
    const started = await startCredentialChange(
      pool!,
      config,
      auth,
      {
        id: randomUUID(),
        intent: "link_provider",
        provider: "google",
        origin: "ignored",
        client_label: "web",
        step_up: { kind: "password", password: "quiet-context-1" },
      },
      "https://web.test",
      deps,
    );
    expect(started.attempt_secret.length).toBeGreaterThanOrEqual(32);
    expect(started.provider_challenge).not.toBeNull();
    const challenge = started.provider_challenge!;
    const result = await completeCredentialChange(
      pool!,
      config,
      auth,
      {
        attempt_id: started.attempt_id,
        attempt_secret: started.attempt_secret,
        origin: "ignored",
        identity_token: googleToken(`google-subject-1-${RUN}`, `linked-${RUN}@example.test`, sha256(challenge.nonce)),
      },
      "https://web.test",
      deps,
    );
    expect(result.status).toBe("linked");
    expect(result.settings.user.id).toBe(account.userId);
    expect(result.settings.sign_in_methods.find((method) => method.provider === "google")?.state).toBe("connected");

    // Every linked login resolves to the same accountId AND userId.
    const loginChallenge = await createGoogleChallenge(pool!, config, "web");
    const googleLogin = await createGoogleSession(
      pool!,
      config,
      {
        challenge_id: loginChallenge.challenge_id,
        identity_token: googleToken(`google-subject-1-${RUN}`, `linked-${RUN}@example.test`, sha256(loginChallenge.nonce)),
        client_label: "web",
      },
      fakeGoogleVerifier,
    );
    expect(googleLogin.account.id).toBe(account.accountId);
    expect(googleLogin.user.id).toBe(account.userId);
    const linked = await pool!.query<{ account_id: string; user_id: string }>(
      `SELECT account_id, user_id FROM auth_identities
       WHERE provider = 'google' AND subject_hash = $1`,
      [sha256(`https://accounts.google.com:google-subject-1-${RUN}`)],
    );
    expect(linked.rows[0]).toEqual({
      account_id: account.accountId,
      user_id: account.userId,
    });
  });

  it("is idempotent for the same subject and rejects a second subject for one provider", async () => {
    const account = await createAccount({
      email: `idem-${randomUUID().slice(0, 8)}@example.test`,
      password: "quiet-context-1",
    });
    const { auth } = await sessionFor(account.accountId, account.userId, "web");
    const link = async (subject: string) => {
      const started = await startCredentialChange(
        pool!,
        config,
        auth,
        {
          id: randomUUID(),
          intent: "link_provider",
          provider: "google",
          origin: "ignored",
          client_label: "web",
          step_up: { kind: "password", password: "quiet-context-1" },
        },
        "https://web.test",
        deps,
      );
      return completeCredentialChange(
        pool!,
        config,
        auth,
        {
          attempt_id: started.attempt_id,
          attempt_secret: started.attempt_secret,
          origin: "ignored",
          identity_token: googleToken(subject, `${subject}@example.test`, sha256(started.provider_challenge!.nonce)),
        },
        "https://web.test",
        deps,
      );
    };
    expect((await link(`google-subject-a-${RUN}`)).status).toBe("linked");
    expect((await link(`google-subject-a-${RUN}`)).status).toBe("already_linked");
    await expect(link(`google-subject-b-${RUN}`)).rejects.toMatchObject({
      code: "LOGIN_METHOD_CONFLICT",
    });
  });

  it("never grants access from an email match: conflicting provider email is rejected", async () => {
    const owner = await createAccount({
      email: `owner-${randomUUID().slice(0, 8)}@example.test`,
      password: "quiet-context-1",
    });
    const other = await createAccount({
      email: `other-${randomUUID().slice(0, 8)}@example.test`,
      password: "quiet-context-1",
    });
    const { auth } = await sessionFor(other.accountId, other.userId, "web");
    const ownerEmail = (await pool!.query<{ email: string }>(
      `SELECT email FROM users WHERE account_id = $1`,
      [owner.accountId],
    )).rows[0]!.email;
    const started = await startCredentialChange(
      pool!,
      config,
      auth,
      {
        id: randomUUID(),
        intent: "link_provider",
        provider: "apple",
        origin: "ignored",
        client_label: "web",
        step_up: { kind: "password", password: "quiet-context-1" },
      },
      "https://web.test",
      deps,
    );
    await expect(
      completeCredentialChange(
        pool!,
        config,
        auth,
        {
          attempt_id: started.attempt_id,
          attempt_secret: started.attempt_secret,
          origin: "ignored",
          identity_token: appleToken(
            `apple-subject-foreign-${RUN}`,
            sha256(started.provider_challenge!.nonce),
            ownerEmail,
            "true",
          ),
        },
        "https://web.test",
        deps,
      ),
    ).rejects.toMatchObject({ code: "LOGIN_METHOD_EMAIL_CONFLICT" });
    const linked = await pool!.query(
      `SELECT 1 FROM auth_identities WHERE account_id = $1`,
      [other.accountId],
    );
    expect(linked.rowCount).toBe(0);
  });

  it("protects the last login method, including historical multiplicity", async () => {
    // Historical shape: two Google subjects on one user, no password.
    const account = await createAccount({
      email: `multi-${randomUUID().slice(0, 8)}@example.test`,
      kind: "google_human",
    });
    for (const subject of [`legacy-google-1-${RUN}`, `legacy-google-2-${RUN}`]) {
      await pool!.query(
        `INSERT INTO auth_identities(id, account_id, user_id, provider, subject_hash)
         VALUES ($1, $2, $3, 'google', $4)`,
        [randomUUID(), account.accountId, account.userId, sha256(`https://accounts.google.com:${subject}`)],
      );
    }
    const { auth } = await sessionFor(account.accountId, account.userId, "web");
    const challenge = await createGoogleChallenge(pool!, config, "web");
    const retried = await startCredentialChange(
      pool!,
      config,
      auth,
      {
        id: randomUUID(),
        intent: "unlink_provider",
        provider: "google",
        origin: "ignored",
        client_label: "web",
        step_up: {
          kind: "provider",
          provider: "google",
          challenge_id: challenge.challenge_id,
          identity_token: googleToken(`legacy-google-1-${RUN}`, "multi@example.test", sha256(challenge.nonce)),
        },
      },
      "https://web.test",
      deps,
    );
    await expect(
      completeCredentialChange(
        pool!,
        config,
        auth,
        {
          attempt_id: retried.attempt_id,
          attempt_secret: retried.attempt_secret,
          origin: "ignored",
        },
        "https://web.test",
        deps,
      ),
    ).rejects.toMatchObject({ code: "LAST_LOGIN_METHOD" });
    const remaining = await pool!.query(
      `SELECT 1 FROM auth_identities WHERE account_id = $1`,
      [account.accountId],
    );
    expect(remaining.rowCount).toBe(2);
  });

  it("rejects replayed, cross-session, and wrong-origin completions", async () => {
    const account = await createAccount({
      email: `replay-${randomUUID().slice(0, 8)}@example.test`,
      password: "quiet-context-1",
    });
    const { auth } = await sessionFor(account.accountId, account.userId, "web");
    const other = await sessionFor(account.accountId, account.userId, "ios");
    const started = await startCredentialChange(
      pool!,
      config,
      auth,
      {
        id: randomUUID(),
        intent: "set_password",
        origin: "ignored",
        client_label: "web",
        step_up: { kind: "password", password: "quiet-context-1" },
      },
      "https://web.test",
      deps,
    );
    const completion = {
      attempt_id: started.attempt_id,
      attempt_secret: started.attempt_secret,
      origin: "ignored",
      password: "quiet-context-2",
    };
    await expect(
      completeCredentialChange(pool!, config, other.auth, completion, "https://web.test", deps),
    ).rejects.toMatchObject({ code: "CREDENTIAL_ATTEMPT_INVALID" });
    await expect(
      completeCredentialChange(pool!, config, auth, completion, "https://evil.test", deps),
    ).rejects.toMatchObject({ code: "CREDENTIAL_ATTEMPT_INVALID" });
    const ok = await completeCredentialChange(pool!, config, auth, completion, "https://web.test", deps);
    expect(ok.status).toBe("password_set");
    await expect(
      completeCredentialChange(pool!, config, auth, completion, "https://web.test", deps),
    ).rejects.toMatchObject({ code: "CREDENTIAL_ATTEMPT_INVALID" });
  });

  it("requires canonical email ownership before setting a password", async () => {
    const accountA = randomUUID();
    const accountB = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const email = `Conflicted.${randomUUID().slice(0, 8)}@Example.Test`;
    await seedLegacyCollision([
      { email, kind: "google_human", accountId: accountA, userId: userA },
      { email, kind: "password_human", accountId: accountB, userId: userB },
    ]);
    await pool!.query(
      `INSERT INTO password_credentials(account_id, user_id, password_scrypt) VALUES ($1, $2, $3)`,
      [accountB, userB, await encodePasswordCredential("quiet-context-1")],
    );
    await pool!.query(
      `INSERT INTO auth_identities(id, account_id, user_id, provider, subject_hash)
       VALUES ($1, $2, $3, 'google', $4)`,
      [randomUUID(), accountA, userA, sha256(`https://accounts.google.com:conflicted-google-${RUN}`)],
    );
    const { auth } = await sessionFor(accountA, userA, "web");
    const challenge = await createGoogleChallenge(pool!, config, "web");
    const started = await startCredentialChange(
      pool!,
      config,
      auth,
      {
        id: randomUUID(),
        intent: "set_password",
        origin: "ignored",
        client_label: "web",
        step_up: {
          kind: "provider",
          provider: "google",
          challenge_id: challenge.challenge_id,
          identity_token: googleToken(`conflicted-google-${RUN}`, email, sha256(challenge.nonce)),
        },
      },
      "https://web.test",
      deps,
    );
    await expect(
      completeCredentialChange(
        pool!,
        config,
        auth,
        {
          attempt_id: started.attempt_id,
          attempt_secret: started.attempt_secret,
          origin: "ignored",
          password: "quiet-context-9",
        },
        "https://web.test",
        deps,
      ),
    ).rejects.toMatchObject({ code: "EMAIL_OWNERSHIP_UNRESOLVED" });
    expect(await passwordHashFor(accountA, userA)).toBeNull();
  });

  it("fails closed on ambiguous legacy duplicates and keeps unambiguous logins working", async () => {
    const accountA = randomUUID();
    const accountB = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const email = `Ambiguous.${randomUUID().slice(0, 8)}@Example.Test`;
    const usernameB = `amb-b-${randomUUID().slice(0, 8)}`;
    await seedLegacyCollision([
      { email, kind: "google_human", accountId: accountA, userId: userA },
      { email, kind: "password_human", accountId: accountB, userId: userB },
    ]);
    for (const [accountId, userId] of [
      [accountA, userA],
      [accountB, userB],
    ] as const) {
      await pool!.query(
        `INSERT INTO password_credentials(account_id, user_id, password_scrypt) VALUES ($1, $2, $3)`,
        [accountId, userId, await encodePasswordCredential("quiet-context-1")],
      );
    }
    await pool!.query(`UPDATE users SET username = $2 WHERE id = $1`, [userB, usernameB]);
    await expect(
      createPasswordSession(pool!, config, {
        identifier: email.toLowerCase(),
        password: "quiet-context-1",
        client_label: "web",
      }),
    ).rejects.toMatchObject({ code: "PASSWORD_SIGN_IN_AMBIGUOUS" });
    const session = await createPasswordSession(pool!, config, {
      identifier: usernameB,
      password: "quiet-context-1",
      client_label: "web",
    });
    expect(session.user.id).toBe(userB);
  });
});

type DuplicateShape = {
  canonical: { accountId: string; userId: string };
  duplicate: { accountId: string; userId: string };
  canonicalAuth: SessionResponseLike;
  duplicatePassword: string;
  canonicalPassword: string;
};

async function seedDuplicateShape(prefix: string): Promise<DuplicateShape> {
  const canonicalAccount = randomUUID();
  const canonicalUser = randomUUID();
  const duplicateAccount = randomUUID();
  const duplicateUser = randomUUID();
  const email = `${prefix}@example.test`;
  const canonicalPassword = "canonical-context-1";
  const duplicatePassword = "duplicate-context-1";
  await seedLegacyCollision([
    { email, kind: "password_human", accountId: canonicalAccount, userId: canonicalUser },
    { email, kind: "google_human", accountId: duplicateAccount, userId: duplicateUser },
  ]);
  await pool!.query(`UPDATE users SET username = $2 WHERE id = $1`, [canonicalUser, `${prefix}-canonical`]);
  await pool!.query(`UPDATE users SET username = $2 WHERE id = $1`, [duplicateUser, `${prefix}-duplicate`]);
  await pool!.query(
    `INSERT INTO password_credentials(account_id, user_id, password_scrypt) VALUES ($1, $2, $3), ($4, $5, $6)`,
    [
      canonicalAccount,
      canonicalUser,
      await encodePasswordCredential(canonicalPassword),
      duplicateAccount,
      duplicateUser,
      await encodePasswordCredential(duplicatePassword),
    ],
  );
  const { auth } = await sessionFor(canonicalAccount, canonicalUser, "web");
  return {
    canonical: { accountId: canonicalAccount, userId: canonicalUser },
    duplicate: { accountId: duplicateAccount, userId: duplicateUser },
    canonicalAuth: auth,
    duplicatePassword,
    canonicalPassword,
  };
}

describe.skipIf(!pool)("reviewed duplicate resolution (PostgreSQL)", () => {
  it("transfers an entirely empty duplicate with dual proof and retires it", async () => {
    const shape = await seedDuplicateShape(`empty${randomUUID().slice(0, 6)}`);
    const duplicateSession = await sessionFor(
      shape.duplicate.accountId,
      shape.duplicate.userId,
      "ios",
    );
    const id = randomUUID();
    const prepared = await prepareReconciliation(pool!, config, shape.canonicalAuth, {
      id,
      proof: {
        kind: "password",
        identifier: (await pool!.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1`,
          [shape.duplicate.userId],
        )).rows[0]!.username!,
        password: shape.duplicatePassword,
      },
      step_up: { kind: "password", password: shape.canonicalPassword },
    });
    expect(prepared.kind).toBe("empty_duplicate_transfer");
    expect(prepared.state).toBe("prepared");
    expect(prepared.inventory).toMatchObject({ entirely_empty: true });
    const readback = await readReconciliation(pool!, shape.canonicalAuth, id);
    expect(readback.id).toBe(id);

    const committed = await confirmReconciliation(pool!, config, shape.canonicalAuth, { id });
    expect(committed.state).toBe("committed");
    const sourceAccount = await pool!.query<{ retired_at: Date | null }>(
      `SELECT retired_at FROM accounts WHERE id = $1`,
      [shape.duplicate.accountId],
    );
    expect(sourceAccount.rows[0]!.retired_at).not.toBeNull();
    const sourceUser = await pool!.query<{ status: string }>(
      `SELECT status FROM users WHERE id = $1`,
      [shape.duplicate.userId],
    );
    expect(sourceUser.rows[0]!.status).toBe("revoked");
    const revoked = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sessions
       WHERE account_id = $1 AND revoked_at IS NULL`,
      [shape.duplicate.accountId],
    );
    expect(revoked.rows[0]!.count).toBe("0");
    // The redundant login moved to the explicitly selected canonical user.
    const moved = await pool!.query<{ account_id: string; user_id: string }>(
      `SELECT account_id, user_id FROM password_credentials WHERE user_id = $1`,
      [shape.canonical.userId],
    );
    expect(moved.rows).toHaveLength(1);
    const aliases = await pool!.query<{ provider: string }>(
      `SELECT provider FROM retired_login_aliases WHERE account_id = $1`,
      [shape.duplicate.accountId],
    );
    expect(aliases.rows.map((row) => row.provider)).toContain("password");
    const reservation = await readEmailReservation(
      pool!,
      (await pool!.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [shape.duplicate.userId])).rows[0]!.email,
    );
    expect(reservation?.state).toBe("owned");
    expect(reservation?.user_id).toBe(shape.canonical.userId);
    // The duplicate's old device session cannot write after transfer.
    await expect(
      assertAccountActive(pool!, shape.duplicate.accountId),
    ).rejects.toMatchObject({ code: "ACCOUNT_RETIRED" });
    // Direct MCP writers admitted before retirement cannot add records to the
    // retired source. The BEFORE guard must reject before column constraints,
    // so this probe cannot accidentally persist a partial tool or OAuth row.
    for (const table of [
      "mcp_interaction_requests", "mcp_tool_calls", "mcp_oauth_connect_requests",
      "mcp_continuation_outbox", "mcp_oauth_cleanup", "mcp_oauth_cleanup_effects",
    ]) {
      await expect(pool!.query(
        `INSERT INTO ${table}(account_id) VALUES ($1)`,
        [shape.duplicate.accountId],
      )).rejects.toMatchObject({ message: "ACCOUNT_RETIRED" });
      const lateRows = await pool!.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${table} WHERE account_id = $1`,
        [shape.duplicate.accountId],
      );
      expect(lateRows.rows[0]!.count).toBe("0");
    }
    void duplicateSession;

    // Idempotent readback.
    const replay = await confirmReconciliation(pool!, config, shape.canonicalAuth, { id });
    expect(replay.state).toBe("committed");
  });

  it("keeps non-empty duplicates review-required with their inventory", async () => {
    const shape = await seedDuplicateShape(`nonempty${randomUUID().slice(0, 6)}`);
    await pool!.query(
      `INSERT INTO subjects(id, account_id, external_ref, display_label, status)
       VALUES ($1, $2, 'fixture-person', 'Governed person', 'active')`,
      [randomUUID(), shape.duplicate.accountId],
    );
    const id = randomUUID();
    const prepared = await prepareReconciliation(pool!, config, shape.canonicalAuth, {
      id,
      proof: {
        kind: "password",
        identifier: (await pool!.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1`,
          [shape.duplicate.userId],
        )).rows[0]!.username!,
        password: shape.duplicatePassword,
      },
      step_up: { kind: "password", password: shape.canonicalPassword },
    });
    expect(prepared.kind).toBe("review_required");
    expect((prepared.inventory as { problems: string[] }).problems).toContainEqual(
      expect.stringMatching(/^product_rows:subjects:/),
    );
    await expect(
      confirmReconciliation(pool!, config, shape.canonicalAuth, { id }),
    ).rejects.toMatchObject({ code: "RECONCILIATION_REVIEW_REQUIRED" });
    const sourceAccount = await pool!.query<{ retired_at: Date | null }>(
      `SELECT retired_at FROM accounts WHERE id = $1`,
      [shape.duplicate.accountId],
    );
    expect(sourceAccount.rows[0]!.retired_at).toBeNull();
    const aliases = await pool!.query(
      `SELECT 1 FROM retired_login_aliases WHERE account_id = $1`,
      [shape.duplicate.accountId],
    );
    expect(aliases.rowCount).toBe(0);
  });

  it("sees deleted Lab workspace history and nonzero generations as history", async () => {
    const shape = await seedDuplicateShape(`history${randomUUID().slice(0, 6)}`);
    // A deleted Lab workspace whose target still retains a user.
    const targetAccount = await createAccount({
      email: `target-${randomUUID().slice(0, 8)}@example.test`,
      password: "quiet-context-1",
    });
    await pool!.query(
      `INSERT INTO lab_test_workspaces(
         id, owner_account_id, owner_user_id, target_account_id, target_user_id,
         duration_hours, expires_at, state, stop_id, stopped_at, deleted_at,
         media_scope_hash
       ) VALUES ($1, $2, $3, $4, $5, 1, now() - interval '1 day', 'deleted',
         $6, now() - interval '1 day', now() - interval '1 day', $7)`,
      [
        randomUUID(),
        shape.duplicate.accountId,
        shape.duplicate.userId,
        targetAccount.accountId,
        targetAccount.userId,
        randomUUID(),
        sha256("fixture-media-scope"),
      ],
    );
    const inventory = await classifyAccountDataInventory(
      pool!,
      shape.duplicate.accountId,
      shape.duplicate.userId,
    );
    expect(inventory.entirely_empty).toBe(false);
    expect(inventory.problems).toContain("lab_workspace_history");
    expect(inventory.problems).toContainEqual(
      expect.stringMatching(/^indirect_ownership:lab_test_workspaces\./),
    );
    expect(inventory.lab_workspace_links[0]!.rows).toBe(1);

    // A bumped harness generation is real history, not a baseline row.
    const generationShape = await seedDuplicateShape(`gen${randomUUID().slice(0, 6)}`);
    await pool!.query(
      `UPDATE harness_source_generations SET generation = 1 WHERE account_id = $1`,
      [generationShape.duplicate.accountId],
    );
    const generationInventory = await classifyAccountDataInventory(
      pool!,
      generationShape.duplicate.accountId,
      generationShape.duplicate.userId,
    );
    expect(generationInventory.entirely_empty).toBe(false);
    expect(generationInventory.problems).toContainEqual(
      expect.stringMatching(/^system_baseline_invalid:harness_source_generations:/),
    );
  });

  it("cancels a prepared reconciliation without effects", async () => {
    const shape = await seedDuplicateShape(`cancel${randomUUID().slice(0, 6)}`);
    const id = randomUUID();
    await prepareReconciliation(pool!, config, shape.canonicalAuth, {
      id,
      proof: {
        kind: "password",
        identifier: (await pool!.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1`,
          [shape.duplicate.userId],
        )).rows[0]!.username!,
        password: shape.duplicatePassword,
      },
      step_up: { kind: "password", password: shape.canonicalPassword },
    });
    const cancelled = await cancelReconciliation(pool!, shape.canonicalAuth, { id });
    expect(cancelled.state).toBe("cancelled");
    await expect(
      confirmReconciliation(pool!, config, shape.canonicalAuth, { id }),
    ).rejects.toMatchObject({ code: "RECONCILIATION_NOT_PENDING" });
  });

  it("fences an admitted late write: ACCOUNT_RETIRED and zero added records", async () => {
    const shape = await seedDuplicateShape(`late${randomUUID().slice(0, 6)}`);
    const id = randomUUID();
    await prepareReconciliation(pool!, config, shape.canonicalAuth, {
      id,
      proof: {
        kind: "password",
        identifier: (await pool!.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1`,
          [shape.duplicate.userId],
        )).rows[0]!.username!,
        password: shape.duplicatePassword,
      },
      step_up: { kind: "password", password: shape.canonicalPassword },
    });

    // Client A was admitted (session exists) and pauses before its governed
    // Person write; B completes the reviewed transfer in between.
    const admitted = await sessionFor(shape.duplicate.accountId, shape.duplicate.userId, "ios");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lateWrite = (async () => {
      await gate;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await assertAccountActive(client, shape.duplicate.accountId);
        await client.query(
          `INSERT INTO subjects(id, account_id, external_ref, display_label, status)
           VALUES ($1, $2, 'late-person', 'Late person', 'active')`,
          [randomUUID(), shape.duplicate.accountId],
        );
        await client.query("COMMIT");
        return "written";
      } catch (error) {
        await client.query("ROLLBACK");
        return error;
      } finally {
        client.release();
      }
    })();
    const committed = await confirmReconciliation(pool!, config, shape.canonicalAuth, { id });
    expect(committed.state).toBe("committed");
    release();
    const outcome = await lateWrite;
    expect(outcome).toMatchObject({ code: "ACCOUNT_RETIRED" });
    void admitted;

    const sourceSubjects = await pool!.query(
      `SELECT 1 FROM subjects WHERE account_id = $1`,
      [shape.duplicate.accountId],
    );
    const canonicalSubjects = await pool!.query(
      `SELECT 1 FROM subjects WHERE account_id = $1`,
      [shape.canonical.accountId],
    );
    expect(sourceSubjects.rowCount).toBe(0);
    expect(canonicalSubjects.rowCount).toBe(0);
    const receipts = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM account_reconciliation_requests
       WHERE account_id = $1 AND state = 'committed'`,
      [shape.canonical.accountId],
    );
    expect(receipts.rows[0]!.count).toBe("1");
    const transfers = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM retired_login_aliases WHERE account_id = $1`,
      [shape.duplicate.accountId],
    );
    expect(Number(transfers.rows[0]!.count)).toBeGreaterThanOrEqual(1);
  });

  it("refuses transfer when a first write commits before reconciliation locks", async () => {
    const shape = await seedDuplicateShape(`first${randomUUID().slice(0, 6)}`);
    const id = randomUUID();
    await prepareReconciliation(pool!, config, shape.canonicalAuth, {
      id,
      proof: {
        kind: "password",
        identifier: (await pool!.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1`,
          [shape.duplicate.userId],
        )).rows[0]!.username!,
        password: shape.duplicatePassword,
      },
      step_up: { kind: "password", password: shape.canonicalPassword },
    });

    // Client A acquires the shared account fence and holds its Person write
    // open; reconciliation must wait, then see the committed record.
    const writer = await pool!.connect();
    await writer.query("BEGIN");
    await assertAccountActive(writer, shape.duplicate.accountId);
    await writer.query(
      `INSERT INTO subjects(id, account_id, external_ref, display_label, status)
       VALUES ($1, $2, 'first-person', 'First person', 'active')`,
      [randomUUID(), shape.duplicate.accountId],
    );
    const reconciliation = confirmReconciliation(pool!, config, shape.canonicalAuth, { id });
    const refusal = reconciliation.catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await writer.query("COMMIT");
    writer.release();
    const outcome = await refusal;
    expect(outcome).toMatchObject({ code: "RECONCILIATION_NOT_EMPTY" });
    const sourceAccount = await pool!.query<{ retired_at: Date | null }>(
      `SELECT retired_at FROM accounts WHERE id = $1`,
      [shape.duplicate.accountId],
    );
    expect(sourceAccount.rows[0]!.retired_at).toBeNull();
    const aliases = await pool!.query(
      `SELECT 1 FROM retired_login_aliases WHERE account_id = $1`,
      [shape.duplicate.accountId],
    );
    expect(aliases.rowCount).toBe(0);
  });
});

describe.skipIf(!pool)("dual proof freshness and attempt binding (PostgreSQL)", () => {
  it("binds the attempt to the exact state its proof checked, even under a rival change", async () => {
    const account = await createAccount({
      email: `gap-${randomUUID().slice(0, 8)}@example.test`,
      password: "quiet-context-1",
    });
    const { auth } = await sessionFor(account.accountId, account.userId, "web");
    // A rival credential change holds the user row while the step-up proof is
    // in flight. The old proof must never mint an attempt afterwards.
    const rival = await pool!.connect();
    await rival.query("BEGIN");
    await rival.query(
      `SELECT id FROM users WHERE account_id = $1 AND id = $2 FOR UPDATE`,
      [account.accountId, account.userId],
    );
    const inFlight = startCredentialChange(
      pool!,
      config,
      auth,
      {
        id: randomUUID(),
        intent: "set_password",
        origin: "ignored",
        client_label: "web",
        step_up: { kind: "password", password: "quiet-context-1" },
      },
      "https://web.test",
      deps,
    ).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await rival.query(
      `DELETE FROM password_credentials WHERE account_id = $1 AND user_id = $2`,
      [account.accountId, account.userId],
    );
    await rival.query("COMMIT");
    rival.release();
    const outcome = await inFlight;
    expect(outcome).toMatchObject({ code: "STEP_UP_FAILED" });
    const attempts = await pool!.query(
      `SELECT 1 FROM credential_change_attempts WHERE account_id = $1`,
      [account.accountId],
    );
    expect(attempts.rowCount).toBe(0);
  });

  it("refuses transfer after the source's proven password is removed", async () => {
    const shape = await seedDuplicateShape(`stalesrc${randomUUID().slice(0, 6)}`);
    // The duplicate keeps a second method so the password can be removed
    // through the real credential-change API, not SQL.
    await pool!.query(
      `INSERT INTO auth_identities(id, account_id, user_id, provider, subject_hash)
       VALUES ($1, $2, $3, 'google', $4)`,
      [
        randomUUID(),
        shape.duplicate.accountId,
        shape.duplicate.userId,
        sha256(`https://accounts.google.com:stale-src-${RUN}`),
      ],
    );
    const id = randomUUID();
    await prepareReconciliation(pool!, config, shape.canonicalAuth, {
      id,
      proof: {
        kind: "password",
        identifier: (await pool!.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1`,
          [shape.duplicate.userId],
        )).rows[0]!.username!,
        password: shape.duplicatePassword,
      },
      step_up: { kind: "password", password: shape.canonicalPassword },
    });

    const duplicateAuth = (
      await sessionFor(shape.duplicate.accountId, shape.duplicate.userId, "ios")
    ).auth;
    const unlink = await startCredentialChange(
      pool!,
      config,
      duplicateAuth,
      {
        id: randomUUID(),
        intent: "unlink_provider",
        provider: "password",
        origin: "ignored",
        client_label: "ios",
        step_up: { kind: "password", password: shape.duplicatePassword },
      },
      "client:ios",
      deps,
    );
    await completeCredentialChange(
      pool!,
      config,
      duplicateAuth,
      {
        attempt_id: unlink.attempt_id,
        attempt_secret: unlink.attempt_secret,
        origin: "ignored",
      },
      "client:ios",
      deps,
    );
    await expect(
      confirmReconciliation(pool!, config, shape.canonicalAuth, { id }),
    ).rejects.toMatchObject({ code: "RECONCILIATION_PROOF_STALE" });
    const sourceAccount = await pool!.query<{ retired_at: Date | null }>(
      `SELECT retired_at FROM accounts WHERE id = $1`,
      [shape.duplicate.accountId],
    );
    expect(sourceAccount.rows[0]!.retired_at).toBeNull();
    const aliases = await pool!.query(
      `SELECT 1 FROM retired_login_aliases WHERE account_id = $1`,
      [shape.duplicate.accountId],
    );
    expect(aliases.rowCount).toBe(0);
  });

  it("refuses transfer after the canonical password is removed", async () => {
    const shape = await seedDuplicateShape(`stalecanon${randomUUID().slice(0, 6)}`);
    await pool!.query(
      `INSERT INTO auth_identities(id, account_id, user_id, provider, subject_hash)
       VALUES ($1, $2, $3, 'google', $4)`,
      [
        randomUUID(),
        shape.canonical.accountId,
        shape.canonical.userId,
        sha256(`https://accounts.google.com:stale-canon-${RUN}`),
      ],
    );
    const id = randomUUID();
    await prepareReconciliation(pool!, config, shape.canonicalAuth, {
      id,
      proof: {
        kind: "password",
        identifier: (await pool!.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1`,
          [shape.duplicate.userId],
        )).rows[0]!.username!,
        password: shape.duplicatePassword,
      },
      step_up: { kind: "password", password: shape.canonicalPassword },
    });
    const unlink = await startCredentialChange(
      pool!,
      config,
      shape.canonicalAuth,
      {
        id: randomUUID(),
        intent: "unlink_provider",
        provider: "password",
        origin: "ignored",
        client_label: "web",
        step_up: { kind: "password", password: shape.canonicalPassword },
      },
      "https://web.test",
      deps,
    );
    await completeCredentialChange(
      pool!,
      config,
      shape.canonicalAuth,
      {
        attempt_id: unlink.attempt_id,
        attempt_secret: unlink.attempt_secret,
        origin: "ignored",
      },
      "https://web.test",
      deps,
    );
    await expect(
      confirmReconciliation(pool!, config, shape.canonicalAuth, { id }),
    ).rejects.toMatchObject({ code: "RECONCILIATION_PROOF_STALE" });
    const sourceAccount = await pool!.query<{ retired_at: Date | null }>(
      `SELECT retired_at FROM accounts WHERE id = $1`,
      [shape.duplicate.accountId],
    );
    expect(sourceAccount.rows[0]!.retired_at).toBeNull();
  });

  it("refuses transfer from an admitted context after its session is revoked", async () => {
    const shape = await seedDuplicateShape(`revoked${randomUUID().slice(0, 6)}`);
    const id = randomUUID();
    await prepareReconciliation(pool!, config, shape.canonicalAuth, {
      id,
      proof: {
        kind: "password",
        identifier: (await pool!.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1`,
          [shape.duplicate.userId],
        )).rows[0]!.username!,
        password: shape.duplicatePassword,
      },
      step_up: { kind: "password", password: shape.canonicalPassword },
    });
    // The admitted context survives its revocation, exactly like a request
    // that already passed the HTTP guard.
    await revokeCurrentSession(pool!, shape.canonicalAuth);
    await expect(
      confirmReconciliation(pool!, config, shape.canonicalAuth, { id }),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
    const sourceAccount = await pool!.query<{ retired_at: Date | null }>(
      `SELECT retired_at FROM accounts WHERE id = $1`,
      [shape.duplicate.accountId],
    );
    expect(sourceAccount.rows[0]!.retired_at).toBeNull();
    const moved = await pool!.query(
      `SELECT 1 FROM password_credentials WHERE account_id = $1`,
      [shape.canonical.accountId],
    );
    expect(moved.rowCount).toBe(1);
  });
});

describe.skipIf(!pool)("provider-only accounts (PostgreSQL)", () => {
  it("lets a provider-only account set its first password after provider reauth", async () => {
    const account = await createAccount({
      email: `firstpw-${randomUUID().slice(0, 8)}@example.test`,
      kind: "google_human",
    });
    await pool!.query(
      `INSERT INTO auth_identities(id, account_id, user_id, provider, subject_hash, email_hint)
       VALUES ($1, $2, $3, 'google', $4, $5)`,
      [
        randomUUID(),
        account.accountId,
        account.userId,
        sha256(`https://accounts.google.com:firstpw-${RUN}`),
        `firstpw-${RUN}@example.test`,
      ],
    );
    const { auth } = await sessionFor(account.accountId, account.userId, "web");
    const challenge = await createGoogleChallenge(pool!, config, "web");
    // Current identity is proven with the linked provider; the NEW password is
    // collected after reauthentication and never inherits anything.
    const started = await startCredentialChange(
      pool!,
      config,
      auth,
      {
        id: randomUUID(),
        intent: "set_password",
        origin: "ignored",
        client_label: "web",
        step_up: {
          kind: "provider",
          provider: "google",
          challenge_id: challenge.challenge_id,
          identity_token: googleToken(`firstpw-${RUN}`, `firstpw-${RUN}@example.test`, sha256(challenge.nonce)),
        },
      },
      "https://web.test",
      deps,
    );
    const beforeRevision = (await pool!.query<{ settings_revision: number }>(
      "SELECT settings_revision FROM accounts WHERE id=$1",
      [account.accountId],
    )).rows[0]!.settings_revision;
    const completed = await completeCredentialChange(
      pool!,
      config,
      auth,
      {
        attempt_id: started.attempt_id,
        attempt_secret: started.attempt_secret,
        origin: "ignored",
        password: "brand-new-password",
      },
      "https://web.test",
      deps,
    );
    expect(completed.status).toBe("password_set");
    expect(
      completed.settings.sign_in_methods.find((method) => method.provider === "password")?.state,
    ).toBe("connected");

    // The receipt must describe the committed row, not the context captured
    // before this operation increments the account's settings revision.
    const finalRow = (await pool!.query<{ settings_revision: number }>(
      "SELECT settings_revision FROM accounts WHERE id=$1",
      [account.accountId],
    )).rows[0]!;
    const receipt = await pool!.query<{ revision_before: number; revision_after: number }>(
      `SELECT details->'revision_before' AS revision_before,
              details->'revision_after' AS revision_after
       FROM account_access_events
       WHERE id=$1 AND account_id=$2 AND actor_user_id=$3 AND kind='set_password'`,
      [started.attempt_id, account.accountId, account.userId],
    );
    expect(finalRow.settings_revision).toBe(beforeRevision + 1);
    expect(completed.settings.workspace.revision).toBe(finalRow.settings_revision);
    expect(receipt.rows).toEqual([{
      revision_before: beforeRevision,
      revision_after: finalRow.settings_revision,
    }]);
    const login = await createPasswordSession(pool!, config, {
      identifier: account.accountId && (await pool!.query<{ email: string }>(
        `SELECT email FROM users WHERE id = $1`,
        [account.userId],
      )).rows[0]!.email,
      password: "brand-new-password",
      client_label: "web",
    });
    expect(login.account.id).toBe(account.accountId);
    expect(login.user.id).toBe(account.userId);
  });

  it("lets a provider-only account connect the other provider after provider reauth", async () => {
    const account = await createAccount({
      email: `secondpv-${randomUUID().slice(0, 8)}@example.test`,
      kind: "google_human",
    });
    await pool!.query(
      `INSERT INTO auth_identities(id, account_id, user_id, provider, subject_hash, email_hint)
       VALUES ($1, $2, $3, 'google', $4, $5)`,
      [
        randomUUID(),
        account.accountId,
        account.userId,
        sha256(`https://accounts.google.com:secondpv-${RUN}`),
        `secondpv-${RUN}@example.test`,
      ],
    );
    const { auth } = await sessionFor(account.accountId, account.userId, "web");
    const reauthChallenge = await createGoogleChallenge(pool!, config, "web");
    const started = await startCredentialChange(
      pool!,
      config,
      auth,
      {
        id: randomUUID(),
        intent: "link_provider",
        provider: "apple",
        origin: "ignored",
        client_label: "web",
        step_up: {
          kind: "provider",
          provider: "google",
          challenge_id: reauthChallenge.challenge_id,
          identity_token: googleToken(`secondpv-${RUN}`, `secondpv-${RUN}@example.test`, sha256(reauthChallenge.nonce)),
        },
      },
      "https://web.test",
      deps,
    );
    // The NEW provider proof is a distinct purpose with its own challenge.
    const targetChallenge = started.provider_challenge!;
    const completed = await completeCredentialChange(
      pool!,
      config,
      auth,
      {
        attempt_id: started.attempt_id,
        attempt_secret: started.attempt_secret,
        origin: "ignored",
        identity_token: appleToken(
          `secondpv-apple-${RUN}`,
          sha256(targetChallenge.nonce),
          `secondpv-${RUN}@example.test`,
          "true",
        ),
      },
      "https://web.test",
      deps,
    );
    expect(completed.status).toBe("linked");
    const linked = await pool!.query<{ account_id: string; user_id: string }>(
      `SELECT account_id, user_id FROM auth_identities
       WHERE provider = 'apple' AND subject_hash = $1`,
      [sha256(`https://appleid.apple.com:secondpv-apple-${RUN}`)],
    );
    expect(linked.rows[0]).toEqual({
      account_id: account.accountId,
      user_id: account.userId,
    });
  });
});

describe.skipIf(!pool)("reconciliation boundary races (PostgreSQL)", () => {
  it("cannot rebind an old duplicate proof after its password changed under a lock barrier", async () => {
    const shape = await seedDuplicateShape(`rebind${randomUUID().slice(0, 6)}`);
    const identifier = (await pool!.query<{ username: string }>(
      `SELECT username FROM users WHERE id = $1`,
      [shape.duplicate.userId],
    )).rows[0]!.username!;
    // The rival holds the duplicate's user row while prepare is in flight and
    // commits a real password change before prepare can verify under lock.
    const rival = await pool!.connect();
    await rival.query("BEGIN");
    await rival.query(
      `SELECT id FROM users WHERE account_id = $1 AND id = $2 FOR UPDATE`,
      [shape.duplicate.accountId, shape.duplicate.userId],
    );
    const inFlight = prepareReconciliation(pool!, config, shape.canonicalAuth, {
      id: randomUUID(),
      proof: { kind: "password", identifier, password: shape.duplicatePassword },
      step_up: { kind: "password", password: shape.canonicalPassword },
    }).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await rival.query(
      `UPDATE password_credentials SET password_scrypt = $3
       WHERE account_id = $1 AND user_id = $2`,
      [
        shape.duplicate.accountId,
        shape.duplicate.userId,
        await encodePasswordCredential("changed-after-proof"),
      ],
    );
    await rival.query("COMMIT");
    rival.release();
    const outcome = await inFlight;
    // The old proof must fail against the locked, current credential instead
    // of being rebound to the newer revision freeze.
    expect(outcome).toMatchObject({ code: "RECONCILIATION_PROOF_FAILED" });
    const requests = await pool!.query(
      `SELECT 1 FROM account_reconciliation_requests WHERE account_id = $1`,
      [shape.canonical.accountId],
    );
    expect(requests.rowCount).toBe(0);
  });

  it("lets a session revocation that commits before the account locks win", async () => {
    const shape = await seedDuplicateShape(`revokewins${randomUUID().slice(0, 6)}`);
    const id = randomUUID();
    await prepareReconciliation(pool!, config, shape.canonicalAuth, {
      id,
      proof: {
        kind: "password",
        identifier: (await pool!.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1`,
          [shape.duplicate.userId],
        )).rows[0]!.username!,
        password: shape.duplicatePassword,
      },
      step_up: { kind: "password", password: shape.canonicalPassword },
    });
    // The revoke commits while confirm is blocked before its account locks.
    const rival = await pool!.connect();
    await rival.query("BEGIN");
    await rival.query(`SELECT retired_at FROM accounts WHERE id = $1 FOR UPDATE`, [
      shape.canonical.accountId,
    ]);
    const inFlight = confirmReconciliation(pool!, config, shape.canonicalAuth, {
      id,
    }).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await rival.query(
      `UPDATE sessions SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [shape.canonicalAuth.sessionId],
    );
    await rival.query("COMMIT");
    rival.release();
    const outcome = await inFlight;
    expect(outcome).toMatchObject({ code: "SESSION_INVALID" });
    const sourceAccount = await pool!.query<{ retired_at: Date | null }>(
      `SELECT retired_at FROM accounts WHERE id = $1`,
      [shape.duplicate.accountId],
    );
    expect(sourceAccount.rows[0]!.retired_at).toBeNull();
    const aliases = await pool!.query(
      `SELECT 1 FROM retired_login_aliases WHERE account_id = $1`,
      [shape.duplicate.accountId],
    );
    expect(aliases.rowCount).toBe(0);
  });

  it("invalidates older bound operations when the transfer changes destination credentials", async () => {
    const shape = await seedDuplicateShape(`invalidate${randomUUID().slice(0, 6)}`);
    const id = randomUUID();
    await prepareReconciliation(pool!, config, shape.canonicalAuth, {
      id,
      proof: {
        kind: "password",
        identifier: (await pool!.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1`,
          [shape.duplicate.userId],
        )).rows[0]!.username!,
        password: shape.duplicatePassword,
      },
      step_up: { kind: "password", password: shape.canonicalPassword },
    });
    // A legitimate change-password attempt issued before the transfer.
    const pending = await startCredentialChange(
      pool!,
      config,
      shape.canonicalAuth,
      {
        id: randomUUID(),
        intent: "change_password",
        origin: "ignored",
        client_label: "web",
        step_up: { kind: "password", password: shape.canonicalPassword },
      },
      "https://web.test",
      deps,
    );
    const committed = await confirmReconciliation(pool!, config, shape.canonicalAuth, {
      id,
    });
    expect(committed.state).toBe("committed");
    await expect(
      completeCredentialChange(
        pool!,
        config,
        shape.canonicalAuth,
        {
          attempt_id: pending.attempt_id,
          attempt_secret: pending.attempt_secret,
          origin: "ignored",
          password: "sneaky-after-transfer",
        },
        "https://web.test",
        deps,
      ),
    // The transfer consumes every older bound operation atomically; the stale
    // attempt can never complete against the transferred state.
    ).rejects.toMatchObject({ code: "CREDENTIAL_ATTEMPT_INVALID" });
    const credential = await passwordHashFor(
      shape.canonical.accountId,
      shape.canonical.userId,
    );
    expect(credential).not.toContain("sneaky");
    const canonicalAccount = await pool!.query<{ settings_revision: number }>(
      `SELECT settings_revision FROM accounts WHERE id = $1`,
      [shape.canonical.accountId],
    );
    expect(canonicalAccount.rows[0]!.settings_revision).toBeGreaterThan(1);
  });
});

describe.skipIf(!pool)("authorized revision binding (PostgreSQL)", () => {
  it("refuses to mint an attempt against revisions the caller was not authorized for", async () => {
    const account = await createAccount({
      email: `revbind-${randomUUID().slice(0, 8)}@example.test`,
      password: "quiet-context-1",
    });
    const { auth } = await sessionFor(account.accountId, account.userId, "web");
    const authorized = await revisionsFor(account.accountId, account.userId);
    // A rival session changes settings after the form was rendered.
    const rival = await startCredentialChange(
      pool!,
      config,
      auth,
      {
        id: randomUUID(),
        intent: "set_password",
        origin: "ignored",
        client_label: "ios",
        step_up: { kind: "password", password: "quiet-context-1" },
      },
      "client:ios",
    );
    await completeCredentialChange(
      pool!,
      config,
      auth,
      {
        attempt_id: rival.attempt_id,
        attempt_secret: rival.attempt_secret,
        origin: "ignored",
        password: "quiet-context-2",
      },
      "client:ios",
    );
    // The old authorization (older revisions + old password) must fail
    // transactionally instead of rebinding to the newer state.
    await expect(
      startCredentialChangeRaw(
        pool!,
        config,
        auth,
        {
          id: randomUUID(),
          intent: "unlink_provider",
          provider: "password",
          origin: "ignored",
          client_label: "web",
          step_up: { kind: "password", password: "quiet-context-1" },
          ...authorized,
        },
        "https://web.test",
        deps,
      ),
    ).rejects.toMatchObject({ code: "CREDENTIAL_ATTEMPT_STALE" });
    const credentials = await pool!.query(
      `SELECT 1 FROM password_credentials WHERE account_id = $1`,
      [account.accountId],
    );
    expect(credentials.rowCount).toBe(1);
  });
});

describe.skipIf(!pool)("verified secondary email ownership (PostgreSQL)", () => {
  async function linkGoogleSubject(
    auth: SessionResponseLike,
    subject: string,
    email: string,
    verified: boolean,
    password = "quiet-context-1",
  ): Promise<"linked" | "already_linked"> {
    const started = await startCredentialChange(
      pool!, config, auth,
      {
        id: randomUUID(), intent: "link_provider", provider: "google",
        origin: "ignored", client_label: "web",
        step_up: { kind: "password", password },
      },
      "https://web.test",
    );
    const nonce = sha256(started.provider_challenge!.nonce);
    const token = verified
      ? googleToken(subject, email, nonce)
      : `${subject}|-|${nonce}`;
    const result = await completeCredentialChange(
      pool!, config, auth,
      {
        attempt_id: started.attempt_id,
        attempt_secret: started.attempt_secret,
        origin: "ignored",
        identity_token: token,
      },
      "https://web.test",
      deps,
    );
    return result.status as "linked" | "already_linked";
  }

  async function claimRow(email: string) {
    return (await pool!.query<{
      account_id: string; user_id: string; claim_kind: string;
      verification_source: string | null;
    }>(
      `SELECT account_id, user_id, claim_kind, verification_source
       FROM account_email_reservations WHERE normalized_email = $1`,
      [email],
    )).rows[0];
  }

  it("keeps a verified linked email owned by the canonical account (no split)", async () => {
    const canonical = await createAccount({
      email: `canon-${randomUUID().slice(0, 8)}@example.test`,
      password: "quiet-context-1",
    });
    const { auth } = await sessionFor(canonical.accountId, canonical.userId, "web");
    const secondaryEmail = `alias-b-${randomUUID().slice(0, 8)}@example.test`;
    const subject = `split-google-${RUN}`;
    expect(await linkGoogleSubject(auth, subject, secondaryEmail, true)).toBe("linked");
    expect(await claimRow(secondaryEmail)).toMatchObject({
      account_id: canonical.accountId,
      user_id: canonical.userId,
      claim_kind: "secondary",
      verification_source: "provider:google",
    });
    // A verified password registration for B must NOT create a second account:
    // the start response is generic and the delivered message is the existing-
    // owner notice with NO code; no pending claim can confirm for B.
    const sink = createMemoryMailSink();
    const start = await startPasswordRegistration(pool!, config, sink.delivery, {
      username: `split${randomUUID().slice(0, 8)}`,
      email: secondaryEmail,
      display_name: "Split",
      password: "quiet-context-9",
      client_label: "web",
    });
    expect(start.status).toBe("verification_sent");
    expect(sink.messages[0]!.text).not.toContain("one-time code:");
    await expect(
      confirmPasswordRegistration(pool!, config, {
        verification_secret: "x".repeat(48),
        client_label: "web",
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_INVALID" });
    const accountsForB = await pool!.query(
      `SELECT 1 FROM users WHERE lower(btrim(email)) = $1`,
      [secondaryEmail],
    );
    expect(accountsForB.rowCount).toBe(0);
    // Google still signs in to the ORIGINAL account: no split.
    const challenge = await createGoogleChallenge(pool!, config, "web");
    const login = await createGoogleSession(pool!, config, {
      challenge_id: challenge.challenge_id,
      identity_token: googleToken(subject, secondaryEmail, sha256(challenge.nonce)),
      client_label: "web",
    }, fakeGoogleVerifier);
    expect(login.account.id).toBe(canonical.accountId);
    expect(login.user.id).toBe(canonical.userId);
  });

  it("serializes signup-vs-link in BOTH orderings to exactly one owner", async () => {
    for (const order of ["link-first", "signup-first"] as const) {
      const canonical = await createAccount({
        email: `race-${order}-${randomUUID().slice(0, 6)}@example.test`,
        password: "quiet-context-1",
      });
      const { auth } = await sessionFor(canonical.accountId, canonical.userId, "web");
      const secondaryEmail = `race-${order}-${randomUUID().slice(0, 6)}@example.test`;
      const subject = `race-google-${order}-${RUN}`;
      const sink = createMemoryMailSink();
      const signup = (async () => {
        await startPasswordRegistration(pool!, config, sink.delivery, {
          username: `race${randomUUID().slice(0, 8)}`,
          email: secondaryEmail,
          display_name: "Race",
          password: "quiet-context-9",
          client_label: "web",
        });
        try {
          await confirmPasswordRegistration(pool!, config, {
            verification_secret: secretFromMessage(sink.messages[0]!.text),
            client_label: "web",
          });
          return "signup-won" as const;
        } catch (error) {
          return (error as { code?: string }).code === "PASSWORD_ACCOUNT_EXISTS"
            ? ("signup-blocked" as const) : ("signup-failed" as const);
        }
      })();
      const link = (async () => {
        try {
          await linkGoogleSubject(auth, subject, secondaryEmail, true);
          return "link-won" as const;
        } catch (error) {
          return (error as { code?: string }).code === "LOGIN_METHOD_EMAIL_CONFLICT"
            ? ("link-blocked" as const) : ("link-failed" as const);
        }
      })();
      // The SAME email ownership lock serializes both directions.
      const results = await Promise.all([signup, link]);
      expect(results).not.toContain("signup-failed");
      expect(results).not.toContain("link-failed");
      expect(results.filter((result) => result.endsWith("-won"))).toHaveLength(1);
      const owners = await pool!.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM account_email_reservations
         WHERE normalized_email = $1 AND state = 'owned'`,
        [secondaryEmail],
      );
      expect(owners.rows[0]!.count).toBe("1");
    }
  });

  it("arbitrates same-subject rebinds and never claims unverified hints", async () => {
    const canonical = await createAccount({
      email: `rebind-${randomUUID().slice(0, 8)}@example.test`, password: "quiet-context-1",
    });
    const foreign = await createAccount({
      email: `foreign-${randomUUID().slice(0, 8)}@example.test`, password: "quiet-context-1",
    });
    const { auth } = await sessionFor(canonical.accountId, canonical.userId, "web");
    const subject = `rebind-google-${RUN}`;
    const emailB = `rebind-b-${randomUUID().slice(0, 8)}@example.test`;
    const emailC = `rebind-c-${randomUUID().slice(0, 8)}@example.test`;
    const foreignEmail = (await pool!.query<{ email: string }>(
      `SELECT email FROM users WHERE account_id = $1`, [foreign.accountId],
    )).rows[0]!.email;
    expect(await linkGoogleSubject(auth, subject, emailB, true)).toBe("linked");
    // Reassertion with a NEW verified address claims it before the hint moves.
    expect(await linkGoogleSubject(auth, subject, emailC, true)).toBe("already_linked");
    for (const claimEmail of [emailB, emailC]) {
      expect(await claimRow(claimEmail)).toMatchObject({
        account_id: canonical.accountId, verification_source: "provider:google",
      });
    }
    // A foreign verified collision fails closed: no claim, credential intact.
    await expect(linkGoogleSubject(auth, subject, foreignEmail, true)).rejects.toMatchObject({
      code: "LOGIN_METHOD_EMAIL_CONFLICT",
    });
    const foreignClaim = await pool!.query(
      `SELECT 1 FROM account_email_reservations WHERE normalized_email = $1 AND account_id = $2`,
      [foreignEmail, canonical.accountId],
    );
    expect(foreignClaim.rowCount).toBe(0);
    const stillLinked = await pool!.query(
      `SELECT 1 FROM auth_identities WHERE account_id = $1 AND subject_hash = $2`,
      [canonical.accountId, sha256(`https://accounts.google.com:${subject}`)],
    );
    expect(stillLinked.rowCount).toBe(1);
    // Unverified hints are labels, never claims (Apple is the provider that
    // may present an unverified/relay hint).
    const hintedEmail = `hint-${randomUUID().slice(0, 8)}@example.test`;
    const appleStart = await startCredentialChange(pool!, config, auth, {
      id: randomUUID(), intent: "link_provider", provider: "apple",
      origin: "ignored", client_label: "web",
      step_up: { kind: "password", password: "quiet-context-1" },
    }, "https://web.test");
    await completeCredentialChange(pool!, config, auth, {
      attempt_id: appleStart.attempt_id,
      attempt_secret: appleStart.attempt_secret,
      origin: "ignored",
      identity_token: appleToken(
        `hint-apple-${RUN}`,
        sha256(appleStart.provider_challenge!.nonce),
        hintedEmail,
        "false",
      ),
    }, "https://web.test", deps);
    const hinted = await pool!.query(
      `SELECT 1 FROM account_email_reservations WHERE normalized_email = $1`,
      [hintedEmail],
    );
    expect(hinted.rowCount).toBe(0);
    const hintedIdentity = await pool!.query<{ email_hint: string | null }>(
      `SELECT email_hint FROM auth_identities WHERE account_id = $1 AND provider = 'apple'`,
      [canonical.accountId],
    );
    expect(hintedIdentity.rows[0]?.email_hint).toBe(hintedEmail);
  });

  it("retains verified claims after unlink and blocks a second account", async () => {
    const canonical = await createAccount({
      email: `retain-${randomUUID().slice(0, 8)}@example.test`, password: "quiet-context-1",
    });
    const { auth } = await sessionFor(canonical.accountId, canonical.userId, "web");
    const secondaryEmail = `retain-b-${randomUUID().slice(0, 8)}@example.test`;
    const subject = `retain-google-${RUN}`;
    expect(await linkGoogleSubject(auth, subject, secondaryEmail, true)).toBe("linked");
    const started = await startCredentialChange(pool!, config, auth, {
      id: randomUUID(), intent: "unlink_provider", provider: "google",
      origin: "ignored", client_label: "web",
      step_up: { kind: "password", password: "quiet-context-1" },
    }, "https://web.test");
    await completeCredentialChange(pool!, config, auth, {
      attempt_id: started.attempt_id, attempt_secret: started.attempt_secret, origin: "ignored",
    }, "https://web.test");
    expect((await claimRow(secondaryEmail))?.account_id).toBe(canonical.accountId);
    // The retained claim blocks a second account: only the notice is sent and
    // no pending claim can confirm; passwords are never inherited.
    const sink = createMemoryMailSink();
    await startPasswordRegistration(pool!, config, sink.delivery, {
      username: `retain${randomUUID().slice(0, 8)}`,
      email: secondaryEmail, display_name: "Retain", password: "quiet-context-9", client_label: "web",
    });
    expect(sink.messages[0]!.text).not.toContain("one-time code:");
    await expect(
      confirmPasswordRegistration(pool!, config, {
        verification_secret: "y".repeat(48), client_label: "web",
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_INVALID" });
    const secondAccount = await pool!.query(
      `SELECT 1 FROM users WHERE lower(btrim(email)) = $1`,
      [secondaryEmail],
    );
    expect(secondAccount.rowCount).toBe(0);
  });

  it("transfers owned source aliases at reconciliation and refuses stale claims", async () => {
    const shape = await seedDuplicateShape(`alias${randomUUID().slice(0, 6)}`);
    const sourceAlias = `src-alias-${randomUUID().slice(0, 6)}@example.test`;
    const sourceAlias2 = `src-alias2-${randomUUID().slice(0, 6)}@example.test`;
    const sourceAuth = await sessionFor(shape.duplicate.accountId, shape.duplicate.userId, "ios");
    // The source owns two verified secondary claims through real arbitration.
    for (const alias of [sourceAlias, sourceAlias2]) {
      const aliasClient = await pool!.connect();
      try {
        await aliasClient.query("BEGIN");
        const { reserveVerifiedEmail } = await import("./accountIdentity.js");
        await reserveVerifiedEmail(
          aliasClient, alias,
          { accountId: shape.duplicate.accountId, userId: shape.duplicate.userId },
          { source: "provider:google", verifiedAt: new Date() },
          "secondary",
        );
        await aliasClient.query("COMMIT");
      } finally {
        aliasClient.release();
      }
    }
    void sourceAuth;
    const id = randomUUID();
    await prepareReconciliation(pool!, config, shape.canonicalAuth, {
      id,
      proof: {
        kind: "password",
        identifier: (await pool!.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1`, [shape.duplicate.userId],
        )).rows[0]!.username!,
        password: shape.duplicatePassword,
      },
      step_up: { kind: "password", password: shape.canonicalPassword },
    });
    const committed = await confirmReconciliation(pool!, config, shape.canonicalAuth, { id });
    expect(committed.state).toBe("committed");
    // Every source claim moved to the canonical user with its provenance.
    for (const alias of [sourceAlias, sourceAlias2]) {
      const row = await claimRow(alias);
      expect(row).toMatchObject({
        account_id: shape.canonical.accountId,
        user_id: shape.canonical.userId,
        verification_source: "provider:google",
      });
    }
  });

  it("keeps a prepared transfer valid after an unchanged verified claim is reasserted", async () => {
    const shape = await seedDuplicateShape(`stableclaim${randomUUID().slice(0, 6)}`);
    const alias = `stable-alias-${randomUUID().slice(0, 6)}@example.test`;
    const { reserveVerifiedEmail } = await import("./accountIdentity.js");
    const owner = { accountId: shape.duplicate.accountId, userId: shape.duplicate.userId };
    const client = await pool!.connect();
    const assertClaim = async () => {
      await client.query("BEGIN");
      try {
        await reserveVerifiedEmail(client, alias, owner, {
          source: "provider:google", verifiedAt: new Date(),
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    };
    try {
      await assertClaim();
      const before = (await client.query(
        "SELECT revision, updated_at, verification_source, verified_at FROM account_email_reservations WHERE normalized_email = $1",
        [alias],
      )).rows[0];
      const id = randomUUID();
      await prepareReconciliation(pool!, config, shape.canonicalAuth, {
        id,
        proof: {
          kind: "password",
          identifier: (await pool!.query<{ username: string }>(
            "SELECT username FROM users WHERE id = $1", [shape.duplicate.userId],
          )).rows[0]!.username!,
          password: shape.duplicatePassword,
        },
        step_up: { kind: "password", password: shape.canonicalPassword },
      });
      await assertClaim();
      const after = (await client.query(
        "SELECT revision, updated_at, verification_source, verified_at FROM account_email_reservations WHERE normalized_email = $1",
        [alias],
      )).rows[0];
      expect(after).toEqual(before);
      expect((await confirmReconciliation(pool!, config, shape.canonicalAuth, { id })).state).toBe("committed");
      expect((await claimRow(alias))?.account_id).toBe(shape.canonical.accountId);
    } finally {
      client.release();
    }
  });

  it("refuses the transfer when a frozen claim changes after prepare", async () => {
    const shape = await seedDuplicateShape(`staleclaim${randomUUID().slice(0, 6)}`);
    const sourceAlias = `stale-alias-${randomUUID().slice(0, 6)}@example.test`;
    const aliasClient = await pool!.connect();
    try {
      await aliasClient.query("BEGIN");
      const { reserveVerifiedEmail } = await import("./accountIdentity.js");
      await reserveVerifiedEmail(
        aliasClient, sourceAlias,
        { accountId: shape.duplicate.accountId, userId: shape.duplicate.userId },
        { source: "provider:apple", verifiedAt: new Date() },
        "secondary",
      );
      await aliasClient.query("COMMIT");
    } finally {
      aliasClient.release();
    }
    const id = randomUUID();
    await prepareReconciliation(pool!, config, shape.canonicalAuth, {
      id,
      proof: {
        kind: "password",
        identifier: (await pool!.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1`, [shape.duplicate.userId],
        )).rows[0]!.username!,
        password: shape.duplicatePassword,
      },
      step_up: { kind: "password", password: shape.canonicalPassword },
    });
    // A genuinely new verified alias changes the frozen inventory.
    const change = await pool!.connect();
    try {
      await change.query("BEGIN");
      const { reserveVerifiedEmail } = await import("./accountIdentity.js");
      await reserveVerifiedEmail(
        change, `new-${sourceAlias}`,
        { accountId: shape.duplicate.accountId, userId: shape.duplicate.userId },
        { source: "provider:google", verifiedAt: new Date() },
        "secondary",
      );
      await change.query("COMMIT");
    } finally {
      change.release();
    }
    await expect(
      confirmReconciliation(pool!, config, shape.canonicalAuth, { id }),
    ).rejects.toMatchObject({ code: "RECONCILIATION_PROOF_STALE" });
    // Nothing moved: the claim and every credential stay in place.
    const row = await claimRow(sourceAlias);
    expect(row?.account_id).toBe(shape.duplicate.accountId);
    const sourceAccount = await pool!.query<{ retired_at: Date | null }>(
      `SELECT retired_at FROM accounts WHERE id = $1`, [shape.duplicate.accountId],
    );
    expect(sourceAccount.rows[0]!.retired_at).toBeNull();
  });
});


describe.skipIf(!pool)("credential completion result routing (PostgreSQL)", () => {
  it("returns applied for the exact completed password attempt through the authenticated result route", async () => {
    const account = await createAccount({
      email: `synthetic-password-result-${randomUUID()}@example.test`,
      password: "synthetic-result-before-password",
    });
    const { auth, token } = await sessionFor(account.accountId, account.userId, "web");
    const grant = await startCredentialChange(pool!, config, auth, {
      id: randomUUID(), intent: "change_password", origin: "ignored", client_label: "web",
      step_up: { kind: "password", password: "synthetic-result-before-password" },
    }, "https://web.test", deps);
    await completeCredentialChange(pool!, config, auth, {
      attempt_id: grant.attempt_id, attempt_secret: grant.attempt_secret,
      origin: "ignored", password: "synthetic-result-after-password",
    }, "https://web.test", deps);

    // Reuse the real HTTP factory, with existing test controls disabling model
    // adapters and optional workers. The pool remains owned by this PG suite.
    const app = await buildApp({
      pool: pool!, config, remoteChatProvider: null, privateConversationProvider: null,
      personResearchProvider: null, screenshotContact: null,
      conversationQueueWorkerEnabled: false, labJobWorkerEnabled: false,
      labProviders: new Map(), mail: createMemoryMailSink().delivery,
    });
    try {
      const response = await app.inject({
        method: "POST", url: "/v1/account/login-methods/result",
        headers: { authorization: `Bearer ${token}`, origin: "https://web.test" },
        payload: {
          attempt_id: grant.attempt_id,
          attempt_secret: grant.attempt_secret,
          intent: "change_password",
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        state: "applied", attempt_id: grant.attempt_id,
        intent: "change_password", outcome: "password_set",
      });
    } finally {
      await app.close();
    }
  });
});
