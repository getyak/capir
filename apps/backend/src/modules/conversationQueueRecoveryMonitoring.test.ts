import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recovery wiring proof: the recovered attempt's monitoring is reconciled only
 * after canonical queue finalization (or after a recovered stop's cancellation
 * both persists and finalizes). The queue state and completion layers are
 * mocked to steer those branches deterministically; the monitoring helper
 * itself runs for real against a recorded pool, so the wiring assertions cover
 * the exact fenced statement as well. Real database acceptance stays with the
 * disposable-database suite.
 */
const state = vi.hoisted(() => ({
  listStale: vi.fn(),
  reclaim: vi.fn(),
  runnerAuth: vi.fn(),
  finalize: vi.fn(),
  readResult: vi.fn(),
}));
const completion = vi.hoisted(() => ({ persistCancellation: vi.fn(), persistCompletion: vi.fn() }));
const images = vi.hoisted(() => ({ readManifests: vi.fn() }));

vi.mock("./conversationQueueState.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./conversationQueueState.js")>()),
  listStaleRunningConversationQueueEntries: state.listStale,
  reclaimStaleConversationQueueEntry: state.reclaim,
  runnerAuthContext: state.runnerAuth,
  finalizeConversationQueueEntry: state.finalize,
  readConversationQueueResult: state.readResult,
}));
vi.mock("./conversationQueueCompletion.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./conversationQueueCompletion.js")>()),
  persistConversationQueueCancellation: completion.persistCancellation,
  persistConversationQueueCompletion: completion.persistCompletion,
}));
vi.mock("./conversationMessageImages.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./conversationMessageImages.js")>()),
  readConversationMessageImageManifests: images.readManifests,
}));

import { ConversationQueueRunner } from "./conversationQueueRunner.js";

const ids = {
  accountId: "10000000-0000-4000-8000-00000000000a",
  sessionId: "20000000-0000-4000-8000-00000000000b",
  entryId: "30000000-0000-4000-8000-00000000000c",
  messageId: "40000000-0000-4000-8000-00000000000d",
  runId: "50000000-0000-4000-8000-00000000000e",
  createdByUserId: "60000000-0000-4000-8000-00000000000f",
};

const staleEntry = {
  accountId: ids.accountId,
  sessionId: ids.sessionId,
  entryId: ids.entryId,
  messageId: ids.messageId,
  runId: ids.runId,
  objective: "synthetic recovered objective",
  createdByUserId: ids.createdByUserId,
  hasResult: false,
  failureCode: null,
};

const reclaimed = {
  accountId: ids.accountId,
  hostResult: null,
  sessionId: ids.sessionId,
  authSessionId: null,
  entryId: ids.entryId,
  messageId: ids.messageId,
  runId: ids.runId,
  objective: "synthetic recovered objective",
  timeZone: null,
  createdByUserId: ids.createdByUserId,
  sequence: 1,
  attempt: 1,
  leaseOwner: "recovery-proof:recovery",
  leaseGeneration: 2,
  hasResult: false,
  acceptedAt: "2026-01-01T00:00:00.000Z",
  claimedAt: "2026-01-01T00:00:01.000Z",
};

const auth = {
  accountId: ids.accountId,
  accountSlug: "recovery-proof",
  userId: ids.createdByUserId,
  userEmail: "owner@example.test",
  userKind: "simulated_human" as const,
  sessionId: "auth-session",
};

interface ProofPool {
  pool: Pool;
  queries: Array<{ sql: string; params: unknown[] }>;
  events: string[];
}

function proofPool(): ProofPool {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const events: string[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      events.push("monitor:reconcile");
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as Pool;
  return { pool, queries, events };
}

function proofLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.listStale.mockResolvedValue([staleEntry]);
  state.reclaim.mockResolvedValue(reclaimed);
  state.runnerAuth.mockResolvedValue(auth);
  completion.persistCancellation.mockResolvedValue(undefined);
  completion.persistCompletion.mockResolvedValue(undefined);
  state.readResult.mockResolvedValue({ images: [] });
  images.readManifests.mockResolvedValue(new Map([[ids.entryId, []]]));
});

describe("recovered monitoring reconciliation wiring", () => {
  it("reconciles a stop raced against stored-result completion", async () => {
    const { pool, queries, events } = proofPool();
    state.reclaim.mockResolvedValue({ ...reclaimed, hasResult: true });
    completion.persistCompletion.mockImplementation(async () => { events.push("persist:replay"); });
    state.finalize.mockImplementation(async (_pool: Pool, input: { status: string }) => {
      events.push(`finalize:${input.status}`);
      return input.status === "completed"
        ? { applied: false, effectiveStatus: "running" }
        : { applied: true, effectiveStatus: "cancelled" };
    });
    await new ConversationQueueRunner({ pool, provider: null, logger: proofLogger() }).recover();
    expect(events).toEqual(["persist:replay", "finalize:completed", "finalize:cancelled", "monitor:reconcile"]);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.params).toEqual([
      ids.accountId, ids.sessionId, ids.entryId, ids.runId, 2, ids.createdByUserId,
    ]);
  });

  it("reconciles a withdrawn source after stored-result replay rejects it", async () => {
    const { pool, events } = proofPool();
    state.reclaim.mockResolvedValue({ ...reclaimed, hasResult: true });
    completion.persistCompletion.mockRejectedValue(Object.assign(new Error("SYNTHETIC_SOURCE_REVOKED"), { statusCode: 410 }));
    state.finalize.mockImplementation(async (_pool: Pool, input: { status: string }) => {
      events.push(`finalize:${input.status}`);
      return { applied: true, effectiveStatus: "failed" };
    });
    await new ConversationQueueRunner({ pool, provider: null, logger: proofLogger() }).recover();
    expect(events).toEqual(["finalize:failed", "monitor:reconcile"]);
    expect(state.finalize).toHaveBeenCalledWith(pool, expect.objectContaining({ status: "failed", failureCode: "SOURCE_REVOKED" }));
  });

  it("does not reconcile a recovered stop when finalization throws", async () => {
    const { pool, queries, events } = proofPool();
    state.finalize.mockImplementation(async (_pool: Pool, input: { status: string }) => {
      events.push(`finalize:${input.status}`);
      if (input.status === "cancelled") throw new Error("SYNTHETIC_FINALIZE_FAILURE");
      return { applied: false, effectiveStatus: "running" };
    });
    completion.persistCancellation.mockImplementation(async () => { events.push("persist:cancel"); });
    await new ConversationQueueRunner({ pool, provider: null, logger: proofLogger() }).recover();
    expect(events).toEqual(["finalize:interrupted", "persist:cancel", "finalize:cancelled"]);
    expect(queries).toEqual([]);
  });

  it("reconciles the recovered attempt only after recovery finalizes it interrupted", async () => {
    const { pool, queries, events } = proofPool();
    const logger = proofLogger();
    state.finalize.mockImplementation(async (_pool: Pool, input: { status: string }) => {
      events.push(`finalize:${input.status}`);
      return { applied: true, effectiveStatus: input.status };
    });
    const runner = new ConversationQueueRunner({
      pool, provider: null, logger, workerId: "recovery-proof", pollIntervalMs: 10,
    });
    await runner.recover();
    expect(state.reclaim).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accountId: ids.accountId, sessionId: ids.sessionId, entryId: ids.entryId, workerId: "recovery-proof:recovery",
    }));
    expect(events).toEqual(["finalize:interrupted", "monitor:reconcile"]);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain("UPDATE product_runs");
    expect(queries[0]!.params).toEqual([
      ids.accountId, ids.sessionId, ids.entryId, ids.runId, 2, ids.createdByUserId,
    ]);
  });

  it("reconciles a recovered stop only after its cancellation persists and finalizes", async () => {
    const { pool, queries, events } = proofPool();
    const logger = proofLogger();
    state.finalize.mockImplementation(async (_pool: Pool, input: { status: string }) => {
      events.push(`finalize:${input.status}`);
      // The interrupted finalize loses to the committed stop; the recovered
      // stop path then finalizes the truthful cancelled state.
      return input.status === "interrupted"
        ? { applied: false, effectiveStatus: "running" }
        : { applied: true, effectiveStatus: "cancelled" };
    });
    completion.persistCancellation.mockImplementation(async () => { events.push("persist:cancel"); });
    const runner = new ConversationQueueRunner({
      pool, provider: null, logger, workerId: "recovery-proof", pollIntervalMs: 10,
    });
    await runner.recover();
    expect(events).toEqual(["finalize:interrupted", "persist:cancel", "finalize:cancelled", "monitor:reconcile"]);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.params).toEqual([
      ids.accountId, ids.sessionId, ids.entryId, ids.runId, 2, ids.createdByUserId,
    ]);
  });

  it("never marks a false terminal when recovered stop persistence fails", async () => {
    const { pool, queries, events } = proofPool();
    const logger = proofLogger();
    state.finalize.mockImplementation(async (_pool: Pool, input: { status: string }) => {
      events.push(`finalize:${input.status}`);
      return input.status === "interrupted"
        ? { applied: false, effectiveStatus: "running" }
        : { applied: true, effectiveStatus: "cancelled" };
    });
    completion.persistCancellation.mockImplementation(async () => {
      events.push("persist:cancel");
      throw new Error("SYNTHETIC_HISTORY_SAVE_FAILURE");
    });
    const runner = new ConversationQueueRunner({
      pool, provider: null, logger, workerId: "recovery-proof", pollIntervalMs: 10,
    });
    await runner.recover();
    // The queue stays running and no cancelled finalization or monitoring
    // reconciliation happens without the persisted stop history.
    expect(events).toEqual(["finalize:interrupted", "persist:cancel"]);
    expect(state.finalize).toHaveBeenCalledTimes(1);
    expect(queries).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      { queue_entry_id: ids.entryId, err: expect.any(Error) },
      "conversation queue stop could not persist a partial answer",
    );
  });

  it("keeps recovery intact when the diagnostic reconciliation itself fails", async () => {
    const queries: unknown[] = [];
    const events: string[] = [];
    const pool = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        events.push("monitor:reconcile");
        throw new Error("SYNTHETIC_MONITORING_OUTAGE");
      }),
    } as unknown as Pool;
    const logger = proofLogger();
    state.finalize.mockImplementation(async (_pool: Pool, input: { status: string }) => {
      events.push(`finalize:${input.status}`);
      return { applied: true, effectiveStatus: input.status };
    });
    const runner = new ConversationQueueRunner({
      pool, provider: null, logger, workerId: "recovery-proof", pollIntervalMs: 10,
    });
    await expect(runner.recover()).resolves.toBeUndefined();
    expect(events).toEqual(["finalize:interrupted", "monitor:reconcile"]);
    expect(queries).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ failure_code: "MONITORING_UNAVAILABLE", run_id: ids.runId }),
      "conversation queue recovery could not reconcile monitoring",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});
