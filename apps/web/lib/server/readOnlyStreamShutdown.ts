import "server-only";

type TerminationSource = {
  once(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
};
type ShutdownScope = Record<symbol, AbortSignal | undefined>;
const key = Symbol.for("capri.web.read-only-stream-shutdown.v1");

/** Close observation transports so Next can drain; never stop an Agent task.
 * Next retains its own signal handlers and process-exit authority.
 * https://nextjs.org/docs/app/guides/self-hosting#graceful-shutdown
 */
export function readOnlyStreamShutdownSignal(
  source: TerminationSource = process,
  scope: ShutdownScope = globalThis as unknown as ShutdownScope,
): AbortSignal {
  if (scope[key]) return scope[key];
  const controller = new AbortController();
  const close = () => controller.abort(new DOMException("Web subscription transport closed for shutdown", "AbortError"));
  source.once("SIGTERM", close);
  source.once("SIGINT", close);
  scope[key] = controller.signal;
  return controller.signal;
}
