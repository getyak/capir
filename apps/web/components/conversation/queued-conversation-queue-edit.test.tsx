// @vitest-environment happy-dom
//
// Queue editing focus lifecycle: the auto-focused edit form is transient, so
// an explicit cancel or a successful save returns focus to the same row's Edit
// button, a row that leaves the queue hands focus to the composer, a failed
// save keeps the text and the editor, and focus is never stolen from where the
// user intentionally moved while an async save was pending — nor restored into
// a new account/session, a disabled control or a detached node.
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

import { QueuedConversation } from "./queued-conversation";
import { conversationHome } from "@/lib/conversation-local";
import * as conversationModule from "./use-conversation";
import styles from "./queued-conversation.module.css";

const SCOPE = "e".repeat(64);
const SESSION = "11111111-1111-4111-8111-111111111111";
const MID = "44444444-4444-4444-8444-444444444444";

const initialDetail = {
  session_id: SESSION,
  revision: 4,
  updated_at: "2026-09-24T00:00:00.000Z",
  expires_at: "2026-10-01T00:00:00.000Z",
  state: "active" as const,
  title: "队列编辑焦点",
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

function queuedEntry(objective = "待编辑的原位消息", overrides: Record<string, unknown> = {}) {
  return {
    queue_entry_id: MID,
    message_id: MID,
    sequence: 1,
    status: "queued",
    objective,
    images: [],
    created_at: "2026-09-24T00:00:00.000Z",
    updated_at: "2026-09-24T00:00:00.000Z",
    revision: 2,
    run_id: null,
    stage: null,
    cancel_requested: false,
    failure_code: null,
    ...overrides,
  };
}

function snapshot(revision: number, queued: unknown[], active: unknown = null) {
  return { contract_version: "2026-08-24.10", session_id: SESSION, revision, paused: false, preview: null, active, queued };
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

let mount: HTMLDivElement | null = null;
let root: Root | null = null;
let emit: ((chunk: string) => void) | null = null;
let mutations: () => Response | Promise<Response>;

async function flush(times = 8) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
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

async function renderWithQueuedEntry() {
  await renderConversation();
  await act(async () => { emit?.(frame("snapshot", snapshot(5, [queuedEntry()]))); });
  await flush();
}

function editButton() {
  return document.querySelector<HTMLButtonElement>('button[aria-label="编辑第 1 条待处理消息"]');
}

function editField() {
  return document.querySelector<HTMLTextAreaElement>('textarea[id^="edit-"]');
}

function editForm() {
  return editField()?.closest("form") ?? null;
}

function control(label: string) {
  return [...document.querySelectorAll("button")].find((node) => node.textContent === label) as HTMLButtonElement | undefined;
}

async function typeInEditor(value: string) {
  const field = editField()!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function deferredMutations() {
  let resolve!: (value: Response | Promise<Response>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Response>((res, rej) => { resolve = res; reject = rej; });
  mutations = () => promise;
  return {
    resolve: (objective = "已编辑的待处理消息") => resolve(Response.json({ snapshot: snapshot(6, [queuedEntry(objective)]) })),
    reject,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  window.history.replaceState(null, "", "/workspace");
  router.push.mockReset();
  fetcher.mockReset();
  emit = null;
  mutations = () => Response.json({ snapshot: snapshot(6, [queuedEntry("已编辑的待处理消息")]) });
  fetcher.mockImplementation((url: string) => {
    if (String(url).endsWith("/stream")) {
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) { emit = (chunk) => controller.enqueue(new TextEncoder().encode(chunk)); },
      })));
    }
    if (String(url).endsWith("/conversation-queue/mutations")) return Promise.resolve(mutations());
    if (String(url).endsWith("/conversation-queue")) return Promise.resolve(Response.json(snapshot(5, [queuedEntry()])));
    return Promise.resolve(Response.json({ detail: initialDetail }));
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

it("returns focus to the same row's Edit button after an explicit cancel", async () => {
  await renderWithQueuedEntry();
  const edit = editButton()!;
  await act(async () => { edit.click(); });
  expect(editForm()).not.toBeNull();
  expect(editField()?.value).toBe("待编辑的原位消息");

  await act(async () => { control("取消")!.click(); });
  expect(editForm()).toBeNull();
  expect(document.activeElement).toBe(editButton());
});

it("keeps the first accepted waiting message once in the transcript and its management out of the composer dock", async () => {
  await renderWithQueuedEntry();
  expect(mount!.textContent!.split("待编辑的原位消息").length - 1).toBe(1);
  const controls = document.querySelector<HTMLElement>('[aria-label="可控补充"]')!;
  expect(controls.closest('[role="region"]')?.getAttribute("aria-label")).toBe("对话记录");
  expect(controls.textContent).not.toContain("接下来");
  expect(mount!.querySelector(`.${styles.dock} [aria-label="可控补充"]`)).toBeNull();
  expect(mount!.querySelector('[data-session-task-capsule][data-phase="queued"]')).not.toBeNull();
  expect(mount!.textContent).toContain("排队等待处理");
  expect(mount!.textContent).toContain("已等待");
  expect(editButton()).not.toBeNull();
  expect(document.querySelector('[aria-label="移除第 1 条待处理消息"]')).not.toBeNull();
});

it("keeps the same user message and composer through a queued-to-running transition without repeating the text", async () => {
  await renderWithQueuedEntry();
  const bubble = document.querySelector("[data-user-message]");
  const composer = document.getElementById("queued-conversation-composer");
  await act(async () => emit?.(frame("snapshot", snapshot(6, [], queuedEntry("待编辑的原位消息", {
    status: "running", run_id: "55555555-5555-4555-8555-555555555555", started_at: "2026-09-24T00:00:01.000Z", stage: "preparing",
  })))));
  await flush();
  expect(document.querySelector("[data-user-message]")).toBe(bubble);
  expect(document.getElementById("queued-conversation-composer")).toBe(composer);
  expect(mount!.textContent!.split("待编辑的原位消息").length - 1).toBe(1);
  expect(editButton()).toBeNull();
});

it("keeps subsequent waiting and failed messages once with inline controls and the original queue order", async () => {
  await renderConversation();
  const second = "66666666-6666-4666-8666-666666666666";
  await act(async () => emit?.(frame("snapshot", snapshot(6, [queuedEntry(), queuedEntry("后续失败原文", {
    message_id: second, queue_entry_id: second, sequence: 2, status: "failed", failure_code: "MODEL_RUN_TIMEOUT", created_at: "2026-09-24T00:00:02.000Z",
  })]))));
  await flush();
  expect(mount!.textContent!.split("待编辑的原位消息").length - 1).toBe(1);
  expect(mount!.textContent!.split("后续失败原文").length - 1).toBe(1);
  const groups = [...mount!.querySelectorAll('[aria-label="可控补充"]')];
  expect(groups).toHaveLength(2);
  expect(groups.every(group => group.closest('[role="region"]'))).toBe(true);
  expect(groups[0]!.querySelector('[aria-label="编辑第 1 条待处理消息"]')).not.toBeNull();
  expect(groups[1]!.textContent).toContain("超时");
  expect(groups[1]!.textContent).toContain("重试");
});

function postedMutations() {
  return fetcher.mock.calls.filter(([url, init]) => String(url).endsWith("/conversation-queue/mutations") && init?.method === "POST")
    .map(([, init]) => JSON.parse(init.body));
}

it("keeps paused continuation deliberate and attached to the waiting message", async () => {
  await renderWithQueuedEntry();
  await act(async () => emit?.(frame("snapshot", { ...snapshot(6, [queuedEntry()]), paused: true })));
  await flush();
  const resume = control("继续处理")!;
  expect(resume.closest('[role="region"]')).not.toBeNull();
  expect(postedMutations()).toEqual([]);
  mutations = () => Response.json({ snapshot: snapshot(7, [queuedEntry()]) });
  await act(async () => resume.click()); await flush();
  expect(postedMutations().map(input => input.kind)).toEqual(["continue"]);
});

it("retries the exact failed queue entry through its inline control without hiding the failure early", async () => {
  await renderWithQueuedEntry();
  await act(async () => emit?.(frame("snapshot", snapshot(6, [queuedEntry("待编辑的原位消息", { status: "failed", failure_code: "MODEL_RUN_TIMEOUT" })]))));
  await flush();
  const retry = control("重试")!;
  expect(retry.closest('[role="region"]')).not.toBeNull();
  expect(mount!.textContent).toContain("超时"); expect(postedMutations()).toEqual([]);
  mutations = () => Response.json({ snapshot: snapshot(7, [queuedEntry()]) });
  await act(async () => retry.click()); await flush();
  expect(postedMutations().map(input => input.kind)).toEqual(["retry", "continue"]);
  expect(postedMutations()[0].queue_entry_id).toBe(MID);
});

it("withdraws only the selected message after the same-ID receipt confirms removal", async () => {
  await renderWithQueuedEntry();
  mutations = () => Response.json({ applied: { kind: "withdraw", queue_entry_id: MID, status: null }, snapshot: snapshot(6, []) });
  const remove = document.querySelector<HTMLButtonElement>('[aria-label="移除第 1 条待处理消息"]')!;
  expect(remove.closest('[role="region"]')).not.toBeNull();
  await act(async () => remove.click()); await flush();
  expect(postedMutations()).toHaveLength(1);
  expect(postedMutations()[0]).toMatchObject({ kind: "withdraw", queue_entry_id: MID, expected_revision: 5 });
  expect(mount!.textContent).not.toContain("待编辑的原位消息");
});

it("keeps supported steering delivery visible with locked controls and no invented separate run", async () => {
  await renderConversation();
  const run = "77777777-7777-4777-8777-777777777777";
  const active = queuedEntry("当前运行原文", { queue_entry_id: "active", message_id: "active-message", status: "running", run_id: run });
  const steer = (overrides = {}) => queuedEntry("待编辑的原位消息", { sequence: 2, steers_run_id: run, steer_state: "dispatching", ...overrides });
  await act(async () => emit?.(frame("snapshot", snapshot(6, [steer()], active)))); await flush();
  expect(mount!.textContent!.split("待编辑的原位消息").length - 1).toBe(1);
  const controls = document.querySelector<HTMLElement>('[aria-label="可控补充"]')!;
  expect(controls.closest('[role="region"]')).not.toBeNull();
  expect(controls.closest('[role="article"]')).not.toBeNull();
  expect(controls.closest('[role="article"]')!.querySelector('details[data-phase]')).toBeNull();
  expect(controls.textContent).toContain("补充");
  expect(controls.textContent).toContain("移除任务消息时，也会移除仍待处理的补充。");
  expect(editButton()?.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('[aria-label="移除第 1 条待处理消息"]')?.disabled).toBe(true);
  await act(async () => emit?.(frame("snapshot", snapshot(7, [steer({ steer_state: "delivered", steer_delivered: true })], active)))); await flush();
  expect(document.querySelector('[aria-label="可控补充"]')).toBe(controls);
  expect(editButton()?.disabled).toBe(true);
  expect(postedMutations()).toEqual([]);
});

it.each([true, false])("preserves editor focus ownership when the waiting message starts running (moved: %s)", async moved => {
  await renderWithQueuedEntry(); await act(async () => editButton()!.click());
  const elsewhere = document.querySelector<HTMLElement>("main summary")!;
  if (moved) await act(async () => elsewhere.focus());
  await act(async () => emit?.(frame("snapshot", snapshot(6, [], queuedEntry("待编辑的原位消息", { status: "running", run_id: "77777777-7777-4777-8777-777777777777" })))));
  await flush();
  expect(editForm()).toBeNull();
  expect(document.activeElement).toBe(moved ? elsewhere : document.getElementById("queued-conversation-composer"));
});

it.each([true, false])("hands off a disappearing queue button only while it owns focus (moved: %s)", async moved => {
  await renderWithQueuedEntry();
  await act(async () => editButton()!.focus());
  const elsewhere = document.querySelector<HTMLElement>("main summary")!;
  if (moved) await act(async () => elsewhere.focus());
  await act(async () => emit?.(frame("snapshot", snapshot(6, [], queuedEntry("待编辑的原位消息", { status: "running", run_id: "77777777-7777-4777-8777-777777777777" })))));
  await flush();
  expect(document.activeElement).toBe(moved ? elsewhere : document.getElementById("queued-conversation-composer"));
});

it("does not hand off a queue button after a pointer moved to nonfocusable space", async () => {
  await renderWithQueuedEntry(); await act(async () => editButton()!.focus());
  const blank = document.createElement("div"); document.querySelector("main")!.append(blank);
  await act(async () => blank.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })));
  await act(async () => emit?.(frame("snapshot", snapshot(6, [], queuedEntry("待编辑的原位消息", { status: "running", run_id: "77777777-7777-4777-8777-777777777777" })))));
  await flush(); expect(document.activeElement).toBe(document.body);
});

it("does not hand off a queue button into a replacement account owner", async () => {
  await renderWithQueuedEntry(); await act(async () => editButton()!.focus());
  await rerenderConversation({ chatBinding: "replacement-account" });
  await act(async () => emit?.(frame("snapshot", snapshot(7, [])))); await flush();
  expect(document.activeElement).toBe(document.body);
});

it.each(["unsupported", "detached"])("preserves the same queue editor, draft and IME ownership when steering becomes %s", async mode => {
  await renderConversation();
  const run = "77777777-7777-4777-8777-777777777777";
  const active = queuedEntry("当前运行原文", { queue_entry_id: "active", message_id: "active-message", status: "running", run_id: run });
  const waiting = queuedEntry("待编辑的原位消息", { sequence: 2, steers_run_id: run, steer_state: "awaiting" });
  await act(async () => emit?.(frame("snapshot", snapshot(6, [waiting], active)))); await flush();
  await act(async () => editButton()!.click()); await typeInEditor("尚未结束的拼音输入");
  const field = editField()!; let ended = 0;
  field.addEventListener("compositionend", () => { ended += 1; });
  await act(async () => field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "pin" })));
  const next: Record<string, unknown> = { ...waiting, steer_state: "unsupported" };
  if (mode === "detached") { delete next.steers_run_id; delete next.steer_state; }
  await act(async () => emit?.(frame("snapshot", snapshot(7, [next], active))));
  await flush();
  expect(editField()).toBe(field); expect(document.activeElement).toBe(field);
  expect(field.value).toBe("尚未结束的拼音输入"); expect(ended).toBe(0);
  await act(async () => field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "拼" })));
  expect(ended).toBe(1);
});

it.each([false, true])("keeps persistence-pending recovery on a canonical message without repeating it (steered member: %s)", async member => {
  const rootId = member ? "88888888-8888-4888-8888-888888888888" : MID;
  const recovered = { ...initialDetail, revision: 8, turn_count: 1, turns: [{
    id: rootId, objective: member ? "原任务正文" : "待编辑的原位消息", createdAt: initialDetail.updated_at,
    ...(member ? { steeredMessages: [{ id: MID, objective: "待编辑的原位消息", createdAt: initialDetail.updated_at }] } : {}),
    response: { taskID: "synthetic-task", contractVersion: "2026-08-24.10", createdAt: initialDetail.updated_at,
      contextManifestID: "", knowledgeSnapshotID: "", disposition: "answer", savedBlocks: [] },
  }] };
  await renderConversation({ initialDetail: recovered });
  await act(async () => emit?.(frame("snapshot", { ...snapshot(9, [queuedEntry("待编辑的原位消息", {
    status: "failed", failure_code: "PERSISTENCE_PENDING", ...(member ? { steers_run_id: "original-run", steer_delivered: true } : {}),
  })]), paused: true }))); await flush();
  expect(mount!.textContent!.split("待编辑的原位消息").length - 1).toBe(1);
  const retry = control("重试")!; expect(retry).toBeDefined(); expect(retry.closest('[role="region"]')).not.toBeNull();
  mutations = () => Response.json({ snapshot: snapshot(10, [queuedEntry()]) });
  await act(async () => retry.click()); await flush();
  expect(postedMutations().map(input => input.kind)).toEqual(["retry", "continue"]);
  expect(postedMutations()[0].queue_entry_id).toBe(MID);
  mutations = () => Response.json({ applied: { kind: "withdraw", queue_entry_id: MID, status: null }, snapshot: snapshot(11, []) });
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="移除第 1 条待处理消息"]')!.click()); await flush();
  expect(postedMutations().at(-1)).toMatchObject({ kind: "withdraw", queue_entry_id: MID, expected_revision: 10 });
  expect(mount!.textContent!.split("待编辑的原位消息").length - 1).toBe(1);
});

it("returns focus to the same row's Edit button after a successful save", async () => {
  await renderWithQueuedEntry();
  await act(async () => { editButton()!.click(); });
  await typeInEditor("已编辑的待处理消息");
  const save = deferredMutations();
  await act(async () => { control("保存")!.click(); });
  await act(async () => { save.resolve(); });
  await flush();

  expect(editForm()).toBeNull();
  expect(document.activeElement).toBe(editButton());
  expect(document.body.textContent).toContain("已编辑的待处理消息");
});

it("keeps the text and the editor focused after a failed save", async () => {
  await renderWithQueuedEntry();
  await act(async () => { editButton()!.click(); });
  await typeInEditor("保留这段修改");
  const save = deferredMutations();
  await act(async () => { control("保存")!.click(); });
  await act(async () => { save.reject(new Error("mutation down")); });
  await flush();

  expect(editForm()).not.toBeNull();
  expect(editField()?.value).toBe("保留这段修改");
  expect(document.activeElement).toBe(editField());
});

it("hands focus to the composer when the edited row leaves the queue while the editor owns focus", async () => {
  await renderWithQueuedEntry();
  await act(async () => { editButton()!.click(); });
  expect(editField()).not.toBeNull();

  await act(async () => { emit?.(frame("snapshot", snapshot(6, []))); });
  await flush();
  expect(editForm()).toBeNull();
  expect(document.activeElement).toBe(document.getElementById("queued-conversation-composer"));
});

it("never steals focus back when the user moved elsewhere and the row leaves", async () => {
  await renderWithQueuedEntry();
  await act(async () => { editButton()!.click(); });
  const elsewhere = document.querySelector<HTMLElement>("main summary")!;
  await act(async () => { elsewhere.focus(); });

  await act(async () => { emit?.(frame("snapshot", snapshot(6, []))); });
  await flush();
  expect(editForm()).toBeNull();
  expect(document.activeElement).toBe(elsewhere);
});

it.each([true, false])("does not restore focus after a blank-space click (native blur: %s)", async nativeBlur => {
  await renderWithQueuedEntry();
  await act(async () => editButton()!.click());
  const blank = document.createElement("div");
  document.querySelector("main")!.append(blank);
  await act(async () => {
    blank.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    if (nativeBlur) editField()!.blur();
    blank.click();
  });
  expect(document.activeElement).toBe(nativeBlur ? document.body : editField());
  await act(async () => emit?.(frame("snapshot", snapshot(6, []))));
  await flush();
  expect(editForm()).toBeNull();
  expect(document.activeElement).toBe(document.body);
});

it.each(["success", "failure"])("does not let an old %s close or focus a reopened editor for the same row", async outcome => {
  await renderWithQueuedEntry();
  await act(async () => editButton()!.click());
  await typeInEditor("old save");
  const save = deferredMutations();
  await act(async () => control("保存")!.click());
  await act(async () => control("取消")!.click());
  expect(editButton()!.disabled).toBe(false);
  expect(document.activeElement).toBe(editButton());
  await act(async () => editButton()!.click());
  await typeInEditor("new editor draft");
  const field = editField()!, cancel = control("取消")!;
  await act(async () => cancel.focus());
  await act(async () => outcome === "success" ? save.resolve("old saved value") : save.reject(new Error("old save failure")));
  await flush();
  expect(editField()).toBe(field);
  expect(field.value).toBe("new editor draft");
  expect(document.activeElement).toBe(cancel);
});

it("restores a failed save after its focused Save button automatically loses focus when disabled", async () => {
  await renderWithQueuedEntry();
  await act(async () => editButton()!.click());
  const pending = deferredMutations();
  const save = control("保存")!;
  await act(async () => { save.focus(); save.click(); });
  expect(save.disabled).toBe(true);
  // happy-dom refuses blur() on disabled controls. Model WebKit's native
  // focusout plus body fallback; the final focus destination is still real.
  await act(async () => save.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null })));
  const active = vi.spyOn(document, "activeElement", "get").mockReturnValue(document.body);
  try {
    await act(async () => pending.reject(new Error("save failed")));
    await flush();
  } finally { active.mockRestore(); }
  expect(editField()).not.toBeNull();
  expect(document.activeElement).toBe(editField());
});

it("never steals focus after the user moved elsewhere while an async save was pending", async () => {
  await renderWithQueuedEntry();
  await act(async () => { editButton()!.click(); });
  const save = deferredMutations();
  await act(async () => { control("保存")!.click(); });
  const elsewhere = document.querySelector<HTMLElement>("main summary")!;
  await act(async () => { elsewhere.focus(); });
  await act(async () => { save.resolve(); });
  await flush();

  expect(editForm()).toBeNull();
  expect(document.activeElement).toBe(elsewhere);
  expect(document.activeElement).not.toBe(editButton());
});

it("never restores focus into a new account/session owner", async () => {
  await renderWithQueuedEntry();
  await act(async () => { editButton()!.click(); });
  expect(editField()).not.toBeNull();
  // The binding identifies the mounted account/session owner; its replacement
  // must never receive the departing editor's focus.
  await rerenderConversation({ chatBinding: "chat-binding-2" });
  await act(async () => { emit?.(frame("snapshot", snapshot(7, []))); });
  await flush();

  expect(editForm()).toBeNull();
  expect(document.activeElement).not.toBe(document.getElementById("queued-conversation-composer"));
  expect(document.activeElement).not.toBe(editButton());
  expect(document.activeElement).toBe(document.body);
});

it("does not resurrect an old Home editor after live Session A → B → A, and a fresh editor can cancel and save", async () => {
  const secondSession = "22222222-2222-4222-8222-222222222222";
  const realUseConversation = conversationModule.useConversation;
  const ids: Array<string | null> = [];
  const queue = snapshot(5, [queuedEntry()]) as unknown as NonNullable<ReturnType<typeof realUseConversation>["snapshot"]>;
  const mutate = vi.fn(async () => true);
  // Isolate the canvas editor lifecycle with the same row in two Sessions.
  // Keep the real hook's actual Home ID resolution; existing cases above
  // exercise the normal queue-mutation request and snapshot wiring.
  vi.spyOn(conversationModule, "useConversation").mockImplementation(function useHomeQueue(options) {
    ids.push(options.id);
    const chat = realUseConversation(options);
    return { ...chat, snapshot: queue, mutate };
  });
  conversationHome(SCOPE, SESSION);
  await renderConversation({ initialDetail: undefined, bootstrap: undefined });
  expect(ids).toContain(SESSION);
  const composer = document.getElementById("queued-conversation-composer");
  await act(async () => editButton()!.click());
  await typeInEditor("old A editor draft");
  conversationHome(SCOPE, secondSession);
  await rerenderConversation({ initialDetail: undefined, bootstrap: null });
  expect(ids).toContain(secondSession);
  expect(editForm()).toBeNull();
  // The composer control survives live-ID changes; transcript summaries are
  // intentionally remounted with SessionRuntime and cannot own this check.
  const elsewhere = document.querySelector<HTMLElement>("[data-add-trigger]")!;
  await act(async () => elsewhere.focus());
  conversationHome(SCOPE, SESSION);
  await rerenderConversation({ initialDetail: undefined, bootstrap: undefined });
  expect(ids.at(-1)).toBe(SESSION);
  expect(document.getElementById("queued-conversation-composer")).toBe(composer);
  expect(editForm()).toBeNull();
  expect(document.activeElement).toBe(elsewhere);
  await act(async () => editButton()!.click());
  expect(editField()?.value).toBe("待编辑的原位消息");
  await act(async () => control("取消")!.click());
  expect(editForm()).toBeNull();
  expect(document.activeElement).toBe(editButton());
  await act(async () => editButton()!.click());
  await typeInEditor("fresh A editor draft");
  await act(async () => control("保存")!.click());
  expect(mutate).toHaveBeenCalledExactlyOnceWith({ kind: "edit", queue_entry_id: MID, objective: "fresh A editor draft" });
  expect(editForm()).toBeNull();
  expect(document.activeElement).toBe(editButton());
});
