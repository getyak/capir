import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { resolveProductPrompt, ScriptedAgentProvider, type AgentProvider } from "@talent-signal/agent";
import { workspaceConversationTimeoutMs } from "./workspaceConversationBudget.js";
import { executeWorkspaceConversationAgentCore } from "./workspaceConversationAgent.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("workspace conversation deadline", () => {
  it("admits a bounded configurable deadline without changing legacy adapters", () => {
    expect(workspaceConversationTimeoutMs("claude-agent-sdk", "")).toBe(1_800_000);
    expect(workspaceConversationTimeoutMs("claude-agent-sdk", "1800000")).toBe(1_800_000);
    expect(workspaceConversationTimeoutMs("claude-agent-sdk", "240000")).toBe(240_000);
    expect(workspaceConversationTimeoutMs("legacy", "240000")).toBe(35_000);
    for (const value of ["0", "Infinity", "1800001", "29999", "120000.5", "bad"]) {
      expect(() => workspaceConversationTimeoutMs("claude-agent-sdk", value)).toThrow("CONVERSATION_TIMEOUT_CONFIGURATION_INVALID");
    }
  });

  it("keeps a default run alive beyond three minutes and stops at thirty minutes", async () => {
    vi.stubEnv("TALENT_SIGNAL_CONVERSATION_TIMEOUT_MS", "");
    const promptSnapshot = await resolveProductPrompt("assistant/workspace");
    vi.useFakeTimers();
    let enter!: () => void;
    const started = new Promise<void>(resolve => { enter = resolve; });
    let settled = false;
    const run: AgentProvider["run"] = async (_request, _tool, signal) => {
      enter();
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      throw new Error("Unexpected completion");
    };
    const outcome = executeWorkspaceConversationAgentCore({ workspaceID: "test", objective: "hello", promptSnapshot,
      provider: { ...new ScriptedAgentProvider([], {}), id: "claude-agent-sdk", run },
      contacts: { search: async () => [], read: vi.fn() },
    }).then(() => null, error => error).finally(() => { settled = true; });
    await started;
    await vi.advanceTimersByTimeAsync(180_001);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_619_999);
    expect((await outcome)?.message).toBe("WORKSPACE_CONVERSATION_TIMEOUT");
  });

  it.each(["complete", "deadline", "cancel", "late"] as const)("handles %s under one cancellable run", async mode => {
    vi.stubEnv("TALENT_SIGNAL_CONVERSATION_TIMEOUT_MS", "180000");
    const promptSnapshot = await resolveProductPrompt("assistant/workspace");
    vi.useFakeTimers();
    const external = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const run: AgentProvider["run"] = async (_request, _tool, signal) => {
      entered();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, mode === "complete" ? 65_000 : 250_000);
        if (mode !== "late") signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
      return { structuredOutput: { outcome: "reply", title: "Ready", body: "Ready" }, inputTokens: 0,
        outputTokens: 0, estimatedUsd: 0, turns: 1, permissionDenials: [] };
    };
    const provider = { ...new ScriptedAgentProvider([], {}), id: "claude-agent-sdk", run };
    const outcome = executeWorkspaceConversationAgentCore({ workspaceID: "test", objective: "hello", promptSnapshot,
      provider, contacts: { search: async () => [], read: async () => { throw new Error("Unexpected contact read"); } }, signal: external.signal,
    }).then(value => ({ value, error: null }), error => ({ value: null, error }));
    await started;
    await vi.advanceTimersByTimeAsync(60_001);
    if (mode === "complete") {
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await outcome).value?.block).toMatchObject({ body: "Ready" });
    } else if (mode === "deadline") {
      await vi.advanceTimersByTimeAsync(120_000);
      expect((await outcome).error?.message).toBe("WORKSPACE_CONVERSATION_TIMEOUT");
    } else if (mode === "late") {
      await vi.advanceTimersByTimeAsync(190_000);
      expect((await outcome).error?.message).toBe("WORKSPACE_CONVERSATION_TIMEOUT");
    } else {
      external.abort(new Error("USER_CANCELLED"));
      expect((await outcome).error?.message).toBe("USER_CANCELLED");
    }
  });

  it("charges image inspection and the model against the same absolute deadline", async () => {
    vi.stubEnv("TALENT_SIGNAL_CONVERSATION_TIMEOUT_MS", "180000");
    const promptSnapshot = await resolveProductPrompt("assistant/workspace");
    vi.useFakeTimers();
    const begun = Date.now();
    const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
    let inspecting!: () => void;
    const started = new Promise<void>(resolve => { inspecting = resolve; });
    const run = vi.fn<AgentProvider["run"]>(async (_request, _tool, signal) => {
      expect(Date.now() - begun).toBe(40_000);
      await wait(150_000, signal);
      throw new Error("A second full deadline must not be granted after inspection");
    });
    const bytes = Buffer.from("synthetic admitted image");
    const result = executeWorkspaceConversationAgentCore({ workspaceID: "test", objective: "inspect", promptSnapshot,
      provider: { ...new ScriptedAgentProvider([], {}), id: "claude-agent-sdk", run },
      contacts: { search: async () => [], read: async () => { throw new Error("Unexpected read"); } },
      memory: { recall: async () => ({ items: [] }), stage: async () => null },
      imageIsCurrent: async () => true,
      imageInspector: { inspect: async (_image, signal) => {
        inspecting(); await wait(40_000, signal);
        return { description: "Synthetic", visible_text: [], uncertainties: [], model: "synthetic", request_id: "synthetic" };
      } },
      inputParts: [{ kind: "image", artifactID: "conversation-image-11111111-1111-4111-8111-111111111111-0-test",
        mimeType: "image/png", byteSize: bytes.length, contentHash: createHash("sha256").update(bytes).digest("hex"),
        dataBase64: bytes.toString("base64") }],
    }).then(() => null, error => error);
    await started;
    await vi.advanceTimersByTimeAsync(180_000);
    expect((await result)?.message).toBe("WORKSPACE_CONVERSATION_TIMEOUT");
    expect(run).toHaveBeenCalledOnce();
    expect(Date.now() - begun).toBe(180_000);
  });
});
