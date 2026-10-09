import type {
  AgentProviderInputPart,
  HarnessSteeringBatch,
  HarnessSteeringFeed,
  HarnessSteeringMessage,
} from "@talent-signal/agent";
import type { ConversationImageManifest } from "@talent-signal/contracts";
import type { Pool } from "pg";

import type { AuthContext } from "./auth.js";
import {
  readConversationMessageImageManifests,
} from "./conversationMessageImages.js";
import {
  type ConversationQueueRunFence,
  type ConversationQueueSteeringMember,
  assertConversationQueueContextCurrent,
  assertConversationQueueOwnedClaim,
  closeConversationQueueSteeringIntake,
  claimConversationQueueSteeringMembers,
  acknowledgeConversationQueueSteeringMembers,
  markConversationQueueSteeringUnsupported,
  readConversationQueueSteeringMembers,
} from "./conversationQueueState.js";

/** Quiet interval: rapid fragments within it combine into one processing step. */
export const CONVERSATION_STEER_QUIET_MS = 750;
/** Anti-starvation: sustained rapid input still ships one batch per window. */
export const CONVERSATION_STEER_MAX_BATCH_AGE_MS = 4 * CONVERSATION_STEER_QUIET_MS;
/** One combined final answer folds at most this many steering messages. */
export const CONVERSATION_STEER_MAX_FOLDED = 20;

export const CONVERSATION_STEER_IMAGE_UNSUPPORTED = "STEER_IMAGE_UNSUPPORTED";
export const CONVERSATION_STEER_MESSAGE_LIMIT = "STEER_MESSAGE_LIMIT";

/** One pending steering message with its grouped, ordered image manifest. */
export interface ConversationQueuePendingSteeringMessage
  extends ConversationQueueSteeringMember {
  images: ConversationImageManifest[];
}

/**
 * Durable steering state behind the feed policy. The production source is
 * fenced SQL; tests substitute a deterministic source with the same contract.
 */
export interface ConversationQueueSteeringSource {
  /** Awaiting messages in accepted order, fenced on the live run. */
  readAwaiting(): Promise<ConversationQueuePendingSteeringMessage[]>;
  /** Freeze immutable text for dispatch, without claiming model consumption. */
  claim(entryIds: string[]): Promise<ConversationQueueSteeringMember[]>;
  /** Confirm consumption only at a later primary-model checkpoint. */
  acknowledge(entryIds: string[]): Promise<void>;
  /** Explicit, never silent: unsupported messages re-queue as the next task. */
  markUnsupported(entryIds: string[], failureCode: string): Promise<void>;
  /** Atomically close intake; true when this run accepts no further steering. */
  closeIntake(options?: { force?: boolean }): Promise<boolean>;
  /** Recheck lease, cancellation and source validity before any dispatch. */
  assertLive(): Promise<void>;
  /** Grouped image bytes for one delivered message, bounded by the host. */
  loadImages(member: ConversationQueueSteeringMember): Promise<AgentProviderInputPart[]>;
}

export interface ConversationQueueSteeringFeedOptions {
  /** External abort, composed with the run's own fences. */
  signal?: AbortSignal;
  quietMs?: number;
  maxBatchAgeMs?: number;
  /** Images already admitted into this run before steering began. */
  usedImageCount?: number;
  usedImageBytes?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * GET-128 steering dispatch policy.
 *
 * Batches are released only at the harness's tool-safe points (the harness
 * never pulls while a tool is in flight). Rapid fragments within the quiet
 * interval combine into one batch; every original message keeps its identity
 * and accepted time. Image messages remain whole as explicit next tasks. Only
 * an empty FINAL checkpoint durably closes intake under the admission lock,
 * so the run's one standalone
 * final answer always follows its latest processed batch and only a genuinely
 * late message becomes the next task.
 */
export function createConversationQueueSteeringFeed(
  source: ConversationQueueSteeringSource,
  options: ConversationQueueSteeringFeedOptions = {},
): HarnessSteeringFeed {
  const quietMs = options.quietMs ?? CONVERSATION_STEER_QUIET_MS;
  const maxBatchAgeMs = options.maxBatchAgeMs ?? CONVERSATION_STEER_MAX_BATCH_AGE_MS;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  let folded = 0;
  return {
    async nextBatchAtSafePoint(checkpoint = {}): Promise<HarnessSteeringBatch | null> {
      for (;;) {
        options.signal?.throwIfAborted();
        await source.assertLive();
        options.signal?.throwIfAborted();
        const pending = await source.readAwaiting();
        if (pending.length === 0) {
          // Close-and-race: admission may attach one more message between the
          // read and the close; the loop then delivers it instead of losing it.
          if (!checkpoint.final) return { messages: [] };
          if (await source.closeIntake()) return null;
          continue;
        }
        const newest = Date.parse(pending[pending.length - 1]!.acceptedAt);
        const oldest = Date.parse(pending[0]!.acceptedAt);
        const nowMs = now().getTime();
        const releaseAt = Math.min(newest + quietMs, oldest + maxBatchAgeMs);
        if (nowMs < releaseAt) {
          await sleep(releaseAt - nowMs);
          continue;
        }
        const deliverable: ConversationQueuePendingSteeringMessage[] = [];
        const unsupportedOverflow: string[] = [];
        const unsupportedImages: string[] = [];
        for (const message of pending) {
          if (folded + deliverable.length >= CONVERSATION_STEER_MAX_FOLDED) {
            unsupportedOverflow.push(message.entryId);
            continue;
          }
          if (message.images.length > 0) {
            // Image grouping is atomic: a message whose images cannot join the
            // text-only hook never loses them silently. It is processed
            // with its images as the next task and the folded turn says so.
            unsupportedImages.push(message.entryId);
            continue;
          }
          deliverable.push(message);
        }
        if (unsupportedOverflow.length > 0) {
          await source.markUnsupported(unsupportedOverflow, CONVERSATION_STEER_MESSAGE_LIMIT);
        }
        if (unsupportedImages.length > 0) {
          await source.markUnsupported(unsupportedImages, CONVERSATION_STEER_IMAGE_UNSUPPORTED);
        }
        if (deliverable.length === 0) continue;
        options.signal?.throwIfAborted();
        await source.assertLive();
        // Hook additionalContext is text-only. Whole image messages remain
        // next tasks; no bytes are loaded or half-folded into this task.
        const claimed = await source.claim(deliverable.map(entry => entry.entryId));
        if (!claimed.length) continue;
        folded += claimed.length;
        const messages: HarnessSteeringMessage[] = claimed.map(member => ({
          messageID: member.messageId, acceptedAt: member.acceptedAt, text: member.objective,
        }));
        return { messages, acknowledge: async () => {
          options.signal?.throwIfAborted();
          await source.assertLive();
          await source.acknowledge(claimed.map(member => member.entryId));
        } };
      }
    },
  };
}

/**
 * Production steering state: fenced SQL on the durable queue. Every step
 * revalidates the run lease, the user's stop and current source authorization,
 * so a stale, revoked or cross-account path can never deliver or fold input.
 */
export function createConversationQueueSteeringSource(input: {
  pool: Pool;
  auth: AuthContext;
  fence: ConversationQueueRunFence;
  sessionId: string;
  /** Composed with the run's abort so a stop unwinds the provider immediately. */
  onLost: (reason: "USER_CANCELLED" | "LEASE_LOST" | "SOURCE_REVOKED") => void;
  loadImages: (
    member: ConversationQueueSteeringMember,
  ) => Promise<AgentProviderInputPart[]>;
}): ConversationQueueSteeringSource {
  const fail = (reason: "USER_CANCELLED" | "LEASE_LOST" | "SOURCE_REVOKED"): never => {
    input.onLost(reason);
    throw new Error(reason);
  };
  return {
    async readAwaiting() {
      const members = await readConversationQueueSteeringMembers(input.pool, input.fence, {
        state: "awaiting",
      });
      const manifests = await readConversationMessageImageManifests(
        input.pool,
        input.fence.accountId,
        members.map((member) => member.entryId),
      );
      return members.map((member) => ({
        ...member,
        images: manifests.get(member.entryId) ?? [],
      }));
    },
    claim: entryIds => claimConversationQueueSteeringMembers(input.pool, input.fence, entryIds),
    acknowledge: entryIds => acknowledgeConversationQueueSteeringMembers(input.pool, input.fence, entryIds),
    markUnsupported: (entryIds, failureCode) =>
      markConversationQueueSteeringUnsupported(input.pool, input.fence, entryIds, failureCode),
    closeIntake: (options) => closeConversationQueueSteeringIntake(input.pool, input.fence, options),
    async assertLive() {
      let claimed;
      try {
        claimed = await assertConversationQueueOwnedClaim(input.pool, input.fence, {
          allowCancelRequested: true,
        });
      } catch {
        return fail("LEASE_LOST");
      }
      if (claimed.cancelRequested) return fail("USER_CANCELLED");
      try {
        await assertConversationQueueContextCurrent(input.pool, input.auth, input.sessionId);
      } catch {
        return fail("SOURCE_REVOKED");
      }
    },
    loadImages: (member) => input.loadImages(member),
  };
}
