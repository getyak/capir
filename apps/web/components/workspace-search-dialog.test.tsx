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
  stage = document.createElement("div"); document.body.append(stage); root = createRoot(stage);
});
afterEach(async () => { await act(async () => root.unmount()); stage.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("closes a filled search in one Escape and returns focus to its trigger", async () => {
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope" })));
  const trigger = stage.querySelector("button")!;
  await act(async () => trigger.click());
  const input = document.querySelector<HTMLInputElement>("[role=dialog] input")!;
  input.focus(); input.value = "林";
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => input.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(document.querySelector("[role=dialog]")).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
});
it("leaves IME candidate cancellation with the input method", async () => {
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope" })));
  await act(async () => stage.querySelector("button")!.click());
  const escape = new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true });
  await act(async () => document.querySelector<HTMLInputElement>("[role=dialog] input")!.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(false);
  expect(document.querySelector("[role=dialog]")).not.toBeNull();
});

it("labels its modal and closes through the accessible close control", async () => {
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope" })));
  const trigger = stage.querySelector("button")!;
  await act(async () => trigger.click());
  const dialog = document.querySelector("[role=dialog]")!;
  const title = document.getElementById(dialog.getAttribute("aria-labelledby")!);
  const description = document.getElementById(dialog.getAttribute("aria-describedby")!);
  expect(title?.textContent).toBe("搜索人物与对话");
  expect(description?.textContent).toContain("当前账号");
  expect(document.activeElement).toBe(dialog.querySelector("input"));
  await act(async () => (dialog.querySelector("[aria-label=关闭搜索]") as HTMLButtonElement).click());
  expect(document.querySelector("[role=dialog]")).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  await act(async () => trigger.click());
  expect(document.querySelector("[role=dialog] input")).toHaveProperty("value", "");
});
