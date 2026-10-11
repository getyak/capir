// @vitest-environment happy-dom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ failed: false, people: [
  { id: "person-one", display_label: "陈曦", contexts: [{ id: "context-one", display_label: "产品合作" }] },
  { id: "person-two", display_label: "陈曦", contexts: [{ id: "context-two", display_label: "研究交流" }] },
] }));
vi.mock("./workspace-search", () => ({ useWorkspaceDirectory: () => ({ data: { people: { people: fixture.people } }, loading: false, failed: fixture.failed, retry: vi.fn() }) }));
import { WorkspaceComposer } from "./workspace-composer";
let root: Root | null = null, host: HTMLDivElement;
let changeDraft: (v: string) => void, changeBinding: (v: string) => void;
const submit = vi.fn();
function Harness() {
  const [value, setValue] = useState("@陈"), [binding, setBinding] = useState("account-one");
  useEffect(() => { changeDraft = setValue; changeBinding = setBinding; }, []);
  return <WorkspaceComposer id="editor" label="消息" value={value} maxLength={1000} placeholder="输入" variant="home" layout="inline"
    canSubmit binding={binding} onValueChange={setValue} onSubmit={submit} onNavigate={() => {}} />;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.failed = false; submit.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<Harness />));
  await act(async () => { const input = host.querySelector("textarea")!; input.setSelectionRange(2, 2); input.focus(); });
});
afterEach(async () => { await act(async () => root?.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function select(index = 0) { await act(async () => host.querySelectorAll<HTMLElement>('[role="option"]')[index].click()); }

it("keeps the native editor and plain send payload while showing the exact directory choice", async () => {
  await select(1);
  expect(host.querySelector("textarea")!.value).toBe("@陈曦（研究交流） ");
  expect(host.querySelector('[data-composer-mention-mirror] mark')?.textContent).toBe("@陈曦（研究交流）");
  expect(host.querySelector('[aria-label="已选择的文字引用"]')).not.toBeNull();
  expect(submit).not.toHaveBeenCalled();
  const reference = host.querySelector<HTMLButtonElement>('[aria-label="查看 陈曦 的引用信息"]')!;
  await act(async () => reference.click());
  const preview = document.querySelector('[aria-label="陈曦 的简要资料"]')!;
  expect(preview.contains(document.activeElement)).toBe(true);
  expect(preview.textContent).toContain("研究交流");
  expect(preview.querySelector("a")?.getAttribute("href")).toBe("/workspace/people/person-two");
  expect(preview.textContent).toContain("不会自动绑定身份或读取人物记忆");
});
it("does not turn an arbitrary typed or pasted name into a selection", async () => {
  await act(async () => changeDraft("@陈曦（产品合作） 普通文字"));
  expect(host.querySelector('[data-composer-mention-mirror] mark')).toBeNull();
  expect(host.querySelector('[aria-label="已选择的文字引用"]')).toBeNull();
});
it("drops previews and highlight when the draft is edited or account binding changes", async () => {
  await select();
  await act(async () => changeDraft("@陈曦（产品合作） 后续文字"));
  expect(host.querySelector("mark")).not.toBeNull();
  await act(async () => changeBinding("account-two"));
  expect(host.querySelector("mark")).toBeNull();
  expect(host.querySelector('[aria-label="已选择的文字引用"]')).toBeNull();
});
it("hides a reference when the authorized directory fails", async () => {
  await select();
  fixture.failed = true;
  await act(async () => changeDraft("@陈曦（产品合作） 继续"));
  expect(host.querySelector("mark")).toBeNull();
  expect(host.querySelector('[aria-label="已选择的文字引用"]')).toBeNull();
});

it("keeps the preview open when mouse hover is followed by a click", async () => {
  await select();
  const reference = host.querySelector<HTMLButtonElement>('[aria-label="查看 陈曦 的引用信息"]')!;
  await act(async () => reference.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
  expect(document.querySelector('[aria-label="陈曦 的简要资料"]')).not.toBeNull();
  await act(async () => reference.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
  expect(document.querySelector('[aria-label="陈曦 的简要资料"]')).not.toBeNull();
  await act(async () => reference.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })));
  await act(async () => reference.click());
  expect(document.querySelector('[aria-label="陈曦 的简要资料"]')).toBeNull();
});

it("replaces an existing span instead of duplicating it when the same person is reselected", async () => {
  const original = fixture.people[0].contexts;
  fixture.people[0].contexts = [];
  try {
    await select();
    await act(async () => changeDraft("@陈曦 hello"));
    await act(async () => {
      const input = host.querySelector("textarea")!;
      input.setSelectionRange(3, 3);
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowLeft" }));
    });
    await select();
    expect(host.querySelectorAll("mark")).toHaveLength(1);
    expect(host.querySelector('[data-composer-mention-mirror]')?.textContent?.replace("\u200b", "")).toBe(host.querySelector("textarea")!.value);
    expect(host.querySelectorAll('[aria-label="查看 陈曦 的引用信息"]')).toHaveLength(1);
  } finally { fixture.people[0].contexts = original; }
});

it("keeps a touch-opened preview visible after the finger leaves the trigger", async () => {
  await select();
  vi.useFakeTimers();
  try {
    const reference = host.querySelector<HTMLButtonElement>('[aria-label="查看 陈曦 的引用信息"]')!;
    await act(async () => reference.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "touch" })));
    await act(async () => reference.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    await act(async () => reference.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "touch" })));
    await act(async () => vi.advanceTimersByTime(250));
    expect(document.querySelector('[aria-label="陈曦 的简要资料"]')).not.toBeNull();
  } finally { vi.useRealTimers(); }
});
