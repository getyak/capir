// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/people" }));
vi.mock("@/lib/workspace-directory-cache", () => ({
  readCachedWorkspaceDirectory: () => null,
  loadWorkspaceDirectory: () => Promise.resolve({ people: { people: [] }, sessions: { sessions: [] } }),
  subscribeWorkspaceDirectoryInvalidation: () => () => {},
  isWorkspaceDirectoryAbort: () => false,
}));
vi.mock("@/lib/workspace-refresh", () => ({ subscribeWorkspaceRefresh: () => () => {}, coordinatorScopeIsCurrent: () => true }));
import { WorkspaceGlobalSearchDialog } from "./workspace-search";
let root: Root, stage: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function(this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
  stage = document.createElement("div"); document.body.append(stage); root = createRoot(stage);
});
afterEach(async () => { await act(async () => root.unmount()); stage.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("closes a filled search in one Escape and returns focus to its trigger", async () => {
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope" })));
  const trigger = stage.querySelector("button")!;
  await act(async () => trigger.click());
  const input = stage.querySelector("input")!;
  input.focus(); input.value = "林";
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => input.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(stage.querySelector("dialog")!.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
});
it("leaves IME candidate cancellation with the input method", async () => {
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope" })));
  await act(async () => stage.querySelector("button")!.click());
  const escape = new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true });
  await act(async () => stage.querySelector("input")!.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(false);
  expect(stage.querySelector("dialog")!.open).toBe(true);
});
