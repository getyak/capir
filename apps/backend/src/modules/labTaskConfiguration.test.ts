import { ClaudeChatProvider, claudeHarnessConfiguration, DEFAULT_AGENT_BUDGET, type AgentProvider, type AgentProviderRequest } from "@talent-signal/agent";
import { WORKSPACE_CONVERSATION_SYSTEM_PROMPT } from "./workspaceConversationAgent.js";
import { describe, expect, it, vi } from "vitest";
import { CHAT_PROMPT_REVISION, configuredAgentPrompt, configuredChatPrompt, RELATIONSHIP_SYSTEM_PROMPT,
  ZhipuChatAnswerProvider, type RemoteChatAnswerProviding, type RemoteChatAnswerRequest } from "./chatAnswerProvider.js";
import { taskModelCatalog, trialProvider, type TrialRunMeasurement } from "./labTaskConfiguration.js";
import { bundledPrompt, promptRevision } from "@talent-signal/agent/prompt-registry";

const request: RemoteChatAnswerRequest = { objective: "Synthetic clarification", context_blocks: [], allowed_citation_ids: [] };
function fixture(): RemoteChatAnswerProviding {
  return { providerId: "zhipu-chat-completions", model: "glm-text", imageModel: "glm-vision",
    supportsImageInput: true, supportsPromptPresets: true,
    async answer(input) {
      return { kind: "clarification", title: "Clarify", body: "Synthetic answer", citation_ids: [],
        provider_id: "zhipu-chat-completions", model: input.images?.length ? "glm-vision" : "glm-text",
        provider_request_id: "synthetic-request", input_tokens: 1, output_tokens: 1,
        usage_reported: false, prompt_revision: configuredChatPrompt(input.mode, input.prompt_preset).revision };
    } };
}

describe("scoped task model configuration", () => {
  it("keeps the saved Opik text across calls and rejects a corrupted snapshot", async () => {
    const text = "Synthetic published relationship prompt.";
    const snapshot = { ...bundledPrompt("assistant/relationship"), text, revision: promptRevision(text), versionId: "published-v1", source: "opik" as const };
    const sent: string[] = [];
    const provider = new ZhipuChatAnswerProvider({ apiKey: "synthetic", model: "glm-5.3", fetcher: vi.fn(async (_url, init) => {
      sent.push(JSON.parse(init!.body as string).messages[0].content);
      return new Response(JSON.stringify({ model: "glm-5.3", choices: [{ message: { content: JSON.stringify({ kind: "clarification", title: "Info", body: "Synthetic response", citation_ids: [] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }) as typeof fetch });
    const entry = taskModelCatalog([provider]).find(x => x.task === "relationship_text")!;
    const wrapped = trialProvider(entry, "baseline", () => {}, snapshot);
    await wrapped.answer(request); await wrapped.answer(request);
    expect(sent).toEqual([text, text]);
    expect(() => trialProvider(entry, "baseline", () => {}, { ...snapshot, text: "Corrupted" })).toThrow("Invalid frozen prompt");
  });
  it("names the actual admitted image model and separates task capabilities", () => {
    const entries = taskModelCatalog([fixture()]);
    expect(entries.map(({ task, model }) => [task, model])).toEqual([
      ["relationship_text", "glm-text"], ["unscoped_chat", "glm-text"], ["relationship_image", "glm-vision"],
    ]);
    const unknownVision = { ...fixture(), imageModel: null };
    expect(taskModelCatalog([unknownVision]).some((x) => x.task === "relationship_image")).toBe(false);
  });

  it("preserves the complete existing safety prompt and has distinct immutable preset hashes", () => {
    const base = configuredChatPrompt();
    const concise = configuredChatPrompt("relationship", "concise");
    expect(base.text).toBe(RELATIONSHIP_SYSTEM_PROMPT);
    expect(base.revision).toBe(CHAT_PROMPT_REVISION);
    expect(concise.text.startsWith(base.text)).toBe(true);
    expect(concise.revision).not.toBe(base.revision);
    expect(() => configuredChatPrompt("relationship", "arbitrary" as "baseline")).toThrow("Unregistered");
  });

  it("runs the selected real provider adapter with the chosen preset and reports actual configuration", async () => {
    let sent = "";
    const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
      sent = String(init?.body);
      return new Response(JSON.stringify({ id: "synthetic-request", model: "glm-5.3",
        choices: [{ message: { content: JSON.stringify({ kind: "clarification", title: "Clarify", body: "What should be confirmed?", citation_ids: [] }) } }],
        usage: { prompt_tokens: 12, completion_tokens: 8 } }), { status: 200 });
    }) as typeof fetch;
    const provider = new ZhipuChatAnswerProvider({ apiKey: "fixture-only", model: "glm-5.3", fetcher });
    const entry = taskModelCatalog([provider]).find((x) => x.task === "relationship_text")!;
    const measurements: TrialRunMeasurement[] = [];
    const result = await trialProvider(entry, "concise", (x) => { measurements.push(x); }).answer(request);
    expect(JSON.parse(sent).messages[0].content).toBe(configuredChatPrompt("relationship", "concise").text);
    expect(result.prompt_revision).toBe(configuredChatPrompt("relationship", "concise").revision);
    expect(measurements[0]).toMatchObject({ requested_model: "glm-5.3", actual_model: "glm-5.3", status: "completed", input_tokens: 12 });
    expect(JSON.stringify(measurements)).not.toContain(request.objective);
    expect(JSON.stringify(measurements)).not.toContain("What should be confirmed?");
  });

  it("rejects input capability changes before model dispatch and never treats unknown usage as zero", async () => {
    const provider = fixture();
    const answer = vi.spyOn(provider, "answer");
    const entry = taskModelCatalog([provider])[0]!;
    const measurements: TrialRunMeasurement[] = [];
    const wrapped = trialProvider(entry, "baseline", (x) => { measurements.push(x); });
    await expect(wrapped.answer({ ...request, images: [{ file_name: "synthetic.png", media_type: "image/png", data: new Uint8Array([1]) }] })).rejects.toThrow("capability");
    expect(answer).not.toHaveBeenCalled();
    await wrapped.answer(request);
    expect(measurements[1]?.input_tokens).toBeNull();
    expect(measurements[0]?.error_code).toBe("TRIAL_PROVIDER_FAILED_OR_UNVERIFIED");
  });

  it("rejects model or prompt substitution and records a failed configuration check", async () => {
    const provider = fixture();
    const original = provider.answer;
    provider.answer = async (input) => ({ ...await original(input), model: "substituted" });
    const measurements: TrialRunMeasurement[] = [];
    const wrapped = trialProvider(taskModelCatalog([provider])[0]!, "baseline", (x) => { measurements.push(x); });
    await expect(wrapped.answer(request)).rejects.toThrow("configuration");
    expect(measurements[0]?.status).toBe("failed");
    expect(measurements[0]?.actual_model).toBe("substituted");
  });
});


const agentRequest: AgentProviderRequest = {
  runID: "synthetic-run", objective: "Hello", systemPrompt: WORKSPACE_CONVERSATION_SYSTEM_PROMPT,
  scopeSummary: { kind: "workspace_conversation", workspaceID: "synthetic-workspace", sessionID: null,
    currentPersonID: null, currentRelationshipContextID: null },
  toolManifest: ["contact_workspace"], budget: { ...DEFAULT_AGENT_BUDGET, maxTurns: 2 },
};

describe("configured workspace Agent", () => {
  it("keeps the terminal contract identical across presets and stages no effects for a direct draft", async () => {
    for (const preset of ["baseline", "concise", "evidence_first"] as const) {
      const invokeTool = vi.fn();
      const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const system = body.messages[0].content as string;
        expect(system.match(/Return one JSON object:/gu)).toHaveLength(1);
        expect(system).not.toContain('"additionalProperties"');
        expect(body.tools.map((item: { function: { name: string } }) => item.function.name)).toEqual([
          "contact_workspace_search",
          "contact_workspace_read",
          "contact_workspace_propose_create",
          "contact_workspace_propose_update",
        ]);
        return new Response(JSON.stringify({ model: "glm-5.3", id: `synthetic-draft-${preset}`,
          choices: [{ message: { content: JSON.stringify({ outcome: "reply", title: "Draft", body: "Here is an unsent introduction template." }) } }],
          usage: { prompt_tokens: 12, completion_tokens: 8 } }));
      }) as typeof fetch;
      const provider = new ZhipuChatAnswerProvider({ apiKey: "fixture-only", model: "glm-5.3", fetcher });
      const result = await provider.runWithPromptPreset({ ...agentRequest, objective: "Draft a generic introduction." }, invokeTool,
        new AbortController().signal, preset, () => {});
      expect(result.structuredOutput).toMatchObject({ outcome: "reply" });
      expect(invokeTool).not.toHaveBeenCalled();
    }
  });

  it("marks an invalid final output as failed even after a successful model response", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ model: "glm-5.3", id: "synthetic-invalid-output",
      choices: [{ message: { content: JSON.stringify({ outcome: "reply", message: "Wrong output shape" }) } }],
      usage: { prompt_tokens: 12, completion_tokens: 4 } }), { status: 200 })) as typeof fetch;
    const original = new ZhipuChatAnswerProvider({ apiKey: "fixture-only", model: "glm-5.3", fetcher });
    const records: TrialRunMeasurement[] = [];
    const wrapped = trialProvider(taskModelCatalog([original]).find((x) => x.task === "unscoped_chat")!, "concise", (x) => { records.push(x); });
    await expect((wrapped as unknown as AgentProvider).run(agentRequest, vi.fn(), new AbortController().signal)).rejects.toThrow();
    expect(records[0]).toMatchObject({ status: "failed", actual_model: "glm-5.3", remote_requests_started: 1 });
    expect(configuredAgentPrompt(agentRequest.systemPrompt, "concise").text).toContain('"outcome":"reply"|"clarification"');
  });

  it("cannot retry an Agent failure using the different bare-answer prompt", async () => {
    const fetcher = vi.fn(async () => { throw new Error("Synthetic upstream failure"); }) as typeof fetch;
    const original = new ZhipuChatAnswerProvider({ apiKey: "fixture-only", model: "glm-5.3", fetcher });
    const records: TrialRunMeasurement[] = [];
    const wrapped = trialProvider(taskModelCatalog([original]).find((x) => x.task === "unscoped_chat")!, "concise", (x) => { records.push(x); });
    await expect((wrapped as unknown as AgentProvider).run(agentRequest, vi.fn(), new AbortController().signal)).rejects.toThrow("Synthetic upstream failure");
    await expect(wrapped.answer({ ...request, mode: "unscoped_conversation" })).rejects.toThrow("cannot fall back");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "failed", remote_requests_started: 1, actual_model: null });
  });

  it("retains the Agent path, exact scope and tool callbacks while measuring actual prompt execution", async () => {
    const bodies: Array<Record<string, any>> = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const message = bodies.length === 1 ? { tool_calls: [{ id: "tool-one", type: "function", function: {
        name: "contact_workspace", arguments: JSON.stringify({ operation: "search", query: "synthetic", maximum_results: 4 }),
      } }] } : { content: JSON.stringify({ outcome: "reply", title: "Hello", body: "Synthetic response" }) };
      return new Response(JSON.stringify({ model: "glm-5.3", id: "synthetic-" + bodies.length, choices: [{ message }],
        usage: { prompt_tokens: 12, completion_tokens: 4 } }), { status: 200 });
    }) as typeof fetch;
    const original = new ZhipuChatAnswerProvider({ apiKey: "fixture-only", model: "glm-5.3", fetcher });
    const records: TrialRunMeasurement[] = [];
    const wrapped = trialProvider(taskModelCatalog([original]).find((x) => x.task === "unscoped_chat")!, "concise", (x) => { records.push(x); });
    const invokeTool = vi.fn(async () => ({ ok: true, name: "contact_workspace", callID: "synthetic-call",
      data: { operation: "search", result_count: 0, results: [] } }));
    const result = await (wrapped as unknown as AgentProvider).run(agentRequest, invokeTool, new AbortController().signal);
    expect(result.turns).toBe(2);
    expect(invokeTool).toHaveBeenCalledWith("contact_workspace", { operation: "search", query: "synthetic", maximum_results: 4 });
    expect(JSON.parse(bodies[0]!.messages[1].content).immutable_scope).toEqual(agentRequest.scopeSummary);
    expect(bodies[0]!.messages[0].content).toBe(configuredAgentPrompt(agentRequest.systemPrompt, "concise").text);
    expect(records[0]).toMatchObject({ execution: "remote", actual_model: "glm-5.3", remote_requests_started: 2,
      input_tokens: 24, output_tokens: 8, status: "completed" });
    expect(records[0]?.prompt_revision).not.toBe(configuredChatPrompt("unscoped_conversation", "concise").revision);
  });

  it("truthfully reports deterministic contact lookup as local and preserves cancellation", async () => {
    const fetcher = vi.fn();
    const original = new ZhipuChatAnswerProvider({ apiKey: "fixture-only", model: "glm-5.3", fetcher: fetcher as typeof fetch });
    const records: TrialRunMeasurement[] = [];
    const wrapped = trialProvider(taskModelCatalog([original]).find((x) => x.task === "unscoped_chat")!, "baseline", (x) => { records.push(x); }) as unknown as AgentProvider;
    const invokeTool = vi.fn(async () => ({ ok: true, name: "contact_workspace", callID: "synthetic-call",
      data: { operation: "search", result_count: 0, results: [] } }));
    await wrapped.run({ ...agentRequest, objective: "Leila 有什么变化？" }, invokeTool, new AbortController().signal);
    expect(fetcher).not.toHaveBeenCalled();
    expect(invokeTool).toHaveBeenCalledTimes(1);
    expect(records[0]).toMatchObject({ execution: "local_only", actual_model: null, actual_prompt_revision: null,
      remote_requests_started: 0, input_tokens: 0, status: "completed" });
    const cancelled = new AbortController(); cancelled.abort(new Error("Cancelled"));
    await expect(wrapped.run(agentRequest, invokeTool, cancelled.signal)).rejects.toThrow("Cancelled");
    expect(records[1]?.status).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });
});


describe("Claude SDK frozen trials", () => {
  const config = claudeHarnessConfiguration({ HAO_ANTHROPIC_API_KEY: "synthetic-only",
    ANTHROPIC_BASE_URL: "https://api.hao.ai/anthropic", TALENT_SIGNAL_AGENT_MODEL: "anthropic/claude-sonnet-5" });
  const receipt = { text: "可以，慢慢聊。", structuredOutput: null, sessionID: "synthetic-sdk-session",
    inputTokens: 50, outputTokens: 20, estimatedUsd: 0.01, turns: 2, toolCalls: 1, toolCompletions: [],
    terminalReason: "completed", permissionDenials: [], reportedModels: ["claude-sonnet-5"], modelResponses: 2 };
  it("uses identical effective natural prompts and records the reported model without inventing request counts", async () => {
    const execute = vi.fn(async (_config, request) => {
      expect(request.systemPrompt).not.toContain("Return JSON");
      expect(request.systemPrompt).not.toContain("Return one JSON object");
      expect(request.systemPrompt).toContain("lead with the useful conclusion");
      return receipt;
    });
    const provider = new ClaudeChatProvider(config, execute);
    const effectivePrompt = vi.spyOn(provider, "effectivePrompt");
    const entries = taskModelCatalog([provider]);
    expect(entries.map(entry => entry.task)).toEqual(["relationship_text", "unscoped_chat"]);
    for (const entry of entries) {
      const measurements: TrialRunMeasurement[] = [];
      const wrapped = trialProvider(entry, "concise", value => { measurements.push(value); });
      if (entry.task === "unscoped_chat") await (wrapped as RemoteChatAnswerProviding & AgentProvider).run(agentRequest, vi.fn(), new AbortController().signal);
      else await wrapped.answer(request);
      expect(measurements[0]).toMatchObject({ status: "completed", requested_model: "anthropic/claude-sonnet-5",
        actual_model: "claude-sonnet-5", remote_requests_started: null, execution: "remote", input_tokens: 50 });
      expect(measurements[0]!.prompt_revision).toBe(measurements[0]!.actual_prompt_revision);
      expect(effectivePrompt).toHaveBeenCalledWith(expect.any(String), "concise",
        entry.task === "unscoped_chat" ? "workspace" : "relationship");
    }
  });
  it("rejects a different returned model even when the requested alias is unchanged", async () => {
    const provider = new ClaudeChatProvider(config, async () => ({ ...receipt, reportedModels: ["claude-opus-5"] }));
    const entry = taskModelCatalog([provider])[0]!;
    const measurements: TrialRunMeasurement[] = [];
    await expect(trialProvider(entry, "baseline", value => { measurements.push(value); }).answer(request)).rejects.toThrow("configuration");
    expect(measurements[0]).toMatchObject({ status: "failed", actual_model: "claude-opus-5" });
  });
});
