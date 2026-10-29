// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionCopyAction } from "./session-copy-action";
import { LocaleProvider } from "./locale-provider";
const request = vi.hoisted(() => vi.fn());
vi.mock("./workspace-session-request", () => ({ workspaceSessionFetch: request }));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const target = { id, binding: "binding", scope: "scope" };
let root: Root | null;
let host: HTMLDivElement;
let writeText: ReturnType<typeof vi.fn>;
function response(binding = "binding") {
  return Response.json({ session_version: binding, detail: { session_id: id, state: "active", turns: [{
    id: "human", objective: "Synthetic sent text", createdAt: "2026-10-29T00:00:00Z",
    response: { taskID: "task", createdAt: "2026-10-29T00:00:01Z", unboundConversationBlocks: [] },
  }] } });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ClipboardItem", undefined);
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  request.mockReset().mockResolvedValue(response());
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<LocaleProvider locale="en"><SessionCopyAction target={target} /></LocaleProvider>));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("copies on explicit click and reports clipboard failure truthfully", async () => {
  expect(request).not.toHaveBeenCalled();
  writeText.mockRejectedValue(new Error("Denied"));
  await act(async () => host.querySelector("button")!.click());
  expect(writeText).toHaveBeenCalledWith("You\n\nSynthetic sent text");
  expect(host.textContent).toContain("Could not copy");
});
it("does not copy another binding's response", async () => {
  request.mockResolvedValue(response("other-account"));
  await act(async () => host.querySelector("button")!.click());
  expect(writeText).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Could not copy");
});
it("does not export a late read after the menu closes", async () => {
  let resolve!: (value: Response) => void;
  request.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
  await act(async () => host.querySelector("button")!.click());
  await act(async () => root!.unmount()); root = null;
  await act(async () => resolve(response()));
  expect(writeText).not.toHaveBeenCalled();
});
