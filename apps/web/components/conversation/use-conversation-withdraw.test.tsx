// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationQueueEntry, ConversationQueueMutationResponse, ConversationQueueSnapshot } from "@talent-signal/contracts";

import { useConversation } from "./use-conversation";
import { conversationImageKey, setConversationImageStoreForTest, type DurableConversationImage } from "@/lib/conversation-image-store";
import { readConversationMessages, writeConversationDraft, writeConversationMessage, type LocalMessage } from "@/lib/conversation-local";
import type { SessionDetail } from "../session-workbench/session-detail-state";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("../workspace-session-request", () => ({ WORKSPACE_SESSION_EXPIRED_EVENT: "expired", workspaceSessionFetch: fetcher }));
const SESSION = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const NEIGHBOUR = "33333333-3333-4333-8333-333333333333";
const OTHER_SESSION = "44444444-4444-4444-8444-444444444444";
const SCOPE = "d".repeat(64);
const OTHER_SCOPE = "e".repeat(64);
const CREATED = "2026-10-24T00:00:00Z";
const VERSION = "2026-08-24.10";
const DRAFT = "Unfinished synthetic composer draft";
type Chat = ReturnType<typeof useConversation>;
type Mounted = { root: Root; host: HTMLDivElement; state: Chat; binding: string };
type StorageChange = { key: string; oldValue: string | null; newValue: string | null };
let mounted: Mounted[];
let streams: Map<string, (snapshot: ConversationQueueSnapshot) => void>;
let images: Map<string, DurableConversationImage[]>;
let readImages: ((key: string) => Promise<DurableConversationImage[]>) | null;
let server: ConversationQueueSnapshot;

function detail(): SessionDetail {
  return { session_id: SESSION, revision: 1, updated_at: CREATED,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(), state: "active", title: "Synthetic", turn_count: 0, is_unread: false,
    scope_kind: "unresolved_intent", person_id: null, relationship_context_id: null, person_label: "", context_label: "",
    deleted_at: null, display_authority: "stale_unconfirmed", composer_draft: null, composer_draft_updated_at: null, turns: [] };
}
function entry(id: string, sequence: number): ConversationQueueEntry {
  return { queue_entry_id: id, message_id: id, sequence, status: "queued", objective: id === TARGET ? "Synthetic target" : "Synthetic neighbour",
    created_at: CREATED, updated_at: CREATED, revision: 1, run_id: null, stage: null, cancel_requested: false, failure_code: null };
}
function snapshot(revision = 7, target = true): ConversationQueueSnapshot {
  return { contract_version: VERSION, session_id: SESSION, revision, paused: true, active: null,
    queued: target ? [entry(TARGET, 1), entry(NEIGHBOUR, 2)] : [entry(NEIGHBOUR, 2)], preview: null };
}
function localMessage(id: string, delivery: LocalMessage["delivery"] = "accepted"): LocalMessage {
  return { id, objective: id === TARGET ? "Synthetic target" : "Synthetic neighbour", createdAt: CREATED,
    delivery, receiptUncertain: delivery === "unknown", expiresAt: Date.now() + 60_000 };
}
async function flush() {
  await act(async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 1)); } });
}
function Harness({ tab }: { tab: Mounted }) {
  const state = useConversation({ id: SESSION, scope: SCOPE, chatBinding: tab.binding, detailBinding: "detail", initial: detail() });
  useLayoutEffect(() => { tab.state = state; });
  return createElement("section", null,
    createElement("textarea", { readOnly: true, value: state.draft }),
    ...state.messages.map(message => createElement("p", { key: message.id, "data-message-id": message.id }, message.objective)));
}
async function mount(binding: string, observeQueue = true) {
  const host = document.createElement("div"); document.body.append(host);
  const tab = { root: createRoot(host), host, binding } as Mounted;
  mounted.push(tab);
  await act(async () => tab.root.render(createElement(Harness, { tab })));
  await flush();
  if (observeQueue) await emit(tab, server);
  return tab;
}
async function emit(tab: Mounted, value: ConversationQueueSnapshot) {
  expect(streams.has(tab.binding)).toBe(true);
  await act(async () => streams.get(tab.binding)!(value)); await flush();
}
async function unmount(tab: Mounted) {
  await act(async () => tab.root.unmount()); tab.host.remove(); mounted = mounted.filter(item => item !== tab);
}
function captureStorageChanges() {
  const changes: StorageChange[] = [];
  const remove = localStorage.removeItem.bind(localStorage);
  const set = localStorage.setItem.bind(localStorage);
  vi.spyOn(localStorage, "removeItem").mockImplementation((key: string) => {
    const oldValue = localStorage.getItem(key); remove(key);
    if (oldValue !== localStorage.getItem(key)) changes.push({ key, oldValue, newValue: localStorage.getItem(key) });
  });
  vi.spyOn(localStorage, "setItem").mockImplementation((key: string, value: string) => {
    const oldValue = localStorage.getItem(key); set(key, value);
    if (oldValue !== localStorage.getItem(key)) changes.push({ key, oldValue, newValue: localStorage.getItem(key) });
  });
  return changes;
}
async function dispatchStorageChanges(changes: StorageChange[]) {
  await act(async () => {
    for (const change of changes) window.dispatchEvent(new StorageEvent("storage", { ...change, storageArea: localStorage, url: "http://localhost/synthetic-tab-a" }));
  });
  await flush();
}
function admissions() { return fetcher.mock.calls.filter(([url, init]) => url.endsWith("/conversation-queue") && init?.method === "POST"); }
function mutations() { return fetcher.mock.calls.filter(([url, init]) => url.endsWith("/mutations") && init?.method === "POST"); }
function ids(tab: Mounted) { return tab.state.messages.map(message => message.id); }
function assertUnaffected(tab: Mounted) {
  expect(tab.state.messages.find(message => message.id === NEIGHBOUR)?.objective).toBe("Synthetic neighbour");
  expect(tab.state.draft).toBe(DRAFT);
  expect(readConversationMessages(OTHER_SCOPE, SESSION).map(message => message.id)).toEqual([TARGET]);
  expect(readConversationMessages(SCOPE, OTHER_SESSION).map(message => message.id)).toEqual([TARGET]);
}
async function withdraw(tab: Mounted) {
  let result!: boolean;
  await act(async () => { result = await tab.state.mutate({ kind: "withdraw", queue_entry_id: TARGET }); });
  await flush();
  expect(mutations()).toHaveLength(1);
  expect(JSON.parse(mutations()[0][1].body)).toMatchObject({ kind: "withdraw", queue_entry_id: TARGET, expected_revision: 7, idempotency_key: expect.any(String) });
  expect(tab.state.snapshot?.session_id).toBe(SESSION);
  expect(tab.state.snapshot?.revision).toBe(8);
  return result;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // happy-dom binds Storage methods onto a proxy. Give each case its own real
  // Storage instance so a denied-operation spy cannot leak into the next case.
  vi.spyOn(window, "localStorage", "get").mockReturnValue(new Storage());
  // Any accidental call beyond the transport double is refused before network access.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("UNEXPECTED_NETWORK"))));
  localStorage.clear(); mounted = []; streams = new Map(); images = new Map(); readImages = null; server = snapshot(); fetcher.mockReset();
  setConversationImageStoreForTest({
    async put(key, next, expected) {
      if (expected && JSON.stringify((images.get(key) ?? []).map(image => image.attachment_id)) !== JSON.stringify(expected)) return false;
      if (next.length) images.set(key, [...next]); else images.delete(key); return true;
    },
    async get(key) { return readImages ? readImages(key) : images.get(key) ?? []; },
    async delete(key) { images.delete(key); },
    async deletePrefix(prefix) { for (const key of images.keys()) if (key.startsWith(prefix)) images.delete(key); },
    async inventory() { return [...images].map(([key, records]) => ({ key, expiresAt: Math.min(...records.map(record => record.expiresAt)) })); },
  });
  writeConversationMessage(SCOPE, SESSION, localMessage(TARGET));
  writeConversationMessage(SCOPE, SESSION, localMessage(NEIGHBOUR));
  writeConversationMessage(OTHER_SCOPE, SESSION, localMessage(TARGET));
  writeConversationMessage(SCOPE, OTHER_SESSION, localMessage(TARGET));
  writeConversationDraft(SCOPE, SESSION, { value: DRAFT, updatedAt: new Date().toISOString(), expiresAt: Date.now() + 60_000, writer: "synthetic" });
  fetcher.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith("/stream")) return Promise.resolve(new Response(new ReadableStream({ start(controller) {
      const binding = (init?.headers as Record<string, string>)["x-workspace-session"];
      streams.set(binding, value => controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(value)}\n\n`)));
    } })));
    if (url.endsWith("/mutations") && init?.method === "POST") {
      server = snapshot(8, false);
      const response: ConversationQueueMutationResponse = { contract_version: VERSION, snapshot: server,
        applied: { kind: "withdraw", queue_entry_id: TARGET, run_id: null, status: null } };
      return Promise.resolve(Response.json(response));
    }
    if (url === `/api/workspace-sessions/${SESSION}` && !init?.method) return Promise.resolve(Response.json({ detail: detail() }));
    if (url.endsWith("/conversation-queue") && !init?.method) return Promise.resolve(Response.json(server));
    return Promise.reject(new Error(`UNEXPECTED_TRANSPORT: ${init?.method ?? "GET"} ${url}`));
  });
});
afterEach(async () => {
  for (const tab of [...mounted]) await unmount(tab);
  vi.restoreAllMocks(); localStorage.clear(); setConversationImageStoreForTest(undefined); vi.unstubAllGlobals();
});

// Break caught: an accepted withdrawal removes A's row but storage reconciliation
// unions B's retained RAM row back into its visible outbox after the new snapshot.
it("retires the other hook after A withdraws, and stays removed on remount", async () => {
  const a = await mount("tab-a"); const b = await mount("tab-b");
  expect(ids(a)).toEqual([TARGET, NEIGHBOUR]); expect(ids(b)).toEqual([TARGET, NEIGHBOUR]);
  const changes = captureStorageChanges();
  expect(await withdraw(a)).toBe(true);
  expect(ids(a)).toEqual([NEIGHBOUR]);
  expect(readConversationMessages(SCOPE, SESSION).map(message => message.id)).toEqual([NEIGHBOUR]);
  expect(changes.some(change => change.key.endsWith(`message:${TARGET}`) && change.oldValue !== null && change.newValue === null)).toBe(true);
  await dispatchStorageChanges(changes); await emit(b, server);
  assertUnaffected(a); assertUnaffected(b); expect(admissions()).toHaveLength(0);
  const retainedRow = b.host.querySelector(`[data-message-id="${TARGET}"]`);
  const retainedIds = ids(b);
  await unmount(b); const reloaded = await mount("tab-b-reloaded");
  expect(ids(reloaded)).toEqual([NEIGHBOUR]); assertUnaffected(reloaded);
  expect(retainedRow).toBeNull();
  expect(retainedIds).toEqual([NEIGHBOUR]);
});

// Break caught: replacing the storage union with a destructive snapshot would
// discard an uncertain delivery merely because another writer removed metadata.
it("keeps an unknown delivery for a standalone missing-row event", async () => {
  server = snapshot(7, false);
  const bytes = new Blob(["synthetic retained bytes"], { type: "image/png" });
  const manifest = { attachment_id: "55555555-5555-4555-8555-555555555555", file_name: "synthetic.png",
    media_type: "image/png" as const, byte_size: bytes.size, content_hash: "a".repeat(64) };
  images.set(conversationImageKey(SCOPE, SESSION, TARGET), [{ ...manifest, position: 0, blob: bytes, expiresAt: Date.now() + 60_000 }]);
  writeConversationMessage(SCOPE, SESSION, { ...localMessage(TARGET, "unknown"), images: [manifest] });
  const b = await mount("tab-b");
  const changes = captureStorageChanges();
  localStorage.removeItem(`talent-signal:conversation:v1:${SCOPE}:${SESSION}:message:${TARGET}`);
  await dispatchStorageChanges(changes); await emit(b, snapshot(8, false));
  expect(b.state.messages.find(message => message.id === TARGET)).toMatchObject({ objective: "Synthetic target", delivery: "unknown" });
  expect(b.host.querySelector(`[data-message-id="${TARGET}"]`)?.textContent).toBe("Synthetic target");
  expect(images.get(conversationImageKey(SCOPE, SESSION, TARGET))?.[0].blob).toBe(bytes);
  assertUnaffected(b); expect(mutations()).toHaveLength(0); expect(admissions()).toHaveLength(0);
});

// Break caught: best-effort local removal is treated as complete even when
// the browser denied it and a subsequent mount can read the exact old intent.
it("reports unknown local cleanup when removeItem leaves the old row readable", async () => {
  const a = await mount("tab-a");
  const key = `talent-signal:conversation:v1:${SCOPE}:${SESSION}:message:${TARGET}`;
  const original = localStorage.getItem(key);
  const remove = localStorage.removeItem.bind(localStorage);
  vi.spyOn(localStorage, "removeItem").mockImplementation(value => {
    if (value === key) throw new DOMException("Synthetic metadata denial", "SecurityError");
    remove(value);
  });
  const result = await withdraw(a);
  expect(localStorage.getItem(key)).toBe(original);
  const reloaded = await mount("tab-reloaded");
  assertUnaffected(a); assertUnaffected(reloaded); expect(admissions()).toHaveLength(0);
  expect(result === false || a.state.error.length > 0).toBe(true);
});

// Break caught: drain holds a pending image intent across await uploadsFor;
// a withdrawal in another hook must revoke that captured intent before POST.
it.each([true, false])("does not POST or recreate a captured image after A withdraws (storage event: %s)", async deliverEvent => {
  const bytes = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], { type: "image/png" });
  const record: DurableConversationImage = { attachment_id: "55555555-5555-4555-8555-555555555555", file_name: "synthetic.png",
    media_type: "image/png", byte_size: bytes.size, content_hash: "a".repeat(64), position: 0, blob: bytes, expiresAt: Date.now() + 60_000 };
  const manifest = { attachment_id: record.attachment_id, file_name: record.file_name, media_type: record.media_type,
    byte_size: record.byte_size, content_hash: record.content_hash };
  const imageKey = conversationImageKey(SCOPE, SESSION, TARGET);
  images.set(imageKey, [record]);
  writeConversationMessage(SCOPE, SESSION, { ...localMessage(TARGET), images: [manifest] });
  const a = await mount("tab-a");
  let resolve!: (value: DurableConversationImage[]) => void;
  const held = new Promise<DurableConversationImage[]>(yes => { resolve = yes; });
  let capturedRead = false;
  readImages = key => {
    if (key === imageKey) { capturedRead = true; return held; }
    return Promise.resolve(images.get(key) ?? []);
  };
  writeConversationMessage(SCOPE, SESSION, { ...localMessage(TARGET, "pending"), receiptUncertain: false, images: [manifest] });
  const b = await mount("tab-b", false);
  expect(capturedRead).toBe(true); expect(b.state.messages.find(message => message.id === TARGET)?.delivery).toBe("pending");
  const composer = b.host.querySelector("textarea");
  const changes = captureStorageChanges();
  expect(await withdraw(a)).toBe(true);
  expect(images.has(imageKey)).toBe(false);
  expect(readConversationMessages(SCOPE, SESSION).map(message => message.id)).toEqual([NEIGHBOUR]);
  if (deliverEvent) await dispatchStorageChanges(changes);
  await act(async () => resolve([record])); await flush();
  assertUnaffected(a); assertUnaffected(b); expect(b.host.querySelector("textarea")).toBe(composer);
  expect(admissions().map(([, init]) => JSON.parse(init.body).message_id)).not.toContain(TARGET);
  expect(readConversationMessages(SCOPE, SESSION).map(message => message.id)).toEqual([NEIGHBOUR]);
});
