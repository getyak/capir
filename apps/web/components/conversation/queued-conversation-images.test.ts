// @vitest-environment happy-dom
//
// Whole-surface regression: dropping an image on the ordinary conversation
// composer keeps the typed draft, shows a removable preview inside the
// composer, and never opens the rejected source-processing dialog. This is the
// inline multimodal path, not Source/Capture intake.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fetcher = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));

vi.mock("@/components/workspace-session-request", () => ({
  WORKSPACE_SESSION_EXPIRED_EVENT: "talent-signal:workspace-session-expired",
  workspaceSessionFetch: fetcher,
  workspaceSessionExpired: () => false,
  relationshipIntegrationFetch: fetcher,
  relationshipIntegrationSessionExpired: () => false,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

import { setConversationImageStoreForTest, type ConversationImageStore } from "@/lib/conversation-image-store";
import { QueuedConversation } from "./queued-conversation";

const SCOPE = "a".repeat(64);
let mount: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(times = 8): Promise<void> {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  });
}

function dropEvent(file: File): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files: [file], items: [{ kind: "file", type: file.type, getAsFile: () => file }], types: ["Files"] },
  });
  return event;
}
function dragEnterEvent(file: File): Event {
  const event = new Event("dragenter", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files: [file], items: [{ kind: "file", type: file.type, getAsFile: () => file }], types: ["Files"] },
  });
  return event;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  router.push.mockReset();
  fetcher.mockReset();
  fetcher.mockImplementation(() => Promise.resolve(Response.json({})));
  const store: ConversationImageStore = {
    async put() { return true; },
    async get() { return []; },
    async delete() {},
    async deletePrefix() {},
    async inventory() { return []; },
  };
  setConversationImageStoreForTest(store);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  mount?.remove();
  mount = null;
  setConversationImageStoreForTest(undefined);
  vi.unstubAllGlobals();
});

it("previews a dropped image in the composer without any processing dialog", async () => {
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => {
    root?.render(createElement(QueuedConversation, { chatBinding: "chat-binding", detailBinding: "detail-binding", scope: SCOPE }));
  });
  await flush();

  const composer = document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer");
  expect(composer).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(composer, "保留的对话草稿");
    composer?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush(2);

  const file = new File([new Uint8Array([137, 80, 78, 71, 9, 9, 9, 9])], "drop.png", { type: "image/png" });
  const target = document.querySelector<HTMLElement>("[data-variant]");
  expect(target).not.toBeNull();
  await act(async () => { target?.dispatchEvent(dragEnterEvent(file)); });
  expect(document.body.textContent).toContain("松开后添加图片");
  await act(async () => { target?.dispatchEvent(dropEvent(file)); });
  await flush();

  // The preview lives in the composer; the draft is untouched and no modal opened.
  expect(document.querySelectorAll("[aria-label='要发送的图片'] img")).toHaveLength(1);
  expect(document.body.textContent).not.toContain("保存并整理图片");
  expect(document.querySelector("[role='dialog']")).toBeNull();
  expect(document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")?.value).toBe("保留的对话草稿");
});

it("keeps denied-storage image input when leaving is declined and allows retry without sending", async () => {
  setConversationImageStoreForTest({ async put() { return false; }, async get() { return []; }, async delete() {}, async deletePrefix() {}, async inventory() { return []; } });
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
  await act(async () => { root!.render(createElement(QueuedConversation, { chatBinding: "chat", detailBinding: "detail", scope: SCOPE })); });
  await flush();
  const composer = mount.querySelector("textarea")!;
  await act(async () => { composer.dispatchEvent(dropEvent(new File([new Uint8Array([137,80,78,71])], "keep.png", { type: "image/png" }))); });
  await flush();
  vi.stubGlobal("confirm", vi.fn(() => false));
  const anchor = document.createElement("a"); anchor.href = "/workspace/people"; document.body.append(anchor);
  try {
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => { anchor.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    expect(mount.querySelector('img[alt="keep.png"]')).not.toBeNull();
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const route = window.location.href;
    window.history.pushState({}, "", "/workspace/people");
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(window.location.href).toBe(route);
    expect(mount.querySelector('img[alt="keep.png"]')).not.toBeNull();
    setConversationImageStoreForTest({ async put() { return true; }, async get() { return []; }, async delete() {}, async deletePrefix() {}, async inventory() { return []; } });
    const retry = [...mount.querySelectorAll("button")].find(button => button.textContent === "重试保存图片")!;
    await act(async () => { retry.click(); }); await flush();
    const savedUnload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(savedUnload);
    expect(savedUnload.defaultPrevented).toBe(false);
    expect(fetcher.mock.calls.filter(call => (call[1] as RequestInit)?.method === "POST")).toHaveLength(0);
  } finally { anchor.remove(); }
});
