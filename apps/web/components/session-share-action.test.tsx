// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionShareAction } from "./session-share-action";
import { LocaleProvider } from "./locale-provider";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let host: HTMLDivElement;
let root: Root;
let writeText: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<LocaleProvider locale="en"><SessionShareAction id={id} /></LocaleProvider>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("copies only the authenticated path, without the current query or fragment", async () => {
  history.replaceState(null, "", "/workspace?private=token#private");
  await act(async () => host.querySelector("button")!.click());
  expect(writeText).toHaveBeenCalledExactlyOnceWith(`${location.origin}/workspace/sessions/${id}`);
  expect(host.textContent).toContain("Link copied");
  expect(host.textContent).toContain("signed in to this account");
});
it("lets the person choose the share destination and treats cancellation as cancellation", async () => {
  const share = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  await act(async () => host.querySelector("button")!.click());
  expect(share).toHaveBeenCalledExactlyOnceWith({ url: `${location.origin}/workspace/sessions/${id}` });
  expect(writeText).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Link copied");
});
