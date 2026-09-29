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

describe("Session message projection", () => {
  it("keeps canonical message identity and puts governed card references after the answer", () => {
    const messages = sessionMessages({ turns: [turn()], active: null, preview: null });
    expect(messages.map((message) => message.id)).toEqual([`${MESSAGE}:user`, `${MESSAGE}:assistant`]);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    const userParts = messages[0]!.content as Array<{ type: string; name?: string; data?: unknown }>;
    expect(userParts.some((part) => part.name === "talent-signal.user-images")).toBe(true);
    const parts = messages[1]!.content as Array<{ type: string; name?: string; data?: unknown }>;
    expect(parts.map((part) => part.name)).toEqual([
      "talent-signal.answer-block", "talent-signal.memory", "talent-signal.calendar",
    ]);
    const memory = parts[1]!.data as Record<string, unknown>;
    expect(memory).toMatchObject({ version: 1, messageId: MESSAGE, proposalId: PROPOSAL, revision: 3 });
    expect(JSON.stringify(memory)).not.toContain("source.png");
    expect(JSON.stringify(memory)).not.toContain("credential");
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
    const pending = sessionMessages({ turns: [], active, preview });
    expect(pending.map((message) => message.id)).toEqual([`${MESSAGE}:user`, `${MESSAGE}:assistant`]);
    expect((pending[1]!.content as Array<{ name?: string }>)[0]!.name).toBe("talent-signal.progress");
  });
});
