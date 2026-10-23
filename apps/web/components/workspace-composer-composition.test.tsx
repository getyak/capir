// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./workspace-search", () => ({ useWorkspaceDirectory: () => ({ data: null, loading: false, failed: false, retry: vi.fn() }) }));
import { WorkspaceComposer } from "./workspace-composer";

let host: HTMLDivElement, root: Root | null;
const submit = vi.fn(), first = vi.fn(), second = vi.fn();
const draft = "  保留\n空白  ";
async function render(binding: string, callback = first, disabled = false) {
  await act(async () => root!.render(<WorkspaceComposer id="composer" label="消息" value={draft} maxLength={1000}
    variant="home" placeholder="输入" binding={binding} canSubmit disabled={disabled} onValueChange={() => {}}
    onSubmit={submit} onNavigate={() => {}} onComposingChange={callback}/>));
}
const input = () => host.querySelector("textarea")!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  submit.mockReset(); first.mockReset(); second.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; host.remove(); vi.unstubAllGlobals(); });

it("reports composition and blocks an Enter without native isComposing until commit", async () => {
  await render("first");
  await act(async () => {
    input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(first.mock.calls).toEqual([[true]]);
  expect(submit).not.toHaveBeenCalled();
  await act(async () => input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  expect(first.mock.calls).toEqual([[true], [false]]);
  expect(submit).not.toHaveBeenCalled();
  expect(input().value).toBe(draft);
  await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  expect(submit).toHaveBeenCalledOnce();
});
it("releases only the previous scope callback and ignores its late compositionend", async () => {
  await render("first");
  await act(async () => input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  await render("second", second);
  expect(first.mock.calls).toEqual([[true], [false]]);
  expect(second).not.toHaveBeenCalled();
  await act(async () => input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  expect(second).not.toHaveBeenCalled();
  await act(async () => input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  await act(async () => root!.unmount()); root = null;
  expect(second.mock.calls).toEqual([[true], [false]]);
});
it("releases composing state when editing is disabled", async () => {
  await render("first");
  await act(async () => input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  await render("first", first, true);
  expect(first.mock.calls).toEqual([[true], [false]]);
});
