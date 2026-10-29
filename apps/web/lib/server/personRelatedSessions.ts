import "server-only";
import { loadWorkspaceSessionDirectory } from "./workspaceSessions";

export type PersonRelatedSessions = {
  sessions: { id: string; title: string; updatedAt: string }[];
  /** False also covers a bounded recent selection from a larger loaded page. */
  complete: boolean;
};

/**
 * The caller supplies the canonical Person already read in the current account.
 * Session ownership and lifecycle come from the authenticated directory loader;
 * neither a display name nor a return locator can establish this relationship.
 */
export async function loadPersonRelatedSessions(person: {
  id: string;
  contexts: readonly { id: string }[];
}): Promise<PersonRelatedSessions> {
  const contexts = new Set(person.contexts.map(context => context.id));
  if (!contexts.size) return { sessions: [], complete: true };
  const directory = await loadWorkspaceSessionDirectory();
  const now = Date.now();
  const matching = directory.sessions.filter(session =>
    session.scopeKind === "relationship" && session.personId === person.id &&
    session.relationshipContextId !== null && contexts.has(session.relationshipContextId) &&
    Date.parse(session.expiresAt) > now,
  );
  return {
    sessions: matching.slice(0, 4).map(session => ({
      id: session.sessionId, title: session.title, updatedAt: session.updatedAt,
    })),
    complete: directory.complete && matching.length <= 4,
  };
}
