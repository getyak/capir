/** Synthetic transport/clock policy only. These stubs are not a real PG,
 * credential, SourceAuth, private result marker or publication grant. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { ApiError } from "../lib/apiError.js";
import type { LegacyChatAuthority } from "./legacyChatAuthority.js";
import { inSavedMemoryCanonicalTransaction, SavedMemoryCanonicalCommitUnknown } from "./savedMemoryCanonicalTransaction.js";

afterEach(() => { vi.useRealTimers(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function transport() {
  const events: string[] = [];
  const hooks: { begin?: () => unknown; commit?: () => unknown; rollback?: () => unknown } = {};
  const query = vi.fn((sql: string) => {
    events.push(sql);
    const hook = sql === "BEGIN" ? hooks.begin : sql === "COMMIT" ? hooks.commit : sql === "ROLLBACK" ? hooks.rollback : undefined;
    return hook ? hook() : Promise.resolve({ command: sql, rows: [], rowCount: 0 });
  });
  const release = vi.fn((discard?: boolean) => { events.push(discard ? "discard" : "release"); });
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const pool = { connect } as unknown as Pool;
  let expired = false;
  const expiry = new ApiError(409, "SYNTHETIC_CLOCK_EXPIRED", "Synthetic clock expired.");
  const clock = vi.fn(() => { events.push("clock"); if (expired) throw expiry; });
  const authority = { throwIfTerminated: clock } as unknown as LegacyChatAuthority;
  const value = Object.freeze({ syntheticTransportResult: true });
  const operation = vi.fn(async (leased: PoolClient) => {
    expect(leased).toBe(client); events.push("operation"); return value;
  });
  const classify = (protectedResult: boolean) => vi.fn((result: typeof value) => {
    expect(result).toBe(value); events.push("classify"); return protectedResult;
  });
  return { pool, client, connect, query, release, authority, clock, expiry, value, operation, classify, events, hooks,
    expire: () => { expired = true; } };
}

describe("saved Memory canonical transaction (synthetic transport, not PG/auth evidence)", () => {
  it("checks the original synchronous owner on both sides of acknowledged COMMIT and releases its single lease", async () => {
    const f = transport(), governed = f.classify(true);
    await expect(inSavedMemoryCanonicalTransaction(f.pool, f.authority, f.operation, governed)).resolves.toBe(f.value);
    expect(f.events).toEqual(["BEGIN", "operation", "classify", "clock", "COMMIT", "clock", "release"]);
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(f.operation).toHaveBeenCalledTimes(1);
    expect(governed).toHaveBeenCalledTimes(1);
    expect(f.release.mock.calls).toEqual([[]]);
  });

  it("rolls back a pre-COMMIT operation error without calling the classifier or clock", async () => {
    const f = transport(), failure = new Error("Synthetic operation failure"), governed = f.classify(true);
    const operation = vi.fn(async () => { f.events.push("operation"); throw failure; });
    await expect(inSavedMemoryCanonicalTransaction(f.pool, f.authority, operation, governed)).rejects.toBe(failure);
    expect(f.events).toEqual(["BEGIN", "operation", "ROLLBACK", "release"]);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(governed).not.toHaveBeenCalled();
    expect(f.clock).not.toHaveBeenCalled();
    expect(f.release.mock.calls).toEqual([[]]);
  });

  it("preserves the ordinary rollback attempt after BEGIN fails, without starting the operation", async () => {
    const f = transport(), failure = new Error("Synthetic BEGIN failure");
    f.hooks.begin = () => Promise.reject(failure);
    await expect(inSavedMemoryCanonicalTransaction(f.pool, f.authority, f.operation, f.classify(true))).rejects.toBe(failure);
    expect(f.events).toEqual(["BEGIN", "ROLLBACK", "release"]);
    expect(f.operation).not.toHaveBeenCalled();
    expect(f.clock).not.toHaveBeenCalled();
    expect(f.release.mock.calls).toEqual([[]]);
  });

  it("rolls back when the original synchronous pre-send clock rejects", async () => {
    const f = transport(); f.expire();
    await expect(inSavedMemoryCanonicalTransaction(f.pool, f.authority, f.operation, f.classify(true))).rejects.toBe(f.expiry);
    expect(f.events).toEqual(["BEGIN", "operation", "classify", "clock", "ROLLBACK", "release"]);
    expect(f.operation).toHaveBeenCalledTimes(1);
    expect(f.release.mock.calls).toEqual([[]]);
  });

  it.each(["synchronous", "asynchronous"] as const)("treats a %s COMMIT exception as unknown, discards, and never rolls back or reruns", async mode => {
    const f = transport(), privateFailure = new Error("Synthetic private transport detail");
    f.hooks.commit = () => {
      if (mode === "synchronous") throw privateFailure;
      return Promise.reject(privateFailure);
    };
    const pending = inSavedMemoryCanonicalTransaction(f.pool, f.authority, f.operation, f.classify(true));
    await expect(pending).rejects.toBeInstanceOf(SavedMemoryCanonicalCommitUnknown);
    await expect(pending).rejects.toMatchObject({ statusCode: 503, code: "SAVED_MEMORY_COMMIT_UNKNOWN" });
    expect(f.events).toEqual(["BEGIN", "operation", "classify", "clock", "COMMIT", "discard"]);
    expect(f.operation).toHaveBeenCalledTimes(1);
    expect(f.clock).toHaveBeenCalledTimes(1);
    expect(f.release.mock.calls).toEqual([[true]]);
    const publicFailure = new SavedMemoryCanonicalCommitUnknown();
    expect(publicFailure).toBeInstanceOf(ApiError);
    expect(publicFailure.message).toContain("同一请求");
    expect(publicFailure.message).not.toContain(privateFailure.message);
    expect(publicFailure.message).not.toContain("回滚");
  });

  it("rejects an expired owner after a known ACK without claiming unknown or attempting rollback", async () => {
    const f = transport(), entered = deferred<void>(), ack = deferred<unknown>();
    f.hooks.commit = () => { entered.resolve(undefined); return ack.promise; };
    const pending = inSavedMemoryCanonicalTransaction(f.pool, f.authority, f.operation, f.classify(true));
    const rejection = expect(pending).rejects.toBe(f.expiry);
    await entered.promise;
    f.expire(); ack.resolve({ command: "COMMIT", rows: [], rowCount: 0 });
    await rejection;
    expect(f.events).toEqual(["BEGIN", "operation", "classify", "clock", "COMMIT", "clock", "release"]);
    expect(f.operation).toHaveBeenCalledTimes(1);
    expect(f.release.mock.calls).toEqual([[]]);
  });

  it("refuses a known ROLLBACK acknowledgement without retrying or sending another rollback", async () => {
    const f = transport();
    f.hooks.commit = () => Promise.resolve({ command: "ROLLBACK", rows: [], rowCount: 0 });
    const pending = inSavedMemoryCanonicalTransaction(f.pool, f.authority, f.operation, f.classify(true));
    await expect(pending).rejects.toMatchObject({ statusCode: 409, code: "SAVED_MEMORY_COMPLETION_NOT_COMMITTED" });
    expect(f.events).toEqual(["BEGIN", "operation", "classify", "clock", "COMMIT", "discard"]);
    expect(f.operation).toHaveBeenCalledTimes(1);
    expect(f.clock).toHaveBeenCalledTimes(1);
    expect(f.release.mock.calls).toEqual([[true]]);
  });

  it.each([
    { name: "missing", ack: {} },
    { name: "unrecognized", ack: { command: "UNKNOWN" } },
    { name: "null", ack: null },
  ])("treats a $name command acknowledgement as unknown, never as COMMIT or rollback", async ({ ack }) => {
    const f = transport(); f.hooks.commit = () => Promise.resolve(ack);
    await expect(inSavedMemoryCanonicalTransaction(f.pool, f.authority, f.operation, f.classify(true)))
      .rejects.toBeInstanceOf(SavedMemoryCanonicalCommitUnknown);
    expect(f.events).toEqual(["BEGIN", "operation", "classify", "clock", "COMMIT", "discard"]);
    expect(f.operation).toHaveBeenCalledTimes(1);
    expect(f.release.mock.calls).toEqual([[true]]);
  });

  it("keeps the ungoverned success path ordinary without using the extra C03 clock", async () => {
    const f = transport(); f.expire();
    await expect(inSavedMemoryCanonicalTransaction(f.pool, f.authority, f.operation, f.classify(false))).resolves.toBe(f.value);
    expect(f.events).toEqual(["BEGIN", "operation", "classify", "COMMIT", "release"]);
    expect(f.clock).not.toHaveBeenCalled();
    expect(f.release.mock.calls).toEqual([[]]);
  });

  it("retains ordinary rollback and original-error behavior for an ungoverned COMMIT failure", async () => {
    const f = transport(), failure = new Error("Synthetic ordinary COMMIT failure");
    f.hooks.commit = () => Promise.reject(failure);
    await expect(inSavedMemoryCanonicalTransaction(f.pool, f.authority, f.operation, f.classify(false))).rejects.toBe(failure);
    expect(f.events).toEqual(["BEGIN", "operation", "classify", "COMMIT", "ROLLBACK", "release"]);
    expect(f.clock).not.toHaveBeenCalled();
    expect(f.release.mock.calls).toEqual([[]]);
  });

  it("keeps successful ungoverned acknowledgements unconstrained like the original pool adapter", async () => {
    const f = transport(); f.hooks.commit = () => Promise.resolve({ rows: [] });
    await expect(inSavedMemoryCanonicalTransaction(f.pool, f.authority, f.operation, f.classify(false))).resolves.toBe(f.value);
    expect(f.events).toEqual(["BEGIN", "operation", "classify", "COMMIT", "release"]);
    expect(f.clock).not.toHaveBeenCalled();
    expect(f.release.mock.calls).toEqual([[]]);
  });

  it("retains ordinary rollback-error precedence rather than reclassifying it as unknown", async () => {
    const f = transport(), failure = new Error("Synthetic ordinary COMMIT failure"), rollback = new Error("Synthetic rollback failure");
    f.hooks.commit = () => Promise.reject(failure);
    f.hooks.rollback = () => Promise.reject(rollback);
    await expect(inSavedMemoryCanonicalTransaction(f.pool, f.authority, f.operation, f.classify(false))).rejects.toBe(rollback);
    expect(f.events).toEqual(["BEGIN", "operation", "classify", "COMMIT", "ROLLBACK", "release"]);
    expect(f.release.mock.calls).toEqual([[]]);
  });

  it("bounds borrow to two seconds and only releases its own late client without starting SQL or work", async () => {
    vi.useFakeTimers();
    const f = transport(), lease = deferred<PoolClient>();
    const connect = vi.fn(() => lease.promise), pool = { connect } as unknown as Pool;
    const governed = f.classify(true), pending = inSavedMemoryCanonicalTransaction(pool, f.authority, f.operation, governed);
    const rejection = expect(pending).rejects.toMatchObject({ statusCode: 503, code: "SAVED_MEMORY_DATABASE_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    lease.resolve(f.client);
    await Promise.resolve(); await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.operation).not.toHaveBeenCalled();
    expect(governed).not.toHaveBeenCalled();
    expect(f.clock).not.toHaveBeenCalled();
    expect(f.release.mock.calls).toEqual([[]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the borrow timer on acquisition failure without touching any client or operation", async () => {
    vi.useFakeTimers();
    const f = transport(), failure = new Error("Synthetic connection failure");
    const pool = { connect: vi.fn(() => Promise.reject(failure)) } as unknown as Pool;
    await expect(inSavedMemoryCanonicalTransaction(pool, f.authority, f.operation, f.classify(true))).rejects.toBe(failure);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.release).not.toHaveBeenCalled();
    expect(f.operation).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps ordinary acquisition pending beyond two seconds without adding the bounded-borrow timer", async () => {
    vi.useFakeTimers();
    const f = transport(), lease = deferred<PoolClient>();
    const pool = { connect: vi.fn(() => lease.promise) } as unknown as Pool;
    const pending = inSavedMemoryCanonicalTransaction(pool, f.authority, f.operation, f.classify(false), { boundedBorrow: false });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2_001);
    expect(f.operation).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
    lease.resolve(f.client);
    await expect(pending).resolves.toBe(f.value);
    expect(f.events).toEqual(["BEGIN", "operation", "classify", "COMMIT", "release"]);
    expect(f.release.mock.calls).toEqual([[]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps governed COMMIT protection with ordinary acquisition and no new borrow timer", async () => {
    vi.useFakeTimers();
    const f = transport(); f.hooks.commit = () => Promise.reject(new Error("Synthetic ordinary-borrow ACK failure"));
    await expect(inSavedMemoryCanonicalTransaction(f.pool, f.authority, f.operation, f.classify(true), { boundedBorrow: false }))
      .rejects.toMatchObject({ statusCode: 503, code: "SAVED_MEMORY_COMMIT_UNKNOWN" });
    expect(f.events).toEqual(["BEGIN", "operation", "classify", "clock", "COMMIT", "discard"]);
    expect(f.operation).toHaveBeenCalledTimes(1);
    expect(f.release.mock.calls).toEqual([[true]]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
