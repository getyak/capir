import type { Pool, PoolClient } from "pg";
import type { UnscopedChatTaskRequest, UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { ApiError } from "../lib/apiError.js";
import { completeIdempotency } from "../lib/idempotency.js";
import type { AuthContext } from "./auth.js";
import { LegacyChatTerminated, type LegacyChatAuthority } from "./legacyChatAuthority.js";
import { lockLegacyChatSessionSource, restoreLegacyChatSourceGuard, validateLegacyChatSourceSnapshot,
  type LegacyChatSourceGuard } from "./legacyChatSourceSnapshot.js";
import { createLegacyChatDatabase, LegacyChatCommitUnknown } from "./legacyChatDatabase.js";
import { runLegacyChatAnswerWindow } from "./legacyChatOwner.js";
import { decodeLegacyChatCheckpoint, encodeLegacyChatCheckpoint, LegacyChatCheckpointError } from "./legacyChatCheckpoint.js";
import { completeLegacyChatExecution, freezeLegacyChatAnswerProvider, legacyChatCheckpointBinding, lockLegacyChatExecution,
  markLegacyChatDispatch, readLegacyChatExecution, renewLegacyChatLease, storeLegacyChatCheckpoint,
  type LegacyChatAdmission, type LegacyChatExecutionRow, type LegacyChatOwnerToken, type LegacyChatWaiter } from "./legacyChatExecutions.js";
import { retireLegacyChatOwnerAfterFailure } from "./legacyChatRetirement.js";
import { appendUnscopedChatCompletionAudit, recordUnscopedChatCompletionSources } from "./unscopedChatCompletion.js";
import { assertSessionChatSourcesAvailable } from "./agentSessionSources.js";
import type { executeUnscopedChatTask, UnscopedChatTaskMutationResult } from "./unscopedChat.js";

const unavailable = () => new ApiError(409, "LEGACY_CHAT_EXECUTION_UNAVAILABLE",
  "This attempt cannot start another model call. Check its current status before starting a new request.");

type OwnerDatabase = ReturnType<typeof createLegacyChatDatabase>;

async function advance<T>(database: OwnerDatabase, authority: LegacyChatAuthority, auth: AuthContext,
  token: LegacyChatOwnerToken, sourceSnapshot: unknown,
  source: LegacyChatSourceGuard,
  operation: (client: PoolClient, row: LegacyChatExecutionRow) => Promise<T>): Promise<T> {
  const result = await database.run(async client => {
    await authority.lockAccountsForFinalization(client);
    await lockLegacyChatSessionSource(client,auth,sourceSnapshot);
    // The observed ORIGINAL source snapshot is checked before the reader locks
    // and again after the last awaited write, on this same passed client.
    await authority.assertFinalCurrent(client);
    await authority.lockReadersForFinalization(client);
    const row = await lockLegacyChatExecution(client, auth, token);
    const result = await operation(client, row);
    await authority.assertFinalCurrent(client);
    source.assertLive();
    return result;
  },true,() => source.assertLive());
  // COMMIT can itself finish after the source's shorter original deadline.
  // Do not describe an acknowledged commit as rollback or deliver late bytes;
  // lawful completed facts retain their separate current-reader replay policy.
  source.assertLive();
  return result;
}

export async function finalizeLegacyChatCheckpoint(input: {
  database: OwnerDatabase; authority: LegacyChatAuthority; auth: AuthContext; token: LegacyChatOwnerToken;
  sourceSnapshot: unknown;
  source: LegacyChatSourceGuard;
}): Promise<UnscopedChatTaskMutationResult> {
  return advance(input.database,input.authority,input.auth,input.token,input.sourceSnapshot,input.source,async (client,row) => {
    if (row.state !== "result_ready" || row.checkpoint === null || row.checkpoint_bytes === null
      || row.checkpoint_sha256 === null) throw unavailable();
    const decoded = decodeLegacyChatCheckpoint({ json: row.checkpoint, byteLength: row.checkpoint_bytes,
      sha256: row.checkpoint_sha256 }, legacyChatCheckpointBinding(row));
    const completion = decoded.completion;
    const source = validateLegacyChatSourceSnapshot(row.source_snapshot);
    const sessionID = source.version === 2 ? source.sessionID : undefined;
    await appendUnscopedChatCompletionAudit(client,input.auth,{
      taskID: row.task_id, sessionID: sessionID ?? null, messageID: row.request_message_id,
      conversationMessageIDs: [], disposition: decoded.body.disposition,
      remoteStatus: completion.remoteStatus,providerID: completion.provider?.providerID ?? null,
      model: completion.provider?.model ?? null,providerRequestID: completion.provider?.providerRequestID ?? null,
      eventKind: null,prompt: completion.provider?.prompt ?? null,
    });
    await recordUnscopedChatCompletionSources(client,input.auth,{ sessionID,taskID: row.task_id,
      messageID: row.request_message_id ?? undefined,blocks: structuredClone(decoded.body.blocks) as UnscopedChatTaskResponse["blocks"],
      conversationSources: [],previousTaskIDs: [] });
    await completeIdempotency(client,{ id: row.idempotency_id,replay: null },201,decoded.body);
    await completeLegacyChatExecution(client,input.token);
    // A fresh copy retains exact values without lending the frozen private DTO.
    return { body: structuredClone(decoded.body) as UnscopedChatTaskResponse, status: 201,replayed: false,
      labProductOutcome: completion.remoteStatus === "completed" ? "accepted" : "fallback" };
  });
}

/** Current reader, canonical key and lawful completion policy own replay.
 * Never require an old execution credential after lawful publication. */
export async function readLegacyChatPublication(input: {
  database: OwnerDatabase; authority: LegacyChatAuthority; auth: AuthContext; parentID: string;
}): Promise<{ state: string; taskID: string; completed?: UnscopedChatTaskMutationResult } | null> {
  const result = await input.database.run(async client => {
    await input.authority.lockAccountsForFinalization(client);
    await input.authority.lockReadersForFinalization(client);
    const row = (await client.query<{ state: string; task_id: string; response_status: number | null;
      response_body: UnscopedChatTaskResponse | null; parent_status: string }>(`
      SELECT e.state,e.task_id,p.response_status,p.response_body,p.status AS parent_status
      FROM idempotency_records p JOIN legacy_chat_executions e
        ON e.account_id=p.account_id AND e.idempotency_id=p.id
      WHERE p.account_id=$1 AND p.id=$2 AND p.actor_user_id=$3
        AND p.operation_scope='create_unscoped_chat_task' FOR SHARE OF p,e NOWAIT`,
    [input.auth.accountId,input.parentID,input.auth.userId])).rows[0];
    if (!row) return null;
    let completed: UnscopedChatTaskMutationResult | undefined;
    if (row.state === "completed") {
      const body = row.response_body;
      if (row.parent_status !== "completed" || row.response_status !== 201 || !body || body.task_id !== row.task_id
        || !Array.isArray(body.external_effects) || body.external_effects.length !== 0) throw unavailable();
      await assertSessionChatSourcesAvailable(client,input.auth,row.task_id);
      completed = { body,status: 201,replayed: true };
    }
    await input.authority.assertFinalCurrent(client);
    return { state: row.state,taskID: row.task_id,...(completed ? { completed } : {}) };
  });
  input.authority.throwIfTerminated();
  return result;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve,reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort",abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort",abort); resolve(); },ms);
    signal.addEventListener("abort",abort,{ once: true });
    if (signal.aborted) abort();
  });
}

export async function waitLegacyChatExecution(input: {
  pool: Pool; auth: AuthContext; authority: LegacyChatAuthority; waiter: LegacyChatWaiter; signal?: AbortSignal;
}): Promise<UnscopedChatTaskMutationResult> {
  const database = createLegacyChatDatabase(input.pool,input.authority);
  const signal = input.signal ? AbortSignal.any([input.signal,input.authority.signal]) : input.authority.signal;
  const until = performance.now()+60_000;
  for (;;) {
    signal.throwIfAborted();
    const state = await readLegacyChatPublication({ database,authority: input.authority,auth: input.auth,parentID: input.waiter.parentID });
    if (state?.completed) return state.completed;
    if (!state || !["admitted","dispatch_started","result_ready"].includes(state.state) || performance.now()>=until) throw unavailable();
    await pause(200,signal); // No PoolClient or row lock survives this wait.
  }
}

export async function runLegacyChatExecution(input: {
  pool: Pool; auth: AuthContext; request: UnscopedChatTaskRequest; authority: LegacyChatAuthority;
  admission: LegacyChatAdmission; execute: typeof executeUnscopedChatTask; referenceTime?: Date; signal?: AbortSignal;
}): Promise<UnscopedChatTaskMutationResult> {
  const { authority,auth,admission } = input, database = createLegacyChatDatabase(input.pool,authority);
  const source = restoreLegacyChatSourceGuard(database.database,auth,admission.row.source_snapshot,database.database,admission.token.taskID);
  authority.observeSource(source);
  let stage: "admitted" | "dispatch" | "answer" | "checkpoint" | "final" = "admitted";
  let disconnected = input.signal?.aborted === true;
  const abort = () => { disconnected = true; authority.dispose(); };
  input.signal?.addEventListener("abort",abort,{ once: true });
  const remaining = Date.parse(admission.row.execution_deadline_exact)-Date.now();
  const timer = setTimeout(() => authority.dispose(),Math.max(0,remaining)); timer.unref?.();
  try {
    if (input.signal?.aborted || remaining<=0) { if (input.signal?.aborted) abort(); throw new LegacyChatTerminated(); }
    if (admission.provider) {
      stage = "dispatch";
      await advance(database,authority,auth,admission.token,admission.row.source_snapshot,source,async (client,row) => {
        if (row.state !== "admitted") throw unavailable();
        await markLegacyChatDispatch(client,admission.token);
      });
    } else if (validateLegacyChatSourceSnapshot(admission.row.source_snapshot).version === 2) {
      // Disabled execution has no provider precheck to initialize its original
      // monotonic source bound. It still reads the real source before forming
      // its local reply; it never invents a dispatch or a model descriptor.
      await authority.source(source);
    }
    stage = "answer";
    const frozen = admission.provider;
    const provider = frozen ? freezeLegacyChatAnswerProvider(frozen.model,
      request => runLegacyChatAnswerWindow({
        answer: () => frozen.answer(request),signal: authority.signal,
        poll: async () => {
          try { await advance(database,authority,auth,admission.token,admission.row.source_snapshot,source,async (client,row) => {
            if (row.state !== "dispatch_started") throw unavailable();
            await renewLegacyChatLease(client,admission.token);
          }); } catch { authority.dispose(); throw authority.signal.reason; }
        },
      })) : null;
    const execution = await input.execute({ request: input.request,taskID: admission.token.taskID,provider,
      database: database.database,auth,legacyAuthority: authority,legacySourceCurrent: source,
      signal: authority.signal,...(input.referenceTime ? { referenceTime: input.referenceTime } : {}) });
    authority.throwIfTerminated();
    source.assertLive();
    const binding = legacyChatCheckpointBinding(admission.row);
    const packet = encodeLegacyChatCheckpoint(execution,binding);
    stage = "checkpoint";
    try {
      await advance(database,authority,auth,admission.token,admission.row.source_snapshot,source,async client => storeLegacyChatCheckpoint(client,admission.token,packet));
    } catch (error) {
      if (!(error instanceof LegacyChatCommitUnknown)) throw error;
      const row = await database.run(client => readLegacyChatExecution(client,auth,admission.token.parentID),false);
      if (!row || row.state !== "result_ready" || row.attempt_id !== admission.token.attemptID
        || row.owner_instance !== admission.token.instance || row.owner_generation !== admission.token.generation
        || row.owner_nonce !== admission.token.nonce || row.checkpoint !== packet.json
        || row.checkpoint_bytes !== packet.byteLength || row.checkpoint_sha256 !== packet.sha256) throw error;
      decodeLegacyChatCheckpoint(packet,binding); // Resolve only the exact durable same-attempt bytes.
    }
    stage = "final";
    try {
      const completed = await finalizeLegacyChatCheckpoint({ database,authority,auth,token: admission.token,sourceSnapshot: admission.row.source_snapshot,source });
      source.assertLive();
      return completed;
    }
    catch (error) {
      if (!(error instanceof LegacyChatCommitUnknown)) throw error;
      const state = await readLegacyChatPublication({ database,authority,auth,parentID: admission.token.parentID });
      if (state?.completed) { source.assertLive(); return state.completed; }
      throw error;
    }
  } catch (error) {
    const invalid = error instanceof LegacyChatCheckpointError;
    const unknown = error instanceof LegacyChatCommitUnknown;
    const state = invalid ? "result_unavailable" : disconnected ? "cancelled" : unknown ? "unknown" : "authority_lost";
    const reason = invalid ? "checkpoint_invalid" : disconnected ? "client_disconnected" : unknown ? "commit_unknown" : "credential_lost";
    // Failure cleanup reduces authority and keeps the immutable key. If a lock
    // conflict/closed Lab defers it, bounded maintenance or canonical Lab cleanup
    // owns the still-durable attempt; a failure never opens a new provider call.
    await retireLegacyChatOwnerAfterFailure(input.pool,auth,admission.token,
      stage === "admitted" && unknown ? "expired" : state,reason).catch(() => undefined);
    if (error instanceof LegacyChatTerminated) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort",abort);
  }
}
