/**
 * Finite diagnostic allowlists for Agent Host server error boundaries.
 *
 * Code-shaped strings are not sanitization: an uppercase/prefix/length regex
 * accepts arbitrary untrusted exception content, including secret canaries.
 * Only codes emitted by an actual current producer (see the producers named on
 * each list) or a recognized transport condition may be forwarded in a server
 * error response; every other exception maps to the caller's fixed fallback.
 *
 * The backend counterpart is `apps/backend/src/lib/diagnosticCodes.ts`; the
 * lists are kept aligned by `diagnosticCodes.test.ts`.
 */

/** Recognized transient socket/transport failure conditions. */
export const SOCKET_TRANSIENT_ERROR_CODES = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
] as const;

/**
 * Diagnostics the `/v1/contact-research/tools` error boundary may forward.
 * Producers: `contactResearchService` policy errors, `personResearchServer`
 * capacity/identity handling, the client-detach abort reason, and browse
 * failures surfacing through `runContactResearchTool`.
 */
export const CONTACT_RESEARCH_ERROR_CODES = [
  "CONTACT_RESEARCH_UNAVAILABLE",
  "CONTACT_RESEARCH_CAPACITY_EXHAUSTED",
  "CONTACT_RESEARCH_CALL_ID_CONFLICT",
  "CONTACT_RESEARCH_CLIENT_CLOSED",
  "CONTACT_RESEARCH_QUERY_OUT_OF_SCOPE",
  "CONTACT_RESEARCH_PRIVATE_LOOKUP_PROHIBITED",
  "CONTACT_RESEARCH_SOURCE_ID_MISMATCH",
] as const;

/**
 * Diagnostics the browser executor error boundary may forward. Producers:
 * `browserExecutorProtocol` (request/response validation),
 * `browserExecutorServer` (auth, capacity, call identity, deadline, aborts),
 * `browserExecutorClient`, `isolatedPublicBrowser`, `safeWebFetch`, and
 * `browserExecutorRuntime`. The explicit resource budget limits
 * (`BROWSER_HTTP_LIMIT`, `BROWSER_RESPONSE_BYTE_LIMIT`) and the
 * auth/response/decision limits are preserved verbatim.
 */
export const BROWSER_ERROR_CODES = [
  "BROWSER_PROTOCOL_INVALID",
  "BROWSER_SOURCE_INVALID",
  "BROWSER_RESPONSE_IDENTITY_MISMATCH",
  "BROWSER_RESULT_INVALID",
  "BROWSER_REQUEST_TOO_LARGE",
  "BROWSER_RESPONSE_TOO_LARGE",
  "BROWSER_DEADLINE_INVALID",
  "BROWSER_DEADLINE_EXCEEDED",
  "BROWSER_EXECUTOR_NOT_CONFIGURED",
  "BROWSER_EXECUTOR_ENDPOINT_INVALID",
  "BROWSER_EXECUTOR_TOKEN_INVALID",
  "BROWSER_EXECUTOR_UNAUTHORIZED",
  "BROWSER_EXECUTOR_NOT_READY",
  "BROWSER_EXECUTOR_ROUTE_DENIED",
  "BROWSER_EXECUTOR_JSON_REQUIRED",
  "BROWSER_EXECUTOR_UNAVAILABLE",
  "BROWSER_EXECUTOR_STOPPING",
  "BROWSER_EXECUTOR_FAILED",
  "BROWSER_EXECUTOR_PATH_INVALID",
  "BROWSER_CALL_FINISHED",
  "BROWSER_CALL_ID_CONFLICT",
  "BROWSER_CAPACITY_UNAVAILABLE",
  "BROWSER_CLIENT_CLOSED",
  "BROWSER_IMAGE_NOT_CONFIGURED",
  "BROWSER_IMAGE_IDENTITY_MISMATCH",
  "BROWSER_DAEMON_NOT_CONFIGURED",
  "BROWSER_DAEMON_IDENTITY_MISMATCH",
  "BROWSER_PIPE_CLOSED",
  "BROWSER_OUTPUT_LIMIT",
  "BROWSER_DIAGNOSTIC_LIMIT",
  "BROWSER_REQUEST_LIMIT",
  "BROWSER_REQUEST_DENIED",
  "BROWSER_NAVIGATION_DENIED",
  "BROWSER_REDIRECT_INVALID",
  "BROWSER_REDIRECT_OUT_OF_SCOPE",
  "BROWSER_RESOURCE_LIMIT",
  "BROWSER_RESOURCE_OUT_OF_SCOPE",
  "BROWSER_RESOURCE_UNAVAILABLE",
  "BROWSER_HTTP_LIMIT",
  "BROWSER_RESPONSE_BYTE_LIMIT",
  "BROWSER_EXECUTION_FAILED",
  "BROWSER_LAUNCH_FAILED",
  "BROWSER_NAVIGATION_FAILED",
  "BROWSER_RENDER_FAILED",
  "BROWSER_CLEANUP_UNVERIFIED",
] as const;

/**
 * Everything the contact-tools boundary may legitimately forward: its own
 * diagnostics plus recognized browse and transport failures.
 */
export const CONTACT_TOOLS_ERROR_CODE_SET: ReadonlySet<string> = new Set([
  ...CONTACT_RESEARCH_ERROR_CODES,
  ...BROWSER_ERROR_CODES,
  ...SOCKET_TRANSIENT_ERROR_CODES,
]);

/** Everything the browser executor boundary may legitimately forward. */
export const BROWSER_EXECUTOR_ERROR_CODE_SET: ReadonlySet<string> = new Set([
  ...BROWSER_ERROR_CODES,
  ...SOCKET_TRANSIENT_ERROR_CODES,
]);

/**
 * Extract the first recognized diagnostic code from an untrusted exception.
 * Neither an arbitrary `code` property, a code-shaped `message`, nor a
 * constructor/name string is trusted unless the exact code is in the finite
 * allowlist.
 */
export function recognizedDiagnosticCode(
  error: unknown,
  recognized: ReadonlySet<string>,
): string | undefined {
  const propertyCode =
    error && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined;
  if (typeof propertyCode === "string" && recognized.has(propertyCode)) {
    return propertyCode;
  }
  const messageCode = error instanceof Error ? error.message : undefined;
  if (typeof messageCode === "string" && recognized.has(messageCode)) {
    return messageCode;
  }
  return undefined;
}

/** Fixed-fallback mapping for boundaries that must always report a code. */
export function boundedDiagnosticCode(
  error: unknown,
  recognized: ReadonlySet<string>,
  fallback: string,
): string {
  return recognizedDiagnosticCode(error, recognized) ?? fallback;
}
