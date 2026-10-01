import { requestLoggerOptions } from "./lib/requestLogger.js";
import {RunArtifactSchema} from "@talent-signal/contracts";
import {listHarnessRunArtifacts,readHarnessRunArtifact} from "./modules/harnessRunFiles.js";
import { registerProductRunMonitoring } from "./modules/productRuns.js";
import { registerAccountManagement } from "./modules/accountManagementRoutes.js";
import type { MailDelivery } from "./lib/mail.js";
import { registerAccountOnboarding } from "./modules/accountOnboardingRoutes.js";
import { registerAgentSessionRoutes } from "./modules/agentSessionRoutes.js";
import { registerConversationQueueRoutes } from "./modules/conversationQueueRoutes.js";
import { registerDesktopCaptureContext } from "./modules/desktopCaptureContext.js";
import { registerDesktopCaptureReceipt } from "./modules/desktopCaptureReceipt.js";
import { registerDesktopBrowserLogin } from "./routes/desktopBrowserLogin.js";
import { postgresDesktopBrowserLoginDb, sweepDesktopBrowserLoginAttempts } from "./modules/desktopBrowserLogin.js";
import { ConversationQueueRunner, type ConversationQueueProviderSelector } from "./modules/conversationQueueRunner.js";
import { registerMeetingDraftRoutes } from "./modules/meetingDraftRoutes.js";
import { registerTimeWorkspaceRoutes } from "./modules/timeWorkspaceRoutes.js";
import { registerAgentPreferenceRoutes } from "./modules/agentPreferenceRoutes.js";
import { registerWeeklyUsageRoutes } from "./modules/weeklyUsage.js";
import { registerMcpExtensionRoutes } from "./modules/mcpRoutes.js";
import { registerScreenshotContactRoutes } from "./modules/screenshotContactRoutes.js";
import { registerMemoryReviewRoutes } from "./modules/memoryReviewRoutes.js";
import { createMemoryProposalRegenerator } from "./modules/memoryRegenerationAgent.js";
import { createMemoryRegenerationImageLoader } from "./modules/memoryRegenerationImageLoader.js";
import { registerSystemHealthRoutes } from "./modules/systemHealth.js";
import { registerReadinessRoutes } from "./modules/readinessRoutes.js";
import { registerFeedbackRoutes } from "./modules/feedbackRoutes.js";
import { registerGoogleAuth } from "./modules/googleAuth.js";
import { registerLabDiagnostics } from "./lib/labDiagnostics.js";
import { registerRecurringJob } from "./lib/recurringJob.js";
import { LabTaskTrialService } from "./modules/labTaskTrials.js";
import { registerLabTaskTrialRoutes } from "./modules/labTaskTrialRoutes.js";
import { LabFeatureOverrideService } from "./modules/labFeatureOverrides.js";
import { registerLabFeatureOverrideRoutes } from "./modules/labFeatureOverrideRoutes.js";
import { LabWorkspaceService } from "./modules/labWorkspaces.js";
import { registerLabWorkspaceRoutes } from "./modules/labWorkspaceRoutes.js";
import { LabExperimentJobService } from "./modules/labExperimentJobs.js";
import { registerLabJobRoutes } from "./modules/labJobRoutes.js";
import { environmentLabCIVerifier, type LabCIVerifying } from "./modules/labCIVerifier.js";
import { randomUUID } from "node:crypto";
import { sweepRuntimeObservationSources } from "./modules/runtimeObservationLifecycle.js";
import { startProductRunProjection } from "./modules/productRunProjection.js";

import {
  AgentRunResponseSchema,
  AgentDecisionResolutionResponseSchema,
  AgentTaskEventsResponseSchema,
  AgentTaskListResponseSchema,
  AgentTaskResponseSchema,
  AnalysisProposalResponseSchema,
  AppleLoginChallengeRequestSchema,
  AppleLoginChallengeResponseSchema,
  AppleLoginRequestSchema,
  ApproveActionRequestSchema,
  ApproveEffectReversalRequestSchema,
  ApprovalResponseSchema,
  AssertionDecisionRequestSchema,
  AssertionDecisionResponseSchema,
  CaptureResponseSchema,
  CaptureIdentityCorrectionRequestSchema,
  CaptureIdentityCorrectionResponseSchema,
  ChatTaskRequestSchema,
  ChatTaskReadbackSchema,
  ChatTaskResponseSchema,
  UnscopedChatTaskRequestSchema,
  UnscopedChatTaskResponseSchema,
  PersonResearchTaskRequestSchema,
  PersonResearchTaskResponseSchema,
  ChatMediaAssetSchema,
  ChatMediaDeleteResponseSchema,
  CreateChatMediaRequestSchema,
  CompileKnowledgeRequestSchema,
  CONTRACT_VERSION,
  CompletePursuitActionRequestSchema,
  CancelAgentTaskRequestSchema,
  CreatePursuitAgentRunRequestSchema,
  CreatePursuitAgentTaskRequestSchema,
  CreateCaptureRequestSchema,
  CreatePursuitRequestSchema,
  DeleteCaptureRequestSchema,
  DeleteCaptureResponseSchema,
  DeletionLineageResponseSchema,
  EffectResultResponseSchema,
  EffectReversalApprovalResponseSchema,
  EffectReversalPreviewSchema,
  EffectReversalResultResponseSchema,
  EvidenceFragmentReviewRequestSchema,
  EvidenceFragmentReviewResponseSchema,
  IdentityResolutionCaseSchema,
  IdentityResolutionDecisionRequestSchema,
  IdentityResolutionDecisionResponseSchema,
  ErrorResponseSchema,
  ExecuteActionRequestSchema,
  ExecuteEffectReversalRequestSchema,
  ReconcileEffectRequestSchema,
  ResourceCaptureRequestSchema,
  ResourceCaptureResponseSchema,
  RelationshipResourceDetailSchema,
  RelationshipResourceListResponseSchema,
  RelationshipAgentHistorySchema,
  RelationshipScopeSchema,
  RevokeApprovalRequestSchema,
  RevokeCapabilityRequestSchema,
  PersonDirectoryResponseSchema,
  PersonMergePreviewSchema,
  PersonMergeRequestSchema,
  PersonMergeResponseSchema,
  PersonMergeReversalPreviewSchema,
  PersonMergeReversalRequestSchema,
  PursuitProposalResponseSchema,
  PursuitProposalListResponseSchema,
  PursuitProposalReviewResponseSchema,
  PursuitDetailResponseSchema,
  PursuitListResponseSchema,
  PursuitMutationResponseSchema,
  PursuitOperationResponseSchema,
  PublicResearchRequestSchema,
  PublicResearchResponseSchema,
  KnowledgeSnapshotSchema,
  LabComparisonResponseSchema,
  LabEvalCaseResponseSchema,
  LabManifestResponseSchema,
  LabRunResponseSchema,
  LabSessionResponseSchema,
  CurrentSessionResponseSchema,
  LogoutResponseSchema,
  PasswordLoginRequestSchema,
  PromoteRealityReceiptRequestSchema,
  RealityReceiptResponseSchema,
  ReviseActionRequestSchema,
  RevisePursuitRequestSchema,
  ReviewPursuitProposalRequestSchema,
  ResolveAgentDecisionBundleRequestSchema,
  SessionResponseSchema,
  SimulatedLoginRequestSchema,
  SourceRetentionReceiptSchema,
  SourceAuthorizationDecisionRequestSchema,
  SourceAuthorizationDecisionResponseSchema,
  StagePursuitProposalRequestSchema,
  StartLabSessionRequestSchema,
  RunLabScenarioRequestSchema,
  CompareLabScenarioRequestSchema,
  CreateRealityReceiptRequestSchema,
  SubmitAnalysisProposalRequestSchema,
  SyncResponseSchema,
  TemporalStateResponseSchema,
  AppendTelemetryBatchRequestSchema,
  CompleteTelemetryTraceRequestSchema,
  CreateTelemetryTraceRequestSchema,
  TelemetryMutationResponseSchema,
  TelemetryTraceDetailResponseSchema,
  TelemetryTraceListResponseSchema,
  WorkspaceReviewResponseSchema,
  type ApproveActionRequest,
  type AppleLoginChallengeRequest,
  type AppleLoginRequest,
  type ApproveEffectReversalRequest,
  type AssertionDecisionRequest,
  type CreateCaptureRequest,
  type CreatePursuitRequest,
  type CompletePursuitActionRequest,
  type CancelAgentTaskRequest,
  type CaptureIdentityCorrectionRequest,
  type ChatTaskRequest,
  type UnscopedChatTaskRequest,
  type CreateChatMediaRequest,
  type PersonResearchTaskRequest,
  type CompileKnowledgeRequest,
  type CreatePursuitAgentRunRequest,
  type CreatePursuitAgentTaskRequest,
  type DeleteCaptureRequest,
  type ExecuteActionRequest,
  type ExecuteEffectReversalRequest,
  type EvidenceFragmentReviewRequest,
  type IdentityResolutionDecisionRequest,
  type PersonMergeRequest,
  type PersonMergeReversalRequest,
  type PasswordLoginRequest,
  type PromoteRealityReceiptRequest,
  type ReconcileEffectRequest,
  type PublicResearchRequest,
  type ResourceCaptureRequest,
  type RevokeApprovalRequest,
  type RevokeCapabilityRequest,
  type ReviseActionRequest,
  type RevisePursuitRequest,
  type ReviewPursuitProposalRequest,
  type ResolveAgentDecisionBundleRequest,
  type SimulatedLoginRequest,
  type SourceAuthorizationDecisionRequest,
  type StagePursuitProposalRequest,
  type StartLabSessionRequest,
  type RunLabScenarioRequest,
  type CompareLabScenarioRequest,
  type CreateRealityReceiptRequest,
  type SubmitAnalysisProposalRequest,
  type AppendTelemetryBatchRequest,
  type CompleteTelemetryTraceRequest,
  type CreateTelemetryTraceRequest,
} from "@talent-signal/contracts";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import type { Pool } from "pg";
import { LabExperimentService, labModelProviders } from "./modules/labExperiments.js";
import { registerLabExperimentRoutes } from "./modules/labExperimentRoutes.js";
import { registerRuntimeManifest, registerLoadedRuntimeConfiguration } from "./modules/runtimeManifest.js";
import { captureDeploymentExposure, assertCandidateDeploymentExposure } from "./modules/deploymentExposure.js";

import type { BackendConfig } from "./config.js";
import { ApiError } from "./lib/apiError.js";
import type { AuthContext } from "./modules/auth.js";
import {
  createPursuitAgentRun,
  getAgentRun,
} from "./modules/agentRuns.js";
import { getRelationshipAgentHistory } from "./modules/agentHistory.js";
import {
  assertProposalReviewNotAgentCorrelated,
  cancelAgentTask,
  createPursuitAgentTask,
  getAgentTask,
  getAgentTaskEvents,
  listPursuitAgentTasks,
  resolveAgentDecisionBundle,
} from "./modules/agentTasks.js";
import {
  approveAction,
  approveEffectReversal,
  executeAction,
  executeEffectReversal,
  previewEffectReversal,
  reconcileEffect,
  reviseAction,
  revokeApproval,
  revokeCapability,
  revokeEffectReversalApproval,
} from "./modules/actions.js";
import {
  type AppleTokenVerifying,
  createAppleLoginChallenge,
  createAppleSession,
  createAuthGuard,
  createPasswordSession,
  createSimulatedSession,
  currentSession,
  revokeCurrentSession,
} from "./modules/auth.js";
import {
  createCapture,
  deleteCapture,
  getDeletionLineage,
  getCapture,
  getTemporalState,
} from "./modules/captures.js";
import { decideAssertion } from "./modules/decisions.js";
import { createChatTask, getChatTaskReadback } from "./modules/chat.js";
import { createUnscopedChatTask } from "./modules/unscopedChat.js";
import {
  createEnvironmentPersonResearchAgentClient,
  type PersonResearchAgentProviding,
} from "./modules/personResearchAgentClient.js";
import { createPersonResearchTask } from "./modules/personResearchTasks.js";
import { loadContactIntelligence, expireScreenshotContactTasks,
  environmentScreenshotContactDependencies, ScreenshotContactTaskRunner,
  type ScreenshotContactDependencies } from "./modules/screenshotContactTasks.js";
import { purgeContactImagesForCapture } from "./modules/contactTaskImages.js";
import { executeGrantedContactArchive, restoreContactArchive } from "./modules/contactArchive.js";
import {
  createEnvironmentChatAnswerProvider,
  type RemoteChatAnswerProviding,
} from "./modules/chatAnswerProvider.js";
import {
  createEnvironmentPrivateConversationProvider,
  isPrivateConversationRequest,
  registerPrivateConversationRoutes,
  type PrivateConversationProvider,
} from "./modules/privateConversation.js";
import {
  CHAT_MEDIA_MAX_BYTES,
  createChatMediaAsset,
  deleteChatMediaAsset,
  getChatMediaContent,
  uploadChatMediaContent,
} from "./modules/chatMedia.js";
import {
  createChatMediaStorage,
  type ChatMediaStorage,
} from "./modules/chatMediaStorage.js";
import {
  decideIdentityResolutionCase,
  getIdentityResolutionCase,
} from "./modules/identityCases.js";
import { correctCaptureIdentity } from "./modules/identityCorrections.js";
import {
  mergePeople,
  previewPersonMerge,
  previewPersonMergeReversal,
  reversePersonMerge,
} from "./modules/personMerges.js";
import {
  decideCaptureSourceAuthorization,
  persistSourceAuthorizationCompilation,
} from "./modules/sourceAuthorization.js";
import { runSourceLifecycleSweep } from "./modules/sourceLifecycle.js";
import {
  getRelationshipScope,
  listPeople,
  searchPeople,
} from "./modules/people.js";
import {
  completePursuitAction,
  createPursuit,
  getPursuit,
  getPursuitOperation,
  listPursuits,
  revisePursuit,
} from "./modules/pursuits.js";
import {
  getPursuitProposal,
  listPursuitProposals,
  reviewPursuitProposal,
  stagePursuitProposal,
  type ProposalReviewConflict,
} from "./modules/pursuitProposals.js";
import { createResourceCapture, loadResourceCapture } from "./modules/resourceIntake.js";
import { prepareCaptureReview } from "./modules/captureReview.js";
import {
  getLatestPublicResearchTask,
  runPublicResearch,
} from "./modules/research.js";
import {
  getRelationshipResource,
  listRelationshipResources,
  reviewEvidenceFragment,
} from "./modules/resources.js";
import {
  compileRelationshipWiki,
  getRelationshipWiki,
} from "./modules/wiki.js";
import { submitAnalysisProposal } from "./modules/proposals.js";
import { readSyncEvents } from "./modules/sync.js";
import {
  getSourceRetentionReceipt,
  getSourceRetentionReceiptByLocator,
} from "./modules/sourceRetention.js";
import { getWorkspaceReview } from "./modules/workspace.js";
import {
  appendTelemetryBatch,
  completeTelemetryTrace,
  createTelemetryTrace,
  getTelemetryArtifactContent,
  getTelemetryTrace,
  listTelemetryTraces,
} from "./modules/telemetry.js";
import {
  compareLabScenario,
  createRealityReceipt,
  getLabManifest,
  promoteRealityReceipt,
  runLabScenario,
  startLabSession,
} from "./modules/lab.js";
import {
  EnvironmentDoubaoVoiceTranscriber,
  type VoiceTranscriptionServing,
  voiceTranscriptionLimits,
} from "./modules/voiceTranscription.js";

const IdParamsSchema = Type.Object(
  { id: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
);
const TraceParamsSchema = Type.Object(
  { traceId: Type.String({ pattern: "^[0-9a-f]{32}$" }) },
  { additionalProperties: false },
);
const TraceListQuerySchema = Type.Object(
  {
    limit: Type.Optional(
      Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$" }),
    ),
  },
  { additionalProperties: false },
);
const SyncQuerySchema = Type.Object(
  {
    after: Type.Optional(
      Type.String({ pattern: "^[0-9]+$", default: "0" }),
    ),
  },
  { additionalProperties: false },
);
const AgentTaskListQuerySchema = Type.Object(
  {
    state: Type.Optional(
      Type.Union([Type.Literal("active"), Type.Literal("all")], {
        default: "active",
      }),
    ),
  },
  { additionalProperties: false },
);
const AgentTaskEventsQuerySchema = Type.Object(
  {
    after: Type.Optional(Type.String({ pattern: "^[0-9]+$", default: "0" })),
  },
  { additionalProperties: false },
);
const StateQuerySchema = Type.Object(
  { assignment_id: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
);
const WorkspaceReviewQuerySchema = Type.Object(
  {
    fixture_case_id: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 80,
        pattern: "^TS-[A-Z]+-[0-9]{2}$",
      }),
    ),
    capture_id: Type.Optional(Type.String({ format: "uuid" })),
  },
  { additionalProperties: false },
);
const SourceLocatorQuerySchema = Type.Object(
  {
    source_locator: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);
const PeopleQuerySchema = Type.Object(
  {
    query: Type.Optional(Type.String({ maxLength: 160 })),
  },
  { additionalProperties: false },
);
const PeopleSearchSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);
const PersonMergePreviewQuerySchema = Type.Object(
  {
    source_person_id: Type.String({ format: "uuid" }),
    target_person_id: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
);
const PersonContextParamsSchema = Type.Object(
  {
    personId: Type.String({ format: "uuid" }),
    contextId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
);
const VoiceTranscriptionRequestSchema = Type.Object(
  {
    audio_base64: Type.String({
      minLength: 60,
      maxLength: voiceTranscriptionLimits.maxBase64Characters,
      pattern: "^[A-Za-z0-9+/]+={0,2}$",
    }),
    client_request_id: Type.String({ format: "uuid" }),
    mime_type: Type.Literal("audio/wav"),
  },
  { additionalProperties: false },
);
const VoiceTranscriptionResponseSchema = Type.Object(
  {
    audio_duration_ms: Type.Optional(Type.Number({ minimum: 0 })),
    client_request_id: Type.String({ format: "uuid" }),
    model: Type.String({ minLength: 1 }),
    provider: Type.Literal("doubao"),
    provider_request_id: Type.String({ format: "uuid" }),
    status: Type.Literal("draft"),
    temporary_audio_stored_by_talent_signal: Type.Literal(false),
    transcript: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export interface AppDependencies {
  appleTokenVerifier?: AppleTokenVerifying;
  config: BackendConfig;
  pool: Pool;
  voiceTranscriber?: VoiceTranscriptionServing;
  chatMediaStorage?: ChatMediaStorage;
  remoteChatProvider?: RemoteChatAnswerProviding | null;
  privateConversationProvider?: PrivateConversationProvider | null;
  labProviders?: Map<string, RemoteChatAnswerProviding>;
  labJobWorkerEnabled?: boolean;
  /** Disable background queue execution only for an explicitly isolated host/test. */
  conversationQueueWorkerEnabled?: boolean;
  labCIVerifier?: LabCIVerifying | null;
  personResearchProvider?: PersonResearchAgentProviding | null;
  /** Isolated mail sink for evaluations; production uses the configured transport. */
  mail?: MailDelivery;
  screenshotContact?: ScreenshotContactDependencies | null;
  /** Host-only reference clock for reproducible relative-date evaluations. */
  chatReferenceClock?: () => Date;
}

export async function buildApp(
  dependencies: AppDependencies,
): Promise<FastifyInstance> {
  const { appleTokenVerifier, config, pool } = dependencies;
  const screenshotContact = dependencies.screenshotContact === undefined
    ? environmentScreenshotContactDependencies() : dependencies.screenshotContact;
  const remoteChatProvider = dependencies.remoteChatProvider === undefined
    ? createEnvironmentChatAnswerProvider()
    : dependencies.remoteChatProvider;
  const privateConversationProvider = dependencies.privateConversationProvider === undefined
    ? createEnvironmentPrivateConversationProvider()
    : dependencies.privateConversationProvider;
  const deploymentExposure = captureDeploymentExposure();
  assertCandidateDeploymentExposure(deploymentExposure, remoteChatProvider?.loadedTaskConfiguration);
  const personResearchProvider =
    dependencies.personResearchProvider === undefined
      ? createEnvironmentPersonResearchAgentClient()
      : dependencies.personResearchProvider;
  const voiceTranscriber =
    dependencies.voiceTranscriber ?? new EnvironmentDoubaoVoiceTranscriber();
  const chatMediaStorage =
    dependencies.chatMediaStorage ?? createChatMediaStorage(config);
  const screenshotRunner = screenshotContact ? new ScreenshotContactTaskRunner(pool,screenshotContact,chatMediaStorage) : null;
  const app = Fastify({
    ...(config.tls
      ? { https: { cert: config.tls.certificatePem, key: config.tls.privateKeyPem } }
      : {}),
    logger: requestLoggerOptions(),
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    bodyLimit: 2 * 1024 * 1024,
  });

  registerLabDiagnostics(app, config.internalLabEnabled === true);
  app.addHook("onReady", async () => {
    await sweepRuntimeObservationSources(pool).catch(() => {
      app.log.error({ code: "RUNTIME_OBSERVATION_SOURCE_RECONCILIATION_PENDING" }, "Private observation source reconciliation will retry.");
    });
  });
  app.addHook("onResponse", async (request, reply) => {
    // The private transport keeps no product-run or observation footprint; its
    // hijacked stream never triggers the reconciliation sweep.
    if (isPrivateConversationRequest(request)) return;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && reply.statusCode < 400) {
      await sweepRuntimeObservationSources(pool).catch(() => {
        request.log.error({ code: "RUNTIME_OBSERVATION_SOURCE_RECONCILIATION_PENDING" }, "Private observation source reconciliation will retry.");
      });
    }
  });

  app.addContentTypeParser(
    /^image\//,
    { parseAs: "buffer", bodyLimit: CHAT_MEDIA_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.decorateRequest("auth", null as unknown as AuthContext);
  await app.register(cors, {
    exposedHeaders: ["x-talent-signal-lab-trace"],
    credentials: false,
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  });
  await app.register(rateLimit, {
    global: false,
    max: 60,
    timeWindow: "1 minute",
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Talent Signal Local Shared Authority API",
        description:
          "Account-scoped localhost contract. All effects are labeled deterministic simulations.",
        version: CONTRACT_VERSION,
      },
      servers: [{ url: `${config.tls ? "https" : "http"}://localhost:${config.port}` }],
      components: {
        securitySchemes: {
          bearerSession: {
            type: "http",
            scheme: "bearer",
          },
        },
      },
    },
  });

  app.setErrorHandler((error, request, reply) => {
    if ((error as {code?:string;message?:string}).code === "P0001" && (error as {message?:string}).message === "LAB_TEST_WORKSPACE_CLOSED") {
      void reply.status(410).send({error:{code:"LAB_TEST_WORKSPACE_CLOSED",message:"This test workspace no longer accepts changes.",request_id:request.id}});
      return;
    }
    if (error instanceof ApiError) {
      void reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          request_id: request.id,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      void reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Retry after the current window.",
          request_id: request.id,
        },
      });
      return;
    }
    const validation = (error as { validation?: unknown }).validation;
    if (validation) {
      void reply.status(400).send({
        error: {
          code: "REQUEST_VALIDATION_FAILED",
          message: "The request does not match the versioned contract.",
          request_id: request.id,
          details: validation,
        },
      });
      return;
    }
    request.log.error(
      { err: error },
      "Unhandled control-plane request failure",
    );
    void reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        request_id: request.id,
      },
    });
  });

  registerReadinessRoutes(app, pool);
  app.get("/v1/meta", async () => ({
    contract_version: CONTRACT_VERSION,
    authority: "account_scoped_backend",
    effect_adapters: [
      {
        id: "local_deterministic",
        simulated: true,
        production_write: false,
      },
    ],
  }));
  app.get("/v1/openapi.json", async () => app.swagger());

  app.post<{ Body: SimulatedLoginRequest }>(
    "/v1/auth/simulated-login",
    {
      schema: {
        tags: ["auth"],
        body: SimulatedLoginRequestSchema,
        response: {
          200: SessionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      createSimulatedSession(pool, config, request.body),
  );

  app.post<{ Body: PasswordLoginRequest }>(
    "/v1/auth/password/login",
    {
      config: {
        rateLimit: {
          max: 12,
          timeWindow: "1 minute",
        },
      },
      schema: {
        tags: ["auth"],
        body: PasswordLoginRequestSchema,
        response: {
          200: SessionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => createPasswordSession(pool, config, request.body),
  );

  // Verified password signup (start + confirm) is registered with the account
  // credential routes so delivery configuration and verification stay together.

  app.post<{ Body: AppleLoginChallengeRequest }>(
    "/v1/auth/apple/challenges",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
      schema: {
        tags: ["auth"],
        body: AppleLoginChallengeRequestSchema,
        response: {
          201: AppleLoginChallengeResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await createAppleLoginChallenge(pool, config, request.body)),
  );

  app.post<{ Body: AppleLoginRequest }>(
    "/v1/auth/apple",
    {
      config: {
        rateLimit: {
          max: 12,
          timeWindow: "1 minute",
        },
      },
      schema: {
        tags: ["auth"],
        body: AppleLoginRequestSchema,
        response: {
          200: SessionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      createAppleSession(
        pool,
        config,
        request.body,
        appleTokenVerifier,
      ),
  );

  registerGoogleAuth(app, pool, config);
  const authenticate = createAuthGuard(pool, deploymentExposure?.workspaceIds);
  registerProductRunMonitoring(app, pool, authenticate);
  registerAccountManagement(app, pool, authenticate, config, dependencies.mail);
  registerAccountOnboarding(app, pool, authenticate);
  registerAgentSessionRoutes(app, pool, authenticate);
  registerMemoryReviewRoutes(
    app,
    pool,
    authenticate,
    createMemoryProposalRegenerator(remoteChatProvider),
    createMemoryRegenerationImageLoader(pool),
  );
  registerConversationQueueRoutes(app, pool, authenticate);
  registerDesktopCaptureReceipt(app, pool, authenticate);
  registerDesktopBrowserLogin(app, pool, config, authenticate);
  registerMeetingDraftRoutes(app, pool, authenticate);
  registerTimeWorkspaceRoutes(app, pool, authenticate, remoteChatProvider);
  registerFeedbackRoutes(app, pool, authenticate);
  const security = [{ bearerSession: [] }];
  registerAgentPreferenceRoutes(app, pool, authenticate, remoteChatProvider?.providerId === "claude-agent-sdk");
  registerWeeklyUsageRoutes(app, pool, authenticate);
  registerPrivateConversationRoutes(app, authenticate, privateConversationProvider);
  registerMcpExtensionRoutes(app, pool, authenticate, {
    allowedOrigins: [],
    deploymentWorkspaceIds: deploymentExposure?.workspaceIds,
  });
  registerSystemHealthRoutes(app, pool, authenticate);
  registerRuntimeManifest(app, config);
  registerLoadedRuntimeConfiguration(app, config, authenticate, remoteChatProvider?.loadedTaskConfiguration, deploymentExposure);
  registerLabWorkspaceRoutes(app,new LabWorkspaceService(pool,chatMediaStorage,config.sessionTtlSeconds),authenticate,config.internalLabEnabled===true);

  const labProviders = dependencies.labProviders ?? labModelProviders(remoteChatProvider);
  registerDesktopCaptureContext(app, authenticate, remoteChatProvider, labProviders, config.internalLabEnabled === true);
  const labTrials = new LabTaskTrialService(pool, labProviders, remoteChatProvider,
    process.env.TALENT_SIGNAL_BACKEND_REVISION?.trim() || null);
  registerLabTaskTrialRoutes(app, labTrials, authenticate, config.internalLabEnabled === true);
  const labFeatures = new LabFeatureOverrideService(pool,
    process.env.TALENT_SIGNAL_BACKEND_REVISION?.trim() || null);
  registerLabFeatureOverrideRoutes(app, labFeatures, authenticate, config.internalLabEnabled === true);
  registerLabJobRoutes(app, new LabExperimentJobService(pool, labProviders,
    process.env.TALENT_SIGNAL_BACKEND_REVISION?.trim() || null,
    Number(process.env.TALENT_SIGNAL_LAB_DAILY_CALL_LIMIT ?? "240")), authenticate,
    config.internalLabEnabled === true, dependencies.labJobWorkerEnabled !== false,
    config.internalLabEnabled ? dependencies.labCIVerifier === undefined ? environmentLabCIVerifier() : dependencies.labCIVerifier : null);
  registerLabExperimentRoutes(app, new LabExperimentService(pool,
    labProviders,
    process.env.TALENT_SIGNAL_BACKEND_REVISION?.trim() || null), authenticate,
    config.internalLabEnabled === true);

  app.get(
    "/v1/lab",
    {
      preHandler: authenticate,
      schema: {
        tags: ["lab", "evaluation"],
        security,
        response: {
          200: LabManifestResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => getLabManifest(pool, config, request.auth),
  );

  app.post<{ Body: StartLabSessionRequest }>(
    "/v1/lab/sessions",
    {
      preHandler: authenticate,
      schema: {
        tags: ["lab", "evaluation"],
        security,
        body: StartLabSessionRequestSchema,
        response: {
          201: LabSessionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await startLabSession(pool, config, request.auth, request.body);
      request.log.info(
        {
          lab_session_id: result.session.id,
          scenario_id: result.session.scenario.id,
          snapshot_hash: result.session.scenario.snapshot_hash,
          canonical_isolation: true,
        },
        "lab session started",
      );
      return reply.status(201).send(result);
    },
  );

  app.post<{ Params: { id: string }; Body: RunLabScenarioRequest }>(
    "/v1/lab/sessions/:id/runs",
    {
      preHandler: authenticate,
      schema: {
        tags: ["lab", "evaluation"],
        security,
        params: IdParamsSchema,
        body: RunLabScenarioRequestSchema,
        response: {
          201: LabRunResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await runLabScenario(
        pool,
        config,
        request.auth,
        request.params.id,
        request.body,
      );
      request.log.info(
        {
          lab_session_id: result.run.session_id,
          lab_run_id: result.run.id,
          trace_id: result.run.trace_id,
          variant: result.run.variant,
          canonical_mutation_count: 0,
          external_effect_count: 0,
        },
        "lab scenario replayed",
      );
      return reply.status(201).send(result);
    },
  );

  app.post<{ Params: { id: string }; Body: CompareLabScenarioRequest }>(
    "/v1/lab/sessions/:id/comparisons",
    {
      preHandler: authenticate,
      schema: {
        tags: ["lab", "evaluation"],
        security,
        params: IdParamsSchema,
        body: CompareLabScenarioRequestSchema,
        response: {
          201: LabComparisonResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await compareLabScenario(
        pool,
        config,
        request.auth,
        request.params.id,
        request.body,
      );
      request.log.info(
        {
          lab_session_id: result.comparison.session_id,
          comparison_id: result.comparison.id,
          identical_snapshot: result.comparison.identical_snapshot,
          regressed_count: result.comparison.regressed_count,
        },
        "lab baseline compared",
      );
      return reply.status(201).send(result);
    },
  );

  app.post<{ Params: { id: string }; Body: CreateRealityReceiptRequest }>(
    "/v1/lab/sessions/:id/receipts",
    {
      preHandler: authenticate,
      schema: {
        tags: ["lab", "evaluation"],
        security,
        params: IdParamsSchema,
        body: CreateRealityReceiptRequestSchema,
        response: {
          201: RealityReceiptResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await createRealityReceipt(
        pool,
        config,
        request.auth,
        request.params.id,
        request.body,
      );
      request.log.info(
        {
          lab_session_id: result.receipt.session_id,
          reality_receipt_id: result.receipt.id,
          trace_id: result.receipt.trace_id,
          reproduced: result.receipt.reproduced,
          redaction_applied: true,
        },
        "lab reality receipt recorded",
      );
      return reply.status(201).send(result);
    },
  );

  app.post<{ Params: { id: string }; Body: PromoteRealityReceiptRequest }>(
    "/v1/lab/receipts/:id/promotions",
    {
      preHandler: authenticate,
      schema: {
        tags: ["lab", "evaluation"],
        security,
        params: IdParamsSchema,
        body: PromoteRealityReceiptRequestSchema,
        response: {
          201: LabEvalCaseResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await promoteRealityReceipt(
        pool,
        config,
        request.auth,
        request.params.id,
        request.body,
      );
      request.log.info(
        {
          eval_case_id: result.eval_case.id,
          eval_case_ref: result.eval_case.case_ref,
          source_receipt_id: result.eval_case.source_receipt_id,
          release_gate: result.eval_case.release_gate,
        },
        "lab reality receipt promoted",
      );
      return reply.status(201).send(result);
    },
  );

  app.post<{ Body: CreateTelemetryTraceRequest }>(
    "/v1/telemetry/traces",
    {
      bodyLimit: 12 * 1024 * 1024,
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
      preHandler: authenticate,
      schema: {
        tags: ["telemetry", "evaluation"],
        security,
        body: CreateTelemetryTraceRequestSchema,
        response: {
          201: TelemetryMutationResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await createTelemetryTrace(pool, request.auth, request.body);
      request.log.info(
        {
          trace_id: result.trace_id,
          interaction_id: result.interaction_id,
          artifact_count: result.artifact_ids.length,
          telemetry_status: result.status,
        },
        "telemetry trace created",
      );
      return reply.status(201).send(result);
    },
  );

  app.post<{
    Params: { traceId: string };
    Body: AppendTelemetryBatchRequest;
  }>(
    "/v1/telemetry/traces/:traceId/batch",
    {
      preHandler: authenticate,
      schema: {
        tags: ["telemetry", "evaluation"],
        security,
        params: TraceParamsSchema,
        body: AppendTelemetryBatchRequestSchema,
        response: {
          200: TelemetryMutationResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const result = await appendTelemetryBatch(
        pool,
        request.auth,
        request.params.traceId,
        request.body,
      );
      request.log.info(
        {
          trace_id: result.trace_id,
          interaction_id: result.interaction_id,
          accepted_spans: result.accepted_spans,
          accepted_events: result.accepted_events,
        },
        "telemetry batch appended",
      );
      return result;
    },
  );

  app.post<{
    Params: { traceId: string };
    Body: CompleteTelemetryTraceRequest;
  }>(
    "/v1/telemetry/traces/:traceId/completion",
    {
      preHandler: authenticate,
      schema: {
        tags: ["telemetry", "evaluation"],
        security,
        params: TraceParamsSchema,
        body: CompleteTelemetryTraceRequestSchema,
        response: {
          200: TelemetryMutationResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const result = await completeTelemetryTrace(
        pool,
        request.auth,
        request.params.traceId,
        request.body,
      );
      request.log.info(
        {
          trace_id: result.trace_id,
          interaction_id: result.interaction_id,
          telemetry_status: result.status,
          error_code: request.body.error_code,
        },
        "telemetry trace completed",
      );
      return result;
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    "/v1/eval/traces",
    {
      preHandler: authenticate,
      schema: {
        tags: ["telemetry", "evaluation"],
        security,
        querystring: TraceListQuerySchema,
        response: {
          200: TelemetryTraceListResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      listTelemetryTraces(
        pool,
        request.auth,
        Number.parseInt(request.query.limit ?? "100", 10),
      ),
  );

  app.get<{ Params: { traceId: string } }>(
    "/v1/eval/traces/:traceId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["telemetry", "evaluation"],
        security,
        params: TraceParamsSchema,
        response: {
          200: TelemetryTraceDetailResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getTelemetryTrace(pool, request.auth, request.params.traceId),
  );

  app.get<{ Params: { id: string } }>(
    "/v1/eval/artifacts/:id/content",
    {
      preHandler: authenticate,
      schema: {
        tags: ["telemetry", "evaluation"],
        security,
        params: IdParamsSchema,
        response: { "4xx": ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const artifact = await getTelemetryArtifactContent(
        pool,
        request.auth,
        request.params.id,
      );
      return reply
        .header("Cache-Control", "private, no-store")
        .header("Content-Disposition", "inline")
        .header("X-Content-Type-Options", "nosniff")
        .type(artifact.contentType)
        .send(artifact.body);
    },
  );

  app.post<{
    Params: { id: string };
    Body: ResolveAgentDecisionBundleRequest;
  }>(
    "/v1/decision-bundles/:id/resolve",
    {
      preHandler: authenticate,
      schema: {
        tags: ["agent-tasks", "review"],
        security,
        params: IdParamsSchema,
        body: ResolveAgentDecisionBundleRequestSchema,
        response: {
          200: AgentDecisionResolutionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await resolveAgentDecisionBundle(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get(
    "/v1/auth/session",
    {
      preHandler: authenticate,
      schema: {
        tags: ["auth"],
        security,
        response: {
          200: CurrentSessionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => currentSession(pool, request.auth),
  );

  app.post(
    "/v1/auth/logout",
    {
      preHandler: authenticate,
      schema: {
        tags: ["auth"],
        security,
        response: {
          200: LogoutResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => revokeCurrentSession(pool, request.auth),
  );

  app.post<{
    Body: {
      audio_base64: string;
      client_request_id: string;
      mime_type: "audio/wav";
    };
  }>(
    "/v1/voice-transcriptions",
    {
      bodyLimit: 3_800_000,
      config: {
        rateLimit: {
          max: 12,
          timeWindow: "1 minute",
        },
      },
      preHandler: authenticate,
      schema: {
        tags: ["voice", "agent"],
        security,
        body: VoiceTranscriptionRequestSchema,
        response: {
          200: VoiceTranscriptionResponseSchema,
          "4xx": ErrorResponseSchema,
          "5xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      voiceTranscriber.transcribe({
        audioBase64: request.body.audio_base64,
        clientRequestId: request.body.client_request_id,
        mimeType: request.body.mime_type,
      }),
  );

  app.get(
    "/v1/pursuits",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pursuits"],
        security,
        response: {
          200: PursuitListResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => listPursuits(pool, request.auth),
  );

  app.post<{ Body: CreatePursuitRequest }>(
    "/v1/pursuits",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pursuits"],
        security,
        body: CreatePursuitRequestSchema,
        response: {
          201: PursuitMutationResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await createPursuit(pool, request.auth, request.body);
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/pursuits/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pursuits"],
        security,
        params: IdParamsSchema,
        response: {
          200: PursuitDetailResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => getPursuit(pool, request.auth, request.params.id),
  );

  app.post<{
    Params: { id: string };
    Body: CreatePursuitAgentRunRequest;
  }>(
    "/v1/pursuits/:id/agent-runs",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pursuits", "agent"],
        security,
        params: IdParamsSchema,
        body: CreatePursuitAgentRunRequestSchema,
        response: {
          201: AgentRunResponseSchema,
          "4xx": ErrorResponseSchema,
          "5xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await createPursuitAgentRun(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      request.log.info(
        {
          trace_id: result.body.run.telemetry?.trace_id ?? null,
          interaction_id: result.body.run.telemetry?.interaction_id ?? null,
          agent_run_id: result.body.run.id,
          agent_status: result.body.run.status,
          tool_call_count: result.body.run.usage.tool_calls,
          terminal_reason: result.body.run.terminal_receipt?.reason_code ?? null,
        },
        "agent run completed",
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/agent-runs/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["agent"],
        security,
        params: IdParamsSchema,
        response: {
          200: AgentRunResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => getAgentRun(pool, request.auth, request.params.id),
  );

  app.post<{
    Params: { id: string };
    Body: CreatePursuitAgentTaskRequest;
  }>(
    "/v1/pursuits/:id/agent-tasks",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pursuits", "agent-tasks"],
        security,
        params: IdParamsSchema,
        body: CreatePursuitAgentTaskRequestSchema,
        response: {
          202: AgentTaskResponseSchema,
          "4xx": ErrorResponseSchema,
          "5xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await createPursuitAgentTask(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { state?: "active" | "all" };
  }>(
    "/v1/pursuits/:id/agent-tasks",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pursuits", "agent-tasks"],
        security,
        params: IdParamsSchema,
        querystring: AgentTaskListQuerySchema,
        response: {
          200: AgentTaskListResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      listPursuitAgentTasks(
        pool,
        request.auth,
        request.params.id,
        request.query.state ?? "active",
      ),
  );

  app.get<{ Params: { id: string } }>(
    "/v1/agent-tasks/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["agent-tasks"],
        security,
        params: IdParamsSchema,
        response: {
          200: AgentTaskResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => getAgentTask(pool, request.auth, request.params.id),
  );

  app.get<{
    Params: { id: string };
    Querystring: { after?: string };
  }>(
    "/v1/agent-tasks/:id/events",
    {
      preHandler: authenticate,
      schema: {
        tags: ["agent-tasks"],
        security,
        params: IdParamsSchema,
        querystring: AgentTaskEventsQuerySchema,
        response: {
          200: AgentTaskEventsResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getAgentTaskEvents(
        pool,
        request.auth,
        request.params.id,
        Number.parseInt(request.query.after ?? "0", 10),
      ),
  );

  app.post<{
    Params: { id: string };
    Body: CancelAgentTaskRequest;
  }>(
    "/v1/agent-tasks/:id/cancel",
    {
      preHandler: authenticate,
      schema: {
        tags: ["agent-tasks"],
        security,
        params: IdParamsSchema,
        body: CancelAgentTaskRequestSchema,
        response: {
          200: AgentTaskResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await cancelAgentTask(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get(
    "/v1/pursuit-proposals",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pursuits", "review"],
        security,
        response: {
          200: PursuitProposalListResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => listPursuitProposals(pool, request.auth),
  );

  app.post<{
    Params: { id: string };
    Body: RevisePursuitRequest;
  }>(
    "/v1/pursuits/:id/revisions",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pursuits"],
        security,
        params: IdParamsSchema,
        body: RevisePursuitRequestSchema,
        response: {
          200: PursuitMutationResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await revisePursuit(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{
    Params: { pursuitId: string; actionId: string };
    Body: CompletePursuitActionRequest;
  }>(
    "/v1/pursuits/:pursuitId/actions/:actionId/completions",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pursuits", "actions"],
        security,
        params: Type.Object(
          {
            pursuitId: Type.String({ format: "uuid" }),
            actionId: Type.String({ format: "uuid" }),
          },
          { additionalProperties: false },
        ),
        body: CompletePursuitActionRequestSchema,
        response: {
          200: PursuitMutationResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await completePursuitAction(
        pool,
        request.auth,
        request.params.pursuitId,
        request.params.actionId,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{
    Params: { id: string };
    Body: StagePursuitProposalRequest;
  }>(
    "/v1/pursuits/:id/proposals",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pursuits", "review"],
        security,
        params: IdParamsSchema,
        body: StagePursuitProposalRequestSchema,
        response: {
          201: PursuitProposalResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await stagePursuitProposal(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/pursuit-proposals/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pursuits", "review"],
        security,
        params: IdParamsSchema,
        response: {
          200: PursuitProposalResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getPursuitProposal(pool, request.auth, request.params.id),
  );

  app.post<{
    Params: { id: string };
    Body: ReviewPursuitProposalRequest;
  }>(
    "/v1/pursuit-proposals/:id/reviews",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pursuits", "review"],
        security,
        params: IdParamsSchema,
        body: ReviewPursuitProposalRequestSchema,
        response: {
          200: PursuitProposalReviewResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await reviewPursuitProposal(
        pool,
        request.auth,
        request.params.id,
        request.body,
        {
          onBeforeReview: (client) =>
            assertProposalReviewNotAgentCorrelated(
              client,
              request.auth,
              request.params.id,
            ),
        },
      );
      reply.header("idempotent-replayed", result.replayed);
      if (result.status === 409) {
        const conflict = result.body as ProposalReviewConflict;
        throw new ApiError(
          409,
          "PURSUIT_PROPOSAL_REVIEW_CONFLICT",
          "The Pursuit changed; review the current revision before applying this Proposal.",
          conflict,
        );
      }
      return reply.status(result.status).send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/operations/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["operations"],
        security,
        params: IdParamsSchema,
        response: {
          200: PursuitOperationResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getPursuitOperation(pool, request.auth, request.params.id),
  );

  app.post<{ Body: CreateCaptureRequest }>(
    "/v1/captures",
    {
      preHandler: authenticate,
      schema: {
        tags: ["captures"],
        security,
        body: CreateCaptureRequestSchema,
        response: {
          201: CaptureResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await createCapture(pool, request.auth, request.body);
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/resource-captures/:id",
    {
      preHandler: authenticate,
      schema: { tags: ["resources"], security, params: IdParamsSchema,
        response: { 200: ResourceCaptureResponseSchema, "4xx": ErrorResponseSchema } },
    },
    async (request) => loadResourceCapture(pool, request.auth.accountId, request.params.id),
  );

  app.post<{ Params: { id: string } }>(
    "/v1/resource-captures/:id/review-preparations",
    {
      preHandler: authenticate,
      schema: { tags: ["resources"], security, params: IdParamsSchema,
        response: { 200: RelationshipResourceDetailSchema, "4xx": ErrorResponseSchema } },
    },
    async (request) => prepareCaptureReview(pool, request.auth, request.params.id),
  );

  app.post<{ Body: ResourceCaptureRequest }>(
    "/v1/resource-captures",
    {
      preHandler: authenticate,
      schema: {
        tags: ["resources"],
        security,
        body: ResourceCaptureRequestSchema,
        response: {
          201: ResourceCaptureResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await createResourceCapture(
        pool,
        request.auth,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/captures/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["captures"],
        security,
        params: IdParamsSchema,
        response: {
          200: CaptureResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => getCapture(pool, request.auth, request.params.id),
  );

  app.get<{ Querystring: { query?: string } }>(
    "/v1/people",
    {
      preHandler: authenticate,
      schema: {
        tags: ["people"],
        security,
        querystring: PeopleQuerySchema,
        response: {
          200: PersonDirectoryResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => listPeople(pool, request.auth, request.query.query),
  );

  app.post<{ Body: { query: string } }>(
    "/v1/people/search",
    {
      preHandler: authenticate,
      schema: {
        tags: ["people"],
        security,
        body: PeopleSearchSchema,
        response: {
          200: PersonDirectoryResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      searchPeople(pool, request.auth, request.body.query),
  );

  app.get<{
    Params: { personId: string; contextId: string };
  }>(
    "/v1/people/:personId/contexts/:contextId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["people"],
        security,
        params: PersonContextParamsSchema,
        response: {
          200: RelationshipScopeSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getRelationshipScope(
        pool,
        request.auth,
        request.params.personId,
        request.params.contextId,
      ),
  );

  app.get<{
    Params: { personId: string; contextId: string };
  }>(
    "/v1/people/:personId/contexts/:contextId/resources",
    {
      preHandler: authenticate,
      schema: {
        tags: ["resources"],
        security,
        params: PersonContextParamsSchema,
        response: {
          200: RelationshipResourceListResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      listRelationshipResources(
        pool,
        request.auth,
        request.params.personId,
        request.params.contextId,
      ),
  );

  app.get<{
    Params: { personId: string; contextId: string };
  }>(
    "/v1/people/:personId/contexts/:contextId/agent-history",
    {
      preHandler: authenticate,
      schema: {
        tags: ["people", "agents"],
        security,
        params: PersonContextParamsSchema,
        response: {
          200: RelationshipAgentHistorySchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getRelationshipAgentHistory(
        pool,
        request.auth,
        request.params.personId,
        request.params.contextId,
      ),
  );

  app.get<{ Params: { id: string } }>(
    "/v1/resources/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["resources"],
        security,
        params: IdParamsSchema,
        response: {
          200: RelationshipResourceDetailSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getRelationshipResource(pool, request.auth, request.params.id),
  );

  app.post<{
    Params: { id: string };
    Body: EvidenceFragmentReviewRequest;
  }>(
    "/v1/evidence-fragments/:id/reviews",
    {
      preHandler: authenticate,
      schema: {
        tags: ["resources"],
        security,
        params: IdParamsSchema,
        body: EvidenceFragmentReviewRequestSchema,
        response: {
          201: EvidenceFragmentReviewResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await reviewEvidenceFragment(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/identity-resolution-cases/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["identity"],
        security,
        params: IdParamsSchema,
        response: {
          200: IdentityResolutionCaseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getIdentityResolutionCase(
        pool,
        request.auth,
        request.params.id,
      ),
  );

  app.post<{
    Params: { id: string };
    Body: IdentityResolutionDecisionRequest;
  }>(
    "/v1/identity-resolution-cases/:id/decisions",
    {
      preHandler: authenticate,
      schema: {
        tags: ["identity"],
        security,
        params: IdParamsSchema,
        body: IdentityResolutionDecisionRequestSchema,
        response: {
          201: IdentityResolutionDecisionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await decideIdentityResolutionCase(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{
    Params: { id: string };
    Body: CaptureIdentityCorrectionRequest;
  }>(
    "/v1/captures/:id/identity-corrections",
    {
      preHandler: authenticate,
      schema: {
        tags: ["identity"],
        security,
        params: IdParamsSchema,
        body: CaptureIdentityCorrectionRequestSchema,
        response: {
          201: CaptureIdentityCorrectionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await correctCaptureIdentity(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{
    Querystring: {
      source_person_id: string;
      target_person_id: string;
    };
  }>(
    "/v1/person-merges/preview",
    {
      preHandler: authenticate,
      schema: {
        tags: ["identity"],
        security,
        querystring: PersonMergePreviewQuerySchema,
        response: {
          200: PersonMergePreviewSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      previewPersonMerge(
        pool,
        request.auth,
        request.query.source_person_id,
        request.query.target_person_id,
      ),
  );

  app.post<{ Body: PersonMergeRequest }>(
    "/v1/person-merges",
    {
      preHandler: authenticate,
      schema: {
        tags: ["identity"],
        security,
        body: PersonMergeRequestSchema,
        response: {
          201: PersonMergeResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await mergePeople(pool, request.auth, request.body);
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/person-merges/:id/reversal",
    {
      preHandler: authenticate,
      schema: {
        tags: ["identity"],
        security,
        params: IdParamsSchema,
        response: {
          200: PersonMergeReversalPreviewSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      previewPersonMergeReversal(
        pool,
        request.auth,
        request.params.id,
      ),
  );

  app.post<{
    Params: { id: string };
    Body: PersonMergeReversalRequest;
  }>(
    "/v1/person-merges/:id/reversal",
    {
      preHandler: authenticate,
      schema: {
        tags: ["identity"],
        security,
        params: IdParamsSchema,
        body: PersonMergeReversalRequestSchema,
        response: {
          201: PersonMergeResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await reversePersonMerge(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{
    Params: { id: string };
    Body: SourceAuthorizationDecisionRequest;
  }>(
    "/v1/captures/:id/source-authorization-decisions",
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          max: 12,
          timeWindow: "1 minute",
        },
      },
      schema: {
        tags: ["resources"],
        security,
        params: IdParamsSchema,
        body: SourceAuthorizationDecisionRequestSchema,
        response: {
          201: SourceAuthorizationDecisionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await decideCaptureSourceAuthorization(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      let body = result.body;
      if (!body.compilation && !body.compilation_error) {
        try {
          const compilation = await compileRelationshipWiki(
            pool,
            request.auth,
            body.person_id,
            body.relationship_context_id,
            {
              idempotency_key:
                `source-authorization-${body.decision_id}`,
              objective:
                body.decision === "revoke"
                  ? "Rebuild the relationship Wiki without evidence whose source authorization was revoked."
                  : "Rebuild the relationship Wiki after restoring the source as reviewable evidence without restoring prior conclusions or actions.",
            },
          );
          body = {
            ...body,
            compilation: {
              snapshot_id: compilation.body.id,
              status: compilation.body.status,
              verdict: compilation.body.quality.verdict,
              block_count: compilation.body.blocks.length,
            },
          };
        } catch (error) {
          body = {
            ...body,
            compilation_error:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "Relationship Wiki recompilation failed.",
          };
        }
        await persistSourceAuthorizationCompilation(
          pool,
          result.idempotencyRecordId,
          body,
        );
      }
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(body);
    },
  );

  app.post<{ Body: PublicResearchRequest }>(
    "/v1/research-tasks",
    {
      preHandler: authenticate,
      schema: {
        tags: ["research"],
        security,
        body: PublicResearchRequestSchema,
        response: {
          201: PublicResearchResponseSchema,
          202: PublicResearchResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await runPublicResearch(
        pool,
        request.auth,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{
    Querystring: { seed_resource_id: string };
  }>(
    "/v1/research-tasks/latest",
    {
      preHandler: authenticate,
      schema: {
        tags: ["research"],
        security,
        querystring: Type.Object(
          {
            seed_resource_id: Type.String({ format: "uuid" }),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Union([
            PublicResearchResponseSchema,
            Type.Null(),
          ]),
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getLatestPublicResearchTask(
        pool,
        request.auth,
        request.query.seed_resource_id,
      ),
  );

  app.post<{
    Params: { personId: string; contextId: string };
    Body: CompileKnowledgeRequest;
  }>(
    "/v1/people/:personId/contexts/:contextId/wiki-compilations",
    {
      preHandler: authenticate,
      schema: {
        tags: ["wiki"],
        security,
        params: PersonContextParamsSchema,
        body: CompileKnowledgeRequestSchema,
        response: {
          201: KnowledgeSnapshotSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await compileRelationshipWiki(
        pool,
        request.auth,
        request.params.personId,
        request.params.contextId,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{
    Params: { personId: string; contextId: string };
  }>(
    "/v1/people/:personId/contexts/:contextId/wiki",
    {
      preHandler: authenticate,
      schema: {
        tags: ["wiki"],
        security,
        params: PersonContextParamsSchema,
        response: {
          200: KnowledgeSnapshotSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getRelationshipWiki(
        pool,
        request.auth,
        request.params.personId,
        request.params.contextId,
      ),
  );

  app.post<{ Body: CreateChatMediaRequest }>(
    "/v1/chat/media",
    {
      preHandler: authenticate,
      schema: {
        tags: ["chat"],
        security,
        body: CreateChatMediaRequestSchema,
        response: {
          201: ChatMediaAssetSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await createChatMediaAsset(
            pool,
            request.auth,
            chatMediaStorage,
            request.body,
          ),
        ),
  );

  app.put<{ Body: Buffer; Params: { id: string } }>(
    "/v1/chat/media/:id/content",
    {
      bodyLimit: CHAT_MEDIA_MAX_BYTES,
      preHandler: authenticate,
      schema: {
        tags: ["chat"],
        security,
        params: IdParamsSchema,
        response: {
          200: ChatMediaAssetSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      uploadChatMediaContent(
        pool,
        request.auth,
        chatMediaStorage,
        request.params.id,
        request.body,
        request.headers["content-type"]?.split(";", 1)[0]?.toLowerCase() ?? "",
      ),
  );

  app.get<{ Params: { id: string } }>(
    "/v1/chat/media/:id/content",
    {
      preHandler: authenticate,
      schema: {
        tags: ["chat"],
        security,
        params: IdParamsSchema,
        response: { "4xx": ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const stored = await getChatMediaContent(
        pool,
        request.auth,
        chatMediaStorage,
        request.params.id,
      );
      return reply
        .header("Cache-Control", "private, max-age=300")
        .header("Content-Disposition", "inline")
        .header("X-Content-Type-Options", "nosniff")
        .type(stored.contentType)
        .send(Buffer.from(stored.body));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/chat/media/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["chat"],
        security,
        params: IdParamsSchema,
        response: {
          200: ChatMediaDeleteResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      deleteChatMediaAsset(
        pool,
        request.auth,
        chatMediaStorage,
        request.params.id,
      ),
  );

  app.post<{ Body: UnscopedChatTaskRequest }>(
    "/v1/chat/unscoped-tasks",
    {
      preHandler: authenticate,
      schema: {
        tags: ["chat", "agent"],
        security,
        body: UnscopedChatTaskRequestSchema,
        response: {
          201: UnscopedChatTaskResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const trial = config.internalLabEnabled ? labTrials.taskContext(request.auth, "unscoped_chat", request.body.idempotency_key) : null;
      let productOutcome: "accepted" | "fallback" | "product_failed" | "unverified" = "product_failed";
      const result = await createUnscopedChatTask(
        pool, request.auth, request.body, remoteChatProvider, trial?.select, dependencies.chatReferenceClock?.(),
      ).then((result) => { productOutcome = result.labProductOutcome ?? "unverified"; return result; }).finally(async () => {
        const persisted = await trial?.finish(productOutcome);
        if (persisted != null) reply.header("lab-observation-persisted", String(persisted));
      });
      request.log.info(
        {
          unscoped_chat_task_id: result.body.task_id,
          chat_disposition: result.body.disposition,
          context_scope: "agent_bounded_contact_lookup",
          external_effect_count: 0,
        },
        "unscoped chat task completed",
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{ Body: ChatTaskRequest }>(
    "/v1/chat/tasks",
    {
      preHandler: authenticate,
      schema: {
        tags: ["chat"],
        security,
        body: ChatTaskRequestSchema,
        response: {
          201: ChatTaskResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const trial = config.internalLabEnabled ? labTrials.taskContext(request.auth,
        request.body.media_ids?.length ? "relationship_image" : "relationship_text", request.body.idempotency_key) : null;
      let productOutcome: "accepted" | "fallback" | "product_failed" | "unverified" = "product_failed";
      const result = await createChatTask(
        pool, request.auth, request.body, remoteChatProvider, chatMediaStorage, personResearchProvider, trial?.select,
        config.internalLabEnabled ? (client) => labFeatures.adoptionReceipt(client, request.auth) : undefined,
      ).then((result) => { productOutcome = result.labProductOutcome ?? "unverified"; return result; }).finally(async () => {
        const persisted = await trial?.finish(productOutcome);
        if (persisted != null) reply.header("lab-observation-persisted", String(persisted));
      });
      request.log.info(
        {
          trace_id: result.body.telemetry?.trace_id ?? null,
          interaction_id: result.body.telemetry?.interaction_id ?? null,
          chat_task_id: result.body.task_id,
          chat_disposition: result.body.disposition,
        },
        "relationship chat task completed",
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  registerScreenshotContactRoutes(app, pool, authenticate, chatMediaStorage, screenshotRunner);
  app.get<{Params:{id:string};Querystring:{relationship_context_id:string}}>("/v1/people/:id/contact-intelligence",{preHandler:authenticate,
    schema:{security,params:Type.Object({id:Type.String({format:"uuid"})}),querystring:Type.Object({relationship_context_id:Type.String({format:"uuid"})},{additionalProperties:false})}},
    async request=>loadContactIntelligence(pool,request.auth,request.params.id,request.query.relationship_context_id));
  app.post<{Params:{id:string};Body:{expected_revision:number;idempotency_key:string;decision:"archive"}}>("/v1/people/:id/archive",{preHandler:authenticate,
    schema:{security,params:Type.Object({id:Type.String({format:"uuid"})}),body:Type.Object({expected_revision:Type.Integer({minimum:1}),idempotency_key:Type.String({minLength:1,maxLength:128}),decision:Type.Literal("archive")},{additionalProperties:false})}},
    async request=>executeGrantedContactArchive(pool,request.auth,{person_id:request.params.id,...request.body},
      taskIDs=>taskIDs.forEach(taskID=>screenshotRunner?.fenceTaskCancellation(request.auth,taskID,"CONTACT_ARCHIVED"))));
  app.post<{Params:{id:string}}>("/v1/contact-archives/:id/restore",{preHandler:authenticate,schema:{security,params:Type.Object({id:Type.String({format:"uuid"})})}},
    async request=>restoreContactArchive(pool,request.auth,request.params.id));

  app.post<{ Body: PersonResearchTaskRequest }>(
    "/v1/person-research/tasks",
    {
      preHandler: authenticate,
      bodyLimit: 12 * 1024 * 1024,
      schema: {
        tags: ["person-research"],
        security,
        body: PersonResearchTaskRequestSchema,
        response: {
          201: PersonResearchTaskResponseSchema,
          "4xx": ErrorResponseSchema,
          "5xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await createPersonResearchTask(
        pool,
        request.auth,
        request.body,
        personResearchProvider,
      );
      request.log.info(
        {
          person_research_task_id: result.body.task_id,
          disposition: result.body.disposition,
          image_content_hash: result.body.source_image.content_hash,
          raw_image_persisted: false,
          external_effect_count: 0,
        },
        "unbound screenshot person-research task completed",
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{Params:{id:string}}>("/v1/chat/tasks/:id/artifacts",{
    preHandler:authenticate,schema:{tags:["chat"],security,params:IdParamsSchema,
      response:{200:Type.Array(RunArtifactSchema,{maxItems:3}),"4xx":ErrorResponseSchema}},
  },async request=>listHarnessRunArtifacts(pool,request.auth,request.params.id));
  app.get<{Params:{id:string;artifactID:string}}>("/v1/chat/tasks/:id/artifacts/:artifactID",{
    preHandler:authenticate,schema:{tags:["chat"],security,
      params:Type.Object({id:Type.String({format:"uuid"}),artifactID:Type.String({format:"uuid"})},{additionalProperties:false})},
  },async(request,reply)=>{
    const file=await readHarnessRunArtifact(pool,request.auth,request.params.id,request.params.artifactID);
    return reply.header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff")
      .header("Content-Disposition",`attachment; filename="${file.name}"`).type(file.media_type+"; charset=utf-8").send(Buffer.from(file.content,"utf8"));
  });

  app.get<{ Params: { id: string } }>(
    "/v1/chat/tasks/:id/readback",
    {
      preHandler: authenticate,
      schema: {
        tags: ["chat"],
        security,
        params: IdParamsSchema,
        response: {
          200: ChatTaskReadbackSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getChatTaskReadback(pool, request.auth, request.params.id),
  );

  app.get<{ Params: { id: string } }>(
    "/v1/captures/:id/retention",
    {
      preHandler: authenticate,
      schema: {
        tags: ["retention"],
        security,
        params: IdParamsSchema,
        response: {
          200: SourceRetentionReceiptSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getSourceRetentionReceipt(pool, request.auth, request.params.id),
  );

  app.get<{ Querystring: { source_locator: string } }>(
    "/v1/source-retention-receipts",
    {
      preHandler: authenticate,
      schema: {
        tags: ["retention"],
        security,
        querystring: SourceLocatorQuerySchema,
        response: {
          200: SourceRetentionReceiptSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getSourceRetentionReceiptByLocator(
        pool,
        request.auth,
        request.query.source_locator,
      ),
  );

  app.get<{ Querystring: { assignment_id: string } }>(
    "/v1/state",
    {
      preHandler: authenticate,
      schema: {
        tags: ["review"],
        security,
        querystring: StateQuerySchema,
        response: {
          200: TemporalStateResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getTemporalState(pool, request.auth, request.query.assignment_id),
  );

  app.get<{
    Querystring: { fixture_case_id?: string; capture_id?: string };
  }>(
    "/v1/workspace-review",
    {
      preHandler: authenticate,
      schema: {
        tags: ["review"],
        security,
        querystring: WorkspaceReviewQuerySchema,
        response: {
          200: WorkspaceReviewResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { capture_id: captureId, fixture_case_id: fixtureCaseId } =
        request.query;
      if (Boolean(captureId) === Boolean(fixtureCaseId)) {
        throw new ApiError(
          400,
          "WORKSPACE_LOOKUP_INVALID",
          "Provide exactly one capture_id or fixture_case_id.",
        );
      }
      return getWorkspaceReview(
        pool,
        request.auth,
        captureId
          ? { captureId }
          : { fixtureCaseId: fixtureCaseId as string },
      );
    },
  );

  app.post<{
    Params: { id: string };
    Body: SubmitAnalysisProposalRequest;
  }>(
    "/v1/captures/:id/analysis-proposals",
    {
      preHandler: authenticate,
      schema: {
        tags: ["review"],
        security,
        params: IdParamsSchema,
        body: SubmitAnalysisProposalRequestSchema,
        response: {
          201: AnalysisProposalResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await submitAnalysisProposal(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{
    Params: { id: string };
    Body: AssertionDecisionRequest;
  }>(
    "/v1/assertions/:id/decisions",
    {
      preHandler: authenticate,
      schema: {
        tags: ["review"],
        security,
        params: IdParamsSchema,
        body: AssertionDecisionRequestSchema,
        response: {
          201: AssertionDecisionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await decideAssertion(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{ Params: { id: string }; Body: ReviseActionRequest }>(
    "/v1/actions/:id/revisions",
    {
      preHandler: authenticate,
      schema: {
        tags: ["actions"],
        security,
        params: IdParamsSchema,
        body: ReviseActionRequestSchema,
        response: { "4xx": ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await reviseAction(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{ Params: { id: string }; Body: ApproveActionRequest }>(
    "/v1/actions/:id/approvals",
    {
      preHandler: authenticate,
      schema: {
        tags: ["actions"],
        security,
        params: IdParamsSchema,
        body: ApproveActionRequestSchema,
        response: {
          201: ApprovalResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await approveAction(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{ Params: { id: string }; Body: RevokeApprovalRequest }>(
    "/v1/approvals/:id/revocation",
    {
      preHandler: authenticate,
      schema: {
        tags: ["actions"],
        security,
        params: IdParamsSchema,
        body: RevokeApprovalRequestSchema,
        response: { "4xx": ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await revokeApproval(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{ Params: { id: string }; Body: ExecuteActionRequest }>(
    "/v1/actions/:id/executions",
    {
      preHandler: authenticate,
      schema: {
        tags: ["effects"],
        security,
        params: IdParamsSchema,
        body: ExecuteActionRequestSchema,
        response: {
          200: EffectResultResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await executeAction(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{ Params: { id: string }; Body: ReconcileEffectRequest }>(
    "/v1/effect-attempts/:id/reconcile",
    {
      preHandler: authenticate,
      schema: {
        tags: ["effects"],
        security,
        params: IdParamsSchema,
        body: ReconcileEffectRequestSchema,
        response: {
          200: EffectResultResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await reconcileEffect(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/effect-attempts/:id/reversal",
    {
      preHandler: authenticate,
      schema: {
        tags: ["effects"],
        security,
        params: IdParamsSchema,
        response: {
          200: EffectReversalPreviewSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      previewEffectReversal(pool, request.auth, request.params.id),
  );

  app.post<{
    Params: { id: string };
    Body: ApproveEffectReversalRequest;
  }>(
    "/v1/effect-attempts/:id/reversal-approvals",
    {
      preHandler: authenticate,
      schema: {
        tags: ["effects"],
        security,
        params: IdParamsSchema,
        body: ApproveEffectReversalRequestSchema,
        response: {
          201: EffectReversalApprovalResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await approveEffectReversal(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{
    Params: { id: string };
    Body: ExecuteEffectReversalRequest;
  }>(
    "/v1/effect-attempts/:id/reversal-executions",
    {
      preHandler: authenticate,
      schema: {
        tags: ["effects"],
        security,
        params: IdParamsSchema,
        body: ExecuteEffectReversalRequestSchema,
        response: {
          200: EffectReversalResultResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await executeEffectReversal(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{ Params: { id: string }; Body: RevokeApprovalRequest }>(
    "/v1/effect-reversal-approvals/:id/revocation",
    {
      preHandler: authenticate,
      schema: {
        tags: ["effects"],
        security,
        params: IdParamsSchema,
        body: RevokeApprovalRequestSchema,
        response: { "4xx": ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await revokeEffectReversalApproval(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{ Body: RevokeCapabilityRequest }>(
    "/v1/authorizations/revocation",
    {
      preHandler: authenticate,
      schema: {
        tags: ["effects"],
        security,
        body: RevokeCapabilityRequestSchema,
        response: { "4xx": ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await revokeCapability(pool, request.auth, request.body);
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.post<{ Params: { id: string }; Body: DeleteCaptureRequest }>(
    "/v1/captures/:id/deletion",
    {
      preHandler: authenticate,
      schema: {
        tags: ["deletion"],
        security,
        params: IdParamsSchema,
        body: DeleteCaptureRequestSchema,
        response: {
          200: DeleteCaptureResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await deleteCapture(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      await purgeContactImagesForCapture(
        pool,
        request.auth.accountId,
        request.params.id,
        chatMediaStorage,
      );
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(result.status)
        .send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/deletions/:id/lineage",
    {
      preHandler: authenticate,
      schema: {
        tags: ["deletion"],
        security,
        params: IdParamsSchema,
        response: {
          200: DeletionLineageResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getDeletionLineage(pool, request.auth, request.params.id),
  );

  app.get<{ Querystring: { after?: string } }>(
    "/v1/sync",
    {
      preHandler: authenticate,
      schema: {
        tags: ["sync"],
        security,
        querystring: SyncQuerySchema,
        response: {
          200: SyncResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      readSyncEvents(
        pool,
        request.auth,
        Number.parseInt(request.query.after ?? "0", 10),
      ),
  );

  const stopProductProjection = startProductRunProjection(pool, () => app.log.error("Product run Opik projection unavailable; local records retained"));
  // The durable queue path keeps the configured Lab provider selection and
  // frozen reference clock, so Web does not silently lose Lab experiment arms.
  const conversationQueueSelectProvider: ConversationQueueProviderSelector | undefined =
    config.internalLabEnabled
      ? async (client, input) => {
          const trial = labTrials.taskContext(
            input.auth,
            "unscoped_chat",
            input.idempotencyKey,
          );
          const provider = await trial.select(client);
          return {
            provider,
            finish: (outcome) => Promise.resolve(trial.finish(outcome)),
          };
        }
      : undefined;
  const conversationQueueRunner = new ConversationQueueRunner({
    pool,
    provider: remoteChatProvider,
    logger: app.log,
    ...(conversationQueueSelectProvider
      ? { selectProvider: conversationQueueSelectProvider }
      : {}),
    ...(dependencies.chatReferenceClock
      ? { referenceClock: dependencies.chatReferenceClock }
      : {}),
  });
  if (dependencies.conversationQueueWorkerEnabled !== false) {
    app.addHook("onReady", async () => {
      await conversationQueueRunner.recover().catch((error: unknown) => {
        app.log.error(
          { err: error },
          "Conversation queue recovery is pending and will retry.",
        );
      });
    });
    conversationQueueRunner.start();
    registerRecurringJob(app, {
      name: "conversation-queue-recovery",
      intervalMs: config.retentionSweepIntervalMs,
      run: () => conversationQueueRunner.recover(),
    });
  }
  registerRecurringJob(app, {
    name: "contact-task-retention-sweep",
    intervalMs: config.retentionSweepIntervalMs,
    run: () => expireScreenshotContactTasks(pool, chatMediaStorage),
  });
  registerRecurringJob(app, {
    name: "source-lifecycle-sweep",
    intervalMs: config.retentionSweepIntervalMs,
    run: async () => {
      await runSourceLifecycleSweep(pool);
    },
  });
  registerRecurringJob(app, {
    name: "desktop-browser-login-sweep",
    intervalMs: config.retentionSweepIntervalMs,
    run: async () => {
      await sweepDesktopBrowserLoginAttempts(postgresDesktopBrowserLoginDb(pool));
    },
  });
  app.addHook("preClose", async () => { await conversationQueueRunner.close(); });
  app.addHook("onClose", async () => {
    await stopProductProjection();
    await screenshotRunner?.close();
  });

  return app;
}
