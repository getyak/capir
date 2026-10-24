// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationQueueEntry, ConversationQueueSnapshot, MeetingDraftRecord } from "@talent-signal/contracts";
import type { SessionDetail } from "../session-workbench/session-detail-state";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("@/components/workspace-session-request", () => ({
  WORKSPACE_SESSION_EXPIRED_EVENT: "talent-signal:workspace-session-expired",
  workspaceSessionFetch: fetcher, workspaceSessionExpired: () => false,
  relationshipIntegrationFetch: fetcher, relationshipIntegrationSessionExpired: () => false,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace", useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
import { writeConversationMessage } from "@/lib/conversation-local";
import { QueuedConversation } from "./queued-conversation";
import { LocaleProvider } from "../locale-provider";

const SESSION = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "33333333-3333-4333-8333-333333333333";
const RUN = "44444444-4444-4444-8444-444444444444";
const SCOPE = "d".repeat(64);
const initial: SessionDetail = {
  session_id: SESSION, revision: 1, updated_at: "2026-10-24T00:00:00Z", expires_at: "2026-10-25T00:00:00Z",
  state: "active", title: "Prepare a meeting", turn_count: 0, is_unread: false,
  scope_kind: "unresolved_intent", person_id: null, relationship_context_id: null,
  person_label: "", context_label: "", deleted_at: null, display_authority: "stale_unconfirmed",
  composer_draft: null, composer_draft_updated_at: null, turns: [],
};
function entry(overrides: Partial<ConversationQueueEntry> = {}): ConversationQueueEntry {
  return { queue_entry_id: MESSAGE, message_id: MESSAGE, sequence: 1, status: "running", objective: "Synthetic task",
    created_at: "2026-10-24T00:00:00Z", started_at: "2026-10-24T00:00:02Z", updated_at: "2026-10-24T00:00:03Z",
    revision: 2, run_id: RUN, stage: "contact_read", cancel_requested: false, failure_code: null, ...overrides };
}
function snapshot(revision: number, active: ConversationQueueEntry | null, queued: ConversationQueueEntry[] = [], paused = false): ConversationQueueSnapshot {
  return { contract_version: "2026-08-24.10", session_id: SESSION, revision, active, queued, paused, preview: null };
}
function completed(): SessionDetail {
  return { ...initial, revision: 4, turn_count: 1, turns: [{ id: MESSAGE, objective: "Synthetic task", createdAt: initial.updated_at,
    response: { taskID: "synthetic", contractVersion: "2026-08-24.10", createdAt: initial.updated_at,
      contextManifestID: "", knowledgeSnapshotID: "", disposition: "answer", savedBlocks: [] } }] };
}
let root: Root;
let host: HTMLDivElement;
let detail: SessionDetail;
let emitters: Array<(value: ConversationQueueSnapshot) => void>;
async function flush() { await act(async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 1)); } }); }
async function render(binding = "chat-a", scope = SCOPE, initialDetail = initial, locale: "en" | "zh-CN" = "en") {
  await act(async () => root.render(<LocaleProvider locale={locale}><QueuedConversation chatBinding={binding} detailBinding="detail" scope={scope} initialDetail={initialDetail}/></LocaleProvider>));
  await flush();
}
async function emit(value: ConversationQueueSnapshot, emitter = emitters.at(-1)!) { await act(async () => emitter(value)); await flush(); }
function capsule() { return host.querySelector<HTMLElement>("[data-session-task-capsule]"); }
async function open() { expect(capsule(), "observed task must expose a capsule").not.toBeNull(); const trigger = capsule()!.querySelector<HTMLButtonElement>("button")!; await act(async () => trigger.click()); await flush(); return trigger; }
function actions() { return fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body)); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear(); window.history.replaceState(null, "", "/workspace");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  detail = initial; emitters = []; fetcher.mockReset();
  fetcher.mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).endsWith("/stream")) return Promise.resolve(new Response(new ReadableStream({ start(controller) {
      emitters.push(value => controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(value)}\n\n`)));
    } })));
    if (init?.method === "POST") return Promise.resolve(Response.json({ snapshot: snapshot(10, entry({ cancel_requested: true }), [], true) }));
    if (/^\/api\/workspace-sessions\/[^/]+$/.test(String(url))) return Promise.resolve(Response.json({ detail }));
    return Promise.resolve(Response.json({}));
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps idle and reopened canonical history free of task status", async () => {
  await render(); expect(capsule()).toBeNull();
  await act(async () => root.unmount()); root = createRoot(host); detail = completed();
  await render("chat-a", SCOPE, detail); await emit(snapshot(5, null));
  expect(capsule()).toBeNull();
});
it("discloses an actual stage and elapsed record without sending or stopping on status click", async () => {
  await render(); await emit(snapshot(2, entry()));
  expect(capsule()?.textContent ?? "").toContain("Reading the related records");
  expect(document.body.textContent).not.toContain("Observed time");
  const trigger = await open();
  expect(document.body.textContent).toContain("Observed time");
  expect(actions()).toEqual([]);
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await flush(); expect(trigger.getAttribute("aria-expanded")).toBe("false"); expect(document.activeElement).toBe(trigger);
  expect(actions()).toEqual([]);
});
it("stops only through the deliberate control and never continues the stopped queue", async () => {
  await render(); await emit(snapshot(2, entry())); await open();
  const stop = [...document.querySelectorAll<HTMLButtonElement>("[data-slot='popover-content'] button")].find(button => button.textContent === "Stop");
  expect(stop).toBeDefined(); await act(async () => stop!.click()); await flush();
  expect(actions().map(action => action.kind)).toEqual(["stop"]);
  expect(actions()[0].run_id).toBe(RUN); expect(capsule()?.textContent ?? "").toContain("Stopping");
  await emit(snapshot(11, null, [entry({ message_id: "77777777-7777-4777-8777-777777777777", queue_entry_id: "77777777-7777-4777-8777-777777777777", status: "queued", run_id: null, started_at: null })], true)); expect(capsule()?.textContent ?? "").toContain("Stopped");
  expect(actions().map(action => action.kind)).toEqual(["stop"]);
});
it("shows queued and paused work from the real queue without approving or continuing on disclosure", async () => {
  await render(); await emit(snapshot(2, null, [entry({ status: "queued", run_id: null, stage: null, started_at: null })]));
  expect(capsule()?.textContent ?? "").toContain("Queued");
  await emit(snapshot(3, null, [entry({ status: "queued", run_id: null, stage: null, started_at: null })], true));
  expect(capsule()?.textContent ?? "").toContain("Paused"); await open(); expect(actions()).toEqual([]);
});
it("keeps failed and unknown work visible with honest recovery and no raw service failure", async () => {
  await render(); await emit(snapshot(2, null, [entry({ status: "failed", failure_code: "MODEL_RUN_TIMEOUT" })]));
  expect(capsule()?.textContent ?? "").toContain("Not completed"); await open();
  expect(document.body.textContent).toContain("Retry"); expect(actions()).toEqual([]);
  await act(async () => root.unmount()); root = createRoot(host);
  writeConversationMessage(SCOPE, SESSION, { id: MESSAGE, objective: "Synthetic task", createdAt: initial.updated_at,
    delivery: "unknown", receiptUncertain: true, expiresAt: Date.now() + 60_000 });
  await render(); expect(capsule()?.textContent ?? "").toContain("Delivery unconfirmed");
});
it("waits for canonical readback instead of claiming success from a completed queue entry", async () => {
  await render(); await emit(snapshot(2, entry())); await emit(snapshot(3, null));
  expect(capsule()?.textContent ?? "").toContain("Reading reply");
  expect(capsule()?.textContent ?? "").not.toContain("Completed");
  detail = completed(); await emit(snapshot(4, null));
  expect(capsule()).toBeNull();
});
it("does not resurrect old active work or callbacks across binding ABA", async () => {
  await render(); await emit(snapshot(2, entry())); await open();
  const oldStop = [...document.querySelectorAll<HTMLButtonElement>("[data-slot='popover-content'] button")].find(button => button.textContent === "Stop")!;
  expect(oldStop).toBeDefined();
  await render("chat-b"); expect(capsule()).toBeNull();
  await render("chat-a"); expect(capsule()).toBeNull();
  await act(async () => oldStop.click()); await flush(); expect(actions()).toEqual([]);
  await emit(snapshot(3, entry({ run_id: "55555555-5555-4555-8555-555555555555" })));
  expect(capsule()?.textContent ?? "").toContain("Reading the related records");
});

it("does not continue a new binding when an old deliberate retry finishes late", async () => {
  await render(); await emit(snapshot(2, null, [entry({ status: "failed" })])); await open();
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>(res => { resolve = res; });
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => init?.method === "POST" ? pending : base(url, init));
  const retry = [...document.querySelectorAll<HTMLButtonElement>("[data-slot='popover-content'] button")].find(button => button.textContent === "Retry")!;
  expect(retry).toBeDefined(); await act(async () => retry.click()); await flush();
  expect(actions().map(action => action.kind)).toEqual(["retry"]);
  await render("chat-b"); await render("chat-a");
  await act(async () => resolve(Response.json({ snapshot: snapshot(3, null, [entry({ status: "queued", run_id: null })]) })));
  await flush(); expect(actions().map(action => action.kind)).toEqual(["retry"]); expect(capsule()).toBeNull();
});
it("does not call a terminal queue row a completed persisted answer", async () => {
  await render(); await emit(snapshot(2, entry({ status: "completed", stage: "persisting" })));
  expect(capsule()?.textContent ?? "").toContain("Reading reply");
  expect(capsule()?.textContent ?? "").not.toContain("Completed");
});
it("uses only the accepted preview stage for the current run", async () => {
  await render(); const value = snapshot(2, entry({ stage: "thinking" }));
  value.preview = { run_id: RUN, message_id: MESSAGE, text: "", stage: "persisting", revision: 1 };
  await emit(value); expect(capsule()?.textContent ?? "").toContain("Saving the reply");
});
it("leaves a pending calendar decision in its governed card after canonical reply readback", async () => {
  const draftId = "66666666-6666-4666-8666-666666666666";
  const draft: Extract<MeetingDraftRecord, { status: "needs_review" }> = {
    id: draftId, external_effect: "none", revision: 1, source_task_id: RUN, origin_session_id: SESSION,
    created_at: initial.updated_at, updated_at: initial.updated_at, expires_at: "2026-10-25T00:00:00Z",
    content_available: true, status: "needs_review", dismissed_at: null, redacted_at: null,
    title: "Synthetic meeting review", starts_at: "2026-10-24T16:00:00Z", ends_at: "2026-10-24T16:30:00Z",
    time_zone: "Asia/Shanghai", source_excerpt: "Synthetic agreed time", reference_time: initial.updated_at,
  };
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => url.includes("/api/meeting-drafts/")
    ? Promise.resolve(Response.json({ draft, session_version: "detail" })) : base(url, init));
  await render(); await emit(snapshot(2, entry()));
  detail = completed(); detail.turns[0].response.meetingDraft = { id: draftId, title: draft.title };
  await emit(snapshot(3, null));
  expect(capsule()).toBeNull();
  expect(host.textContent).toContain("Synthetic meeting review");
  expect(host.textContent).toContain("Download calendar draft");
  expect(host.textContent).toContain("Execution complete, awaiting your decision");
  expect(actions()).toEqual([]);
});
it("measures live elapsed time from its actual started timestamp only inside disclosure", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T00:00:12Z"));
  try {
    await render(); await emit(snapshot(2, entry()));
    expect(host.textContent).not.toContain("Observed time"); await open();
    expect(document.querySelector("[data-slot='popover-content']")?.textContent).toContain("Observed time 10 sec");
    expect(document.querySelector("[data-slot='popover-content']")?.textContent).not.toContain("%");
  } finally { vi.useRealTimers(); }
});

it.each([
  [409, "en", "The queue changed and has been refreshed. Check it before acting again."],
  [503, "en", "The operation is unconfirmed. Your content is retained. Check the queue before retrying."],
  [409, "zh-CN", "队列刚刚有变化，已更新。请核对后再操作。"],
  [503, "zh-CN", "操作结果尚未确认，已保留内容。请核对队列后重试。"],
] as const)("renders real mutation %s recovery in %s without admission or continue", async (status, locale, expected) => {
  await render("chat-a", SCOPE, initial, locale);
  const failed = entry({ status: "failed" }); await emit(snapshot(2, null, [failed]));
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith("/mutations")) return Promise.resolve(Response.json({ message: "Raw mutation provider detail" }, { status }));
    if (url.endsWith("/conversation-queue")) return Promise.resolve(Response.json(snapshot(3, null, [failed])));
    return base(url, init);
  });
  const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === (locale === "en" ? "Retry" : "重试"))!;
  await act(async () => retry.click()); await flush();
  expect(host.textContent).toContain(expected); expect(host.textContent).not.toContain("Raw mutation provider detail");
  expect(actions().map(action => action.kind)).toEqual(["retry"]);
  expect(host.textContent).toContain("Synthetic task");
});
it.each([
  ["en", "Could not save the send status. Your content is still in the composer. Restore browser storage, then try again."],
  ["zh-CN", "无法保存发送状态，内容仍在输入框中。请恢复浏览器存储后重试。"],
] as const)("renders a real local persistence failure in %s and retains the original draft", async (locale, expected) => {
  const draft = "用户原文 · retained source";
  await render("chat-a", SCOPE, { ...initial, composer_draft: draft }, locale);
  const storage = window.localStorage;
  // happy-dom binds Storage methods on a proxy; replacing its window getter
  // keeps this transport failure scoped and reliably restorable between cases.
  vi.spyOn(window, "localStorage", "get").mockReturnValue(new Proxy(storage, {
    get(target, key) { if (key === "setItem") return () => { throw new Error("Storage denied"); }; return Reflect.get(target, key); },
  }));
  const send = host.querySelector<HTMLButtonElement>(locale === "en" ? '[aria-label="Send message"]' : '[aria-label="发送消息"]')!;
  expect(send).not.toBeNull(); await act(async () => send.click()); await flush();
  expect(host.textContent).toContain(expected);
  expect(host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")?.value).toBe(draft);
  expect(actions()).toEqual([]);
});
it.each([
  ["en", "Delivery is unconfirmed. Check the status, then retry."],
  ["zh-CN", "送达结果尚未确认，可核对并重试。"],
] as const)("renders the real unknown-delivery explanation in %s without auto resend", async (locale, expected) => {
  await render("chat-a", SCOPE, { ...initial, composer_draft: "用户原文 · lost receipt" }, locale);
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/conversation-queue") && init?.method === "POST"
    ? Promise.reject(new Error("transport disconnected")) : base(url, init));
  const send = host.querySelector<HTMLButtonElement>(locale === "en" ? '[aria-label="Send message"]' : '[aria-label="发送消息"]')!;
  await act(async () => send.click()); await flush();
  expect(host.textContent).toContain(expected); expect(host.textContent).toContain("用户原文 · lost receipt");
  expect(host.querySelector("[data-conversation-work][data-phase='unknown']")).not.toBeNull();
  await flush(); expect(actions()).toHaveLength(1);
});
it("preserves uncataloged provider and user wording in an English rejected-delivery surface", async () => {
  const provider = "服务商原文 · original provider explanation";
  const user = "用户原文 · keep wording";
  await render("chat-a", SCOPE, { ...initial, composer_draft: user });
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/conversation-queue") && init?.method === "POST"
    ? Promise.resolve(Response.json({ message: provider }, { status: 422 })) : base(url, init));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.click()); await flush();
  expect(host.textContent).toContain(provider); expect(host.textContent).toContain(user);
  expect(host.querySelector("[data-conversation-work][data-phase='rejected']")).not.toBeNull(); expect(actions()).toHaveLength(1);
});
