/** Display-only attention for runs actually watched finishing. No transcript,
 * account identity or replay state is retained beyond the owning conversation. */
export function createAnswerSeamRegistry(owner?: { scope: string; sessionId: string }) {
  const observed = new Map<string, boolean>();
  return {
    observe(messageId: string) {
      if (!messageId || (owner && (!owner.scope || !owner.sessionId)) || observed.has(messageId)) return;
      observed.set(messageId, false);
      if (observed.size > 128) observed.delete(observed.keys().next().value!);
    },
    claim(messageId: string, status: string, requiresDecision = false): "none" | "seam" {
      // Informational is the real producer's persisted answer status. This
      // method is called only by persisted answer blocks, never streaming text.
      if ((!(["informational", "confirmed", "needs_review"].includes(status)) && !(status === "proposed" && requiresDecision)) || observed.get(messageId) !== false) return "none";
      observed.set(messageId, true);
      return "seam";
    },
  };
}
export type AnswerSeamRegistry = ReturnType<typeof createAnswerSeamRegistry>;
