import { beginQueueRunMonitoring, completeQueueRunMonitoring, queueRunCorrelation } from "./conversationQueueMonitoring.js";
import { conversationRunDiagnostics } from "./conversationRunDiagnostics.js";
import { randomUUID } from "node:crypto";

import { createVisibleTextFilter, type AgentVisibleProgressStage } from "@talent-signal/agent";
import type { ConversationImageManifest } from "@talent-signal/contracts";
import type { Pool } from "pg";

import type { AuthContext } from "./auth.js";
import type { RemoteChatAnswerProviding } from "./chatAnswerProvider.js";
import { readConversationMessageImageManifests, readConversationRunImages } from "./conversationMessageImages.js";
import {
  createConversationQueueSteeringFeed,
  createConversationQueueSteeringSource,
} from "./conversationQueueSteering.js";
import { executeUnscopedChatTask } from "./unscopedChat.js";
import { isWorkspaceConversationAgentProvider } from "./workspaceConversationAgent.js";
import {
  CONVERSATION_QUEUE_MAX_CONCURRENT_RUNS,
  ConversationQueueLeaseLostError,
  type ClaimedConversationQueueEntry,
  type ConversationQueueRunFence,
  assertConversationQueueContextCurrent,
  assertConversationQueueOwnedClaim,
  claimNextConversationQueueEntry,
  openConversationQueueSteeringIntake,
  finalizeConversationQueueEntry,
  listRunnableConversationQueueSessions,
  listStaleRunningConversationQueueEntries,
  markConversationQueuePersistencePending,
  readConversationQueueResult,
  reclaimStaleConversationQueueEntry,
  recordConversationQueueResult,
  refreshConversationQueueLease,
  runnerAuthContext,
} from "./conversationQueueState.js";
import {
  persistConversationQueueCancellation,
  persistConversationQueueCompletion,
  type ConversationQueueExecutionResult,
} from "./conversationQueueCompletion.js";
import {
  clearConversationQueuePreview,
  publishConversationQueueChanged,
  publishConversationQueuePreview,
  subscribeConversationQueueLive,
} from "./conversationQueueLive.js";

const PREVIEW_FLUSH_MS = 250;
const PREVIEW_MAX_CHARS = 12_000;
const HEARTBEAT_MS = 20_000;
const RECOVERY_INTERVAL_MS = 30_000;

export interface ConversationQueueRunnerLogger {
  info(metadata: Record<string, unknown>, message: string): void;
  warn(metadata: Record<string, unknown>, message: string): void;
  error(metadata: Record<string, unknown>, message: string): void;
}

export interface ConversationQueueProviderSelection {
  provider: RemoteChatAnswerProviding | null;
  finish?: (
    outcome: "accepted" | "fallback" | "product_failed" | "unverified",
  ) => Promise<unknown>;
}

export type ConversationQueueProviderSelector = (
  client: Pool,
  input: { auth: AuthContext; idempotencyKey: string },
) => Promise<ConversationQueueProviderSelection>;

export interface ConversationQueueRunnerOptions {
  pool: Pool;
  provider: RemoteChatAnswerProviding | null;
  logger: ConversationQueueRunnerLogger;
  workerId?: string;
  pollIntervalMs?: number;
  heartbeatMs?: number;
  recoveryIntervalMs?: number;
  selectProvider?: ConversationQueueProviderSelector;
  referenceClock?: () => Date;
}

interface ActiveRun {
  fence: ConversationQueueRunFence;
  controller: AbortController;
  promise: Promise<void>;
}

class RunAbort extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RunAbort";
  }
}

function serializedResult(
  execution: Awaited<ReturnType<typeof executeUnscopedChatTask>>,
  images: ConversationImageManifest[],
  run: { claimedAt: string },
): ConversationQueueExecutionResult {
  const toolCompletions = execution.agentProviderResult?.toolCompletions ?? [];
  return {
    body: execution.body,
    conversationMessageIDs: execution.conversationMessageIDs,
    previousTaskIDs: execution.previousTaskIDs,
    conversationSources: execution.conversationSources ?? [],
    remoteStatus: execution.remoteStatus,
    images,
    // Canonical run bounds and genuine tool completions only; the folded card
    // reads back authentic execution without arguments, results or prose.
    execution: {
      started_at: run.claimedAt,
      completed_at: new Date().toISOString(),
      tools: toolCompletions.slice(0, 16).map((completion) => ({
        name: completion.name,
        completed_at: completion.completedAt,
      })),
    },
    audit: {
      providerID:
        execution.agentProviderResult?.providerID ??
        execution.providerResult?.provider_id ??
        null,
      model:
        execution.agentProviderResult?.model ??
        execution.providerResult?.model ??
        null,
      providerRequestID:
        execution.agentProviderResult?.providerRequestID ??
        execution.providerResult?.provider_request_id ??
        null,
      prompt:
        execution.agentProviderResult?.prompt ??
        (execution.providerResult?.prompt_snapshot
          ? {
              name: execution.providerResult.prompt_snapshot.name,
              revision: execution.providerResult.prompt_snapshot.revision,
              versionId: execution.providerResult.prompt_snapshot.versionId,
              source: execution.providerResult.prompt_snapshot.source,
            }
          : null),
      contactAgentEventKind: execution.body.agent_event?.kind ?? null,
    },
  };
}

/**
 * Bounded worker that owns conversation queue execution.
 *
 * One run per Session under an advisory-lock claim with a durable lease and
 * monotonic lease generation. Every authoritative write is fenced on that
 * generation, so a stale worker can never publish text, overwrite a result, or
 * commit a Session turn after another runner recovered the entry.
 */
export class ConversationQueueRunner {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly heartbeatMs: number;
  private readonly recoveryIntervalMs: number;
  private readonly active = new Map<string, ActiveRun>();
  private readonly sessionsInFlight = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private recoveryTimer: NodeJS.Timeout | null = null;
  private closing = false;
  private ticking = false;
  private jobs = new Set<Promise<void>>();
  private recoveryWork: Promise<void> | null = null;

  constructor(private readonly options: ConversationQueueRunnerOptions) {
    this.workerId = options.workerId ?? `conversation-queue-${randomUUID()}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
    this.recoveryIntervalMs = options.recoveryIntervalMs ?? RECOVERY_INTERVAL_MS;
  }

  start(): void {
    this.unsubscribe = subscribeConversationQueueLive((event) => {
      if (event.type === "stop") {
        const run = this.active.get(event.runId);
        if (run) run.controller.abort(new RunAbort("USER_CANCELLED"));
        else this.schedule(0);
        return;
      }
      this.schedule(50);
    });
    this.recoveryTimer = setInterval(() => {
      if (this.recoveryWork || this.closing) return;
      this.recoveryWork = this.recover().catch((error) => {
        this.options.logger.error({ err: error }, "conversation queue recovery failed");
      }).finally(() => { this.recoveryWork = null; });
    }, this.recoveryIntervalMs);
    this.recoveryTimer.unref?.();
    this.schedule(0);
  }

  async close(): Promise<void> {
    this.closing = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
    // Shutdown is not user cancellation: runs yield a truthful interrupted
    // state instead of a "stopped" partial answer.
    for (const run of this.active.values()) {
      run.controller.abort(new RunAbort("RUNNER_SHUTDOWN"));
    }
    // Include claims and owner lookups that have not reached active execution.
    await Promise.allSettled([...this.jobs, ...[...this.active.values()].map((run) => run.promise), ...(this.recoveryWork ? [this.recoveryWork] : [])]);
  }

  async recover(): Promise<void> {
    const stale = await listStaleRunningConversationQueueEntries(this.options.pool);
    for (const entry of stale) {
      if (this.closing) return;
      try {
        const reclaimed = await reclaimStaleConversationQueueEntry(this.options.pool, {
          accountId: entry.accountId,
          sessionId: entry.sessionId,
          entryId: entry.entryId,
          workerId: `${this.workerId}:recovery`,
        });
        if (!reclaimed) continue; // another worker already reclaimed it
        const auth = await runnerAuthContext(this.options.pool, {
          accountId: reclaimed.accountId,
          userId: reclaimed.createdByUserId,
          authSessionId: reclaimed.authSessionId,
        });
        const fence: ConversationQueueRunFence = {
          accountId: reclaimed.accountId,
          sessionId: reclaimed.sessionId,
          entryId: reclaimed.entryId,
          runId: reclaimed.runId,
          leaseOwner: reclaimed.leaseOwner,
          leaseGeneration: reclaimed.leaseGeneration,
        };
        if (reclaimed.hasResult) {
          const result = (await readConversationQueueResult(
            this.options.pool,
            reclaimed.accountId,
            reclaimed.entryId,
          )) as ConversationQueueExecutionResult | null;
          if (result) {
            const recovered = await this.replayPersistence(auth, reclaimed, result, fence);
            if (recovered) {
              this.options.logger.info(
                { queue_entry_id: reclaimed.entryId, code: "RESULT_REPLAY" },
                "conversation queue result was persisted without a new model call",
              );
              continue;
            }
          }
        }
        const interrupted = await finalizeConversationQueueEntry(this.options.pool, {
          fence,
          status: "interrupted",
          failureCode: "RUNNER_INTERRUPTED",
        });
        if (!interrupted.applied && interrupted.effectiveStatus === "running") {
          // Recheck the owned stop through the normal cancellation path. Keep
          // the admitted message and attachment references in Session history
          // before terminal finalization scrubs the queue's source text. This
          // reads metadata only and never replays the provider after a stop.
          const images = await readConversationMessageImageManifests(
            this.options.pool, reclaimed.accountId, [reclaimed.entryId],
          );
          await this.finalizeCancelled(auth, reclaimed, fence, "", images.get(reclaimed.entryId) ?? []);
          this.options.logger.warn(
            { queue_entry_id: reclaimed.entryId },
            "conversation queue attempted settlement of a recovered stop",
          );
          continue;
        }
        this.options.logger.warn(
          { queue_entry_id: reclaimed.entryId },
          "conversation queue recovered an interrupted run and paused its queue",
        );
      } catch (error) {
        this.options.logger.error(
          { queue_entry_id: entry.entryId, err: error },
          "conversation queue recovery could not finish an interrupted run",
        );
      }
    }
  }

  private schedule(delayMs: number): void {
    if (this.closing) return;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.closing || this.ticking) return;
    this.ticking = true;
    try {
      if (this.jobs.size >= CONVERSATION_QUEUE_MAX_CONCURRENT_RUNS) return;
      const sessions = await listRunnableConversationQueueSessions(this.options.pool);
      for (const session of sessions) {
        if (this.closing) return;
        if (this.jobs.size >= CONVERSATION_QUEUE_MAX_CONCURRENT_RUNS) return;
        const key = `${session.accountId}:${session.sessionId}`;
        if (this.sessionsInFlight.has(key)) continue;
        this.sessionsInFlight.add(key);
        const job = this.runOne(session.accountId, session.sessionId)
          .catch((error) => {
            this.options.logger.error(
              { err: error, session: key },
              "conversation queue session run failed before its terminal state",
            );
          })
          .finally(() => {
            this.jobs.delete(job);
            this.sessionsInFlight.delete(key);
            this.schedule(this.pollIntervalMs);
          });
        this.jobs.add(job);
        return;
      }
    } catch (error) {
      this.options.logger.error({ err: error }, "conversation queue poll failed");
    } finally {
      this.ticking = false;
      if (this.active.size === 0) this.schedule(this.pollIntervalMs);
    }
  }

  private async runOne(accountId: string, sessionId: string): Promise<void> {
    const claimed = await claimNextConversationQueueEntry(this.options.pool, {
      accountId,
      sessionId,
      workerId: this.workerId,
      acceptsSteering: Boolean(this.options.selectProvider) || Boolean(this.options.provider
        && isWorkspaceConversationAgentProvider(this.options.provider)
        && this.options.provider.inputCapabilities?.steering === true),
    });
    if (!claimed) return;
    const fence: ConversationQueueRunFence = {
      accountId: claimed.accountId,
      sessionId: claimed.sessionId,
      entryId: claimed.entryId,
      runId: claimed.runId,
      leaseOwner: this.workerId,
      leaseGeneration: claimed.leaseGeneration,
    };
    if (this.closing) { await this.finalizeRetained(fence, "RUNNER_SHUTDOWN"); return; }
    let auth: AuthContext;
    try { auth = await runnerAuthContext(this.options.pool, { accountId: claimed.accountId, userId: claimed.createdByUserId, authSessionId: claimed.authSessionId }); }
    catch { await this.finalizeRetained(fence, "OWNER_UNAVAILABLE"); return; }
    if (this.closing) { await this.finalizeRetained(fence, "RUNNER_SHUTDOWN", { auth, claimed, partialText: "" }); return; }
    if (claimed.hasResult) {
      const result = (await readConversationQueueResult(
        this.options.pool,
        claimed.accountId,
        claimed.entryId,
      )) as ConversationQueueExecutionResult | null;
      if (result) {
        await this.replayPersistence(auth, claimed, result, fence);
        return;
      }
    }
    await this.execute(claimed, auth, fence);
  }

  /** Persist a stored result without invoking the model again. */
  private async replayPersistence(
    auth: AuthContext,
    claimed: ClaimedConversationQueueEntry,
    result: ConversationQueueExecutionResult,
    fence: ConversationQueueRunFence,
  ): Promise<boolean> {
    try {
      await persistConversationQueueCompletion(this.options.pool, auth, {
        fence,
        sessionId: claimed.sessionId,
        messageId: claimed.messageId,
        objective: claimed.objective,
        acceptedAt: claimed.acceptedAt,
        images: result.images ?? [],
        result,
      });
      const finalized = await finalizeConversationQueueEntry(this.options.pool, {
        fence,
        status: "completed",
      });
      if (finalized.applied) {
        await completeQueueRunMonitoring(this.options.pool, claimed, result, this.options.logger);
        return true;
      }
      if (finalized.effectiveStatus === "running") {
        // A stop raced completion. Finalize the truthful cancelled state; the
        // fenced update cannot clobber another worker's claim.
        const cancelled = await finalizeConversationQueueEntry(this.options.pool, {
          fence,
          status: "cancelled",
        });
        return cancelled.applied;
      }
      if (finalized.effectiveStatus === "completed") {
        await completeQueueRunMonitoring(this.options.pool, claimed, result, this.options.logger);
        return true;
      }
      return false;
    } catch (error) {
      if (error instanceof ConversationQueueLeaseLostError) return false;
      if (
        error instanceof Error &&
        "statusCode" in error &&
        (error as { statusCode?: number }).statusCode === 410
      ) {
        // Sources or the Session were withdrawn; the result is no longer
        // admissible and must not be resurrected.
        await this.finalizeRetained(fence, "SOURCE_REVOKED", { auth, claimed, partialText: "" });
        return true;
      }
      await this.markPersistencePending(fence);
      this.options.logger.warn(
        { queue_entry_id: fence.entryId, err: error },
        "conversation queue persistence failed; the stored result will be replayed on retry",
      );
      return true;
    }
  }

  private async execute(
    claimed: ClaimedConversationQueueEntry,
    auth: AuthContext,
    fence: ConversationQueueRunFence,
  ): Promise<void> {
    const controller = new AbortController();
    const filter = createVisibleTextFilter(true);
    let previewText = "";
    const completedTools: Array<{ name: string; completed_at: string }> = [];
    let previewStage: AgentVisibleProgressStage | null = null;
    let previewSequence = 0;
    let lastFlush = 0;
    let flushTimer: NodeJS.Timeout | null = null;
    let previewClosed = false;
    let previewChecking = false;
    let previewDirty = false;
    const publishCurrentPreview = async () => {
      previewDirty = true;
      if (previewChecking || previewClosed || controller.signal.aborted) return;
      previewChecking = true;
      try {
        while (previewDirty && !previewClosed && !controller.signal.aborted) {
          previewDirty = false;
          const claim = await assertConversationQueueOwnedClaim(this.options.pool, fence, {
            allowCancelRequested: true,
          });
          if (claim.cancelRequested) {
            controller.abort(new RunAbort("USER_CANCELLED"));
            return;
          }
          await assertConversationQueueContextCurrent(this.options.pool, auth, claimed.sessionId);
          if (previewClosed || controller.signal.aborted) return;
          publishConversationQueuePreview({ accountId: claimed.accountId, sessionId: claimed.sessionId,
            runId: claimed.runId, messageId: claimed.messageId, text: previewText, completedTools: [...completedTools],
            stage: previewStage, sequence: ++previewSequence, leaseGeneration: fence.leaseGeneration });
        }
      } catch (error) {
        controller.abort(new RunAbort(error instanceof ConversationQueueLeaseLostError ? "LEASE_LOST" : "SOURCE_REVOKED"));
      } finally { previewChecking = false; }
    };
    const flush = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastFlush < PREVIEW_FLUSH_MS) {
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = null;
            flush(false);
          }, PREVIEW_FLUSH_MS);
          flushTimer.unref?.();
        }
        return;
      }
      lastFlush = now;
      if (!previewText && !previewStage && !completedTools.length) return;
      void publishCurrentPreview();
    };
    let revocationCode: string | null = null;
    let heartbeatPending = false;
    const heartbeat = setInterval(() => {
      if (heartbeatPending || controller.signal.aborted) return;
      heartbeatPending = true;
      void refreshConversationQueueLease(this.options.pool, fence)
        .then((state) => {
          if (!state) {
            controller.abort(new RunAbort("LEASE_LOST"));
            return;
          }
          if (state.cancelRequested) {
            controller.abort(new RunAbort("USER_CANCELLED"));
            return;
          }
          return assertConversationQueueContextCurrent(this.options.pool, auth, claimed.sessionId);
        })
        .catch((error) => {
          revocationCode = "SOURCE_REVOKED";
          this.options.logger.warn(
            { queue_entry_id: claimed.entryId, err: error },
            "conversation queue heartbeat could not confirm the lease or source validity",
          );
          controller.abort(new RunAbort("SOURCE_REVOKED"));
        }).finally(() => { heartbeatPending = false; });
    }, this.heartbeatMs);
    heartbeat.unref?.();
    const run: ActiveRun = { fence, controller, promise: Promise.resolve() };
    this.active.set(claimed.runId, run);
    const promise = (async () => {
      const monitor = await beginQueueRunMonitoring(this.options.pool, claimed, this.options.logger);
      return monitor.capture(async () => {
      let entryImages: Awaited<ReturnType<typeof readConversationRunImages>>["images"] = [];
      try {
        const selection = this.options.selectProvider
          ? await this.options.selectProvider(this.options.pool, {
              auth,
              idempotencyKey: `conversation-queue:${claimed.entryId}`,
            })
          : { provider: this.options.provider };
        if (!selection.provider) {
          await this.finalizeRetained(fence, "MODEL_PROVIDER_UNAVAILABLE", { auth, claimed, partialText: "" });
          return;
        }
        const runImageContext = await readConversationRunImages(
          this.options.pool,
          claimed.accountId,
          claimed.sessionId,
          claimed.entryId,
        );
        entryImages = runImageContext.images.filter(
          (image) => image.messageId === claimed.messageId,
        );
        // GET-128 steering: an agent-provider Run that actually consumes
        // steering input receives messages accepted while it works, delivered
        // at tool-safe points into THIS task. Any other provider closes intake
        // at once so later messages are honestly the next task from admission
        // time, never silently waiting for a dispatch that can never happen.
        const steeringCapable = isWorkspaceConversationAgentProvider(selection.provider)
          && selection.provider.inputCapabilities?.steering === true;
        const steeringSource = createConversationQueueSteeringSource({
          pool: this.options.pool,
          auth,
          fence,
          sessionId: claimed.sessionId,
          onLost: (reason) => controller.abort(new RunAbort(reason)),
          loadImages: async (member) => {
            const context = await readConversationRunImages(
              this.options.pool, claimed.accountId, claimed.sessionId, member.entryId,
            );
            return context.images
              .filter((image) => image.messageId === member.messageId)
              .map((image) => ({
                kind: "image" as const,
                artifactID: `conversation-image-${image.messageId}-${image.imageIndex}-${image.manifest.attachment_id}`,
                mimeType: image.manifest.media_type,
                byteSize: image.manifest.byte_size,
                contentHash: image.manifest.content_hash,
                dataBase64: Buffer.from(image.data).toString("base64"),
              }));
          },
        });
        const steering = steeringCapable
          ? createConversationQueueSteeringFeed(steeringSource, {
              signal: controller.signal,
              ...(this.options.referenceClock ? { now: this.options.referenceClock } : {}),
              usedImageCount: runImageContext.images.length,
              usedImageBytes: runImageContext.images.reduce(
                (sum, image) => sum + image.manifest.byte_size, 0,
              ),
            })
          : null;
        if (steering) await openConversationQueueSteeringIntake(this.options.pool, fence);
        else await steeringSource.closeIntake({ force: true });
        const execution = await executeUnscopedChatTask({
          taskID: claimed.runId,
          request: {
            idempotency_key: `conversation-queue:${claimed.entryId}`,
            session_id: claimed.sessionId,
            message_id: claimed.messageId,
            objective: claimed.objective,
            ...(claimed.timeZone ? { time_zone: claimed.timeZone } : {}),
          },
          images: runImageContext.images.map((image) => ({
            messageId: image.messageId,
            imageIndex: image.imageIndex,
            attachmentId: image.manifest.attachment_id,
            fileName: image.manifest.file_name,
            mediaType: image.manifest.media_type,
            byteSize: image.manifest.byte_size,
            contentHash: image.manifest.content_hash,
            data: image.data,
          })),
          ...(runImageContext.omitted > 0
            ? {
                imageContextNote: `This conversation has ${runImageContext.omitted} earlier image(s) from previous messages that do not fit this turn's bounded image budget (at most 10 images / 30 MB total). Do not claim to have seen those omitted images; say they are unavailable if asked about them.`,
              }
            : {}),
          provider: selection.provider,
          database: this.options.pool,
          probePool: this.options.pool,
          auth,
          ...(steering ? { steering } : {}),
          ...(this.options.referenceClock ? { referenceTime: this.options.referenceClock() } : {}),
          onToolCompletion: receipt => {
            if (controller.signal.aborted || previewClosed) return;
            if (completedTools.length < 16) completedTools.push({ name: receipt.name, completed_at: receipt.completedAt });
            flush(false);
          },
          onVisibleText: (delta) => {
            if (controller.signal.aborted || previewClosed) return;
            const visible = filter.push(delta);
            if (!visible) return;
            previewText = (previewText + visible).slice(0, PREVIEW_MAX_CHARS);
            previewStage = "answer";
            flush(false);
          },
          onProgress: (stage) => {
            if (controller.signal.aborted || previewClosed) return;
            previewStage = stage;
            flush(false);
          },
          signal: controller.signal,
        });
        const trailing = filter.flush();
        if (trailing && !controller.signal.aborted) {
          previewText = (previewText + trailing).slice(0, PREVIEW_MAX_CHARS);
          previewStage = "answer";
          flush(true);
        }
        const outcome =
          execution.remoteStatus === "agent_completed" || execution.remoteStatus === "completed"
            ? "accepted"
            : "fallback";
        await selection.finish?.(outcome).catch(() => undefined);
        if (controller.signal.aborted) {
          const reason = (controller.signal.reason as RunAbort | undefined)?.code ?? "ABORTED";
          if (reason === "USER_CANCELLED") {
            await this.finalizeCancelled(auth, claimed, fence, previewText, entryImages.map((image) => image.manifest), completedTools);
          } else {
            await this.finalizeRetained(fence, reason === "RUNNER_SHUTDOWN" ? "RUNNER_SHUTDOWN" : reason === "LEASE_LOST" ? "LEASE_LOST" : "SOURCE_REVOKED", { auth, claimed, partialText: previewText });
          }
          return;
        }
        if (execution.remoteStatus === "fallback") {
          const failureCode = execution.remoteFailureCode ?? "MODEL_RUN_FAILED";
          this.options.logger.warn(
            { ...queueRunCorrelation(claimed), ...execution.remoteDiagnostics, failure_code: failureCode },
            "conversation queue model run did not complete",
          );
          await this.finalizeRetained(fence, failureCode, { auth, claimed, partialText: previewText });
          return;
        }
        const result = serializedResult(
          execution,
          entryImages.map((image) => image.manifest),
          { claimedAt: claimed.claimedAt },
        );
        await recordConversationQueueResult(this.options.pool, fence, result);
        await this.replayPersistence(auth, claimed, result, fence);
      } catch (error) {
        const reason = (controller.signal.reason as RunAbort | undefined)?.code;
        if (error instanceof ConversationQueueLeaseLostError || reason === "LEASE_LOST") {
          // A committed Stop also fails the non-cancel result fence. Distinguish
          // it from a truly stale worker, including a lost in-process stop event.
          try {
            const owned = await assertConversationQueueOwnedClaim(this.options.pool, fence, { allowCancelRequested: true });
            if (owned.cancelRequested) await this.finalizeCancelled(auth, claimed, fence, previewText,
              entryImages.map(image => image.manifest), completedTools);
          } catch { /* A stale/revoked claim never gains cancellation authority. */ }
          return;
        }
        this.options.logger.error(
          { ...queueRunCorrelation(claimed), ...conversationRunDiagnostics(error) },
          "conversation queue run failed",
        );
        if (reason === "USER_CANCELLED") {
          await this.finalizeCancelled(auth, claimed, fence, previewText, entryImages.map((image) => image.manifest), completedTools).catch(() => undefined);
        } else if (revocationCode === "SOURCE_REVOKED" || reason === "SOURCE_REVOKED") {
          await this.finalizeRetained(fence, "SOURCE_REVOKED", { auth, claimed, partialText: previewText }).catch(() => undefined);
        } else {
          await this.finalizeRetained(fence, reason === "RUNNER_SHUTDOWN" ? "RUNNER_SHUTDOWN" : "RUN_FAILED", { auth, claimed, partialText: previewText }).catch(() => undefined);
        }
      } finally {
        previewClosed = true;
        clearConversationQueuePreview(claimed.runId);
        clearInterval(heartbeat);
        if (flushTimer) clearTimeout(flushTimer);
        this.active.delete(claimed.runId);
        publishConversationQueueChanged(claimed.accountId, claimed.sessionId);
        this.schedule(this.pollIntervalMs);
        await monitor.settle();
      }
      });
    })();
    run.promise = promise;
    await promise;
  }

  private async finalizeCancelled(
    auth: AuthContext,
    claimed: ClaimedConversationQueueEntry,
    fence: ConversationQueueRunFence,
    partialText: string,
    images: ConversationImageManifest[],
    tools: Array<{ name: string; completed_at: string }> = [],
  ): Promise<void> {
    try {
      await persistConversationQueueCancellation(this.options.pool, auth, {
        fence,
        sessionId: claimed.sessionId,
        messageId: claimed.messageId,
        objective: claimed.objective,
        acceptedAt: claimed.acceptedAt,
        images,
        partialText,
        stoppedAt: new Date().toISOString(),
        execution: { started_at: claimed.claimedAt, completed_at: new Date().toISOString(), tools },
      });
    } catch (error) {
      if (error instanceof ConversationQueueLeaseLostError) return;
      // Never scrub the admitted message if its history was not saved. A
      // transient failure can retry on lease recovery; revoked or expired
      // context still cannot receive a partial answer and retains its existing
      // expiry/deletion boundary.
      this.options.logger.warn(
        { queue_entry_id: claimed.entryId, err: error },
        "conversation queue stop could not persist a partial answer",
      );
      return;
    }
    await finalizeConversationQueueEntry(this.options.pool, {
      fence,
      status: "cancelled",
    }).catch(() => undefined);
  }

  private async finalizeRetained(
    fence: ConversationQueueRunFence,
    failureCode: string,
    stop?: {
      auth: AuthContext;
      claimed: ClaimedConversationQueueEntry;
      partialText: string;
    },
  ): Promise<void> {
    const outcome = await finalizeConversationQueueEntry(this.options.pool, {
      fence,
      status: failureCode === "RUNNER_SHUTDOWN" ? "interrupted" : "failed",
      failureCode,
    });
    if (outcome.applied || outcome.effectiveStatus !== "running") return;
    // A committed stop won the race against this failure or shutdown path. The
    // cancelled terminal state scrubs the queue's admitted text, so the exact
    // message and attachment manifests must reach Session history first through
    // the governed cancellation persistence. Without owned auth/identity, when
    // that persistence fails, or when the context is revoked or expired, keep
    // the fenced row retained for lease recovery instead of scrubbing it or
    // claiming the message saved.
    if (!stop) return;
    try {
      const images = (
        await readConversationMessageImageManifests(this.options.pool, fence.accountId, [fence.entryId])
      ).get(fence.entryId) ?? [];
      await persistConversationQueueCancellation(this.options.pool, stop.auth, {
        fence,
        sessionId: fence.sessionId,
        messageId: stop.claimed.messageId,
        objective: stop.claimed.objective,
        acceptedAt: stop.claimed.acceptedAt,
        images,
        partialText: stop.partialText,
        stoppedAt: new Date().toISOString(),
        execution: { started_at: stop.claimed.claimedAt, completed_at: new Date().toISOString(), tools: [] },
      });
    } catch (error) {
      if (!(error instanceof ConversationQueueLeaseLostError)) {
        this.options.logger.warn(
          { queue_entry_id: fence.entryId, failure_code: "CANCELLATION_PERSISTENCE_FAILED" },
          "conversation queue stop racing a failure could not persist the admitted message",
        );
      }
      return;
    }
    await finalizeConversationQueueEntry(this.options.pool, {
      fence,
      status: "cancelled",
    }).catch(() => undefined);
  }

  private async markPersistencePending(fence: ConversationQueueRunFence): Promise<void> {
    try {
      await markConversationQueuePersistencePending(this.options.pool, { fence });
    } catch (error) {
      if (error instanceof ConversationQueueLeaseLostError) return;
      throw error;
    }
  }
}
