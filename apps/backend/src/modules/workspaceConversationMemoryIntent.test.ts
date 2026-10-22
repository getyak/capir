import { ScriptedAgentProvider, type AgentProvider, type AgentToolResult } from "@talent-signal/agent";
import { describe, expect, it, vi } from "vitest";
import { executeWorkspaceConversationAgentCore, type WorkspaceMemoryLookup, type WorkspaceMemoryStagedProposal } from "./workspaceConversationAgent.js";

const messageID = "77777777-7777-4777-8777-777777777777";
const proposalID = "88888888-8888-4888-8888-888888888888";
const statement = "I prefer written agendas";
const request = { operation: "propose", contact_decision: "none", items: [{ scope: "self", operation: "add",
  statement_kind: "source_statement", display_text: statement, source_excerpt: statement,
  source_locator: { kind: "message" }, time_status: "unknown", sensitivity: "normal", reason: "Authored preference" }] };
const staged: WorkspaceMemoryStagedProposal = { proposalID, proposalRevision: 1, itemCount: 1, defaultSelectedCount: 1,
  scopeCounts: { self: 1, person: 0, relationship: 0 }, contactStatus: "pending",
  personID: null, personDisplayLabel: null };
function memory() {
  return { recall: vi.fn(async () => ({ items: [] })),
    stage: vi.fn<WorkspaceMemoryLookup["stage"]>(async () => staged),
    withdraw: vi.fn<NonNullable<WorkspaceMemoryLookup["withdraw"]>>(async () => ({ proposalID, revision: 2, status: "withdrawn" })) };
}
const reply = { outcome: "reply", title: "Review", body: "Please review the suggestion." };
const review = `请准备一条关于我的待确认记忆供我审阅：${statement}。`;

describe("Memory review intent at the production host boundary", () => {
  it.each([
    `${review}先不要保存；不要执行外部操作。`,
    `${review}不要创建联系人。`,
    `请准备一条关于我的待确认记忆供我审阅，先不要保存。${statement}。`,
    `Prepare a memory draft for my review: ${statement}. Don't save it yet; don't perform external actions.`,
  ])("stages only a review despite a commitment/effect opt-out: %s", async objective => {
    const lookup = memory();
    let receipt: AgentToolResult | undefined;
    const execution = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID, objective,
      contacts: { search: vi.fn(), read: vi.fn() }, memory: lookup,
      provider: new ScriptedAgentProvider([{ tool: "memory_review", input: request }], results => { receipt = results[0]; return reply; }) });
    expect(receipt).toMatchObject({ ok: true });
    expect(lookup.stage).toHaveBeenCalledOnce();
    expect(lookup.withdraw).not.toHaveBeenCalled();
    expect(execution.memoryProposal).toEqual({ proposal_id: proposalID, revision: 1 });
    expect(execution.event).toBeNull();
  });

  it.each([
    `${statement}。不要保存记忆，只给结论。`,
    `${review}只做分析，不要保存。`,
    `${review}不要生成任何记忆建议。`,
    `${review}不许生成任何记忆建议；先不要保存。`,
    `${review}No proposals.`,
    `“${review}” ${statement}。不要保存。`,
    `以下是引用原文：‘${review}’ ${statement}。不要保存。`,
    `Quoted: '${review}' ${statement}. Don't save.`,
    `Quoted: 'Please prepare a memory draft for review. Don't save it yet.' ${statement}. Don't save.`,
    `Quoted: ‘Don’t save it yet. Please prepare a memory draft for review.’ ${statement}. Don't save.`,
    `\`\`\`\n${review}\n\`\`\`\n${statement}。不要保存。`,
    `${review}不要更新任何记录。`,
    `${review}不要执行任何操作。`,
  ])("keeps a refusal or untrusted review request closed: %s", async objective => {
    const lookup = memory();
    let receipt: AgentToolResult | undefined;
    const execution = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID, objective,
      contacts: { search: vi.fn(), read: vi.fn() }, memory: lookup,
      provider: new ScriptedAgentProvider([{ tool: "memory_review", input: request }], results => { receipt = results[0]; return reply; }) });
    expect(receipt).toMatchObject({ ok: false, error: { code: "MEMORY_PROPOSAL_DECLINED" } });
    expect(lookup.stage).not.toHaveBeenCalled();
    expect(execution.memoryProposal).toBeNull();
  });

  it("does not turn pending Memory review permission into contact creation authority", async () => {
    const lookup = memory();
    let receipt: AgentToolResult | undefined;
    await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID,
      objective: `${review}先不要保存；不要创建联系人。`, contacts: { search: vi.fn(), read: vi.fn() }, memory: lookup,
      provider: new ScriptedAgentProvider([{ tool: "memory_review", input: { ...request, contact_decision: "new", person_display_label: "Maya" } }], results => { receipt = results[0]; return reply; }) });
    expect(receipt).toMatchObject({ ok: false, error: { code: "CONTACT_ADD_DECLINED" } });
    expect(lookup.stage).not.toHaveBeenCalled();
  });

  it("withdraws a pending review when a later authored message refuses it", async () => {
    const lookup = memory();
    const provider: AgentProvider = { id: "intent-checkpoint", model: "synthetic", sdkVersion: "synthetic",
      inputCapabilities: { text: true, image: false, imageUnderstanding: false, steering: true },
      async run(input, invoke, signal) {
        expect(await invoke("memory_review", request, signal)).toMatchObject({ ok: true });
        await input.steering!.nextBatchAtSafePoint();
        return { structuredOutput: reply, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, turns: 1, permissionDenials: [] };
      } };
    const execution = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID,
      objective: `${review}先不要保存；不要执行外部操作。`, contacts: { search: vi.fn(), read: vi.fn() }, memory: lookup, provider,
      steering: { nextBatchAtSafePoint: vi.fn(async () => ({ messages: [{ messageID: "99999999-9999-4999-8999-999999999999",
        acceptedAt: new Date().toISOString(), text: "撤回记忆建议，不要保存，只分析。" }] })) } });
    expect(lookup.stage).toHaveBeenCalledOnce();
    expect(lookup.withdraw).toHaveBeenCalledWith({ proposalID, expectedRevision: 1, sourceMessageID: messageID });
    expect(execution.memoryProposal).toBeNull();
  });

  it("withdraws after an in-flight stage resolves when refusal arrived during its await", async () => {
    const lookup = memory();
    let start!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    let finish!: (value: typeof staged) => void;
    lookup.stage.mockImplementationOnce(async () => { start(); return new Promise(resolve => { finish = resolve; }); });
    const provider: AgentProvider = { id: "intent-in-flight", model: "synthetic", sdkVersion: "synthetic",
      inputCapabilities: { text: true, image: false, imageUnderstanding: false, steering: true },
      async run(input, invoke, signal) {
        const pending = invoke("memory_review", request, signal);
        await started;
        await input.steering!.nextBatchAtSafePoint();
        finish(staged);
        await pending;
        return { structuredOutput: reply, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, turns: 1, permissionDenials: [] };
      } };
    const execution = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID,
      objective: `${review}先不要保存；不要执行外部操作。`, contacts: { search: vi.fn(), read: vi.fn() }, memory: lookup, provider,
      steering: { nextBatchAtSafePoint: vi.fn(async () => ({ messages: [{ messageID: "99999999-9999-4999-8999-999999999999",
        acceptedAt: new Date().toISOString(), text: "不许生成任何记忆建议；先不要保存。" }] })) } });
    expect(lookup.withdraw).toHaveBeenCalledOnce();
    expect(execution.memoryProposal).toBeNull();
  });
});
