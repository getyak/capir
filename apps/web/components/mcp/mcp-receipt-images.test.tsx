// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { McpToolCallReceipt } from "@talent-signal/contracts";
import { LocaleProvider } from "../locale-provider";
import { McpReceiptImages } from "./mcp-receipt-images";

const callId = "22222222-2222-4222-8222-222222222222";
const receipt = (content: unknown[]) => ({ outcome: "succeeded", call_id: callId, result_json: JSON.stringify({ content }) } as McpToolCallReceipt);
const image = { type: "image", status: "ready", image_index: 0 };
const fetcher = vi.fn();
const createUrl = vi.fn(() => "blob:synthetic-image");
const revokeUrl = vi.fn();
let mount: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl; });
  mount = document.createElement("div"); mount.dataset.workspaceScope = "synthetic-scope";
  document.body.appendChild(mount); root = createRoot(mount);
  fetcher.mockReset(); createUrl.mockClear(); revokeUrl.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); vi.unstubAllGlobals(); });
const flush = () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });

it("renders an authenticated raster blob and releases it when the card leaves", async () => {
  fetcher.mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
  await act(async () => root.render(createElement(McpReceiptImages, { receipt: receipt([image]), sessionVersion: "synthetic-session" })));
  await flush();
  expect(mount.querySelector("img")?.getAttribute("src")).toBe("blob:synthetic-image");
  expect(new Headers(fetcher.mock.calls[0]![1].headers).get("x-workspace-session")).toBe("synthetic-session");
  expect(createUrl).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(revokeUrl).toHaveBeenCalledWith("blob:synthetic-image");
});

it("does not fetch remote URLs or unavailable image descriptors", async () => {
  await act(async () => root.render(createElement(McpReceiptImages, { receipt: receipt([
    { type: "image", status: "unavailable", error_code: "MCP_IMAGE_STORAGE_FAILED", url: "https://untrusted.example/image" },
    { type: "image", status: "ready", image_index: "https://untrusted.example/image" },
  ]), sessionVersion: "synthetic-session" })));
  await flush();
  expect(fetcher).not.toHaveBeenCalled();
  expect(mount.textContent).toContain("无法保存或显示");
  expect(mount.querySelector("img")).toBeNull();
});

it("cancels an old image read when the conversation result leaves", async () => {
  let resolve: (value: Response) => void = () => undefined;
  fetcher.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
  await act(async () => root.render(createElement(McpReceiptImages, { receipt: receipt([image]), sessionVersion: "synthetic-session" })));
  await flush();
  const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  resolve(new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }));
  await flush();
  expect(createUrl).not.toHaveBeenCalled();
});

it("uses the display locale for failure, recovery and alt text without calling the tool again", async () => {
  fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  await act(async () => root.render(
    <LocaleProvider locale="en">
      <McpReceiptImages receipt={receipt([
        { type: "image", status: "unavailable", error_code: "MCP_IMAGE_CONVERSATION_REQUIRED" },
        { type: "image", status: "unavailable", error_code: "MCP_IMAGE_STORAGE_FAILED" }, image,
      ])} sessionVersion="synthetic-session" />
    </LocaleProvider>,
  ));
  await flush();
  expect(mount.textContent).toContain("Images need a conversation to be retained.");
  expect(mount.textContent).toContain("could not be saved or displayed");
  expect(mount.textContent).toContain("The tool will not run again.");
  const retry = mount.querySelector("button")!;
  expect(retry.textContent).toBe("Reload image");
  fetcher.mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
  await act(async () => retry.click());
  await flush();
  expect(mount.querySelector("img")?.getAttribute("alt")).toBe("Image returned by the tool 1");
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetcher.mock.calls) {
    expect(url).toBe(`/api/extensions/tool-calls/${callId}/images/0`);
    expect(init.method).toBeUndefined();
    expect(new Headers(init.headers).get("x-workspace-session")).toBe("synthetic-session");
  }
});
