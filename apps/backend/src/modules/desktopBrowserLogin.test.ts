import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import {
  DESKTOP_BROWSER_LOGIN_CALLBACK_URL,
  approveDesktopBrowserLogin,
  cancelDesktopBrowserLogin,
  consumeDesktopBrowserLogin,
  desktopBrowserLoginCallbackUrl,
  newDesktopBrowserLoginSecrets,
  pkceS256,
  prepareDesktopBrowserLogin,
  readDesktopBrowserLoginGrant,
  readDesktopBrowserLoginGrantResult,
  readDesktopBrowserLoginStatus,
  type DesktopBrowserLoginAttemptRow,
  type DesktopBrowserLoginDb,
  type DesktopBrowserLoginQueryable,
} from "./desktopBrowserLogin.js";
import type { AuthContext } from "./auth.js";

/**
 * Deterministic unit evidence for the browser-owned macOS primary login
 * state machine (ADR 0022). The in-memory store models the exact statements
 * the PostgreSQL implementation issues, including transactional rollback of
 * refused writes; the real SQL constraints and atomicity are covered by the
 * companion PostgreSQL integration test.
 */

const config: BackendConfig = {
  allowedOrigins: ["https://web.test"],
  appleSignInAudiences: ["com.talentsignal.app"],
  appleSignInEnabled: false,
  databaseUrl: "synthetic-only",
  host: "127.0.0.1",
  passwordAuthEnabled: true,
  passwordRegistrationEnabled: true,
  port: 4317,
  retentionSweepIntervalMs: 60_000,
  sessionTtlSeconds: 28_800,
  simulatedAuthEnabled: false,
};

type SessionRow = {
  id: string;
  account_id: string;
  user_id: string;
  token_hash: string;
  client_label: string;
  expires_at: Date;
  revoked_at: Date | null;
};

type UserRow = {
  account_id: string;
  user_id: string;
  account_name: string;
  account_slug: string;
  account_role: "admin" | "member";
  display_name: string;
  user_email: string;
  user_kind: "password_human" | "google_human" | "apple_human" | "lab_human" | "simulated_human";
  username: string | null;
  status: string;
};

class FakeDb implements DesktopBrowserLoginDb {
  attempts = new Map<string, DesktopBrowserLoginAttemptRow>();
  sessions = new Map<string, SessionRow>();
  accounts = new Map<string, { retired_at: Date | null }>();
  users = new Map<string, UserRow>();

  async query<R = unknown>(text: string, params: unknown[] = []): Promise<{ rows: R[] }> {
    const result = await this.dispatch(text, params);
    return result as { rows: R[] };
  }

  private async dispatch(text: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    const sql = text.replace(/\s+/gu, " ").trim().toLowerCase();

    if (sql.startsWith("insert into desktop_browser_login_attempts")) {
      const [
        id, protocolVersion, purpose, origin, stateHash, challenge,
        cancelSecretHash, matchingHint, createdAt, expiresAt,
      ] = params as [string, number, string, string, string, string, string, string, Date, Date];
      this.attempts.set(id, {
        id, protocol_version: protocolVersion, purpose, origin,
        state_hash: stateHash, challenge, cancel_secret_hash: cancelSecretHash,
        code_hash: null, matching_hint: matchingHint, state: "prepared",
        account_id: null, user_id: null, browser_session_id: null,
        device_session_id: null, failed_proof_count: 0,
        created_at: createdAt, approved_at: null, consumed_at: null,
        cancelled_at: null, expires_at: expiresAt, code_expires_at: null,
      });
      return { rows: [] };
    }

    if (sql.includes("from desktop_browser_login_attempts where id = $1 for update") ||
        (sql.includes("from desktop_browser_login_attempts where id = $1") && !sql.includes("for update"))) {
      const row = this.attempts.get(params[0] as string);
      return { rows: row ? [{ ...row }] : [] };
    }

    if (sql.startsWith("update desktop_browser_login_attempts set failed_proof_count")) {
      const row = this.attempts.get(params[0] as string);
      if (row) row.failed_proof_count += 1;
      return { rows: [] };
    }

    if (sql.includes("set state = 'approved'")) {
      const [id, accountId, userId, sessionId, approvedAt, codeHash, codeExpiresAt] =
        params as [string, string, string, string, Date, string, Date];
      const row = this.attempts.get(id);
      if (!row || row.state !== "prepared") return { rows: [] };
      Object.assign(row, {
        state: "approved", account_id: accountId, user_id: userId,
        browser_session_id: sessionId, approved_at: approvedAt,
        code_hash: codeHash, code_expires_at: codeExpiresAt,
      });
      return { rows: [{ id }] };
    }

    if (sql.includes("set state = 'consumed'")) {
      const [id, consumedAt, deviceSessionId] = params as [string, Date, string];
      const row = this.attempts.get(id);
      if (!row || row.state !== "approved") return { rows: [] };
      Object.assign(row, {
        state: "consumed", consumed_at: consumedAt, device_session_id: deviceSessionId,
      });
      return { rows: [{ id }] };
    }

    if (sql.includes("set state = 'cancelled'")) {
      const [id, cancelledAt] = params as [string, Date];
      const row = this.attempts.get(id);
      if (!row || !["prepared", "approved"].includes(row.state)) return { rows: [] };
      Object.assign(row, { state: "cancelled", cancelled_at: cancelledAt });
      return { rows: [{ id }] };
    }

    if (sql.startsWith("select id, expires_at from sessions where id = $1 and account_id = $2")) {
      const [id, accountId, userId, now] = params as [string, string, string, Date];
      const session = this.sessions.get(id);
      const live = session && session.account_id === accountId && session.user_id === userId &&
        session.revoked_at === null && session.expires_at.getTime() > now.getTime();
      return { rows: live && session ? [{ id, expires_at: session.expires_at }] : [] };
    }

    if (sql.startsWith("select id, expires_at from sessions where id = $1")) {
      const [id, now] = params as [string, Date];
      const session = this.sessions.get(id);
      const live = session && session.revoked_at === null && session.expires_at.getTime() > now.getTime();
      return { rows: live && session ? [{ id, expires_at: session.expires_at }] : [] };
    }

    if (sql.startsWith("select users.id as user_id")) {
      const [accountId, userId] = params as [string, string];
      const user = this.users.get(`${accountId}:${userId}`);
      return {
        rows: user && user.status === "active"
          ? [{
              user_id: user.user_id, account_id: user.account_id,
              account_name: user.account_name, account_slug: user.account_slug,
              account_role: user.account_role, display_name: user.display_name,
              user_email: user.user_email, user_kind: user.user_kind,
              username: user.username,
            }]
          : [],
      };
    }

    if (sql.startsWith("select id, retired_at from accounts where id = $1")) {
      const account = this.accounts.get(params[0] as string);
      return {
        rows: account ? [{ id: params[0], retired_at: account.retired_at }] : [],
      };
    }

    if (sql.startsWith("select status, kind from users")) {
      const [accountId, userId] = params as [string, string];
      const user = this.users.get(`${accountId}:${userId}`);
      return { rows: user ? [{ status: user.status, kind: user.user_kind }] : [] };
    }

    if (sql.startsWith("select retired_at from accounts")) {
      const account = this.accounts.get(params[0] as string);
      return { rows: account ? [{ retired_at: account.retired_at }] : [] };
    }

    if (sql.startsWith("insert into sessions")) {
      const [id, accountId, userId, tokenHash, clientLabel, expiresAt] =
        params as [string, string, string, string, string, Date];
      this.sessions.set(id, {
        id, account_id: accountId, user_id: userId, token_hash: tokenHash,
        client_label: clientLabel, expires_at: expiresAt, revoked_at: null,
      });
      return { rows: [] };
    }

    if (sql.startsWith("select id from sessions where token_hash = $1")) {
      for (const session of this.sessions.values()) {
        if (session.token_hash === params[0]) return { rows: [{ id: session.id }] };
      }
      return { rows: [] };
    }

    throw new Error(`Unhandled statement in fake store: ${sql}`);
  }

  async transaction<T>(run: (tx: DesktopBrowserLoginQueryable) => Promise<T>): Promise<T> {
    const snapshot = structuredClone({
      attempts: [...this.attempts].map(([key, row]) => [key, row] as const),
      sessions: [...this.sessions].map(([key, row]) => [key, row] as const),
    });
    try {
      return await run(this);
    } catch (error) {
      this.attempts = new Map(snapshot.attempts);
      this.sessions = new Map(snapshot.sessions);
      throw error;
    }
  }
}

/**
 * Deterministic lock-wait aging: time advances while the exchange or approval
 * waits on the account/session row locks, so post-lock expiry revalidation can
 * be proven against a fresh reading.
 */
class AgingDb implements DesktopBrowserLoginDb {
  constructor(
    private readonly inner: FakeDb,
    private readonly clock: { at: number },
    private readonly bumpMs: number,
  ) {}

  query<R = unknown>(text: string, params?: unknown[]) {
    return this.inner.query<R>(text, params);
  }

  async transaction<T>(run: (tx: DesktopBrowserLoginQueryable) => Promise<T>): Promise<T> {
    return this.inner.transaction((tx) =>
      run({
        query: async <R>(text: string, params?: unknown[]) => {
          const result = await tx.query<R>(text, params);
          if (/from sessions[\s\S]*revoked_at is null/i.test(text)) {
            // The lock queue outlived the code window before the row returned.
            this.clock.at += this.bumpMs;
          }
          return result;
        },
      }),
    );
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/u;

function seedWorld(db: FakeDb, options: { userKind?: UserRow["user_kind"]; browserSessionLive?: boolean } = {}) {
  const accountId = randomUUID();
  const userId = randomUUID();
  const browserSessionId = randomUUID();
  db.accounts.set(accountId, { retired_at: null });
  db.users.set(`${accountId}:${userId}`, {
    account_id: accountId,
    user_id: userId,
    account_name: "Workspace",
    account_slug: "workspace",
    account_role: "admin",
    display_name: "Real Person",
    user_email: "person@example.test",
    user_kind: options.userKind ?? "password_human",
    username: null,
    status: "active",
  });
  db.sessions.set(browserSessionId, {
    id: browserSessionId,
    account_id: accountId,
    user_id: userId,
    token_hash: "browser-token-hash",
    client_label: "talent-signal-web",
    expires_at: new Date("2026-10-01T12:30:00.000Z"),
    revoked_at: options.browserSessionLive === false ? new Date() : null,
  });
  const auth: AuthContext = {
    accountId,
    accountSlug: "workspace",
    userId,
    userEmail: "person@example.test",
    userKind: options.userKind ?? "password_human",
    sessionId: browserSessionId,
  };
  return { accountId, userId, browserSessionId, auth };
}

async function prepareGrant(
  db: FakeDb,
  now: () => Date,
  overrides: Partial<{ challenge: string; state: string; cancel_secret: string; web_origin: string }> = {},
) {
  const secrets = newDesktopBrowserLoginSecrets();
  const request = {
    protocol_version: 1 as const,
    purpose: "macos-primary-login" as const,
    challenge: secrets.challenge,
    state: secrets.state,
    cancel_secret: secrets.cancelSecret,
    web_origin: "https://web.test",
    ...overrides,
  };
  const prepared = await prepareDesktopBrowserLogin(db, config, request, now);
  return { secrets, request, prepared };
}

function expectApiError(error: unknown, code: string) {
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe(code);
}

describe("desktop browser login preparation", () => {
  const now = () => new Date("2026-10-01T12:00:00.000Z");

  it("stores only hashes and returns the bounded authorization entry", async () => {
    const db = new FakeDb();
    const { secrets, prepared } = await prepareGrant(db, now);
    const row = db.attempts.get(prepared.attempt_id)!;
    expect(row.state).toBe("prepared");
    expect(row.state_hash).toMatch(SHA256_HEX);
    expect(row.cancel_secret_hash).toMatch(SHA256_HEX);
    expect(row.state_hash).not.toBe(secrets.state);
    expect(row.cancel_secret_hash).not.toBe(secrets.cancelSecret);
    // The S256 challenge is public; its verifier is never stored.
    expect(row.challenge).toBe(secrets.challenge);
    expect(prepared.authorization_url).toBe(
      `https://web.test/desktop-auth/authorize?attempt=${prepared.attempt_id}&state=${encodeURIComponent(secrets.state)}`,
    );
    expect(prepared.expires_at).toBe(new Date(now().getTime() + 5 * 60_000).toISOString());
    expect(prepared.matching_hint).toMatch(/^[A-Z0-9]{4}-[0-9]{2}$/u);
    // The cancellation secret is never echoed anywhere; the state appears only
    // inside the browser authorization target the native operation opened.
    expect(JSON.stringify(prepared)).not.toContain(secrets.cancelSecret);
    expect(prepared.authorization_url).toContain(secrets.state);
    expect(JSON.stringify({ ...prepared, authorization_url: "" })).not.toContain(secrets.state);
  });

  it("refuses origins outside the exact allowlist and malformed grants", async () => {
    const db = new FakeDb();
    for (const web_origin of ["https://evil.test", "https://web.test/workspace", "https://web.test?x=1", "file:///tmp"]) {
      await expect(prepareGrant(db, now, { web_origin })).rejects.toSatisfy(
        (error: unknown) =>
          (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_ORIGIN_NOT_ALLOWED" ||
          (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_ORIGIN_INVALID",
      );
    }
    await expect(prepareGrant(db, now, { state: "short" })).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_SECRET_INVALID",
    );
    await expect(
      prepareDesktopBrowserLogin(db, config, {
        protocol_version: 1,
        purpose: "something-else" as never,
        challenge: "a".repeat(43),
        state: "b".repeat(43),
        cancel_secret: "c".repeat(43),
        web_origin: "https://web.test",
      }, now),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_PURPOSE_INVALID",
    );
  });

  it("keeps the hint human-readable and never a bearer", async () => {
    const db = new FakeDb();
    const { prepared } = await prepareGrant(db, now);
    // Nothing accepts the hint as proof: it is absent from every hash column.
    const row = db.attempts.get(prepared.attempt_id)!;
    expect(row.state_hash).not.toContain(prepared.matching_hint);
    expect(row.cancel_secret_hash).not.toContain(prepared.matching_hint);
  });
});

describe("desktop browser login approval", () => {
  const now = () => new Date("2026-10-01T12:00:00.000Z");

  it("mints one code for the fixed callback and binds identity", async () => {
    const db = new FakeDb();
    const { auth, accountId, userId, browserSessionId } = seedWorld(db);
    const { secrets, prepared } = await prepareGrant(db, now);
    const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    expect(approved.state).toBe("approved");
    expect(approved.already_approved).toBe(false);
    expect(approved.code).toHaveLength(43);
    expect(approved.account_id).toBe(accountId);
    expect(approved.user_id).toBe(userId);
    expect(approved.code_expires_at).toBe(new Date(now().getTime() + 60_000).toISOString());
    const callback = new URL(approved.callback_url);
    expect(callback.protocol).toBe("com.talentsignal.macos.auth:");
    expect(callback.host).toBe("complete");
    expect(callback.pathname === "" || callback.pathname === "/").toBe(true);
    expect([...callback.searchParams.keys()].sort()).toEqual(["attempt", "code", "state"]);
    expect(callback.searchParams.get("attempt")).toBe(prepared.attempt_id);
    expect(callback.searchParams.get("code")).toBe(approved.code);
    expect(callback.searchParams.get("state")).toBe(secrets.state);
    const row = db.attempts.get(prepared.attempt_id)!;
    expect(row.state).toBe("approved");
    expect(row.browser_session_id).toBe(browserSessionId);
    expect(row.code_hash).toBe(createHash("sha256").update(approved.code!).digest("hex"));
  });

  it("never mints a second code for an already-approved confirmation", async () => {
    const db = new FakeDb();
    const { auth } = seedWorld(db);
    const { secrets, prepared } = await prepareGrant(db, now);
    const first = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    const second = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    expect(second.already_approved).toBe(true);
    expect(second.code).toBeNull();
    expect(second.code_expires_at).toBe(first.code_expires_at);
    expect(db.attempts.get(prepared.attempt_id)!.code_hash).toBe(
      createHash("sha256").update(first.code!).digest("hex"),
    );
  });

  it("refuses Lab and simulated identities and a gone browser session", async () => {
    for (const userKind of ["lab_human", "simulated_human"] as const) {
      const db = new FakeDb();
      const { auth } = seedWorld(db, { userKind });
      const { secrets, prepared } = await prepareGrant(db, now);
      await expect(
        approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, { state: secrets.state, web_origin: "https://web.test" }, { now }),
      ).rejects.toSatisfy(
        (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_IDENTITY_REFUSED",
      );
      expect(db.attempts.get(prepared.attempt_id)!.state).toBe("prepared");
    }
    const db = new FakeDb();
    const { auth } = seedWorld(db, { browserSessionLive: false });
    const { secrets, prepared } = await prepareGrant(db, now);
    await expect(
      approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, { state: secrets.state, web_origin: "https://web.test" }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_BROWSER_SESSION_GONE",
    );
  });

  it("keeps wrong-state refusals non-consuming and expires the grant", async () => {
    const db = new FakeDb();
    const { auth } = seedWorld(db);
    const { secrets, prepared } = await prepareGrant(db, now);
    await expect(
      approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, { state: "z".repeat(43), web_origin: "https://web.test" }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH",
    );
    // The correct state is not locked out by the wrong one.
    const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    expect(approved.code).not.toBeNull();
    const late = () => new Date(now().getTime() + 5 * 60_000 + 1);
    await expect(
      approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, { state: secrets.state, web_origin: "https://web.test" }, { now: late }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_GRANT_EXPIRED",
    );
  });

  it("refuses cross-account or cross-session takeover of an already-approved grant", async () => {
    const db = new FakeDb();
    const { auth } = seedWorld(db);
    const { secrets, prepared } = await prepareGrant(db, now);
    await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    // A different browser session of a real account cannot read the prior
    // confirmation back or borrow its identity.
    await expect(
      approveDesktopBrowserLogin(db, config, prepared.attempt_id, {
        ...auth,
        sessionId: "11111111-2222-3333-4444-555555555555",
      }, { state: secrets.state, web_origin: "https://web.test" }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_BROWSER_SESSION_GONE" ||
        (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_BINDING_MISMATCH",
    );
  });

  it("enforces the exact prepared origin, not allowlist inclusion", async () => {
    const db = new FakeDb();
    const { auth } = seedWorld(db);
    const { secrets, prepared } = await prepareGrant(db, now);
    await expect(
      approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
        state: secrets.state,
        web_origin: "https://other.test",
      }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_ORIGIN_NOT_ALLOWED",
    );
    expect(db.attempts.get(prepared.attempt_id)!.state).toBe("prepared");
  });

  it("expires an untouched grant after five minutes", async () => {
    const db = new FakeDb();
    const { auth } = seedWorld(db);
    const { secrets, prepared } = await prepareGrant(db, now);
    const late = () => new Date(now().getTime() + 5 * 60_000 + 1);
    await expect(
      approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, { state: secrets.state, web_origin: "https://web.test" }, { now: late }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_GRANT_EXPIRED",
    );
    expect(db.attempts.get(prepared.attempt_id)!.state).toBe("prepared");
  });
});

describe("desktop browser login exchange", () => {
  const now = () => new Date("2026-10-01T12:00:00.000Z");

  it("consumes once, records the device session, and refuses replay", async () => {
    const db = new FakeDb();
    const { auth, accountId, userId } = seedWorld(db);
    const verifier = "v".repeat(43);
    const secrets = newDesktopBrowserLoginSecrets();
    const { prepared } = await prepareGrant(db, now, {
      challenge: pkceS256(verifier), state: secrets.state, cancel_secret: secrets.cancelSecret,
    });
    const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    const session = await consumeDesktopBrowserLogin(db, config, {
      attempt_id: prepared.attempt_id,
      code: approved.code!,
      verifier,
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    expect(session.account.id).toBe(accountId);
    expect(session.user.id).toBe(userId);
    expect(session.user.kind).toBe("password_human");
    expect(session.access_token.length).toBeGreaterThanOrEqual(32);
    const row = db.attempts.get(prepared.attempt_id)!;
    expect(row.state).toBe("consumed");
    expect(row.device_session_id).toBeTruthy();
    // The created session is an ordinary, independently revocable session.
    expect([...db.sessions.values()].some((candidate) => candidate.id === row.device_session_id)).toBe(true);
    // Replay never mints a second session.
    await expect(
      consumeDesktopBrowserLogin(db, config, {
        attempt_id: prepared.attempt_id,
        code: approved.code!,
        verifier,
        state: secrets.state,
      web_origin: "https://web.test",
      }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_GRANT_CONSUMED",
    );
  });

  it("keeps wrong proofs non-consuming and lets the correct proof finish", async () => {
    const db = new FakeDb();
    const { auth } = seedWorld(db);
    const verifier = "v".repeat(43);
    const secrets = newDesktopBrowserLoginSecrets();
    const { prepared } = await prepareGrant(db, now, {
      challenge: pkceS256(verifier), state: secrets.state, cancel_secret: secrets.cancelSecret,
    });
    const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    await expect(
      consumeDesktopBrowserLogin(db, config, {
        attempt_id: prepared.attempt_id,
        code: "w".repeat(43),
        verifier,
        state: secrets.state,
      web_origin: "https://web.test",
      }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH",
    );
    expect(db.attempts.get(prepared.attempt_id)!.state).toBe("approved");
    expect(db.attempts.get(prepared.attempt_id)!.failed_proof_count).toBe(1);
    const session = await consumeDesktopBrowserLogin(db, config, {
      attempt_id: prepared.attempt_id,
      code: approved.code!,
      verifier,
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    expect(session.access_token).toBeTruthy();
  });

  it("expires the one-use code after sixty seconds and the grant after five minutes", async () => {
    const db = new FakeDb();
    const { auth } = seedWorld(db);
    const verifier = "v".repeat(43);
    const secrets = newDesktopBrowserLoginSecrets();
    const { prepared } = await prepareGrant(db, now, {
      challenge: pkceS256(verifier), state: secrets.state, cancel_secret: secrets.cancelSecret,
    });
    const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    const afterCode = () => new Date(now().getTime() + 61_000);
    await expect(
      consumeDesktopBrowserLogin(db, config, {
        attempt_id: prepared.attempt_id,
        code: approved.code!,
        verifier,
        state: secrets.state,
      web_origin: "https://web.test",
      }, { now: afterCode }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_CODE_EXPIRED",
    );
    const afterGrant = () => new Date(now().getTime() + 5 * 60_000 + 1);
    await expect(
      consumeDesktopBrowserLogin(db, config, {
        attempt_id: prepared.attempt_id,
        code: approved.code!,
        verifier,
        state: secrets.state,
      web_origin: "https://web.test",
      }, { now: afterGrant }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_GRANT_EXPIRED",
    );
    // Neither refusal consumed the grant.
    expect(db.attempts.get(prepared.attempt_id)!.state).toBe("approved");
  });

  it("re-verifies the approving browser session and the allowlisted origin inside the exchange", async () => {
    const db = new FakeDb();
    const { auth, browserSessionId } = seedWorld(db);
    const verifier = "v".repeat(43);
    const secrets = newDesktopBrowserLoginSecrets();
    const { prepared } = await prepareGrant(db, now, {
      challenge: pkceS256(verifier), state: secrets.state, cancel_secret: secrets.cancelSecret,
    });
    const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    db.sessions.get(browserSessionId)!.revoked_at = new Date();
    await expect(
      consumeDesktopBrowserLogin(db, config, {
        attempt_id: prepared.attempt_id,
        code: approved.code!,
        verifier,
        state: secrets.state,
      web_origin: "https://web.test",
      }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_BROWSER_SESSION_GONE",
    );
    db.sessions.get(browserSessionId)!.revoked_at = null;
    const foreignConfig: BackendConfig = { ...config, allowedOrigins: ["https://other.test"] };
    await expect(
      consumeDesktopBrowserLogin(db, foreignConfig, {
        attempt_id: prepared.attempt_id,
        code: approved.code!,
        verifier,
        state: secrets.state,
      web_origin: "https://web.test",
      }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_ORIGIN_NOT_ALLOWED",
    );
    expect(db.attempts.get(prepared.attempt_id)!.state).toBe("approved");
  });

  it("revalidates code expiry with a fresh reading after lock waits", async () => {
    const db = new FakeDb();
    const clock = { at: Date.parse("2026-10-01T12:00:00.000Z") };
    const now = () => new Date(clock.at);
    const { auth } = seedWorld(db);
    const verifier = "v".repeat(43);
    const secrets = newDesktopBrowserLoginSecrets();
    const { prepared } = await prepareGrant(db, now, {
      challenge: pkceS256(verifier), state: secrets.state, cancel_secret: secrets.cancelSecret,
    });
    const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state, web_origin: "https://web.test",
    }, { now });
    const sessionsBefore = db.sessions.size;
    // The exchange begins before code expiry, but the account/session lock
    // wait outlives the sixty-second code window.
    await expect(
      consumeDesktopBrowserLogin(new AgingDb(db, clock, 61_000), config, {
        attempt_id: prepared.attempt_id,
        code: approved.code!,
        verifier,
        state: secrets.state,
        web_origin: "https://web.test",
      }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_CODE_EXPIRED",
    );
    // No device session was minted and the grant stays exactly as it was.
    expect(db.sessions.size).toBe(sessionsBefore);
    const row = db.attempts.get(prepared.attempt_id)!;
    expect(row.state).toBe("approved");
    expect(row.device_session_id).toBeNull();
    expect(row.consumed_at).toBeNull();
  });

  it("revalidates grant expiry for approval with a fresh reading after lock waits", async () => {
    const db = new FakeDb();
    const clock = { at: Date.parse("2026-10-01T12:00:00.000Z") };
    const now = () => new Date(clock.at);
    const { auth } = seedWorld(db);
    const { secrets, prepared } = await prepareGrant(db, now);
    await expect(
      approveDesktopBrowserLogin(
        new AgingDb(db, clock, 5 * 60_000 + 1),
        config,
        prepared.attempt_id,
        auth,
        { state: secrets.state, web_origin: "https://web.test" },
        { now },
      ),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_GRANT_EXPIRED",
    );
    expect(db.attempts.get(prepared.attempt_id)!.state).toBe("prepared");
  });

  it("compares the returned session expiry against a fresh time after the wait", async () => {
    const db = new FakeDb();
    const clock = { at: Date.parse("2026-10-01T12:00:00.000Z") };
    const now = () => new Date(clock.at);
    const { auth, browserSessionId } = seedWorld(db);
    // The session outlives the pre-lock reading but expires during the wait:
    // the stale WHERE predicate passes and only the post-lock comparison sees
    // the truth.
    db.sessions.get(browserSessionId)!.expires_at = new Date("2026-10-01T12:00:30.000Z");
    const verifier = "v".repeat(43);
    const secrets = newDesktopBrowserLoginSecrets();
    const { prepared } = await prepareGrant(db, now, {
      challenge: pkceS256(verifier), state: secrets.state, cancel_secret: secrets.cancelSecret,
    });
    const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state, web_origin: "https://web.test",
    }, { now });
    await expect(
      consumeDesktopBrowserLogin(new AgingDb(db, clock, 31_000), config, {
        attempt_id: prepared.attempt_id,
        code: approved.code!,
        verifier,
        state: secrets.state,
        web_origin: "https://web.test",
      }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_BROWSER_SESSION_GONE",
    );
    expect(db.attempts.get(prepared.attempt_id)!.state).toBe("approved");
  });

  it("refuses an exchange against an account retired after the lock", async () => {
    const db = new FakeDb();
    const { auth, accountId } = seedWorld(db);
    const verifier = "v".repeat(43);
    const secrets = newDesktopBrowserLoginSecrets();
    const { prepared } = await prepareGrant(db, now, {
      challenge: pkceS256(verifier), state: secrets.state, cancel_secret: secrets.cancelSecret,
    });
    const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state, web_origin: "https://web.test",
    }, { now });
    db.accounts.get(accountId)!.retired_at = new Date("2026-10-01T12:00:30.000Z");
    await expect(
      consumeDesktopBrowserLogin(db, config, {
        attempt_id: prepared.attempt_id,
        code: approved.code!,
        verifier,
        state: secrets.state,
        web_origin: "https://web.test",
      }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "ACCOUNT_RETIRED",
    );
    expect(db.attempts.get(prepared.attempt_id)!.state).toBe("approved");
  });

  it("refuses exchange of a cancelled grant", async () => {
    const db = new FakeDb();
    const { auth } = seedWorld(db);
    const verifier = "v".repeat(43);
    const secrets = newDesktopBrowserLoginSecrets();
    const { prepared } = await prepareGrant(db, now, {
      challenge: pkceS256(verifier), state: secrets.state, cancel_secret: secrets.cancelSecret,
    });
    const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    const cancelled = await cancelDesktopBrowserLogin(db, prepared.attempt_id, {
      cancel_secret: secrets.cancelSecret,
    }, { now });
    expect(cancelled).toMatchObject({ state: "cancelled", cancellation_recorded: true });
    await expect(
      consumeDesktopBrowserLogin(db, config, {
        attempt_id: prepared.attempt_id,
        code: approved.code!,
        verifier,
        state: secrets.state,
      web_origin: "https://web.test",
      }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_GRANT_CANCELLED",
    );
    expect(db.sessions.size).toBe(1);
  });
});

describe("desktop browser login cancellation", () => {
  const now = () => new Date("2026-10-01T12:00:00.000Z");

  it("refuses a wrong cancellation secret without locking out the correct one", async () => {
    const db = new FakeDb();
    const { secrets, prepared } = await prepareGrant(db, now);
    await expect(
      cancelDesktopBrowserLogin(db, prepared.attempt_id, { cancel_secret: "z".repeat(43) }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH",
    );
    expect(db.attempts.get(prepared.attempt_id)!.state).toBe("prepared");
    const cancelled = await cancelDesktopBrowserLogin(db, prepared.attempt_id, {
      cancel_secret: secrets.cancelSecret,
    }, { now });
    expect(cancelled).toMatchObject({ state: "cancelled", cancellation_recorded: true });
  });

  it("treats cancellation after a possible consume as unresolved, never a rollback", async () => {
    const db = new FakeDb();
    const { auth } = seedWorld(db);
    const verifier = "v".repeat(43);
    const secrets = newDesktopBrowserLoginSecrets();
    const { prepared } = await prepareGrant(db, now, {
      challenge: pkceS256(verifier), state: secrets.state, cancel_secret: secrets.cancelSecret,
    });
    const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    await consumeDesktopBrowserLogin(db, config, {
      attempt_id: prepared.attempt_id,
      code: approved.code!,
      verifier,
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    const result = await cancelDesktopBrowserLogin(db, prepared.attempt_id, {
      cancel_secret: secrets.cancelSecret,
    }, { now });
    expect(result).toMatchObject({ state: "consumed", cancellation_recorded: false });
    // The consumed grant and its session survive; nothing claims a rollback.
    expect(db.attempts.get(prepared.attempt_id)!.state).toBe("consumed");
  });

  it("is idempotent and reports expiry truthfully", async () => {
    const db = new FakeDb();
    const { secrets, prepared } = await prepareGrant(db, now);
    await cancelDesktopBrowserLogin(db, prepared.attempt_id, { cancel_secret: secrets.cancelSecret }, { now });
    const again = await cancelDesktopBrowserLogin(db, prepared.attempt_id, {
      cancel_secret: secrets.cancelSecret,
    }, { now });
    expect(again).toMatchObject({ state: "cancelled", cancellation_recorded: false });

    const late = () => new Date(now().getTime() + 5 * 60_000 + 1);
    const { secrets: secondSecrets, prepared: second } = await prepareGrant(db, now);
    const expired = await cancelDesktopBrowserLogin(db, second.attempt_id, {
      cancel_secret: secondSecrets.cancelSecret,
    }, { now: late });
    expect(expired).toMatchObject({ state: "expired", cancellation_recorded: false });
  });
});

describe("desktop browser login read-only result and status", () => {
  const now = () => new Date("2026-10-01T12:00:00.000Z");

  async function consumedGrant(db: FakeDb) {
    const { auth, accountId, userId } = seedWorld(db);
    const verifier = "v".repeat(43);
    const secrets = newDesktopBrowserLoginSecrets();
    const { prepared } = await prepareGrant(db, now, {
      challenge: pkceS256(verifier), state: secrets.state, cancel_secret: secrets.cancelSecret,
    });
    const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    const session = await consumeDesktopBrowserLogin(db, config, {
      attempt_id: prepared.attempt_id,
      code: approved.code!,
      verifier,
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    return {
      auth,
      accountId,
      userId,
      secrets,
      verifier,
      attempt_id: prepared.attempt_id,
      session,
      // The readback is performed by the Mac device session created above.
      deviceAuth: { ...auth, sessionId: db.attempts.get(prepared.attempt_id)!.device_session_id! },
    };
  }

  it("reveals the exact approved identity only against a matching proof", async () => {
    const db = new FakeDb();
    const { accountId, userId, secrets, verifier, attempt_id } = await consumedGrant(db);
    await expect(
      readDesktopBrowserLoginGrantResult(db, attempt_id, { verifier: "z".repeat(43) }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH",
    );
    const byVerifier = await readDesktopBrowserLoginGrantResult(db, attempt_id, { verifier });
    expect(byVerifier).toMatchObject({
      state: "consumed", committed: true, account_id: accountId, user_id: userId,
    });
    const byCancelSecret = await readDesktopBrowserLoginGrantResult(db, attempt_id, {
      cancel_secret: secrets.cancelSecret,
    });
    expect(byCancelSecret).toMatchObject({ state: "consumed", committed: true });
    // No secret-bearing material in the readback.
    expect(JSON.stringify(byVerifier)).not.toContain(verifier);
    expect(JSON.stringify(byVerifier)).not.toContain(secrets.cancelSecret);
  });

  it("previews the grant only against the exact state and prepared origin", async () => {
    const db = new FakeDb();
    const { auth } = seedWorld(db);
    const { secrets, prepared } = await prepareGrant(db, now);
    const view = await readDesktopBrowserLoginGrant(db, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    }, { now });
    expect(view).toMatchObject({ state: "prepared" });
    expect(view.matching_hint).toMatch(/^[A-Z0-9]{4}-[0-9]{2}$/u);
    // A wrong state reveals no hint, lifecycle or identity authority.
    await expect(
      readDesktopBrowserLoginGrant(db, config, prepared.attempt_id, auth, {
        state: "z".repeat(43),
        web_origin: "https://web.test",
      }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH",
    );
    await expect(
      readDesktopBrowserLoginGrant(db, config, prepared.attempt_id, auth, {
        state: secrets.state,
        web_origin: "https://other.test",
      }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_ORIGIN_NOT_ALLOWED",
    );
  });

  it("correlates status to the exact device session and refuses others", async () => {
    const db = new FakeDb();
    const { auth, deviceAuth, attempt_id } = await consumedGrant(db);
    const status = await readDesktopBrowserLoginStatus(db, attempt_id, deviceAuth, { now });
    expect(status).toMatchObject({ state: "consumed", attempt_id });
    expect(status.account_id).toBe(auth.accountId);
    expect(status.user_id).toBe(auth.userId);
    // Another session of the same account cannot read this grant back.
    await expect(
      readDesktopBrowserLoginStatus(db, attempt_id, { ...auth, sessionId: randomUUID() }, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_SESSION_MISMATCH",
    );
    await expect(
      readDesktopBrowserLoginStatus(db, randomUUID(), deviceAuth, { now }),
    ).rejects.toSatisfy(
      (error: unknown) => (error as ApiError).code === "DESKTOP_BROWSER_LOGIN_ATTEMPT_NOT_FOUND",
    );
  });

  it("keeps the fixed callback limited to attempt, code and state", () => {
    const url = new URL(desktopBrowserLoginCallbackUrl("attempt-id", "code-value", "state-value"));
    expect(url.href.startsWith(DESKTOP_BROWSER_LOGIN_CALLBACK_URL)).toBe(true);
    expect([...url.searchParams.keys()].sort()).toEqual(["attempt", "code", "state"]);
  });
});
