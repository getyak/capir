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
    expect(partsOf(pending[1]!)).toEqual(["talent-signal.execution"]);
    expect(JSON.stringify(pending[1]!.content)).not.toContain("收到，我先理清这件事。");
    const execution = (pending[1]!.content as Array<{ name?: string; data?: unknown }>)[0]!.data as Record<string, unknown>;
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

  it("pins the in-flight work marker to its exact message identity", () => {
    // Without a run or preview the handoff marker carries no forming text, so
    // the surface renders exactly one compact work row for this message id.
    const messages = sessionMessages({ turns: [], active: null, preview: null, handoff: [{ messageId: MESSAGE, objective: "请继续", createdAt: "2026-09-29T01:00:00.000Z" }] });
    const data = (messages[1]!.content as Array<{ name?: string; data?: Record<string, unknown> }>)[0]!;
    expect(data.name).toBe("talent-signal.work-row");
    expect(data.data?.messageId).toBe(MESSAGE);
    expect(data.data?.text).toBe("");
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

it("restores every steered original before one final result and uses actual run bounds rather than queue wait", () => {
  const first = turn();
  first.steeredMessages = [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", objective: "补充交付边界", createdAt: "2026-09-29T01:00:05Z", images: first.images }];
  first.response.execution = { started_at: "2026-09-29T01:00:03Z", completed_at: "2026-09-29T01:00:11Z", tools: [{ name: "contact_read", completed_at: "2026-09-29T01:00:04Z" }] };
  const duplicate = { queue_entry_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", message_id: first.steeredMessages[0]!.id, sequence: 2, status: "queued" as const, objective: "补充交付边界", created_at: "2026-09-29T01:00:05Z", updated_at: "2026-09-29T01:00:05Z", revision: 1, run_id: null, stage: null, cancel_requested: false, failure_code: null };
  const messages = sessionMessages({ turns: [first], active: null, preview: null, queued: [duplicate] });
  expect(messages.map(message => message.id)).toEqual([`${MESSAGE}:user`, `${duplicate.message_id}:user`, `${MESSAGE}:assistant`]);
  expect(messages[1]?.content).toContainEqual({ type: "text", text: "补充交付边界" });
  expect(messages[1]?.createdAt.toISOString()).toBe("2026-09-29T01:00:05.000Z");
  expect(messages[1]?.content[1]).toMatchObject({ data: { messageId: duplicate.message_id, images: first.images } });
  expect(messages[2]?.content[0]).toMatchObject({ data: { startedAt: "2026-09-29T01:00:03Z", endedAt: "2026-09-29T01:00:11Z", timingBasis: "run", completedTools: first.response.execution.tools } });
});

it("keeps sent image manifests in original order and identity for history, active and queued messages", () => {
  const images = ["first.png", "second.png", "third.png"].map((file_name, position) => ({
    attachment_id: `f0000000-0000-4000-8000-${String(position).padStart(12, "0")}`,
    file_name,
    media_type: "image/png" as const,
    byte_size: 8,
    content_hash: "a".repeat(64),
  }));
  const first = turn();
  first.objective = "看这三张截图";
  first.images = images;
  const history = sessionMessages({ turns: [first], active: null, preview: null })[0]!;
  expect(history.id).toBe(`${MESSAGE}:user`);
  // Mixed sends keep readable text before the ordered image manifest.
  expect(history.content.map((part) => part.type)).toEqual(["text", "data"]);
  const historyParts = history.content as Array<{ type: string; name?: string; data?: unknown }>;
  const historyImages = historyParts.find((part) => part.name === "talent-signal.user-images")!.data as Record<string, unknown>;
  expect(historyImages).toMatchObject({ messageId: MESSAGE, local: false });
  expect(historyImages.images).toEqual(images);

  const entry: ConversationQueueEntry = {
    queue_entry_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    message_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    sequence: 1,
    status: "queued",
    objective: "",
    images,
    created_at: "2026-10-06T01:00:00Z",
    updated_at: "2026-10-06T01:00:00Z",
    revision: 1,
    run_id: null,
    stage: null,
    cancel_requested: false,
    failure_code: null,
  };
  for (const projected of [
    sessionMessages({ turns: [], active: { ...entry, status: "running" }, preview: null })[0]!,
    sessionMessages({ turns: [], active: null, preview: null, queued: [entry] })[0]!,
  ]) {
    expect(projected.id).toBe(`${entry.message_id}:user`);
    const projectedParts = projected.content as Array<{ type: string; name?: string; data?: unknown }>;
    const projectedImages = projectedParts.find((part) => part.name === "talent-signal.user-images")!.data as Record<string, unknown>;
    expect(projectedImages).toMatchObject({ messageId: entry.message_id, local: false });
    // Array position stays the immutable order; nothing is renumbered.
    expect((projectedImages.images as typeof images).map((image) => image.file_name)).toEqual(["first.png", "second.png", "third.png"]);
  }
});

it("preserves host result identity without projecting internal continuation as a human message at any lifecycle", () => {
  const host = { request_id: PROPOSAL, call_id: MESSAGE, original_message_id: MESSAGE,
    actor_user_id: PROPOSAL, kind: "form" as const, outcome: "submitted", choice_id: null, receipt_ref: null };
  const base: ConversationQueueEntry = { queue_entry_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", message_id: MESSAGE,
    sequence: 2, status: "queued", objective: "PRIVATE_HOST_CONTINUATION", host_result: host,
    created_at: "2026-10-04T01:00:00Z", updated_at: "2026-10-04T01:00:00Z", revision: 1,
    run_id: null, stage: null, cancel_requested: false, failure_code: null };
  for (const status of ["queued", "failed", "interrupted"] as const) {
    const projected = sessionMessages({ turns: [], active: null, preview: null, queued: [{ ...base, status }] });
    expect(projected.map(message => message.role)).toEqual(["assistant"]);
    expect(projected[0]?.content[0]).toMatchObject({ name: "talent-signal.mcp-human-result", data: { result: host } });
    expect(JSON.stringify(projected)).not.toContain(base.objective);
  }
  const active = sessionMessages({ turns: [], active: { ...base, status: "running" }, preview: null });
  expect(active.map(message => message.role)).toEqual(["assistant"]);
  expect(active[0]?.content[0]).toMatchObject({ name: "talent-signal.mcp-human-result", data: { result: host } });
  const completed = turn();
  completed.objective = base.objective;
  completed.response.hostResult = host;
  const restored = sessionMessages({ turns: [completed], active: null, preview: null });
  expect(restored.map(message => message.role)).toEqual(["assistant"]);
  expect(JSON.stringify(restored)).not.toContain(base.objective);
});
