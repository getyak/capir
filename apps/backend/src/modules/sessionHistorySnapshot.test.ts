import { describe, expect, it, vi } from "vitest";
import { createSessionHistorySnapshot, readSessionHistoryBodies, readSessionHistorySources } from "./sessionHistorySnapshot.js";
import type { AuthContext } from "./auth.js";
import type { DatabaseClient } from "../database/pool.js";

const auth = { accountId: "account-one", userId: "actor-one", sessionId: "auth-session-one" } as AuthContext;
const messages = [{ message_id: "earlier", role: "user" as const, text: "Earlier authorized synthetic choice" },
  { message_id: "current", role: "user" as const, text: "Current instruction" }];
function setup(options: { onAuth?: () => Promise<void>; withoutScreenshots?: boolean; readUntil?: Date } = {}) {
  let live = true, sourceCurrent = true;
  const originalExpiry = new Date(Date.now() + 60_000);
  let databaseNow = Date.now();
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
    if (sql.includes("AS history_owner_current")) return { rows: [{ history_owner_current: live,
      history_tasks_current: originalExpiry.valueOf() > databaseNow, history_sources_current: sourceCurrent,
      history_stamp_current: true, history_generation_current: true, expires_at: originalExpiry,
      read_until: options.readUntil ?? originalExpiry, checked_at: new Date(databaseNow) }] };
    if (sql.includes("FROM sessions")) { await options.onAuth?.(); return { rows: live ? [{ current: true }] : [] }; }
    if (sql.includes("AS history_task_available")) return { rows: [{ task_id: "original-task",
      history_task_available: originalExpiry.valueOf() > databaseNow, expires_at: originalExpiry }] };
    if (sql.includes("FROM screenshot_contact_tasks")) return { rows: sourceCurrent ? [{ id: "source-one", fingerprint: "original" }] : [] };
    throw new Error("Unexpected synthetic query");
  });
  const assertCurrent = vi.fn(async () => {});
  const snapshot = createSessionHistorySnapshot({ database: { query } as unknown as DatabaseClient,
    auth, sessionID: "product-session-one", messages, currentMessageID: "current",
    sources: options.withoutScreenshots ? [] : [{ taskID: "source-one", fingerprint: "original" }],
    taskIDs: ["original-task"], sessionStamp: "synthetic-stamp", sourceGeneration: "1", assertCurrent });
  return { snapshot, query, assertCurrent, revoke: () => { live = false; }, expireSource: () => { sourceCurrent = false; },
    expireOriginalTask: () => { databaseNow = originalExpiry.valueOf() + 1; } };
}

describe("host Session history authority", () => {
  it("excludes the current message and binds a deterministic content version", () => {
    const first = setup().snapshot, second = setup().snapshot;
    expect(first.messages).toEqual([messages[0]]);
    expect(first.version).toBe(second.version);
  });
  it("checks the original actor, authenticated session and product Session", async () => {
    const state = setup(); await state.snapshot.assertCurrent();
    expect(state.query.mock.calls[0]?.[1]).toEqual([auth.sessionId, auth.accountId, auth.userId, "product-session-one"]);
    expect(state.assertCurrent).toHaveBeenCalledTimes(2);
  });
  it("refuses revoked or expired authenticated sessions", async () => {
    const state = setup(); state.revoke();
    await expect(state.snapshot.assertCurrent()).rejects.toMatchObject({ code: "SESSION_HISTORY_UNAVAILABLE" });
  });
  it("refuses an expired, withdrawn or rebound inherited screenshot", async () => {
    const state = setup(); state.expireSource();
    await expect(state.snapshot.assertCurrent()).rejects.toMatchObject({ code: "SESSION_HISTORY_UNAVAILABLE" });
  });
  it("propagates source generation or canonical Session changes before any read", async () => {
    const state = setup(); state.assertCurrent.mockRejectedValueOnce(new Error("SOURCE_GENERATION_CHANGED"));
    await expect(state.snapshot.assertCurrent()).rejects.toThrow("SOURCE_GENERATION_CHANGED");
    expect(state.query).not.toHaveBeenCalled();
  });
  it("rechecks the existing guard after asynchronous metadata reads", async () => {
    const state = setup(); state.assertCurrent.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("SESSION_CONTEXT_CHANGED"));
    await expect(state.snapshot.assertCurrent()).rejects.toThrow("SESSION_CONTEXT_CHANGED");
  });
  it("rechecks live owner in the final authority envelope after the last guard await", async () => {
    const state = setup();
    state.assertCurrent.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => { state.revoke(); });
    await expect(state.snapshot.assertCurrent()).rejects.toMatchObject({ code: "SESSION_HISTORY_UNAVAILABLE" });
  });
  it("refuses an authority deadline crossed while final SQL was evaluated even if its earlier flags were true", async () => {
    const state = setup({ readUntil: new Date(Date.now() - 1) });
    await expect(state.snapshot.assertCurrent()).rejects.toMatchObject({ code: "SESSION_HISTORY_UNAVAILABLE" });
  });
  it("rejects natural original-reply expiry across an await without generation, Session or screenshot changes", async () => {
    let entered: (() => void) | undefined, release: (() => void) | undefined;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const state = setup({ withoutScreenshots: true, onAuth: async () => { entered?.(); await held; } });
    const checking = state.snapshot.assertCurrent();
    await started;
    state.expireOriginalTask(); release?.();
    await expect(checking).rejects.toMatchObject({ code: "SESSION_HISTORY_UNAVAILABLE" });
    expect(state.assertCurrent).toHaveBeenCalled();
  });
  it("rejects excessive host text before making snapshot copies or fingerprints", () => {
    expect(() => createSessionHistorySnapshot({ database: {} as DatabaseClient, auth, sessionID: "product-session-one",
      messages: [{ message_id: "large", role: "user", text: "中".repeat(350_000) }], sources: [], taskIDs: ["original-task"],
      sessionStamp: "synthetic-stamp", sourceGeneration: "1", assertCurrent: vi.fn() }))
      .toThrowError(expect.objectContaining({ code: "SESSION_HISTORY_SNAPSHOT_UNAVAILABLE" }));
  });
  it("admits canonical bodies only with a complete consistent bounded SQL envelope", async () => {
    const response = { operation_scope: "create_unscoped_chat_task", response_body: { task_id: "task", blocks: [] } };
    const client = (row: unknown) => ({ query: async () => ({ rows: [row] }) }) as unknown as DatabaseClient;
    expect(await readSessionHistoryBodies(client({ history_result_rows: "1", history_result_bytes: "80", responses: [response] }), auth, ["task"]))
      .toEqual([response]);
    for (const row of [
      { history_result_rows: "201", history_result_bytes: "80", responses: null },
      { history_result_rows: "1", history_result_bytes: "1048577", responses: null },
      { history_result_rows: "1", history_result_bytes: "80", responses: [] },
      { history_result_rows: "not-a-count", history_result_bytes: "80", responses: [] },
    ]) await expect(readSessionHistoryBodies(client(row), auth, ["task"]))
      .rejects.toMatchObject({ code: "SESSION_HISTORY_SNAPSHOT_UNAVAILABLE" });
  });
  it("keeps revoked per-task source authority distinct from an empty source list", async () => {
    const database = { query: async () => ({ rows: [
      { history_source_task: "allowed", available: true, screenshot_task_id: null, source_fingerprint: null },
      { history_source_task: "revoked", available: false, screenshot_task_id: null, source_fingerprint: null },
    ] }) } as unknown as DatabaseClient;
    const sources = await readSessionHistorySources(database, auth, ["allowed", "revoked"]);
    expect(sources.get("allowed")).toEqual([]); expect(sources.get("revoked")).toBeNull();
  });
});
