import { Value } from "@sinclair/typebox/value";
import { CaptureImageObservationSchema, type CaptureImageObservation } from "@talent-signal/contracts";
import type { PoolClient } from "pg";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Validate the exact producer while the live fenced queue row still owns its
 * temporary result. This never reads client-authored Session response fields. */
export function captureObservationForResult(result: unknown, runID: string, messageID: string): CaptureImageObservation | null {
  const host = object(result), body = object(host?.body);
  const images = host?.images;
  const source = Array.isArray(images) && images.length === 1 ? object(images[0]) : null;
  const candidate = host?.captureImageObservation;
  return host?.remoteStatus === "agent_completed" && body?.task_id === runID && source &&
    Value.Check(CaptureImageObservationSchema, candidate) && candidate.content_hash === source.content_hash &&
    candidate.artifact_id === `conversation-image-${messageID}-0-${source.attachment_id}` &&
    candidate.clues.every(clue => clue.source_excerpt.includes(clue.text)) ? candidate : null;
}

/** Called inside the successful/cancelled terminal transaction, after the
 * owned row was locked and updated. Keep full result/answer/OCR scrubbing. */
export async function persistTerminalCaptureObservation(client: PoolClient,
  fence: { accountId: string; sessionId: string; entryId: string; runId: string },
  messageID: string, result: unknown, completed: boolean): Promise<void> {
  const observation = completed ? captureObservationForResult(result, fence.runId, messageID) : null;
  if (observation) {
    await client.query(
      `UPDATE conversation_message_images
       SET capture_observation=CASE WHEN image_index=0 AND content_hash=$5 AND
         ('conversation-image-'||message_id::text||'-0-'||attachment_id::text)=$6 THEN $7::jsonb ELSE NULL END
       WHERE account_id=$1 AND session_id=$2 AND queue_entry_id=$3 AND message_id=$4 AND expires_at>now()`,
      [fence.accountId, fence.sessionId, fence.entryId, messageID, observation.content_hash, observation.artifact_id,
        JSON.stringify({ run_id: fence.runId, observation })],
    );
  } else {
    await client.query("UPDATE conversation_message_images SET capture_observation=NULL WHERE account_id=$1 AND session_id=$2 AND queue_entry_id=$3 AND capture_observation IS NOT NULL",
      [fence.accountId, fence.sessionId, fence.entryId]);
  }
}
