// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationQueueEntry, ConversationQueueSnapshot } from "@talent-signal/contracts";
import { useConversation } from "./use-conversation";
import { writeConversationMessage } from "@/lib/conversation-local";
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
  expires_at: "2026-10-25T00:00:00Z", state: "active", title: "Synthetic", turn_count: 0, is_unread: false,
  scope_kind: "unresolved_intent", person_id: null, relationship_context_id: null, person_label: "", context_label: "",
  deleted_at: null, display_authority: "stale_unconfirmed", composer_draft: null, composer_draft_updated_at: null, turns: [] }; }
let state: ReturnType<typeof useConversation>;
function Harness({ id, scope, binding }: { id: string; scope: string; binding: string }) {
  const conversation = useConversation({ id, scope, chatBinding: binding, detailBinding: "detail", initial: detail(id) });
  useLayoutEffect(() => { state = conversation; });
  return createElement("textarea", { value: conversation.draft, onChange: event => conversation.changeDraft(event.target.value) });
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
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals(); });

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
