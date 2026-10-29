// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfirmDialog, CopyButton, ExtensionDialog } from "./workspace-extensions-dialogs";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("announces a pending confirmation while preserving its dismissal fence", async () => {
  const cancel = vi.fn();
  await act(async () => root.render(<ConfirmDialog busy open title="撤销连接" description="当前连接将不可再用。" confirmLabel="撤销连接" onCancel={cancel} onConfirm={() => {}} />));
  const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
  expect(dialog.querySelector("footer")?.getAttribute("aria-busy")).toBe("true");
  expect(document.querySelector("[role=status]")?.textContent).toContain("正在处理");
  await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(document.querySelector("[role=dialog]")).toBe(dialog);
  expect(cancel).not.toHaveBeenCalled();
  expect([...dialog.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
});

it("keeps a ready non-dismissible dialog available without announcing processing", async () => {
  const close = vi.fn();
  vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  await act(async () => root.render(<ExtensionDialog dismissible={false} title="只显示一次的配置" description="保存配置后显式关闭。" footer={<button type="button" onClick={close}>我已保存，关闭</button>} onClose={close}><CopyButton label="复制配置" value="fixture-ready-configuration" /></ExtensionDialog>));
  const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
  expect(dialog.querySelector('[aria-busy="true"]')).toBeNull();
  expect([...dialog.querySelectorAll('[role="status"]')].some(status => status.textContent?.includes("正在处理"))).toBe(false);
  const copy = [...dialog.querySelectorAll("button")].find(button => button.textContent === "复制配置")!;
  await act(async () => copy.click());
  const copied = [...dialog.querySelectorAll('[role="status"]')].find(status => status.textContent === "已复制");
  expect(copied).toBeDefined();
  expect(copied!.closest('[aria-busy="true"]')).toBeNull();
  await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(close).not.toHaveBeenCalled();
  await act(async () => dialog.querySelector<HTMLButtonElement>("footer button")!.click());
  expect(close).toHaveBeenCalledTimes(1);
});

it("restores the keyboard opener after a programmatically mounted dialog closes", async () => {
  function View() {
    const [open, setOpen] = useState(false);
    return <><button type="button" onClick={() => setOpen(true)}>管理连接</button>{open && <ExtensionDialog title="连接详情" description="只读连接信息" footer={<button type="button" onClick={() => setOpen(false)}>完成</button>} onClose={() => setOpen(false)}>连接内容</ExtensionDialog>}</>;
  }
  await act(async () => root.render(<View />));
  const opener = host.querySelector("button")!;
  opener.focus();
  await act(async () => opener.click());
  const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
  await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(document.querySelector("[role=dialog]")).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
});

it.each(["isComposing", "legacy keyCode"])("leaves %s Escape with the input method inside an extension dialog", async (composition) => {
  const close = vi.fn();
  await act(async () => root.render(<ExtensionDialog title="编辑连接" description="修改连接名称" footer={null} onClose={close}><input aria-label="名称" /></ExtensionDialog>));
  const input = document.querySelector<HTMLInputElement>("[role=dialog] input")!;
  const escape = new KeyboardEvent("keydown", { key: "Escape", isComposing: composition === "isComposing", bubbles: true, cancelable: true });
  if (composition === "legacy keyCode") Object.defineProperty(escape, "keyCode", { value: 229 });
  await act(async () => input.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(false);
  expect(document.querySelector("[role=dialog]")).not.toBeNull();
  expect(close).not.toHaveBeenCalled();
});

it("announces clipboard success without changing the copy action name", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  await act(async () => root.render(<CopyButton label="复制地址" value="https://example.test/mcp" />));
  const button = host.querySelector("button")!;
  await act(async () => button.click());
  expect(button.textContent).toBe("复制地址");
  expect(host.querySelector("[role=status]")?.textContent).toBe("已复制");
});

it("keeps clipboard recovery visible until a new attempt", async () => {
  vi.useFakeTimers();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
  await act(async () => root.render(<CopyButton label="复制地址" value="https://example.test/mcp" />));
  await act(async () => host.querySelector("button")!.click());
  await act(async () => vi.advanceTimersByTime(3_000));
  const recovery = host.querySelector("[role=alert]");
  expect(recovery).not.toBeNull();
  expect(recovery!.textContent).toContain("手动选择");
});
