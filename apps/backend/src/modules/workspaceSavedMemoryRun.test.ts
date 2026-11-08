/** Synthetic driver boundary only. These tests exercise the real private
 * Legacy owner and Run bridge, not actual PostgreSQL/login availability. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { ScriptedAgentProvider, type AgentMemoryItem, type AgentProvider } from "@talent-signal/agent";
import { executeWorkspaceConversationAgent, executeWorkspaceConversationAgentCore, type WorkspaceMemoryLookup } from "./workspaceConversationAgent.js";
import type { BackendConfig } from "../config.js";
import type { AuthContext } from "./auth.js";
import { admitLegacyChatAuthority, LegacyChatTerminated, type LegacyChatAuthority } from "./legacyChatAuthority.js";
import { createHarnessSourceGuardWithBinding } from "./harnessSourceGuard.js";
import { createWorkspaceSavedMemoryRun, type WorkspaceTrackedMemoryPage } from "./workspaceSavedMemoryRun.js";
import type { SavedMemoryReadProof, SavedMemoryStamp } from "./savedMemoryLineage.js";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const auth: AuthContext = { accountId: id(1), accountSlug: "synthetic", userId: id(2), sessionId: id(3),
  userKind: "password_human", userEmail: "synthetic@example.invalid" };
const owners: LegacyChatAuthority[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.restoreAllMocks(); });
async function sourceFixture() {
  const proofs: SavedMemoryReadProof[] = [];
  let onFinal: (() => Promise<void>) | null = null;
  let jointLive = true;
  const pool = { query: async (sql: string, params: unknown[]) => {
    if (sql.includes("AS original_deadline")) return { rows: [{ original_deadline: "2030-01-02T00:00:00.000000Z",
      remaining_ms: "60000", user_kind: "password_human", token_branch: "current", lab_binding: null }] };
    if (sql.includes("AS source_expires_at")) return { rows: [{ generation: "0", session_stamp: null, current: true,
      source_expires_at: "2030-01-02T00:00:00.000000Z", session_expires_at: null, source_person_ids: params[4] }] };
    if (sql.includes("AS read_until")) {
      const value = JSON.parse(params[11] as string) as { proof?: SavedMemoryReadProof };
      if (value.proof) { proofs.push(value.proof); await onFinal?.(); }
      return { rows: jointLive ? [{ available: true, checked_at: "2030-01-01T00:00:00.000000Z", read_until: "2030-01-01T00:01:00.000000Z" }] : [] };
    }
    if (sql.includes("SELECT state,expires_at")) return { rows: [{ state: "active", expires_at: new Date("2030-01-02"), stop_clear: true }] };
    return { rows: [{ "?column?": 1 }] };
  } } as unknown as Pool;
  const owner = await admitLegacyChatAuthority(pool, auth, "Bearer synthetic-never-a-real-credential", { internalLabEnabled: false } as BackendConfig);
  owners.push(owner);
  const source = await createHarnessSourceGuardWithBinding(pool, auth, undefined,
    () => ({ expiresAt: new Date("2030-01-02"), personIDs: [] }));
  const admission = { pool, auth, owner, taskID: id(4), source: source.source, guard: source.guard };
  return { owner, admission, proofs, revoke: () => { jointLive = false; }, final: (callback: () => Promise<void>) => { onFinal = callback; } };
}
async function fixture() {
  const f = await sourceFixture();
  return { ...f, run: await createWorkspaceSavedMemoryRun(f.admission, id(5), performance.now() + 30_000) };
}
function tracked(n: number, size = 50, epoch = "1"): WorkspaceTrackedMemoryPage {
  const item = { id: id(n), scope: "self", statement_kind: "source_statement", display_text: "x".repeat(size),
    subject_id: id(99), relationship_context_id: null, speaker: null, reporter: null, valid_time: null, observed_time: null,
    time_status: "unknown", sensitivity: "normal", version: 1, supersedes_id: null, conflict_group_id: null,
    evidence_retained: true, evidence_refs: [] } satisfies AgentMemoryItem;
  const stamp: SavedMemoryStamp = { item_id: item.id, item_version: 1, lineage_epoch: epoch, memory_owner_id: auth.userId,
    scope: "self", subject_id: null, relationship_context_id: null };
  return { page: { items: [item], has_more: false, next_cursor: null }, originalStamps: [stamp] };
}
describe("Workspace saved Memory actual shared Run bridge", () => {
  it("admits only whole Self items actually compiled, preserving the omitted-row continuation", async () => {
    const f = await fixture(), a = tracked(10, 13_000), b = tracked(11, 13_000);
    const value = await f.run.self({ page: { items: [...a.page.items, ...b.page.items], has_more: true, next_cursor: "past-b" },
      originalStamps: [...a.originalStamps, ...b.originalStamps] });
    expect(value.status).toBe("partial"); expect(value.items.map(item => item.id)).toEqual([id(10)]);
    expect(value.items[0]?.subject_id).toBe(id(99));
    expect(value.continuation).toEqual({ operation: "recall", scope: "self" });
    expect(f.proofs.at(-1)?.stamps).toEqual(a.originalStamps);
  });
  it("shares the whole-frame budget between bootstrap and repeated recall, retaining terminal413", async () => {
    const f = await fixture(), page = tracked(10, 10_500);
    await f.run.self(page); await f.run.recall(page);
    await expect(f.run.recall(page)).rejects.toMatchObject({ statusCode: 413, code: "SAVED_MEMORY_BUDGET_LIMITED" });
    expect(f.owner.signal.aborted).toBe(true);
    await expect(f.owner.provider(async () => "must not become a fallback201")).rejects.toBeInstanceOf(LegacyChatTerminated);
  });
  it("rejects replacement epochs instead of laundering already exposed text", async () => {
    const f = await fixture(); await f.run.recall(tracked(10));
    await expect(f.run.recall(tracked(10, 50, "2"))).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.owner.signal.aborted).toBe(true);
    expect(f.proofs).toHaveLength(1);
  });
  it("refuses missing original tuples before final admission and latches every later producer", async () => {
    const f = await fixture(), page = tracked(10);
    await expect(f.run.recall({ ...page, originalStamps: [] })).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(f.proofs).toHaveLength(0);
    await expect(f.run.self(tracked(11))).rejects.toBeInstanceOf(LegacyChatTerminated);
  });
  it("serializes held finalizations and preserves the union across two simultaneous recalls", async () => {
    const f = await fixture();
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(done => { release = done; }), started = new Promise<void>(done => { entered = done; });
    f.final(async () => { if (f.proofs.length === 1) { entered(); await held; } });
    const a = f.run.recall(tracked(10)), b = f.run.recall(tracked(11));
    try { await started; expect(f.proofs).toHaveLength(1); }
    finally { release(); }
    await Promise.all([a, b]);
    expect(f.proofs.at(-1)?.stamps.map(stamp => stamp.item_id)).toEqual([id(10), id(11)]);
  });
  it("keeps a schema refusal nonterminal without exposing Memory or resetting the Run", async () => {
    const f = await fixture();
    await expect(f.run.search({ terms: [] })).rejects.toMatchObject({ statusCode: 400, code: "SAVED_MEMORY_QUERY_INVALID" });
    expect(f.owner.signal.aborted).toBe(false); expect(f.proofs).toHaveLength(0);
    expect((await f.run.recall(tracked(10))).items).toHaveLength(1);
  });
});

describe("actual Workspace Core with the private prepared owner", () => {
  it.each(["workspace", "missing-tracked-reader", "adapter-auth"])("latches prepared-owner construction failure (%s) before any fallback", async kind => {
    const f = await sourceFixture(), scripted = new ScriptedAgentProvider([], { outcome: "reply", title: "Synthetic", body: "Must not execute." });
    const run = vi.spyOn(scripted, "run");
    const operation = kind === "adapter-auth"
      ? executeWorkspaceConversationAgent({ database: f.admission.pool, auth: { ...auth, userId: id(101) },
        objective: "Synthetic integration.", runID: id(5), savedMemoryAdmission: f.admission, provider: scripted })
      : executeWorkspaceConversationAgentCore({ objective: "Synthetic integration.", workspaceID: kind === "workspace" ? id(101) : auth.accountId,
        runID: id(5), savedMemoryAdmission: f.admission, contacts: { search: vi.fn(), read: vi.fn() }, provider: scripted,
        memory: { recall: vi.fn(), ...(kind === "missing-tracked-reader" ? {} : { recallTracked: async () => tracked(10) }), stage: vi.fn() } });
    await expect(operation).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(run).not.toHaveBeenCalled(); expect(f.owner.signal.aborted).toBe(true);
    await expect(f.owner.provider(async () => "must not become fallback201")).rejects.toBeInstanceOf(LegacyChatTerminated);
  });
  it("uses tracked bootstrap and recall, one real Run ID, conditional protocol and original shared tool limit", async () => {
    const f = await sourceFixture();
    const legacyRecall = vi.fn<WorkspaceMemoryLookup["recall"]>(async () => { throw new Error("Untracked read must not run."); });
    const trackedRecall = vi.fn<NonNullable<WorkspaceMemoryLookup["recallTracked"]>>(async () => tracked(10));
    const scripted = new ScriptedAgentProvider([], { outcome: "reply", title: "Synthetic", body: "Synthetic host integration." });
    const original = scripted.run.bind(scripted);
    const run = vi.fn<AgentProvider["run"]>(async (request, invoke, signal) => {
      expect(request.runID).toBe(id(5));
      expect(request.toolManifest).toContain("search_saved_memory");
      expect(request.selfMemoryContext?.items.map(item => item.id)).toEqual([id(10)]);
      expect(request.assertCurrent).toBeTypeOf("function");
      expect(request.budget).toMatchObject({ maxTurns: 6, maxToolCalls: 6 });
      expect((await invoke("memory_review", { operation: "recall", scope: "self" })).ok).toBe(true);
      for (let i = 0; i < 5; i++) expect((await invoke("search_saved_memory", { terms: [] })).error?.code).toBe("SAVED_MEMORY_QUERY_INVALID");
      expect((await invoke("search_saved_memory", { terms: ["exhausted"] })).error?.code).toBe("CONTACT_TOOL_BUDGET_EXHAUSTED");
      return original(request, invoke, signal);
    });
    const result = await executeWorkspaceConversationAgentCore({ objective: "Synthetic integration.", workspaceID: auth.accountId,
      runID: id(5), savedMemoryAdmission: f.admission, contacts: { search: vi.fn(), read: vi.fn() },
      memory: { recall: legacyRecall, recallTracked: trackedRecall, stage: vi.fn() }, provider: { ...scripted, run } });
    expect(result.block.body).toBe("Synthetic host integration.");
    expect(legacyRecall).not.toHaveBeenCalled(); expect(trackedRecall).toHaveBeenCalledTimes(2);
    expect(f.proofs.at(-1)?.stamps).toEqual(tracked(10).originalStamps);
  });
  it("checks the actual bound owner again after a held startup snapshot, before model exposure", async () => {
    const f = await sourceFixture(), scripted = new ScriptedAgentProvider([], { outcome: "reply", title: "Synthetic", body: "Must not execute." });
    const run = vi.spyOn(scripted, "run");
    let entered!: () => void, release!: () => void;
    const begun = new Promise<void>(done => { entered = done; }), held = new Promise<void>(done => { release = done; });
    const result = executeWorkspaceConversationAgentCore({ objective: "Synthetic integration.", workspaceID: auth.accountId,
      runID: id(5), savedMemoryAdmission: f.admission, contacts: { search: vi.fn(), read: vi.fn() }, provider: scripted,
      memory: { recall: vi.fn(), recallTracked: async () => tracked(10), stage: vi.fn() },
      mcpConnections: { handle: vi.fn(), snapshot: async () => { entered(); await held; return { state: "available" }; } },
    });
    // Install rejection observation before releasing any asynchronous boundary.
    const rejected = expect(result).rejects.toBeInstanceOf(LegacyChatTerminated);
    try { await begun; f.revoke(); } finally { release(); }
    await rejected;
    expect(run).not.toHaveBeenCalled(); expect(f.owner.signal.aborted).toBe(true);
  });
  it("propagates a bootstrap provenance fault before provider execution instead of an empty-profile fallback", async () => {
    const f = await sourceFixture();
    const scripted = new ScriptedAgentProvider([], { outcome: "reply", title: "Synthetic", body: "Must not execute." });
    const run = vi.spyOn(scripted, "run");
    await expect(executeWorkspaceConversationAgentCore({ objective: "Synthetic integration.", workspaceID: auth.accountId,
      runID: id(5), savedMemoryAdmission: f.admission, contacts: { search: vi.fn(), read: vi.fn() }, provider: scripted,
      memory: { recall: vi.fn(), recallTracked: async () => ({ ...tracked(10), originalStamps: [] }), stage: vi.fn() },
    })).rejects.toBeInstanceOf(LegacyChatTerminated);
    expect(run).not.toHaveBeenCalled(); expect(f.owner.signal.aborted).toBe(true);
  });
});
