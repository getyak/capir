// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocaleTag } from "@talent-signal/contracts";
import { LocaleProvider } from "./locale-provider";
const state = vi.hoisted(() => ({ load: vi.fn(), snapshot: { people: { people: [] as unknown[] }, sessions: { sessions: [] as unknown[] } } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/people" }));
vi.mock("@/lib/workspace-directory-cache", () => ({ readCachedWorkspaceDirectory: () => null, loadWorkspaceDirectory: state.load, subscribeWorkspaceDirectoryInvalidation: () => () => {}, isWorkspaceDirectoryAbort: () => false }));
vi.mock("@/lib/workspace-refresh", () => ({ subscribeWorkspaceRefresh: () => () => {}, coordinatorScopeIsCurrent: () => true }));
import { WorkspaceGlobalSearchDialog } from "./workspace-search";
let root: Root; let stage: HTMLDivElement;
async function mount(locale: LocaleTag) { await act(async () => root.render(<LocaleProvider locale={locale}><WorkspaceGlobalSearchDialog binding="scope" presentation="field" /></LocaleProvider>)); }
async function open(locale: LocaleTag) { await mount(locale); await act(async () => stage.querySelector("button")!.click()); }
function dialog() { return document.querySelector<HTMLElement>("[role=dialog]")!; }
async function type(value: string) { const input = dialog().querySelector("input")!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); return input; }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); state.load.mockReset(); state.snapshot = { people: { people: [] }, sessions: { sessions: [] } }; state.load.mockImplementation(async () => state.snapshot); stage = document.createElement("div"); document.body.append(stage); root = createRoot(stage); });
afterEach(async () => { await act(async () => root.unmount()); stage.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  ["en", "Search people and conversations", "Search people or conversations", "Close search"],
  ["zh-CN", "搜索人物与对话", "搜索人物或对话", "关闭搜索"],
  ["zh-TW", "搜尋人物與對話", "搜尋人物或對話", "關閉搜尋"],
  ["ja", "人物と会話を検索", "人物や会話を検索", "検索を閉じる"],
  ["ko", "인물과 대화 검색", "인물 또는 대화 검색", "검색 닫기"],
] as const)("localizes global search chrome in %s and preserves focus and dismissal", async (locale, title, field, close) => {
  await mount(locale); expect(stage.textContent).toContain(field); const trigger = stage.querySelector("button")!;
  await act(async () => trigger.click()); const modal = dialog();
  expect(document.getElementById(modal.getAttribute("aria-labelledby")!)?.textContent).toBe(title);
  expect(modal.querySelector("input")?.placeholder).toBe(title); expect(document.activeElement).toBe(modal.querySelector("input"));
  const closer = modal.querySelector<HTMLButtonElement>(`button[aria-label="${close}"]`)!; expect(closer).not.toBeNull();
  if (locale === "en") { expect(modal.textContent).toContain("Enter a name, organization or conversation title."); expect(modal.textContent).toContain("↑ ↓ Select · Enter Open · Esc Close"); expect(document.getElementById(modal.getAttribute("aria-describedby")!)?.textContent).toContain("current account"); }
  await act(async () => closer.click()); expect(document.querySelector("[role=dialog]")).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
});
it("preserves query and authored results on locale change without reloading the directory", async () => {
  state.snapshot = { people: { people: [{ id: "person-a", display_label: "林知遥", contexts: [{ display_label: "联系人" }] }, { id: "person-b", display_label: "林原名", contexts: [] }] }, sessions: { sessions: [{ session_id: "session-a", state: "active", expires_at: "2030-01-01T00:00:00Z", title: "林的对话原文", person_label: "", context_label: "" }] } };
  await open("zh-CN"); const input = await type("林"); const readCount = state.load.mock.calls.length; await mount("en");
  expect(dialog().querySelector("input")).toBe(input); expect(input.value).toBe("林"); expect(state.load).toHaveBeenCalledTimes(readCount);
  for (const text of ["林知遥", "林原名", "林的对话原文"]) expect(dialog().textContent).toContain(text);
  expect(dialog().querySelector('a[href="/workspace/people/person-a"] small')?.textContent).toBe("联系人");
  expect(dialog().querySelector('a[href="/workspace/people/person-b"] small')?.textContent).toBe("Contact");
  expect(dialog().querySelector('a[href="/workspace/sessions/session-a"] small')?.textContent).toBe("Account-specific conversation");
});
it("localizes the empty-query and no-result message while preserving the exact entered query", async () => {
  await open("en"); await type("  未命中 & 原话  ");
  expect(dialog().textContent).toContain('No results for “未命中 & 原话”. Try part of a name or an organization.');
  expect(dialog().querySelector("input")?.value).toBe("  未命中 & 原话  ");
});
it("distinguishes loading and failure from no results and localizes retry", async () => {
  let fail!: (reason: Error) => void; state.load.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  await open("en"); await type("林"); expect(dialog().textContent).toContain("Reading the current account's directory…");
  await act(async () => fail(new Error("unavailable")));
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain("Cannot read people and conversations right now. Try again; saved content will not be lost.");
  expect(dialog().textContent).not.toContain("No results for");
  const retry = [...dialog().querySelectorAll("button")].find(button => button.textContent === "Reload")!;
  await act(async () => retry.click()); expect(state.load).toHaveBeenLastCalledWith("scope", expect.any(Function), { force: true });
});
