import { describe, expect, it, vi } from "vitest";
import { claudeHarnessConfiguration, runClaudeHarness } from "@talent-signal/agent";
import { createConversationQueueSteeringFeed, CONVERSATION_STEER_IMAGE_UNSUPPORTED, CONVERSATION_STEER_MESSAGE_LIMIT, type ConversationQueueSteeringSource, type ConversationQueuePendingSteeringMessage } from "./conversationQueueSteering.js";

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
function fixture() {
  let clock = Date.parse("2026-10-01T01:00:00Z"); let lost = false; let closed = false;
  const rows: ConversationQueuePendingSteeringMessage[] = []; const unsupported = new Map<string, string>(); const trace: string[] = [];
  const source: ConversationQueueSteeringSource = {
    readAwaiting: vi.fn(async () => rows.filter(r => r.steerState === "awaiting")),
    claim: vi.fn(async keys => { trace.push("claim"); const found = rows.filter(r => keys.includes(r.entryId) && r.steerState === "awaiting"); found.forEach(r => { r.steerState = "dispatching"; }); return found.map(r => ({ ...r })); }),
    acknowledge: vi.fn(async keys => { if (lost) throw new Error("SOURCE_REVOKED"); trace.push("ack"); rows.filter(r => keys.includes(r.entryId)).forEach(r => { r.steerState = "delivered"; }); }),
    markUnsupported: vi.fn(async (keys, code) => { rows.filter(r => keys.includes(r.entryId)).forEach(r => { r.steerState = "unsupported"; unsupported.set(r.entryId, code); }); }),
    closeIntake: vi.fn(async () => { if (rows.some(r => r.steerState === "awaiting" || r.steerState === "dispatching")) return false; closed = true; return true; }),
    assertLive: vi.fn(async () => { if (lost) throw new Error("SOURCE_REVOKED"); }), loadImages: vi.fn(async () => []),
  };
  const admit = (index: number, images: ConversationQueuePendingSteeringMessage["images"] = []) => {
    const row: ConversationQueuePendingSteeringMessage = { entryId: `entry-${index}`, messageId: ids[index % 3]!, objective: `fragment ${index}`, acceptedAt: new Date(clock).toISOString(), images, steerState: "awaiting" };
    rows.push(row); return row;
  };
  const feed = createConversationQueueSteeringFeed(source, { now: () => new Date(clock), sleep: async ms => { trace.push(`sleep:${ms}`); clock += ms; } });
  return { source, rows, trace, feed, admit, unsupported, advance: (ms: number) => { clock += ms; }, revoke: () => { lost = true; }, closed: () => closed };
}

describe("durable steering policy at primary checkpoints", () => {
  it("preserves an empty intake until a final checkpoint", async () => {
    const f = fixture(); expect(await f.feed.nextBatchAtSafePoint()).toEqual({ messages: [] }); expect(f.closed()).toBe(false);
    expect(await f.feed.nextBatchAtSafePoint({ final: true })).toBeNull(); expect(f.closed()).toBe(true);
  });

  it("combines rapid fragments with original identity and time, then acknowledges only after model consumption", async () => {
    const f = fixture(); const b = f.admit(1); f.advance(200); const c = f.admit(2);
    const batch = await f.feed.nextBatchAtSafePoint();
    expect(f.trace).toContain("sleep:750");
    expect(batch?.messages.map(m => [m.messageID, m.acceptedAt, m.text])).toEqual([[b.messageId, b.acceptedAt, b.objective], [c.messageId, c.acceptedAt, c.objective]]);
    expect(f.rows.map(r => r.steerState)).toEqual(["dispatching", "dispatching"]); expect(f.source.acknowledge).not.toHaveBeenCalled();
    await batch?.acknowledge?.(); expect(f.rows.map(r => r.steerState)).toEqual(["delivered", "delivered"]);
    expect(await f.feed.nextBatchAtSafePoint({ final: true })).toBeNull();
  });

  it("catches admission between the last empty read and final closure", async () => {
    const f = fixture(); let raced = false;
    vi.mocked(f.source.closeIntake).mockImplementation(async () => { if (!raced) { raced = true; f.admit(1); return false; } return true; });
    const batch = await f.feed.nextBatchAtSafePoint({ final: true }); expect(batch?.messages[0]?.messageID).toBe(ids[1]); await batch?.acknowledge?.();
    expect(await f.feed.nextBatchAtSafePoint({ final: true })).toBeNull();
  });

  it("keeps whole image messages for the next task and can close with only unsupported members", async () => {
    const f = fixture(); const image = { attachment_id: ids[0]!, file_name: "synthetic.png", media_type: "image/png" as const, byte_size: 8, content_hash: "a".repeat(64) };
    f.admit(1, Array.from({ length: 6 }, () => image)); f.admit(2, Array.from({ length: 6 }, () => image));
    expect(await f.feed.nextBatchAtSafePoint({ final: true })).toBeNull(); expect(f.closed()).toBe(true);
    expect([...f.unsupported.values()]).toEqual([CONVERSATION_STEER_IMAGE_UNSUPPORTED, CONVERSATION_STEER_IMAGE_UNSUPPORTED]);
    expect(f.rows.map(r => r.images.length)).toEqual([6, 6]); expect(f.source.loadImages).not.toHaveBeenCalled(); expect(f.source.claim).not.toHaveBeenCalled();
  });

  it("bounds a long fragment stream and keeps overflow explicit", async () => {
    const f = fixture(); for (let i = 0; i < 22; i++) f.admit(i);
    const batch = await f.feed.nextBatchAtSafePoint(); expect(batch?.messages).toHaveLength(20);
    expect([...f.unsupported.values()]).toEqual([CONVERSATION_STEER_MESSAGE_LIMIT, CONVERSATION_STEER_MESSAGE_LIMIT]);
    await batch?.acknowledge?.(); expect(await f.feed.nextBatchAtSafePoint({ final: true })).toBeNull();
  });

  it("leaves a dispatched message unacknowledged after source revocation", async () => {
    const f = fixture(); f.admit(1); const batch = await f.feed.nextBatchAtSafePoint(); f.revoke();
    await expect(batch?.acknowledge?.()).rejects.toThrow("SOURCE_REVOKED"); expect(f.rows[0]?.steerState).toBe("dispatching");
  });

  it("wires production coalescing into the actual harness Stop checkpoint and returns only the latest combined final", async () => {
    const f = fixture(); f.admit(1); f.advance(100); f.admit(2);
    const driver = (({ prompt, options }: any) => ({ close: vi.fn(), async *[Symbol.asyncIterator]() {
      for await (const _ of prompt) { /* SDK eager input */ }
      expect(f.source.claim).not.toHaveBeenCalled();
      const stop = options.hooks.Stop[0].hooks[0];
      const context = await stop({ hook_event_name: "Stop", stop_hook_active: false });
      expect(context.hookSpecificOutput.additionalContext).toContain("fragment 1"); expect(context.hookSpecificOutput.additionalContext).toContain("fragment 2");
      expect(f.source.acknowledge).not.toHaveBeenCalled();
      expect(await stop({ hook_event_name: "Stop", stop_hook_active: true })).toEqual({});
      yield { type: "result", subtype: "success", result: "Final using both fragments", is_error: false, modelUsage: {}, total_cost_usd: 0, num_turns: 2, session_id: "synthetic", permission_denials: [] };
    } })) as any;
    const outcome = await runClaudeHarness(claudeHarnessConfiguration({ ANTHROPIC_API_KEY: "synthetic", TALENT_SIGNAL_AGENT_MODEL: "synthetic" }), {
      objective: "Synthetic task", systemPrompt: "Synthetic", tools: [], assertCurrent: async () => {}, steering: f.feed,
      budget: { maxTurns: 8, maxToolCalls: 8, maxDurationMs: 30000, maxTaskTokens: 4000, maxEstimatedUsd: 1 },
    }, new AbortController().signal, driver, null);
    expect(outcome.text).toBe("Final using both fragments"); expect(f.rows.map(r => r.steerState)).toEqual(["delivered", "delivered"]);
    expect(f.source.acknowledge).toHaveBeenCalledTimes(1);
  });
});
