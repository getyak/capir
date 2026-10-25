import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { BackendConfig } from "../config.js";
import type { AuthContext } from "./auth.js";
import { desktopAccessRenewal, enrollDesktopPersistentSession, renewDesktopPersistentSession } from "./desktopPersistentSession.js";

const secret = "x".repeat(43);
const sessionId = randomUUID();
const now = new Date("2026-10-25T08:00:00Z");
const ttl = 28_800;
const config = { allowedOrigins: ["https://web.test"], sessionTtlSeconds: ttl } as BackendConfig;

describe("bounded desktop access generations", () => {
  it("derives the same credential for a lost-response retry without extending expiry", () => {
    const first = desktopAccessRenewal(secret, sessionId, { generation: 0, expiresAt: now }, now, ttl);
    const retry = desktopAccessRenewal(secret, sessionId, first, new Date(now.getTime() + 1_000), ttl);
    expect(first.rotate).toBe(true);
    expect(first.generation).toBe(1);
    expect(retry.accessToken).toBe(first.accessToken);
    expect(retry.expiresAt).toEqual(first.expiresAt);
    expect(retry.rotate).toBe(false);
  });

  it("renews after arbitrarily long inactivity and makes a distinct bounded generation", () => {
    const first = desktopAccessRenewal(secret, sessionId, { generation: 0, expiresAt: now }, now, ttl);
    const later = new Date("2036-10-25T08:00:00Z");
    const next = desktopAccessRenewal(secret, sessionId, first, later, ttl);
    expect(next.generation).toBe(2);
    expect(next.accessToken).not.toBe(first.accessToken);
    expect(next.expiresAt.getTime() - later.getTime()).toBe(ttl * 1_000);
    expect(first.expiresAt.toISOString()).toBe("2026-10-25T16:00:00.000Z");
  });

  it("rotates only inside the renewal window and domain-separates each device session", () => {
    const first = desktopAccessRenewal(secret, sessionId, { generation: 0, expiresAt: now }, now, ttl);
    const early = desktopAccessRenewal(secret, sessionId, first, new Date("2026-10-25T11:59:59Z"), ttl);
    const due = desktopAccessRenewal(secret, sessionId, first, new Date("2026-10-25T12:00:00Z"), ttl);
    expect(early.rotate).toBe(false);
    expect(due.rotate).toBe(true);
    expect(due.generation).toBe(2);
    const other = desktopAccessRenewal(secret, randomUUID(), { generation: 0, expiresAt: now }, now, ttl);
    expect(other.accessToken).not.toBe(first.accessToken);
    expect(first.accessToken).not.toBe(secret);
    expect(first.accessToken).toBe(createHmac("sha256", secret).update(`capri:macos-access:v1:${sessionId}:1`).digest("base64url"));
  });
});

describe("desktop capability admission", () => {
  const accountId = randomUUID(), userId = randomUUID();
  const auth = { accountId, userId, sessionId, userKind: "password_human" } as AuthContext;
  const proof = { device_secret: secret, web_origin: "https://web.test", account_id: accountId, user_id: userId };
  const emptyPool = () => ({ query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() });
  it("rejects malformed proof without opening a database connection", async () => {
    const pool = emptyPool();
    await expect(renewDesktopPersistentSession(pool as unknown as Pool, config, { ...proof, device_secret: "short" }))
      .rejects.toMatchObject({ statusCode: 400, code: "DESKTOP_SESSION_PROOF_INVALID" });
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("does not allow arbitrary or merely similar origins", async () => {
    const pool = emptyPool();
    await expect(renewDesktopPersistentSession(pool as unknown as Pool, config, { ...proof, web_origin: "https://web.test.evil" }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(pool.query).not.toHaveBeenCalled();
  });
  it("refuses Lab and simulated enrollment before it can promote any authority", async () => {
    for (const userKind of ["lab_human", "simulated_human"] as const) {
      const pool = emptyPool();
      await expect(enrollDesktopPersistentSession(pool as unknown as Pool, config, { ...auth, userKind }, proof))
        .rejects.toMatchObject({ statusCode: 403, code: "DESKTOP_SESSION_INELIGIBLE" });
      expect(pool.connect).not.toHaveBeenCalled();
    }
  });
  it("a missing credential is terminal and never falls back to password or simulated login", async () => {
    const pool = emptyPool();
    await expect(renewDesktopPersistentSession(pool as unknown as Pool, config, proof))
      .rejects.toMatchObject({ statusCode: 401, code: "DESKTOP_SESSION_REVOKED" });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("checks identity and deployment audience before any renewal", async () => {
    const pool = emptyPool();
    pool.query.mockResolvedValue({ rows: [{ session_id: sessionId, account_id: accountId, user_id: userId }] });
    await expect(renewDesktopPersistentSession(pool as unknown as Pool, config, { ...proof, user_id: randomUUID() }))
      .rejects.toMatchObject({ statusCode: 401 });
    await expect(renewDesktopPersistentSession(pool as unknown as Pool, config, proof, [randomUUID()]))
      .rejects.toMatchObject({ statusCode: 403, code: "DEPLOYMENT_WORKSPACE_NOT_ADMITTED" });
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
