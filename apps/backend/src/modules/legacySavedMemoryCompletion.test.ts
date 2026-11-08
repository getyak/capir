/** Synthetic owner/SQL boundary tests only. These rows are not real PostgreSQL
 * completion, credential or publication evidence; the separate PG gate is. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { BackendConfig } from "../config.js";
import type { AuthContext } from "./auth.js";
import { createHarnessSourceGuardWithBinding } from "./harnessSourceGuard.js";
import { accessLegacySavedMemoryRun, admitLegacyChatAuthority, bindLegacySavedMemoryRun,
  LegacyChatTerminated, readLegacySavedMemoryPublication, restoreLegacyChatAuthority,
  sealLegacySavedMemoryRun, type LegacyChatAuthority } from "./legacyChatAuthority.js";
import { savedMemoryDurableProofDigest, type SavedMemoryDurableProofV2 } from "./savedMemoryDurableLineage.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const auth: AuthContext = { accountId: id(1), accountSlug: "synthetic", userId: id(2), sessionId: id(3),
  userKind: "password_human", userEmail: "synthetic@example.invalid" };
const config = { internalLabEnabled: false } as BackendConfig;
const checked = "2030-01-01T00:00:00.000000Z", until = "2030-01-01T00:01:00.000000Z";
const owners: LegacyChatAuthority[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.restoreAllMocks(); });
const retained: SavedMemoryDurableProofV2 = { version: 2, account_id: auth.accountId, reader_actor_id: auth.userId,
  task_id: id(4), completion_idempotency_id: id(6), retention_kind: "canonical_no_session",
  source_origin_session_id: null, expires_at: null, stamps: [] };
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function fixture() {
  const commands: { where: "pool" | "held"; sql: string }[] = [];
  let failPoolJoint = false, heldPublicationLive = true, canonical = false, hold: ReturnType<typeof deferred> | undefined;
  let sourceHold: ReturnType<typeof deferred> | undefined, sourceEntered: ReturnType<typeof deferred> | undefined;
  let finalHold: ReturnType<typeof deferred> | undefined, finalEntered: ReturnType<typeof deferred> | undefined;
  let entered: ReturnType<typeof deferred> | undefined, publication: unknown = retained, digest = savedMemoryDurableProofDigest(retained);
  let afterPublication: (() => void) | undefined;
  const pool = { query: async (sql: string, params: unknown[]) => {
    commands.push({ where: "pool", sql });
    if (sql.includes("AS original_deadline")) return { rows: [{ original_deadline: "2099-01-01T00:00:00.123456Z", remaining_ms: "120000",
      user_kind: auth.userKind, token_branch: "previous", lab_binding: null }] };
    if (sql.includes("AS source_expires_at")) {
      if (sourceHold) { const current = sourceHold; sourceHold = undefined; sourceEntered!.release(); await current.promise; }
      return { rows: [{ generation: "0", session_stamp: null, current: true,
        source_expires_at: "2030-01-02T00:00:00.000000Z", session_expires_at: null, source_person_ids: params[4] }] };
    }
    if (sql.includes("t.proof_digest")) {
      afterPublication?.();
      return { rows: publication === null ? [] : [{ available: true, checked_at: checked, read_until: until, proof: publication, proof_digest: digest }] };
    }
    if (sql.includes("AS read_until")) {
      if (hold) { const current = hold; hold = undefined; entered!.release(); await current.promise; }
      return { rows: failPoolJoint ? [] : [{ available: true, checked_at: checked, read_until: until }] };
    }
    if (sql.includes("SELECT state,expires_at")) return { rows: [{ state: "active", expires_at: new Date("2030-01-02"), stop_clear: true }] };
    if (sql.includes("AS remaining_ms")) return { rows: [{ remaining_ms: "120000" }] };
    return { rows: [{ "?column?": 1 }], rowCount: 1 };
  } } as unknown as Pool;
  const owner = await admitLegacyChatAuthority(pool, auth, "Bearer synthetic-private-only", config); owners.push(owner);
  const source = await createHarnessSourceGuardWithBinding(pool, auth, undefined,
    () => ({ expiresAt: new Date("2030-01-02"), personIDs: [] }));
  const client = { query: async (sql: string) => {
    commands.push({ where: "held", sql });
    if (sql.includes("AS read_until")) {
      if (finalHold) { const current = finalHold; finalHold = undefined; finalEntered!.release(); await current.promise; }
      if (sql.includes("t.proof_digest")) return { rows: heldPublicationLive && publication !== null
        ? [{ available: true, checked_at: checked, read_until: until, proof: publication, proof_digest: digest }] : [] };
      return { rows: canonical ? [{ available: true, checked_at: checked, read_until: until }] : [] };
    }
    return { rows: [{ id: id(1) }], rowCount: 1 };
  } } as unknown as PoolClient;
  return { owner, pool, client, commands,
    bind: () => bindLegacySavedMemoryRun(owner, { auth, taskID: id(4), runID: id(5), runDeadlineMonotonicMs: performance.now() + 30_000,
      source: source.source, guard: source.guard }),
    canonical: () => { canonical = true; failPoolJoint = true; },
    revokePoolJoint: () => { failPoolJoint = true; },
    revokeHeldPublication: () => { heldPublicationLive = false; },
    observeSource: () => { owner.observeSource(source.guard); },
    hold: () => { hold = deferred(); entered = deferred(); return { release: hold.release, entered: entered.promise }; },
    holdSource: () => { sourceHold = deferred(); sourceEntered = deferred(); return { release: sourceHold.release, entered: sourceEntered.promise }; },
    holdFinal: () => { finalHold = deferred(); finalEntered = deferred(); return { release: finalHold.release, entered: finalEntered.promise }; },
    publication: (value: unknown, hash = digest) => { publication = value; digest = hash; },
    afterPublication: (fn: () => void) => { afterPublication = fn; } };
}

describe("sealed Legacy completion and independent current-reader publication", () => {
  it("uses the owned held client at finalization and at withClient return while ordinary checks remain fresh-pool", async () => {
    const f = await fixture(), handle = await f.bind(), run = accessLegacySavedMemoryRun(handle, f.owner, auth);
    const proof = await sealLegacySavedMemoryRun(handle, f.owner, auth);
    expect(proof).toEqual(run.reads.snapshot());
    await expect(run.assertCurrent()).resolves.toBeUndefined();
    await f.owner.withClient(f.client, async held => {
      await f.owner.lockAccountsForFinalization(held); await f.owner.lockReadersForFinalization(held);
      f.canonical(); // Synthetic own writes are deliberately invisible to pool.
      await f.owner.assertFinalCurrent(held);
    });
    const finals = f.commands.filter(c => c.sql.includes("agent_session_chat_sources_available"));
    expect(finals).toHaveLength(2); expect(finals.every(c => c.where === "held")).toBe(true);
    for (const { sql } of finals) {
      expect(sql).toContain("SELECT statement_timestamp() AS checked_at");
      expect(sql).toContain("saved_memory_task_current($6,$13::uuid,$7,tick.checked_at)");
      expect(sql).toContain("d.stamps=$12::jsonb->'proof'->'stamps'");
      expect(sql).toContain("saved_memory_discovery_current($6,$7");
    }
    expect(f.owner.signal.aborted).toBe(false);
  });

  it("drains an already accepted finalizer before sealing the original immutable read-set", async () => {
    const f = await fixture(), handle = await f.bind(), run = accessLegacySavedMemoryRun(handle, f.owner, auth);
    const held = f.hold(), pending = run.finalizeProof(run.reads.snapshot());
    await held.entered;
    let resolved = false;
    const sealing = sealLegacySavedMemoryRun(handle, f.owner, auth).then(value => { resolved = true; return value; });
    try { await Promise.resolve(); expect(resolved).toBe(false); }
    finally { held.release(); }
    await pending;
    const proof = await sealing;
    expect(proof).toBe(await sealLegacySavedMemoryRun(handle, f.owner, auth));
    expect(Object.isFrozen(proof)).toBe(true);
    expect(() => run.reads.admit([])).toThrow();
    expect(f.owner.signal.aborted).toBe(false);
  });

  it("rechecks the complete current proof at seal before admitting it to the canonical writer", async () => {
    const f = await fixture(), handle = await f.bind(), run = accessLegacySavedMemoryRun(handle, f.owner, auth);
    await run.assertCurrent();
    f.revokePoolJoint();
    await expect(sealLegacySavedMemoryRun(handle, f.owner, auth)).rejects.toBeInstanceOf(LegacyChatTerminated);
    const last = f.commands.at(-1)!;
    expect(last.where).toBe("pool"); expect(last.sql).toContain("saved_memory_read_set_current");
    expect(last.sql).not.toContain("agent_session_chat_sources_available");
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("latches any new producer after seal instead of silently widening the completed read-set", async () => {
    const f = await fixture(), handle = await f.bind(), run = accessLegacySavedMemoryRun(handle, f.owner, auth);
    await sealLegacySavedMemoryRun(handle, f.owner, auth);
    expect(() => run.finalizeProof(run.reads.snapshot())).toThrow(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("refuses an unowned final client and cannot use a genuine foreign handle to terminate another owner", async () => {
    const a = await fixture(), b = await fixture(), handle = await a.bind();
    let touched = 0;
    const hooked = Object.defineProperty({ ...auth }, "accountId", { enumerable: true, get() { touched++; return auth.accountId; } });
    await expect(sealLegacySavedMemoryRun(handle, b.owner, hooked)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(touched).toBe(0); expect(a.owner.signal.aborted || b.owner.signal.aborted).toBe(false);
    await sealLegacySavedMemoryRun(handle, a.owner, auth);
    await expect(a.owner.withClient(a.client, async () => { await a.owner.assertFinalCurrent(b.client); }))
      .rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(a.owner.signal.aborted).toBe(true); expect(b.owner.signal.aborted).toBe(false);
  });

  it("refuses a queued raw finalizer after its actual withClient lease has closed", async () => {
    const f = await fixture(), handle = await f.bind();
    await sealLegacySavedMemoryRun(handle, f.owner, auth);
    const main = f.holdFinal();
    const returning = f.owner.withClient(f.client, async () => { f.canonical(); });
    const returned = returning.then(() => true, error => error);
    let source: ReturnType<typeof f.holdSource> | undefined;
    let late: Promise<unknown> | undefined;
    try {
      await main.entered;
      source = f.holdSource();
      late = f.owner.assertFinalCurrent(f.client).then(() => false, error => error);
      main.release();
      await source.entered;
      expect(await returned).toBe(true); // active/raw/guarded lease is now closed.
    } finally { main.release(); source?.release(); }
    expect(await late).toBeInstanceOf(LegacyChatTerminated);
    expect(f.commands.filter(c => c.where === "held" && c.sql.includes("AS read_until"))).toHaveLength(1);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("reads exact retained V2 through one new current-reader command without old Run/query metadata or a new retained TTL", async () => {
    const f = await fixture(), before = f.commands.length;
    expect(await readLegacySavedMemoryPublication(f.owner, auth, id(4))).toEqual(retained);
    const commands = f.commands.slice(before); expect(commands).toHaveLength(1);
    const sql = commands[0]!.sql;
    expect(commands[0]!.where).toBe("pool");
    expect(sql).toContain("SELECT statement_timestamp() AS checked_at");
    expect(sql).toContain("sessions.previous_token_hash=$1");
    expect(sql).toContain("agent_session_chat_sources_available($6,$12::text)");
    expect(sql).toContain("saved_memory_task_current($6,$12::uuid,$7,tick.checked_at)");
    expect(sql).not.toContain("saved_memory_discovery_current"); expect(sql).not.toContain("$13");
    expect(f.owner.signal.aborted).toBe(false);
    await expect(f.bind()).rejects.toBeInstanceOf(LegacyChatTerminated);
  });

  it("keeps the exact current-reader publication as the final held fence after account/reader locks", async () => {
    const f = await fixture();
    await readLegacySavedMemoryPublication(f.owner, auth, id(4));
    const before = f.commands.length;
    await f.owner.withClient(f.client, async held => {
      await f.owner.lockAccountsForFinalization(held); await f.owner.lockReadersForFinalization(held);
      await f.owner.assertFinalCurrent(held);
    });
    const finals = f.commands.slice(before).filter(c => c.sql.includes("t.proof_digest"));
    expect(finals).toHaveLength(2); expect(finals.every(c => c.where === "held")).toBe(true);
    expect(finals.every(c => c.sql.includes("saved_memory_task_current"))).toBe(true);
    expect(f.owner.signal.aborted).toBe(false);
    await expect(f.owner.assertFinalCurrent(f.client)).rejects.toBeInstanceOf(LegacyChatTerminated);
  });

  it("refuses current-reader publication withdrawal after its successful initial fresh snapshot", async () => {
    const f = await fixture(); await readLegacySavedMemoryPublication(f.owner, auth, id(4));
    f.revokeHeldPublication();
    await expect(f.owner.withClient(f.client, async held => { await f.owner.assertFinalCurrent(held); }))
      .rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it.each(["task", "proof"] as const)("refuses a later %s substitution for the one current-reader publication", async kind => {
    const f = await fixture(); await readLegacySavedMemoryPublication(f.owner, auth, id(4));
    if (kind === "task") {
      const before = f.commands.length;
      await expect(readLegacySavedMemoryPublication(f.owner, auth, id(40))).rejects.toBeInstanceOf(LegacyChatTerminated);
      expect(f.commands).toHaveLength(before);
    } else {
      const changed = { ...retained, completion_idempotency_id: id(60) };
      f.publication(changed, savedMemoryDurableProofDigest(changed));
      await expect(f.owner.withClient(f.client, async held => { await f.owner.assertFinalCurrent(held); }))
        .rejects.toBeInstanceOf(LegacyChatTerminated);
    }
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("rejects a queued raw publication fence once the actual current-reader lease has closed", async () => {
    const f = await fixture(); await readLegacySavedMemoryPublication(f.owner, auth, id(4)); f.observeSource();
    const main = f.holdFinal(), returning = f.owner.withClient(f.client, async () => {});
    const returned = returning.then(() => true, error => error);
    let source: ReturnType<typeof f.holdSource> | undefined, late: Promise<unknown> | undefined;
    try {
      await main.entered; source = f.holdSource();
      late = f.owner.assertFinalCurrent(f.client).then(() => false, error => error);
      main.release(); await source.entered; expect(await returned).toBe(true);
    } finally { main.release(); source?.release(); }
    expect(await late).toBeInstanceOf(LegacyChatTerminated);
    expect(f.commands.filter(c => c.where === "held" && c.sql.includes("t.proof_digest"))).toHaveLength(1);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it.each(["missing", "v1", "digest"] as const)("refuses %s retained metadata and latches the actual reader", async kind => {
    const f = await fixture();
    f.publication(kind === "missing" ? null : kind === "v1" ? { version: 1 } : retained, kind === "digest" ? "0".repeat(64) : undefined);
    await expect(readLegacySavedMemoryPublication(f.owner, auth, id(4))).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("rejects forged, restored and execution-bound reader owners without invoking a forged owner", async () => {
    const a = await fixture(); let touched = 0;
    const hooked = Object.defineProperty({ ...auth }, "accountId", { enumerable: true, get() { touched++; return auth.accountId; } });
    for (const fake of [{ ...a.owner }, new Proxy(a.owner, {})])
      await expect(readLegacySavedMemoryPublication(fake, hooked, id(4))).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(touched).toBe(0); expect(a.owner.signal.aborted).toBe(false);
    const restored = await restoreLegacyChatAuthority(a.pool, auth, a.owner.snapshotOriginal(), config); owners.push(restored);
    await expect(readLegacySavedMemoryPublication(restored, auth, id(4))).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(a.owner.signal.aborted).toBe(false);
    const b = await fixture(); await b.bind();
    await expect(readLegacySavedMemoryPublication(b.owner, auth, id(4))).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(b.owner.signal.aborted).toBe(true);
  });

  it.each(["accountId", "userId", "sessionId", "userKind"] as const)(
    "refuses a current-reader %s substitution before any database operation", async key => {
      const f = await fixture(), before = f.commands.length;
      const changed = { ...auth, [key]: key === "userKind" ? "lab_human" : id(90) };
      await expect(readLegacySavedMemoryPublication(f.owner, changed, id(4))).rejects.toBeInstanceOf(LegacyChatTerminated);
      expect(f.commands).toHaveLength(before); expect(f.owner.signal.aborted).toBe(true);
    },
  );

  it("keeps the earlier actual reader SQL horizon through later awaits instead of renewing the credential floor", async () => {
    let now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = await fixture();
    expect((await readLegacySavedMemoryPublication(f.owner, auth, id(4))).expires_at).toBeNull();
    now = 61_001; // SQL horizon60s elapsed; original admitted credential120s has not.
    expect(() => f.owner.throwIfTerminated()).toThrow(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("charges the full current-reader ACK against the captured SQL horizon without adding an expiry to its proof", async () => {
    let now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = await fixture(); f.afterPublication(() => { now += 60_001; });
    await expect(readLegacySavedMemoryPublication(f.owner, auth, id(4))).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true); expect(retained.expires_at).toBeNull();
  });
});
