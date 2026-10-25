import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { BackendConfig } from "../config.js";
import type { AuthContext } from "./auth.js";
import { persistentAccessRenewal, enrollPersistentSession, renewPersistentSession, revokePersistentSession } from "./persistentSession.js";
import { desktopAccessRenewal } from "./desktopPersistentSession.js";

const secret = "x".repeat(43), sessionId = randomUUID();
const now = new Date("2026-10-25T08:00:00Z"), ttl = 28_800;
const config = { sessionTtlSeconds: ttl } as BackendConfig;

describe("bounded first-party access generations", () => {
  it("recovers a lost response without sliding the generation's access deadline", () => {
    const first = persistentAccessRenewal(secret, sessionId, { generation: 0, expiresAt: now }, now, ttl);
    const retry = persistentAccessRenewal(secret, sessionId, first, new Date(now.getTime() + 1_000), ttl);
    expect(first.generation).toBe(1);
    expect(retry.accessToken).toBe(first.accessToken);
    expect(retry.expiresAt).toEqual(first.expiresAt);
    expect(retry.rotate).toBe(false);
  });
  it("renews after ten years while access stays bounded and Mac remains a different protocol", () => {
    const first = persistentAccessRenewal(secret, sessionId, { generation: 0, expiresAt: now }, now, ttl);
    const later = new Date("2036-10-25T08:00:00Z");
    const next = persistentAccessRenewal(secret, sessionId, first, later, ttl);
    expect(next.generation).toBe(2);
    expect(next.accessToken).not.toBe(first.accessToken);
    expect(next.expiresAt.getTime() - later.getTime()).toBe(ttl * 1_000);
    expect(first.expiresAt.toISOString()).toBe("2026-10-25T16:00:00.000Z");
    expect(first.accessToken).not.toBe(desktopAccessRenewal(secret, sessionId,
      { generation: 0, expiresAt: now }, now, ttl).accessToken);
    expect(first.accessToken).toBe(createHmac("sha256", secret)
      .update(`capri:first-party-access:v1:${sessionId}:1`).digest("base64url"));
  });
  it("rotates at half TTL and binds each generation to exactly one canonical session", () => {
    const first = persistentAccessRenewal(secret, sessionId, { generation: 0, expiresAt: now }, now, ttl);
    expect(persistentAccessRenewal(secret, sessionId, first, new Date("2026-10-25T11:59:59Z"), ttl).rotate).toBe(false);
    expect(persistentAccessRenewal(secret, sessionId, first, new Date("2026-10-25T12:00:00Z"), ttl).generation).toBe(2);
    expect(persistentAccessRenewal(secret, randomUUID(), { generation: 0, expiresAt: now }, now, ttl).accessToken)
      .not.toBe(first.accessToken);
  });
  it.each([0, -1, NaN, 1.5])("rejects invalid TTL %s", ttlSeconds => {
    expect(() => persistentAccessRenewal(secret, sessionId, { generation: 0, expiresAt: now }, now, ttlSeconds)).toThrow();
  });
});

describe("ordinary real-user persistence admission", () => {
  const accountId = randomUUID(), userId = randomUUID();
  const auth = { accountId, userId, sessionId, userKind: "password_human" } as AuthContext;
  const proof = { renewal_secret: secret, account_id: accountId, user_id: userId, session_id: sessionId };
  const emptyPool = () => ({ query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() });
  it("rejects malformed secret without opening a database connection", async () => {
    const pool = emptyPool();
    await expect(renewPersistentSession(pool as unknown as Pool, config, { ...proof, renewal_secret: "short" }))
      .rejects.toMatchObject({ statusCode: 400, code: "PERSISTENT_SESSION_PROOF_INVALID" });
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("rejects malformed destructive-only proof without opening a database connection", async () => {
    const pool = emptyPool();
    await expect(revokePersistentSession(pool as unknown as Pool, config,
      { ...proof, original_access_token: "short" }))
      .rejects.toMatchObject({ statusCode: 400, code: "PERSISTENT_SESSION_PROOF_INVALID" });
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it.each(["lab_human", "simulated_human"] as const)("does not promote %s to permanent login", async userKind => {
    const pool = emptyPool();
    await expect(enrollPersistentSession(pool as unknown as Pool, config,
      { ...auth, userKind }, { renewal_secret: secret, client_kind: "ios" }))
      .rejects.toMatchObject({ statusCode: 403, code: "PERSISTENT_SESSION_INELIGIBLE" });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("never searches another identity or session when a capability is missing or mismatched", async () => {
    const pool = emptyPool();
    await expect(renewPersistentSession(pool as unknown as Pool, config, proof))
      .rejects.toMatchObject({ statusCode: 401, code: "PERSISTENT_SESSION_REVOKED" });
    pool.query.mockResolvedValue({ rows: [{ session_id: sessionId, account_id: accountId, user_id: userId }] });
    for (const input of [{ ...proof, session_id: randomUUID() }, { ...proof, user_id: randomUUID() },
      { ...proof, account_id: randomUUID() }]) {
      await expect(renewPersistentSession(pool as unknown as Pool, config, input))
        .rejects.toMatchObject({ code: "PERSISTENT_SESSION_REVOKED" });
    }
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("keeps deployment audience rejection distinct from credential revocation", async () => {
    const pool = emptyPool();
    pool.query.mockResolvedValue({ rows: [{ session_id: sessionId, account_id: accountId, user_id: userId }] });
    await expect(renewPersistentSession(pool as unknown as Pool, config, proof, [randomUUID()]))
      .rejects.toMatchObject({ statusCode: 403, code: "DEPLOYMENT_WORKSPACE_NOT_ADMITTED" });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("propagates infrastructure failures without converting them to sign-out", async () => {
    const pool = emptyPool(), unavailable = new Error("Synthetic database unavailable");
    pool.query.mockRejectedValue(unavailable);
    await expect(renewPersistentSession(pool as unknown as Pool, config, proof)).rejects.toBe(unavailable);
  });
});
