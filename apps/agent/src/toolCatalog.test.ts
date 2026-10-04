import { describe, expect, it } from "vitest";

import {
  AgentFinalOutputSchema,
  ContactWorkspaceInputSchema,
  WorkspaceConversationFinalOutputSchema,
} from "./schemas.js";
import {
  AGENT_TOOL_CATALOG,
  agentCapabilityManifest,
  contactWorkspaceOperationTools,
  candidateOutcome,
  candidateToolNames,
} from "./toolCatalog.js";
import {
  ALL_AGENT_TOOL_NAMES,
  PERSON_RESEARCH_AGENT_TOOL_NAMES,
  PURSUIT_AGENT_TOOL_NAMES,
  RESEARCH_AGENT_TOOL_NAMES,
  WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES,
} from "./types.js";

describe("provider-neutral Agent capability catalog", () => {
  it("exposes operation-specific native contact Tools so search cannot include proposal fields", () => {
    const nativeTools = contactWorkspaceOperationTools();
    expect(nativeTools.map((tool) => tool.name)).toEqual([
      "contact_workspace_search", "contact_workspace_read", "contact_workspace_propose_create", "contact_workspace_propose_update",
    ]);
    const search = nativeTools[0]!.parameters;
    expect(search).toMatchObject({ type: "object", additionalProperties: false });
    expect(Object.keys(search.properties)).toEqual(["query", "maximum_results", "source_clue"]);
    expect(search.required).toEqual(["query"]);
    expect(nativeTools[0]!.description).toContain("source_clue is REQUIRED");
    expect(nativeTools[0]!.description).toContain("input_images artifact_id");
    expect(nativeTools[0]!.description).not.toContain("Input contains only query");
    expect(ContactWorkspaceInputSchema.parse({
      operation: "search", query: "周明", source_clue: {
        clue: "周明", source_locator: { kind: "image_region", artifact_id: "admitted-image", image_index: 0 },
      },
    })).toMatchObject({ source_clue: { clue: "周明", source_locator: { artifact_id: "admitted-image" } } });
    expect(ContactWorkspaceInputSchema.parse({ operation: "search", query: "nira.voss@example.com" }))
      .toEqual({ operation: "search", query: "nira.voss@example.com", maximum_results: 4 });
    expect(ContactWorkspaceInputSchema.safeParse({
      operation: "search", query: "nira.voss@example.com",
      identity_clue: { type: "email", value: "nira.voss@example.com" },
    }).success).toBe(false);
  });

  it("keeps no_action in the terminal protocol rather than the tool surface", () => {
    expect(ALL_AGENT_TOOL_NAMES).not.toContain("record_no_action");
    expect(Object.keys(AGENT_TOOL_CATALOG)).not.toContain("record_no_action");
    expect(
      AgentFinalOutputSchema.parse({
        outcome: "no_action",
        reason_code: "NO_MATERIAL_CHANGE",
        reason: "No governed change is supported.",
        missing_evidence_refs: [],
      }),
    ).toMatchObject({ outcome: "no_action" });
    expect(
      AgentFinalOutputSchema.safeParse({
        outcome: "no_action",
        candidate_fingerprint: "a".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("assembles small definition-specific surfaces from one catalog", () => {
    expect(PURSUIT_AGENT_TOOL_NAMES).toHaveLength(3);
    expect(RESEARCH_AGENT_TOOL_NAMES).toHaveLength(3);
    expect(PERSON_RESEARCH_AGENT_TOOL_NAMES).toHaveLength(5);
    expect(WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES).toEqual([
      "contact_workspace",
      "memory_review",
      "mcp_connections",
    ]);
    expect(candidateToolNames(PURSUIT_AGENT_TOOL_NAMES)).toEqual([
      "stage_pursuit_proposal",
    ]);
    expect(candidateToolNames(RESEARCH_AGENT_TOOL_NAMES)).toEqual([
      "create_research_artifact",
    ]);
    expect(candidateToolNames(PERSON_RESEARCH_AGENT_TOOL_NAMES)).toEqual([
      "create_person_research_artifact",
    ]);
    expect(candidateToolNames(WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES)).toEqual([
      "contact_workspace",
    ]);
    expect(candidateOutcome(PURSUIT_AGENT_TOOL_NAMES)).toBe("proposal");
    expect(candidateOutcome(RESEARCH_AGENT_TOOL_NAMES)).toBe("artifact");
    expect(candidateOutcome(PERSON_RESEARCH_AGENT_TOOL_NAMES)).toBe(
      "person_research_artifact",
    );
    expect(candidateOutcome(WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES)).toBe(
      "contact_change_proposal",
    );
  });

  it("makes consequence, approval, reversibility, and idempotency inspectable", () => {
    const capabilities = agentCapabilityManifest(ALL_AGENT_TOOL_NAMES);
    const durable = capabilities.filter(
      (capability) => capability.consequence === "durable_candidate",
    );

    expect(capabilities).toHaveLength(14);
    expect(durable.map((capability) => capability.name)).toEqual([
      "stage_pursuit_proposal",
      "create_research_artifact",
      "create_person_research_artifact",
      "contact_workspace",
      "memory_review",
      "mcp_connections",
    ]);
    expect(
      durable.every(
        (capability) =>
          capability.openWorld === (capability.name === "mcp_connections") &&
          capability.reversibility === "discardable" &&
          capability.idempotency === "content_fingerprint",
      ),
    ).toBe(true);
    expect(AGENT_TOOL_CATALOG.stage_pursuit_proposal.approval).toBe(
      "human_review_before_apply",
    );
    expect(AGENT_TOOL_CATALOG.contact_workspace.approval).toBe(
      "human_review_before_apply",
    );
    expect(AGENT_TOOL_CATALOG.memory_review.approval).toBe(
      "human_review_before_apply",
    );
    expect(AGENT_TOOL_CATALOG.mcp_connections).toMatchObject({
      consequence: "durable_candidate",
      approval: "human_review_before_apply",
      openWorld: true,
      reversibility: "discardable",
      idempotency: "content_fingerprint",
    });
    expect(AGENT_TOOL_CATALOG.mcp_connections.schema.safeParse({
      operation: "execute", connection_id: "b1c3f1fc-1e15-4cd3-89a1-b64cf0b66817",
    }).success).toBe(false);
  });

  it("admits bounded contact operations but exposes no apply operation", () => {
    expect(
      ContactWorkspaceInputSchema.parse({
        operation: "search",
        query: "Maya",
        maximum_results: 4,
      }),
    ).toMatchObject({ operation: "search", maximum_results: 4 });
    expect(
      ContactWorkspaceInputSchema.safeParse({
        operation: "apply",
        person_id: "b1c3f1fc-1e15-4cd3-89a1-b64cf0b66817",
      }).success,
    ).toBe(false);
    expect(
      WorkspaceConversationFinalOutputSchema.parse({
        outcome: "reply",
        title: "Hello",
        body: "How can I help?",
        session_title: "Compare outreach drafts",
      }),
    ).toMatchObject({ outcome: "reply", session_title: "Compare outreach drafts" });
  });
});

for (const outcome of ["reply", "clarification"] as const) {
  it(`preserves ${outcome} bodies independently of optional Unicode title metadata`, () => {
    const reply = { outcome, title: "Answer", body: "The substantive answer." };
    const title = "Discuss " + "👨‍👩‍👧‍👦".repeat(23);
    expect(title.length).toBeGreaterThan(256);
    expect(Array.from(title).length).toBeLessThanOrEqual(256);
    expect(WorkspaceConversationFinalOutputSchema.parse({ ...reply, session_title: title })).toMatchObject({ ...reply, session_title: title });
    for (const invalid of [" ", "a".repeat(257), 42, null]) {
      const result = WorkspaceConversationFinalOutputSchema.parse({ ...reply, session_title: invalid });
      expect(result).toMatchObject({ ...reply, session_title: undefined });
    }
    expect(WorkspaceConversationFinalOutputSchema.safeParse({ ...reply, body: "", session_title: "ok" }).success).toBe(outcome === "reply");
  });
}
