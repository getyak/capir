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

it("keeps accepted images and text while visibly refusing a new batch the browser cannot store", async () => {
  let failing = false;
  const records = new Map<string, import("@/lib/conversation-image-store").DurableConversationImage[]>();
  setConversationImageStoreForTest({
    async put(key, images) { if (failing) return false; records.set(key, [...images]); return true; },
    async get(key) { return records.get(key) ?? []; }, async delete(key) { records.delete(key); }, async deletePrefix() {}, async inventory() { return []; },
  });
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
  await act(async () => { root!.render(createElement(QueuedConversation, { chatBinding: "chat", detailBinding: "detail", scope: SCOPE })); }); await flush();
  const composer = mount.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { setter.call(composer, "原话保留"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
  const file = (name: string) => new File([new Uint8Array([137,80,78,71])], name, { type: "image/png" });
  await act(async () => { composer.dispatchEvent(dropEvent(file("stored.png"))); }); await flush();
  const original = mount.querySelector<HTMLImageElement>('img[alt="stored.png"]')!.src;
  failing = true;
  await act(async () => { composer.dispatchEvent(dropEvent(file("refused.png"))); }); await flush();
  expect(mount.querySelector('img[alt="refused.png"]')).toBeNull();
  expect(mount.querySelector<HTMLImageElement>('img[alt="stored.png"]')!.src).toBe(original);
  expect(composer.value).toBe("原话保留");
  expect(mount.textContent).toContain("这批图片未添加");
  expect(mount.textContent).toContain("重新选择");
  const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
  // A new explicit selection after recovery may now be accepted.
  failing = false;
  await act(async () => { composer.dispatchEvent(dropEvent(file("refused.png"))); }); await flush();
  expect(mount.querySelector('img[alt="refused.png"]')).not.toBeNull();
  expect(mount.querySelectorAll("[aria-label='要发送的图片'] img")).toHaveLength(2);
  expect(fetcher.mock.calls.filter(call => (call[1] as RequestInit)?.method === "POST")).toHaveLength(0);
});

it("cancels Back before URL commitment while a new selection is still awaiting durable acknowledgement", async () => {
  const navigation = new EventTarget();
  vi.stubGlobal("navigation", navigation);
  vi.stubGlobal("confirm", vi.fn(() => false));
  const phases: string[] = [];
  // App Router registers once before route-level listeners. Its RESTORE path
  // can replace the route immediately after popstate; do not rely on a later
  // component callback still existing. Native navigate precedes that commit.
  const routerPopstate = () => {
    phases.push("router restore");
    root!.render(createElement("main", null, "People"));
  };
  window.addEventListener("popstate", routerPopstate);
  let writes = 0;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const records = new Map<string, import("@/lib/conversation-image-store").DurableConversationImage[]>();
  setConversationImageStoreForTest({
    async put(key, images) { writes += 1; if (writes > 1) await gate; records.set(key, [...images]); return true; },
    async get(key) { return records.get(key) ?? []; }, async delete(key) { records.delete(key); }, async deletePrefix() {}, async inventory() { return []; },
  });
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
  try {
    await act(async () => { root!.render(createElement(QueuedConversation, { chatBinding: "chat", detailBinding: "detail", scope: SCOPE })); }); await flush();
    const composer = mount.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { setter.call(composer, "保留原文与两张图"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    for (const name of ["durable.png", "unsaved.png"]) {
      await act(async () => { composer.dispatchEvent(dropEvent(new File([new Uint8Array([137,80,78,71])], name, { type: "image/png" }))); }); await flush();
    }
    const urls = [...mount.querySelectorAll("img")].map(image => image.src);
    expect(mount.querySelectorAll("[aria-label='要发送的图片'] img")).toHaveLength(1);
    expect(mount.querySelector('img[alt="unsaved.png"]')).toBeNull();
    const route = window.location.href;
    const historyLength = window.history.length;
    const target = new URL("/workspace/people", route).href;
    function traverse() {
      const event = new Event("navigate", { cancelable: true });
      Object.defineProperties(event, { navigationType: { value: "traverse" }, destination: { value: { url: target, sameDocument: true } } });
      phases.push("before commit"); navigation.dispatchEvent(event);
      if (!event.defaultPrevented) {
        phases.push("commit URL"); window.history.replaceState({ __NA: true }, "", target);
        window.dispatchEvent(new PopStateEvent("popstate", { state: { __NA: true } }));
      }
      return event;
    }
    let declined!: Event;
    await act(async () => { declined = traverse(); });
    expect(declined.defaultPrevented).toBe(true);
    expect(phases).toEqual(["before commit"]);
    expect(window.location.href).toBe(route);
    expect(window.history.length).toBe(historyLength);
    expect(mount.querySelector("textarea")!.value).toBe("保留原文与两张图");
    expect([...mount.querySelectorAll("img")].map(image => image.src)).toEqual(urls);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    // The explicit leave decision traverses normally, without a second prompt
    // from the legacy popstate guard or a synthetic replacement history entry.
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => { traverse(); }); await flush();
    expect(phases).toEqual(["before commit", "before commit", "commit URL", "router restore"]);
    expect(window.location.href).toBe(target);
    expect(mount.textContent).toBe("People");
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.filter(call => (call[1] as RequestInit)?.method === "POST")).toHaveLength(0);
  } finally { release(); await flush(); window.removeEventListener("popstate", routerPopstate); }
});

it("keeps a replaced draft visibly unsafe until the reader explicitly chooses the stored version", async () => {
  const records = new Map<string, import("@/lib/conversation-image-store").DurableConversationImage[]>();
  setConversationImageStoreForTest({
    async put(key, images, expected) {
      if (expected && JSON.stringify(expected) !== JSON.stringify((records.get(key) ?? []).map(image => image.attachment_id))) return false;
      records.set(key, [...images]); return true;
    },
    async get(key) { return records.get(key) ?? []; }, async delete(key) { records.delete(key); }, async deletePrefix() {}, async inventory() { return []; },
  });
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
  await act(async () => { root!.render(createElement(QueuedConversation, { chatBinding: "chat", detailBinding: "detail", scope: SCOPE })); }); await flush();
  const composer = mount.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { setter.call(composer, "保留文字"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
  const file = (name: string) => new File([new Uint8Array([137,80,78,71])], name, { type: "image/png" });
  await act(async () => { composer.dispatchEvent(dropEvent(file("ours.png"))); }); await flush();
  const key = [...records.keys()][0]!;
  const theirs = records.get(key)!.map(record => ({ ...record, attachment_id: crypto.randomUUID(), file_name: "theirs.png", blob: file("theirs.png") }));
  records.set(key, theirs);
  await act(async () => { composer.dispatchEvent(dropEvent(file("new.png"))); }); await flush();
  const useStored = [...mount.querySelectorAll("button")].find(button => button.textContent === "使用本机已保存的图片");
  expect(useStored).toBeDefined();
  expect(mount.textContent).toContain("离开或刷新可能丢失");
  const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  vi.stubGlobal("confirm", vi.fn(() => false));
  const anchor = document.createElement("a"); anchor.href = "/workspace/private"; document.body.append(anchor);
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => { anchor.dispatchEvent(click); }); anchor.remove();
  expect(click.defaultPrevented).toBe(true);
  await act(async () => { useStored!.click(); }); await flush();
  expect(mount.querySelector('img[alt="ours.png"]')).not.toBeNull();
  expect(records.get(key)).toEqual(theirs);
  vi.mocked(window.confirm).mockReturnValue(true);
  await act(async () => { useStored!.click(); }); await flush();
  expect(mount.querySelector('img[alt="ours.png"]')).toBeNull();
  expect(mount.querySelector('img[alt="theirs.png"]')).not.toBeNull();
  expect(composer.value).toBe("保留文字");
  expect(records.get(key)).toEqual(theirs);
  const resolvedUnload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(resolvedUnload);
  expect(resolvedUnload.defaultPrevented).toBe(false);
  expect(fetcher.mock.calls.filter(call => (call[1] as RequestInit)?.method === "POST")).toHaveLength(0);
});
