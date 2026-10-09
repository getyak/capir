import type { AgentSessionPayload } from "@talent-signal/contracts";

export type SessionHumanMessage = Pick<AgentSessionPayload["turns"][number], "id" | "objective" | "createdAt" | "images">;
/** Preserve each original human identity, source and accepted time in a fold. */
export function sessionHumanMessages(
  turn: SessionHumanMessage & {
    steeredMessages?: SessionHumanMessage[];
    response?: { hostResult?: unknown };
  },
): SessionHumanMessage[] {
  // A turn carrying a typed host tool result is host-authored result
  // provenance, never a human-authored message; only its steered human
  // messages (if any) remain user turns.
  const own = turn.response?.hostResult ? [] : [turn];
  return [...own, ...(turn.steeredMessages ?? [])];
}
