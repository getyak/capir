import { createHash, randomUUID } from "node:crypto";

import { CONTRACT_VERSION, type AgentSessionPayload } from "@talent-signal/contracts";

import { captureProductStep } from "@talent-signal/agent";
import { ProductRunService } from "./productRuns.js";
import { cleanupProductRunSources } from "./productRunStorage.js";
import type { AgentProviderInputPart, AgentProviderRequest, AgentProviderResult, HarnessSteeringBatch } from "@talent-signal/agent";
import { Pool } from "pg";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { RemoteChatAnswerProviding, RemoteChatAnswerRequest, RemoteChatAnswerResult } from "./chatAnswerProvider.js";
import {
  ConversationQueueLeaseLostError,
  admitConversationQueueEntry,
  claimNextConversationQueueEntry,
  finalizeConversationQueueEntry,
  mutateConversationQueueEntry,
  readConversationQueueSnapshot,
  reclaimStaleConversationQueueEntry,
  recordConversationQueueResult,
  sweepConversationQueue,
} from "./conversationQueue.js";
import { ConversationQueueRunner } from "./conversationQueueRunner.js";
import { readConversationMessageImage } from "./conversationMessageImages.js";
import { registerConversationQueueRoutes } from "./conversationQueueRoutes.js";
import { ApiError } from "../lib/apiError.js";
import { subscribeConversationQueueLive, type ConversationQueueLivePreview } from "./conversationQueueLive.js";
import { getAgentSession, readAgentSessionConversation } from "./agentSessions.js";
import { mutateAgentSession } from "./agentSessions.js";
import { resolveSessionSourceAuthority } from "./memoryReviewStore.js";
import { digestValue } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";

const databaseURL = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (databaseURL && !["127.0.0.1", "localhost"].includes(new URL(databaseURL).hostname)) {
  throw new Error("Use an isolated local PostgreSQL database for conversation queue tests.");
}
const pool = databaseURL ? new Pool({ connectionString: databaseURL, max: 8, connectionTimeoutMillis: 5000, query_timeout: 20000 }) : null;
// Real disposable-database round trips can exceed the default Vitest budget on
// a loaded host; assertions are unchanged.
vi.setConfig({ testTimeout: 30_000 });
const suite = databaseURL ? describe : describe.skip;

afterAll(async () => {
  await pool?.end();
});

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(15);
  }
  throw new Error("Timed out waiting for the expected conversation queue state.");
}

interface SeededSession {
  auth: AuthContext;
  accountId: string;
  userId: string;
  sessionId: string;
}

async function seedSession(options: {
  composerDraft?: string;
  screenshotTaskIDs?: string[];
  expiresIn?: string;
} = {}): Promise<SeededSession> {
  const accountId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const auth: AuthContext = {
    accountId,
    accountSlug: `cq-${accountId}`,
    userId,
    userEmail: `${userId}@example.test`,
    sessionId: randomUUID(),
    userKind: "simulated_human",
  };
  await pool!.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Conversation queue proof')", [accountId, auth.accountSlug]);
  await pool!.query(
    "INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'CQ proof','simulated_human')",
    [userId, accountId, auth.userEmail],
  );
  const now = new Date().toISOString();
  const payload = {
    id: sessionId,
    scopeKind: "unresolved_intent",
    personDisplayLabel: "",
    contextDisplayLabel: "",
    title: "",
    turns: [],
    updatedAt: now,
    createdAt: now,
    ...(options.composerDraft ? { composerDraft: options.composerDraft } : {}),
    ...(options.screenshotTaskIDs ? { screenshotTaskIDs: options.screenshotTaskIDs } : {}),
  };
  await pool!.query(
    `INSERT INTO agent_sessions(account_id,id,created_by_user_id,revision,payload,created_at,expires_at)
     VALUES($1,$2,$3,1,$4::jsonb,now(),now()+$5::interval)`,
    [accountId, sessionId, userId, JSON.stringify(payload), options.expiresIn ?? "7 days"],
  );
  return { auth, accountId, userId, sessionId };
}

async function removeProofAccount(accountId: string): Promise<void> {
  const tables = (
    await pool!.query<{ table_name: string }>(
      "SELECT table_name FROM lab_test_workspace_table_manifest WHERE scope='account' ORDER BY table_name",
    )
  ).rows.map((row) => row.table_name);
  const targets = [...tables, "sessions"];
  await pool!.query(
    `WITH ${targets.map((table, index) => `d${index} AS (DELETE FROM "${table}" WHERE account_id=$1 RETURNING 1)`).join(",")}
     SELECT ${targets.map((_, index) => `(SELECT count(*) FROM d${index})`).join("+")} AS removed`,
    [accountId],
  );
  await pool!.query("DELETE FROM users WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM accounts WHERE id=$1", [accountId]);
}

function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

class ScriptedConversationProvider implements RemoteChatAnswerProviding {
  readonly providerId = "zhipu-chat-completions" as const;
  readonly id = "zhipu-chat-completions";
  readonly model = "synthetic-conversation-model";
  readonly supportsImageInput = false;
  readonly calls: string[] = [];
  active = 0;
  maxActive = 0;
  preGateDeltas: string[] = [];
  postGateDeltas: string[] = [];
  gateForObjective: ((objective: string) => Promise<void> | null) | null = null;
  /** Models a provider that does not honour cancellation promptly. */
  ignoreAbortForObjective: ((objective: string) => boolean) | null = null;
  onBeforeReturn: (() => Promise<void>) | null = null;
  failWith: Error | null = null;
  lastSignal: AbortSignal | null = null;
  lastInputParts: readonly AgentProviderInputPart[] = [];
  /** Emits no preview or progress callbacks, so a racing stop stays unobserved
   * until the failure/shutdown finalization path re-checks it. */
  silent = false;

  async answer(_request: RemoteChatAnswerRequest): Promise<RemoteChatAnswerResult> {
    throw new Error("The governed agent path is required for this synthetic provider.");
  }

  async run(
    request: AgentProviderRequest,
    _invokeTool: unknown,
    signal: AbortSignal,
  ): Promise<AgentProviderResult> {
    this.calls.push(request.objective);
    this.lastInputParts = request.inputParts ?? [];
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.lastSignal = signal;
    const ignoreAbort = this.ignoreAbortForObjective?.(request.objective) === true;
    try {
      for (const delta of this.preGateDeltas) {
        if (!ignoreAbort) signal.throwIfAborted();
        if (!this.silent) request.onVisibleText?.(delta);
      }
      if (!this.silent) request.onProgress?.("answer");
      const held = this.gateForObjective?.(request.objective);
      if (held) {
        if (ignoreAbort) {
          await held;
        } else {
          await Promise.race([
            held,
            new Promise<never>((_resolve, reject) => {
              if (signal.aborted) reject(signal.reason);
              else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            }),
          ]);
        }
      }
      if (!ignoreAbort) signal.throwIfAborted();
      for (const delta of this.postGateDeltas) {
        if (!ignoreAbort) signal.throwIfAborted();
        if (!this.silent) request.onVisibleText?.(delta);
      }
      await this.onBeforeReturn?.();
      if (this.failWith) throw this.failWith;
      const body = [...this.preGateDeltas, ...this.postGateDeltas].join("") || "回答正文";
      return {
        structuredOutput: { outcome: "reply", title: "回复", body },
        inputTokens: 1,
        outputTokens: 1,
        estimatedUsd: 0,
        turns: 1,
        permissionDenials: [],
      };
    } finally {
      this.active -= 1;
    }
  }
}

async function startRunner(
  provider: RemoteChatAnswerProviding | null,
  workerId = `w-${randomUUID()}`,
): Promise<ConversationQueueRunner> {
  const runner = new ConversationQueueRunner({
    pool: pool!,
    provider,
    logger: silentLogger,
    workerId,
    pollIntervalMs: 10,
    heartbeatMs: 40,
    recoveryIntervalMs: 10_000,
  });
  runner.start();
  return runner;
}

async function entryRow(sessionId: string, accountId: string) {
  return (
    await pool!.query<{
      status: string;
      content_state: string;
      failure_code: string | null;
      result: unknown;
      objective: string | null;
      run_id: string | null;
      lease_generation: number;
      cancel_requested: boolean;
      cancel_auto_continue: boolean;
      sequence: string;
    }>(
      "SELECT status,content_state,failure_code,result,objective,run_id,lease_generation,cancel_requested,cancel_auto_continue,sequence FROM conversation_queue_entries WHERE account_id=$1 AND session_id=$2 ORDER BY sequence",
      [accountId, sessionId],
    )
  ).rows;
}

async function queueState(sessionId: string, accountId: string) {
  return (
    await pool!.query<{ paused: boolean; revision: number }>(
      "SELECT paused,revision FROM conversation_queue_state WHERE account_id=$1 AND session_id=$2",
      [accountId, sessionId],
    )
  ).rows[0];
}

/** Models a stop committed through the API on another process: the durable
 * `cancel_requested` write lands while this runner's in-process live
 * publication never arrives. That lost-event window is exactly what the lease
 * heartbeat's cancel recheck bounds. */
async function commitUnpublishedStop(sessionId: string, accountId: string): Promise<void> {
  await pool!.query(
    "UPDATE conversation_queue_entries SET cancel_requested=true, cancel_auto_continue=false, updated_at=now(), revision=revision+1 WHERE account_id=$1 AND session_id=$2 AND status='running'",
    [accountId, sessionId],
  );
}

suite("durable conversation queue", () => {
  it("preserves the admitted user turn when stopped before any visible text", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    const held = gate();
    provider.gateForObjective = () => held.promise;
    const runner = await startRunner(provider);
    try {
      const message = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId,
        message_id: message,
        idempotency_key: randomUUID(),
        objective: "停止前保留已发送消息",
      });
      await waitFor(() => provider.calls.length === 1);
      const active = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "stop",
        run_id: active.active!.run_id!,
        expected_revision: active.revision,
        idempotency_key: randomUUID(),
      });
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "cancelled");
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload?.turns[0]?.id).toBe(message);
      expect(session.payload?.turns[0]?.response.unboundConversationBlocks?.[0]).toMatchObject({
        title: "已停止",
        body: "已停止生成，本次尚未形成回复。",
        status: "failed",
      });
    } finally {
      held.release();
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("fails visibly and pauses when no model provider is configured", async () => {
    const seeded = await seedSession();
    const runner = await startRunner(null);
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        idempotency_key: randomUUID(),
        objective: "provider unavailable",
      });
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "failed");
      expect((await entryRow(seeded.sessionId, seeded.accountId))[0]?.failure_code).toBe("MODEL_PROVIDER_UNAVAILABLE");
      expect((await queueState(seeded.sessionId, seeded.accountId))?.paused).toBe(true);
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("interrupts active work on shutdown without persisting a stopped answer or starting the next message", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    const held = gate();
    provider.preGateDeltas = ["unfinished private preview"];
    provider.gateForObjective = () => held.promise;
    const runner = await startRunner(provider);
    try {
      for (const objective of ["active at shutdown", "must stay queued"]) {
        await admitConversationQueueEntry(pool!, seeded.auth, {
          session_id: seeded.sessionId, message_id: randomUUID(),
          idempotency_key: randomUUID(), objective,
        });
      }
      await waitFor(() => provider.calls.length === 1);
      await runner.close();
      const entries = await entryRow(seeded.sessionId, seeded.accountId);
      expect(entries.map(entry => entry.status)).toEqual(["interrupted", "queued"]);
      expect(entries[0]?.failure_code).toBe("RUNNER_SHUTDOWN");
      expect(provider.lastSignal?.aborted).toBe(true);
      expect(provider.calls).toEqual(["active at shutdown"]);
      expect((await queueState(seeded.sessionId, seeded.accountId))?.paused).toBe(true);
      expect((await getAgentSession(pool!, seeded.auth, seeded.sessionId)).payload?.turns).toHaveLength(0);
    } finally {
      held.release();
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("admits before provider work, streams a genuine preview, and preserves strict FIFO", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    const hold = gate();
    provider.preGateDeltas = ["正在整理"];
    provider.postGateDeltas = ["回答正文"];
    provider.gateForObjective = (objective) => (objective === "第一条" ? hold.promise : null);
    const previews: ConversationQueueLivePreview[] = [];
    const unsubscribe = subscribeConversationQueueLive((event) => {
      if (event.type === "preview") previews.push(event.preview);
    });
    const runner = await startRunner(provider);
    try {
      const first = await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "第一条",
      });
      expect(first.response.status).toBe("queued");
      // Admission returns before any provider work.
      expect(provider.calls).toHaveLength(0);

      await waitFor(() => provider.calls.length === 1);
      await waitFor(() => previews.some((preview) => preview.text.includes("正在整理")));
      expect(provider.gateForObjective).not.toBeNull();

      // Two more messages queue while the first is still running.
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "第二条",
      });
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "第三条",
      });
      await sleep(120);
      expect(provider.calls).toHaveLength(1);
      const snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      expect(snapshot.active?.objective).toBe("第一条");
      expect(snapshot.queued.map((entry) => entry.objective)).toEqual(["第二条", "第三条"]);

      hold.release();
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId)).every((row) => row.status === "completed"));
      expect(provider.calls).toEqual(["第一条", "第二条", "第三条"]);
      expect(provider.maxActive).toBe(1);
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload?.turns.map((turn) => turn.objective)).toEqual(["第一条", "第二条", "第三条"]);
    } finally {
      unsubscribe();
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("keeps a newer composer draft across an older completion", async () => {
    const seeded = await seedSession({ composerDraft: "新草稿没有被覆盖" });
    const provider = new ScriptedConversationProvider();
    provider.postGateDeltas = ["回答"];
    const runner = await startRunner(provider);
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "旧消息",
      });
      await waitFor(async () =>
        (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "completed",
      );
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload?.composerDraft).toBe("新草稿没有被覆盖");
      expect(session.payload?.turns).toHaveLength(1);
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("replays a duplicate admission and rejects changed input for the same id", async () => {
    const seeded = await seedSession();
    const messageId = randomUUID();
    const key = randomUUID();
    try {
      const first = await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: key,
        session_id: seeded.sessionId,
        message_id: messageId,
        objective: "同一条",
      });
      const replay = await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: key,
        session_id: seeded.sessionId,
        message_id: messageId,
        objective: "同一条",
      });
      expect(replay.replayed).toBe(true);
      expect(replay.response.queue_entry_id).toBe(first.response.queue_entry_id);
      await expect(
        admitConversationQueueEntry(pool!, seeded.auth, {
          idempotency_key: key,
          session_id: seeded.sessionId,
          message_id: messageId,
          objective: "内容已改变",
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
      await expect(
        admitConversationQueueEntry(pool!, seeded.auth, {
          idempotency_key: randomUUID(),
          session_id: seeded.sessionId,
          message_id: messageId,
          objective: "内容已改变",
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      await removeProofAccount(seeded.accountId);
    }
  });

  it("checks revisions for queued edits and withdraws without touching a claimed entry", async () => {
    const seeded = await seedSession();
    const admitted = await admitConversationQueueEntry(pool!, seeded.auth, {
      idempotency_key: randomUUID(),
      session_id: seeded.sessionId,
      message_id: randomUUID(),
      objective: "原始内容",
    });
    try {
      const snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      const edited = await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "edit",
        queue_entry_id: admitted.response.queue_entry_id,
        expected_revision: snapshot.revision,
        idempotency_key: randomUUID(),
        objective: "编辑后的内容",
      });
      expect(edited.applied.status).toBe("queued");
      await expect(
        mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
          kind: "edit",
          queue_entry_id: admitted.response.queue_entry_id,
          expected_revision: snapshot.revision,
          idempotency_key: randomUUID(),
          objective: "过期修订",
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
      const current = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "withdraw",
        queue_entry_id: admitted.response.queue_entry_id,
        expected_revision: current.revision,
        idempotency_key: randomUUID(),
      });
      expect(await entryRow(seeded.sessionId, seeded.accountId)).toHaveLength(0);
    } finally {
      await removeProofAccount(seeded.accountId);
    }
  });

  it("replays a successful queued edit idempotently and rejects a claimed edit", async () => {
    const seeded = await seedSession();
    const messageId = randomUUID();
    const editKey = randomUUID();
    const admitted = await admitConversationQueueEntry(pool!, seeded.auth, {
      idempotency_key: randomUUID(),
      session_id: seeded.sessionId,
      message_id: messageId,
      objective: "原始内容",
    });
    try {
      const snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      const edited = await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "edit",
        queue_entry_id: admitted.response.queue_entry_id,
        expected_revision: snapshot.revision,
        idempotency_key: editKey,
        objective: "编辑后的内容",
      });
      const replay = await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "edit",
        queue_entry_id: admitted.response.queue_entry_id,
        expected_revision: snapshot.revision,
        idempotency_key: editKey,
        objective: "编辑后的内容",
      });
      expect(replay.replayed).toBe(true);
      expect(replay.applied).toEqual(edited.applied);

      const claimed = await claimNextConversationQueueEntry(pool!, {
        accountId: seeded.accountId,
        sessionId: seeded.sessionId,
        workerId: "claim-test",
      });
      expect(claimed).not.toBeNull();
      const claimedState = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await expect(
        mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
          kind: "edit",
          queue_entry_id: admitted.response.queue_entry_id,
          expected_revision: claimedState.revision,
          idempotency_key: randomUUID(),
          objective: "已开始后编辑",
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: "CONVERSATION_QUEUE_ENTRY_CLAIMED" });
    } finally {
      await removeProofAccount(seeded.accountId);
    }
  });

  it("stops the active run, pauses the queue, stores only an owned partial, then resumes on continue", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    const hold = gate();
    provider.preGateDeltas = ["已经生成的部分"];
    provider.postGateDeltas = ["不会出现"];
    provider.gateForObjective = (objective) => (objective === "会被停止" ? hold.promise : null);
    const runner = await startRunner(provider);
    try {
      const stoppedMessageId = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: stoppedMessageId,
        objective: "会被停止",
      });
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "停止后仍然排队",
      });
      await waitFor(async () => {
        const snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
        return snapshot.active !== null;
      });
      const active = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      // A running row precedes provider entry. This case asserts a preserved
      // partial, so wait until the provider has actually emitted its prefix.
      await waitFor(() => provider.calls.length === 1);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "stop",
        expected_revision: active.revision,
        idempotency_key: randomUUID(),
        run_id: active.active!.run_id!,
      });
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "cancelled");
      expect((await queueState(seeded.sessionId, seeded.accountId))!.paused).toBe(true);
      expect(provider.calls).toHaveLength(1);
      const rows = await entryRow(seeded.sessionId, seeded.accountId);
      expect(rows[0]?.content_state).toBe("scrubbed");
      expect(rows[0]?.objective).toBeNull();
      expect(rows.map((row) => row.status)).toEqual(["cancelled", "queued"]);
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload?.turns).toHaveLength(1);
      expect(session.payload?.turns[0]?.response.taskID).toBe(`cancelled-${stoppedMessageId}`);
      expect(session.payload?.turns[0]?.response.unboundConversationBlocks?.[0]?.body).toBe("已经生成的部分");

      // The follow-up stays unclaimed while paused.
      await sleep(80);
      expect(provider.calls).toHaveLength(1);
      const paused = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "continue",
        expected_revision: paused.revision,
        idempotency_key: randomUUID(),
      });
      await waitFor(() => provider.calls.length === 2);
      await waitFor(async () => {
        const finalRows = await entryRow(seeded.sessionId, seeded.accountId);
        return finalRows.map((row) => row.status).join(",") === "cancelled,completed";
      });
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("prioritizes a waiting supplement: stops the live run, reorders, and continues without pause", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    const held = gate();
    provider.gateForObjective = (objective) => (objective === "正在处理的补充来源" ? held.promise : null);
    const runner = await startRunner(provider);
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "正在处理的补充来源",
      });
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "默认排队的补充",
      });
      const prioritizedMessageId = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: prioritizedMessageId,
        objective: "应优先处理的补充",
      });
      await waitFor(async () => {
        const snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
        return snapshot.active !== null && snapshot.queued.length === 2;
      });
      let snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      const prioritized = snapshot.queued.find((entry) => entry.message_id === prioritizedMessageId);
      expect(prioritized).toBeDefined();
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "prioritize",
        queue_entry_id: prioritized!.queue_entry_id,
        expected_revision: snapshot.revision,
        idempotency_key: randomUUID(),
      });
      // The live run is stop-requested for auto-continue; the chosen supplement
      // is first among waiting work and the queue is ready to claim it next.
      await waitFor(async () => {
        const rows = await entryRow(seeded.sessionId, seeded.accountId);
        return rows[0]?.cancel_requested === true && rows[0]?.cancel_auto_continue === true;
      });
      snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      expect(snapshot.queued.map((entry) => entry.objective)).toEqual([
        "应优先处理的补充",
        "默认排队的补充",
      ]);
      expect(snapshot.paused).toBe(false);

      held.release();
      await waitFor(async () => {
        const rows = await entryRow(seeded.sessionId, seeded.accountId);
        return rows.filter((row) => row.status === "cancelled").length === 1;
      });
      // Prioritize's stop must not re-pause; the chosen supplement runs next.
      expect((await queueState(seeded.sessionId, seeded.accountId))!.paused).toBe(false);
      await waitFor(async () => {
        const rows = await entryRow(seeded.sessionId, seeded.accountId);
        return rows.some((row) => row.objective === "应优先处理的补充" && row.status === "running")
          || rows.some((row) => row.objective === "应优先处理的补充" && row.status === "completed");
      });
    } finally {
      held.release();
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("prioritize without a live run only reorders waiting work and unpauses", async () => {
    const seeded = await seedSession();
    try {
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "continue",
        expected_revision: 0,
        idempotency_key: randomUUID(),
      });
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "先排队",
      });
      const second = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: second,
        objective: "后到但优先",
      });
      let snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      const target = snapshot.queued.find((entry) => entry.message_id === second);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "prioritize",
        queue_entry_id: target!.queue_entry_id,
        expected_revision: snapshot.revision,
        idempotency_key: randomUUID(),
      });
      snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      expect(snapshot.queued.map((entry) => entry.objective)).toEqual(["后到但优先", "先排队"]);
      expect(snapshot.active).toBeNull();
      expect(snapshot.paused).toBe(false);
    } finally {
      await removeProofAccount(seeded.accountId);
    }
  });

  it("plain stop after prioritize still pauses and never inherits auto-continue", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    const held = gate();
    provider.gateForObjective = (objective) => (objective === "会被再次停止" ? held.promise : null);
    const runner = await startRunner(provider);
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "会被再次停止",
      });
      const second = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: second,
        objective: "停止后不得自动执行",
      });
      await waitFor(async () => {
        const snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
        return snapshot.active !== null && snapshot.queued.length === 1;
      });
      let snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      // Prioritize first (sets auto-continue on the live run)…
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "prioritize",
        queue_entry_id: snapshot.queued[0]!.queue_entry_id,
        expected_revision: snapshot.revision,
        idempotency_key: randomUUID(),
      });
      // …then a plain Stop must win and keep the queue paused after cancel.
      snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "stop",
        run_id: snapshot.active!.run_id!,
        expected_revision: snapshot.revision,
        idempotency_key: randomUUID(),
      });
      held.release();
      await waitFor(async () => {
        const rows = await entryRow(seeded.sessionId, seeded.accountId);
        return rows.some((row) => row.status === "cancelled");
      });
      expect((await queueState(seeded.sessionId, seeded.accountId))!.paused).toBe(true);
      await sleep(80);
      expect(provider.calls).toHaveLength(1);
    } finally {
      held.release();
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("refuses prioritize while a failed message still needs retry or removal", async () => {
    const seeded = await seedSession();
    try {
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "continue",
        expected_revision: 0,
        idempotency_key: randomUUID(),
      });
      const failedMessage = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: failedMessage,
        objective: "未完成的消息",
      });
      const next = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: next,
        objective: "不得越过失败继续",
      });
      const claimed = await claimNextConversationQueueEntry(pool!, {
        accountId: seeded.accountId,
        sessionId: seeded.sessionId,
        workerId: "prioritize-gate",
      });
      expect(claimed).not.toBeNull();
      await finalizeConversationQueueEntry(pool!, {
        fence: {
          accountId: claimed!.accountId,
          sessionId: claimed!.sessionId,
          entryId: claimed!.entryId,
          runId: claimed!.runId,
          leaseOwner: claimed!.leaseOwner,
          leaseGeneration: claimed!.leaseGeneration,
        },
        status: "failed",
        failureCode: "RUN_FAILED",
      });
      const snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      const target = snapshot.queued.find((entry) => entry.message_id === next);
      expect(target).toBeDefined();
      await expect(
        mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
          kind: "prioritize",
          queue_entry_id: target!.queue_entry_id,
          expected_revision: snapshot.revision,
          idempotency_key: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "CONVERSATION_QUEUE_RETRY_REQUIRED" });
    } finally {
      await removeProofAccount(seeded.accountId);
    }
  });

  it("never commits a cancelled run's stale result when the provider ignores the abort", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    provider.postGateDeltas = ["迟到的完整回答"];
    // Deliberately uncooperative: it ignores the abort signal and resolves only
    // when the test releases the gate after the stop was acknowledged.
    let releaseLate: () => void = () => undefined;
    provider.gateForObjective = () => new Promise<void>((resolve) => { releaseLate = resolve; });
    provider.ignoreAbortForObjective = () => true;
    const runner = await startRunner(provider);
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "不合作的提供方",
      });
      await waitFor(async () => {
        const snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
        return snapshot.active !== null;
      });
      const active = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await waitFor(() => provider.calls.length === 1);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "stop",
        expected_revision: active.revision,
        idempotency_key: randomUUID(),
        run_id: active.active!.run_id!,
      });
      // The stop is acknowledged durably while the provider still runs.
      await waitFor(async () => {
        const row = (await entryRow(seeded.sessionId, seeded.accountId))[0];
        return row?.cancel_requested === true && row.status === "running";
      });
      releaseLate();
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "cancelled");
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload?.turns).toHaveLength(1);
      expect(session.payload?.turns[0]?.response.unboundConversationBlocks).toMatchObject([
        { title: "已停止", body: "已停止生成，本次尚未形成回复。", status: "failed" },
      ]);
      expect(JSON.stringify(session.payload?.turns)).not.toContain("迟到的完整回答");
      const rows = await entryRow(seeded.sessionId, seeded.accountId);
      expect(rows[0]?.status).toBe("cancelled");
      expect(rows[0]?.result).toBeNull();
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  }, 20000);

  it("pauses after a failure, retries only on request, and preserves a result when persistence fails", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    provider.postGateDeltas = ["回答"];
    const runner = await startRunner(provider);
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "第一次失败",
      });
      provider.failWith = new Error("synthetic provider failure");
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "failed");
      expect((await queueState(seeded.sessionId, seeded.accountId))!.paused).toBe(true);
      provider.failWith = null;

      const failed = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      expect(failed.queued[0]?.failure_code).toBe("MODEL_RUN_FAILED");
      // Retry re-queues but does not clear the pause.
      const retried = await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "retry",
        queue_entry_id: failed.queued[0]!.queue_entry_id,
        expected_revision: failed.revision,
        idempotency_key: randomUUID(),
      });
      expect(retried.applied.status).toBe("queued");
      expect((await queueState(seeded.sessionId, seeded.accountId))!.paused).toBe(true);
      await sleep(80);
      expect(provider.calls).toHaveLength(1);
      const continued = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "continue",
        expected_revision: continued.revision,
        idempotency_key: randomUUID(),
      });
      await waitFor(async () =>
        (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "completed",
      );
      expect(provider.calls).toHaveLength(2);
      await runner.close();
      const runs = (await pool!.query("SELECT id,status FROM product_runs WHERE session_id=$1 ORDER BY created_at",[seeded.sessionId])).rows;
      expect(runs.map(row => row.status)).toEqual(["failed","completed"]);
      expect(new Set(runs.map(row => row.id)).size).toBe(2);
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("retains a successful result for replay when canonical persistence fails once", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    provider.postGateDeltas = ["已经生成"];
    // Corrupt the Session payload after the provider succeeds and before
    // persistence, so the canonical save fails once and must replay.
    provider.onBeforeReturn = async () => {
      await pool!.query(
        "UPDATE agent_sessions SET payload='{\"turns\":[]}'::jsonb,revision=revision+1 WHERE account_id=$1 AND id=$2",
        [seeded.accountId, seeded.sessionId],
      );
    };
    const runner = await startRunner(provider);
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "持久化会先失败",
      });
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "failed");
      const failed = await entryRow(seeded.sessionId, seeded.accountId);
      expect(failed[0]?.failure_code).toBe("PERSISTENCE_PENDING");
      expect(failed[0]?.result).not.toBeNull();
      expect(provider.calls).toHaveLength(1);

      // Restore a valid Session payload, then explicitly retry: only persistence replays.
      const now = new Date().toISOString();
      await pool!.query(
        "UPDATE agent_sessions SET payload=$3::jsonb,revision=revision+1 WHERE account_id=$1 AND id=$2",
        [
          seeded.accountId,
          seeded.sessionId,
          JSON.stringify({
            id: seeded.sessionId,
            scopeKind: "unresolved_intent",
            personDisplayLabel: "",
            contextDisplayLabel: "",
            title: "",
            turns: [],
            isUnread: false,
            updatedAt: now,
            createdAt: now,
          }),
        ],
      );
      const pending = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "retry",
        queue_entry_id: pending.queued[0]!.queue_entry_id,
        expected_revision: pending.revision,
        idempotency_key: randomUUID(),
      });
      const continued = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "continue",
        expected_revision: continued.revision,
        idempotency_key: randomUUID(),
      });
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "completed");
      expect(provider.calls).toHaveLength(1);
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload?.turns).toHaveLength(1);
      await runner.close();
      const runs = (await pool!.query("SELECT id,task_id,status,output FROM product_runs WHERE session_id=$1",[seeded.sessionId])).rows;
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({status:"completed",task_id:runs[0].id});
      expect(JSON.stringify(runs[0].output)).toContain("已经生成");
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("fences a stale worker after lease expiry and lets recovery reclaim the entry", async () => {
    const seeded = await seedSession();
    const messageId = randomUUID();
    const admitted = await admitConversationQueueEntry(pool!, seeded.auth, {
      idempotency_key: randomUUID(),
      session_id: seeded.sessionId,
      message_id: messageId,
      objective: "租约测试",
    });
    try {
      const claimed = await claimNextConversationQueueEntry(pool!, {
        accountId: seeded.accountId,
        sessionId: seeded.sessionId,
        workerId: "stale-worker",
      });
      expect(claimed).not.toBeNull();
      const fence = {
        accountId: claimed!.accountId,
        sessionId: claimed!.sessionId,
        entryId: claimed!.entryId,
        runId: claimed!.runId,
        leaseOwner: claimed!.leaseOwner,
        leaseGeneration: claimed!.leaseGeneration,
      };
      await pool!.query(
        "UPDATE conversation_queue_entries SET lease_expires_at=now()-interval '1 second' WHERE account_id=$1 AND id=$2",
        [seeded.accountId, admitted.response.queue_entry_id],
      );
      await expect(
        recordConversationQueueResult(pool!, fence, {
          body: { contract_version: "2026-01-01.1", task_id: randomUUID(), disposition: "answer", blocks: [], external_effects: [], created_at: new Date().toISOString() },
          conversationMessageIDs: [],
          previousTaskIDs: [],
          conversationSources: [],
          remoteStatus: "completed",
          audit: { providerID: null, model: null, providerRequestID: null, prompt: null, contactAgentEventKind: null },
        } as never),
      ).rejects.toBeInstanceOf(ConversationQueueLeaseLostError);
      const reclaimed = await reclaimStaleConversationQueueEntry(pool!, {
        accountId: seeded.accountId,
        sessionId: seeded.sessionId,
        entryId: admitted.response.queue_entry_id,
        workerId: "recovery-worker",
      });
      expect(reclaimed).not.toBeNull();
      expect(reclaimed!.leaseGeneration).toBeGreaterThan(fence.leaseGeneration);
      const finalized = await finalizeConversationQueueEntry(pool!, {
        fence: {
          accountId: reclaimed!.accountId,
          sessionId: reclaimed!.sessionId,
          entryId: reclaimed!.entryId,
          runId: reclaimed!.runId,
          leaseOwner: reclaimed!.leaseOwner,
          leaseGeneration: reclaimed!.leaseGeneration,
        },
        status: "interrupted",
        failureCode: "RUNNER_INTERRUPTED",
      });
      expect(finalized.applied).toBe(true);
      expect((await queueState(seeded.sessionId, seeded.accountId))!.paused).toBe(true);
    } finally {
      await removeProofAccount(seeded.accountId);
    }
  });

  it("isolates accounts and users, and fences deleted or expired Sessions", async () => {
    const owner = await seedSession();
    const other = await seedSession();
    try {
      await admitConversationQueueEntry(pool!, owner.auth, {
        idempotency_key: randomUUID(),
        session_id: owner.sessionId,
        message_id: randomUUID(),
        objective: "私有队列",
      });
      await expect(
        readConversationQueueSnapshot(pool!, other.auth, owner.sessionId),
      ).rejects.toMatchObject({ statusCode: 404 });
      const sameAccountOtherUser: AuthContext = {
        ...owner.auth,
        userId: randomUUID(),
        userEmail: "other@example.test",
      };
      await expect(
        readConversationQueueSnapshot(pool!, sameAccountOtherUser, owner.sessionId),
      ).rejects.toMatchObject({ statusCode: 404 });

      await pool!.query(
        "UPDATE agent_sessions SET payload=NULL,deleted_at=now() WHERE account_id=$1 AND id=$2",
        [owner.accountId, owner.sessionId],
      );
      await expect(
        readConversationQueueSnapshot(pool!, owner.auth, owner.sessionId),
      ).rejects.toMatchObject({ statusCode: 410 });
      await sweepConversationQueue(pool!, owner.accountId);
      expect(await entryRow(owner.sessionId, owner.accountId)).toHaveLength(0);
    } finally {
      await removeProofAccount(owner.accountId);
      await removeProofAccount(other.accountId);
    }
  });

  it("fences revoked screenshot context and never displays stale queued material", async () => {
    const revokedTask = randomUUID();
    const seeded = await seedSession({ screenshotTaskIDs: [revokedTask] });
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "依赖已撤回来源",
      }).catch(() => undefined);
      await expect(
        readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId),
      ).rejects.toMatchObject({ statusCode: 410 });
      await sweepConversationQueue(pool!, seeded.accountId);
      expect(await entryRow(seeded.sessionId, seeded.accountId)).toHaveLength(0);
    } finally {
      await removeProofAccount(seeded.accountId);
    }
  });

  it("does not extend the Session lifetime and removes rows on expiry", async () => {
    const seeded = await seedSession({ expiresIn: "1 hour" });
    const admitted = await admitConversationQueueEntry(pool!, seeded.auth, {
      idempotency_key: randomUUID(),
      session_id: seeded.sessionId,
      message_id: randomUUID(),
      objective: "继承会话期限",
    });
    try {
      const entry = (
        await pool!.query<{ expires_at: Date }>(
          "SELECT expires_at FROM conversation_queue_entries WHERE account_id=$1 AND id=$2",
          [seeded.accountId, admitted.response.queue_entry_id],
        )
      ).rows[0]!;
      const session = (
        await pool!.query<{ expires_at: Date }>(
          "SELECT expires_at FROM agent_sessions WHERE account_id=$1 AND id=$2",
          [seeded.accountId, seeded.sessionId],
        )
      ).rows[0]!;
      expect(entry.expires_at.toISOString()).toBe(session.expires_at.toISOString());
      await pool!.query(
        "UPDATE agent_sessions SET expires_at=now()-interval '1 hour' WHERE account_id=$1 AND id=$2",
        [seeded.accountId, seeded.sessionId],
      );
      await sweepConversationQueue(pool!, seeded.accountId);
      expect(await entryRow(seeded.sessionId, seeded.accountId)).toHaveLength(0);
      expect(await queueState(seeded.sessionId, seeded.accountId)).toBeUndefined();
    } finally {
      await removeProofAccount(seeded.accountId);
    }
  });

  it("exposes a usable terminal state after recovery of a crashed run", async () => {
    const seeded = await seedSession();
    const admitted = await admitConversationQueueEntry(pool!, seeded.auth, {
      idempotency_key: randomUUID(),
      session_id: seeded.sessionId,
      message_id: randomUUID(),
      objective: "崩溃恢复",
    });
    const provider = new ScriptedConversationProvider();
    try {
      const claimed = await claimNextConversationQueueEntry(pool!, {
        accountId: seeded.accountId,
        sessionId: seeded.sessionId,
        workerId: "crashed-worker",
      });
      expect(claimed).not.toBeNull();
      await pool!.query(
        "UPDATE conversation_queue_entries SET lease_expires_at=now()-interval '1 second' WHERE account_id=$1 AND id=$2",
        [seeded.accountId, admitted.response.queue_entry_id],
      );
      const recoveryRunner = new ConversationQueueRunner({
        pool: pool!,
        provider,
        logger: silentLogger,
        workerId: "recovery-runner",
        pollIntervalMs: 10,
      });
      await recoveryRunner.recover();
      const rows = await entryRow(seeded.sessionId, seeded.accountId);
      expect(rows[0]?.status).toBe("interrupted");
      expect(rows[0]?.failure_code).toBe("RUNNER_INTERRUPTED");
      expect(provider.calls).toHaveLength(0);
      const snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      expect(snapshot.paused).toBe(true);
      expect(snapshot.queued[0]?.status).toBe("interrupted");
    } finally {
      await removeProofAccount(seeded.accountId);
    }
  });

  it("settles a stop that survived a crashed worker instead of blocking the Session queue", async () => {
    const seeded = await seedSession();
    const runner = new ConversationQueueRunner({ pool: pool!, provider: null, logger: silentLogger });
    const stoppedMessageId = randomUUID();
    const followupMessageId = randomUUID();
    const stoppedImage = pngUpload(pngBytes(12));
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: stoppedMessageId,
        objective: "崩溃后遗留的停止请求",
        images: [stoppedImage],
      });
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: followupMessageId,
        objective: "恢复后应继续的下一条",
      });
      const claimed = await claimNextConversationQueueEntry(pool!, {
        accountId: seeded.accountId,
        sessionId: seeded.sessionId,
        workerId: "audit-crashed-worker",
      });
      expect(claimed).not.toBeNull();
      const beforeStop = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "stop",
        expected_revision: beforeStop.revision,
        idempotency_key: randomUUID(),
        run_id: claimed!.runId,
      });
      // The worker dies before it can settle the committed stop; only the
      // durable lease remains and now reads as expired.
      await pool!.query(
        "UPDATE conversation_queue_entries SET lease_expires_at = now() - interval '1 second' WHERE account_id=$1 AND id=$2",
        [seeded.accountId, claimed!.entryId],
      );
      await runner.recover();
      const rows = await entryRow(seeded.sessionId, seeded.accountId);
      expect(rows[0]?.status).toBe("cancelled");
      expect((await queueState(seeded.sessionId, seeded.accountId))!.paused).toBe(true);
      const stoppedSession = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(stoppedSession.payload?.turns).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: stoppedMessageId, objective: "崩溃后遗留的停止请求",
          images: [expect.objectContaining({ attachment_id: stoppedImage.attachment_id })] }),
      ]));
      // A settled stop pauses like every other stop; Continue resumes the queue
      // instead of the stopped row blocking its Session forever.
      const paused = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "continue",
        expected_revision: paused.revision,
        idempotency_key: randomUUID(),
      });
      const next = await claimNextConversationQueueEntry(pool!, {
        accountId: seeded.accountId,
        sessionId: seeded.sessionId,
        workerId: "audit-followup-worker",
      });
      expect(next?.messageId).toBe(followupMessageId);
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("retains a recovered stopped message when saving its history fails, then retries without a provider", async () => {
    const seeded = await seedSession();
    const messageId = randomUUID();
    let rejectSave = true;
    const failingPool = {
      query: pool!.query.bind(pool),
      connect: async () => {
        const client = await pool!.connect();
        return {
          query: (sql: string, values?: unknown[]) => {
            if (rejectSave && sql.includes("INSERT INTO agent_sessions(")) {
              throw new Error("SYNTHETIC_HISTORY_SAVE_FAILURE");
            }
            return client.query(sql, values);
          },
          release: () => client.release(),
        };
      },
    } as unknown as Pool;
    const runner = new ConversationQueueRunner({ pool: failingPool, provider: null, logger: silentLogger });
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId,
        message_id: messageId, objective: "Keep my stopped message until its history is durable",
      });
      const claimed = await claimNextConversationQueueEntry(pool!, {
        accountId: seeded.accountId, sessionId: seeded.sessionId, workerId: "history-failure-proof",
      });
      const before = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "stop", expected_revision: before.revision,
        idempotency_key: randomUUID(), run_id: claimed!.runId,
      });
      const expireLease = () => pool!.query(
        "UPDATE conversation_queue_entries SET lease_expires_at=now()-interval '1 second' WHERE account_id=$1 AND id=$2",
        [seeded.accountId, claimed!.entryId],
      );
      await expireLease();
      await runner.recover();
      expect((await entryRow(seeded.sessionId, seeded.accountId))[0]).toMatchObject({
        status: "running", cancel_requested: true,
        objective: "Keep my stopped message until its history is durable",
      });
      expect((await getAgentSession(pool!, seeded.auth, seeded.sessionId)).payload?.turns).toEqual([]);
      rejectSave = false;
      await expireLease();
      await runner.recover();
      expect((await entryRow(seeded.sessionId, seeded.accountId))[0]?.status).toBe("cancelled");
      expect((await getAgentSession(pool!, seeded.auth, seeded.sessionId)).payload?.turns).toEqual([
        expect.objectContaining({ id: messageId, objective: "Keep my stopped message until its history is durable" }),
      ]);
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it.each(["stop", "prioritize"] as const)("does not publish a stop when its %s transaction rolls back", async (kind) => {
    const seeded = await seedSession();
    const stops: string[] = [];
    const unsubscribe = subscribeConversationQueueLive(event => {
      if (event.type === "stop" && event.sessionId === seeded.sessionId) stops.push(event.runId);
    });
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId,
        message_id: randomUUID(), objective: "Rollback must preserve this run",
      });
      const claimed = await claimNextConversationQueueEntry(pool!, {
        accountId: seeded.accountId, sessionId: seeded.sessionId, workerId: "rollback-proof",
      });
      const queued = await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId,
        message_id: randomUUID(), objective: "A waiting supplement",
      });
      const before = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      // Real PostgreSQL transaction, with a failure after the stop update but
      // before its operation receipt can commit. This is not a mocked rollback.
      const failingPool = { connect: async () => {
        const client = await pool!.connect();
        return {
          query: (sql: string, values?: unknown[]) => {
            if (sql.startsWith("INSERT INTO conversation_queue_operations")) throw new Error("SYNTHETIC_RECEIPT_FAILURE");
            return client.query(sql, values);
          },
          release: () => client.release(),
        };
      } } as unknown as Pool;
      await expect(mutateConversationQueueEntry(failingPool, seeded.auth, seeded.sessionId, {
        ...(kind === "stop" ? { kind, run_id: claimed!.runId } : { kind, queue_entry_id: queued.response.queue_entry_id }),
        expected_revision: before.revision, idempotency_key: randomUUID(),
      })).rejects.toThrow("SYNTHETIC_RECEIPT_FAILURE");
      expect((await entryRow(seeded.sessionId, seeded.accountId))[0]?.cancel_requested).toBe(false);
      expect(stops).toEqual([]);
    } finally {
      unsubscribe();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("accepts every mutation kind through the real Fastify route contract", async () => {
    const seeded = await seedSession();
    const app = Fastify();
    app.decorateRequest("auth", null as unknown as AuthContext);
    registerConversationQueueRoutes(app, pool!, async (request) => {
      (request as unknown as { auth: AuthContext }).auth = seeded.auth;
    });
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof ApiError) {
        void reply.status(error.statusCode).send({
          error: { code: error.code, message: error.message, request_id: request.id },
        });
        return;
      }
      void reply.status(500).send({
        error: { code: "INTERNAL_ERROR", message: "synthetic", request_id: request.id },
      });
    });
    await app.ready();
    const url = `/v1/agent-sessions/${seeded.sessionId}/conversation-queue`;
    const inject = (method: "GET" | "POST", path: string, body?: Record<string, unknown>) =>
      app.inject({
        method,
        url: path,
        ...(body
          ? { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }
          : {}),
      });
    const post = (body: Record<string, unknown>) => inject("POST", `${url}/mutations`, body);
    try {
      const admitted = await inject("POST", url, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "HTTP 编辑目标",
      });
      expect(admitted.statusCode).toBe(202);
      const firstEntryID = (admitted.json() as { queue_entry_id: string }).queue_entry_id;

      const readRevision = async () => {
        const response = await inject("GET", url);
        expect(response.statusCode).toBe(200);
        return response.json() as {
          revision: number;
          active: { run_id: string } | null;
          queued: Array<{ queue_entry_id: string }>;
        };
      };

      let snapshot = await readRevision();
      const edit = await post({
        kind: "edit",
        queue_entry_id: firstEntryID,
        expected_revision: snapshot.revision,
        idempotency_key: randomUUID(),
        objective: "HTTP 编辑后",
      });
      expect(edit.statusCode, edit.body).toBe(200);
      expect(edit.json().applied.kind).toBe("edit");

      snapshot = await readRevision();
      const continued = await post({
        kind: "continue",
        expected_revision: snapshot.revision,
        idempotency_key: randomUUID(),
      });
      expect(continued.statusCode, continued.body).toBe(200);
      expect(continued.json().applied.kind).toBe("continue");

      const claimed = await claimNextConversationQueueEntry(pool!, {
        accountId: seeded.accountId,
        sessionId: seeded.sessionId,
        workerId: "http-stop",
      });
      expect(claimed).not.toBeNull();
      snapshot = await readRevision();
      const stop = await post({
        kind: "stop",
        expected_revision: snapshot.revision,
        idempotency_key: randomUUID(),
        run_id: claimed!.runId,
      });
      expect(stop.statusCode, stop.body).toBe(200);
      expect(stop.json().applied.kind).toBe("stop");

      // Stop leaves the run cancel-requested; finalize it truthfully, then
      // unpause through the HTTP continue command.
      await finalizeConversationQueueEntry(pool!, {
        fence: {
          accountId: claimed!.accountId,
          sessionId: claimed!.sessionId,
          entryId: claimed!.entryId,
          runId: claimed!.runId,
          leaseOwner: claimed!.leaseOwner,
          leaseGeneration: claimed!.leaseGeneration,
        },
        status: "cancelled",
      });
      snapshot = await readRevision();
      await post({
        kind: "continue",
        expected_revision: snapshot.revision,
        idempotency_key: randomUUID(),
      });

      // retry: a second entry is claimed and moved to a retryable failure.
      const secondAdmit = await inject("POST", url, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "HTTP 重试目标",
      });
      expect(secondAdmit.statusCode).toBe(202);
      const secondEntryID = (secondAdmit.json() as { queue_entry_id: string }).queue_entry_id;
      const secondClaim = await claimNextConversationQueueEntry(pool!, {
        accountId: seeded.accountId,
        sessionId: seeded.sessionId,
        workerId: "http-retry",
      });
      expect(secondClaim).not.toBeNull();
      await finalizeConversationQueueEntry(pool!, {
        fence: {
          accountId: secondClaim!.accountId,
          sessionId: secondClaim!.sessionId,
          entryId: secondClaim!.entryId,
          runId: secondClaim!.runId,
          leaseOwner: secondClaim!.leaseOwner,
          leaseGeneration: secondClaim!.leaseGeneration,
        },
        status: "failed",
        failureCode: "RUN_FAILED",
      });
      snapshot = await readRevision();
      const retry = await post({
        kind: "retry",
        queue_entry_id: secondEntryID,
        expected_revision: snapshot.revision,
        idempotency_key: randomUUID(),
      });
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json().applied.kind).toBe("retry");

      const extra = await inject("POST", url, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "HTTP 撤回目标",
      });
      expect(extra.statusCode).toBe(202);
      const extraEntryID = (extra.json() as { queue_entry_id: string }).queue_entry_id;
      snapshot = await readRevision();
      const withdraw = await post({
        kind: "withdraw",
        queue_entry_id: extraEntryID,
        expected_revision: snapshot.revision,
        idempotency_key: randomUUID(),
      });
      expect(withdraw.statusCode, withdraw.body).toBe(200);
      expect(withdraw.json().applied.kind).toBe("withdraw");

      // prioritize is accepted through the same non-mutating mutation union.
      const prioritizeTarget = await inject("POST", url, {
        idempotency_key: randomUUID(),
        session_id: seeded.sessionId,
        message_id: randomUUID(),
        objective: "HTTP 优先目标",
      });
      expect(prioritizeTarget.statusCode).toBe(202);
      const prioritizeEntryID = (prioritizeTarget.json() as { queue_entry_id: string }).queue_entry_id;
      snapshot = await readRevision();
      const prioritize = await post({
        kind: "prioritize",
        queue_entry_id: prioritizeEntryID,
        expected_revision: snapshot.revision,
        idempotency_key: randomUUID(),
      });
      expect(prioritize.statusCode, prioritize.body).toBe(200);
      expect(prioritize.json().applied.kind).toBe("prioritize");

      const invalidStop = await post({
        kind: "stop",
        expected_revision: 0,
        idempotency_key: randomUUID(),
      });
      expect(invalidStop.statusCode).toBe(400);
    } finally {
      await app.close();
      await removeProofAccount(seeded.accountId);
    }
  }, 20000);

  it("persists the admitted turn and a truthful stopped marker when a model failure races a committed stop", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    provider.silent = true;
    provider.failWith = new Error("synthetic provider failure");
    provider.onBeforeReturn = () => commitUnpublishedStop(seeded.sessionId, seeded.accountId);
    const messageId = randomUUID();
    const objective = "失败与停止竞争时必须保留原消息";
    const stoppedImage = pngUpload(pngBytes(21));
    const runner = new ConversationQueueRunner({
      pool: pool!, provider, logger: silentLogger, workerId: `w-${randomUUID()}`,
      pollIntervalMs: 10, heartbeatMs: 100_000, recoveryIntervalMs: 10_000,
    });
    runner.start();
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId,
        message_id: messageId, objective, images: [stoppedImage],
      });
      await waitFor(() => provider.calls.length === 1);
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "cancelled");
      const rows = await entryRow(seeded.sessionId, seeded.accountId);
      expect(rows[0]?.status).toBe("cancelled");
      expect(rows[0]?.content_state).toBe("scrubbed");
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload?.turns).toEqual([
        expect.objectContaining({
          id: messageId, objective,
          images: [expect.objectContaining({ attachment_id: stoppedImage.attachment_id })],
          response: expect.objectContaining({
            unboundConversationBlocks: [expect.objectContaining({
              title: "已停止", body: "已停止生成，本次尚未形成回复。", status: "failed",
            })],
          }),
        }),
      ]);
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  }, 20000);

  it("persists the admitted turn and a truthful stopped marker when shutdown races a committed stop", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    provider.silent = true;
    const held = gate();
    provider.gateForObjective = () => held.promise;
    const messageId = randomUUID();
    const objective = "关闭与停止竞争时必须保留原消息";
    const stoppedImage = pngUpload(pngBytes(22));
    const runner = new ConversationQueueRunner({
      pool: pool!, provider, logger: silentLogger, workerId: `w-${randomUUID()}`,
      pollIntervalMs: 10, heartbeatMs: 100_000, recoveryIntervalMs: 10_000,
    });
    runner.start();
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId,
        message_id: messageId, objective, images: [stoppedImage],
      });
      await waitFor(() => provider.calls.length === 1);
      await commitUnpublishedStop(seeded.sessionId, seeded.accountId);
      await runner.close();
      const rows = await entryRow(seeded.sessionId, seeded.accountId);
      expect(rows[0]?.status).toBe("cancelled");
      expect(rows[0]?.content_state).toBe("scrubbed");
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload?.turns).toEqual([
        expect.objectContaining({
          id: messageId, objective,
          images: [expect.objectContaining({ attachment_id: stoppedImage.attachment_id })],
          response: expect.objectContaining({
            unboundConversationBlocks: [expect.objectContaining({
              title: "已停止", body: "已停止生成，本次尚未形成回复。", status: "failed",
            })],
          }),
        }),
      ]);
    } finally {
      held.release();
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  }, 20000);

  it("retains a recoverable fenced row when a raced stop cannot save its history, then settles it intact", async () => {
    const seeded = await seedSession();
    const messageId = randomUUID();
    const objective = "保存失败时保留可恢复队列行";
    let rejectSave = true;
    let saveAttempts = 0;
    const failingPool = {
      query: pool!.query.bind(pool),
      connect: async () => {
        const client = await pool!.connect();
        return {
          query: (sql: string, values?: unknown[]) => {
            if (rejectSave && sql.includes("INSERT INTO agent_sessions(")) {
              saveAttempts += 1;
              throw new Error("SYNTHETIC_HISTORY_SAVE_FAILURE");
            }
            return client.query(sql, values);
          },
          release: () => client.release(),
        };
      },
    } as unknown as Pool;
    const provider = new ScriptedConversationProvider();
    provider.silent = true;
    provider.failWith = new Error("synthetic provider failure");
    provider.onBeforeReturn = () => commitUnpublishedStop(seeded.sessionId, seeded.accountId);
    const cancellationWarnings: Record<string, unknown>[] = [];
    const runner = new ConversationQueueRunner({
      pool: failingPool, provider, logger: {
        ...silentLogger,
        warn(metadata, message) {
          if (message === "conversation queue stop racing a failure could not persist the admitted message") {
            cancellationWarnings.push(metadata);
          }
        },
      }, workerId: `w-${randomUUID()}`,
      pollIntervalMs: 10, heartbeatMs: 100_000, recoveryIntervalMs: 10_000,
    });
    runner.start();
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId,
        message_id: messageId, objective,
      });
      await waitFor(() => provider.calls.length === 1);
      await waitFor(() => saveAttempts >= 1);
      await waitFor(() => cancellationWarnings.length === 1);
      // Database errors can include private row details. This new diagnostic
      // records only the queue identity and a fixed classification.
      expect(cancellationWarnings).toEqual([{
        queue_entry_id: expect.any(String),
        failure_code: "CANCELLATION_PERSISTENCE_FAILED",
      }]);
      // Never scrub and never claim saved: the fenced row keeps the message.
      expect((await entryRow(seeded.sessionId, seeded.accountId))[0]).toMatchObject({
        status: "running", cancel_requested: true, content_state: "retained", objective,
      });
      expect((await getAgentSession(pool!, seeded.auth, seeded.sessionId)).payload?.turns).toEqual([]);
      rejectSave = false;
      await pool!.query(
        "UPDATE conversation_queue_entries SET lease_expires_at=now()-interval '1 second' WHERE account_id=$1 AND session_id=$2",
        [seeded.accountId, seeded.sessionId],
      );
      await runner.recover();
      expect((await entryRow(seeded.sessionId, seeded.accountId))[0]).toMatchObject({
        status: "cancelled", content_state: "scrubbed",
      });
      expect((await getAgentSession(pool!, seeded.auth, seeded.sessionId)).payload?.turns).toEqual([
        expect.objectContaining({ id: messageId, objective }),
      ]);
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  }, 20000);

  it("keeps an ordinary failure retained without a stopped marker and retries the exact message", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    provider.postGateDeltas = ["第一次的回答"];
    provider.failWith = new Error("synthetic provider failure");
    const runner = await startRunner(provider);
    const messageId = randomUUID();
    const objective = "普通失败不得伪造停止标记";
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId,
        message_id: messageId, objective,
      });
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "failed");
      // Negative control: without a stop nothing is scrubbed and no stopped
      // marker may claim the message was saved.
      expect((await entryRow(seeded.sessionId, seeded.accountId))[0]).toMatchObject({
        status: "failed", content_state: "retained", failure_code: "MODEL_RUN_FAILED", objective,
      });
      expect((await getAgentSession(pool!, seeded.auth, seeded.sessionId)).payload?.turns).toEqual([]);
      provider.failWith = null;
      const failed = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "retry", queue_entry_id: failed.queued[0]!.queue_entry_id,
        expected_revision: failed.revision, idempotency_key: randomUUID(),
      });
      const continued = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "continue", expected_revision: continued.revision, idempotency_key: randomUUID(),
      });
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "completed");
      // Retry re-runs the model and only then persists the exact admitted text.
      expect(provider.calls).toHaveLength(2);
      expect((await getAgentSession(pool!, seeded.auth, seeded.sessionId)).payload?.turns).toEqual([
        expect.objectContaining({ id: messageId, objective }),
      ]);
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  }, 20000);

});

function pngBytes(fill = 1, size = 64): Buffer {
  const bytes = Buffer.alloc(size, fill);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  return bytes;
}
function pngUpload(bytes: Buffer, attachmentID = randomUUID()) {
  return {
    attachment_id: attachmentID,
    file_name: "inline.png",
    media_type: "image/png" as const,
    byte_size: bytes.length,
    content_hash: createHash("sha256").update(bytes).digest("hex"),
    data_base64: bytes.toString("base64"),
  };
}

suite("conversation message images", () => {
  it("admits images-only inline, delivers exact pixels, and retains only a manifest", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    const runner = await startRunner(provider);
    try {
      const bytes = pngBytes(3);
      const attachmentID = randomUUID();
      const message = randomUUID();
      const admitted = await admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId, message_id: message, idempotency_key: randomUUID(),
        objective: "", images: [pngUpload(bytes, attachmentID)],
      });
      expect(admitted.response.status).toBe("queued");
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "completed");

      const manifest = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      // Completed entries are scrubbed from the active snapshot but the bytes stay.
      expect(manifest.active).toBeNull();
      const readback = await readConversationMessageImage(pool!, seeded.auth, seeded.sessionId, message, 0);
      expect(readback?.media_type).toBe("image/png");
      expect(readback?.content.equals(bytes)).toBe(true);

      const imageParts = provider.lastInputParts.filter(part => part.kind === "image");
      expect(imageParts).toHaveLength(1);
      expect(imageParts[0]).toMatchObject({ kind: "image", mimeType: "image/png", byteSize: bytes.length,
        contentHash: createHash("sha256").update(bytes).digest("hex"), dataBase64: bytes.toString("base64") });

      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      const turn = session.payload?.turns[0]!;
      expect(turn.objective).toBe("");
      expect(turn.images).toEqual([{ attachment_id: attachmentID, file_name: "inline.png", media_type: "image/png",
        byte_size: bytes.length, content_hash: imageParts[0]!.contentHash }]);
      expect(JSON.stringify(turn)).not.toContain("data_base64");
      expect(JSON.stringify(turn)).not.toContain(bytes.toString("base64"));
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("rejects empty text without images and conflicting bytes or order for one message", async () => {
    const seeded = await seedSession();
    try {
      await expect(admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId, message_id: randomUUID(), idempotency_key: randomUUID(), objective: "",
      })).rejects.toMatchObject({ code: "CONVERSATION_QUEUE_OBJECTIVE_REQUIRED" });

      const message = randomUUID();
      const idempotency = randomUUID();
      const first = pngUpload(pngBytes(4));
      const admitted = await admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId, message_id: message, idempotency_key: idempotency, objective: "mixed", images: [first],
      });
      const replay = await admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId, message_id: message, idempotency_key: idempotency, objective: "mixed", images: [first],
      });
      expect(replay.replayed).toBe(true);
      expect(replay.response.queue_entry_id).toBe(admitted.response.queue_entry_id);

      await expect(admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId, message_id: message, idempotency_key: randomUUID(), objective: "mixed", images: [pngUpload(pngBytes(5))],
      })).rejects.toMatchObject({ code: "CONVERSATION_QUEUE_MESSAGE_CONFLICT" });

      const count = await pool!.query<{ count: string }>("SELECT count(*) AS count FROM conversation_message_images WHERE account_id=$1 AND message_id=$2", [seeded.accountId, message]);
      expect(Number(count.rows[0]!.count)).toBe(1);
    } finally {
      await removeProofAccount(seeded.accountId);
    }
  });

  it("rejects signature, hash, and per-image size errors before any admission", async () => {
    const seeded = await seedSession();
    try {
      const bytes = pngBytes();
      const cases = [
        { ...pngUpload(bytes), content_hash: "a".repeat(64) },
        { ...pngUpload(bytes), data_base64: `${bytes.toString("base64")}\n` },
        { ...pngUpload(bytes), media_type: "image/jpeg" as const },
        { ...pngUpload(bytes), byte_size: bytes.length + 1 },
        { ...pngUpload(bytes), byte_size: 10_000_001 },
      ];
      for (const image of cases) {
        await expect(admitConversationQueueEntry(pool!, seeded.auth, {
          session_id: seeded.sessionId, message_id: randomUUID(), idempotency_key: randomUUID(), objective: "", images: [image],
        })).rejects.toMatchObject({ statusCode: 422 });
      }
      const entries = await pool!.query<{ count: string }>("SELECT count(*) AS count FROM conversation_queue_entries WHERE account_id=$1", [seeded.accountId]);
      expect(Number(entries.rows[0]!.count)).toBe(0);
    } finally {
      await removeProofAccount(seeded.accountId);
    }
  });

  it("scopes image readback to the owning account and cascades on withdraw", async () => {
    const seeded = await seedSession();
    const other = await seedSession();
    try {
      const message = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId, message_id: message, idempotency_key: randomUUID(), objective: "scoped", images: [pngUpload(pngBytes(6))],
      });
      expect(await readConversationMessageImage(pool!, seeded.auth, seeded.sessionId, message, 0)).not.toBeNull();
      expect(await readConversationMessageImage(pool!, other.auth, seeded.sessionId, message, 0)).toBeNull();
      expect(await readConversationMessageImage(pool!, seeded.auth, seeded.sessionId, message, 1)).toBeNull();

      const snapshot = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      const withdraw = await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "withdraw", queue_entry_id: snapshot.queued[0]!.queue_entry_id, expected_revision: snapshot.revision, idempotency_key: randomUUID(),
      });
      expect(withdraw.applied.kind).toBe("withdraw");
      const remaining = await pool!.query<{ count: string }>("SELECT count(*) AS count FROM conversation_message_images WHERE account_id=$1 AND message_id=$2", [seeded.accountId, message]);
      expect(Number(remaining.rows[0]!.count)).toBe(0);
      expect(await readConversationMessageImage(pool!, seeded.auth, seeded.sessionId, message, 0)).toBeNull();
    } finally {
      await removeProofAccount(other.accountId);
      await removeProofAccount(seeded.accountId);
    }
  });
});

suite("conversation image compatibility and followups", () => {
  it("replays a pre-deployment text-only receipt without changing its hash", async () => {
    const seeded = await seedSession();
    try {
      const message = randomUUID();
      const key = randomUUID();
      const objective = "旧客户端文本重试";
      const oldHash = digestValue({ session_id: seeded.sessionId, message_id: message, objective, time_zone: null });
      const receipt = { contract_version: CONTRACT_VERSION, session_id: seeded.sessionId, message_id: message,
        queue_entry_id: randomUUID(), run_id: null, status: "queued", sequence: 1, revision: 1, snapshot_revision: 1,
        accepted_at: new Date().toISOString() };
      await pool!.query(
        `INSERT INTO idempotency_records(id,account_id,actor_user_id,operation_scope,idempotency_key,request_hash,status,response_status,response_body,completed_at)
         VALUES($1,$2,$3,'conversation_queue_admit',$4,$5,'completed',202,$6::jsonb,now())`,
        [randomUUID(), seeded.accountId, seeded.userId, key, oldHash, JSON.stringify(receipt)],
      );
      const replay = await admitConversationQueueEntry(pool!, seeded.auth, { session_id: seeded.sessionId, message_id: message, idempotency_key: key, objective });
      expect(replay.replayed).toBe(true);
      expect(replay.response.queue_entry_id).toBe(receipt.queue_entry_id);
    } finally {
      await removeProofAccount(seeded.accountId);
    }
  });

  it("conflicts a reordered image manifest for the same message identity", async () => {
    const seeded = await seedSession();
    try {
      const message = randomUUID();
      const first = pngUpload(pngBytes(1));
      const second = pngUpload(pngBytes(2));
      await admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId, message_id: message, idempotency_key: randomUUID(), objective: "order", images: [first, second],
      });
      await expect(admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId, message_id: message, idempotency_key: randomUUID(), objective: "order", images: [second, first],
      })).rejects.toMatchObject({ code: "CONVERSATION_QUEUE_MESSAGE_CONFLICT" });
    } finally {
      await removeProofAccount(seeded.accountId);
    }
  });

  it("lets a text-only followup inspect the earlier image from the same owned Session", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    const runner = await startRunner(provider);
    try {
      const bytes = pngBytes(8, 48);
      const message = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId, message_id: message, idempotency_key: randomUUID(), objective: "look at this", images: [pngUpload(bytes)],
      });
      await waitFor(() => provider.calls.length === 1);
      await admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId, message_id: randomUUID(), idempotency_key: randomUUID(), objective: "what did you see?",
      });
      await waitFor(() => provider.calls.length === 2);
      const images = provider.lastInputParts.filter(part => part.kind === "image");
      expect(images).toHaveLength(1);
      expect(images[0]).toMatchObject({
        artifactID: expect.stringContaining(message),
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        dataBase64: bytes.toString("base64"),
      });
      // The followup's own turn must not claim the earlier message's manifest.
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      const followup = session.payload?.turns.find(turn => turn.objective === "what did you see?");
      expect(followup?.images).toBeUndefined();
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("denies image readback after Session expiry and cascades on Session delete", async () => {
    const seeded = await seedSession();
    const other = await seedSession();
    try {
      const message = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId, message_id: message, idempotency_key: randomUUID(), objective: "expiry", images: [pngUpload(pngBytes(9))],
      });
      await pool!.query("UPDATE agent_sessions SET expires_at=now()-interval '1 second' WHERE account_id=$1 AND id=$2", [seeded.accountId, seeded.sessionId]);
      expect(await readConversationMessageImage(pool!, seeded.auth, seeded.sessionId, message, 0)).toBeNull();

      const second = randomUUID();
      await admitConversationQueueEntry(pool!, other.auth, {
        session_id: other.sessionId, message_id: second, idempotency_key: randomUUID(), objective: "purge", images: [pngUpload(pngBytes(10))],
      });
      await pool!.query("DELETE FROM agent_sessions WHERE account_id=$1 AND id=$2", [other.accountId, other.sessionId]);
      const remaining = await pool!.query<{ count: string }>(
        "SELECT count(*) AS count FROM conversation_message_images WHERE account_id=$1 AND session_id=$2",
        [other.accountId, other.sessionId],
      );
      expect(Number(remaining.rows[0]!.count)).toBe(0);
    } finally {
      await removeProofAccount(other.accountId);
      await removeProofAccount(seeded.accountId);
    }
  });

  it("preserves server-owned turn images on a legacy PUT and refuses a forged manifest", async () => {
    const seeded = await seedSession();
    const provider = new ScriptedConversationProvider();
    const runner = await startRunner(provider);
    try {
      const message = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, {
        session_id: seeded.sessionId, message_id: message, idempotency_key: randomUUID(), objective: "legacy", images: [pngUpload(pngBytes(11))],
      });
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "completed");
      const before = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      const original = structuredClone(before.payload!);
      expect(original.turns[0]?.images).toHaveLength(1);

      const legacy = structuredClone(original) as unknown as { turns: Array<Record<string, unknown>>; composerDraft?: string; updatedAt: string };
      delete legacy.turns[0]!.images;
      // Equivalent timestamps must still restore the server-owned manifest.
      legacy.turns[0]!.createdAt = original.turns[0]!.createdAt.replace(/Z$/, "000Z");
      legacy.composerDraft = "edited draft";
      legacy.updatedAt = new Date().toISOString();
      await mutateAgentSession(pool!, seeded.auth, seeded.sessionId, {
        expected_revision: before.revision, idempotency_key: randomUUID(), payload: legacy as never,
      });
      const after = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(after.payload?.turns[0]?.images).toEqual(original.turns[0]?.images);
      expect(after.payload?.composerDraft).toBe("edited draft");

      const forged = structuredClone(original) as unknown as { turns: Array<{ images: Array<{ content_hash: string }> }>; updatedAt: string };
      (forged.turns[0]! as { images: Array<{ content_hash: string }>; createdAt?: string }).createdAt =
        original.turns[0]!.createdAt.replace(/Z$/, "000Z");
      forged.turns[0]!.images[0]!.content_hash = "f".repeat(64);
      forged.updatedAt = new Date().toISOString();
      await expect(mutateAgentSession(pool!, seeded.auth, seeded.sessionId, {
        expected_revision: after.revision, idempotency_key: randomUUID(), payload: forged as never,
      })).rejects.toMatchObject({ code: "AGENT_SESSION_IMAGE_MANIFEST_CHANGED" });
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });
});


suite("queue attempt monitoring", () => {
  it("binds the canonical answer and LLM span, then removes revoked content", async () => {
    const seeded=await seedSession(), provider=new ScriptedConversationProvider();
    const run=provider.run.bind(provider);
    provider.run=(...args) => captureProductStep("synthetic.llm","llm",{prompt:args[0].objective},()=>run(...args),{model:provider.model});
    provider.postGateDeltas=["synthetic exact answer"];
    const runner=await startRunner(provider);
    try {
      const messageID=randomUUID();
      await admitConversationQueueEntry(pool!,seeded.auth,{idempotency_key:randomUUID(),session_id:seeded.sessionId,message_id:messageID,objective:"synthetic monitor objective"});
      await waitFor(async ()=>(await entryRow(seeded.sessionId,seeded.accountId))[0]?.status==="completed");
      await runner.close();
      const id=(await entryRow(seeded.sessionId,seeded.accountId))[0]!.run_id!;
      const detail=await new ProductRunService(pool!).detail(seeded.auth,id);
      expect(detail.run).toMatchObject({id,task_id:id,content_available:true,status:"completed"});
      expect(JSON.stringify(detail.output)).toContain("synthetic exact answer");
      expect(detail.spans.some(span=>span.kind==="llm" && JSON.stringify(span.output).includes("synthetic exact answer"))).toBe(true);
      expect(detail.spans.some(span=>span.metadata.message_id===messageID)).toBe(true);
      await pool!.query("UPDATE agent_sessions SET payload=NULL,deleted_at=now() WHERE account_id=$1 AND id=$2",[seeded.accountId,seeded.sessionId]);
      await cleanupProductRunSources(pool!);
      const revoked=await new ProductRunService(pool!).detail(seeded.auth,id);
      expect(revoked.run.content_available).toBe(false);
      expect(revoked.output).toBeNull();
      expect(revoked.spans).toEqual([]);
    } finally { await runner.close();await removeProofAccount(seeded.accountId); }
  });

  it("retains safe failure diagnostics through cleanup without provider prose or source content",async()=>{
    const seeded=await seedSession(),provider=new ScriptedConversationProvider();
    provider.failWith=new Error("private-provider-error sk-secret-123");
    const runner=await startRunner(provider);
    try {
      await admitConversationQueueEntry(pool!,seeded.auth,{idempotency_key:randomUUID(),session_id:seeded.sessionId,message_id:randomUUID(),objective:"private-user-objective"});
      await waitFor(async ()=>(await entryRow(seeded.sessionId,seeded.accountId))[0]?.status==="failed");
      await runner.close();
      const id=(await entryRow(seeded.sessionId,seeded.accountId))[0]!.run_id!;
      await cleanupProductRunSources(pool!);
      const detail=await new ProductRunService(pool!).detail(seeded.auth,id);
      expect(detail.run.status).toBe("failed");
      expect(detail.output).toBeNull();
      expect(detail.spans.some(span=>span.metadata.failure_code==="MODEL_RUN_FAILED")).toBe(true);
      expect(JSON.stringify(detail)).not.toMatch(/private-provider-error|sk-secret|private-user-objective/);
      await pool!.query("UPDATE product_runs SET expires_at=now()-interval '1 second' WHERE id=$1",[id]);
      await cleanupProductRunSources(pool!);
      expect((await pool!.query("SELECT id FROM product_run_spans WHERE run_id=$1",[id])).rowCount).toBe(0);
    } finally {await runner.close();await removeProofAccount(seeded.accountId);}
  });

  it("keeps sending successful when diagnostic admission fails and never logs a false binding",async()=>{
    const seeded=await seedSession(),provider=new ScriptedConversationProvider();
    const original=pool!.query.bind(pool!);
    const query=vi.spyOn(pool!,"query").mockImplementation(((...args: unknown[])=>{
      if(typeof args[0]==="string" && args[0].includes("INSERT INTO product_runs")) return Promise.reject(new Error("synthetic monitor failure"));
      return (original as (...args:unknown[])=>unknown)(...args);
    }) as never);
    const logger={info:vi.fn(),warn:vi.fn(),error:vi.fn()};
    const runner=new ConversationQueueRunner({pool:pool!,provider,logger,pollIntervalMs:10,heartbeatMs:40,recoveryIntervalMs:10_000});
    runner.start();
    try {
      await admitConversationQueueEntry(pool!,seeded.auth,{idempotency_key:randomUUID(),session_id:seeded.sessionId,message_id:randomUUID(),objective:"diagnostic outage"});
      await waitFor(async ()=>(await entryRow(seeded.sessionId,seeded.accountId))[0]?.status==="completed");
      await runner.close();
      expect((await getAgentSession(pool!,seeded.auth,seeded.sessionId)).payload?.turns).toHaveLength(1);
      expect(logger.info.mock.calls.some(call=>call[1]==="conversation reply linked to monitoring")).toBe(false);
      expect(logger.warn.mock.calls.some(call=>call[0].failure_code==="MONITORING_BINDING_UNAVAILABLE")).toBe(true);
    } finally {query.mockRestore();await runner.close();await removeProofAccount(seeded.accountId);}
  });
});

/**
 * GET-128 steering: a steering-capable agent provider consumes the run's
 * steering feed with the same delivery contract as the primary harness checkpoints — batches
 * are pulled only after the test opens the drain (its tool-safe point), the
 * feed durably closes intake before the single final answer, and the answer
 * folds exactly the delivered messages.
 */
class SteeringConversationProvider extends ScriptedConversationProvider {
  readonly inputCapabilities = { text: true, image: true, imageUnderstanding: true, steering: true };
  private nextDrain = 0;
  private nextFinish = 0;
  readonly batches: HarnessSteeringBatch[] = [];
  drainSignals: Array<{ promise: Promise<void>; release: () => void }> = [];
  finishSignals: Array<{ promise: Promise<void>; release: () => void }> = [];
  failWith: Error | null = null;
  acknowledge = true;
  toolReceipts: Array<{ name: string; completed_at: string }> = [];

  async run(
    request: AgentProviderRequest,
    _invokeTool: unknown,
    _signal: AbortSignal,
  ): Promise<AgentProviderResult> {
    this.calls.push(request.objective);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      const drain = this.drainSignals[this.nextDrain++];
      if (drain) await drain.promise;
      for (;;) {
        const batch = await request.steering?.nextBatchAtSafePoint({ final: true });
        if (!batch) break;
        if (this.acknowledge) await batch.acknowledge?.();
        this.batches.push(batch);
        if (!this.acknowledge) break;
      }
      const finish = this.finishSignals[this.nextFinish++];
      if (finish) await finish.promise;
      if (this.failWith) {
        const failure = this.failWith;
        this.failWith = null;
        throw failure;
      }
      const body = [request.objective, ...this.batches.flatMap((batch) => batch.messages.map((message) => message.text))]
        .join(" | ");
      return {
        structuredOutput: { outcome: "reply", title: "回复", body },
        inputTokens: 1,
        outputTokens: 1,
        estimatedUsd: 0,
        turns: 1 + this.batches.length,
        permissionDenials: [],
        toolCompletions: [{ name: "steering_probe", completedAt: new Date().toISOString() }],
      };
    } finally {
      this.active -= 1;
    }
  }
}

suite("durable conversation queue steering", () => {
  it("folds messages accepted while a task runs into that task's one combined final answer, preserving every original identity", async () => {
    const seeded = await seedSession();
    const provider = new SteeringConversationProvider();
    provider.drainSignals.push(gate());
    const runner = await startRunner(provider);
    try {
      const taskMessageId = randomUUID();
      const steerOneId = randomUUID();
      const steerTwoId = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId, message_id: taskMessageId, objective: "主任务",
      });
      await waitFor(() => provider.calls.length === 1);
      // User input stays usable while the task runs: both messages steer THAT
      // task instead of queueing as unrelated future work.
      const one = await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId, message_id: steerOneId, objective: "补充一",
      });
      const two = await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId, message_id: steerTwoId, objective: "补充二",
      });
      const runId = (await entryRow(seeded.sessionId, seeded.accountId))[0]!.run_id!;
      expect(one.response.steers_run_id).toBe(runId);
      expect(two.response.steers_run_id).toBe(runId);
      const midRun = await readConversationQueueSnapshot(pool!, seeded.auth, seeded.sessionId);
      expect(midRun.queued.map((entry) => entry.message_id)).toEqual([steerOneId, steerTwoId]);
      expect(midRun.queued.every((entry) => entry.steers_run_id === runId)).toBe(true);
      // A holds until the steering messages are accepted, then the run
      // processes the latest batch before its one standalone final answer.
      provider.drainSignals[0]!.release();
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId)).every((row) => row.status === "completed"));
      // Not acceptable: A completing and then running B, C separately.
      expect(provider.calls).toEqual(["主任务"]);
      expect(provider.batches.flatMap((batch) => batch.messages.map((message) => message.messageID)))
        .toEqual([steerOneId, steerTwoId]);
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload?.turns).toHaveLength(1);
      const turn = session.payload!.turns[0]!;
      expect(turn.id).toBe(taskMessageId);
      expect(turn.objective).toBe("主任务");
      expect(turn.steeredMessages?.map((message) => ({ id: message.id, objective: message.objective }))).toEqual([
        { id: steerOneId, objective: "补充一" },
        { id: steerTwoId, objective: "补充二" },
      ]);
      expect(Date.parse(turn.steeredMessages![0]!.createdAt)).toBeLessThanOrEqual(Date.parse(turn.steeredMessages![1]!.createdAt));
      // Exactly one combined response follows the folded human messages.
      expect(turn.response.unboundConversationBlocks?.[0]?.body).toContain("补充二");
      // Authentic execution readback: canonical run bounds and genuine tool
      // completions (name/time only), never arguments or results.
      expect(turn.response.execution?.started_at).toBeTruthy();
      expect(turn.response.execution?.completed_at).toBeTruthy();
      expect(turn.response.execution?.tools).toHaveLength(1);
      expect(turn.response.execution?.tools[0]!.name).toBe("steering_probe");
      expect(JSON.stringify(turn.response.execution)).not.toContain("arguments");
      const history = await readAgentSessionConversation(pool!, seeded.auth, seeded.sessionId,
        { personId: null, relationshipContextId: null });
      expect(history.messages.filter(message => message.role === "user").map(message => message.message_id))
        .toEqual([taskMessageId, steerOneId, steerTwoId]);
      expect(history.messages.at(-1)?.role).toBe("assistant");
      const authority = await resolveSessionSourceAuthority(pool!, seeded.auth, seeded.sessionId, steerTwoId);
      expect(authority.text).toBe("补充二");
      expect(authority.messageId).toBe(steerTwoId);
      expect(authority.sourceTaskId).toBe(turn.response.taskID);
      // Legacy clients omit the server-owned fold/receipt. Round-trip restores
      // both; a later forged fragment, timestamp or receipt cannot replace them.
      const legacy = structuredClone(session.payload!);
      delete legacy.turns[0]!.steeredMessages;
      delete legacy.turns[0]!.response.execution;
      const restored = await mutateAgentSession(pool!, seeded.auth, seeded.sessionId, {
        expected_revision: session.revision, idempotency_key: randomUUID(), payload: legacy,
      });
      expect(restored.payload!.turns[0]!.steeredMessages).toEqual(turn.steeredMessages);
      expect(restored.payload!.turns[0]!.response.execution).toEqual(turn.response.execution);
      const forkPayload = { ...structuredClone(restored.payload!), id: randomUUID(),
        originSessionID: seeded.sessionId, originTurnID: taskMessageId, originKind: "local" as const };
      // An owned fork inherits the exact canonical provenance, not client proof.
      const fork = await mutateAgentSession(pool!, seeded.auth, forkPayload.id, {
        expected_revision: 0, idempotency_key: randomUUID(), payload: forkPayload,
      });
      expect(fork.payload!.turns[0]!.steeredMessages).toEqual(turn.steeredMessages);
      const counterfeit: AgentSessionPayload = { ...structuredClone(forkPayload), id: randomUUID() };
      delete counterfeit.originSessionID; delete counterfeit.originTurnID; delete counterfeit.originKind;
      await expect(mutateAgentSession(pool!, seeded.auth, counterfeit.id, {
        expected_revision: 0, idempotency_key: randomUUID(), payload: counterfeit,
      })).rejects.toMatchObject({ code: "AGENT_SESSION_EXECUTION_PROVENANCE_CHANGED" });
      for (const change of ["fragment", "receipt", "identity", "answer"] as const) {
        const forged = structuredClone(restored.payload!);
        if (change === "fragment") forged.turns[0]!.steeredMessages![0]!.objective = "forged supplement";
        if (change === "receipt") forged.turns[0]!.response.execution!.tools[0]!.name = "forged_tool";
        if (change === "identity") forged.turns[0]!.objective = "rewritten task";
        if (change === "answer") forged.turns[0]!.response.unboundConversationBlocks![0]!.body = "forged answer";
        await expect(mutateAgentSession(pool!, seeded.auth, seeded.sessionId, {
          expected_revision: restored.revision, idempotency_key: randomUUID(), payload: forged,
        })).rejects.toMatchObject({ code: "AGENT_SESSION_EXECUTION_PROVENANCE_CHANGED" });
      }
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("reserves an active admitted message against a public placeholder Session save", async () => {
    const seeded = await seedSession();
    try {
      const messageID = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, { session_id: seeded.sessionId,
        message_id: messageID, idempotency_key: randomUUID(), objective: "canonical intent" });
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      const payload = { ...structuredClone(session.payload!), isUnread: false };
      payload.turns.push({ id: messageID, objective: "placeholder", createdAt: new Date().toISOString(),
        response: { contractVersion: CONTRACT_VERSION, taskID: randomUUID(), contextManifestID: "", knowledgeSnapshotID: "",
          disposition: "answer", createdAt: new Date().toISOString(), unboundConversationBlocks: [] } });
      await expect(mutateAgentSession(pool!, seeded.auth, seeded.sessionId, { expected_revision: session.revision,
        idempotency_key: randomUUID(), payload })).rejects.toMatchObject({ code: "AGENT_SESSION_QUEUE_MESSAGE_RESERVED" });
      expect((await getAgentSession(pool!, seeded.auth, seeded.sessionId)).payload!.turns).toHaveLength(0);
    } finally { await removeProofAccount(seeded.accountId); }
  });

  it("preserves a staged but unacknowledged fragment as queued work after Stop", async () => {
    const seeded = await seedSession();
    const provider = new SteeringConversationProvider();
    provider.acknowledge = false;
    provider.drainSignals.push(gate()); provider.finishSignals.push(gate());
    const runner = await startRunner(provider);
    try {
      const rootID = randomUUID(), updateID = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, { session_id: seeded.sessionId,
        message_id: rootID, idempotency_key: randomUUID(), objective: "root" });
      await waitFor(() => provider.calls.length === 1);
      await admitConversationQueueEntry(pool!, seeded.auth, { session_id: seeded.sessionId,
        message_id: updateID, idempotency_key: randomUUID(), objective: "unconsumed" });
      provider.drainSignals[0]!.release(); await waitFor(() => provider.batches.length === 1);
      await commitUnpublishedStop(seeded.sessionId, seeded.accountId); provider.finishSignals[0]!.release();
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId))[0]?.status === "cancelled");
      const entries = await entryRow(seeded.sessionId, seeded.accountId);
      expect(entries[1]).toMatchObject({ status: "queued", objective: "unconsumed", content_state: "retained" });
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload!.turns[0]!.steeredMessages).toBeUndefined();
      expect((await queueState(seeded.sessionId, seeded.accountId))?.paused).toBe(true);
    } finally { provider.drainSignals[0]!.release(); provider.finishSignals[0]!.release(); await runner.close(); await removeProofAccount(seeded.accountId); }
  });

  it("keeps a message accepted after the run's final intake closure as the next task with its own turn", async () => {
    const seeded = await seedSession();
    const provider = new SteeringConversationProvider();
    provider.drainSignals.push(gate());
    const runner = await startRunner(provider);
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId, message_id: randomUUID(), objective: "主任务",
      });
      await waitFor(() => provider.calls.length === 1);
      // The run drains and durably closes steering intake before its final.
      provider.drainSignals[0]!.release();
      await waitFor(async () =>
        (await pool!.query<{ steer_closed_at: Date | null }>(
          "SELECT steer_closed_at FROM conversation_queue_entries WHERE account_id=$1 AND session_id=$2 AND status='running'",
          [seeded.accountId, seeded.sessionId],
        )).rows[0]?.steer_closed_at != null,
      );
      const late = await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId, message_id: randomUUID(), objective: "迟到消息",
      });
      expect(late.response.steers_run_id).toBeUndefined();
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId)).every((row) => row.status === "completed"));
      // Late input after the final runs as the next task with its own turn.
      expect(provider.calls).toEqual(["主任务", "迟到消息"]);
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload?.turns.map((turn) => turn.objective)).toEqual(["主任务", "迟到消息"]);
      expect(session.payload?.turns[0]?.steeredMessages).toBeUndefined();
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("keeps delivered steering messages and the truthful stopped marker when the task is stopped", async () => {
    const seeded = await seedSession();
    const provider = new SteeringConversationProvider();
    provider.drainSignals.push(gate());
    provider.finishSignals.push(gate());
    const runner = await startRunner(provider);
    try {
      const taskMessageId = randomUUID();
      const steerId = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId, message_id: taskMessageId, objective: "主任务",
      });
      await waitFor(() => provider.calls.length === 1);
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId, message_id: steerId, objective: "补充消息",
      });
      provider.drainSignals[0]!.release();
      await waitFor(() => provider.batches.length === 1);
      // The stop is durably committed while the run still holds its final
      // answer; Escape must preserve the completed steering work.
      await commitUnpublishedStop(seeded.sessionId, seeded.accountId);
      provider.finishSignals[0]!.release();
      await waitFor(async () =>
        (await entryRow(seeded.sessionId, seeded.accountId)).some((row) => row.status === "cancelled"),
      );
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload?.turns).toHaveLength(1);
      const turn = session.payload!.turns[0]!;
      expect(turn.id).toBe(taskMessageId);
      // Completed work is preserved: the delivered human message keeps its
      // identity and the stopped marker is never a fabricated answer.
      expect(turn.steeredMessages?.map((message) => message.id)).toEqual([steerId]);
      expect(turn.response.unboundConversationBlocks?.[0]?.title).toContain("已停止");
      expect(turn.response.unboundConversationBlocks?.[0]?.status).toBe("failed");
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("keeps the steering group together on failure and re-delivers it on one explicit retry", async () => {
    const seeded = await seedSession();
    const provider = new SteeringConversationProvider();
    provider.drainSignals.push(gate(), gate());
    provider.failWith = new Error("synthetic model failure");
    const runner = await startRunner(provider);
    try {
      const taskMessageId = randomUUID();
      const steerId = randomUUID();
      const task = await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId, message_id: taskMessageId, objective: "主任务",
      });
      await waitFor(() => provider.calls.length === 1);
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId, message_id: steerId, objective: "补充消息",
      });
      provider.drainSignals[0]!.release();
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId)).every((row) => row.status === "failed"));
      // The whole group shares the failure; nothing was processed twice or lost.
      const failed = await entryRow(seeded.sessionId, seeded.accountId);
      expect(failed.map((row) => row.status)).toEqual(["failed", "failed"]);
      expect(failed[1]!.objective).toBe("补充消息");
      // One explicit retry on the steering message re-queues the whole group.
      const rows = await pool!.query<{ id: string; steer_group_entry_id: string | null }>(
        "SELECT id,steer_group_entry_id FROM conversation_queue_entries WHERE account_id=$1 AND session_id=$2 ORDER BY sequence",
        [seeded.accountId, seeded.sessionId],
      );
      const memberRow = rows.rows.find((row) => row.steer_group_entry_id)!;
      const retry = await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "retry",
        queue_entry_id: memberRow.id,
        expected_revision: (await queueState(seeded.sessionId, seeded.accountId))!.revision,
        idempotency_key: randomUUID(),
      });
      expect(retry.applied.kind).toBe("retry");
      await mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "continue",
        expected_revision: retry.snapshot.revision,
        idempotency_key: randomUUID(),
      });
      await waitFor(() => provider.calls.length === 2, 20_000);
      provider.drainSignals[1]!.release();
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId)).every((row) => row.status === "completed"), 20_000);
      // The retried run re-delivers the steering message and folds it again.
      const deliveredAgain = provider.batches.flatMap((batch) => batch.messages.map((message) => message.messageID));
      expect(deliveredAgain.filter((id) => id === steerId)).toHaveLength(2);
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload?.turns).toHaveLength(1);
      expect(session.payload?.turns[0]?.steeredMessages?.map((message) => message.id)).toEqual([steerId]);
      expect(task.response.status).toBe("queued");
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });

  it("never rewrites or deletes a steering message that already steered the run", async () => {
    const seeded = await seedSession();
    const provider = new SteeringConversationProvider();
    provider.drainSignals.push(gate());
    provider.finishSignals.push(gate());
    const runner = await startRunner(provider);
    try {
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId, message_id: randomUUID(), objective: "主任务",
      });
      await waitFor(() => provider.calls.length === 1);
      await admitConversationQueueEntry(pool!, seeded.auth, {
        idempotency_key: randomUUID(), session_id: seeded.sessionId, message_id: randomUUID(), objective: "补充消息",
      });
      provider.drainSignals[0]!.release();
      await waitFor(() => provider.batches.length === 1);
      const rows = await pool!.query<{ id: string; steer_group_entry_id: string | null }>(
        "SELECT id,steer_group_entry_id FROM conversation_queue_entries WHERE account_id=$1 AND session_id=$2 ORDER BY sequence",
        [seeded.accountId, seeded.sessionId],
      );
      const memberRow = rows.rows.find((row) => row.steer_group_entry_id)!;
      const state = await queueState(seeded.sessionId, seeded.accountId);
      await expect(mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "edit",
        queue_entry_id: memberRow.id,
        expected_revision: state!.revision,
        idempotency_key: randomUUID(),
        objective: "改写后的文字",
      })).rejects.toMatchObject({ code: "CONVERSATION_QUEUE_ENTRY_STEERED" });
      await expect(mutateConversationQueueEntry(pool!, seeded.auth, seeded.sessionId, {
        kind: "withdraw",
        queue_entry_id: memberRow.id,
        expected_revision: state!.revision,
        idempotency_key: randomUUID(),
      })).rejects.toMatchObject({ code: "CONVERSATION_QUEUE_ENTRY_STEERED" });
      // The delivered message keeps its exact accepted text for the fold.
      provider.finishSignals[0]!.release();
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId)).every((row) => row.status === "completed"));
      const session = await getAgentSession(pool!, seeded.auth, seeded.sessionId);
      expect(session.payload?.turns[0]?.steeredMessages?.[0]?.objective).toBe("补充消息");
    } finally {
      await runner.close();
      await removeProofAccount(seeded.accountId);
    }
  });
});


suite("provider-selection steering boundary", () => {
  it.each([true, false])("preserves input admitted during selection (capable=%s)", async (capable) => {
    const seeded = await seedSession();
    const selected = gate();
    const drain = gate();
    const provider = capable ? new SteeringConversationProvider() : new ScriptedConversationProvider();
    if (provider instanceof SteeringConversationProvider) provider.drainSignals.push(drain);
    let selecting = false;
    const runner = new ConversationQueueRunner({ pool: pool!, provider: null, logger: silentLogger,
      workerId: `selection-${randomUUID()}`, pollIntervalMs: 10, heartbeatMs: 40,
      selectProvider: async () => { selecting = true; await selected.promise; return { provider }; },
    });
    runner.start();
    try {
      const rootID = randomUUID(); const memberID = randomUUID();
      await admitConversationQueueEntry(pool!, seeded.auth, { idempotency_key: randomUUID(), session_id: seeded.sessionId, message_id: rootID, objective: "Original task" });
      await waitFor(() => selecting);
      const admitted = await admitConversationQueueEntry(pool!, seeded.auth, { idempotency_key: randomUUID(), session_id: seeded.sessionId, message_id: memberID, objective: "Fragment during selection" });
      expect(admitted.response.steers_run_id).toBeTruthy();
      selected.release(); drain.release();
      await waitFor(async () => (await entryRow(seeded.sessionId, seeded.accountId)).every(row => row.status === "completed"));
      const saved = (await getAgentSession(pool!, seeded.auth, seeded.sessionId)).payload!;
      if (capable) {
        expect(saved.turns).toHaveLength(1);
        expect(saved.turns[0]!.steeredMessages?.[0]?.id).toBe(memberID);
      } else {
        expect(saved.turns).toHaveLength(2);
        expect(saved.turns.map(turn => turn.id)).toEqual([rootID, memberID]);
        expect(saved.turns[0]!.steeredMessages).toBeUndefined();
      }
    } finally { selected.release(); drain.release(); await runner.close(); await removeProofAccount(seeded.accountId); }
  });
});
