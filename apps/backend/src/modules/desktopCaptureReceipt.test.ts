import { describe, expect, it } from "vitest";
import { projectDesktopCaptureReceipt } from "./desktopCaptureReceipt.js";

const mid = "a072ed54-6d56-413d-af4b-3ebc01ba646a";
const image = { attachment_id: "ae5d77d0-7cdf-420f-8c45-ecf317d05c6d", file_name: "capture.png",
  media_type: "image/png" as const, byte_size: 8, content_hash: "a".repeat(64) };
const row = { id: "75ce7ff4-a5a8-40d0-b1d7-d84a13adcd30", message_id: mid,
  status: "completed" as const, updated_at: new Date("2026-09-28T12:00:00Z") };

describe("exact desktop screenshot receipt", () => {
  it("requires the exact canonical Session turn before claiming a result is viewable", () => {
    const before = projectDesktopCaptureReceipt(row, [image], []);
    expect(before.result_recorded).toBe(false);
    const after = projectDesktopCaptureReceipt(row, [image], [{ id: mid, images: [image] }]);
    expect(after).toMatchObject({ message_id: mid, status: "completed", result_recorded: true, image_manifest: [image] });
  });

  it("does not trust a same-id turn when its image bytes differ", () => {
    const receipt = projectDesktopCaptureReceipt(row, [image], [{ id: mid, images: [{ ...image, content_hash: "b".repeat(64) }] }]);
    expect(receipt.result_recorded).toBe(false);
  });

  it("does not report a failed or missing-image result as complete", () => {
    expect(projectDesktopCaptureReceipt({ ...row, status: "failed" }, [image], [{ id: mid, images: [image] }]).result_recorded).toBe(false);
    expect(projectDesktopCaptureReceipt(row, [], [{ id: mid, images: [image] }]).result_recorded).toBe(false);
  });
});
