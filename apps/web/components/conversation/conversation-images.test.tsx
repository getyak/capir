// @vitest-environment happy-dom
//
// GET-137 conversation images. One sent image renders directly; several fold
// into overlapping cards with a count and explicit expand/collapse. Clicking
// an exact thumbnail opens only that image with previous/next navigation in
// the original manifest order. The viewer keeps fit/100% zoom, blob-only
// open/download with the original file name on explicit clicks, blank-space
// close without image/control close, honest retryable failures with no
// renumbering, and object URL revocation on unmount.
import { Activity, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ConversationImageManifest } from "@talent-signal/contracts";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../workspace-session-request", () => ({
  WORKSPACE_SESSION_EXPIRED_EVENT: "talent-signal:workspace-session-expired",
  workspaceSessionFetch: fetcher,
  workspaceSessionExpired: () => false,
  relationshipIntegrationFetch: fetcher,
  relationshipIntegrationSessionExpired: () => false,
}));

import {
  setConversationImageStoreForTest,
  type ConversationImageStore,
  type DurableConversationImage,
} from "@/lib/conversation-image-store";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import { ConversationImageStrip } from "./conversation-images";
import { QueuedConversation } from "./queued-conversation";
import styles from "./queued-conversation.module.css";

const SESSION = "33333333-3333-4333-8333-333333333333";
const MESSAGE = "44444444-4444-4444-8444-444444444444";

function imageManifest(position: number, name?: string): ConversationImageManifest {
  return {
    attachment_id: `f0000000-0000-4000-8000-${String(position).padStart(12, "0")}`,
    file_name: name ?? `photo-${position + 1}.png`,
    media_type: "image/png",
    byte_size: 8,
    content_hash: "a".repeat(64),
  };
}

function records(...blobs: Blob[]): DurableConversationImage[] {
  return blobs.map((blob, position) => ({ ...imageManifest(position), position, blob, expiresAt: Date.now() + 60_000 }));
}

function storeWith(images: DurableConversationImage[], options: { getThrows?: boolean } = {}): ConversationImageStore {
  return {
    async put() { return true; },
    async get() {
      if (options.getThrows) throw new Error("STORAGE_DENIED");
      return images;
    },
    async delete() {},
    async deletePrefix() {},
    async inventory() { return []; },
  };
}

function pngBytes(): Blob {
  return new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: "image/png" });
}

let mount: HTMLDivElement | null = null;
let root: Root | null = null;
let createdUrls: string[] = [];
let revokedUrls: string[] = [];

async function flush(times = 8): Promise<void> {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  });
}

async function renderStrip(props: {
  images: ConversationImageManifest[];
  local?: boolean;
}): Promise<void> {
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => {
    root?.render(createElement(ConversationImageStrip, {
      binding: "chat-binding",
      images: props.images,
      local: props.local ?? false,
      messageId: MESSAGE,
      scope: "a".repeat(64),
      sessionId: SESSION,
    }));
  });
  await flush();
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === label
    || node.textContent === label);
  expect(found, `missing button ${label}`).toBeTruthy();
  return found as HTMLButtonElement;
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[role='dialog']");
  expect(found, "viewer dialog is not open").toBeTruthy();
  return found!;
}

function dialogImage(): HTMLImageElement {
  const images = dialog().querySelectorAll("img");
  expect(images).toHaveLength(1);
  return images[0] as HTMLImageElement;
}

function positionText(): string {
  return dialog().querySelector(`.${styles.imagePosition}`)?.textContent ?? "";
}

// Host protocol fixture only: happy-dom does not decode these synthetic bytes.
// The protected browser checks use the actual valid PNG and natural dimensions.
async function decodeThumbnails(): Promise<void> {
  await act(async () => {
    for (const image of document.querySelectorAll<HTMLImageElement>("ul img")) {
      Object.defineProperties(image, { naturalWidth: { value:480, configurable:true }, naturalHeight: { value:240, configurable:true } });
      image.dispatchEvent(new window.Event("load"));
    }
  });
}

// Two images where the second fails its first read; the viewer is opened on
// the healthy image and stepped onto the unavailable one, which is the only
// way a keyboard user reaches the inline Retry inside the viewer.
async function openFailedImage(): Promise<void> {
  fetcher.mockImplementation((url: string) => String(url).endsWith("/1")
    ? Promise.resolve(new Response("unavailable", { status: 500 }))
    : Promise.resolve(new Response(pngBytes())));
  await renderStrip({ images: [imageManifest(0), imageManifest(1)] });
  await act(async () => { document.querySelector<HTMLButtonElement>("button[title='查看原图 1']")!.click(); });
  await flush();
  await act(async () => {
    dialog().dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  });
  expect(dialog().textContent).toContain("这张图片暂时无法读取。");
}

function viewerImageCount(): number {
  return dialog().querySelectorAll("img").length;
}

it("keeps one focused retry control through pending read and decoded recovery, then opens the exact image", async () => {
  fetcher.mockResolvedValueOnce(new Response("unavailable", {status:500}));
  await renderStrip({images:[imageManifest(0)]});
  const retry = button("重新读取图片"); retry.focus();
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  await act(async () => { retry.click(); retry.click(); }); await flush();
  expect(retry.isConnected).toBe(true); expect(document.activeElement).toBe(retry);
  expect(retry.disabled).toBe(false); expect(retry.getAttribute("aria-busy")).toBe("true");
  expect(fetcher).toHaveBeenCalledTimes(2);
  finish(new Response(pngBytes())); await flush();
  expect(retry.getAttribute("aria-busy")).toBe("true"); // Blob arrival is not pixel recovery.
  await decodeThumbnails();
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute("aria-label")).toBe("已重新读取，查看原图 1");
  await act(async () => retry.click()); await flush();
  expect(dialogImage().alt).toBe("photo-1.png");
  await act(async () => document.activeElement?.dispatchEvent(new window.KeyboardEvent("keydown", {key:"Escape",bubbles:true,cancelable:true}))); await flush();
  expect(document.activeElement).toBe(retry);
});

it("keeps the same control retryable after a repeated read failure without claiming recovery", async () => {
  fetcher.mockResolvedValue(new Response("unavailable", {status:500}));
  await renderStrip({images:[imageManifest(0)]});
  const retry = button("重新读取图片"); retry.focus();
  await act(async () => retry.click()); await flush();
  expect(retry.isConnected).toBe(true); expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute("aria-busy")).not.toBe("true");
  expect(retry.textContent).toBe("重新读取图片");
  expect(document.body.textContent).not.toContain("图片已重新读取");
});

it("does not steal a user's moved focus when the retry finishes decoding", async () => {
  fetcher.mockResolvedValueOnce(new Response("unavailable", {status:500}));
  await renderStrip({images:[imageManifest(0)]});
  const retry = button("重新读取图片"); retry.focus();
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  await act(async () => retry.click()); await flush();
  const other = document.createElement("button"); document.body.append(other); other.focus();
  try {
    finish(new Response(pngBytes())); await flush(); await decodeThumbnails();
    expect(document.activeElement).toBe(other);
    expect(retry.getAttribute("aria-label")).toBe("已重新读取，查看原图 1");
  } finally { other.remove(); }
});

it("keeps a decoding failure retryable and revokes its failed bytes", async () => {
  fetcher.mockResolvedValueOnce(new Response("unavailable", {status:500}));
  await renderStrip({images:[imageManifest(0)]});
  const retry = button("重新读取图片"); retry.focus();
  await act(async () => retry.click()); await flush();
  const image = document.querySelector<HTMLImageElement>("ul img")!, url = image.src;
  await act(async () => image.dispatchEvent(new window.Event("error")));
  expect(document.activeElement).toBe(retry);
  expect(retry.textContent).toBe("重新读取图片");
  expect(retry.getAttribute("aria-busy")).not.toBe("true");
  expect(revokedUrls).toContain(url);
  expect(document.body.textContent).not.toContain("图片已重新读取");
});

it("keeps the same focused inline Retry mounted through a pending read with a synchronous duplicate guard", async () => {
  await openFailedImage();
  const retry = button("重新读取"); retry.focus();
  let finish!: (response: Response) => void;
  fetcher.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  await act(async () => { retry.click(); retry.click(); }); await flush();
  // The second activation is dropped synchronously: one retry read only.
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/1"))).toHaveLength(2);
  expect(retry.isConnected).toBe(true);
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute("aria-busy")).toBe("true");
  expect(retry.getAttribute("aria-disabled")).toBe("true");
  expect(retry.textContent).toBe("重新读取");
  // A late failure returns to the SAME control without claiming recovery.
  await act(async () => { finish(new Response("unavailable", { status: 500 })); }); await flush();
  expect(button("重新读取")).toBe(retry);
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute("aria-busy")).not.toBe("true");
  expect(document.body.textContent).not.toContain("图片已重新读取");
});

it("keeps the inline Retry through blob arrival until the viewer image really decodes, then hands focus to zoom", async () => {
  await openFailedImage();
  const retry = button("重新读取"); retry.focus();
  let finish!: (response: Response) => void;
  fetcher.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  await act(async () => retry.click()); await flush();
  finish(new Response(pngBytes())); await flush();
  // Bytes available is not pixel recovery: the SAME control stays mounted.
  expect(button("重新读取")).toBe(retry);
  expect(retry.isConnected).toBe(true);
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute("aria-busy")).toBe("true");
  expect(viewerImageCount()).toBe(1);
  expect(dialogImage().alt).toBe("photo-2.png");
  expect(document.body.textContent).not.toContain("图片已重新读取");
  // Only the CURRENT viewer image's real successful onLoad finishes the retry.
  await act(async () => dialogImage().dispatchEvent(new window.Event("load")));
  expect(retry.isConnected).toBe(false);
  expect(document.activeElement).toBe(button("缩放 适应窗口，点击切换为原始 100%"));
});

it("keeps the same focused inline Retry after a repeated failure without a false recovery", async () => {
  await openFailedImage();
  const retry = button("重新读取"); retry.focus();
  fetcher.mockImplementation(() => Promise.resolve(new Response("unavailable", { status: 500 })));
  await act(async () => retry.click()); await flush();
  await act(async () => retry.click()); await flush();
  expect(button("重新读取")).toBe(retry);
  expect(retry.isConnected).toBe(true);
  expect(document.activeElement).toBe(retry);
  expect(retry.textContent).toBe("重新读取");
  expect(retry.getAttribute("aria-busy")).not.toBe("true");
  expect(document.body.textContent).not.toContain("图片已重新读取");
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/1"))).toHaveLength(3);
});

it("keeps the same focused inline Retry on a decode failure and revokes its failed bytes", async () => {
  await openFailedImage();
  const retry = button("重新读取"); retry.focus();
  fetcher.mockImplementation(() => Promise.resolve(new Response(pngBytes())));
  await act(async () => retry.click()); await flush();
  const brokenUrl = dialogImage().src;
  await act(async () => dialogImage().dispatchEvent(new window.Event("error")));
  expect(button("重新读取")).toBe(retry);
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute("aria-busy")).not.toBe("true");
  expect(revokedUrls).toContain(brokenUrl);
  expect(document.body.textContent).not.toContain("图片已重新读取");
});

it("never steals a moved focus when the retried image finishes decoding", async () => {
  await openFailedImage();
  const retry = button("重新读取"); retry.focus();
  let finish!: (response: Response) => void;
  fetcher.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  await act(async () => retry.click()); await flush();
  finish(new Response(pngBytes())); await flush();
  // The user picks another control inside the modal while the bytes decode.
  const other = button("下载原图");
  other.focus();
  await act(async () => dialogImage().dispatchEvent(new window.Event("load")));
  expect(document.activeElement).toBe(other);
  expect(retry.isConnected).toBe(false);
});

it.each(["left-and-returned", "activated-without-focus"] as const)("keeps an explicit recovered action after %s, with no automatic focus or second GET", async kind => {
  await openFailedImage();
  const retry = button("重新读取");
  const other = button("上一张图片");
  if (kind === "left-and-returned") retry.focus(); else other.focus();
  let finish!: (response: Response) => void;
  fetcher.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
  await act(async () => retry.click()); await flush();
  await act(async () => { other.focus(); retry.focus(); });
  expect(button("重新读取")).toBe(retry);
  finish(new Response(pngBytes())); await flush();
  await act(async () => dialogImage().dispatchEvent(new window.Event("load")));
  expect(document.activeElement).toBe(retry);
  expect(button("查看已恢复图片")).toBe(retry);
  expect(retry.getAttribute("aria-busy")).not.toBe("true");
  const calls = fetcher.mock.calls.length;
  await act(async () => retry.click());
  expect(fetcher.mock.calls).toHaveLength(calls);
  expect(document.activeElement).toBe(button("缩放 适应窗口，点击切换为原始 100%"));
});

it("retires a retained recovered action only after the user leaves it", async () => {
  await openFailedImage(); const retry = button("重新读取"); retry.focus();
  let finish!: (response: Response) => void;
  fetcher.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
  await act(async () => retry.click()); await flush();
  const other = button("上一张图片");
  await act(async () => { other.focus(); retry.focus(); });
  finish(new Response(pngBytes())); await flush();
  await act(async () => dialogImage().dispatchEvent(new window.Event("load")));
  expect(document.activeElement).toBe(retry);
  await act(async () => other.focus());
  expect(document.activeElement).toBe(other); expect(retry.isConnected).toBe(false);
});

it("cancels the handoff on stepping away and keeps the late one-image read alive", async () => {
  await openFailedImage();
  const retry = button("重新读取"); retry.focus();
  let finish!: (response: Response) => void;
  fetcher.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  await act(async () => retry.click()); await flush();
  const previous = button("上一张图片");
  await act(async () => { previous.focus(); previous.click(); }); await flush();
  expect(document.activeElement).toBe(previous);
  const before = createdUrls.length;
  finish(new Response(pngBytes())); await flush();
  // Cancelling UI focus work never cancels the shared read pipeline.
  expect(createdUrls).toHaveLength(before + 1);
  const next = button("下一张图片");
  await act(async () => { next.focus(); next.click(); }); await flush();
  await act(async () => dialogImage().dispatchEvent(new window.Event("load")));
  expect(document.activeElement).toBe(next);
});

it("cancels the handoff on close so a late result never steals focus", async () => {
  await openFailedImage();
  const retry = button("重新读取"); retry.focus();
  let finish!: (response: Response) => void;
  fetcher.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  await act(async () => retry.click()); await flush();
  const trigger = document.querySelector<HTMLButtonElement>("button[title='查看原图 1']")!;
  await act(async () => {
    document.activeElement?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await flush();
  expect(document.querySelector("[role='dialog']")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  finish(new Response(pngBytes())); await flush(); await decodeThumbnails();
  expect(document.activeElement).toBe(trigger);
  expect(document.body.textContent).not.toContain("图片已重新读取，可查看原图");
});

it("retries local bytes in the same scope without using the server proxy", async () => {
  setConversationImageStoreForTest(storeWith([], {getThrows:true}));
  await renderStrip({images:[imageManifest(0)],local:true});
  const retry = button("重新读取图片"); retry.focus();
  setConversationImageStoreForTest(storeWith(records(pngBytes())));
  await act(async () => retry.click()); await flush(); await decodeThumbnails();
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute("aria-label")).toBe("已重新读取，查看原图 1");
  expect(fetcher).not.toHaveBeenCalled();
});

it("preserves expansion and manifest order, recovering the first failed attachment rather than the first image", async () => {
  let fail = true;
  fetcher.mockImplementation((url: string) => {
    if (url.endsWith("/1") && fail) { fail = false; return Promise.resolve(new Response("unavailable", {status:500})); }
    return Promise.resolve(new Response(pngBytes()));
  });
  await renderStrip({images:[imageManifest(0),imageManifest(1),imageManifest(2)]}); await decodeThumbnails();
  await act(async () => button("展开图片").click());
  const retry = button("重新读取图片"); retry.focus(); const previousUrls = [...createdUrls];
  await act(async () => retry.click()); await flush();
  expect(document.querySelector("[data-layout='expanded']")).not.toBeNull();
  await decodeThumbnails();
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute("aria-label")).toBe("已重新读取，查看原图 2");
  expect([...document.querySelectorAll("ul img")].map(e => e.getAttribute("alt"))).toEqual(["photo-1.png","photo-2.png","photo-3.png"]);
  expect(previousUrls.every(url => revokedUrls.includes(url))).toBe(true);
  await act(async () => retry.click()); await flush();
  expect(dialogImage().alt).toBe("photo-2.png"); expect(positionText()).toBe("2 / 3");
});

it.each(["binding", "scope", "sessionId", "messageId", "images", "local", "unmount"] as const)("discards a pending retry across %s ownership changes", async (kind) => {
  const base = {binding:"chat-binding",scope:"a".repeat(64),sessionId:SESSION,messageId:MESSAGE,images:[imageManifest(0)],local:false};
  fetcher.mockResolvedValueOnce(new Response("unavailable", {status:500}));
  await renderStrip({images:base.images});
  const retry = button("重新读取图片"); retry.focus();
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  await act(async () => retry.click()); await flush();
  if (kind === "unmount") { await act(async () => root?.unmount()); root = null; }
  else {
    const next = {...base};
    if (kind === "images") next.images = [imageManifest(1, "new-owner.png")];
    else if (kind === "local") { next.local = true; setConversationImageStoreForTest(storeWith(records(pngBytes()))); }
    else next[kind] = kind === "scope" ? "b".repeat(64) : "new-owner";
    await act(async () => root?.render(createElement(ConversationImageStrip,next))); await flush(); await decodeThumbnails();
  }
  expect(retry.isConnected).toBe(false);
  const count = createdUrls.length;
  const other = document.createElement("button"); document.body.append(other); other.focus();
  try {
    finish(new Response(pngBytes())); await flush();
    expect(createdUrls).toHaveLength(count);
    expect(document.activeElement).toBe(other);
    expect(document.body.textContent).not.toContain("图片已重新读取，可查看原图");
  } finally { other.remove(); }
});

it("discards late local retry bytes after the message switches to server history", async () => {
  setConversationImageStoreForTest(storeWith([], {getThrows:true}));
  await renderStrip({images:[imageManifest(0)],local:true});
  let finish!: (records: DurableConversationImage[]) => void;
  setConversationImageStoreForTest({...storeWith([]), get: () => new Promise(resolve => { finish = resolve; })});
  await act(async () => button("重新读取图片").click()); await flush();
  await act(async () => root?.render(createElement(ConversationImageStrip, {binding:"chat-binding",scope:"a".repeat(64),sessionId:SESSION,messageId:MESSAGE,images:[imageManifest(0)],local:false})));
  await flush(); await decodeThumbnails();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const serverUrl = document.querySelector<HTMLImageElement>("ul img")!.src;
  finish(records(pngBytes())); await flush();
  expect(document.querySelector<HTMLImageElement>("ul img")!.src).toBe(serverUrl);
  expect(createdUrls).toEqual([serverUrl]);
});

it("restarts a retained Activity read honestly before it can reuse a recovered control", async () => {
  const props = {binding:"chat-binding",scope:"a".repeat(64),sessionId:SESSION,messageId:MESSAGE,images:[imageManifest(0)],local:false};
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
  const render = async (mode: "visible" | "hidden") => {
    await act(async () => root?.render(<Activity mode={mode}><ConversationImageStrip {...props} /></Activity>));
    await flush();
  };
  fetcher.mockResolvedValueOnce(new Response("unavailable", {status:500}));
  await render("visible");
  const retry = button("重新读取图片");
  await act(async () => retry.click()); await flush(); await decodeThumbnails();
  expect(retry.getAttribute("aria-label")).toBe("已重新读取，查看原图 1");
  const previous = [...createdUrls];
  await render("hidden");
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  await render("visible");
  expect(retry.isConnected).toBe(true);
  expect(retry.getAttribute("aria-busy")).toBe("true");
  expect(retry.getAttribute("aria-label") ?? "").not.toContain("已重新读取");
  expect(document.querySelector("ul img")).toBeNull();
  expect(previous.every(url => revokedUrls.includes(url))).toBe(true);
  finish(new Response(pngBytes())); await flush(); await decodeThumbnails();
  expect(retry.getAttribute("aria-label")).toBe("已重新读取，查看原图 1");
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  createdUrls = [];
  revokedUrls = [];
  fetcher.mockReset();
  fetcher.mockImplementation((url: string) => {
    if (String(url).includes("/conversation-images/")) {
      return Promise.resolve(new Response(pngBytes()));
    }
    return Promise.resolve(Response.json({}));
  });
  let counter = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    counter += 1;
    const url = `blob:synthetic-${counter}`;
    createdUrls.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => { revokedUrls.push(String(url)); });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  mount?.remove();
  mount = null;
  setConversationImageStoreForTest(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("renders one sent image directly and reads its bytes only through the protected proxy", async () => {
  await renderStrip({ images: [imageManifest(0, "screenshot.png")] });

  expect(document.querySelector("[data-layout='single']")).not.toBeNull();
  expect(document.querySelector("[aria-label='消息中的 1 张图片']")).not.toBeNull();
  const image = document.querySelector("img[alt='screenshot.png']") as HTMLImageElement;
  expect(image).toBeTruthy();
  // The pixel source is the mounted object URL, never a sensitive URL.
  expect(image.src).toBe(createdUrls[0]);
  expect(image.src.startsWith("blob:")).toBe(true);
  const [path, init] = fetcher.mock.calls[0] as [string, RequestInit];
  expect(path).toBe(`/api/workspace-sessions/${SESSION}/conversation-images/${MESSAGE}/0`);
  expect((init.headers as Record<string, string>)["x-workspace-session"]).toBe("chat-binding");
  expect(fetcher.mock.calls.every(([url]) => String(url).includes("/api/workspace-sessions/"))).toBe(true);
});

it("folds multiple sent images into overlapping cards with a count and explicit expand/collapse", async () => {
  setConversationImageStoreForTest(storeWith(records(pngBytes(), pngBytes(), pngBytes())));
  await renderStrip({ images: [imageManifest(0), imageManifest(1), imageManifest(2)], local: true });

  const strip = document.querySelector("[data-layout='folded']") as HTMLElement;
  expect(strip).toBeTruthy();
  expect(strip.textContent).toContain("3 张图片");
  const toggle = button("展开图片");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  // Manifest order survives the folded presentation.
  expect([...document.querySelectorAll("[aria-label='消息中的 3 张图片'] img")].map((node) => node.getAttribute("alt")))
    .toEqual(["photo-1.png", "photo-2.png", "photo-3.png"]);

  await act(async () => { toggle.click(); });
  expect(document.querySelector("[data-layout='expanded']")).not.toBeNull();
  expect(button("收起图片").getAttribute("aria-expanded")).toBe("true");
  await act(async () => { button("收起图片").click(); });
  expect(document.querySelector("[data-layout='folded']")).not.toBeNull();
});

it("opens only the clicked image and navigates in the original manifest order", async () => {
  setConversationImageStoreForTest(storeWith(records(pngBytes(), pngBytes(), pngBytes())));
  await renderStrip({ images: [imageManifest(0), imageManifest(1), imageManifest(2)], local: true });

  await act(async () => { document.querySelector<HTMLButtonElement>("button[title='查看原图 2']")!.click(); });
  await flush();
  expect(dialogImage().alt).toBe("photo-2.png");
  expect(positionText()).toContain("2 / 3");

  await act(async () => {
    dialog().dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  });
  expect(dialogImage().alt).toBe("photo-3.png");
  expect(positionText()).toContain("3 / 3");

  await act(async () => { button("下一张图片").click(); });
  // Navigation wraps along the immutable manifest order.
  expect(dialogImage().alt).toBe("photo-1.png");
  expect(positionText()).toContain("1 / 3");

  await act(async () => { button("上一张图片").click(); });
  expect(dialogImage().alt).toBe("photo-3.png");
  await act(async () => {
    dialog().dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
  });
  expect(dialogImage().alt).toBe("photo-2.png");
});

it("closes on blank dialog space only, never on image or control clicks", async () => {
  setConversationImageStoreForTest(storeWith(records(pngBytes(), pngBytes())));
  await renderStrip({ images: [imageManifest(0), imageManifest(1)], local: true });
  await act(async () => { document.querySelector<HTMLButtonElement>("button[title='查看原图 1']")!.click(); });
  await flush();

  await act(async () => { dialogImage().click(); });
  expect(document.querySelector("[role='dialog']")).not.toBeNull();
  await act(async () => { button("下载原图").click(); });
  expect(document.querySelector("[role='dialog']")).not.toBeNull();

  // Blank space closes gracefully.
  await act(async () => { dialog().click(); });
  await flush();
  expect(document.querySelector("[role='dialog']")).toBeNull();
});

it("keeps zoom as a compact fit/100% percentage toggle", async () => {
  setConversationImageStoreForTest(storeWith(records(pngBytes())));
  await renderStrip({ images: [imageManifest(0)], local: true });
  await act(async () => { document.querySelector<HTMLButtonElement>("button[title='查看原图 1']")!.click(); });
  await flush();

  const zoom = button("缩放 适应窗口，点击切换为原始 100%");
  expect(zoom.textContent).toBe("适应");
  expect(dialogImage().dataset.zoom).toBe("fit");
  await act(async () => { zoom.click(); });
  expect(button("缩放 100%（原始大小），点击切换为适应窗口").textContent).toBe("100%");
  expect(dialogImage().dataset.zoom).toBe("actual");
  await act(async () => { button("缩放 100%（原始大小），点击切换为适应窗口").click(); });
  expect(button("缩放 适应窗口，点击切换为原始 100%").textContent).toBe("适应");
});

it("lets keyboard users pan the actual-size stage while retaining navigation on viewer controls", async () => {
  await renderStrip({ images: [imageManifest(0), imageManifest(1)] });
  await act(async () => { document.querySelector<HTMLButtonElement>("button[title='查看原图 1']")!.click(); });
  await flush();
  await act(async () => { button("缩放 适应窗口，点击切换为原始 100%").click(); });
  const stage = dialog().querySelector<HTMLElement>(`.${styles.imageStage}`)!;
  stage.focus();
  expect(document.activeElement).toBe(stage);
  const pan = new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
  await act(async () => { stage.dispatchEvent(pan); });
  expect(pan.defaultPrevented).toBe(false);
  expect(positionText()).toBe("1 / 2");

  const next = button("下一张图片");
  next.focus();
  const navigate = new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
  await act(async () => { next.dispatchEvent(navigate); });
  expect(navigate.defaultPrevented).toBe(true);
  expect(positionText()).toBe("2 / 2");
});

it("downloads and opens the exact original bytes only on explicit clicks with the original file name", async () => {
  const anchors: Array<{ download: string; href: string }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    anchors.push({ download: this.download, href: this.href });
  });
  const opened: Array<[string | URL | undefined, string | undefined]> = [];
  vi.spyOn(window, "open").mockImplementation((url, target) => {
    opened.push([url as string | undefined, target as string | undefined]);
    return null;
  });
  setConversationImageStoreForTest(storeWith(records(pngBytes(), pngBytes())));
  await renderStrip({ images: [imageManifest(0), imageManifest(1, "原始截图 final.png")], local: true });
  await act(async () => { document.querySelector<HTMLButtonElement>("button[title='查看原图 2']")!.click(); });
  await flush();

  expect(anchors).toHaveLength(0);
  expect(opened).toHaveLength(0);
  await act(async () => { button("下载原图").click(); });
  expect(anchors).toHaveLength(1);
  expect(anchors[0]!.download).toBe("原始截图 final.png");
  expect(anchors[0]!.href).toBe(createdUrls[1]);
  expect(anchors[0]!.href.startsWith("blob:")).toBe(true);

  await act(async () => { button("在新标签页打开原图").click(); });
  expect(opened).toHaveLength(1);
  expect(String(opened[0]![0])).toBe(createdUrls[1]);
  expect(String(opened[0]![0]).startsWith("blob:")).toBe(true);
});

it("keeps an unavailable image honest, in place and retryable inside the viewer", async () => {
  let failures = 1;
  fetcher.mockImplementation((url: string) => {
    if (String(url).endsWith("/conversation-images/" + MESSAGE + "/1") && failures > 0) {
      failures -= 1;
      return Promise.resolve(new Response("nope", { status: 500 }));
    }
    if (String(url).includes("/conversation-images/")) return Promise.resolve(new Response(pngBytes()));
    return Promise.resolve(Response.json({}));
  });
  await renderStrip({ images: [imageManifest(0), imageManifest(1), imageManifest(2)] });

  const items = document.querySelectorAll("[aria-label='消息中的 3 张图片'] li");
  expect(items).toHaveLength(3);
  // The unavailable item keeps its manifest position and total count.
  expect(items[1]!.textContent).toContain("图片暂时无法读取");
  expect(document.body.textContent).toContain("3 张图片");
  expect(document.body.textContent).toContain("重新读取图片");

  // The viewer reaches the unavailable item by order and says so honestly.
  await act(async () => { document.querySelector<HTMLButtonElement>("button[title='查看原图 3']")!.click(); });
  await flush();
  expect(positionText()).toContain("3 / 3");
  await act(async () => {
    dialog().dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
  });
  expect(dialog().textContent).toContain("这张图片暂时无法读取。");
  expect(positionText()).toContain("2 / 3");

  await act(async () => { button("重新读取").click(); });
  await flush();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/conversation-images/" + MESSAGE + "/1"))).toHaveLength(2);
  expect(dialogImage().alt).toBe("photo-2.png");
  expect(positionText()).toContain("2 / 3");
});

it("replaces a decoded-image failure with an honest retry while preserving its manifest position", async () => {
  await renderStrip({ images: [imageManifest(0), imageManifest(1)] });
  await act(async () => { document.querySelector<HTMLButtonElement>("button[title='查看原图 2']")!.click(); });
  await flush();
  const brokenUrl = dialogImage().src;
  await act(async () => { dialogImage().dispatchEvent(new window.Event("error")); });

  expect(dialog().querySelector("img")).toBeNull();
  expect(dialog().textContent).toContain("这张图片暂时无法读取。");
  expect(positionText()).toBe("2 / 2");
  expect(button("下载原图").disabled).toBe(true);
  expect(button("在新标签页打开原图").disabled).toBe(true);
  expect(revokedUrls).toContain(brokenUrl);

  await act(async () => { button("重新读取").click(); });
  await flush();
  expect(dialogImage().alt).toBe("photo-2.png");
  expect(dialogImage().src).not.toBe(brokenUrl);
  expect(positionText()).toBe("2 / 2");
  expect(button("下载原图").disabled).toBe(false);
});

it("restores keyboard focus to the exact clicked thumbnail after Escape", async () => {
  await renderStrip({ images: [imageManifest(0), imageManifest(1)] });
  const trigger = document.querySelector<HTMLButtonElement>("button[title='查看原图 2']")!;
  trigger.focus();
  await act(async () => { trigger.click(); });
  await flush();
  expect(dialog().contains(document.activeElement)).toBe(true);
  await act(async () => {
    document.activeElement?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await flush();
  expect(document.querySelector("[role='dialog']")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("ends a rejected local durable read in a retryable state instead of endless loading", async () => {
  setConversationImageStoreForTest(storeWith([], { getThrows: true }));
  await renderStrip({ images: [imageManifest(0)], local: true });

  expect(document.body.textContent).not.toContain("正在读取图片");
  expect(document.body.textContent).toContain("图片暂时无法读取");
  expect(document.body.textContent).toContain("重新读取图片");
});

it("stops sequential protected reads and creates no URL after the strip unmounts", async () => {
  let finish!: (response: Response) => void;
  fetcher.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  await renderStrip({ images: [imageManifest(0), imageManifest(1)] });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => root?.unmount());
  root = null;
  finish(new Response(pngBytes()));
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(createdUrls).toHaveLength(0);
});

it("revokes every created object URL when the strip unmounts", async () => {
  setConversationImageStoreForTest(storeWith(records(pngBytes(), pngBytes())));
  await renderStrip({ images: [imageManifest(0), imageManifest(1)], local: true });
  expect(createdUrls).toHaveLength(2);

  await act(async () => root?.unmount());
  root = null;
  expect([...revokedUrls].sort()).toEqual([...createdUrls].sort());
});

it("keeps the user bubble frame off image-bearing sends while text-only messages stay unchanged", async () => {
  const turn = (id: string, objective: string, images: ConversationImageManifest[]) => ({
    id,
    objective,
    images,
    createdAt: "2026-09-29T01:00:00.000Z",
    response: {
      contractVersion: "2026-08-24.10",
      taskID: "77777777-7777-4777-8777-777777777777",
      contextManifestID: "",
      knowledgeSnapshotID: "",
      disposition: "answer",
      createdAt: "2026-09-29T01:00:01.000Z",
      unboundConversationBlocks: [],
    },
  });
  const detail = {
    session_id: SESSION,
    revision: 1,
    updated_at: "2026-09-22T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    state: "active",
    title: "图片对话",
    turn_count: 3,
    is_unread: false,
    scope_kind: "unresolved_intent",
    person_id: null,
    relationship_context_id: null,
    person_label: "",
    context_label: "",
    deleted_at: null,
    display_authority: "stale_unconfirmed",
    composer_draft: null,
    composer_draft_updated_at: null,
    turns: [
      turn("11111111-1111-4111-8111-111111111111", "看这两张截图", [imageManifest(0), imageManifest(1)]),
      turn("22222222-2222-4222-8222-222222222222", "保持原样的文字", []),
      turn("33333333-3333-4333-8333-333333333333", "", [imageManifest(2)]),
    ],
  } as unknown as SessionDetail;

  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => {
    root?.render(createElement(QueuedConversation, {
      chatBinding: "chat-binding",
      detailBinding: "detail-binding",
      initialDetail: detail,
      scope: "a".repeat(64),
    }));
  });
  await flush();

  const rows = [...mount.querySelectorAll(`.${styles.userRow}`)];
  expect(rows).toHaveLength(3);
  const [mixed, textOnly, imageOnly] = rows as [HTMLElement, HTMLElement, HTMLElement];
  const bubble = `.${styles.userMessage}`;
  // Mixed send: readable text bubble, images outside any text bubble frame.
  expect(mixed.querySelector(bubble)?.textContent).toBe("看这两张截图");
  expect(mixed.querySelector(`${bubble} [aria-label^="消息中的"]`)).toBeNull();
  expect(mixed.querySelector("[aria-label='消息中的 2 张图片']")).not.toBeNull();
  // Text-only send keeps the original single bubble and no strip.
  expect(textOnly.querySelector(bubble)?.textContent).toBe("保持原样的文字");
  expect(textOnly.querySelector("[aria-label^='消息中的']")).toBeNull();
  // Image-only send shows the image directly, without an empty bubble frame.
  expect(imageOnly.querySelector(bubble)).toBeNull();
  expect(imageOnly.querySelector("[aria-label='消息中的 1 张图片']")).not.toBeNull();
});
