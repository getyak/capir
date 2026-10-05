import type { UnscopedChatTaskRequest } from "@talent-signal/contracts";
import { describe, expect, it, vi } from "vitest";

import type { RemoteChatAnswerProviding } from "./chatAnswerProvider.js";
import { executeUnscopedChatTask } from "./unscopedChat.js";
import { readAgentSessionConversation } from "./agentSessions.js";
import type { DatabaseClient } from "../database/pool.js";
import type { AuthContext } from "./auth.js";

vi.mock("./agentSessions.js", () => ({ readAgentSessionConversation: vi.fn() }));

const request: UnscopedChatTaskRequest = {
  idempotency_key: "ios:unscoped-chat:fixture",
  objective: "你好",
};

describe("unscoped Agent conversation", () => {
  const auth = { accountId: "account", userId: "user" } as AuthContext;

  it("does not start a second remote SDK call after the admitted run fails", async () => {
    const answer = vi.fn(async () => { throw new Error("CLAUDE_HARNESS_SESSION_INVALIDATED"); });
    const execution = await executeUnscopedChatTask({ request,
      provider: { providerId: "claude-agent-sdk", model: "synthetic", supportsImageInput: false, answer },
    });
    expect(answer).toHaveBeenCalledOnce();
    expect(execution.remoteStatus).toBe("fallback");
    expect(execution.remoteFailureCode).toBeUndefined();
    expect(execution.body.external_effects).toEqual([]);
  });

  it("retains only a bounded timeout code from an SDK failure", async () => {
    const answer = vi.fn(async () => { throw new Error("WORKSPACE_CONVERSATION_TIMEOUT"); });
    const execution = await executeUnscopedChatTask({ request,
      provider: { providerId: "claude-agent-sdk", model: "synthetic", supportsImageInput: true, answer },
    });
    expect(answer).toHaveBeenCalledOnce();
    expect(execution.remoteStatus).toBe("fallback");
    expect(execution.remoteFailureCode).toBe("MODEL_RUN_TIMEOUT");
    expect(JSON.stringify(execution.body)).not.toContain("WORKSPACE_CONVERSATION_TIMEOUT");
  });

  it("preserves a bounded token-budget reason without a second provider call", async () => {
    const answer = vi.fn(async () => { throw new Error("CLAUDE_HARNESS_TOKEN_BUDGET_EXHAUSTED"); });
    const execution = await executeUnscopedChatTask({ request,
      provider: { providerId: "claude-agent-sdk", model: "synthetic", supportsImageInput: true, answer },
    });
    expect(answer).toHaveBeenCalledOnce();
    expect(execution.remoteStatus).toBe("fallback");
    expect(execution.remoteFailureCode).toBe("MODEL_RUN_TOKEN_BUDGET_EXHAUSTED");
    expect(execution.remoteDiagnostics?.failure_code).toBe("CLAUDE_HARNESS_TOKEN_BUDGET_EXHAUSTED");
    expect(execution.body.external_effects).toEqual([]);
    expect(JSON.stringify(execution.body)).not.toContain("CLAUDE_HARNESS_TOKEN_BUDGET_EXHAUSTED");
  });

  it("loads canonical same-scope dialogue before answering a follow-up", async () => {
    const messages = [{ message_id: "previous", role: "assistant" as const, text: "1. Call. 2. Draft an email." }];
    vi.mocked(readAgentSessionConversation).mockResolvedValueOnce({ hasRecordedTurns: true, messages });
    const answer = vi.fn(async () => ({ kind: "answer" as const, title: "Email", body: "A suggested draft.", citation_ids: [],
      provider_id: "zhipu-chat-completions" as const, model: "glm-5.3", provider_request_id: null, input_tokens: 0, output_tokens: 0 }));
    const database = { query: vi.fn(async (sql: string) => ({ rows: sql.includes("FROM agent_sessions")
      ? [{ expires_at: new Date(Date.now() + 86_400_000) }] : [] })) } as unknown as DatabaseClient;
    const execution = await executeUnscopedChatTask({
      request: { ...request, session_id: "session", message_id: "current", objective: "Expand option two." }, database, auth,
      provider: { providerId: "zhipu-chat-completions", model: "glm-5.3", supportsImageInput: false, answer },
    });
    expect(readAgentSessionConversation).toHaveBeenLastCalledWith(database, auth, "session", { personId: null, relationshipContextId: null });
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({
      session_title_requested: false,
      conversation_history: messages,
      allowed_citation_ids: [],
      context_blocks: [],
    }));
    expect(execution.body.session_title).toBeUndefined();
  });

  it("does not rename a Session whose recorded history is no longer admissible", async () => {
    vi.mocked(readAgentSessionConversation).mockResolvedValueOnce({ hasRecordedTurns: true, messages: [] });
    const answer = vi.fn(async () => ({ kind: "answer" as const, title: "Current reply", session_title: "Wrong rename",
      body: "A current answer.", citation_ids: [], provider_id: "zhipu-chat-completions" as const,
      model: "glm-5.3", provider_request_id: null, input_tokens: 0, output_tokens: 0 }));
    const database = { query: vi.fn(async (sql: string) => ({ rows: sql.includes("FROM agent_sessions")
      ? [{ expires_at: new Date(Date.now() + 86_400_000) }] : [] })) } as unknown as DatabaseClient;
    const execution = await executeUnscopedChatTask({
      request: { ...request, session_id: "session", message_id: "current", objective: "Try again." },
      database,
      auth,
      provider: { providerId: "zhipu-chat-completions", model: "glm-5.3", supportsImageInput: false, answer },
    });
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ session_title_requested: false }));
    expect(execution.body.session_title).toBeUndefined();
    expect(execution.body.blocks[0]?.title).toBe("Current reply");
  });

  it("does not turn invalid Session scope into an unrestricted provider fallback", async () => {
    vi.mocked(readAgentSessionConversation).mockRejectedValueOnce(new Error("AGENT_SESSION_SCOPE_CHANGED"));
    const answer = vi.fn();
    await expect(executeUnscopedChatTask({ request: { ...request, session_id: "session" }, database: {} as DatabaseClient, auth,
      provider: { providerId: "zhipu-chat-completions", model: "glm-5.3", supportsImageInput: false, answer },
    })).rejects.toThrow("AGENT_SESSION_SCOPE_CHANGED");
    expect(answer).not.toHaveBeenCalled();
  });

  it("sends only the submitted text and returns no evidence or effects", async () => {
    const answer = vi.fn(async () => ({
      kind: "answer" as const,
      title: "问候回复",
      session_title: "简单聊两句",
      body: "你好，我在。你想聊什么？",
      citation_ids: [],
      provider_id: "zhipu-chat-completions" as const,
      model: "glm-5.3",
      provider_request_id: "provider-request-1",
      input_tokens: 10,
      output_tokens: 8,
    }));
    const provider: RemoteChatAnswerProviding = {
      providerId: "zhipu-chat-completions",
      model: "glm-5.3",
      supportsImageInput: false,
      answer,
    };

    const execution = await executeUnscopedChatTask({
      request,
      provider,
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
    });

    expect(answer).toHaveBeenCalledWith({
      mode: "unscoped_conversation",
      objective: "你好",
      session_title_requested: true,
      context_blocks: [],
      allowed_citation_ids: [],
      images: [],
    });
    expect(execution).toMatchObject({
      remoteStatus: "completed",
      body: {
        session_title: "简单聊两句",
        disposition: "answer",
        external_effects: [],
        blocks: [
          {
            kind: "answer",
            title: "问候回复",
            body: "你好，我在。你想聊什么？",
            citation_dependency_ids: [],
            requires_user_decision: false,
          },
        ],
      },
    });
  });

  it("returns a truthful local reply when the remote provider fails", async () => {
    const execution = await executeUnscopedChatTask({
      request,
      provider: {
        providerId: "zhipu-chat-completions",
        model: "glm-5.3",
        supportsImageInput: false,
        answer: async () => {
          throw new Error("provider unavailable");
        },
      },
    });

    expect(execution.remoteStatus).toBe("fallback");
    expect(execution.body.external_effects).toEqual([]);
    expect(execution.body.blocks[0]).toMatchObject({
      kind: "answer",
      title: "这次未完成",
      body: expect.stringContaining("这次处理未完成"),
      citation_dependency_ids: [],
      requires_user_decision: false,
    });
  });

  it("forwards user-sent images to the unscoped remote chat fallback", async () => {
    vi.mocked(readAgentSessionConversation).mockResolvedValueOnce({ hasRecordedTurns: false, messages: [] });
    const data = new Uint8Array([1, 2, 3, 4]);
    const answer = vi.fn(async () => ({ kind: "answer" as const, title: "图片", body: "I can see it.",
      citation_ids: [], provider_id: "zhipu-chat-completions" as const, model: "glm-5.3",
      provider_request_id: null, input_tokens: 0, output_tokens: 0 }));
    await executeUnscopedChatTask({
      request,
      provider: { providerId: "zhipu-chat-completions", model: "glm-5.3", supportsImageInput: false, answer },
      images: [{ messageId: "10000000-0000-4000-8000-000000000001", attachmentId: "attachment-1", fileName: "shot.png", mediaType: "image/png", byteSize: data.length, contentHash: "a".repeat(64), data }],
    });
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({
      images: [{ file_name: "shot.png", media_type: "image/png", data }],
    }));
  });

  it("forwards user-sent images as provider inputParts on the workspace agent path", async () => {
    vi.mocked(readAgentSessionConversation).mockResolvedValueOnce({ hasRecordedTurns: true, messages: [] });
    const data = new Uint8Array([9, 8, 7]);
    const database = { query: vi.fn(async (sql: string) => ({ rows: sql.includes("FROM agent_sessions")
      ? [{ expires_at: new Date(Date.now() + 86_400_000) }] : [] })) } as unknown as DatabaseClient;
    const run = vi.fn(async () => ({ structuredOutput: { outcome: "reply", title: "图片", body: "Looking at it." },
      inputTokens: 1, outputTokens: 1, estimatedUsd: 0, turns: 1, permissionDenials: [] }));
    const execution = await executeUnscopedChatTask({
      request: { ...request, session_id: "session", message_id: "current", objective: "" },
      database,
      auth,
      provider: { providerId: "zhipu-chat-completions", id: "zhipu-chat-completions", model: "synthetic", supportsImageInput: true,
        answer: vi.fn(), run } as never,
      images: [{ messageId: "10000000-0000-4000-8000-000000000002", attachmentId: "10000000-0000-4000-8000-000000000001", fileName: "shot.png", mediaType: "image/png",
        byteSize: data.length, contentHash: "b".repeat(64), data }],
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      objective: expect.stringContaining("请先完成工具调用"),
      inputParts: [expect.objectContaining({ kind: "image", artifactID: "conversation-image-10000000-0000-4000-8000-000000000002-0-10000000-0000-4000-8000-000000000001",
        mimeType: "image/png", byteSize: data.length, dataBase64: Buffer.from(data).toString("base64") })],
    }), expect.any(Function), expect.anything());
    expect(execution.body.disposition).toBe("answer");
  });

  it("does not silently drop images when the provider rejects image processing", async () => {
    vi.mocked(readAgentSessionConversation).mockResolvedValueOnce({ hasRecordedTurns: false, messages: [] });
    const data = new Uint8Array([1]);
    const answer = vi.fn(async () => { throw new Error("Remote Chat image processing is not admitted."); });
    const execution = await executeUnscopedChatTask({
      request,
      provider: { providerId: "zhipu-chat-completions", model: "glm-5.3", supportsImageInput: false, answer },
      images: [{ messageId: "10000000-0000-4000-8000-000000000003", attachmentId: "a", fileName: "shot.png", mediaType: "image/png", byteSize: 1, contentHash: "c".repeat(64), data }],
    });
    expect(answer).toHaveBeenCalled();
    expect(execution.remoteStatus).toBe("fallback");
    expect(execution.body.blocks[0]?.body).toContain("这次处理未完成");
  });
});
