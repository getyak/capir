import { describe, expect, it, vi } from "vitest";

import { OpenRouterAgentProvider } from "./openRouterProvider.js";
import { AGENT_TOOL_NAMES, type AgentProviderRequest } from "./types.js";

const fingerprint = "a".repeat(64);

function request(): AgentProviderRequest {
  return {
    runID: "10000000-0000-4000-8000-000000000099",
    objective: "Determine the smallest safe next step from synthetic evidence.",
    systemPrompt: "Never confirm state or create an external effect.",
    scopeSummary: {
      kind: "pursuit",
      workspaceID: "10000000-0000-4000-8000-000000000001",
      pursuitID: "10000000-0000-4000-8000-000000000002",
      pursuitRevision: 1,
      evidenceRefs: ["10000000-0000-4000-8000-000000000003"],
    },
    toolManifest: AGENT_TOOL_NAMES,
    budget: {
      maxTurns: 6,
      maxToolCalls: 12,
      maxDurationMs: 60_000,
      maxTaskTokens: 32_000,
      maxEstimatedUsd: 1,
    },
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OpenRouterAgentProvider", () => {
  it("sends governed text and base64 images as one multimodal user message", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        model: "openai/gpt-4.1-mini",
        choices: [{ message: { role: "assistant", content: "{}" } }],
      }),
    );
    const provider = new OpenRouterAgentProvider({
      apiKey: "test-key",
      model: "openai/gpt-4.1-mini",
      imageInputEnabled: true,
      fetcher,
    });

    await provider.run(
      {
        ...request(),
        inputParts: [
          {
            artifactID: "10000000-0000-4000-8000-000000000010",
            kind: "text",
            mimeType: "text/plain; charset=utf-8",
            byteSize: 9,
            contentHash: "b".repeat(64),
            text: "synthetic",
          },
          {
            artifactID: "10000000-0000-4000-8000-000000000011",
            kind: "image",
            mimeType: "image/png",
            byteSize: 3,
            contentHash: "c".repeat(64),
            dataBase64: "AQID",
          },
        ],
      },
      vi.fn(),
      new AbortController().signal,
    );

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(body.messages[1]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,AQID" },
        },
      ]),
    );
  });

  it("runs sequential governed tools and returns the exact terminal output", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          id: "generation-1",
          model: "cohere/north-mini-code:free",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: { name: "read_pursuit", arguments: "{}" },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 3, cost: 0 },
        }),
      )
      .mockResolvedValueOnce(
        response({
          id: "generation-2",
          model: "cohere/north-mini-code:free",
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  outcome: "no_action",
                  reason_code: "NO_MATERIAL_CHANGE",
                  reason: "The evidence supports no safe change.",
                  missing_evidence_refs: [],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 19, completion_tokens: 9, cost: 0 },
        }),
      );
    const provider = new OpenRouterAgentProvider({
      apiKey: "test-key",
      model: "cohere/north-mini-code:free",
      fetcher,
    });
    const invokeTool = vi.fn(async (name: string) => ({
      ok: true,
      callID: `result-${name}`,
      name,
      data: { pursuitID: "synthetic" },
    }));

    const result = await provider.run(
      request(),
      invokeTool,
      new AbortController().signal,
    );

    expect(invokeTool.mock.calls.map(([name]) => name)).toEqual(["read_pursuit"]);
    expect(result.structuredOutput).toEqual({
      outcome: "no_action",
      reason_code: "NO_MATERIAL_CHANGE",
      reason: "The evidence supports no safe change.",
      missing_evidence_refs: [],
    });
    expect(result).toMatchObject({
      inputTokens: 30,
      outputTokens: 12,
      estimatedUsd: 0,
      turns: 2,
      sessionID: "generation-2",
      terminalReason: "provider_stopped",
    });
    const finalBody = JSON.parse(
      String(fetcher.mock.calls[1]?.[1]?.body),
    ) as { tool_choice: string; parallel_tool_calls: boolean };
    expect(finalBody.tool_choice).toBe("auto");
    expect(finalBody.parallel_tool_calls).toBe(false);
  });

  it("passes malformed arguments to the governed validator without persisting them", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        model: "cohere/north-mini-code:free",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-invalid",
                  type: "function",
                  function: {
                    name: "read_evidence",
                    arguments: "{not-json",
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13, cost: 0 },
      }),
    );
    const provider = new OpenRouterAgentProvider({
      apiKey: "test-key",
      model: "cohere/north-mini-code:free",
      fetcher,
    });
    const invokeTool = vi.fn(async (name: string) => ({
      ok: false,
      callID: "denied",
      name,
      error: { code: "TOOL_INPUT_INVALID", message: "Invalid input." },
    }));
    const constrained = request();
    constrained.budget.maxTurns = 1;

    const result = await provider.run(
      constrained,
      invokeTool,
      new AbortController().signal,
    );

    expect(invokeTool).toHaveBeenCalledWith("read_evidence", "{not-json");
    expect(result.permissionDenials).toEqual([
      "read_evidence:TOOL_INPUT_INVALID",
    ]);
    expect(result.terminalReason).toBe("max_turns");
  });

  it("fails closed when the provider changes the pinned model", async () => {
    const provider = new OpenRouterAgentProvider({
      apiKey: "test-key",
      model: "cohere/north-mini-code:free",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        response({
          model: "openrouter/another-model",
          choices: [{ message: { role: "assistant", content: "{}" } }],
        }),
      ),
    });

    await expect(
      provider.run(request(), vi.fn(), new AbortController().signal),
    ).rejects.toThrow("different from the immutable configured model");
  });

  it("reports provider failures without exposing the credential or response body", async () => {
    const provider = new OpenRouterAgentProvider({
      apiKey: "secret-must-not-appear",
      model: "cohere/north-mini-code:free",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        response(
          {
            error: {
              code: 429,
              message: "echo secret-must-not-appear and private evidence",
            },
          },
          429,
        ),
      ),
    });

    const error = await provider
      .run(request(), vi.fn(), new AbortController().signal)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("429");
    expect(String(error)).not.toContain("secret-must-not-appear");
    expect(String(error)).not.toContain("private evidence");
  });

  it("rejects a dynamic free router and non-HTTPS remote base URL", () => {
    expect(
      () =>
        new OpenRouterAgentProvider({
          apiKey: "test-key",
          model: "openrouter/free",
        }),
    ).toThrow("not a pinned model");
    expect(
      () =>
        new OpenRouterAgentProvider({
          apiKey: "test-key",
          model: "cohere/north-mini-code:free",
          baseUrl: "http://openrouter.example/api/v1",
        }),
    ).toThrow("must use HTTPS");
  });

  it("uses low reasoning and privacy-constrained routing for GLM-5.3", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        model: "z-ai/glm-5.3",
        choices: [{ message: { role: "assistant", content: "{}" } }],
        usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.001 },
      }),
    );
    const provider = new OpenRouterAgentProvider({
      apiKey: "test-key",
      model: "z-ai/glm-5.3",
      providerOrder: ["z-ai"],
      fetcher,
    });

    await provider.run(request(), vi.fn(), new AbortController().signal);

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      reasoning_effort: string;
      provider: Record<string, unknown>;
    };
    expect(body.reasoning_effort).toBe("low");
    expect(body.provider).toEqual({
      allow_fallbacks: true,
      data_collection: "deny",
      require_parameters: true,
      zdr: true,
      order: ["z-ai"],
    });
  });
});
