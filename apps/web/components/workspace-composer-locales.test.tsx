// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "./locale-provider";
import { WorkspaceComposer } from "./workspace-composer";
vi.mock("./workspace-search", () => ({ useWorkspaceDirectory: () => ({ data: null, loading:false, failed:false, retry:vi.fn() }) }));
let host: HTMLDivElement;
let root: Root;
const submit = vi.fn();
function Harness({ locale, initial = "/" }: { locale: "en" | "zh-CN"; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <LocaleProvider locale={locale}><WorkspaceComposer id="locale-composer" label="Message" placeholder="Message" value={value}
    variant="home" maxLength={1000} canSubmit binding="current" onValueChange={setValue} onNavigate={() => {}} onSubmit={submit}
    onFiles={() => {}} /></LocaleProvider>;
}
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT:true }); host = document.createElement("div"); document.body.append(host); root=createRoot(host); submit.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("localizes capability discovery, menu choices and staged text while preserving IME send ownership", async () => {
  await act(async () => root.render(<Harness locale="en"/>));
  const input=host.querySelector("textarea")!;
  act(() => { input.setSelectionRange(1,1); input.focus(); });
  expect(host.textContent).toContain("/ Capabilities · @ People");
  expect(host.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe("Capability suggestions");
  expect(host.querySelector('[role="option"]')?.textContent).toContain("Organize this conversation");
  act(() => input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles:true })));
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key:"Enter", bubbles:true, cancelable:true })));
  expect(input.value).toBe("/");
  act(() => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles:true })));
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key:"Enter", bubbles:true, cancelable:true })));
  expect(input.value).toContain("Help me organize");
  expect(submit).not.toHaveBeenCalled();
  const staged=input.value;
  await act(async () => root.render(<Harness locale="zh-CN"/>));
  expect(input.value).toBe(staged);
  expect(host.textContent).toContain("/ 能力 · @ 人物");
});
it("uses the active locale for relevant counts and the opened add menu", async () => {
  await act(async () => root.render(<Harness locale="en" initial={"a".repeat(901)}/>));
  expect(host.textContent).toContain("99 characters remaining before the send limit.");
  act(() => host.querySelector<HTMLButtonElement>('[data-add-trigger]')!.click());
  const panel=document.querySelector('[data-add-panel]')!;
  expect(panel.getAttribute("aria-label")).toBe("Add content and find people");
  expect(panel.textContent).toContain("Add files");
  expect(panel.textContent).toContain("Tools and skills");
  expect(panel.textContent).not.toContain("添加文件");
});
