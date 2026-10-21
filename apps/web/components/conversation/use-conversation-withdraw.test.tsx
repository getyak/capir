// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readConversationMessages, writeConversationMessage, writeConversationWithdrawal } from "@/lib/conversation-local";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import type { DurableConversationImage } from "@/lib/conversation-image-store";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), removeImages: vi.fn(async () => true), loadImages: vi.fn(async (): Promise<DurableConversationImage[]> => []) }));
vi.mock("../workspace-session-request", () => ({ workspaceSessionFetch: mocks.fetch }));
vi.mock("@/lib/workspace-refresh", () => ({ subscribeWorkspaceRefresh: () => () => {}, workspaceRefreshGeneration: () => 0 }));
vi.mock("@/lib/conversation-image-store", async original => ({ ...await original<typeof import("@/lib/conversation-image-store")>(), removeConversationImagesConfirmed: mocks.removeImages, loadConversationImages: mocks.loadImages }));
import { useConversation } from "./use-conversation";

const sid = "11111111-1111-4111-8111-111111111111";
const entry = "22222222-2222-4222-8222-222222222222";
const first = "33333333-3333-4333-8333-333333333333";
const supplement = "44444444-4444-4444-8444-444444444444";
const neighbour = "55555555-5555-4555-8555-555555555555";
const receipt = "66666666-6666-4666-8666-666666666666";
const detail: SessionDetail = { session_id: sid, revision: 1, updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString(), state: "active", title: "Synthetic withdrawal", turn_count: 0, is_unread: false, scope_kind: "unresolved_intent", person_id: null, relationship_context_id: null, person_label: "", context_label: "", deleted_at: null, display_authority: "stale_unconfirmed", composer_draft: null, composer_draft_updated_at: null, turns: [] };
const row = { queue_entry_id: entry, message_id: first, status: "failed", objective: "Synthetic first", revision: 1, sequence: 1, run_id: null, stage: null, cancel_requested: false, failure_code: "MODEL_RUN_FAILED", created_at: detail.updated_at, updated_at: detail.updated_at };
const snapshot = { contract_version: "2026-08-24.10", session_id: sid, revision: 4, active: null, queued: [row], paused: true, preview: null };
const result = () => ({ snapshot: { ...snapshot, revision: 5, queued: [] }, applied: { kind: "withdraw", queue_entry_id: entry, status: null, run_id: null, withdrawn_message_ids: [first, supplement] } });
let chat: ReturnType<typeof useConversation>, root: Root, mount: HTMLDivElement;
let mutation: () => Promise<Response>;
function Probe({ scope = "owner" }: { scope?: string }) { const current = useConversation({ id: sid, scope, chatBinding: scope, detailBinding: scope, initial: detail }); useLayoutEffect(() => { chat = current; }); return null; }
function seed(scope = "owner") { for (const id of [first, supplement, neighbour]) writeConversationMessage(scope, sid, { id, objective: "Synthetic " + id, createdAt: detail.updated_at, delivery: "accepted", expiresAt: Date.now() + 3600000 }); }
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); mocks.fetch.mockReset(); mocks.loadImages.mockReset(); mocks.loadImages.mockResolvedValue([]); mocks.removeImages.mockReset(); mocks.removeImages.mockResolvedValue(true); seed(); mutation = async () => Response.json(result());
  mocks.fetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "POST") return mutation();
    if (String(url).endsWith("/stream")) return Promise.resolve(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)); } })));
    if (String(url).endsWith("/conversation-queue")) return Promise.resolve(Response.json({ ...snapshot, queued: [] }));
    return Promise.resolve(Response.json({ detail }));
  });
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
  await act(async () => root.render(<Probe/>));
  await vi.waitFor(() => expect(chat.snapshot?.revision).toBe(4));
  await act(async () => chat.changeDraft("Synthetic unsent draft"));
});
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

it("retires only explicit receipt IDs, images and reloadable outbox while preserving the draft", async () => {
  await act(async () => { expect(await chat.mutate({ kind: "withdraw", queue_entry_id: entry })).toBe(true); });
  expect(chat.messages.map(message => message.id)).toEqual([neighbour]);
  expect(readConversationMessages("owner", sid).map(message => message.id)).toEqual([neighbour]);
  expect(mocks.removeImages.mock.calls).toEqual([["owner", sid, first], ["owner", sid, supplement]]);
  expect(chat.draft).toBe("Synthetic unsent draft");
});

it("retains messages after unknown withdrawal even when a readback no longer lists them", async () => {
  mutation = async () => { throw new Error("lost response"); };
  await act(async () => { expect(await chat.mutate({ kind: "withdraw", queue_entry_id: entry })).toBe(false); });
  expect(chat.messages).toHaveLength(3); expect(readConversationMessages("owner", sid)).toHaveLength(3); expect(mocks.removeImages).not.toHaveBeenCalled();
});

it.each([undefined, [supplement]])("retains the outbox for an incomplete explicit receipt (%s)", async ids => {
  mutation = async () => Response.json({ ...result(), applied: { ...result().applied, withdrawn_message_ids: ids } });
  await act(async () => { expect(await chat.mutate({ kind: "withdraw", queue_entry_id: entry })).toBe(false); });
  expect(chat.messages).toHaveLength(3); expect(mocks.removeImages).not.toHaveBeenCalled(); expect(chat.error).toContain("回执");
});

it("requires a durable withdrawal record before discarding local copies", async () => {
  const original = window.localStorage;
  const denied = vi.spyOn(window, "localStorage", "get").mockReturnValue(new Proxy(original, { get(target, key) {
    if (key === "setItem") return () => { throw new Error("quota"); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } }));
  try { await act(async () => { expect(await chat.mutate({ kind: "withdraw", queue_entry_id: entry })).toBe(false); }); }
  finally { denied.mockRestore(); }
  expect(chat.messages).toHaveLength(3); expect(mocks.removeImages).not.toHaveBeenCalled(); expect(chat.error).toContain("撤销记录");
});

it("reports unconfirmed byte deletion while retaining the durable retry receipt", async () => {
  mocks.removeImages.mockResolvedValue(false);
  await act(async () => { expect(await chat.mutate({ kind: "withdraw", queue_entry_id: entry })).toBe(false); });
  expect(chat.messages.map(message => message.id)).toEqual([neighbour]); expect(chat.error).toContain("清理未完成");
  expect(readConversationMessages("owner", sid).map(message => message.id)).toEqual([neighbour]);
});

it("uses an explicit other-tab receipt, never a missing storage row, to retire live copies", async () => {
  const key = `talent-signal:conversation:v1:owner:${sid}:message:${first}`; localStorage.removeItem(key);
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key })));
  expect(chat.messages).toHaveLength(3);
  writeConversationWithdrawal("owner", sid, receipt, [first, supplement], Date.now() + 3600000);
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: `talent-signal:conversation:v1:owner:${sid}:withdrawal:${receipt}` })));
  expect(chat.messages.map(message => message.id)).toEqual([neighbour]); expect(chat.draft).toBe("Synthetic unsent draft");
});

it.each([true, false])("does not admit a captured image after another tab withdraws it (storage event=%s)", async dispatch => {
  await act(async () => root.unmount());
  const image = { attachment_id: receipt, file_name: "synthetic.png", media_type: "image/png" as const, byte_size: 4, content_hash: "a".repeat(64) };
  writeConversationMessage("owner", sid, { id: first, objective: "Synthetic delayed image", images: [image], createdAt: detail.updated_at, delivery: "pending", expiresAt: Date.now() + 3600000 });
  let release!: (images: DurableConversationImage[]) => void;
  mocks.loadImages.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  root = createRoot(mount); await act(async () => root.render(<Probe/>));
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  writeConversationWithdrawal("owner", sid, receipt, [first], Date.now() + 3600000);
  if (dispatch) await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: `talent-signal:conversation:v1:owner:${sid}:withdrawal:${receipt}` })));
  await act(async () => { release([{ ...image, position: 0, blob: new Blob([new Uint8Array([1,2,3,4])]), expiresAt: Date.now() + 3600000 }]); });
  await vi.waitFor(() => expect(chat.messages.map(message => message.id)).toEqual([supplement, neighbour]));
  expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  expect(readConversationMessages("owner", sid).map(message => message.id)).toEqual([supplement, neighbour]);
});

it("drops a parsed withdrawal response after the owning account binding changes", async () => {
  let finish!: (body: unknown) => void;
  const response = new Response(); vi.spyOn(response, "json").mockImplementation(() => new Promise(resolve => { finish = resolve; })); mutation = async () => response;
  let pending!: Promise<boolean>; await act(async () => { pending = chat.mutate({ kind: "withdraw", queue_entry_id: entry }); });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function")); seed("other");
  await act(async () => root.render(<Probe scope="other"/>));
  await act(async () => { finish(result()); expect(await pending).toBe(false); });
  expect(readConversationMessages("owner", sid)).toHaveLength(3); expect(readConversationMessages("other", sid)).toHaveLength(3); expect(mocks.removeImages).not.toHaveBeenCalled();
});
