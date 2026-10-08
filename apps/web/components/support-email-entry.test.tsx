// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportEmailEntry } from "./support-email-entry";
import { siteConfig } from "@/lib/site";
const state = vi.hoisted(() => ({ legacy: false }));
vi.mock("./desktop-chrome", () => ({ useDesktopChrome: () => state.legacy ? { supportMailHandoff: false } : null }));
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; state.legacy = false; document.body.innerHTML = ""; vi.restoreAllMocks(); });
async function render() {
  const element = document.createElement("div"); document.body.append(element);
  root = createRoot(element);
  await act(async () => root!.render(<SupportEmailEntry className="download-action" subject="Request capri access">Request invite</SupportEmailEntry>));
  return element;
}
describe("download email entry compatibility", () => {
  it("keeps the styled browser mail action and invitation subject", async () => {
    const element = await render();
    expect(element.querySelector("a")?.getAttribute("href")).toBe(`mailto:${siteConfig.email}?subject=Request%20capri%20access`);
    expect(element.querySelector("a")?.className).toBe("download-action");
  });
  it("gives legacy Mac hosts a working copy action instead of a blocked mail link", async () => {
    state.legacy = true;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const element = await render();
    expect(element.querySelector("a")).toBeNull();
    expect(element.querySelector("span")?.className).not.toContain("download-action");
    await act(async () => element.querySelector("button")!.click());
    expect(writeText).toHaveBeenCalledWith(siteConfig.email);
    expect(element.textContent).toContain("已复制支持邮箱");
  });
});
