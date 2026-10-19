import { describe, expect, it, vi } from "vitest";

import {
  MEMORY_RELATIONSHIP_RECALL_DESCRIPTION,
  MemoryReviewInputSchema,
  MemoryReviewToolInputSchema,
  memoryLocatorAdmissionError,
  memoryReviewSDKOperationTools,
  type MemoryProposalCandidateInput,
} from "./memorySchemas.js";
import { AGENT_TOOL_CATALOG, agentToolJsonSchema } from "./toolCatalog.js";
import { ScriptedAgentProvider } from "./scriptedProvider.js";
import type { AgentToolResult } from "./types.js";

function candidate(
  overrides: Partial<MemoryProposalCandidateInput>,
): MemoryProposalCandidateInput {
  return {
    scope: "person",
    operation: "add",
    statement_kind: "source_statement",
    display_text: "陈宇在这次聊天中说，他目前负责设计系统",
    speaker: "陈宇",
    reporter: null,
    valid_time: null,
    observed_time: "2026-09-21T10:00:00.000Z",
    time_status: "known",
    sensitivity: "normal",
    source_excerpt: "他目前负责设计系统",
    source_locator: { kind: "message", session_id: null, message_id: null },
    reason: "下一次少解释一句",
    ...overrides,
  };
}

describe("memory_review Agent tool", () => {
  it("permits a contact-only name draft with provenance but not an empty no-op", () => {
    expect(MemoryReviewInputSchema.safeParse({operation:"propose",scope:"relationship",contact_decision:"new",person_display_label:"阿禾",new_contact_source_locator:{kind:"image_region",artifact_id:"current-image",image_index:0},items:[]}).success).toBe(true);
    expect(MemoryReviewInputSchema.safeParse({operation:"propose",contact_decision:"new",person_display_label:"阿禾",new_contact_source_locator:{kind:"image_region",artifact_id:"current-image",image_index:0},items:[]}).success).toBe(true);
    expect(MemoryReviewInputSchema.safeParse({operation:"propose",contact_decision:"none",items:[]}).success).toBe(false);
  });
  it("is a Zod object capability with a typed recall/propose boundary", () => {
    expect(AGENT_TOOL_CATALOG.memory_review.capabilityClass).toBe("memory_review");
    expect(AGENT_TOOL_CATALOG.memory_review.approval).toBe("human_review_before_apply");
    expect(MemoryReviewToolInputSchema.safeParse({ operation: "recall" }).success).toBe(true);
    expect(
      MemoryReviewInputSchema.safeParse({ operation: "propose", items: [] }).success,
    ).toBe(false);
    expect(agentToolJsonSchema("memory_review")).toMatchObject({
      type: "object",
      properties: { operation: { enum: ["recall", "propose"] } },
    });
    expect(MEMORY_RELATIONSHIP_RECALL_DESCRIPTION).toContain("Memory");
  });

  it("requires an admitted ordered image locator and preserves speaker and time", async () => {
    const admitted = ["image-0", "image-1"];
    const items = [
      candidate({
        source_locator: { kind: "image_region", artifact_id: "image-1", image_index: 1, region: null, session_id: null },
        source_excerpt: "负责设计系统",
      }),
      candidate({
        scope: "relationship",
        display_text: "陈宇要求这次合作先发文字方案",
        speaker: "陈宇",
        reporter: null,
        source_locator: { kind: "image_region", artifact_id: "image-0", image_index: 0, region: null, session_id: null },
        source_excerpt: "先发文字方案",
      }),
    ];
    expect(memoryLocatorAdmissionError(items, admitted)).toBeNull();
    expect(
      memoryLocatorAdmissionError(
        [candidate({ source_locator: { kind: "image_region", artifact_id: "image-9", image_index: 9, region: null, session_id: null } })],
        admitted,
      ),
    ).toContain("image-9");

    const staged: MemoryProposalCandidateInput[] = [];
    const invokeTool = vi.fn(
      async (name: string, input: unknown): Promise<AgentToolResult> => {
        expect(name).toBe("memory_review");
        const parsed = MemoryReviewInputSchema.safeParse(input);
        if (!parsed.success || parsed.data.operation !== "propose") {
          return { ok: false, callID: "c0", name, error: { code: "TOOL_INPUT_INVALID", message: "invalid" } };
        }
        const locatorError = memoryLocatorAdmissionError(parsed.data.items, admitted);
        if (locatorError) {
          return { ok: false, callID: "c0", name, error: { code: "MEMORY_SOURCE_NOT_ADMITTED", message: locatorError } };
        }
        staged.push(...parsed.data.items);
        return { ok: true, callID: "c1", name, candidateFingerprint: "proposal-1", data: { status: "needs_review" } };
      },
    );
    const provider = new ScriptedAgentProvider(
      [{ tool: "memory_review", input: { operation: "propose", contact_decision: "new", person_display_label: "陈宇", items } }],
      { outcome: "reply", title: "已记录", body: "这里是你需要的答复。" },
    );
    const result = await provider.run(
      {
        runID: "run-1",
        objective: "看看这张截图并帮我记住变化",
        systemPrompt: "test",
        scopeSummary: {
          kind: "workspace_conversation",
          workspaceID: "workspace-1",
          sessionID: null,
          currentPersonID: null,
          currentRelationshipContextID: null,
        },
        toolManifest: ["memory_review"],
        budget: { maxTurns: 2, maxToolCalls: 2, maxDurationMs: 5_000, maxTaskTokens: 1_000, maxEstimatedUsd: 0 },
        inputParts: [
          { kind: "image", artifactID: "image-0", mimeType: "image/png", byteSize: 4, contentHash: "a".repeat(64), dataBase64: "aGVsbG8=" },
          { kind: "image", artifactID: "image-1", mimeType: "image/png", byteSize: 4, contentHash: "b".repeat(64), dataBase64: "aGVsbG8=" },
        ],
      },
      invokeTool,
      new AbortController().signal,
    );
    expect(result.structuredOutput).toEqual({ outcome: "reply", title: "已记录", body: "这里是你需要的答复。" });
    expect(staged).toHaveLength(2);
    expect(staged[0]?.speaker).toBe("陈宇");
    expect(staged[0]?.observed_time).toBe("2026-09-21T10:00:00.000Z");
    expect(staged[0]?.time_status).toBe("known");
  });

  it("produces a helpful answer with no memory proposal when there is no semantic change", async () => {
    const invokeTool = vi.fn(
      async (name: string): Promise<AgentToolResult> => ({
        ok: false,
        callID: "c0",
        name,
        error: { code: "MEMORY_NO_MATERIAL_CHANGE", message: "no change" },
      }),
    );
    const provider = new ScriptedAgentProvider([], {
      outcome: "reply",
      title: "没有需要记住的变化",
      body: "这张截图和已记住的内容一致，我没有生成新的记忆卡。",
    });
    const result = await provider.run(
      {
        runID: "run-2",
        objective: "又发了一次同样的截图",
        systemPrompt: "test",
        scopeSummary: {
          kind: "workspace_conversation",
          workspaceID: "workspace-1",
          sessionID: null,
          currentPersonID: null,
          currentRelationshipContextID: null,
        },
        toolManifest: ["memory_review"],
        budget: { maxTurns: 2, maxToolCalls: 2, maxDurationMs: 5_000, maxTaskTokens: 1_000, maxEstimatedUsd: 0 },
      },
      invokeTool,
      new AbortController().signal,
    );
    expect(invokeTool).not.toHaveBeenCalled();
    expect(result.structuredOutput).toMatchObject({ outcome: "reply" });
  });
});

describe("bounded SDK Memory operations", () => {
  const propose = () => memoryReviewSDKOperationTools().find(tool => tool.operation === "propose")!;
  const self = () => candidate({ scope: "self", dependence_kind: "independent_self", speaker: "self",
    display_text: "接下来两周练习陶艺，之后是否继续尚未决定", source_excerpt: "接下来两周练习陶艺，之后是否继续尚未决定", time_status: "future" });

  it("binds only the host-selected operation and preserves explicit self or mixed item scopes", () => {
    const tool = propose();
    expect(tool.readOnly).toBe(false);
    for (const items of [[self()], [self(), candidate({})]]) {
      const request = { contact_decision: items.length > 1 ? "existing" : "none", items };
      const parsed = tool.schema.parse(request);
      const host = MemoryReviewInputSchema.parse({ ...parsed, operation: tool.operation });
      expect(host).toEqual({ ...request, operation: "propose" });
    }
  });

  it("does not infer missing scopes or hide original cross-field constraints", () => {
    const request = { contact_decision: "none", items: [self()] };
    const { scope: _scope, ...withoutScope } = self();
    for (const invalid of [{ items: request.items }, { contact_decision: "none" },
      { ...request, items: [withoutScope] }, { ...request, scope: "self" },
      { ...request, operation: "commit" }, { ...request, items: [] },
      { ...request, unrecognized: "synthetic" }]) expect(propose().schema.safeParse(invalid).success).toBe(false);
    expect(propose().schema.safeParse({ contact_decision: "new", person_display_label: "Mira", items: [] }).success).toBe(false);
    expect(propose().schema.safeParse({ contact_decision: "new", person_display_label: "Mira",
      new_contact_source_locator: { kind: "image_region", artifact_id: "synthetic-admitted-image" }, items: [] }).success).toBe(true);
  });

  it("keeps recall read-only, scoped and paginated without proposal arguments", () => {
    const recall = memoryReviewSDKOperationTools().find(tool => tool.operation === "recall")!;
    expect(recall.readOnly).toBe(true);
    expect(recall.schema.parse({ scope: "self", cursor: "page-2" })).toEqual({ scope: "self", cursor: "page-2" });
    expect(recall.schema.safeParse({ items: [self()] }).success).toBe(false);
    expect(recall.schema.safeParse({ operation: "commit" }).success).toBe(false);
  });
});
