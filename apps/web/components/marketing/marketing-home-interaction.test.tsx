// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MarketingHome } from "./marketing-home";

it("withdraws the dependent continuity example and restores it only through a new demo", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const click = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find(element => element.textContent === label);
    expect(button).toBeDefined();
    await act(() => button!.click());
  };
  try {
    await act(() => root.render(<MarketingHome locale="zh-CN" />));
    expect(host.querySelector("#method")?.textContent).toContain("收到，我周末看看");
    await click("移除来源");
    expect(host.querySelector("#method")?.textContent).not.toContain("收到，我周末看看");
    expect(host.querySelector("#method")?.textContent).toContain("来源已移除");
    await click("开始新的合成演示");
    expect(host.querySelector("#method")?.textContent).toContain("收到，我周末看看");
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
