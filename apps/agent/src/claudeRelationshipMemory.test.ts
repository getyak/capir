import { describe, expect, it, vi } from "vitest";
import { ClaudeChatProvider } from "./claudeChatProvider.js";
import { claudeHarnessConfiguration } from "./claudeHarnessConfiguration.js";
import type { ClaudeHarnessRequest } from "./claudeHarness.js";
import type { AgentMemoryItem, AgentMemoryPage } from "./memoryContext.js";
import { bundledPrompt } from "./promptRegistry.js";

const configuration = claudeHarnessConfiguration({ ANTHROPIC_API_KEY: "synthetic", TALENT_SIGNAL_AGENT_MODEL: "synthetic-model" });
const outcome = { text: "According to the retained statement.", structuredOutput: null,
  sessionID: "synthetic-session", inputTokens: 10, outputTokens: 20, estimatedUsd: 0,
  turns: 1, toolCalls: 1, toolCompletions: [], terminalReason: "completed", permissionDenials: [], reportedModels: ["synthetic-model"] };
const identity = { block_id: "identity", block_key: "identity", type: "identity_context", status: "confirmed",
  headline: "Synthetic contact", summary: "Synthetic project", items: [], evidence_fragment_ids: [] };
const memory: AgentMemoryItem = {
  id: "synthetic-person-memory", scope: "person", display_text: "The user reports that the contact works on product design.",
  statement_kind: "source_statement", speaker: "synthetic-user", reporter: "synthetic-user",
  time_status: "unknown", valid_time: null, observed_time: null, sensitivity: "normal",
  version: 1, conflict_group_id: null, supersedes_id: null, evidence_retained: true,
  evidence_refs: [{ excerpt: "The contact works on product design.", locator: { kind: "message", message_id: null },
    source_session_id: "synthetic-source-session", source_message_id: "synthetic-source-message" }],
};

async function answer(page: AgentMemoryPage | null, inspect: (request: ClaudeHarnessRequest) => Promise<void>, assertCurrent = vi.fn(async () => {}), allowed: string[] = []) {
  const recall = vi.fn(async () => page!);
  const stage = vi.fn(async () => null);
  const execute = vi.fn(async (_configuration, request: ClaudeHarnessRequest) => { await inspect(request); return outcome; });
  const response = await new ClaudeChatProvider(configuration, execute).answer({
    objective: "What responsibilities and discussion did I retain?", prompt_snapshot: bundledPrompt("assistant/relationship"),
    context_blocks: [identity], allowed_citation_ids: allowed, assertCurrent,
    ...(page ? { memoryReview: { recall, stage } } : {}),
  });
  return { recall, stage, assertCurrent, response };
}

function reader(request: ClaudeHarnessRequest) {
  return request.tools.find(tool => tool.name === "read_relationship_memory")!;
}
function readJson(result: Awaited<ReturnType<ReturnType<typeof reader>["execute"]>>) {
  const text = result.content.find(block => block.type === "text")!;
  return JSON.parse(text.text as string);
}

describe("relationship domain Memory beside the Wiki snapshot", () => {
  it("answers retained Memory without citing unrelated allowed Wiki fragments", async () => {
    const result = await answer({ items: [memory], has_more: false }, async request => {
      await reader(request).execute({}, new AbortController().signal);
      const rejected = await request.tools.find(tool => tool.name === "cite_evidence")!
        .execute({ source_ids: [memory.id] }, new AbortController().signal);
      expect(rejected.isError).toBe(true);
    }, undefined, ["unrelated-wiki-fragment"]);
    expect(result.response.kind).toBe("answer");
    expect(result.response.citation_ids).toEqual([]);
  });

  it.each(["empty", "unread", "unavailable"])("keeps the citation classification when accepted Memory is %s", async state => {
    const page = state === "unavailable" ? null : { items: state === "empty" ? [] : [memory], has_more: false };
    const result = await answer(page, async request => {
      if (state !== "unread") await reader(request).execute({}, new AbortController().signal);
    }, undefined, ["unrelated-wiki-fragment"]);
    expect(result.response.kind).toBe("clarification");
    expect(result.response.citation_ids).toEqual([]);
  });

  it("records a successful later domain recall page without inventing Wiki citations", async () => {
    const result = await answer({ items: [memory], has_more: false }, async request => {
      await request.tools.find(tool => tool.name === "memory_review")!
        .execute({ operation: "recall", scope: "person", cursor: "synthetic-next" }, new AbortController().signal);
    }, undefined, ["unrelated-wiki-fragment"]);
    expect(result.response.kind).toBe("answer");
    expect(result.recall).toHaveBeenCalledExactlyOnceWith({ scope: "person", cursor: "synthetic-next" });
    expect(result.response.citation_ids).toEqual([]);
  });

  it("returns both accepted scopes when the filtered Wiki has no matching blocks, without promoting statements", async () => {
    const relationship = { ...memory, id: "synthetic-relationship-memory", scope: "relationship" as const,
      display_text: "The user reports a future discussion.", time_status: "future" as const };
    const result = await answer({ items: [memory, relationship], has_more: false, next_cursor: null }, async request => {
      expect(request.context).not.toContain(memory.display_text);
      expect(JSON.parse(request.context!).conversation).toEqual([]);
      const tool = reader(request); expect(tool.readOnly).toBe(true);
      const value = readJson(await tool.execute({ block_types: ["fact"] }, new AbortController().signal));
      expect(value.blocks).toEqual([]); expect(value.identity_context).toEqual([identity]);
      expect(value.accepted_memory).toEqual({ authority: "accepted_relationship_memory_not_execution_permission",
        coverage: "complete", items: [memory, relationship], has_more: false, next_cursor: null });
    });
    expect(result.recall).toHaveBeenCalledExactlyOnceWith();
    expect(result.stage).not.toHaveBeenCalled();
    expect(result.assertCurrent).toHaveBeenCalled();
  });

  it.each([
    [{ items: [], has_more: false, next_cursor: null }, "complete"],
    [{ items: [memory], has_more: true, next_cursor: "synthetic-next" }, "partial"],
    [{ items: [] }, "unknown"],
  ] as const)("preserves coverage and the exact authorized pagination cursor: %s", async (page, coverage) => {
    await answer({ ...page, items: [...page.items] }, async request => {
      const value = readJson(await reader(request).execute({}, new AbortController().signal));
      expect(value.accepted_memory.coverage).toBe(coverage);
      expect(value.accepted_memory.next_cursor).toBe("next_cursor" in page ? page.next_cursor : null);
    });
  });

  it("keeps the legacy snapshot usable while marking accepted Memory unavailable when its host hook is absent", async () => {
    await answer(null, async request => {
      const value = readJson(await reader(request).execute({}, new AbortController().signal));
      expect(value.blocks).toEqual([identity]); expect(value.accepted_memory).toEqual({ coverage: "unavailable" });
    });
  });

  it("refuses an unexpected private self item without exposing its contents or count", async () => {
    await answer({ items: [{ ...memory, scope: "self", display_text: "private synthetic marker" }] }, async request => {
      await expect(reader(request).execute({}, new AbortController().signal))
        .rejects.toThrow("CLAUDE_CHAT_RELATIONSHIP_MEMORY_SCOPE_INVALID");
    });
  });

  it("does not let a failed recall satisfy the accepted Memory receipt", async () => {
    const execute = vi.fn(async (_configuration, request: ClaudeHarnessRequest) => {
      await expect(reader(request).execute({}, new AbortController().signal)).rejects.toThrow("synthetic-recall-unavailable");
      return outcome;
    });
    const response = await new ClaudeChatProvider(configuration, execute).answer({ objective: "Recall", context_blocks: [identity],
      allowed_citation_ids: ["unrelated-wiki-fragment"],
      memoryReview: { recall: async () => { throw new Error("synthetic-recall-unavailable"); }, stage: async () => null } });
    expect(response.kind).toBe("clarification");
    expect(response.citation_ids).toEqual([]);
  });

  it("does not turn a failed domain recall into an empty success", async () => {
    const execute = vi.fn(async (_configuration, request: ClaudeHarnessRequest) => {
      await expect(reader(request).execute({}, new AbortController().signal)).rejects.toThrow("synthetic-recall-unavailable");
      return outcome;
    });
    await new ClaudeChatProvider(configuration, execute).answer({ objective: "Recall", context_blocks: [identity], allowed_citation_ids: [],
      memoryReview: { recall: async () => { throw new Error("synthetic-recall-unavailable"); }, stage: async () => null } });
  });

  it("rejects source withdrawal after the domain read, before returning its page", async () => {
    let checks = 0;
    const assertCurrent = vi.fn(async () => { if (++checks === 2) throw new Error("synthetic-source-withdrawn"); });
    await answer({ items: [memory], has_more: false }, async request => {
      await expect(reader(request).execute({}, new AbortController().signal)).rejects.toThrow("synthetic-source-withdrawn");
    }, assertCurrent);
  });
});
