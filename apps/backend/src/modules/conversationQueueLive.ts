/**
 * In-process live transport for conversation queue observation.
 *
 * Preview text is never persisted: it lives only for the lifetime of the
 * runner process and is broadcast to same-process SSE connections. A backend
 * restart therefore truthfully reports an interrupted run instead of replaying
 * stale text. Durable queue state remains the authority.
 */
export interface ConversationQueueLivePreview {
  accountId: string;
  sessionId: string;
  runId: string;
  messageId: string;
  text: string;
  completedTools?: Array<{ name: string; completed_at: string }>;
  stage: string | null;
  sequence: number;
  leaseGeneration: number;
}

export type ConversationQueueLiveEvent =
  | { type: "changed"; accountId: string; sessionId: string }
  | { type: "preview"; preview: ConversationQueueLivePreview }
  | { type: "stop"; accountId: string; sessionId: string; runId: string };

type Listener = (event: ConversationQueueLiveEvent) => void;

const listeners = new Set<Listener>();
const previews = new Map<string, ConversationQueueLivePreview>();

export function subscribeConversationQueueLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(event: ConversationQueueLiveEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // A slow or broken observer must never affect queue execution.
    }
  }
}

export function publishConversationQueueChanged(accountId: string, sessionId: string): void {
  publish({ type: "changed", accountId, sessionId });
}

export function publishConversationQueuePreview(preview: ConversationQueueLivePreview): void {
  previews.set(preview.runId, preview);
  publish({ type: "preview", preview });
}

export function publishConversationQueueStop(accountId: string, sessionId: string, runId: string): void {
  publish({ type: "stop", accountId, sessionId, runId });
}

export function readConversationQueuePreview(runId: string): ConversationQueueLivePreview | null {
  return previews.get(runId) ?? null;
}

export function clearConversationQueuePreview(runId: string): void {
  previews.delete(runId);
}
