import { ChatResponseBlockSchema } from "@talent-signal/contracts";
import { createServer } from "node:http";
import { access } from "node:fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { calendarDraftCapability } from "./calendarDraft.js";
import { ClaudeChatProvider } from "./claudeChatProvider.js";
import { runClaudeHarness, type ClaudeHarnessRequest } from "./claudeHarness.js";
import { claudeHarnessConfiguration } from "./claudeHarnessConfiguration.js";

const config = claudeHarnessConfiguration({ ANTHROPIC_API_KEY: "synthetic-only", TALENT_SIGNAL_AGENT_MODEL: "synthetic-model" });
const id = "11111111-1111-4111-8111-111111111111";
const objective = "Synthetic meeting on 2026-10-18 from 08:00 to 09:00 in Shanghai. Prepare only a draft.";
const calendarContext = { sourceRequestID: id, referenceTime: "2026-10-07T00:00:00Z", timeZone: "Asia/Shanghai" };
const calendarInput = { title: "Synthetic meeting", starts_at: "2026-10-18T08:00:00+08:00", ends_at: "2026-10-18T09:00:00+08:00", time_zone: "Asia/Shanghai", source_excerpt: objective, finish_preparation: true };
function request(overrides: Partial<ClaudeHarnessRequest> = {}): ClaudeHarnessRequest {
  const calendar = calendarDraftCapability(calendarContext, objective);
  return { objective, systemPrompt: "Synthetic local test", tools: calendar.tools, preparationReady: calendar.preparationReady, onPreparationSuperseded: calendar.discard,
    preparationRevision: calendar.preparationRevision,
    budget: { maxTurns: 8, maxToolCalls: 8, maxDurationMs: 30_000, maxTaskTokens: 4000, maxEstimatedUsd: 1 }, assertCurrent: vi.fn(async () => {}), ...overrides };
}
const result = (overrides = {}) => ({ type: "result", subtype: "success", result: "", is_error: false, terminal_reason: "hook_stopped",
  modelUsage: { synthetic: { inputTokens: 20, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } }, total_cost_usd: .01,
  num_turns: 2, session_id: "synthetic-session", permission_denials: [], ...overrides });
const event = (name: string, extra = {}) => ({ hook_event_name: name, session_id: "synthetic-session", transcript_path: "/synthetic", cwd: "/synthetic", ...extra });
const hook = (options: any, name: string) => options.hooks[name][0].hooks[0];
const batch = (options: any, extra = {}) => hook(options, "PostToolBatch")(event("PostToolBatch", { tool_calls: [], ...extra }));
function sdk(driver: (options: any) => AsyncGenerator<any>, close = vi.fn()) {
  return (({ options }: any) => ({ close, [Symbol.asyncIterator]: () => driver(options) })) as unknown as typeof query;
}
async function stage(options: any, args = calendarInput, child = false) {
  const dispatch = options.mcpServers.talent_signal.instance.server._requestHandlers.get("tools/call");
  const response = await dispatch({ method: "tools/call", params: { name: "stage_calendar_draft", arguments: args } }, { signal: new AbortController().signal });
  await hook(options, "PostToolUse")(event("PostToolUse", { tool_name: "mcp__talent_signal__stage_calendar_draft", tool_input: args, tool_response: response, ...(child ? { agent_id: "child" } : {}) }));
  return response;
}

describe("host-validated preparation terminal", () => {
  it("delivers authentic receipt fields after a valid pending draft, without prose", async () => {
    const feed = { nextBatchAtSafePoint: vi.fn(async () => null) };
    const output = await runClaudeHarness(config, request({ steering: feed }), new AbortController().signal, sdk(async function* (options) {
      await stage(options);
      expect(await batch(options)).toMatchObject({ continue: false });
      yield result();
    }), null);
    expect(feed.nextBatchAtSafePoint).toHaveBeenCalledExactlyOnceWith({ final: true });
    expect(output).toMatchObject({ text: "", terminalReason: "hook_stopped", inputTokens: 20, outputTokens: 5, turns: 2, toolCalls: 1 });
    expect(output.toolCompletions.map(tool => tool.name)).toEqual(["stage_calendar_draft"]);
  });

  it.each(["not-ready", "malformed", "failed", "child"])("continues when %s", async kind => {
    const overrides: Partial<ClaudeHarnessRequest> = kind === "not-ready" ? { preparationReady: () => false } : {};
    await runClaudeHarness(config, request(overrides), new AbortController().signal, sdk(async function* (options) {
      if (kind === "failed") await stage(options, { ...calendarInput, source_excerpt: "Absent source" });
      else if (kind === "malformed") await stage(options, { ...calendarInput, ends_at: "invalid" });
      else await stage(options, calendarInput, kind === "child");
      expect(await batch(options, kind === "child" ? { agent_id: "child" } : {})).toEqual({});
      yield result({ terminal_reason: "completed", result: "Clarify" });
    }), null);
  });

  it("continues a multi-goal task when staging does not explicitly finish preparation", async () => {
    await runClaudeHarness(config, request(), new AbortController().signal, sdk(async function* (options) {
      await stage(options, { ...calendarInput, finish_preparation: false });
      expect(await batch(options)).toEqual({});
      yield result({ terminal_reason: "completed", result: "Other requested work finished" });
    }), null);
  });

  it("discards a staged draft when original steering supersedes it", async () => {
    const calendar = calendarDraftCapability(calendarContext, objective);
    const feed = { nextBatchAtSafePoint: vi.fn(async () => ({ messages: [{ messageID: id, acceptedAt: "2026-10-07T00:01:00Z", text: "Cancel" }] })) };
    await runClaudeHarness(config, request({ tools: calendar.tools, preparationReady: calendar.preparationReady, onPreparationSuperseded: calendar.discard, preparationRevision: calendar.preparationRevision, steering: feed }),
      new AbortController().signal, sdk(async function* (options) {
        await stage(options); expect(calendar.draft()).toBeDefined();
        await batch(options); expect(calendar.draft()).toBeUndefined();
        expect(calendar.preparationReady()).toBe(false);
        expect((await stage(options, { ...calendarInput, title: "Updated synthetic draft", finish_preparation: false })).isError).toBe(false);
        expect(calendar.draft()?.title).toBe("Updated synthetic draft");
        expect(await batch(options)).not.toHaveProperty("continue", false);
        yield result({ terminal_reason: "completed" });
      }), null);
  });

  it("does not stop solely because a host closure is ready without primary execution", async () => {
    await runClaudeHarness(config, request({ preparationReady: () => true }), new AbortController().signal, sdk(async function* (options) {
      expect(await batch(options)).toEqual({}); yield result({ terminal_reason: "completed" });
    }), null);
  });

  it("continues for new original steering and never later terminates using the old draft", async () => {
    const acknowledge = vi.fn(async () => {});
    let pulls = 0;
    const feed = { nextBatchAtSafePoint: vi.fn(async () => ++pulls === 1 ? { messages: [{ messageID: id, acceptedAt: "2026-10-07T00:01:00Z", text: "Cancel that draft" }], acknowledge } : null) };
    await runClaudeHarness(config, request({ steering: feed }), new AbortController().signal, sdk(async function* (options) {
      await stage(options);
      expect((await batch(options)).hookSpecificOutput.additionalContext).toContain("Cancel that draft");
      expect(await batch(options)).toEqual({});
      yield result({ terminal_reason: "completed", result: "Cancelled" });
    }), null);
    expect(feed.nextBatchAtSafePoint.mock.calls).toEqual([[{ final: true }], [{ final: false }]]);
    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it("fast-stops on a new finishing draft from the latest original after steering supersedes the old one", async () => {
    const latest = "Please move the synthetic meeting to 2026-10-18 and finish the calendar draft";
    const calendar = calendarDraftCapability({ ...calendarContext,
      resolveMessageExcerpt: excerpt => latest.includes(excerpt) ? { messageID: id, text: latest }
        : objective.includes(excerpt) ? { messageID: id, text: objective } : false }, objective);
    let pulls = 0;
    const feed = { nextBatchAtSafePoint: vi.fn(async () => ++pulls === 1
      ? { messages: [{ messageID: id, acceptedAt: "2026-10-07T00:01:00Z", text: latest }] } : null) };
    const output = await runClaudeHarness(config, request({ tools: calendar.tools,
      preparationReady: calendar.preparationReady, onPreparationSuperseded: calendar.discard,
      preparationRevision: calendar.preparationRevision, steering: feed }),
      new AbortController().signal, sdk(async function* (options) {
        await stage(options);
        expect(calendar.preparationRevision()).toBe(1);
        // The old finishing draft is invalidated and cannot terminate the task.
        const superseded = await batch(options);
        expect(superseded.hookSpecificOutput.additionalContext).toContain("move the synthetic meeting");
        expect(calendar.draft()).toBeUndefined();
        expect(calendar.preparationRevision()).toBe(2);
        // The latest original stages its own finishing draft in a strictly newer generation.
        expect((await stage(options, { ...calendarInput, source_excerpt: "move the synthetic meeting to 2026-10-18",
          title: "Rescheduled synthetic meeting" })).isError).toBe(false);
        expect(calendar.preparationRevision()).toBe(3);
        expect(calendar.preparationReady()).toBe(true);
        // Fast-stop before another model call, never salvaging with the old draft.
        expect(await batch(options)).toMatchObject({ continue: false, stopReason: "Host-validated preparation is ready for human review." });
        yield result();
      }), null);
    expect(feed.nextBatchAtSafePoint.mock.calls).toEqual([[{ final: true }], [{ final: true }]]);
    expect(output).toMatchObject({ text: "", terminalReason: "hook_stopped", toolCalls: 2 });
    expect(output.toolCompletions.map(tool => tool.name)).toEqual(["stage_calendar_draft", "stage_calendar_draft"]);
  });

  it.each(["old-draft", "constant-readiness", "constant-revision", "unrelated-primary"])(
    "keeps the stop disarmed after steering for %s", async kind => {
    const calendar = calendarDraftCapability(calendarContext, objective);
    const unrelated = { name: "unrelated", description: "Synthetic unrelated tool", schema: z.strictObject({}), readOnly: true,
      execute: async () => ({ content: [{ type: "text" as const, text: "unrelated receipt" }] }) };
    let pulls = 0;
    const feed = { nextBatchAtSafePoint: vi.fn(async () => ++pulls === 1
      ? { messages: [{ messageID: id, acceptedAt: "2026-10-07T00:01:00Z", text: "Cancel" }] } : null) };
    await runClaudeHarness(config, request({
      tools: kind === "unrelated-primary" ? [...calendar.tools, unrelated] : calendar.tools,
      // The old draft or unchanged readiness may keep claiming ready after steering.
      preparationReady: kind === "old-draft" ? calendar.preparationReady : () => true,
      onPreparationSuperseded: kind === "old-draft" ? () => {} : calendar.discard,
      preparationRevision: kind === "constant-revision" ? () => 7 : calendar.preparationRevision,
      steering: feed,
    }), new AbortController().signal, sdk(async function* (options) {
      await stage(options);
      const superseded = await batch(options);
      expect(superseded.hookSpecificOutput.additionalContext).toContain("Cancel");
      if (kind === "unrelated-primary") {
        // No new preparation exists; unrelated success must not re-arm the stop.
        const dispatch = options.mcpServers.talent_signal.instance.server._requestHandlers.get("tools/call");
        await dispatch({ method: "tools/call", params: { name: "unrelated", arguments: {} } }, { signal: new AbortController().signal });
        await hook(options, "PostToolUse")(event("PostToolUse", { tool_name: "mcp__talent_signal__unrelated", tool_input: {}, tool_response: {} }));
      }
      expect(await batch(options)).toEqual({});
      yield result({ terminal_reason: "completed", result: "Clarify" });
    }), null);
  });

  it.each([
    ["invalid", Number.NaN, 7],
    ["negative", -1, 7],
    ["fraction", 5, 8.5],
    ["unsafe", 5, Number.MAX_SAFE_INTEGER + 2],
  ] as const)("fails closed after steering for a %s host preparation generation", async (_kind, first, later) => {
    let reads = 0;
    const preparationRevision = () => ++reads === 1 ? first : later;
    let pulls = 0;
    const feed = { nextBatchAtSafePoint: vi.fn(async () => ++pulls === 1
      ? { messages: [{ messageID: id, acceptedAt: "2026-10-07T00:01:00Z", text: "Cancel" }] } : null) };
    await runClaudeHarness(config, request({ preparationReady: () => true, preparationRevision, steering: feed }),
      new AbortController().signal, sdk(async function* (options) {
        await stage(options);
        const superseded = await batch(options);
        expect(superseded.hookSpecificOutput.additionalContext).toContain("Cancel");
        // Even a numerically "newer" invalid or unsafe generation must not re-arm.
        expect(await batch(options)).toEqual({});
        yield result({ terminal_reason: "completed", result: "Clarify" });
      }), null);
  });

  it("fails closed when the host preparation generation regresses after steering", async () => {
    const calendar = calendarDraftCapability(calendarContext, objective);
    const values = [5, 8, 6, 6];
    const preparationRevision = () => values.shift() ?? 6;
    let pulls = 0;
    const feed = { nextBatchAtSafePoint: vi.fn(async () => ++pulls === 1
      ? { messages: [{ messageID: id, acceptedAt: "2026-10-07T00:01:00Z", text: "Cancel" }] } : null) };
    await runClaudeHarness(config, request({ tools: calendar.tools, preparationReady: calendar.preparationReady,
      onPreparationSuperseded: calendar.discard, preparationRevision, steering: feed }),
      new AbortController().signal, sdk(async function* (options) {
        await stage(options, { ...calendarInput, title: "Superseded draft", finish_preparation: false });
        await batch(options); // floor capture observes generation 5
        expect(await batch(options)).toEqual({}); // observes 8 while nothing is ready
        expect((await stage(options, { ...calendarInput, title: "Latest synthetic draft" })).isError).toBe(false);
        // The ready draft observes a regressed generation 6 and cannot re-arm.
        expect(await batch(options)).toEqual({});
        yield result({ terminal_reason: "completed", result: "Clarify" });
      }), null);
  });

  it("keeps the legacy fail-closed stop after steering without a host generation", async () => {
    const calendar = calendarDraftCapability(calendarContext, objective);
    let pulls = 0;
    const feed = { nextBatchAtSafePoint: vi.fn(async () => ++pulls === 1
      ? { messages: [{ messageID: id, acceptedAt: "2026-10-07T00:01:00Z", text: "Cancel" }] } : null) };
    const legacy = request({ tools: calendar.tools, preparationReady: calendar.preparationReady,
      onPreparationSuperseded: calendar.discard, steering: feed });
    delete legacy.preparationRevision;
    await runClaudeHarness(config, legacy, new AbortController().signal, sdk(async function* (options) {
      await stage(options);
      await batch(options);
      // A brand-new valid finishing draft still cannot re-arm a legacy host.
      expect((await stage(options, { ...calendarInput, title: "Updated synthetic draft" })).isError).toBe(false);
      expect(calendar.preparationReady()).toBe(true);
      expect(await batch(options)).toEqual({});
      yield result({ terminal_reason: "completed", result: "Clarify" });
    }), null);
  });

  it("invalidates each new current preparation again on repeated steering", async () => {
    const calendar = calendarDraftCapability(calendarContext, objective);
    let pulls = 0;
    const feed = { nextBatchAtSafePoint: vi.fn(async () => ++pulls <= 2
      ? { messages: [{ messageID: id, acceptedAt: `2026-10-07T00:0${pulls}:00Z`, text: `Change ${pulls}` }] } : null) };
    await runClaudeHarness(config, request({ tools: calendar.tools,
      preparationReady: calendar.preparationReady, onPreparationSuperseded: calendar.discard,
      preparationRevision: calendar.preparationRevision, steering: feed }),
      new AbortController().signal, sdk(async function* (options) {
        await stage(options); // draft A, generation 1
        const first = await batch(options);
        expect(first.hookSpecificOutput.additionalContext).toContain("Change 1");
        expect(calendar.preparationRevision()).toBe(2); // A invalidated
        expect((await stage(options, { ...calendarInput, title: "Synthetic draft B" })).isError).toBe(false);
        const second = await batch(options);
        // Even a ready draft B cannot stop when newer original input arrives.
        expect(second.hookSpecificOutput.additionalContext).toContain("Change 2");
        expect(calendar.preparationRevision()).toBe(4); // B invalidated again
        expect((await stage(options, { ...calendarInput, title: "Synthetic draft C" })).isError).toBe(false);
        expect(await batch(options)).toMatchObject({ continue: false });
        yield result();
      }), null);
    expect(calendar.preparationRevision()).toBe(5);
  });

  it.each(["readiness", "regressing-revision"])("rechecks %s after the async fences before stopping", async kind => {
    const calendar = calendarDraftCapability(calendarContext, objective);
    let readySeen = false;
    let regress = false;
    let pulls = 0;
    const feed = { nextBatchAtSafePoint: vi.fn(async () => ++pulls === 1
      ? { messages: [{ messageID: id, acceptedAt: "2026-10-07T00:01:00Z", text: "Cancel" }] } : null) };
    const input = request({ tools: calendar.tools, steering: feed,
      preparationReady: () => { const ready = calendar.preparationReady(); if (ready) readySeen = true; return ready; },
      preparationRevision: () => regress ? 0 : calendar.preparationRevision(),
      onPreparationSuperseded: calendar.discard,
      // The source/lease fence mutates host state after the stop decision forms.
      assertCurrent: async () => { if (readySeen && kind === "readiness") calendar.discard(); if (readySeen && kind === "regressing-revision") regress = true; } });
    await runClaudeHarness(config, input, new AbortController().signal, sdk(async function* (options) {
      await stage(options, { ...calendarInput, title: "Superseded draft", finish_preparation: false });
      const superseded = await batch(options);
      expect(superseded.hookSpecificOutput.additionalContext).toContain("Cancel");
      expect(calendar.preparationRevision()).toBe(2);
      expect((await stage(options, { ...calendarInput, title: "Re-armed synthetic draft" })).isError).toBe(false);
      expect(await batch(options)).toEqual({});
      yield result({ terminal_reason: "completed", result: "Clarify" });
    }), null);
  });

  it.each(["output-schema", "failed-tool"])("continues without stopping when %s blocks a re-armed preparation", async kind => {
    const calendar = calendarDraftCapability(calendarContext, objective);
    const failing = { name: "failing", description: "Synthetic failing tool", schema: z.strictObject({}), readOnly: true,
      execute: async () => ({ content: [{ type: "text" as const, text: "synthetic failure" }], isError: true }) };
    let pulls = 0;
    const feed = { nextBatchAtSafePoint: vi.fn(async () => ++pulls === 1
      ? { messages: [{ messageID: id, acceptedAt: "2026-10-07T00:01:00Z", text: "Cancel" }] } : null) };
    const input = request({ tools: kind === "failed-tool" ? [...calendar.tools, failing] : calendar.tools,
      preparationReady: calendar.preparationReady, onPreparationSuperseded: calendar.discard,
      preparationRevision: calendar.preparationRevision, steering: feed,
      ...(kind === "output-schema" ? { outputSchema: { type: "object" } } : {}) });
    await runClaudeHarness(config, input, new AbortController().signal, sdk(async function* (options) {
      await stage(options);
      await batch(options);
      expect((await stage(options, { ...calendarInput, title: "Re-armed synthetic draft" })).isError).toBe(false);
      if (kind === "failed-tool") {
        const dispatch = options.mcpServers.talent_signal.instance.server._requestHandlers.get("tools/call");
        await dispatch({ method: "tools/call", params: { name: "failing", arguments: {} } }, { signal: new AbortController().signal });
      }
      expect(await batch(options)).toEqual({});
      yield result({ terminal_reason: "completed", result: "Clarify" });
    }), null);
  });

  it.each(["source", "cancel", "budget"])("never salvages %s loss through a re-armed preparation", async kind => {
    const abort = new AbortController(); let lost = false;
    const calendar = calendarDraftCapability(calendarContext, objective);
    let pulls = 0;
    const feed = { nextBatchAtSafePoint: vi.fn(async () => ++pulls === 1
      ? { messages: [{ messageID: id, acceptedAt: "2026-10-07T00:01:00Z", text: "Cancel" }] } : null) };
    const input = request({ tools: calendar.tools, preparationReady: calendar.preparationReady,
      onPreparationSuperseded: calendar.discard, preparationRevision: calendar.preparationRevision, steering: feed,
      assertCurrent: async () => { if (lost) throw new Error("SOURCE_REVOKED"); } });
    await expect(runClaudeHarness(config, input, abort.signal, sdk(async function* (options) {
      await stage(options);
      await batch(options);
      await stage(options, { ...calendarInput, title: "Re-armed synthetic draft" });
      if (kind === "source") lost = true;
      if (kind === "cancel") abort.abort(new Error("USER_CANCELLED"));
      if (kind === "budget") yield { type: "assistant", message: { id: "usage", model: "synthetic", content: [], usage: { input_tokens: 4000, output_tokens: 5 } } };
      // Model hook exceptions may be swallowed by SDK: the controller must still fail.
      try { await batch(options); } catch { /* emulate SDK error handling */ }
      yield result();
    }), null)).rejects.toThrow();
  });

  it("waits for all parallel work and continues if any tool failed", async () => {
    const input = request(); let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    input.tools = [...input.tools, { name: "other", description: "Synthetic", schema: z.strictObject({}), readOnly: true,
      execute: async () => { await hold; return { content: [], isError: true }; } }];
    await runClaudeHarness(config, input, new AbortController().signal, sdk(async function* (options) {
      const dispatch = options.mcpServers.talent_signal.instance.server._requestHandlers.get("tools/call");
      const other = dispatch({ method: "tools/call", params: { name: "other", arguments: {} } }, { signal: new AbortController().signal });
      await stage(options); release(); await other;
      expect(await batch(options)).toEqual({}); yield result({ terminal_reason: "completed" });
    }), null);
  });

  it.each(["source", "cancel", "timeout", "budget"])("never salvages %s loss after preparation", async kind => {
    const abort = new AbortController(); let lost = false;
    const input = request({ assertCurrent: async () => { if (lost) throw new Error("SOURCE_REVOKED"); } });
    await expect(runClaudeHarness(config, input, abort.signal, sdk(async function* (options) {
      await stage(options);
      if (kind === "source") lost = true;
      if (kind === "cancel") abort.abort(new Error("USER_CANCELLED"));
      if (kind === "timeout") options.abortController.abort(new Error("CLAUDE_HARNESS_TIMEOUT"));
      if (kind === "budget") yield { type: "assistant", message: { id: "usage", model: "synthetic", content: [], usage: { input_tokens: 4000, output_tokens: 5 } } };
      // Model hook exceptions may be swallowed by SDK: the controller must still fail.
      try { await batch(options); } catch { /* emulate SDK error handling */ }
      yield result();
    }), null)).rejects.toThrow();
  });

  it("rejects a hook-stopped terminal without the host stop marker", async () => {
    await expect(runClaudeHarness(config, request(), new AbortController().signal, sdk(async function* () { yield result(); }), null))
      .rejects.toThrow("CLAUDE_HARNESS_PREPARATION_STOP_NOT_REQUESTED");
  });

  it.each(["stream", "cleanup"])("keeps %s failure after requesting a genuine stop", async kind => {
    await expect(runClaudeHarness(config, request(), new AbortController().signal, sdk(async function* (options) {
      await stage(options); await batch(options);
      if (kind === "stream") throw new Error("Synthetic stream failure");
      yield result();
    }, kind === "cleanup" ? vi.fn(() => { throw new Error("Synthetic cleanup failure"); }) : vi.fn()), null)).rejects.toThrow();
  });

  it("retains terminal usage and failure subtype instead of salvaging a prepared draft", async () => {
    await expect(runClaudeHarness(config, request(), new AbortController().signal, sdk(async function* (options) {
      await stage(options); await batch(options);
      yield result({ subtype: "error_max_turns", is_error: true, terminal_reason: "max_turns" });
    }), null)).rejects.toMatchObject({ message: "CLAUDE_HARNESS_ERROR_MAX_TURNS", receipt: { inputTokens: 20, outputTokens: 5, turns: 2 } });
  });

  it("does not terminally prepare structured output", async () => {
    await runClaudeHarness(config, request({ outputSchema: { type: "object" } }), new AbortController().signal, sdk(async function* (options) {
      await stage(options); expect(await batch(options)).toEqual({}); yield result({ terminal_reason: "completed" });
    }), null);
  });

  it("supports the answer adapter's host status for empty prose with a valid card and leaves JSON adapter unchanged", async () => {
    const provider = new ClaudeChatProvider(config, async (_configuration, input) => {
      if (!input.preparationReady) {
        // The JSON adapter stays unchanged: no preparation gate, no generation.
        expect(input.preparationRevision).toBeUndefined();
        return { text: '{"outcome":"reply","title":"Reply","body":"Synthetic"}', structuredOutput: null,
        sessionID: "synthetic", inputTokens: 20, outputTokens: 5, estimatedUsd: .01, turns: 2, toolCalls: 0,
        toolCompletions: [], reportedModels: [], terminalReason: "completed", permissionDenials: [] };
      }
      // Both production call sites supply the real host generation function.
      expect(input.preparationRevision).toBeTypeOf("function");
      expect(input.preparationRevision!()).toBe(0);
      expect(input.preparationReady()).toBe(false);
      await input.tools.find(tool => tool.name === "stage_calendar_draft")!.execute(calendarInput, new AbortController().signal);
      expect(input.preparationReady()).toBe(true);
      expect(input.preparationRevision!()).toBe(1);
      return { text: "", structuredOutput: null, sessionID: "synthetic", inputTokens: 20, outputTokens: 5, estimatedUsd: .01, turns: 2, toolCalls: 1,
        toolCompletions: [], reportedModels: [], terminalReason: "hook_stopped", permissionDenials: [] };
    });
    const answer = await provider.answer({ objective, calendarContext, context_blocks: [], allowed_citation_ids: [] });
    expect(answer.body.length).toBeGreaterThanOrEqual(ChatResponseBlockSchema.properties.body.minLength!);
    expect(answer).toMatchObject({ body: expect.stringContaining("No calendar event has been created"), calendarDraft: { status: "needs_review", external_effect: "none" } });
    const scopeSummary = { kind: "workspace_conversation" as const, workspaceID: id, sessionID: null, currentPersonID: null, currentRelationshipContextID: null };
    const output = await provider.run({ runID: id, objective, systemPrompt: "Synthetic", outputMode: "json", calendarContext,
      scopeSummary, toolManifest: [], budget: request().budget }, async () => ({ ok: true, callID: "unused", name: "unused" }), new AbortController().signal);
    expect(output.calendarDraft).toBeUndefined();
    expect(output.structuredOutput).toMatchObject({ body: "Synthetic" });
    const natural = await provider.run({ runID: id, objective, systemPrompt: "Synthetic", outputMode: "natural", calendarContext,
      scopeSummary, toolManifest: [], budget: request().budget }, async () => ({ ok: true, callID: "unused", name: "unused" }), new AbortController().signal);
    expect(natural.calendarDraft).toMatchObject({ status: "needs_review", external_effect: "none" });
  });

  it("executes actual pinned SDK through the production provider/harness against loopback synthetic SSE", async () => {
    let calls = 0; let directory = "";
    const server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      if (req.url?.includes("count_tokens")) { res.setHeader("content-type", "application/json"); res.end('{"input_tokens":20}'); return; }
      if (!req.url?.split("?")[0]?.endsWith("/messages")) { res.statusCode = 404; res.end("{}"); return; }
      const round = ++calls;
      const name = body.tools?.find((tool: any) => tool.name === "mcp__talent_signal__stage_calendar_draft")?.name;
      const blocks = round === 1 && name ? [{ type: "tool_use", id: "synthetic_tool_1", name, input: calendarInput }] : [{ type: "text", text: "Unexpected extra round" }];
      const stop = round === 1 && name ? "tool_use" : "end_turn";
      const message = { id: `synthetic_${round}`, type: "message", role: "assistant", model: body.model, content: blocks, stop_reason: stop, stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
      if (!body.stream) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(message)); return; }
      res.setHeader("content-type", "text/event-stream");
      const event = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      event("message_start", { message: { ...message, content: [], stop_reason: null, usage: { ...message.usage, output_tokens: 0 } } });
      for (const [index, block] of blocks.entries()) {
        event("content_block_start", { index, content_block: block.type === "tool_use" ? { ...block, input: {} } : { type: "text", text: "" } });
        event("content_block_delta", { index, delta: block.type === "tool_use" ? { type: "input_json_delta", partial_json: JSON.stringify(calendarInput) } : { type: "text_delta", text: "Unexpected extra round" } });
        event("content_block_stop", { index });
      }
      event("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } });
      event("message_stop", {}); res.end();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Synthetic server unavailable");
    // A test-owned configuration value, never a new admitted production endpoint.
    const local = { ...config, model: "claude-sonnet-4-6", baseUrl: `http://127.0.0.1:${address.port}`, taskBudgetEnabled: false };
    const realQuery: typeof query = input => { directory = input.options!.cwd!; return query(input); };
    const provider = new ClaudeChatProvider(local, (configuration, input, signal) => runClaudeHarness(configuration, input, signal, realQuery, null));
    try {
      const output = await provider.run({ runID: id, objective, systemPrompt: "Local synthetic calendar preparation only.", calendarContext,
        scopeSummary: { kind: "workspace_conversation", workspaceID: id, sessionID: null, currentPersonID: null, currentRelationshipContextID: null },
        toolManifest: [], budget: request().budget }, async () => { throw new Error("No other product tools admitted"); }, new AbortController().signal);
      expect(calls).toBe(1);
      expect(output).toMatchObject({ terminalReason: "hook_stopped", turns: 2, inputTokens: 20, outputTokens: 5,
        calendarDraft: { status: "needs_review", external_effect: "none", source_request_id: id, source_excerpt: objective } });
      expect(output.toolCompletions?.map(tool => tool.name)).toEqual(["stage_calendar_draft"]);
      expect(output.structuredOutput).toMatchObject({ body: expect.stringContaining("No calendar event has been created") });
      expect((output.structuredOutput as { body: string }).body.length).toBeGreaterThanOrEqual(ChatResponseBlockSchema.properties.body.minLength!);
      await expect(access(directory)).rejects.toThrow();
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 45_000);
});
