/** Synthetic SQL boundary/race cases only. They invoke the real opaque receipt
 * producer/consumer; synthetic rows are not Auth, PostgreSQL or HTTP evidence. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { BackendConfig } from "../config.js";
import type { DatabaseClient } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import { createHarnessSourceGuardWithBinding } from "./harnessSourceGuard.js";
import { accessLegacySavedMemoryRun, admitLegacyChatAuthority, bindLegacySavedMemoryRun,
  assertLegacySavedMemoryHistoryReceiptOwner, inheritLegacySavedMemoryHistory, isForeignLegacySavedMemoryHistoryError,
  LegacyChatTerminated, sealLegacySavedMemoryRun,
  type LegacyChatAuthority } from "./legacyChatAuthority.js";
import { readSavedMemorySessionHistory, type SavedMemorySessionHistoryReceipt } from "./savedMemorySessionHistory.js";
import { savedMemoryDurableProofDigest, type SavedMemoryDurableProofV2 } from "./savedMemoryDurableLineage.js";
import type { SavedMemoryStamp } from "./savedMemoryLineage.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const auth: AuthContext = { accountId: id(1), accountSlug: "synthetic", userId: id(2), sessionId: id(3),
  userKind: "password_human", userEmail: "synthetic@example.invalid" };
const checked = "2030-01-01T00:00:00.000000Z", until = "2030-01-01T00:01:00.000000Z";
const stamp: SavedMemoryStamp = { item_id: id(10), item_version: 1, lineage_epoch: "7", memory_owner_id: id(2),
  scope: "self", subject_id: null, relationship_context_id: null };
const owners: LegacyChatAuthority[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.restoreAllMocks(); });
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function retained(taskID = id(6), stamps: readonly SavedMemoryStamp[] = [stamp]): SavedMemoryDurableProofV2 {
  return { version: 2, account_id: auth.accountId, reader_actor_id: auth.userId, task_id: taskID,
    completion_idempotency_id: id(8), retention_kind: "canonical_no_session", source_origin_session_id: null, expires_at: null, stamps };
}
async function fixture(options: { proof?: SavedMemoryDurableProofV2; proofs?: readonly SavedMemoryDurableProofV2[]; unavailable?: boolean; noSession?: boolean } = {}) {
  const proof = options.proof ?? retained(), commands: { where: "pool" | "held"; sql: string; metadata?: Record<string, unknown> }[] = [];
  let jointLive = true, generation = "0", onHistoryAck: (() => void) | undefined;
  let pending: { entered: ReturnType<typeof deferred>; gate: ReturnType<typeof deferred> } | undefined;
  const historyRows = (params: unknown[]) => ({ rows: [{ checked_at: checked, read_until: until, source: JSON.parse(params[4] as string), turns: (options.proofs ?? [proof]).map((proof, index) => ({
      kind: "normal", task_id: proof.task_id, source_available: true,
      human_messages: [{ message_id: id(100 + index), text: "Synthetic original historical question" }],
      assistant_text: options.unavailable ? null : "Synthetic original canonical answer",
      ancestor: options.unavailable ? null : { taskID: proof.task_id, completionID: proof.completion_idempotency_id,
        bodyDigest: "b".repeat(64), proofDigest: savedMemoryDurableProofDigest(proof), proof, sourceTaskExpiresAt: proof.expires_at },
    })) }] });
  const pool = { query: async (sql: string, params: unknown[]) => {
    const metadata = typeof params[11] === "string" ? JSON.parse(params[11]) as Record<string, unknown> : undefined;
    commands.push({ where: "pool", sql, ...(metadata ? { metadata } : {}) });
    if (sql.includes("AS original_deadline")) return { rows: [{ original_deadline: "2099-01-01T00:00:00.123456Z", remaining_ms: "120000",
      user_kind: auth.userKind, token_branch: "current", lab_binding: null }] };
    if (sql.includes("AS source_expires_at")) return { rows: [{ generation, current: true,
      session_stamp: options.noSession ? null : "a".repeat(32), source_expires_at: "2030-01-02T00:00:00.000000Z",
      session_expires_at: options.noSession ? null : "2030-01-03T00:00:00.000000Z", source_person_ids: params[4] }] };
    if (sql.includes("END AS turns")) return historyRows(params);
    if (sql.includes("AS read_until")) {
      if (metadata?.history && pending) { const current = pending; pending = undefined; current.entered.release(); await current.gate.promise; }
      if (metadata?.history) onHistoryAck?.();
      return { rows: jointLive ? [{ available: true, checked_at: checked, read_until: until }] : [] };
    }
    return { rows: [{ "?column?": 1 }], rowCount: 1 };
  } } as unknown as Pool;
  const owner = await admitLegacyChatAuthority(pool, auth, "Bearer synthetic-private-only", { internalLabEnabled: false } as BackendConfig);
  owners.push(owner);
  const source = await createHarnessSourceGuardWithBinding(pool, auth, options.noSession ? undefined : id(4),
    () => ({ expiresAt: new Date("2030-01-02"), personIDs: [] }));
  const handle = await bindLegacySavedMemoryRun(owner, { auth, ...source, taskID: id(5), runID: id(9),
    runDeadlineMonotonicMs: performance.now() + 30_000 });
  const run = accessLegacySavedMemoryRun(handle, owner, auth);
  const receipt = (runID = id(9), database: DatabaseClient = pool) => readSavedMemorySessionHistory({ database, owner, auth, ...source,
    sessionID: id(4), taskID: id(5), runID });
  const client = { query: async (sql: string, params: unknown[] = []) => {
    if (sql.includes("END AS turns")) return historyRows(params);
    commands.push({ where: "held", sql, ...(typeof params[11] === "string" ? { metadata: JSON.parse(params[11]) as Record<string, unknown> } : {}) });
    return { rows: sql.includes("AS read_until") ? (jointLive ? [{ available: true, checked_at: checked, read_until: until }] : []) : [{ id: id(1) }], rowCount: 1 };
  } } as unknown as PoolClient;
  return { owner, handle, run, source, pool, client, commands, receipt,
    revoke: () => { jointLive = false; }, changeGeneration: () => { generation = "1"; },
    afterHistoryAck: (operation: () => void) => { onHistoryAck = operation; },
    holdHistory: () => { const current = { entered: deferred(), gate: deferred() }; pending = current;
      return { entered: current.entered.promise, release: current.gate.release }; } };
}

describe("actual private Run consumes its inline Session history receipt", () => {
  it("brands reject-only foreign identity before a closing phase or expired Run clock without consuming it", async () => {
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    const a = await fixture(), b = await fixture(), receipt = await b.receipt();
    await sealLegacySavedMemoryRun(a.handle, a.owner, auth);
    now = 30_001;
    let refusal: unknown;
    try { assertLegacySavedMemoryHistoryReceiptOwner(receipt, a.owner); } catch (error) { refusal = error; }
    expect(refusal).toBeInstanceOf(LegacyChatTerminated);
    expect(isForeignLegacySavedMemoryHistoryError(refusal)).toBe(true);
    expect(isForeignLegacySavedMemoryHistoryError(new LegacyChatTerminated())).toBe(false);
    expect(a.owner.signal.aborted || b.owner.signal.aborted).toBe(false);
    const later = await inheritLegacySavedMemoryHistory(a.handle, a.owner, auth, receipt).then(() => null, error => error);
    expect(later).toBeInstanceOf(LegacyChatTerminated); expect(isForeignLegacySavedMemoryHistoryError(later)).toBe(true);
    expect(a.owner.signal.aborted || b.owner.signal.aborted).toBe(false);
    expect(() => assertLegacySavedMemoryHistoryReceiptOwner({} as SavedMemorySessionHistoryReceipt, a.owner)).not.toThrow();
    // Preflight made no permission claim for the unknown shape or consumed B.
  });

  it("rejects a forwarding query wrapper even when it returns the actual producer's rows", async () => {
    const f = await fixture(); await f.run.assertCurrent();
    const wrapper = { query: f.pool.query.bind(f.pool) } as unknown as DatabaseClient;
    const receipt = await f.receipt(id(9), wrapper), before = f.commands.length;
    await expect(inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, receipt)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.commands).toHaveLength(before); expect(f.run.reads.snapshot().stamps).toEqual([]);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("preserves a closing owner's accepted tail when a foreign receipt arrives", async () => {
    const a = await fixture(), b = await fixture(), own = await a.receipt(), foreign = await b.receipt(), gate = a.holdHistory();
    const pending = inheritLegacySavedMemoryHistory(a.handle, a.owner, auth, own); await gate.entered;
    const sealing = sealLegacySavedMemoryRun(a.handle, a.owner, auth);
    try {
      const error = await inheritLegacySavedMemoryHistory(a.handle, a.owner, auth, foreign).then(() => null, error => error);
      expect(isForeignLegacySavedMemoryHistoryError(error)).toBe(true);
      expect(a.owner.signal.aborted || b.owner.signal.aborted).toBe(false);
    } finally { gate.release(); }
    await pending; expect((await sealing).stamps).toEqual([stamp]);
    await inheritLegacySavedMemoryHistory(b.handle, b.owner, auth, foreign);
    expect(a.owner.signal.aborted || b.owner.signal.aborted).toBe(false);
  });

  it("accepts the actual current guarded reader identity and returns its frame within the original lease", async () => {
    const f = await fixture();
    await f.owner.withClient(f.client, async held => {
      const frame = await inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, await f.receipt(id(9), held));
      expect(frame.envelope.available).toBe(true); expect(frame.messages).toHaveLength(2);
      expect(f.run.reads.snapshot().stamps).toEqual([stamp]);
    });
    expect(f.owner.signal.aborted).toBe(false);
  });

  it("rejects a raw client receipt even inside its active lease", async () => {
    const f = await fixture();
    await expect(f.owner.withClient(f.client, async () => {
      await inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, await f.receipt(id(9), f.client));
    })).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.run.reads.snapshot().stamps).toEqual([]); expect(f.owner.signal.aborted).toBe(true);
  });

  it("cannot wash an old guarded reader receipt into a new lease reusing the same raw client", async () => {
    const f = await fixture(); let receipt: SavedMemorySessionHistoryReceipt | undefined;
    await f.owner.withClient(f.client, async held => { receipt = await f.receipt(id(9), held); });
    await expect(f.owner.withClient(f.client, async () => {
      await inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, receipt!);
    })).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.run.reads.snapshot().stamps).toEqual([]); expect(f.owner.signal.aborted).toBe(true);
  });

  it("rejects the history ACK after the original guarded issuance lease has closed", async () => {
    const f = await fixture(), gate = f.holdHistory(), exit = new Error("Synthetic owning operation exit");
    let observed: Promise<unknown> | undefined;
    try {
      await expect(f.owner.withClient(f.client, async held => {
        const pending = inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, await f.receipt(id(9), held));
        observed = pending.then(value => value, error => error);
        await gate.entered;
        // Real exceptional exit runs finally without waiting on the successful
        // tail's new current check queued behind this deliberately held joint.
        throw exit;
      })).rejects.toBe(exit);
    } finally { gate.release(); }
    expect(await observed).toBeInstanceOf(LegacyChatTerminated);
    expect(f.run.reads.snapshot().stamps).toEqual([]); expect(f.owner.signal.aborted).toBe(true);
  });

  it("returns the original selected frame only after a joint and inherits exact V2 null-expiry tuples", async () => {
    const f = await fixture(), receipt = await f.receipt();
    const frame = await inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, receipt);
    expect(frame.envelope.available).toBe(true); expect(Object.isFrozen(frame) && Object.isFrozen(frame.messages)).toBe(true);
    expect(frame.messages.map(message => message.text)).toEqual(["Synthetic original historical question", "Synthetic original canonical answer"]);
    expect(f.run.reads.snapshot().stamps).toEqual([stamp]);
    const last = f.commands.at(-1)!;
    expect(last.sql).toContain("SELECT statement_timestamp() AS checked_at");
    expect(last.sql).toContain("sessions.previous_token_hash=$1");
    expect(last.sql).toContain("saved_memory_discovery_current($6,$7");
    expect(last.sql).toContain("saved_memory_task_current($6,historical.task_id,$7,tick.checked_at)");
    expect(last.sql).toContain("canonical.response_body::text");
    expect(last.sql).toContain("agent_session_chat_sources_available($6,historical.task_id::text)");
    expect((last.metadata!.history as { proof: SavedMemoryDurableProofV2 }[])[0]!.proof).toEqual(retained());
    expect(JSON.stringify(last.metadata)).not.toContain("Synthetic original canonical answer");
    expect(f.run.authority.expiresAt).toBe(until); expect(f.owner.signal.aborted).toBe(false);
  });

  it("retains an explicit zero-dependency V2 ancestor as a checked canonical domain", async () => {
    const f = await fixture({ proof: retained(id(6), []) });
    await inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, await f.receipt());
    expect(f.run.reads.snapshot().stamps).toEqual([]);
    const metadata = f.commands.at(-1)!.metadata!;
    expect(metadata.history).toHaveLength(1);
    expect((metadata.history as { proof: SavedMemoryDurableProofV2 }[])[0]!.proof.stamps).toEqual([]);
    await f.run.assertCurrent(); expect(f.commands.at(-1)!.sql).toContain("historical.dependency_count=jsonb_array_length");
  });

  it("unions every actually selected ancestor without losing either original tuple", async () => {
    const second = { ...stamp, item_id: id(11), lineage_epoch: "19" };
    const f = await fixture({ proofs: [retained(id(6)), { ...retained(id(16), [second]), completion_idempotency_id: id(18) }] });
    await inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, await f.receipt());
    expect(f.run.reads.snapshot().stamps).toEqual([stamp, second]);
    expect(f.commands.at(-1)!.metadata!.history).toHaveLength(2);
    await f.run.assertCurrent(); expect(f.commands.at(-1)!.metadata!.history).toHaveLength(2);
  });

  it("refuses a whole inherited union over the fixed capacity with413 and no partial admission", async () => {
    const one = Array.from({ length: 256 }, (_, n) => ({ ...stamp, item_id: id(1000 + n) }));
    const two = [{ ...stamp, item_id: id(2000) }];
    const f = await fixture({ proofs: [retained(id(6), one), { ...retained(id(16), two), completion_idempotency_id: id(18) }] });
    await expect(inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, await f.receipt()))
      .rejects.toMatchObject({ statusCode: 413, code: "SAVED_MEMORY_BUDGET_LIMITED" });
    expect(f.run.reads.snapshot().stamps).toEqual([]); expect(f.owner.signal.aborted).toBe(true);
  });

  it("terminates on typed unavailable history instead of inheriting an empty certified proof", async () => {
    const f = await fixture({ unavailable: true });
    await expect(inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, await f.receipt())).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.run.reads.snapshot().stamps).toEqual([]); expect(f.owner.signal.aborted).toBe(true);
  });

  it.each(["clone", "proxy"])("refuses a %s receipt without admitting any original stamps", async kind => {
    const f = await fixture(), receipt = await f.receipt();
    const fake = (kind === "clone" ? { ...receipt } : new Proxy(receipt, {})) as SavedMemorySessionHistoryReceipt;
    await expect(inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, fake)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.run.reads.snapshot().stamps).toEqual([]); expect(f.owner.signal.aborted).toBe(true);
  });

  it("refuses genuine foreign handle/receipt identity without poisoning either real owner or consuming B's receipt", async () => {
    const a = await fixture(), b = await fixture(), receipt = await b.receipt();
    let hooks = 0;
    const hooked = Object.defineProperty({ ...auth }, "accountId", { enumerable: true, get() { hooks++; return auth.accountId; } });
    await expect(inheritLegacySavedMemoryHistory(a.handle, b.owner, hooked, receipt)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(hooks).toBe(0); expect(a.owner.signal.aborted || b.owner.signal.aborted).toBe(false);
    await expect(inheritLegacySavedMemoryHistory(a.handle, a.owner, auth, receipt)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(a.owner.signal.aborted || b.owner.signal.aborted).toBe(false);
    expect((await inheritLegacySavedMemoryHistory(b.handle, b.owner, auth, receipt)).envelope.available).toBe(true);
  });

  it("isolates a foreign receipt even when its real recipient has no Session source", async () => {
    const a = await fixture({ noSession: true }), b = await fixture(), receipt = await b.receipt();
    await expect(inheritLegacySavedMemoryHistory(a.handle, a.owner, auth, receipt)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(a.owner.signal.aborted || b.owner.signal.aborted).toBe(false);
    await inheritLegacySavedMemoryHistory(b.handle, b.owner, auth, receipt);
  });

  it("rejects another Run's real receipt even under the same owner/auth/Session", async () => {
    const f = await fixture();
    await expect(inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, await f.receipt(id(99)))).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true); expect(f.run.reads.snapshot().stamps).toEqual([]);
  });

  it("does not replace a current tuple with an ancestor's conflicting version or epoch", async () => {
    const f = await fixture(), receipt = await f.receipt();
    const existing = { ...stamp, lineage_epoch: "8" }; f.run.reads.admit([existing]);
    await expect(inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, receipt)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.run.reads.snapshot().stamps).toEqual([existing]); expect(f.owner.signal.aborted).toBe(true);
  });

  it("drains accepted inheritance before seal and latches a later history producer", async () => {
    const f = await fixture(), receipt = await f.receipt(), lateReceipt = await f.receipt(), gate = f.holdHistory();
    const pending = inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, receipt);
    let sealed = false;
    await gate.entered;
    const sealing = sealLegacySavedMemoryRun(f.handle, f.owner, auth).then(value => { sealed = true; return value; });
    try { await Promise.resolve(); expect(sealed).toBe(false); } finally { gate.release(); }
    await pending; expect((await sealing).stamps).toEqual([stamp]);
    expect(f.commands.at(-1)!.metadata!.history).toHaveLength(1);
    await expect(inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, lateReceipt)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("keeps ancestors and all exposed query domains in the held final and original withClient tail", async () => {
    const f = await fixture();
    await inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, await f.receipt());
    await f.run.finalizeRead({ proof: f.run.reads.snapshot(), query_id: id(20), query_digest: "c".repeat(64), projection_version: 1,
      cutoff: checked, query_expires_at: until, literal_patterns: ["%synthetic%"], page_limit: 1, delivered_stamps: [stamp] });
    await sealLegacySavedMemoryRun(f.handle, f.owner, auth);
    await f.owner.withClient(f.client, async held => { await f.owner.assertFinalCurrent(held); });
    const finals = f.commands.filter(command => command.where === "held" && command.sql.includes("AS read_until"));
    expect(finals).toHaveLength(2);
    for (const command of finals) {
      expect(command.metadata!.history).toHaveLength(1); expect(command.metadata!.domains).toHaveLength(1);
      expect(command.sql).toContain("SELECT statement_timestamp() AS checked_at");
      expect(command.sql).toContain("historical.proof_digest=ancestor->>'proofDigest'");
    }
  });

  it("rechecks inherited domains at seal rather than trusting the previous successful exposure", async () => {
    const f = await fixture(); await inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, await f.receipt());
    f.revoke();
    await expect(sealLegacySavedMemoryRun(f.handle, f.owner, auth)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true); expect(f.commands.at(-1)!.metadata!.history).toHaveLength(1);
  });

  it("refuses an old held lease without issuing an ancestor query on the released client", async () => {
    const f = await fixture(); await inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, await f.receipt());
    await sealLegacySavedMemoryRun(f.handle, f.owner, auth);
    let old: PoolClient | undefined;
    await f.owner.withClient(f.client, async held => { old = held; });
    const count = f.commands.length;
    await expect(f.owner.assertFinalCurrent(old!)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.commands).toHaveLength(count); expect(f.owner.signal.aborted).toBe(true);
  });

  it("charges the joint's actual roundtrip and rejects before returning or admitting a delayed frame", async () => {
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = await fixture(), receipt = await f.receipt();
    f.afterHistoryAck(() => { now = 30_001; });
    await expect(inheritLegacySavedMemoryHistory(f.handle, f.owner, auth, receipt)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.run.reads.snapshot().stamps).toEqual([]); expect(f.owner.signal.aborted).toBe(true);
  });
});
