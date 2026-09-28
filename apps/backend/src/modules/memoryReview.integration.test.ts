import { sweepDueSourceRetention } from "./sourceRetention.js";
import { createHash, randomUUID } from "node:crypto";

import type {
  MemoryCommitRequest,
  MemoryProposalCandidate,
  MemoryProposalStageRequest,
  MemoryReviewView,
} from "@talent-signal/contracts";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { inTransaction } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import { mutateAgentSession } from "./agentSessions.js";
import { createChatTask } from "./chat.js";
import { executeUnscopedChatTask } from "./unscopedChat.js";
import { executeWorkspaceConversationAgent } from "./workspaceConversationAgent.js";
import { registerMemoryReviewRoutes } from "./memoryReviewRoutes.js";
import Fastify from "fastify";
import { createMemoryProposalRegenerator } from "./memoryRegenerationAgent.js";
import { readConversationMessageImage } from "./conversationMessageImages.js";
import { deleteCapture } from "./captures.js";
import {
  decideCaptureSourceAuthorization,
  sweepDueSourceAuthorizations,
} from "./sourceAuthorization.js";
import {
  commitMemoryReview,
  decideMemoryReviewItem,
  decideMemoryContactOnly,
  listMemoryProposals,
  mutateMemoryItem,
  openMemoryReview,
  readMemoryOperation,
  readMemoryReview,
  rebaseMemoryProposal,
  recallMemories,
  readMemoryScopedOperationView,
  saveMemoryReviewDraft,
  regenerateMemoryProposal,
  resolveMemoryPursuitScopes,
  resolveSessionSourceAuthority,
  stageMemoryProposal,
  undoMemoryCommit,
  undoMemoryScopedOperation,
  dismissMemoryReview,
  type MemorySourceAuthority,
} from "./memoryReview.js";
import { verifyPendingSourceAuthority } from "./memorySourceVerification.js";
import { createHarnessSourceGuard } from "./harnessSourceGuard.js";
import { loadAgentResponsePreference, saveAgentPreference } from "./agentPreferences.js";
import { invalidateMemoriesForSessionIds } from "./memoryReview.js";
import { ScriptedAgentProvider, type SelfMemoryContext } from "@talent-signal/agent";

const url = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
const pool = url
  ? new Pool({ connectionString: url, idleTimeoutMillis: 0, max: 6 })
  : null;

beforeAll(() => {
  expect(url, "CONTACT_AGENT_TEST_DATABASE_URL must point at the synthetic test database").toBeTruthy();
}, 10_000);

afterAll(async () => {
  await pool?.end();
});

const loadRegenerationImage = async (input: {
  auth: AuthContext;
  sessionId: string;
  messageId: string;
  imageIndex: number;
}) => {
  const image = await readConversationMessageImage(
    pool!,
    input.auth,
    input.sessionId,
    input.messageId,
    input.imageIndex,
  );
  return image ? { media_type: image.media_type, content: image.content } : null;
};

async function makeAuth(label: string): Promise<AuthContext> {
  const accountId = randomUUID();
  const userId = randomUUID();
  const accountSlug = `memory-${label}-${accountId.slice(0, 8)}`;
  await pool!.query(
    "INSERT INTO accounts(id,slug,name) VALUES($1,$2,$3)",
    [accountId, accountSlug, `Memory ${label}`],
  );
  await pool!.query(
    "INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,$4,'simulated_human')",
    [userId, accountId, `${accountSlug}@synthetic.local`, "Synthetic Owner"],
  );
  return {
    accountId,
    accountSlug,
    userId,
    userEmail: `${accountSlug}@synthetic.local`,
    userKind: "simulated_human",
    sessionId: randomUUID(),
  };
}

async function makeContact(
  auth: AuthContext,
  label: string,
): Promise<{ personId: string; contextId: string }> {
  const personId = randomUUID();
  const contextId = randomUUID();
  await pool!.query(
    "INSERT INTO subjects(id,account_id,external_ref,display_label,status) VALUES($1,$2,$3,$4,'active')",
    [personId, auth.accountId, `memory-test-person:${personId}`, label],
  );
  await pool!.query(
    "INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label,status) VALUES($1,$2,$3,$4,$5,'active')",
    [contextId, auth.accountId, personId, `memory-test-context:${contextId}`, `${label} relationship`],
  );
  return { personId, contextId };
}

/** Build one confirmed Pursuit role with a current, bound evidence chain. */
async function makePursuitWithEvidence(
  auth: AuthContext,
  contact: { personId: string; contextId: string },
): Promise<{ pursuitId: string; roleId: string; fragmentId: string; captureId: string }> {
  const pursuitId = randomUUID();
  await pool!.query(
    `INSERT INTO pursuits(id, account_id, pursuit_type, title, target_outcome, target_date, status, milestone, milestone_authority_user_id, milestone_authority_at, created_by_user_id, updated_by_user_id)
     VALUES($1,$2,'recruiting','Pursuit association','Hire','2026-12-31','active','screen',$3,now(),$3,$3)`,
    [pursuitId, auth.accountId, auth.userId],
  );
  const roleId = randomUUID();
  await pool!.query(
    `INSERT INTO pursuit_roles(id, account_id, pursuit_id, person_id, role_type, status, confidence, basis_kind, display_order, created_by_user_id)
     VALUES($1,$2,$3,$4,'candidate','active','confirmed','evidence_supported',0,$5)`,
    [roleId, auth.accountId, pursuitId, contact.personId, auth.userId],
  );
  const captureId = randomUUID();
  const resourceId = randomUUID();
  const fragmentId = randomUUID();
  await pool!.query(
    `INSERT INTO captures(id, account_id, created_by_user_id, subject_id, assignment_id, source_kind, source_metadata, identity_status, identity_context, purpose, status)
     VALUES($1,$2,$3,$4,$5,'conversation_screenshot','{}'::jsonb,'bound','{}'::jsonb,'relationship_evidence','active')`,
    [captureId, auth.accountId, auth.userId, contact.personId, contact.contextId],
  );
  await pool!.query(
    `INSERT INTO source_resources(id, account_id, capture_id, created_by_user_id, client_resource_id, resource_kind, input_channel, display_name, media_type, observed_at, retention_scope, processing_state)
     VALUES($1,$2,$3,$4,$5,'conversation_screenshot','chat','Pursuit source','image/png',now(),'relationship','ready')`,
    [resourceId, auth.accountId, captureId, auth.userId, `pursuit-assoc-${fragmentId}`],
  );
  await pool!.query(
    `INSERT INTO evidence_fragments(id, account_id, capture_id, resource_id, fragment_kind, sequence, text_content, content_hash, locator, attributed_actor, attribution_status, parser_name, parser_version, status, review_status)
     VALUES($1,$2,$3,$4,'message',0,'Pursuit association evidence',$5,'{}'::jsonb,'unknown','confirmed','test','1','active','reviewed')`,
    [fragmentId, auth.accountId, captureId, resourceId, `hash-${fragmentId}`],
  );
  await pool!.query(
    `INSERT INTO source_retention_receipts(receipt_id, account_id, capture_id, policy_version, requested_mode, effective_mode, source_scope, source_access_state, source_access_reason, retention_until, created_at)
     VALUES($1,$2,$3,'source-retention.v2','full_source','full_source','full_reviewed_source','available','review_completed',now() + interval '30 days',now())`,
    [randomUUID(), auth.accountId, captureId],
  );
  await pool!.query(
    `INSERT INTO pursuit_role_evidence(account_id, role_id, evidence_fragment_id) VALUES($1,$2,$3)`,
    [auth.accountId, roleId, fragmentId],
  );
  return { pursuitId, roleId, fragmentId, captureId };
}

function candidate(
  overrides: Partial<MemoryProposalCandidate>,
): MemoryProposalCandidate {
  const displayText = overrides.display_text ?? "I prefer conclusions first";
  return {
    scope: "self",
    operation: "add",
    statement_kind: "fact",
    display_text: displayText,
    subject_id: null,
    relationship_context_id: null,
    speaker: null,
    reporter: null,
    valid_time: null,
    observed_time: null,
    time_status: "known",
    sensitivity: "normal",
    source_excerpt: displayText,
    source_locator: { kind: "message", session_id: null, message_id: null },
    previous_memory_item_id: null,
    previous_text: null,
    previous_revision: null,
    reason: "Useful next time",
    ...overrides,
  };
}

interface StageOptions {
  items: MemoryProposalCandidate[];
  contactDecision: "existing" | "new" | "none";
  personId?: string | null;
  contextId?: string | null;
  newContact?: {
    display_label: string;
    relationship_context: string;
    source_locator?: MemorySourceAuthority["artifacts"][number] extends never ? never : {
      kind: "image_region";
      artifact_id: string;
      session_id?: string | null;
      image_index?: number;
      region?: null;
    } | null;
  } | null;
  surface?: "chat" | "people" | "relationship";
  authorityText?: string;
  sessionId?: string | null;
  messageId?: string | null;
  manualAuthority?: MemorySourceAuthority;
  identityAuthority?: "tentative" | "stable_handle" | "human_selection";
  identityClue?: { type: "email" | "phone" | "wechat" | "linkedin_url" | "public_profile_url" | "source_native_id"; value: string } | null;
  reuseSession?: boolean;
  images?: Array<{ attachmentId: string; contentHash: string }>;
}

async function insertSourceSession(
  auth: AuthContext,
  sessionId: string,
  messageId: string,
  objective: string,
  images: Array<{ attachmentId: string; contentHash: string }> = [],
  scope?: { personId: string; relationshipContextId: string },
): Promise<void> {
  const iso = new Date().toISOString();
  const contents = images.map((_image, index) => Buffer.from([index + 1, 2, 3, 4]));
  const computedHashes = contents.map((content) =>
    createHash("sha256").update(content).digest("hex"),
  );
  await pool!.query(
    `INSERT INTO agent_sessions(
       account_id,id,created_by_user_id,revision,payload,created_at,expires_at
     ) VALUES($1,$2,$3,1,$4::jsonb,now(),now() + interval '30 days')`,
    [
      auth.accountId,
      sessionId,
      auth.userId,
      JSON.stringify({
        id: sessionId,
        scopeKind: scope ? "relationship" : "unresolved_intent",
        ...(scope
          ? {
              personID: scope.personId,
              relationshipContextID: scope.relationshipContextId,
            }
          : {}),
        personDisplayLabel: "Memory source",
        contextDisplayLabel: "Conversation",
        title: "Memory source",
        updatedAt: iso,
        isUnread: false,
        turns: [
          {
            id: messageId,
            objective,
            response: {
              contractVersion: "2026-08-24.10",
              taskID: randomUUID(),
              contextManifestID: randomUUID(),
              knowledgeSnapshotID: randomUUID(),
              disposition: "answer",
              createdAt: iso,
            },
            createdAt: iso,
            ...(images.length > 0
              ? {
                  images: images.map((image, index) => ({
                    attachment_id: image.attachmentId,
                    file_name: `image-${index}.png`,
                    media_type: "image/png",
                    byte_size: 4,
                    content_hash: computedHashes[index]!,
                  })),
                }
              : {}),
          },
        ],
      }),
    ],
  );
  if (images.length > 0) {
    const queueEntryId = randomUUID();
    await pool!.query(
      "INSERT INTO conversation_queue_entries(account_id,session_id,id,message_id,created_by_user_id,sequence,status,content_state,objective,idempotency_key,expires_at) VALUES($1,$2,$3,$4,$5,1,'completed','retained',$6,$7,now() + interval '30 days')",
      [auth.accountId, sessionId, queueEntryId, messageId, auth.userId, objective.slice(0, 1000), `key-${queueEntryId}`],
    );
    for (const [index, image] of images.entries()) {
      await pool!.query(
        "INSERT INTO conversation_message_images(account_id,session_id,message_id,queue_entry_id,image_index,attachment_id,file_name,media_type,byte_size,content_hash,content,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'image/png',$8,$9,$10,now() + interval '30 days')",
        [auth.accountId, sessionId, messageId, queueEntryId, index, image.attachmentId, `image-${index}.png`, contents[index]!.length, computedHashes[index]!, contents[index]!],
      );
    }
  }
}

async function stage(auth: AuthContext, options: StageOptions) {
  const idempotencyKey = randomUUID();
  const requestedSessionId =
    options.sessionId === undefined ? randomUUID() : options.sessionId;
  const requestedMessageId =
    options.messageId === undefined ? randomUUID() : options.messageId;
  const request: MemoryProposalStageRequest = {
    idempotency_key: idempotencyKey,
    surface: options.surface ?? "chat",
    session_id: requestedSessionId,
    source_task_id: randomUUID(),
    source_message_id: requestedMessageId,
    person_id: options.personId ?? null,
    relationship_context_id: options.contextId ?? null,
    contact_decision: options.contactDecision,
    ...((options.identityAuthority
      ?? (options.contactDecision === "existing" ? "human_selection" : null))
      ? {
          identity_authority:
            options.identityAuthority
            ?? (options.contactDecision === "existing" ? "human_selection" : "tentative"),
        }
      : {}),
    identity_clue: options.identityClue ?? null,
    new_contact: options.newContact ?? null,
    proposer: { kind: "human", name: "integration-test", version: "1" },
    items: options.items,
  };
  let authority: MemorySourceAuthority;
  if (options.manualAuthority) {
    authority = options.manualAuthority;
  } else if (requestedSessionId && requestedMessageId) {
    const objective = `${options.authorityText ?? ""}\n${options.items
      .map((item) => item.source_excerpt)
      .join("\n")}`.trim();
    if (!options.reuseSession) {
      await insertSourceSession(
        auth,
        requestedSessionId,
        requestedMessageId,
        objective,
        options.images ?? [],
      );
    }
    authority = await resolveSessionSourceAuthority(
      pool!,
      auth,
      requestedSessionId,
      requestedMessageId,
    );
  } else {
    throw new Error("A real admitted Session source or a manual capture authority is required.");
  }
  return inTransaction(pool!, (client) =>
    stageMemoryProposal(client, auth, request, authority),
  );
}

async function open(
  auth: AuthContext,
  proposalId: string,
  purpose: "chat" | "people" | "relationship",
  personId?: string | null,
  contextId?: string | null,
) {
  return openMemoryReview(pool!, auth, proposalId, {
    purpose,
    person_id: personId ?? null,
    relationship_context_id: contextId ?? null,
  });
}

interface CommitOptions {
  selected: string[];
  contactDecision: "existing" | "new" | "none";
  newContact?: {
    display_label: string;
    relationship_context: string;
    source_locator?: MemorySourceAuthority["artifacts"][number] extends never ? never : {
      kind: "image_region";
      artifact_id: string;
      session_id?: string | null;
      image_index?: number;
      region?: null;
    } | null;
  } | null;
  decisions?: Record<string, MemoryCommitRequest["item_decisions"][string]>;
  edited?: Record<string, string>;
  expectedVersions?: Record<string, number>;
  expectedRevision?: number;
  idempotencyKey?: string;
  identityAuthority?: "tentative" | "stable_handle" | "human_selection";
}

async function commit(
  auth: AuthContext,
  review: MemoryReviewView,
  credential: string,
  options: CommitOptions,
) {
  const body: MemoryCommitRequest = {
    idempotency_key: options.idempotencyKey ?? randomUUID(),
    expected_proposal_revision:
      options.expectedRevision ?? review.proposal_revision,
    contact_decision: options.contactDecision,
    ...(options.identityAuthority
      ? { identity_authority: options.identityAuthority }
      : options.contactDecision === "existing"
        ? { identity_authority: "human_selection" as const }
        : {}),
    selected_item_ids: options.selected,
    edited_text: options.edited ?? {},
    item_decisions: options.decisions ?? {},
    expected_item_versions: options.expectedVersions ?? {},
    new_contact: options.newContact ?? null,
    reason: "integration test commit",
  };
  return commitMemoryReview(
    pool!,
    auth,
    review.review_scope_id,
    credential,
    body,
  );
}

function draftProposalItems() {
  const self = [
    candidate({ display_text: "I prefer conclusions first" }),
    candidate({ display_text: "I am hiring a design partner this quarter" }),
    candidate({ display_text: "I read concrete examples before deciding" }),
  ];
  const person = Array.from({ length: 8 }, (_value, index) =>
    candidate({
      scope: "person",
      statement_kind: "source_statement",
      speaker: "Chen",
      display_text: `Chen statement ${index}`,
      source_excerpt: `Chen statement ${index}`,
    }),
  );
  const relationship = Array.from({ length: 6 }, (_value, index) =>
    candidate({
      scope: "relationship",
      statement_kind: "source_statement",
      speaker: "Chen",
      display_text: `Chen and I agreed item ${index}`,
      source_excerpt: `Chen and I agreed item ${index}`,
    }),
  );
  return { self, person, relationship, all: [...self, ...person, ...relationship] };
}

describe.skipIf(!pool)("Memory review integration", () => {
  async function acceptSelf(auth: AuthContext, items: MemoryProposalCandidate[]) {
    const staged = await stage(auth, { contactDecision: "none", items });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    return commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map(item => item.id), contactDecision: "none",
    });
  }

  it("bootstraps the same accepted self and explicit service setting in fresh clients without tool calls", async () => {
    const auth = await makeAuth("self-bootstrap");
    await acceptSelf(auth, [candidate({ display_text: "I plan to study design next year.",
      statement_kind: "source_statement", speaker: "me", reporter: "me",
      time_status: "future", valid_time: "2027-01-01T00:00:00Z" })]);
    await saveAgentPreference(pool!, auth, {
      idempotency_key: randomUUID(), expected_revision: 0, response_style: "conclusion_first",
    });
    const cores: SelfMemoryContext[] = [];
    for (const clientLabel of ["web", "mobile"]) {
      const sessionId = randomUUID();
      await insertSourceSession(auth, sessionId, randomUUID(), clientLabel);
      const provider = new ScriptedAgentProvider([], { outcome: "reply", title: "Ready", body: "Ready" });
      const run = vi.spyOn(provider, "run");
      await executeWorkspaceConversationAgent({
        database: pool!, auth, sessionID: sessionId, objective: "What should I work on?",
        provider, responsePreference: (await loadAgentResponsePreference(pool!, auth))!,
        assertCurrent: await createHarnessSourceGuard(pool!, auth, sessionId, () => undefined),
      });
      const request = run.mock.calls[0]![0];
      expect(request.responsePreference).toMatchObject({ responseStyle: "conclusion_first" });
      cores.push(request.selfMemoryContext!);
    }
    expect(cores[0]).toEqual(cores[1]);
    expect(cores[0]).toMatchObject({ status: "complete", items: [{
      display_text: "I plan to study design next year.", statement_kind: "source_statement",
      time_status: "future", speaker: "me", version: 1, evidence_retained: true,
    }] });
    expect(cores[0]!.items[0]!.evidence_refs[0]).toHaveProperty("source_session_id");
    expect(cores[0]!.items[0]!.evidence_refs[0]).not.toHaveProperty("excerpt");

    const otherUserId = randomUUID();
    await pool!.query("INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Other','simulated_human')",
      [otherUserId, auth.accountId, otherUserId + "@synthetic.local"]);
    const other = { ...auth, userId: otherUserId };
    expect((await recallMemories(pool!, other, { surface: "chat", scope: "self" })).items).toEqual([]);
    expect(await loadAgentResponsePreference(pool!, other)).toBeUndefined();
  });

  it.each(["correct", "delete_source"] as const)("rejects an answer after loaded self memory changes: %s", async change => {
    const auth = await makeAuth("self-change");
    const accepted = await acceptSelf(auth, [candidate({ display_text: "My current goal is design." })]);
    const id = accepted.body.receipt.created_item_ids[0]!;
    const assertCurrent = await createHarnessSourceGuard(pool!, auth, undefined, () => undefined);
    const provider = new ScriptedAgentProvider([], { outcome: "reply", title: "Old", body: "Old" });
    const originalRun = provider.run.bind(provider);
    vi.spyOn(provider, "run").mockImplementation(async (...args) => {
      expect(args[0].selfMemoryContext!.items.map(item => item.id)).toContain(id);
      if (change === "correct") await mutateMemoryItem(pool!, auth, id, {
        operation: "correct", idempotency_key: randomUUID(), expected_version: 1,
        display_text: "My current goal is research.", reason: "User correction",
      });
      else {
        const sources = await recallMemories(pool!, auth, { surface: "chat" });
        await inTransaction(pool!, client => invalidateMemoriesForSessionIds(client, auth.accountId,
          [sources.items[0]!.evidence_refs[0]!.source_session_id!]));
      }
      return originalRun(...args);
    });
    await expect(executeWorkspaceConversationAgent({ database: pool!, auth, objective: "Help me plan.",
      provider, assertCurrent })).rejects.toMatchObject({ code: "HARNESS_SOURCE_CHANGED" });
    const next = new ScriptedAgentProvider([], { outcome: "reply", title: "Current", body: "Current" });
    const nextRun = vi.spyOn(next, "run");
    await executeWorkspaceConversationAgent({ database: pool!, auth, objective: "Try again.", provider: next,
      assertCurrent: await createHarnessSourceGuard(pool!, auth, undefined, () => undefined) });
    expect(nextRun.mock.calls[0]![0].selfMemoryContext).toMatchObject({
      status: "complete",
      items: change === "correct" ? [expect.objectContaining({ version: 2, display_text: "My current goal is research." })] : [],
    });
  });

  it("paginates all self memories without losing timestamp ties or revealing them on business surfaces", async () => {
    const auth = await makeAuth("self-pages");
    for (const start of [0, 40, 80]) await acceptSelf(auth,
      Array.from({ length: start === 80 ? 25 : 40 }, (_, i) => candidate({ display_text: "My project note " + (start + i) })));
    // PostgreSQL microseconds must survive the cursor, even though JS Date
    // rounds to milliseconds. All rows deliberately share that same instant.
    await pool!.query("UPDATE memory_items SET created_at='2026-09-22T00:00:00.123456Z' WHERE account_id=$1", [auth.accountId]);
    const first = await recallMemories(pool!, auth, { surface: "chat", scope: "self", limit: 100 });
    expect(first.items).toHaveLength(100);
    expect(first.has_more).toBe(true);
    const second = await recallMemories(pool!, auth, { surface: "chat", scope: "self", limit: 100, cursor: first.next_cursor });
    expect(second.items).toHaveLength(5);
    expect(second.has_more).toBe(false);
    expect(second.next_cursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(105);
    const contact = await makeContact(auth, "Business");
    expect(await recallMemories(pool!, auth, { surface: "relationship", scope: "self",
      person_id: contact.personId, relationship_context_id: contact.contextId }))
      .toMatchObject({ items: [], has_more: false, next_cursor: null });
    const foreign = await makeAuth("foreign-page");
    expect((await recallMemories(pool!, foreign, { surface: "chat", scope: "self", cursor: first.next_cursor })).items).toEqual([]);
    await expect(recallMemories(pool!, auth, { surface: "chat", cursor: "invalid" }))
      .rejects.toMatchObject({ code: "MEMORY_CURSOR_INVALID" });
    const provider = new ScriptedAgentProvider([], { outcome: "reply", title: "Ready", body: "Ready" });
    const run = vi.spyOn(provider, "run");
    await executeWorkspaceConversationAgent({ database: pool!, auth, objective: "Hi", provider });
    expect(run.mock.calls[0]![0].selfMemoryContext!.status).toBe("partial");
  });

  it("creates one contact and exactly seventeen scoped memories in one commit", async () => {
    const auth = await makeAuth("new-contact");
    const text = "Chen shared his design system notes";
    const { self, person, relationship, all } = draftProposalItems();
    const items = all;
    const staged = await stage(auth, {
      items,
      contactDecision: "new",
      newContact: { display_label: "Chen", relationship_context: "Design partner" },
      authorityText: `${text} Chen`,
    });
    expect(staged?.scopeCounts).toEqual({ self: 3, person: 8, relationship: 6 });

    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    expect(opened.review.visible_item_count).toBe(17);
    expect(opened.review.visible_default_selected_count).toBe(17);

    const result = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "new",
      newContact: { display_label: "Chen", relationship_context: "Design partner" },
    });
    expect(result.body.receipt.item_count).toBe(17);
    expect(result.body.receipt.created_person_id).toBeTruthy();
    expect(result.body.receipt.created_relationship_context_id).toBeTruthy();

    const personId = result.body.receipt.created_person_id!;
    const contextId = result.body.receipt.created_relationship_context_id!;
    const chatRecall = await recallMemories(pool!, auth, {
      surface: "chat",
      person_id: personId,
      relationship_context_id: contextId,
    });
    expect(chatRecall.items).toHaveLength(17);
    const peopleRecall = await recallMemories(pool!, auth, {
      surface: "people",
      person_id: personId,
    });
    expect(peopleRecall.items).toHaveLength(14);
    expect(peopleRecall.items.some((item) => item.scope === "self")).toBe(false);
    const relationshipRecall = await recallMemories(pool!, auth, {
      surface: "relationship",
      person_id: personId,
      relationship_context_id: contextId,
    });
    expect(relationshipRecall.items.filter((item) => item.scope === "relationship")).toHaveLength(6);
    expect(relationshipRecall.items.some((item) => item.scope === "self")).toBe(false);

    const readback = await readMemoryOperation(
      pool!,
      auth,
      result.body.receipt.operation_key,
    );
    expect(readback.state).toBe("applied");
    expect(readback.receipt?.item_count).toBe(17);
  });

  it("persists exactly the checked subset and keeps frozen revisions honest", async () => {
    const auth = await makeAuth("uncheck");
    const { person, all } = draftProposalItems();
    const staged = await stage(auth, {
      items: all,
      contactDecision: "new",
      newContact: { display_label: "Chen", relationship_context: "Design partner" },
      authorityText: "I prefer conclusions first",
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const kept = opened.review.items.filter(
      (item) => !(item.scope === "person" && item.display_text === person[0]!.display_text),
    );
    expect(kept).toHaveLength(16);
    const result = await commit(auth, opened.review, opened.review_credential!, {
      selected: kept.map((item) => item.id),
      contactDecision: "new",
      newContact: { display_label: "Chen", relationship_context: "Design partner" },
    });
    expect(result.body.receipt.item_count).toBe(16);

    await expect(
      commit(auth, opened.review, opened.review_credential!, {
        selected: [opened.review.items[0]!.id],
        contactDecision: "new",
        newContact: { display_label: "Chen", relationship_context: "Design partner" },
      }),
    ).rejects.toThrow(/open|revision|frozen|rebase/i);
  });

  it("refuses contact-dependent memory when the contact is skipped or ambiguous", async () => {
    const auth = await makeAuth("skip");
    const { person } = draftProposalItems();
    const staged = await stage(auth, {
      items: [candidate({ display_text: "I prefer conclusions first" }), person[0]!],
      contactDecision: "new",
      newContact: { display_label: "Chen", relationship_context: "Design partner" },
      authorityText: "I prefer conclusions first",
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const selfItem = opened.review.items.find((item) => item.scope === "self")!;
    const personItem = opened.review.items.find((item) => item.scope === "person")!;
    await expect(
      commit(auth, opened.review, opened.review_credential!, {
        selected: [personItem.id],
        contactDecision: "none",
      }),
    ).rejects.toThrow(/contact/i);

    const skipped = await commit(auth, opened.review, opened.review_credential!, {
      selected: [selfItem.id],
      contactDecision: "none",
    });
    expect(skipped.body.receipt.item_count).toBe(1);
    // The skipped contact leaves person/relationship items pending for restore.
    const reread = await readMemoryReview(
      pool!,
      auth,
      opened.review.review_scope_id,
      opened.review_credential!,
    );
    expect(reread.review.items.some((item) => item.scope === "person")).toBe(true);

    const second = await makeAuth("ambiguous");
    await makeContact(second, "Chen");
    await makeContact(second, "Chen");
    const ambiguous = await stage(second, {
      items: [person[0]!],
      contactDecision: "new",
      newContact: { display_label: "Chen", relationship_context: "Design partner" },
      authorityText: "Chen",
    });
    expect(ambiguous?.proposal.contact_status).toBe("ambiguous");
    const ambiguousOpen = await open(second, ambiguous!.proposal.proposal_id, "chat");
    await expect(
      commit(second, ambiguousOpen.review, ambiguousOpen.review_credential!, {
        selected: ambiguousOpen.review.items.filter((item) => item.scope !== "self").map((item) => item.id),
        contactDecision: "new",
        newContact: { display_label: "Chen", relationship_context: "Design partner" },
      }),
    ).rejects.toThrow(/ambiguous/i);
  });

  it("never strips a contact dependence from a sentence classified as self", async () => {
    const auth = await makeAuth("self-escape");
    const { personId } = await makeContact(auth, "Chen");
    const staged = await stage(auth, {
      items: [
        candidate({
          scope: "self",
          subject_id: personId,
          display_text: "I want to work with Chen",
        }),
      ],
      contactDecision: "existing",
      personId,
    });
    const item = staged && (await open(auth, staged.proposal.proposal_id, "chat"));
    const selfEscape = item!.review.items.find(
      (reviewItem) => reviewItem.judgment_kind === "self_scope_escape",
    );
    expect(selfEscape).toBeTruthy();
    await expect(
      commit(auth, item!.review, item!.review_credential!, {
        selected: [selfEscape!.id],
        contactDecision: "none",
      }),
    ).rejects.toThrow(/self/i);
  });

  it("saves a relationship subset, then rebases the remaining Chat items without replay", async () => {
    const auth = await makeAuth("partial");
    const text = "Chen and I agreed";
    const contact = await makeContact(auth, "Chen");
    const { self, person, relationship } = draftProposalItems();
    const items = [
      ...self.map((item) => candidate({ ...item, source_excerpt: text })),
      ...person.map((item) => candidate({ ...item, source_excerpt: text })),
      ...relationship.map((item) => candidate({ ...item, source_excerpt: text })),
    ];
    const staged = await stage(auth, {
      items,
      contactDecision: "existing",
      personId: contact.personId,
      contextId: contact.contextId,
      authorityText: text,
    });
    const chat = await open(auth, staged!.proposal.proposal_id, "chat");
    expect(chat.review.visible_item_count).toBe(17);
    const relationshipScope = await open(
      auth,
      staged!.proposal.proposal_id,
      "relationship",
      contact.personId,
      contact.contextId,
    );
    const six = relationshipScope.review.items.filter(
      (item) => item.scope === "relationship",
    );
    expect(six).toHaveLength(6);
    const partial = await commit(
      auth,
      relationshipScope.review,
      relationshipScope.review_credential!,
      { selected: six.map((item) => item.id), contactDecision: "existing" },
    );
    expect(partial.body.receipt.item_count).toBe(6);

    // The stale Chat scope cannot replay the pre-partial revision.
    await expect(
      commit(auth, chat.review, chat.review_credential!, {
        selected: chat.review.items.map((item) => item.id),
        contactDecision: "existing",
      }),
    ).rejects.toThrow(/frozen|revision|rebase/i);

    const chatRebased = await open(auth, staged!.proposal.proposal_id, "chat");
    expect(chatRebased.review.visible_item_count).toBe(11);
    expect(chatRebased.review.items.some((item) => item.scope === "relationship")).toBe(false);
    const rest = await commit(
      auth,
      chatRebased.review,
      chatRebased.review_credential!,
      {
        selected: chatRebased.review.items.map((item) => item.id),
        contactDecision: "existing",
      },
    );
    expect(rest.body.receipt.item_count).toBe(11);
    const total = await pool!.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM memory_items WHERE account_id=$1 AND status='active'",
      [auth.accountId],
    );
    expect(total.rows[0]?.count).toBe(17);
    const recalled = await recallMemories(pool!, auth, {
      surface: "relationship",
      person_id: contact.personId,
      relationship_context_id: contact.contextId,
    });
    expect(recalled.items.filter((item) => item.scope === "relationship")).toHaveLength(6);
  });

  it("restores the same contact but never moves memory to another person", async () => {
    const auth = await makeAuth("rebase");
    const { person } = draftProposalItems();
    const contactA = await makeContact(auth, "Chen");
    const contactB = await makeContact(auth, "Dana");
    const staged = await stage(auth, {
      items: [candidate({ display_text: "I prefer conclusions first" }), person[0]!],
      contactDecision: "existing",
      personId: contactA.personId,
      contextId: contactA.contextId,
      authorityText: "Chen",
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const restore = await rebaseMemoryProposal(pool!, auth, staged!.proposal.proposal_id, {
      expected_proposal_revision: opened.review.proposal_revision,
      contact_decision: "existing",
      person_id: contactA.personId,
      reason: "restore same contact",
    });
    expect(restore.replayed).toBe(true);

    const switched = await rebaseMemoryProposal(pool!, auth, staged!.proposal.proposal_id, {
      expected_proposal_revision: opened.review.proposal_revision,
      contact_decision: "existing",
      person_id: contactB.personId,
      reason: "switch contact",
    });
    expect(switched.replayed).toBe(false);
    expect(switched.proposal.person_id).toBe(contactB.personId);
    const rows = await pool!.query<{ scope: string; status: string }>(
      "SELECT scope,status FROM memory_proposal_items WHERE account_id=$1 AND proposal_id=$2",
      [auth.accountId, staged!.proposal.proposal_id],
    );
    expect(rows.rows.filter((row) => row.scope !== "self").every((row) => row.status === "skipped")).toBe(true);
    expect(rows.rows.some((row) => row.scope === "self" && row.status === "pending")).toBe(true);
  });

  it("revokes recall after explicit Session deletion but keeps it after natural expiry", async () => {
    const auth = await makeAuth("ttl");
    const commitOne = async (sessionId: string, text: string) => {
      const staged = await stage(auth, {
        items: [candidate({ display_text: text })],
        contactDecision: "none",
        sessionId,
        authorityText: text,
      });
      const opened = await open(auth, staged!.proposal.proposal_id, "chat");
      const result = await commit(auth, opened.review, opened.review_credential!, {
        selected: opened.review.items.map((item) => item.id),
        contactDecision: "none",
      });
      return result.body.receipt;
    };

    const expirySession = randomUUID();
    const expiryMemory = (await commitOne(expirySession, "I prefer conclusions first")).created_item_ids[0]!;
    // Natural Session/image TTL must not revoke independently retained evidence.
    await pool!.query(
      "UPDATE agent_sessions SET expires_at = now() - interval '1 day' WHERE account_id=$1 AND id=$2",
      [auth.accountId, expirySession],
    );
    const afterExpiry = await recallMemories(pool!, auth, { surface: "chat" });
    expect(afterExpiry.items.map((item) => item.id)).toContain(expiryMemory);

    const deleteSession = randomUUID();
    const deleteReceipt = await commitOne(deleteSession, "I read examples before deciding");
    const deleteMemory = deleteReceipt.created_item_ids[0]!;
    // Explicit Session deletion is the real production path and revokes recall.
    await mutateAgentSession(
      pool!,
      auth,
      deleteSession,
      { expected_revision: 1, idempotency_key: randomUUID() },
      true,
    );
    const afterDelete = await recallMemories(pool!, auth, { surface: "chat" });
    expect(afterDelete.items.map((item) => item.id)).not.toContain(deleteMemory);
    expect(afterDelete.items.map((item) => item.id)).toContain(expiryMemory);
    const itemRow = await pool!.query<{ status: string }>(
      "SELECT status FROM memory_items WHERE account_id=$1 AND id=$2",
      [auth.accountId, deleteMemory],
    );
    expect(itemRow.rows[0]?.status).toBe("invalidated");
    const revokedReadback = await readMemoryOperation(
      pool!,
      auth,
      deleteReceipt.operation_key,
    );
    expect(revokedReadback.state).toBe("source_revoked");
    expect(revokedReadback.receipt).toBeNull();
  });

  it("invalidates dependent memory through the real capture deletion path", async () => {
    const auth = await makeAuth("capture-delete");
    const captureId = randomUUID();
    const resourceId = randomUUID();
    const fragmentId = randomUUID();
    await pool!.query(
      `INSERT INTO captures(id,account_id,created_by_user_id,source_kind,source_metadata,identity_status,identity_context,purpose)
       VALUES($1,$2,$3,'conversation_transcript','{}'::jsonb,'unbound','{}'::jsonb,'memory integration test')`,
      [captureId, auth.accountId, auth.userId],
    );
    await pool!.query(
      `INSERT INTO source_resources(
         id,account_id,capture_id,created_by_user_id,client_resource_id,resource_kind,
         input_channel,display_name,media_type,observed_at,retention_scope
       ) VALUES($1,$2,$3,$4,$5,'conversation_transcript','chat','Transcript','text/plain',now(),'reviewed_selected_text')`,
      [resourceId, auth.accountId, captureId, auth.userId, `client-${resourceId}`],
    );
    await pool!.query(
      `INSERT INTO source_retention_receipts(
         receipt_id,account_id,capture_id,policy_version,requested_mode,effective_mode,
         source_scope,source_access_state,source_access_reason,created_at
       ) VALUES($1,$2,$3,'source-retention.v2','evidence_crop','evidence_crop',
                'reviewed_selected_text','available','awaiting_review_completion',now())`,
      [randomUUID(), auth.accountId, captureId],
    );
    await pool!.query(
      `INSERT INTO evidence_fragments(
         id,account_id,capture_id,resource_id,fragment_kind,sequence,text_content,
         content_hash,locator,attributed_actor,attribution_status,parser_name,parser_version
       ) VALUES($1,$2,$3,$4,'message',0,$5,$6,'{}'::jsonb,'recruiter','confirmed','test','1')`,
      [fragmentId, auth.accountId, captureId, resourceId, "I prefer conclusions first", "hash-1"],
    );
    const authority: MemorySourceAuthority = {
      text: "I prefer conclusions first",
      artifacts: [
        {
          artifactId: `${captureId}:message:0`,
          kind: "text",
          sessionId: null,
          messageId: null,
          captureId,
          sourceResourceId: resourceId,
          evidenceFragmentId: fragmentId,
          contentHash: null,
          captureVersion: 1,
        },
      ],
      sessionId: null,
      messageId: null,
      sourceTaskId: null,
      captureIds: [captureId],
      messageTextHash: null,
      imageManifest: [],
      captureVersion: 1,
      captureSubjectId: null,
      captureContextId: null,
    };
    const staged = await inTransaction(pool!, (client) =>
      stageMemoryProposal(
        client,
        auth,
        {
          idempotency_key: randomUUID(),
          surface: "chat",
          session_id: null,
          source_task_id: randomUUID(),
          source_message_id: null,
          person_id: null,
          relationship_context_id: null,
          contact_decision: "none",
          new_contact: null,
          proposer: { kind: "human", name: "integration-test", version: "1" },
          items: [
            candidate({
              display_text: "I prefer conclusions first",
              source_locator: { kind: "document", source_resource_id: resourceId, locator: {} },
            }),
          ],
        },
        authority,
      ),
    );
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const result = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "none",
    });
    const memoryId = result.body.receipt.created_item_ids[0]!;
    await deleteCapture(pool!, auth, captureId, {
      idempotency_key: randomUUID(),
      reason: "integration test deletion",
    });
    const recalled = await recallMemories(pool!, auth, { surface: "chat" });
    expect(recalled.items.map((item) => item.id)).not.toContain(memoryId);
  });

  it("applies explicit conflict decisions and conservatively labels edits", async () => {
    const auth = await makeAuth("conflict");
    const { personId } = await makeContact(auth, "Chen");
    const first = await stage(auth, {
      items: [
        candidate({
          scope: "person",
          display_text: "Chen is located in Shanghai",
          source_excerpt: "Chen is located in Shanghai",
        }),
      ],
      contactDecision: "existing",
      personId,
      authorityText: "Chen is located in Shanghai",
    });
    const firstOpen = await open(auth, first!.proposal.proposal_id, "chat");
    const firstCommit = await commit(auth, firstOpen.review, firstOpen.review_credential!, {
      selected: firstOpen.review.items.map((item) => item.id),
      contactDecision: "existing",
    });
    const previousId = firstCommit.body.receipt.created_item_ids[0]!;

    const second = await stage(auth, {
      items: [
        candidate({
          scope: "person",
          operation: "contest",
          display_text: "Chen is located in Beijing",
          source_excerpt: "Chen is located in Beijing",
          previous_memory_item_id: previousId,
          previous_revision: 1,
        }),
      ],
      contactDecision: "existing",
      personId,
      authorityText: "Chen is located in Beijing",
    });
    const secondOpen = await open(auth, second!.proposal.proposal_id, "chat");
    const item = secondOpen.review.items[0]!;
    const keepOld = await commit(auth, secondOpen.review, secondOpen.review_credential!, {
      selected: [item.id],
      contactDecision: "existing",
      decisions: { [item.id]: "keep_old" },
    });
    expect(keepOld.body.receipt.kept_old_item_ids).toContain(item.id);
    const stillShanghai = await recallMemories(pool!, auth, {
      surface: "people",
      person_id: personId,
    });
    expect(stillShanghai.items.every((entry) => entry.display_text.includes("Shanghai"))).toBe(true);

    const edited = await stage(auth, {
      items: [
        candidate({
          scope: "person",
          display_text: "Chen is located in Beijing",
          source_excerpt: "Chen is located in Beijing",
        }),
      ],
      contactDecision: "existing",
      personId,
      authorityText: "Chen is located in Beijing",
    });
    const editedOpen = await open(auth, edited!.proposal.proposal_id, "chat");
    const editedItem = editedOpen.review.items[0]!;
    const editedCommit = await commit(auth, editedOpen.review, editedOpen.review_credential!, {
      selected: [editedItem.id],
      contactDecision: "existing",
      edited: { [editedItem.id]: `${editedItem.display_text} and seeks a new job` },
    });
    const stored = await pool!.query<{ original_display_text: string; display_text: string }>(
      "SELECT original_display_text, display_text FROM memory_items WHERE account_id=$1 AND id=$2",
      [auth.accountId, editedCommit.body.receipt.created_item_ids[0]!],
    );
    expect(stored.rows[0]?.original_display_text).toBe("Chen is located in Beijing");
    expect(stored.rows[0]?.display_text).toContain("seeks a new job");
  });

  it("blocks undo after a later accepted correction and reclaims an otherwise unused contact", async () => {
    const auth = await makeAuth("undo");
    const { person } = draftProposalItems();
    const staged = await stage(auth, {
      items: [person[0]!],
      contactDecision: "new",
      newContact: { display_label: "Chen", relationship_context: "Design partner" },
      authorityText: "Chen",
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const result = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "new",
      newContact: { display_label: "Chen", relationship_context: "Design partner" },
    });
    const memoryId = result.body.receipt.created_item_ids[0]!;
    const corrected = await mutateMemoryItem(pool!, auth, memoryId, {
      operation: "correct",
      idempotency_key: randomUUID(),
      expected_version: 1,
      display_text: "Chen statement zero, corrected",
      reason: "test correction",
    });
    expect(corrected.status).toBe("active");
    await expect(
      undoMemoryCommit(pool!, auth, result.body.receipt.commit_id, {
        idempotency_key: randomUUID(),
        expected_commit_revision: 1,
        reason: "too late",
      }),
    ).rejects.toThrow(/undo|version/i);

    const clean = await makeAuth("undo-clean");
    const cleanStaged = await stage(clean, {
      items: [candidate({ display_text: "I prefer conclusions first" })],
      contactDecision: "none",
    });
    const cleanOpen = await open(clean, cleanStaged!.proposal.proposal_id, "chat");
    const cleanResult = await commit(clean, cleanOpen.review, cleanOpen.review_credential!, {
      selected: cleanOpen.review.items.map((item) => item.id),
      contactDecision: "none",
    });
    const undone = await undoMemoryCommit(pool!, clean, cleanResult.body.receipt.commit_id, {
      idempotency_key: randomUUID(),
      expected_commit_revision: 1,
      reason: "undo clean commit",
    });
    expect(undone.receipt.status).toBe("undone");
    const recalled = await recallMemories(pool!, clean, { surface: "chat" });
    expect(recalled.items).toHaveLength(0);
  });

  it("scopes proposal listing and receipts to the requesting purpose", async () => {
    const auth = await makeAuth("scoping");
    const { personId, contextId } = await makeContact(auth, "Chen");
    const staged = await stage(auth, {
      items: [
        candidate({ display_text: "I prefer conclusions first" }),
        candidate({
          scope: "relationship",
          relationship_context_id: contextId,
          display_text: "Chen wants a text plan first",
          source_excerpt: "Chen wants a text plan first",
        }),
      ],
      contactDecision: "existing",
      personId,
      contextId,
      authorityText: "Chen wants a text plan first",
    });
    const chatList = await listMemoryProposals(pool!, auth, "chat", null, null);
    expect(chatList.proposals[0]?.item_count).toBe(2);
    const peopleList = await listMemoryProposals(pool!, auth, "people", personId, null);
    expect(peopleList.proposals[0]?.item_count).toBe(1);
    const relationshipList = await listMemoryProposals(
      pool!,
      auth,
      "relationship",
      personId,
      contextId,
    );
    expect(relationshipList.proposals[0]?.item_count).toBe(1);
    await expect(listMemoryProposals(pool!, auth, "people", null, null)).rejects.toThrow();

    const opened = await open(auth, staged!.proposal.proposal_id, "relationship", personId, contextId);
    expect(opened.review.items.every((item) => item.scope === "relationship")).toBe(true);
    await expect(
      readMemoryReview(pool!, auth, opened.review.review_scope_id, "wrong-credential-value"),
    ).rejects.toThrow(/bound|purpose|credential/i);
  });

  it("preserves speaker, reporter, and a future plan's time status", async () => {
    const auth = await makeAuth("temporal");
    const { personId } = await makeContact(auth, "Chen");
    const text = "陈宇说，他转述 B 的话；他下月计划换团队";
    const staged = await stage(auth, {
      items: [
        candidate({
          scope: "person",
          statement_kind: "source_statement",
          speaker: "B",
          reporter: "陈宇",
          display_text: "陈宇转述：B 计划下月换团队",
          source_excerpt: "他转述 B 的话",
          time_status: "future",
          valid_time: null,
        }),
      ],
      contactDecision: "existing",
      personId,
      authorityText: text,
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const result = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "existing",
    });
    const stored = await pool!.query<{
      speaker: string;
      reporter: string;
      time_status: string;
      statement_kind: string;
    }>(
      "SELECT speaker, reporter, time_status, statement_kind FROM memory_items WHERE account_id=$1 AND id=$2",
      [auth.accountId, result.body.receipt.created_item_ids[0]!],
    );
    expect(stored.rows[0]).toMatchObject({
      speaker: "B",
      reporter: "陈宇",
      time_status: "future",
      statement_kind: "source_statement",
    });
  });

  it("rejects pending read/commit/reproposal after the original source expires", async () => {
    const auth = await makeAuth("pending-ttl");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const staged = await stage(auth, {
      items: [candidate({ display_text: "I prefer conclusions first" })],
      contactDecision: "none",
      sessionId,
      messageId,
    });
    await pool!.query(
      "UPDATE agent_sessions SET expires_at = now() - interval '1 day' WHERE account_id=$1 AND id=$2",
      [auth.accountId, sessionId],
    );
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    expect(opened.review.visible_item_count).toBe(0);
    await expect(
      commit(auth, opened.review, opened.review_credential!, {
        selected: opened.review.items.map((item) => item.id),
        contactDecision: "none",
        expectedRevision: staged!.proposal.revision,
      }),
    ).rejects.toThrow(/source/i);
    await expect(
      regenerateMemoryProposal(
        pool!,
        auth,
        staged!.proposal.proposal_id,
        {
          expected_proposal_revision: staged!.proposal.revision,
          contact_decision: "none",
          identity_authority: "tentative",
          reason: "reproposal after expiry",
        },
        async () => {
          throw new Error("regenerator must not run when the source is unavailable");
        },
      ),
    ).rejects.toThrow(/source|unavailable/i);
  });

  it("rejects a commit when the reviewed message text changes or an image disappears", async () => {
    const auth = await makeAuth("mutated-source");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const staged = await stage(auth, {
      items: [candidate({ display_text: "I prefer conclusions first" })],
      contactDecision: "none",
      sessionId,
      messageId,
    });
    await pool!.query(
      "UPDATE agent_sessions SET payload = jsonb_set(payload, '{turns,0,objective}', to_jsonb($3::text)) WHERE account_id=$1 AND id=$2",
      [auth.accountId, sessionId, "I prefer long explanations first"],
    );
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    await expect(
      commit(auth, opened.review, opened.review_credential!, {
        selected: staged!.proposal.item_count > 0 ? opened.review.items.map((i) => i.id) : [],
        contactDecision: "none",
      }),
    ).rejects.toThrow(/source/i);
  });

  it("still commits the exact original message after an unrelated later turn is appended", async () => {
    const auth = await makeAuth("appended-turn");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const staged = await stage(auth, {
      items: [candidate({ display_text: "I prefer conclusions first" })],
      contactDecision: "none",
      sessionId,
      messageId,
    });
    const extraTurn = JSON.stringify([{
      id: randomUUID(),
      objective: "an unrelated later question",
      response: {
        contractVersion: "2026-08-24.10",
        taskID: randomUUID(),
        contextManifestID: randomUUID(),
        knowledgeSnapshotID: randomUUID(),
        disposition: "answer",
        createdAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    }]);
    await pool!.query(
      "UPDATE agent_sessions SET payload = jsonb_set(payload, '{turns}', (payload->'turns') || $3::jsonb) WHERE account_id=$1 AND id=$2",
      [auth.accountId, sessionId, extraTurn],
    );
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const result = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "none",
    });
    expect(result.body.receipt.item_count).toBe(1);
  });

  it("refuses a contact-only commit after the source is explicitly deleted", async () => {
    const auth = await makeAuth("contact-only-delete");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const staged = await stage(auth, {
      items: [
        candidate({
          scope: "person",
          display_text: "Chen owns the design system",
          source_excerpt: "Chen owns the design system",
        }),
      ],
      contactDecision: "new",
      newContact: { display_label: "Chen", relationship_context: "" },
      authorityText: "Chen owns the design system",
      sessionId,
      messageId,
    });
    await mutateAgentSession(pool!, auth, sessionId, {
      expected_revision: 1,
      idempotency_key: randomUUID(),
    }, true);
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    await expect(
      commit(auth, opened.review, opened.review_credential!, {
        selected: [],
        contactDecision: "new",
        newContact: { display_label: "Chen", relationship_context: "" },
      }),
    ).rejects.toThrow(/source/i);
    const people = await pool!.query("SELECT COUNT(*)::int AS count FROM subjects WHERE account_id=$1 AND display_label='Chen'", [auth.accountId]);
    expect(people.rows[0]?.count).toBe(0);
  });

  it("keeps self and relationship memory private to the same-account author", async () => {
    const author = await makeAuth("privacy-author");
    const other = { ...author, userId: randomUUID(), userEmail: `other-${author.accountId}@synthetic.local` };
    await pool!.query(
      "INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,$4,'simulated_human')",
      [other.userId, author.accountId, other.userEmail, "Other Owner"],
    );
    const contact = await makeContact(author, "Chen");
    await pool!.query("UPDATE assignments SET external_ref=$3 WHERE account_id=$1 AND id=$2", [author.accountId, contact.contextId, `privacy-context:${contact.contextId}`]);

    const staged = await stage(author, {
      items: [
        candidate({ display_text: "I prefer conclusions first" }),
        candidate({
          scope: "relationship",
          display_text: "I promised Chen a prototype on Friday",
          source_excerpt: "I promised Chen a prototype on Friday",
        }),
      ],
      contactDecision: "existing",
      personId: contact.personId,
      contextId: contact.contextId,
      authorityText: "I promised Chen a prototype on Friday",
    });
    const opened = await open(author, staged!.proposal.proposal_id, "chat");
    const result = await commit(author, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "existing",
    });
    const relationshipItem = result.body.receipt.created_item_ids[1]!;

    const otherChat = await recallMemories(pool!, other, { surface: "chat" });
    expect(otherChat.items).toHaveLength(0);
    const otherBiz = await recallMemories(pool!, other, {
      surface: "relationship",
      person_id: contact.personId,
      relationship_context_id: contact.contextId,
    });
    expect(otherBiz.items).toHaveLength(0);
    await expect(
      readMemoryReview(pool!, other, opened.review.review_scope_id, opened.review_credential!),
    ).rejects.toThrow(/not found/i);
    await expect(
      mutateMemoryItem(pool!, other, relationshipItem, {
        operation: "delete",
        idempotency_key: randomUUID(),
        expected_version: 1,
        reason: "should not be allowed",
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("requires human or stable-handle authority to bind an existing same-name contact", async () => {
    const auth = await makeAuth("identity-authority");
    const first = await makeContact(auth, "Chen");
    const second = await makeContact(auth, "Chen");
    const item = candidate({
      scope: "person",
      display_text: "Chen owns the design system",
      source_excerpt: "Chen owns the design system",
    });
    // Tentative model selection cannot resolve a same-name contact.
    const tentative = await stage(auth, {
      items: [item],
      contactDecision: "existing",
      personId: second.personId,
      identityAuthority: "tentative",
      authorityText: "Chen owns the design system",
    });
    const tentativeOpen = await open(
      auth,
      tentative!.proposal.proposal_id,
      "chat",
    );
    await expect(
      commit(auth, tentativeOpen.review, tentativeOpen.review_credential!, {
        selected: tentativeOpen.review.items.map((i) => i.id),
        contactDecision: "existing",
        identityAuthority: "tentative",
      }),
    ).rejects.toThrow(/authoriz|identity|ambiguous/i);
    // Explicit human selection of the second same-name contact succeeds.
    const human = await stage(auth, {
      items: [item],
      contactDecision: "existing",
      personId: second.personId,
      identityAuthority: "human_selection",
      authorityText: "Chen owns the design system",
    });
    expect(human!.proposal.contact_status).toBe("resolved");
    const humanOpen = await open(auth, human!.proposal.proposal_id, "chat");
    const result = await commit(auth, humanOpen.review, humanOpen.review_credential!, {
      selected: humanOpen.review.items.map((i) => i.id),
      contactDecision: "existing",
      identityAuthority: "human_selection",
    });
    expect(result.body.receipt.created_item_ids).toHaveLength(1);
    const stored = await pool!.query<{ subject_id: string }>(
      "SELECT subject_id FROM memory_items WHERE account_id=$1 AND id=$2",
      [auth.accountId, result.body.receipt.created_item_ids[0]!],
    );
    expect(stored.rows[0]?.subject_id).toBe(second.personId);
    // A unique name with a different handle is not auto-bound by stable handle.
    const third = await makeContact(auth, "Dana");
    await expect(
      stage(auth, {
        items: [item],
        contactDecision: "existing",
        personId: third.personId,
        identityAuthority: "stable_handle",
        identityClue: { type: "email", value: "chen@example.com" },
        authorityText: "Chen owns the design system",
      }),
    ).rejects.toThrow(/handle/i);
    expect(first.personId).toBeTruthy();
  });

  it("dismisses a whole card and a business subset without creating memory", async () => {
    const auth = await makeAuth("dismiss");
    const contact = await makeContact(auth, "Chen");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const staged = await stage(auth, {
      items: [
        candidate({ display_text: "I prefer conclusions first" }),
        candidate({
          scope: "person",
          display_text: "Chen owns the design system",
          source_excerpt: "Chen owns the design system",
        }),
        candidate({
          scope: "relationship",
          display_text: "Chen wants a text plan first",
          source_excerpt: "Chen wants a text plan first",
        }),
      ],
      contactDecision: "existing",
      personId: contact.personId,
      contextId: contact.contextId,
      authorityText: "Chen owns the design system; Chen wants a text plan first",
      sessionId,
      messageId,
    });
    const chat = await open(auth, staged!.proposal.proposal_id, "chat");
    const dismissed = await dismissMemoryReview(
      pool!,
      auth,
      chat.review.review_scope_id,
      chat.review_credential!,
      {
        idempotency_key: randomUUID(),
        expected_review_revision: chat.review.review_revision,
        item_ids: [],
        reason: "no save",
      },
    );
    expect(dismissed.dismissed_item_ids).toHaveLength(3);
    expect(dismissed.proposal_status).toBe("dismissed");
    const memories = await pool!.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM memory_items WHERE account_id=$1",
      [auth.accountId],
    );
    expect(memories.rows[0]?.count).toBe(0);
    // A genuinely new source can propose again; the same source cannot.
    await expect(
      stage(auth, {
        items: [
          candidate({
            scope: "person",
            display_text: "Chen owns the design system",
            source_excerpt: "Chen owns the design system",
          }),
        ],
        contactDecision: "existing",
        personId: contact.personId,
        contextId: contact.contextId,
        authorityText: "Chen owns the design system",
        sessionId,
        messageId,
        reuseSession: true,
      }),
    ).resolves.toBeNull();
  });

  it("stages a local 3/8/6 draft from two admitted image-only screenshots", async () => {
    const auth = await makeAuth("image-only");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const image0 = { attachmentId: randomUUID(), contentHash: "a".repeat(64) };
    const image1 = { attachmentId: randomUUID(), contentHash: "b".repeat(64) };
    const artifact0 = `conversation-image-${messageId}-0-${image0.attachmentId}`;
    const artifact1 = `conversation-image-${messageId}-1-${image1.attachmentId}`;
    const imageCandidate = (
      artifactId: string,
      imageIndex: number,
      overrides: Partial<MemoryProposalCandidate>,
    ) =>
      candidate({
        source_locator: {
          kind: "image_region",
          artifact_id: artifactId,
          session_id: null,
          image_index: imageIndex,
          region: null,
        },
        source_excerpt: overrides.source_excerpt ?? "截图中的一句话",
        ...overrides,
      });
    const items: MemoryProposalCandidate[] = [
      imageCandidate(artifact0, 0, { display_text: "我要求回复先给结论" }),
      imageCandidate(artifact0, 0, { display_text: "我做决定前喜欢看具体案例" }),
      imageCandidate(artifact0, 0, { display_text: "这季度我在找设计合作者" }),
      ...Array.from({ length: 8 }, (_v, i) =>
        imageCandidate(artifact0, 0, {
          scope: "person",
          statement_kind: "source_statement",
          speaker: "陈宇",
          display_text: `陈宇说截图事实 ${i}`,
        }),
      ),
      ...Array.from({ length: 6 }, (_v, i) =>
        imageCandidate(artifact1, 1, {
          scope: "relationship",
          statement_kind: "source_statement",
          speaker: "陈宇",
          display_text: `我们约定截图事项 ${i}`,
        }),
      ),
    ];
    const staged = await stage(auth, {
      items,
      contactDecision: "new",
      newContact: {
        display_label: "陈宇",
        relationship_context: "设计合作",
        source_locator: {
          kind: "image_region",
          artifact_id: artifact0,
          session_id: null,
          image_index: 0,
          region: null,
        },
      },
      authorityText: "帮我写回复",
      sessionId,
      messageId,
      images: [image0, image1],
    });
    expect(staged?.scopeCounts).toEqual({ self: 3, person: 8, relationship: 6 });
    expect(staged?.proposal.contact_status).toBe("pending");
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    expect(opened.review.visible_item_count).toBe(17);
    const result = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "new",
      newContact: { display_label: "陈宇", relationship_context: "设计合作" },
    });
    expect(result.body.receipt.item_count).toBe(17);
    expect(result.body.receipt.created_person_id).toBeTruthy();
  });

  it("refuses a commit when one admitted image disappears", async () => {
    const auth = await makeAuth("image-missing");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const image0 = { attachmentId: randomUUID(), contentHash: "c".repeat(64) };
    const image1 = { attachmentId: randomUUID(), contentHash: "d".repeat(64) };
    const staged = await stage(auth, {
      items: [
        candidate({
          source_locator: {
            kind: "image_region",
            artifact_id: `conversation-image-${messageId}-0-${image0.attachmentId}`,
            session_id: null,
            image_index: 0,
            region: null,
          },
          source_excerpt: "截图内容",
        }),
      ],
      contactDecision: "none",
      authorityText: "帮我写回复",
      sessionId,
      messageId,
      images: [image0, image1],
    });
    await pool!.query(
      "DELETE FROM conversation_message_images WHERE account_id=$1 AND session_id=$2 AND message_id=$3 AND image_index=1",
      [auth.accountId, sessionId, messageId],
    );
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    expect(opened.review.visible_item_count).toBe(0);
    await expect(
      commit(auth, opened.review, opened.review_credential!, {
        selected: opened.review.items.map((item) => item.id),
        contactDecision: "none",
      }),
    ).rejects.toThrow(/source|empty/i);
  });

  it("refuses a commit when an admitted image digest changes", async () => {
    const auth = await makeAuth("image-digest");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const image0 = { attachmentId: randomUUID(), contentHash: "e".repeat(64) };
    const staged = await stage(auth, {
      items: [
        candidate({
          source_locator: {
            kind: "image_region",
            artifact_id: `conversation-image-${messageId}-0-${image0.attachmentId}`,
            session_id: null,
            image_index: 0,
            region: null,
          },
          source_excerpt: "截图内容",
        }),
      ],
      contactDecision: "none",
      authorityText: "帮我写回复",
      sessionId,
      messageId,
      images: [image0],
    });
    await pool!.query(
      "UPDATE conversation_message_images SET content_hash=$4 WHERE account_id=$1 AND session_id=$2 AND message_id=$3 AND image_index=0",
      [auth.accountId, sessionId, messageId, "f".repeat(64)],
    );
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    expect(opened.review.visible_item_count).toBe(0);
    await expect(
      commit(auth, opened.review, opened.review_credential!, {
        selected: opened.review.items.map((item) => item.id),
        contactDecision: "none",
      }),
    ).rejects.toThrow(/source|empty/i);
  });

  it("serializes a concurrent source delete against the pending source lock", async () => {
    const auth = await makeAuth("concurrent-source");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const staged = await stage(auth, {
      items: [candidate({ display_text: "I prefer conclusions first" })],
      contactDecision: "none",
      sessionId,
      messageId,
    });
    const proposalRow = (
      await pool!.query(
        "SELECT * FROM memory_proposals WHERE account_id=$1 AND id=$2",
        [auth.accountId, staged!.proposal.proposal_id],
      )
    ).rows[0];
    const itemRows = (
      await pool!.query(
        "SELECT * FROM memory_proposal_items WHERE account_id=$1 AND proposal_id=$2",
        [auth.accountId, staged!.proposal.proposal_id],
      )
    ).rows;
    const lockConnection = await pool!.connect();
    const deleteConnection = await pool!.connect();
    try {
      await lockConnection.query("BEGIN");
      const verification = await verifyPendingSourceAuthority(
        lockConnection,
        auth,
        proposalRow as never,
        itemRows as never,
        { lock: true },
      );
      expect(verification.proposalSourceAvailable).toBe(true);
      await deleteConnection.query("BEGIN");
      await deleteConnection.query("SET LOCAL lock_timeout='150ms'");
      let blocked = false;
      try {
        await deleteConnection.query(
          "UPDATE agent_sessions SET deleted_at=now(), payload=NULL WHERE account_id=$1 AND id=$2",
          [auth.accountId, sessionId],
        );
      } catch (error) {
        blocked = (error as { code?: string }).code === "55P03";
        await deleteConnection.query("ROLLBACK");
      }
      expect(blocked).toBe(true);
      await lockConnection.query("COMMIT");
    } finally {
      lockConnection.release();
      deleteConnection.release();
    }
    // Delete-before-commit must refuse; the row lock released above.
    await mutateAgentSession(
      pool!,
      auth,
      sessionId,
      { expected_revision: 1, idempotency_key: randomUUID() },
      true,
    );
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    await expect(
      commit(auth, opened.review, opened.review_credential!, {
        selected: opened.review.items.map((item) => item.id),
        contactDecision: "none",
      }),
    ).rejects.toThrow(/source|empty/i);
  });

  it("regenerates fresh candidates for a changed target without moving old items", async () => {
    const auth = await makeAuth("regenerate");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const text = "陈宇负责设计系统；我们约定先发文字方案";
    const staged = await stage(auth, {
      items: [
        candidate({ display_text: "我要求回复先给结论" }),
        candidate({ display_text: "我看具体案例再决定" }),
        candidate({ display_text: "这季度我在找设计合作者" }),
        candidate({
          scope: "person",
          statement_kind: "source_statement",
          speaker: "陈宇",
          display_text: "陈宇负责设计系统",
          source_excerpt: "陈宇负责设计系统",
        }),
        candidate({
          scope: "relationship",
          statement_kind: "source_statement",
          speaker: "陈宇",
          display_text: "我们约定先发文字方案",
          source_excerpt: "我们约定先发文字方案",
        }),
      ],
      contactDecision: "new",
      newContact: { display_label: "陈宇", relationship_context: "设计合作" },
      authorityText: text,
      sessionId,
      messageId,
    });
    const chat = await open(auth, staged!.proposal.proposal_id, "chat");
    const selfItems = chat.review.items.filter((item) => item.scope === "self");
    const skipped = await commit(auth, chat.review, chat.review_credential!, {
      selected: selfItems.map((item) => item.id),
      contactDecision: "none",
    });
    expect(skipped.body.receipt.item_count).toBe(3);
    // Person/relationship items stay pending for restore.
    const reread = await readMemoryReview(
      pool!,
      auth,
      chat.review.review_scope_id,
      chat.review_credential!,
    );
    expect(reread.review.items.some((item) => item.scope === "person")).toBe(true);

    const regenerator = vi.fn(async () => [
      candidate({
        scope: "person",
        statement_kind: "source_statement",
        speaker: "陈宇",
        display_text: "陈宇负责设计系统（重新核对）",
        source_excerpt: "陈宇负责设计系统",
      }),
      candidate({
        scope: "relationship",
        statement_kind: "source_statement",
        speaker: "陈宇",
        display_text: "我们约定先发文字方案（重新核对）",
        source_excerpt: "我们约定先发文字方案",
      }),
    ]);
    const result = await regenerateMemoryProposal(
      pool!,
      auth,
      staged!.proposal.proposal_id,
      {
        expected_proposal_revision: staged!.proposal.revision,
        contact_decision: "new",
        identity_authority: "tentative",
        new_contact: { display_label: "林恩", relationship_context: "设计合作" },
        reason: "identity changed",
      },
      regenerator,
    );
    expect(regenerator).toHaveBeenCalledOnce();
    expect(result.proposal.revision).toBe(2);
    // The new relationship label stays a label, never a context id.
    expect(result.proposal.relationship_context_id).toBeNull();
    expect(result.proposal.relationship_display_label).toBe("设计合作");
    const fresh = await open(auth, staged!.proposal.proposal_id, "chat");
    const scopes = fresh.review.items.map((item) => item.scope).sort();
    expect(scopes).toContain("relationship");
    expect(scopes).toContain("person");
  });

  it("never returns a cached success after the committed source is deleted", async () => {
    const auth = await makeAuth("truthful-replay");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const staged = await stage(auth, {
      items: [candidate({ display_text: "I prefer conclusions first" })],
      contactDecision: "none",
      sessionId,
      messageId,
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const operationKey = randomUUID();
    const first = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "none",
      idempotencyKey: operationKey,
    });
    await mutateAgentSession(
      pool!,
      auth,
      sessionId,
      { expected_revision: 1, idempotency_key: randomUUID() },
      true,
    );
    const readback = await readMemoryOperation(pool!, auth, operationKey);
    expect(readback.state).toBe("source_revoked");
    expect(readback.receipt).toBeNull();
    await expect(
      commit(auth, opened.review, opened.review_credential!, {
        selected: opened.review.items.map((item) => item.id),
        contactDecision: "none",
        idempotencyKey: operationKey,
      }),
    ).rejects.toThrow(/source/i);
    expect(first.body.receipt.item_count).toBe(1);
  });

  it("rejects a stale item revision before committing any Memory", async () => {
    const auth = await makeAuth("item-decision-stale");
    const staged = await stage(auth, {
      items: [candidate({ display_text: "I want direct answers" })],
      contactDecision: "none",
      sessionId: randomUUID(),
      messageId: randomUUID(),
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const target = opened.review.items[0]!;
    await expect(decideMemoryReviewItem(pool!, auth, opened.review.review_scope_id, opened.review_credential!, {
      idempotency_key: randomUUID(),
      expected_proposal_revision: opened.review.proposal_revision,
      expected_review_revision: opened.review.review_revision,
      item_id: target.id,
      expected_item_added_revision: target.added_revision + 1,
      contact_decision: "none",
      decision: "accept",
      reason: "stale item",
    })).rejects.toMatchObject({ code: "MEMORY_ITEM_STALE" });
    const row = await pool!.query<{ status: string }>(
      "SELECT status FROM memory_proposal_items WHERE account_id=$1 AND id=$2",
      [auth.accountId, target.id],
    );
    expect(row.rows[0]?.status).toBe("pending");
  }, 30_000);

  it("passes one Memory item without deciding its sibling and replays the same key", async () => {
    const auth = await makeAuth("item-decision-pass");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const staged = await stage(auth, {
      items: [
        candidate({ display_text: "I prefer written summaries" }),
        candidate({ display_text: "I keep a weekly contact list" }),
      ],
      contactDecision: "none",
      sessionId,
      messageId,
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const [first, second] = opened.review.items;
    const body = {
      idempotency_key: randomUUID(),
      expected_proposal_revision: opened.review.proposal_revision,
      expected_review_revision: opened.review.review_revision,
      item_id: first!.id,
      expected_item_added_revision: first!.added_revision,
      contact_decision: "none" as const,
      decision: "skip" as const,
      reason: "Not useful now",
    };
    const decided = await decideMemoryReviewItem(pool!, auth, opened.review.review_scope_id, opened.review_credential!, body);
    expect(decided).toMatchObject({ kind: "skipped", item_id: first!.id, receipt: null, remaining_pending_item_count: 1 });
    const replay = await decideMemoryReviewItem(pool!, auth, opened.review.review_scope_id, opened.review_credential!, body);
    expect(replay.replayed).toBe(true);
    const readback = await readMemoryScopedOperationView(pool!, auth, body.idempotency_key, {
      purpose: "chat", session_id: sessionId,
    });
    expect(readback.state).toBe("skipped");
    expect(readback.dismissed_item_id).toBe(first!.id);
    const status = await pool!.query<{ id: string; status: string }>(
      "SELECT id,status FROM memory_proposal_items WHERE account_id=$1 AND proposal_id=$2",
      [auth.accountId, staged!.proposal.proposal_id],
    );
    expect(Object.fromEntries(status.rows.map((row) => [row.id, row.status]))).toMatchObject({
      [first!.id]: "skipped",
      [second!.id]: "pending",
    });
  }, 30_000);

  it("decides one Memory item without skipping an untouched sibling", async () => {
    const auth = await makeAuth("item-decision-siblings");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const staged = await stage(auth, {
      items: [
        candidate({ display_text: "I prefer concise updates" }),
        candidate({ display_text: "I prepare notes before meetings" }),
      ],
      contactDecision: "none",
      sessionId,
      messageId,
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const [first, second] = opened.review.items;
    const decided = await decideMemoryReviewItem(pool!, auth, opened.review.review_scope_id, opened.review_credential!, {
      idempotency_key: randomUUID(),
      expected_proposal_revision: opened.review.proposal_revision,
      expected_review_revision: opened.review.review_revision,
      item_id: first!.id,
      expected_item_added_revision: first!.added_revision,
      contact_decision: "none",
      decision: "accept",
      edited_text: "I prefer concise written updates",
      reason: "Remember only this item",
    });
    expect(decided.kind).toBe("committed");
    expect(decided.applied_display_text).toBe("I prefer concise written updates");
    const readback = await readMemoryScopedOperationView(pool!, auth, decided.receipt!.operation_key, {
      purpose: "chat", session_id: sessionId,
    });
    expect(readback.applied_display_text).toBe("I prefer concise written updates");
    expect(decided.receipt?.decisions.map((decision) => decision.proposal_item_id)).toEqual([first!.id]);
    const status = await pool!.query<{ id: string; status: string }>(
      "SELECT id,status FROM memory_proposal_items WHERE account_id=$1 AND proposal_id=$2 ORDER BY id",
      [auth.accountId, staged!.proposal.proposal_id],
    );
    expect(Object.fromEntries(status.rows.map((row) => [row.id, row.status]))).toMatchObject({
      [first!.id]: "committed",
      [second!.id]: "pending",
    });
   }, 30_000);

  it("requires a guarded rebase before a contact card changes the sourced name", async () => {
    const auth = await makeAuth("contact-card-name-change");
    const staged = await stage(auth, {
      items: [], contactDecision: "new",
      newContact: { display_label: "陈宇", relationship_context: "" },
      authorityText: "陈宇负责设计系统", sessionId: randomUUID(), messageId: randomUUID(),
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    await expect(decideMemoryContactOnly(pool!, auth, opened.review.review_scope_id, opened.review_credential!, {
      idempotency_key: randomUUID(), expected_proposal_revision: opened.review.proposal_revision,
      display_label: "林岚", relationship_context: "", reason: "Correct name",
    })).rejects.toMatchObject({ code: "MEMORY_CONTACT_LABEL_REBASE_REQUIRED" });
    const people = await pool!.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM subjects WHERE account_id=$1 AND display_label='林岚'",
      [auth.accountId],
    );
    expect(people.rows[0]?.count).toBe(0);
  }, 30_000);

  it("adds only the contact and keeps both related Memory items pending", async () => {
    const auth = await makeAuth("contact-card-siblings");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const staged = await stage(auth, {
      items: [
        candidate({ scope: "person", statement_kind: "source_statement", speaker: "陈宇",
          display_text: "陈宇负责设计系统", source_excerpt: "陈宇负责设计系统" }),
        candidate({ scope: "person", statement_kind: "source_statement", speaker: "陈宇",
          display_text: "陈宇参加试点合作", source_excerpt: "陈宇参加试点合作" }),
      ],
      contactDecision: "new",
      newContact: { display_label: "陈宇", relationship_context: "试点合作" },
      sessionId, messageId,
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const body = {
      idempotency_key: randomUUID(),
      expected_proposal_revision: opened.review.proposal_revision,
      display_label: "陈宇",
      relationship_context: "试点合作",
      reason: "Add only the contact",
    };
    const result = await decideMemoryContactOnly(pool!, auth, opened.review.review_scope_id, opened.review_credential!, body);
    expect(result.receipt.created_person_id).toBeTruthy();
    expect(result.receipt.applied_item_count).toBe(0);
    expect(result.remaining_pending_item_count).toBe(2);
    const rows = await pool!.query<{ status: string }>(
      "SELECT status FROM memory_proposal_items WHERE account_id=$1 AND proposal_id=$2",
      [auth.accountId, staged!.proposal.proposal_id],
    );
    expect(rows.rows.map((row) => row.status)).toEqual(["pending", "pending"]);
    const fresh = await open(auth, staged!.proposal.proposal_id, "chat");
    expect(fresh.review.contact_status).toBe("resolved");
    expect(fresh.review.contact_decision).toBe("existing");
    const replay = await decideMemoryContactOnly(pool!, auth, opened.review.review_scope_id, opened.review_credential!, body);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt.created_person_id).toBe(result.receipt.created_person_id);
    const undone = await undoMemoryCommit(pool!, auth, result.receipt.commit_id, {
      idempotency_key: randomUUID(), expected_commit_revision: 1, reason: "Undo contact card",
    });
    expect(undone.receipt.status).toBe("undone");
    expect(undone.receipt.undo_contact_outcome).toBe("retained");
  }, 30_000);

  it("stages a name-only contact with zero Memory items and records its confirmed receipt", async () => {
    const auth = await makeAuth("contact-only");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const staged = await stage(auth, {
      items: [],
      contactDecision: "new",
      newContact: { display_label: "陈宇", relationship_context: "" },
      authorityText: "陈宇负责设计系统",
      sessionId,
      messageId,
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const result = await commit(auth, opened.review, opened.review_credential!, {
      selected: [],
      contactDecision: "new",
      newContact: { display_label: "陈宇", relationship_context: "" },
    });
    expect(result.body.receipt.item_count).toBe(0);
    expect(result.body.receipt.created_person_id).toBeTruthy();
    const readback = await readMemoryOperation(
      pool!,
      auth,
      result.body.receipt.operation_key,
    );
    expect(readback.state).toBe("applied");
    expect(readback.receipt?.created_person_id).toBe(result.body.receipt.created_person_id);
  });

  it.each(["deleted", "expired", "image_changed", "image_deleted"])("rejects a zero-item contact when its source is %s", async (change) => {
    const auth=await makeAuth(`zero-${change}`),sessionId=randomUUID(),messageId=randomUUID();
    const staged=await stage(auth,{items:[],contactDecision:"new",newContact:{display_label:"阿禾",relationship_context:""},authorityText:"阿禾",sessionId,messageId,
      images:[{attachmentId:randomUUID(),contentHash:"a".repeat(64)}]});
    expect(staged?.proposal.item_count).toBe(0);
    if(change==="deleted")await pool!.query("UPDATE agent_sessions SET deleted_at=now(),payload=NULL WHERE account_id=$1 AND id=$2",[auth.accountId,sessionId]);
    if(change==="expired")await pool!.query("UPDATE agent_sessions SET expires_at=now()-interval '1 day' WHERE account_id=$1 AND id=$2",[auth.accountId,sessionId]);
    if(change==="image_changed")await pool!.query("UPDATE conversation_message_images SET content_hash=$4 WHERE account_id=$1 AND session_id=$2 AND message_id=$3",[auth.accountId,sessionId,messageId,"b".repeat(64)]);
    if(change==="image_deleted")await pool!.query("DELETE FROM conversation_message_images WHERE account_id=$1 AND session_id=$2 AND message_id=$3",[auth.accountId,sessionId,messageId]);
    const opened=await open(auth,staged!.proposal.proposal_id,"chat");
    await expect(commit(auth,opened.review,opened.review_credential!,{selected:[],contactDecision:"new",newContact:{display_label:"阿禾",relationship_context:""}})).rejects.toThrow(/source/i);
    const people=await pool!.query("SELECT count(*)::int AS count FROM subjects WHERE account_id=$1 AND display_label='阿禾'",[auth.accountId]);
    expect(people.rows[0].count).toBe(0);
  });

  it("dismisses only the visible business subset", async () => {
    const auth = await makeAuth("dismiss-subset");
    const contact = await makeContact(auth, "Chen");
    const staged = await stage(auth, {
      items: [
        candidate({ display_text: "I prefer conclusions first" }),
        candidate({
          scope: "person",
          display_text: "Chen owns the design system",
          source_excerpt: "Chen owns the design system",
        }),
        candidate({
          scope: "relationship",
          display_text: "Chen wants a text plan first",
          source_excerpt: "Chen wants a text plan first",
        }),
      ],
      contactDecision: "existing",
      personId: contact.personId,
      contextId: contact.contextId,
      authorityText: "Chen owns the design system; Chen wants a text plan first",
    });
    const people = await open(
      auth,
      staged!.proposal.proposal_id,
      "people",
      contact.personId,
    );
    const personItem = people.review.items.find((item) => item.scope === "person")!;
    const dismissed = await dismissMemoryReview(
      pool!,
      auth,
      people.review.review_scope_id,
      people.review_credential!,
      {
        idempotency_key: randomUUID(),
        expected_review_revision: people.review.review_revision,
        item_ids: [personItem.id],
        reason: "skip only business item",
      },
    );
    expect(dismissed.dismissed_item_ids).toEqual([personItem.id]);
    expect(dismissed.proposal_status).not.toBe("dismissed");
    const chat = await open(auth, staged!.proposal.proposal_id, "chat");
    expect(chat.review.items.some((item) => item.scope === "self")).toBe(true);
    expect(chat.review.items.some((item) => item.id === personItem.id)).toBe(false);
  });

  it("keeps two same-revision credentials valid and reports a stale second commit", async () => {
    const auth = await makeAuth("credentials");
    const staged = await stage(auth, {
      items: [candidate({ display_text: "I prefer conclusions first" })],
      contactDecision: "none",
    });
    const tabOne = await open(auth, staged!.proposal.proposal_id, "chat");
    const tabTwo = await open(auth, staged!.proposal.proposal_id, "chat");
    expect(tabOne.review.review_scope_id).toBe(tabTwo.review.review_scope_id);
    await expect(
      readMemoryReview(pool!, auth, tabOne.review.review_scope_id, tabOne.review_credential!),
    ).resolves.toBeTruthy();
    await expect(
      readMemoryReview(pool!, auth, tabTwo.review.review_scope_id, tabTwo.review_credential!),
    ).resolves.toBeTruthy();
    const first = await commit(auth, tabOne.review, tabOne.review_credential!, {
      selected: tabOne.review.items.map((item) => item.id),
      contactDecision: "none",
    });
    expect(first.body.receipt.item_count).toBe(1);
    await expect(
      commit(auth, tabTwo.review, tabTwo.review_credential!, {
        selected: tabTwo.review.items.map((item) => item.id),
        contactDecision: "none",
      }),
    ).rejects.toThrow(/frozen|revision|rebase|open/i);
  });

  it("keeps a current fact when a future plan arrives with a hostile update target", async () => {
    const auth = await makeAuth("temporal-separate");
    const firstSession = randomUUID();
    const firstMessage = randomUUID();
    const first = await stage(auth, {
      items: [
        candidate({
          scope: "person",
          statement_kind: "source_statement",
          speaker: "陈宇",
          display_text: "陈宇目前在上海",
          source_excerpt: "陈宇目前在上海",
          time_status: "known",
        }),
      ],
      contactDecision: "new",
      newContact: { display_label: "陈宇", relationship_context: "" },
      authorityText: "陈宇目前在上海",
      sessionId: firstSession,
      messageId: firstMessage,
    });
    const firstOpen = await open(auth, first!.proposal.proposal_id, "chat");
    const firstCommit = await commit(auth, firstOpen.review, firstOpen.review_credential!, {
      selected: firstOpen.review.items.map((item) => item.id),
      contactDecision: "new",
      newContact: { display_label: "陈宇", relationship_context: "" },
    });
    const shanghaiId = firstCommit.body.receipt.created_item_ids[0]!;
    const personId = firstCommit.body.receipt.created_person_id!;

    const second = await stage(auth, {
      items: [
        candidate({
          scope: "person",
          operation: "update",
          statement_kind: "source_statement",
          speaker: "陈宇",
          display_text: "陈宇计划下月搬到北京",
          source_excerpt: "陈宇计划下月搬到北京",
          time_status: "future",
          valid_time: null,
          previous_memory_item_id: shanghaiId,
          previous_revision: 1,
        }),
      ],
      contactDecision: "existing",
      personId,
      identityAuthority: "human_selection",
      authorityText: "陈宇计划下月搬到北京",
    });
    const secondOpen = await open(auth, second!.proposal.proposal_id, "chat");
    const planned = secondOpen.review.items[0]!;
    expect(planned.operation).toBe("add");
    expect(planned.previous_memory_item_id).toBeNull();
    await commit(auth, secondOpen.review, secondOpen.review_credential!, {
      selected: [planned.id],
      contactDecision: "existing",
    });
    const recalled = await recallMemories(pool!, auth, {
      surface: "people",
      person_id: personId,
    });
    const texts = recalled.items.map((item) => item.display_text);
    expect(texts).toContain("陈宇目前在上海");
    expect(texts).toContain("陈宇计划下月搬到北京");
    const shanghai = await pool!.query<{ status: string }>(
      "SELECT status FROM memory_items WHERE account_id=$1 AND id=$2",
      [auth.accountId, shanghaiId],
    );
    expect(shanghai.rows[0]?.status).toBe("active");
  });

  it("keeps a planned-Friday to actually-sent update as a superseding update", async () => {
    const auth = await makeAuth("temporal-completion");
    const first = await stage(auth, {
      items: [
        candidate({
          scope: "relationship",
          statement_kind: "source_statement",
          display_text: "我计划周五发原型",
          source_excerpt: "我计划周五发原型",
          time_status: "future",
        }),
      ],
      contactDecision: "new",
      newContact: { display_label: "陈宇", relationship_context: "设计合作" },
      authorityText: "陈宇说：我计划周五发原型",
    });
    const firstOpen = await open(auth, first!.proposal.proposal_id, "chat");
    const firstCommit = await commit(auth, firstOpen.review, firstOpen.review_credential!, {
      selected: firstOpen.review.items.map((item) => item.id),
      contactDecision: "new",
      newContact: { display_label: "陈宇", relationship_context: "设计合作" },
    });
    const planId = firstCommit.body.receipt.created_item_ids[0]!;
    const personId = firstCommit.body.receipt.created_person_id!;
    const contextId = firstCommit.body.receipt.created_relationship_context_id!;
    const second = await stage(auth, {
      items: [
        candidate({
          scope: "relationship",
          operation: "update",
          statement_kind: "source_statement",
          display_text: "我已发送原型",
          source_excerpt: "我已发送原型",
          time_status: "past",
          previous_memory_item_id: planId,
          previous_revision: 1,
        }),
      ],
      contactDecision: "existing",
      personId,
      contextId,
      identityAuthority: "human_selection",
      authorityText: "我已发送原型",
    });
    const secondOpen = await open(auth, second!.proposal.proposal_id, "chat");
    const item = secondOpen.review.items[0]!;
    expect(item.operation).toBe("update");
    expect(item.previous_memory_item_id).toBe(planId);
    await commit(auth, secondOpen.review, secondOpen.review_credential!, {
      selected: [item.id],
      contactDecision: "existing",
    });
    const plan = await pool!.query<{ status: string }>(
      "SELECT status FROM memory_items WHERE account_id=$1 AND id=$2",
      [auth.accountId, planId],
    );
    expect(plan.rows[0]?.status).toBe("superseded");
  });

  it("never saves a contact-dependent sentence as independent self when the contact is skipped", async () => {
    const auth = await makeAuth("self-escape-pending");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const staged = await stage(auth, {
      items: [
        candidate({
          scope: "self",
          dependence_kind: "contact",
          statement_kind: "user_opinion",
          display_text: "我想和陈宇合作",
          source_excerpt: "我想和陈宇合作",
        }),
        candidate({
          scope: "self",
          statement_kind: "user_opinion",
          display_text: "我做决定前喜欢看具体案例",
          source_excerpt: "我做决定前喜欢看具体案例",
        }),
      ],
      contactDecision: "new",
      newContact: { display_label: "陈宇", relationship_context: "" },
      authorityText: "我想和陈宇合作；我做决定前喜欢看具体案例",
      sessionId,
      messageId,
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const cooperation = opened.review.items.find(
      (item) => item.display_text === "我想和陈宇合作",
    )!;
    const generic = opened.review.items.find(
      (item) => item.display_text === "我做决定前喜欢看具体案例",
    )!;
    expect(cooperation.scope).toBe("person");
    await expect(
      commit(auth, opened.review, opened.review_credential!, {
        selected: [cooperation.id],
        contactDecision: "none",
      }),
    ).rejects.toThrow(/contact/i);
    const saved = await commit(auth, opened.review, opened.review_credential!, {
      selected: [generic.id],
      contactDecision: "none",
    });
    expect(saved.body.receipt.item_count).toBe(1);
  });

  it("flags an undeclared contact-dependent self sentence for judgment and refuses edits that add one", async () => {
    const auth = await makeAuth("self-escape-undeclared");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const staged = await stage(auth, {
      items: [
        candidate({
          scope: "self",
          statement_kind: "user_opinion",
          display_text: "我希望和陈宇合作",
          source_excerpt: "我希望和陈宇合作",
        }),
      ],
      contactDecision: "new",
      newContact: { display_label: "陈宇", relationship_context: "" },
      authorityText: "我希望和陈宇合作",
      sessionId,
      messageId,
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const escaped = opened.review.items.find(
      (item) => item.display_text === "我希望和陈宇合作",
    )!;
    expect(escaped.judgment_kind).toBe("self_scope_escape");
    await expect(
      commit(auth, opened.review, opened.review_credential!, {
        selected: [escaped.id],
        contactDecision: "none",
      }),
    ).rejects.toThrow(/self/i);

    const editSession = randomUUID();
    const editMessage = randomUUID();
    const editStaged = await stage(auth, {
      items: [
        candidate({
          scope: "self",
          statement_kind: "user_opinion",
          display_text: "我做决定前喜欢看具体案例",
          source_excerpt: "我做决定前喜欢看具体案例",
        }),
      ],
      contactDecision: "new",
      newContact: { display_label: "陈宇", relationship_context: "" },
      authorityText: "我做决定前喜欢看具体案例；我希望和陈宇合作",
      sessionId: editSession,
      messageId: editMessage,
    });
    const editOpened = await open(auth, editStaged!.proposal.proposal_id, "chat");
    const editItem = editOpened.review.items[0]!;
    await expect(
      commit(auth, editOpened.review, editOpened.review_credential!, {
        selected: [editItem.id],
        contactDecision: "none",
        edited: { [editItem.id]: "我希望和陈宇合作" },
      }),
    ).rejects.toThrow(/self|contact/i);
  });


  async function makeBoundCapture(
    auth: AuthContext,
    personId: string,
    contextId: string,
    authorizationExpiresAt: Date | null = null,
  ): Promise<{ captureId: string; resourceId: string; fragmentId: string }> {
    const captureId = randomUUID();
    const resourceId = randomUUID();
    const fragmentId = randomUUID();
    await pool!.query(
      `INSERT INTO captures(id,account_id,created_by_user_id,subject_id,assignment_id,source_kind,source_metadata,identity_status,identity_context,purpose)
       VALUES($1,$2,$3,$4,$5,'conversation_transcript','{}'::jsonb,'bound','{}'::jsonb,'memory revocation test')`,
      [captureId, auth.accountId, auth.userId, personId, contextId],
    );
    await pool!.query(
      `INSERT INTO source_resources(
         id,account_id,capture_id,created_by_user_id,client_resource_id,resource_kind,
         input_channel,display_name,media_type,observed_at,retention_scope
       ) VALUES($1,$2,$3,$4,$5,'conversation_transcript','chat','Transcript','text/plain',now(),'reviewed_selected_text')`,
      [resourceId, auth.accountId, captureId, auth.userId, `client-${resourceId}`],
    );
    await pool!.query(
      `INSERT INTO source_retention_receipts(
         receipt_id,account_id,capture_id,policy_version,requested_mode,effective_mode,
         source_scope,source_access_state,source_access_reason,authorization_expires_at,created_at
       ) VALUES($1,$2,$3,'source-retention.v2','evidence_crop','evidence_crop',
                'reviewed_selected_text','available','awaiting_review_completion',$4,now())`,
      [randomUUID(), auth.accountId, captureId, authorizationExpiresAt],
    );
    await pool!.query(
      `INSERT INTO evidence_fragments(
         id,account_id,capture_id,resource_id,fragment_kind,sequence,text_content,
         content_hash,locator,attributed_actor,attribution_status,parser_name,parser_version
       ) VALUES($1,$2,$3,$4,'message',0,$5,$6,'{}'::jsonb,'recruiter','confirmed','test','1')`,
      [fragmentId, auth.accountId, captureId, resourceId, "陈宇负责设计系统", `hash-${fragmentId}`],
    );
    return { captureId, resourceId, fragmentId };
  }

  function captureAuthority(
    capture: { captureId: string; resourceId: string; fragmentId: string },
    personId: string,
    contextId: string,
    captureVersion: number,
    text = "陈宇负责设计系统",
  ): MemorySourceAuthority {
    return {
      text,
      artifacts: [
        {
          artifactId: `${capture.captureId}:message:0`,
          kind: "text",
          sessionId: null,
          messageId: null,
          captureId: capture.captureId,
          sourceResourceId: capture.resourceId,
          evidenceFragmentId: capture.fragmentId,
          contentHash: null,
          captureVersion,
        },
      ],
      sessionId: null,
      messageId: null,
      sourceTaskId: null,
      captureIds: [capture.captureId],
      messageTextHash: null,
      imageManifest: [],
      captureVersion,
      captureSubjectId: personId,
      captureContextId: contextId,
    };
  }

  async function stageCapture(
    auth: AuthContext,
    capture: { captureId: string; resourceId: string; fragmentId: string },
    personId: string,
    contextId: string,
    captureVersion: number,
    text = "陈宇负责设计系统",
  ) {
    return inTransaction(pool!, (client) =>
      stageMemoryProposal(
        client,
        auth,
        {
          idempotency_key: randomUUID(),
          surface: "chat",
          session_id: null,
          source_task_id: randomUUID(),
          source_message_id: null,
          person_id: personId,
          relationship_context_id: contextId,
          contact_decision: "existing",
          identity_authority: "human_selection",
          identity_clue: null,
          new_contact: null,
          proposer: { kind: "human", name: "integration-test", version: "1" },
          items: [
            candidate({
              scope: "person",
              statement_kind: "source_statement",
              speaker: "陈宇",
              display_text: text,
              source_excerpt: text,
              source_locator: {
                kind: "document",
                source_resource_id: capture.resourceId,
                locator: {},
              },
            }),
          ],
        },
        captureAuthority(capture, personId, contextId, captureVersion, text),
      ),
    );
  }

  it("permanently invalidates accepted Memory on explicit revoke and keeps it gone after restore", async () => {
    const auth = await makeAuth("revoke-restore");
    const contact = await makeContact(auth, "Chen");
    const capture = await makeBoundCapture(auth, contact.personId, contact.contextId);
    const staged = await stageCapture(auth, capture, contact.personId, contact.contextId, 1);
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const committed = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "existing",
    });
    const memoryId = committed.body.receipt.created_item_ids[0]!;
    const before = await recallMemories(pool!, auth, {
      surface: "people",
      person_id: contact.personId,
    });
    expect(before.items.map((item) => item.id)).toContain(memoryId);

    await decideCaptureSourceAuthorization(pool!, auth, capture.captureId, {
      idempotency_key: randomUUID(),
      expected_capture_version: 1,
      decision: "revoke",
      reason: "integration revoke",
    });
    const afterRevoke = await recallMemories(pool!, auth, {
      surface: "people",
      person_id: contact.personId,
    });
    expect(afterRevoke.items.map((item) => item.id)).not.toContain(memoryId);

    await decideCaptureSourceAuthorization(pool!, auth, capture.captureId, {
      idempotency_key: randomUUID(),
      expected_capture_version: 2,
      decision: "restore",
      reason: "integration restore",
    });
    const afterRestore = await recallMemories(pool!, auth, {
      surface: "people",
      person_id: contact.personId,
    });
    expect(afterRestore.items.map((item) => item.id)).not.toContain(memoryId);

    // A new epoch can stage and accept fresh evidence.
    const restaged = await stageCapture(auth, capture, contact.personId, contact.contextId, 3);
    const reopened = await open(auth, restaged!.proposal.proposal_id, "chat");
    const recommitted = await commit(auth, reopened.review, reopened.review_credential!, {
      selected: reopened.review.items.map((item) => item.id),
      contactDecision: "existing",
    });
    const freshId = recommitted.body.receipt.created_item_ids[0]!;
    expect(freshId).not.toBe(memoryId);
    const afterNewEpoch = await recallMemories(pool!, auth, {
      surface: "people",
      person_id: contact.personId,
    });
    expect(afterNewEpoch.items.map((item) => item.id)).toContain(freshId);
  });

  it("fails pending capture review closed when the authorization deadline passes", async () => {
    const auth = await makeAuth("capture-deadline");
    const contact = await makeContact(auth, "Chen");
    const capture = await makeBoundCapture(
      auth,
      contact.personId,
      contact.contextId,
      new Date(Date.now() + 3_600_000),
    );
    const staged = await stageCapture(auth, capture, contact.personId, contact.contextId, 1);
    await pool!.query(
      "UPDATE source_retention_receipts SET authorization_expires_at = now() - interval '1 hour' WHERE account_id=$1 AND capture_id=$2",
      [auth.accountId, capture.captureId],
    );
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    expect(opened.review.visible_item_count).toBe(0);
    await expect(
      commit(auth, opened.review, opened.review_credential!, {
        selected: opened.review.items.map((item) => item.id),
        contactDecision: "existing",
      }),
    ).rejects.toThrow(/source|empty/i);
  });


  it("binds a commit operation to its review scope and reconciles same-scope retries", async () => {
    const auth = await makeAuth("idempotency-scope");
    const contact = await makeContact(auth, "Chen");
    const staged = await stage(auth, {
      items: [
        candidate({ display_text: "I prefer conclusions first" }),
        candidate({
          scope: "person",
          display_text: "Chen owns the design system",
          source_excerpt: "Chen owns the design system",
        }),
        candidate({
          scope: "relationship",
          display_text: "Chen wants a text plan first",
          source_excerpt: "Chen wants a text plan first",
        }),
      ],
      contactDecision: "existing",
      personId: contact.personId,
      contextId: contact.contextId,
      authorityText: "I prefer conclusions first; Chen owns the design system; Chen wants a text plan first",
    });
    const chat = await open(auth, staged!.proposal.proposal_id, "chat");
    const relationship = await open(
      auth,
      staged!.proposal.proposal_id,
      "relationship",
      contact.personId,
      contact.contextId,
    );
    const selected = chat.review.items
      .filter((item) => item.scope !== "relationship")
      .map((item) => item.id);
    const key = randomUUID();
    const first = await commit(auth, chat.review, chat.review_credential!, {
      selected,
      contactDecision: "existing",
      idempotencyKey: key,
    });
    const retry = await commit(auth, chat.review, chat.review_credential!, {
      selected,
      contactDecision: "existing",
      idempotencyKey: key,
    });
    expect(retry.replayed).toBe(true);
    expect(retry.body.receipt.commit_id).toBe(first.body.receipt.commit_id);

    await expect(
      commit(auth, relationship.review, relationship.review_credential!, {
        selected,
        contactDecision: "existing",
        idempotencyKey: key,
      }),
    ).rejects.toThrow(/IDEMPOTENCY|SCOPE|REUSED|OPEN/i);
  });

  it("preserves a surviving conflict when an earlier conflict batch is undone", async () => {
    const auth = await makeAuth("conflict-undo");
    const contact = await makeContact(auth, "Chen");
    const base = await stage(auth, {
      items: [
        candidate({
          scope: "person",
          display_text: "Chen is located in Shanghai",
          source_excerpt: "Chen is located in Shanghai",
        }),
      ],
      contactDecision: "existing",
      personId: contact.personId,
      contextId: contact.contextId,
      authorityText: "Chen is located in Shanghai",
    });
    const baseOpen = await open(auth, base!.proposal.proposal_id, "chat");
    const baseCommit = await commit(auth, baseOpen.review, baseOpen.review_credential!, {
      selected: baseOpen.review.items.map((item) => item.id),
      contactDecision: "existing",
    });
    const shanghaiId = baseCommit.body.receipt.created_item_ids[0]!;

    const contest = async (
      previousId: string,
      previousRevision: number,
      text: string,
    ) => {
      const stagedContest = await stage(auth, {
        items: [
          candidate({
            scope: "person",
            operation: "contest",
            display_text: text,
            source_excerpt: text,
            previous_memory_item_id: previousId,
            previous_revision: previousRevision,
          }),
        ],
        contactDecision: "existing",
        personId: contact.personId,
        contextId: contact.contextId,
        authorityText: text,
      });
      const openedContest = await open(
        auth,
        stagedContest!.proposal.proposal_id,
        "chat",
      );
      const item = openedContest.review.items[0]!;
      return commit(auth, openedContest.review, openedContest.review_credential!, {
        selected: [item.id],
        contactDecision: "existing",
        decisions: { [item.id]: "retain_conflict" },
      });
    };

    const firstContest = await contest(shanghaiId, 1, "Chen is located in Beijing");
    const firstContestItem = firstContest.body.receipt.created_item_ids[0]!;
    const firstContestVersion = (
      await pool!.query<{ version: number }>(
        "SELECT version FROM memory_items WHERE account_id=$1 AND id=$2",
        [auth.accountId, firstContestItem],
      )
    ).rows[0]!.version;
    const secondContest = await contest(
      firstContestItem,
      firstContestVersion,
      "Chen is located in Shenzhen",
    );
    const secondContestItem = secondContest.body.receipt.created_item_ids[0]!;

    const groupBefore = await pool!.query<{ conflict_group_id: string | null }>(
      "SELECT conflict_group_id FROM memory_items WHERE account_id=$1 AND id=$2",
      [auth.accountId, shanghaiId],
    );
    expect(groupBefore.rows[0]?.conflict_group_id).toBeTruthy();

    await undoMemoryCommit(pool!, auth, firstContest.body.receipt.commit_id, {
      idempotency_key: randomUUID(),
      expected_commit_revision: 1,
      reason: "undo earlier conflict batch",
    });

    const shanghai = await pool!.query<{ status: string; conflict_group_id: string | null }>(
      "SELECT status, conflict_group_id FROM memory_items WHERE account_id=$1 AND id=$2",
      [auth.accountId, shanghaiId],
    );
    expect(shanghai.rows[0]?.status).toBe("active");
    expect(shanghai.rows[0]?.conflict_group_id).toBeTruthy();
    const shenzhen = await pool!.query<{ status: string; conflict_group_id: string | null }>(
      "SELECT status, conflict_group_id FROM memory_items WHERE account_id=$1 AND id=$2",
      [auth.accountId, secondContestItem],
    );
    expect(shenzhen.rows[0]?.status).toBe("active");
    expect(shenzhen.rows[0]?.conflict_group_id).toBe(
      shanghai.rows[0]?.conflict_group_id,
    );
  });


  it("runs the real host for an empty-objective image-only message and commits 17", async () => {
    const auth = await makeAuth("image-host");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const image0 = {
      attachmentId: randomUUID(),
      contentHash: createHash("sha256").update(Buffer.from([1, 2, 3, 4])).digest("hex"),
    };
    const image1 = {
      attachmentId: randomUUID(),
      contentHash: createHash("sha256").update(Buffer.from([2, 2, 3, 4])).digest("hex"),
    };
    await insertSourceSession(auth, sessionId, messageId, "", [image0, image1]);
    const artifact0 = `conversation-image-${messageId}-0-${image0.attachmentId}`;
    const artifact1 = `conversation-image-${messageId}-1-${image1.attachmentId}`;
    const imageCandidate = (
      artifactId: string,
      imageIndex: number,
      overrides: Partial<MemoryProposalCandidate>,
    ) =>
      candidate({
        source_locator: {
          kind: "image_region",
          artifact_id: artifactId,
          session_id: null,
          image_index: imageIndex,
          region: null,
        },
        source_excerpt: overrides.source_excerpt ?? "截图中的一句话",
        ...overrides,
      });
    const items: MemoryProposalCandidate[] = [
      imageCandidate(artifact0, 0, { display_text: "我要求回复先给结论" }),
      imageCandidate(artifact0, 0, { display_text: "我做决定前喜欢看具体案例" }),
      imageCandidate(artifact0, 0, { display_text: "这季度我在找设计合作者" }),
      ...Array.from({ length: 8 }, (_v, i) =>
        imageCandidate(artifact0, 0, {
          scope: "person",
          statement_kind: "source_statement",
          speaker: "陈宇",
          display_text: `陈宇说截图事实 ${i}`,
        }),
      ),
      ...Array.from({ length: 6 }, (_v, i) =>
        imageCandidate(artifact1, 1, {
          scope: "relationship",
          statement_kind: "source_statement",
          speaker: "陈宇",
          display_text: `我们约定截图事项 ${i}`,
        }),
      ),
    ];
    const provider = {
      providerId: "zhipu-chat-completions" as const,
      id: "image-host-scripted",
      model: "image-host-scripted-v1",
      sdkVersion: "image-host.v1",
      supportsImageInput: true,
      inputCapabilities: { text: true, image: true, imageUnderstanding: true },
      answer: vi.fn(),
      run: vi.fn(async (_request: unknown, invokeTool: (name: string, input: unknown, signal?: AbortSignal) => Promise<unknown>) => {
        const toolResult = await invokeTool(
          "memory_review",
          {
            operation: "propose",
            contact_decision: "new",
            person_display_label: "陈宇",
            new_contact_source_locator: {
              kind: "image_region",
              artifact_id: artifact0,
              session_id: null,
              image_index: 0,
              region: null,
            },
            items,
          },
        );
        expect(toolResult).toMatchObject({ ok: true });
        return {
          structuredOutput: { outcome: "reply", title: "已记录", body: "这里是回答。" },
          inputTokens: 1,
          outputTokens: 1,
          estimatedUsd: 0,
          turns: 1,
          permissionDenials: [],
        };
      }),
    };
    const execution = await executeUnscopedChatTask({
      request: {
        idempotency_key: randomUUID(),
        objective: "",
        session_id: sessionId,
        message_id: messageId,
      },
      provider: provider as never,
      database: pool!,
      auth,
      images: [
        {
          messageId,
          imageIndex: 0,
          attachmentId: image0.attachmentId,
          fileName: "image-0.png",
          mediaType: "image/png",
          byteSize: 4,
          contentHash: image0.contentHash,
          data: Buffer.from([1, 2, 3, 4]),
        },
        {
          messageId,
          imageIndex: 1,
          attachmentId: image1.attachmentId,
          fileName: "image-1.png",
          mediaType: "image/png",
          byteSize: 4,
          contentHash: image1.contentHash,
          data: Buffer.from([1, 2, 3, 4]),
        },
      ],
    });
    expect(execution.body.memory_proposal).toBeTruthy();
    const proposalId = execution.body.memory_proposal!.proposal_id;
    const opened = await open(auth, proposalId, "chat");
    expect(opened.review.visible_item_count).toBe(17);
    // The host must supply a non-empty organizing label for a new contact so
    // the browser's own commit (which uses the review label) can save all 17,
    // including the six relationship items.
    expect(opened.review.relationship_display_label).toBeTruthy();
    const committed = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "new",
      newContact: {
        display_label: "陈宇",
        relationship_context: opened.review.relationship_display_label ?? "",
      },
    });
    expect(committed.body.receipt.item_count).toBe(17);
    expect(committed.body.receipt.created_person_id).toBeTruthy();
    expect(committed.body.receipt.created_relationship_context_id).toBeTruthy();
  });


  it("allows an authorized search and stage followed by a helpful answer with a memory reference", async () => {
    const auth = await makeAuth("answer-after-search");
    const contact = await makeContact(auth, "Chen");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const sourceText = "陈宇负责设计系统";
    await insertSourceSession(auth, sessionId, messageId, sourceText);
    const provider = {
      providerId: "zhipu-chat-completions" as const,
      id: "answer-after-search-scripted",
      model: "answer-after-search-v1",
      sdkVersion: "answer-after-search.v1",
      supportsImageInput: false,
      inputCapabilities: { text: true, image: false, imageUnderstanding: false },
      answer: vi.fn(),
      run: vi.fn(async (_request: unknown, invokeTool: (name: string, input: unknown, signal?: AbortSignal) => Promise<{ ok: boolean; data?: unknown }>) => {
        const search = await invokeTool("contact_workspace", {
          operation: "search",
          query: "Chen",
          maximum_results: 4,
        });
        expect(search.ok).toBe(true);
        const searchData = search.data as { results: Array<{ person_id: string; relationship_contexts: Array<{ id: string }> }> };
        const personId = searchData.results[0]!.person_id;
        const contextId = searchData.results[0]!.relationship_contexts[0]!.id;
        expect((await invokeTool("contact_workspace", { operation: "read", person_id: personId, relationship_context_id: contextId })).ok).toBe(true);
        expect((await invokeTool("memory_review", { operation: "recall", person_id: personId, relationship_context_id: contextId })).ok).toBe(true);
        const staged = await invokeTool("memory_review", {
          operation: "propose",
          contact_decision: "existing",
          person_id: personId,
          relationship_context_id: contextId,
          items: [
            {
              scope: "relationship",
              operation: "add",
              statement_kind: "source_statement",
              speaker: "陈宇",
              display_text: "陈宇负责设计系统",
              time_status: "known",
              sensitivity: "normal",
              source_excerpt: "陈宇负责设计系统",
              source_locator: { kind: "message", session_id: sessionId, message_id: messageId },
              reason: "useful next time",
            },
          ],
        });
        expect(staged.ok).toBe(true);
        return {
          structuredOutput: { outcome: "reply", title: "已记录", body: "这里是回答。" },
          inputTokens: 1,
          outputTokens: 1,
          estimatedUsd: 0,
          turns: 1,
          permissionDenials: [],
        };
      }),
    };
    const execution = await executeWorkspaceConversationAgent({
      database: pool!,
      auth,
      objective: "What changed with Chen? 陈宇负责设计系统",
      sourceText,
      sessionID: sessionId,
      messageID: messageId,
      // The authenticated relationship entry supplies the human identity
      // binding; a model read alone no longer grants personalized authority.
      humanIdentityBinding: { personID: contact.personId, contextID: contact.contextId },
      provider: provider as never,
    });
    expect(execution.block).toMatchObject({ kind: "answer", body: "这里是回答。" });
    expect(execution.event).toMatchObject({ kind: "resolved_contact_context" });
    expect(execution.memoryProposal).toBeTruthy();
    const opened = await open(auth, execution.memoryProposal!.proposal_id, "chat");
    expect(opened.review.visible_item_count).toBe(1);
    const committed = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "existing",
    });
    expect(committed.body.receipt.item_count).toBe(1);
    expect(contact.personId).toBeTruthy();
  });


  it("regenerates fresh evidence for an existing contact switch and preserves failures", async () => {
    const auth = await makeAuth("regenerate-existing");
    const contactA = await makeContact(auth, "Chen");
    const contactB = await makeContact(auth, "Dana");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const sourceText = "陈宇负责设计系统；他也提到新的合作";
    const staged = await stage(auth, {
      items: [
        candidate({ display_text: "我要求回复先给结论" }),
        candidate({
          scope: "person",
          statement_kind: "source_statement",
          speaker: "陈宇",
          display_text: "陈宇负责设计系统",
          source_excerpt: "陈宇负责设计系统",
        }),
      ],
      contactDecision: "existing",
      personId: contactA.personId,
      contextId: contactA.contextId,
      identityAuthority: "human_selection",
      authorityText: `${sourceText};我要求回复先给结论`,
      sessionId,
      messageId,
    });
    const firstOpen = await open(
      auth,
      staged!.proposal.proposal_id,
      "people",
      contactA.personId,
    );
    const firstCommit = await commit(auth, firstOpen.review, firstOpen.review_credential!, {
      selected: firstOpen.review.items.map((item) => item.id),
      contactDecision: "existing",
    });
    expect(firstCommit.body.receipt.created_item_ids).toHaveLength(1);
    const afterFirst = await pool!.query<{ status: string; revision: number }>(
      "SELECT status, revision FROM memory_proposals WHERE account_id=$1 AND id=$2",
      [auth.accountId, staged!.proposal.proposal_id],
    );
    expect(afterFirst.rows[0]?.status).toBe("partially_committed");
    const currentRevision = afterFirst.rows[0]!.revision;

    // A failed regenerator writes nothing and surfaces the failure.
    await expect(
      regenerateMemoryProposal(
        pool!,
        auth,
        staged!.proposal.proposal_id,
        {
          expected_proposal_revision: currentRevision,
          contact_decision: "existing",
          identity_authority: "human_selection",
          person_id: contactB.personId,
          relationship_context_id: contactB.contextId,
          reason: "switch to B",
        },
        async () => {
          throw new Error("MODEL_UNAVAILABLE");
        },
      ),
    ).rejects.toThrow(/MODEL_UNAVAILABLE/i);
    const unchanged = await pool!.query<{ revision: number }>(
      "SELECT revision FROM memory_proposals WHERE account_id=$1 AND id=$2",
      [auth.accountId, staged!.proposal.proposal_id],
    );
    expect(unchanged.rows[0]?.revision).toBe(currentRevision);

    const regenerator = vi.fn(async () => [
      candidate({
        scope: "person",
        statement_kind: "source_statement",
        speaker: "Dana",
        display_text: "Dana 负责设计系统",
        source_excerpt: "他也提到新的合作",
      }),
    ]);
    const result = await regenerateMemoryProposal(
      pool!,
      auth,
      staged!.proposal.proposal_id,
      {
        expected_proposal_revision: currentRevision,
        contact_decision: "existing",
        identity_authority: "human_selection",
        person_id: contactB.personId,
        relationship_context_id: contactB.contextId,
        reason: "switch to B",
      },
      regenerator,
    );
    expect(regenerator).toHaveBeenCalledOnce();
    expect(result.proposal.person_id).toBe(contactB.personId);
    const fresh = await open(auth, staged!.proposal.proposal_id, "chat");
    const freshItem = fresh.review.items.find(
      (item) => item.display_text === "Dana 负责设计系统",
    )!;
    expect(freshItem).toBeTruthy();
    const committed = await commit(auth, fresh.review, fresh.review_credential!, {
      selected: [freshItem.id],
      contactDecision: "existing",
      identityAuthority: "human_selection",
    });
    const stored = await pool!.query<{ subject_id: string }>(
      "SELECT subject_id FROM memory_items WHERE account_id=$1 AND id=$2",
      [auth.accountId, committed.body.receipt.created_item_ids[0]!],
    );
    expect(stored.rows[0]?.subject_id).toBe(contactB.personId);
  });


  it("commits a relationship message staged with the host session-bound text artifact", async () => {
    const auth = await makeAuth("relationship-host-shape");
    const contact = await makeContact(auth, "陈宇");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const objective = "这次先发文字方案";
    await insertSourceSession(auth, sessionId, messageId, objective);
    const authority: MemorySourceAuthority = {
      text: objective,
      artifacts: [
        {
          artifactId: `${sessionId}:message:${messageId}`,
          kind: "text",
          sessionId,
          messageId,
          captureId: null,
          sourceResourceId: null,
          evidenceFragmentId: null,
          contentHash: null,
          captureVersion: null,
        },
      ],
      sessionId,
      messageId,
      sourceTaskId: null,
      captureIds: [],
      messageTextHash: createHash("sha256").update(objective).digest("hex"),
      imageManifest: [],
      captureVersion: null,
      captureSubjectId: null,
      captureContextId: null,
    };
    const staged = await inTransaction(pool!, (client) =>
      stageMemoryProposal(
        client,
        auth,
        {
          idempotency_key: randomUUID(),
          surface: "relationship",
          session_id: sessionId,
          source_task_id: randomUUID(),
          source_message_id: messageId,
          person_id: contact.personId,
          relationship_context_id: contact.contextId,
          contact_decision: "existing",
          identity_authority: "human_selection",
          identity_clue: null,
          new_contact: null,
          proposer: { kind: "human", name: "integration-test", version: "1" },
          items: [
            candidate({
              scope: "relationship",
              statement_kind: "source_statement",
              speaker: "陈宇",
              display_text: "这次先发文字方案",
              source_excerpt: "这次先发文字方案",
              source_locator: {
                kind: "message",
                session_id: sessionId,
                message_id: messageId,
              },
            }),
          ],
        },
        authority,
      ),
    );
    const opened = await open(
      auth,
      staged!.proposal.proposal_id,
      "relationship",
      contact.personId,
      contact.contextId,
    );
    const committed = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "existing",
    });
    expect(committed.body.receipt.item_count).toBe(1);
  });


  it("keeps accepted minimal evidence on natural authorization expiry and blocks pending acceptance through the real sweeper", async () => {
    const auth = await makeAuth("natural-expiry-service");
    const contact = await makeContact(auth, "Chen");
    const capture = await makeBoundCapture(
      auth,
      contact.personId,
      contact.contextId,
      new Date(Date.now() + 3_600_000),
    );
    const accepted = await stageCapture(
      auth,
      capture,
      contact.personId,
      contact.contextId,
      1,
    );
    const acceptedOpen = await open(auth, accepted!.proposal.proposal_id, "chat");
    const committed = await commit(auth, acceptedOpen.review, acceptedOpen.review_credential!, {
      selected: acceptedOpen.review.items.map((item) => item.id),
      contactDecision: "existing",
    });
    const memoryId = committed.body.receipt.created_item_ids[0]!;
    const pending = await stageCapture(
      auth,
      capture,
      contact.personId,
      contact.contextId,
      1,
      "陈宇正在负责新的设计流程",
    );
    const versionBefore = (
      await pool!.query<{ version: number }>(
        "SELECT version FROM captures WHERE account_id=$1 AND id=$2",
        [auth.accountId, capture.captureId],
      )
    ).rows[0]!.version;
    const swept = await sweepDueSourceAuthorizations(
      pool!,
      new Date(Date.now() + 7_200_000),
    );
    expect(swept.length).toBeGreaterThan(0);

    // Natural expiry increments the capture epoch but must not revoke accepted
    // minimal evidence.
    const versionAfter = (
      await pool!.query<{ version: number }>(
        "SELECT version FROM captures WHERE account_id=$1 AND id=$2",
        [auth.accountId, capture.captureId],
      )
    ).rows[0]!.version;
    expect(versionAfter).toBe(versionBefore + 1);
    const recalled = await recallMemories(pool!, auth, {
      surface: "people",
      person_id: contact.personId,
    });
    expect(recalled.items.map((item) => item.id)).toContain(memoryId);

    // The pending proposal cannot be accepted after expiry.
    const pendingOpen = await open(auth, pending!.proposal.proposal_id, "chat");
    expect(pendingOpen.review.visible_item_count).toBe(0);
    await expect(
      commit(auth, pendingOpen.review, pendingOpen.review_credential!, {
        selected: pendingOpen.review.items.map((item) => item.id),
        contactDecision: "existing",
      }),
    ).rejects.toThrow(/source|empty/i);
  });


  it("regenerates through the real adapter with ordered admitted image bytes and governed target recall", async () => {
    const auth = await makeAuth("regeneration-adapter");
    const contactB = await makeContact(auth, "Dana");
    const contactC = await makeContact(auth, "Eve");
    // Accepted memory for the new target B.
    const bStaged = await stage(auth, {
      items: [
        candidate({
          scope: "person",
          display_text: "Dana owns the design system",
          source_excerpt: "Dana owns the design system",
        }),
      ],
      contactDecision: "existing",
      personId: contactB.personId,
      contextId: contactB.contextId,
      identityAuthority: "human_selection",
      authorityText: "Dana owns the design system",
    });
    const bOpen = await open(auth, bStaged!.proposal.proposal_id, "chat");
    await commit(auth, bOpen.review, bOpen.review_credential!, {
      selected: bOpen.review.items.map((item) => item.id),
      contactDecision: "existing",
    });
    // Accepted memory for an unrelated contact C must not reach the model.
    const cStaged = await stage(auth, {
      items: [
        candidate({
          scope: "relationship",
          display_text: "Eve wants a text plan first",
          source_excerpt: "Eve wants a text plan first",
        }),
      ],
      contactDecision: "existing",
      personId: contactC.personId,
      contextId: contactC.contextId,
      identityAuthority: "human_selection",
      authorityText: "Eve wants a text plan first",
    });
    const cOpen = await open(auth, cStaged!.proposal.proposal_id, "chat");
    await commit(auth, cOpen.review, cOpen.review_credential!, {
      selected: cOpen.review.items.map((item) => item.id),
      contactDecision: "existing",
    });

    const sessionId = randomUUID();
    const messageId = randomUUID();
    const image0 = { attachmentId: randomUUID(), contentHash: "3".repeat(64) };
    const image1 = { attachmentId: randomUUID(), contentHash: "4".repeat(64) };
    const artifact0 = `conversation-image-${messageId}-0-${image0.attachmentId}`;
    const artifact1 = `conversation-image-${messageId}-1-${image1.attachmentId}`;
    const imageCandidate = (artifactId: string, imageIndex: number, text: string) =>
      candidate({
        scope: "person",
        statement_kind: "source_statement",
        speaker: "Dana",
        display_text: text,
        source_excerpt: "截图中的一句话",
        source_locator: {
          kind: "image_region",
          artifact_id: artifactId,
          session_id: null,
          image_index: imageIndex,
          region: null,
        },
      });
    const draft = await stage(auth, {
      items: [
        imageCandidate(artifact0, 0, "Dana 负责设计系统"),
        imageCandidate(artifact1, 1, "我们约定先发文字方案"),
      ],
      contactDecision: "new",
      newContact: {
        display_label: "Dana",
        relationship_context: "设计合作",
        source_locator: {
          kind: "image_region",
          artifact_id: artifact0,
          session_id: null,
          image_index: 0,
          region: null,
        },
      },
      sessionId,
      messageId,
      images: [image0, image1],
    });

    let captured: {
      inputParts?: ReadonlyArray<{ kind: string; artifactID: string; contentHash: string; byteSize: number }> | undefined;
      objective?: string | undefined;
    } = {};
    const provider = {
      id: "regeneration-deterministic",
      model: "regeneration-deterministic-v1",
      sdkVersion: "regeneration.v1",
      inputCapabilities: { text: true, image: true, imageUnderstanding: true },
      run: async (request: { inputParts?: ReadonlyArray<{ kind: string; artifactID: string; contentHash: string; byteSize: number }>; objective: string }) => {
        captured = { inputParts: request.inputParts, objective: request.objective };
        return {
          structuredOutput: {
            items: [
              {
                scope: "person",
                operation: "add",
                statement_kind: "source_statement",
                display_text: "Dana 负责设计系统（重新核对）",
                speaker: "Dana",
                time_status: "known",
                sensitivity: "normal",
                source_excerpt: "截图中的一句话",
                source_locator: {
                  kind: "image_region",
                  artifact_id: artifact0,
                  session_id: null,
                  image_index: 0,
                  region: null,
                },
                reason: "revalidated for the selected contact",
              },
            ],
          },
          inputTokens: 1,
          outputTokens: 1,
          estimatedUsd: 0,
          turns: 1,
          permissionDenials: [],
        };
      },
    };
    const regenerator = createMemoryProposalRegenerator(provider);
    expect(regenerator).toBeTruthy();
    const result = await regenerateMemoryProposal(
      pool!,
      auth,
      draft!.proposal.proposal_id,
      {
        expected_proposal_revision: draft!.proposal.revision,
        contact_decision: "existing",
        identity_authority: "human_selection",
        person_id: contactB.personId,
        relationship_context_id: contactB.contextId,
        reason: "switch to Dana",
      },
      regenerator!,
      async ({ auth: actingAuth, sessionId: sourceSession, messageId: sourceMessage, imageIndex }) => {
        const image = await readConversationMessageImage(
          pool!,
          actingAuth,
          sourceSession,
          sourceMessage,
          imageIndex,
        );
        return image ? { media_type: image.media_type, content: image.content } : null;
      },
    );
    expect(result.proposal.person_id).toBe(contactB.personId);
    expect(result.proposal.relationship_display_label).toBe("Dana relationship");
    // Ordered admitted image bytes reached the provider.
    expect(captured.inputParts).toHaveLength(2);
    expect(captured.inputParts!.map((part) => part.artifactID)).toEqual([
      artifact0,
      artifact1,
    ]);
    expect(captured.inputParts!.map((part) => part.contentHash)).toEqual([
      createHash("sha256").update(Buffer.from([1, 2, 3, 4])).digest("hex"),
      createHash("sha256").update(Buffer.from([2, 2, 3, 4])).digest("hex"),
    ]);
    const objective = JSON.parse(captured.objective!) as {
      target_person_label: string;
      relationship_label: string;
      existing_accepted_memory: string[];
      admitted_images: Array<{ artifact_id: string }>;
    };
    expect(objective.target_person_label).toBe("Dana");
    expect(objective.relationship_label).toBe("Dana relationship");
    expect(objective.admitted_images.map((image) => image.artifact_id)).toEqual([
      artifact0,
      artifact1,
    ]);
    expect(objective.existing_accepted_memory).toContain("Dana owns the design system");
    expect(objective.existing_accepted_memory).not.toContain("Eve wants a text plan first");
  });


  it("stages and commits relationship memory through the real createChatTask host", async () => {
    const auth = await makeAuth("relationship-chat-host");
    const contact = await makeContact(auth, "陈宇");
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const objective = "这次先发文字方案";
    await insertSourceSession(auth, sessionId, messageId, objective, [], {
      personId: contact.personId,
      relationshipContextId: contact.contextId,
    });
    const snapshotId = randomUUID();
    await pool!.query(
      `INSERT INTO knowledge_snapshots(
         id,account_id,subject_id,assignment_id,source_state_cursor,compiler_name,
         compiler_version,policy_version,status,quality,compiled_at
       ) VALUES($1,$2,$3,$4,0,'integration','1','integration','published',$5::jsonb,now())`,
      [
        snapshotId,
        auth.accountId,
        contact.personId,
        contact.contextId,
        JSON.stringify({ verdict: "gold", gates: {}, measures: {}, reasons: [] }),
      ],
    );
    await pool!.query(
      `INSERT INTO knowledge_blocks(
         id,account_id,snapshot_id,block_key,block_type,status,structured_content,
         sensitivity,semantic_hash
       ) VALUES($1,$2,$3,'identity','identity_context','confirmed',$4::jsonb,'normal','hash-identity')`,
      [
        randomUUID(),
        auth.accountId,
        snapshotId,
        JSON.stringify({ headline: "陈宇", items: [] }),
      ],
    );
    await pool!.query(
      `INSERT INTO knowledge_blocks(
         id,account_id,snapshot_id,block_key,block_type,status,structured_content,
         sensitivity,semantic_hash
       ) VALUES($1,$2,$3,'no-action','no_action','confirmed',$4::jsonb,'normal','hash-no-action')`,
      [
        randomUUID(),
        auth.accountId,
        snapshotId,
        JSON.stringify({
          headline: "No action",
          summary: "No material change.",
          items: [],
        }),
      ],
    );
    const provider = {
      providerId: "zhipu-chat-completions" as const,
      model: "relationship-chat-scripted",
      supportsImageInput: false,
      answer: async (input: {
        memoryReview?: {
          stage: (stageInput: {
            contact_decision: "existing" | "new" | "none";
            person_display_label?: string | null;
            items: unknown[];
          }) => Promise<{ proposal_id: string; proposal_revision: number; item_count: number; default_selected_count: number } | null>;
        };
      }) => {
        const staged = await input.memoryReview!.stage({
          contact_decision: "existing",
          person_display_label: null,
          items: [
            {
              scope: "relationship",
              operation: "add",
              statement_kind: "source_statement",
              speaker: "陈宇",
              display_text: "这次先发文字方案",
              time_status: "known",
              sensitivity: "normal",
              source_excerpt: "这次先发文字方案",
              source_locator: { kind: "message", session_id: sessionId, message_id: messageId },
              reason: "useful next time",
            },
          ],
        });
        return {
          kind: "answer" as const,
          title: "回复",
          body: "这次先按文字方案推进。",
          citation_ids: [],
          provider_id: "zhipu-chat-completions" as const,
          model: "relationship-chat-scripted",
          provider_request_id: null,
          input_tokens: 1,
          output_tokens: 1,
          ...(staged ? { memoryProposal: staged } : {}),
        };
      },
    };
    const result = await createChatTask(
      pool!,
      auth,
      {
        idempotency_key: randomUUID(),
        session_id: sessionId,
        message_id: messageId,
        objective,
        person_id: contact.personId,
        relationship_context_id: contact.contextId,
      },
      provider as never,
    );
    expect(result.body.memory_proposal).toBeTruthy();
    const opened = await open(
      auth,
      result.body.memory_proposal!.proposal_id,
      "relationship",
      contact.personId,
      contact.contextId,
    );
    const committed = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "existing",
    });
    expect(committed.body.receipt.item_count).toBe(1);
  });


  it("rejects regeneration when the source is deleted or an image changes during inference", async () => {
    const auth = await makeAuth("regeneration-race");
    const contactB = await makeContact(auth, "Dana");

    const makeDraft = async () => {
      const sessionId = randomUUID();
      const messageId = randomUUID();
      const image0 = {
        attachmentId: randomUUID(),
        contentHash: createHash("sha256").update(Buffer.from([1, 2, 3, 4])).digest("hex"),
      };
      const image1 = {
        attachmentId: randomUUID(),
        contentHash: createHash("sha256").update(Buffer.from([2, 2, 3, 4])).digest("hex"),
      };
      const artifact0 = `conversation-image-${messageId}-0-${image0.attachmentId}`;
      const artifact1 = `conversation-image-${messageId}-1-${image1.attachmentId}`;
      const item = (artifactId: string, imageIndex: number, text: string) =>
        candidate({
          scope: "person",
          statement_kind: "source_statement",
          speaker: "Dana",
          display_text: text,
          source_excerpt: "截图中的一句话",
          source_locator: {
            kind: "image_region",
            artifact_id: artifactId,
            session_id: null,
            image_index: imageIndex,
            region: null,
          },
        });
      const draft = await stage(auth, {
        items: [item(artifact0, 0, "Dana 负责设计系统"), item(artifact1, 1, "我们约定先发文字方案")],
        contactDecision: "new",
        newContact: {
          display_label: "Dana",
          relationship_context: "设计合作",
          source_locator: {
            kind: "image_region",
            artifact_id: artifact0,
            session_id: null,
            image_index: 0,
            region: null,
          },
        },
        sessionId,
        messageId,
        images: [image0, image1],
      });
      return { sessionId, messageId, artifact0, draft };
    };

    const candidateFor = (artifactId: string) => ({
      scope: "person" as const,
      operation: "add" as const,
      statement_kind: "source_statement" as const,
      display_text: "Dana 负责设计系统（重新核对）",
      speaker: "Dana",
      time_status: "known" as const,
      sensitivity: "normal" as const,
      source_excerpt: "截图中的一句话",
      source_locator: {
        kind: "image_region" as const,
        artifact_id: artifactId,
        session_id: null,
        image_index: 0,
        region: null,
      },
      reason: "revalidated",
    });

    // Case 1: the session is deleted while the model is "waiting".
    const first = await makeDraft();
    const beforeRevision = first.draft!.proposal.revision;
    await expect(
      regenerateMemoryProposal(
        pool!,
        auth,
        first.draft!.proposal.proposal_id,
        {
          expected_proposal_revision: beforeRevision,
          contact_decision: "existing",
          identity_authority: "human_selection",
          person_id: contactB.personId,
          relationship_context_id: contactB.contextId,
          reason: "switch to Dana",
        },
        async () => {
          await mutateAgentSession(
            pool!,
            auth,
            first.sessionId,
            { expected_revision: 1, idempotency_key: randomUUID() },
            true,
          );
          return [candidateFor(first.artifact0)];
        },
        loadRegenerationImage,
      ),
    ).rejects.toThrow(/source|unavailable/i);
    const afterDelete = await pool!.query<{ revision: number; target_person_id: string | null }>(
      "SELECT revision, target_person_id FROM memory_proposals WHERE account_id=$1 AND id=$2",
      [auth.accountId, first.draft!.proposal.proposal_id],
    );
    expect(afterDelete.rows[0]?.revision).toBe(beforeRevision);
    expect(afterDelete.rows[0]?.target_person_id).toBeNull();
    const pendingAfterDelete = await pool!.query<{ status: string }>(
      "SELECT status FROM memory_proposal_items WHERE account_id=$1 AND proposal_id=$2 ORDER BY id",
      [auth.accountId, first.draft!.proposal.proposal_id],
    );
    expect(pendingAfterDelete.rows.map((row) => row.status)).toEqual(["pending", "pending"]);

    // Case 2: one admitted image disappears while the model is "waiting".
    const second = await makeDraft();
    const secondRevision = second.draft!.proposal.revision;
    await expect(
      regenerateMemoryProposal(
        pool!,
        auth,
        second.draft!.proposal.proposal_id,
        {
          expected_proposal_revision: secondRevision,
          contact_decision: "existing",
          identity_authority: "human_selection",
          person_id: contactB.personId,
          relationship_context_id: contactB.contextId,
          reason: "switch to Dana",
        },
        async () => {
          await pool!.query(
            "DELETE FROM conversation_message_images WHERE account_id=$1 AND session_id=$2 AND message_id=$3 AND image_index=1",
            [auth.accountId, second.sessionId, second.messageId],
          );
          return [candidateFor(second.artifact0)];
        },
        loadRegenerationImage,
      ),
    ).rejects.toThrow(/source|unavailable/i);
    const afterImageDelete = await pool!.query<{ revision: number }>(
      "SELECT revision FROM memory_proposals WHERE account_id=$1 AND id=$2",
      [auth.accountId, second.draft!.proposal.proposal_id],
    );
    expect(afterImageDelete.rows[0]?.revision).toBe(secondRevision);
    const itemCount = await pool!.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM memory_proposal_items WHERE account_id=$1 AND proposal_id=$2",
      [auth.accountId, second.draft!.proposal.proposal_id],
    );
    expect(itemCount.rows[0]?.count).toBe(2);
  });

  it("regenerates to a new uncreated target under a business source without a scope error", async () => {
    const auth = await makeAuth("regeneration-new-target");
    const contactA = await makeContact(auth, "Chen");
    const staged = await stage(auth, {
      items: [
        candidate({
          scope: "person",
          display_text: "Chen owns the design system",
          source_excerpt: "Chen owns the design system",
        }),
      ],
      contactDecision: "existing",
      personId: contactA.personId,
      contextId: contactA.contextId,
      identityAuthority: "human_selection",
      surface: "people",
      authorityText: "Chen owns the design system",
    });
    const regenerator = vi.fn(async () => [
      candidate({
        scope: "person",
        display_text: "林恩 owns the design system",
        source_excerpt: "Chen owns the design system",
      }),
    ]);
    const result = await regenerateMemoryProposal(
      pool!,
      auth,
      staged!.proposal.proposal_id,
      {
        expected_proposal_revision: staged!.proposal.revision,
        contact_decision: "new",
        identity_authority: "tentative",
        new_contact: { display_label: "林恩", relationship_context: "" },
        reason: "new contact",
      },
      regenerator,
    );
    expect(regenerator).toHaveBeenCalledOnce();
    expect(result.proposal.person_id).toBeNull();
    expect(result.proposal.person_display_label).toBe("林恩");
  });


  it("regenerates through the authenticated POST rebase route", async () => {
    const auth = await makeAuth("rebase-route");
    const contactA = await makeContact(auth, "Chen");
    const contactB = await makeContact(auth, "Dana");
    const staged = await stage(auth, {
      items: [
        candidate({
          scope: "person",
          display_text: "Chen owns the design system",
          source_excerpt: "Chen owns the design system",
        }),
      ],
      contactDecision: "existing",
      personId: contactA.personId,
      contextId: contactA.contextId,
      identityAuthority: "human_selection",
      authorityText: "Chen owns the design system",
    });
    const app = Fastify();
    registerMemoryReviewRoutes(
      app,
      pool!,
      async (request) => {
        (request as unknown as { auth: AuthContext }).auth = auth;
      },
      async () => [
        candidate({
          scope: "person",
          display_text: "Dana owns the design system",
          source_excerpt: "Chen owns the design system",
        }),
      ],
      null,
    );
    await app.ready();
    try {
      const response = await app.inject({
        method: "POST",
        url: `/v1/memory/proposals/${staged!.proposal.proposal_id}/rebases`,
        payload: {
          idempotency_key: randomUUID(),
          expected_proposal_revision: staged!.proposal.revision,
          contact_decision: "existing",
          identity_authority: "human_selection",
          person_id: contactB.personId,
          relationship_context_id: contactB.contextId,
          reason: "route switch",
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { proposal: { person_id: string | null } };
      expect(body.proposal.person_id).toBe(contactB.personId);
    } finally {
      await app.close();
    }
  });

  it("resolves only confirmed, currently evidenced Pursuit person/context scopes", async () => {
    const auth = await makeAuth("pursuit-scope");
    const person = await makeContact(auth, "Pursuit Chen");
    const pursuitId = randomUUID();
    await pool!.query(
      `INSERT INTO pursuits(id, account_id, pursuit_type, title, target_outcome, target_date, status, milestone, milestone_authority_user_id, milestone_authority_at, created_by_user_id, updated_by_user_id)
       VALUES($1,$2,'recruiting','Design lead','Hire a design lead','2026-12-31','active','screen',$3,now(),$3,$3)`,
      [pursuitId, auth.accountId, auth.userId],
    );
    const roleId = randomUUID();
    await pool!.query(
      `INSERT INTO pursuit_roles(id, account_id, pursuit_id, person_id, role_type, status, confidence, basis_kind, display_order, created_by_user_id)
       VALUES($1,$2,$3,$4,'candidate','active','confirmed','user_authored',0,$5)`,
      [roleId, auth.accountId, pursuitId, person.personId, auth.userId],
    );

    // A user-authored role with no evidentiary context stays person-only; it
    // never grants all of that person's relationships to the Pursuit.
    let resolved = await resolveMemoryPursuitScopes(pool!, auth, pursuitId);
    expect(resolved.scopes).toHaveLength(1);
    expect(resolved.scopes[0]!.person_id).toBe(person.personId);
    expect(resolved.scopes[0]!.relationship_context_id).toBeNull();

    const captureId = randomUUID();
    const resourceId = randomUUID();
    const fragmentId = randomUUID();
    await pool!.query(
      `INSERT INTO captures(id, account_id, created_by_user_id, subject_id, assignment_id, source_kind, source_metadata, identity_status, identity_context, purpose, status)
       VALUES($1,$2,$3,$4,$5,'conversation_screenshot','{}'::jsonb,'bound','{}'::jsonb,'relationship_evidence','active')`,
      [captureId, auth.accountId, auth.userId, person.personId, person.contextId],
    );
    await pool!.query(
      `INSERT INTO source_resources(id, account_id, capture_id, created_by_user_id, client_resource_id, resource_kind, input_channel, display_name, media_type, observed_at, retention_scope, processing_state)
       VALUES($1,$2,$3,$4,$5,'conversation_screenshot','chat','Pursuit source','image/png',now(),'relationship','ready')`,
      [resourceId, auth.accountId, captureId, auth.userId, `pursuit-${fragmentId}`],
    );
    await pool!.query(
      `INSERT INTO evidence_fragments(id, account_id, capture_id, resource_id, fragment_kind, sequence, text_content, content_hash, locator, attributed_actor, attribution_status, parser_name, parser_version, status, review_status)
       VALUES($1,$2,$3,$4,'message',0,'Pursuit evidence',$5,'{}'::jsonb,'unknown','confirmed','test','1','active','reviewed')`,
      [fragmentId, auth.accountId, captureId, resourceId, `hash-${fragmentId}`],
    );
    await pool!.query(
      `INSERT INTO source_retention_receipts(receipt_id, account_id, capture_id, policy_version, requested_mode, effective_mode, source_scope, source_access_state, source_access_reason, retention_until, created_at)
       VALUES($1,$2,$3,'source-retention.v2','full_source','full_source','full_reviewed_source','available','review_completed',now() + interval '30 days',now())`,
      [randomUUID(), auth.accountId, captureId],
    );
    await pool!.query(
      `INSERT INTO pursuit_role_evidence(account_id, role_id, evidence_fragment_id) VALUES($1,$2,$3)`,
      [auth.accountId, roleId, fragmentId],
    );
    await pool!.query(
      `UPDATE pursuit_roles SET basis_kind='evidence_supported' WHERE account_id=$1 AND id=$2`,
      [auth.accountId, roleId],
    );
    resolved = await resolveMemoryPursuitScopes(pool!, auth, pursuitId);
    expect(resolved.scopes[0]!.relationship_context_id).toBe(person.contextId);

    // A removed or suggested role is never eligible.
    await pool!.query(`UPDATE pursuit_roles SET status='removed' WHERE account_id=$1 AND id=$2`, [auth.accountId, roleId]);
    expect((await resolveMemoryPursuitScopes(pool!, auth, pursuitId)).scopes).toHaveLength(0);
    await pool!.query(`UPDATE pursuit_roles SET status='active', confidence='suggested' WHERE account_id=$1 AND id=$2`, [auth.accountId, roleId]);
    expect((await resolveMemoryPursuitScopes(pool!, auth, pursuitId)).scopes).toHaveLength(0);
    await pool!.query(`UPDATE pursuit_roles SET confidence='confirmed' WHERE account_id=$1 AND id=$2`, [auth.accountId, roleId]);

    // A revoked/deleted capture degrades the association to person-only.
    await pool!.query(`UPDATE captures SET status='deleted', deleted_at=now() WHERE account_id=$1 AND id=$2`, [auth.accountId, captureId]);
    const degraded = (await resolveMemoryPursuitScopes(pool!, auth, pursuitId)).scopes;
    expect(degraded).toHaveLength(1);
    expect(degraded[0]!.relationship_context_id).toBeNull();
  });

  it("restricts a mixed chat operation view and denies cross-scope undo", async () => {
    const auth = await makeAuth("scoped-undo");
    const { all } = draftProposalItems();
    const staged = await stage(auth, {
      items: all,
      contactDecision: "new",
      newContact: { display_label: "Scoped Chen", relationship_context: "Design partner" },
      authorityText: "Scoped Chen design system notes",
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const committed = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "new",
      newContact: { display_label: "Scoped Chen", relationship_context: "Design partner" },
    });
    const receipt = committed.body.receipt;
    const personId = receipt.created_person_id!;
    const contextId = receipt.created_relationship_context_id!;
    const selfProposalIds = new Set(
      opened.review.items.filter((item) => item.scope === "self").map((item) => item.id),
    );

    const relationshipView = await readMemoryScopedOperationView(pool!, auth, receipt.operation_key, {
      purpose: "relationship",
      person_id: personId,
      relationship_context_id: contextId,
    });
    expect(relationshipView.visible_effect_count).toBe(6);
    expect(relationshipView.undo.allowed).toBe(false);
    expect(relationshipView.visible_receipt?.applied_item_count).toBe(6);
    expect(relationshipView.visible_receipt?.decisions).toHaveLength(6);
    // A restricted projection never leaks private self ids or counts.
    for (const decision of relationshipView.visible_receipt?.decisions ?? []) {
      expect(selfProposalIds.has(decision.proposal_item_id)).toBe(false);
    }
    expect(relationshipView.visible_receipt?.item_count).toBe(6);

    await expect(
      undoMemoryScopedOperation(pool!, auth, receipt.operation_key, {
        idempotency_key: randomUUID(),
        expected_commit_revision: relationshipView.commit_revision!,
        purpose: "relationship",
        person_id: personId,
        relationship_context_id: contextId,
        reason: "cross scope undo",
      }),
    ).rejects.toThrow(/scope|authorized/i);

    const chatView = await readMemoryScopedOperationView(pool!, auth, receipt.operation_key, {
      purpose: "chat",
    });
    expect(chatView.visible_effect_count).toBe(17);
    expect(chatView.undo.allowed).toBe(true);

    const undone = await undoMemoryScopedOperation(pool!, auth, receipt.operation_key, {
      idempotency_key: randomUUID(),
      expected_commit_revision: chatView.commit_revision!,
      purpose: "chat",
      reason: "authorized full undo",
    });
    expect(undone.receipt.status).toBe("undone");
  });

  it("denies relationship undo when skipped private self items share the batch", async () => {
    const auth = await makeAuth("scoped-skip");
    const { self, relationship } = draftProposalItems();
    const staged = await stage(auth, {
      items: [...self, ...relationship],
      contactDecision: "new",
      newContact: { display_label: "Skip Chen", relationship_context: "Design partner" },
      authorityText: "Skip Chen design system notes",
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const selfIds = opened.review.items
      .filter((item) => item.scope === "self")
      .map((item) => item.id);
    const relationshipIds = opened.review.items
      .filter((item) => item.scope === "relationship")
      .map((item) => item.id);
    const decisions = Object.fromEntries(
      selfIds.map((id) => [id, "skip" as const]),
    );
    const committed = await commit(auth, opened.review, opened.review_credential!, {
      selected: relationshipIds,
      contactDecision: "new",
      newContact: { display_label: "Skip Chen", relationship_context: "Design partner" },
      decisions,
    });
    const receipt = committed.body.receipt;
    const personId = receipt.created_person_id!;
    const contextId = receipt.created_relationship_context_id!;
    const view = await readMemoryScopedOperationView(pool!, auth, receipt.operation_key, {
      purpose: "relationship",
      person_id: personId,
      relationship_context_id: contextId,
    });
    expect(view.visible_effect_count).toBe(6);
    // Skipped private self items are hidden, so a relationship surface can
    // never whole-batch undo this mixed Chat commit.
    expect(view.undo.allowed).toBe(false);
    const selfIdSet = new Set(selfIds);
    for (const decision of view.visible_receipt?.decisions ?? []) {
      expect(selfIdSet.has(decision.proposal_item_id)).toBe(false);
    }
    for (const skipped of view.visible_receipt?.skipped_item_ids ?? []) {
      expect(selfIdSet.has(skipped)).toBe(false);
    }
    await expect(
      undoMemoryScopedOperation(pool!, auth, receipt.operation_key, {
        idempotency_key: randomUUID(),
        expected_commit_revision: view.commit_revision!,
        purpose: "relationship",
        person_id: personId,
        relationship_context_id: contextId,
        reason: "relationship scoped undo",
      }),
    ).rejects.toThrow(/scope|authorized/i);
  });

  it("reopens a canonical proposal draft at 16 and preserves hidden choices across a scoped save", async () => {
    const auth = await makeAuth("draft-reopen");
    const contact = await makeContact(auth, "Draft Chen");
    const { all } = draftProposalItems();
    const staged = await stage(auth, {
      items: all,
      contactDecision: "existing",
      personId: contact.personId,
      contextId: contact.contextId,
      identityAuthority: "human_selection",
      authorityText: "Draft Chen design system notes",
    });
    const chat = await open(auth, staged!.proposal.proposal_id, "chat");
    const chatVisible = chat.review.items;
    const deselected = chatVisible.find((item) => item.scope === "person")!.id;
    const chatSelected = chatVisible.filter((item) => item.id !== deselected).map((item) => item.id);
    await saveMemoryReviewDraft(pool!, auth, chat.review.review_scope_id, chat.review_credential!, {
      expected_review_revision: chat.review.review_revision,
      contact_decision: "existing",
      selected_item_ids: chatSelected,
      edited_text: {},
      item_decisions: {},
    });
    // A fresh read on the same proposal must see the persisted 16-selection.
    const reopened = await readMemoryReview(pool!, auth, chat.review.review_scope_id, chat.review_credential!);
    expect(reopened.review.draft?.selected_item_ids).toHaveLength(16);
    expect(reopened.review.draft?.selected_item_ids).not.toContain(deselected);

    // A relationship-scoped save must preserve the hidden self/person choices.
    const relationship = await open(
      auth,
      staged!.proposal.proposal_id,
      "relationship",
      contact.personId,
      contact.contextId,
    );
    const relationshipIds = relationship.review.items
      .filter((item) => item.scope === "relationship")
      .map((item) => item.id);
    expect(relationshipIds).toHaveLength(6);
    await saveMemoryReviewDraft(
      pool!,
      auth,
      relationship.review.review_scope_id,
      relationship.review_credential!,
      {
        expected_review_revision: relationship.review.review_revision,
        contact_decision: "existing",
        selected_item_ids: relationshipIds,
        edited_text: {},
        item_decisions: {},
      },
    );
    const chatAgain = await readMemoryReview(pool!, auth, chat.review.review_scope_id, chat.review_credential!);
    expect(chatAgain.review.draft?.selected_item_ids).toHaveLength(16);
    expect(chatAgain.review.draft?.selected_item_ids).not.toContain(deselected);
    for (const id of relationshipIds) {
      expect(chatAgain.review.draft?.selected_item_ids).toContain(id);
    }
  });

  it("never hands another person the original created relationship context", async () => {
    const auth = await makeAuth("other-person-context");
    const other = await makeContact(auth, "Unrelated Person");
    const { all } = draftProposalItems();
    const staged = await stage(auth, {
      items: all,
      contactDecision: "new",
      newContact: { display_label: "Owner Person", relationship_context: "Owner context" },
      authorityText: "Owner Person design system notes",
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const committed = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "new",
      newContact: { display_label: "Owner Person", relationship_context: "Owner context" },
    });
    const view = await readMemoryScopedOperationView(pool!, auth, committed.body.receipt.operation_key, {
      purpose: "people",
      person_id: other.personId,
      relationship_context_id: null,
    });
    expect(view.visible_receipt?.created_person_id).toBeNull();
    expect(view.visible_receipt?.created_relationship_context_id).toBeNull();
    expect(view.undo.allowed).toBe(false);
  });

  it("recovers an already-undone scoped compensation after the created contact is reclaimed", async () => {
    const auth = await makeAuth("undo-reclaimed");
    const { relationship } = draftProposalItems();
    const staged = await stage(auth, {
      items: relationship,
      contactDecision: "new",
      newContact: { display_label: "Reclaim Person", relationship_context: "Reclaim context" },
      authorityText: "Reclaim Person design system notes",
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const committed = await commit(auth, opened.review, opened.review_credential!, {
      selected: opened.review.items.map((item) => item.id),
      contactDecision: "new",
      newContact: { display_label: "Reclaim Person", relationship_context: "Reclaim context" },
    });
    const receipt = committed.body.receipt;
    const personId = receipt.created_person_id!;
    const contextId = receipt.created_relationship_context_id!;
    const first = await readMemoryScopedOperationView(pool!, auth, receipt.operation_key, {
      purpose: "relationship",
      person_id: personId,
      relationship_context_id: contextId,
    });
    expect(first.undo.allowed).toBe(true);
    await undoMemoryScopedOperation(pool!, auth, receipt.operation_key, {
      idempotency_key: randomUUID(),
      expected_commit_revision: first.commit_revision!,
      purpose: "relationship",
      person_id: personId,
      relationship_context_id: contextId,
      reason: "scoped undo",
    });
    // Replayed read must recover the historical own compensation receipt even
    // though the newly created person/context may no longer be active.
    const replay = await readMemoryScopedOperationView(pool!, auth, receipt.operation_key, {
      purpose: "relationship",
      person_id: personId,
      relationship_context_id: contextId,
    });
    expect(replay.state).toBe("undone");
    expect(replay.visible_receipt?.status).toBe("undone");
    expect(replay.visible_receipt?.undo_contact_outcome).toBe("reclaimed");
    const recovered = await undoMemoryScopedOperation(pool!, auth, receipt.operation_key, {
      idempotency_key: randomUUID(),
      expected_commit_revision: replay.commit_revision!,
      purpose: "relationship",
      person_id: personId,
      relationship_context_id: contextId,
      reason: "lost response replay",
    });
    expect(recovered.replayed).toBe(true);
  });

  it("pins and revalidates the exact Pursuit association on read and commit", async () => {
    const auth = await makeAuth("pursuit-assoc");
    const contact = await makeContact(auth, "Pursuit Assoc");
    const { pursuitId, roleId, fragmentId, captureId } = await makePursuitWithEvidence(auth, contact);
    const { relationship } = draftProposalItems();
    const staged = await stage(auth, {
      items: relationship,
      contactDecision: "existing",
      personId: contact.personId,
      contextId: contact.contextId,
      identityAuthority: "human_selection",
      authorityText: "Pursuit association evidence",
    });
    const opened = await openMemoryReview(pool!, auth, staged!.proposal.proposal_id, {
      purpose: "relationship",
      person_id: contact.personId,
      relationship_context_id: contact.contextId,
      pursuit_id: pursuitId,
      pursuit_role_id: roleId,
      pursuit_role_evidence_fragment_id: fragmentId,
    });
    expect(opened.review.pursuit_id).toBe(pursuitId);
    expect(opened.review.pursuit_role_id).toBe(roleId);
    expect(opened.review.pursuit_role_evidence_fragment_id).toBe(fragmentId);

    // A later role removal invalidates the derived review and its commit.
    await pool!.query("UPDATE pursuit_roles SET status='removed' WHERE account_id=$1 AND id=$2", [auth.accountId, roleId]);
    await expect(
      readMemoryReview(pool!, auth, opened.review.review_scope_id, opened.review_credential!),
    ).rejects.toThrow(/Pursuit|current/i);
    await expect(
      commit(auth, opened.review, opened.review_credential!, {
        selected: opened.review.items.map((item) => item.id),
        contactDecision: "existing",
      }),
    ).rejects.toThrow(/Pursuit|current/i);

    // A capture epoch change (rebind) invalidates the pinned association too.
    await pool!.query("UPDATE pursuit_roles SET status='active' WHERE account_id=$1 AND id=$2", [auth.accountId, roleId]);
    await pool!.query("UPDATE captures SET version=version+1 WHERE account_id=$1 AND id=$2", [auth.accountId, captureId]);
    await expect(
      readMemoryReview(pool!, auth, opened.review.review_scope_id, opened.review_credential!),
    ).rejects.toThrow(/Pursuit|current/i);
  });

  it("denies a committed Pursuit operation replay after the role is withdrawn", async () => {
    const auth = await makeAuth("pursuit-replay");
    const contact = await makeContact(auth, "Replay Assoc");
    const { pursuitId, roleId, fragmentId } = await makePursuitWithEvidence(auth, contact);
    const staged = await stage(auth, {
      items: draftProposalItems().relationship,
      contactDecision: "existing",
      personId: contact.personId,
      contextId: contact.contextId,
      identityAuthority: "human_selection",
      authorityText: "Replay association evidence",
    });
    const opened = await openMemoryReview(pool!, auth, staged!.proposal.proposal_id, {
      purpose: "relationship",
      person_id: contact.personId,
      relationship_context_id: contact.contextId,
      pursuit_id: pursuitId,
      pursuit_role_id: roleId,
      pursuit_role_evidence_fragment_id: fragmentId,
    });
    const idempotencyKey = randomUUID();
    const body = {
      idempotency_key: idempotencyKey,
      expected_proposal_revision: opened.review.proposal_revision,
      contact_decision: "existing" as const,
      identity_authority: "human_selection" as const,
      person_id: contact.personId,
      relationship_context_id: contact.contextId,
      selected_item_ids: opened.review.items.map((item) => item.id),
      edited_text: {},
      item_decisions: {},
      expected_item_versions: {},
      reason: "pursuit replay",
    };
    const applied = await commitMemoryReview(pool!, auth, opened.review.review_scope_id, opened.review_credential!, body);
    expect(applied.body.receipt.status).toBe("applied");
    // Withdrawing the role denies even an idempotent replay of the same key.
    await pool!.query("UPDATE pursuit_roles SET status='removed' WHERE account_id=$1 AND id=$2", [auth.accountId, roleId]);
    await expect(
      commitMemoryReview(pool!, auth, opened.review.review_scope_id, opened.review_credential!, body),
    ).rejects.toThrow(/Pursuit|current/i);
  });

  it.each(["new-existing", "existing-new", "skip-existing"] as const)(
    "rebases persisted draft identity and preserves only self intent: %s", async (direction) => {
      const auth = await makeAuth(`draft-rebase-${direction}`);
      const a = await makeContact(auth, "Old target");
      const b = await makeContact(auth, "Existing target");
      const fromExisting = direction === "existing-new";
      const staged = await stage(auth, {
        items: draftProposalItems().all,
        contactDecision: fromExisting ? "existing" : "new",
        ...(fromExisting ? { personId: a.personId, contextId: a.contextId } : {
          newContact: { display_label: "Old target", relationship_context: "Design" },
        }),
        authorityText: "Old target; New target works on design",
      });
      const opened = await open(auth, staged!.proposal.proposal_id, "chat");
      const self = opened.review.items.filter(item => item.scope === "self");
      const oldPerson = opened.review.items.find(item => item.scope === "person")!;
      const saved = await saveMemoryReviewDraft(pool!, auth, opened.review.review_scope_id, opened.review_credential!, {
        expected_review_revision: opened.review.review_revision,
        contact_decision: direction === "skip-existing" ? "none" : opened.review.contact_decision,
        selected_item_ids: [self[0]!.id, oldPerson.id],
        edited_text: { [self[0]!.id]: "I prefer a short conclusion", [oldPerson.id]: "Old edited person" },
        item_decisions: { [oldPerson.id]: "retain_conflict" },
      });
      const nextDecision = fromExisting ? "new" : "existing";
      await regenerateMemoryProposal(pool!, auth, staged!.proposal.proposal_id, {
        expected_proposal_revision: staged!.proposal.revision,
        contact_decision: nextDecision, identity_authority: "human_selection",
        ...(fromExisting ? { new_contact: { display_label: "New target", relationship_context: "Design" } }
          : { person_id: b.personId, relationship_context_id: b.contextId }),
        reason: "Explicitly change identity",
      }, async () => [candidate({ scope: "person", statement_kind: "source_statement", speaker: "New target",
        display_text: "New target works on design", source_excerpt: "New target works on design" })]);
      // An old tab cannot restore the prior decision after the atomic rebase.
      await expect(saveMemoryReviewDraft(pool!, auth, opened.review.review_scope_id, opened.review_credential!, {
        expected_review_revision: saved.review.review_revision,
        contact_decision: "none", selected_item_ids: [], edited_text: {}, item_decisions: {},
      })).rejects.toThrow(/proposal changed/i);
      const fresh = await open(auth, staged!.proposal.proposal_id, "chat");
      const reloaded = await readMemoryReview(pool!, auth, fresh.review.review_scope_id, fresh.review_credential!);
      expect(reloaded.review.draft?.contact_decision).toBe(nextDecision);
      expect(reloaded.review.draft?.selected_item_ids).toEqual([self[0]!.id]);
      expect(reloaded.review.draft?.edited_text).toEqual({ [self[0]!.id]: "I prefer a short conclusion" });
      expect(reloaded.review.draft?.item_decisions).toEqual({});
      const regenerated = reloaded.review.items.find(item => item.scope === "person")!;
      expect(regenerated.id).not.toBe(oldPerson.id);
      const applied = await commit(auth, reloaded.review, fresh.review_credential!, {
        selected: [regenerated.id], contactDecision: reloaded.review.draft!.contact_decision,
        newContact: fromExisting ? { display_label: "New target", relationship_context: "Design" } : null,
      });
      expect(applied.body.receipt.created_item_ids).toHaveLength(1);
    },
  );

  it("reopens a skipped-contact draft with all dependent intent preserved", async () => {
    const auth = await makeAuth("draft-skip-reopen");
    const staged = await stage(auth, {
      items: draftProposalItems().all,
      contactDecision: "new",
      newContact: { display_label: "Skip Draft", relationship_context: "设计交流" },
      authorityText: "Skip Draft design system notes",
    });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const personItem = opened.review.items.find((item) => item.scope === "person")!;
    const selfItem = opened.review.items.find((item) => item.scope === "self")!;
    const selected = opened.review.items
      .filter((item) => item.id !== personItem.id && item.id !== selfItem.id)
      .map((item) => item.id);
    await saveMemoryReviewDraft(pool!, auth, opened.review.review_scope_id, opened.review_credential!, {
      expected_review_revision: opened.review.review_revision,
      contact_decision: "none",
      selected_item_ids: selected,
      edited_text: {},
      item_decisions: {},
    });
    const reopened = await readMemoryReview(pool!, auth, opened.review.review_scope_id, opened.review_credential!);
    expect(reopened.review.draft?.contact_decision).toBe("none");
    expect(reopened.review.draft?.selected_item_ids).toHaveLength(15);
    const otherPersonItem = opened.review.items.find((item) => item.scope === "person" && item.id !== personItem.id)!;
    const relationshipItem = opened.review.items.find((item) => item.scope === "relationship")!;
    expect(reopened.review.draft?.selected_item_ids).not.toContain(personItem.id);
    expect(reopened.review.draft?.selected_item_ids).not.toContain(selfItem.id);
    // The hidden dependent intent (other person + relationship items) survives
    // the skipped-contact save and its PG reopen.
    expect(reopened.review.draft?.selected_item_ids).toContain(otherPersonItem.id);
    expect(reopened.review.draft?.selected_item_ids).toContain(relationshipItem.id);
  });

  async function committedPursuit(label: string) {
    const auth = await makeAuth(label);
    const contact = await makeContact(auth, label);
    const association = await makePursuitWithEvidence(auth, contact);
    const staged = await stage(auth, { items: draftProposalItems().relationship, contactDecision: "existing",
      personId: contact.personId, contextId: contact.contextId, identityAuthority: "human_selection", authorityText: "Pursuit association evidence" });
    const opened = await openMemoryReview(pool!, auth, staged!.proposal.proposal_id, { purpose: "relationship",
      person_id: contact.personId, relationship_context_id: contact.contextId, pursuit_id: association.pursuitId,
      pursuit_role_id: association.roleId, pursuit_role_evidence_fragment_id: association.fragmentId });
    const applied = await commit(auth, opened.review, opened.review_credential!, { selected: opened.review.items.map(item => item.id), contactDecision: "existing" });
    return { auth, contact, association, receipt: applied.body.receipt, query: { purpose: "relationship" as const, person_id: contact.personId, relationship_context_id: contact.contextId } };
  }

  it.each(["link", "pursuit", "resource"] as const)("serializes %s withdrawal against scoped undo", async kind => {
    const { auth, association, receipt, query } = await committedPursuit(`barrier-${kind}`);
    const revoke = await pool!.connect();
    await revoke.query("BEGIN");
    let undo!: Promise<unknown>;
    try {
      if (kind === "link") await revoke.query("DELETE FROM pursuit_role_evidence WHERE account_id=$1 AND role_id=$2", [auth.accountId, association.roleId]);
      if (kind === "pursuit") await revoke.query("UPDATE pursuits SET status='cancelled' WHERE account_id=$1 AND id=$2", [auth.accountId, association.pursuitId]);
      if (kind === "resource") await revoke.query("UPDATE source_resources SET processing_state='deleted' WHERE account_id=$1 AND capture_id=$2", [auth.accountId, association.captureId]);
      let settled = false;
      undo = undoMemoryScopedOperation(pool!, auth, receipt.operation_key, { ...query, idempotency_key: randomUUID(), expected_commit_revision: 1, reason: "concurrent undo" })
        .then(value => { settled = true; return value; }, error => { settled = true; return error; });
      // The revocation owns the exact authorizing row before undo starts.
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(settled).toBe(false);
      await revoke.query("COMMIT");
      expect(await undo).toMatchObject({ code: "MEMORY_PURSUIT_ASSOCIATION_STALE" });
      expect((await pool!.query("SELECT status FROM memory_commits WHERE id=$1", [receipt.commit_id])).rows[0].status).toBe("applied");
    } finally { await revoke.query("ROLLBACK"); revoke.release(); if (undo) await undo; }
  });

  it.each(["purge", "expire", "expire-purge", "purge-expire"])("retains accepted Pursuit history through real natural lifecycle: %s", async order => {
    const { auth, association, receipt, query } = await committedPursuit(`pursuit-natural-${order}`);
    for (const step of order.split("-")) {
      if (step === "purge") {
        await pool!.query("UPDATE source_retention_receipts SET retention_until=now()-interval '1 hour' WHERE account_id=$1 AND capture_id=$2", [auth.accountId, association.captureId]);
        await sweepDueSourceRetention(pool!);
        expect((await pool!.query("SELECT status FROM evidence_fragments WHERE id=$1", [association.fragmentId])).rows[0].status).toBe("purged");
      } else {
        await pool!.query("UPDATE source_retention_receipts SET authorization_expires_at=now()-interval '1 hour' WHERE account_id=$1 AND capture_id=$2", [auth.accountId, association.captureId]);
        await sweepDueSourceAuthorizations(pool!);
        expect((await pool!.query("SELECT authorization_state FROM source_retention_receipts WHERE capture_id=$1", [association.captureId])).rows[0].authorization_state).toBe("expired");
      }
    }
    expect((await readMemoryScopedOperationView(pool!, auth, receipt.operation_key, query)).state).toBe("applied");
    const undo = { ...query, idempotency_key: randomUUID(), expected_commit_revision: 1, reason: "undo after natural TTL" };
    expect((await undoMemoryScopedOperation(pool!, auth, receipt.operation_key, undo)).receipt.status).toBe("undone");
    expect((await undoMemoryScopedOperation(pool!, auth, receipt.operation_key, undo)).replayed).toBe(true);
    await pool!.query("UPDATE source_retention_receipts SET authorization_state='revoked' WHERE account_id=$1 AND capture_id=$2", [auth.accountId, association.captureId]);
    await expect(readMemoryScopedOperationView(pool!, auth, receipt.operation_key, query)).rejects.toMatchObject({ code: "MEMORY_PURSUIT_ASSOCIATION_STALE" });
    await expect(undoMemoryCommit(pool!, auth, receipt.commit_id, { idempotency_key: undo.idempotency_key, expected_commit_revision: undo.expected_commit_revision, reason: undo.reason })).rejects.toMatchObject({ code: "MEMORY_PURSUIT_ASSOCIATION_STALE" });
  });

  it("rejects accepted history when a manual epoch interrupts natural transitions", async () => {
    const { auth, association, receipt, query } = await committedPursuit("pursuit-epoch-gap");
    await pool!.query("UPDATE source_retention_receipts SET authorization_expires_at=now()-interval '1 hour' WHERE capture_id=$1", [association.captureId]);
    await sweepDueSourceAuthorizations(pool!);
    await pool!.query("UPDATE captures SET version=version+1 WHERE id=$1", [association.captureId]);
    await pool!.query("UPDATE source_retention_receipts SET retention_until=now()-interval '1 hour' WHERE capture_id=$1", [association.captureId]);
    await sweepDueSourceRetention(pool!);
    await expect(readMemoryScopedOperationView(pool!, auth, receipt.operation_key, query)).rejects.toMatchObject({ code: "MEMORY_PURSUIT_ASSOCIATION_STALE" });
  });

  it("does not exempt an existing contact from current scope checks after undo", async () => {
    const auth = await makeAuth("historical-existing");
    const contact = await makeContact(auth, "Existing");
    const staged = await stage(auth, { items: draftProposalItems().relationship, contactDecision: "existing", personId: contact.personId, contextId: contact.contextId, identityAuthority: "human_selection" });
    const opened = await open(auth, staged!.proposal.proposal_id, "relationship", contact.personId, contact.contextId);
    const applied = await commit(auth, opened.review, opened.review_credential!, { selected: opened.review.items.map(item => item.id), contactDecision: "existing" });
    await undoMemoryCommit(pool!, auth, applied.body.receipt.commit_id, { idempotency_key: randomUUID(), expected_commit_revision: 1, reason: "undo" });
    await pool!.query("UPDATE subjects SET status='deleted' WHERE id=$1", [contact.personId]);
    await expect(readMemoryScopedOperationView(pool!, auth, applied.body.receipt.operation_key, { purpose: "people", person_id: contact.personId })).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND" });
  });

  it("persists retained contact outcome and rejects later business reads after its deletion", async () => {
    const auth = await makeAuth("historical-retained");
    const newContact = { display_label: "Retained", relationship_context: "Design" };
    const staged = await stage(auth, { items: draftProposalItems().relationship, contactDecision: "new", newContact, authorityText: "Retained design system notes" });
    const opened = await open(auth, staged!.proposal.proposal_id, "chat");
    const applied = await commit(auth, opened.review, opened.review_credential!, { selected: opened.review.items.map(item => item.id), contactDecision: "new", newContact });
    const receipt = applied.body.receipt;
    await pool!.query("INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label,status) VALUES($1,$2,$3,$4,'Later relationship','active')", [randomUUID(), auth.accountId, receipt.created_person_id, randomUUID()]);
    const request = { idempotency_key: randomUUID(), expected_commit_revision: 1, reason: "retain later work" };
    expect((await undoMemoryCommit(pool!, auth, receipt.commit_id, request)).receipt.undo_contact_outcome).toBe("retained");
    const view = await readMemoryScopedOperationView(pool!, auth, receipt.operation_key, { purpose: "people", person_id: receipt.created_person_id! });
    expect(view.visible_receipt?.undo_contact_outcome).toBe("retained");
    expect((await undoMemoryCommit(pool!, auth, receipt.commit_id, request)).receipt.undo_contact_outcome).toBe("retained");
    await pool!.query("UPDATE subjects SET status='deleted' WHERE id=$1", [receipt.created_person_id]);
    await expect(readMemoryScopedOperationView(pool!, auth, receipt.operation_key, { purpose: "people", person_id: receipt.created_person_id! })).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND" });
  });

  it("binds operation read and undo to the signed Session inside the transaction", async () => {
    const {auth,receipt}=await committedPursuit("operation-session");
    const request={purpose:"chat" as const,session_id:randomUUID()};
    await expect(readMemoryScopedOperationView(pool!,auth,receipt.operation_key,request)).rejects.toMatchObject({code:"MEMORY_ENTRY_SCOPE_MISMATCH"});
    await expect(undoMemoryScopedOperation(pool!,auth,receipt.operation_key,{...request,idempotency_key:randomUUID(),expected_commit_revision:1,reason:"wrong entry"})).rejects.toMatchObject({code:"MEMORY_ENTRY_SCOPE_MISMATCH"});
    expect((await pool!.query("SELECT status FROM memory_commits WHERE id=$1",[receipt.commit_id])).rows[0].status).toBe("applied");
  });
  it.each(["delete","rebind"])("rejects relationship corrections and replay after context %s", async kind => {
    const {auth,contact,receipt}=await committedPursuit(`mutation-${kind}`);
    const id=receipt.created_item_ids[0]!;
    const request={operation:"correct" as const,idempotency_key:randomUUID(),expected_version:1,display_text:"Human corrected plan",reason:"human correction",
      entry_scope:{purpose:"relationship" as const,person_id:contact.personId,relationship_context_id:contact.contextId}};
    await mutateMemoryItem(pool!,auth,id,request);
    if(kind==="delete")await pool!.query("UPDATE assignments SET status='deleted' WHERE id=$1",[contact.contextId]);
    else {const other=await makeContact(auth,"Other");await pool!.query("UPDATE assignments SET subject_id=$2 WHERE id=$1",[contact.contextId,other.personId]);}
    await expect(mutateMemoryItem(pool!,auth,id,request)).rejects.toMatchObject({code:"MEMORY_NOT_FOUND"});
    await expect(mutateMemoryItem(pool!,auth,id,{...request,idempotency_key:randomUUID(),expected_version:2})).rejects.toMatchObject({code:"MEMORY_NOT_FOUND"});
  });

  it("rechecks image authority transactionally after the preflight image read", async () => {
    const auth=await makeAuth("image-recall-race");const contact=await makeContact(auth,"Chen");
    await pool!.query(`INSERT INTO identity_handles(id,account_id,subject_id,handle_type,normalized_value_hash,display_hint,status,confirmed_by_user_id,freshness_policy_version,validity_basis,valid_until)
      VALUES($1,$2,$3,'source_native_id',$4,'@chenyu_demo','confirmed',$5,'identity-freshness-2026-08-07.v1','policy_default',now()+interval '180 days')`,[randomUUID(),auth.accountId,contact.personId,createHash("sha256").update("chenyu_demo").digest("hex"),auth.userId]);
    const staged=await stage(auth,{items:draftProposalItems().relationship,contactDecision:"existing",personId:contact.personId,contextId:contact.contextId,identityAuthority:"human_selection"});
    const opened=await open(auth,staged!.proposal.proposal_id,"chat");
    await commit(auth,opened.review,opened.review_credential!,{selected:opened.review.items.map(item=>item.id),contactDecision:"existing"});
    const sessionId=randomUUID(),messageId=randomUUID(),attachmentId=randomUUID();
    const hash=createHash("sha256").update(Buffer.from([1,2,3,4])).digest("hex");
    await insertSourceSession(auth,sessionId,messageId,"",[{attachmentId,contentHash:hash}]);
    const artifact=`conversation-image-${messageId}-0-${attachmentId}`;
    // Pause after the second real PG image preflight has observed the row,
    // then remove it before the adapter enters its authorization transaction.
    const original=pool!.query.bind(pool!);let reads=0;
    const spy=vi.spyOn(pool!,"query").mockImplementation((async (...args: unknown[])=>{
      const result=await (original as (...args: unknown[])=>Promise<unknown>)(...args);
      if(typeof args[0]==="string" && args[0].includes("SELECT image.content_hash, image.content") && ++reads===2) {
        await original("DELETE FROM conversation_message_images WHERE account_id=$1 AND session_id=$2",[auth.accountId,sessionId]);
      }
      return result;
    }) as Pool["query"]);
    let recalled: unknown;
    try {
      const provider={providerId:"zhipu-chat-completions",id:"image-race",model:"synthetic",sdkVersion:"test",supportsImageInput:true,
        inputCapabilities:{text:true,image:true,imageUnderstanding:true},answer:vi.fn(),
        run:async (_request:unknown,invoke:(name:string,input:unknown)=>Promise<unknown>)=>{
          expect(await invoke("contact_workspace",{operation:"search",query:"@chenyu_demo",maximum_results:4,source_clue:{clue:"@chenyu_demo",source_locator:{kind:"image_region",artifact_id:artifact,image_index:0}}})).toMatchObject({ok:true});
          recalled=await invoke("memory_review",{operation:"recall",person_id:contact.personId,relationship_context_id:contact.contextId});
          return {structuredOutput:{outcome:"reply",title:"Source changed",body:"请重新提供图片。"},inputTokens:1,outputTokens:1,estimatedUsd:0,turns:1,permissionDenials:[]};
        }};
      await executeWorkspaceConversationAgent({database:pool!,auth,sessionID:sessionId,messageID:messageId,objective:"Please summarize this image",sourceText:"",provider:provider as never,
        inputParts:[{kind:"image",artifactID:artifact,mimeType:"image/png",byteSize:4,contentHash:hash,dataBase64:Buffer.from([1,2,3,4]).toString("base64")}]});
      expect(reads).toBe(2);expect(recalled).toMatchObject({ok:false,error:{code:"MEMORY_UNAVAILABLE"}});
      expect(JSON.stringify(recalled)).not.toContain("display_text");
    } finally {spy.mockRestore();}
  });

});
