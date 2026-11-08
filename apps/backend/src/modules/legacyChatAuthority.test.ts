import { afterEach, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { admitLegacyChatAuthority, LegacyChatTerminated, type LegacyChatAuthority } from "./legacyChatAuthority.js";
import { guardLegacyProvider } from "./legacyChatProviderGuard.js";

const auth: AuthContext = { accountId: "00000000-0000-4000-8000-000000000001", accountSlug: "synthetic",
  userId: "00000000-0000-4000-8000-000000000002", sessionId: "00000000-0000-4000-8000-000000000003",
  userKind: "password_human", userEmail: "synthetic@example.invalid" };
const config = { internalLabEnabled: false } as BackendConfig;
const admissions: LegacyChatAuthority[] = [];
afterEach(() => { for (const item of admissions.splice(0)) item.dispose(); });

async function fixture(sourceFailureCode?: "CHAT_COMPLETION_SOURCE_CHANGED") {
  let live = true, admission = true, databaseFails = false;
  const commands: string[] = [];
  const pool = { query: async (sql: string) => {
    commands.push(sql);
    if (databaseFails) throw new Error("Synthetic database failure");
    if (admission) {
      admission = false;
      return { rows: [{ original_deadline: "2099-01-01T00:00:00.123456Z", remaining_ms: "60000",
        user_kind: auth.userKind, token_branch: "previous", lab_binding: null }], rowCount: 1 };
    }
    if (sql.includes("WITH tick")) return { rows: live ? [{ "?column?": 1 }] : [], rowCount: live ? 1 : 0 };
    return { rows: [{ id: auth.sessionId }], rowCount: 1 };
  } } as unknown as Pool;
  const authority = await admitLegacyChatAuthority(pool, auth, "Bearer synthetic-unit-only", config, undefined, sourceFailureCode);
  admissions.push(authority);
  return { authority, pool, commands, revoke: () => { live = false; }, fail: () => { databaseFails = true; } };
}

describe("legacy original-credential fences (synthetic database boundary)", () => {
  it("retains real provider capabilities, metadata, request guard absence and method this", async () => {
    const f = await fixture();
    const provider = { model: "synthetic", calls: 0, answer(input: object) {
      expect(this).toBe(provider);
      expect("assertCurrent" in input).toBe(false);
      this.calls++;
      return Promise.resolve("answer");
    } };
    const guarded = guardLegacyProvider(provider, f.authority, async () => {});
    expect("run" in guarded).toBe(false);
    expect((guarded as unknown as { run?: unknown }).run).toBeUndefined();
    expect(guarded.model).toBe("synthetic");
    expect(await guarded.answer({})).toBe("answer");
    expect(provider.calls).toBe(1);
    expect(f.commands.slice(1).every(sql => !sql.includes("FOR SHARE"))).toBe(true);
  });

  it("rejects a late answer and latches failure even if the provider catches a withdrawn tool", async () => {
    const f = await fixture();
    let calls = 0, tools = 0;
    const provider = { run: async (_request: object, invoke: () => Promise<unknown>) => {
      calls++;
      f.revoke();
      await invoke().catch(() => null);
      return "late answer";
    } };
    const guarded = guardLegacyProvider(provider, f.authority);
    await expect(guarded.run({}, async () => { tools++; })).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(calls).toBe(1);
    expect(tools).toBe(0);
    expect(f.authority.signal.aborted).toBe(true);
    await expect(guarded.run({}, async () => {})).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(calls).toBe(1);
  });

  it("retains an existing source guard, checks around host callbacks and passes cancellation", async () => {
    const f = await fixture();
    let checks = 0, toolCalls = 0;
    const original = new AbortController();
    const provider = { async run(request: { assertCurrent?: () => Promise<void> },
      invoke: () => Promise<unknown>, signal?: AbortSignal) {
      expect(this).toBe(provider);
      expect(request.assertCurrent).toBeTypeOf("function");
      await request.assertCurrent!();
      await invoke();
      expect(signal?.aborted).toBe(false);
      original.abort();
      expect(signal?.aborted).toBe(true);
      return "done";
    } };
    await expect(guardLegacyProvider(provider, f.authority).run({ assertCurrent: async () => { checks++; } },
      async () => { toolCalls++; }, original.signal)).resolves.toBe("done");
    expect(checks).toBeGreaterThanOrEqual(5);
    expect(toolCalls).toBe(1);
  });

  it("allows ordinary provider errors and input errors to retain existing fallback semantics", async () => {
    const f = await fixture();
    let calls = 0;
    const provider = guardLegacyProvider({ answer: async () => {
      if (++calls === 1) throw new Error("Synthetic provider unavailable");
      return "fallback answer";
    } }, f.authority);
    await expect(provider.answer()).rejects.toThrow("Synthetic provider unavailable");
    await expect(provider.answer()).resolves.toBe("fallback answer");
    await expect(f.authority.host(async () => { throw new ApiError(400, "INVALID_INPUT", "Synthetic input"); }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(f.authority.assertCurrent()).resolves.toBeUndefined();
  });

  it("keeps the scoped source code terminal without exposing the original source error", async () => {
    const f = await fixture("CHAT_COMPLETION_SOURCE_CHANGED");
    let calls = 0;
    const guarded = guardLegacyProvider({ answer: async (_request: object) => { calls++; return "must not run"; } },
      f.authority, async () => { throw new ApiError(409, "HARNESS_SOURCE_CHANGED", "Synthetic private source detail"); });
    await expect(guarded.answer({})).rejects.toMatchObject({ code: "CHAT_COMPLETION_SOURCE_CHANGED", statusCode: 409 });
    await expect(guarded.answer({})).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(calls).toBe(0);
    expect(f.authority.signal.aborted).toBe(true);
    expect(f.authority.signal.reason).toBeInstanceOf(LegacyChatTerminated);
    expect(f.authority.signal.reason.message).not.toContain("Synthetic private source detail");
    await expect(f.authority.assertCurrent()).rejects.toMatchObject({ code: "CHAT_COMPLETION_SOURCE_CHANGED" });
  });

  it("keeps disposal before a late known-source rejection on the same terminal instance", async () => {
    const f = await fixture("CHAT_COMPLETION_SOURCE_CHANGED");
    let rejectSource!: (error: Error) => void;
    const pending = f.authority.source(() => new Promise<never>((_resolve, reject) => { rejectSource = reject; }));
    f.authority.dispose();
    const first = f.authority.signal.reason;
    expect(first).toMatchObject({ code: "LEGACY_CHAT_AUTHORITY_UNAVAILABLE" });
    const rejection = expect(pending).rejects.toBe(first);
    rejectSource(new ApiError(409, "HARNESS_SOURCE_CHANGED", "Synthetic late source detail"));
    await rejection;
    await expect(f.authority.assertCurrent()).rejects.toBe(first);
    expect(f.authority.signal.reason).toBe(first);
  });

  it("keeps source rejection before later disposal on the same terminal instance", async () => {
    const f = await fixture("CHAT_COMPLETION_SOURCE_CHANGED");
    await expect(f.authority.source(async () => { throw new ApiError(409, "HARNESS_SOURCE_CHANGED", "Synthetic source detail"); }))
      .rejects.toMatchObject({ code: "CHAT_COMPLETION_SOURCE_CHANGED" });
    const first = f.authority.signal.reason;
    f.authority.dispose();
    await expect(f.authority.assertCurrent()).rejects.toBe(first);
    expect(f.authority.signal.reason).toBe(first);
  });

  it.each(["revoked", "database", "unknown-source"] as const)("does not label %s as a known scoped source change", async kind => {
    const f = await fixture("CHAT_COMPLETION_SOURCE_CHANGED");
    if (kind === "revoked") f.revoke();
    if (kind === "database") f.fail();
    const operation = kind === "unknown-source"
      ? f.authority.source(async () => { throw new Error("Synthetic unknown source failure"); })
      : f.authority.provider(async () => "must not return");
    await expect(operation).rejects.toMatchObject({ code: "LEGACY_CHAT_AUTHORITY_UNAVAILABLE" });
    expect(f.authority.signal.aborted).toBe(true);
    await expect(f.authority.provider(async () => "must not return")).rejects.toBeInstanceOf(LegacyChatTerminated);
  });

  it("does not turn source or database failure into a reusable fallback capability", async () => {
    const f = await fixture();
    const provider = guardLegacyProvider({ answer: async (request: { readEvidenceImage: () => Promise<unknown> }) => {
      await request.readEvidenceImage().catch(() => null);
      return "hidden failure";
    } }, f.authority);
    await expect(provider.answer({ readEvidenceImage: async () => { throw new Error("Synthetic file unavailable"); } }))
      .rejects.toBeInstanceOf(LegacyChatTerminated);
    const second = await fixture();
    second.fail();
    await expect(second.authority.provider(async () => "not called")).rejects.toBeInstanceOf(LegacyChatTerminated);
  });

  it("fences swallowed database errors, permits only rollback cleanup, and rejects released-client late work", async () => {
    const f = await fixture();
    let late: PoolClient | undefined;
    const client = { query: async (sql: string) => {
      if (sql === "BROKEN") throw new Error("Synthetic failed statement");
      return { rows: [{}], rowCount: 1 };
    } } as unknown as PoolClient;
    await expect(f.authority.withClient(client, async guarded => {
      late = guarded;
      await guarded.query("BROKEN").catch(() => undefined);
      await guarded.query("ROLLBACK TO SAVEPOINT synthetic");
      expect(() => guarded.query("SELECT 1")).toThrow(LegacyChatTerminated);
    })).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(() => late!.query("ROLLBACK")).toThrow(LegacyChatTerminated);
  });

  it("rechecks owner after the final asynchronous source read", async () => {
    const f = await fixture();
    f.authority.observeSource(async () => { f.revoke(); });
    await expect(f.authority.assertFinalCurrent(f.pool)).rejects.toBeInstanceOf(LegacyChatTerminated);
  });

  it("keeps source reads terminal when disposal wins a late source result", async () => {
    const f = await fixture();
    await expect(f.authority.source(async () => { f.authority.dispose(); return "late bytes"; }))
      .rejects.toBeInstanceOf(LegacyChatTerminated);
  });
});

// These are the actual SessionStore methods owned by harnessSessions. A final
// provider rejection is too late if mirror bytes already reached its caller.
async function continuationStoreBoundary(method: "append" | "load" | "listSubkeys" | "delete" | "listSessions" | "listSessionSummaries", phase: "before" | "during") {
  const f = await fixture();
  let mode: "control" | "before" | "during" = "control", calls = 0, delivered = 0;
  let observedThis: unknown;
  const operation = async function(this: unknown) {
    observedThis = this; calls++;
    if (mode === "during") f.revoke();
    await Promise.resolve();
    return "synthetic-mirror-only";
  };
  const store = { append: operation, load: operation, listSubkeys: operation, delete: operation,
    listSessions: operation, listSessionSummaries: operation };
  const provider = { async run(request: { continuation: () => Promise<{ store: typeof store }> }) {
    const mirror = await request.continuation();
    if (mode === "before") f.revoke();
    const value = await mirror.store[method]();
    delivered++;
    return value;
  } };
  const guarded = guardLegacyProvider(provider, f.authority);
  const request = { continuation: async () => ({ store }) };
  await expect(guarded.run(request)).resolves.toBe("synthetic-mirror-only");
  expect(calls).toBe(1); expect(delivered).toBe(1);
  const controlThis = observedThis;
  calls = 0; delivered = 0; mode = phase;
  await expect(guarded.run(request)).rejects.toBeInstanceOf(LegacyChatTerminated);
  expect.soft(calls).toBe(phase === "before" ? 0 : 1);
  expect.soft(delivered).toBe(0);
  expect.soft(controlThis === store).toBe(true);
}

describe("continuation mirror original-login boundary", () => {
  it.each(["append", "load", "listSubkeys", "delete", "listSessions", "listSessionSummaries"] as const)("denies %s before a revoked-login callback executes", async method => {
    await continuationStoreBoundary(method, "before");
  });
  it.each(["append", "load", "listSubkeys", "delete", "listSessions", "listSessionSummaries"] as const)("denies %s data after revocation during its await", async method => {
    await continuationStoreBoundary(method, "during");
  });
});
