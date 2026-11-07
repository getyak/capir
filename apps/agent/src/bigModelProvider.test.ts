import { describe, expect, it, vi } from "vitest";

import { BigModelAgentProvider } from "./bigModelProvider.js";
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

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function provider(fetcher: typeof fetch) {
  return new BigModelAgentProvider({
    apiKey: "test-key",
    model: "glm-5.3",
    reasoningEffort: "low",
    inputCnyPerMillion: 8,
    outputCnyPerMillion: 28,
    cnyPerUsd: 7,
    fetcher,
  });
}

describe("BigModelAgentProvider", () => {

  it("rejects unsupported explicit reasoning before any provider request", () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => new BigModelAgentProvider({ apiKey: "synthetic", model: "glm-4.6v-flash", inputCnyPerMillion: 8, outputCnyPerMillion: 28, cnyPerUsd: 7,
      reasoningEffort: "high", fetcher })).toThrow();
    expect(() => new BigModelAgentProvider({ apiKey: "synthetic", model: "glm-5.3", inputCnyPerMillion: 8, outputCnyPerMillion: 28, cnyPerUsd: 7,
      reasoningEffort: "invalid" as "low", fetcher })).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([undefined, "low", "high", "max"] as const)("preserves host reasoning intent %s in the actual request body", async effort => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({
      model: "glm-5.3", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "{}" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.000001 },
    }));
    const configured = new BigModelAgentProvider({ apiKey: "synthetic-test-key", model: "glm-5.3", inputCnyPerMillion: 8, outputCnyPerMillion: 28, cnyPerUsd: 7,
      ...(effort === undefined ? {} : { reasoningEffort: effort }), fetcher });
    await configured.run(request(), vi.fn(), new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    if (effort === undefined) expect(Object.hasOwn(body, "reasoning_effort")).toBe(false);
    else expect(body.reasoning_effort).toBe(effort);
  });

  it("uses the official multimodal content shape for a pinned vision model", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        model: "glm-4.6v-flash",
        choices: [{ message: { content: "{}" } }],
      }),
    );
    const visionProvider = new BigModelAgentProvider({
      apiKey: "test-key",
      model: "glm-4.6v-flash",
      inputCnyPerMillion: 1,
      outputCnyPerMillion: 1,
      cnyPerUsd: 7,
      fetcher,
    });

    await visionProvider.run(
      {
        ...request(),
        inputParts: [
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
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,AQID" },
        },
      ]),
    );
    expect(visionProvider.inputCapabilities.imageUnderstanding).toBe(true);
  });

  it("preserves reasoning across tools and returns bounded cost", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          id: "request-1",
          model: "glm-5.3",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                reasoning_content: "Synthetic reasoning",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "read_pursuit",
                      arguments: "{}",
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10_000, completion_tokens: 1_000 },
        }),
      )
      .mockResolvedValueOnce(
        response({
          id: "request-2",
          model: "glm-5.3",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  outcome: "no_action",
                  reason_code: "NO_MATERIAL_CHANGE",
                  reason: "No safe change.",
                  missing_evidence_refs: [],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 12_000, completion_tokens: 500 },
        }),
      );
    const invokeTool = vi.fn(async (name: string) => ({
      ok: true,
      callID: "result-1",
      name,
      data: { pursuitID: "synthetic" },
    }));

    const result = await provider(fetcher).run(
      request(),
      invokeTool,
      new AbortController().signal,
    );

    expect(result.structuredOutput).toEqual({
      outcome: "no_action",
      reason_code: "NO_MATERIAL_CHANGE",
      reason: "No safe change.",
      missing_evidence_refs: [],
    });
    expect(result.estimatedUsd).toBeCloseTo(0.031142857, 8);
    const secondBody = JSON.parse(
      String(fetcher.mock.calls[1]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(JSON.stringify(secondBody)).toContain("Synthetic reasoning");
    expect(secondBody).toHaveProperty("tools");
    expect(secondBody.tool_choice).toBe("auto");
    expect(secondBody).toMatchObject({
      model: "glm-5.3",
      thinking: { type: "enabled" },
      reasoning_effort: "low",
    });
  });

  it("fails closed for an unofficial host, dynamic model, or provider error", async () => {
    expect(
      () =>
        new BigModelAgentProvider({
          apiKey: "test-key",
          model: "glm-latest",
          inputCnyPerMillion: 8,
          outputCnyPerMillion: 28,
          cnyPerUsd: 7,
        }),
    ).toThrow("pinned GLM model");
    expect(
      () =>
        new BigModelAgentProvider({
          apiKey: "test-key",
          model: "glm-5.3",
          baseUrl: "https://example.com/api/paas/v4",
          inputCnyPerMillion: 8,
          outputCnyPerMillion: 28,
          cnyPerUsd: 7,
        }),
    ).toThrow("official v4");

    const error = await provider(
      vi.fn<typeof fetch>().mockResolvedValue(
        response({ private: "evidence" }, 429),
      ),
    )
      .run(request(), vi.fn(), new AbortController().signal)
      .catch((caught: unknown) => caught);
    expect(String(error)).toContain("429");
    expect(String(error)).not.toContain("evidence");
  });
});
