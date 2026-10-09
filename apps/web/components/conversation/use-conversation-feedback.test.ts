// @vitest-environment happy-dom
//
// Quiet feedback gaps around admission and the completed snapshot/history
// handoff. A local outbox message (and its local attachment bytes) is the
// durable evidence of what was sent: it must survive any server active/queued
// snapshot and an active->empty completion whose canonical history readback is
// delayed or failing, so the transcript never goes blank before the persisted
// final answer arrives. A stopped run and a completed run must stay distinct.
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  conversationImageKey,
  setConversationImageStoreForTest,
  type ConversationImageStore,
  type DurableConversationImage,
} from "../../lib/conversation-image-store";
import { readConversationMessages, writeConversationMessage } from "../../lib/conversation-local";
import { useConversation } from "./use-conversation";
import type { SessionDetail } from "../session-workbench/session-detail-state";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("../workspace-session-request", () => ({ workspaceSessionFetch: fetcher }));

const sid = "72ce7ff4-a5a8-40d0-b1d7-d84a13adcd30";
const mid = "a072ed54-6d56-413d-af4b-3ebc01ba646a";

function detail(turns: SessionDetail["turns"] = []): SessionDetail {
  return {
    session_id: sid,
    revision: 3,
    updated_at: "2026-09-24T19:51:06.000Z",
    expires_at: "2030-01-01T00:00:00.000Z",
    state: "active",
    title: "反馈与交接",
    turn_count: turns.length,
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
    turns,
  } as SessionDetail;
}

function entry(messageId: string, overrides: Record<string, unknown> = {}) {
  return {
    queue_entry_id: mid,
    message_id: messageId,
    sequence: 1,
    status: "running",
    objective: "已接收的原位消息",
    images: [],
    created_at: "2026-09-24T00:00:00.000Z",
    updated_at: "2026-09-24T00:00:00.000Z",
    revision: 2,
    run_id: "66666666-6666-4666-8666-666666666666",
    stage: "answer",
    cancel_requested: false,
    failure_code: null,
    ...overrides,
  };
}

function snapshot(revision: number, active: unknown, queued: unknown[] = [], paused = false) {
  return {
    contract_version: "2026-08-24.10",
    session_id: sid,
    revision,
    paused,
    preview: null,
    active,
    queued,
  };
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function turn(id: string, objective: string, images: SessionDetail["turns"][number]["images"] = []) {
  return {
    id,
    objective,
    images,
    createdAt: "2026-09-24T00:05:00.000Z",
    response: {
      contractVersion: "2026-08-24.10",
      taskID: "77777777-7777-4777-8777-777777777777",
      contextManifestID: "",
      knowledgeSnapshotID: "",
      disposition: "answer",
      createdAt: "2026-09-24T00:05:01.000Z",
      unboundConversationBlocks: [{ id: "block-1", kind: "answer", title: null, body: "持久化的最终回复。", status: "informational", citation_dependency_ids: [], requires_user_decision: false, allows_static_share: false, target_ref: null }],
      memoryProposal: null,
      meetingDraft: null,
    },
  } as unknown as SessionDetail["turns"][number];
}

function memoryStore() {
  const map = new Map<string, DurableConversationImage[]>();
  const store: ConversationImageStore = {
    async put(key, images) { map.set(key, [...images]); return true; },
    async get(key) { return map.get(key) ?? []; },
    async delete(key) { map.delete(key); },
    async deletePrefix(prefix) { for (const key of [...map.keys()]) if (key.startsWith(prefix)) map.delete(key); },
    async inventory() { return [...map.entries()].map(([key, images]) => ({ key, expiresAt: images.reduce((min, image) => Math.min(min, image.expiresAt), Number.POSITIVE_INFINITY) })); },
  };
  return { map, store };
}

let chat: ReturnType<typeof useConversation>;
let root: Root;
let mount: HTMLDivElement;
let memory: ReturnType<typeof memoryStore>;
let emit: ((chunk: string) => void) | null = null;
let detailBody: () => Response | Promise<Response>;

function Probe({ initial }: { initial?: SessionDetail }) {
  const current = useConversation({ id: sid, scope: "owner", chatBinding: "chat", detailBinding: "detail", initial, onAdmitted: () => undefined });
  useLayoutEffect(() => { chat = current; });
  return null;
}

async function flush(times = 8) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  });
}

async function drainMicrotasks(times = 24) {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  memory = memoryStore();
  setConversationImageStoreForTest(memory.store);
  fetcher.mockReset();
  emit = null;
  detailBody = () => Response.json({ detail: detail() });
  fetcher.mockImplementation((url: string) => {
    if (String(url).endsWith("/stream")) {
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) { emit = (chunk) => controller.enqueue(new TextEncoder().encode(chunk)); },
      })));
    }
    if (String(url).endsWith(`/api/workspace-sessions/${sid}`)) return Promise.resolve(detailBody());
    return Promise.resolve(Response.json({}));
  });
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  setConversationImageStoreForTest(undefined);
  vi.unstubAllGlobals();
});

it("retains the accepted message through an active snapshot with no canonical history yet", async () => {
  writeConversationMessage("owner", sid, {
    id: mid, objective: "已接收的原位消息", createdAt: "2026-09-24T00:00:00.000Z",
    delivery: "accepted", receiptUncertain: false, expiresAt: Date.now() + 60_000,
  });
  await act(async () => { root.render(createElement(Probe, { initial: detail() })); });
  await flush();
  await act(async () => { emit?.(frame("snapshot", snapshot(4, entry(mid)))); });
  await flush();

  // The server row confirms processing but is not canonical history: the
  // exact local identity stays until its turn exists.
  expect(chat.messages.map((message) => message.id)).toEqual([mid]);
  expect(readConversationMessages("owner", sid).map((message) => message.id)).toEqual([mid]);
});

it("keeps the outbox message and its bytes when the active snapshot empties before a failing history readback", async () => {
  // The message is admitted with its local attachment bytes first.
  fetcher.mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).endsWith("/stream")) {
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) { emit = (chunk) => controller.enqueue(new TextEncoder().encode(chunk)); },
      })));
    }
    if (init?.method === "POST" && String(url).endsWith("/conversation-queue")) return Promise.resolve(Response.json({}, { status: 202 }));
    if (String(url).endsWith(`/api/workspace-sessions/${sid}`)) return Promise.reject(new Error("readback failed"));
    return Promise.resolve(Response.json({}));
  });
  await act(async () => { root.render(createElement(Probe, { initial: detail() })); });
  await flush();
  await act(async () => {
    await chat.addFiles([new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], "shot.png", { type: "image/png" })]);
  });
  await act(async () => { chat.changeDraft("带图的原位消息"); await chat.submit(); });
  await flush();
  const messageId = chat.messages[0]!.id;
  expect(chat.messages[0]!.delivery).toBe("accepted");
  const key = conversationImageKey("owner", sid, messageId);
  await act(async () => { chat.changeDraft("交接期间保留的新草稿"); });

  // Active snapshot, then the completed snapshot empties the active slot
  // while the canonical history readback is failing.
  await act(async () => {
    emit?.(frame("snapshot", snapshot(5, entry(messageId))));
    emit?.(frame("snapshot", snapshot(6, null)));
  });
  await flush();

  expect(chat.messages.map((message) => message.id)).toEqual([messageId]);
  expect(readConversationMessages("owner", sid).map((message) => message.id)).toEqual([messageId]);
  // Local attachment bytes stay owned by this client until canonical history
  // (or another durable server representation) carries them.
  expect(memory.map.has(key)).toBe(true);
  // The completed run is distinguishable from a stopped one: readback pending.
  expect(chat.runOutcome[messageId]).toBe("completed");
  // The unsent draft surface is untouched by the handoff.
  expect(chat.draft).toBe("交接期间保留的新草稿");
});

it("reports a stopped run as stopped and never as a completed readback", async () => {
  writeConversationMessage("owner", sid, {
    id: mid, objective: "会被停止的消息", createdAt: "2026-09-24T00:00:00.000Z",
    delivery: "accepted", receiptUncertain: false, expiresAt: Date.now() + 60_000,
  });
  await act(async () => { root.render(createElement(Probe, { initial: detail() })); });
  await flush();
  await act(async () => {
    emit?.(frame("snapshot", snapshot(5, entry(mid, { cancel_requested: true }))));
    emit?.(frame("snapshot", snapshot(6, null)));
  });
  await flush();
  expect(chat.runOutcome[mid]).toBe("stopped");
});

it("retires the local message and its bytes exactly once when canonical history carries them", async () => {
  writeConversationMessage("owner", sid, {
    id: mid, objective: "已接收的原位消息", createdAt: "2026-09-24T00:00:00.000Z",
    delivery: "accepted", receiptUncertain: false, expiresAt: Date.now() + 60_000,
    images: [{ attachment_id: "66666666-6666-4666-8666-666666666666", file_name: "shot.png", media_type: "image/png", byte_size: 8, content_hash: "a".repeat(64) }],
  });
  await act(async () => { root.render(createElement(Probe, { initial: detail() })); });
  await flush();
  await act(async () => { emit?.(frame("snapshot", snapshot(4, entry(mid)))); });
  await flush();
  expect(chat.messages.map((message) => message.id)).toEqual([mid]);

  // Canonical history readback arrives with the same identity and manifests.
  detailBody = () => Response.json({ detail: detail([turn(mid, "已接收的原位消息", [{ attachment_id: "66666666-6666-4666-8666-666666666666", file_name: "shot.png", media_type: "image/png", byte_size: 8, content_hash: "a".repeat(64) }])]) });
  await act(async () => { await chat.refreshDetail(); });
  await flush();
  expect(chat.messages).toEqual([]);
  expect(readConversationMessages("owner", sid)).toEqual([]);
  // The canonical turn is the single projected representation now.
  expect((chat.detail?.turns ?? []).map((entry) => entry.id)).toEqual([mid]);
});

it("marks a stalled readback recoverable while retaining the exact message identity", async () => {
  vi.useFakeTimers();
  try {
    writeConversationMessage("owner", sid, {
      id: mid, objective: "已接收的原位消息", createdAt: "2026-09-24T00:00:00.000Z",
      delivery: "accepted", receiptUncertain: false, expiresAt: Date.now() + 60_000,
    });
    fetcher.mockImplementation((url: string) => {
      if (String(url).endsWith("/stream")) {
        return Promise.resolve(new Response(new ReadableStream({
          start(controller) { emit = (chunk) => controller.enqueue(new TextEncoder().encode(chunk)); },
        })));
      }
      return Promise.reject(new Error("readback failed"));
    });
    await act(async () => { root.render(createElement(Probe, { initial: detail() })); });
    await act(async () => { await drainMicrotasks(); });
    await act(async () => {
      emit?.(frame("snapshot", snapshot(5, entry(mid))));
      emit?.(frame("snapshot", snapshot(6, null)));
      await drainMicrotasks();
    });
    await act(async () => { vi.advanceTimersByTime(13_000); await drainMicrotasks(); });
    // The bounded passive retries never resend a POST and leave the stalled
    // readback explicitly recoverable with its identity intact.
    expect(chat.readbackStalled).toContain(mid);
    expect(chat.messages.map((message) => message.id)).toEqual([mid]);
    expect(readConversationMessages("owner", sid).map((message) => message.id)).toEqual([mid]);
    expect(fetcher.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

it("never lets a passive readback retry touch the network after the surface unmounts", async () => {
  vi.useFakeTimers();
  try {
    writeConversationMessage("owner", sid, {
      id: mid, objective: "已接收的原位消息", createdAt: "2026-09-24T00:00:00.000Z",
      delivery: "accepted", receiptUncertain: false, expiresAt: Date.now() + 60_000,
    });
    fetcher.mockImplementation((url: string) => {
      if (String(url).endsWith("/stream")) {
        return Promise.resolve(new Response(new ReadableStream({
          start(controller) { emit = (chunk) => controller.enqueue(new TextEncoder().encode(chunk)); },
        })));
      }
      return Promise.reject(new Error("readback failed"));
    });
    await act(async () => { root.render(createElement(Probe, { initial: detail() })); });
    await act(async () => { await drainMicrotasks(); });
    await act(async () => {
      emit?.(frame("snapshot", snapshot(5, entry(mid))));
      emit?.(frame("snapshot", snapshot(6, null)));
      await drainMicrotasks();
    });
    // The passive readback retries are armed before the surface unmounts.
    expect(chat.runOutcome[mid]).toBe("completed");
    const before = fetcher.mock.calls.length;
    await act(async () => { root.unmount(); });
    await act(async () => { vi.advanceTimersByTime(30_000); });
    // Stale scope: the unmounted conversation schedules nothing and keeps the
    // retained message recoverable by the next mounted read.
    expect(fetcher.mock.calls.length).toBe(before);
    expect(readConversationMessages("owner", sid).map((message) => message.id)).toEqual([mid]);
  } finally {
    vi.useRealTimers();
  }
});

it("never re-admits a server-confirmed message when history readback fails", async () => {
  writeConversationMessage("owner", sid, { id: mid, objective: "lost receipt", createdAt: "2026-09-24T00:00:00.000Z", delivery: "unknown", receiptUncertain: true, expiresAt: Date.now() + 60_000 });
  await act(async () => root.render(createElement(Probe, { initial: detail() })));
  await flush();
  detailBody = () => Promise.reject(new Error("history offline"));
  fetcher.mockImplementation((url: string) => String(url).endsWith("/conversation-queue") ? Promise.resolve(Response.json(snapshot(5, entry(mid)))) : Promise.reject(new Error("history offline")));
  await act(async () => { await chat.retryDelivery(chat.messages[0]!); });
  await flush();
  expect(chat.messages[0]?.delivery).toBe("accepted");
  expect(fetcher.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(0);
});

it("does not treat a rejected Stop request as an observed stop", async () => {
  await act(async () => root.render(createElement(Probe, { initial: detail() })));
  await flush();
  const running = snapshot(5, entry(mid));
  await act(async () => emit?.(frame("snapshot", running)));
  await flush();
  fetcher.mockImplementation((url: string) => String(url).endsWith("/mutations") ? Promise.resolve(Response.json({message:"refused"},{status:500})) : Promise.resolve(Response.json(running)));
  await act(async () => { await chat.mutate({kind:"stop",run_id:entry(mid).run_id}); });
  await act(async () => emit?.(frame("snapshot", snapshot(6, null))));
  await flush();
  expect(chat.runOutcome[mid]).toBe("completed");
});

it("does not carry a stopped run outcome into a later run of the same message", async () => {
  await act(async () => root.render(createElement(Probe, { initial: detail() })));
  await flush();
  await act(async () => { emit?.(frame("snapshot",snapshot(5,entry(mid,{cancel_requested:true}))));emit?.(frame("snapshot",snapshot(6,null))); });
  await flush();
  await act(async () => { emit?.(frame("snapshot",snapshot(7,entry(mid,{run_id:"99999999-9999-4999-8999-999999999999"}))));emit?.(frame("snapshot",snapshot(8,null))); });
  await flush();
  expect(chat.runOutcome[mid]).toBe("completed");
});

it("keeps local evidence when canonical history returns a different same-count image", async () => {
  const images = [{attachment_id:"66666666-6666-4666-8666-666666666666",file_name:"shot.png",media_type:"image/png" as const,byte_size:8,content_hash:"a".repeat(64)}];
  writeConversationMessage("owner",sid,{id:mid,objective:"original",createdAt:"2026-09-24T00:00:00.000Z",delivery:"accepted",receiptUncertain:false,expiresAt:Date.now()+60_000,images});
  await act(async () => root.render(createElement(Probe,{initial:detail()})));await flush();
  detailBody=()=>Response.json({detail:detail([turn(mid,"original",[{...images[0]!,content_hash:"b".repeat(64)}])])});
  await act(async()=>{await chat.refreshDetail();});
  expect(readConversationMessages("owner",sid).map(m=>m.id)).toEqual([mid]);
});

it("counts a retained server queue message once when admitting a supplement",async()=>{
 const queued=Array.from({length:25},(_,i)=>entry(`message-${i}`,{status:"queued",run_id:null}));
 for(const row of queued)writeConversationMessage("owner",sid,{id:row.message_id,objective:row.objective,createdAt:row.created_at,delivery:"accepted",receiptUncertain:false,expiresAt:Date.now()+60_000});
 await act(async()=>root.render(createElement(Probe,{initial:detail()})));await flush();
 await act(async()=>emit?.(frame("snapshot",snapshot(5,null,queued))));await flush();
 await act(async()=>chat.changeDraft("next supplement"));
 await act(async()=>{expect(await chat.submit()).toBe(true);});
 await flush();
 expect(fetcher.mock.calls.filter(call=>call[1]?.method==="POST")).toHaveLength(1);
});

it("retains streamed text when preview and completion arrive in one network chunk", async () => {
  detailBody = () => Promise.reject(new Error("history delayed"));
  await act(async () => root.render(createElement(Probe, { initial: detail() })));
  await flush();
  await act(async () => emit?.(frame("snapshot", snapshot(5, entry(mid)))));
  await flush();
  const text = "Already streamed response";
  await act(async () => emit?.(
    frame("preview", { run_id: entry(mid).run_id, message_id: mid, text, stage: "answer", revision: 1 })
    + frame("snapshot", snapshot(6, null)),
  ));
  await flush();
  expect(chat.handoffPreviews[mid]?.text).toBe(text);
});
