import { describe, expect, it, vi } from "vitest";
import type { AgentProvider, AgentToolResult, HarnessSteeringMessage } from "@talent-signal/agent";
import { executeWorkspaceConversationAgentCore, type WorkspaceMemoryLookup } from "./workspaceConversationAgent.js";

const root = "11111111-1111-4111-8111-111111111111";
const update = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const result = { structuredOutput: { outcome: "reply", title: "Result", body: "Complete" },
  inputTokens: 1, outputTokens: 1, estimatedUsd: 0, turns: 1, permissionDenials: [] };
const supplement: HarnessSteeringMessage = { messageID: update, acceptedAt: new Date().toISOString(), text: "客户邮箱 alice@example.test。先给结论。" };
function feed(messages = [supplement]) { return { nextBatchAtSafePoint: vi.fn(async () => ({ messages })) }; }
const item = (excerpt: string, messageID: string) => ({ scope: "self", operation: "add", statement_kind: "fact",
  display_text: excerpt, time_status: "known", sensitivity: "normal", source_excerpt: excerpt,
  source_locator: { kind: "message", session_id: session, message_id: messageID }, reason: "An authored preference" });

it("grounds a new lookup only after a fenced checkpoint without joining separate message text", async () => {
  const search = vi.fn(async () => []);
  const receipts: AgentToolResult[] = [];
  const provider: AgentProvider = { id: "checkpoint-fixture", model: "fixture", sdkVersion: "fixture", inputCapabilities: { text: true, image: false, imageUnderstanding: false, steering: true },
    async run(request, invoke, signal) {
      receipts.push(await invoke("contact_workspace", { operation: "search", query: "alice@example.test" }, signal));
      await request.steering!.nextBatchAtSafePoint();
      receipts.push(await invoke("contact_workspace", { operation: "search", query: "alice@example.test" }, signal));
      receipts.push(await invoke("contact_workspace", { operation: "search", query: "资料客户" }, signal));
      return result;
    } };
  await executeWorkspaceConversationAgentCore({ workspaceID: "fixture", sessionID: session, messageID: root,
    objective: "查找客户资料", contacts: { search, read: vi.fn() }, provider, steering: feed() });
  expect(receipts.map(receipt => receipt.ok)).toEqual([false, true, false]);
  expect(search).toHaveBeenCalledExactlyOnceWith("alice@example.test");
});

it("stages a supplemental Memory excerpt with its original message ID and rejects cross-message provenance", async () => {
  const stage = vi.fn<WorkspaceMemoryLookup["stage"]>(async () => ({ proposalID: root, proposalRevision: 1, itemCount: 1, defaultSelectedCount: 0,
    scopeCounts: { self: 1, person: 0, relationship: 0 }, contactStatus: "pending" as const, personID: null, personDisplayLabel: null }));
  const memory: WorkspaceMemoryLookup = { stage, recall: vi.fn(async () => ({ items: [] })) };
  const receipts: AgentToolResult[] = [];
  const provider: AgentProvider = { id: "memory-checkpoint-fixture", model: "fixture", sdkVersion: "fixture", inputCapabilities: { text: true, image: false, imageUnderstanding: false, steering: true },
    async run(request, invoke, signal) {
      await request.steering!.nextBatchAtSafePoint();
      const propose = (items: unknown[]) => invoke("memory_review", { operation: "propose", contact_decision: "none", items }, signal);
      receipts.push(await propose([item("先给结论", root)]));
      receipts.push(await propose([item("只做资料查找", root), item("先给结论", update)]));
      receipts.push(await propose([item("先给结论", update)]));
      expect(request.calendarContext!.resolveMessageExcerpt!("先给结论")).toEqual({ messageID: update, text: supplement.text });
      return result;
    } };
  await executeWorkspaceConversationAgentCore({ workspaceID: "fixture", sessionID: session, messageID: root,
    objective: "只做资料查找", contacts: { search: vi.fn(), read: vi.fn() }, memory, provider, steering: feed(),
    calendarContext: { sourceRequestID: root, referenceTime: new Date().toISOString(), timeZone: "Asia/Shanghai" } });
  expect(receipts.map(receipt => receipt.ok)).toEqual([false, false, true]);
  expect(stage).toHaveBeenCalledOnce();
  expect(stage.mock.calls[0]![0]).toMatchObject({ sourceMessageID: update, sourceText: supplement.text,
    items: [{ source_locator: { message_id: update, session_id: session } }] });
});


it("accepts successful silence without substituting a failure or action claim", async () => {
  const provider: AgentProvider = { id: "silent-fixture", model: "fixture", sdkVersion: "fixture",
    inputCapabilities: { text: true, image: false, imageUnderstanding: false },
    async run() { return { ...result, structuredOutput: { outcome: "reply", title: "Reply", body: "" } }; } };
  const execution = await executeWorkspaceConversationAgentCore({ workspaceID: "fixture", objective: "No reply needed",
    contacts: { search: vi.fn(), read: vi.fn() }, provider });
  expect(execution.block.body).toBe("");
  expect(execution.event).toBeNull();
});
