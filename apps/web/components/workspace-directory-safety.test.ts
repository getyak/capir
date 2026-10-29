import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  WorkspaceDirectoryCache,
  invalidateWorkspaceDirectory,
  loadWorkspaceDirectory,
  readCachedWorkspaceDirectory,
  subscribeWorkspaceDirectoryInvalidation,
  workspaceDirectoryMutationInvalidates,
  workspaceDirectoryMutationInvalidationMode,
  workspaceDirectoryScopeTransition,
  type WorkspaceDirectorySnapshot,
} from "@/lib/workspace-directory-cache";

import { activeDirectorySessions, readWorkspaceDirectory } from "./workspace-search";
import { workspaceSessionFetch } from "./workspace-session-request";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const sessions = { session_version: "account-a", sessions: [] };

const emptySnapshot: WorkspaceDirectorySnapshot = { people: {}, sessions: {} };

afterEach(() => {
  invalidateWorkspaceDirectory();
  vi.unstubAllGlobals();
});

describe("disposable workspace directory", () => {
  it("does not publish the old account after cancellation during body decoding", async () => {
    const body = deferred<unknown>();
    const controller = new AbortController();
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ people: [{ id: "a", display_label: "Private A" }] }))
      .mockResolvedValueOnce({ ok: true, json: () => body.promise });
    const pending = readWorkspaceDirectory("account-a", controller.signal, request);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    controller.abort();
    body.resolve(sessions);
    expect(await pending).toBeNull();
  });

  it("fails closed for a different credential binding even when people were returned", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ people: [{ id: "a", display_label: "Private A" }] }))
      .mockResolvedValueOnce(Response.json(sessions));
    await expect(readWorkspaceDirectory("account-b", new AbortController().signal, request)).rejects.toThrow("binding");
  });

  it("performs fresh uncached reads on each directory activation", async () => {
    const request = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      expect(options?.cache).toBe("no-store");
      return String(url).includes("people") ? Response.json({ people: [] }) : Response.json(sessions);
    });
    await readWorkspaceDirectory("account-a", new AbortController().signal, request);
    await readWorkspaceDirectory("account-a", new AbortController().signal, request);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls.every(([, options]) => options?.cache === "no-store")).toBe(true);
  });

  it("removes exact-deadline, deleted and malformed rows without another request", () => {
    const row = { session_id: "a", state: "active", expires_at: "2030-01-01T00:00:00Z" };
    const expiry = Date.parse(row.expires_at);
    const payload = { sessions: [row, { ...row, state: "deleted" }, { ...row, expires_at: "invalid" }] };
    expect(activeDirectorySessions(payload, expiry - 1).sessions).toEqual([row]);
    expect(activeDirectorySessions(payload, expiry).sessions).toEqual([]);
  });
});

describe("bounded directory continuity cache", () => {
  it("retains mounted projections for send admission and title-only rename", () => {
    const admission = "/api/workspace-sessions/11111111-1111-4111-8111-111111111111/conversation-queue";
    expect(workspaceDirectoryMutationInvalidationMode("POST", admission)).toBe("refresh");
    expect(workspaceDirectoryMutationInvalidationMode("post", admission)).toBe("refresh");
    expect(workspaceDirectoryMutationInvalidationMode("PATCH", "/api/workspace-sessions/session-a")).toBe("refresh");
    for (const [method, pathname] of [
      ["POST", `${admission}/mutations`],
      ["POST", `${admission}/stream`],
      ["DELETE", admission],
      ["PATCH", admission],
      ["POST", "/api/workspace-sessions"],
      ["DELETE", "/api/workspace-sessions/session-a"],
      ["POST", "/api/workspace-chat"],
      ["POST", "/api/local-integration/people"],
      ["POST", "/api/local-integration/person-merges"],
    ]) expect(workspaceDirectoryMutationInvalidationMode(method, pathname)).toBe("revalidate");
    expect(workspaceDirectoryMutationInvalidationMode("GET", admission)).toBeNull();
    expect(workspaceDirectoryMutationInvalidationMode("PUT", "/api/workspace-sessions/session-a")).toBeNull();
    expect(workspaceDirectoryMutationInvalidationMode("POST", "/api/telemetry/traces")).toBeNull();
  });

  it("invalidates sent conversations but leaves composer-only saves quiet", () => {
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/workspace-chat")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("PUT", "/api/workspace-sessions/session-a")).toBe(false);
    expect(workspaceDirectoryMutationInvalidates("DELETE", "/api/workspace-sessions/session-a")).toBe(true);
  });

  it("does not deliver a cache hit invalidated before its microtask runs", async () => {
    const cache = new WorkspaceDirectoryCache<{ id: string }>();
    await cache.load("a", async () => ({ id: "old" }));
    const hit = cache.load("a", async () => ({ id: "unexpected" }));
    cache.invalidate("a", "discard");
    await expect(hit).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reuses a fresh entry instead of re-reading within the TTL", async () => {
    let now = 1_000;
    const cache = new WorkspaceDirectoryCache<{ id: string }>({ ttlMs: 30_000, now: () => now });
    const loader = vi.fn(async () => ({ id: "account-a" }));

    await expect(cache.load("account-a", loader)).resolves.toEqual({ id: "account-a" });
    now += 29_999;
    await expect(cache.load("account-a", loader)).resolves.toEqual({ id: "account-a" });
    expect(loader).toHaveBeenCalledTimes(1);

    now += 1_000;
    await expect(cache.load("account-a", loader)).resolves.toEqual({ id: "account-a" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent readers of the same binding into one read", async () => {
    const gate = deferred<void>();
    const cache = new WorkspaceDirectoryCache<{ id: string }>();
    const loader = vi.fn(async () => {
      await gate.promise;
      return { id: "account-a" };
    });

    const first = cache.load("account-a", loader);
    const second = cache.load("account-a", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    gate.resolve();
    await expect(first).resolves.toEqual({ id: "account-a" });
    await expect(second).resolves.toEqual({ id: "account-a" });
  });

  it("never caches a rejection, so a 401 or error is retried fresh", async () => {
    const cache = new WorkspaceDirectoryCache<{ id: string }>();
    const loader = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("backend_session_expired"), { status: 401 }))
      .mockResolvedValueOnce({ id: "account-a" });

    await expect(cache.load("account-a", loader)).rejects.toThrow("backend_session_expired");
    expect(cache.read("account-a")).toBeNull();
    await expect(cache.load("account-a", loader)).resolves.toEqual({ id: "account-a" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("isolates bindings so invalidating one account keeps the other", async () => {
    const cache = new WorkspaceDirectoryCache<{ id: string }>();
    const loadA = vi.fn(async () => ({ id: "account-a" }));
    const loadB = vi.fn(async () => ({ id: "account-b" }));

    await cache.load("account-a", loadA);
    await cache.load("account-b", loadB);
    cache.invalidate("account-a", "discard");

    expect(cache.read("account-a")).toBeNull();
    expect(cache.read("account-b")).toEqual({ id: "account-b" });
    // The surviving entry is reused, not re-fetched.
    await cache.load("account-b", loadB);
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it("rejects a late in-flight result after invalidation (mutation race)", async () => {
    const cache = new WorkspaceDirectoryCache<{ id: string }>();
    // The loader ignores its abort signal and resolves a pre-mutation value.
    const late = deferred<{ id: string }>();
    const pending = cache.load("account-a", () => late.promise);

    cache.invalidate("account-a");
    late.resolve({ id: "pre-mutation" });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.read("account-a")).toBeNull();

    const loader = vi.fn(async () => ({ id: "post-mutation" }));
    await expect(cache.load("account-a", loader)).resolves.toEqual({ id: "post-mutation" });
    expect(cache.read("account-a")).toEqual({ id: "post-mutation" });
  });

  it("rejects an abort-ignoring loader that resolves after a discard", async () => {
    const cache = new WorkspaceDirectoryCache<{ id: string }>();
    const late = deferred<{ id: string }>();
    const pending = cache.load("account-a", () => late.promise);

    cache.invalidate("account-a", "discard");
    late.resolve({ id: "private" });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.read("account-a")).toBeNull();
  });

  it("aborts the invalidated read and notifies subscribers with its keys and mode", async () => {
    const cache = new WorkspaceDirectoryCache<{ id: string }>();
    const subscriber = vi.fn();
    cache.subscribe(subscriber);
    const loader = vi.fn((signal: AbortSignal) => new Promise<{ id: string }>((_resolve, reject) => {
      signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));

    const pending = cache.load("account-a", loader);
    cache.invalidate("account-a");
    expect(loader.mock.calls[0][0].aborted).toBe(true);
    await expect(pending).rejects.toThrow("aborted");
    expect(subscriber).toHaveBeenCalledWith(["account-a"], "revalidate");
  });

  it("clears every binding with a discard and reports the mode", async () => {
    const cache = new WorkspaceDirectoryCache<{ id: string }>();
    await cache.load("account-a", async () => ({ id: "a" }));
    await cache.load("account-b", async () => ({ id: "b" }));
    const subscriber = vi.fn();
    cache.subscribe(subscriber);

    cache.invalidateAll("discard");

    expect(cache.read("account-a")).toBeNull();
    expect(cache.read("account-b")).toBeNull();
    expect(subscriber).toHaveBeenCalledWith(null, "discard");
  });

  it("force revalidates even when a fresh entry exists (explicit retry)", async () => {
    const cache = new WorkspaceDirectoryCache<{ id: string }>();
    const loader = vi.fn(async () => ({ id: "account-a" }));
    await cache.load("account-a", loader);
    await cache.load("account-a", loader, { force: true });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("bounds retained bindings and evicts the oldest", async () => {
    const cache = new WorkspaceDirectoryCache<{ id: string }>({ maxEntries: 2 });
    for (const id of ["a", "b", "c"]) {
      await cache.load(`account-${id}`, async () => ({ id }));
    }
    expect(cache.size()).toBe(2);
    expect(cache.read("account-a")).toBeNull();
    expect(cache.read("account-c")).toEqual({ id: "c" });
  });

  it("invalidates conservative private-data mutations and excludes read-only APIs", () => {
    // Reads never invalidate.
    expect(workspaceDirectoryMutationInvalidates("GET", "/api/workspace-sessions")).toBe(false);
    expect(workspaceDirectoryMutationInvalidates("HEAD", "/api/local-integration/people")).toBe(false);
    // Session + People directory mutations.
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/workspace-sessions")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("DELETE", "/api/workspace-sessions/session-1")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/local-integration/people")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("PATCH", "/api/local-integration/people/person-1")).toBe(true);
    // Contact create/confirm, captures, evidence and identity mutations.
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/contact-agent/people")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/contact-agent/tasks/task-1/confirm")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/browser-extension/captures")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/captures/screenshot-analysis")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/local-integration/captures")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/local-integration/captures/capture-1/identity-corrections")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/local-integration/evidence-fragments/fragment-1/reviews")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/local-integration/identity-resolution-cases/case-1/decisions")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/local-integration/person-merges")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/local-integration/resource-claims/assertion-1/decisions")).toBe(true);
    // POSTs that are read-only projections do not invalidate.
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/local-integration/people/search")).toBe(false);
    // Unrelated or non-directory APIs do not invalidate.
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/telemetry/traces")).toBe(false);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/lab/sessions")).toBe(false);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/meeting-drafts/draft-1/dismiss")).toBe(false);
    expect(workspaceDirectoryMutationInvalidates("PUT", "/api/agent-preferences")).toBe(false);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/workspace-chat")).toBe(true);
    expect(workspaceDirectoryMutationInvalidates("POST", "/api/analyze")).toBe(false);
  });
});

describe("workspace directory scope boundary policy", () => {
  it("discards every binding when identity disappears (logout/expired)", () => {
    expect(workspaceDirectoryScopeTransition("account-a", null)).toEqual({ kind: "discard-all" });
    expect(workspaceDirectoryScopeTransition("account-a", undefined)).toEqual({ kind: "discard-all" });
    expect(workspaceDirectoryScopeTransition(null, null)).toEqual({ kind: "none" });
  });

  it("discards only the previous binding on an identity swap", () => {
    expect(workspaceDirectoryScopeTransition("account-a", "account-b")).toEqual({
      kind: "discard-previous",
      previous: "account-a",
    });
  });

  it("keeps a new account's own cache and stable bindings", () => {
    expect(workspaceDirectoryScopeTransition(null, "account-a")).toEqual({ kind: "none" });
    expect(workspaceDirectoryScopeTransition("account-a", "account-a")).toEqual({ kind: "none" });
  });

  it("keeps the mountable boundary wired to discard semantics", () => {
    const source = readFileSync(
      new URL("./workspace-directory-cache.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('"use client"');
    expect(source).toContain("workspaceDirectoryScopeTransition");
    expect(source).toContain('"discard"');
  });
});

describe("directory cache lifecycle through workspaceSessionFetch", () => {
  function browser() {
    vi.stubGlobal("window", {
      location: { href: "http://localhost:3000/workspace/today", origin: "http://localhost:3000" },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      querySelector: () => ({ dataset: { workspaceScope: "account-a" } }),
    });
  }

  it("drops the cached directory after a successful Session mutation", async () => {
    await loadWorkspaceDirectory("account-a", async () => emptySnapshot);
    expect(readCachedWorkspaceDirectory("account-a")).not.toBeNull();

    browser();
    const request = vi.fn(async () => Response.json({ ok: true }));
    const response = await workspaceSessionFetch(
      "/api/workspace-sessions",
      { method: "POST" },
      request,
    );
    expect(response.ok).toBe(true);
    expect(readCachedWorkspaceDirectory("account-a")).toBeNull();
  });

  it("keeps the cached directory after a plain read", async () => {
    await loadWorkspaceDirectory("account-a", async () => emptySnapshot);
    browser();
    const request = vi.fn(async () => Response.json({ ok: true }));
    await workspaceSessionFetch("/api/workspace-sessions", undefined, request);
    expect(readCachedWorkspaceDirectory("account-a")).toEqual(emptySnapshot);
  });

  it("notifies live subscribers when a mutation invalidates the shared cache", async () => {
    await loadWorkspaceDirectory("account-a", async () => emptySnapshot);
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceDirectoryInvalidation(listener);

    browser();
    const request = vi.fn(async () => Response.json({ ok: true }));
    await workspaceSessionFetch(
      "/api/local-integration/people",
      { method: "POST", body: "{}" },
      request,
    );

    expect(listener).toHaveBeenCalledWith(null, "revalidate");
    unsubscribe();
  });

  it("drops the snapshot and discards without refetch on a generic 401", async () => {
    await loadWorkspaceDirectory("account-a", async () => emptySnapshot);
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceDirectoryInvalidation(listener);
    browser();
    const request = vi.fn(async () =>
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );
    const response = await workspaceSessionFetch(
      "/api/workspace-sessions",
      undefined,
      request,
    );
    expect(response.status).toBe(401);
    expect(readCachedWorkspaceDirectory("account-a")).toBeNull();
    expect(listener).toHaveBeenCalledWith(null, "discard");
    unsubscribe();
  });

  it("drops the snapshot on an expired backend session (401)", async () => {
    await loadWorkspaceDirectory("account-a", async () => emptySnapshot);
    browser();
    const request = vi.fn(async () =>
      Response.json({ code: "backend_session_expired" }, { status: 401 }),
    );
    const response = await workspaceSessionFetch(
      "/api/workspace-sessions",
      undefined,
      request,
    );
    expect(response.status).toBe(401);
    expect(readCachedWorkspaceDirectory("account-a")).toBeNull();
  });

  it("invalidates a conservative contact-confirm mutation", async () => {
    await loadWorkspaceDirectory("account-a", async () => emptySnapshot);
    browser();
    const request = vi.fn(async () => Response.json({ ok: true }));
    await workspaceSessionFetch(
      "/api/contact-agent/tasks/task-1/confirm",
      { method: "POST", body: "{}" },
      request,
    );
    expect(readCachedWorkspaceDirectory("account-a")).toBeNull();
  });
});

describe("directory request deadlines", () => {
  it("releases a hung shared read for retry and never caches its late result", async () => {
    vi.useFakeTimers();
    const cache = new WorkspaceDirectoryCache<{ id: string }>({ timeoutMs: 50 });
    const late = deferred<{ id: string }>();
    let signal!: AbortSignal;
    try {
      const pending = cache.load("a", input => { signal = input; return late.promise; });
      expect(cache.load("a", async () => ({ id: "unused" }), { force: true })).toBe(pending);
      let failure: unknown = null;
      void pending.catch(error => { failure = error; });
      await vi.advanceTimersByTimeAsync(50);
      expect(failure).toMatchObject({ name: "TimeoutError" });
      expect(signal.aborted).toBe(true);
      await expect(cache.load("a", async () => ({ id: "fresh" }), { force: true }))
        .resolves.toEqual({ id: "fresh" });
      late.resolve({ id: "old" });
      await Promise.resolve();
      expect(cache.read("a")).toEqual({ id: "fresh" });
      expect(vi.getTimerCount()).toBe(0);
    } finally { cache.invalidateAll(); vi.useRealTimers(); }
  });

  it("bounds body decoding as well as waiting for response headers", async () => {
    vi.useFakeTimers();
    const cache = new WorkspaceDirectoryCache<WorkspaceDirectorySnapshot | null>({ timeoutMs: 50 });
    const body = deferred<unknown>();
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ people: [] }))
      .mockResolvedValueOnce({ ok: true, json: () => body.promise });
    try {
      let failure: unknown = null;
      const pending = cache.load("account-a", signal => readWorkspaceDirectory("account-a", signal, request));
      void pending.catch(error => { failure = error; });
      await vi.advanceTimersByTimeAsync(50);
      expect(request).toHaveBeenCalledTimes(2);
      expect(failure).toMatchObject({ name: "TimeoutError" });
      body.resolve(sessions);
      await Promise.resolve();
      expect(cache.read("account-a")).toBeNull();
    } finally { cache.invalidateAll(); vi.useRealTimers(); }
  });

  it("settles an invalidated read even if the loader ignores cancellation", async () => {
    const cache = new WorkspaceDirectoryCache<unknown>();
    let failure: unknown = null;
    const pending = cache.load("a", () => new Promise(() => {}));
    void pending.catch(error => { failure = error; });
    cache.invalidate("a", "discard");
    await vi.waitFor(() => expect(failure).toMatchObject({ name: "AbortError" }), { timeout: 100, interval: 5 });
    await expect(cache.load("b", async () => "other account")).resolves.toBe("other account");
  });
});

it.each(["aborted", "changed-scope"])("does not expire a current account from a late %s response", async (transition) => {
  const event = vi.fn();
  let scope = "account-a";
  vi.stubGlobal("window", { location: { href: "http://localhost:3000/workspace", origin: "http://localhost:3000" }, dispatchEvent: event });
  vi.stubGlobal("document", { querySelector: () => ({ dataset: { workspaceScope: scope } }) });
  const controller = new AbortController();
  const pending = deferred<Response>();
  const result = workspaceSessionFetch("/api/workspace-sessions", { signal: controller.signal }, () => pending.promise);
  if (transition === "aborted") controller.abort(); else scope = "account-b";
  const current: WorkspaceDirectorySnapshot = { people: { people: [{ id: "current" }] }, sessions: {} };
  await loadWorkspaceDirectory("current", async () => current);
  pending.resolve(Response.json({ code: "SESSION_EXPIRED" }, { status: 401, headers: { "X-Talent-Signal-Session-Status": "expired" } }));
  await result;
  expect(event).not.toHaveBeenCalled();
  expect(readCachedWorkspaceDirectory("current")).toEqual(current);
});

it("does not trust an expiry header from another origin or a non-401 reply", async () => {
  const event = vi.fn();
  vi.stubGlobal("window", { location: { href: "http://localhost:3000/workspace", origin: "http://localhost:3000" }, dispatchEvent: event });
  vi.stubGlobal("document", { querySelector: () => ({ dataset: { workspaceScope: "account-a" } }) });
  for (const [url, status] of [["https://other.invalid/api/read", 401], ["/api/workspace-sessions", 503]] as const) {
    await workspaceSessionFetch(url, {}, async () => Response.json({}, { status, headers: { "X-Talent-Signal-Session-Status": "expired" } }));
  }
  expect(event).not.toHaveBeenCalled();
});

it("does not apply a legacy body-only expiry after the account changes during decoding", async () => {
  const event = vi.fn();
  let scope = "account-a";
  vi.stubGlobal("window", { location: { href: "http://localhost:3000/workspace", origin: "http://localhost:3000" }, dispatchEvent: event });
  vi.stubGlobal("document", { querySelector: () => ({ dataset: { workspaceScope: scope } }) });
  const reading = deferred<void>(), body = deferred<unknown>();
  const response = { status: 401, headers: new Headers(), clone: () => ({ json: () => { reading.resolve(); return body.promise; } }) } as Response;
  const pending = workspaceSessionFetch("/api/workspace-sessions", {}, async () => response);
  await reading.promise;
  scope = "account-b";
  body.resolve({ code: "SESSION_EXPIRED" });
  await pending;
  expect(event).not.toHaveBeenCalled();
});
