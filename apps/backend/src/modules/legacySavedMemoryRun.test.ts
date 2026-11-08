/** Synthetic DB boundary only; these rows are not real credential/PG proof. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { BackendConfig } from "../config.js";
import type { AuthContext } from "./auth.js";
import { ApiError } from "../lib/apiError.js";
import { createHarnessSourceGuardWithBinding } from "./harnessSourceGuard.js";
import { accessLegacySavedMemoryRun, admitLegacyChatAuthority, bindLegacySavedMemoryRun,
  terminateLegacySavedMemoryRun, LegacyChatTerminated, type LegacyChatAuthority, type LegacySavedMemoryRunHandle } from "./legacyChatAuthority.js";
import { captureLegacySavedMemoryDomain, captureLegacySavedMemoryEnvelope } from "./legacySavedMemoryDomain.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const auth: AuthContext = { accountId: id(1), accountSlug: "synthetic", userId: id(2), sessionId: id(3),
  userKind: "password_human", userEmail: "synthetic@example.invalid" };
const config = { internalLabEnabled: false } as BackendConfig;
const checked = "2030-01-01T00:00:00.000000Z", until = "2030-01-01T00:01:00.000000Z";
const owners: LegacyChatAuthority[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.restoreAllMocks(); });
async function fixture(options: { kind?: "lab_human"; initializeDelay?: () => void } = {}) {
  const actor = { ...auth, userKind: options.kind ?? auth.userKind };
  const commands: string[] = [], metadata: unknown[] = [];
  let admitted = false, jointLive = true, generation = "0";
  const pool = { query: async (sql: string, params: unknown[]) => {
    commands.push(sql);
    if (sql.includes("AS original_deadline")) {
      admitted = true;
      return { rows: [{ original_deadline: "2099-01-01T00:00:00.123456Z", remaining_ms: "60000", user_kind: actor.userKind,
        token_branch: "previous", lab_binding: options.kind ? { entry: id(10), workspace: id(11), parent: id(12), principal: null,
          generation: null, ownerAccount: id(13), ownerUser: id(14), grant: null, entitlementGeneration: null, run: null } : null }] };
    }
    if (sql.includes("AS source_expires_at")) return { rows: [{ generation, session_stamp: null, current: true,
      source_expires_at: "2030-01-02T00:00:00.000000Z", session_expires_at: null, source_person_ids: params[4] }] };
    if (sql.includes("AS read_until")) {
      metadata.push(JSON.parse(params[11] as string));
      if (sql.includes("$13::bigint")) options.initializeDelay?.();
      return { rows: jointLive ? [{ available: true, checked_at: checked, read_until: until }] : [] };
    }
    if (sql.includes("SELECT state,expires_at")) return { rows: [{ state: "active", expires_at: new Date("2030-01-02"), stop_clear: true }] };
    if (!admitted) throw new Error("Synthetic owner was not admitted.");
    return { rows: [{ "?column?": 1 }] };
  } } as unknown as Pool;
  const owner = await admitLegacyChatAuthority(pool, actor, "Bearer synthetic-private-only", config);
  owners.push(owner);
  const source = await createHarnessSourceGuardWithBinding(pool, actor, undefined,
    () => ({ expiresAt: new Date("2030-01-02"), personIDs: [] }));
  const input = () => ({ auth: actor, taskID: id(4), runID: id(5), runDeadlineMonotonicMs: performance.now() + 30_000,
    source: source.source, guard: source.guard });
  return { owner, actor, input, commands, metadata, revoke: () => { jointLive = false; },
    changeSource: () => { generation = "1"; } };
}

describe("private Legacy saved Memory Run owner", () => {
  it("mints an opaque identity with original task/deadline and fresh private-slot joint SQL", async () => {
    const f = await fixture(), handle = await bindLegacySavedMemoryRun(f.owner, f.input());
    const run = accessLegacySavedMemoryRun(handle, f.owner, f.actor);
    expect(Object.keys(handle)).toEqual([]);
    expect(Object.isFrozen(handle) && Object.isFrozen(run)).toBe(true);
    expect(run.authority.taskID).toBe(id(4)); expect(run.runID).toBe(id(5));
    expect(run.authority.expiresAt).toBe(until);
    const result = await run.finalizeProof(run.reads.snapshot());
    expect(result).toEqual({ available: true, checked_at: checked, read_until: until });
    const joint = f.commands.at(-1)!;
    expect(joint).toContain("WITH tick AS MATERIALIZED");
    expect(joint).toContain("sessions.previous_token_hash=$1");
    expect(joint).toContain("tick.checked_at<$9::timestamptz");
    expect(joint).toContain("saved_memory_read_set_current($6,$7");
    expect(joint).toContain("saved_memory_discovery_current($6,$7");
    expect(Object.keys(f.metadata.at(-1) as object).sort()).toEqual(["domains", "proof", "source"]);
  });

  it.each(["clone", "proxy", "foreign-owner", "changed-login"])("rejects %s instead of accepting a structural permission object", async kind => {
    const f = await fixture(), handle = await bindLegacySavedMemoryRun(f.owner, f.input());
    if (kind === "clone" || kind === "proxy") {
      const fake = kind === "proxy" ? new Proxy(handle, {}) : JSON.parse(JSON.stringify(handle));
      expect(() => accessLegacySavedMemoryRun(fake as LegacySavedMemoryRunHandle, f.owner, f.actor)).toThrow(LegacyChatTerminated);
      expect(f.owner.signal.aborted).toBe(true);
    } else if (kind === "changed-login") {
      expect(() => accessLegacySavedMemoryRun(handle, f.owner, { ...f.actor, sessionId: id(40) })).toThrow(LegacyChatTerminated);
    } else {
      await expect(bindLegacySavedMemoryRun({ ...f.owner }, f.input())).rejects.toBeInstanceOf(LegacyChatTerminated);
      expect(() => accessLegacySavedMemoryRun(handle, new Proxy(f.owner, {}), f.actor)).toThrow(LegacyChatTerminated);
    }
  });

  it("latches a Memory rejection into old provider/fallback checks even if the tool catches it", async () => {
    const f = await fixture(), handle = await bindLegacySavedMemoryRun(f.owner, f.input());
    const run = accessLegacySavedMemoryRun(handle, f.owner, f.actor);
    f.revoke(); await expect(run.finalizeProof(run.reads.snapshot())).rejects.toBeInstanceOf(LegacyChatTerminated);
    let ran = false;
    await expect(f.owner.provider(async () => { ran = true; return "must not become201"; })).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(ran).toBe(false); expect(f.owner.signal.aborted).toBe(true);
  });

  it("rejects a foreign guard before invoking it and rejects metadata getters before reading them", async () => {
    const f = await fixture(); let invoked = 0;
    await expect(bindLegacySavedMemoryRun(f.owner, { ...f.input(), guard: async () => { invoked++; } }))
      .rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(invoked).toBe(0);
    const g = await fixture(), handle = await bindLegacySavedMemoryRun(g.owner, g.input());
    const run = accessLegacySavedMemoryRun(handle, g.owner, g.actor);
    const domain = Object.defineProperty({}, "proof", { enumerable: true, get() { invoked++; return run.reads.snapshot(); } });
    expect(() => run.finalizeRead(domain as Parameters<typeof run.finalizeRead>[0])).toThrow(LegacyChatTerminated);
    expect(invoked).toBe(0);
  });

  it("latches construction failures before a handle exists and refuses forged termination owners", async () => {
    const f = await fixture(); let invoked = false;
    expect(() => terminateLegacySavedMemoryRun(f.owner, new Error("Synthetic private construction detail")))
      .toThrow(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
    expect(f.owner.signal.reason.message).not.toContain("Synthetic private construction detail");
    await expect(f.owner.provider(async () => { invoked = true; return "must not become201"; })).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(invoked).toBe(false);
    const g = await fixture();
    for (const forged of [{ ...g.owner }, new Proxy(g.owner, {})]) {
      expect(() => terminateLegacySavedMemoryRun(forged, null)).toThrow(LegacyChatTerminated);
      expect(g.owner.signal.aborted).toBe(false);
    }
  });

  it("does not terminate a foreign real owner when given another owner's genuine handle", async () => {
    const a = await fixture(), b = await fixture();
    const first = await bindLegacySavedMemoryRun(a.owner, a.input()), second = await bindLegacySavedMemoryRun(b.owner, b.input());
    let touched = 0;
    const hooked = Object.defineProperty({ ...b.actor }, "accountId", { enumerable: true, get() { touched++; return b.actor.accountId; } });
    expect(() => accessLegacySavedMemoryRun(first, b.owner, hooked)).toThrow(LegacyChatTerminated);
    expect(touched).toBe(0);
    expect(a.owner.signal.aborted || b.owner.signal.aborted).toBe(false);
    await expect(accessLegacySavedMemoryRun(first, a.owner, a.actor).assertCurrent()).resolves.toBeUndefined();
    await expect(accessLegacySavedMemoryRun(second, b.owner, b.actor).assertCurrent()).resolves.toBeUndefined();
  });

  it("keeps the closed413 terminal class after a post-finalizer charge failure", async () => {
    const f = await fixture(), handle = await bindLegacySavedMemoryRun(f.owner, f.input());
    const run = accessLegacySavedMemoryRun(handle, f.owner, f.actor);
    await run.finalizeProof(run.reads.snapshot());
    expect(() => run.terminate(new ApiError(413, "SAVED_MEMORY_BUDGET_LIMITED", "Synthetic private prose")))
      .toThrow(LegacyChatTerminated);
    expect(f.owner.signal.reason).toMatchObject({ code: "SAVED_MEMORY_BUDGET_LIMITED", statusCode: 413 });
    expect(f.owner.signal.reason.message).not.toContain("Synthetic private prose");
    await expect(f.owner.assertCurrent()).rejects.toBe(f.owner.signal.reason);
  });

  it("charges the complete initialization roundtrip against the original Core deadline", async () => {
    let now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = await fixture({ initializeDelay: () => { now = 5000; } });
    await expect(bindLegacySavedMemoryRun(f.owner, { ...f.input(), runDeadlineMonotonicMs: 2000 }))
      .rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("applies the original Core deadline to the old synchronous terminal check after binding", async () => {
    let now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = await fixture();
    await bindLegacySavedMemoryRun(f.owner, { ...f.input(), runDeadlineMonotonicMs: 2000 });
    now = 2001;
    expect(() => f.owner.throwIfTerminated()).toThrow(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("refuses a Lab binding whose original proof never captured its Lab deadline", async () => {
    const f = await fixture({ kind: "lab_human" });
    await expect(bindLegacySavedMemoryRun(f.owner, f.input())).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.commands.some(sql => sql.includes("AS read_until"))).toBe(false);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("rechecks the actual source before the last joint and retires changed source metadata", async () => {
    const f = await fixture(), handle = await bindLegacySavedMemoryRun(f.owner, f.input());
    const run = accessLegacySavedMemoryRun(handle, f.owner, f.actor), count = f.metadata.length;
    f.changeSource(); await expect(run.assertCurrent()).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.metadata).toHaveLength(count);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("rejects malformed envelopes and query domains without publishing arbitrary data", () => {
    expect(() => captureLegacySavedMemoryEnvelope({ available: true, checked_at: checked, read_until: until, sql: "private" })).toThrow();
    expect(() => captureLegacySavedMemoryEnvelope({ available: false, checked_at: checked, read_until: until })).toThrow();
    expect(() => captureLegacySavedMemoryDomain({ available: true })).toThrow();
  });
});
