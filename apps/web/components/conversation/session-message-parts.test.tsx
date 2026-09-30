import { describe, expect, it } from "vitest";
import type { ConversationQueueEntry, ConversationQueuePreview } from "@talent-signal/contracts";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import { sessionMessages } from "./session-message-parts";

const MESSAGE = "44444444-4444-4444-8444-444444444444";
const PROPOSAL = "55555555-5555-4555-8555-555555555555";

function turn(): SessionDetail["turns"][number] {
  return {
    id: MESSAGE,
    objective: "把陈宇的设计合作记录下来",
    images: [{ attachment_id: "66666666-6666-4666-8666-666666666666", file_name: "source.png", media_type: "image/png", byte_size: 8, content_hash: "a".repeat(64) }],
    createdAt: "2026-09-29T01:00:00.000Z",
    response: {
      contractVersion: "2026-08-24.10",
      taskID: "77777777-7777-4777-8777-777777777777",
      contextManifestID: "",
      knowledgeSnapshotID: "",
      disposition: "answer",
      createdAt: "2026-09-29T01:00:01.000Z",
      unboundConversationBlocks: [{ id: "block-1", kind: "answer", title: "已整理", body: "陈宇负责设计协作。", status: "informational", citation_dependency_ids: [], requires_user_decision: false, allows_static_share: false, target_ref: null }],
      memoryProposal: { proposal_id: PROPOSAL, revision: 3 },
      meetingDraft: { id: "88888888-8888-4888-8888-888888888888", title: "下周回访" },
    },
  } as SessionDetail["turns"][number];
}

function partsOf(message: { content: Array<{ type: string; name?: string; data?: unknown }> }) {
  return message.content.filter((part) => part.type === "data").map((part) => part.name);
}

describe("Session message projection", () => {
  it("keeps canonical message identity and puts governed card references after the answer", () => {
    const messages = sessionMessages({ turns: [turn()], active: null, preview: null });
    expect(messages.map((message) => message.id)).toEqual([`${MESSAGE}:user`, `${MESSAGE}:assistant`]);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    const userParts = messages[0]!.content as Array<{ type: string; name?: string; data?: unknown }>;
    expect(userParts.some((part) => part.name === "talent-signal.user-images")).toBe(true);
    const parts = messages[1]!.content as Array<{ type: string; name?: string; data?: unknown }>;
    // The execution record sits above the standalone result; pending memory
    // and calendar decisions stay distinct blocks after it.
    expect(parts.map((part) => part.name)).toEqual([
      "talent-signal.execution", "talent-signal.answer-block", "talent-signal.memory", "talent-signal.calendar",
    ]);
    const execution = parts[0]!.data as Record<string, unknown>;
    expect(execution).toMatchObject({ phase: "completed", startedAt: "2026-09-29T01:00:00.000Z", endedAt: "2026-09-29T01:00:01.000Z" });
    const memory = parts[2]!.data as Record<string, unknown>;
    expect(memory).toMatchObject({ version: 1, messageId: MESSAGE, proposalId: PROPOSAL, revision: 3 });
    expect(JSON.stringify(memory)).not.toContain("source.png");
    expect(JSON.stringify(memory)).not.toContain("credential");
  });

  it("keeps a clean completed result standalone with only its collapsed execution record", () => {
    const clean = turn();
    delete (clean.response as Record<string, unknown>).memoryProposal;
    delete (clean.response as Record<string, unknown>).meetingDraft;
    const messages = sessionMessages({ turns: [clean], active: null, preview: null });
    expect(partsOf(messages[1]!)).toEqual(["talent-signal.execution", "talent-signal.answer-block"]);
    const execution = (messages[1]!.content as Array<{ name?: string; data?: unknown }>).find((part) => part.name === "talent-signal.execution")!.data as Record<string, unknown>;
    expect(execution.phase).toBe("completed");
    // The result body is a separate part: the record never wraps or restates it.
    expect(JSON.stringify(execution)).not.toContain("陈宇负责设计协作");
  });

  it("records a stopped run as interrupted from its persisted cancelled identity", () => {
    const stopped = turn();
    delete (stopped.response as Record<string, unknown>).memoryProposal;
    delete (stopped.response as Record<string, unknown>).meetingDraft;
    (stopped.response as Record<string, unknown>).taskID = `cancelled-${MESSAGE}`;
    const messages = sessionMessages({ turns: [stopped], active: null, preview: null });
    const execution = (messages[1]!.content as Array<{ name?: string; data?: unknown }>).find((part) => part.name === "talent-signal.execution")!.data as Record<string, unknown>;
    expect(execution.phase).toBe("interrupted");
  });

  it("keeps an empty assistant response valid with no fabricated placeholder", () => {
    const silent = turn();
    delete (silent.response as Record<string, unknown>).memoryProposal;
    delete (silent.response as Record<string, unknown>).meetingDraft;
    (silent.response as Record<string, unknown>).unboundConversationBlocks = [];
    (silent.response as Record<string, unknown>).savedBlocks = [];
    const messages = sessionMessages({ turns: [silent], active: null, preview: null });
    expect(partsOf(messages[1]!)).toEqual(["talent-signal.execution"]);
    expect(JSON.stringify(messages[1]!.content)).not.toContain("这项结果暂时无法显示");
  });

  it("projects an in-flight response as incomplete without duplicating a committed turn", () => {
    const active: ConversationQueueEntry = {
      queue_entry_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      message_id: MESSAGE,
      sequence: 1,
      status: "running",
      objective: "请继续",
      images: [],
      created_at: "2026-09-29T01:00:00.000Z",
      updated_at: "2026-09-29T01:00:01.000Z",
      revision: 1,
      run_id: "99999999-9999-4999-8999-999999999999",
      stage: "answer",
      cancel_requested: false,
      failure_code: null,
    };
    const preview = { run_id: active.run_id!, message_id: MESSAGE, text: "正在整理", stage: "answer", revision: 1 } as ConversationQueuePreview;
    expect(sessionMessages({ turns: [turn()], active, preview })).toHaveLength(2);
    const pending = sessionMessages({ turns: [], active, preview, milestones: [{ stage: "contact_lookup", label: "正在查找相关人物", observedAt: "2026-09-29T01:00:00.500Z" }] });
    expect(pending.map((message) => message.id)).toEqual([`${MESSAGE}:user`, `${MESSAGE}:assistant`]);
    expect(partsOf(pending[1]!)).toEqual(["talent-signal.run-update", "talent-signal.execution"]);
    const update = (pending[1]!.content as Array<{ name?: string; data?: unknown }>)[0]!.data as Record<string, unknown>;
    expect(update).toMatchObject({ updates: ["收到，我先理清这件事。"], stage: "answer" });
    const execution = (pending[1]!.content as Array<{ name?: string; data?: unknown }>)[1]!.data as Record<string, unknown>;
    expect(execution).toMatchObject({ phase: "running", stage: "answer", endedAt: null, draft: "正在整理" });
    expect(execution.milestones).toEqual([{ stage: "contact_lookup", label: "正在查找相关人物", observedAt: "2026-09-29T01:00:00.500Z" }]);
    // The ephemeral run update never becomes semantic result content.
    expect(partsOf(pending[1]!)).not.toContain("talent-signal.answer-block");
  });

  it("keeps a paused or stopping run's partial truth on the observed entry", () => {
    const base: ConversationQueueEntry = {
      queue_entry_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      message_id: MESSAGE,
      sequence: 1,
      status: "running",
      objective: "请继续",
      created_at: "2026-09-29T01:00:00.000Z",
      updated_at: "2026-09-29T01:00:01.000Z",
      revision: 1,
      run_id: "99999999-9999-4999-8999-999999999999",
      stage: "answer",
      cancel_requested: true,
      failure_code: null,
    };
    const pending = sessionMessages({ turns: [], active: base, preview: null });
    const execution = (pending[1]!.content as Array<{ name?: string; data?: unknown }>).find((part) => part.name === "talent-signal.execution")!.data as Record<string, unknown>;
    expect(execution.phase).toBe("stopping");
  });
});

it("keeps one execution identity when a queued message fails without producing an answer", () => {
  const base: ConversationQueueEntry = { queue_entry_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", message_id: MESSAGE, sequence: 1, status: "queued", objective: "Synthetic request", created_at: "2026-10-01T01:00:00Z", updated_at: "2026-10-01T01:00:00Z", revision: 1, run_id: null, stage: null, cancel_requested: false, failure_code: null };
  const project = (entry: ConversationQueueEntry) => sessionMessages({ turns: [], active: null, preview: null, queued: [entry] });
  const queued = project(base);
  const failed = project({ ...base, status: "failed", failure_code: "RUN_FAILED", updated_at: "2026-10-01T01:00:05Z", revision: 2 });
  expect(queued.map(message => message.id)).toEqual(failed.map(message => message.id));
  expect(partsOf(failed[1]!)).toEqual(["talent-signal.execution"]);
  expect(failed[1]!.content[0]).toMatchObject({ data: { phase: "failed", endedAt: "2026-10-01T01:00:05Z", failureCode: "RUN_FAILED" } });
});
