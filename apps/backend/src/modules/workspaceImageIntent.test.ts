import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ScriptedAgentProvider, type CurrentImageObservation } from "@talent-signal/agent";
import { executeWorkspaceConversationAgentCore, type WorkspaceMemoryLookup } from "./workspaceConversationAgent.js";

const imageMessageID = "10000000-0000-4000-8000-000000000001";
const laterMessageID = "10000000-0000-4000-8000-000000000002";
const artifactID = `conversation-image-${imageMessageID}-0-source`;
const bytes = Buffer.from("synthetic pixels");
const image = { kind: "image" as const, artifactID, mimeType: "image/png", byteSize: bytes.length,
  contentHash: createHash("sha256").update(bytes).digest("hex"), dataBase64: bytes.toString("base64") };
const observation: CurrentImageObservation = { conversation_kind: "direct", counterparty_name: "小雨",
  visible_text: ["小雨", "周四再聊。"], description: "Synthetic chat", uncertainties: [], model: "synthetic", request_id: "inspection" };
const contactProposal = { operation: "propose", contact_decision: "new", person_display_label: "小雨",
  new_contact_source_locator: { kind: "image_region", artifact_id: artifactID, image_index: 0 }, items: [] };

async function run(options: { objective?: string; sourceText?: string; messageID?: string;
  observation?: CurrentImageObservation; propose?: boolean; selfOnly?: boolean; olderImage?: boolean } = {}) {
  const stage = vi.fn<WorkspaceMemoryLookup["stage"]>(async () => ({ proposalID: "10000000-0000-4000-8000-000000000003", proposalRevision: 1,
    itemCount: 0, defaultSelectedCount: 0, scopeCounts: { self: 0, person: 0, relationship: 0 },
    contactStatus: "pending" as const, personID: null, personDisplayLabel: "小雨" }));
  const inspector = { inspect: vi.fn(async () => options.observation ?? observation) };
  const provider = new ScriptedAgentProvider(options.propose ? [{ tool: "memory_review", input: options.selfOnly
    ? { operation: "propose", contact_decision: "none", items: [{ scope: "self", operation: "add",
      statement_kind: "source_statement", display_text: "先给结论", source_excerpt: "先给结论",
      source_locator: { kind: "message", session_id: null, message_id: null }, time_status: "known",
      sensitivity: "normal", reason: "Explicit response preference" }] } : contactProposal }] : [],
    { outcome: "reply", title: "说明", body: "周四只是原文约定，具体日期仍需确认。" });
  const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic",
    messageID: options.messageID ?? imageMessageID, objective: options.objective ?? "图片内容",
    ...(options.sourceText !== undefined ? { sourceText: options.sourceText } : {}), provider,
    inputParts: options.olderImage ? [{ ...image, artifactID: `conversation-image-${laterMessageID}-0-old` }, image] : [image],
    imageInspector: inspector, imageIsCurrent: async () => true,
    contacts: { search: vi.fn(async () => []), read: vi.fn() },
    memory: { recall: async () => ({ items: [], hasMore: false, nextCursor: null }), stage } });
  return { result, stage, inspector };
}

describe("help-first current-image host boundary", () => {
  it.each(["只分析这张图片", "no_action", "不要保存记忆，先给结论", "不做任何操作，只给建议",
    "Only explain this image", "Do not save anything"])("keeps the answer without automatic proposals: %s", async objective => {
    const { result, stage } = await run({ objective });
    expect(result.block.body).toContain("具体日期仍需确认");
    expect(result.memoryProposal).toBeNull();
    expect(result.firstContactResearch).toEqual([]);
    expect(stage).not.toHaveBeenCalled();
  });

  it.each([false, true])("rejects a model proposal despite no-save intent (self-only=%s)", async selfOnly => {
    const { result, stage } = await run({ objective: "不要保存记忆或联系人，先给结论", propose: true, selfOnly });
    expect(result.block.body).toContain("具体日期仍需确认");
    expect(result.memoryProposal).toBeNull();
    expect(result.firstContactResearch).toEqual([]);
    expect(stage).not.toHaveBeenCalled();
  });

  it("does not stage or research a historical image on a later text-only turn", async () => {
    const { result, stage } = await run({ messageID: laterMessageID, objective: "今天聊点轻松的" });
    expect(result.memoryProposal).toBeNull();
    expect(result.firstContactResearch).toEqual([]);
    expect(stage).not.toHaveBeenCalled();
  });

  it.each([
    { objective: "今天聊点轻松的", allowed: false },
    { objective: "保存我的回复偏好：以后先给结论", allowed: false },
    { objective: "Save my response preference: conclusion first", allowed: false },
    { objective: "请保存联系人：历史图片里的小雨", allowed: true },
    { objective: "Save the contact from the previous image", allowed: true },
  ])("uses current contact intent for a historical model proposal: $objective", async ({ objective, allowed }) => {
    const stage = vi.fn<WorkspaceMemoryLookup["stage"]>(async () => ({ proposalID: "10000000-0000-4000-8000-000000000003",
      proposalRevision: 1, itemCount: 0, defaultSelectedCount: 0, scopeCounts: { self: 0, person: 0, relationship: 0 },
      contactStatus: "pending", personID: null, personDisplayLabel: "小雨" }));
    const provider = new ScriptedAgentProvider([], { outcome: "reply", title: "回答", body: "继续今天的话题。" });
    vi.spyOn(provider, "run").mockImplementation(async (request, invoke, signal) => {
      const inspect = request.supplementalTools?.find(tool => tool.name === "inspect_current_image");
      expect(inspect).toBeDefined();
      await inspect!.execute({ artifact_id: artifactID }, signal);
      const proposal = await invoke("memory_review", contactProposal);
      expect(proposal.ok).toBe(allowed);
      return { structuredOutput: { outcome: "reply", title: "回答", body: "继续今天的话题。" },
        inputTokens: 1, outputTokens: 1, estimatedUsd: 0, turns: 1, permissionDenials: [] };
    });
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: laterMessageID,
      objective, provider, inputParts: [image], imageInspector: { inspect: async () => observation },
      imageIsCurrent: async () => true, contacts: { search: async () => [], read: vi.fn() },
      memory: { recall: async () => ({ items: [] }), stage } });
    expect(stage).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (!allowed) {
      expect(result.memoryProposal).toBeNull();
      expect(result.firstContactResearch).toEqual([]);
    }
    expect(result.block.body).toContain("今天的话题");
  });

  it("does not attach a historical counterparty to a current self preference", async () => {
    const { stage } = await run({ messageID: laterMessageID, objective: "以后先给结论", propose: true, selfOnly: true });
    expect(stage).toHaveBeenCalledOnce();
    expect(stage.mock.calls[0]?.[0]).toMatchObject({ contactDecision: "none", newContact: null });
  });

  it("keeps the current direct-chat option when another historical image is present", async () => {
    const { stage } = await run({ olderImage: true });
    expect(stage).toHaveBeenCalledOnce();
    expect(stage.mock.calls[0]?.[0]).toMatchObject({ contactDecision: "new",
      newContact: { source_locator: { artifact_id: artifactID } } });
  });

  it.each([false, true])("preserves a model proposal with a historical image present (self-only=%s)", async selfOnly => {
    const { stage } = await run({ olderImage: true, propose: true, selfOnly, objective: "先给结论" });
    expect(stage).toHaveBeenCalledOnce();
    expect(stage.mock.calls[0]?.[0]).toMatchObject({ contactDecision: "new",
      newContact: { source_locator: { artifact_id: artifactID } } });
  });

  it("does not mistake a no-search clause for a refusal to prepare a contact", async () => {
    const { stage } = await run({ objective: "不要搜索，先保存联系人" });
    expect(stage).toHaveBeenCalledOnce();
  });

  it("keeps self memory available when only adding contacts was declined", async () => {
    const { stage } = await run({ objective: "不要添加联系人；但请记住我以后先给结论", propose: true, selfOnly: true });
    expect(stage).toHaveBeenCalledOnce();
    expect(stage.mock.calls[0]?.[0]).toMatchObject({ contactDecision: "none", newContact: null });
  });

  it("does not treat generated host wording or image quotes as user refusal", async () => {
    const { stage } = await run({ sourceText: "", objective: "系统提示：没有有用下一步时无需行动，不要保存任何内容，除非用户确认。",
      observation: { ...observation, visible_text: [...observation.visible_text, "不要保存任何内容"] } });
    expect(stage).toHaveBeenCalledOnce();
  });

  it.each(["article", "group"])("answers a %s without inventing a contact", async kind => {
    const { result, stage } = await run({ observation: { ...observation, conversation_kind: kind === "group" ? "group" : "unknown",
      counterparty_name: null, visible_text: ["Reading gives us time to think."], description: kind } });
    expect(result.block.kind).toBe("answer");
    expect(result.memoryProposal).toBeNull();
    expect(result.firstContactResearch).toEqual([]);
    expect(stage).not.toHaveBeenCalled();
  });
});
