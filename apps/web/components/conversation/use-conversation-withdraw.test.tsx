// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationQueueEntry, ConversationQueueMutationResponse, ConversationQueueSnapshot } from "@talent-signal/contracts";

import { useConversation } from "./use-conversation";
import { conversationImageKey, setConversationImageStoreForTest, type DurableConversationImage } from "@/lib/conversation-image-store";
import { readConversationMessages, writeConversationDraft, writeConversationMessage, readConversationWithdrawals, reserveConversationWithdrawal, type LocalMessage } from "@/lib/conversation-local";
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
async function settleUntil(done: () => boolean) {
  const deadline = performance.now() + 1000;
  while (!done() && performance.now() < deadline) await flush();
  expect(done()).toBe(true);
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
    async deleteConfirmed(key) { images.delete(key); return true; },
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
        applied: { kind: "withdraw", queue_entry_id: TARGET, run_id: null, status: null, withdrawn_message_ids: [TARGET] } };
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
  await act(async () => resolve([record]));
  // Observable drain completion: retirement must be applied to B even when the
  // event was withheld. Fixed microtask counts cannot certify a completed drain.
  await settleUntil(() => !ids(b).includes(TARGET));
  assertUnaffected(a); assertUnaffected(b); expect(b.host.querySelector("textarea")).toBe(composer);
  expect(admissions().map(([, init]) => JSON.parse(init.body).message_id)).not.toContain(TARGET);
  expect(readConversationMessages(SCOPE, SESSION).map(message => message.id)).toEqual([NEIGHBOUR]);
});

function reservation(operation = "66666666-6666-4666-8666-666666666666") {
  return { version: 1 as const, operation, queueEntryId: TARGET, targetMessageId: TARGET, expectedRevision: 7,
    createdAt: Date.now(), protectUntil: Date.now() + 86_400_000, state: "pending" as const };
}
it("does not POST when a durable withdrawal cannot be reserved", async () => {
  const a = await mount("tab-a"); const previous = localStorage.setItem.bind(localStorage);
  vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => { if (key.includes(":withdrawal:")) throw new Error("quota"); previous(key, value); });
  let result!: boolean; await act(async () => { result = await a.state.mutate({ kind: "withdraw", queue_entry_id: TARGET }); });
  expect(result).toBe(false); expect(mutations()).toHaveLength(0); expect(ids(a)).toEqual([TARGET, NEIGHBOUR]); assertUnaffected(a);
});
it("keeps a durable pending operation when confirmation promotion fails and replays identical bytes after reload", async () => {
  const a = await mount("tab-a"); const previous = localStorage.setItem.bind(localStorage);
  vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => { if (key.includes(":withdrawal:") && JSON.parse(value).state === "confirmed") throw new Error("quota"); previous(key, value); });
  expect(await withdraw(a)).toBe(false);
  expect(ids(a)).toEqual([TARGET, NEIGHBOUR]); expect(a.state.messages.every(message => message.delivery === "unknown")).toBe(true);
  const operation = readConversationWithdrawals(SCOPE, SESSION);
  expect(operation.status).toBe("known"); if (operation.status !== "known") throw new Error("missing operation");
  expect(operation.records).toHaveLength(1); expect(operation.records[0].state).toBe("pending");
  const originalBody = mutations()[0][1].body;
  await unmount(a); vi.mocked(localStorage.setItem).mockImplementation(previous);
  const b = await mount("reloaded");
  await settleUntil(() => ids(b).length === 1 && ids(b)[0] === NEIGHBOUR);
  expect(mutations()).toHaveLength(2); expect(mutations()[1][1].body).toBe(originalBody); expect(admissions()).toHaveLength(0);
  const recovered = readConversationWithdrawals(SCOPE, SESSION);
  expect(recovered.status === "known" && recovered.records[0]).toMatchObject({ ...operation.records[0], state: "confirmed", cleanup: "confirmed" });
});
it("replays an existing pending operation at its original revision and never admits its unknown content", async () => {
  const saved = reservation(); reserveConversationWithdrawal(SCOPE, SESSION, saved);
  const a = await mount("recovery");
  expect(mutations()).toHaveLength(1); expect(JSON.parse(mutations()[0][1].body)).toEqual({ kind: "withdraw", queue_entry_id: TARGET,
    expected_revision: 7, idempotency_key: saved.operation, include_withdrawn_message_ids: true });
  expect(ids(a)).toEqual([NEIGHBOUR]); expect(admissions()).toHaveLength(0); assertUnaffected(a);
});
it.each(["legacy", "empty", "duplicate", "too many", "missing target", "malformed", "foreign session", "stale revision", "non-null run", "wrong kind", "wrong queue entry", "non-null status"] as const)("retains unknown evidence for an unconfirmed %s receipt", async kind => {
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => {
    if (!url.endsWith("/mutations")) return base(url, init);
    const applied: Record<string, unknown> = { kind: "withdraw", queue_entry_id: TARGET, run_id: null, status: null, withdrawn_message_ids: [TARGET] };
    const next = snapshot(8, false);
    if (kind === "legacy") delete applied.withdrawn_message_ids;
    if (kind === "empty") applied.withdrawn_message_ids = [];
    if (kind === "duplicate") applied.withdrawn_message_ids = [TARGET, TARGET];
    if (kind === "too many") applied.withdrawn_message_ids = [TARGET, ...Array.from({ length: 51 }, (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`)];
    if (kind === "missing target") applied.withdrawn_message_ids = [NEIGHBOUR];
    if (kind === "malformed") applied.withdrawn_message_ids = [TARGET, "composer-draft"];
    if (kind === "foreign session") next.session_id = OTHER_SESSION;
    if (kind === "stale revision") next.revision = 7;
    if (kind === "non-null run") applied.run_id = TARGET;
    if (kind === "wrong kind") applied.kind = "retry";
    if (kind === "wrong queue entry") applied.queue_entry_id = NEIGHBOUR;
    if (kind === "non-null status") applied.status = "queued";
    return Promise.resolve(Response.json({ contract_version: VERSION, snapshot: next, applied }));
  });
  const a = await mount("tab-a"); expect(await withdraw(a)).toBe(false);
  expect(ids(a)).toEqual([TARGET, NEIGHBOUR]); expect(a.state.messages.every(message => message.delivery === "unknown")).toBe(true);
  expect(readConversationWithdrawals(SCOPE, SESSION)).toMatchObject({ status: "known", records: [{ state: "pending" }] });
  assertUnaffected(a); expect(admissions()).toHaveLength(0);
});
it("uses exact receipt group IDs to retire an unobserved supplement and preserve an absent unrelated neighbour", async () => {
  const supplement = "77777777-7777-4777-8777-777777777777";
  writeConversationMessage(SCOPE, SESSION, { ...localMessage(supplement), objective: "unobserved supplement" });
  const a = await mount("a"); const b = await mount("b"); const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/mutations") ? Promise.resolve(Response.json({ contract_version: VERSION,
    snapshot: { ...snapshot(8, false), queued: [] }, applied: { kind: "withdraw", queue_entry_id: TARGET, run_id: null, status: null, withdrawn_message_ids: [TARGET, supplement] } })) : base(url, init));
  const changes = captureStorageChanges(); expect(await withdraw(a)).toBe(true); await dispatchStorageChanges(changes);
  expect(ids(a)).toEqual([NEIGHBOUR]); expect(ids(b)).toEqual([NEIGHBOUR]); assertUnaffected(a); assertUnaffected(b);
});
it("keeps positive proof and retries only local cleanup after an unavailable byte store recovers", async () => {
  const a = await mount("a"); setConversationImageStoreForTest(null);
  expect(await withdraw(a)).toBe(false); expect(ids(a)).toEqual([NEIGHBOUR]);
  expect(a.state.error).toContain("本机清理");
  expect(readConversationWithdrawals(SCOPE, SESSION)).toMatchObject({ status: "known", records: [{ state: "confirmed", cleanup: "pending" }] });
  await unmount(a); const deleted: string[] = [];
  setConversationImageStoreForTest({ async get() { return []; }, async put() { return false; }, async delete() {}, async deletePrefix() {}, async inventory() { return []; }, async deleteConfirmed(key) { deleted.push(key); return true; } });
  const b = await mount("b"); expect(ids(b)).toEqual([NEIGHBOUR]); expect(mutations()).toHaveLength(1);
  expect(deleted).toEqual([conversationImageKey(SCOPE, SESSION, TARGET)]);
  expect(readConversationWithdrawals(SCOPE, SESSION)).toMatchObject({ status: "known", records: [{ state: "confirmed", cleanup: "confirmed" }] });
});

it("denied withdrawal inventory retains content as unknown and blocks admission", async () => {
  const a = await mount("a");
  vi.spyOn(localStorage, "key").mockImplementation(() => { throw new Error("inventory denied"); });
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: `talent-signal:conversation:v1:${SCOPE}:${SESSION}:withdrawal:unknown`, storageArea: localStorage })));
  expect(ids(a)).toEqual([TARGET, NEIGHBOUR]); expect(a.state.messages.every(row => row.delivery === "unknown")).toBe(true);
  await act(async () => a.state.retryDelivery(a.state.messages[0]));
  expect(admissions()).toHaveLength(0); expect(mutations()).toHaveLength(0);
});
it("a late admission JSON cannot recreate retired RAM or metadata", async () => {
  const a = await mount("a");
  let resolve!: (body: unknown) => void;
  const json = new Promise<unknown>(yes => { resolve = yes; });
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/conversation-queue") && init?.method === "POST"
    ? Promise.resolve({ ok: true, headers: new Headers(), json: () => json } as Response) : base(url, init));
  writeConversationMessage(SCOPE, SESSION, { ...localMessage(TARGET, "pending"), receiptUncertain: false });
  const b = await mount("b", false); expect(admissions()).toHaveLength(1);
  expect(await withdraw(a)).toBe(true);
  await act(async () => resolve({ session_id: SESSION, message_id: TARGET }));
  await settleUntil(() => !ids(b).includes(TARGET));
  expect(readConversationMessages(SCOPE, SESSION).map(row => row.id)).toEqual([NEIGHBOUR]);
  expect(admissions()).toHaveLength(1); assertUnaffected(a); assertUnaffected(b);
});
it("a late retry readback cannot re-pend a retired message", async () => {
  const a = await mount("a"); const b = await mount("b");
  let resolve!: (body: unknown) => void;
  const json = new Promise<unknown>(yes => { resolve = yes; }); const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/conversation-queue") && !init?.method
    ? Promise.resolve({ ok: true, headers: new Headers(), json: () => json } as Response) : base(url, init));
  let retry!: Promise<void>;
  await act(async () => { retry = b.state.retryDelivery(b.state.messages.find(row => row.id === TARGET)!); });
  expect(await withdraw(a)).toBe(true);
  await act(async () => { resolve(snapshot(7, false)); await retry; });
  expect(ids(b)).toEqual([NEIGHBOUR]); expect(admissions()).toHaveLength(0); assertUnaffected(b);
});
it("a definitive structured CAS rejection retires only the reservation without rebasing or admitting", async () => {
  const a = await mount("a"); const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/mutations")
    ? Promise.resolve(Response.json({ code: "CONVERSATION_QUEUE_REVISION_CONFLICT", message: "synthetic CAS" }, { status: 409 })) : base(url, init));
  expect(await withdraw(a)).toBe(false); expect(mutations()).toHaveLength(1);
  expect(readConversationWithdrawals(SCOPE, SESSION)).toEqual({ status: "known", records: [] });
  expect(ids(a)).toEqual([TARGET, NEIGHBOUR]); expect(admissions()).toHaveLength(0); assertUnaffected(a);
});

it("does not POST an expired captured image even after completed proof is safely collected", async () => {
  const expiresAt = Date.now() + 60000;
  const bytes = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
  const record: DurableConversationImage = { attachment_id: "55555555-5555-4555-8555-555555555555", file_name: "synthetic.png", media_type: "image/png", byte_size: bytes.size, content_hash: "a".repeat(64), position: 0, blob: bytes, expiresAt };
  const manifest = { attachment_id: record.attachment_id, file_name: record.file_name, media_type: record.media_type, byte_size: record.byte_size, content_hash: record.content_hash };
  const imageKey = conversationImageKey(SCOPE, SESSION, TARGET); images.set(imageKey, [record]);
  writeConversationMessage(SCOPE, SESSION, { ...localMessage(TARGET), expiresAt, images: [manifest] });
  const a = await mount("a"); let resolve!: (value: DurableConversationImage[]) => void;
  const held = new Promise<DurableConversationImage[]>(yes => { resolve = yes; });
  readImages = key => key === imageKey ? held : Promise.resolve(images.get(key) ?? []);
  writeConversationMessage(SCOPE, SESSION, { ...localMessage(TARGET, "pending"), expiresAt, images: [manifest], receiptUncertain: false });
  const b = await mount("b", false); expect(b.state.messages[0].delivery).toBe("pending");
  expect(await withdraw(a)).toBe(true);
  const inventory = readConversationWithdrawals(SCOPE, SESSION); if (inventory.status !== "known") throw new Error("missing proof");
  const future = inventory.records[0].protectUntil + 1; vi.spyOn(Date, "now").mockReturnValue(future);
  const { removeConversationWithdrawalIfSafe } = await import("@/lib/conversation-local");
  expect(removeConversationWithdrawalIfSafe(SCOPE, SESSION, inventory.records[0].operation, future)).toBe(true);
  await act(async () => resolve([record]));
  await settleUntil(() => b.state.messages.find(row => row.id === TARGET)?.delivery === "unknown");
  expect(admissions()).toHaveLength(0);
  expect(localStorage.getItem(`talent-signal:conversation:v1:${SCOPE}:${SESSION}:message:${TARGET}`)).toBeNull();
});
it("does not present a denied authority inventory as a known empty outbox after reload", async () => {
  vi.spyOn(localStorage, "key").mockImplementation(() => { throw new Error("denied inventory"); });
  const a = await mount("a");
  expect(a.state.error).toContain("本机"); expect(a.state.error).toContain("刷新");
  expect(admissions()).toHaveLength(0); expect(mutations()).toHaveLength(0);
});
