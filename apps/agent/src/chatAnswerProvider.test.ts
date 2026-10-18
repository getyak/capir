import { describe, expect, it, vi } from "vitest";
import {
  DeepSeekRelationshipTextProvider,
  ZhipuChatAnswerProvider,
  createEnvironmentChatAnswerProvider,
  type RemoteChatAnswerProviding,
  type RemoteChatAnswerRequest,
  type RemoteChatAnswerResult,
} from "./chatAnswerProvider.js";
import { ClaudeChatProvider } from "./claudeChatProvider.js";
import { parseChatAnswerTextTask, serializeChatAnswerTextTask } from "./chatAnswerTextTask.js";
import type { AgentToolResult } from "./types.js";
import { bundledPrompt } from "./promptRegistry.js";

async function runQuestion(objective: string) {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({
    model: "glm-5.3",
    choices: [{ message: { content: JSON.stringify({ outcome: "reply", title: "Reply", body: "No contact selected." }) } }],
  }));
  const invokeTool = vi.fn(async (): Promise<AgentToolResult> => ({
    ok: true, callID: "synthetic-search", name: "contact_workspace", data: { operation: "search", results: [] },
  }));
  const provider = new ZhipuChatAnswerProvider({ apiKey: "synthetic-only", model: "glm-5.3", observer: null, fetcher });
  const result = await provider.run({
    runID: "synthetic-named-clue", objective, systemPrompt: "Stay within the current scope.",
    scopeSummary: { kind: "workspace_conversation", workspaceID: "synthetic-workspace", sessionID: null,
      currentPersonID: null, currentRelationshipContextID: null },
    toolManifest: ["contact_workspace"],
    budget: { maxTurns: 1, maxToolCalls: 1, maxDurationMs: 10000, maxTaskTokens: 4000, maxEstimatedUsd: 1 },
  }, invokeTool, new AbortController().signal);
  return { result, invokeTool, fetcher };
}

describe("named relationship question preflight", () => {
  it.each([
    ["What changed with Maya?", "Maya"],
    [" \tWHAT\thas  changed\twith  Leila Noor! \t", "Leila Noor"],
    ["What do we know about Jean-Luc?", "Jean-Luc"],
    ["What changed with 玛雅？", "玛雅？"],
    ["Leila 有什么变化？", "Leila"],
    [" 玛雅发生了什么变化！ ", "玛雅"],
    ["陈明现在怎么样", "陈明"],
    ["陈明  目前怎么样。", "陈明"],
    [`What changed with ${"a".repeat(200)}?`, "a".repeat(200)],
  ])("extracts one exact clue from %s", async (objective, clue) => {
    const { result, invokeTool, fetcher } = await runQuestion(objective);
    expect(invokeTool).toHaveBeenCalledExactlyOnceWith("contact_workspace", { operation: "search", query: clue, maximum_results: 4 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.structuredOutput).toMatchObject({ outcome: "clarification" });
  });

  it.each([
    "What changed with *?", "What changed with Maya%?", "所有人有什么变化？", "What changed with all contacts?",
    "What changed with them?", "What changed with a?", "What changed with Leila\nNoor?",
    "What changed without Maya?", "Something changed with Maya?", `What changed with ${"a".repeat(201)}?`,
  ])("does not authorize a shortcut search for %s", async (objective) => {
    const { result, invokeTool, fetcher } = await runQuestion(objective);
    expect(invokeTool).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.structuredOutput).toMatchObject({ outcome: "reply" });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).messages[1].content).toContain(objective.replaceAll("\n", "\\n"));
  });

  it("bounds the shortcut on adversarial whitespace without truncating it into a contact clue", async () => {
    for (const objective of [
      `what\tchanged\twith\t${"\t".repeat(250_000)}a`,
      `what\tdo\twe\tknow\tabout\ta${"\t".repeat(250_000)}x`,
      `a有什么变化${"\t".repeat(250_000)}x`,
    ]) {
      const { invokeTool, fetcher } = await runQuestion(objective);
      expect(invokeTool).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledOnce();
      const sent = JSON.parse(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).messages[1].content);
      expect(sent.objective).toBe(objective);
    }
  });
});

describe("structured Session title transport", () => {
  it.each(["", "x".repeat(257), null, 42])("keeps a valid answer when optional title metadata is invalid", async title => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      model: "glm-5.3",
      choices: [{ message: { content: JSON.stringify({ kind: "answer", title: "Reply", body: "Visible reply", citation_ids: [], session_title: title }) } }],
    }));
    const result = await new ZhipuChatAnswerProvider({ apiKey: "synthetic-only", model: "glm-5.3", observer: null, fetcher }).answer({
      objective: "Summarize the conversation", mode: "unscoped_conversation", session_title_requested: true,
      prompt_snapshot: bundledPrompt("assistant/conversation"), context_blocks: [], allowed_citation_ids: [],
    });
    expect(result.body).toBe("Visible reply");
    expect(result.session_title).toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("accepts 32 compound graphemes within the 256-code-point cap", async () => {
    const title = "👩‍👩‍👧‍👦".repeat(32);
    expect(Array.from(title)).toHaveLength(224);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      model: "glm-5.3",
      choices: [{ message: { content: JSON.stringify({
        kind: "answer",
        title: "Reply",
        session_title: title,
        body: "Visible reply",
        citation_ids: [],
      }) } }],
    }));
    const provider = new ZhipuChatAnswerProvider({
      apiKey: "synthetic-only",
      model: "glm-5.3",
      observer: null,
      fetcher,
    });
    const result = await provider.answer({
      objective: "Summarize the conversation",
      mode: "unscoped_conversation",
      session_title_requested: true,
      prompt_snapshot: bundledPrompt("assistant/conversation"),
      context_blocks: [],
      allowed_citation_ids: [],
    });
    expect(result.session_title).toBe(title);
    expect(result.title).toBe("Reply");
  });
});

describe("inline user message images in unscoped conversation", () => {
  const data = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  function visionFetcher() {
    return vi.fn<typeof fetch>(async () => Response.json({
      id: "vision-1",
      model: "glm-5.3-flash",
      choices: [{ message: { content: JSON.stringify({ kind: "answer", title: "Reply", body: "I can see the image.", citation_ids: [] }) } }],
    }));
  }

  it("sends unscoped user images through the vision model without relationship context", async () => {
    const fetcher = visionFetcher();
    const result = await new ZhipuChatAnswerProvider({
      apiKey: "synthetic-only", model: "glm-5.3", visionModel: "glm-5.3-flash", observer: null, fetcher,
    }).answer({
      objective: "What is in this picture?", mode: "unscoped_conversation",
      prompt_snapshot: bundledPrompt("assistant/conversation"),
      context_blocks: [], allowed_citation_ids: [],
      images: [{ file_name: "shot.png", media_type: "image/png", data }],
    });
    expect(result.body).toBe("I can see the image.");
    expect(result.model).toBe("glm-5.3-flash");
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe("glm-5.3-flash");
    expect(JSON.stringify(body.messages[1].content)).toContain("data:image/png;base64,");
    expect(JSON.stringify(body.messages[1].content)).toContain("What is in this picture?");
  });

  it("still rejects relationship context on an unscoped request", async () => {
    await expect(new ZhipuChatAnswerProvider({
      apiKey: "synthetic-only", model: "glm-5.3", visionModel: "glm-5.3-flash", observer: null, fetcher: visionFetcher(),
    }).answer({
      objective: "Unsafe", mode: "unscoped_conversation",
      prompt_snapshot: bundledPrompt("assistant/conversation"),
      context_blocks: [{ block_id: "x", block_key: "x", type: "identity_context", status: "confirmed", headline: "x", summary: "x", items: [], evidence_fragment_ids: [] }],
      allowed_citation_ids: [],
      images: [{ file_name: "shot.png", media_type: "image/png", data }],
    })).rejects.toThrow("cannot receive relationship context");
  });

  it("passes agent inputParts images to the vision model in an unscoped run", async () => {
    const fetcher = visionFetcher();
    const provider = new ZhipuChatAnswerProvider({ apiKey: "synthetic-only", model: "glm-5.3", visionModel: "glm-5.3-flash", observer: null, fetcher });
    const result = await provider.run({
      runID: "synthetic-images", objective: "", systemPrompt: "Stay in scope.",
      scopeSummary: { kind: "workspace_conversation", workspaceID: "w", sessionID: "s", currentPersonID: null, currentRelationshipContextID: null },
      toolManifest: [], budget: { maxTurns: 1, maxToolCalls: 1, maxDurationMs: 10_000, maxTaskTokens: 4_000, maxEstimatedUsd: 1 },
      inputParts: [{ kind: "image", artifactID: "conversation-image-1", mimeType: "image/png", byteSize: data.length,
        contentHash: "0".repeat(64), dataBase64: Buffer.from(data).toString("base64") }],
    }, async () => ({ ok: true, callID: "noop", name: "noop" }), new AbortController().signal);
    expect(result.turns).toBe(1);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe("glm-5.3-flash");
    expect(JSON.stringify(body.messages[1].content)).toContain("conversation-image-1");
  });
});

describe("observation redaction for inline images", () => {
  const data = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  const dataURL = `data:image/png;base64,${Buffer.from(data).toString("base64")}`;
  function capturingObserver(captured: unknown[]) {
    return {
      addCredential: () => {},
      start: (_context: unknown, input: unknown) => {
        captured.push(input);
        return {
          step: async (_name: string, _kind: string, input2: unknown, execute: () => Promise<unknown>) => {
            captured.push(input2);
            return execute();
          },
        };
      },
      complete: async () => {},
    };
  }
  function visionFetcher(response: () => Response) {
    return vi.fn<typeof fetch>(async () => response());
  }
  const observation = { run_id: "run", workspace_id: "w", authorization_scope: "workspace_conversation" };

  it("keeps original bytes out of answer-mode observations while the fetch receives them", async () => {
    const captured: unknown[] = [];
    const fetcher = visionFetcher(() => Response.json({ id: "v", model: "glm-5.3-flash",
      choices: [{ message: { content: JSON.stringify({ kind: "answer", title: "Reply", body: "ok", citation_ids: [] }) } }] }));
    await new ZhipuChatAnswerProvider({ apiKey: "synthetic-only", model: "glm-5.3", visionModel: "glm-5.3-flash",
      observer: capturingObserver(captured) as never, fetcher }).answer({
      objective: "look", mode: "unscoped_conversation", observation,
      prompt_snapshot: bundledPrompt("assistant/conversation"), context_blocks: [], allowed_citation_ids: [],
      images: [{ file_name: "shot.png", media_type: "image/png", data }],
    });
    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain(Buffer.from(data).toString("base64"));
    expect(serialized).not.toContain("data:image/png;base64");
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).toContain(dataURL);
  });

  it("redacts answer-mode observations on the provider error path", async () => {
    const captured: unknown[] = [];
    const fetcher = visionFetcher(() => new Response("nope", { status: 500 }));
    await expect(new ZhipuChatAnswerProvider({ apiKey: "synthetic-only", model: "glm-5.3", visionModel: "glm-5.3-flash",
      observer: capturingObserver(captured) as never, fetcher }).answer({
      objective: "look", mode: "unscoped_conversation", observation,
      prompt_snapshot: bundledPrompt("assistant/conversation"), context_blocks: [], allowed_citation_ids: [],
      images: [{ file_name: "shot.png", media_type: "image/png", data }],
    })).rejects.toThrow();
    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain(Buffer.from(data).toString("base64"));
    expect(serialized).not.toContain("data:image/png;base64");
  });

  it("redacts workspace-run observations for agent inputParts", async () => {
    const captured: unknown[] = [];
    const fetcher = visionFetcher(() => Response.json({ id: "v", model: "glm-5.3-flash",
      choices: [{ message: { content: JSON.stringify({ outcome: "reply", title: "Reply", body: "ok" }) } }] }));
    await new ZhipuChatAnswerProvider({ apiKey: "synthetic-only", model: "glm-5.3", visionModel: "glm-5.3-flash",
      observer: capturingObserver(captured) as never, fetcher }).run({
      runID: "run", objective: "look", systemPrompt: "Stay in scope.",
      scopeSummary: { kind: "workspace_conversation", workspaceID: "w", sessionID: "s", currentPersonID: null, currentRelationshipContextID: null },
      toolManifest: [], observation, budget: { maxTurns: 1, maxToolCalls: 1, maxDurationMs: 10_000, maxTaskTokens: 4_000, maxEstimatedUsd: 1 },
      inputParts: [{ kind: "image", artifactID: "conversation-image-1", mimeType: "image/png", byteSize: data.length,
        contentHash: "0".repeat(64), dataBase64: Buffer.from(data).toString("base64") }],
    }, async () => ({ ok: true, callID: "noop", name: "noop" }), new AbortController().signal);
    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain(Buffer.from(data).toString("base64"));
    expect(serialized).not.toContain("data:image/png;base64");
  });
});

const relationshipContextBlock = {
  block_id: "block-1",
  block_key: "identity_context",
  type: "identity_context",
  status: "confirmed",
  headline: "Maya",
  summary: "Maya now leads Northstar.",
  items: ["Maya now leads Northstar."],
  evidence_fragment_ids: ["ev-1"],
};

function relationshipRequest(overrides: Partial<RemoteChatAnswerRequest> = {}): RemoteChatAnswerRequest {
  return {
    objective: "What changed with Maya?",
    mode: "relationship",
    session_title_requested: true,
    reference_time: "2026-10-18T04:00:00.000Z",
    conversation_history: [{ message_id: "m-1", role: "user", text: "Earlier question about Maya" }],
    context_blocks: [{ ...relationshipContextBlock }],
    allowed_citation_ids: ["ev-1"],
    prompt_snapshot: bundledPrompt("assistant/relationship"),
    ...overrides,
  };
}

const validAnswerPayload = {
  kind: "answer",
  title: "Maya update",
  body: "Maya now leads Northstar.",
  citation_ids: ["ev-1"],
};

function zhipuCompletion(content: unknown, usage: unknown = { prompt_tokens: 11, completion_tokens: 22 }, model = "glm-5.3") {
  return { id: "glm-request-1", model, choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage };
}

function deepSeekCompletion(content: unknown, usage: unknown = { prompt_tokens: 11, completion_tokens: 22 }, model = "deepseek-flash") {
  return { id: "deepseek-request-1", model, choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage };
}

function zhipuProvider(fetcher: typeof fetch) {
  return new ZhipuChatAnswerProvider({ apiKey: "synthetic-only", model: "glm-5.3", observer: null, fetcher });
}

function deepSeekProvider(fetcher: typeof fetch) {
  return new DeepSeekRelationshipTextProvider({ apiKey: "synthetic-only", model: "deepseek-flash", observer: null, fetcher });
}

type AnswerOutcome = { ok: true; result: RemoteChatAnswerResult } | { ok: false; error: Error };

async function outcomeOf(provider: RemoteChatAnswerProviding, request: RemoteChatAnswerRequest): Promise<AnswerOutcome> {
  try {
    return { ok: true, result: await provider.answer(request) };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

async function sharedRulePair(content: unknown, request = relationshipRequest()) {
  return {
    zhipu: await outcomeOf(zhipuProvider(vi.fn<typeof fetch>(async () => Response.json(zhipuCompletion(content)))), request),
    deepseek: await outcomeOf(deepSeekProvider(vi.fn<typeof fetch>(async () => Response.json(deepSeekCompletion(content)))), request),
  };
}

function answerFields(result: RemoteChatAnswerResult) {
  return { kind: result.kind, title: result.title, body: result.body, citation_ids: result.citation_ids, session_title: result.session_title };
}

function expectSharedRule(pair: Awaited<ReturnType<typeof sharedRulePair>>) {
  if (pair.zhipu.ok && pair.deepseek.ok) {
    expect(answerFields(pair.deepseek.result)).toEqual(answerFields(pair.zhipu.result));
    return pair;
  }
  expect(pair.zhipu.ok).toBe(false);
  expect(pair.deepseek.ok).toBe(false);
  if (!pair.zhipu.ok && !pair.deepseek.ok) {
    // One parser, one rule: only the provider error label may differ.
    expect(pair.deepseek.error.message.replace("DeepSeek Chat", "Zhipu Chat")).toBe(pair.zhipu.error.message);
  }
  return pair;
}

describe("shared product text-task seam", () => {
  it("serializes identical text-task messages and shared wire fields for Zhipu and DeepSeek", async () => {
    const request = relationshipRequest();
    const zhipuFetcher = vi.fn<typeof fetch>(async () => Response.json(zhipuCompletion(JSON.stringify(validAnswerPayload))));
    const deepseekFetcher = vi.fn<typeof fetch>(async () => Response.json(deepSeekCompletion(JSON.stringify(validAnswerPayload))));
    await zhipuProvider(zhipuFetcher).answer(request);
    await deepSeekProvider(deepseekFetcher).answer(request);
    const task = await serializeChatAnswerTextTask(request, { imagesAdmitted: false });
    const zhipuBody = JSON.parse(String(zhipuFetcher.mock.calls[0]?.[1]?.body));
    const deepseekBody = JSON.parse(String(deepseekFetcher.mock.calls[0]?.[1]?.body));
    expect(zhipuBody.messages).toEqual(task.messages);
    expect(deepseekBody.messages).toEqual(task.messages);
    for (const field of ["response_format", "temperature", "max_tokens", "stream"]) {
      expect(zhipuBody[field]).toEqual(deepseekBody[field]);
    }
    expect(deepseekBody).toEqual({
      model: "deepseek-flash",
      messages: task.messages,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0,
      max_tokens: 1600,
      stream: false,
    });
    expect(zhipuBody.model).toBe("glm-5.3");
    expect(zhipuBody.thinking).toEqual({ type: "enabled" });
  });

  it("routes both providers through the shared serializer and parser outputs", async () => {
    const request = relationshipRequest();
    const content = JSON.stringify({ ...validAnswerPayload, session_title: "Maya's new role" });
    const zhipuFetcher = vi.fn<typeof fetch>(async () => Response.json(zhipuCompletion(content)));
    const deepseekFetcher = vi.fn<typeof fetch>(async () => Response.json(deepSeekCompletion(content)));
    const zhipuResult = await zhipuProvider(zhipuFetcher).answer(request);
    const deepseekResult = await deepSeekProvider(deepseekFetcher).answer(request);
    expect(answerFields(zhipuResult)).toEqual(parseChatAnswerTextTask(content, request, "Zhipu Chat"));
    expect(answerFields(deepseekResult)).toEqual(parseChatAnswerTextTask(content, request, "DeepSeek Chat"));
  });

  it.each([
    ["plain JSON object", JSON.stringify(validAnswerPayload)],
    ["fenced JSON object", `\`\`\`json\n${JSON.stringify(validAnswerPayload)}\n\`\`\``],
    ["citation outside the allowlist", JSON.stringify({ ...validAnswerPayload, citation_ids: ["ev-2"] })],
    ["missing required relationship citation", JSON.stringify({ ...validAnswerPayload, citation_ids: [] })],
    ["invalid citation identifier", JSON.stringify({ ...validAnswerPayload, citation_ids: [42] })],
    ["too many citations", JSON.stringify({ ...validAnswerPayload, citation_ids: Array.from({ length: 21 }, (_, index) => `ev-${index}`) })],
    ["unsupported response kind", JSON.stringify({ ...validAnswerPayload, kind: "refusal" })],
    ["non-object JSON", "[]"],
    ["invalid JSON", "not json"],
    ["oversized answer body", JSON.stringify({ ...validAnswerPayload, body: "x".repeat(4_001) })],
    ["oversized provider content", `${JSON.stringify(validAnswerPayload)}${" ".repeat(17_000)}`],
  ])("applies one answer parser with identical rules to %s", async (_name, content) => {
    expectSharedRule(await sharedRulePair(content));
  });

  it("applies the same unscoped attachment-only rules to both providers", async () => {
    const request = relationshipRequest({
      mode: "unscoped_conversation",
      prompt_snapshot: bundledPrompt("assistant/conversation"),
      context_blocks: [],
      allowed_citation_ids: [],
    });
    const pair = expectSharedRule(await sharedRulePair(
      JSON.stringify({ kind: "answer", title: "Reply", body: "A conversational reply.", citation_ids: [] }),
      request,
    ));
    expect(pair.deepseek.ok && pair.deepseek.result.citation_ids).toEqual([]);
  });

  it("applies one governed context transport limit to both providers", async () => {
    const request = relationshipRequest({ objective: "x".repeat(48_001) });
    const zhipu = await outcomeOf(zhipuProvider(vi.fn<typeof fetch>(async () => Response.json(zhipuCompletion("{}")))), request);
    const deepseek = await outcomeOf(deepSeekProvider(vi.fn<typeof fetch>(async () => Response.json(deepSeekCompletion("{}")))), request);
    expect(zhipu.ok === false && zhipu.error.message).toBe("The governed Chat context is too large for remote processing.");
    expect(deepseek.ok === false && deepseek.error.message).toBe("The governed Chat context is too large for remote processing.");
  });

  it("rejects unscoped relationship context on both providers", async () => {
    const request = relationshipRequest({ mode: "unscoped_conversation", prompt_snapshot: bundledPrompt("assistant/conversation") });
    const zhipu = await outcomeOf(zhipuProvider(vi.fn<typeof fetch>(async () => Response.json(zhipuCompletion("{}")))), request);
    const deepseek = await outcomeOf(deepSeekProvider(vi.fn<typeof fetch>(async () => Response.json(deepSeekCompletion("{}")))), request);
    expect(zhipu.ok === false && zhipu.error.message).toBe("Unscoped Chat cannot receive relationship context or citations.");
    expect(deepseek.ok === false && deepseek.error.message).toBe("Unscoped Chat cannot receive relationship context or citations.");
  });
});

describe("DeepSeek relationship text provider", () => {
  it("sends the exact pinned DeepSeek text-task profile", async () => {
    const request = relationshipRequest();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(deepSeekCompletion(JSON.stringify(validAnswerPayload))));
    const provider = new DeepSeekRelationshipTextProvider({ apiKey: "sk-synthetic-only", model: "deepseek-flash", observer: null, fetcher });
    const result = await provider.answer(request);
    const task = await serializeChatAnswerTextTask(request, { imagesAdmitted: false });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://api.deepseek.com/chat/completions");
    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ authorization: "Bearer sk-synthetic-only", "content-type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "deepseek-flash",
      messages: task.messages,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0,
      max_tokens: 1600,
      stream: false,
    });
    expect(result).toMatchObject({
      provider_id: "deepseek-chat-completions",
      model: "deepseek-flash",
      reported_model: "deepseek-flash",
      provider_request_id: "deepseek-request-1",
      input_tokens: 11,
      output_tokens: 22,
      usage_reported: true,
      prompt_revision: task.prompt.revision,
    });
    expect(result.prompt_snapshot).toEqual(task.snapshot);
  });

  it("exposes the pinned DeepSeek text-only surface and no full Agent behavior", () => {
    const provider = deepSeekProvider(vi.fn<typeof fetch>(async () => Response.json({})));
    expect(provider.providerId).toBe("deepseek-chat-completions");
    expect(provider.supportsImageInput).toBe(false);
    expect(provider.imageModel).toBeNull();
    expect(provider.supportsPromptPresets).toBe(true);
    // This provider exposes text answers only. An opted-in host can use its
    // text branch, but no tool-agent capability is advertised here.
    expect("run" in provider).toBe(false);
    expect("runWithPromptPreset" in provider).toBe(false);
    expect(provider.loadedTaskConfiguration?.configuration.model).toBe("deepseek-flash");
  });

  it("accepts only the alias or its exact documented reported identity", () => {
    const provider = deepSeekProvider(vi.fn<typeof fetch>(async () => Response.json({})));
    expect(provider.matchesReportedModel("deepseek-flash")).toBe(true);
    expect(provider.matchesReportedModel("DeepSeek-V4.1-Flash-1017")).toBe(true);
    expect(provider.matchesReportedModel("DeepSeek-V4.1-Flash-1018")).toBe(false);
    expect(provider.matchesReportedModel("deepseek-chat")).toBe(false);
    expect(provider.matchesReportedModel("deepseek-flash ")).toBe(false);
    expect(provider.matchesReportedModel(null)).toBe(false);
  });

  it("explicitly rejects images instead of silently answering without them", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(deepSeekCompletion(JSON.stringify(validAnswerPayload))));
    const provider = deepSeekProvider(fetcher);
    const image = { file_name: "shot.png", media_type: "image/png" as const, data: new Uint8Array([137, 80, 78, 71]) };
    await expect(provider.answer(relationshipRequest({ images: [image] }))).rejects.toThrow("do not admit images");
    await expect(provider.answer(relationshipRequest({
      mode: "unscoped_conversation",
      prompt_snapshot: bundledPrompt("assistant/conversation"),
      context_blocks: [],
      allowed_citation_ids: [],
      images: [image],
    }))).rejects.toThrow("do not admit images");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong reported model", async () => {
    for (const model of [null, "deepseek-chat", "DeepSeek-V4.1-Flash-1018", "DeepSeek-V4.1-Flash-1017-x"]) {
      const payload = model === null
        ? { ...deepSeekCompletion(JSON.stringify(validAnswerPayload)), model: undefined }
        : deepSeekCompletion(JSON.stringify(validAnswerPayload), undefined, model);
      const fetcher = vi.fn<typeof fetch>(async () => Response.json(payload));
      await expect(deepSeekProvider(fetcher).answer(relationshipRequest())).rejects.toThrow("different or missing model");
    }
  });

  it("rejects a wrong configured model or a missing API key", () => {
    expect(() => new DeepSeekRelationshipTextProvider({ apiKey: "sk-synthetic-only", model: "deepseek-chat", observer: null, fetcher: vi.fn<typeof fetch>(async () => Response.json({})) })).toThrow("deepseek-flash");
    expect(() => new DeepSeekRelationshipTextProvider({ apiKey: "sk-synthetic-only", model: "DeepSeek-V4.1-Flash-1017", observer: null, fetcher: vi.fn<typeof fetch>(async () => Response.json({})) })).toThrow("deepseek-flash");
    expect(() => new DeepSeekRelationshipTextProvider({ apiKey: "", model: "deepseek-flash", observer: null, fetcher: vi.fn<typeof fetch>(async () => Response.json({})) })).toThrow("API key is required");
  });

  it("propagates requested model, documented reported model, request id and usage", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(deepSeekCompletion(
      JSON.stringify(validAnswerPayload),
      { prompt_tokens: 11, completion_tokens: 22 },
      "DeepSeek-V4.1-Flash-1017",
    )));
    const result = await deepSeekProvider(fetcher).answer(relationshipRequest());
    expect(result).toMatchObject({
      model: "deepseek-flash",
      reported_model: "DeepSeek-V4.1-Flash-1017",
      provider_request_id: "deepseek-request-1",
      input_tokens: 11,
      output_tokens: 22,
      usage_reported: true,
    });
  });

  const cacheSplitCases: Array<[
    string,
    Record<string, number> | null,
    { cache_hit_tokens: number | null; cache_miss_tokens: number | null },
  ]> = [
    ["consistent split", { prompt_tokens: 10, completion_tokens: 20, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6 }, { cache_hit_tokens: 4, cache_miss_tokens: 6 }],
    ["genuine zero hit split", { prompt_tokens: 5, completion_tokens: 20, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 5 }, { cache_hit_tokens: 0, cache_miss_tokens: 5 }],
    ["inconsistent split sum", { prompt_tokens: 10, completion_tokens: 20, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 7 }, { cache_hit_tokens: null, cache_miss_tokens: null }],
    ["partial split", { prompt_tokens: 10, completion_tokens: 20, prompt_cache_hit_tokens: 4 }, { cache_hit_tokens: null, cache_miss_tokens: null }],
    ["negative split", { prompt_tokens: 10, completion_tokens: 20, prompt_cache_hit_tokens: -1, prompt_cache_miss_tokens: 11 }, { cache_hit_tokens: null, cache_miss_tokens: null }],
    ["fractional split", { prompt_tokens: 10, completion_tokens: 20, prompt_cache_hit_tokens: 4.5, prompt_cache_miss_tokens: 5.5 }, { cache_hit_tokens: null, cache_miss_tokens: null }],
    ["unsafe rounded split", { prompt_tokens: 2 ** 53, completion_tokens: 0, prompt_cache_hit_tokens: 2 ** 53, prompt_cache_miss_tokens: 1 }, { cache_hit_tokens: null, cache_miss_tokens: null }],
    ["missing usage", null, { cache_hit_tokens: null, cache_miss_tokens: null }],
  ];
  it.each(cacheSplitCases)("keeps the %s honest without fabricating zeros", async (_name, usage, expected) => {
    const payload = usage === null
      ? { ...deepSeekCompletion(JSON.stringify(validAnswerPayload)), usage: undefined }
      : deepSeekCompletion(JSON.stringify(validAnswerPayload), usage);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(payload));
    const result = await deepSeekProvider(fetcher).answer(relationshipRequest());
    expect(result).toMatchObject(expected);
    if (usage && Number.isSafeInteger(usage.prompt_tokens)) {
      expect(result.input_tokens).toBe(usage.prompt_tokens);
      expect(result.output_tokens).toBe(usage.completion_tokens);
      expect(result.usage_reported).toBe(true);
    } else {
      expect(result.usage_reported).toBe(false);
    }
  });

  it.each([
    { prompt_tokens: -1, completion_tokens: 0 },
    { prompt_tokens: 1, completion_tokens: -1 },
    { prompt_tokens: 0.5, completion_tokens: 1 },
    { prompt_tokens: 2 ** 53, completion_tokens: 0 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1 },
  ])("keeps malformed or unsafe total usage unknown: %j", async usage => {
    const result = await deepSeekProvider(vi.fn<typeof fetch>(async () => Response.json(
      deepSeekCompletion(JSON.stringify(validAnswerPayload), usage),
    ))).answer(relationshipRequest());
    expect(result).toMatchObject({ input_tokens: 0, output_tokens: 0, usage_reported: false,
      cache_hit_tokens: null, cache_miss_tokens: null });
  });

  it("distinguishes genuine reported zero usage from unknown usage", async () => {
    const result = await deepSeekProvider(vi.fn<typeof fetch>(async () => Response.json(
      deepSeekCompletion(JSON.stringify(validAnswerPayload), {
        prompt_tokens: 0, completion_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0,
      }),
    ))).answer(relationshipRequest());
    expect(result).toMatchObject({ input_tokens: 0, output_tokens: 0, usage_reported: true,
      cache_hit_tokens: 0, cache_miss_tokens: 0 });
  });

  it("applies the same cache-split rule to Zhipu usage", async () => {
    const request = relationshipRequest();
    const content = JSON.stringify(validAnswerPayload);
    const without = await zhipuProvider(vi.fn<typeof fetch>(async () => Response.json(
      zhipuCompletion(content, { prompt_tokens: 10, completion_tokens: 20 }),
    ))).answer(request);
    expect(without.cache_hit_tokens).toBeNull();
    expect(without.cache_miss_tokens).toBeNull();
    const reported = await zhipuProvider(vi.fn<typeof fetch>(async () => Response.json(
      zhipuCompletion(content, { prompt_tokens: 10, completion_tokens: 20, prompt_cache_hit_tokens: 3, prompt_cache_miss_tokens: 7 }),
    ))).answer(request);
    expect(reported.cache_hit_tokens).toBe(3);
    expect(reported.cache_miss_tokens).toBe(7);
  });

  it("composes host cancellation with its own timeout and starts one request only", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let observedSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      observedSignal = init?.signal;
      started();
      return await new Promise<Response>((_resolve, reject) => {
        const fail = () => reject(init?.signal?.reason ?? new Error("aborted"));
        if (init?.signal?.aborted) fail();
        else init?.signal?.addEventListener("abort", fail, { once: true });
      });
    });
    const pending = deepSeekProvider(fetcher).answer(relationshipRequest({ signal: controller.signal }));
    await startedPromise;
    controller.abort(new Error("host cancelled"));
    await expect(pending).rejects.toThrow("host cancelled");
    expect(fetcher).toHaveBeenCalledOnce();
    // Composed with the pinned 15000 ms profile timeout, never the host signal alone.
    expect(observedSignal).not.toBe(controller.signal);
    expect(observedSignal?.aborted).toBe(true);
  });

  it("propagates failure without real network retries", async () => {
    const failing = vi.fn<typeof fetch>(async () => { throw new Error("synthetic network failure"); });
    await expect(deepSeekProvider(failing).answer(relationshipRequest())).rejects.toThrow("synthetic network failure");
    expect(failing).toHaveBeenCalledOnce();
    const serverError = vi.fn<typeof fetch>(async () => new Response("nope", { status: 500 }));
    await expect(deepSeekProvider(serverError).answer(relationshipRequest())).rejects.toThrow("failed with 500");
    expect(serverError).toHaveBeenCalledOnce();
  });

  it("registers credentials for redaction without serializing keys or raw media", async () => {
    const captured: unknown[] = [];
    const addCredential = vi.fn();
    const observer = {
      addCredential,
      start: (_context: unknown, input: unknown) => {
        captured.push(input);
        return {
          step: async (_name: string, _kind: string, input2: unknown, execute: () => Promise<unknown>) => {
            captured.push(input2);
            return execute();
          },
        };
      },
      complete: async () => {},
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(deepSeekCompletion(JSON.stringify(validAnswerPayload))));
    await new DeepSeekRelationshipTextProvider({
      apiKey: "sk-synthetic-only", model: "deepseek-flash", observer: observer as never, fetcher,
    }).answer(relationshipRequest({ observation: { run_id: "run", workspace_id: "w", authorization_scope: "workspace_conversation" } }));
    expect(addCredential).toHaveBeenCalledWith("sk-synthetic-only");
    expect(JSON.stringify(captured)).not.toContain("sk-synthetic-only");
    const headers = fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-synthetic-only");
  });
});

describe("host Chat provider configuration", () => {
  const admitted = { TALENT_SIGNAL_ALLOW_REMOTE_CHAT_PROCESSING: "true" };
  const noopFetcher = vi.fn<typeof fetch>(async () => Response.json({}));

  it("keeps remote Chat processing off by default", () => {
    expect(createEnvironmentChatAnswerProvider({}, noopFetcher)).toBeNull();
    expect(createEnvironmentChatAnswerProvider({ TALENT_SIGNAL_ALLOW_REMOTE_CHAT_PROCESSING: "false" }, noopFetcher)).toBeNull();
    expect(() => createEnvironmentChatAnswerProvider({ TALENT_SIGNAL_ALLOW_REMOTE_CHAT_PROCESSING: "yes" }, noopFetcher)).toThrow("must be true or false");
  });

  it("preserves the zhipu branch and its existing gates", () => {
    const provider = createEnvironmentChatAnswerProvider({
      ...admitted, TALENT_SIGNAL_CHAT_PROVIDER: "zhipu", ZHIPU_API_KEY: "sk-synthetic-only", TALENT_SIGNAL_CHAT_MODEL: "glm-5.3",
    }, noopFetcher);
    expect(provider).toBeInstanceOf(ZhipuChatAnswerProvider);
    expect(provider?.providerId).toBe("zhipu-chat-completions");
    expect(provider?.model).toBe("glm-5.3");
    expect(() => createEnvironmentChatAnswerProvider({
      ...admitted, TALENT_SIGNAL_CHAT_PROVIDER: "zhipu", TALENT_SIGNAL_CHAT_MODEL: "glm-5.3",
    }, noopFetcher)).toThrow("Remote Chat admission requires ZHIPU_API_KEY.");
    expect(() => createEnvironmentChatAnswerProvider({
      ...admitted, TALENT_SIGNAL_CHAT_PROVIDER: "zhipu", ZHIPU_API_KEY: "sk-synthetic-only",
      TALENT_SIGNAL_CHAT_MODEL: "glm-5.3", TALENT_SIGNAL_CHAT_VISION_MODEL: "glm-5.3-flash",
    }, noopFetcher)).toThrow("TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING");
  });

  it("preserves the claude branch", () => {
    const provider = createEnvironmentChatAnswerProvider({
      ...admitted, TALENT_SIGNAL_CHAT_PROVIDER: "claude",
      TALENT_SIGNAL_AGENT_MODEL: "claude-sonnet-4-5", ANTHROPIC_API_KEY: "sk-synthetic-only",
    }, noopFetcher);
    expect(provider).toBeInstanceOf(ClaudeChatProvider);
    expect(provider?.providerId).toBe("claude-agent-sdk");
  });

  it("adds one explicit deepseek host branch", () => {
    const provider = createEnvironmentChatAnswerProvider({
      ...admitted, TALENT_SIGNAL_CHAT_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "sk-synthetic-only", TALENT_SIGNAL_CHAT_MODEL: "deepseek-flash",
    }, noopFetcher);
    expect(provider).toBeInstanceOf(DeepSeekRelationshipTextProvider);
    expect(provider?.providerId).toBe("deepseek-chat-completions");
    expect(provider?.model).toBe("deepseek-flash");
    expect(provider?.supportsImageInput).toBe(false);
  });

  it("rejects missing or wrong DeepSeek configuration", () => {
    expect(() => createEnvironmentChatAnswerProvider({
      ...admitted, TALENT_SIGNAL_CHAT_PROVIDER: "deepseek", TALENT_SIGNAL_CHAT_MODEL: "deepseek-flash",
    }, noopFetcher)).toThrow("DEEPSEEK_API_KEY");
    expect(() => createEnvironmentChatAnswerProvider({
      ...admitted, TALENT_SIGNAL_CHAT_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "sk-synthetic-only",
    }, noopFetcher)).toThrow("TALENT_SIGNAL_CHAT_MODEL=deepseek-flash");
    expect(() => createEnvironmentChatAnswerProvider({
      ...admitted, TALENT_SIGNAL_CHAT_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "sk-synthetic-only",
      TALENT_SIGNAL_CHAT_MODEL: "deepseek-chat",
    }, noopFetcher)).toThrow("TALENT_SIGNAL_CHAT_MODEL=deepseek-flash");
    expect(() => createEnvironmentChatAnswerProvider({
      ...admitted, TALENT_SIGNAL_CHAT_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "sk-synthetic-only",
      TALENT_SIGNAL_CHAT_MODEL: "deepseek-flash", TALENT_SIGNAL_CHAT_VISION_MODEL: "glm-5.3-flash",
    }, noopFetcher)).toThrow("vision");
  });

  it("rejects unknown providers without changing valid defaults", () => {
    expect(() => createEnvironmentChatAnswerProvider({
      ...admitted, TALENT_SIGNAL_CHAT_PROVIDER: "openai",
    }, noopFetcher)).toThrow("TALENT_SIGNAL_CHAT_PROVIDER=zhipu, claude or deepseek");
  });
});
