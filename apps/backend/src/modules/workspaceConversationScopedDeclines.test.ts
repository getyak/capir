import { createHash } from "node:crypto";
import { ScriptedAgentProvider, type AgentToolResult } from "@talent-signal/agent";
import { describe, expect, it } from "vitest";

import {
  executeWorkspaceConversationAgentCore,
  type WorkspaceContactLookup,
  type WorkspaceMemoryLookup,
} from "./workspaceConversationAgent.js";
import { withFirstContactNameCandidate } from "./firstContactResearch.js";

const workspaceID = "11111111-1111-4111-8111-111111111111";
const sessionID = "22222222-2222-4222-8222-222222222222";
const messageID = "33333333-3333-4333-8333-333333333333";
const namesakeID = "44444444-4444-4444-8444-444444444444";
const proposalID = "55555555-5555-4555-8555-555555555555";
const displayName = "林海（测试）";
const requests = [
  {
    language: "Chinese",
    text: "请依据这张明确标记为虚构测试的截图，为林海（测试）准备一个待我确认的新联系人草稿。不要保存 Memory，不创建会议，不对外发送消息；不要把同名人物自动合并。",
  },
  {
    language: "English",
    text: "Using this screenshot clearly marked as a fictional test, prepare a new contact draft for 林海（测试） for me to review. Do not save Memory. Do not create meetings. Do not send external messages. Do not automatically merge same-name people.",
  },
] as const;

function namesakeDirectory(): WorkspaceContactLookup {
  return {
    search: async () => [{
      personID: namesakeID,
      displayLabel: displayName,
      directoryRevision: 1,
      contexts: [],
      exactIdentityMatch: false,
    }],
    read: async () => { throw new Error("A name-only draft must not open private contact data"); },
  };
}

describe("effect-scoped proposal declines", () => {
  // Catch a Memory/calendar/message refusal incorrectly discarding a contact
  // review at the real governed tool and terminal presentation boundaries.
  it.each(requests)("keeps the requested contact_workspace review ($language)", async ({ text }) => {
    const execution = await executeWorkspaceConversationAgentCore({
      workspaceID, sessionID, messageID, objective: text, sourceText: text,
      contacts: namesakeDirectory(),
      provider: new ScriptedAgentProvider([{
        tool: "contact_workspace",
        input: {
          operation: "propose_create",
          display_name: displayName,
          relationship_context: "",
          identity_clue: null,
          source_excerpts: [displayName],
          reason: "Prepare only the explicitly requested contact review.",
        },
      }], results => results[0]?.ok ? {
        outcome: "contact_change_proposal", candidate_fingerprint: results[0].candidateFingerprint,
      } : { outcome: "reply", title: "No draft", body: "No contact draft was prepared." }),
    });

    expect(execution.event).toMatchObject({
      kind: "contact_change_proposal",
      proposal_kind: "create",
      display_name: "林海（测试）",
      target_person_id: null,
      target_relationship_context_id: null,
      source_message_id: "33333333-3333-4333-8333-333333333333",
      source_excerpts: ["林海（测试）"],
      requires_user_confirmation: true,
    });
    expect(execution.memoryProposal).toBeNull();
  });

  // A memory_review tool name does not itself mean Memory is proposed. Keep
  // source/identity validation real and replace only the image/DB adapters.
  it.each(requests)("stages an image contact-only memory_review ($language)", async ({ text }) => {
    const bytes = Buffer.from("explicitly fictional screenshot: 林海（测试）");
    const artifactID = `conversation-image-${messageID}-0-66666666-6666-4666-8666-666666666666`;
    const sourceLocator = { kind: "image_region" as const, artifact_id: artifactID, image_index: 0 };
    const stagedRequests: Array<Parameters<WorkspaceMemoryLookup["stage"]>[0]> = [];
    const memory: WorkspaceMemoryLookup = {
      recall: async ({ personID }) => {
        expect(personID).toBeNull();
        return { items: [] };
      },
      stage: async input => {
        const items = withFirstContactNameCandidate(input.items, input.nameCandidate ?? null);
        stagedRequests.push({ ...input, items });
        return {
          proposalID, proposalRevision: 1, itemCount: items.length, defaultSelectedCount: 0,
          scopeCounts: { self: 0, person: items.length, relationship: 0 },
          contactStatus: "ambiguous", personID: null, personDisplayLabel: displayName,
        };
      },
    };
    let toolResults: readonly AgentToolResult[] = [];
    const execution = await executeWorkspaceConversationAgentCore({
      workspaceID, sessionID, messageID, objective: text, sourceText: text,
      contacts: namesakeDirectory(), memory,
      inputParts: [{ kind: "image", artifactID, mimeType: "image/png", byteSize: bytes.length,
        contentHash: createHash("sha256").update(bytes).digest("hex"), dataBase64: bytes.toString("base64") }],
      imageIsCurrent: async () => true,
      imageInspector: { inspect: async () => ({
        conversation_kind: "direct", counterparty_name: displayName,
        visible_text: [displayName, "明确标记为虚构测试"],
        description: "Synthetic screenshot for scoped proposal-policy regression.",
        uncertainties: [], model: "synthetic-inspector", request_id: "synthetic-no-network",
      }) },
      provider: new ScriptedAgentProvider([{
        tool: "memory_review",
        input: { operation: "propose", contact_decision: "new", person_display_label: displayName,
          new_contact_source_locator: sourceLocator, items: [] },
      }], results => {
        toolResults = results;
        return { outcome: "reply", title: "Contact review", body: "Review the proposed new contact." };
      }),
    });

    expect(toolResults[0]).toMatchObject({ ok: true, data: { operation: "propose", status: "needs_review" } });
    expect(execution.memoryProposal).toEqual({ proposal_id: "55555555-5555-4555-8555-555555555555", revision: 1 });
    expect(stagedRequests).toHaveLength(1);
    expect(stagedRequests[0]).toMatchObject({
      surface: "chat", contactDecision: "new", personID: null, contextID: null,
      identityAuthority: "tentative", identityClue: null,
      sourceMessageID: "33333333-3333-4333-8333-333333333333", sourceText: text,
      newContact: { display_label: "林海（测试）", relationship_context: "", source_locator: sourceLocator },
    });
    expect(stagedRequests[0]!.items).toEqual([]);
  });
});
