import { describe, expect, it } from "vitest";
import type { AuthContext } from "./auth.js";
import type { DatabaseClient } from "../database/pool.js";
import { createHarnessSourceGuard } from "./harnessSourceGuard.js";

const auth: AuthContext = { accountId: "00000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000002",
  sessionId: "00000000-0000-4000-8000-000000000003", userKind: "password_human", accountSlug: "synthetic", userEmail: "synthetic@example.invalid" };
const expiresAt = "2099-01-01T00:00:00.123456Z";
const snapshot = () => ({ version: 1, accountId: auth.accountId, userId: auth.userId, generation: "9007199254740992",
  sessionStamp: null, personIDs: [], expiresAt });
function fixture() {
  let generation = "9007199254740992", current = true, stamp: string | null = null;
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const database = { query: async (sql: string, params: unknown[]) => {
    queries.push({ sql, params });
    return { rows: [{ generation, session_stamp: stamp, current }] };
  } } as unknown as DatabaseClient;
  return { database, queries, generation: (value: string) => { generation = value; }, expire: () => { current = false; }, stamp: () => { stamp = "forbidden"; } };
}

describe("original no-Session source snapshot", () => {
  it("does not recapture the post-withdrawal generation when recovering a checkpoint", async () => {
    const f = fixture();
    const original = snapshot();
    f.generation("9007199254740993");
    // Concrete counterexample control: re-admitting the old guard at recovery
    // accepts the changed baseline. Recovery must compare the stored original.
    const naive = await createHarnessSourceGuard(f.database, auth, undefined,
      () => ({ expiresAt: new Date(expiresAt), personIDs: [] }));
    await expect(naive()).resolves.toBeUndefined();
    const { restoreLegacyChatSourceGuard } = await import("./legacyChatSourceSnapshot.js");
    const restored = restoreLegacyChatSourceGuard(f.database, auth, original);
    await expect(restored()).rejects.toMatchObject({ code: "HARNESS_SOURCE_CHANGED" });
  });

  it("captures exact BIGINT text, fixed microsecond expiry, and explicit empty scope", async () => {
    const { captureLegacyChatSourceSnapshot, restoreLegacyChatSourceGuard } = await import("./legacyChatSourceSnapshot.js");
    const f = fixture();
    const result = await captureLegacyChatSourceSnapshot(f.database, auth, expiresAt);
    expect(result).toEqual(snapshot());
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.personIDs)).toBe(true);
    const guard = restoreLegacyChatSourceGuard(f.database, auth, result);
    await expect(guard()).resolves.toBeUndefined();
    for (const q of f.queries) expect(q.params).toEqual([auth.accountId, auth.userId, null, expiresAt, []]);
    f.expire();
    await expect(guard()).rejects.toMatchObject({ code: "HARNESS_SOURCE_CHANGED" });
  });

  it.each(["scope", "session", "person", "version", "numeric_generation", "leading_zero", "overflow", "deadline", "unknown"])("rejects source snapshot %s before DB work", async kind => {
    const { restoreLegacyChatSourceGuard } = await import("./legacyChatSourceSnapshot.js");
    const value: Record<string, unknown> = snapshot();
    if (kind === "scope") value.userId = "00000000-0000-4000-8000-000000000004";
    if (kind === "session") value.sessionStamp = "session";
    if (kind === "person") value.personIDs = [auth.userId];
    if (kind === "version") value.version = 2;
    if (kind === "numeric_generation") value.generation = 9007199254740992;
    if (kind === "leading_zero") value.generation = "01";
    if (kind === "overflow") value.generation = "9223372036854775808";
    if (kind === "deadline") value.expiresAt = "2099-01-01T00:00:00.123Z";
    if (kind === "unknown") value.objective = "PRIVATE_SYNTHETIC";
    const f = fixture();
    expect(() => restoreLegacyChatSourceGuard(f.database, auth, value)).toThrow();
    expect(f.queries).toEqual([]);
  });

  it("captures original values before an asynchronous Lab probe and rejects a later generation", async () => {
    const { restoreLegacyChatSourceGuard } = await import("./legacyChatSourceSnapshot.js");
    const f = fixture();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const probe = { query: async () => { await held; return { rows: [{ state: "active", expires_at: new Date(expiresAt), stop_clear: true }] }; } } as unknown as DatabaseClient;
    const value = snapshot();
    const guard = restoreLegacyChatSourceGuard(f.database, { ...auth, userKind: "lab_human" }, value, probe);
    const pending = guard();
    f.generation("9007199254740993"); value.generation = "9007199254740993";
    release();
    await expect(pending).rejects.toMatchObject({ code: "HARNESS_SOURCE_CHANGED" });
  });

  it.each(["0", "-9223372036854775808", "9223372036854775807"])("preserves the legal PostgreSQL BIGINT text %s", async generation => {
    const { validateLegacyChatSourceSnapshot } = await import("./legacyChatSourceSnapshot.js");
    expect(validateLegacyChatSourceSnapshot({ ...snapshot(), generation }).generation).toBe(generation);
  });

  it.each(["top", "people", "revoked_proxy"])("denies %s accessors/proxies without executing caller code", async kind => {
    const { validateLegacyChatSourceSnapshot } = await import("./legacyChatSourceSnapshot.js");
    let reads = 0;
    const trap = () => { reads++; throw new Error("PRIVATE_SYNTHETIC"); };
    const value = snapshot();
    let input: unknown = value;
    if (kind === "top") Object.defineProperty(value, "generation", { get: trap });
    if (kind === "people") value.personIDs = new Proxy([], { ownKeys: trap, get: trap });
    if (kind === "revoked_proxy") { const proxy = Proxy.revocable(value, {}); proxy.revoke(); input = proxy.proxy; }
    expect(() => validateLegacyChatSourceSnapshot(input)).toThrowError("The source context changed. Retry using its current state.");
    expect(reads).toBe(0);
  });

  it("does no baseline read at restore and never revives the same failed guard", async () => {
    const { restoreLegacyChatSourceGuard } = await import("./legacyChatSourceSnapshot.js");
    const f = fixture();
    const guard = restoreLegacyChatSourceGuard(f.database, auth, snapshot());
    expect(f.queries).toEqual([]);
    f.generation("9007199254740993");
    await expect(guard()).rejects.toMatchObject({ code: "HARNESS_SOURCE_CHANGED" });
    const reads = f.queries.length;
    f.generation("9007199254740992");
    await expect(guard()).rejects.toMatchObject({ code: "HARNESS_SOURCE_CHANGED" });
    expect(f.queries).toHaveLength(reads);
  });
});
