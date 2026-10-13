// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryRecallItem } from "@talent-signal/contracts";
import { usePersonMemory } from "./person-memory-controller";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("./workspace-session-request", () => ({ workspaceSessionFetch: fetcher, WORKSPACE_SESSION_EXPIRED_EVENT: "session-expired" }));
const PERSON = "11111111-1111-4111-8111-111111111111";
function memory(id = "old", overrides: Partial<MemoryRecallItem> & { can_edit?: boolean } = {}): MemoryRecallItem {
  return { id, scope: "person", statement_kind: "fact", display_text: "原记忆", original_display_text: "原记忆", subject_id: PERSON,
    relationship_context_id: null, speaker: null, reporter: null, valid_time: null, observed_time: null,
    time_status: "unknown", sensitivity: "normal", version: 1, supersedes_id: null, conflict_group_id: null,
    evidence_retained: true, evidence_refs: [{ excerpt: "原始对话", locator: { kind: "message", session_id: null, message_id: null } }],
    created_at: "2026-10-13T00:00:00Z", ...{ can_edit: true }, ...overrides };
}
const corrected = () => memory("new", { display_text: "修改记忆", supersedes_id: "old", version: 2 });
const page = (items: MemoryRecallItem[], more = false, cursor: string | null = null) => Response.json({ surface: "people", person_id: PERSON, items, has_more: more, next_cursor: cursor });
const mutation = (item = corrected()) => Response.json({ status: "active", item });
let controller: ReturnType<typeof usePersonMemory>;
let root: Root;
let mount: HTMLDivElement;
function Probe({ binding = "binding", capability = "entry", hasMore = false, cursor = null, entries = [memory()], personId = PERSON }: { binding?: string; capability?: string; hasMore?: boolean; cursor?: string | null; entries?: MemoryRecallItem[]; personId?: string }) {
  const value = usePersonMemory({ personId, binding, entryCapability: capability, items: entries, hasMore, nextCursor: cursor });
  useLayoutEffect(() => { controller = value; });
  return null;
}
async function start() {
  await act(async () => controller.begin(controller.items[0]!));
  await act(async () => controller.change("修改记忆"));
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher.mockReset(); mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
  await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); vi.unstubAllGlobals(); });

describe("confirmed Memory correction", () => {
  it("writes only a signed item correction, reads it back, then edits the replacement ID", async () => {
    await start(); fetcher.mockResolvedValueOnce(mutation()).mockResolvedValueOnce(page([corrected()]));
    await act(async () => controller.save());
    expect(controller.notice).toContain("已核对"); expect(controller.edit).toBeNull(); expect(controller.items[0]!.id).toBe("new");
    const [path, init] = fetcher.mock.calls[0]!;
    expect(path).toBe("/api/memory/items/old/mutations");
    expect(init.headers).toMatchObject({ "x-workspace-session": "binding", "x-memory-entry-capability": "entry" });
    expect(JSON.parse(init.body)).toMatchObject({ operation: "correct", expected_version: 1, display_text: "修改记忆" });
    expect(JSON.parse(init.body)).not.toHaveProperty("entry_scope");
    expect(controller.items[0]!.original_display_text).toBe("原记忆");
    expect(controller.items[0]!.evidence_refs[0]!.excerpt).toBe("原始对话");
    await act(async () => controller.begin(controller.items[0]!));
    await act(async () => controller.change("再次修改"));
    fetcher.mockResolvedValueOnce(mutation(memory("newer", { display_text: "再次修改", version: 3, supersedes_id: "new" })))
      .mockResolvedValueOnce(page([memory("newer", { display_text: "再次修改", version: 3, supersedes_id: "new" })]));
    await act(async () => controller.save());
    expect(fetcher.mock.calls[2]![0]).toBe("/api/memory/items/new/mutations");
    expect(JSON.parse(fetcher.mock.calls[2]![1].body).expected_version).toBe(2);
  });
  it("keeps an unknown result and retries the identical request after response loss", async () => {
    await start(); fetcher.mockRejectedValueOnce(new Error("response lost"));
    await act(async () => controller.save());
    expect(controller.edit).toMatchObject({ phase: "unknown", draft: "修改记忆" }); expect(controller.notice).toBeNull();
    await act(async () => { controller.change("不应替换提交内容"); controller.cancel(); });
    expect(controller.edit!.draft).toBe("修改记忆");
    fetcher.mockResolvedValueOnce(mutation()).mockResolvedValueOnce(page([corrected()]));
    await act(async () => controller.save());
    expect(fetcher.mock.calls[1]![1].body).toBe(fetcher.mock.calls[0]![1].body);
    expect(controller.items[0]!.id).toBe("new"); expect(controller.notice).toContain("已保存");
  });
  it("does not claim success from acknowledgement alone and retries readback without a second write", async () => {
    await start(); fetcher.mockResolvedValueOnce(mutation()).mockRejectedValueOnce(new Error("read unavailable"));
    await act(async () => controller.save());
    expect(controller.notice).toBeNull(); expect(controller.edit!.phase).toBe("unknown"); expect(controller.items[0]!.id).toBe("old");
    fetcher.mockResolvedValueOnce(page([corrected()])); await act(async () => controller.save());
    expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    expect(controller.notice).toContain("已保存");
  });
  it("finds the saved replacement beyond the first page before confirming success", async () => {
    await start(); fetcher.mockResolvedValueOnce(mutation()).mockResolvedValueOnce(page([memory()], true, "signed-next"))
      .mockResolvedValueOnce(page([corrected()]));
    await act(async () => controller.save());
    expect(fetcher.mock.calls[2]![0]).toContain("limit=50&cursor=signed-next"); expect(controller.items[0]!.id).toBe("new");
  });
  it("guards double saves before React rerenders", async () => {
    await start(); let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockResolvedValueOnce(page([corrected()]));
    let first!: Promise<string | null>;
    await act(async () => { first = controller.save(); await controller.save(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { finish(mutation()); await first; }); expect(controller.items[0]!.id).toBe("new");
  });
  it("preserves a stale draft and requires current readback before saving with the new version", async () => {
    await start(); fetcher.mockResolvedValueOnce(Response.json({ code: "MEMORY_ITEM_REVISION_CONFLICT" }, { status: 409 }));
    await act(async () => controller.save());
    expect(controller.edit).toMatchObject({ phase: "conflict", draft: "修改记忆" });
    await act(async () => controller.save()); expect(fetcher).toHaveBeenCalledTimes(1);
    const latest = memory("changed-elsewhere", { display_text: "其他位置的修改", supersedes_id: "old", version: 2 });
    fetcher.mockResolvedValueOnce(page([latest])); await act(async () => controller.refreshConflict());
    expect(controller.edit).toMatchObject({ itemId: "changed-elsewhere", draft: "修改记忆", phase: "editing" });
    const newer = memory("new", { display_text: "修改记忆", supersedes_id: "changed-elsewhere", version: 3 });
    fetcher.mockResolvedValueOnce(mutation(newer)).mockResolvedValueOnce(page([newer])); await act(async () => controller.save());
    expect(fetcher.mock.calls[2]![0]).toBe("/api/memory/items/changed-elsewhere/mutations");
    expect(JSON.parse(fetcher.mock.calls[2]![1].body).expected_version).toBe(2);
  });
  it("discards revoked data and never presents the stale save as success", async () => {
    await start(); fetcher.mockResolvedValueOnce(mutation()).mockResolvedValueOnce(Response.json({}, { status: 403 }));
    await act(async () => controller.save());
    expect(controller.items).toEqual([]); expect(controller.edit).toBeNull(); expect(controller.notice).toBeNull(); expect(controller.loadError).toContain("不可用");
  });
  it("preserves a draft on validation failure and does not send empty or overlong values", async () => {
    await start(); await act(async () => controller.change(" ")); await act(async () => controller.save());
    expect(fetcher).not.toHaveBeenCalled(); expect(controller.edit!.error).toContain("1–1000");
    await act(async () => controller.change("x".repeat(1001))); await act(async () => controller.save()); expect(fetcher).not.toHaveBeenCalled();
    await act(async () => controller.change("修改记忆")); fetcher.mockResolvedValueOnce(Response.json({}, { status: 400 }));
    await act(async () => controller.save()); expect(controller.edit).toMatchObject({ phase: "editing", draft: "修改记忆" }); expect(controller.notice).toBeNull();
  });
  it("refreshes only the signed capability while preserving the draft, and discards state on account change", async () => {
    await start(); await act(async () => root.render(createElement(Probe, { capability: "new-entry" })));
    expect(controller.edit!.draft).toBe("修改记忆"); fetcher.mockResolvedValueOnce(mutation()).mockResolvedValueOnce(page([corrected()]));
    await act(async () => controller.save()); expect(fetcher.mock.calls[0]![1].headers["x-memory-entry-capability"]).toBe("new-entry");
    await act(async () => root.render(createElement(Probe, { binding: "another-account" })));
    expect(controller.edit).toBeNull(); expect(controller.items[0]!.id).toBe("old"); expect(controller.notice).toBeNull();
  });
  it("does not silently lose the remaining pages or replace retained items on transient load failure", async () => {
    await act(async () => root.render(createElement(Probe, { binding: "page-binding", hasMore: true, cursor: "signed-page" })));
    fetcher.mockRejectedValueOnce(new Error("network")); await act(async () => controller.loadMore());
    expect(controller.items).toHaveLength(1); expect(controller.hasMore).toBe(true); expect(controller.loadError).toContain("重试");
    fetcher.mockResolvedValueOnce(page([memory(), memory("additional")])); await act(async () => controller.loadMore());
    expect(controller.items.map(item => item.id)).toEqual(["old", "additional"]); expect(controller.hasMore).toBe(false);
    expect(fetcher.mock.calls[1]![0]).toContain("cursor=signed-page");
  });
  it.each(["continuous supersession", "deleted record"])("preserves an unlinked draft after %s without guessing a new target", async kind => {
    await start(); fetcher.mockResolvedValueOnce(Response.json({}, { status: 409 })); await act(async () => controller.save());
    const newest = memory("v3", { display_text: "两次更新后的内容", supersedes_id: "v2", version: 3 });
    fetcher.mockResolvedValueOnce(page(kind === "deleted record" ? [] : [newest])); await act(async () => controller.refreshConflict());
    expect(controller.edit).toMatchObject({ itemId: "old", draft: "修改记忆", phase: "conflict" });
    expect(controller.edit!.error).toContain("草稿已保留"); expect(controller.items.some(item => item.id === "old")).toBe(false);
    await act(async () => controller.save()); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retracts stale source evidence on refreshed server props and keeps an in-progress draft", async () => {
    await start(); const updated = memory("old", { evidence_retained: false, evidence_refs: [], version: 2 });
    await act(async () => root.render(createElement(Probe, { entries: [updated] })));
    expect(controller.items[0]!.evidence_refs).toEqual([]); expect(controller.items[0]!.evidence_retained).toBe(false);
    expect(controller.edit).toMatchObject({ phase: "conflict", draft: "修改记忆" });
    await act(async () => controller.save()); expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps an exact unknown request recoverable when the server snapshot already contains its replacement", async () => {
    await start(); fetcher.mockRejectedValueOnce(new Error("lost response")); await act(async () => controller.save());
    await act(async () => root.render(createElement(Probe, { entries: [corrected()] })));
    expect(controller.edit).toMatchObject({ itemId: "old", phase: "unknown", draft: "修改记忆" });
    fetcher.mockResolvedValueOnce(mutation()).mockResolvedValueOnce(page([corrected()])); await act(async () => controller.save());
    expect(fetcher.mock.calls[1]![1].body).toBe(fetcher.mock.calls[0]![1].body); expect(controller.items).toHaveLength(1);
    expect(controller.items[0]!.id).toBe("new"); expect(controller.notice).toContain("已核对");
  });
  it("does not rewind a verified correction when a pre-save server snapshot finishes late", async () => {
    await start(); fetcher.mockResolvedValueOnce(mutation()).mockResolvedValueOnce(page([corrected()])); await act(async () => controller.save());
    await act(async () => root.render(createElement(Probe, { entries: [memory(), memory("another")] })));
    expect(controller.items.map(item => item.id)).toEqual(["new", "another"]); expect(controller.notice).toContain("已核对");
    await act(async () => root.render(createElement(Probe, { entries: [] })));
    expect(controller.items).toEqual([]);
  });
  it("keeps another owner's readable Memory after a write denial and never fabricates deletion", async () => {
    await start(); fetcher.mockResolvedValueOnce(Response.json({}, { status: 404 })).mockResolvedValueOnce(page([memory("old", { can_edit: false })]));
    await act(async () => controller.save());
    expect(controller.items).toHaveLength(1); expect(controller.items[0]!.evidence_refs[0]!.excerpt).toBe("原始对话");
    expect(controller.edit).toMatchObject({ phase: "conflict", draft: "修改记忆" }); expect(controller.edit!.error).toContain("仍可读取"); expect(controller.notice).toBeNull();
    await act(async () => controller.cancel()); await act(async () => controller.begin(controller.items[0]!)); expect(controller.edit).toBeNull();
  });
  it("resolves an acknowledged correction that is no longer current without locking the page or writing again", async () => {
    await start(); fetcher.mockResolvedValueOnce(mutation()).mockResolvedValueOnce(page([memory("third", { supersedes_id: "new", version: 3 })]));
    await act(async () => controller.save());
    expect(controller.notice).toBeNull(); expect(controller.edit).toMatchObject({ phase: "conflict", draft: "修改记忆" });
    expect(controller.edit!.error).toContain("已不再当前"); expect(controller.items[0]!.id).toBe("third");
    await act(async () => controller.save());
    expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    await act(async () => controller.cancel()); expect(controller.edit).toBeNull();
    await act(async () => controller.begin(controller.items[0]!)); expect(controller.edit!.itemId).toBe("third");
  });
  it.each([{ code: "session_stale" }, { error: { code: "session_stale" } }])("clears the entire local scope after mutation 409 %j instead of retaining a domain conflict draft", async payload => {
    await act(async () => root.render(createElement(Probe, { binding: "paged-scope", hasMore: true, cursor: "old-cursor" })));
    await start(); const event = vi.fn(); window.addEventListener("session-expired", event);
    try {
      fetcher.mockResolvedValueOnce(Response.json(payload, { status: 409 })); await act(async () => controller.save());
      expect(controller.items).toEqual([]); expect(controller.edit).toBeNull(); expect(controller.notice).toBeNull();
      expect(controller.hasMore).toBe(false); expect(controller.loadingMore).toBe(false); expect(event).toHaveBeenCalledTimes(1);
      await act(async () => { controller.begin(memory()); controller.change("旧草稿不得恢复"); await controller.loadMore(); await controller.save(); });
      expect(fetcher).toHaveBeenCalledTimes(1); expect(controller.edit).toBeNull();
      await act(async () => root.render(createElement(Probe, { binding: "paged-scope", entries: [memory("stale-snapshot")] })));
      expect(controller.items).toEqual([]);
    } finally { window.removeEventListener("session-expired", event); }
  });
  it.each([{ code: "session_stale" }, { error: { code: "session_stale" } }])("recognizes readback 409 %j and discards the pending operation without reporting success", async payload => {
    await start(); fetcher.mockResolvedValueOnce(mutation()).mockResolvedValueOnce(Response.json(payload, { status: 409 }));
    await act(async () => controller.save());
    expect(controller.items).toEqual([]); expect(controller.edit).toBeNull(); expect(controller.notice).toBeNull();
    await act(async () => controller.save()); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("discards a late successful mutation after session invalidation", async () => {
    await start(); let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    let pending!: Promise<string | null>; await act(async () => { pending = controller.save(); });
    await act(async () => window.dispatchEvent(new Event("session-expired")));
    await act(async () => { finish(mutation()); await pending; });
    expect(controller.items).toEqual([]); expect(controller.edit).toBeNull(); expect(controller.notice).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not let a late session-stale response from the previous scope expire the new account", async () => {
    await start(); let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    let pending!: Promise<string | null>; await act(async () => { pending = controller.save(); });
    const nextPerson = "44444444-4444-4444-8444-444444444444";
    const nextItem = memory("new-account-record", { subject_id: nextPerson, display_text: "新账号的记忆" });
    await act(async () => root.render(createElement(Probe, { binding: "new-account", capability: "new-signed-entry", personId: nextPerson, entries: [nextItem] })));
    const event = vi.fn(); window.addEventListener("session-expired", event);
    try {
      await act(async () => { finish(Response.json({ error: { code: "session_stale" } }, { status: 409 })); await pending; });
      expect(controller.items).toEqual([nextItem]); expect(controller.edit).toBeNull(); expect(controller.notice).toBeNull(); expect(event).not.toHaveBeenCalled();
    } finally { window.removeEventListener("session-expired", event); }
  });
});
