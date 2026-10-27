/**
 * Bounded, in-memory continuity cache for the authorized workspace directory.
 *
 * The People directory and the account's Session directory are sensitive,
 * account-bound read models. They are intentionally:
 *
 * - keyed by the existing opaque `workspaceSessionsBinding` credential binding
 *   (account id + user id + rotating token + expiry), so two accounts never
 *   share an entry and a credential rotation starts a fresh entry;
 * - short-lived (`WORKSPACE_DIRECTORY_CACHE_TTL_MS`), memory-only, and discarded
 *   on reload — never written to localStorage, IndexedDB or a shared server
 *   cache;
 * - never populated by errors, aborts, null bodies or 401 responses;
 * - discarded on session expiry, scope/identity change and after any
 *   conservative successful private-data mutation.
 *
 * This module is framework-free so the cache policy is unit-testable without a
 * DOM, React or Next.js runtime.
 */

export type WorkspaceDirectoryResponse = {
  people?: Array<{
    id?: unknown;
    display_label?: unknown;
    avatar?: { url?: unknown } | null;
    contexts?: Array<{ display_label?: unknown }>;
  }>;
};

export type WorkspaceDirectorySessionRow = {
  session_id?: unknown;
  title?: unknown;
  state?: unknown;
  person_label?: unknown;
  context_label?: unknown;
  updated_at?: unknown;
  expires_at?: unknown;
};

export type WorkspaceDirectorySessionResponse = {
  sessions?: WorkspaceDirectorySessionRow[];
  session_version?: unknown;
};

export type WorkspaceDirectorySnapshot = {
  people: WorkspaceDirectoryResponse;
  sessions: WorkspaceDirectorySessionResponse;
};

/** Bounded reuse window: long enough to cover an ordinary navigation burst. */
export const WORKSPACE_DIRECTORY_CACHE_TTL_MS = 30_000;

/** Bound on retained credential bindings; a tab has one active account. */
export const WORKSPACE_DIRECTORY_CACHE_MAX_ENTRIES = 4;

/** Background revalidation cadence while the surface stays visible. */
export const WORKSPACE_DIRECTORY_REFRESH_INTERVAL_MS = 60_000;

/** Includes response bodies; a stalled read must release its retry slot. */
export const WORKSPACE_DIRECTORY_REQUEST_TIMEOUT_MS = 15_000;

export type WorkspaceDirectoryCacheOptions = {
  ttlMs?: number;
  maxEntries?: number;
  timeoutMs?: number;
  /** Injectable clock so expiry and races can be tested deterministically. */
  now?: () => number;
};

export type WorkspaceDirectoryLoader<T> = (signal: AbortSignal) => Promise<T>;

type Entry<T> = { value: T; expiresAt: number };

type Inflight<T> = {
  promise: Promise<T>;
  controller: AbortController;
  /** False once invalidated; a cancelled load must never populate the cache. */
  deliver: boolean;
};

export function isWorkspaceDirectoryAbort(error: unknown): boolean {
  return (
    error !== null &&
    error !== undefined &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** Cancellation error used when an invalidated read is not allowed to deliver. */
export function workspaceDirectoryAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(
      "Workspace directory read aborted after invalidation",
      "AbortError",
    );
  }
  const error = new Error("Workspace directory read aborted after invalidation");
  error.name = "AbortError";
  return error;
}

/**
 * All modes drop the shared cache and fence its in-flight reads. `refresh`
 * allows a mounted reader to keep its same-binding projection while reading
 * again after an additive send admission. `revalidate` also clears rendered
 * projections (a potentially destructive private mutation). `discard` clears
 * them and fails closed instead of re-reading with the same credential
 * (scope change, logout, any 401, session expiry).
 */
export type WorkspaceDirectoryInvalidationMode = "refresh" | "revalidate" | "discard";

export type WorkspaceDirectoryScopeTransition =
  | { kind: "none" }
  | { kind: "discard-all" }
  | { kind: "discard-previous"; previous: string };

/**
 * Pure binding-lifecycle decision used by the mountable scope boundary.
 * Identity disappearing (`next` null) must discard everything; an identity
 * swap discards only the previous binding; arriving at a first binding keeps
 * any cache the new account may already own.
 */
export function workspaceDirectoryScopeTransition(
  previous: string | null | undefined,
  next: string | null | undefined,
): WorkspaceDirectoryScopeTransition {
  if (previous === next) return { kind: "none" };
  if (!next) return { kind: "discard-all" };
  if (previous) return { kind: "discard-previous", previous };
  return { kind: "none" };
}

export type WorkspaceDirectoryInvalidationListener = (
  keys: readonly string[] | null,
  mode: WorkspaceDirectoryInvalidationMode,
) => void;

/**
 * Bounded TTL cache with in-flight deduplication and explicit invalidation.
 *
 * Rejections are never cached, so a failed or 401 read always leaves the entry
 * empty. Concurrent readers of the same key share one request; invalidating a
 * key aborts that request and prevents it from delivering a late result.
 */
export class WorkspaceDirectoryCache<T> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inflight = new Map<string, Inflight<T>>();
  private readonly listeners = new Set<WorkspaceDirectoryInvalidationListener>();

  constructor(options: WorkspaceDirectoryCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? WORKSPACE_DIRECTORY_CACHE_TTL_MS;
    this.maxEntries = Math.max(
      1,
      options.maxEntries ?? WORKSPACE_DIRECTORY_CACHE_MAX_ENTRIES,
    );
    this.now = options.now ?? Date.now;
    this.timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(1, options.timeoutMs!) : WORKSPACE_DIRECTORY_REQUEST_TIMEOUT_MS;
  }

  /** Fresh value for `key`, or null once missing or past its TTL. */
  read(key: string): T | null {
    if (!key) return null;
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  has(key: string): boolean {
    return this.read(key) !== null;
  }

  set(key: string, value: T): void {
    if (!key || value === null || value === undefined) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * Return a fresh cached value, or run `loader` once per key. `force` skips the
   * cache hit but still joins an in-flight request instead of stacking a second.
   * A load invalidated mid-flight always rejects with an `AbortError`, even when
   * the loader ignores its signal and later resolves.
   */
  load(
    key: string,
    loader: WorkspaceDirectoryLoader<T>,
    options: { force?: boolean } = {},
  ): Promise<T> {
    if (!key) {
      return Promise.reject(new Error("workspace directory binding required"));
    }
    if (!options.force) {
      const cached = this.read(key);
      if (cached !== null) return Promise.resolve().then(() => {
        if (this.read(key) !== cached) throw workspaceDirectoryAbortError();
        return cached;
      });
    }
    const existing = this.inflight.get(key);
    if (existing) return existing.promise;

    const record = { controller: new AbortController(), deliver: true } as Inflight<T>;
    let timer: ReturnType<typeof setTimeout>;
    let onAbort: () => void;
    record.promise = new Promise<T>((resolve, reject) => {
      onAbort = () => reject(workspaceDirectoryAbortError());
      record.controller.signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        record.deliver = false;
        // Settle as a timeout before aborting transport: callers must show a
        // retryable failure rather than silently ignoring cancellation.
        reject(Object.assign(new Error("Workspace directory read timed out"), { name: "TimeoutError" }));
        record.controller.abort();
      }, this.timeoutMs);
      // The executor also converts a synchronous loader failure to a rejection.
      loader(record.controller.signal).then(value => {
        if (!record.deliver) { reject(workspaceDirectoryAbortError()); return; }
        if (value !== null && value !== undefined) this.set(key, value);
        resolve(value);
      }, reject);
    })
      .finally(() => {
        clearTimeout(timer);
        record.controller.signal.removeEventListener("abort", onAbort);
        if (this.inflight.get(key) === record) this.inflight.delete(key);
      });
    this.inflight.set(key, record);
    return record.promise;
  }

  /**
   * Drop a single binding or every binding, abort every in-flight read and
   * block late delivery. Subscribers are notified with the affected keys (or
   * `null` when all were cleared) and the reason mode.
   */
  invalidate(
    key?: string,
    mode: WorkspaceDirectoryInvalidationMode = "revalidate",
  ): void {
    const keys =
      key === undefined
        ? [...new Set([...this.entries.keys(), ...this.inflight.keys()])]
        : [key];
    for (const target of keys) {
      this.entries.delete(target);
      const inflight = this.inflight.get(target);
      if (inflight) {
        inflight.deliver = false;
        inflight.controller.abort();
        this.inflight.delete(target);
      }
    }
    // Always notify: a live reader may still hold the pre-mutation snapshot even
    // if its cache entry already expired, and must react.
    this.notify(key === undefined ? null : [key], mode);
  }

  invalidateAll(mode: WorkspaceDirectoryInvalidationMode = "revalidate"): void {
    this.invalidate(undefined, mode);
  }

  subscribe(listener: WorkspaceDirectoryInvalidationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  size(): number {
    return this.entries.size;
  }

  private notify(
    keys: readonly string[] | null,
    mode: WorkspaceDirectoryInvalidationMode,
  ): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(keys, mode);
      } catch {
        // A broken subscriber must not break invalidation for the others.
      }
    }
  }
}

/** Shared singleton for the live shell. */
const workspaceDirectoryCache = new WorkspaceDirectoryCache<WorkspaceDirectorySnapshot>();

export function readCachedWorkspaceDirectory(
  binding: string | null | undefined,
): WorkspaceDirectorySnapshot | null {
  return binding ? workspaceDirectoryCache.read(binding) : null;
}

export function loadWorkspaceDirectory(
  binding: string,
  loader: WorkspaceDirectoryLoader<WorkspaceDirectorySnapshot>,
  options?: { force?: boolean },
): Promise<WorkspaceDirectorySnapshot> {
  return workspaceDirectoryCache.load(binding, loader, options);
}

export function invalidateWorkspaceDirectory(
  binding?: string,
  mode: WorkspaceDirectoryInvalidationMode = "revalidate",
): void {
  workspaceDirectoryCache.invalidate(binding, mode);
}

export function subscribeWorkspaceDirectoryInvalidation(
  listener: WorkspaceDirectoryInvalidationListener,
): () => void {
  return workspaceDirectoryCache.subscribe(listener);
}

/**
 * Prefixes whose successful non-read requests can change the authorized People /
 * Session directory or the evidence and identity state the workspace reads.
 * Telemetry, lab, eval, health, meeting drafts and preference writes are
 * deliberately excluded: they do not change the directory projection.
 */
const PRIVATE_DATA_MUTATION_PREFIXES = [
  "/api/workspace-sessions",
  "/api/workspace-chat",
  "/api/local-integration",
  "/api/contact-agent",
  "/api/browser-extension/captures",
  "/api/captures",
] as const;

/** POSTs under these prefixes are read-only projections, not mutations. */
const READ_ONLY_POST_PATHS = new Set([
  "/api/local-integration/people/search",
]);

/**
 * A successful private-data mutation must drop the cached read model so the
 * next navigation renders the server's answer instead of a pre-mutation
 * snapshot. Conservative by design: reads and unrelated endpoints leave the
 * entry alone, while evidence/identity/contact mutations invalidate.
 */
export function workspaceDirectoryMutationInvalidates(
  method: string,
  pathname: string,
): boolean {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return false;
  if (READ_ONLY_POST_PATHS.has(pathname)) return false;
  // This route only saves the composer draft; typing must not clear the shell.
  // Creation, sending and deletion have separate endpoints/methods below.
  if (verb === "PUT" && /^\/api\/workspace-sessions\/[^/]+$/.test(pathname)) return false;
  return PRIVATE_DATA_MUTATION_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Only additive queue admission may retain an already authorized projection.
 * Queue mutations (including Withdraw), identity changes and deletion retain
 * the conservative clear-before-readback policy. This never preserves cache
 * entries or grants new readers access to stale data. */
export function workspaceDirectoryMutationInvalidationMode(
  method: string,
  pathname: string,
): Exclude<WorkspaceDirectoryInvalidationMode, "discard"> | null {
  if (!workspaceDirectoryMutationInvalidates(method, pathname)) return null;
  return method.toUpperCase() === "POST" && /^\/api\/workspace-sessions\/[^/]+\/conversation-queue$/.test(pathname)
    ? "refresh"
    : "revalidate";
}
