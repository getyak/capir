import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  createSdkMcpServer: vi.fn((options: unknown) => options),
  query: vi.fn(),
  tool: vi.fn(
    (
      name: string,
      description: string,
      schema: unknown,
      handler: unknown,
      options: unknown,
    ) => ({ name, description, schema, handler, options }),
  ),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => sdk);

import { ClaudeAgentSDKProvider } from "./claudeProvider.js";
import type { ClaudeHarnessRequest } from "./claudeHarness.js";

const request = {
  runID: "synthetic-run",
  objective: "Record a synthetic review-only result.",
  systemPrompt: "Use only the immutable tool manifest.",
  scopeSummary: {
    kind: "pursuit" as const,
    workspaceID: "synthetic-workspace",
    pursuitID: "synthetic-pursuit",
    pursuitRevision: 1,
    evidenceRefs: ["synthetic-evidence"],
  },
  toolManifest: [
    "read_pursuit",
    "read_evidence",
    "stage_pursuit_proposal",
  ] as const,
  budget: {
    maxTurns: 6,
    maxToolCalls: 12,
    maxDurationMs: 60_000,
    maxTaskTokens: 32_000,
    maxEstimatedUsd: 1,
  },
};

function sdkResult() {
  return {
    type: "result",
    subtype: "success",
    structured_output: {
      outcome: "no_action",
      reason_code: "NO_MATERIAL_CHANGE",
      reason: "Synthetic evidence supports no canonical change.",
      missing_evidence_refs: [],
    },
    modelUsage: {
      synthetic: {
        inputTokens: 10,
        outputTokens: 3,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    },
    total_cost_usd: 0,
    num_turns: 1,
    permission_denials: [],
    session_id: "synthetic-session",
  };
}

function stream(
  beforeResult?: (queryInput: any) => Promise<void>,
  queryInput?: any,
) {
  return {
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {
      if (beforeResult && queryInput) await beforeResult(queryInput);
      yield sdkResult();
    },
  };
}

describe("ClaudeAgentSDKProvider", () => {
  it("uses the person research output schema and preserves its exact staged fingerprint", async () => {
    const fingerprint="a".repeat(64);
    const execute=vi.fn(async (_configuration, input:ClaudeHarnessRequest, signal:AbortSignal) => {
      expect(JSON.stringify(input.outputSchema)).toContain("person_research_artifact");
      const tool=input.tools.find(entry=>entry.name==="create_person_research_artifact")!;
      await tool.execute({},signal);
      return {text:"",structuredOutput:{outcome:"no_action"},sessionID:"synthetic",inputTokens:10,outputTokens:3,
        estimatedUsd:0,turns:1,toolCalls:1,toolCompletions:[],terminalReason:"completed",permissionDenials:[],reportedModels:["synthetic"]};
    });
    const provider=new ClaudeAgentSDKProvider("claude-synthetic-pinned",execute);
    const result=await provider.run({...request,scopeSummary:{kind:"person_public_profile_research",providerID:"synthetic",
      authorization:{purpose:"person_public_profile_research",accessMode:"visible_screenshot_identity_clues",allowedPlatforms:["threads"],maximumProviderCalls:4,maximumResultsPerCall:3},inputArtifactIDs:["synthetic-image"]},
      toolManifest:["create_person_research_artifact"]},async name=>({ok:true,name,callID:"synthetic",candidateFingerprint:fingerprint,data:{}}),new AbortController().signal);
    expect(result.structuredOutput).toEqual({outcome:"person_research_artifact",candidate_fingerprint:fingerprint});
  });

  it("reports the exact SDK version pinned by the agent package", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(new ClaudeAgentSDKProvider("claude-synthetic-pinned").sdkVersion).toBe(
      manifest.dependencies["@anthropic-ai/claude-agent-sdk"],
    );
  });

  beforeEach(() => {
    sdk.query.mockReset();
    vi.stubEnv("HAO_ANTHROPIC_API_KEY", "synthetic-hao");
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-official");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://api.hao.ai/anthropic");
    vi.stubEnv("TALENT_SIGNAL_CLAUDE_TASK_BUDGET_ENABLED", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("admits original image bytes only through the explicit vision capability", async () => {
    const data = Buffer.from("synthetic-image-byte-fixture");
    const part = { kind: "image" as const, artifactID: "synthetic-image", mimeType: "image/png",
      byteSize: data.length, contentHash: createHash("sha256").update(data).digest("hex"), dataBase64: data.toString("base64") };
    const imageRequest = { ...request, inputParts: [part] };
    await expect(new ClaudeAgentSDKProvider("claude-synthetic-pinned").run(imageRequest,
      async (name) => ({ callID: "synthetic-unused", name, ok: true, data: {} }), new AbortController().signal)).rejects.toThrow("IMAGE_NOT_ADMITTED");
    sdk.query.mockImplementation((input: any) => stream(async () => {
      const message = (await input.prompt.next()).value;
      expect(message.message.content).toContainEqual({ type: "image", source: {
        type: "base64", media_type: "image/png", data: part.dataBase64,
      } });
    }, input));
    await new ClaudeAgentSDKProvider("claude-synthetic-pinned", undefined, undefined, true).run(imageRequest,
      async (name) => ({ callID: "synthetic-unused", name, ok: true, data: {} }), new AbortController().signal);
  });

  it("captures configuration before ambient environment changes", async () => {
    const provider = new ClaudeAgentSDKProvider("claude-synthetic-pinned");
    vi.stubEnv("HAO_ANTHROPIC_API_KEY", "changed-credential");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://unadmitted.invalid");
    sdk.query.mockImplementation((queryInput: any) => {
      expect(queryInput.options.env.ANTHROPIC_BASE_URL).toBe("https://api.hao.ai/anthropic");
      expect(queryInput.options.env.ANTHROPIC_API_KEY).toBe("synthetic-hao");
      return stream();
    });
    await provider.run(request, async (name) => ({ callID: "synthetic-unused", name, ok: true, data: {} }), new AbortController().signal);
  });

  it("gates every tool in PreToolUse and omits unsupported proxy task budgets", async () => {
    sdk.query.mockImplementation((queryInput: any) =>
      stream(async (input) => {
        const gate = input.options.hooks.PreToolUse[0].hooks[0];
        const allowed = await gate(
          {
            hook_event_name: "PreToolUse",
            tool_name: "mcp__talent_signal__read_evidence",
            tool_input: { evidence_refs: ["10000000-0000-4000-8000-000000000001"] },
            tool_use_id: "allowed",
          },
          "allowed",
          { signal: new AbortController().signal },
        );
        expect(allowed.hookSpecificOutput.permissionDecision).toBe("allow");

        const denied = await gate(
          {
            hook_event_name: "PreToolUse",
            tool_name: "Bash",
            tool_input: { command: "printenv" },
            tool_use_id: "denied",
          },
          "denied",
          { signal: new AbortController().signal },
        );
        expect(denied.hookSpecificOutput.permissionDecision).toBe("deny");

      }, queryInput),
    );

    const provider = new ClaudeAgentSDKProvider("claude-synthetic-pinned");
    const invokeTool = vi.fn(async (name: string) => ({
      ok: true,
      callID: "synthetic-call",
      name,
      data: { synthetic: true },
    }));
    const result = await provider.run(
      request,
      invokeTool,
      new AbortController().signal,
    );
    const options = sdk.query.mock.calls[0]![0].options;

    expect(options.canUseTool).toBeUndefined();
    expect(options.outputFormat).toMatchObject({ type: "json_schema" });
    expect(options.taskBudget).toBeUndefined();
    expect(options.allowedTools).toEqual(expect.arrayContaining([
      "mcp__talent_signal__read_pursuit",
      "mcp__talent_signal__read_evidence",
      "mcp__talent_signal__stage_pursuit_proposal",
    ]));
    expect(result.structuredOutput).toEqual({
      outcome: "no_action",
      reason_code: "NO_MATERIAL_CHANGE",
      reason: "Synthetic evidence supports no canonical change.",
      missing_evidence_refs: [],
    });
    expect(result.permissionDenials).toContain("TOOL_NOT_AUTHORIZED");
  });

  it("keeps the SDK task budget for the official Anthropic endpoint", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://api.anthropic.com");
    sdk.query.mockImplementation((queryInput: any) => stream(undefined, queryInput));

    const provider = new ClaudeAgentSDKProvider("claude-synthetic-pinned");
    await provider.run(request, vi.fn(), new AbortController().signal);

    expect(sdk.query.mock.calls[0]![0].options.taskBudget).toEqual({
      total: 32_000,
    });
  });

  it("allows an explicitly compatible custom endpoint to opt in", async () => {
    vi.stubEnv("TALENT_SIGNAL_CLAUDE_TASK_BUDGET_ENABLED", "true");
    sdk.query.mockImplementation((queryInput: any) => stream(undefined, queryInput));

    const provider = new ClaudeAgentSDKProvider("claude-synthetic-pinned");
    await provider.run(request, vi.fn(), new AbortController().signal);

    expect(sdk.query.mock.calls[0]![0].options.taskBudget).toEqual({
      total: 32_000,
    });
  });
});
