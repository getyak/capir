import type {
  CapirTestCapabilitiesResponse,
  CapirTestCreateRequest,
  CapirTestHandoffExchangeRequest,
  CapirTestHandoffExchangeResponse,
  CapirTestHandoffRequest,
  CapirTestHandoffResponse,
  CapirTestRun,
  CapirTestStopRequest,
} from "./capirTestSchemas.js";
import type { ProductRunDetail, ProductRunList, ProductRunFeedbackMutation } from "./productRunSchemas.js";
import type { TimeScope, TimeActivityListResponse, TimeScheduleMutationRequest, TimeScheduleDeleteRequest, TimeScheduleResponse, TimeReviewRequest, TimeReviewResponse } from "./timeWorkspaceSchemas.js";
import type { AccountSettings, AccountMutation, AccountOnboarding, AccountOnboardingMutation, AccountOnboardingPreview, AccountOnboardingPreviewRequest, CredentialChangeAttempt, CredentialChangeResult, CompleteCredentialChangeRequest, StartCredentialChangeRequest, PasswordRegistrationStartResponse, PasswordVerificationConfirmRequest, ReconciliationActionRequest, ReconciliationPrepareRequest, ReconciliationRecord } from "./accountSchemas.js";
import type {
  McpClientGrantCreateRequest,
  McpClientGrantCreateResponse,
  McpClientGrantListResponse,
  McpClientGrantResponse,
  McpClientGrantRevokeRequest,
  McpConnectionActionRequest,
  McpConnectionCreateRequest,
  McpConnectionListResponse,
  McpConnectionResponse,
  McpConnectionUpdateRequest,
  McpEndpointsResponse,
} from "./mcpSchemas.js";
import type { AgentSessionListResponse,AgentSessionResponse,AgentSessionMutationRequest,AgentSessionDeleteRequest } from "./agentSessionSchemas.js";
import type {
  ConversationQueueAdmitRequest,
  ConversationQueueAdmitResponse,
  ConversationQueueMutationRequest,
  ConversationQueueMutationResponse,
  ConversationQueueSnapshot,
} from "./conversationQueueSchemas.js";
import type { AgentPreferenceMutation, AgentPreferenceResponse } from "./agentPreferenceSchemas.js";
import type { MeetingDraftDismissRequest, MeetingDraftListResponse, MeetingDraftListScope, MeetingDraftResponse, MeetingDraftUpdateRequest } from "./meetingDraftSchemas.js";
import type { SystemHealthResponse } from "./systemHealthSchemas.js";
import type { WeeklyUsageResponse } from "./weeklyUsageSchemas.js";
import type {
  MemoryCommitRequest,
  MemoryCommitResponse,
  MemoryItemDecisionRequest,
  MemoryItemDecisionResponse,
  MemoryContactOnlyDecisionRequest,
  MemoryContactOnlyDecisionResponse,
  MemoryDismissRequest,
  MemoryDismissResponse,
  MemoryItemMutationRequest,
  MemoryItemMutationResponse,
  MemoryOperationReadback,
  MemoryOperationUndoRequest,
  MemoryOperationUndoResponse,
  MemoryOpenReviewRequest,
  MemoryProposalListResponse,
  MemoryProposalRebaseRequest,
  MemoryProposalRebaseResponse,
  MemoryProposalStageRequest,
  MemoryPursuitScopesResponse,
  MemoryRecallResponse,
  MemoryReviewDraftRequest,
  MemoryReviewResponse,
  MemoryScopedOperationView,
  MemoryUndoRequest,
  MemoryUndoResponse,
} from "./memorySchemas.js";
import type {
  AnalysisProposalResponse,
  AppleLoginChallengeRequest,
  AppleLoginChallengeResponse,
  AppleLoginRequest,
  ApproveEffectReversalRequest,
  ApproveActionRequest,
  ApprovalResponse,
  AssertionDecisionRequest,
  AssertionDecisionResponse,
  CaptureResponse,
  CurrentSessionResponse,
  CreateCaptureRequest,
  DeleteCaptureRequest,
  DeleteCaptureResponse,
  DeletionLineageResponse,
  EffectResultResponse,
  EffectReversalApprovalResponse,
  EffectReversalPreview,
  EffectReversalResultResponse,
  ExecuteEffectReversalRequest,
  ExecuteActionRequest,
  ReconcileEffectRequest,
  LogoutResponse,
  PasswordLoginRequest,
  PasswordRegistrationRequest,
  ReviseActionRequest,
  SessionResponse,
  SimulatedLoginRequest,
  SourceRetentionReceipt,
  SubmitAnalysisProposalRequest,
  SyncResponse,
  TemporalStateResponse,
  WorkspaceReviewResponse,
} from "./schemas.js";
import type {
  PersonDirectoryResponse,
  CaptureIdentityCorrectionRequest,
  CaptureIdentityCorrectionResponse,
  EvidenceFragmentReviewRequest,
  EvidenceFragmentReviewResponse,
  IdentityResolutionCase,
  IdentityResolutionDecisionRequest,
  IdentityResolutionDecisionResponse,
  PersonMergePreview,
  PersonMergeRequest,
  PersonMergeResponse,
  PersonMergeReversalRequest,
  PersonMergeReversalPreview,
  PublicResearchRequest,
  PublicResearchResponse,
  RelationshipAgentHistory,
  RelationshipResourceDetail,
  RelationshipResourceListResponse,
  RelationshipScope,
  ResourceCaptureRequest,
  ResourceCaptureResponse,
  SourceAuthorizationDecisionRequest,
  SourceAuthorizationDecisionResponse,
} from "./resourceSchemas.js";
import type {
  CompileKnowledgeRequest,
  ChatMediaAsset,
  ChatMediaDeleteResponse,
  ChatTaskRequest,
  UnscopedChatTaskRequest,
  UnscopedChatTaskResponse,
  ChatTaskReadback,
  ChatTaskResponse,
  CreateChatMediaRequest,
  KnowledgeSnapshot,
} from "./resourceSchemas.js";
import type {
  PursuitProposalListResponse,
  PursuitProposalResponse,
  PursuitProposalReviewResponse,
  ReviewPursuitProposalRequest,
  StagePursuitProposalRequest,
} from "./proposalSchemas.js";
import type {
  CompletePursuitActionRequest,
  CreatePursuitRequest,
  PursuitDetailResponse,
  PursuitListResponse,
  PursuitMutationResponse,
  PursuitOperationResponse,
  RevisePursuitRequest,
} from "./pursuitSchemas.js";
import type {
  AgentTaskEventsResponse,
  AgentDecisionResolutionResponse,
  AgentTaskListResponse,
  AgentTaskResponse,
  AgentRunResponse,
  CancelAgentTaskRequest,
  CreatePursuitAgentTaskRequest,
  CreatePursuitAgentRunRequest,
  ResolveAgentDecisionBundleRequest,
} from "./agentSchemas.js";
import type {
  AppendTelemetryBatchRequest,
  CompleteTelemetryTraceRequest,
  CreateTelemetryTraceRequest,
  TelemetryMutationResponse,
  TelemetryTraceDetailResponse,
  TelemetryTraceListResponse,
} from "./telemetrySchemas.js";
import type {
  CompareLabScenarioRequest,
  CreateRealityReceiptRequest,
  LabComparisonResponse,
  LabEvalCaseResponse,
  LabManifestResponse,
  LabRunResponse,
  LabSessionResponse,
  PromoteRealityReceiptRequest,
  RealityReceiptResponse,
  RunLabScenarioRequest,
  StartLabSessionRequest,
} from "./labSchemas.js";
import type {
  LabJobCatalog,
  LabJobRequest,
  LabJobResponse,
  LabJobReview,
} from "./labJobSchemas.js";
import type {
  LabRegressionList,
  LabRegressionRequest,
  LabRegressionResponse,
} from "./labRegressionSchemas.js";
import type {
  LabFeatureConfiguration,
  LabFeatureOverrideRequest,
  LabFeatureOverride,
} from "./labFeatureSchemas.js";

export class TalentSignalHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.name = "TalentSignalHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type VoiceTranscriptionRequest = {
  audio_base64: string;
  client_request_id: string;
  mime_type: "audio/wav";
};

export type VoiceTranscriptionDraft = {
  audio_duration_ms?: number;
  client_request_id: string;
  model: string;
  provider: "doubao";
  provider_request_id: string;
  status: "draft";
  temporary_audio_stored_by_talent_signal: false;
  transcript: string;
};

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class TalentSignalClient {
  readonly baseUrl: string;
  private accessToken: string | undefined;
  private clientPlatform: "web" | "ios" | "unknown" = "unknown";

  setClientPlatform(platform: "web" | "ios" | "unknown"): void { this.clientPlatform = platform; }

  createProductRunCase(id: string, body: { id: string; output_hash: string; expected_behavior: string }): Promise<{ id: string }> {
    return this.request(`/v1/product-runs/${encodeURIComponent(id)}/cases`, { method: "POST", body });
  }
  listProductRuns(query = ""): Promise<ProductRunList> { return this.request(`/v1/product-runs${query}`, { method: "GET" }); }
  getProductRun(id: string, byTask = false): Promise<ProductRunDetail> { return this.request(`/v1/product-runs/${byTask ? "tasks/" : ""}${encodeURIComponent(id)}`, { method: "GET" }); }
  submitProductRunFeedback(taskID: string, body: ProductRunFeedbackMutation): Promise<ProductRunDetail> { return this.request(`/v1/product-runs/tasks/${encodeURIComponent(taskID)}/feedback`, { method: "PUT", body }); }

  constructor(baseUrl: string, accessToken?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.accessToken = accessToken;
  }

  setAccessToken(accessToken: string): void {
    this.accessToken = accessToken;
  }

  async login(request: SimulatedLoginRequest): Promise<SessionResponse> {
    const response = await this.request<SessionResponse>(
      "/v1/auth/simulated-login",
      { method: "POST", body: request, authenticated: false },
    );
    this.setAccessToken(response.access_token);
    return response;
  }

  async signInWithPassword(
    request: PasswordLoginRequest,
    signal?: AbortSignal,
  ): Promise<SessionResponse> {
    const response = await this.request<SessionResponse>(
      "/v1/auth/password/login",
      { method: "POST", body: request, authenticated: false, signal },
    );
    this.setAccessToken(response.access_token);
    return response;
  }

  /**
   * Canonical run readback for a live operator-owned test session (the direct
   * password and private handoff banner source). Uses this client's ordinary
   * session bearer; the separate provisioning client authority is unchanged.
   */
  async currentCapirTestRun(): Promise<CapirTestRun> {
    const response = await this.request<{ run: CapirTestRun }>(
      "/v1/capir/test-session",
      { method: "GET" },
    );
    return response.run;
  }

  async registerWithPassword(
    request: PasswordRegistrationRequest,
    signal?: AbortSignal,
  ): Promise<PasswordRegistrationStartResponse> {
    // Verified signup: this only starts delivery. The response is generic and
    // contains no code; confirmation activates the account.
    return this.request<PasswordRegistrationStartResponse>(
      "/v1/auth/password/register",
      { method: "POST", body: request, authenticated: false, signal },
    );
  }

  async confirmPasswordRegistration(
    request: PasswordVerificationConfirmRequest,
    signal?: AbortSignal,
  ): Promise<SessionResponse> {
    const response = await this.request<SessionResponse>(
      "/v1/auth/password/register/confirm",
      { method: "POST", body: request, authenticated: false, signal },
    );
    this.setAccessToken(response.access_token);
    return response;
  }

  startLoginMethodChange(
    request: StartCredentialChangeRequest,
    signal?: AbortSignal,
  ): Promise<CredentialChangeAttempt> {
    return this.request<CredentialChangeAttempt>(
      "/v1/account/login-methods/attempts",
      { method: "POST", body: request, signal },
    );
  }

  completeLoginMethodChange(
    request: CompleteCredentialChangeRequest,
    signal?: AbortSignal,
  ): Promise<CredentialChangeResult> {
    return this.request<CredentialChangeResult>(
      "/v1/account/login-methods/complete",
      { method: "POST", body: request, signal },
    );
  }

  prepareReconciliation(
    request: ReconciliationPrepareRequest,
    signal?: AbortSignal,
  ): Promise<ReconciliationRecord> {
    return this.request<ReconciliationRecord>(
      "/v1/account/reconciliations/prepare",
      { method: "POST", body: request, signal },
    );
  }

  readReconciliation(id: string, signal?: AbortSignal): Promise<ReconciliationRecord> {
    return this.request<ReconciliationRecord>(
      `/v1/account/reconciliations/${encodeURIComponent(id)}`,
      { method: "GET", signal },
    );
  }

  confirmReconciliation(
    id: string,
    request: ReconciliationActionRequest,
    signal?: AbortSignal,
  ): Promise<ReconciliationRecord> {
    return this.request<ReconciliationRecord>(
      `/v1/account/reconciliations/${encodeURIComponent(id)}/confirm`,
      { method: "POST", body: request, signal },
    );
  }

  cancelReconciliation(
    id: string,
    request: ReconciliationActionRequest,
    signal?: AbortSignal,
  ): Promise<ReconciliationRecord> {
    return this.request<ReconciliationRecord>(
      `/v1/account/reconciliations/${encodeURIComponent(id)}/cancel`,
      { method: "POST", body: request, signal },
    );
  }

  createGoogleLoginChallenge(
    request: { client_label: string },
    signal?: AbortSignal,
  ): Promise<AppleLoginChallengeResponse> {
    return this.request("/v1/auth/google/challenges", {
      method: "POST",
      body: request,
      authenticated: false,
      signal,
    });
  }

  createAppleLoginChallenge(
    request: AppleLoginChallengeRequest,
  ): Promise<AppleLoginChallengeResponse> {
    return this.request("/v1/auth/apple/challenges", {
      method: "POST",
      body: request,
      authenticated: false,
    });
  }

  async signInWithApple(request: AppleLoginRequest): Promise<SessionResponse> {
    const response = await this.request<SessionResponse>("/v1/auth/apple", {
      method: "POST",
      body: request,
      authenticated: false,
    });
    this.setAccessToken(response.access_token);
    return response;
  }

  accountSettings(): Promise<AccountSettings> {
    return this.request<AccountSettings>("/v1/account/settings", { method: "GET" });
  }

  accountOnboarding(signal?: AbortSignal): Promise<AccountOnboarding> {
    return this.request<AccountOnboarding>("/v1/account/onboarding", {
      method: "GET", signal,
    });
  }

  updateAccountOnboarding(
    input: AccountOnboardingMutation,
    signal?: AbortSignal,
  ): Promise<AccountOnboarding> {
    return this.request<AccountOnboarding>("/v1/account/onboarding", {
      method: "POST", signal,
      body: input,
    });
  }

  previewAccountOnboarding(
    request: AccountOnboardingPreviewRequest,
    signal?: AbortSignal,
  ): Promise<AccountOnboardingPreview> {
    return this.request<AccountOnboardingPreview>(
      "/v1/account/onboarding/preview",
      { method: "POST", body: request, signal },
    );
  }

  systemHealth(signal?: AbortSignal): Promise<SystemHealthResponse> {
    return this.request<SystemHealthResponse>("/v1/system/health", {
      method: "GET",
      signal,
    });
  }

  updateAccountSettings(input: AccountMutation): Promise<AccountSettings> {
    return this.request<AccountSettings>("/v1/account/settings", {method: "POST", body: input});
  }

  currentSession(signal?: AbortSignal): Promise<CurrentSessionResponse> {
    return this.request("/v1/auth/session", { method: "GET", signal });
  }

  async logout(): Promise<LogoutResponse> {
    const response = await this.request<LogoutResponse>("/v1/auth/logout", {
      method: "POST",
    });
    this.accessToken = undefined;
    return response;
  }

  createPursuit(
    request: CreatePursuitRequest,
  ): Promise<PursuitMutationResponse> {
    return this.request("/v1/pursuits", { method: "POST", body: request });
  }

  listPursuits(): Promise<PursuitListResponse> {
    return this.request("/v1/pursuits", { method: "GET" });
  }

  getPursuit(pursuitId: string): Promise<PursuitDetailResponse> {
    return this.request(`/v1/pursuits/${pursuitId}`, { method: "GET" });
  }

  revisePursuit(
    pursuitId: string,
    request: RevisePursuitRequest,
  ): Promise<PursuitMutationResponse> {
    return this.request(`/v1/pursuits/${pursuitId}/revisions`, {
      method: "POST",
      body: request,
    });
  }

  completePursuitAction(
    pursuitId: string,
    actionId: string,
    request: CompletePursuitActionRequest,
  ): Promise<PursuitMutationResponse> {
    return this.request(
      `/v1/pursuits/${pursuitId}/actions/${actionId}/completions`,
      { method: "POST", body: request },
    );
  }

  getOperation(operationId: string): Promise<PursuitOperationResponse> {
    return this.request(`/v1/operations/${operationId}`, { method: "GET" });
  }

  createPursuitAgentRun(
    pursuitId: string,
    request: CreatePursuitAgentRunRequest,
  ): Promise<AgentRunResponse> {
    return this.request(`/v1/pursuits/${pursuitId}/agent-runs`, {
      method: "POST",
      body: request,
    });
  }

  getAgentRun(runId: string): Promise<AgentRunResponse> {
    return this.request(`/v1/agent-runs/${runId}`, { method: "GET" });
  }

  createPursuitAgentTask(
    pursuitId: string,
    request: CreatePursuitAgentTaskRequest,
  ): Promise<AgentDecisionResolutionResponse> {
    return this.request(`/v1/pursuits/${pursuitId}/agent-tasks`, {
      method: "POST",
      body: request,
    });
  }

  listPursuitAgentTasks(
    pursuitId: string,
    state: "active" | "all" = "active",
  ): Promise<AgentTaskListResponse> {
    return this.request(
      `/v1/pursuits/${pursuitId}/agent-tasks?state=${state}`,
      { method: "GET" },
    );
  }

  getAgentTask(taskId: string): Promise<AgentTaskResponse> {
    return this.request(`/v1/agent-tasks/${taskId}`, { method: "GET" });
  }

  getAgentTaskEvents(
    taskId: string,
    afterSequence = 0,
  ): Promise<AgentTaskEventsResponse> {
    return this.request(
      `/v1/agent-tasks/${taskId}/events?after=${afterSequence}`,
      { method: "GET" },
    );
  }

  cancelAgentTask(
    taskId: string,
    request: CancelAgentTaskRequest,
  ): Promise<AgentTaskResponse> {
    return this.request(`/v1/agent-tasks/${taskId}/cancel`, {
      method: "POST",
      body: request,
    });
  }

  resolveAgentDecisionBundle(
    bundleId: string,
    request: ResolveAgentDecisionBundleRequest,
  ): Promise<AgentDecisionResolutionResponse> {
    return this.request(`/v1/decision-bundles/${bundleId}/resolve`, {
      method: "POST",
      body: request,
    });
  }

  createTelemetryTrace(
    request: CreateTelemetryTraceRequest,
  ): Promise<TelemetryMutationResponse> {
    return this.request("/v1/telemetry/traces", {
      method: "POST",
      body: request,
    });
  }

  appendTelemetryBatch(
    traceId: string,
    request: AppendTelemetryBatchRequest,
  ): Promise<TelemetryMutationResponse> {
    return this.request(`/v1/telemetry/traces/${traceId}/batch`, {
      method: "POST",
      body: request,
    });
  }

  completeTelemetryTrace(
    traceId: string,
    request: CompleteTelemetryTraceRequest,
  ): Promise<TelemetryMutationResponse> {
    return this.request(`/v1/telemetry/traces/${traceId}/completion`, {
      method: "POST",
      body: request,
    });
  }

  listTelemetryTraces(limit = 100): Promise<TelemetryTraceListResponse> {
    return this.request(`/v1/eval/traces?limit=${limit}`, { method: "GET" });
  }

  getTelemetryTrace(traceId: string): Promise<TelemetryTraceDetailResponse> {
    return this.request(`/v1/eval/traces/${traceId}`, { method: "GET" });
  }

  getLabManifest(): Promise<LabManifestResponse> {
    return this.request("/v1/lab", { method: "GET" });
  }

  startLabSession(
    request: StartLabSessionRequest,
  ): Promise<LabSessionResponse> {
    return this.request("/v1/lab/sessions", { method: "POST", body: request });
  }

  runLabScenario(
    sessionId: string,
    request: RunLabScenarioRequest,
  ): Promise<LabRunResponse> {
    return this.request(`/v1/lab/sessions/${sessionId}/runs`, {
      method: "POST",
      body: request,
    });
  }

  compareLabScenario(
    sessionId: string,
    request: CompareLabScenarioRequest,
  ): Promise<LabComparisonResponse> {
    return this.request(`/v1/lab/sessions/${sessionId}/comparisons`, {
      method: "POST",
      body: request,
    });
  }

  createRealityReceipt(
    sessionId: string,
    request: CreateRealityReceiptRequest,
  ): Promise<RealityReceiptResponse> {
    return this.request(`/v1/lab/sessions/${sessionId}/receipts`, {
      method: "POST",
      body: request,
    });
  }

  promoteRealityReceipt(
    receiptId: string,
    request: PromoteRealityReceiptRequest,
  ): Promise<LabEvalCaseResponse> {
    return this.request(`/v1/lab/receipts/${receiptId}/promotions`, {
      method: "POST",
      body: request,
    });
  }

  getLabJobCatalog(): Promise<LabJobCatalog> {
    return this.request("/v1/lab/experiment-jobs", { method: "GET" });
  }

  startLabJob(request: LabJobRequest): Promise<LabJobResponse> {
    return this.request("/v1/lab/experiment-jobs", {
      method: "POST",
      body: request,
    });
  }

  getLabJob(jobId: string): Promise<LabJobResponse> {
    return this.request(`/v1/lab/experiment-jobs/${jobId}`, { method: "GET" });
  }

  cancelLabJob(jobId: string): Promise<LabJobResponse> {
    return this.request(`/v1/lab/experiment-jobs/${jobId}/cancel`, {
      method: "POST",
      body: {},
    });
  }

  reviewLabJob(jobId: string, review: LabJobReview): Promise<LabJobResponse> {
    return this.request(`/v1/lab/experiment-jobs/${jobId}/review`, {
      method: "POST",
      body: review,
    });
  }

  listLabRegressions(): Promise<LabRegressionList> {
    return this.request("/v1/lab/regressions", { method: "GET" });
  }

  getLabRegression(regressionId: string): Promise<LabRegressionResponse> {
    return this.request(`/v1/lab/regressions/${regressionId}`, {
      method: "GET",
    });
  }

  saveLabRegression(request: LabRegressionRequest): Promise<LabRegressionResponse> {
    return this.request("/v1/lab/regressions", {
      method: "POST",
      body: request,
    });
  }

  getLabFeatureConfiguration(): Promise<LabFeatureConfiguration> {
    return this.request("/v1/lab/feature-configuration", { method: "GET" });
  }

  startLabFeatureOverride(request: LabFeatureOverrideRequest): Promise<{
    contract_version: string;
    override: LabFeatureOverride;
  }> {
    return this.request("/v1/lab/feature-overrides", { method: "POST", body: request });
  }

  getLabFeatureOverride(overrideId: string): Promise<{
    contract_version: string;
    override: LabFeatureOverride;
  }> {
    return this.request(`/v1/lab/feature-overrides/${overrideId}`, { method: "GET" });
  }

  stopLabFeatureOverride(overrideId: string): Promise<{
    contract_version: string;
    override: LabFeatureOverride;
  }> {
    return this.request(`/v1/lab/feature-overrides/${overrideId}/stop`, { method: "POST", body: {} });
  }

  async getTelemetryArtifactContent(
    artifactId: string,
  ): Promise<{ body: ArrayBuffer; contentType: string }> {
    const response = await this.rawRequest(
      `/v1/eval/artifacts/${artifactId}/content`,
      { method: "GET" },
    );
    return {
      body: await response.arrayBuffer(),
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  stagePursuitProposal(
    pursuitId: string,
    request: StagePursuitProposalRequest,
  ): Promise<PursuitProposalResponse> {
    return this.request(`/v1/pursuits/${pursuitId}/proposals`, {
      method: "POST",
      body: request,
    });
  }

  getPursuitProposal(
    proposalId: string,
  ): Promise<PursuitProposalResponse> {
    return this.request(`/v1/pursuit-proposals/${proposalId}`, {
      method: "GET",
    });
  }

  listPursuitProposals(): Promise<PursuitProposalListResponse> {
    return this.request("/v1/pursuit-proposals", { method: "GET" });
  }

  reviewPursuitProposal(
    proposalId: string,
    request: ReviewPursuitProposalRequest,
  ): Promise<PursuitProposalReviewResponse> {
    return this.request(`/v1/pursuit-proposals/${proposalId}/reviews`, {
      method: "POST",
      body: request,
    });
  }

  createCapture(request: CreateCaptureRequest): Promise<CaptureResponse> {
    return this.request("/v1/captures", { method: "POST", body: request });
  }

  createResourceCapture(
    request: ResourceCaptureRequest,
  ): Promise<ResourceCaptureResponse> {
    return this.request("/v1/resource-captures", {
      method: "POST",
      body: request,
    });
  }

  listRelationshipResources(
    personId: string,
    relationshipContextId: string,
  ): Promise<RelationshipResourceListResponse> {
    return this.request(
      `/v1/people/${personId}/contexts/${relationshipContextId}/resources`,
      { method: "GET" },
    );
  }

  loadResourceCapture(captureId: string): Promise<ResourceCaptureResponse> {
    return this.request(`/v1/resource-captures/${captureId}`, { method: "GET" });
  }

  prepareCaptureReview(captureId: string): Promise<RelationshipResourceDetail> {
    return this.request(`/v1/resource-captures/${captureId}/review-preparations`, { method: "POST" });
  }

  getRelationshipResource(
    resourceId: string,
  ): Promise<RelationshipResourceDetail> {
    return this.request(`/v1/resources/${resourceId}`, {
      method: "GET",
    });
  }

  reviewEvidenceFragment(
    fragmentId: string,
    request: EvidenceFragmentReviewRequest,
  ): Promise<EvidenceFragmentReviewResponse> {
    return this.request(`/v1/evidence-fragments/${fragmentId}/reviews`, {
      method: "POST",
      body: request,
    });
  }

  getIdentityResolutionCase(
    caseId: string,
  ): Promise<IdentityResolutionCase> {
    return this.request(`/v1/identity-resolution-cases/${caseId}`, {
      method: "GET",
    });
  }

  decideIdentityResolutionCase(
    caseId: string,
    request: IdentityResolutionDecisionRequest,
  ): Promise<IdentityResolutionDecisionResponse> {
    return this.request(
      `/v1/identity-resolution-cases/${caseId}/decisions`,
      {
        method: "POST",
        body: request,
      },
    );
  }

  correctCaptureIdentity(
    captureId: string,
    request: CaptureIdentityCorrectionRequest,
  ): Promise<CaptureIdentityCorrectionResponse> {
    return this.request(
      `/v1/captures/${captureId}/identity-corrections`,
      {
        method: "POST",
        body: request,
      },
    );
  }

  previewPersonMerge(
    sourcePersonId: string,
    targetPersonId: string,
  ): Promise<PersonMergePreview> {
    return this.request(
      `/v1/person-merges/preview?source_person_id=${encodeURIComponent(
        sourcePersonId,
      )}&target_person_id=${encodeURIComponent(targetPersonId)}`,
      { method: "GET" },
    );
  }

  mergePeople(
    request: PersonMergeRequest,
  ): Promise<PersonMergeResponse> {
    return this.request("/v1/person-merges", {
      method: "POST",
      body: request,
    });
  }

  reversePersonMerge(
    operationId: string,
    request: PersonMergeReversalRequest,
  ): Promise<PersonMergeResponse> {
    return this.request(`/v1/person-merges/${operationId}/reversal`, {
      method: "POST",
      body: request,
    });
  }

  getPersonMergeReversalPreview(
    operationId: string,
  ): Promise<PersonMergeReversalPreview> {
    return this.request(`/v1/person-merges/${operationId}/reversal`, {
      method: "GET",
    });
  }

  decideCaptureSourceAuthorization(
    captureId: string,
    request: SourceAuthorizationDecisionRequest,
  ): Promise<SourceAuthorizationDecisionResponse> {
    return this.request(
      `/v1/captures/${captureId}/source-authorization-decisions`,
      {
        method: "POST",
        body: request,
      },
    );
  }

  runPublicResearch(
    request: PublicResearchRequest,
  ): Promise<PublicResearchResponse> {
    return this.request("/v1/research-tasks", {
      method: "POST",
      body: request,
    });
  }

  getLatestPublicResearchTask(
    seedResourceId: string,
  ): Promise<PublicResearchResponse | null> {
    return this.request(
      `/v1/research-tasks/latest?seed_resource_id=${encodeURIComponent(
        seedResourceId,
      )}`,
      { method: "GET" },
    );
  }

  getCapture(captureId: string): Promise<CaptureResponse> {
    return this.request(`/v1/captures/${captureId}`, { method: "GET" });
  }

  listPeople(query = ""): Promise<PersonDirectoryResponse> {
    const search = query.trim()
      ? `?query=${encodeURIComponent(query.trim())}`
      : "";
    return this.request(`/v1/people${search}`, { method: "GET" });
  }

  searchPeople(query: string): Promise<PersonDirectoryResponse> {
    return this.request("/v1/people/search", {
      method: "POST",
      body: { query },
    });
  }

  getRelationshipScope(
    personId: string,
    relationshipContextId: string,
  ): Promise<RelationshipScope> {
    return this.request(
      `/v1/people/${personId}/contexts/${relationshipContextId}`,
      { method: "GET" },
    );
  }

  getRelationshipAgentHistory(
    personId: string,
    relationshipContextId: string,
  ): Promise<RelationshipAgentHistory> {
    return this.request(
      `/v1/people/${personId}/contexts/${relationshipContextId}/agent-history`,
      { method: "GET" },
    );
  }

  compileKnowledge(
    personId: string,
    relationshipContextId: string,
    request: CompileKnowledgeRequest,
  ): Promise<KnowledgeSnapshot> {
    return this.request(
      `/v1/people/${personId}/contexts/${relationshipContextId}/wiki-compilations`,
      { method: "POST", body: request },
    );
  }

  getKnowledge(
    personId: string,
    relationshipContextId: string,
  ): Promise<KnowledgeSnapshot> {
    return this.request(
      `/v1/people/${personId}/contexts/${relationshipContextId}/wiki`,
      { method: "GET" },
    );
  }

  createUnscopedChatTask(request: UnscopedChatTaskRequest, signal?: AbortSignal): Promise<UnscopedChatTaskResponse> {
    return this.request("/v1/chat/unscoped-tasks", { method: "POST", body: request, ...(signal ? { signal } : {}) });
  }

  createChatTask(request: ChatTaskRequest): Promise<ChatTaskResponse> {
    return this.request("/v1/chat/tasks", {
      method: "POST",
      body: request,
    });
  }

  transcribeVoice(
    request: VoiceTranscriptionRequest,
  ): Promise<VoiceTranscriptionDraft> {
    return this.request("/v1/voice-transcriptions", {
      method: "POST",
      body: request,
    });
  }

  createChatMedia(request: CreateChatMediaRequest): Promise<ChatMediaAsset> {
    return this.request("/v1/chat/media", { method: "POST", body: request });
  }

  async uploadChatMediaContent(
    mediaId: string,
    body: Uint8Array,
    mediaType: string,
  ): Promise<ChatMediaAsset> {
    const response = await this.rawRequest(`/v1/chat/media/${mediaId}/content`, {
      method: "PUT",
      body: body as BodyInit,
      headers: { "content-type": mediaType },
    });
    return (await response.json()) as ChatMediaAsset;
  }

  deleteChatMedia(mediaId: string): Promise<ChatMediaDeleteResponse> {
    return this.request(`/v1/chat/media/${mediaId}`, { method: "DELETE" });
  }

  getChatMediaContent(mediaId: string): Promise<Response> {
    return this.rawRequest(`/v1/chat/media/${mediaId}/content`, {
      method: "GET",
    });
  }

  getChatTaskReadback(taskId: string): Promise<ChatTaskReadback> {
    return this.request(`/v1/chat/tasks/${taskId}/readback`, {
      method: "GET",
    });
  }

  getSourceRetentionReceipt(
    captureId: string,
  ): Promise<SourceRetentionReceipt> {
    return this.request(`/v1/captures/${captureId}/retention`, {
      method: "GET",
    });
  }

  getSourceRetentionReceiptByLocator(
    sourceLocator: string,
  ): Promise<SourceRetentionReceipt> {
    return this.request(
      `/v1/source-retention-receipts?source_locator=${encodeURIComponent(sourceLocator)}`,
      { method: "GET" },
    );
  }

  submitAnalysis(
    captureId: string,
    request: SubmitAnalysisProposalRequest,
  ): Promise<AnalysisProposalResponse> {
    return this.request(`/v1/captures/${captureId}/analysis-proposals`, {
      method: "POST",
      body: request,
    });
  }

  decideAssertion(
    assertionId: string,
    request: AssertionDecisionRequest,
  ): Promise<AssertionDecisionResponse> {
    return this.request(`/v1/assertions/${assertionId}/decisions`, {
      method: "POST",
      body: request,
    });
  }

  reviseAction(
    actionId: string,
    request: ReviseActionRequest,
  ): Promise<{ id: string; version: number; exact_preview_digest: string }> {
    return this.request(`/v1/actions/${actionId}/revisions`, {
      method: "POST",
      body: request,
    });
  }

  approveAction(
    actionId: string,
    request: ApproveActionRequest,
  ): Promise<ApprovalResponse> {
    return this.request(`/v1/actions/${actionId}/approvals`, {
      method: "POST",
      body: request,
    });
  }

  executeAction(
    actionId: string,
    request: ExecuteActionRequest,
  ): Promise<EffectResultResponse> {
    return this.request(`/v1/actions/${actionId}/executions`, {
      method: "POST",
      body: request,
    });
  }

  reconcileEffect(
    attemptId: string,
    request: ReconcileEffectRequest,
  ): Promise<EffectResultResponse> {
    return this.request(`/v1/effect-attempts/${attemptId}/reconcile`, {
      method: "POST",
      body: request,
    });
  }

  previewEffectReversal(
    attemptId: string,
  ): Promise<EffectReversalPreview> {
    return this.request(`/v1/effect-attempts/${attemptId}/reversal`, {
      method: "GET",
    });
  }

  approveEffectReversal(
    attemptId: string,
    request: ApproveEffectReversalRequest,
  ): Promise<EffectReversalApprovalResponse> {
    return this.request(
      `/v1/effect-attempts/${attemptId}/reversal-approvals`,
      { method: "POST", body: request },
    );
  }

  executeEffectReversal(
    attemptId: string,
    request: ExecuteEffectReversalRequest,
  ): Promise<EffectReversalResultResponse> {
    return this.request(
      `/v1/effect-attempts/${attemptId}/reversal-executions`,
      { method: "POST", body: request },
    );
  }

  revokeEffectReversalApproval(
    approvalId: string,
    request: { idempotency_key: string; reason: string },
  ): Promise<{ id: string; status: "revoked" }> {
    return this.request(
      `/v1/effect-reversal-approvals/${approvalId}/revocation`,
      { method: "POST", body: request },
    );
  }

  deleteCapture(
    captureId: string,
    request: DeleteCaptureRequest,
  ): Promise<DeleteCaptureResponse> {
    return this.request(`/v1/captures/${captureId}/deletion`, {
      method: "POST",
      body: request,
    });
  }

  getTemporalState(assignmentId: string): Promise<TemporalStateResponse> {
    return this.request(
      `/v1/state?assignment_id=${encodeURIComponent(assignmentId)}`,
      { method: "GET" },
    );
  }

  getWorkspaceReview(fixtureCaseId: string): Promise<WorkspaceReviewResponse> {
    return this.request(
      `/v1/workspace-review?fixture_case_id=${encodeURIComponent(fixtureCaseId)}`,
      { method: "GET" },
    );
  }

  getWorkspaceReviewByCapture(
    captureId: string,
  ): Promise<WorkspaceReviewResponse> {
    return this.request(
      `/v1/workspace-review?capture_id=${encodeURIComponent(captureId)}`,
      { method: "GET" },
    );
  }

  getDeletionLineage(deletionId: string): Promise<DeletionLineageResponse> {
    return this.request(`/v1/deletions/${deletionId}/lineage`, {
      method: "GET",
    });
  }

  revokeApproval(
    approvalId: string,
    request: { idempotency_key: string; reason: string },
  ): Promise<{ id: string; status: "revoked" }> {
    return this.request(`/v1/approvals/${approvalId}/revocation`, {
      method: "POST",
      body: request,
    });
  }

  revokeCapability(request: {
    idempotency_key: string;
    capability: "local.simulated_attention.create";
    reason: string;
  }): Promise<{
    capability: string;
    status: "revoked";
  }> {
    return this.request("/v1/authorizations/revocation", {
      method: "POST",
      body: request,
    });
  }

  listAgentSessions(after?: string): Promise<AgentSessionListResponse> {
    return this.request(`/v1/agent-sessions${after ? `?after=${encodeURIComponent(after)}` : ""}`, { method: "GET" });
  }

  getAgentPreference(): Promise<AgentPreferenceResponse> {
    return this.request("/v1/agent/preferences", { method: "GET" });
  }

  /** Read-only weekly usage metadata for the signed-in account member. */
  getWeeklyUsage(signal?: AbortSignal): Promise<WeeklyUsageResponse> {
    return this.request("/v1/workspace/usage/weekly", { method: "GET", signal });
  }

  listMcpConnections(signal?: AbortSignal): Promise<McpConnectionListResponse> {
    return this.request("/v1/mcp/connections", { method: "GET", signal });
  }

  createMcpConnection(
    request: McpConnectionCreateRequest,
  ): Promise<McpConnectionResponse> {
    return this.request("/v1/mcp/connections", { method: "POST", body: request });
  }

  updateMcpConnection(
    id: string,
    request: McpConnectionUpdateRequest,
  ): Promise<McpConnectionResponse> {
    return this.request(`/v1/mcp/connections/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: request,
    });
  }

  connectMcpConnection(
    id: string,
    request: McpConnectionActionRequest,
  ): Promise<McpConnectionResponse> {
    return this.request(
      `/v1/mcp/connections/${encodeURIComponent(id)}/connect`,
      { method: "POST", body: request },
    );
  }

  disconnectMcpConnection(
    id: string,
    request: McpConnectionActionRequest,
  ): Promise<McpConnectionResponse> {
    return this.request(
      `/v1/mcp/connections/${encodeURIComponent(id)}/disconnect`,
      { method: "POST", body: request },
    );
  }

  listMcpClientGrants(signal?: AbortSignal): Promise<McpClientGrantListResponse> {
    return this.request("/v1/mcp/clients", { method: "GET", signal });
  }

  createMcpClientGrant(
    request: McpClientGrantCreateRequest,
  ): Promise<McpClientGrantCreateResponse> {
    return this.request("/v1/mcp/clients", { method: "POST", body: request });
  }

  revokeMcpClientGrant(
    id: string,
    request: McpClientGrantRevokeRequest,
  ): Promise<McpClientGrantResponse> {
    return this.request(`/v1/mcp/clients/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
      body: request,
    });
  }

  getMcpEndpoints(signal?: AbortSignal): Promise<McpEndpointsResponse> {
    return this.request("/v1/mcp/endpoints", { method: "GET", signal });
  }

  saveAgentPreference(request: AgentPreferenceMutation): Promise<AgentPreferenceResponse> {
    return this.request("/v1/agent/preferences", { method: "PUT", body: request });
  }

  getAgentSession(id: string, signal?: AbortSignal): Promise<AgentSessionResponse> {
    return this.request(`/v1/agent-sessions/${encodeURIComponent(id)}`, { method: "GET", ...(signal ? { signal } : {}) });
  }

  saveAgentSession(id: string, request: AgentSessionMutationRequest, signal?: AbortSignal): Promise<AgentSessionResponse> {
    return this.request(`/v1/agent-sessions/${encodeURIComponent(id)}`, { method: "PUT", body: request, ...(signal ? { signal } : {}) });
  }

  deleteAgentSession(id: string, request: AgentSessionDeleteRequest): Promise<AgentSessionResponse> {
    return this.request(`/v1/agent-sessions/${encodeURIComponent(id)}`, { method: "DELETE", body: request });
  }

  admitConversationQueueEntry(request: ConversationQueueAdmitRequest, signal?: AbortSignal): Promise<ConversationQueueAdmitResponse> {
    return this.request(`/v1/agent-sessions/${encodeURIComponent(request.session_id)}/conversation-queue`, { method: "POST", body: request, ...(signal ? { signal } : {}) });
  }

  getConversationQueue(sessionId: string, signal?: AbortSignal): Promise<ConversationQueueSnapshot> {
    return this.request(`/v1/agent-sessions/${encodeURIComponent(sessionId)}/conversation-queue`, { method: "GET", ...(signal ? { signal } : {}) });
  }

  getDesktopCapturePolicy(): Promise<import("./desktopCaptureSchemas.js").DesktopCapturePolicy> {
    return this.request("/v1/desktop-capture/policy", { method: "GET" });
  }

  getDesktopCaptureReceipt(sessionId: string, messageId: string): Promise<import("./desktopCaptureSchemas.js").DesktopCaptureReceipt> {
    return this.request(`/v1/desktop-capture/${encodeURIComponent(sessionId)}/${encodeURIComponent(messageId)}`, { method: "GET" });
  }

  /** Anonymous, rate-limited preparation of one browser-owned macOS login grant. */
  prepareDesktopBrowserLogin(
    request: import("./desktopBrowserLoginSchemas.js").DesktopBrowserLoginPrepareRequest,
    signal?: AbortSignal,
  ): Promise<import("./desktopBrowserLoginSchemas.js").DesktopBrowserLoginPrepareResponse> {
    return this.request("/v1/desktop-browser-login/prepare", {
      method: "POST",
      body: request,
      authenticated: false,
      ...(signal ? { signal } : {}),
    });
  }

  /** Intentional approval from the authenticated first-party browser session. */
  approveDesktopBrowserLogin(
    attemptId: string,
    request: import("./desktopBrowserLoginSchemas.js").DesktopBrowserLoginApproveRequest,
    signal?: AbortSignal,
  ): Promise<import("./desktopBrowserLoginSchemas.js").DesktopBrowserLoginApproveResponse> {
    return this.request(`/v1/desktop-browser-login/${encodeURIComponent(attemptId)}/approve`, {
      method: "POST",
      body: request,
      ...(signal ? { signal } : {}),
    });
  }

  /** One-use code/verifier exchange; the only call that opens a device session. */
  consumeDesktopBrowserLogin(
    request: import("./desktopBrowserLoginSchemas.js").DesktopBrowserLoginConsumeRequest,
    signal?: AbortSignal,
  ): Promise<import("./schemas.js").SessionResponse> {
    return this.request("/v1/desktop-browser-login/consume", {
      method: "POST",
      body: request,
      authenticated: false,
      ...(signal ? { signal } : {}),
    });
  }

  /** Deliberate cancellation proved by the prepared cancellation secret. */
  cancelDesktopBrowserLogin(
    attemptId: string,
    request: import("./desktopBrowserLoginSchemas.js").DesktopBrowserLoginCancelRequest,
  ): Promise<import("./desktopBrowserLoginSchemas.js").DesktopBrowserLoginCancelResponse> {
    return this.request(`/v1/desktop-browser-login/${encodeURIComponent(attemptId)}/cancel`, {
      method: "POST",
      body: request,
      authenticated: false,
    });
  }

  /** Authenticated, state-bound browser decline of one pending grant. */
  declineDesktopBrowserLogin(
    attemptId: string,
    request: import("./desktopBrowserLoginSchemas.js").DesktopBrowserLoginDeclineRequest,
  ): Promise<import("./desktopBrowserLoginSchemas.js").DesktopBrowserLoginCancelResponse> {
    return this.request(`/v1/desktop-browser-login/${encodeURIComponent(attemptId)}/decline`, {
      method: "POST",
      body: request,
    });
  }

  /** Secret-bound read-only outcome for an unknown exchange result. */
  readDesktopBrowserLoginGrantResult(
    attemptId: string,
    request: import("./desktopBrowserLoginSchemas.js").DesktopBrowserLoginGrantResultRequest,
  ): Promise<import("./desktopBrowserLoginSchemas.js").DesktopBrowserLoginGrantResultResponse> {
    return this.request(`/v1/desktop-browser-login/${encodeURIComponent(attemptId)}/grant-result`, {
      method: "POST",
      body: request,
      authenticated: false,
    });
  }

  /** Read-only inspection of one pending grant for the confirmation page.
   * The preview checks the exact prepared origin and operation state; a
   * mismatch reveals no hint, lifecycle or identity authority. */
  readDesktopBrowserLoginGrant(
    attemptId: string,
    state: string,
    webOrigin: string,
  ): Promise<import("./desktopBrowserLoginSchemas.js").DesktopBrowserLoginGrantView> {
    const query = new URLSearchParams({ state, web_origin: webOrigin });
    return this.request(`/v1/desktop-browser-login/${encodeURIComponent(attemptId)}/grant?${query}`, {
      method: "GET",
    });
  }

  /** Read-only correlation of the live session against one consumed grant. */
  readDesktopBrowserLoginStatus(
    attemptId: string,
  ): Promise<import("./desktopBrowserLoginSchemas.js").DesktopBrowserLoginStatusResponse> {
    return this.request(`/v1/desktop-browser-login/${encodeURIComponent(attemptId)}/status`, {
      method: "GET",
    });
  }

  mutateConversationQueue(sessionId: string, request: ConversationQueueMutationRequest, signal?: AbortSignal): Promise<ConversationQueueMutationResponse> {
    return this.request(`/v1/agent-sessions/${encodeURIComponent(sessionId)}/conversation-queue/mutations`, { method: "POST", body: request, ...(signal ? { signal } : {}) });
  }

  /** Authenticated SSE observation. Reconnection only resumes observation. */
  openConversationQueueStream(sessionId: string, signal?: AbortSignal): Promise<Response> {
    return this.rawRequest(`/v1/agent-sessions/${encodeURIComponent(sessionId)}/conversation-queue/stream`, {
      method: "GET",
      headers: { accept: "text/event-stream" },
      ...(signal ? { signal } : {}),
    });
  }

  /** Authenticated original-image readback for one inline conversation message. */
  openConversationMessageImage(
    sessionId: string,
    messageId: string,
    index: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    return this.rawRequest(
      `/v1/agent-sessions/${encodeURIComponent(sessionId)}/conversation-images/${encodeURIComponent(messageId)}/${index}`,
      { method: "GET", headers: { accept: "image/*" }, ...(signal ? { signal } : {}) },
    );
  }

  listMeetingDrafts(after?: string, scope: MeetingDraftListScope = "all"): Promise<MeetingDraftListResponse> {
    const query = new URLSearchParams({ scope });
    if (after) query.set("after", after);
    return this.request(`/v1/meeting-drafts?${query.toString()}`, { method: "GET" });
  }

  getMeetingDraft(id: string): Promise<MeetingDraftResponse> {
    return this.request(`/v1/meeting-drafts/${encodeURIComponent(id)}`, { method: "GET" });
  }

  updateMeetingDraft(id: string, request: MeetingDraftUpdateRequest): Promise<MeetingDraftResponse> {
    return this.request(`/v1/meeting-drafts/${encodeURIComponent(id)}`, { method: "PUT", body: request });
  }

  dismissMeetingDraft(id: string, request: MeetingDraftDismissRequest): Promise<MeetingDraftResponse> {
    return this.request(`/v1/meeting-drafts/${encodeURIComponent(id)}/dismiss`, { method: "POST", body: request });
  }

  sync(after = 0): Promise<SyncResponse> {
    return this.request(`/v1/sync?after=${after}`, { method: "GET" });
  }

  listTimeActivities(scope: TimeScope, after?: string): Promise<TimeActivityListResponse> {
    const query = new URLSearchParams({ from: scope.from, to: scope.to, time_zone: scope.time_zone });
    if (scope.person_id) query.set("person_id", scope.person_id);
    if (scope.kind) query.set("kind", scope.kind);
    if (after) query.set("after", after);
    return this.request(`/v1/time/activities?${query}`, { method: "GET" });
  }

  getTimeSchedule(id: string): Promise<TimeScheduleResponse> {
    return this.request(`/v1/time/schedules/${encodeURIComponent(id)}`, { method: "GET" });
  }

  putTimeSchedule(id: string, input: TimeScheduleMutationRequest): Promise<TimeScheduleResponse> {
    return this.request(`/v1/time/schedules/${encodeURIComponent(id)}`, { method: "PUT", body: input });
  }

  deleteTimeSchedule(id: string, input: TimeScheduleDeleteRequest): Promise<TimeScheduleResponse> {
    return this.request(`/v1/time/schedules/${encodeURIComponent(id)}`, { method: "DELETE", body: input });
  }

  reviewTimeRange(input: TimeReviewRequest): Promise<TimeReviewResponse> {
    return this.request("/v1/time/review", { method: "POST", body: input });
  }

  // ---- GET-40 three-scope Memory review (additive) ----
  stageMemoryProposal(body: MemoryProposalStageRequest): Promise<{ contract_version: string; replayed: boolean; proposal: unknown }> {
    return this.request("/v1/memory/proposals", { method: "POST", body });
  }

  listMemoryProposals(query: { purpose?: "chat" | "people" | "relationship"; person_id?: string | null; relationship_context_id?: string | null } = {}): Promise<MemoryProposalListResponse> {
    const params = new URLSearchParams();
    if (query.purpose) params.set("purpose", query.purpose);
    if (query.person_id) params.set("person_id", query.person_id);
    if (query.relationship_context_id) params.set("relationship_context_id", query.relationship_context_id);
    const suffix = params.toString();
    return this.request(`/v1/memory/proposals${suffix ? `?${suffix}` : ""}`, { method: "GET" });
  }

  openMemoryReview(proposalId: string, body: MemoryOpenReviewRequest): Promise<MemoryReviewResponse> {
    return this.request(`/v1/memory/proposals/${encodeURIComponent(proposalId)}/reviews`, { method: "POST", body });
  }

  rebaseMemoryProposal(proposalId: string, body: MemoryProposalRebaseRequest): Promise<MemoryProposalRebaseResponse> {
    return this.request(`/v1/memory/proposals/${encodeURIComponent(proposalId)}/rebases`, { method: "POST", body });
  }

  readMemoryReview(reviewScopeId: string, credential: string): Promise<MemoryReviewResponse> {
    return this.request(`/v1/memory/reviews/${encodeURIComponent(reviewScopeId)}`, {
      method: "GET",
      headers: { "x-memory-review-credential": credential },
    });
  }

  saveMemoryReviewDraft(reviewScopeId: string, credential: string, body: MemoryReviewDraftRequest): Promise<MemoryReviewResponse> {
    return this.request(`/v1/memory/reviews/${encodeURIComponent(reviewScopeId)}/draft`, {
      method: "PUT",
      body,
      headers: { "x-memory-review-credential": credential },
    });
  }

  commitMemoryReview(reviewScopeId: string, credential: string, body: MemoryCommitRequest): Promise<MemoryCommitResponse> {
    return this.request(`/v1/memory/reviews/${encodeURIComponent(reviewScopeId)}/commits`, {
      method: "POST",
      body,
      headers: { "x-memory-review-credential": credential },
    });
  }

  decideMemoryContactOnly(reviewScopeId: string, credential: string, body: MemoryContactOnlyDecisionRequest): Promise<MemoryContactOnlyDecisionResponse> {
    return this.request(`/v1/memory/reviews/${encodeURIComponent(reviewScopeId)}/contact-decisions`, {
      method: "POST", body,
      headers: { "x-memory-review-credential": credential },
    });
  }

  decideMemoryReviewItem(reviewScopeId: string, credential: string, body: MemoryItemDecisionRequest): Promise<MemoryItemDecisionResponse> {
    return this.request(`/v1/memory/reviews/${encodeURIComponent(reviewScopeId)}/item-decisions`, {
      method: "POST",
      body,
      headers: { "x-memory-review-credential": credential },
    });
  }

  dismissMemoryReview(reviewScopeId: string, credential: string, body: MemoryDismissRequest): Promise<MemoryDismissResponse> {
    return this.request(`/v1/memory/reviews/${encodeURIComponent(reviewScopeId)}/dismissals`, {
      method: "POST",
      body,
      headers: { "x-memory-review-credential": credential },
    });
  }

  readMemoryOperation(operationKey: string): Promise<MemoryOperationReadback> {
    return this.request(`/v1/memory/operations/${encodeURIComponent(operationKey)}`, { method: "GET" });
  }

  readMemoryOperationView(operationKey: string, query: { purpose: "chat" | "people" | "relationship"; person_id?: string | null; relationship_context_id?: string | null }): Promise<MemoryScopedOperationView> {
    const params = new URLSearchParams({ purpose: query.purpose });
    if (query.person_id) params.set("person_id", query.person_id);
    if (query.relationship_context_id) params.set("relationship_context_id", query.relationship_context_id);
    return this.request(`/v1/memory/operation-views/${encodeURIComponent(operationKey)}?${params.toString()}`, { method: "GET" });
  }

  undoMemoryOperationScope(operationKey: string, body: MemoryOperationUndoRequest): Promise<MemoryOperationUndoResponse> {
    return this.request(`/v1/memory/operation-views/${encodeURIComponent(operationKey)}/undo`, { method: "POST", body });
  }

  undoMemoryCommit(commitId: string, body: MemoryUndoRequest): Promise<MemoryUndoResponse> {
    return this.request(`/v1/memory/commits/${encodeURIComponent(commitId)}/undo`, { method: "POST", body });
  }

  recallMemories(query: { surface: "chat" | "people" | "relationship"; person_id?: string | null; relationship_context_id?: string | null; limit?: number }): Promise<MemoryRecallResponse> {
    const params = new URLSearchParams({ surface: query.surface });
    if (query.person_id) params.set("person_id", query.person_id);
    if (query.relationship_context_id) params.set("relationship_context_id", query.relationship_context_id);
    if (query.limit) params.set("limit", String(query.limit));
    return this.request(`/v1/memory/items?${params.toString()}`, { method: "GET" });
  }

  mutateMemoryItem(itemId: string, body: MemoryItemMutationRequest): Promise<MemoryItemMutationResponse> {
    return this.request(`/v1/memory/items/${encodeURIComponent(itemId)}/mutations`, { method: "POST", body });
  }

  resolveMemoryPursuitScopes(pursuitId: string): Promise<MemoryPursuitScopesResponse> {
    return this.request(`/v1/memory/pursuits/${encodeURIComponent(pursuitId)}/scopes`, { method: "GET" });
  }

  private async request<T>(
    path: string,
    options: {
      method: "DELETE" | "GET" | "POST" | "PUT";
      body?: unknown;
      authenticated?: boolean;
      signal?: AbortSignal;
      headers?: Record<string, string>;
    },
  ): Promise<T> {
    const response = await this.rawRequest(path, {
      method: options.method,
      headers: {
        accept: "application/json",
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(options.headers ?? {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      authenticated: options.authenticated,
      signal: options.signal,
    });

    const payload = (await response.json()) as T | ErrorEnvelope;
    if (!response.ok) {
      const envelope = payload as ErrorEnvelope;
      throw new TalentSignalHttpError(
        response.status,
        envelope.error?.code ?? "HTTP_ERROR",
        envelope.error?.message ?? `Request failed with ${response.status}.`,
        envelope.error?.details,
      );
    }
    return payload as T;
  }

  private async rawRequest(
    path: string,
    options: {
      method: "DELETE" | "GET" | "POST" | "PUT";
      body?: BodyInit;
      headers?: Record<string, string>;
      authenticated?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    const authenticated = options.authenticated ?? true;
    if (authenticated && !this.accessToken) {
      throw new Error("An access token is required for this request.");
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method,
      headers: {
        ...(options.headers ?? {}),
        "x-talent-signal-platform": this.clientPlatform,
        ...(authenticated
          ? { authorization: `Bearer ${this.accessToken}` }
          : {}),
      },
      body: options.body,
      signal: options.signal,
    });
    if (!response.ok) {
      let envelope: ErrorEnvelope = {};
      try {
        envelope = (await response.clone().json()) as ErrorEnvelope;
      } catch {
        // Binary endpoints may fail before producing a JSON envelope.
      }
      throw new TalentSignalHttpError(
        response.status,
        envelope.error?.code ?? "HTTP_ERROR",
        envelope.error?.message ?? `Request failed with ${response.status}.`,
        envelope.error?.details,
      );
    }
    return response;
  }
}

/**
 * Operator provisioning client for the `capir test ...` surfaces (Task 1).
 *
 * It authenticates with a high-entropy provisioning key (or the trusted Web
 * consumer key for the private handoff exchange), never a human session, and
 * never logs or echoes passwords, keys or handoff secrets. Every request
 * refuses HTTP redirects and is bounded by a timeout: a hostile or misrouted
 * endpoint can never receive the provisioning credential, the password or the
 * Web consumer key through a followed redirect. Transport failures surface as
 * one stable sanitized error that carries no URL, header or body material.
 */
export class CapirTestProvisioningClient {
  readonly baseUrl: string;
  private readonly provisioningKey: string | undefined;
  private readonly backendOrigin: string | undefined;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string,
    options: {
      provisioningKey?: string;
      backendOrigin?: string;
      timeoutMs?: number;
    } = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.provisioningKey = options.provisioningKey;
    this.backendOrigin = options.backendOrigin;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  capabilities(): Promise<CapirTestCapabilitiesResponse> {
    return this.request<CapirTestCapabilitiesResponse>(
      "/v1/capir/capabilities",
      { method: "GET" },
    );
  }

  create(request: CapirTestCreateRequest): Promise<CapirTestRun> {
    return this.request<{ run: CapirTestRun }>("/v1/capir/tests", {
      method: "POST",
      body: request,
    }).then((response) => response.run);
  }

  status(runId: string): Promise<CapirTestRun> {
    return this.request<{ run: CapirTestRun }>(
      `/v1/capir/tests/${encodeURIComponent(runId)}`,
      { method: "GET" },
    ).then((response) => response.run);
  }

  stop(runId: string, request: CapirTestStopRequest): Promise<CapirTestRun> {
    return this.request<{ run: CapirTestRun }>(
      `/v1/capir/tests/${encodeURIComponent(runId)}/stop`,
      { method: "POST", body: request },
    ).then((response) => response.run);
  }

  createHandoff(
    runId: string,
    request: CapirTestHandoffRequest,
  ): Promise<CapirTestHandoffResponse> {
    return this.request<CapirTestHandoffResponse>(
      `/v1/capir/tests/${encodeURIComponent(runId)}/handoffs`,
      { method: "POST", body: request },
    );
  }

  /** Private Web-consumer exchange; consumes the one-use handoff secret. */
  exchangeHandoff(
    webConsumerKey: string,
    request: CapirTestHandoffExchangeRequest,
  ): Promise<CapirTestHandoffExchangeResponse> {
    return this.request<CapirTestHandoffExchangeResponse>(
      "/v1/capir/tests/handoffs/exchange",
      {
        method: "POST",
        body: request,
        headers: { "x-capir-web-consumer-key": webConsumerKey },
      },
    );
  }

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST";
      body?: unknown;
      headers?: Record<string, string>;
    },
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          accept: "application/json",
          ...(options.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...(this.provisioningKey
            ? { authorization: `Bearer ${this.provisioningKey}` }
            : {}),
          ...(this.backendOrigin
            ? { "x-capir-backend-origin": this.backendOrigin }
            : {}),
          ...(options.headers ?? {}),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        // Never follow a redirect: credentials and secrets must not be
        // replayed to another origin or path.
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Stable sanitized transport failure (redirect refused, timeout, DNS,
      // TLS or connection errors): no URL, header or body material leaks.
      throw new TalentSignalHttpError(
        0,
        "CAPIR_TEST_TRANSPORT_FAILED",
        "The provisioning request could not reach the configured service.",
        undefined,
      );
    }
    let payload: unknown = {};
    try {
      payload = await response.json();
    } catch {
      // Non-JSON failures still surface as a typed error below.
    }
    if (!response.ok) {
      const envelope = payload as ErrorEnvelope;
      throw new TalentSignalHttpError(
        response.status,
        envelope.error?.code ?? "HTTP_ERROR",
        envelope.error?.message ?? `Request failed with ${response.status}.`,
        envelope.error?.details,
      );
    }
    return payload as T;
  }
}
