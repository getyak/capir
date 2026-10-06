/** One wall-clock deadline covers image inspection, SDK startup and tool turns.
 * Keep this independent of the general-purpose Agent budget: a durable
 * conversation does not have to finish inside an HTTP request timeout.
 */
export function workspaceConversationTimeoutMs(providerID: string, configured = process.env.TALENT_SIGNAL_CONVERSATION_TIMEOUT_MS): number {
  if (providerID !== "claude-agent-sdk") return 35_000;
  if (!configured?.trim()) return 1_800_000;
  const duration = Number(configured);
  if (!Number.isSafeInteger(duration) || duration < 30_000 || duration > 1_800_000) {
    throw new Error("CONVERSATION_TIMEOUT_CONFIGURATION_INVALID");
  }
  return duration;
}
