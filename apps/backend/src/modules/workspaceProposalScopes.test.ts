import { createHash } from "node:crypto";
import { calendarDraftCapability, type AgentProvider, type AgentToolResult } from "@talent-signal/agent";
import { describe, expect, it } from "vitest";
import { executeWorkspaceConversationAgentCore, type WorkspaceMemoryLookup } from "./workspaceConversationAgent.js";
import { withFirstContactNameCandidate } from "./firstContactResearch.js";

const root = "10000000-0000-4000-8000-000000000001";
const later = "10000000-0000-4000-8000-000000000002";
const proposalID = "10000000-0000-4000-8000-000000000003";
const reply = { structuredOutput: { outcome: "reply", title: "Review", body: "Review the requested draft." },
  inputTokens: 1, outputTokens: 1, estimatedUsd: 0, turns: 1, permissionDenials: [] };
const contacts = { search: async () => [], read: async () => { throw new Error("Private read not authorized by fixture"); } };
const contact = { operation: "propose_create", display_name: "林海（测试）", relationship_context: "",
  identity_clue: null, source_excerpts: ["林海（测试）"], reason: "Human review only" };
const choice = { operation: "propose_choice", purpose: "Compare options",
  options: JSON.stringify([{ id: "a", label: "A" }, { id: "b", label: "B" }]) };
const item = { scope: "self", operation: "add", statement_kind: "source_statement", display_text: "先给结论",
  source_excerpt: "先给结论", source_locator: { kind: "message", message_id: root, session_id: null },
  time_status: "unknown", sensitivity: "normal", reason: "Current authored preference" };
const imageBytes = Buffer.from("synthetic scoped proposal fixture");
const image = { kind: "image" as const, artifactID: `conversation-image-${root}-0-10000000-0000-4000-8000-000000000004`,
  mimeType: "image/png" as const, byteSize: imageBytes.length,
  contentHash: createHash("sha256").update(imageBytes).digest("hex"), dataBase64: imageBytes.toString("base64") };
const imageInspector = { inspect: async () => ({ conversation_kind: "direct" as const,
  counterparty_name: "林海（测试）", visible_text: ["林海（测试）"], description: "Synthetic image",
  uncertainties: [], model: "synthetic", request_id: "synthetic-no-network" }) };
function provider(run: AgentProvider["run"]): AgentProvider {
  return { id: "scope-fixture", model: "synthetic", sdkVersion: "synthetic",
    inputCapabilities: { text: true, image: false, imageUnderstanding: false, steering: true }, run };
}
type Stage = Parameters<WorkspaceMemoryLookup["stage"]>[0];
type Withdrawal = { proposalID: string; expectedRevision: number; sourceMessageID: string };
function memoryAdapter(stages: Stage[], withdrawals: Withdrawal[]): WorkspaceMemoryLookup {
  return { recall: async () => ({ items: [] }), stage: async input => {
    const items = withFirstContactNameCandidate(input.items, input.nameCandidate ?? null);
    stages.push({ ...input, items });
    return { proposalID, proposalRevision: 1, itemCount: items.length, defaultSelectedCount: 0,
      scopeCounts: { self: items.filter(value => value.scope === "self").length,
        person: items.filter(value => value.scope === "person").length,
        relationship: items.filter(value => value.scope === "relationship").length },
      contactStatus: input.personID ? "resolved" : "pending",
      personID: input.personID, personDisplayLabel: input.newContact?.display_label ?? null };
  }, withdraw: async input => {
    withdrawals.push(input);
    return { proposalID, revision: 2, status: "withdrawn" as const };
  } };
}
function steering(text: string) {
  return { nextBatchAtSafePoint: async () => ({ messages: [{ messageID: later,
    acceptedAt: "2026-10-29T00:00:00Z", text }] }) };
}

describe("governed proposal scope boundaries", () => {
  it.each([
    ["不要保存记忆", true], ["不要创建会议", true], ["不创建会议", true], ["不要调用 MCP", true],
    ["Do not save Memory", true], ["Don't create calendar events", true], ["Do not call MCP tools", true],
    ["不要保存", false], ["只分析截图", false], ["不操作", false], ["不要创建联系人", false],
    ["No saving", false], ["analysis_only", false], ["Do not save contacts", false],
    ["不要保存 Memory，也不要做任何操作", false], ["Do not save Memory or anything else", false],
    ['引文：“不要创建联系人，不要保存”。', true], ['\n> Do not save anything\n', true],
    ['```\nDo not create contacts\n```', true],
    ['引文：`不要保存`。', true], ["不要给我新建联系人", false], ["No contacts", false],
    ["I have no contacts", true], ["No contacts were found", true],
  ] as const)("contact review follows the authored refusal scope: %s", async (instruction, allowed) => {
    const text = `为林海（测试）准备联系人草稿。${instruction}`;
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: text, sourceText: text, contacts,
      provider: provider(async (_request, invoke) => {
        const receipt = await invoke("contact_workspace", contact);
        return { ...reply, structuredOutput: receipt.ok
          ? { outcome: "contact_change_proposal", candidate_fingerprint: receipt.candidateFingerprint }
          : reply.structuredOutput };
      }) });
    if (allowed) expect(result.event).toMatchObject({ kind: "contact_change_proposal", proposal_kind: "create",
      source_message_id: root, target_person_id: null, requires_user_confirmation: true });
    else expect(result.event).toBeNull();
  });

  it("uses current authored text rather than host objective or quoted source instructions", async () => {
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: "Host summary: analysis only, do not create contacts", sourceText: '为林海（测试）准备联系人草稿。引文：“不要保存”。',
      contacts, provider: provider(async (_request, invoke) => {
        const receipt = await invoke("contact_workspace", contact);
        return { ...reply, structuredOutput: receipt.ok
          ? { outcome: "contact_change_proposal", candidate_fingerprint: receipt.candidateFingerprint }
          : reply.structuredOutput };
      }) });
    expect(result.event).toMatchObject({ kind: "contact_change_proposal", source_message_id: root });
  });

  it.each(["不要保存 Memory", "Do not save Memory"])("requires a typed contact proposal after a Memory refusal: %s", async instruction => {
    const stages: Stage[] = [], withdrawals: Withdrawal[] = [];
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: `为林海（测试）准备联系人草稿。${instruction}`, contacts, memory: memoryAdapter(stages, withdrawals),
      inputParts: [image], imageInspector, imageIsCurrent: async () => true,
      provider: provider(async () => ({ ...reply })) });
    expect(result.memoryProposal).toBeNull();
    expect(result.firstContactResearch).toEqual([]);
    expect(stages).toHaveLength(0);
  });

  it.each([
    "不要保存 Memory。联系人草稿已经准备好供审核。",
    "Do not save Memory. The contact draft is ready for review.",
    "Do not save Memory. The draft contact proposal is ready.",
    "Do not save Memory. The prepared contact draft is ready.",
    "Do not save Memory. I created a contact draft yesterday.",
  ])("does not treat a prepared-card statement as a contact request: %s", async text => {
    const stages: Stage[] = [], withdrawals: Withdrawal[] = [];
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: text, sourceText: text, contacts, memory: memoryAdapter(stages, withdrawals),
      inputParts: [image], imageInspector, imageIsCurrent: async () => true,
      provider: provider(async () => ({ ...reply })) });
    expect(result.memoryProposal).toBeNull();
    expect(result.firstContactResearch).toEqual([]);
    expect(stages).toHaveLength(0);
  });

  it.each(["不要保存 Memory", "Do not save Memory"])("does not upgrade an empty Memory request into a contact: %s", async instruction => {
    const stages: Stage[] = [], withdrawals: Withdrawal[] = [];
    let receipt: AgentToolResult | undefined;
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: `为林海（测试）准备联系人草稿。${instruction}`, contacts, memory: memoryAdapter(stages, withdrawals),
      inputParts: [image], imageInspector, imageIsCurrent: async () => true,
      provider: provider(async (_request, invoke) => {
        receipt = await invoke("memory_review", { operation: "propose", contact_decision: "none", items: [] });
        return { ...reply };
      }) });
    expect(receipt).toMatchObject({ ok: false });
    expect(result.memoryProposal).toBeNull();
    expect(result.firstContactResearch).toEqual([]);
    expect(stages).toHaveLength(0);
  });

  it("projects an authored contact-only review without injecting name Memory", async () => {
    const stages: Stage[] = [], withdrawals: Withdrawal[] = [];
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: "为林海（测试）准备联系人草稿。不要保存 Memory。", contacts, memory: memoryAdapter(stages, withdrawals),
      contactReviewSurface: "memory", provider: provider(async (_request, invoke) => {
        const receipt = await invoke("contact_workspace", contact);
        return { ...reply, structuredOutput: receipt.ok
          ? { outcome: "contact_change_proposal", candidate_fingerprint: receipt.candidateFingerprint }
          : reply.structuredOutput };
      }) });
    expect(result.memoryProposal).toEqual({ proposal_id: proposalID, revision: 1 });
    expect(stages).toHaveLength(1);
    expect(stages[0]!.items).toEqual([]);
    expect(stages[0]!.nameCandidate).toBeUndefined();
    expect(stages[0]!.sourceMessageID).toBe(root);
  });

  it.each(["不要创建联系人", "Do not create contacts", "不要创建会议", "Do not create calendar events",
    "不要调用 MCP", "Do not call MCP tools"])("keeps a self-Memory review independent: %s", async instruction => {
    const stages: Stage[] = [], withdrawals: Withdrawal[] = [];
    const text = `请记住我的偏好：先给结论。${instruction}`;
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: text, contacts, memory: memoryAdapter(stages, withdrawals),
      provider: provider(async (_request, invoke) => {
        await invoke("memory_review", { operation: "propose", contact_decision: "none", items: [item] });
        return { ...reply };
      }) });
    expect(result.memoryProposal).toEqual({ proposal_id: proposalID, revision: 1 });
    expect(stages).toHaveLength(1);
    expect(stages[0]!.items).toEqual([item]);
    expect(withdrawals).toEqual([]);
  });

  it.each(["不要保存 Memory", "Do not save Memory", "不要创建联系人", "Do not create contacts", "不要保存"])(
    "rejects a whole mixed proposal containing a refused effect: %s", async instruction => {
      const stages: Stage[] = [], withdrawals: Withdrawal[] = [];
      let receipt: AgentToolResult | undefined;
      const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
        objective: `林海（测试），我的偏好是先给结论。${instruction}`, contacts, memory: memoryAdapter(stages, withdrawals),
        inputParts: [image], imageInspector, imageIsCurrent: async () => true,
        provider: provider(async (_request, invoke) => {
          receipt = await invoke("memory_review", { operation: "propose", contact_decision: "new",
            person_display_label: "林海（测试）", new_contact_source_locator: { kind: "message", message_id: root }, items: [item] });
          return { ...reply };
        }) });
      expect(receipt?.ok).toBe(false);
      expect(stages).toEqual([]);
      expect(result.memoryProposal).toBeNull();
    });

  it.each([
    ["不要保存 Memory", true], ["Do not save Memory", true], ["不要创建联系人", true],
    ["Do not create contacts", true], ["不要调用 MCP", true], ["Do not call MCP tools", true],
    ["不创建会议", false], ["Do not create calendar events", false], ["不要保存", false],
  ] as const)("the real calendar adapter follows only its applicable refusal: %s", async (instruction, allowed) => {
    const text = `Tomorrow at 3pm for 30 minutes. ${instruction}`;
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: text, contacts,
      calendarContext: { sourceRequestID: root, referenceTime: "2026-09-09T02:00:00Z", timeZone: "Asia/Shanghai" },
      provider: provider(async request => {
        const calendar = calendarDraftCapability(request.calendarContext, request.objective);
        await calendar.tools[0]!.execute({ title: "Synthetic meeting", starts_at: "2026-09-10T15:00:00+08:00",
          ends_at: "2026-09-10T15:30:00+08:00", time_zone: "Asia/Shanghai", source_excerpt: "Tomorrow at 3pm for 30 minutes" },
        new AbortController().signal);
        const draft = calendar.draft();
        return { ...reply, ...(draft ? { calendarDraft: draft } : {}) };
      }) });
    if (allowed) expect(result.providerResult.calendarDraft).toMatchObject({ status: "needs_review", external_effect: "none" });
    else expect(result.providerResult.calendarDraft).toBeUndefined();
  });

  it.each([["不要保存 Memory", true], ["Do not create calendar events", false], ["no_action", false]] as const)(
    "final calendar presentation rechecks late steering: %s", async (instruction, visible) => {
      const text = "Tomorrow at 3pm for 30 minutes.";
      const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
        objective: text, contacts, steering: steering(instruction),
        calendarContext: { sourceRequestID: root, referenceTime: "2026-09-09T02:00:00Z", timeZone: "Asia/Shanghai" },
        provider: provider(async request => {
          const calendar = calendarDraftCapability(request.calendarContext, request.objective);
          await calendar.tools[0]!.execute({ title: "Synthetic meeting", starts_at: "2026-09-10T15:00:00+08:00",
            ends_at: "2026-09-10T15:30:00+08:00", time_zone: "Asia/Shanghai", source_excerpt: "Tomorrow at 3pm for 30 minutes" },
          new AbortController().signal);
          const draft = calendar.draft();
          await request.steering!.nextBatchAtSafePoint();
          return { ...reply, ...(draft ? { calendarDraft: draft } : {}) };
        }) });
      if (visible) expect(result.providerResult.calendarDraft).toMatchObject({ status: "needs_review", external_effect: "none" });
      else expect(result.providerResult.calendarDraft).toBeUndefined();
    });

  it("keeps selected-person Memory when steering refuses contact creation", async () => {
    const stages: Stage[] = [], withdrawals: Withdrawal[] = [];
    const personID = "10000000-0000-4000-8000-000000000005";
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: "请为我选择的人准备一条记忆草稿：先给结论。", contacts,
      humanIdentityBinding: { personID, contextID: null }, memory: memoryAdapter(stages, withdrawals),
      steering: steering("不要创建联系人"), provider: provider(async (request, invoke) => {
        await invoke("memory_review", { operation: "propose", contact_decision: "existing", person_id: personID,
          items: [{ ...item, scope: "person" }] });
        await request.steering!.nextBatchAtSafePoint();
        return { ...reply };
      }) });
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ personID, contactDecision: "existing", identityAuthority: "human_selection" });
    expect(withdrawals).toEqual([]);
    expect(result.memoryProposal).toEqual({ proposal_id: proposalID, revision: 1 });
  });

  it.each([
    ["不要保存 Memory", true], ["Do not save Memory", true], ["不要创建联系人", true],
    ["Do not create contacts", true], ["不创建会议", true], ["Do not create meetings", true],
    ["不要调用 MCP", false], ["Do not call MCP tools", false], ["不对外发送消息", false],
    ["Do not send external messages", false], ["no_action", false],
  ] as const)("MCP human-review requests retain their own boundary: %s", async (instruction, allowed) => {
    const dispatched: Record<string, unknown>[] = [];
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: `Compare the choices. ${instruction}`, contacts,
      mcpConnections: { handle: async input => { dispatched.push(input);
        return { ok: true, data: { request_id: proposalID, call_id: proposalID, kind: "choice", state: "pending" } }; } },
      provider: provider(async (_request, invoke) => { await invoke("mcp_connections", choice); return { ...reply }; }) });
    expect(dispatched).toHaveLength(allowed ? 1 : 0);
    if (allowed) expect(result.block.mcp_interaction).toMatchObject({ request_id: proposalID, state: "pending" });
    else expect(result.block.mcp_interaction).toBeUndefined();
  });

  it.each([
    ["contact", "不要保存 Memory", false], ["contact", "Do not save Memory", false],
    ["memory", "不要创建联系人", false], ["memory", "Do not create contacts", false],
    ["contact", "不要创建联系人", true], ["memory", "Do not save Memory", true],
    ["contact", "no_action", true], ["memory", "不要保存", true],
  ] as const)("steering withdraws only an applicable pending %s effect: %s", async (effect, instruction, withdrawn) => {
    const stages: Stage[] = [], withdrawals: Withdrawal[] = [];
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: `为林海（测试）准备联系人草稿，我的偏好是先给结论。${effect === "contact" ? "不要保存 Memory。" : ""}`,
      contacts, memory: memoryAdapter(stages, withdrawals),
      steering: steering(instruction), provider: provider(async (request, invoke) => {
        await invoke("memory_review", effect === "contact"
          ? { operation: "propose", contact_decision: "new", person_display_label: "林海（测试）",
            new_contact_source_locator: { kind: "message", message_id: root }, items: [] }
          : { operation: "propose", contact_decision: "none", items: [item] });
        await request.steering!.nextBatchAtSafePoint();
        return { ...reply };
      }) });
    expect(stages).toHaveLength(1);
    expect(withdrawals).toEqual(withdrawn ? [{ proposalID, expectedRevision: 1, sourceMessageID: root }] : []);
    expect(result.memoryProposal).toEqual(withdrawn ? null : { proposal_id: proposalID, revision: 1 });
  });

  it.each([["Do not save Memory", false], ["不要创建联系人", false], ["Do not call MCP tools", true], ["no_action", true]] as const)(
    "steering scopes MCP withdrawal rather than every proposal: %s", async (instruction, withdrawn) => {
      const withdrawnIDs: string[] = [];
      const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
        objective: "Compare the choices", contacts, steering: steering(instruction),
        mcpConnections: { handle: async () => ({ ok: true, data: { request_id: proposalID, call_id: proposalID, kind: "choice", state: "pending" } }),
          withdrawPending: async () => { withdrawnIDs.push(proposalID); return { requests: [{ requestID: proposalID,
            revision: 2, state: "rejected" as const, status: "withdrawn" as const }] }; } },
        provider: provider(async (request, invoke) => { await invoke("mcp_connections", choice);
          await request.steering!.nextBatchAtSafePoint(); return { ...reply }; }) });
      expect(withdrawnIDs).toEqual(withdrawn ? [proposalID] : []);
      if (withdrawn) expect(result.block.mcp_interaction).toBeUndefined();
      else expect(result.block.mcp_interaction).toMatchObject({ request_id: proposalID });
    });

  it("withdraws an earlier host-added name Memory without silently replacing the mixed card", async () => {
    const stages: Stage[] = [], withdrawals: Withdrawal[] = [];
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: "为林海（测试）准备联系人和姓名来源供我确认。", contacts, memory: memoryAdapter(stages, withdrawals),
      inputParts: [image], imageInspector, imageIsCurrent: async () => true, steering: steering("Do not save Memory"),
      provider: provider(async (request, invoke) => {
        await invoke("memory_review", { operation: "propose", contact_decision: "new", person_display_label: "林海（测试）",
          new_contact_source_locator: { kind: "image_region", artifact_id: image.artifactID, image_index: 0 }, items: [] });
        await request.steering!.nextBatchAtSafePoint();
        return { ...reply };
      }) });
    expect(stages).toHaveLength(1);
    expect(stages[0]!.items).toHaveLength(1);
    expect(stages[0]!.items[0]).toMatchObject({ scope: "person", source_excerpt: "林海（测试）" });
    expect(withdrawals).toEqual([{ proposalID, expectedRevision: 1, sourceMessageID: root }]);
    expect(result.memoryProposal).toBeNull();
  });

  it.each([
    ["tool", "不要 `保存` Memory，请为林海（测试）准备联系人草稿。"],
    ["default", "不要 `保存` Memory，请为林海（测试）准备联系人草稿。"],
    ["tool", "Do not `save` Memory. Prepare a contact draft for 林海（测试） for review."],
    ["default", "Do not `save` Memory. Prepare a contact draft for 林海（测试） for review."],
  ] as const)("formatted refusal preserves the %s proposal boundary: %s", async (path, text) => {
    const stages: Stage[] = [], withdrawals: Withdrawal[] = [];
    let toolReceipt: AgentToolResult | undefined;
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: text, sourceText: text, contacts, memory: memoryAdapter(stages, withdrawals),
      inputParts: [image], imageInspector, imageIsCurrent: async () => true,
      provider: provider(async (_request, invoke) => {
        if (path === "tool") toolReceipt = await invoke("memory_review", { operation: "propose", contact_decision: "new",
          person_display_label: "林海（测试）", new_contact_source_locator: {
            kind: "image_region", artifact_id: image.artifactID, image_index: 0,
          }, items: [] });
        return { ...reply };
      }) });
    if (path === "tool") expect(toolReceipt).toMatchObject({ ok: true });
    if (path === "default") {
      expect(result.memoryProposal).toBeNull();
      expect(result.firstContactResearch).toEqual([]);
      expect(stages).toHaveLength(0);
      return;
    }
    expect(result.memoryProposal).toEqual({ proposal_id: proposalID, revision: 1 });
    expect(stages).toHaveLength(1);
    expect(stages[0]!.items).toEqual([]);
    expect(stages[0]!.nameCandidate).toBeUndefined();
    expect(stages[0]).toMatchObject({ contactDecision: "new", personID: null, identityAuthority: "tentative",
      newContact: { display_label: "林海（测试）", source_locator: { kind: "image_region", artifact_id: image.artifactID } } });
    expect(withdrawals).toEqual([]);
  });

  it.each([["Do not save Memory", true], ["不要创建联系人", false], ["no_action", false]] as const)(
    "final contact presentation rechecks scoped steering: %s", async (instruction, visible) => {
      const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
        objective: "为林海（测试）准备联系人草稿。", contacts, steering: steering(instruction),
        provider: provider(async (request, invoke) => {
          const receipt = await invoke("contact_workspace", contact);
          await request.steering!.nextBatchAtSafePoint();
          return { ...reply, structuredOutput: { outcome: "contact_change_proposal", candidate_fingerprint: receipt.candidateFingerprint } };
        }) });
      if (visible) expect(result.event).toMatchObject({ kind: "contact_change_proposal", requires_user_confirmation: true });
      else expect(result.event).toBeNull();
    });

  it.each([
    ["contact tool", "不要 `做任何操作`，请为林海（测试）准备联系人草稿。"],
    ["memory tool", "不要 `做任何操作`，请为林海（测试）准备联系人草稿。"],
    ["default", "不要 `做任何操作`，请为林海（测试）准备联系人草稿。"],
    ["contact tool", "不要 `给我保存` Memory，请为林海（测试）准备联系人草稿。"],
    ["memory tool", "不要 `给我保存` Memory，请为林海（测试）准备联系人草稿。"],
    ["default", "不要 `给我保存` Memory，请为林海（测试）准备联系人草稿。"],
  ] as const)("formatted global legacy refusal blocks the %s contact path: %s", async (path, text) => {
    const stages: Stage[] = [], withdrawals: Withdrawal[] = [];
    let toolReceipt: AgentToolResult | undefined;
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: text, sourceText: text, contacts, memory: memoryAdapter(stages, withdrawals),
      inputParts: [image], imageInspector, imageIsCurrent: async () => true, contactReviewSurface: "memory",
      provider: provider(async (_request, invoke) => {
        if (path === "contact tool") {
          toolReceipt = await invoke("contact_workspace", contact);
          if (toolReceipt.ok) return { ...reply, structuredOutput: {
            outcome: "contact_change_proposal", candidate_fingerprint: toolReceipt.candidateFingerprint,
          } };
        }
        if (path === "memory tool") toolReceipt = await invoke("memory_review", { operation: "propose",
          contact_decision: "new", person_display_label: "林海（测试）", new_contact_source_locator: {
            kind: "image_region", artifact_id: image.artifactID, image_index: 0,
          }, items: [] });
        return { ...reply };
      }) });
    if (path !== "default") expect(toolReceipt?.ok).toBe(false);
    expect(stages).toEqual([]);
    expect(result.event).toBeNull();
    expect(result.memoryProposal).toBeNull();
    expect(withdrawals).toEqual([]);
  });
});
