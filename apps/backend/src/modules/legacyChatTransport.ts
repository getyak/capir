import type { IncomingMessage, ServerResponse } from "node:http";

/** Body read-complete/normal IncomingMessage close is not owner cancellation.
 * Only the winning durable POST subscribes this signal as its execution stop;
 * duplicate waiters use it solely to stop their own wait. */
export function bindLegacyChatTransport(request: IncomingMessage, reply: ServerResponse) {
  const controller = new AbortController();
  const abort = () => { if (!controller.signal.aborted) controller.abort(); };
  const close = () => { if (!reply.writableFinished) abort(); };
  request.on("aborted",abort);
  reply.on("close",close);
  if (request.aborted || (reply.destroyed && !reply.writableFinished)) abort();
  return { signal: controller.signal,dispose() {
    request.off("aborted",abort);
    reply.off("close",close);
  } };
}
