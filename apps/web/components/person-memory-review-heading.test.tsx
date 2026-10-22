// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PersonMemoryReviewHeading } from "./person-memory-review-heading";

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([new DOMRect(0, 100, 200, 30)] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount(path: string) {
  window.history.replaceState(null, "", path);
  await act(async () => root.render(createElement(PersonMemoryReviewHeading, { personId: "person" })));
}
it("hands the requested review hash to the pending heading", async () => {
  await mount("/workspace/people/person#person-memory-pending");
  expect(document.activeElement).toBe(host.querySelector("h2"));
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
});
it.each(["/workspace/people/person", "/workspace/people/other#person-memory-pending"])("does not focus an ordinary or different destination: %s", async path => {
  await mount(path); expect(document.activeElement).not.toBe(host.querySelector("h2"));
});
it("respects a control chosen before delayed content mounts", async () => {
  const chosen = document.createElement("button"); document.body.append(chosen); chosen.focus();
  try {
    await mount("/workspace/people/person#person-memory-pending");
    expect(document.activeElement).toBe(chosen);
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  } finally { chosen.remove(); }
});
