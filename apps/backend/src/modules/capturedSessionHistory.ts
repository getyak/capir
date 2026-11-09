import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { readCapturedAgentSessionConversation } from "./agentSessions.js";
import { SESSION_CHAT_SOURCE_LIMIT } from "./agentSessionSources.js";
import { createHarnessSourceGuardWithBinding, readHarnessRunSourceBinding, type HarnessSourceAuthority } from "./harnessSourceGuard.js";
import { admitSessionHistoryOwner, sessionHistorySnapshotUnavailable } from "./sessionHistorySnapshot.js";

export interface CapturedHistoryInput {
  database: DatabaseClient; auth: AuthContext; sessionID: string; taskID: string;
  messageID: string | undefined; sources: () => HarnessSourceAuthority;
  onExpiry?: (expiresAt: Date) => void;
}

/** Internal fixed reader. Its only consumer selecting authority is the actual
 * Legacy credential owner, which supplies its checked private query channel. */
export async function collectCapturedHistory(database: DatabaseClient, input: CapturedHistoryInput) {
  const { auth, sessionID, taskID, messageID } = input;
  const binding = await createHarnessSourceGuardWithBinding(database, auth, sessionID, input.sources);
  const currentSource = () => readHarnessRunSourceBinding(binding.source, binding.guard, auth);
  const original = currentSource();
  const inline = await readCapturedAgentSessionConversation(database, auth, sessionID, original, messageID, false);
  if ((inline.conversation.sources?.length ?? 0) > SESSION_CHAT_SOURCE_LIMIT) throw sessionHistorySnapshotUnavailable();
  await admitSessionHistoryOwner({ database, auth, sessionID, taskID, ...(messageID ? { messageID } : {}) });
  await binding.guard();
  let complete: typeof inline | undefined;
  try {
    const candidate = await readCapturedAgentSessionConversation(database, auth, sessionID, original, messageID, true);
    if (new Set([...(inline.conversation.sources ?? []), ...(candidate.conversation.sources ?? [])]
      .map(source => source.taskID)).size > SESSION_CHAT_SOURCE_LIMIT) throw sessionHistorySnapshotUnavailable();
    // Bound the union as well: refusal of the optional complete capability
    // never drops obligations already selected by the original inline read.
    if (Buffer.byteLength(JSON.stringify([...new Set([...inline.claims, ...candidate.claims])])) > 1_048_576)
      throw sessionHistorySnapshotUnavailable();
    complete = candidate;
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "SESSION_HISTORY_SNAPSHOT_UNAVAILABLE") throw error;
  }
  const tasks = [...new Set([...inline.tasks, ...(complete?.conversation.historyTaskIDs ?? [])])];
  // Preserve two different fingerprints if the same screenshot changed between
  // the two genuine reads. No current snapshot can satisfy both obligations.
  const screenshots = [...new Set([...(inline.conversation.sources ?? []), ...(complete?.conversation.sources ?? [])]
    .map(source => JSON.stringify({ taskID: source.taskID, fingerprint: source.fingerprint })))].map(s => JSON.parse(s));
  const domain = JSON.stringify({ claims: [...new Set([...inline.claims, ...(complete?.claims ?? [])])].map(s => JSON.parse(s)),
    tasks, screenshots });
  for (const frame of [inline.conversation, complete?.conversation]) {
    if (!frame) continue;
    frame.messages.forEach(message => Object.freeze(message)); Object.freeze(frame.messages);
    frame.sources?.forEach(source => Object.freeze(source));
    if (frame.sources) Object.freeze(frame.sources);
    if (frame.historyTaskIDs) Object.freeze(frame.historyTaskIDs);
    Object.freeze(frame);
  }
  // The credential owner's closure alone may reuse this exact source for a
  // captured SDK Memory Run. It never enters the route's preparation view.
  return { inline: inline.conversation, complete: complete?.conversation, source: binding.source,
    guard: binding.guard, currentSource, domain };
}
