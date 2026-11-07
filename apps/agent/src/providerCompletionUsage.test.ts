import { describe, expect, it, vi } from "vitest";
import { BigModelAgentProvider } from "./bigModelProvider.js";
import { OpenRouterAgentProvider } from "./openRouterProvider.js";
import { AGENT_TOOL_NAMES, type AgentProviderRequest } from "./types.js";

const request = (): AgentProviderRequest => ({
  runID: "10000000-0000-4000-8000-000000000001", objective: "Synthetic governed task",
  systemPrompt: "Only prepare reviewed proposals.", scopeSummary: { kind: "pursuit",
    workspaceID: "10000000-0000-4000-8000-000000000002", pursuitID: "10000000-0000-4000-8000-000000000003",
    pursuitRevision: 1, evidenceRefs: [] }, toolManifest: AGENT_TOOL_NAMES,
  budget: { maxTurns: 6, maxToolCalls: 12, maxDurationMs: 60_000, maxTaskTokens: 32_000, maxEstimatedUsd: 1 },
});
const tool = { id: "synthetic-call", type: "function", function: { name: "read_pursuit", arguments: "{}" } };
const usage = { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13, cost: 0.01 };
const cases = [
  { name: "BigModel", model: "glm-5.3", make: (fetcher: typeof fetch) => new BigModelAgentProvider({
    apiKey: "synthetic-key", model: "glm-5.3", inputCnyPerMillion: 8, outputCnyPerMillion: 28, cnyPerUsd: 7, fetcher }) },
  { name: "OpenRouter", model: "openai/gpt-4.1-mini", make: (fetcher: typeof fetch) => new OpenRouterAgentProvider({
    apiKey: "synthetic-key", model: "openai/gpt-4.1-mini", fetcher }) },
];

for (const adapter of cases) describe(`${adapter.name} completion and accounting`, () => {
  const response = (finishReason: unknown, reportedUsage: unknown, tools: unknown[] = []) => new Response(JSON.stringify({
    id: "synthetic-response", model: adapter.model, choices: [{ finish_reason: finishReason,
      message: { role: "assistant", content: tools.length ? null : "{}", ...(tools.length ? { tool_calls: tools } : {}) } }],
    ...(reportedUsage === undefined ? {} : { usage: reportedUsage }),
  }), { headers: { "content-type": "application/json" } });
  const invoke = () => vi.fn(async (name: string) => ({ ok: true, callID: "synthetic-receipt", name, data: {} }));

  it.each(["length", "content_filter", "refusal", "sensitive", "network_error", "error", "model_context_window_exceeded"])(
    "executes zero tools from a %s batch even when its arguments parse", async finishReason => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(finishReason, usage, [tool]))
        .mockResolvedValueOnce(response("stop", usage));
      const execute = invoke(), result = await adapter.make(fetcher).run(request(), execute, new AbortController().signal);
      expect(execute).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result.structuredOutput).toBeNull();
      expect(result.terminalReason).toMatch(/^provider_(output_incomplete|response_rejected)$/);
    });

  it.each([undefined, null, "", "unrecognized_reason"])("does not treat unknown completion metadata %s as a closed tool batch", async reason => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(reason, usage, [tool]))
      .mockResolvedValueOnce(response("stop", usage));
    const execute = invoke(), result = await adapter.make(fetcher).run(request(), execute, new AbortController().signal);
    expect(execute).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.terminalReason).toBe("provider_response_rejected");
  });

  it("preserves absent usage as unknown and never invents a zero charge", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("stop", undefined));
    const result = await adapter.make(fetcher).run(request(), invoke(), new AbortController().signal);
    expect(result).toMatchObject({ inputTokens: null, outputTokens: null, estimatedUsd: null,
      terminalReason: "provider_usage_unavailable", structuredOutput: null });
  });

  it("keeps explicitly reported zero token usage and charge as zero", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("stop", {
      prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 }));
    const result = await adapter.make(fetcher).run(request(), invoke(), new AbortController().signal);
    expect(result).toMatchObject({ inputTokens: 0, outputTokens: 0, estimatedUsd: 0, structuredOutput: {} });
  });

  it("does not replace a missing later input count with a subtotal", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("tool_calls", usage, [tool]))
      .mockResolvedValueOnce(response("stop", { completion_tokens: 7, total_tokens: 12, cost: 0.02 }));
    const result = await adapter.make(fetcher).run(request(), invoke(), new AbortController().signal);
    expect(result.inputTokens).toBeNull(); expect(result.outputTokens).toBe(10);
    expect(result).toHaveProperty("totalTokens", 25);
    if (adapter.name === "BigModel") expect(result.estimatedUsd).toBeNull();
    else expect(result.estimatedUsd).toBeCloseTo(0.03);
  });

  it("stops before tools or another request when reported cumulative tokens exhaust the task budget", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("tool_calls", {
      prompt_tokens: 97, completion_tokens: 3, total_tokens: 100, cost: 0.01 }, [tool]))
      .mockResolvedValueOnce(response("stop", usage));
    const input = request(); input.budget.maxTaskTokens = 100;
    const execute = invoke(), result = await adapter.make(fetcher).run(input, execute, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(execute).not.toHaveBeenCalled();
    expect(result.terminalReason).toBe("budget_exhausted");
  });

  it("stops before tools when the known charge exceeds the finite task budget", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("tool_calls", usage, [tool]))
      .mockResolvedValueOnce(response("stop", usage));
    const input = request(); input.budget.maxEstimatedUsd = 0.00001;
    const execute = invoke(), result = await adapter.make(fetcher).run(input, execute, new AbortController().signal);
    expect(execute).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.terminalReason).toBe("budget_exhausted");
  });

  it.each([null, -1, 1.5, "3", true])("does not coerce an invalid reported token count %s into a known number", async count => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("stop", {
      prompt_tokens: count, completion_tokens: 3, total_tokens: 13, cost: 0.01 }));
    const result = await adapter.make(fetcher).run(request(), invoke(), new AbortController().signal);
    expect(result.inputTokens).toBeNull(); expect(result.outputTokens).toBe(3);
  });

  it("does not execute the next tool after cancellation during an earlier tool", async () => {
    const controller = new AbortController(), calls: string[] = [];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("tool_calls", usage, [tool, { ...tool, id: "second" }]));
    const execute = async (name: string) => {
      calls.push(name); controller.abort(new Error("Synthetic cancel"));
      return { ok: true, callID: "first-receipt", name, data: {} };
    };
    await expect(adapter.make(fetcher).run(request(), execute, controller.signal)).rejects.toThrow("Synthetic cancel");
    expect(calls).toEqual(["read_pursuit"]); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a declared tool-call completion with no actual tool batch", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("tool_calls", usage));
    const result = await adapter.make(fetcher).run(request(), invoke(), new AbortController().signal);
    expect(result).toMatchObject({ terminalReason: "provider_response_rejected", structuredOutput: null });
  });

  it("does not report a total smaller than a known token component", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("stop", {
      completion_tokens: 20, total_tokens: 13, cost: 0.01 }));
    const result = await adapter.make(fetcher).run(request(), invoke(), new AbortController().signal);
    expect(result).toMatchObject({ inputTokens: null, outputTokens: 20, totalTokens: null,
      terminalReason: "provider_usage_unavailable", structuredOutput: null });
  });

  it.each(["response", "choice", "refusal"])("rejects explicit %s failure even with a stop completion", async location => {
    const payload = await response("stop", usage, [tool]).json();
    if (location === "response") payload.error = { code: "synthetic-error" };
    else if (location === "choice") payload.choices[0].error = { code: "synthetic-error" };
    else payload.choices[0].message.refusal = "Synthetic refusal";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(payload)))
      .mockResolvedValueOnce(response("stop", usage));
    const execute = invoke(), result = await adapter.make(fetcher).run(request(), execute, new AbortController().signal);
    expect(execute).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ terminalReason: "provider_response_rejected", structuredOutput: null });
  });

  it("uses cumulative charges before dispatching a later tool batch", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("tool_calls", usage, [tool]))
      .mockResolvedValueOnce(response("tool_calls", usage, [{ ...tool, id: "second-round" }]))
      .mockResolvedValueOnce(response("stop", usage));
    const input = request(); input.budget.maxTaskTokens = 26;
    const execute = invoke(), result = await adapter.make(fetcher).run(input, execute, new AbortController().signal);
    expect(execute).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ totalTokens: 26, terminalReason: "budget_exhausted", structuredOutput: null });
  });

  if (adapter.name === "OpenRouter") {
    it.each([null, false, "", " ", -1])("keeps an invalid cost %s unknown rather than free", async cost => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("stop", { ...usage, cost }));
      const result = await adapter.make(fetcher).run(request(), invoke(), new AbortController().signal);
      expect(result).toMatchObject({ estimatedUsd: null, terminalReason: "provider_usage_unavailable" });
    });

    it("keeps a missing later cost unknown instead of returning the earlier known subtotal", async () => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("tool_calls", usage, [tool]))
        .mockResolvedValueOnce(response("stop", { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 }));
      const result = await adapter.make(fetcher).run(request(), invoke(), new AbortController().signal);
      expect(result).toMatchObject({ inputTokens: 15, outputTokens: 10, totalTokens: 25, estimatedUsd: null,
        terminalReason: "provider_usage_unavailable" });
    });

    it("keeps an unknown earlier field unknown after a later known round while using reported total/cost", async () => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("tool_calls", {
        completion_tokens: 3, total_tokens: 13, cost: 0.01 }, [tool]))
        .mockResolvedValueOnce(response("stop", { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12, cost: 0.02 }));
      const result = await adapter.make(fetcher).run(request(), invoke(), new AbortController().signal);
      expect(result.inputTokens).toBeNull(); expect(result.outputTokens).toBe(10);
      expect(result).toHaveProperty("totalTokens", 25); expect(result.estimatedUsd).toBeCloseTo(0.03);
    });

    it("does not dispatch tools or a second request without reported cost for a finite cost budget", async () => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("tool_calls", {
        prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }, [tool]))
        .mockResolvedValueOnce(response("stop", usage));
      const execute = invoke(), result = await adapter.make(fetcher).run(request(), execute, new AbortController().signal);
      expect(execute).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ inputTokens: 10, outputTokens: 3, estimatedUsd: null,
        terminalReason: "provider_usage_unavailable" });
    });
  }
});
