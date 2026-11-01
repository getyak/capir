import { randomUUID } from "node:crypto";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import {
  ConversationQueueAppliedSchema,
  ConversationQueueMutationRequestSchema,
} from "@talent-signal/contracts";

FormatRegistry.Set("uuid", (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value));
const base = { queue_entry_id: randomUUID(), expected_revision: 1, idempotency_key: "withdrawal-contract" };
const applied = { kind: "withdraw", queue_entry_id: base.queue_entry_id, run_id: null, status: null };

describe("withdrawal receipt contract", () => {
  it("accepts legacy requests and legacy receipts without an opt-in or identity field", () => {
    expect(Value.Check(ConversationQueueMutationRequestSchema, { ...base, kind: "withdraw" })).toBe(true);
    expect(Value.Check(ConversationQueueAppliedSchema, applied)).toBe(true);
  });
  it("accepts true opt-in only on withdraw", () => {
    expect(Value.Check(ConversationQueueMutationRequestSchema, { ...base, kind: "withdraw", include_withdrawn_message_ids: true })).toBe(true);
    for (const kind of ["edit", "retry", "continue", "stop", "prioritize"]) {
      const { queue_entry_id, ...common } = base;
      const request = { ...common, kind, ...(["continue", "stop"].includes(kind) ? {} : { queue_entry_id }), ...(kind === "edit" ? { objective: "edit" } : {}), ...(kind === "stop" ? { run_id: randomUUID() } : {}) };
      expect(Value.Check(ConversationQueueMutationRequestSchema, request)).toBe(true);
      expect(Value.Check(ConversationQueueMutationRequestSchema, { ...request, include_withdrawn_message_ids: true })).toBe(false);
    }
    expect(Value.Check(ConversationQueueMutationRequestSchema, { ...base, kind: "withdraw", include_withdrawn_message_ids: false })).toBe(false);
  });
  it.each([1, 51])("accepts %s unique withdrawn UUID identities", (count) => {
    expect(Value.Check(ConversationQueueAppliedSchema, { ...applied, withdrawn_message_ids: Array.from({ length: count }, () => randomUUID()) })).toBe(true);
  });
  it.each([
    [], [base.queue_entry_id, base.queue_entry_id], ["invalid"], Array.from({ length: 52 }, () => randomUUID()),
  ].map((ids) => ({ ids })))("refuses an invalid identity set $ids", ({ ids: withdrawn_message_ids }) => {
    expect(Value.Check(ConversationQueueAppliedSchema, { ...applied, withdrawn_message_ids })).toBe(false);
  });
});


// Route-only proof supplements (and does not replace) isolated-PG producer tests.
const route = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("./conversationQueue.js", () => ({ mutateConversationQueueEntry: route.mutate, admitConversationQueueEntry: vi.fn(), readConversationQueueSnapshot: vi.fn() }));
vi.mock("./auth.js", () => ({ currentSession: vi.fn() }));
vi.mock("./conversationMessageImages.js", () => ({ readConversationMessageImage: vi.fn() }));
vi.mock("./conversationQueueLive.js", () => ({ readConversationQueuePreview: vi.fn(), subscribeConversationQueueLive: vi.fn() }));
import { registerConversationQueueRoutes } from "./conversationQueueRoutes.js";
import { CONTRACT_VERSION } from "@talent-signal/contracts";

describe("withdrawal receipt route projection", () => {
  it("keeps legacy wire shape while retaining canonical IDs and transmits exact opt-in IDs", async () => {
    const app = Fastify();
    registerConversationQueueRoutes(app, {} as never, async () => undefined);
    const sessionId = randomUUID();
    const canonical = { ...applied, withdrawn_message_ids: [randomUUID(), randomUUID()].sort() };
    const snapshot = { contract_version: CONTRACT_VERSION, session_id: sessionId, revision: 2, paused: false, active: null, queued: [], preview: null };
    route.mutate.mockResolvedValue({ snapshot, applied: canonical, replayed: false });
    try {
      for (const optIn of [false, true]) {
        const body = { ...base, kind: "withdraw", ...(optIn ? { include_withdrawn_message_ids: true } : {}) };
        const response = await app.inject({ method: "POST", url: `/v1/agent-sessions/${sessionId}/conversation-queue/mutations`, payload: body });
        expect(response.statusCode).toBe(200);
        expect(response.json().applied).toEqual(optIn ? canonical : applied);
        expect(canonical.withdrawn_message_ids).toHaveLength(2);
        expect(route.mutate.mock.calls.at(-1)![3]).toEqual(body);
      }
    } finally { await app.close(); }
  });
});
