export * from "./client.js";
export * from "./agentSchemas.js";
export * from "./constants.js";
export * from "./identityHandles.js";
export * from "./labSchemas.js";
export * from "./proposalSchemas.js";
export * from "./pursuitSchemas.js";
export * from "./resourceSchemas.js";
export * from "./schemas.js";
export * from "./telemetrySchemas.js";
export * from "./labExperimentSchemas.js";
export * from "./labRuntimeSchemas.js";
export * from "./labJobSchemas.js";
export * from "./labRegressionSchemas.js";
export * from "./labCISchemas.js";
export * from "./labWorkspaceSchemas.js";
export * from "./capirTestSchemas.js";
export * from "./labFeatureSchemas.js";
export * from "./agentSessionSchemas.js";
export * from "./conversationQueueSchemas.js";
export * from "./desktopCaptureSchemas.js";
export * from "./desktopBrowserLoginSchemas.js";
export * from "./feedbackSchemas.js";
export * from "./agentPreferenceSchemas.js";
export * from "./systemHealthSchemas.js";
export * from "./weeklyUsageSchemas.js";

export * from "./calendarDraftSchemas.js";
export * from "./meetingDraftSchemas.js";

export * from "./productRunSchemas.js";
export * from "./accountSchemas.js";

export * from "./mcpSchemas.js";
export * from "./mcpInteractionSchemas.js";
export * from "./timeWorkspaceSchemas.js";
export * from "./memorySchemas.js";

// Legacy Stage A capir client contract definitions (auth/sandbox) adopted from
// the reviewed CLI source. They describe the historical human-grant surface for
// client compatibility only; the current server does not implement them and
// capability discovery must list those scopes as unavailable.
export * from "./capirSchemas.js";
// Explicit v2 browser-owned CLI authorization contract (rotating refresh,
// grant management, user test entitlement scopes). Negotiated separately from
// the legacy capir.v1 surface above.
export * from "./capirAuthSchemas.js";
