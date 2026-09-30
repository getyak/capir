import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runClaudeHarness, type ClaudeHarnessRequest, type HarnessSteeringFeed } from "./claudeHarness.js";
import { claudeHarnessConfiguration } from "./claudeHarnessConfiguration.js";

const config = claudeHarnessConfiguration({ ANTHROPIC_API_KEY: "synthetic-secret", TALENT_SIGNAL_AGENT_MODEL: "synthetic-model" });
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const request = (overrides: Partial<ClaudeHarnessRequest> = {}): ClaudeHarnessRequest => ({ objective: "Synthetic task", systemPrompt: "Synthetic instructions", tools: [],
  budget: { maxTurns: 8, maxToolCalls: 10, maxDurationMs: 30000, maxTaskTokens: 4000, maxEstimatedUsd: 1 }, assertCurrent: vi.fn(async () => {}), ...overrides });
const result = (overrides: object = {}) => ({ type: "result", subtype: "success", result: "Final including both fragments", is_error: false,
  modelUsage: { synthetic: { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
  total_cost_usd: .01, num_turns: 1, session_id: "synthetic-session", permission_denials: [], ...overrides });
function sdk(driver: (prompt: any, options: any) => AsyncGenerator<any>) {
  return (({ prompt, options }: any) => ({ close: vi.fn(), [Symbol.asyncIterator]: () => driver(prompt, options) })) as any;
}
const event = (hook_event_name: string, extra = {}) => ({ hook_event_name, session_id: "synthetic-session", transcript_path: "/synthetic", cwd: "/synthetic", ...extra });
const hook = (options: any, name: string) => options.hooks[name][0].hooks[0];
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
const fragments = () => ids.slice(1).map((id, i) => ({ messageID: id, acceptedAt: `2026-10-01T01:00:00.${i}00Z`, text: `Fragment ${i + 1}` }));

describe("primary SDK lifecycle steering", () => {
  it("keeps eager input open for steering authority until the complete parallel tool batch, then folds once before the final", async () => {
    const release = deferred(); const started = deferred(); const trace: string[] = []; let pulls = 0;
    const acknowledge = vi.fn(async () => { trace.push("ack"); });
    const feed: HarnessSteeringFeed = { nextBatchAtSafePoint: vi.fn(async options => {
      trace.push(options?.final ? "final-check" : "batch-check");
      return ++pulls === 1 ? { messages: fragments(), acknowledge } : null;
    }) };
    const execute = vi.fn(async () => { trace.push("tool-start"); started.resolve(); await release.promise; trace.push("tool-end"); return { content: [{ type: "text" as const, text: "synthetic receipt" }] }; });
    const running = runClaudeHarness(config, request({ messageID: ids[0], steering: feed, tools: [{ name: "probe", description: "Synthetic probe", schema: z.strictObject({}), readOnly: true, execute }] }), new AbortController().signal,
      sdk(async function* (prompt, options) {
        const inputs = []; for await (const input of prompt) inputs.push(input);
        expect(inputs).toHaveLength(1); expect(inputs[0].uuid).toBe(ids[0]); expect(pulls).toBe(0);
        const dispatch = options.mcpServers.talent_signal.instance.server._requestHandlers.get("tools/call");
        const calls = [1, 2].map(() => dispatch({ method: "tools/call", params: { name: "probe", arguments: {} } }, { signal: new AbortController().signal }));
        await Promise.all(calls);
        for (let i = 0; i < 2; i++) await hook(options, "PostToolUse")(event("PostToolUse", { tool_name: "mcp__talent_signal__probe", tool_input: {}, tool_response: {} }));
        const batch = await hook(options, "PostToolBatch")(event("PostToolBatch", { tool_calls: [] }));
        expect(batch.hookSpecificOutput.additionalContext).toContain(ids[1]); expect(batch.hookSpecificOutput.additionalContext).toContain(ids[2]);
        expect(acknowledge).not.toHaveBeenCalled();
        // A later primary Stop is evidence the model continued after injection.
        expect(await hook(options, "Stop")(event("Stop", { stop_hook_active: false }))).toEqual({});
        trace.push("final"); yield result();
      }), null);
    await started.promise; expect(pulls).toBe(0); release.resolve();
    const outcome = await running;
    expect(trace.lastIndexOf("tool-end")).toBeLessThan(trace.indexOf("batch-check"));
    expect(trace.indexOf("ack")).toBeLessThan(trace.indexOf("final"));
    expect(acknowledge).toHaveBeenCalledTimes(1); expect(outcome.toolCompletions).toHaveLength(2);
    expect(outcome.text).toBe("Final including both fragments");
  });

  it("does not close on an empty tool checkpoint and handles a late fragment before Stop", async () => {
    let late = false; const ack = vi.fn(async () => {});
    const feed: HarnessSteeringFeed = { nextBatchAtSafePoint: vi.fn(async options => {
      if (!options?.final) return { messages: [] };
      if (!late) { late = true; return { messages: fragments(), acknowledge: ack }; }
      return null;
    }) };
    await runClaudeHarness(config, request({ steering: feed }), new AbortController().signal, sdk(async function* (prompt, options) {
      for await (const _ of prompt) { /* eager SDK input */ }
      expect(await hook(options, "PostToolBatch")(event("PostToolBatch", { tool_calls: [] }))).toEqual({});
      const continuation = await hook(options, "Stop")(event("Stop", { stop_hook_active: false }));
      expect(continuation.hookSpecificOutput.hookEventName).toBe("Stop"); expect(ack).not.toHaveBeenCalled();
      expect(await hook(options, "Stop")(event("Stop", { stop_hook_active: true }))).toEqual({});
      yield result();
    }), null);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(feed.nextBatchAtSafePoint).toHaveBeenNthCalledWith(1, { final: false });
    expect(feed.nextBatchAtSafePoint).toHaveBeenNthCalledWith(2, { final: true });
  });

  it("never treats a child checkpoint or abort after dispatch as primary consumption", async () => {
    const abort = new AbortController(); const ack = vi.fn(async () => {});
    const feed: HarnessSteeringFeed = { nextBatchAtSafePoint: vi.fn(async () => ({ messages: fragments(), acknowledge: ack })) };
    await expect(runClaudeHarness(config, request({ steering: feed }), abort.signal, sdk(async function* (prompt, options) {
      for await (const _ of prompt) { /* input */ }
      expect(await hook(options, "PostToolBatch")(event("PostToolBatch", { agent_id: "child", tool_calls: [] }))).toEqual({});
      expect(await hook(options, "Stop")(event("Stop", { agent_id: "child", stop_hook_active: false }))).toEqual({});
      expect(feed.nextBatchAtSafePoint).not.toHaveBeenCalled();
      await hook(options, "PostToolBatch")(event("PostToolBatch", { tool_calls: [] }));
      abort.abort(new Error("USER_CANCELLED")); yield result();
    }), null)).rejects.toThrow();
    expect(ack).not.toHaveBeenCalled();
  });

  it("stops at a failed result instead of allowing a later success to overwrite it", async () => {
    const later = vi.fn();
    await expect(runClaudeHarness(config, request(), new AbortController().signal, sdk(async function* (prompt) {
      for await (const _ of prompt) { /* input */ }
      yield result({ subtype: "error_max_turns", is_error: true }); later(); yield result();
    }), null)).rejects.toThrow("CLAUDE_HARNESS_ERROR_MAX_TURNS");
    expect(later).not.toHaveBeenCalled();
  });

  it("includes usage observed after a cumulative receipt when the next model call is stopped", async () => {
    const abort = new AbortController(); let failure: any;
    try { await runClaudeHarness(config, request(), abort.signal, sdk(async function* (prompt) {
      for await (const _ of prompt) { /* input */ }
      yield result({ modelUsage: { synthetic: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } });
      yield { type: "assistant", parent_tool_use_id: null, message: { id: "later", model: "synthetic-model", content: [], usage: { input_tokens: 12, output_tokens: 7 } } };
      abort.abort(new Error("USER_CANCELLED"));
    }), null); } catch (error) { failure = error; }
    expect(failure.receipt).toMatchObject({ inputTokens: 112, outputTokens: 27, usageComplete: false });
  });
});
