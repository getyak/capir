/** Synthetic driver boundary only. Real private Legacy/source/bridge objects
 * are exercised; the driver rows do not prove PostgreSQL or login authority. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AgentMemoryItem } from "@talent-signal/agent";
import type { BackendConfig } from "../config.js";
import type { AuthContext } from "./auth.js";
import { admitLegacyChatAuthority, LegacyChatTerminated, type LegacyChatAuthority } from "./legacyChatAuthority.js";
import { createHarnessSourceGuardWithBinding } from "./harnessSourceGuard.js";
import { consumeWorkspaceSavedMemoryCompletion, createWorkspaceSavedMemoryRun, sealWorkspaceSavedMemoryRun,
  type WorkspaceSavedMemoryCompletionHandle, type WorkspaceTrackedMemoryPage } from "./workspaceSavedMemoryRun.js";
import type { SavedMemoryReadProof, SavedMemoryStamp } from "./savedMemoryLineage.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor: AuthContext = { accountId: id(1), accountSlug: "synthetic", userId: id(2), sessionId: id(3),
  userKind: "password_human", userEmail: "synthetic@example.invalid" };
const taskID = id(4), runID = id(5);
const owners: LegacyChatAuthority[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.restoreAllMocks(); });

async function sourceFixture() {
  const proofs: SavedMemoryReadProof[] = [];
  let live = true, onProof: (() => Promise<void>) | undefined;
  const pool = { query: async (sql: string, parameters: unknown[]) => {
    if (sql.includes("AS original_deadline")) return { rows: [{ original_deadline: "2030-01-02T00:00:00.000000Z",
      remaining_ms: "60000", user_kind: actor.userKind, token_branch: "current", lab_binding: null }] };
    if (sql.includes("AS source_expires_at")) return { rows: [{ generation: "0", session_stamp: null, current: true,
      source_expires_at: "2030-01-02T00:00:00.000000Z", session_expires_at: null, source_person_ids: parameters[4] }] };
    if (sql.includes("AS read_until")) {
      const metadata = JSON.parse(parameters[11] as string) as { proof?: SavedMemoryReadProof };
      if (metadata.proof) { proofs.push(metadata.proof); await onProof?.(); }
      return { rows: live ? [{ available: true, checked_at: "2030-01-01T00:00:00.000000Z",
        read_until: "2030-01-01T00:01:00.000000Z" }] : [] };
    }
    if (sql.includes("SELECT state,expires_at")) return { rows: [{ state: "active", expires_at: new Date("2030-01-02"), stop_clear: true }] };
    return { rows: [{ "?column?": 1 }] };
  } } as unknown as Pool;
  const auth = { ...actor };
  const owner = await admitLegacyChatAuthority(pool, auth, "Bearer synthetic-not-a-credential",
    { internalLabEnabled: false } as BackendConfig);
  owners.push(owner);
  const source = await createHarnessSourceGuardWithBinding(pool, auth, undefined,
    () => ({ expiresAt: new Date("2030-01-02"), personIDs: [] }));
  const admission = { owner, pool, auth, taskID, source: source.source, guard: source.guard };
  return { owner, auth, admission, proofs, revoke: () => { live = false; },
    hold: (callback: () => Promise<void>) => { onProof = callback; } };
}
async function fixture() {
  const source = await sourceFixture();
  const deadline = performance.now() + 30_000;
  const run = await createWorkspaceSavedMemoryRun(source.admission, runID, deadline);
  return { ...source, run, deadline };
}
function tracked(n: number, epoch = "9007199254740993"): WorkspaceTrackedMemoryPage {
  const item = { id: id(n), scope: "self", statement_kind: "source_statement", display_text: `Synthetic original ${n}.`,
    subject_id: actor.userId, relationship_context_id: null, speaker: null, reporter: null, valid_time: null, observed_time: null,
    time_status: "unknown", sensitivity: "normal", version: 1, supersedes_id: null, conflict_group_id: null,
    evidence_retained: true, evidence_refs: [] } satisfies AgentMemoryItem;
  const stamp: SavedMemoryStamp = { item_id: item.id, item_version: 1, lineage_epoch: epoch, memory_owner_id: actor.userId,
    scope: "self", subject_id: null, relationship_context_id: null };
  return { page: { items: [item], has_more: false, next_cursor: null }, originalStamps: [stamp] };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe("private Workspace Memory completion handoff", () => {
  it("seals the original immutable union under the startup binding without adding a new expiry", async () => {
    const f = await fixture(), a = tracked(10), b = tracked(11, "2");
    await f.run.self(a); await f.run.recall(b);
    Object.assign(a.originalStamps[0]!, { lineage_epoch: "9007199254740994" });
    Object.assign(f.admission, { taskID: id(900), auth: { ...actor, userId: id(901) } });
    const handle = await sealWorkspaceSavedMemoryRun(f.admission, taskID, runID);
    expect(Object.keys(handle)).toEqual([]); expect(Object.isFrozen(handle)).toBe(true);
    const proof = consumeWorkspaceSavedMemoryCompletion(handle, f.owner, f.auth, taskID, runID);
    expect(proof).toMatchObject({ version: 1, account_id: actor.accountId, reader_actor_id: actor.userId,
      task_id: taskID, expires_at: "2030-01-01T00:01:00.000000Z" });
    expect(proof.stamps.map(stamp => [stamp.item_id, stamp.lineage_epoch])).toEqual([[id(10), "9007199254740993"], [id(11), "2"]]);
    expect(Object.isFrozen(proof) && Object.isFrozen(proof.stamps) && proof.stamps.every(Object.isFrozen)).toBe(true);
    await expect(f.run.assertCurrent()).resolves.toBeUndefined();
  });

  it("seals a genuine empty original read set rather than treating a missing Run as independence", async () => {
    const f = await fixture();
    const handle = await sealWorkspaceSavedMemoryRun(f.admission, taskID, runID);
    expect(f.proofs.length).toBeGreaterThan(0);
    expect(consumeWorkspaceSavedMemoryCompletion(handle, f.owner, f.auth, taskID, runID).stamps).toEqual([]);
    const missing = await sourceFixture();
    await expect(sealWorkspaceSavedMemoryRun(missing.admission, taskID, runID)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(missing.proofs).toEqual([]);
  });

  it("accepts only the actual admission object without reading a clone or Proxy", async () => {
    const f = await fixture(); let touched = 0;
    const proxy = new Proxy(f.admission, { get() { touched++; throw new Error("must not inspect"); } });
    for (const copy of [{ ...f.admission }, proxy])
      await expect(sealWorkspaceSavedMemoryRun(copy, taskID, runID)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(touched).toBe(0); expect(f.owner.signal.aborted).toBe(false);
    const handle = await sealWorkspaceSavedMemoryRun(f.admission, taskID, runID);
    expect(consumeWorkspaceSavedMemoryCompletion(handle, f.owner, f.auth, taskID, runID).stamps).toEqual([]);
  });

  it.each(["clone", "proxy"])("refuses a %s completion handle without authorizing canonical publication", async kind => {
    const f = await fixture(), handle = await sealWorkspaceSavedMemoryRun(f.admission, taskID, runID);
    const copy = kind === "clone" ? JSON.parse(JSON.stringify(handle)) : new Proxy(handle, {});
    expect(() => consumeWorkspaceSavedMemoryCompletion(copy as WorkspaceSavedMemoryCompletionHandle,
      f.owner, f.auth, taskID, runID)).toThrow(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("isolates another real owner before auth hooks and leaves both genuine handoffs usable", async () => {
    const a = await fixture(), b = await fixture();
    const ah = await sealWorkspaceSavedMemoryRun(a.admission, taskID, runID), bh = await sealWorkspaceSavedMemoryRun(b.admission, taskID, runID);
    let touched = 0;
    const hooked = Object.defineProperty({ ...b.auth }, "accountId", { enumerable: true, get() { touched++; return b.auth.accountId; } });
    expect(() => consumeWorkspaceSavedMemoryCompletion(ah, b.owner, hooked, taskID, runID)).toThrow(LegacyChatTerminated);
    expect(touched).toBe(0); expect(a.owner.signal.aborted || b.owner.signal.aborted).toBe(false);
    expect(consumeWorkspaceSavedMemoryCompletion(ah, a.owner, a.auth, taskID, runID).task_id).toBe(taskID);
    expect(consumeWorkspaceSavedMemoryCompletion(bh, b.owner, b.auth, taskID, runID).task_id).toBe(taskID);
  });

  it.each(["task", "run"])("latches a wrong expected %s at seal", async kind => {
    const f = await fixture();
    await expect(sealWorkspaceSavedMemoryRun(f.admission, kind === "task" ? id(900) : taskID,
      kind === "run" ? id(901) : runID)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
    await expect(f.owner.provider(async () => "must not become a fallback201")).rejects.toBeInstanceOf(LegacyChatTerminated);
  });

  it.each(["task", "run", "login", "actor"])("latches a mismatched %s at consumption", async kind => {
    const f = await fixture(), handle = await sealWorkspaceSavedMemoryRun(f.admission, taskID, runID);
    const auth = { ...f.auth, ...(kind === "login" ? { sessionId: id(900) } : {}), ...(kind === "actor" ? { userId: id(901) } : {}) };
    expect(() => consumeWorkspaceSavedMemoryCompletion(handle, f.owner, auth,
      kind === "task" ? id(902) : taskID, kind === "run" ? id(903) : runID)).toThrow(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("refuses a second seal and a second consumption", async () => {
    const a = await fixture(); await sealWorkspaceSavedMemoryRun(a.admission, taskID, runID);
    await expect(sealWorkspaceSavedMemoryRun(a.admission, taskID, runID)).rejects.toBeInstanceOf(LegacyChatTerminated);
    const b = await fixture(), handle = await sealWorkspaceSavedMemoryRun(b.admission, taskID, runID);
    consumeWorkspaceSavedMemoryCompletion(handle, b.owner, b.auth, taskID, runID);
    expect(() => consumeWorkspaceSavedMemoryCompletion(handle, b.owner, b.auth, taskID, runID)).toThrow(LegacyChatTerminated);
    expect(a.owner.signal.aborted && b.owner.signal.aborted).toBe(true);
  });

  it.each(["self", "recall", "search"])("refuses and latches a late %s producer before it reads", async kind => {
    const f = await fixture(); await sealWorkspaceSavedMemoryRun(f.admission, taskID, runID);
    const before = f.proofs.length;
    const rejected = kind === "search" ? f.run.search({ terms: ["synthetic"] }) : f.run[kind](tracked(10));
    expect(f.owner.signal.aborted).toBe(true);
    await expect(rejected).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.proofs).toHaveLength(before);
  });

  it("waits for all already accepted producers before sealing their original union", async () => {
    const f = await fixture(), started = deferred(), held = deferred();
    f.hold(async () => { if (f.proofs.length === 1) { started.resolve(); await held.promise; } });
    const first = f.run.recall(tracked(10)), second = f.run.recall(tracked(11));
    await started.promise;
    let done = false;
    const sealing = sealWorkspaceSavedMemoryRun(f.admission, taskID, runID).then(value => { done = true; return value; });
    try { await Promise.resolve(); expect(done).toBe(false); expect(f.proofs).toHaveLength(1); }
    finally { held.resolve(); }
    await Promise.all([first, second]);
    const proof = consumeWorkspaceSavedMemoryCompletion(await sealing, f.owner, f.auth, taskID, runID);
    expect(proof.stamps.map(stamp => stamp.item_id)).toEqual([id(10), id(11)]);
  });

  it("closes new producers immediately while the accepted producer is still draining", async () => {
    const f = await fixture(), started = deferred(), held = deferred();
    f.hold(async () => { if (f.proofs.length === 1) { started.resolve(); await held.promise; } });
    const first = f.run.recall(tracked(10));
    const observedFirst = first.then(() => false, error => error);
    await started.promise;
    const sealing = sealWorkspaceSavedMemoryRun(f.admission, taskID, runID);
    const observedSeal = sealing.then(() => false, error => error);
    try {
      const late = f.run.recall(tracked(11));
      expect(f.owner.signal.aborted).toBe(true);
      await expect(late).rejects.toBeInstanceOf(LegacyChatTerminated);
    } finally { held.resolve(); }
    expect(await observedFirst).toBeInstanceOf(LegacyChatTerminated);
    expect(await observedSeal).toBeInstanceOf(LegacyChatTerminated);
    expect(f.proofs).toHaveLength(1);
  });

  it("does a real owner recheck at seal and refuses a now-unavailable joint", async () => {
    const f = await fixture(); await f.run.recall(tracked(10)); f.revoke();
    await expect(sealWorkspaceSavedMemoryRun(f.admission, taskID, runID)).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
  });

  it("does not renew the original Core deadline when the private proof is consumed", async () => {
    const f = await fixture(), handle = await sealWorkspaceSavedMemoryRun(f.admission, taskID, runID);
    vi.spyOn(performance, "now").mockReturnValue(f.deadline + 1);
    expect(() => consumeWorkspaceSavedMemoryCompletion(handle, f.owner, f.auth, taskID, runID)).toThrow(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
  });
});
