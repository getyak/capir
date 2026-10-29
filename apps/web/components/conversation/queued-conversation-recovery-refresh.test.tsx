// @vitest-environment happy-dom
//
// Explicit readback refresh on the work row: one bounded GET with local
// idle/loading/failed feedback, a synchronous fence against repeat clicks, a
// usable retry on failure, and stale feedback dropped when the account/session
// owner or the message lifecycle changes. The refresh never clears retained
// content, never exposes raw backend errors and never claims a persisted
// answer exists.
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

import { conversationHome, writeConversationMessage } from "@/lib/conversation-local";
import { QueuedConversation } from "./queued-conversation";
import { beginWorkspaceSearchFocusHandoff } from "@/lib/workspace-search-focus";
import * as conversationModule from "./use-conversation";

const SCOPE = "d".repeat(64);
const SESSION = "11111111-1111-4111-8111-111111111111";
const MID = "44444444-4444-4444-8444-444444444444";
const RUN_ID = "66666666-6666-4666-8666-666666666666";

const initialDetail = {
  session_id: SESSION,
  revision: 4,
  updated_at: "2026-09-24T00:00:00.000Z",
  expires_at: "2026-10-01T00:00:00.000Z",
  state: "active" as const,
  title: "刷新反馈",
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

function entry(overrides: Record<string, unknown> = {}) {
  return {
    queue_entry_id: MID,
    message_id: MID,
    sequence: 1,
    status: "running",
    objective: "被停止的消息",
    images: [],
    created_at: "2026-09-24T00:00:00.000Z",
    updated_at: "2026-09-24T00:00:00.000Z",
    revision: 2,
    run_id: RUN_ID,
    stage: "answer",
    cancel_requested: true,
    failure_code: null,
    ...overrides,
  };
}

function snapshot(revision: number, active: unknown, queued: unknown[] = []) {
  return { contract_version: "2026-08-24.10", session_id: SESSION, revision, paused: false, preview: null, active, queued };
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

let mount: HTMLDivElement | null = null;
let root: Root | null = null;
let emit: ((chunk: string) => void) | null = null;
let detailBody: () => Response | Promise<Response>;

async function flush(times = 8) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  });
}

function acceptLocal(id: string, objective: string) {
  writeConversationMessage(SCOPE, SESSION, {
    id, objective, createdAt: "2026-09-24T00:00:02.000Z",
    delivery: "accepted", receiptUncertain: false, expiresAt: Date.now() + 60 * 60 * 1000,
  });
}

async function renderConversation(props: Record<string, unknown> = {}) {
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => {
    root?.render(createElement(QueuedConversation, {
      chatBinding: "chat-binding",
      detailBinding: "detail-binding",
      scope: SCOPE,
      initialDetail,
      ...props,
    }));
  });
  await flush(6);
}

async function rerenderConversation(props: Record<string, unknown> = {}) {
  await act(async () => {
    root?.render(createElement(QueuedConversation, {
      chatBinding: "chat-binding",
      detailBinding: "detail-binding",
      scope: SCOPE,
      initialDetail,
      ...props,
    }));
  });
  await flush(4);
}

function detailReads() {
  return fetcher.mock.calls.filter(([url]) => String(url) === `/api/workspace-sessions/${SESSION}`).length;
}

function button(label: string) {
  return [...document.querySelectorAll("button")].find((node) => node.textContent === label) as HTMLButtonElement | undefined;
}

/** Drive the observed stop: the active run leaves the slot with a stop outcome. */
async function stoppedWorkRow() {
  acceptLocal(MID, "被停止的消息");
  await renderConversation();
  await act(async () => {
    emit?.(frame("snapshot", snapshot(5, entry())));
    emit?.(frame("snapshot", snapshot(6, null)));
  });
  await flush();
  expect(document.querySelector("[data-conversation-work][data-phase='stopped']")).not.toBeNull();
}

function deferredDetail() {
  let resolve!: (value: Response | Promise<Response>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Response>((res, rej) => { resolve = res; reject = rej; });
  detailBody = () => promise;
  return { resolve: (value?: Response) => resolve(value ?? Response.json({ detail: { ...initialDetail, revision: 5 } })), reject };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  window.history.replaceState(null, "", "/workspace");
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
    if (/^\/api\/workspace-sessions\/[^/]+$/.test(String(url))) return Promise.resolve(detailBody());
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
  vi.restoreAllMocks();
});

it("fences repeat refresh clicks and returns to idle after a successful read", async () => {
  await stoppedWorkRow();
  const refresh = button("刷新")!;
  expect(refresh).toBeDefined();
  const pending = deferredDetail();
  const before = detailReads();

  await act(async () => { refresh.click(); refresh.click(); });
  // Synchronous in-flight fence: exactly one explicit read, with loading feedback.
  expect(detailReads()).toBe(before + 1);
  expect(refresh.textContent).toBe("正在刷新…");
  expect(refresh.disabled).toBe(true);
  await act(async () => { refresh.click(); });
  expect(detailReads()).toBe(before + 1);

  await act(async () => pending.resolve());
  await flush();
  // Success returns to idle without inventing a completion message.
  expect(refresh.textContent).toBe("刷新");
  expect(refresh.disabled).toBe(false);
  expect(document.body.textContent).not.toContain("刷新失败");
  expect(document.body.textContent).not.toContain("已刷新");
});

it("keeps the retained row through a failed refresh and offers a usable retry without raw errors", async () => {
  await stoppedWorkRow();
  const refresh = button("刷新")!;
  const pending = deferredDetail();
  await act(async () => { refresh.click(); });
  await act(async () => { pending.reject(new Error("RAW-BACKEND-SECRET-BOOM")); });
  await flush();

  // Truthful failure feedback; retained content stays; no raw provider error.
  expect(document.body.textContent).toContain("刷新失败，内容已保留，可重试。");
  expect(refresh.textContent).toBe("重试刷新");
  expect(refresh.disabled).toBe(false);
  expect(document.body.textContent).toContain("被停止的消息");
  expect(document.body.textContent).toContain("已停止");
  expect(document.body.textContent).not.toContain("RAW-BACKEND-SECRET-BOOM");

  // The retry is a fresh explicit read that recovers to idle.
  const retry = deferredDetail();
  const before = detailReads();
  await act(async () => { refresh.click(); });
  expect(detailReads()).toBe(before + 1);
  expect(refresh.textContent).toBe("正在刷新…");
  await act(async () => retry.resolve());
  await flush();
  expect(document.body.textContent).not.toContain("刷新失败");
  expect(refresh.textContent).toBe("刷新");
});

it("drops stale refresh feedback when the message leaves the surface", async () => {
  await stoppedWorkRow();
  const refresh = button("刷新")!;
  const pending = deferredDetail();
  await act(async () => { refresh.click(); });
  expect(refresh.textContent).toBe("正在刷新…");

  // The same message is re-queued by another actor: its work row leaves.
  await act(async () => {
    emit?.(frame("snapshot", snapshot(7, null, [entry({ status: "queued", run_id: null, stage: null, cancel_requested: false })])));
  });
  await flush();
  expect(document.querySelector("[data-conversation-work]")).toBeNull();

  // A late resolution must never repaint feedback for the departed message.
  await act(async () => { pending.reject(new Error("late failure")); });
  await flush();
  expect(document.body.textContent).not.toContain("刷新失败");
  expect(document.body.textContent).not.toContain("正在刷新…");
});

it("drops stale refresh feedback when the account/session owner changes mid-read", async () => {
  await stoppedWorkRow();
  const refresh = button("刷新")!;
  const pending = deferredDetail();
  await act(async () => { refresh.click(); });
  expect(refresh.textContent).toBe("正在刷新…");

  // A new binding is a new composition owner on the same account scope.
  await rerenderConversation({ chatBinding: "chat-binding-2" });
  const after = button("刷新")!;
  expect(after).toBeDefined();
  expect(after.textContent).toBe("刷新");
  expect(document.body.textContent).not.toContain("正在刷新…");

  await act(async () => { pending.reject(new Error("late failure after owner change")); });
  await flush();
  expect(document.body.textContent).not.toContain("刷新失败");
  expect(document.body.textContent).not.toContain("正在刷新…");
  expect(document.body.textContent).toContain("被停止的消息");
});

it("does not let an A1 completion clear A2's lock after an owner A → B → A round trip", async () => {
  await stoppedWorkRow();
  const old = deferredDetail();
  await act(async () => button("刷新")!.click());
  await rerenderConversation({ chatBinding: "chat-binding-2" });
  await rerenderConversation();
  const next = deferredDetail(), refresh = button("刷新")!;
  const before = detailReads();
  await act(async () => {
    refresh.click();
    old.reject(new Error("old A1 failed"));
    // Keep this event batch open so the second click tests the synchronous
    // lock before React paints the disabled button, as rapid input can do.
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    refresh.click();
  });
  expect(detailReads()).toBe(before + 1);
  expect(refresh.textContent).toBe("正在刷新…");
  expect(document.body.textContent).not.toContain("刷新失败");
  await act(async () => next.resolve());
  await flush();
  expect(refresh.textContent).toBe("刷新");
});

it("does not apply the old lifecycle's failure when the same message leaves and returns to recovery", async () => {
  await stoppedWorkRow();
  const old = deferredDetail();
  await act(async () => button("刷新")!.click());
  await act(async () => emit?.(frame("snapshot", snapshot(7, null, [entry({ status: "queued", run_id: null, cancel_requested: false })]))));
  await flush();
  expect(button("刷新")).toBeUndefined();
  await act(async () => emit?.(frame("snapshot", snapshot(8, null))));
  await flush();
  expect(button("刷新")).toBeDefined();
  const next = deferredDetail();
  await act(async () => button("刷新")!.click());
  await act(async () => old.reject(new Error("previous message lifecycle")));
  await flush();
  expect(button("正在刷新…")?.disabled).toBe(true);
  expect(document.body.textContent).not.toContain("刷新失败");
  await act(async () => next.resolve());
  await flush();
  expect(button("刷新")?.disabled).toBe(false);
});

it("drops old failure feedback after the account scope changes", async () => {
  await stoppedWorkRow();
  const old = deferredDetail();
  await act(async () => button("刷新")!.click());
  await rerenderConversation({ scope: "f".repeat(64) });
  await act(async () => old.reject(new Error("old account scope")));
  await flush();
  expect(document.body.textContent).not.toContain("刷新失败");
  expect(document.body.textContent).not.toContain("正在刷新…");
});

it("fences actual live ID changes even when Home preserves the same composer owner", async () => {
  const secondSession = "22222222-2222-4222-8222-222222222222";
  const realUseConversation = conversationModule.useConversation;
  const ids: Array<string | null> = [];
  // Unit-level hook fixture supplies the same retained recovery message in
  // both Home Sessions. Keep the real hook's ID resolution, request, abort and
  // readback wiring; this isolates the canvas owner from its stable IME key.
  const retained = [{ id: MID, objective: "retained recovery", createdAt: "2026-09-24T00:00:02Z",
    delivery: "accepted" as const, receiptUncertain: false, expiresAt: Date.now() + 60_000 }];
  const outcomes = { [MID]: "stopped" as const };
  vi.spyOn(conversationModule, "useConversation").mockImplementation(function useRetainedHome(options) {
    ids.push(options.id);
    const chat = realUseConversation(options);
    return { ...chat, messages: retained, runOutcome: outcomes };
  });
  conversationHome(SCOPE, SESSION);
  await renderConversation({ initialDetail: undefined, bootstrap: undefined });
  expect(ids).toContain(SESSION);
  const composer = document.getElementById("queued-conversation-composer");
  const old = deferredDetail();
  await act(async () => button("刷新")!.click());
  conversationHome(SCOPE, secondSession);
  // null and undefined are both the Home editing context, but this explicit
  // re-read of the local Home pointer resolves a different actual live ID.
  await rerenderConversation({ initialDetail: undefined, bootstrap: null });
  expect(ids).toContain(secondSession);
  expect(document.getElementById("queued-conversation-composer")).toBe(composer);
  expect(button("刷新")).toBeDefined();
  const next = deferredDetail();
  await act(async () => button("刷新")!.click());
  expect(fetcher.mock.calls.some(([url]) => url === `/api/workspace-sessions/${secondSession}`)).toBe(true);
  await act(async () => old.reject(new Error("old live ID")));
  await flush();
  expect(button("正在刷新…")?.disabled).toBe(true);
  expect(document.body.textContent).not.toContain("刷新失败");
  await act(async () => next.resolve(Response.json({ detail: { ...initialDetail, session_id: secondSession, revision: 5 } })));
  await flush();
  expect(button("刷新")?.disabled).toBe(false);
});

it("drops stale refresh feedback on unmount", async () => {
  await stoppedWorkRow();
  const refresh = button("刷新")!;
  const pending = deferredDetail();
  await act(async () => { refresh.click(); });
  await act(async () => { root?.unmount(); });
  root = null;
  await act(async () => { pending.resolve(); });
  await flush(2);
  expect(document.querySelector("[data-conversation-work]")).toBeNull();
  expect(document.body.textContent).not.toContain("正在刷新…");
});

it("receives search focus on the current queued session title, not another route", async () => {
  await renderConversation();
  mount!.id = "workspace-content";
  const heading = mount!.querySelector("h1")!;
  // happy-dom cannot paint; model only the actual rendered title as visible.
  vi.spyOn(heading, "getClientRects").mockReturnValue([new DOMRect(0, 0, 100, 24)] as unknown as DOMRectList);
  const href = `/workspace/sessions/${SESSION}`;
  window.history.replaceState(null, "", href);
  const handoff = beginWorkspaceSearchFocusHandoff({ href });
  try {
    await vi.waitFor(() => expect(document.activeElement).toBe(heading));
  } finally {
    handoff.cancel();
  }
});
