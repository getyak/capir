// @vitest-environment happy-dom
// Exercise the real Queue -> submit -> durable-image-put path. Hook capture
// exposes setup/readback only; it does not replace production transitions.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import { CONVERSATION_IMAGE_DRAFT, setConversationImageStoreForTest, type DurableConversationImage } from "@/lib/conversation-image-store";
import { invalidateWorkspaceDirectory } from "@/lib/workspace-directory-cache";

const state = vi.hoisted(() => ({ chat: null as unknown as ReturnType<typeof import("./use-conversation")["useConversation"]>, fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/sessions", useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock("../workspace-session-request", () => ({ WORKSPACE_SESSION_EXPIRED_EVENT: "talent-signal:workspace-session-expired", workspaceSessionFetch: state.fetch, workspaceSessionExpired: () => false, relationshipIntegrationFetch: state.fetch, relationshipIntegrationSessionExpired: () => false }));
vi.mock("./use-conversation", async original => {
  const actual = await original<typeof import("./use-conversation")>();
  return { ...actual, useConversation(options: Parameters<typeof actual.useConversation>[0]) { const chat = actual.useConversation(options); state.chat = chat; return chat; } };
});
import { QueuedConversation } from "./queued-conversation";

const SESSION = "11111111-1111-4111-8111-111111111111";
const HISTORY = "22222222-2222-4222-8222-222222222222";
const SCOPE = "d".repeat(64);
const detail = {
  session_id: SESSION, revision: 1, updated_at: "2026-10-29T00:00:00Z", expires_at: "2099-01-01T00:00:00Z",
  state: "active", title: "Synthetic source reading", turn_count: 1, is_unread: false, scope_kind: "unresolved_intent",
  person_id: null, relationship_context_id: null, person_label: "", context_label: "", deleted_at: null,
  display_authority: "stale_unconfirmed", composer_draft: null, composer_draft_updated_at: null,
  turns: [{ id: HISTORY, objective: "Earlier synthetic image", images: [{ attachment_id: "33333333-3333-4333-8333-333333333333", file_name: "history.png", media_type: "image/png", byte_size: 8, content_hash: "a".repeat(64) }], createdAt: "2026-10-29T00:00:00Z",
    response: { taskID: "synthetic", contractVersion: "2026-08-24.10", createdAt: "2026-10-29T00:00:01Z", contextManifestID: "", knowledgeSnapshotID: "", disposition: "answer", savedBlocks: [] } }],
} as unknown as SessionDetail;

let root: Root;
let host: HTMLDivElement;
let height: number;
let offsets: WeakMap<HTMLElement, number>;
let observers: Set<{ callback: ResizeObserverCallback; targets: Set<Element> }>;
let holdPut: boolean;
let releasePut: (stored: boolean) => void;
let putStarted: Promise<void>;

const isViewport = (node: HTMLElement) => node.getAttribute("aria-label") === "对话记录";
async function flush() { await act(async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 1)); } }); }
async function render(scope = SCOPE, binding = "chat") { await act(async () => root.render(createElement(QueuedConversation, { scope, chatBinding: binding, detailBinding: `detail-${binding}`, initialDetail: detail }))); await flush(); }
function viewport() { return host.querySelector<HTMLElement>('[aria-label="对话记录"]')!; }
function source() { return host.querySelector<HTMLButtonElement>(`[data-message-evidence='${HISTORY}'] button[title='查看原图 1']`)!; }
async function inspect() { await act(async () => source().click()); return host.querySelector<HTMLElement>("[data-evidence-preview]")!; }
async function resize() { await act(async () => { const view = viewport(); for (const observer of observers) if (observer.targets.has(view) || observer.targets.has(view.firstElementChild!)) observer.callback([], {} as ResizeObserver); }); }
async function readAt(top: number) { await act(async () => { const view = viewport(); view.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true })); view.scrollTop = top; view.dispatchEvent(new Event("scroll")); }); }
async function nearBottom() { await act(async () => { const view = viewport(); view.dispatchEvent(new Event("pointerdown", { bubbles: true })); view.scrollTop = height - 300; view.dispatchEvent(new Event("scroll")); }); }

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); invalidateWorkspaceDirectory(undefined, "discard");
  height = 1000; offsets = new WeakMap(); observers = new Set(); holdPut = false;
  vi.stubGlobal("ResizeObserver", class {
    record: { callback: ResizeObserverCallback; targets: Set<Element> };
    constructor(callback: ResizeObserverCallback) { this.record = { callback, targets: new Set() }; observers.add(this.record); }
    observe(node: Element) { this.record.targets.add(node); }
    disconnect() { observers.delete(this.record); }
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:synthetic-${crypto.randomUUID()}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return isViewport(this) ? 300 : 0; });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return isViewport(this) ? height : 0; });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (this: HTMLElement) { return offsets.get(this) ?? 0; });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (this: HTMLElement, value: number) { offsets.set(this, Math.max(0, Math.min(value, height - 300))); });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (isViewport(this)) return new DOMRect(0, 100, 600, 300);
    const view = this.closest<HTMLElement>('[aria-label="对话记录"]');
    if (view && (this.hasAttribute("data-message-evidence") || this.hasAttribute("data-evidence-preview"))) return new DOMRect(0, 100 + 160 - view.scrollTop, 540, this.hasAttribute("data-evidence-preview") ? 280 : 200);
    return new DOMRect();
  });
  let signalStarted!: () => void;
  putStarted = new Promise<void>(resolve => { signalStarted = resolve; });
  const gate = new Promise<boolean>(resolve => { releasePut = resolve; });
  const records = new Map<string, DurableConversationImage[]>();
  setConversationImageStoreForTest({
    async put(key, images, expected) {
      if (holdPut && images.length && !key.endsWith(`:${CONVERSATION_IMAGE_DRAFT}`)) { signalStarted(); if (!await gate) return false; }
      if (expected && JSON.stringify(records.get(key)?.map(image => image.attachment_id) ?? []) !== JSON.stringify(expected)) return false;
      if (images.length) records.set(key, [...images]); else records.delete(key);
      return true;
    },
    async get(key) { return records.get(key) ?? []; }, async delete(key) { records.delete(key); },
    async deletePrefix(prefix) { for (const key of records.keys()) if (key.startsWith(prefix)) records.delete(key); },
    async inventory() { return [...records].map(([key, images]) => ({ key, expiresAt: images[0]?.expiresAt ?? 0 })); },
  });
  const empty = { contract_version: "2026-08-24.10", session_id: SESSION, revision: 1, active: null, queued: [], paused: false, preview: null };
  state.fetch.mockReset(); state.fetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes("/conversation-images/")) return Promise.resolve(new Response(new Blob([new Uint8Array(8)], { type: "image/png" })));
    if (url.endsWith("/stream")) return Promise.resolve(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(empty)}\n\n`)); init?.signal?.addEventListener("abort", () => controller.close(), { once: true }); } })));
    if (url.endsWith("/conversation-queue")) return Promise.resolve(Response.json(init?.method === "POST" ? {} : empty, { status: init?.method === "POST" ? 202 : 200 }));
    return Promise.resolve(Response.json({ detail }));
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
  await readAt(100);
  await act(async () => { await state.chat.addFiles([new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], "pending.png", { type: "image/png" })]); state.chat.changeDraft("Synthetic later message"); });
  await flush();
});

afterEach(async () => { releasePut(false); await act(async () => root.unmount()); host.remove(); invalidateWorkspaceDirectory(undefined, "discard"); setConversationImageStoreForTest(undefined); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["keep-open", "open-close", "manual-read", "unchanged", "put-failed", "owner-change"] as const)("lets the latest reading intent win while a Send waits for durable image storage: %s", async mode => {
  holdPut = true;
  const send = host.querySelector<HTMLButtonElement>('button[data-send-mode="send"][aria-label="发送消息"]')!;
  expect(send).not.toBeNull(); expect(send.disabled).toBe(false);
  await act(async () => send.click());
  await putStarted;
  expect(state.chat.submitting).toBe(true);
  if (mode === "keep-open" || mode === "open-close") {
    const preview = await inspect(); expect(preview).not.toBeNull();
    if (mode === "open-close") await act(async () => preview.querySelector<HTMLButtonElement>('[aria-label="关闭原图"]')!.click());
  }
  if (mode === "manual-read") await readAt(60);
  if (mode === "owner-change") { await render("e".repeat(64), "other-chat"); await readAt(70); }
  const before = viewport().scrollTop;
  await act(async () => releasePut(mode !== "put-failed"));
  await flush();
  height = 1400;
  await resize();
  if (mode === "unchanged") { expect(viewport().scrollTop).toBe(1100); return; }
  expect(viewport().scrollTop).toBe(before);
  if (mode === "keep-open") {
    expect(host.querySelector("[data-evidence-preview]")).not.toBeNull();
    await nearBottom();
    height = 1600;
    await resize();
    expect(viewport().scrollTop).toBe(1100); // The newer inspection lease still owns the near-bottom reading.
  }
  if (mode === "put-failed") { expect(state.chat.attachments).toHaveLength(1); expect(state.chat.draft).toBe("Synthetic later message"); }
});
