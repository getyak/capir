import { ClaudeHarnessFailure, ClaudeHarnessInterruption, claudeHarnessInterruptionCode } from "@talent-signal/agent";

const resultCodes = new Set(["CLAUDE_HARNESS_ERROR_MAX_TURNS", "CLAUDE_HARNESS_ERROR_MAX_BUDGET_USD",
  "CLAUDE_HARNESS_ERROR_MAX_STRUCTURED_OUTPUT_RETRIES", "CLAUDE_HARNESS_ERROR_DURING_EXECUTION",
  "CLAUDE_HARNESS_PROVIDER_ERROR"]);
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const httpStatus = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
/** Never log provider prose, arbitrary terminal reasons or entire receipts. */
export function conversationRunDiagnostics(error: unknown): Record<string, string | number | boolean | null> {
  const code = error instanceof ClaudeHarnessFailure && resultCodes.has(error.message)
    ? error.message : claudeHarnessInterruptionCode(error);
  const result: Record<string, string | number | boolean | null> = { failure_code: code };
  if (!(error instanceof ClaudeHarnessFailure || error instanceof ClaudeHarnessInterruption)) return result;
  const receipt = error.receipt;
  return { ...result, sdk_initialized_ms: finite(receipt.sdkTiming?.initializedAfterMs),
    sdk_first_response_ms: finite(receipt.sdkTiming?.firstModelResponseAfterMs),
    model_responses: finite(receipt.modelResponses), tool_calls: finite(receipt.toolCalls),
    input_tokens: finite(receipt.inputTokens), output_tokens: finite(receipt.outputTokens),
    usage_complete: !("usageComplete" in receipt && receipt.usageComplete === false),
    provider_http_status: httpStatus("providerStatus" in receipt ? receipt.providerStatus : null),
    api_retry_count: receipt.apiRetries?.length ?? 0,
    last_api_status: finite(receipt.apiRetries?.at(-1)?.httpStatus),
    ...(/^[0-9a-f-]{36}$/iu.test(receipt.sessionID ?? "") ? { sdk_session_id: receipt.sessionID! } : {}),
  };
}
