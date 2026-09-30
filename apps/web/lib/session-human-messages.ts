import type { AgentSessionPayload } from "@talent-signal/contracts";

export type SessionHumanMessage = Pick<AgentSessionPayload["turns"][number], "id" | "objective" | "createdAt" | "images">;
/** Preserve each original human identity, source and accepted time in a fold. */
export function sessionHumanMessages(turn: SessionHumanMessage & { steeredMessages?: SessionHumanMessage[] }): SessionHumanMessage[] {
  return [turn, ...(turn.steeredMessages ?? [])];
}
