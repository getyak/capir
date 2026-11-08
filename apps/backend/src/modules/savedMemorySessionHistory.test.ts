/** Synthetic data/identity/selection tests only. No fake row here is evidence
 * of PostgreSQL, authentication, a canonical completion or model permission. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { BackendConfig } from "../config.js";
import type { AuthContext } from "./auth.js";
import { admitLegacyChatAuthority, type LegacyChatAuthority } from "./legacyChatAuthority.js";
import { createHarnessSourceGuardWithBinding, readHarnessRunSourceBinding } from "./harnessSourceGuard.js";
import { savedMemoryDurableProofDigest } from "./savedMemoryDurableLineage.js";
import { boundedConversationHistory } from "./chatAnswerProvider.js";
import { boundInlineAgentSessionMessages, consumeSessionHistoryReceipt, isForeignSessionHistoryReceipt, isForeignSessionHistoryReceiptError,
  readSavedMemorySessionHistory, sessionHistoryReceiptUsesDatabase } from "./savedMemorySessionHistory.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const auth: AuthContext = { accountId: id(1), userId: id(2), sessionId: id(3), accountSlug: "synthetic",
  userEmail: "synthetic@example.invalid", userKind: "password_human" };
const owners: LegacyChatAuthority[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.restoreAllMocks(); });
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function fixture() {
  const proof = { version: 2 as const, account_id: auth.accountId, reader_actor_id: auth.userId, task_id: id(6),
    completion_idempotency_id: id(7), retention_kind: "canonical_no_session" as const, source_origin_session_id: null,
    expires_at: null, stamps: [] };
  const turn = { kind: "normal", task_id: id(6), source_available: true,
    human_messages: [{ message_id: id(8), text: "Original synthetic human text" }], assistant_text: "Synthetic canonical answer",
    ancestor: { taskID: id(6), completionID: id(7), bodyDigest: "a".repeat(64),
      proofDigest: savedMemoryDurableProofDigest(proof), proof, sourceTaskExpiresAt: null } };
  let reply: Record<string, unknown> | undefined, hold: ReturnType<typeof deferred> | undefined;
  let historyCalls = 0, inputHook: (() => void) | undefined;
  const pool = { query: async (sql: string, params: unknown[]) => {
    if (sql.includes("AS original_deadline")) return { rows: [{ original_deadline: "2099-01-01T00:00:00.000000Z",
      remaining_ms: "120000", user_kind: auth.userKind, token_branch: "current", lab_binding: null }] };
    if (sql.includes("AS source_expires_at")) return { rows: [{ generation: "0", session_stamp: "b".repeat(32), current: true,
      source_expires_at: "2030-01-02T00:00:00.000000Z", session_expires_at: "2030-01-03T00:00:00.000000Z", source_person_ids: params[4] }] };
    if (sql.includes("budget.ancestor_expiry")) {
      historyCalls++; inputHook?.();
      if (hold) { const pending = hold; hold = undefined; await pending.promise; }
      return { rows: reply === undefined ? [] : [reply] };
    }
    return { rows: [], rowCount: 0 };
  } } as unknown as Pool;
  const owner = await admitLegacyChatAuthority(pool, auth, "Bearer synthetic-data-boundary", { internalLabEnabled: false } as BackendConfig);
  owners.push(owner);
  const source = await createHarnessSourceGuardWithBinding(pool, auth, id(4),
    () => ({ expiresAt: new Date("2030-01-02"), personIDs: [] }));
  const binding = readHarnessRunSourceBinding(source.source, source.guard, auth);
  reply = { checked_at: "2030-01-01T00:00:00.000000Z", read_until: "2030-01-01T00:01:00.000000Z",
    source: { ...binding, personIDs: [...binding.personIDs] }, turns: [turn] };
  const input = { database: pool, owner, auth: { ...auth }, sessionID: id(4), runID: id(5), taskID: id(9),
    source: source.source, guard: source.guard };
  return { owner, input, reply, turn, proof, historyCalls: () => historyCalls,
    missing: () => { reply = undefined; }, hold: () => { hold = deferred(); return hold; },
    onRead: (fn: () => void) => { inputHook = fn; },
    consume: (receipt: Parameters<typeof consumeSessionHistoryReceipt>[0]) =>
      consumeSessionHistoryReceipt(receipt, owner, auth, id(4), id(5), id(9)) };
}

describe("prepared original Session history receipts", () => {
  it("mints a detached immutable data frame with a complete genuine-empty V2 ancestor", async () => {
    const f = await fixture(), receipt = await readSavedMemorySessionHistory(f.input);
    f.turn.assistant_text = "changed retained synthetic holder";
    const facts = f.consume(receipt);
    expect(facts.messages.map(message => message.text)).toEqual(["Original synthetic human text", "Synthetic canonical answer"]);
    expect(facts.ancestors[0]?.proof.stamps).toEqual([]);
    expect(facts.unavailableAssistantTaskIDs).toEqual([]);
    expect(Object.isFrozen(facts) && Object.isFrozen(facts.messages) && Object.isFrozen(facts.messages[0])
      && Object.isFrozen(facts.ancestors) && Object.isFrozen(facts.ancestors[0]?.proof)).toBe(true);
    expect(f.historyCalls()).toBe(1);
  });

  it("retains human data but marks a missing/withdrawn assistant explicitly unavailable", async () => {
    const f = await fixture(); Object.assign(f.turn, { ancestor: null, assistant_text: null });
    const facts = f.consume(await readSavedMemorySessionHistory(f.input));
    expect(facts.messages).toEqual([{ message_id: id(8), role: "user", text: "Original synthetic human text" }]);
    expect(facts.ancestors).toEqual([]); expect(facts.unavailableAssistantTaskIDs).toEqual([id(6)]);
  });

  it("distinguishes a real empty Session frame from a missing assistant proof", async () => {
    const f = await fixture(); f.reply.turns = [];
    const facts = f.consume(await readSavedMemorySessionHistory(f.input));
    expect(facts.messages).toEqual([]); expect(facts.ancestors).toEqual([]); expect(facts.unavailableAssistantTaskIDs).toEqual([]);
  });

  it("preserves exact large original epoch strings in detached retained tuples", async () => {
    const f = await fixture();
    const stamp = { item_id: id(88), item_version: 1, lineage_epoch: "9007199254740993", memory_owner_id: auth.userId,
      scope: "self" as const, subject_id: null, relationship_context_id: null };
    Object.assign(f.proof, { stamps: [stamp] }); f.turn.ancestor.proofDigest = savedMemoryDurableProofDigest(f.proof);
    const receipt = await readSavedMemorySessionHistory(f.input); stamp.lineage_epoch = "9007199254740994";
    expect(f.consume(receipt).ancestors[0]?.proof.stamps[0]?.lineage_epoch).toBe("9007199254740993");
  });

  it("refuses source failure and unsupported issuers without returning an assistant frame", async () => {
    for (const delta of [{ source_available: false }, { kind: "unsupported" }]) {
      const f = await fixture(); Object.assign(f.turn, delta);
      await expect(readSavedMemorySessionHistory(f.input)).rejects.toMatchObject({ code: "SAVED_MEMORY_SESSION_HISTORY_UNAVAILABLE" });
    }
  });

  it("refuses missing SELECT rows and oversized SQL envelopes", async () => {
    const a = await fixture(); a.missing();
    await expect(readSavedMemorySessionHistory(a.input)).rejects.toMatchObject({ statusCode: 409 });
    const b = await fixture(); b.reply.turns = null;
    await expect(readSavedMemorySessionHistory(b.input)).rejects.toMatchObject({ statusCode: 413, code: "SAVED_MEMORY_BUDGET_LIMITED" });
  });

  it("refuses mismatched original proof digest, claim or task instead of certifying a replacement", async () => {
    for (const delta of [{ proofDigest: "0".repeat(64) }, { completionID: id(77) }, { taskID: id(66) }]) {
      const f = await fixture(); Object.assign(f.turn.ancestor, delta);
      await expect(readSavedMemorySessionHistory(f.input)).rejects.toMatchObject({ statusCode: 409 });
    }
  });

  it("refuses Session retention metadata inconsistent with the original proof", async () => {
    const f = await fixture(); Object.assign(f.turn.ancestor, { sourceTaskExpiresAt: "2030-01-01T00:00:30.000000Z" });
    await expect(readSavedMemorySessionHistory(f.input)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("never follows a caller's auth/owner/task replacement while its real SELECT is pending", async () => {
    const f = await fixture(), hold = f.hold();
    const pending = readSavedMemorySessionHistory(f.input);
    f.input.taskID = id(99); f.input.auth = { ...auth, userId: id(98) };
    hold.release();
    expect(f.consume(await pending).taskID).toBe(id(9));
  });

  it("rejects cloned and proxy receipts with no unpacking hooks", async () => {
    const f = await fixture(), receipt = await readSavedMemorySessionHistory(f.input); let touched = 0;
    for (const fake of [{ ...receipt }, new Proxy(receipt, { get() { touched++; throw new Error("must not execute"); } })])
      expect(() => f.consume(fake as typeof receipt)).toThrow();
    expect(touched).toBe(0); expect(f.consume(receipt).taskID).toBe(id(9));
  });

  it("uses private foreign-error identity before auth hooks and leaves the genuine receipt consumable", async () => {
    const a = await fixture(), b = await fixture(), receipt = await readSavedMemorySessionHistory(a.input); let touched = 0;
    const hooked = Object.defineProperty({ ...auth }, "accountId", { get() { touched++; return auth.accountId; } });
    let error: unknown;
    try { consumeSessionHistoryReceipt(receipt, b.owner, hooked, id(4), id(5), id(9)); } catch (value) { error = value; }
    expect(isForeignSessionHistoryReceiptError(error)).toBe(true);
    expect(isForeignSessionHistoryReceiptError({ code: "SAVED_MEMORY_SESSION_HISTORY_UNAVAILABLE" })).toBe(false);
    expect(isForeignSessionHistoryReceiptError(new Proxy(error as object, {}))).toBe(false);
    expect(touched).toBe(0); expect(a.owner.signal.aborted || b.owner.signal.aborted).toBe(false);
    expect(a.consume(receipt).taskID).toBe(id(9));
  });

  it("preflights only genuine foreign receipt identity without consuming, hooks or phase/clock authority", async () => {
    const a = await fixture(), b = await fixture(), receipt = await readSavedMemorySessionHistory(a.input);
    let touched = 0;
    const proxy = new Proxy(receipt, { get() { touched++; throw new Error("must not execute"); } });
    expect(isForeignSessionHistoryReceipt(receipt, a.owner)).toBe(false);
    expect(isForeignSessionHistoryReceipt(receipt, b.owner)).toBe(true);
    expect(isForeignSessionHistoryReceipt({ ...receipt } as typeof receipt, b.owner)).toBe(false);
    expect(isForeignSessionHistoryReceipt(proxy, b.owner)).toBe(false);
    expect(touched).toBe(0); expect(a.owner.signal.aborted || b.owner.signal.aborted).toBe(false);
    expect(a.consume(receipt).taskID).toBe(id(9)); // Preflight did not consume.
    vi.spyOn(performance, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
    expect(isForeignSessionHistoryReceipt(receipt, b.owner)).toBe(true); // Known identity survives late phases/deadlines.
    expect(isForeignSessionHistoryReceipt(receipt, a.owner)).toBe(false); // False still cannot renew or reconsume.
    expect(() => a.consume(receipt)).toThrow();
  });

  it.each(["session", "run", "task", "login"] as const)("refuses a %s handoff substitution", async kind => {
    const f = await fixture(), receipt = await readSavedMemorySessionHistory(f.input);
    expect(() => consumeSessionHistoryReceipt(receipt, f.owner, kind === "login" ? { ...auth, sessionId: id(99) } : auth,
      kind === "session" ? id(99) : id(4), kind === "run" ? id(99) : id(5), kind === "task" ? id(99) : id(9))).toThrow();
  });

  it("allows exactly one successful data handoff", async () => {
    const f = await fixture(), receipt = await readSavedMemorySessionHistory(f.input);
    f.consume(receipt); expect(() => f.consume(receipt)).toThrow();
  });

  it("retains the exact SQL driver identity for the private owner's provenance fence", async () => {
    const f = await fixture(), receipt = await readSavedMemorySessionHistory(f.input);
    expect(sessionHistoryReceiptUsesDatabase(receipt, f.owner, f.input.database)).toBe(true);
    expect(sessionHistoryReceiptUsesDatabase(receipt, f.owner, { query: f.input.database.query } as typeof f.input.database)).toBe(false);
    f.consume(receipt);
    expect(sessionHistoryReceiptUsesDatabase(receipt, f.owner, f.input.database)).toBe(true);
  });

  it("rejects a row/source stamp from a different observation", async () => {
    const f = await fixture(); (f.reply.source as { sessionStamp: string }).sessionStamp = "c".repeat(32);
    await expect(readSavedMemorySessionHistory(f.input)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects a cloned source handle or a different guard without invoking either callback", async () => {
    const f = await fixture(); let touched = 0;
    await expect(readSavedMemorySessionHistory({ ...f.input, source: { ...f.input.source } as typeof f.input.source }))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(readSavedMemorySessionHistory({ ...f.input, guard: async () => { touched++; } }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(touched).toBe(0); expect(f.historyCalls()).toBe(0);
  });

  it("does not execute getters, proxies or toJSON while capturing rows", async () => {
    const f = await fixture(); let touched = 0;
    f.reply.source = { ...f.reply.source as object, personIDs: new Proxy([], { get() { touched++; return undefined; } }) };
    await expect(readSavedMemorySessionHistory(f.input)).rejects.toMatchObject({ statusCode: 409 });
    const g = await fixture(); Object.defineProperty(g.turn, "ancestor", { enumerable: true, get() { touched++; return null; } });
    await expect(readSavedMemorySessionHistory(g.input)).rejects.toMatchObject({ statusCode: 409 });
    expect(touched).toBe(0);
  });

  it("keeps the actual inline suffix and last12/current/blank selection, not six messages", async () => {
    const f = await fixture(); f.turn.human_messages = Array.from({ length: 20 }, (_, n) => ({ message_id: id(100 + n), text: `human${n}:` + "x".repeat(900) }));
    f.turn.assistant_text = " ";
    const raw = f.turn.human_messages.map(message => ({ ...message, role: "user" as const, text: message.text.slice(0, 2000) }));
    const expected = boundedConversationHistory(boundInlineAgentSessionMessages([...raw,
      { message_id: id(6), role: "assistant" as const, text: " " }]), id(119));
    const facts = f.consume(await readSavedMemorySessionHistory({ ...f.input, currentMessageID: id(119) }));
    expect(facts.messages).toEqual(expected); expect(facts.messages.length).toBeGreaterThan(6);
    expect(facts.ancestors).toEqual([]); // Blank assistant was not exposed.
  });

  it("refuses an ACK or later handoff beyond the actual original SQL horizon", async () => {
    let now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = await fixture(), receipt = await readSavedMemorySessionHistory(f.input);
    now += 60_001; expect(() => f.consume(receipt)).toThrow();
    const g = await fixture(); g.onRead(() => { now += 60_001; });
    await expect(readSavedMemorySessionHistory(g.input)).rejects.toMatchObject({ statusCode: 409 });
  });
});
