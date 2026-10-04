export const PURSUIT_AGENT_TOOL_NAMES = [
  "read_pursuit",
  "read_evidence",
  "stage_pursuit_proposal",
] as const;

export const RESEARCH_AGENT_TOOL_NAMES = [
  "search_web",
  "fetch_web",
  "create_research_artifact",
] as const;

export const PERSON_RESEARCH_AGENT_TOOL_NAMES = [
  "search_douyin_profiles",
  "search_tiktok_profiles",
  "search_weibo_profiles",
  "search_threads_profiles",
  "create_person_research_artifact",
] as const;

export const WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES = [
  "contact_workspace",
  "memory_review",
  "mcp_connections",
] as const;

export const ALL_AGENT_TOOL_NAMES = [
  ...PURSUIT_AGENT_TOOL_NAMES,
  "search_web",
  "fetch_web",
  "create_research_artifact",
  ...PERSON_RESEARCH_AGENT_TOOL_NAMES,
  ...WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES,
] as const;

// Backwards-compatible name for the original bounded Pursuit definition.
export const AGENT_TOOL_NAMES = PURSUIT_AGENT_TOOL_NAMES;

export type AgentToolName = (typeof ALL_AGENT_TOOL_NAMES)[number];

export type AgentRunStatus =
  | "proposal_staged"
  | "no_action"
  | "quarantined"
  | "budget_exhausted"
  | "cancelled"
  | "failed";

export interface AgentBudget {
  maxTurns: number;
  maxToolCalls: number;
  maxDurationMs: number;
  maxTaskTokens: number;
  maxEstimatedUsd: number;
}

export interface AgentDefinition {
  name: string;
  version: string;
  systemPrompt: string;
  policyVersion: string;
  contractVersion: string;
  toolManifest: readonly AgentToolName[];
}

export interface AgentEvidenceManifestItem {
  fragmentID: string;
  contentHash: string;
  inclusionReason: string;
  authorizationScope: string;
}

export interface AgentInputArtifactManifestItem {
  artifactID: string;
  kind: "text" | "image";
  mimeType: string;
  byteSize: number;
  contentHash: string;
}

export type AgentProviderInputPart =
  | (AgentInputArtifactManifestItem & {
      kind: "text";
      text: string;
    })
  | (AgentInputArtifactManifestItem & {
      kind: "image";
      dataBase64: string;
    });

export interface AgentProviderInputCapabilities {
  text: boolean;
  image: boolean;
  imageUnderstanding: boolean;
  /** True only for providers that consume `steering` input mid-Run. */
  steering?: boolean;
}

export interface AgentRunScope {
  runID: string;
  workspaceID: string;
  userID: string;
  pursuitID: string;
  pursuitRevision: number;
  captureID: string;
  objective: string;
  evidenceManifest: readonly AgentEvidenceManifestItem[];
  inputArtifactManifest?: readonly AgentInputArtifactManifestItem[];
}

export interface AgentWebResearchAuthorization {
  purpose: "company_market_research";
  subjectKind: "company" | "market";
  accessMode: "domain_allowlist" | "open_web";
  allowedDomains: readonly string[];
  queryAnchors: readonly string[];
  maximumSearchCount: number;
  maximumFetchCount: number;
}

export interface AgentPublicResearchScope {
  runID: string;
  objective: string;
  providerID: string;
  authorization: AgentWebResearchAuthorization;
}

export type AgentPersonResearchPlatform =
  | "douyin"
  | "tiktok"
  | "weibo"
  | "threads";

export interface AgentPersonResearchAuthorization {
  purpose: "person_public_profile_research";
  accessMode: "visible_screenshot_identity_clues";
  allowedPlatforms: readonly AgentPersonResearchPlatform[];
  maximumProviderCalls: number;
  maximumResultsPerCall: number;
}

export interface AgentPersonResearchScope {
  runID: string;
  objective: string;
  providerID: string;
  authorization: AgentPersonResearchAuthorization;
  inputArtifactManifest: readonly AgentInputArtifactManifestItem[];
}

export interface AgentPublicProfileResult {
  resultID: string;
  platform: AgentPersonResearchPlatform;
  providerID: string;
  providerRequestID: string | null;
  profileID: string;
  displayName: string;
  handle: string | null;
  biography: string | null;
  profileUrl: string;
  avatarUrl: string | null;
  verified: boolean | null;
  contentHash: string;
  retrievedAt: string;
}

export interface AgentPersonResearchArtifactCandidate {
  title: string;
  summary: string;
  limitations: string;
  identityStatus: "possible_match" | "ambiguous";
  observedClues: Array<{
    kind: "display_name" | "handle" | "profile_url" | "platform";
    value: string;
    sourceArtifactID: string;
    observationStatus: "unreviewed_screenshot_observation";
  }>;
  candidates: Array<{
    resultID: string;
    matchBasis: string;
  }>;
  claims: Array<{
    statement: string;
    epistemicStatus: "provider_observation" | "agent_inference";
    sourceRefs: string[];
  }>;
  sources: Array<{
    resultID: string;
    platform: AgentPersonResearchPlatform;
    profileUrl: string;
    displayName: string;
    handle: string | null;
    biography: string | null;
    avatarUrl: string | null;
    verified: boolean | null;
    contentHash: string;
    retrievedAt: string;
    providerID: string;
    providerRequestID: string | null;
  }>;
}

export interface AgentPersonResearchNoActionCandidate {
  reasonCode:
    | "NO_VISIBLE_IDENTITY_CLUE"
    | "AMBIGUOUS_IDENTITY_CLUE"
    | "NO_PUBLIC_PROFILE_MATCH"
    | "UNTRUSTED_INSTRUCTION"
    | "PROHIBITED_PERSON_ASSESSMENT"
    | "PERSON_RESEARCH_UNAVAILABLE";
  reason: string;
}

export interface AgentWebSearchResult {
  resultID: string;
  url: string;
  title: string;
  snippet: string;
  publishedAt: string | null;
  providerID: string;
}

export interface AgentFetchedWebPage {
  resultID: string;
  canonicalUrl: string;
  title: string;
  text: string;
  contentHash: string;
  retrievedAt: string;
  providerID: string;
}

export interface AgentResearchArtifactCandidate {
  title: string;
  summary: string;
  limitations: string;
  claims: Array<{
    statement: string;
    sourceRefs: string[];
  }>;
  sources: Array<{
    resultID: string;
    url: string;
    title: string;
    contentHash: string;
    retrievedAt: string;
  }>;
}

export interface AgentEvidence {
  fragmentID: string;
  text: string;
  observedAt: string;
  sourceDisplayName: string;
  attributionStatus: "confirmed";
  reviewStatus: "reviewed";
  availability: "available";
  contentHash: string;
}

export interface AgentPursuitSnapshot {
  workspaceID: string;
  pursuitID: string;
  revision: number;
  title: string;
  status: string;
  milestone: string;
  roles: readonly unknown[];
  gaps: readonly unknown[];
  actions: readonly unknown[];
}

export interface AgentProposalCandidate {
  summary: string;
  items: Array<{
    itemKey: string;
    epistemicStatus: "fact" | "inference" | "unknown" | "disputed";
    evidenceRefs: string[];
    reason: string;
    effectSummary: string;
    change:
      | { kind: "set_milestone"; proposedValue: string }
      | {
          kind: "set_pursuit_status";
          proposedValue:
            | "draft"
            | "active"
            | "paused"
            | "succeeded"
            | "failed"
            | "cancelled";
        }
      | {
          kind: "set_role_status";
          roleID: string;
          proposedValue: "active" | "quiet" | "removed";
        }
      | {
          kind: "add_gap";
          proposedValue: {
            title: string;
            basisSummary: string;
            closeCondition: string;
          };
        }
      | {
          kind: "add_action";
          proposedValue: {
            title: string;
            ownerUserID: string;
            dueAt: string | null;
          };
        };
  }>;
}

export interface AgentNoActionCandidate {
  reasonCode:
    | "NO_MATERIAL_CHANGE"
    | "INSUFFICIENT_EVIDENCE"
    | "UNTRUSTED_INSTRUCTION"
    | "AMBIGUOUS_TIME"
    | "PROHIBITED_PERSON_ASSESSMENT"
    | "UNSUPPORTED_INPUT_CAPABILITY";
  reason: string;
  missingEvidenceRefs: string[];
}

export interface AgentPublicResearchNoActionCandidate {
  reasonCode:
    | "NO_MATERIAL_CHANGE"
    | "INSUFFICIENT_EVIDENCE"
    | "UNTRUSTED_INSTRUCTION"
    | "PUBLIC_RESEARCH_UNAVAILABLE";
  reason: string;
  missingEvidenceRefs: string[];
}

export interface AgentFingerprints {
  definition: string;
  systemPrompt: string;
  toolManifest: string;
  sdk: string;
  model: string;
  policy: string;
  contract: string;
  context: string;
}

export interface AgentUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedUsd: number | null;
  turns: number | null;
  toolCalls: number;
  durationMs: number;
}

export interface AgentToolResult {
  ok: boolean;
  callID: string;
  name: string;
  data?: unknown;
  candidateFingerprint?: string;
  error?: { code: string; message: string };
}

/** Previous dialogue is working context, never evidence or tool authority. */
export interface ConversationMessage {
  message_id: string;
  role: "user" | "assistant";
  text: string;
}

/** Bounded, host-owned execution stages a provider may report to the product. */
export const AGENT_VISIBLE_PROGRESS_STAGES = [
  "contact_lookup",
  "contact_read",
  "calendar_draft",
  "answer",
] as const;

export type AgentVisibleProgressStage =
  (typeof AGENT_VISIBLE_PROGRESS_STAGES)[number];

export interface AgentProviderRequest {
  /** Host-owned optional tools, with closures limited to the current Run. */
  supplementalTools?: readonly import("./claudeHarness.js").HarnessTool[];
  calendarContext?: import("./calendarDraft.js").CalendarDraftContext;
  /** Trusted host source lineage for opt-in private observation; never model authority. */
  observation?: import("./runtimeObservation.js").RuntimeObservationContext;
  continuation?: import("./claudeHarnessContinuation.js").HarnessContinuationFactory;
  /** Host-only source admission captured before compiling private context. */
  assertCurrent?: () => Promise<void>;
  /**
   * Host-observed visible main-session text while the provider is still active.
   * A forming response only: never evidence, citation, or execution authority.
   */
  onVisibleText?: (text: string) => void;
  /** Host-observed bounded stage code. Never carries model input or tool arguments. */
  onProgress?: (stage: AgentVisibleProgressStage) => void;
  responsePreference?: import("./responsePreference.js").ResponsePreference;
  /** Original immutable message identity; preserved on the SDK input frame. */
  messageID?: string;
  /** GET-128 steering: dynamic input for messages accepted while this Run is live. */
  steering?: import("./claudeHarness.js").HarnessSteeringFeed;
  onToolCompletion?: (receipt: import("./claudeHarness.js").HarnessToolCompletion) => void;
  /** Host-compiled private L2; never included on relationship/business entry. */
  selfMemoryContext?: import("./memoryContext.js").SelfMemoryContext;
  runID: string;
  objective: string;
  /** Host-owned first-result gate for optional Session display metadata. */
  sessionTitleRequested?: boolean;
  conversationHistory?: readonly ConversationMessage[];
  systemPrompt: string;
  /** Host-only structured consumers must not receive conversational output guidance. */
  outputMode?: "natural" | "json";
  scopeSummary:
    | {
        kind: "pursuit";
        workspaceID: string;
        pursuitID: string;
        pursuitRevision: number;
        evidenceRefs: string[];
      }
    | {
        kind: "public_research";
        authorization: AgentWebResearchAuthorization;
        providerID: string;
      }
    | {
        kind: "person_public_profile_research";
        authorization: AgentPersonResearchAuthorization;
        providerID: string;
        inputArtifactIDs: string[];
      }
    | {
        kind: "workspace_conversation";
        workspaceID: string;
        sessionID: string | null;
        currentPersonID: string | null;
        currentRelationshipContextID: string | null;
      };
  toolManifest: readonly AgentToolName[];
  budget: AgentBudget;
  inputParts?: readonly AgentProviderInputPart[];
}

export interface AgentProviderResult {
  calendarDraft?: import("@talent-signal/contracts").CalendarDraft;
  /** First-turn display metadata only; never evidence or execution authority. */
  sessionTitle?: string;
  prompt?: import("./promptRegistry.js").PromptReference;
  structuredOutput: unknown;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  turns: number;
  permissionDenials: string[];
  /** Genuine tool-completion receipts: name and time only. */
  toolCompletions?: import("./claudeHarness.js").HarnessToolCompletion[];
  sessionID?: string;
  terminalReason?: string;
}

export interface AgentProvider {
  readonly id: string;
  readonly model: string;
  readonly sdkVersion: string;
  readonly inputCapabilities: AgentProviderInputCapabilities;
  run(
    request: AgentProviderRequest,
    invokeTool: (name: string, input: unknown, executionSignal?: AbortSignal) => Promise<AgentToolResult>,
    signal: AbortSignal,
  ): Promise<AgentProviderResult>;
}

export interface AgentCapabilityGateway {
  readPursuit(scope: AgentRunScope): Promise<AgentPursuitSnapshot>;
  readEvidence(
    scope: AgentRunScope,
    evidenceRefs: readonly string[],
  ): Promise<readonly AgentEvidence[]>;
  commitProposal(
    scope: AgentRunScope,
    candidate: AgentProposalCandidate,
    candidateFingerprint: string,
  ): Promise<{ proposalID: string; status: "needs_review"; replayed: boolean }>;
  commitNoAction(
    scope: AgentRunScope,
    candidate: AgentNoActionCandidate,
    candidateFingerprint: string,
  ): Promise<{ noActionID: string; replayed: boolean }>;
}

export interface AgentJournalStart {
  scope: AgentRunScope;
  budget: AgentBudget;
  providerID: string;
  model: string;
  sdkVersion: string;
  fingerprints: AgentFingerprints;
  startedAt: string;
}

export interface AgentJournalEvent {
  runID: string;
  sequence: number;
  kind: "tool_call" | "provider_result" | "terminal";
  occurredAt: string;
  toolName?: string;
  status: string;
  inputFingerprint?: string;
  outputFingerprint?: string;
  metadata: Record<string, unknown>;
}

export interface AgentJournalOutput {
  runID: string;
  status: "validated" | "quarantined";
  outputFingerprint: string;
  structuredOutput: unknown;
  recordedAt: string;
}

export interface AgentTerminalReceipt {
  runID: string;
  status: AgentRunStatus;
  reasonCode: string;
  proposalID: string | null;
  noActionID: string | null;
  candidateFingerprint: string | null;
  externalEffects: [];
  fingerprints: AgentFingerprints;
  usage: AgentUsage;
  permissionDenials: string[];
  providerSessionID: string | null;
  completedAt: string;
}

export interface AgentPublicResearchCheckpoint {
  searchResults: AgentWebSearchResult[];
  fetchedPages: AgentFetchedWebPage[];
  searchCalls: number;
  fetchCalls: number;
  toolCalls: number;
  sequence: number;
}

export interface AgentPublicResearchGateway {
  searchWeb(
    scope: AgentPublicResearchScope,
    input: { query: string; maximumResults: number; recencyDays: number | null },
    signal: AbortSignal,
  ): Promise<readonly Omit<AgentWebSearchResult, "resultID">[]>;
  fetchWeb(
    scope: AgentPublicResearchScope,
    result: AgentWebSearchResult,
    signal: AbortSignal,
  ): Promise<Omit<AgentFetchedWebPage, "resultID">>;
  commitResearchArtifact(
    scope: AgentPublicResearchScope,
    candidate: AgentResearchArtifactCandidate,
    candidateFingerprint: string,
  ): Promise<{ artifactID: string; status: "draft"; replayed: boolean }>;
  commitNoAction(
    scope: AgentPublicResearchScope,
    candidate: AgentPublicResearchNoActionCandidate,
    candidateFingerprint: string,
  ): Promise<{ noActionID: string; replayed: boolean }>;
}

export interface AgentPublicResearchJournal {
  start(input: {
    scope: AgentPublicResearchScope;
    budget: AgentBudget;
    modelProviderID: string;
    model: string;
    sdkVersion: string;
    startedAt: string;
  }): Promise<void>;
  loadCheckpoint(runID: string): Promise<AgentPublicResearchCheckpoint | null>;
  saveCheckpoint(
    runID: string,
    checkpoint: AgentPublicResearchCheckpoint,
  ): Promise<void>;
  append(event: AgentJournalEvent): Promise<void>;
  recordOutput(output: AgentJournalOutput): Promise<void>;
  complete(
    receipt: AgentPublicResearchTerminalReceipt,
  ): Promise<AgentPublicResearchTerminalReceipt>;
}

export interface AgentPublicResearchTerminalReceipt {
  runID: string;
  status:
    | "artifact_created"
    | "no_action"
    | "quarantined"
    | "budget_exhausted"
    | "cancelled"
    | "failed";
  reasonCode: string;
  artifactID: string | null;
  noActionID: string | null;
  candidateFingerprint: string | null;
  externalEffects: [];
  usage: AgentUsage;
  permissionDenials: string[];
  providerSessionID: string | null;
  completedAt: string;
}

export interface AgentPublicResearchRunRequest {
  scope: AgentPublicResearchScope;
  budget: AgentBudget;
  provider: AgentProvider;
  gateway: AgentPublicResearchGateway;
  journal: AgentPublicResearchJournal;
  runtime?: AgentRuntimeDependencies;
  signal?: AbortSignal;
}

export interface AgentPersonResearchCheckpoint {
  profileResults: AgentPublicProfileResult[];
  queryObservations: Array<{
    platform: AgentPersonResearchPlatform;
    query: string;
    sourceArtifactID: string;
    observationStatus: "unreviewed_screenshot_observation";
  }>;
  providerCalls: number;
  toolCalls: number;
  sequence: number;
}

export interface AgentPersonResearchGateway {
  searchProfiles(
    scope: AgentPersonResearchScope,
    input: {
      platform: AgentPersonResearchPlatform;
      query: string;
      maximumResults: number;
    },
    signal: AbortSignal,
  ): Promise<readonly Omit<AgentPublicProfileResult, "resultID">[]>;
  commitPersonResearchArtifact(
    scope: AgentPersonResearchScope,
    candidate: AgentPersonResearchArtifactCandidate,
    candidateFingerprint: string,
  ): Promise<{ artifactID: string; status: "draft"; replayed: boolean }>;
  commitNoAction(
    scope: AgentPersonResearchScope,
    candidate: AgentPersonResearchNoActionCandidate,
    candidateFingerprint: string,
  ): Promise<{ noActionID: string; replayed: boolean }>;
}

export interface AgentPersonResearchJournal {
  start(input: {
    scope: AgentPersonResearchScope;
    budget: AgentBudget;
    modelProviderID: string;
    model: string;
    sdkVersion: string;
    startedAt: string;
  }): Promise<void>;
  loadCheckpoint(runID: string): Promise<AgentPersonResearchCheckpoint | null>;
  saveCheckpoint(
    runID: string,
    checkpoint: AgentPersonResearchCheckpoint,
  ): Promise<void>;
  append(event: AgentJournalEvent): Promise<void>;
  recordOutput(output: AgentJournalOutput): Promise<void>;
  complete(
    receipt: AgentPersonResearchTerminalReceipt,
  ): Promise<AgentPersonResearchTerminalReceipt>;
}

export interface AgentPersonResearchTerminalReceipt {
  runID: string;
  status:
    | "artifact_created"
    | "no_action"
    | "quarantined"
    | "budget_exhausted"
    | "cancelled"
    | "failed";
  reasonCode: string;
  artifactID: string | null;
  noActionID: string | null;
  candidateFingerprint: string | null;
  externalEffects: [];
  usage: AgentUsage;
  permissionDenials: string[];
  providerSessionID: string | null;
  completedAt: string;
}

export interface AgentPersonResearchRunRequest {
  scope: AgentPersonResearchScope;
  budget: AgentBudget;
  provider: AgentProvider;
  gateway: AgentPersonResearchGateway;
  journal: AgentPersonResearchJournal;
  runtime?: AgentRuntimeDependencies;
  providerInputParts: readonly AgentProviderInputPart[];
  signal?: AbortSignal;
}

export interface AgentRunJournal {
  start(input: AgentJournalStart): Promise<void>;
  append(event: AgentJournalEvent): Promise<void>;
  recordOutput(output: AgentJournalOutput): Promise<void>;
  complete(receipt: AgentTerminalReceipt): Promise<AgentTerminalReceipt>;
}

export interface AgentRuntimeDependencies {
  nowMs(): number;
  randomUUID(): string;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AgentRunRequest {
  definition: AgentDefinition;
  scope: AgentRunScope;
  budget: AgentBudget;
  provider: AgentProvider;
  gateway: AgentCapabilityGateway;
  journal: AgentRunJournal;
  runtime?: AgentRuntimeDependencies;
  providerInputParts?: readonly AgentProviderInputPart[];
  signal?: AbortSignal;
}
