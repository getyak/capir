/** Nonstreaming batches require a closed, recognized completion before tools. */
export function providerCompletionFailure(reason: unknown, hasTools: boolean):
  "provider_output_incomplete" | "provider_response_rejected" | undefined {
  if (reason === "stop") return undefined;
  if ((reason === "tool_calls" || reason === "function_call") && hasTools) return undefined;
  if (reason === "length" || reason === "max_tokens" || reason === "model_context_window_exceeded") {
    return "provider_output_incomplete";
  }
  return "provider_response_rejected";
}

export function providerCompletionQuarantineReason(reason: string | undefined): string | undefined {
  switch (reason) {
    case "provider_output_incomplete": return "PROVIDER_OUTPUT_INCOMPLETE";
    case "provider_response_rejected": return "PROVIDER_RESPONSE_REJECTED";
    case "provider_usage_unavailable": return "PROVIDER_USAGE_UNAVAILABLE";
    default: return undefined;
  }
}
