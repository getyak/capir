import {
  ScriptedAgentProvider,
  type AgentProvider,
  type AgentToolResult,
} from "@talent-signal/agent";
import type { DatabaseClient } from "../database/pool.js";
import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "./auth.js";
import {
  executeWorkspaceConversationAgent,
  executeWorkspaceConversationAgentCore,
  type WorkspaceMemoryLookup,
} from "./workspaceConversationAgent.js";

const auth: AuthContext = {
  accountId: "11111111-1111-4111-8111-111111111111",
  accountSlug: "fixture-alpha",
  userId: "22222222-2222-4222-8222-222222222222",
  userEmail: "recruiter@alpha.local",
  userKind: "simulated_human",
  sessionId: "33333333-3333-4333-8333-333333333333",
};

const personID = "44444444-4444-4444-8444-444444444444";
const contextID = "55555555-5555-4555-8555-555555555555";

function personRow(options: {
  label?: string;
  personID?: string;
  contextID?: string;
  contextLabel?: string;
  profileRevision?: number | null;
} = {}) {
  const rowPersonID = options.personID ?? personID;
  const rowContextID = options.contextID ?? contextID;
  return {
    id: rowPersonID,
    display_label: options.label ?? "Maya Chen",
    context_count: 1,
    capture_count: 2,
    confirmed_identity_count: 0,
    last_activity_at: new Date("2026-09-01T00:00:00.000Z"),
    name_match: true,
    matched_handle_status: null,
    matched_handle_type: null,
    matched_handle_hint: null,
    matched_handle_source_resource_id: null,
    matched_handle_valid_until: null,
    profile_headline: options.profileRevision ? "Chief Product Officer" : null,
    profile_summary: options.profileRevision ? "Recruiter-authored profile" : null,
    profile_provenance_kind: options.profileRevision ? "user_authored" : null,
    profile_authored_by_user_id: options.profileRevision
      ? auth.userId
      : null,
    profile_revision: options.profileRevision ?? null,
    profile_updated_at: options.profileRevision
      ? new Date("2026-09-01T00:00:00.000Z")
      : null,
    public_profile_card_headline: null,
    public_profile_confirmed_by_user_id: null,
    public_profile_revision: null,
    public_profile_confirmed_at: null,
    public_profile_url: null,
    public_profile_platform: null,
    public_profile_avatar_url: null,
    public_profile_use_avatar: null,
    public_profile_retrieved_at: null,
    contexts: [
      {
        id: rowContextID,
        display_label: options.contextLabel ?? "CPO search",
        last_activity_at: "2026-09-01T00:00:00.000Z",
      },
    ],
  };
}

describe("workspace conversation Agent", () => {
  it("marks an unavailable bootstrap honestly and does not stage a write", async () => {
    const provider = new ScriptedAgentProvider([], { outcome: "reply", title: "Hello", body: "Hello" });
    const run = vi.spyOn(provider, "run");
    const stage = vi.fn();
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId, objective: "Hello", provider,
      contacts: { search: vi.fn(), read: vi.fn() },
      memory: { recall: vi.fn().mockRejectedValue(new Error("database unavailable")), stage },
    });
    expect(run.mock.calls[0]![0].selfMemoryContext).toEqual({
      kind: "private_self_memory", status: "unavailable", items: [], continuation: null,
    });
    expect(stage).not.toHaveBeenCalled();
  });

  it.each([["claude-agent-sdk", 180_000], ["scripted", 35_000]])("admits the %s adapter's complete execution budget", async (id, duration) => {
    const provider = new ScriptedAgentProvider([], { outcome: "reply", title: "Ready", body: "Ready" });
    const run = vi.fn<AgentProvider["run"]>(async request => {
      expect(request.budget.maxDurationMs).toBe(duration);
      return { structuredOutput: { outcome: "reply", title: "Ready", body: "Ready" }, inputTokens: 0,
        outputTokens: 0, estimatedUsd: 0, turns: 1, permissionDenials: [] };
    });
    await executeWorkspaceConversationAgentCore({ workspaceID: auth.accountId, objective: "Hello",
      contacts: { search: vi.fn(), read: vi.fn() }, provider: { ...provider, id: String(id), run } });
    expect(run).toHaveBeenCalledOnce();
  });
  it.each([false, true])("bounds the visual round-trip budget without widening other limits (image=%s)", async image => {
    const provider = new ScriptedAgentProvider([], { outcome: "reply", title: "Ready", body: "Ready" });
    const run = vi.fn<AgentProvider["run"]>(async request => {
      expect(request.budget).toMatchObject({ maxTaskTokens: image ? 96_000 : 32_000,
        maxEstimatedUsd: 1, maxTurns: 6, maxToolCalls: 6, maxDurationMs: 180_000 });
      return { structuredOutput: { outcome: "reply", title: "Ready", body: "Ready" },
        inputTokens: 0, outputTokens: 0, estimatedUsd: 0, turns: 1, permissionDenials: [] };
    });
    await executeWorkspaceConversationAgentCore({ workspaceID: auth.accountId, objective: "Inspect",
      contacts: { search: vi.fn(), read: vi.fn() }, provider: { ...provider, id: "claude-agent-sdk", run },
      ...(image ? { inputParts: [{ kind: "image" as const, artifactID: "current", mimeType: "image/jpeg",
        byteSize: 3, contentHash: "a".repeat(64), dataBase64: "AAAA" }] } : {}) });
    expect(run).toHaveBeenCalledOnce();
  });
  it.each(["Hello", "Add my MCP", "Use DeepWiki"])("keeps MCP round trips within the same cost and execution limits: %s", async objective => {
    const provider = new ScriptedAgentProvider([], { outcome: "reply", title: "Ready", body: "Ready" });
    const run = vi.fn<AgentProvider["run"]>(async request => {
      expect(request.budget).toMatchObject({ maxTaskTokens: objective === "Hello" ? 32_000 : 96_000,
        maxEstimatedUsd: 1, maxTurns: 6, maxToolCalls: 6, maxDurationMs: 180_000 });
      return { structuredOutput: { outcome: "reply", title: "Ready", body: "Ready" },
        inputTokens: 0, outputTokens: 0, estimatedUsd: 0, turns: 1, permissionDenials: [] };
    });
    await executeWorkspaceConversationAgentCore({ workspaceID: auth.accountId, objective,
      contacts: { search: vi.fn(), read: vi.fn() }, provider: { ...provider, id: "claude-agent-sdk", run },
      mcpConnections: { handle: vi.fn() } });
    expect(run).toHaveBeenCalledOnce();
  });
  it("can reply without opening the contact workspace", async () => {
    const query = vi.fn();
    const execution = await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "你好",
      provider: new ScriptedAgentProvider([], {
        outcome: "reply",
        title: "你好",
        body: "你好，我在。",
      }),
    });

    expect(query).not.toHaveBeenCalled();
    expect(execution.event).toBeNull();
    expect(execution.block).toMatchObject({
      kind: "answer",
      body: "你好，我在。",
      requires_user_decision: false,
    });
  });

  it("never executes or presents textual tool markup as a completed reply", async () => {
    const query = vi.fn();
    // A model that prints tag-like markup instead of invoking a tool must not
    // cause the host to parse or execute an arbitrary pseudo-call, and the raw
    // markup must not be presented as a successful useful answer.
    const provider = new ScriptedAgentProvider([], {
      outcome: "reply",
      title: "Reply",
      body: '<contact_workspace>{"action":"search","query":"Chen Yu"}</contact_workspace>',
    });
    const execution = await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "帮我找陈宇",
      provider,
    });
    expect(query).not.toHaveBeenCalled();
    expect(execution.event).toBeNull();
    expect(execution.block.body).not.toContain("<contact_workspace>");
    expect(execution.block.body).toContain("还没有保存任何内容");
  });

  it("keeps ordinary prose even when it mentions a tool name", async () => {
    const query = vi.fn();
    const provider = new ScriptedAgentProvider([], {
      outcome: "reply",
      title: "回复",
      body: "我会先用 contact_workspace 查一下，但这次先回答你的问题：结论是可行的。",
    });
    const execution = await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "这件事可行吗？",
      provider,
    });
    expect(execution.block.body).toContain("结论是可行的");
  });

  it("keeps the reply heading separate from first-result Session metadata", async () => {
    const provider = new ScriptedAgentProvider([], {
      outcome: "reply",
      title: "Current reply",
      body: "Here is the comparison.",
      session_title: "Compare outreach drafts",
    });
    const run = vi.spyOn(provider, "run");
    const execution = await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "Compare these outreach drafts",
      sessionTitleRequested: true,
      contacts: { search: vi.fn(), read: vi.fn() },
      provider,
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ sessionTitleRequested: true }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(execution.block.title).toBe("Current reply");
    expect(execution.providerResult.sessionTitle).toBe("Compare outreach drafts");
  });

  it("passes the named-relationship lookup contract to the provider", async () => {
    const query = vi.fn();
    const provider = {
      id: "routing-policy-test",
      model: "routing-policy-test-v1",
      sdkVersion: "routing-policy-test.v1",
      inputCapabilities: {
        text: true,
        image: false,
        imageUnderstanding: false,
      },
      run: vi.fn(async (request) => {
        expect(request.systemPrompt).toContain(
          "search using clues in the message",
        );
        expect(request.systemPrompt).toContain(
          "read a unique match",
        );
        expect(request.budget.maxDurationMs).toBe(35_000);
        return {
          structuredOutput: {
            outcome: "clarification",
            title: "Which relationship?",
            body: "Share one more exact identity clue.",
          },
          inputTokens: 1,
          outputTokens: 1,
          estimatedUsd: 0,
          turns: 1,
          permissionDenials: [],
        };
      }),
    } satisfies AgentProvider;

    await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "What changed with Leila?",
      provider,
    });

    expect(provider.run).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects wildcard enumeration without querying the account", async () => {
    const query = vi.fn();
    const execution = await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "Show me all contacts",
      provider: new ScriptedAgentProvider(
        [
          {
            tool: "contact_workspace",
            input: { operation: "search", query: "*", maximum_results: 6 },
          },
        ],
        {
          outcome: "clarification",
          title: "Which contact?",
          body: "Name one person or relationship to search.",
        },
      ),
    });

    expect(query).not.toHaveBeenCalled();
    expect(execution.block.kind).toBe("clarification");
  });

  it("keeps a no-match search as a clarification without a fabricated event", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const execution = await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "What changed with Noor?",
      provider: new ScriptedAgentProvider(
        [
          {
            tool: "contact_workspace",
            input: { operation: "search", query: "Noor", maximum_results: 4 },
          },
        ],
        {
          outcome: "clarification",
          title: "I could not find Noor",
          body: "Share one more identity clue, or continue without contact context.",
        },
      ),
    });

    expect(query).toHaveBeenCalledOnce();
    expect(execution.event).toBeNull();
    expect(execution.block.kind).toBe("clarification");
  });

  it("uses only one exact same-Run search result as relationship context", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [personRow()] })
      .mockResolvedValueOnce({
        rows: [
          {
            person_id: personID,
            person_label: "Maya Chen",
            profile_headline: null,
            profile_summary: null,
            profile_provenance_kind: null,
            profile_authored_by_user_id: null,
            profile_revision: null,
            profile_updated_at: null,
            contact_points: [],
            context_id: contextID,
            context_label: "CPO search",
          },
        ],
      });
    const execution = await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "What is happening with Maya?",
      provider: new ScriptedAgentProvider(
        [
          {
            tool: "contact_workspace",
            input: { operation: "search", query: "Maya", maximum_results: 4 },
          },
          {
            tool: "contact_workspace",
            input: {
              operation: "read",
              person_id: personID,
              relationship_context_id: contextID,
            },
          },
        ],
        {
          outcome: "use_contact",
          person_id: personID,
          relationship_context_id: contextID,
        },
      ),
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(execution.event).toEqual({
      kind: "resolved_contact_context",
      person_id: personID,
      person_display_label: "Maya Chen",
      relationship_context_id: contextID,
      relationship_context_display_label: "CPO search",
      tool_summary: "Contact search · Maya Chen · CPO search",
    });
  });

  it("stages a grounded create card without applying a contact write", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const execution = await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "Create Maya Chen as a contact for the CPO search",
      provider: new ScriptedAgentProvider(
        [
          {
            tool: "contact_workspace",
            input: {
              operation: "propose_create",
              display_name: "Maya Chen",
              relationship_context: "CPO search",
              identity_clue: null,
              source_excerpts: ["Maya Chen", "CPO search"],
              reason: "The recruiter explicitly requested a contact draft.",
            },
          },
        ],
        (results) => ({
          outcome: "contact_change_proposal",
          candidate_fingerprint: results[0]?.candidateFingerprint,
        }),
      ),
    });

    expect(query).toHaveBeenCalledOnce();
    expect(execution.event).toMatchObject({
      kind: "contact_change_proposal",
      proposal_kind: "create",
      display_name: "Maya Chen",
      relationship_context: "CPO search",
      requires_user_confirmation: true,
      target_person_id: null,
    });
    expect(execution.block).toMatchObject({
      kind: "identity_review",
      requires_user_decision: true,
    });
  });

  it("returns minimal candidates and refuses to read an ambiguous search", async () => {
    const secondPersonID = "66666666-6666-4666-8666-666666666666";
    const secondContextID = "77777777-7777-4777-8777-777777777777";
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        personRow(),
        personRow({
          personID: secondPersonID,
          contextID: secondContextID,
          contextLabel: "Board search",
        }),
      ],
    });
    const execution = await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "What is happening with Maya Chen?",
      provider: new ScriptedAgentProvider(
        [
          {
            tool: "contact_workspace",
            input: { operation: "search", query: "Maya Chen", maximum_results: 6 },
          },
          {
            tool: "contact_workspace",
            input: {
              operation: "read",
              person_id: personID,
              relationship_context_id: contextID,
            },
          },
        ],
        (results) => {
          expect(results[1]).toMatchObject({
            ok: false,
            error: { code: "CONTACT_READ_NOT_AUTHORIZED" },
          });
          return {
            outcome: "clarification",
            title: "Which Maya?",
            body: "Choose the right relationship.",
          };
        },
      ),
    });

    expect(query).toHaveBeenCalledOnce();
    expect(execution.event).toMatchObject({
      kind: "contact_candidates",
      possible_duplicate: true,
    });
    expect(execution.event?.kind === "contact_candidates"
      ? execution.event.candidates
      : []).toHaveLength(2);
  });

  it("rejects a create proposal whose contact fields were invented", async () => {
    const query = vi.fn();
    const execution = await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "Please create a contact from this message",
      provider: new ScriptedAgentProvider(
        [
          {
            tool: "contact_workspace",
            input: {
              operation: "propose_create",
              display_name: "Invented Person",
              relationship_context: "Invented Search",
              identity_clue: null,
              source_excerpts: ["create a contact"],
              reason: "A model guess.",
            },
          },
        ],
        (results) => {
          expect(results[0]).toMatchObject({
            ok: false,
            error: { code: "CONTACT_PROPOSAL_FIELDS_UNGROUNDED" },
          });
          return {
            outcome: "clarification",
            title: "Who should I add?",
            body: "Please provide the person's name and relationship context.",
          };
        },
      ),
    });

    expect(query).not.toHaveBeenCalled();
    expect(execution.event).toBeNull();
    expect(execution.block.kind).toBe("clarification");
  });

  it("rejects an update when the searched directory revision changed", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [personRow({ profileRevision: 3 })],
    });
    const execution = await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "Update Maya Chen in the CPO search",
      provider: new ScriptedAgentProvider(
        [
          {
            tool: "contact_workspace",
            input: { operation: "search", query: "Maya Chen", maximum_results: 4 },
          },
          {
            tool: "contact_workspace",
            input: {
              operation: "propose_update",
              person_id: personID,
              relationship_context_id: contextID,
              base_revision: 2,
              display_name: "Maya Chen",
              relationship_context: "CPO search",
              identity_clue: null,
              source_excerpts: ["Maya Chen", "CPO search"],
              reason: "The recruiter asked for an update.",
            },
          },
        ],
        (results) => {
          expect(results[1]).toMatchObject({
            ok: false,
            error: { code: "CONTACT_UPDATE_TARGET_STALE_OR_UNRESOLVED" },
          });
          return {
            outcome: "clarification",
            title: "Review the current contact",
            body: "The contact changed; search again before proposing an update.",
          };
        },
      ),
    });

    expect(query).toHaveBeenCalledOnce();
    expect(execution.event?.kind).toBe("contact_candidates");
  });

  it("stages a contact detail update only against the exact searched target", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [personRow({ profileRevision: 3 })],
    });
    const execution = await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "Update Maya Chen in the CPO search with maya@example.com",
      provider: new ScriptedAgentProvider(
        [
          {
            tool: "contact_workspace",
            input: {
              operation: "search",
              query: "Maya Chen",
              maximum_results: 4,
            },
          },
          {
            tool: "contact_workspace",
            input: {
              operation: "propose_update",
              person_id: personID,
              relationship_context_id: contextID,
              base_revision: 3,
              display_name: "Maya Chen",
              relationship_context: "CPO search",
              identity_clue: {
                type: "email",
                value: "maya@example.com",
              },
              source_excerpts: ["Maya Chen", "maya@example.com"],
              reason: "The recruiter requested a reviewable contact detail update.",
            },
          },
        ],
        (results) => ({
          outcome: "contact_change_proposal",
          candidate_fingerprint: results[1]?.candidateFingerprint,
        }),
      ),
    });

    expect(query).toHaveBeenCalledOnce();
    expect(execution.event).toMatchObject({
      kind: "contact_change_proposal",
      proposal_kind: "update",
      target_person_id: personID,
      target_relationship_context_id: contextID,
      base_revision: 3,
      requires_user_confirmation: true,
    });
  });

  it("enforces the per-turn contact Tool call budget", async () => {
    const query = vi.fn();
    const calls = Array.from({ length: 7 }, () => ({
      tool: "contact_workspace" as const,
      input: { operation: "search", query: "*", maximum_results: 4 },
    }));
    const execution = await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "Find Maya",
      provider: new ScriptedAgentProvider(calls, (results) => {
        expect(results[6]).toMatchObject({
          ok: false,
          error: { code: "CONTACT_TOOL_BUDGET_EXHAUSTED" },
        });
        return {
          outcome: "clarification",
          title: "Which contact?",
          body: "Give me one specific contact clue.",
        };
      }),
    });

    expect(query).not.toHaveBeenCalled();
    expect(execution.block.kind).toBe("clarification");
  });

  it("does not let a generic reply silently use searched contact data", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [personRow()] });

    const execution = await executeWorkspaceConversationAgent({
      database: { query } as unknown as DatabaseClient,
      auth,
      objective: "Tell me about Maya Chen",
      provider: new ScriptedAgentProvider(
        [
          {
            tool: "contact_workspace",
            input: { operation: "search", query: "Maya Chen", maximum_results: 4 },
          },
        ],
        {
          outcome: "reply",
          title: "Maya Chen",
          body: "A reply based on the hidden search result.",
        },
      ),
    });
    // A helpful answer is allowed, but it must not surface the searched contact
    // as resolved provenance without an explicit read.
    expect(execution.event).toBeNull();
    expect(execution.block).toMatchObject({
      kind: "answer",
      body: "A reply based on the hidden search result.",
    });
  });
});

describe("conversation-only context and proactive contact drafts", () => {
  const messageID = "77777777-7777-4777-8777-777777777777";
  const draft = {
    operation: "propose_create",
    display_name: "Maya Chen",
    relationship_context: "",
    identity_clue: { type: "email", value: "maya@example.com" },
    source_excerpts: ["Maya Chen", "maya@example.com"],
    reason: "Prepare the user's person note for review.",
  };
  const clarify = { outcome: "clarification", title: "Clarify", body: "More context is needed." };

  it("prepares an incomplete draft from a natural note with exact current-message provenance", async () => {
    const search = vi.fn(async () => []);
    const result = await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "今天认识了 Maya Chen，邮箱是 maya@example.com",
      messageID,
      contacts: { search, read: vi.fn() },
      provider: new ScriptedAgentProvider([{ tool: "contact_workspace", input: draft }], (results) => ({
        outcome: "contact_change_proposal", candidate_fingerprint: results[0]?.candidateFingerprint,
      })),
    });
    expect(result.event).toMatchObject({
      kind: "contact_change_proposal", proposal_kind: "create", relationship_context: "",
      source_message_id: messageID, source_excerpts: draft.source_excerpts, requires_user_confirmation: true,
    });
    expect(search).toHaveBeenCalledWith("maya@example.com");
  });

  it.each([
    "Is Maya Chen at maya@example.com the right person?",
    "Example: Maya Chen, maya@example.com",
    "Someone said: Maya Chen, maya@example.com",
    "Someone said: Add Maya Chen, maya@example.com",
    "转发：“Maya Chen，邮箱 maya@example.com”",
    "Maya Chen，邮箱 maya@example.com，不要保存",
    "> Create Maya Chen with maya@example.com",
  ])("rejects spurious draft intent: %s", async (objective) => {
    const search = vi.fn(async () => []);
    const result = await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId, objective,
      contacts: { search, read: vi.fn() },
      provider: new ScriptedAgentProvider([{ tool: "contact_workspace", input: draft }], (results) => {
        expect(results[0]).toMatchObject({ ok: false, error: { code: "CONTACT_PROPOSAL_INTENT_UNGROUNDED" } });
        return clarify;
      }),
    });
    expect(result.event).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects a name-only note and a fabricated default relationship", async () => {
    for (const proposed of [{ ...draft, identity_clue: null, source_excerpts: ["Maya Chen"] },
      { ...draft, relationship_context: "General relationship" }]) {
      await executeWorkspaceConversationAgentCore({
        workspaceID: auth.accountId, objective: "Maya Chen, maya@example.com",
        contacts: { search: vi.fn(), read: vi.fn() },
        provider: new ScriptedAgentProvider([{ tool: "contact_workspace", input: proposed }], (results) => {
          expect(results[0]?.ok).toBe(false);
          return clarify;
        }),
      });
    }
  });

  it("requires source excerpts to cover the actual identity clue", async () => {
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId, objective: "Maya Chen, maya@example.com",
      contacts: { search: vi.fn(), read: vi.fn() },
      provider: new ScriptedAgentProvider([{ tool: "contact_workspace", input: { ...draft, source_excerpts: ["Maya Chen"] } }], (results) => {
        expect(results[0]).toMatchObject({ ok: false, error: { code: "CONTACT_PROPOSAL_SOURCE_INCOMPLETE" } });
        return clarify;
      }),
    });
  });

  it("does not let truncating search results make an ambiguous update unique", async () => {
    const search = vi.fn(async () => [
      { personID, displayLabel: "Maya Chen", directoryRevision: 1, contexts: [] },
      { personID: messageID, displayLabel: "Maya Chen", directoryRevision: 1, contexts: [] },
    ]);
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId, objective: "Update Maya Chen with maya@example.com",
      contacts: { search, read: vi.fn() },
      provider: new ScriptedAgentProvider([
        { tool: "contact_workspace", input: { operation: "search", query: "Maya Chen", maximum_results: 1 } },
        { tool: "contact_workspace", input: { ...draft, operation: "propose_update", person_id: personID, base_revision: 1 } },
      ], (results) => {
        expect(results[1]).toMatchObject({ ok: false, error: { code: "CONTACT_UPDATE_TARGET_STALE_OR_UNRESOLVED" } });
        return clarify;
      }),
    });
  });

  it("does not resolve duplicate names when one person has no relationship yet", async () => {
    const read = vi.fn();
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId, objective: "Find Maya Chen",
      contacts: { search: vi.fn(async () => [
        { personID, displayLabel: "Maya Chen", directoryRevision: 1, contexts: [{ id: contextID, displayLabel: "CPO search" }] },
        { personID: messageID, displayLabel: "Maya Chen", directoryRevision: 1, contexts: [] },
      ]), read },
      provider: new ScriptedAgentProvider([
        { tool: "contact_workspace", input: { operation: "search", query: "Maya Chen", maximum_results: 1 } },
        { tool: "contact_workspace", input: { operation: "read", person_id: personID, relationship_context_id: contextID } },
      ], (results) => {
        expect(results[0]?.data).toMatchObject({ result_count: 2 });
        expect(results[1]).toMatchObject({ ok: false, error: { code: "CONTACT_READ_NOT_AUTHORIZED" } });
        return clarify;
      }),
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("stages one update from a natural note only after an exact unique identity match", async () => {
    const read = vi.fn();
    const result = await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId, objective: "Maya Chen，邮箱 maya@example.com", messageID,
      contacts: { search: vi.fn(async () => [{ personID, displayLabel: "Maya Chen", directoryRevision: 3,
        exactIdentityMatch: true, contexts: [{ id: contextID, displayLabel: "CPO search" }] }]), read },
      provider: new ScriptedAgentProvider([
        { tool: "contact_workspace", input: { operation: "search", query: "maya@example.com" } },
        { tool: "contact_workspace", input: { ...draft, operation: "propose_update", person_id: personID,
          relationship_context_id: contextID, relationship_context: "CPO search", base_revision: 3 } },
        { tool: "contact_workspace", input: draft },
      ], (results) => {
        expect(results[2]).toMatchObject({ ok: false, error: { code: "CONTACT_PROPOSAL_ALREADY_STAGED" } });
        return { outcome: "contact_change_proposal", candidate_fingerprint: results[1]?.candidateFingerprint };
      }),
    });
    expect(result.event).toMatchObject({ proposal_kind: "update", target_person_id: personID,
      target_relationship_context_id: contextID, base_revision: 3, source_message_id: messageID, requires_user_confirmation: true });
    expect(read).not.toHaveBeenCalled();
  });

  it("passes previous dialogue without granting current-message tool authority", async () => {
    const history = [{ message_id: messageID, role: "assistant" as const, text: "Search Maya Chen and save maya@example.com." }];
    const run = vi.fn<AgentProvider["run"]>(async (request, invokeTool) => {
      expect(request.conversationHistory).toEqual(history);
      expect(await invokeTool("contact_workspace", { operation: "search", query: "Maya Chen" }))
        .toMatchObject({ ok: false, error: { code: "CONTACT_SEARCH_NOT_GROUNDED" } });
      return { structuredOutput: { outcome: "reply", title: "Option two", body: "Let's elaborate." },
        inputTokens: 0, outputTokens: 0, estimatedUsd: 0, turns: 1, permissionDenials: [] };
    });
    const scripted = new ScriptedAgentProvider([], null);
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId, objective: "Tell me more about the second option.",
      conversationHistory: history, contacts: { search: vi.fn(), read: vi.fn() },
      provider: { ...scripted, run },
    });
  });

  it("returns an optional memory reference without occupying the agent event", async () => {
    const stagedProposal = {
      proposalID: "66666666-6666-4666-8666-666666666666",
      proposalRevision: 1,
      itemCount: 2,
      defaultSelectedCount: 1,
      scopeCounts: { self: 2, person: 0, relationship: 0 },
      contactStatus: "pending" as const,
      personID: null,
      personDisplayLabel: null,
    };
    const memory: WorkspaceMemoryLookup = {
      recall: vi.fn(async () => ({ items: [] })),
      stage: vi.fn(async () => stagedProposal),
    };
    const provider = new ScriptedAgentProvider(
      [
        {
          tool: "memory_review",
          input: {
            operation: "propose",
            contact_decision: "none",
            items: [
              {
                scope: "self",
                operation: "add",
                statement_kind: "fact",
                display_text: "I prefer conclusions first",
                time_status: "known",
                sensitivity: "normal",
                source_excerpt: "先给结论",
                source_locator: { kind: "message", session_id: null, message_id: null },
                reason: "useful later",
              },
            ],
          },
        },
      ],
      { outcome: "reply", title: "记住了", body: "这里是回答。" },
    );
    const execution = await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "先给结论",
      contacts: { search: vi.fn(), read: vi.fn() },
      memory,
      provider,
    });
    expect(execution.event).toBeNull();
    expect(execution.memoryProposal).toEqual({
      proposal_id: stagedProposal.proposalID,
      revision: 1,
    });
    expect(execution.block).toMatchObject({
      kind: "answer",
      body: "这里是回答。",
    });
  });

  it("keeps the helpful answer when the optional memory stage fails", async () => {
    const memory: WorkspaceMemoryLookup = {
      recall: vi.fn(async () => ({ items: [] })),
      stage: vi.fn(async () => {
        throw new Error("MEMORY_UNAVAILABLE");
      }),
    };
    const provider = new ScriptedAgentProvider(
      [
        {
          tool: "memory_review",
          input: {
            operation: "propose",
            contact_decision: "none",
            items: [
              {
                scope: "self",
                operation: "add",
                statement_kind: "fact",
                display_text: "I prefer conclusions first",
                time_status: "known",
                sensitivity: "normal",
                source_excerpt: "先给结论",
                source_locator: { kind: "message", session_id: null, message_id: null },
                reason: "useful later",
              },
            ],
          },
        },
      ],
      { outcome: "reply", title: "记住了", body: "这里是回答。" },
    );
    const run = vi.spyOn(provider, "run");
    const execution = await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "先给结论",
      contacts: { search: vi.fn(), read: vi.fn() },
      memory,
      provider,
    });
    expect(run).toHaveBeenCalledOnce();
    expect(execution.memoryProposal).toBeNull();
    expect(execution.block).toMatchObject({ kind: "answer", body: "这里是回答。" });
  });

  it("admits a bounded image clue only from a source admitted to this Run", async () => {
    const artifactId = "conversation-image-44444444-4444-4444-8444-444444444444-0-abc";
    const search = vi.fn(async () => [
      { personID, displayLabel: "陈宇", directoryRevision: 1, contexts: [{ id: contextID, displayLabel: "关系" }], exactIdentityMatch: true },
    ]);
    const imagePart = {
      kind: "image" as const,
      artifactID: artifactId,
      mimeType: "image/jpeg" as const,
      byteSize: 12,
      contentHash: "a".repeat(64),
      dataBase64: "AAAA",
    };
    const steps = [{
      tool: "contact_workspace",
      input: {
        operation: "search",
        query: "@chenyu_demo",
        source_clue: {
          clue: "@chenyu_demo",
          source_locator: { kind: "image_region", artifact_id: artifactId, image_index: 0 },
        },
      },
    }];
    let admittedResults: readonly AgentToolResult[] = [];
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "Please summarize this screenshot.",
      sourceText: "",
      contacts: { search, read: vi.fn() },
      memory: { recall: vi.fn(async () => ({ items: [] })), stage: vi.fn(async () => null) },
      inputParts: [imagePart],
      imageIsCurrent: async () => true,
      provider: new ScriptedAgentProvider(steps, (results) => {
        admittedResults = results;
        return { outcome: "reply", title: "已读", body: "这是图片摘要。" } as const;
      }),
    });
    expect(search).toHaveBeenCalledOnce();
    expect(admittedResults[0]).toMatchObject({ ok: true });

    // A foreign artifact ID cannot authorize the same lookup.
    const foreignSearch = vi.fn();
    let foreignResults: readonly AgentToolResult[] = [];
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "Please summarize this screenshot.",
      sourceText: "",
      contacts: { search: foreignSearch, read: vi.fn() },
      memory: { recall: vi.fn(async () => ({ items: [] })), stage: vi.fn(async () => null) },
      inputParts: [{ ...imagePart, artifactID: "conversation-image-foreign-0-xyz" }],
      provider: new ScriptedAgentProvider(steps, (results) => {
        foreignResults = results;
        return { outcome: "reply", title: "已读", body: "这是图片摘要。" } as const;
      }),
    });
    expect(foreignSearch).not.toHaveBeenCalled();
    expect(foreignResults[0]).toMatchObject({ ok: false, error: { code: "CONTACT_SEARCH_NOT_GROUNDED" } });

    // An admitted artifact with a mismatched image index is also rejected.
    const wrongIndexSearch = vi.fn();
    let wrongIndexResults: readonly AgentToolResult[] = [];
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "Please summarize this screenshot.",
      sourceText: "",
      contacts: { search: wrongIndexSearch, read: vi.fn() },
      memory: { recall: vi.fn(async () => ({ items: [] })), stage: vi.fn(async () => null) },
      inputParts: [imagePart],
      imageIsCurrent: async () => true,
      provider: new ScriptedAgentProvider(
        [{
          tool: "contact_workspace",
          input: {
            operation: "search",
            query: "@chenyu_demo",
            source_clue: {
              clue: "@chenyu_demo",
              source_locator: { kind: "image_region", artifact_id: artifactId, image_index: 3 },
            },
          },
        }],
        (toolResults) => {
          wrongIndexResults = toolResults;
          return { outcome: "reply", title: "已读", body: "这是图片摘要。" } as const;
        },
      ),
    });
    expect(wrongIndexSearch).not.toHaveBeenCalled();
    expect(wrongIndexResults[0]).toMatchObject({ ok: false, error: { code: "CONTACT_SEARCH_NOT_GROUNDED" } });
  });

  it("denies personalized recall for an unresolved same-name search result", async () => {
    const otherPerson = "77777777-7777-4777-8777-777777777777";
    const otherContext = "88888888-8888-4888-8888-888888888888";
    const search = vi.fn(async () => [
      { personID, displayLabel: "陈宇", directoryRevision: 1, contexts: [{ id: contextID, displayLabel: "甲" }], exactIdentityMatch: false },
      { personID: otherPerson, displayLabel: "陈宇", directoryRevision: 1, contexts: [{ id: otherContext, displayLabel: "乙" }], exactIdentityMatch: false },
    ]);
    const recall = vi.fn(async () => ({ items: [] }));
    let results: readonly AgentToolResult[] = [];
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "陈宇 最近有什么变化",
      contacts: { search, read: vi.fn() },
      memory: { recall, stage: vi.fn(async () => null) },
      provider: new ScriptedAgentProvider(
        [
          { tool: "contact_workspace", input: { operation: "search", query: "陈宇", maximum_results: 4 } },
          { tool: "memory_review", input: { operation: "recall", person_id: personID, relationship_context_id: contextID } },
        ],
        (toolResults) => {
          results = toolResults;
          return { outcome: "reply", title: "不能确定", body: "有两位同名联系人，请先确认。" } as const;
        },
      ),
    });
    expect(recall).toHaveBeenCalledExactlyOnceWith({ personID: null, contextID: null, scope: "self", limit: 100 });
    expect(results[1]).toMatchObject({ ok: false, error: { code: "MEMORY_RECALL_NOT_AUTHORIZED" } });
  });

  it("permits personalized recall only for a unique server-confirmed handle", async () => {
    const search = vi.fn(async () => [
      { personID, displayLabel: "陈宇", directoryRevision: 1, contexts: [{ id: contextID, displayLabel: "关系" }], exactIdentityMatch: true, confirmedHandleType: "email", confirmedHandleValue: "chenyu@example.com" },
    ]);
    const recall = vi.fn(async () => ({ items: [] }));
    let results: readonly AgentToolResult[] = [];
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "chenyu@example.com 最近有什么变化",
      contacts: { search, read: vi.fn() },
      memory: { recall, stage: vi.fn(async () => null) },
      provider: new ScriptedAgentProvider(
        [
          { tool: "contact_workspace", input: { operation: "search", query: "chenyu@example.com", maximum_results: 4 } },
          { tool: "memory_review", input: { operation: "recall", person_id: personID, relationship_context_id: contextID } },
        ],
        (toolResults) => {
          results = toolResults;
          return { outcome: "reply", title: "最近变化", body: "目前没有新的变化。" } as const;
        },
      ),
    });
    expect(recall).toHaveBeenCalledTimes(2);
    expect(results[1]).toMatchObject({ ok: true });
  });

  it("does not let a model contact read escalate to personalized recall", async () => {
    // The model resolved a unique name and read the contact, but a read is a
    // model call, not a human identity binding, so personalized Memory stays
    // forbidden until a confirmed handle or an explicit human binding exists.
    const search = vi.fn(async () => [
      { personID, displayLabel: "陈宇", directoryRevision: 1, contexts: [{ id: contextID, displayLabel: "关系" }], exactIdentityMatch: false },
    ]);
    const recall = vi.fn(async () => ({ items: [] }));
    let results: readonly AgentToolResult[] = [];
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "陈宇 最近有什么变化",
      contacts: {
        search,
        read: vi.fn(async () => ({
          person: { id: personID, displayLabel: "陈宇", directoryRevision: 1 },
          relationship: { id: contextID, displayLabel: "关系" },
        })),
      },
      memory: { recall, stage: vi.fn(async () => null) },
      provider: new ScriptedAgentProvider(
        [
          { tool: "contact_workspace", input: { operation: "search", query: "陈宇", maximum_results: 4 } },
          { tool: "contact_workspace", input: { operation: "read", person_id: personID, relationship_context_id: contextID } },
          { tool: "memory_review", input: { operation: "recall", person_id: personID, relationship_context_id: contextID } },
        ],
        (toolResults) => {
          results = toolResults;
          return { outcome: "reply", title: "不能确定", body: "需要先确认身份。" } as const;
        },
      ),
    });
    expect(recall).toHaveBeenCalledExactlyOnceWith({ personID: null, contextID: null, scope: "self", limit: 100 });
    expect(results[2]).toMatchObject({ ok: false, error: { code: "MEMORY_RECALL_NOT_AUTHORIZED" } });
  });

  it("binds a human identity entry to personalized recall without a model read", async () => {
    const recall = vi.fn(async () => ({ items: [] }));
    let results: readonly AgentToolResult[] = [];
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "最近有什么变化",
      contacts: { search: vi.fn(), read: vi.fn() },
      memory: { recall, stage: vi.fn(async () => null) },
      humanIdentityBinding: { personID, contextID },
      provider: new ScriptedAgentProvider(
        [{ tool: "memory_review", input: { operation: "recall", person_id: personID, relationship_context_id: contextID } }],
        (toolResults) => {
          results = toolResults;
          return { outcome: "reply", title: "变化", body: "没有新的变化。" } as const;
        },
      ),
    });
    expect(recall).toHaveBeenCalledTimes(2);
    expect(results[0]).toMatchObject({ ok: true });
  });

  it("supplies a neutral organizing relationship label for a new contact", async () => {
    const stagedProposal = {
      proposalID: "99999999-9999-4999-8999-999999999999",
      proposalRevision: 1,
      itemCount: 1,
      defaultSelectedCount: 1,
      scopeCounts: { self: 0, person: 0, relationship: 1 },
      contactStatus: "pending" as const,
      personID: null,
      personDisplayLabel: "陈宇",
    };
    const stage = vi.fn(async () => stagedProposal);
    const memory: WorkspaceMemoryLookup = { recall: vi.fn(async () => ({ items: [] })), stage };
    const provider = new ScriptedAgentProvider(
      [
        {
          tool: "memory_review",
          input: {
            operation: "propose",
            contact_decision: "new",
            person_display_label: "陈宇",
            items: [
              {
                scope: "relationship",
                operation: "add",
                statement_kind: "source_statement",
                speaker: "陈宇",
                display_text: "我们约定下周四先看文字方案",
                time_status: "known",
                sensitivity: "normal",
                source_excerpt: "我们约定下周四先看文字方案",
                source_locator: { kind: "message", session_id: null, message_id: null },
                reason: "later reference",
              },
            ],
          },
        },
      ],
      { outcome: "reply", title: "已记录", body: "这里是回答。" },
    );
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "陈宇：我们约定下周四先看文字方案",
      contacts: { search: vi.fn(), read: vi.fn() },
      memory,
      provider,
    });
    expect(stage).toHaveBeenCalledWith(
      expect.objectContaining({
        newContact: expect.objectContaining({ relationship_context: "与陈宇的交流" }),
      }),
    );

    // An ungrounded model label cannot contaminate a new identity.
    const explicitStage = vi.fn(async () => stagedProposal);
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "陈宇说先给结论",
      contacts: { search: vi.fn(), read: vi.fn() },
      memory: { recall: vi.fn(async () => ({ items: [] })), stage: explicitStage },
      provider: new ScriptedAgentProvider(
        [
          {
            tool: "memory_review",
            input: {
              operation: "propose",
              contact_decision: "new",
              person_display_label: "陈宇",
              relationship_display_label: "设计交流",
              items: [
                {
                  scope: "self",
                  operation: "add",
                  statement_kind: "fact",
                  display_text: "先给结论",
                  time_status: "known",
                  sensitivity: "normal",
                  source_excerpt: "先给结论",
                  source_locator: { kind: "message", session_id: null, message_id: null },
                  reason: "later",
                },
              ],
            },
          },
        ],
        { outcome: "reply", title: "已记录", body: "这里是回答。" },
      ),
    });
    expect(explicitStage).toHaveBeenCalledWith(
      expect.objectContaining({
        newContact: expect.objectContaining({ relationship_context: "与陈宇的交流" }),
      }),
    );
  });
  it("rechecks handle ownership after search instead of recalling the cached person", async () => {
    const original = { personID, displayLabel: "陈宇", directoryRevision: 1, contexts: [{ id: contextID, displayLabel: "关系" }], exactIdentityMatch: true, confirmedHandleType: "email", confirmedHandleValue: "chenyu@example.com" };
    const search = vi.fn().mockResolvedValueOnce([original]).mockResolvedValue([{ ...original, personID: "77777777-7777-4777-8777-777777777777" }]);
    const recall = vi.fn(); let observed: readonly AgentToolResult[] = [];
    await executeWorkspaceConversationAgentCore({ workspaceID: auth.accountId, objective: "chenyu@example.com 最近有什么变化", contacts: { search, read: vi.fn() }, memory: { recall, stage: vi.fn() },
      provider: new ScriptedAgentProvider([
        { tool: "contact_workspace", input: { operation: "search", query: "chenyu@example.com" } },
        { tool: "memory_review", input: { operation: "recall", person_id: personID, relationship_context_id: contextID } },
      ], results => { observed = results; return { outcome: "reply", title: "待确认", body: "账号归属已变化，请重新确认。" }; }) });
    expect(search).toHaveBeenCalledTimes(2); expect(recall).toHaveBeenCalledExactlyOnceWith({ personID: null, contextID: null, scope: "self", limit: 100 });
    expect(observed[1]).toMatchObject({ ok: false, error: { code: "MEMORY_RECALL_NOT_AUTHORIZED" } });
  });

  it.each([true, false])("allows an image handle only while its exact source remains current: %s", async current => {
    const artifactId = "conversation-image-44444444-4444-4444-8444-444444444444-0-55555555-5555-4555-8555-555555555555";
    const search = vi.fn(async () => [{ personID, displayLabel: "陈宇", directoryRevision: 1, contexts: [{ id: contextID, displayLabel: "关系" }], exactIdentityMatch: true, confirmedHandleType: "email", confirmedHandleValue: "chenyu@example.com" }]);
    const recall = vi.fn(async () => ({ items: [] }));
    const imageIsCurrent = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(current);
    let observed: readonly AgentToolResult[] = [];
    await executeWorkspaceConversationAgentCore({ workspaceID: auth.accountId, objective: "Summarize image", sourceText: "", contacts: { search, read: vi.fn() }, memory: { recall, stage: vi.fn() }, imageIsCurrent,
      inputParts: [{ kind: "image", artifactID: artifactId, mimeType: "image/jpeg", byteSize: 3, contentHash: "a".repeat(64), dataBase64: "AAAA" }],
      provider: new ScriptedAgentProvider([
        { tool: "contact_workspace", input: { operation: "search", query: "chenyu@example.com", source_clue: { clue: "chenyu@example.com", source_locator: { kind: "image_region", artifact_id: artifactId, image_index: 0 } } } },
        { tool: "memory_review", input: { operation: "recall", person_id: personID, relationship_context_id: contextID } },
      ], results => { observed=results; return { outcome: "reply", title: "图片摘要", body: "这是本次来源。" }; }) });
    expect(recall).toHaveBeenCalledTimes(current ? 2 : 1);
    expect(observed[1]?.ok).toBe(current);
  });

});

describe("shared screenshot relationship review", () => {
  const artifactId = "conversation-image-44444444-4444-4444-8444-444444444444-0-55555555-5555-4555-8555-555555555555";
  const foreignArtifactId = "conversation-image-99999999-9999-4999-8999-999999999999-0-55555555-5555-4555-8555-555555555555";
  const imagePart = {
    kind: "image" as const,
    artifactID: artifactId,
    mimeType: "image/jpeg" as const,
    byteSize: 12,
    contentHash: "a".repeat(64),
    dataBase64: "AAAA",
  };
  const stagedProposal = {
    proposalID: "88888888-8888-4888-8888-888888888888",
    proposalRevision: 1,
    itemCount: 1,
    defaultSelectedCount: 1,
    scopeCounts: { self: 0, person: 0, relationship: 1 },
    contactStatus: "pending" as const,
    personID: null,
    personDisplayLabel: "周明",
  };
  const imageLocator = (artifact = artifactId) => ({
    kind: "image_region" as const,
    artifact_id: artifact,
    image_index: 0,
  });

  // This scripted-provider test verifies the host plumbing and gates only: the
  // image is a mock admitted artifact and the excerpts describe the synthetic
  // fixture. It is not a test of image understanding.
  it("plumbs a name-only new-contact review from an admitted screenshot without auto-binding a same-name match", async () => {
    const existingPerson = "66666666-6666-4666-8666-666666666666";
    const search = vi.fn(async () => [
      { personID: existingPerson, displayLabel: "周明", directoryRevision: 1, contexts: [], exactIdentityMatch: false },
    ]);
    const recall = vi.fn(async () => ({ items: [] }));
    const stage = vi.fn(async (_input: Parameters<WorkspaceMemoryLookup["stage"]>[0]) => stagedProposal);
    const memory: WorkspaceMemoryLookup = { recall, stage };
    const provider = new ScriptedAgentProvider(
      [
        {
          tool: "contact_workspace",
          input: {
            operation: "search",
            query: "周明",
            source_clue: { clue: "周明", source_locator: imageLocator() },
          },
        },
        { tool: "memory_review", input: { operation: "recall" } },
        {
          tool: "memory_review",
          input: {
            operation: "propose",
            contact_decision: "new",
            person_display_label: "周明",
            relationship_display_label: "松风9月读书群（南街）",
            new_contact_source_locator: imageLocator(),
            items: [
              {
                scope: "relationship",
                dependence_kind: "relationship",
                operation: "add",
                statement_kind: "source_statement",
                display_text: "这段私聊中双方互报姓名",
                speaker: "周明",
                time_status: "unknown",
                sensitivity: "normal",
                source_excerpt: "周明",
                source_locator: imageLocator(),
                reason: "以后要跟进这段关系",
              },
              {
                scope: "relationship",
                dependence_kind: "relationship",
                operation: "add",
                statement_kind: "source_statement",
                display_text: "用户自我介绍提到来自松风9月读书群（南街）",
                speaker: "self",
                time_status: "unknown",
                sensitivity: "normal",
                source_excerpt: "I am Lin from 松风9月读书群（南街）",
                source_locator: imageLocator(),
                reason: "关系的来源线索",
              },
              {
                scope: "relationship",
                dependence_kind: "relationship",
                operation: "add",
                statement_kind: "source_statement",
                display_text: "截图第一次可见的加好友事件在周五 20:18，具体日历日期未知",
                speaker: "self",
                time_status: "unknown",
                sensitivity: "normal",
                source_excerpt: "Friday 20:18",
                source_locator: imageLocator(),
                reason: "关系开始时间的来源",
              },
            ],
          },
        },
      ],
      { outcome: "reply", title: "已整理", body: "这位是周明，来自松风9月读书群（南街）。" },
    );
    const execution = await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "The user sent one or more images without any accompanying text.",
      sourceText: "",
      contacts: { search, read: vi.fn() },
      memory,
      inputParts: [imagePart],
      imageIsCurrent: async () => true,
      provider,
    });

    expect(search).toHaveBeenCalledOnce();
    expect(recall.mock.calls).toEqual([
      [{ personID: null, contextID: null, scope: "self", limit: 100 }],
      [{ personID: null, contextID: null, scope: undefined, cursor: undefined,
        identityClue: null, imageAuthority: null }],
    ]);
    expect(stage).toHaveBeenCalledWith(
      expect.objectContaining({
        contactDecision: "new",
        personID: null,
        identityAuthority: "tentative",
        newContact: expect.objectContaining({
          display_label: "周明",
          relationship_context: "与周明的交流",
          source_locator: expect.objectContaining({ kind: "image_region", artifact_id: artifactId }),
        }),
      }),
    );
    const stagedItems = stage.mock.calls[0]![0].items;
    expect(stagedItems).toHaveLength(3);
    expect(stagedItems.every((item) => item.time_status === "unknown" && !("valid_time" in item))).toBe(true);
    // The group origin is attributed to the owner's own introduction, never to
    // the counterparty's membership.
    const origin = stagedItems.find((item) => item.display_text.includes("松风9月读书群"));
    expect(origin).toMatchObject({ speaker: "self", source_excerpt: "I am Lin from 松风9月读书群（南街）" });
    const addFriend = stagedItems.find((item) => item.display_text.includes("加好友"));
    expect(addFriend).toMatchObject({ time_status: "unknown", source_excerpt: "Friday 20:18" });
    expect(execution.memoryProposal).toEqual({ proposal_id: stagedProposal.proposalID, revision: 1 });
  });

  it("refuses to auto-bind a same-name existing contact from a name-only screenshot", async () => {
    const existingPerson = "66666666-6666-4666-8666-666666666666";
    const search = vi.fn(async () => [
      { personID: existingPerson, displayLabel: "周明", directoryRevision: 1, contexts: [{ id: contextID, displayLabel: "读书群" }], exactIdentityMatch: false },
    ]);
    const stage = vi.fn(async () => stagedProposal);
    let observed: readonly AgentToolResult[] = [];
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "The user sent one or more images without any accompanying text.",
      sourceText: "",
      contacts: { search, read: vi.fn() },
      memory: { recall: vi.fn(async () => ({ items: [] })), stage },
      inputParts: [imagePart],
      imageIsCurrent: async () => true,
      provider: new ScriptedAgentProvider(
        [
          { tool: "contact_workspace", input: { operation: "search", query: "周明", source_clue: { clue: "周明", source_locator: imageLocator() } } },
          {
            tool: "memory_review",
            input: {
              operation: "propose",
              contact_decision: "existing",
              person_id: existingPerson,
              relationship_context_id: contextID,
              items: [
                {
                  scope: "person",
                  operation: "add",
                  statement_kind: "source_statement",
                  display_text: "周明在群里自报姓名",
                  speaker: "周明",
                  time_status: "unknown",
                  sensitivity: "normal",
                  source_excerpt: "周明",
                  source_locator: imageLocator(),
                  reason: "以后要跟进",
                },
              ],
            },
          },
        ],
        (results) => {
          observed = results;
          return { outcome: "clarification", title: "需要确认", body: "请先确认是否是同一位周明。" };
        },
      ),
    });
    expect(stage).not.toHaveBeenCalled();
    expect(observed[1]).toMatchObject({ ok: false, error: { code: "MEMORY_SCOPE_NOT_AUTHORIZED" } });
  });

  it("rejects a new-contact image locator that was not admitted to this Run", async () => {
    const stage = vi.fn(async () => stagedProposal);
    let observed: readonly AgentToolResult[] = [];
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "The user sent one or more images without any accompanying text.",
      sourceText: "",
      contacts: { search: vi.fn(), read: vi.fn() },
      memory: { recall: vi.fn(async () => ({ items: [] })), stage },
      inputParts: [imagePart],
      imageIsCurrent: async () => true,
      provider: new ScriptedAgentProvider(
        [
          {
            tool: "memory_review",
            input: {
              operation: "propose",
              contact_decision: "new",
              person_display_label: "周明",
              new_contact_source_locator: imageLocator(foreignArtifactId),
              items: [
                {
                  scope: "person",
                  operation: "add",
                  statement_kind: "source_statement",
                  display_text: "周明在群里自报姓名",
                  speaker: "周明",
                  time_status: "unknown",
                  sensitivity: "normal",
                  source_excerpt: "周明",
                  source_locator: imageLocator(),
                  reason: "以后要跟进",
                },
              ],
            },
          },
        ],
        (results) => {
          observed = results;
          return { outcome: "reply", title: "已整理", body: "未保存任何内容。" };
        },
      ),
    });
    expect(stage).not.toHaveBeenCalled();
    expect(observed[0]).toMatchObject({ ok: false, error: { code: "MEMORY_SOURCE_NOT_ADMITTED" } });
  });

  it("does not use a revoked screenshot as a search source", async () => {
    const contactSearch = vi.fn(async () => []);
    let observed: readonly AgentToolResult[] = [];
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "The user sent one or more images without any accompanying text.",
      sourceText: "",
      contacts: { search: contactSearch, read: vi.fn() },
      memory: { recall: vi.fn(async () => ({ items: [] })), stage: vi.fn() },
      inputParts: [imagePart],
      imageIsCurrent: async () => false,
      provider: new ScriptedAgentProvider(
        [
          { tool: "contact_workspace", input: { operation: "search", query: "周明", source_clue: { clue: "周明", source_locator: imageLocator() } } },
        ],
        (results) => {
          observed = results;
          return { outcome: "reply", title: "来源不可用", body: "这张截图当前不可用，未保存内容。" };
        },
      ),
    });
    expect(contactSearch).not.toHaveBeenCalled();
    expect(observed[0]).toMatchObject({ ok: false, error: { code: "CONTACT_SEARCH_NOT_GROUNDED" } });
  });

  it("rejects a Memory proposal whose admitted screenshot source is no longer current", async () => {
    // The artifact is admitted by this Run, so artifact admission passes, but
    // the host's current-source callback reports it revoked/expired. In
    // production that callback is `imageCurrent`, which checks expiry,
    // session/entry ownership, the content hash, and the
    // memory_source_revocations ledger; a revoked source must be refused and
    // nothing may reach the staging seam.
    const stage = vi.fn(async () => stagedProposal);
    let observed: readonly AgentToolResult[] = [];
    await executeWorkspaceConversationAgentCore({
      workspaceID: auth.accountId,
      objective: "The user sent one or more images without any accompanying text.",
      sourceText: "",
      contacts: { search: vi.fn(), read: vi.fn() },
      memory: { recall: vi.fn(async () => ({ items: [] })), stage },
      inputParts: [imagePart],
      imageIsCurrent: async () => false,
      provider: new ScriptedAgentProvider(
        [
          {
            tool: "memory_review",
            input: {
              operation: "propose",
              contact_decision: "new",
              person_display_label: "周明",
              new_contact_source_locator: imageLocator(),
              items: [
                {
                  scope: "relationship",
                  dependence_kind: "relationship",
                  operation: "add",
                  statement_kind: "source_statement",
                  display_text: "截图第一次可见的加好友事件在周五 20:18",
                  speaker: "self",
                  time_status: "unknown",
                  sensitivity: "normal",
                  source_excerpt: "Friday 20:18",
                  source_locator: imageLocator(),
                  reason: "关系开始时间的来源",
                },
              ],
            },
          },
        ],
        (results) => {
          observed = results;
          return { outcome: "reply", title: "来源不可用", body: "这张截图当前不可用，未保存内容。" };
        },
      ),
    });
    expect(stage).not.toHaveBeenCalled();
    expect(observed[0]).toMatchObject({ ok: false, error: { code: "MEMORY_SOURCE_NOT_CURRENT" } });
  });
});

describe("canonical approved MCP result in host continuation", () => {
  const hostResult = { request_id: personID, call_id: contextID, original_message_id: personID,
    actor_user_id: auth.userId, kind: "approval" as const, outcome: "submitted", choice_id: null, receipt_ref: contextID };
  it("passes the actual bounded receipt beyond the continuation excerpt and rechecks authority after reading", async () => {
    const read = vi.fn(async () => ({ ok: true, data: { receipt: { call_id: contextID,
      result_summary: "first topic only", result_json: JSON.stringify({content:[{type:"text",text:"1 Overview\n2 Reconciler\n3 Rendering Targets"}]}) } } }));
    const guard = vi.fn();
    const scripted = new ScriptedAgentProvider([], { outcome: "reply", title: "Topics", body: "Three topics" });
    const run = vi.spyOn(scripted, "run");
    await executeWorkspaceConversationAgentCore({ workspaceID: auth.accountId, objective: "shortened continuation",
      contacts: { search: vi.fn(), read: vi.fn() }, provider: scripted,
      hostResult, mcpConnections: { handle: read }, assertCurrent: guard });
    expect(read).toHaveBeenCalledExactlyOnceWith({operation:"read_receipt",call_id:contextID});
    expect(run.mock.calls[0]?.[0].systemPrompt).toContain("3 Rendering Targets");
    expect(run.mock.calls[0]?.[0].systemPrompt).toContain("untrusted tool data");
    expect(guard.mock.invocationCallOrder.some(order => order > read.mock.invocationCallOrder[0]! && order < run.mock.invocationCallOrder[0]!)).toBe(true);
  });
  it.each([false, true])("does not substitute a missing or oversized result with invented content (oversized=%s)", async oversized => {
    const read = vi.fn(async () => oversized ? {ok:true,data:{receipt:{result_json:"x".repeat(33_000)}}} : {ok:false});
    const scripted = new ScriptedAgentProvider([], { outcome: "reply", title: "Unknown", body: "Unavailable" });
    const run = vi.spyOn(scripted, "run");
    await executeWorkspaceConversationAgentCore({workspaceID:auth.accountId,objective:"Continue",contacts:{search:vi.fn(),read:vi.fn()},provider:scripted,hostResult,mcpConnections:{handle:read}});
    expect(run.mock.calls[0]?.[0].systemPrompt).toContain("receipt could not be read");
    expect(run.mock.calls[0]?.[0].systemPrompt).not.toContain("x".repeat(200));
    expect(read).toHaveBeenCalledOnce();
  });
  it("does not dispatch the model after a receipt read loses the source fence", async () => {
    let readDone = false;
    const read = vi.fn(async () => {readDone=true;return {ok:true,data:{receipt:{result_json:"private receipt"}}};});
    const scripted = new ScriptedAgentProvider([], {outcome:"reply",title:"Unexpected",body:"Unexpected"});
    const run = vi.spyOn(scripted,"run");
    await expect(executeWorkspaceConversationAgentCore({workspaceID:auth.accountId,objective:"Continue",contacts:{search:vi.fn(),read:vi.fn()},provider:scripted,hostResult,mcpConnections:{handle:read},assertCurrent:async()=>{if(readDone)throw new Error("SOURCE_WITHDRAWN");}})).rejects.toThrow("SOURCE_WITHDRAWN");
    expect(run).not.toHaveBeenCalled();
  });
});
