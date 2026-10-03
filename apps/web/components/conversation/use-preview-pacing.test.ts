// @vitest-environment happy-dom
//
// GET-128 presentation pacing: rapid forming fragments coalesce into 500–1000ms
// paints while terminal states and errors stay prompt and stale frames never
// repaint.
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationQueuePreview } from "@talent-signal/contracts";
import { usePreviewPacing } from "./use-preview-pacing";

const RUN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let paced: ConversationQueuePreview | null = null;
function Probe({ preview }: { preview: ConversationQueuePreview | null }) {
  const value = usePreviewPacing(preview);
  useLayoutEffect(() => { paced = value; });
  return null;
}
function preview(revision: number, text: string, stage = "answer"): ConversationQueuePreview {
  return { run_id: RUN, message_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", revision, text, stage };
}
let root: Root;
let mount: HTMLDivElement;
async function render(value: ConversationQueuePreview | null) {
  await act(async () => { root.render(createElement(Probe, { preview: value })); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
});
afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("coalesces rapid fragments and keeps the trailing update, then commits terminal removal at once", async () => {
  await render(preview(1, "先"));
  expect(paced?.text).toBe("先");
  await act(async () => { vi.advanceTimersByTime(120); await render(preview(2, "先核对")); });
  await act(async () => { vi.advanceTimersByTime(120); await render(preview(3, "先核对两人的记录")); });
  // Inside the interval the presented text holds the last committed value.
  expect(paced?.text).toBe("先");
  await act(async () => { vi.advanceTimersByTime(600); });
  // The trailing edge paints the newest observed fragment, not the first one.
  expect(paced?.text).toBe("先核对两人的记录");
  // Terminal readback removes the preview and clears the presented text at once.
  await act(async () => { vi.advanceTimersByTime(10); await render(null); });
  expect(paced).toBeNull();
});

it("never repaints an older fragment from a previous run", async () => {
  await render(preview(4, "newer"));
  expect(paced?.text).toBe("newer");
  await act(async () => { vi.advanceTimersByTime(1000); await render({ ...preview(3, "older") }); });
  expect(paced?.text).toBe("newer");
});
