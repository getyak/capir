import type { HarnessContinuation } from "@talent-signal/agent";
import type { LegacyChatAuthority } from "./legacyChatAuthority.js";

// Keep the wrapper exhaustive against the pinned SDK contract: a new store
// method must be reviewed before it can reach the SDK without an owner fence.
const continuationStoreMethods = {
  append: true, load: true, listSubkeys: true, delete: true,
  listSessions: true, listSessionSummaries: true,
} satisfies Record<keyof HarnessContinuation["store"], true>;

type Callable = (...args: unknown[]) => unknown;
type HostObject = Record<string, unknown>;
const object = (value: unknown): value is HostObject => value !== null && typeof value === "object";
const callable = (value: unknown): value is Callable => typeof value === "function";

/** Add the HTTP request's original credential fence without changing provider
 * capabilities, metadata, source-admission presence, prompts or method `this`.
 * The queue keeps its own untouched provider/host-authority construction.
 */
export function guardLegacyProvider<T extends object>(provider: T, authority: LegacyChatAuthority,
  additionalSource?: (() => Promise<void>) | undefined): T {
  const signal = (prior: unknown) => prior instanceof AbortSignal
    ? AbortSignal.any([prior, authority.signal]) : authority.signal;
  const sourceCheck = (request: HostObject) => callable(request.assertCurrent)
    ? () => Promise.resolve(Reflect.apply(request.assertCurrent as Callable, request, [])) : undefined;
  const checksFor = (request: HostObject) => {
    const original = sourceCheck(request);
    return original || additionalSource ? async () => { await original?.(); await additionalSource?.(); } : undefined;
  };
  const admittedSource = (request: HostObject) => {
    const source = sourceCheck(request);
    if (!source) return undefined; // Presence is a capability gate: never manufacture it.
    return async () => {
      await authority.assertCurrent();
      await authority.source(source);
      if (additionalSource) await authority.source(additionalSource);
      await authority.assertCurrent();
    };
  };
  const sourceResult = (value: unknown): unknown => {
    if (!object(value) || !callable(value.assertCurrent)) return value;
    return { ...value, assertCurrent: admittedSource(value) };
  };
  const hostMethods = (value: unknown, names: readonly string[], check?: () => Promise<void>) => {
    if (!object(value)) return value;
    const result = { ...value };
    for (const name of names) {
      const method = value[name];
      if (callable(method)) result[name] = (...args: unknown[]) =>
        authority.host(async () => sourceResult(await Reflect.apply(method, value, args)), check);
    }
    return result;
  };
  const continuation = (factory: Callable, owner: HostObject, check?: () => Promise<void>) =>
    async (...args: unknown[]) => {
      const result = await authority.host(() => Promise.resolve(Reflect.apply(factory, owner, args)), check);
      if (!object(result)) return result;
      const wrapped = hostMethods(result, ["assertCurrent"], check) as HostObject;
      wrapped.store = hostMethods(result.store, Object.keys(continuationStoreMethods), check);
      if (callable(result.finish)) wrapped.finish = (...values: unknown[]) => {
        // The existing false branch only rolls back/releases its savepoint.
        // It must run on failure, but the guarded client rejects all use once
        // its transaction is released, including late cleanup callbacks.
        if (values[0] === false) return Reflect.apply(result.finish as Callable, result, values);
        return authority.host(() => Promise.resolve(Reflect.apply(result.finish as Callable, result, values)), check);
      };
      return wrapped;
    };
  const requestFor = (request: HostObject, method: string) => {
    const check = checksFor(request);
    const wrapped = { ...request };
    if (callable(request.assertCurrent)) wrapped.assertCurrent = admittedSource(request);
    if (method === "answer") wrapped.signal = signal(request.signal);
    if (request.memoryReview) wrapped.memoryReview = hostMethods(request.memoryReview, ["recall", "stage"], check);
    if (callable(request.readEvidenceImage)) wrapped.readEvidenceImage = (...args: unknown[]) =>
      authority.host(() => authority.source(async () => sourceResult(await Reflect.apply(request.readEvidenceImage as Callable, request, args))), check);
    if (object(request.runFiles)) wrapped.runFiles = hostMethods(request.runFiles, ["assertCurrent", "saveArtifact"], check);
    if (callable(request.continuation)) wrapped.continuation = continuation(request.continuation, request, check);
    if (Array.isArray(request.supplementalTools)) wrapped.supplementalTools = request.supplementalTools.map(tool =>
      object(tool) ? hostMethods(tool, ["execute"], check) : tool);
    return { wrapped, check };
  };
  return new Proxy(provider, { get(target, key) {
    const method = Reflect.get(target, key, target);
    // In particular, an answer-only DeepSeek adapter must not gain `.run`.
    if (!["answer", "run", "runWithPromptPreset"].includes(String(key)) || !callable(method))
      return callable(method) ? method.bind(target) : method;
    return async (...args: unknown[]) => {
      const request = object(args[0]) ? requestFor(args[0], String(key)) : null;
      const forwarded = [...args];
      if (request) forwarded[0] = request.wrapped;
      if ((key === "run" || key === "runWithPromptPreset") && callable(args[1])) {
        const invoke = args[1];
        forwarded[1] = (...values: unknown[]) => authority.host(
          () => Promise.resolve(Reflect.apply(invoke, undefined, values)), request?.check);
        forwarded[2] = signal(args[2]);
      }
      return authority.provider(() => Promise.resolve(Reflect.apply(method, target, forwarded)), request?.check);
    };
  } });
}
