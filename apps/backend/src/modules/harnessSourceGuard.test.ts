import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withProductRunCapture, type ProductRunSpan } from "@talent-signal/agent";
import { ApiError } from "../lib/apiError.js";
import type { DatabaseClient } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import { assertHarnessLabAuthority, createHarnessSourceGuard, type HarnessSourceAuthority } from "./harnessSourceGuard.js";

const accountID = "11111111-1111-4111-8111-111111111111";
const userID = "22222222-2222-4222-8222-222222222222";
const sessionID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-01-01T00:00:00Z");
const future = new Date("2026-01-02T00:00:00Z");

const auth = (userKind: AuthContext["userKind"] = "lab_human"): AuthContext =>
  ({ accountId: accountID, accountSlug: "slug", userId: userID, userEmail: "human@example.test", userKind, sessionId: "auth-session" });

const workspaceRow = (overrides: Partial<{state:string; expires_at:Date; stop_clear:boolean}> = {}) =>
  ({ state: "active", expires_at: future, stop_clear: true, ...overrides });

const sourceRow = (overrides: Partial<{generation:string; session_stamp:string|null; current:boolean}> = {}) =>
  ({ generation: "0", session_stamp: "stamp-a", current: true, ...overrides });

const authority = (expiresAt: Date = future): HarnessSourceAuthority => ({ expiresAt, personIDs: ["person-1"] });

type QueryResult = { rows: unknown[] };
function fakeClient(impl: (sql: string, params: readonly unknown[]) => Promise<QueryResult>) {
  const query = vi.fn(async (sql: string, params?: unknown[]): Promise<QueryResult> => impl(sql, params ?? []));
  return { query, client: { query } as unknown as DatabaseClient };
}
/** Deterministic per-call responses for admission then recheck reads. */
function queuedClient(...responses: QueryResult[]) {
  const queue = [...responses];
  return fakeClient(async () => queue.shift() ?? { rows: [] });
}

function eventSink() {
  const spans: ProductRunSpan[] = [];
  return { spans, sink: { async append(span: ProductRunSpan) { spans.push(span); } } };
}

/** Exactly one metadata-only failed event naming the observed static branch. */
function expectRejectionEvent(spans: ProductRunSpan[], failureCode: string, phase: string) {
  expect(spans).toHaveLength(1);
  const span = spans[0]!;
  expect(span.name).toBe("harness.source_guard.rejected");
  expect(span.kind).toBe("context");
  expect(span.status).toBe("failed");
  expect(span.error).toBe("Operation failed");
  expect(span.metadata).toEqual({ failure_code: failureCode, phase });
  const empty = { status: "unavailable", original_bytes: 0, retained_bytes: 0, sha256: null };
  expect(span.input).toEqual(empty);
  expect(span.output).toEqual(empty);
}

async function flushAsyncWork() {
  vi.useRealTimers();
  for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve));
}

describe("harness source guard rejection diagnostics", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it("admits a current source, keeps exact query and account bindings and emits no rejected event", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const database = fakeClient(async () => ({ rows: [sourceRow()] }));
    await withProductRunCapture(sink, async () => {
      const guard = await createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(future), probe.client);
      await expect(guard()).resolves.toBeUndefined();
    });
    expect(spans).toEqual([]);
    expect(probe.query).toHaveBeenCalledTimes(2);
    const [probeSQL, probeParams] = probe.query.mock.calls[0]!;
    expect(String(probeSQL)).toContain("pg_try_advisory_xact_lock_shared");
    expect(String(probeSQL)).toContain("FOR SHARE NOWAIT");
    expect(probeParams).toEqual([accountID, userID]);
    expect(database.query).toHaveBeenCalledTimes(2);
    const [sourceSQL, sourceParams] = database.query.mock.calls[0]!;
    expect(String(sourceSQL)).toContain("harness_source_generations");
    expect(String(sourceSQL)).toContain("agent_sessions");
    expect(String(sourceSQL)).toContain("identity_handles");
    expect(sourceParams).toEqual([accountID, userID, sessionID, future, ["person-1"]]);
  });

  it("skips the Lab gate for non-lab users and still checks the source on its own read", async () => {
    const { spans, sink } = eventSink();
    const database = fakeClient(async (sql) => ({ rows: sql.includes("lab_test_workspaces") ? [workspaceRow()] : [sourceRow()] }));
    await withProductRunCapture(sink, async () => {
      const guard = await createHarnessSourceGuard(database.client, auth("apple_human"), sessionID, () => authority(future));
      await expect(guard()).resolves.toBeUndefined();
    });
    expect(spans).toEqual([]);
    expect(database.query).toHaveBeenCalledTimes(2);
    for (const [sql] of database.query.mock.calls) expect(String(sql)).not.toContain("lab_test_workspaces");
  });

  it("passes without a source authority or Session stamp and emits no rejected event", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const database = fakeClient(async () => ({ rows: [sourceRow({ session_stamp: null })] }));
    await withProductRunCapture(sink, async () => {
      const guard = await createHarnessSourceGuard(database.client, auth(), undefined, () => undefined, probe.client);
      await expect(guard()).resolves.toBeUndefined();
    });
    expect(spans).toEqual([]);
  });

  it("labels a missing Lab authority row and denies", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [] }));
    const database = fakeClient(async () => ({ rows: [sourceRow()] }));
    await expect(withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client)))
      .rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED", name: "ApiError" });
    expectRejectionEvent(spans, "LAB_AUTHORITY_MISSING", "admission");
  });

  it("labels a pending Lab stop and denies", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow({ stop_clear: false })] }));
    const database = fakeClient(async () => ({ rows: [sourceRow()] }));
    await expect(withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client)))
      .rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    expectRejectionEvent(spans, "LAB_STOP_PENDING", "admission");
  });

  it("labels an inactive Lab workspace and denies", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow({ state: "ended" })] }));
    const database = fakeClient(async () => ({ rows: [sourceRow()] }));
    await expect(withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client)))
      .rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    expectRejectionEvent(spans, "LAB_WORKSPACE_INACTIVE", "admission");
  });

  it("labels an expired Lab workspace at the exact expiry boundary and denies", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow({ expires_at: NOW })] }));
    const database = fakeClient(async () => ({ rows: [sourceRow()] }));
    await expect(withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client)))
      .rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    expectRejectionEvent(spans, "LAB_WORKSPACE_EXPIRED", "admission");
  });

  it("keeps the one second Lab probe timeout fail closed and labels it", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(() => new Promise<QueryResult>(() => {}));
    const database = fakeClient(async () => ({ rows: [sourceRow()] }));
    let settled = false;
    await withProductRunCapture(sink, async () => {
      const pending = createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client);
      void pending.then(() => { settled = true; }, () => { settled = true; });
      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const error = await pending.then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(409);
      expect((error as ApiError).code).toBe("HARNESS_SOURCE_CHANGED");
    });
    expectRejectionEvent(spans, "PROBE_TIMEOUT", "admission");
  });

  it("maps the exact NOWAIT conflict code to a static enum and never leaks it", async () => {
    const { spans, sink } = eventSink();
    const conflict = Object.assign(new Error("lock_not_available: secret-row-prose"), { code: "55P03" });
    const probe = fakeClient(async () => { throw conflict; });
    const database = fakeClient(async () => ({ rows: [sourceRow()] }));
    const error = await withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client)
      .then(() => null, (caught: unknown) => caught));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBe(conflict);
    expect((error as ApiError).code).toBe("HARNESS_SOURCE_CHANGED");
    expectRejectionEvent(spans, "LOCK_UNAVAILABLE", "admission");
    expect(JSON.stringify(spans)).not.toMatch(/55P03|secret/i);
  });

  it("preserves an unexpected Lab probe error without its prose in the event", async () => {
    const { spans, sink } = eventSink();
    const failure = Object.assign(new Error("secret database prose: credential-like-42"), { code: "42P01" });
    const probe = fakeClient(async () => { throw failure; });
    const database = fakeClient(async () => ({ rows: [sourceRow()] }));
    const error = await withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client)
      .then(() => null, (caught: unknown) => caught));
    expect(error).toBe(failure);
    expectRejectionEvent(spans, "UNEXPECTED_PROBE_FAILURE", "admission");
    expect(JSON.stringify(spans)).not.toMatch(/secret|42P01|credential/i);
  });

  it("preserves an unexpected source read error without its prose in the event", async () => {
    const { spans, sink } = eventSink();
    const failure = new Error("secret source read prose");
    const probe = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const database = fakeClient(async () => { throw failure; });
    const error = await withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client)
      .then(() => null, (caught: unknown) => caught));
    expect(error).toBe(failure);
    expectRejectionEvent(spans, "UNEXPECTED_PROBE_FAILURE", "admission");
    expect(JSON.stringify(spans)).not.toContain("secret");
  });

  it("labels an expired source authority at the exact expiry boundary and denies", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const database = fakeClient(async () => ({ rows: [sourceRow()] }));
    await expect(withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(NOW), probe.client)))
      .rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    expect(database.query).not.toHaveBeenCalled();
    expectRejectionEvent(spans, "SOURCE_AUTHORITY_EXPIRED_OR_INVALID", "admission");
  });

  it("labels a non-finite source authority and denies", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const database = fakeClient(async () => ({ rows: [sourceRow()] }));
    await expect(withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(new Date(NaN)), probe.client)))
      .rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    expectRejectionEvent(spans, "SOURCE_AUTHORITY_EXPIRED_OR_INVALID", "admission");
  });

  it("labels a missing source row and denies", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const database = fakeClient(async () => ({ rows: [] }));
    await expect(withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client)))
      .rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    expectRejectionEvent(spans, "SOURCE_ROW_UNAVAILABLE", "admission");
  });

  it("labels a source that is not current and denies", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const database = fakeClient(async () => ({ rows: [sourceRow({ current: false })] }));
    await expect(withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client)))
      .rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    expectRejectionEvent(spans, "SOURCE_NOT_CURRENT", "admission");
  });

  it("labels a missing Session stamp at admission and denies", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const database = fakeClient(async () => ({ rows: [sourceRow({ session_stamp: null })] }));
    await expect(withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client)))
      .rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    expectRejectionEvent(spans, "SESSION_MISSING", "admission");
  });

  it("distinguishes a source generation change from a session context change on recheck", async () => {
    const generation = eventSink();
    const probeA = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const databaseA = queuedClient({ rows: [sourceRow({ generation: "1" })] }, { rows: [sourceRow({ generation: "2" })] });
    await withProductRunCapture(generation.sink, async () => {
      const guard = await createHarnessSourceGuard(databaseA.client, auth(), sessionID, () => authority(), probeA.client);
      await expect(guard()).rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    });
    expectRejectionEvent(generation.spans, "SOURCE_GENERATION_CHANGED", "recheck");

    const session = eventSink();
    const probeB = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const databaseB = queuedClient(
      { rows: [sourceRow({ generation: "1", session_stamp: "stamp-a" })] },
      { rows: [sourceRow({ generation: "1", session_stamp: "stamp-b" })] });
    await withProductRunCapture(session.sink, async () => {
      const guard = await createHarnessSourceGuard(databaseB.client, auth(), sessionID, () => authority(), probeB.client);
      await expect(guard()).rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    });
    expectRejectionEvent(session.spans, "SESSION_CONTEXT_CHANGED", "recheck");
  });

  it("emits exactly one reason when both the generation and the session stamp changed", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const database = queuedClient(
      { rows: [sourceRow({ generation: "1", session_stamp: "stamp-a" })] },
      { rows: [sourceRow({ generation: "2", session_stamp: "stamp-b" })] });
    await withProductRunCapture(sink, async () => {
      const guard = await createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client);
      await expect(guard()).rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    });
    expectRejectionEvent(spans, "SOURCE_GENERATION_CHANGED", "recheck");
  });

  it("labels a Session that disappeared on recheck with the recheck phase", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const database = queuedClient({ rows: [sourceRow({ session_stamp: "stamp-a" })] }, { rows: [sourceRow({ session_stamp: null })] });
    await withProductRunCapture(sink, async () => {
      const guard = await createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client);
      await expect(guard()).rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    });
    expectRejectionEvent(spans, "SESSION_MISSING", "recheck");
  });

  it("labels a Lab gate failure during a source recheck as recheck", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow({ stop_clear: false })] }));
    const database = queuedClient({ rows: [sourceRow()] });
    // Admission succeeds before the independent Lab authority changes.
    let reads = 0;
    const changingProbe = fakeClient(async () => ({ rows: [workspaceRow({ stop_clear: ++reads === 1 })] }));
    await withProductRunCapture(sink, async () => {
      const guard = await createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), changingProbe.client);
      await expect(guard()).rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    });
    expectRejectionEvent(spans, "LAB_STOP_PENDING", "recheck");
    const standalone = eventSink();
    await expect(withProductRunCapture(standalone.sink, () => assertHarnessLabAuthority(probe.client, auth(), "recheck")))
      .rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED" });
    expectRejectionEvent(standalone.spans, "LAB_STOP_PENDING", "recheck");
  });

  it("labels a standalone Lab gate rejection as admission and keeps its error", async () => {
    const { spans, sink } = eventSink();
    const probe = fakeClient(async () => ({ rows: [workspaceRow({ stop_clear: false })] }));
    const error = await withProductRunCapture(sink, () => assertHarnessLabAuthority(probe.client, auth())
      .then(() => null, (caught: unknown) => caught));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("HARNESS_SOURCE_CHANGED");
    expectRejectionEvent(spans, "LAB_STOP_PENDING", "admission");
  });

  it("keeps a failing capture sink from replacing the rejection or causing an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const appended: ProductRunSpan[] = [];
      const sink = { async append(span: ProductRunSpan) { appended.push(span); throw new Error("sink unavailable: secret-prose"); } };
      const probe = fakeClient(async () => ({ rows: [] }));
      const database = fakeClient(async () => ({ rows: [sourceRow()] }));
      const error = await withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client)
        .then(() => null, (caught: unknown) => caught));
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("HARNESS_SOURCE_CHANGED");
      expect(String(error)).not.toContain("sink unavailable");
      expect(appended).toHaveLength(1);
      await flushAsyncWork();
      expect(unhandled).toEqual([]);
    } finally { process.off("unhandledRejection", onUnhandled); }
  });

  it("keeps a hanging capture sink from postponing the rejection or causing an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const appended: ProductRunSpan[] = [];
      let release = () => {};
      const hung = new Promise<void>(resolve => { release = resolve; });
      const sink = { append(span: ProductRunSpan) { appended.push(span); return hung; } };
      const probe = fakeClient(async () => ({ rows: [workspaceRow({ state: "ended" })] }));
      const database = fakeClient(async () => ({ rows: [sourceRow()] }));
      // The rejection settles while the sink is still hung: nothing awaits it.
      const error = await withProductRunCapture(sink, () => createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client)
        .then(() => null, (caught: unknown) => caught));
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("HARNESS_SOURCE_CHANGED");
      expect(appended).toHaveLength(1);
      expect(appended[0]!.metadata).toEqual({ failure_code: "LAB_WORKSPACE_INACTIVE", phase: "admission" });
      release();
      await flushAsyncWork();
      expect(unhandled).toEqual([]);
    } finally { process.off("unhandledRejection", onUnhandled); }
  });

  it("keeps a failing capture sink equivalent for a legitimate pass", async () => {
    const sink = { async append() { throw new Error("sink unavailable"); } };
    const probe = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const database = fakeClient(async () => ({ rows: [sourceRow()] }));
    await withProductRunCapture(sink, async () => {
      const guard = await createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client);
      await expect(guard()).resolves.toBeUndefined();
    });
  });

  it("keeps a caller without a capture sink equivalent", async () => {
    const probe = fakeClient(async () => ({ rows: [workspaceRow({ state: "ended" })] }));
    const database = fakeClient(async () => ({ rows: [sourceRow()] }));
    await expect(createHarnessSourceGuard(database.client, auth(), sessionID, () => authority(), probe.client))
      .rejects.toMatchObject({ statusCode: 409, code: "HARNESS_SOURCE_CHANGED", name: "ApiError" });
    const passingProbe = fakeClient(async () => ({ rows: [workspaceRow()] }));
    const passingSource = fakeClient(async () => ({ rows: [sourceRow()] }));
    const guard = await createHarnessSourceGuard(passingSource.client, auth(), sessionID, () => authority(), passingProbe.client);
    await expect(guard()).resolves.toBeUndefined();
  });
});
