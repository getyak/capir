// @vitest-environment happy-dom
// Keep the real queue hook, message projection and Session runtime. Only the
// network, durable browser storage and native layout are deterministic seams.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationImageManifest, ConversationQueueSnapshot } from "@talent-signal/contracts";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import { conversationImageKey, setConversationImageStoreForTest, type DurableConversationImage } from "@/lib/conversation-image-store";
import { invalidateWorkspaceDirectory } from "@/lib/workspace-directory-cache";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  chat: null as unknown as ReturnType<typeof import("./use-conversation")["useConversation"]>,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/sessions", useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
vi.mock("../workspace-session-request", () => ({
  WORKSPACE_SESSION_EXPIRED_EVENT: "talent-signal:workspace-session-expired",
  workspaceSessionFetch: state.fetch, workspaceSessionExpired: () => false,
  relationshipIntegrationFetch: state.fetch, relationshipIntegrationSessionExpired: () => false,
}));
vi.mock("./use-conversation", async original => {
  const actual = await original<typeof import("./use-conversation")>();
  return { ...actual, useConversation(options: Parameters<typeof actual.useConversation>[0]) {
    const chat = actual.useConversation(options); state.chat = chat; return chat;
  } };
});
import { QueuedConversation } from "./queued-conversation";

const SESSION = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const SCOPE = "d".repeat(64);
const CREATED = "2026-10-29T00:00:00.000Z";
const image: ConversationImageManifest = {
  attachment_id: "44444444-4444-4444-8444-444444444444",
  file_name: "synthetic-source.png", media_type: "image/png", byte_size: 8,
  content_hash: "a".repeat(64),
};
const emptyDetail: SessionDetail = {
  session_id: SESSION, revision: 1, updated_at: CREATED, expires_at: "2099-01-01T00:00:00.000Z",
  state: "active", title: "Synthetic original inspection", turn_count: 0, is_unread: false,
  scope_kind: "unresolved_intent", person_id: null, relationship_context_id: null,
  person_label: "", context_label: "", deleted_at: null, display_authority: "stale_unconfirmed",
  composer_draft: null, composer_draft_updated_at: null, turns: [],
};
const activeEntry = {
  queue_entry_id: "55555555-5555-4555-8555-555555555555", message_id: MESSAGE,
  sequence: 1, status: "running" as const, objective: "Read this synthetic source", images: [image],
  created_at: CREATED, updated_at: CREATED, started_at: CREATED, revision: 1, run_id: RUN,
  stage: "answer", cancel_requested: false, failure_code: null,
};
function snapshot(active = true, revision = 1): ConversationQueueSnapshot {
  return {
    contract_version: "2026-08-24.10", session_id: SESSION, revision,
    paused: false, preview: null, active: active ? activeEntry : null, queued: [],
  } as ConversationQueueSnapshot;
}
let root: Root;
let host: HTMLDivElement;
let queue: ConversationQueueSnapshot;
let detail: SessionDetail;
let holdDetail: boolean;
let detailWaiters: Array<(response: Response) => void>;
let emit: (next: ConversationQueueSnapshot) => void;
let offsets: WeakMap<HTMLElement, number>;
let resizeRecords: Set<{ callback: ResizeObserverCallback; targets: Set<Element> }>;
let feedHeight: number;
let createdUrls: string[];
let revokedUrls: string[];
let localReads: string[];
let localRecords: Map<string, DurableConversationImage[]>;
let releasePending: Array<() => void> = [];
const receipts: Array<Record<string, unknown>> = [];
function checkpoint(phase: string, extra: Record<string, unknown> = {}) { receipts.push({ phase, ...extra }); console.info("G189_CHECKPOINT", JSON.stringify({ phase, ...extra })); }

const isFeed = (node: HTMLElement) => node.getAttribute("aria-label") === "对话记录";
async function flush() {
  await act(async () => { for (let index = 0; index < 8; index++) {
    await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 1));
  } });
}
async function render(scope = SCOPE, binding = "chat-binding") {
  await act(async () => root.render(createElement(QueuedConversation, {
    scope, chatBinding: binding, detailBinding: `detail-${binding}`, initialDetail: emptyDetail,
  })));
  await flush();
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("G189 fixture forbids real network"); }));
  localStorage.clear(); invalidateWorkspaceDirectory(undefined, "discard");
  releasePending = [];
  queue = snapshot(); detail = emptyDetail; holdDetail = false; detailWaiters = [];
  offsets = new WeakMap(); resizeRecords = new Set(); feedHeight = 1000;
  createdUrls = []; revokedUrls = []; localReads = []; localRecords = new Map();
  vi.stubGlobal("ResizeObserver", class {
    record: { callback: ResizeObserverCallback; targets: Set<Element> };
    constructor(callback: ResizeObserverCallback) { this.record = { callback, targets: new Set() }; resizeRecords.add(this.record); }
    observe(node: Element) { this.record.targets.add(node); }
    disconnect() { resizeRecords.delete(this.record); }
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:synthetic-${createdUrls.length + 1}`; createdUrls.push(url); return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(url => { revokedUrls.push(String(url)); });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return isFeed(this) ? 300 : 405; });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return isFeed(this) ? feedHeight : 980; });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (this: HTMLElement) { return offsets.get(this) ?? 0; });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (this: HTMLElement, value: number) { offsets.set(this, value); });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (isFeed(this)) return new DOMRect(0, 100, 600, 300);
    const viewport = this.closest<HTMLElement>('[aria-label="对话记录"]');
    if (viewport && (this.hasAttribute("data-message-evidence") || this.hasAttribute("data-evidence-preview"))) {
      return new DOMRect(0, 100 + 160 - viewport.scrollTop, 540, this.hasAttribute("data-evidence-preview") ? 280 : 200);
    }
    return new DOMRect();
  });
  setConversationImageStoreForTest({
    async put(key, images) { if (images.length) localRecords.set(key, [...images]); else localRecords.delete(key); return true; },
    async get(key) { localReads.push(key); return localRecords.get(key) ?? []; },
    async delete(key) { localRecords.delete(key); },
    async deletePrefix(prefix) { for (const key of localRecords.keys()) if (key.startsWith(prefix)) localRecords.delete(key); },
    async inventory() { return [...localRecords].map(([key, images]) => ({ key, expiresAt: images[0]?.expiresAt ?? 0 })); },
  });
  state.fetch.mockReset();
  state.fetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes("/conversation-images/")) return Promise.resolve(new Response(new Blob([new Uint8Array(8)], { type: "image/png" })));
    if (url.endsWith("/stream")) return Promise.resolve(new Response(new ReadableStream({
      start(controller) {
        emit = next => controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(next)}\n\n`));
        emit(queue);
        init?.signal?.addEventListener("abort", () => { try { controller.close(); } catch { /* Already cancelled. */ } }, { once: true });
      },
    })));
    if (url.endsWith("/conversation-queue")) return Promise.resolve(Response.json(queue));
    if (url === `/api/workspace-sessions/${SESSION}`) {
      return holdDetail ? new Promise<Response>(resolve => detailWaiters.push(resolve)) : Promise.resolve(Response.json({ detail }));
    }
    return Promise.resolve(Response.json({}));
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  for (const release of releasePending.splice(0)) release();
  await flush();
  for (const resolve of detailWaiters) resolve(Response.json({ detail: emptyDetail }));
  await act(async () => root.unmount()); host.remove();
  setConversationImageStoreForTest(undefined); invalidateWorkspaceDirectory(undefined, "discard");
  localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function holdOneDraftRemoval(retainedCount = 1) {
  const draftKey = conversationImageKey(SCOPE, SESSION, "composer-draft");
  let enter!: () => void;
  let release!: (result: "accept" | "refuse" | "reject") => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const settled = new Promise<"accept" | "refuse" | "reject">(resolve => { release = resolve; });
  releasePending.push(() => release("accept"));
  let held = false;
  setConversationImageStoreForTest({
    async put(key, images, expected) {
      if (!held && key === draftKey && images.length === retainedCount) {
        held = true; checkpoint("real-durable-shrink-put-entered", { exactDraftKey: key === draftKey, retainedIds: images.map(x => x.attachment_id) }); enter();
        const result = await settled;
        if (result === "reject") throw new Error("synthetic durable storage refusal");
        if (result === "refuse") return false;
      }
      if (expected && JSON.stringify((localRecords.get(key) ?? []).map(image => image.attachment_id)) !== JSON.stringify(expected)) return false;
      if (images.length) localRecords.set(key, [...images]); else localRecords.delete(key);
      return true;
    },
    async get(key) { return localRecords.get(key) ?? []; },
    async delete(key) { localRecords.delete(key); },
    async deletePrefix(prefix) { for (const key of localRecords.keys()) if (key.startsWith(prefix)) localRecords.delete(key); },
    async inventory() { return [...localRecords].map(([key, images]) => ({ key, expiresAt: images[0]?.expiresAt ?? 0 })); },
  });
  return { entered, release };
}
async function stageTwoDraftImages(count = 2) {
  queue = snapshot(false);
  await render();
  const file = (name: string) => new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], name, { type: "image/png" });
  await act(async () => { state.chat.changeDraft("Retain authored text"); await state.chat.addFiles([file("first.png"), file("second.png")].slice(0, count)); });
  await flush();
  expect(state.chat.attachments.map(attachment => attachment.file.name)).toEqual(["first.png", "second.png"].slice(0, count));
  const composer = host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="移除第 1 张图片"]');
  expect(trigger).toBeTruthy();
  checkpoint("real-components-two-attachments-ready", { composerConnected: composer.isConnected, count: state.chat.attachments.length });
  return { composer, trigger: trigger! };
}
it("G189: returns owned focus after an acknowledged asynchronous draft image removal", async () => {
  const { composer, trigger } = await stageTwoDraftImages();
  const gate = holdOneDraftRemoval();
  await act(async () => { trigger.focus(); trigger.click(); });
  await gate.entered;
  expect(document.activeElement).toBe(trigger);
  expect(trigger.isConnected).toBe(true);
  expect(state.chat.attachments).toHaveLength(2);
  await act(async () => { gate.release("accept"); }); await flush();
  expect(trigger.isConnected).toBe(false);
  expect(host.querySelector("#queued-conversation-composer")).toBe(composer);
  expect(composer.disabled).toBe(false);
  expect(composer.value).toBe("Retain authored text");
  expect(state.chat.attachments.map(attachment => attachment.file.name)).toEqual(["second.png"]);
  checkpoint("primary-post-durable-removal", { triggerConnected: trigger.isConnected, sameComposer: host.querySelector("#queued-conversation-composer") === composer, composerEnabled: !composer.disabled, retainedText: composer.value === "Retain authored text", attachmentNames: state.chat.attachments.map(x => x.file.name), activeIsComposer: document.activeElement === composer, activeTag: document.activeElement?.tagName });
  expect(document.activeElement).toBe(composer);
  await flush(); expect(document.activeElement).toBe(composer);
});
it.each(["refuse", "reject"] as const)("G189: a %s keeps its focused control and a deliberate retry can complete", async failure => {
  const { composer, trigger } = await stageTwoDraftImages();
  const gate = holdOneDraftRemoval();
  await act(async () => { trigger.focus(); trigger.click(); }); await gate.entered;
  await act(async () => { gate.release(failure); }); await flush();
  expect(trigger.isConnected).toBe(true); expect(trigger.disabled).toBe(false);
  expect(document.activeElement).toBe(trigger); expect(state.chat.attachments).toHaveLength(2);
  await act(async () => { trigger.click(); }); await flush();
  expect(trigger.isConnected).toBe(false);
  expect(state.chat.attachments.map(attachment => attachment.file.name)).toEqual(["second.png"]);
  expect(document.activeElement).toBe(composer);
});
it.each(["foreign", "blank", "foreign-back"] as const)("G189: does not reclaim focus after deliberate %s intent while removal waits", async intent => {
  const { trigger } = await stageTwoDraftImages(); const gate = holdOneDraftRemoval();
  const foreign = document.createElement("button"); foreign.textContent = "Synthetic foreign control"; document.body.append(foreign);
  const blank = document.createElement("div"); blank.textContent = "Synthetic blank space"; document.body.append(blank);
  try {
    await act(async () => { trigger.focus(); trigger.click(); }); await gate.entered;
    await act(async () => {
      const target = intent === "blank" ? blank : foreign;
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      if (intent === "blank") trigger.blur(); else foreign.focus();
      if (intent === "foreign-back") trigger.focus();
    });
    const expected = intent === "foreign" ? foreign : document.body;
    await act(async () => { gate.release("accept"); }); await flush();
    expect(trigger.isConnected).toBe(false); expect(document.activeElement).toBe(expected);
    await flush(); expect(document.activeElement).toBe(expected);
  } finally { foreign.remove(); blank.remove(); }
});
it.each(["replace", "ABA"] as const)("G189: an old %s owner cannot focus a replacement composer", async variant => {
  const { composer: oldComposer, trigger } = await stageTwoDraftImages(); const gate = holdOneDraftRemoval();
  await act(async () => { trigger.focus(); trigger.click(); }); await gate.entered;
  await render(SCOPE, "replacement-binding");
  if (variant === "ABA") await render(SCOPE, "chat-binding");
  const replacement = host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
  expect(replacement).not.toBe(oldComposer);
  // Do not insert a foreign-focus escape hatch: this directly exercises the
  // token fence even when native removal left activeElement at body.
  expect(document.activeElement).toBe(document.body);
  await act(async () => { gate.release("accept"); }); await flush();
  expect(document.activeElement).toBe(document.body);
  expect(host.querySelector("#queued-conversation-composer")).toBe(replacement);
});

it("G189: explicit blur to BODY while durable removal waits revokes focus ownership", async () => {
  const { trigger } = await stageTwoDraftImages(); const gate = holdOneDraftRemoval();
  const exits: boolean[] = [];
  trigger.addEventListener("focusout", () => exits.push(trigger.isConnected));
  await act(async () => { trigger.focus(); trigger.click(); }); await gate.entered;
  await act(async () => trigger.blur());
  expect(trigger.isConnected).toBe(true);
  expect(exits).toEqual([true]);
  expect(document.activeElement).toBe(document.body);
  await act(async () => gate.release("accept")); await flush();
  expect(trigger.isConnected).toBe(false);
  expect(state.chat.attachments.map(x => x.file.name)).toEqual(["second.png"]);
  expect(document.activeElement).toBe(document.body);
  await flush(); expect(document.activeElement).toBe(document.body);
  checkpoint("explicit-blur-control", { focusoutWhileConnected: exits, activeTag: document.activeElement?.tagName });
});
it("G189: removing the last draft image restores only the same composer after durability", async () => {
  const { composer, trigger } = await stageTwoDraftImages(1); const gate = holdOneDraftRemoval(0);
  await act(async () => { trigger.focus(); trigger.click(); }); await gate.entered;
  expect(trigger.isConnected).toBe(true); expect(state.chat.attachments).toHaveLength(1);
  expect(document.activeElement).toBe(trigger);
  await act(async () => gate.release("accept")); await flush();
  expect(trigger.isConnected).toBe(false); expect(state.chat.attachments).toHaveLength(0);
  expect(host.querySelector("#queued-conversation-composer")).toBe(composer);
  expect(composer.value).toBe("Retain authored text"); expect(composer.disabled).toBe(false);
  expect(document.activeElement).toBe(composer);
  await flush(); expect(document.activeElement).toBe(composer);
});
it.each(["Enter", " "] as const)("G189: %j keyboard sequence plus explicit button default-activation fixture retains async handoff", async key => {
  const { composer, trigger } = await stageTwoDraftImages(); const gate = holdOneDraftRemoval();
  await act(async () => {
    trigger.focus();
    const down = new KeyboardEvent("keydown", { key, code: key === "Enter" ? "Enter" : "Space", bubbles: true, cancelable: true });
    expect(trigger.dispatchEvent(down)).toBe(true);
    // happy-dom does not implement keyboard -> button click activation.
    // The browser-default activation seam uses the real button's click API;
    // actual browser Enter/Space default behavior is separate and UNRUN.
    if (key === "Enter") trigger.click();
    const up = new KeyboardEvent("keyup", { key, code: key === "Enter" ? "Enter" : "Space", bubbles: true, cancelable: true });
    expect(trigger.dispatchEvent(up)).toBe(true);
    if (key === " ") trigger.click();
  });
  await gate.entered; expect(document.activeElement).toBe(trigger); expect(state.chat.attachments).toHaveLength(2);
  await act(async () => gate.release("accept")); await flush();
  expect(trigger.isConnected).toBe(false); expect(document.activeElement).toBe(composer);
  await flush(); expect(document.activeElement).toBe(composer);
  checkpoint("keyboard-sequence-with-default-activation-fixture", { key, browserDefaultActivationVerified: false, activeIsComposer: document.activeElement === composer });
});
it("G189: two pending real removals hand off once from only the latest focused operation", async () => {
  const { composer, trigger: first } = await stageTwoDraftImages(); const gate = holdOneDraftRemoval();
  const second = host.querySelector<HTMLButtonElement>('button[aria-label="移除第 2 张图片"]')!;
  let composerFocuses = 0; composer.addEventListener("focus", () => { composerFocuses += 1; });
  await act(async () => { first.focus(); first.click(); }); await gate.entered;
  await act(async () => { second.focus(); second.click(); });
  expect(state.chat.attachments).toHaveLength(2); expect(document.activeElement).toBe(second);
  expect(composerFocuses).toBe(0);
  await act(async () => gate.release("accept")); await flush();
  expect(first.isConnected).toBe(false); expect(second.isConnected).toBe(false);
  expect(state.chat.attachments).toHaveLength(0);
  expect(localRecords.get(conversationImageKey(SCOPE, SESSION, "composer-draft")) ?? []).toHaveLength(0);
  expect(host.querySelector("#queued-conversation-composer")).toBe(composer);
  expect(composer.value).toBe("Retain authored text"); expect(document.activeElement).toBe(composer);
  expect(composerFocuses).toBe(1);
  await flush(); expect(document.activeElement).toBe(composer); expect(composerFocuses).toBe(1);
  checkpoint("two-real-pending-removals", { composerFocuses, attachments: state.chat.attachments.length, durableRemaining: (localRecords.get(conversationImageKey(SCOPE, SESSION, "composer-draft")) ?? []).length });
});
