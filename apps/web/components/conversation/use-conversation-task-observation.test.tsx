// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, type ChangeEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationQueueEntry, ConversationQueueSnapshot } from "@talent-signal/contracts";
import { useConversation } from "./use-conversation";
import { setConversationImageStoreForTest, type DurableConversationImage } from "@/lib/conversation-image-store";
import { readConversationMessages, writeConversationMessage } from "@/lib/conversation-local";
import type { SessionDetail } from "../session-workbench/session-detail-state";
const fetcher = vi.hoisted(() => vi.fn());
vi.mock("@/components/workspace-session-request", () => ({ WORKSPACE_SESSION_EXPIRED_EVENT: "expired", workspaceSessionFetch: fetcher }));
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333";
const SCOPE = "d".repeat(64);
const entry: ConversationQueueEntry = { queue_entry_id: MESSAGE, message_id: MESSAGE, sequence: 1, status: "running",
  objective: "Synthetic", created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z", revision: 1,
  run_id: "44444444-4444-4444-8444-444444444444", stage: "thinking", cancel_requested: false, failure_code: null };
function detail(id: string): SessionDetail { return { session_id: id, revision: 1, updated_at: entry.created_at,
  expires_at: new Date(Date.now() + 3_600_000).toISOString(), state: "active", title: "Synthetic", turn_count: 0, is_unread: false,
  scope_kind: "unresolved_intent", person_id: null, relationship_context_id: null, person_label: "", context_label: "",
  deleted_at: null, display_authority: "stale_unconfirmed", composer_draft: null, composer_draft_updated_at: null, turns: [] }; }
let state: ReturnType<typeof useConversation>;
function Harness({ id, scope, binding }: { id: string; scope: string; binding: string }) {
  const conversation = useConversation({ id, scope, chatBinding: binding, detailBinding: "detail", initial: detail(id) });
  useLayoutEffect(() => { state = conversation; });
  return createElement("textarea", { value: conversation.draft, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => conversation.changeDraft(event.target.value) });
}
let root: Root;
let host: HTMLDivElement;
let streams: Array<{ id: string; emit: (snapshot: ConversationQueueSnapshot) => void }>;
async function flush() { await act(async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 1)); } }); }
async function render(id = A, scope = SCOPE, binding = "a") { await act(async () => root.render(createElement(Harness, { id, scope, binding }))); await flush(); }
async function snapshot(revision: number, active: ConversationQueueEntry | null) {
  const stream = streams.at(-1)!;
  await act(async () => stream.emit({ contract_version: "2026-08-24.10", session_id: stream.id, revision, paused: false, active, queued: [], preview: null })); await flush();
}
beforeEach(() => {
  const images = new Map<string, DurableConversationImage[]>();
  setConversationImageStoreForTest({
    async put(key, next, expected) {
      if (expected && JSON.stringify((images.get(key) ?? []).map(image => image.attachment_id)) !== JSON.stringify(expected)) return false;
      if (next.length) images.set(key, [...next]); else images.delete(key);
      return true;
    },
    async get(key) { return images.get(key) ?? []; },
    async delete(key) { images.delete(key); },
    async deletePrefix(prefix) { for (const key of images.keys()) if (key.startsWith(prefix)) images.delete(key); },
    async inventory() { return [...images].map(([key, records]) => ({ key, expiresAt: Math.min(...records.map(image => image.expiresAt)) })); },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); streams = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); fetcher.mockReset();
  fetcher.mockImplementation((url: string) => {
    const id = url.split("/")[3];
    if (url.endsWith("/stream")) return Promise.resolve(new Response(new ReadableStream({ start(controller) {
      streams.push({ id, emit: value => controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(value)}\n\n`)) });
    } })));
    return Promise.resolve(Response.json({ detail: detail(id) }));
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); setConversationImageStoreForTest(undefined); vi.unstubAllGlobals(); });

it.each(["binding", "scope", "session"])("fences real observations through %s ABA while preserving the composer node", async change => {
  await render(); await snapshot(1, entry); const oldOwner = state.taskObservation.owner;
  const composer = host.querySelector("textarea");
  expect(state.taskObservation.snapshot?.active?.run_id).toBe(entry.run_id);
  if (change === "binding") await render(A, SCOPE, "b");
  if (change === "scope") await render(A, "e".repeat(64));
  if (change === "session") await render(B);
  expect(state.taskObservation.snapshot).toBeNull();
  expect(state.taskObservation.handoffEntries).toEqual({});
  await render();
  expect(state.taskObservation.owner).not.toBe(oldOwner);
  expect(state.taskObservation.snapshot).toBeNull();
  expect(state.taskObservation.runOutcome).toEqual({});
  expect(host.querySelector("textarea")).toBe(composer);
  await snapshot(2, { ...entry, run_id: "55555555-5555-4555-8555-555555555555" });
  expect(state.taskObservation.snapshot?.active?.run_id).toBe("55555555-5555-4555-8555-555555555555");
});
it("does not attach an old completed outcome to an accepted same-ID local row in a new scope", async () => {
  await render(); await snapshot(1, entry); await snapshot(2, null);
  expect(state.taskObservation.runOutcome[MESSAGE]).toBe("completed");
  const other = "e".repeat(64);
  writeConversationMessage(other, A, { id: MESSAGE, objective: "Synthetic collision", createdAt: entry.created_at,
    delivery: "accepted", receiptUncertain: false, expiresAt: Date.now() + 60_000 });
  await render(A, other);
  expect(state.taskObservation.messages.map(message => message.id)).toEqual([MESSAGE]);
  expect(state.taskObservation.runOutcome).toEqual({});
  expect(state.taskObservation.handoffEntries).toEqual({});
});

function unknown(scope = SCOPE) {
  writeConversationMessage(scope, A, { id: MESSAGE, objective: "Retained unknown delivery", createdAt: entry.created_at,
    delivery: "unknown", receiptUncertain: true, expiresAt: Date.now() + 60_000 });
}
function posts() { return fetcher.mock.calls.filter(([, init]) => init?.method === "POST"); }
function emptyQueue(revision = 1): ConversationQueueSnapshot {
  return { contract_version: "2026-08-24.10", session_id: A, revision, paused: false, active: null, queued: [], preview: null };
}

it.each(["binding ABA", "same-ID scope switch"])("does not resend or suppress current observations when old retry check aborts after %s", async change => {
  unknown(); await render();
  const composer = host.querySelector("textarea");
  let reject!: (error: Error) => void;
  const pending = new Promise<Response>((_, no) => { reject = no; });
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/conversation-queue") && !init?.method ? pending : base(url, init));
  let retry!: Promise<void>;
  await act(async () => { retry = state.retryDelivery(state.messages[0]); await Promise.resolve(); });
  const scope = change === "binding ABA" ? SCOPE : "e".repeat(64);
  if (change === "binding ABA") { await render(A, SCOPE, "b"); await render(); }
  else { unknown(scope); await render(A, scope); }
  await act(async () => state.changeDraft("New lifecycle unfinished draft"));
  await snapshot(5, null);
  const owner = state.taskObservation.owner;
  expect(state.messages[0].delivery).toBe("unknown");
  await act(async () => { reject(new DOMException("Closed", "AbortError")); await retry; }); await flush();
  expect(state.messages.map(message => ({ id: message.id, delivery: message.delivery }))).toEqual([{ id: MESSAGE, delivery: "unknown" }]);
  expect(posts()).toHaveLength(0);
  expect(state.taskObservation.owner).toBe(owner);
  expect(state.taskObservation.messages.map(message => message.id)).toEqual([MESSAGE]);
  expect(state.taskObservation.snapshot?.revision).toBe(5);
  expect(state.draft).toBe("New lifecycle unfinished draft");
  expect(host.querySelector("textarea")).toBe(composer);
});

it("drops an old retry's delayed queue JSON before snapshot commit or current-owner readback", async () => {
  unknown(); await render(); const composer = host.querySelector("textarea");
  let resolve!: (value: ConversationQueueSnapshot) => void;
  const pending = new Promise<ConversationQueueSnapshot>(yes => { resolve = yes; });
  const response = Response.json({});
  vi.spyOn(response, "json").mockImplementation(() => pending);
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/conversation-queue") && !init?.method ? Promise.resolve(response) : base(url, init));
  let retry!: Promise<void>;
  await act(async () => { retry = state.retryDelivery(state.messages[0]); await Promise.resolve(); await Promise.resolve(); });
  await render(A, SCOPE, "b"); await render();
  await act(async () => state.changeDraft("Keep the new draft")); await snapshot(5, null);
  const beforeReads = fetcher.mock.calls.filter(([url]) => url === `/api/workspace-sessions/${A}`).length;
  await act(async () => { resolve(emptyQueue(10)); await retry; }); await flush();
  expect(state.messages[0].delivery).toBe("unknown");
  expect(posts()).toHaveLength(0);
  expect(state.taskObservation.snapshot?.revision).toBe(5);
  expect(state.taskObservation.messages.map(message => message.id)).toEqual([MESSAGE]);
  expect(fetcher.mock.calls.filter(([url]) => url === `/api/workspace-sessions/${A}`)).toHaveLength(beforeReads);
  expect(state.draft).toBe("Keep the new draft"); expect(host.querySelector("textarea")).toBe(composer);
});

it("ignores an old retry after its history JSON finishes in the new binding", async () => {
  unknown(); await render(); const composer = host.querySelector("textarea");
  let resolve!: (value: { detail: SessionDetail }) => void;
  const pending = new Promise<{ detail: SessionDetail }>(yes => { resolve = yes; });
  const response = Response.json({}); vi.spyOn(response, "json").mockImplementation(() => pending);
  const base = fetcher.getMockImplementation()!;
  let heldHistory = false;
  fetcher.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith("/conversation-queue") && !init?.method) return Promise.resolve(Response.json(emptyQueue()));
    if (url === `/api/workspace-sessions/${A}` && !heldHistory) { heldHistory = true; return Promise.resolve(response); }
    return base(url, init);
  });
  let retry!: Promise<void>;
  await act(async () => { retry = state.retryDelivery(state.messages[0]); }); await flush();
  expect(heldHistory).toBe(true);
  await render(A, SCOPE, "b"); await render(); await snapshot(5, null);
  await act(async () => state.changeDraft("Preserve draft after readback"));
  await act(async () => { resolve({ detail: detail(A) }); await retry; }); await flush();
  expect(posts()).toHaveLength(0); expect(state.messages[0].delivery).toBe("unknown");
  expect(state.taskObservation.snapshot?.revision).toBe(5);
  expect(state.taskObservation.messages.map(message => message.id)).toEqual([MESSAGE]);
  expect(state.draft).toBe("Preserve draft after readback"); expect(host.querySelector("textarea")).toBe(composer);
});

function heldJson(status = 200) {
  let resolve!: (value: unknown) => void;
  const body = new Promise<unknown>(yes => { resolve = yes; });
  const response = Response.json({}, { status });
  vi.spyOn(response, "json").mockImplementation(() => body);
  return { response, resolve };
}
async function beginMutation(input: Parameters<typeof state.mutate>[0]) {
  let result!: Promise<boolean>;
  await act(async () => { result = state.mutate(input); }); await flush();
  return { result };
}
function mutationPosts() { return fetcher.mock.calls.filter(([url, init]) => url.endsWith("/mutations") && init?.method === "POST"); }
async function newMutationOwner(change: "binding ABA" | "same-ID scope switch") {
  if (change === "binding ABA") { await render(A, SCOPE, "b"); await render(); }
  else { unknown("e".repeat(64)); await render(A, "e".repeat(64)); }
  await snapshot(5, null);
  await act(async () => { state.changeDraft("New mutation owner draft"); await state.addFiles([new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], "new-owner.png", { type: "image/png" })]); });
  expect(state.attachments).toHaveLength(1);
}
it.each([
  [200, "binding ABA"], [200, "same-ID scope switch"],
  [401, "binding ABA"], [403, "same-ID scope switch"],
] as const)("drops old mutation %s JSON across %s without reconciling or refusing the current owner", async (status, change) => {
  unknown(); await render(); await snapshot(1, null);
  const held = heldJson(status); const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/mutations") ? Promise.resolve(held.response) : base(url, init));
  const old = await beginMutation({ kind: "retry", queue_entry_id: MESSAGE });
  const composer = host.querySelector("textarea");
  await newMutationOwner(change);
  const owner = state.taskObservation.owner; const attachments = state.attachments;
  const reads = fetcher.mock.calls.filter(([url]) => url.endsWith("/conversation-queue")).length;
  await act(async () => { held.resolve(status === 200 ? { snapshot: { ...emptyQueue(10), active: entry } } : { message: "Departed authority denied" }); await old.result; }); await flush();
  expect(state.messages.map(message => message.delivery)).toEqual(["unknown"]);
  expect(state.taskObservation.messages.map(message => message.id)).toEqual([MESSAGE]);
  expect(state.taskObservation.snapshot?.revision).toBe(5); expect(state.taskObservation.owner).toBe(owner);
  expect(state.draft).toBe("New mutation owner draft"); expect(state.attachments).toEqual(attachments);
  expect(state.unavailable).toBe(false); expect(host.querySelector("textarea")).toBe(composer);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/conversation-queue"))).toHaveLength(reads);
  expect(posts().filter(([url]) => url.endsWith("/conversation-queue"))).toHaveLength(0);
});
it.each(["conflict body", "CAS readback body", "rebase body"])("does not rebase an old Stop after its held %s crosses binding ABA", async boundary => {
  await render(); await snapshot(1, entry);
  const held = heldJson(boundary === "conflict body" ? 409 : 200); const base = fetcher.getMockImplementation()!;
  let stopPosts = 0;
  fetcher.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith("/mutations")) return Promise.resolve(boundary === "conflict body" || (boundary === "rebase body" && ++stopPosts === 2) ? held.response : Response.json({ message: "CAS" }, { status: 409 }));
    if (url.endsWith("/conversation-queue")) return Promise.resolve(boundary === "CAS readback body" ? held.response : Response.json({ ...emptyQueue(2), active: entry }));
    return base(url, init);
  });
  const old = await beginMutation({ kind: "stop", run_id: entry.run_id! });
  await render(A, SCOPE, "b"); await render(); await snapshot(5, null);
  const reads = fetcher.mock.calls.filter(([url]) => url.endsWith("/conversation-queue")).length;
  await act(async () => { held.resolve(boundary === "conflict body" ? { message: "CAS" } : boundary === "rebase body" ? { snapshot: { ...emptyQueue(10), active: entry } } : { ...emptyQueue(10), active: entry }); await old.result; }); await flush();
  expect(mutationPosts()).toHaveLength(boundary === "rebase body" ? 2 : 1);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/conversation-queue"))).toHaveLength(reads);
  expect(state.taskObservation.snapshot?.revision).toBe(5); expect(state.error).toBe("");
});
it("does not commit an old outer-catch recovery body in the current lifecycle", async () => {
  unknown(); await render(); await snapshot(1, null);
  const held = heldJson(); const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith("/mutations")) return Promise.resolve(Response.json({ message: "Failure" }, { status: 500 }));
    if (url.endsWith("/conversation-queue")) return Promise.resolve(held.response);
    return base(url, init);
  });
  const old = await beginMutation({ kind: "retry", queue_entry_id: MESSAGE });
  await newMutationOwner("same-ID scope switch"); const attachments = state.attachments;
  await act(async () => { held.resolve({ ...emptyQueue(10), active: entry }); await old.result; }); await flush();
  expect(state.taskObservation.snapshot?.revision).toBe(5); expect(state.messages[0].delivery).toBe("unknown");
  expect(state.taskObservation.messages.map(message => message.id)).toEqual([MESSAGE]);
  expect(state.draft).toBe("New mutation owner draft"); expect(state.attachments).toEqual(attachments);
  expect(posts().filter(([url]) => url.endsWith("/conversation-queue"))).toHaveLength(0);
});
it("gives the new lifecycle its own single-flight lock and rejects cleanup from an old operation", async () => {
  await render(); await snapshot(1, null);
  const oldBody = heldJson(); const newBody = heldJson(); const base = fetcher.getMockImplementation()!;
  let count = 0;
  fetcher.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/mutations")
    ? Promise.resolve(++count === 1 ? oldBody.response : count === 2 ? newBody.response : Response.json({ snapshot: emptyQueue(7) })) : base(url, init));
  const old = await beginMutation({ kind: "continue" }); expect(state.mutating).toBe(true);
  await render(A, SCOPE, "b"); await render(); await snapshot(5, null);
  expect(state.mutating).toBe(false);
  const current = await beginMutation({ kind: "continue" }); expect(state.mutating).toBe(true); expect(mutationPosts()).toHaveLength(2);
  await act(async () => { expect(await state.mutate({ kind: "continue" })).toBe(false); });
  await act(async () => { oldBody.resolve({ snapshot: emptyQueue(10) }); expect(await old.result).toBe(false); }); await flush();
  expect(state.mutating).toBe(true); expect(state.taskObservation.snapshot?.revision).toBe(5);
  await act(async () => { expect(await state.mutate({ kind: "continue" })).toBe(false); }); expect(mutationPosts()).toHaveLength(2);
  await act(async () => { newBody.resolve({ snapshot: emptyQueue(6) }); expect(await current.result).toBe(true); }); await flush();
  expect(state.mutating).toBe(false); expect(state.taskObservation.snapshot?.revision).toBe(6);
  await act(async () => { expect(await state.mutate({ kind: "continue" })).toBe(true); }); expect(mutationPosts()).toHaveLength(3);
});
it.each(["same run", "replacement run"])("preserves current-owner Stop CAS and idempotency for %s", async target => {
  await render(); await snapshot(1, entry);
  const latest = { ...emptyQueue(2), active: target === "same run" ? entry : { ...entry, run_id: "55555555-5555-4555-8555-555555555555" } };
  const base = fetcher.getMockImplementation()!; let count = 0;
  fetcher.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith("/mutations")) return Promise.resolve(++count === 1 ? Response.json({ message: "CAS" }, { status: 409 }) : Response.json({ snapshot: { ...latest, revision: 3, active: { ...entry, cancel_requested: true } } }));
    if (url.endsWith("/conversation-queue")) return Promise.resolve(Response.json(latest));
    return base(url, init);
  });
  await act(async () => { expect(await state.mutate({ kind: "stop", run_id: entry.run_id! })).toBe(true); }); await flush();
  const bodies = mutationPosts().map(([, init]) => JSON.parse(init.body));
  expect(bodies).toHaveLength(target === "same run" ? 2 : 1);
  if (target === "same run") {
    expect(bodies[1]).toMatchObject({ kind: "stop", run_id: entry.run_id, expected_revision: 2, idempotency_key: bodies[0].idempotency_key });
    expect(bodies[0].expected_revision).toBe(1);
  }
  expect(state.mutating).toBe(false);
});

it.each(["binding ABA", "same-ID scope switch"] as const)("does not retire a same-ID outbox after an old withdrawal crosses %s", async change => {
  unknown(); await render();
  await act(async () => streams.at(-1)!.emit({ ...emptyQueue(1), paused: true, queued: [{ ...entry, status: "failed" }] }));
  await flush();
  const held = heldJson(); const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/mutations") ? Promise.resolve(held.response) : base(url, init));
  const old = await beginMutation({ kind: "withdraw", queue_entry_id: entry.queue_entry_id });
  await newMutationOwner(change);
  await act(async () => { held.resolve({ snapshot: emptyQueue(2), applied: { kind: "withdraw", queue_entry_id: entry.queue_entry_id, run_id: null, status: null } }); expect(await old.result).toBe(false); });
  await flush();
  expect(readConversationMessages(SCOPE, A).map(message => message.id)).toEqual([MESSAGE]);
  expect(state.messages.map(message => message.id)).toEqual([MESSAGE]);
  expect(state.draft).toBe("New mutation owner draft");
  expect(state.attachments).toHaveLength(1);
});

it("does not submit a withdrawal using the departed scope's queue revision before a fresh observation", async () => {
  unknown(); await render();
  await act(async () => streams.at(-1)!.emit({ ...emptyQueue(1), paused: true, queued: [{ ...entry, status: "failed" }] })); await flush();
  const other = "e".repeat(64); unknown(other); await render(A, other);
  expect(state.taskObservation.snapshot).toBeNull();
  await act(async () => { expect(await state.mutate({ kind: "withdraw", queue_entry_id: entry.queue_entry_id })).toBe(false); });
  expect(mutationPosts()).toHaveLength(0);
  expect(readConversationMessages(other, A)).toHaveLength(1);
});
