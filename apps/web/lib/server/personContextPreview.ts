import "server-only";
import { TalentSignalHttpError } from "@talent-signal/contracts";
import type { PersonContextPreview } from "../person-context-preview";
import { loadPersonMemory } from "./localBackend";
import { loadWorkspaceSessionDirectory } from "./workspaceSessions";

export async function loadPersonContextPreview(personId: string, binding: string): Promise<PersonContextPreview> {
  const { person, items } = await loadPersonMemory(personId);
  if (!person) throw new TalentSignalHttpError(404, "person_unavailable", "人物已不可用。", null);
  const contextIds = new Set(person.contexts.map(context => context.id));
  // Recall is already governed by the people surface; keep the final projection
  // explicitly person-bound and omit raw excerpts and private self content.
  const memory = items.filter(item => item.subject_id === personId &&
    (item.scope === "person" || (item.scope === "relationship" && Boolean(item.relationship_context_id && contextIds.has(item.relationship_context_id)))))
    .slice(0, 12).map(item => ({
      id: item.id, scope: item.scope as "person" | "relationship", text: item.display_text,
      kind: item.statement_kind, timeStatus: item.time_status, speaker: item.speaker ?? null,
      observedAt: item.observed_time ?? null, evidenceRetained: item.evidence_retained,
    }));
  let history: PersonContextPreview["history"] = [];
  let historyUnavailable = false;
  try {
    const directory = await loadWorkspaceSessionDirectory();
    history = directory.sessions.filter(session => session.personId === personId).slice(0, 4)
      .map(session => ({id: session.sessionId, title: session.title, updatedAt: session.updatedAt}));
  } catch (error) {
    if (error && typeof error === "object" && "status" in error &&
        (error.status === 401 || error.status === 403)) throw error;
    historyUnavailable = true;
  }
  return {
    session_version: binding,
    person: { id: person.id, label: person.display_label, headline: person.profile?.headline ?? null,
      avatarUrl: person.avatar?.url ?? null,
      contexts: person.contexts.map(context => ({id: context.id, label: context.display_label})),
    }, memory, history, historyUnavailable,
  };
}
