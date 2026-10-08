// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyCode } from "./copy-code";

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
async function render(code = "safe template") {
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element); roots.push(root);
  await act(async () => root.render(<CopyCode code={code} label="Terminal" locale="zh-CN" />));
  return element;
}
describe("copy feedback", () => {
  it("reports success only after the clipboard resolves and copies exact multiline text", async () => {
    let complete!: () => void;
    const writeText = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const element = await render("line 1\nline 2");
    await act(async () => element.querySelector("button")!.click());
    expect(element.textContent).not.toContain("已复制");
    await act(async () => complete());
    expect(writeText).toHaveBeenCalledWith("line 1\nline 2");
    expect(element.querySelector('[role="status"]')?.textContent).toContain("已复制");
  });
  it("preserves selectable text and a retry button when clipboard access fails", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const element = await render();
    await act(async () => element.querySelector("button")!.click());
    expect(element.querySelector('[role="status"]')?.textContent).toContain("手动复制");
    expect(element.querySelector("code")?.textContent).toBe("safe template");
    expect(element.querySelector("button")?.disabled).toBe(false);
    expect(element.textContent).not.toContain("已复制");
  });
});
