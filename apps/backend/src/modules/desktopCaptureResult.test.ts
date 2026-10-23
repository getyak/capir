import { describe, expect, it } from "vitest";
import { projectDesktopCaptureResult } from "./desktopCaptureResult.js";

const mid = "a072ed54-6d56-413d-af4b-3ebc01ba646a";
const sid = "a072ed54-6d56-413d-af4b-3ebc01ba646b";
const run = "a072ed54-6d56-413d-af4b-3ebc01ba646c";
const image = { attachment_id: "ae5d77d0-7cdf-420f-8c45-ecf317d05c6d", file_name: "capture.png",
  media_type: "image/png" as const, byte_size: 8, content_hash: "a".repeat(64) };
const observation = { artifact_id: `conversation-image-${mid}-0-${image.attachment_id}`,
  content_hash: image.content_hash, model: "actual-inspector", inspection_request_id: "actual-receipt",
  conversation_kind: "unknown" as const, pending: true as const,
  clues: [{ kind: "company" as const, text: "松禾设计", source_excerpt: "松禾设计" }] };
const row = { id: "75ce7ff4-a5a8-40d0-b1d7-d84a13adcd30", message_id: mid, run_id: run, revision: 8,
  status: "completed" as const, updated_at: new Date("2026-09-28T12:00:00Z"),
  result: { body: { task_id: run }, remoteStatus: "agent_completed", captureImageObservation: observation } };
const turns = [{ id: mid, images: [image] }];
const retainedSource = { ...image, capture_observation: { run_id: run, observation } };

describe("host-owned current screenshot result", () => {
  it("binds a genuine pending observation to the canonical message, image and immutable host version", () => {
    const result = projectDesktopCaptureResult(sid, row, [retainedSource], turns);
    expect(result).toMatchObject({ session_id: sid, message_id: mid, queue_entry_id: row.id,
      source: image, observation });
    expect(result?.result_version).toMatch(/^[a-f0-9]{64}$/u);
    expect(projectDesktopCaptureResult(sid, row, [retainedSource], turns)?.result_version).toBe(result?.result_version);
    expect(projectDesktopCaptureResult(sid, { ...row, revision: 9 }, [retainedSource], turns)?.result_version).not.toBe(result?.result_version);
    expect(result?.source).not.toHaveProperty("capture_observation");
  });
  it("never extracts clues from editable Session responses or a completion boolean", () => {
    const forged = [{ ...turns[0]!, captureImageObservation: observation, response: { captureImageObservation: observation } }];
    const staleTemporary = { ...row, result: null };
    const forgedTemporary = { ...row, result: { body: { captureImageObservation: observation } } };
    expect(projectDesktopCaptureResult(sid, staleTemporary, [image], forged)?.observation).toBeNull();
    expect(projectDesktopCaptureResult(sid, forgedTemporary, [image], forged)?.observation).toBeNull();
  });
  it("rejects missing, changed, unpersisted or failed canonical sources", () => {
    expect(projectDesktopCaptureResult(sid, row, [], turns)).toBeNull();
    expect(projectDesktopCaptureResult(sid, row, [image], [])).toBeNull();
    expect(projectDesktopCaptureResult(sid, row, [image], [{ id: mid, images: [{ ...image, content_hash: "b".repeat(64) }] }])).toBeNull();
    expect(projectDesktopCaptureResult(sid, { ...row, status: "failed" }, [image], turns)).toBeNull();
  });
  it("requires matching same-run producer and image provenance; rejects unknown fields and unbounded content", () => {
    const variants = [
      { ...observation, content_hash: "b".repeat(64) },
      { ...observation, artifact_id: observation.artifact_id.replace(mid, sid) },
      { ...observation, pending: false },
      { ...observation, confirmed_person_id: run },
      { ...observation, clues: [...observation.clues, ...observation.clues, ...observation.clues, ...observation.clues,
        ...observation.clues, ...observation.clues, ...observation.clues] },
    ];
    for (const captureImageObservation of variants) {
      expect(projectDesktopCaptureResult(sid, row, [{ ...image, capture_observation: { run_id: run, observation: captureImageObservation } }], turns)?.observation).toBeNull();
    }
    expect(projectDesktopCaptureResult(sid, row, [{ ...image, capture_observation: { run_id: sid, observation } }], turns)?.observation).toBeNull();
  });
});
