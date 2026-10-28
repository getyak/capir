// @vitest-environment happy-dom
// Uses the real directory selection, composer, durable outbox and submit path.
// Transport is synthetic; no model request or account data is used.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setConversationImageStoreForTest, CONVERSATION_IMAGE_DRAFT, type ConversationImageStore, type DurableConversationImage } from "@/lib/conversation-image-store";
const fetcher = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
const directory = vi.hoisted(() => ({ people: [
  { id: "11111111-1111-4111-8111-111111111111", display_label: "林海", contexts: [] },
  { id: "22222222-2222-4222-8222-222222222222", display_label: "林海", contexts: [{ id: "other", display_label: "研究合作" }] },
] }));
vi.mock("../workspace-search", () => ({ useWorkspaceDirectory: () => ({ data: { people: { people: directory.people } }, loading: false, failed: false, retry: vi.fn() }) }));
vi.mock("@/components/workspace-session-request", () => ({ WORKSPACE_SESSION_EXPIRED_EVENT: "session-expired", workspaceSessionFetch: fetcher, workspaceSessionExpired: () => false, relationshipIntegrationFetch: fetcher, relationshipIntegrationSessionExpired: () => false }));
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace", useRouter: () => router, useSearchParams: () => new URLSearchParams() }));
import { QueuedConversation } from "./queued-conversation";
const SESSION = "33333333-3333-4333-8333-333333333333";
const ACTIVE = "44444444-4444-4444-8444-444444444444";
const initialDetail = { session_id: SESSION, revision: 1, updated_at: "2026-10-29T00:00:00Z", expires_at: "2099-01-01T00:00:00Z", state: "active" as const, title: "Synthetic target selection", turn_count: 0, is_unread: false, scope_kind: "unresolved_intent" as const, person_id: null, relationship_context_id: null, person_label: "", context_label: "", deleted_at: null, display_authority: "stale_unconfirmed" as const, composer_draft: null, composer_draft_updated_at: null, turns: [] };
const active = { queue_entry_id: ACTIVE, message_id: ACTIVE, sequence: 1, status: "running", objective: "Synthetic active message", created_at: initialDetail.updated_at, updated_at: initialDetail.updated_at, revision: 1, run_id: "55555555-5555-4555-8555-555555555555", stage: "answer", cancel_requested: false, failure_code: null, accepts_steering: true };
let root: Root, host: HTMLDivElement;
let put: ConversationImageStore["put"];
let snapshotActive = true;
let echoTarget = true;
let emitSnapshot: (snapshot: unknown) => void;
async function flush() { await act(async () => { for (let n = 0; n < 6; n++) { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 1)); } }); }
async function render(binding = "detail") { await act(async () => root.render(createElement(QueuedConversation, { initialDetail, scope: "synthetic-owner", chatBinding: "chat", detailBinding: binding }))); await flush(); }
function input() { return host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!; }
async function type(value: string) { await act(async () => { const field = input(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); field.setSelectionRange(value.length, value.length); field.focus(); field.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true })); }); }
async function chooseReference(index = 0) { await type("@林"); await act(async () => { host.querySelectorAll<HTMLElement>('[role="option"]')[index].click(); }); }
async function chooseTarget() { await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="查看 林海 的引用信息"]')!.click()); await act(async () => { [...document.querySelectorAll("button")].find(button => button.textContent === "为此人整理记忆草稿")!.click(); }); }
function selection() { return host.querySelector('[aria-label="本条消息的记忆草稿目标"]'); }
function send() { return host.querySelector<HTMLButtonElement>("button[data-send-mode]")!; }
function posts() { return fetcher.mock.calls.filter(([url, init]) => (String(url).endsWith("/conversation-queue") || String(url).endsWith("/conversation-queue/memory-draft")) && init?.method === "POST"); }
async function addImage() {
  await act(async () => host.querySelector<HTMLButtonElement>("[data-add-trigger]")!.click());
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("[data-add-panel] button")].find(button => button.textContent?.includes("添加文件"))!.click());
  const picker = host.querySelector<HTMLInputElement>('input[type="file"]')!; await act(async () => { Object.defineProperty(picker, "files", { value: [new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], "synthetic.png", { type: "image/png" })], configurable: true }); picker.dispatchEvent(new Event("change", { bubbles: true })); }); await flush(); }
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); snapshotActive = true; echoTarget = true;
  window.history.replaceState(null, "", "/workspace"); fetcher.mockReset();
  const images = new Map<string, DurableConversationImage[]>();
  put = async (key, records) => { if (records.length) images.set(key, [...records]); else images.delete(key); return true; };
  setConversationImageStoreForTest({ put: (...args) => put(...args), get: async key => images.get(key) ?? [], delete: async key => { images.delete(key); }, deletePrefix: async prefix => { for (const key of images.keys()) if (key.startsWith(prefix)) images.delete(key); }, inventory: async () => [] });
  fetcher.mockImplementation((url, init) => {
    if (String(url).endsWith("/stream")) return Promise.resolve(new Response(new ReadableStream({ start(controller) {
      emitSnapshot = snapshot => controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
      controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify({ contract_version: "2026-08-24.10", session_id: SESSION, revision: 1, paused: false, active: snapshotActive ? active : null, queued: [], preview: null })}\n\n`));
    } })));
    if (String(url).endsWith("/conversation-queue") || String(url).endsWith("/conversation-queue/memory-draft")) return Promise.resolve(init?.method === "POST" ? Response.json({ ...(echoTarget && JSON.parse(init.body).memory_draft_target ? { memory_draft_target: JSON.parse(init.body).memory_draft_target } : {}) }, { status: 202 }) : Response.json({ contract_version: "2026-08-24.10", session_id: SESSION, revision: 1, paused: false, active: snapshotActive ? active : null, queued: [], preview: null }));
    return Promise.resolve(Response.json({ detail: initialDetail }));
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); await render();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setConversationImageStoreForTest(undefined); vi.unstubAllGlobals(); });

it("makes a same-name directory choice explicit, visible and separately queued without changing plain @", async () => {
  await chooseReference(1); await type(input().value + "请整理这条测试文字");
  expect(selection()).toBeNull(); expect(send().dataset.sendMode).toBe("steer");
  await chooseTarget();
  expect(document.activeElement).toBe(input());
  expect(selection()?.textContent).toContain("仅用本条文字");
  expect(selection()?.textContent).toContain("林海"); expect(host.textContent).not.toContain(directory.people[1].id);
  expect(send().dataset.sendMode).toBe("queue"); expect(send().getAttribute("aria-label")).toBe("加入队列");
  const exactText = input().value;
  await act(async () => send().click()); await flush();
  expect(String(posts()[0][0])).toMatch(/\/conversation-queue\/memory-draft$/u);
  const body = JSON.parse(posts()[0][1].body);
  expect(body).toMatchObject({ objective: exactText.trim(), memory_draft_target: { person_id: directory.people[1].id } });
  expect(body).not.toHaveProperty("humanIdentityBinding"); expect(body).not.toHaveProperty("relationship_context_id");
  expect(input().value).toBe(""); expect(selection()).toBeNull();
});
it("removes scope on cancellation, edited reference or account binding replacement, including ABA", async () => {
  await chooseReference(); await type(input().value + "note"); await chooseTarget();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="取消本条消息的记忆草稿目标"]')!.click());
  expect(selection()).toBeNull(); expect(send().dataset.sendMode).toBe("steer"); expect(document.activeElement).toBe(input());
  await chooseTarget(); await type("different draft"); expect(selection()).toBeNull();
  await chooseReference(); await type(input().value + "note"); await chooseTarget();
  await render("other-account"); expect(selection()).toBeNull(); await render("detail"); expect(selection()).toBeNull();
  await type("ordinary text"); await act(async () => send().click()); await flush();
  expect(JSON.parse(posts()[0][1].body)).not.toHaveProperty("memory_draft_target");
});
it("explains missing authored text and attached images while retaining the removable target and all input", async () => {
  await chooseReference(); await chooseTarget();
  expect(send().disabled).toBe(true); expect(selection()?.textContent).toContain("请在人物引用后补充");
  await type(input().value + "authored note"); expect(send().disabled).toBe(false);
  await addImage();
  expect(send().disabled).toBe(true); expect(selection()?.textContent).toContain("请将图片分开发送");
  expect(input().value).toContain("authored note"); expect(host.querySelectorAll('[aria-label="要发送的图片"] img').length).toBe(1);
  expect(posts()).toHaveLength(0);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="取消本条消息的记忆草稿目标"]')!.click());
  expect(send().disabled).toBe(false);
});
it("preserves a newer same-text target selected while an earlier ordinary image send waits for durable storage", async () => {
  await chooseReference(); await type(input().value + "authored note"); await addImage();
  const originalPut = put; let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  put = async (...args) => { if (!args[0].endsWith(CONVERSATION_IMAGE_DRAFT)) await held; return originalPut(...args); };
  const exactText = input().value;
  await act(async () => send().click());
  await chooseTarget(); expect(selection()).not.toBeNull();
  await act(async () => release()); await flush();
  expect(input().value).toBe(exactText); expect(selection()).not.toBeNull();
  expect(JSON.parse(posts()[0][1].body)).not.toHaveProperty("memory_draft_target");
  expect(send().disabled).toBe(false);
});

it("keeps the original target visible and offers a read-only check when a same-ID queue receipt has lost its scope", async () => {
  echoTarget = false;
  await chooseReference(); await type(input().value + "authored note"); await chooseTarget();
  await act(async () => send().click()); await flush();
  const body = JSON.parse(posts()[0][1].body);
  const unbound = { ...active, queue_entry_id: body.message_id, message_id: body.message_id, objective: body.objective, status: "queued", run_id: null, accepts_steering: false };
  await act(async () => emitSnapshot({ contract_version: "2026-08-24.10", session_id: SESSION, revision: 2, paused: false, active, queued: [unbound], preview: null }));
  await flush();
  const marker = host.querySelector('[data-memory-draft-target]')!;
  expect(marker.textContent).toContain("记忆草稿 · 林海");
  expect(marker.textContent).toContain("人物目标尚未确认");
  expect(marker.querySelector("button")).not.toBeNull();
  expect(marker.textContent).not.toContain(directory.people[0].id);
  expect(posts()).toHaveLength(1);
});
