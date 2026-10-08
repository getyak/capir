import "server-only";

import { createHash } from "node:crypto";

import {
  CONTRACT_VERSION,
  SIMULATED_CAPABILITY,
  TalentSignalClient,
  TalentSignalHttpError,
  type AssertionDecisionRequest,
  type AssertionDecisionResponse,
  type ChatTaskResponse,
  type CaptureIdentityCorrectionRequest,
  type CaptureIdentityCorrectionResponse,
  type DeleteCaptureResponse,
  type DeletionLineageResponse,
  type EffectResultResponse,
  type EffectReversalPreview,
  type PersonDirectoryResponse,
  type PersonMergePreview,
  type PersonMergeRequest,
  type PersonMergeResponse,
  type PersonMergeReversalRequest,
  type PersonMergeReversalPreview,
  type PublicResearchResponse,
  type EvidenceFragmentInput,
  type EvidenceFragmentReviewRequest,
  type EvidenceFragmentReviewResponse,
  type IdentityResolutionCase,
  type IdentityResolutionDecisionRequest,
  type IdentityResolutionDecisionResponse,
  type KnowledgeSnapshot,
  type RelationshipResourceDetail,
  type RelationshipResourceListResponse,
  type RelationshipAgentHistory,
  type RelationshipScope,
  type ResourceCaptureResponse,
  type ResourceCaptureRequest,
  type SimulatedEffectPreview,
  type SourceAuthorizationDecisionRequest,
  type SourceAuthorizationDecisionResponse,
  type VoiceTranscriptionDraft,
  type WorkspaceReviewResponse,
  type TelemetryContext,
  type MemoryProposalRecord,
  type MemoryRecallItem,
  type MemoryPursuitScope,
} from "@talent-signal/contracts";

import { screenshotIdentityChoiceIssue } from "../person-identity-choice";
import {
  validateScreenshotAnalysisMeta,
  validateScreenshotCaptureDraft,
  validateReviewedScreenshotEdit,
  type ScreenshotAnalysisMeta,
  type ScreenshotCaptureDraft,
} from "../screenshot-capture";
import { verifyScreenshotAnalysisReceipt } from "./screenshot-analysis-receipt";
import { authenticatedBackendClient as signedInBackendClient } from "./backendAuth";
import { BackendSessionExpiredError, isBackendSessionExpiredError } from "../backend-session";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_ACCOUNT_SLUG = "fixture-alpha";
const LOCAL_USER_EMAIL = "recruiter@alpha.local";
const TS_CORE_01 = "TS-CORE-01";

function backendBaseUrl(): string {
  const configured =
    process.env.TALENT_SIGNAL_BACKEND_URL?.trim() ??
    "http://127.0.0.1:4317";
  const parsed = new URL(configured);
  if (
    parsed.protocol !== "http:" ||
    !LOCAL_HOSTNAMES.has(parsed.hostname)
  ) {
    throw new Error("集成后端必须是本地主机 HTTP URL。");
  }
  return parsed.origin;
}

function stableRef(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

/**
 * Deterministic UUID for a caller-owned relationship Session. The same
 * request_id always resolves the same Session so an idempotent retry never
 * creates a second conversation or a duplicate committed source.
 */
function deterministicSessionId(value: string): string {
  const digest = createHash("sha256")
    .update(`get40-relationship-session:${value}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "4";
  digest[16] = "8";
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function readWorkspace(
  client: TalentSignalClient,
  captureId?: string,
) {
  return captureId
    ? client.getWorkspaceReviewByCapture(captureId)
    : client.getWorkspaceReview(TS_CORE_01);
}

async function authenticatedClient(clientLabel: string) {
  const signedIn = await signedInBackendClient();
  if (signedIn) {
    try {
      const session = await signedIn.currentSession();
      return { client: signedIn, session };
    } catch (error) {
      if (isBackendSessionExpiredError(error)) throw new BackendSessionExpiredError();
      throw error;
    }
  }
  const client = new TalentSignalClient(backendBaseUrl());
  const session = await client.login({
    account_slug: process.env.TALENT_SIGNAL_BACKEND_ACCOUNT_SLUG ?? LOCAL_ACCOUNT_SLUG,
    user_email: process.env.TALENT_SIGNAL_BACKEND_USER_EMAIL ?? LOCAL_USER_EMAIL,
    client_label: clientLabel,
  });
  return { client, session };
}

export function isIntegrationMode(): boolean {
  const configured = process.env.TALENT_SIGNAL_INTEGRATION_MODE;
  return (
    configured === "true" ||
    (process.env.NODE_ENV !== "production" && configured !== "false")
  );
}

export async function loadBackendWorkspace(
  clientLabel = "web-workspace",
  captureId?: string,
): Promise<WorkspaceReviewResponse> {
  const { client } = await authenticatedClient(clientLabel);
  return readWorkspace(client, captureId);
}

export async function loadPeopleDirectory(
  query = "",
): Promise<PersonDirectoryResponse> {
  const { client } = await authenticatedClient("web-people-directory");
  return client.listPeople(query);
}

export async function searchPeopleDirectory(
  query: string,
): Promise<PersonDirectoryResponse> {
  const { client } = await authenticatedClient(
    "web-people-directory-search",
  );
  return client.searchPeople(query);
}

/**
 * Person-only Memory surface. It never forces a relationship context: a
 * person with no context is still reachable, and any existing contexts remain
 * explicit navigation links.
 */
export async function loadPersonMemory(personId: string): Promise<{
  person: PersonDirectoryResponse["people"][number] | null;
  proposals: MemoryProposalRecord[];
  items: MemoryRecallItem[];
}> {
  if (!UUID.test(personId)) throw new Error("人物标识无效。");
  const [{ client }, directory] = await Promise.all([
    authenticatedClient("web-person-memory"),
    loadPeopleDirectory(),
  ]);
  const [proposals, recall] = await Promise.all([
    client.listMemoryProposals({ purpose: "people", person_id: personId }),
    client.recallMemories({ surface: "people", person_id: personId, limit: 50 }),
  ]);
  return {
    person: directory.people.find((entry) => entry.id === personId) ?? null,
    proposals: proposals.proposals,
    items: recall.items,
  };
}

/** Pursuit-scoped Memory review entries resolved through the authenticated API. */
export async function loadPursuitMemoryScopes(pursuitId: string): Promise<
  Array<
    MemoryPursuitScope & {
      proposals: MemoryProposalRecord[];
    }
  >
> {
  if (!UUID.test(pursuitId)) throw new Error("寻访标识无效。");
  const { client } = await authenticatedClient("web-pursuit-memory");
  const resolved = await client.resolveMemoryPursuitScopes(pursuitId);
  const scopes: Array<MemoryPursuitScope & { proposals: MemoryProposalRecord[] }> = [];
  for (const scope of resolved.scopes) {
    const proposals = await client.listMemoryProposals({
      purpose: "relationship",
      person_id: scope.person_id,
      relationship_context_id: scope.relationship_context_id ?? null,
    });
    scopes.push({ ...scope, proposals: proposals.proposals });
  }
  return scopes;
}

export async function loadIdentityResolutionCase(
  caseId: string,
): Promise<IdentityResolutionCase> {
  const { client } = await authenticatedClient(
    "web-identity-resolution-case",
  );
  return client.getIdentityResolutionCase(caseId);
}

export type RelationshipWorkspaceInitialRead = {
  accountId: string;
  workspace: WorkspaceReviewResponse | null;
  relationshipScope: RelationshipScope | null;
  identityResolutionCase: IdentityResolutionCase | null;
  agentHistory: RelationshipAgentHistory | null;
  knowledgeSnapshot: KnowledgeSnapshot | null;
  warnings: string[];
};

export async function loadRelationshipWorkspaceInitialRead(input: {
  captureId?: string;
  personId?: string;
  relationshipContextId?: string;
  identityCaseId?: string;
}): Promise<RelationshipWorkspaceInitialRead> {
  const { client, session } = await authenticatedClient(
    "web-relationship-workspace-initial-read",
  );
  const hasRelationshipScope = Boolean(
    input.personId && input.relationshipContextId && !input.captureId,
  );
  const shouldReadWorkspace = Boolean(
    input.captureId || !input.identityCaseId,
  ) && !hasRelationshipScope;

  const [workspace, relationshipScope, identityResolutionCase] =
    await Promise.all([
      shouldReadWorkspace
        ? readWorkspace(client, input.captureId).catch((error: unknown) => {
            // An account with no seeded/default capture still owns a workspace
            // conversation. An explicitly requested missing capture is an error.
            if (!input.captureId && error instanceof TalentSignalHttpError && error.status === 404) return null;
            throw error;
          })
        : Promise.resolve(null),
      hasRelationshipScope
        ? client.getRelationshipScope(
            input.personId as string,
            input.relationshipContextId as string,
          )
        : Promise.resolve(null),
      input.identityCaseId
        ? client.getIdentityResolutionCase(input.identityCaseId)
        : Promise.resolve(null),
    ]);

  const historyScope = relationshipScope
    ? {
        personId: relationshipScope.person.id,
        relationshipContextId: relationshipScope.relationship_context.id,
      }
    : workspace
      ? {
          personId: workspace.subject.id,
          relationshipContextId: workspace.assignment.id,
        }
      : null;

  if (!historyScope) {
    return {
      accountId: session.account.id,
      workspace,
      relationshipScope,
      identityResolutionCase,
      agentHistory: null,
      knowledgeSnapshot: null,
      warnings: [],
    };
  }

  const [scopeRead, historyRead, knowledgeRead] = await Promise.allSettled([
    relationshipScope
      ? Promise.resolve(relationshipScope)
      : client.getRelationshipScope(
          historyScope.personId,
          historyScope.relationshipContextId,
        ),
    client.getRelationshipAgentHistory(
      historyScope.personId,
      historyScope.relationshipContextId,
    ),
    client.getKnowledge(
      historyScope.personId,
      historyScope.relationshipContextId,
    ),
  ]);
  const warnings: string[] = [];
  if (scopeRead.status === "rejected") {
    warnings.push(
      "The relationship loaded, but its current person record details are temporarily unavailable.",
    );
  }
  if (historyRead.status === "rejected") {
    warnings.push(
      "The contact loaded, but its durable Agent history is temporarily unavailable.",
    );
  }
  if (
    knowledgeRead.status === "rejected" &&
    (!(knowledgeRead.reason instanceof TalentSignalHttpError) ||
      knowledgeRead.reason.status !== 404)
  ) {
    warnings.push(
      "The contact loaded, but its latest relationship Wiki is temporarily unavailable.",
    );
  }

  return {
    accountId: session.account.id,
    workspace,
    relationshipScope:
      scopeRead.status === "fulfilled"
        ? scopeRead.value
        : relationshipScope,
    identityResolutionCase,
    agentHistory:
      historyRead.status === "fulfilled" ? historyRead.value : null,
    knowledgeSnapshot:
      knowledgeRead.status === "fulfilled" ? knowledgeRead.value : null,
    warnings,
  };
}

export type IdentityResolutionWorkflowResult = {
  decision: IdentityResolutionDecisionResponse;
  identity_case: IdentityResolutionCase;
  compilation: KnowledgeSnapshot | null;
  compilation_error: string | null;
};

export async function decideIdentityResolution(
  caseId: string,
  request: IdentityResolutionDecisionRequest,
): Promise<IdentityResolutionWorkflowResult> {
  const { client } = await authenticatedClient(
    "web-identity-resolution-decision",
  );
  const decision = await client.decideIdentityResolutionCase(
    caseId,
    request,
  );
  const identityCase = await client.getIdentityResolutionCase(caseId);
  if (
    decision.identity_status !== "bound" ||
    !decision.person_id ||
    !decision.relationship_context_id
  ) {
    return {
      decision,
      identity_case: identityCase,
      compilation: null,
      compilation_error: null,
    };
  }
  try {
    const compilation = await client.compileKnowledge(
      decision.person_id,
      decision.relationship_context_id,
      {
        idempotency_key:
          `identity-case:${caseId}:version:${decision.case_version}`,
        objective:
          "Recompile the selected relationship after explicit identity resolution.",
      },
    );
    return {
      decision,
      identity_case: identityCase,
      compilation,
      compilation_error: null,
    };
  } catch {
    return {
      decision,
      identity_case: identityCase,
      compilation: null,
      compilation_error:
        "Identity was resolved, but the derived Wiki did not recompile. The governed source remains bound and compilation can be retried.",
    };
  }
}

type CommitRelationshipResourceCommon = {
  request_id: string;
  captured_at: string;
  channel: "chat" | "web_upload";
  kind: ResourceCaptureRequest["resource"]["kind"];
  display_name: string;
  media_type: string;
  confirmed_identity_handles?: NonNullable<
    ResourceCaptureRequest["confirmed_identity_handles"]
  >;
  byte_size?: number;
  content_hash?: string;
  source_locator?: string;
  discovered_from_resource_id?: string;
  fragments: EvidenceFragmentInput[];
};

export type CommitRelationshipResourceInput =
  CommitRelationshipResourceCommon &
    (
      | {
          person_id: string;
          relationship_context_id: string;
          person_scope?: never;
        }
      | {
          person_scope: ResourceCaptureRequest["person_scope"];
          person_id?: never;
          relationship_context_id?: never;
        }
    );

export async function commitRelationshipResource(
  input: CommitRelationshipResourceInput,
): Promise<ResourceCaptureResponse> {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(input.request_id) ||
    ("person_id" in input &&
      (!input.person_id ||
        !input.relationship_context_id ||
        !uuid.test(input.person_id) ||
        !uuid.test(input.relationship_context_id))) ||
    input.display_name.trim().length === 0 ||
    input.display_name.length > 240 ||
    input.media_type.trim().length === 0 ||
    input.media_type.length > 120 ||
    input.fragments.length === 0 ||
    input.fragments.length > 300 ||
    (input.discovered_from_resource_id !== undefined &&
      !uuid.test(input.discovered_from_resource_id))
  ) {
    throw new Error("受治理来源的接收信息不完整。");
  }
  const capturedAt = input.captured_at;
  // The observation time is client-attested evidence. Never invent it here;
  // reject missing or malformed values with a recoverable validation error
  // instead of letting Date.toISOString throw a raw RangeError.
  if (
    typeof capturedAt !== "string" ||
    capturedAt.length === 0 ||
    Number.isNaN(Date.parse(capturedAt)) ||
    new Date(capturedAt).toISOString() !== capturedAt
  ) {
    throw new Error(
      "无法确认该来源的观察时间，未保存任何内容。请刷新页面后重新提交。",
    );
  }
  const timezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  const clientResourceId = `web-resource:${input.request_id}`;
  if (
    input.fragments.some(
      (fragment) => fragment.client_resource_id !== clientResourceId,
    )
  ) {
    throw new Error("来源片段已绑定到另一项接收记录。");
  }
  const sourceScope =
    input.kind === "resume" || input.kind === "document"
      ? "reviewed_extracted_text"
      : "reviewed_selected_text";
  const { client } = await authenticatedClient(
    `web-resource-${input.kind}`,
  );
  const personScope: ResourceCaptureRequest["person_scope"] =
    "person_scope" in input && input.person_scope
      ? input.person_scope
      : {
          status: "confirmed",
          person_id: input.person_id as string,
          relationship_context: {
            status: "existing",
            relationship_context_id:
              input.relationship_context_id as string,
          },
          binding_basis:
            "The signed-in recruiter submitted this resource from the visible person and relationship context.",
        };
  return client.createResourceCapture({
    contract_version: CONTRACT_VERSION,
    idempotency_key: `web-resource:${input.request_id}`,
    channel: input.channel,
    purpose:
      input.kind === "personal_note"
        ? "Preserve a recruiter-authored note in the selected relationship context"
        : input.kind === "public_url"
          ? "Save a recruiter-selected public URL as an unexecuted research seed"
          : input.kind === "conversation_transcript"
            ? "Attach a recruiter-reviewed conversation transcript for evidence and fact review"
          : "Attach extracted document evidence to the selected relationship context",
    captured_at: capturedAt,
    source_timezone: timezone,
    person_scope: personScope,
    ...(input.confirmed_identity_handles
      ? {
          confirmed_identity_handles:
            input.confirmed_identity_handles,
        }
      : {}),
    resource: {
      client_resource_id: clientResourceId,
      kind: input.kind,
      display_name: input.display_name.trim(),
      media_type: input.media_type.trim(),
      observed_at: capturedAt,
      source_timezone: timezone,
      ...(input.byte_size === undefined
        ? {}
        : { byte_size: input.byte_size }),
      ...(input.content_hash
        ? { content_hash: input.content_hash }
        : {}),
      ...(input.source_locator
        ? { source_locator: input.source_locator }
        : {}),
      ...(input.discovered_from_resource_id
        ? {
            discovered_from_resource_id:
              input.discovered_from_resource_id,
            discovered_from_client_resource_id: "parent-governed-resource",
          }
        : {}),
      retention: {
        requested_mode: "ephemeral",
        source_scope: sourceScope,
      },
    },
    fragments: input.fragments,
  });
}

export async function loadRelationshipScope(
  personId: string,
  relationshipContextId: string,
): Promise<RelationshipScope> {
  const { client } = await authenticatedClient(
    "web-relationship-scope",
  );
  return client.getRelationshipScope(personId, relationshipContextId);
}

export type PersonMergeCompilationReceipt = {
  relationship_context_id: string;
  person_id: string;
  status: KnowledgeSnapshot["status"] | "failed";
  knowledge_snapshot_id: string | null;
  error: string | null;
};

export type PersonMergeWorkflowResult = PersonMergeResponse & {
  compilations: PersonMergeCompilationReceipt[];
};

export async function previewRelationshipPersonMerge(
  sourcePersonId: string,
  targetPersonId: string,
): Promise<PersonMergePreview> {
  if (
    !UUID.test(sourcePersonId) ||
    !UUID.test(targetPersonId) ||
    sourcePersonId === targetPersonId
  ) {
    throw new TalentSignalHttpError(
      400,
      "person_merge_scope_invalid",
      "Choose two different active people for merge review.",
      null,
    );
  }
  const { client } = await authenticatedClient(
    "web-person-merge-preview",
  );
  return client.previewPersonMerge(sourcePersonId, targetPersonId);
}

async function compilePersonMergeContexts(
  client: TalentSignalClient,
  merge: PersonMergeResponse,
): Promise<PersonMergeCompilationReceipt[]> {
  const movedContexts = new Set(
    merge.affected_relationship_context_ids,
  );
  const pending = [
    ...merge.relationship_context_ids_requiring_recompilation,
  ];
  const receipts: PersonMergeCompilationReceipt[] = [];
  while (pending.length > 0) {
    const batch = pending.splice(0, 6);
    receipts.push(
      ...(await Promise.all(
        batch.map(async (relationshipContextId) => {
          const personId =
            merge.status === "reversed" &&
            movedContexts.has(relationshipContextId)
              ? merge.source_person_id
              : merge.target_person_id;
          try {
            const snapshot = await client.compileKnowledge(
              personId,
              relationshipContextId,
              {
                idempotency_key:
                  `person-merge:${merge.operation_id}:${merge.status}:${relationshipContextId}`,
                objective:
                  merge.status === "applied"
                    ? "Recompile this relationship after the recruiter confirmed a reversible person merge"
                    : "Recompile this relationship after the recruiter reversed a person merge",
              },
            );
            return {
              relationship_context_id: relationshipContextId,
              person_id: personId,
              status: snapshot.status,
              knowledge_snapshot_id: snapshot.id,
              error: null,
            } satisfies PersonMergeCompilationReceipt;
          } catch (caught) {
            return {
              relationship_context_id: relationshipContextId,
              person_id: personId,
              status: "failed",
              knowledge_snapshot_id: null,
              error:
                caught instanceof Error
                  ? caught.message
                  : "无法重新编译这份关系 Wiki。",
            } satisfies PersonMergeCompilationReceipt;
          }
        }),
      )),
    );
  }
  return receipts;
}

export async function mergeRelationshipPeople(
  request: PersonMergeRequest,
): Promise<PersonMergeWorkflowResult> {
  const { client } = await authenticatedClient("web-person-merge");
  const merge = await client.mergePeople(request);
  return {
    ...merge,
    compilations: await compilePersonMergeContexts(client, merge),
  };
}

export async function reverseRelationshipPersonMerge(
  operationId: string,
  request: PersonMergeReversalRequest,
): Promise<PersonMergeWorkflowResult> {
  if (!UUID.test(operationId)) {
    throw new TalentSignalHttpError(
      400,
      "person_merge_operation_invalid",
      "The merge operation identifier is invalid.",
      null,
    );
  }
  const { client } = await authenticatedClient(
    "web-person-merge-reversal",
  );
  const merge = await client.reversePersonMerge(operationId, request);
  return {
    ...merge,
    compilations: await compilePersonMergeContexts(client, merge),
  };
}

export async function loadPersonMergeReversalPreview(
  operationId: string,
): Promise<PersonMergeReversalPreview> {
  if (!UUID.test(operationId)) {
    throw new TalentSignalHttpError(
      400,
      "person_merge_operation_invalid",
      "The merge operation identifier is invalid.",
      null,
    );
  }
  const { client } = await authenticatedClient(
    "web-person-merge-reversal-preview",
  );
  return client.getPersonMergeReversalPreview(operationId);
}

export async function loadRelationshipAgentHistory(
  personId: string,
  relationshipContextId: string,
): Promise<RelationshipAgentHistory> {
  const { client } = await authenticatedClient(
    "web-relationship-agent-history",
  );
  return client.getRelationshipAgentHistory(
    personId,
    relationshipContextId,
  );
}

export async function loadRelationshipWiki(
  personId: string,
  relationshipContextId: string,
): Promise<KnowledgeSnapshot> {
  const { client } = await authenticatedClient(
    "web-relationship-wiki",
  );
  return client.getKnowledge(personId, relationshipContextId);
}

export async function loadRelationshipResources(
  personId: string,
  relationshipContextId: string,
): Promise<RelationshipResourceListResponse> {
  const { client } = await authenticatedClient(
    "web-relationship-resources",
  );
  return client.listRelationshipResources(
    personId,
    relationshipContextId,
  );
}

export async function loadRelationshipResource(
  resourceId: string,
): Promise<RelationshipResourceDetail> {
  const { client } = await authenticatedClient(
    "web-relationship-resource-detail",
  );
  return client.getRelationshipResource(resourceId);
}

export async function reviewRelationshipEvidence(
  fragmentId: string,
  request: EvidenceFragmentReviewRequest,
): Promise<EvidenceFragmentReviewResponse> {
  const { client } = await authenticatedClient(
    "web-evidence-fragment-review",
  );
  return client.reviewEvidenceFragment(fragmentId, request);
}

export type RunRelationshipResearchInput = {
  request_id: string;
  person_id: string;
  relationship_context_id: string;
  seed_resource_id: string;
  expected_seed_url: string;
  allowed_domain: string;
  maximum_page_count: number;
  maximum_link_depth: number;
};

export async function runRelationshipResearch(
  input: RunRelationshipResearchInput,
): Promise<PublicResearchResponse> {
  let expectedUrl: URL;
  try {
    expectedUrl = new URL(input.expected_seed_url);
  } catch {
    throw new Error("公开研究的种子 URL 无效。");
  }
  if (
    !UUID.test(input.request_id) ||
    !UUID.test(input.person_id) ||
    !UUID.test(input.relationship_context_id) ||
    !UUID.test(input.seed_resource_id) ||
    expectedUrl.protocol !== "https:" ||
    expectedUrl.hostname.toLowerCase() !==
      input.allowed_domain.trim().toLowerCase() ||
    !Number.isInteger(input.maximum_page_count) ||
    input.maximum_page_count < 1 ||
    input.maximum_page_count > 5 ||
    !Number.isInteger(input.maximum_link_depth) ||
    input.maximum_link_depth < 0 ||
    input.maximum_link_depth > 1
  ) {
    throw new Error("已批准的公开研究范围不完整。");
  }
  const { client } = await authenticatedClient(
    "web-public-research",
  );
  return client.runPublicResearch({
    idempotency_key: `web-research:${input.request_id}`,
    person_id: input.person_id,
    relationship_context_id: input.relationship_context_id,
    seed_resource_id: input.seed_resource_id,
    purpose:
      "Retrieve a bounded public page snapshot for recruiter review in the selected relationship context",
    expected_seed_url: expectedUrl.toString(),
    authorization: {
      decision: "approve_public_research",
      allowed_domain: input.allowed_domain.trim().toLowerCase(),
      maximum_page_count: input.maximum_page_count,
      maximum_link_depth: input.maximum_link_depth,
    },
  });
}

export async function getLatestRelationshipResearch(
  seedResourceId: string,
): Promise<PublicResearchResponse | null> {
  if (!UUID.test(seedResourceId)) {
    throw new Error("公开研究的种子来源无效。");
  }
  const { client } = await authenticatedClient(
    "web-public-research-status",
  );
  return client.getLatestPublicResearchTask(seedResourceId);
}

export type AskRelationshipChatInput = {
  time_zone?: string;
  previous_task_id?: string;
  request_id: string;
  person_id: string;
  relationship_context_id: string;
  objective: string;
  telemetry?: TelemetryContext;
};

export type CompileRelationshipKnowledgeInput = {
  request_id: string;
  person_id: string;
  relationship_context_id: string;
};

export const RELATIONSHIP_WIKI_COMPILE_OBJECTIVE =
  "Compile the current relationship Wiki from the exact governed sources that remain authorized. Keep confirmed facts, unresolved evidence, and any supported next action or no-action result separate.";

export async function compileRelationshipKnowledge(
  input: CompileRelationshipKnowledgeInput,
): Promise<KnowledgeSnapshot> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.request_id,
    ) ||
    !UUID.test(input.person_id) ||
    !UUID.test(input.relationship_context_id)
  ) {
    throw new TalentSignalHttpError(
      400,
      "wiki_compile_request_invalid",
      "关系 Wiki 编译范围不完整。",
      null,
    );
  }
  const { client } = await authenticatedClient("web-relationship-wiki");
  return client.compileKnowledge(
    input.person_id,
    input.relationship_context_id,
    {
      idempotency_key: `web-wiki:${input.request_id}`,
      objective: RELATIONSHIP_WIKI_COMPILE_OBJECTIVE,
    },
  );
}

export async function askRelationshipChat(
  input: AskRelationshipChatInput,
): Promise<ChatTaskResponse> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.request_id,
    ) ||
    !/^[0-9a-f-]{36}$/i.test(input.person_id) ||
    !/^[0-9a-f-]{36}$/i.test(input.relationship_context_id) ||
    input.objective.trim().length === 0 ||
    input.objective.length > 1_000
  ) {
    throw new Error("聊天任务范围不完整。");
  }
  const objective = input.objective.trim();
  const { client } = await authenticatedClient("web-relationship-chat");
  client.setClientPlatform("web");
  await client.compileKnowledge(
    input.person_id,
    input.relationship_context_id,
    {
      idempotency_key: `web-wiki:${input.request_id}`,
      objective,
    },
  );
  // A real, owner-authorized relationship Session and stable message ID, not a
  // manually preinserted completed turn. The Memory source can only become
  // actionable after this turn is actually persisted below.
  const sessionId = deterministicSessionId(
    `${input.person_id}:${input.relationship_context_id}:${input.request_id}`,
  );
  const messageId = input.request_id;
  const now = new Date().toISOString();
  let existingTurns: Array<{ id: string }> = [];
  let sessionExists = false;
  try {
    const existing = await client.getAgentSession(sessionId);
    if (existing.session.payload) {
      if (existing.session.payload.scopeKind !== "relationship") {
        throw new TalentSignalHttpError(
          409,
          "relationship_session_unavailable",
          "这段关系对话已不可用，请重新打开关系工作台。",
          null,
        );
      }
      existingTurns = existing.session.payload.turns;
      sessionExists = true;
    }
  } catch (error) {
    if (!(error instanceof TalentSignalHttpError) || error.status !== 404) {
      throw error;
    }
  }
  if (!sessionExists) {
    try {
      await client.saveAgentSession(sessionId, {
        expected_revision: 0,
        idempotency_key: sessionId,
        payload: {
          id: sessionId,
          scopeKind: "relationship",
          personID: input.person_id,
          relationshipContextID: input.relationship_context_id,
          personDisplayLabel: "",
          contextDisplayLabel: "",
          title: objective.slice(0, 120) || "关系对话",
          turns: [],
          updatedAt: now,
          isUnread: false,
        },
      });
    } catch (error) {
      // Another tab may have created the same deterministic Session first.
      if (!(error instanceof TalentSignalHttpError) || error.status !== 409) {
        throw error;
      }
    }
  }
  const response = await client.createChatTask({
    idempotency_key: `web-chat:${input.request_id}`,
    session_id: sessionId,
    message_id: messageId,
    ...(input.previous_task_id
      ? { previous_task_id: input.previous_task_id }
      : {}),
    objective,
    ...(input.time_zone ? { time_zone: input.time_zone } : {}),
    person_id: input.person_id,
    relationship_context_id: input.relationship_context_id,
    ...(input.telemetry ? { telemetry: input.telemetry } : {}),
  });
  if (!existingTurns.some((turn) => turn.id.toLowerCase() === messageId.toLowerCase())) {
    // The answer is already authoritative; persistence is the precondition for
    // rendering an actionable Memory reference. A failure is reported truthfully
    // so the client retries the same idempotent request.
    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
      try {
        const current = await client.getAgentSession(sessionId);
        const payload = current.session.payload;
        if (!payload) throw new Error("relationship session payload missing");
        if (payload.turns.some((turn) => turn.id.toLowerCase() === messageId.toLowerCase())) {
          saved = true;
          break;
        }
        await client.saveAgentSession(sessionId, {
          expected_revision: current.session.revision,
          idempotency_key: messageId,
          payload: {
            ...payload,
            ...(payload.turns.length === 0 && response.session_title
              ? { title: response.session_title.slice(0, 256) }
              : {}),
            updatedAt: response.created_at,
            turns: [
              ...payload.turns,
              {
                id: messageId,
                objective,
                createdAt: now,
                response: {
                  contractVersion: CONTRACT_VERSION,
                  taskID: response.task_id,
                  contextManifestID: response.context_manifest_id,
                  knowledgeSnapshotID: response.knowledge_snapshot_id,
                  disposition: response.disposition,
                  createdAt: response.created_at,
                  unboundConversationBlocks: response.blocks.slice(0, 32).map((block) => ({
                    id: block.id,
                    kind: block.kind,
                    title: block.title,
                    body: block.body,
                    status: block.status,
                    citation_dependency_ids: [],
                    requires_user_decision: false as const,
                    allows_static_share: false,
                    target_ref: null,
                  })),
                  ...(response.memory_proposal
                    ? {
                        memoryProposal: {
                          proposal_id: response.memory_proposal.proposal_id,
                          revision: response.memory_proposal.revision,
                        },
                      }
                    : {}),
                },
              },
            ],
          },
        });
        saved = true;
      } catch (error) {
        if (
          attempt < 2 &&
          error instanceof TalentSignalHttpError &&
          error.status === 409
        ) {
          continue;
        }
        if (!saved) {
          throw new TalentSignalHttpError(
            503,
            "relationship_answer_persist_failed",
            "回复已生成，但保存到关系对话失败。请重试同一条消息。",
            null,
          );
        }
      }
    }
    if (!saved) {
      throw new TalentSignalHttpError(
        503,
        "relationship_answer_persist_failed",
        "回复已生成，但保存到关系对话失败。请重试同一条消息。",
        null,
      );
    }
  }
  return response;
}

export async function transcribeRelationshipVoice(input: {
  audio_base64: string;
  client_request_id: string;
  mime_type: "audio/wav";
}): Promise<VoiceTranscriptionDraft> {
  if (
    !UUID.test(input.client_request_id) ||
    input.mime_type !== "audio/wav" ||
    input.audio_base64.length < 60 ||
    input.audio_base64.length > 3_333_336 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.audio_base64)
  ) {
    throw new Error("临时语音录音无效。");
  }
  const { client } = await authenticatedClient("web-relationship-voice");
  const draft = await client.transcribeVoice(input);
  if (
    draft.client_request_id !== input.client_request_id ||
    draft.provider !== "doubao" ||
    draft.status !== "draft" ||
    draft.temporary_audio_stored_by_talent_signal !== false ||
    !draft.transcript.trim()
  ) {
    throw new Error("语音转写返回了无效草稿。");
  }
  return draft;
}

export async function decideBackendAssertion(
  assertionId: string,
  request: AssertionDecisionRequest,
  captureId?: string,
): Promise<WorkspaceReviewResponse> {
  const { client } = await authenticatedClient("web-fact-review");
  await client.decideAssertion(assertionId, request);
  return readWorkspace(client, captureId);
}

export async function decideRelationshipClaim(
  assertionId: string,
  request: AssertionDecisionRequest,
): Promise<AssertionDecisionResponse> {
  const { client } = await authenticatedClient(
    "web-relationship-claim-review",
  );
  return client.decideAssertion(assertionId, request);
}

export async function correctRelationshipResourceIdentity(
  captureId: string,
  request: CaptureIdentityCorrectionRequest,
): Promise<
  CaptureIdentityCorrectionResponse & {
    prior_compilation: KnowledgeSnapshot | null;
    prior_compilation_error: string | null;
    target_compilation: KnowledgeSnapshot | null;
    target_compilation_error: string | null;
  }
> {
  const { client } = await authenticatedClient(
    "web-relationship-identity-correction",
  );
  const correction = await client.correctCaptureIdentity(
    captureId,
    request,
  );
  let targetCompilation: KnowledgeSnapshot | null = null;
  let targetCompilationError: string | null = null;
  try {
    targetCompilation = await client.compileKnowledge(
      correction.person_id,
      correction.relationship_context_id,
      {
        idempotency_key: `identity-correction:${correction.decision_id}:target`,
        objective:
          "Recompile the corrected relationship after the recruiter moved governed source lineage",
      },
    );
  } catch (caught) {
    targetCompilationError =
      caught instanceof Error
        ? caught.message
        : "无法重新编译更正后的关系 Wiki。";
  }

  const scopeChanged =
    correction.prior_person_id !== correction.person_id ||
    correction.prior_relationship_context_id !==
      correction.relationship_context_id;
  let priorCompilation: KnowledgeSnapshot | null = null;
  let priorCompilationError: string | null = null;
  if (scopeChanged) {
    try {
      priorCompilation = await client.compileKnowledge(
        correction.prior_person_id,
        correction.prior_relationship_context_id,
        {
          idempotency_key: `identity-correction:${correction.decision_id}:prior`,
          objective:
            "Recompile the prior relationship after governed source lineage moved away",
        },
      );
    } catch (caught) {
      priorCompilationError =
        caught instanceof Error
          ? caught.message
          : "无法重新编译此前的关系 Wiki。";
    }
  }

  return {
    ...correction,
    prior_compilation: priorCompilation,
    prior_compilation_error: priorCompilationError,
    target_compilation: targetCompilation,
    target_compilation_error: targetCompilationError,
  };
}

export async function decideRelationshipSourceAuthorization(
  captureId: string,
  request: SourceAuthorizationDecisionRequest,
): Promise<SourceAuthorizationDecisionResponse> {
  const { client } = await authenticatedClient(
    "web-source-authorization",
  );
  return client.decideCaptureSourceAuthorization(captureId, request);
}

export async function approveBackendAction(
  actionId: string,
  captureId?: string,
): Promise<WorkspaceReviewResponse> {
  const { client } = await authenticatedClient("web-action-approval");
  const workspace = await readWorkspace(client, captureId);
  const action = workspace.analysis.action;
  if (!action || action.id !== actionId) {
    throw new Error("未找到当前合成行动提案。");
  }
  await client.approveAction(action.id, {
    idempotency_key: `web-approve:${action.id}:v${action.version}`,
    expected_action_version: action.version,
    exact_preview: action.exact_preview,
  });
  return readWorkspace(client, captureId);
}

export async function executeBackendAction(
  actionId: string,
  captureId?: string,
): Promise<{
  effect: EffectResultResponse;
  workspace: WorkspaceReviewResponse;
}> {
  const { client } = await authenticatedClient("web-action-execution");
  const workspace = await readWorkspace(client, captureId);
  const action = workspace.analysis.action;
  const approval = workspace.latest_approval;
  if (
    !action ||
    action.id !== actionId ||
    !approval ||
    approval.status !== "active"
  ) {
    throw new Error("执行前需要一项当前有效的准确批准。");
  }
  const effect = await client.executeAction(action.id, {
    idempotency_key: `web-execute:${action.id}:v${action.version}`,
    approval_id: approval.id,
    expected_action_version: action.version,
  });
  return {
    effect,
    workspace: await readWorkspace(client, captureId),
  };
}

export async function reconcileBackendEffect(
  attemptId: string,
  captureId?: string,
): Promise<{
  effect: EffectResultResponse;
  workspace: WorkspaceReviewResponse;
}> {
  const { client } = await authenticatedClient("web-effect-reconciliation");
  const effect = await client.reconcileEffect(attemptId, {
    idempotency_key: `web-reconcile:${attemptId}`,
  });
  return {
    effect,
    workspace: await readWorkspace(client, captureId),
  };
}

export async function previewBackendEffectReversal(
  attemptId: string,
): Promise<EffectReversalPreview> {
  const { client } = await authenticatedClient("web-effect-reversal-preview");
  return client.previewEffectReversal(attemptId);
}

export async function approveBackendEffectReversal(
  attemptId: string,
  request: {
    expected_destination_version: number;
    expected_preview_digest: string;
    reason: string;
    request_id: string;
  },
  captureId?: string,
): Promise<WorkspaceReviewResponse> {
  const { client } = await authenticatedClient("web-effect-reversal-approval");
  await client.approveEffectReversal(attemptId, {
    idempotency_key: `web-reversal-approve:${request.request_id}`,
    expected_destination_version: request.expected_destination_version,
    expected_preview_digest: request.expected_preview_digest,
    reason: request.reason,
  });
  return readWorkspace(client, captureId);
}

export async function executeBackendEffectReversal(
  attemptId: string,
  approvalId: string,
  captureId?: string,
): Promise<WorkspaceReviewResponse> {
  const { client } = await authenticatedClient("web-effect-reversal-execution");
  await client.executeEffectReversal(attemptId, {
    idempotency_key: `web-reversal-execute:${attemptId}:${approvalId}`,
    approval_id: approvalId,
  });
  return readWorkspace(client, captureId);
}

export async function revokeBackendEffectReversalApproval(
  approvalId: string,
  captureId?: string,
): Promise<WorkspaceReviewResponse> {
  const { client } = await authenticatedClient("web-effect-reversal-revocation");
  await client.revokeEffectReversalApproval(approvalId, {
    idempotency_key: `web-reversal-revoke:${approvalId}`,
    reason: "Recruiter cancelled the exact local effect reversal approval.",
  });
  return readWorkspace(client, captureId);
}

export async function revokeBackendApproval(
  approvalId: string,
  captureId?: string,
): Promise<WorkspaceReviewResponse> {
  const { client } = await authenticatedClient("web-approval-revocation");
  await client.revokeApproval(approvalId, {
    idempotency_key: `web-revoke-approval:${approvalId}`,
    reason: "Recruiter cancelled the synthetic local effect approval.",
  });
  return readWorkspace(client, captureId);
}

export async function revokeBackendCapability(): Promise<{
  capability: string;
  status: "revoked";
}> {
  const { client } = await authenticatedClient("web-capability-revocation");
  return client.revokeCapability({
    idempotency_key: "web-revoke:local-simulated-attention",
    capability: SIMULATED_CAPABILITY,
    reason: "Round-2 Web recovery proof before local effect execution.",
  });
}

export type IntegrationRevisionVariant =
  | "stale_approval"
  | "timeout_after_effect";

function revisedPreview(
  current: SimulatedEffectPreview,
  variant: IntegrationRevisionVariant,
): SimulatedEffectPreview {
  if (variant === "timeout_after_effect") {
    return {
      ...current,
      simulation_behavior: "timeout_after_write",
    };
  }
  return {
    ...current,
    change: {
      ...current.change,
      title: `${current.change.title} — revised`,
    },
  };
}

export async function reviseBackendActionForEvaluation(
  actionId: string,
  variant: IntegrationRevisionVariant,
  captureId?: string,
): Promise<WorkspaceReviewResponse> {
  const { client } = await authenticatedClient("web-action-revision");
  const workspace = await readWorkspace(client, captureId);
  const action = workspace.analysis.action;
  if (!action || action.id !== actionId) {
    throw new Error("未找到当前合成行动提案。");
  }
  await client.reviseAction(action.id, {
    idempotency_key: `web-revise:${action.id}:v${action.version}:${variant}`,
    expected_action_version: action.version,
    exact_preview: revisedPreview(action.exact_preview, variant),
    reason:
      variant === "timeout_after_effect"
        ? "Exercise truthful unknown-result reconciliation."
        : "Exercise stale approval after an exact preview change.",
  });
  return readWorkspace(client, captureId);
}

export type CommitScreenshotCaptureInput = {
  request_id: string;
  person_id?: string | null;
  relationship_context_id?: string | null;
  contact_name: string;
  identity_query?: string | null;
  assignment_label: string;
  draft: ScreenshotCaptureDraft;
  original_draft?: ScreenshotCaptureDraft;
  analysis_meta: ScreenshotAnalysisMeta;
  analysis_receipt: string;
};

export async function commitScreenshotCapture(
  input: CommitScreenshotCaptureInput,
): Promise<WorkspaceReviewResponse> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.request_id,
    ) ||
    input.contact_name.trim().length === 0 ||
    input.contact_name.length > 160 ||
    input.assignment_label.trim().length === 0 ||
    input.assignment_label.length > 200
  ) {
    throw new Error("已审阅的截图采集信息不完整。");
  }
  const submittedDraft = validateScreenshotCaptureDraft(input.draft);
  const receiptDraft = input.original_draft
    ? validateScreenshotCaptureDraft(input.original_draft)
    : submittedDraft;
  const analysisMeta = validateScreenshotAnalysisMeta(input.analysis_meta);
  if (
    typeof input.analysis_receipt !== "string" ||
    input.analysis_receipt.length > 2_000 ||
    !verifyScreenshotAnalysisReceipt(input.analysis_receipt, {
      draft: receiptDraft,
      meta: analysisMeta,
    })
  ) {
    throw new Error(
      "The screenshot analysis receipt is missing, expired, or does not match this draft.",
    );
  }
  const humanEdited = Boolean(input.original_draft);
  const draft = humanEdited
    ? validateReviewedScreenshotEdit(receiptDraft, submittedDraft)
    : submittedDraft;
  const contactName = input.contact_name.trim();
  const identityQuery = input.identity_query?.trim() || contactName;
  const assignmentLabel = input.assignment_label.trim();
  const personId = input.person_id?.trim() || null;
  const relationshipContextId =
    input.relationship_context_id?.trim() || null;
  if (
    personId !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      personId,
    )
  ) {
    throw new Error("所选人物身份无效。");
  }
  if (
    relationshipContextId !== null &&
    (!personId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        relationshipContextId,
      ))
  ) {
    throw new Error("所选关系背景无效。");
  }
  const newPersonRef = `web-person:${stableRef(`new\n${input.request_id}`)}`;
  const personBindingRef = personId ?? newPersonRef;
  const assignmentKey = stableRef(
    `${personBindingRef}\n${assignmentLabel.normalize("NFKC").toLowerCase()}`,
  );
  const { client } = await authenticatedClient("web-screenshot-capture");
  const identityCandidates = await client.searchPeople(identityQuery);
  const identityChoiceIssue = screenshotIdentityChoiceIssue(
    identityCandidates.people,
    personId,
  );
  if (identityChoiceIssue) {
    throw new Error(
      identityChoiceIssue === "selected_person_not_in_candidates"
        ? "所选人物不在当前身份线索的候选范围内。未保存来源；请重新搜索并确认身份。"
        : "当前身份线索对应多个无法区分的人物。未保存来源；请先补充可核对线索或完成重复身份审阅。",
    );
  }
  const capture = await client.createCapture({
    idempotency_key: `web-screenshot:${input.request_id}`,
    source: {
      kind: "screenshot_metadata",
      channel: "web_upload",
      captured_at: new Date().toISOString(),
      source_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      purpose:
        `${humanEdited ? "Recruiter-edited" : "Recruiter-reviewed"} ${draft.platform} conversation screenshot transcription for relationship context`,
      source_locator: [
        `sha256:${analysisMeta.source_sha256}`,
        `provider:${analysisMeta.provider}`,
        `request:${analysisMeta.request_id ?? "not-returned"}`,
        ...(analysisMeta.pre_provider_minimization
          ? [
              `browser-crop:${analysisMeta.pre_provider_minimization.crop_top_percent}-${analysisMeta.pre_provider_minimization.crop_bottom_percent}`,
              `browser-redactions:${analysisMeta.pre_provider_minimization.redaction_count}`,
            ]
          : []),
      ].join(";"),
      retention: {
        requested_mode: "evidence_crop",
        source_scope: "reviewed_extracted_text",
      },
    },
    identity: personId
      ? {
          status: "bound_existing",
          subject_id: personId,
          ...(relationshipContextId
            ? { assignment_id: relationshipContextId }
            : {}),
          assignment_ref: `web-assignment:${assignmentKey}`,
          assignment_label: assignmentLabel,
          binding_basis:
            "The signed-in recruiter explicitly selected this existing person before committing the reviewed capture.",
        }
      : {
          status: "bound",
          external_ref: newPersonRef,
          display_label: contactName,
          assignment_ref: `web-assignment:${assignmentKey}`,
          assignment_label: assignmentLabel,
          binding_basis:
            "The signed-in recruiter explicitly confirmed creation of a new person before committing the reviewed capture.",
        },
    messages: draft.messages,
  });
  const messageById = new Map(
    draft.messages.map((message) => [message.source_message_id, message]),
  );
  await client.submitAnalysis(capture.id, {
    idempotency_key: `web-screenshot-analysis:${input.request_id}`,
    producer: {
      kind: humanEdited ? "human_draft" : "model",
      name: humanEdited
        ? `Recruiter-reviewed transcription · ${analysisMeta.provider}`.slice(
            0,
            120,
          )
        : `${analysisMeta.provider} · ${analysisMeta.model}`.slice(0, 120),
      version: [
        draft.schema_version,
        analysisMeta.prompt_version,
        humanEdited ? "human-transcription-edit" : "model-draft",
        analysisMeta.request_id ?? "request-id-not-returned",
      ]
        .join(":")
        .slice(0, 120),
    },
    disposition: draft.disposition,
    assertions: draft.assertions.map((assertion) => ({
      field: assertion.field,
      status: assertion.status,
      value: assertion.value,
      evidence_message_id: assertion.evidence_message_id,
      evidence_quote: assertion.evidence_quote,
      subject_kind:
        messageById.get(assertion.evidence_message_id)?.speaker ===
        "candidate"
          ? "candidate"
          : "unknown",
      temporal_relation: "new",
    })),
    action: draft.action
      ? {
          type: "prepare_question",
          owner: "recruiter",
          target: draft.action.target,
          reason: draft.action.reason,
          due: draft.action.due,
          evidence_message_ids: draft.action.evidence_message_ids,
          effect_preview: {
            simulated: true,
            capability: SIMULATED_CAPABILITY,
            adapter: "local_deterministic",
            target: {
              destination_key: `assignment:${assignmentKey}:attention`,
              label: `${contactName} · recruiter attention queue`,
            },
            change: {
              kind: "create_attention",
              title: `Prepare question: ${draft.action.target}`,
            },
            expected_destination_version: 0,
            simulation_behavior: "success",
          },
        }
      : null,
  });
  return client.getWorkspaceReviewByCapture(capture.id);
}

export async function deleteBackendCapture(
  captureId: string,
): Promise<{
  deletion: DeleteCaptureResponse;
  lineage: DeletionLineageResponse;
  compilation: KnowledgeSnapshot | null;
  compilation_error: string | null;
}> {
  const { client } = await authenticatedClient("web-source-deletion");
  const capture = await client.getCapture(captureId);
  const deletion = await client.deleteCapture(captureId, {
    idempotency_key: `web-delete:${captureId}`,
    reason: "Recruiter requested deletion of the synthetic local source.",
  });
  const lineage = await client.getDeletionLineage(deletion.deletion_id);
  if (!capture.subject_id || !capture.assignment_id) {
    return {
      deletion,
      lineage,
      compilation: null,
      compilation_error: null,
    };
  }

  try {
    const compilation = await client.compileKnowledge(
      capture.subject_id,
      capture.assignment_id,
      {
        idempotency_key: `source-deletion:${deletion.deletion_id}:relationship`,
        objective:
          "Recompile the relationship from the governed sources that remain after recruiter-requested deletion",
      },
    );
    return {
      deletion,
      lineage,
      compilation,
      compilation_error: null,
    };
  } catch (caught) {
    return {
      deletion,
      lineage,
      compilation: null,
      compilation_error:
        caught instanceof TalentSignalHttpError &&
        caught.code === "RELATIONSHIP_CONTEXT_NOT_FOUND"
          ? null
          : caught instanceof Error
            ? caught.message
            : "来源已删除，但无法重新编译剩余的关系 Wiki。",
    };
  }
}
