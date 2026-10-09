// @vitest-environment happy-dom
//
// Quiet feedback gaps in the embedded conversation surface. One compact,
// truthful assistant work row sits directly beneath the sent message from the
// earliest send state until the persisted final answer replaces it: no blank
// window between admission and the active snapshot, and no blank transcript
// when the completed snapshot empties the active slot before canonical
// history is readable. Status text always derives from observed
// delivery/queue/run/connection state; nothing is acknowledged, animated or
// completed without evidence.
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

import { writeConversationMessage } from "@/lib/conversation-local";
import { QueuedConversation } from "./queued-conversation";

const SCOPE = "b".repeat(64);
const SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MID = "44444444-4444-4444-8444-444444444444";
const LOCAL_UNKNOWN = "55555555-5555-5555-8555-555555555555";

const initialDetail = {
  session_id: SESSION,
  revision: 4,
  updated_at: "2026-09-24T00:00:00.000Z",
  expires_at: "2026-10-01T00:00:00.000Z",
  state: "active" as const,
  title: "反馈与交接",
  turn_count: 0,
  is_unread: false,
  scope_kind: "unresolved_intent" as const,
  person_id: null,
  relationship_context_id: null,
  person_label: "",
  context_label: "",
  deleted_at: null,
  display_authority: "stale_unconfirmed" as const,
  composer_draft: null,
  composer_draft_updated_at: null,
  turns: [],
};

function entry(messageId: string, overrides: Record<string, unknown> = {}) {
  return {
    queue_entry_id: messageId,
    message_id: messageId,
    sequence: 1,
    status: "running",
    objective: "原位消息",
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
  return { contract_version: "2026-08-24.10", session_id: SESSION, revision, paused, preview: null, active, queued };
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function turn(id: string, objective: string) {
  return {
    id,
    objective,
    images: [],
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
  };
}

let mount: HTMLDivElement | null = null;
let root: Root | null = null;
let emit: ((chunk: string) => void) | null = null;
let detailBody: () => Response | Promise<Response>;

async function flush(times = 10) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  });
}

async function renderConversation() {
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => {
    root?.render(createElement(QueuedConversation, {
      chatBinding: "chat-binding",
      detailBinding: "detail-binding",
      scope: SCOPE,
      initialDetail,
    }));
  });
  await flush(6);
}

function acceptLocal(id: string, objective: string, delivery: "accepted" | "unknown" = "accepted", error?: string) {
  writeConversationMessage(SCOPE, SESSION, {
    id, objective, createdAt: "2026-09-24T00:00:02.000Z",
    delivery, receiptUncertain: delivery === "unknown", expiresAt: Date.now() + 60 * 60 * 1000,
    ...(error ? { error } : {}),
  });
}

function workRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-conversation-work]")];
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  router.push.mockReset();
  fetcher.mockReset();
  emit = null;
  detailBody = () => Response.json({ detail: initialDetail });
  fetcher.mockImplementation((url: string) => {
    if (String(url).endsWith("/stream")) {
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) { emit = (chunk) => controller.enqueue(new TextEncoder().encode(chunk)); },
      })));
    }
    if (String(url).endsWith(`/api/workspace-sessions/${SESSION}`)) return Promise.resolve(detailBody());
    return Promise.resolve(Response.json({}));
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  mount?.remove();
  mount = null;
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("shows one truthful work row beneath an accepted message before any SSE state arrives", async () => {
  acceptLocal(MID, "已接收的原位消息");
  await renderConversation();

  const rows = workRows();
  expect(rows).toHaveLength(1);
  expect(rows[0]!.getAttribute("data-phase")).toBe("waiting");
  // Identity keeps the current product name and the monochrome brand mark.
  expect(rows[0]!.textContent).toContain("capri");
  expect(rows[0]!.querySelector("[data-work-mark]")).not.toBeNull();
  // Accepted-but-unobserved means waiting for reply status, never running.
  expect(rows[0]!.textContent).toContain("等待回复状态");
  expect(document.body.textContent).toContain("已接收的原位消息");
  expect(document.body.textContent).not.toContain("正在回复");
  expect(document.body.textContent).not.toContain("正在处理");
  // Distinct from the delivery phases and free of any success footnote.
  expect(document.body.textContent).not.toContain("等待送达");
  expect(document.body.textContent).not.toContain("正在送达");
  expect(document.body.textContent).not.toContain("已送达");
  // No fabricated progress metric.
  expect(rows[0]!.textContent).not.toMatch(/\d+\s*%/u);
});

it("keeps the sent message visible with a readback row when the active slot empties before history", async () => {
  acceptLocal(MID, "已接收的原位消息");
  fetcher.mockImplementation((url: string) => {
    if (String(url).endsWith("/stream")) {
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) { emit = (chunk) => controller.enqueue(new TextEncoder().encode(chunk)); },
      })));
    }
    return Promise.reject(new Error("readback failed"));
  });
  await renderConversation();
  await act(async () => {
    emit?.(frame("snapshot", snapshot(5, entry(MID, {objective: "已接收的原位消息"}))));
    emit?.(frame("snapshot", snapshot(6, null)));
  });
  await flush();

  // The completed snapshot no longer projects the message, but the outbox
  // identity keeps the transcript truthful instead of blank.
  expect(document.body.textContent).toContain("已接收的原位消息");
  const rows = workRows();
  expect(rows).toHaveLength(1);
  expect(rows[0]!.getAttribute("data-phase")).toBe("readback");
  expect(rows[0]!.textContent).toContain("正在读取回复");
  expect(document.querySelectorAll("[data-user-message]")).toHaveLength(1);
});

it("replaces the work row with the persisted final answer exactly once", async () => {
  acceptLocal(MID, "已接收的原位消息");
  await renderConversation();
  await act(async () => { emit?.(frame("snapshot", snapshot(5, entry(MID)))); });
  await flush();
  // While the run is live its execution record owns the status; the compact
  // work row stays reserved for the unrepresented send and readback states.
  expect(document.body.textContent).toContain("正在处理");
  expect(workRows()).toHaveLength(0);

  detailBody = () => Response.json({ detail: { ...initialDetail, revision: 5, turns: [turn(MID, "已接收的原位消息")] } });
  await act(async () => { emit?.(frame("snapshot", snapshot(6, null))); });
  await flush();

  // Final replacement without a duplicate user bubble or a stale work row.
  expect(document.querySelectorAll("[data-user-message]")).toHaveLength(1);
  expect(document.body.textContent).toContain("持久化的最终回复。");
  expect(workRows()).toHaveLength(0);
});

it("keeps the queued supplement state and its existing queue controls", async () => {
  acceptLocal(MID, "可控补充的下一条");
  await renderConversation();
  await act(async () => {
    emit?.(frame("snapshot", snapshot(5, entry(OTHER, { message_id: OTHER, objective: "正在处理的原位消息" }), [
      entry(MID, { queue_entry_id: MID, sequence: 2, status: "queued", objective: "可控补充的下一条", run_id: null, stage: null }),
    ])));
  });
  await flush();

  // The queued supplement keeps one truthful transcript state without any
  // duplicate local bubble, and the queue controls stay editable.
  expect(document.body.textContent).toContain("已排队，等待处理");
  expect(document.body.textContent).toContain("可控补充的下一条");
  expect(document.querySelectorAll("[data-user-message]")).toHaveLength(2);
  const queue = document.querySelector("[aria-label='可控补充']");
  expect(queue).not.toBeNull();
  expect(queue?.textContent).toContain("可控补充的下一条");
  expect(document.querySelector("button[aria-label='优先处理第 1 条待处理消息']")).not.toBeNull();
});

it("shows paused and failed queue states without any status animation", async () => {
  acceptLocal(MID, "停下来的补充");
  await renderConversation();
  await act(async () => {
    emit?.(frame("snapshot", snapshot(5, null, [
      entry(MID, { queue_entry_id: MID, sequence: 1, status: "queued", objective: "停下来的补充", run_id: null, stage: null }),
    ], true)));
  });
  await flush();
  // Paused is a fact about the queue, not a running state; nothing pulses.
  expect(document.body.textContent).toContain("已暂停");
  expect(document.querySelector("[data-animate='true']")).toBeNull();

  await act(async () => {
    emit?.(frame("snapshot", snapshot(6, null, [
      entry(MID, { queue_entry_id: MID, sequence: 1, status: "failed", objective: "停下来的补充", run_id: null, stage: null, failure_code: "MODEL_RUN_FAILED" }),
    ])));
  });
  await flush();
  // The failure keeps its bounded reason and the existing retry control.
  expect(document.body.textContent).toContain("上次未完成，请重试或移除");
  expect(document.querySelector("[data-animate='true']")).toBeNull();
});

it("reports a stopped run as stopped and never animates it", async () => {
  acceptLocal(MID, "会被停止的消息");
  await renderConversation();
  await act(async () => {
    emit?.(frame("snapshot", snapshot(5, entry(MID, { cancel_requested: true }))));
    emit?.(frame("snapshot", snapshot(6, null)));
  });
  await flush();
  const row = workRows().find((candidate) => candidate.getAttribute("data-phase") === "stopped");
  expect(row).not.toBeUndefined();
  expect(row!.textContent).toContain("已停止");
  expect(row!.getAttribute("data-animate")).toBe("false");
});

it("shows connection recovery while the status feed cannot deliver state", async () => {
  acceptLocal(MID, "已接收的原位消息");
  fetcher.mockImplementation((url: string) => {
    if (String(url).endsWith("/stream")) return Promise.reject(new Error("stream down"));
    return Promise.resolve(Response.json({ detail: initialDetail }));
  });
  await renderConversation();
  await flush();
  const rows = workRows();
  expect(rows).toHaveLength(1);
  expect(rows[0]!.textContent).toContain("连接恢复中，消息已保留");
  expect(rows[0]!.getAttribute("data-animate")).toBe("false");
});

it("keeps streaming text fully visible with one identity and a small current status", async () => {
  acceptLocal(MID, "已接收的原位消息");
  await renderConversation();
  await act(async () => {
    emit?.(frame("snapshot", {
      ...snapshot(5, entry(MID)),
      preview: { run_id: entry(MID).run_id, message_id: MID, text: "正在整理的回复草稿，全部保留。", stage: "answer", revision: 1 },
    }));
  });
  await flush();

  // The streaming text stays fully visible and gains the observed run stage.
  expect(document.body.textContent).toContain("正在整理的回复草稿，全部保留。");
  expect([...document.querySelectorAll("[role='status']")].some((node) => node.textContent === "正在回复")).toBe(true);
  // One identity label only; the duplicate local user bubble is hidden while
  // the canonical active projection shows the message.
  expect(document.querySelectorAll("[role='img'][aria-label='capri']")).toHaveLength(1);
  expect(document.querySelectorAll("[data-user-message]")).toHaveLength(1);
});

it("keeps the same-ID check and retry for an unknown delivery and never shows it as processing", async () => {
  acceptLocal(LOCAL_UNKNOWN, "送达未知的消息", "unknown", "送达结果尚未确认，可核对并重试。");
  await renderConversation();

  const rows = workRows();
  expect(rows).toHaveLength(1);
  expect(rows[0]!.getAttribute("data-phase")).toBe("unknown");
  expect(document.body.textContent).toContain("送达结果尚未确认，可核对并重试。");
  expect([...document.querySelectorAll("button")].some((button) => button.textContent === "核对并重试")).toBe(true);
  expect(document.body.textContent).not.toContain("等待回复状态");
  expect(document.body.textContent).not.toContain("正在回复");
  expect(document.body.textContent).not.toContain("正在处理");
});

it("keeps an existing remote active message visible when completion history cannot be read",async()=>{
 await renderConversation();detailBody=()=>Promise.reject(new Error("history offline"));
 await act(async()=>{emit?.(frame("snapshot",snapshot(5,entry(MID,{objective:"remote message without an outbox"}))));});await flush();
 await act(async()=>{emit?.(frame("snapshot",snapshot(6,null)));});await flush();
 expect(document.body.textContent).toContain("remote message without an outbox");
 expect(workRows()[0]?.textContent).toContain("正在读取回复");
});

it("keeps an earlier readback before the next active message",async()=>{
 acceptLocal(MID,"earlier message");await renderConversation();detailBody=()=>Promise.reject(new Error("history offline"));
 await act(async()=>emit?.(frame("snapshot",snapshot(5,entry(MID,{objective:"earlier message"})))));await flush();
 await act(async()=>emit?.(frame("snapshot",snapshot(6,entry(OTHER,{objective:"later message",created_at:"2026-09-24T00:00:03.000Z"})))));await flush();
 const text=[...document.querySelectorAll('[data-user-message]')].map(n=>n.textContent);
 expect(text).toEqual(["earlier message","later message"]);
});

it("renders the authoritative edited queue objective",async()=>{
 acceptLocal(MID,"old draft");await renderConversation();
 await act(async()=>emit?.(frame("snapshot",snapshot(5,null,[entry(MID,{status:"queued",objective:"edited queue message",run_id:null})]))));await flush();
 expect(document.querySelector('[data-user-message]')?.textContent).toBe("edited queue message");
});

it("keeps already streamed text visible through a failed completion readback",async()=>{
 await renderConversation();detailBody=()=>Promise.reject(new Error("history offline"));
 await act(async()=>emit?.(frame("snapshot",snapshot(5,entry(MID)))));await flush();
 await act(async()=>emit?.(frame("preview",{run_id:entry(MID).run_id,message_id:MID,text:"已经生成的部分回复",stage:"answer",revision:1})));await flush();
 await act(async()=>emit?.(frame("snapshot",snapshot(6,null))));await flush();
 expect(document.body.textContent).toContain("已经生成的部分回复");
 expect(document.body.textContent).toContain("正在读取回复");
});
