import { expect, it } from "vitest";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import { conversationCopyText } from "./session-conversation-copy";

it("copies sent text and final prose in order without exporting governed or hidden material", () => {
  const turns = [{ id: "human", objective: "Sent synthetic text", createdAt: "2026-10-29T00:00:00Z", images: [{ file_name: "PRIVATE_IMAGE" }], response: {
    taskID: "task", createdAt: "2026-10-29T00:00:05Z", disposition: "answer",
    unboundConversationBlocks: [
      { id: "answer", kind: "answer", title: "Reply", body: "Final synthetic answer", status: "informational", requires_user_decision: false },
      { id: "proposal", kind: "proposal", body: "PRIVATE_PROPOSAL", status: "proposed", requires_user_decision: true },
    ],
    memoryProposal: { proposal_id: "PRIVATE_MEMORY", revision: 1 },
    execution: { tools: [{ name: "PRIVATE_TOOL", completed_at: "2026-10-29T00:00:04Z" }], completed_at: "2026-10-29T00:00:05Z" },
  } }] as unknown as SessionDetail["turns"];
  const text = conversationCopyText(turns, { user: "You", assistant: "capri" });
  expect(text).toBe("You\n\nSent synthetic text\n\ncapri\n\nFinal synthetic answer");
  expect(text).not.toContain("PRIVATE");
});
