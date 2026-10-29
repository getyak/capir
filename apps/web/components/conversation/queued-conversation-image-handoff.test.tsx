// @vitest-environment happy-dom
// Keep the real queue hook, message projection and Session runtime. Only the
// network, durable browser storage and native layout are deterministic seams.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationImageManifest, ConversationQueueSnapshot } from "@talent-signal/contracts";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import { conversationImageKey, setConversationImageStoreForTest, type DurableConversationImage } from "@/lib/conversation-image-store";
import { writeConversationMessage } from "@/lib/conversation-local";
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
const completedDetail = {
  ...emptyDetail, revision: 2, turn_count: 1,
  turns: [{
    id: MESSAGE, objective: "Read this synthetic source", images: [image], createdAt: CREATED,
    response: {
      taskID: RUN, contractVersion: "2026-08-24.10", createdAt: "2026-10-29T00:00:20.000Z",
      contextManifestID: "", knowledgeSnapshotID: "", disposition: "answer", savedBlocks: [],
    },
  }],
} as unknown as SessionDetail;

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
function feed() { return host.querySelector<HTMLElement>('[aria-label="对话记录"]')!; }
function preview() { return host.querySelector<HTMLElement>("[data-evidence-preview]"); }
function stage() { return preview()?.querySelector<HTMLElement>('[data-zoom][role="region"]') ?? null; }
async function openOriginal() {
  const trigger = host.querySelector<HTMLButtonElement>(`[data-message-evidence="${MESSAGE}"] button[title="查看原图 1"]`)!;
  expect(trigger).not.toBeNull();
  await act(async () => trigger.click());
  await flush();
  const zoom = preview()!.querySelector<HTMLButtonElement>('button[aria-label^="缩放"]')!;
  await act(async () => zoom.click());
  expect(stage()?.dataset.zoom).toBe("actual");
  await act(async () => { stage()!.scrollTop = 280; stage()!.scrollLeft = 36; stage()!.focus(); });
}
async function resizeFeed() {
  await act(async () => {
    for (const record of resizeRecords) if (record.targets.has(feed()) || record.targets.has(feed().firstElementChild!)) {
      record.callback([], {} as ResizeObserver);
    }
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); invalidateWorkspaceDirectory(undefined, "discard");
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
  for (const resolve of detailWaiters) resolve(Response.json({ detail: emptyDetail }));
  await act(async () => root.unmount()); host.remove();
  setConversationImageStoreForTest(undefined); invalidateWorkspaceDirectory(undefined, "discard");
  localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("keeps the inspected server original open across completion before and after delayed history readback", async () => {
  await render();
  await act(async () => {
    feed().dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
    feed().scrollTop = 100; feed().dispatchEvent(new Event("scroll"));
  });
  await openOriginal();
  const originalPreview = preview()!;
  const originalStage = stage()!;
  const originalPixels = originalPreview.querySelector("img")!.src;
  const readingTop = feed().scrollTop;
  const readsBeforeHandoff = localReads.filter(key => key === conversationImageKey(SCOPE, SESSION, MESSAGE)).length;

  holdDetail = true; queue = snapshot(false, 2);
  await act(async () => emit(queue));
  await flush();
  expect(detailWaiters.length).toBeGreaterThan(0);
  expect(state.chat.detail?.turns).toHaveLength(0);
  // A server receipt must not become a local outbox row during this gap.
  // The old local:true projection remounts this exact viewer and fails here.
  expect(preview()).toBe(originalPreview);
  expect(stage()).toBe(originalStage);
  expect(stage()?.dataset.zoom).toBe("actual");
  expect(stage()?.scrollTop).toBe(280);
  expect(stage()?.scrollLeft).toBe(36);
  expect(document.activeElement).toBe(originalStage);
  expect(feed().scrollTop).toBe(readingTop);
  expect(localReads.filter(key => key === conversationImageKey(SCOPE, SESSION, MESSAGE))).toHaveLength(readsBeforeHandoff);
  expect(revokedUrls).not.toContain(originalPixels);

  detail = completedDetail; holdDetail = false;
  await act(async () => { for (const resolve of detailWaiters.splice(0)) resolve(Response.json({ detail })); });
  await flush();
  expect(state.chat.detail?.turns).toHaveLength(1);
  expect(preview()).toBe(originalPreview);
  expect(stage()).toBe(originalStage);
  expect(stage()?.dataset.zoom).toBe("actual");
  expect(stage()?.scrollTop).toBe(280);
  expect(document.activeElement).toBe(originalStage);
  feedHeight = 1400; await resizeFeed();
  expect(feed().scrollTop).toBe(readingTop);
  expect(revokedUrls).not.toContain(originalPixels);

  // Preserve the opposite boundary: a new account/binding must drop old
  // inspection ownership and revoke bytes, even with the same Session ID.
  detail = emptyDetail; queue = snapshot(false, 3);
  await render("e".repeat(64), "other-account-binding");
  expect(preview()).toBeNull();
  expect(revokedUrls).toContain(originalPixels);
});

it("keeps a genuinely local unknown outbox image readable without a server image request", async () => {
  queue = snapshot(false);
  const blob = new Blob([new Uint8Array(8)], { type: "image/png" });
  localRecords.set(conversationImageKey(SCOPE, SESSION, MESSAGE), [{ ...image, position: 0, blob, expiresAt: Date.now() + 60_000 }]);
  writeConversationMessage(SCOPE, SESSION, {
    id: MESSAGE, objective: "Read this synthetic source", images: [image], createdAt: CREATED,
    delivery: "unknown", receiptUncertain: true, expiresAt: Date.now() + 60_000,
  });
  await render();
  await openOriginal();
  expect(preview()?.querySelector("img")?.src).toBe("blob:synthetic-1");
  expect(stage()?.scrollTop).toBe(280);
  expect(state.fetch.mock.calls.filter(([url]) => String(url).includes("/conversation-images/"))).toHaveLength(0);
});
