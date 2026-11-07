// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryProposalListResponse, MemoryProposalRecord } from "@talent-signal/contracts";
import { MemoryProposalPages } from "./memory-proposal-pages";
import { WorkspaceSessionBoundary } from "../workspace-session-boundary";

const io = vi.hoisted(() => ({ request: vi.fn(), listeners: new Set<(keys: string[] | null, mode: string) => void>() }));
vi.mock("../workspace-session-request", () => ({ workspaceSessionFetch: io.request,
  WORKSPACE_SESSION_EXPIRED_EVENT: "session-expired" }));
vi.mock("@/lib/workspace-directory-cache", () => ({ subscribeWorkspaceDirectoryInvalidation:
  (listener: (keys: string[] | null, mode: string) => void) => {
    io.listeners.add(listener); return () => io.listeners.delete(listener);
  } }));
vi.mock("../locale-provider", () => ({ useT: () => (key: string) => key, useLocale: () => "zh-CN" }));
vi.mock("../desktop-chrome", () => ({ useDesktopChrome: () => null }));
vi.mock("./memory-review-card", () => ({ MemoryReviewCard: ({ proposal }: { proposal: { proposal_id: string; revision: number } }) =>
  createElement("button", { "data-proposal": proposal.proposal_id, "data-revision": proposal.revision }, proposal.proposal_id) }));

const PERSON = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const firstId = "20000000-0000-4000-8000-000000000001";
const nextId = "20000000-0000-4000-8000-000000000002";
const snapshot = "2026-09-22T10:00:00.123456Z";
function proposal(id = firstId, overrides: Partial<MemoryProposalRecord> = {}): MemoryProposalRecord {
  return { proposal_id: id, revision: 1, status: "open", surface: "chat", contact_decision: "existing",
    contact_status: "resolved", identity_authority: "human_selection", person_id: PERSON,
    relationship_context_id: null, item_count: 1, default_selected_count: 1,
    created_at: "2026-09-22T10:00:00Z", expires_at: new Date(Date.now() + 60_000).toISOString(), ...overrides };
}
function page(proposals = [proposal()], more = true): MemoryProposalListResponse {
  return { contract_version: "2026-08-24.10", proposals, has_more: more,
    next_cursor: more ? "mp1.next" : null, snapshot_at: snapshot };
}
let root: Root, mount: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
  io.request.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount()); mount.remove(); vi.useRealTimers(); vi.restoreAllMocks(); io.listeners.clear();
});
async function render(initialPage = page(), overrides: Record<string, unknown> = {}) {
  await act(async () => root.render(createElement(MemoryProposalPages, {
    binding: "binding-1", entryCapability: "entry-1", purpose: "people", personId: PERSON, initialPage, ...overrides,
  })));
}
const button = (name: string) => [...mount.querySelectorAll("button")].find(control => control.textContent === name)!;
async function click(name: string) { await act(async () => { button(name).focus(); button(name).click(); }); }
const ids = () => [...mount.querySelectorAll<HTMLElement>("[data-proposal]")].map(node => node.dataset.proposal);
const invalidation = (mode: string) => { for (const listener of io.listeners) listener(null, mode); };

describe("bounded current proposal pages", () => {
  it.each([{ code: "session_stale" }, { error: { code: "session_stale" } }])(
    "hands confirmed409 login change %j to the real mounted workspace privacy boundary", async metadata => {
      await act(async () => root.render(<WorkspaceSessionBoundary binding="binding-1">
        <div><h1>Synthetic private person and account</h1>
          <MemoryProposalPages binding="binding-1" entryCapability="entry-1"
            purpose="people" personId={PERSON} initialPage={page()} />
        </div>
      </WorkspaceSessionBoundary>));
      expect(mount.textContent).toContain("Synthetic private person and account");
      io.request.mockResolvedValueOnce(Response.json(metadata, { status: 409 }));
      await click("继续查看");
      expect(mount.textContent).not.toContain("Synthetic private person and account");
      expect(mount.textContent).toContain("登录已失效");
      expect(ids()).toEqual([]);
    });

  it("makes one scoped continuation request, replaces the current page and focuses its real list", async () => {
    await render(); io.request.mockResolvedValueOnce(Response.json(page([proposal(nextId)], false)));
    await click("继续查看");
    expect(io.request).toHaveBeenCalledTimes(1);
    const [path, init] = io.request.mock.calls[0]!;
    expect(Object.fromEntries(new URL(path, "https://synthetic.invalid").searchParams)).toEqual({
      purpose: "people", person_id: PERSON, paginate: "true", cursor: "mp1.next" });
    expect(init.headers).toEqual({ "x-workspace-session": "binding-1", "x-memory-entry-capability": "entry-1" });
    expect(ids()).toEqual([nextId]);
    expect(document.activeElement).toBe(mount.querySelector("ul"));
    expect(button("继续查看")).toBeUndefined();
    expect(mount.textContent).toContain("这是上次读取的提案快照。后续变化请重新读取最新。");
  });

  it("deduplicates only the bounded page by proposal identity without rewinding revision", async () => {
    await render(page([proposal(), proposal(firstId, { revision: 2 }), proposal()], false));
    expect(ids()).toEqual([firstId]);
    expect(mount.querySelector("[data-proposal]")?.getAttribute("data-revision")).toBe("2");
  });

  it.each(["scope", "capability", "server-revision", "source", "focus", "session"])(
    "clears or replaces authorized state and rejects a late body after %s changes", async mode => {
      await render();
      let finish!: (value: unknown) => void;
      io.request.mockResolvedValueOnce({ ok: true, status: 200,
        json: () => new Promise(resolve => { finish = resolve; }) } as Response);
      await click("继续查看");
      const signal = io.request.mock.calls[0]![1].signal as AbortSignal;
      if (mode === "scope") await render(page([proposal(nextId, { person_id: OTHER })], false), { personId: OTHER, binding: "binding-2" });
      if (mode === "capability") await render(page([proposal(nextId)], false), { entryCapability: "entry-2" });
      if (mode === "server-revision") await render(page([proposal(nextId, { revision: 2 })], false));
      if (mode === "source") await act(async () => invalidation("revalidate"));
      if (mode === "focus") await act(async () => window.dispatchEvent(new Event("focus")));
      if (mode === "session") await act(async () => window.dispatchEvent(new Event("session-expired")));
      expect(signal.aborted).toBe(true);
      const before = ids();
      await act(async () => { finish(page([proposal("20000000-0000-4000-8000-000000000099")], false)); });
      expect(ids()).toEqual(before);
      if (["source", "focus", "session"].includes(mode)) expect(ids()).toEqual([]);
    });

  it("does not let an unrelated binding invalidation clear this scope", async () => {
    await render();
    await act(async () => { for (const listener of io.listeners) listener(["other-binding"], "discard"); });
    expect(ids()).toEqual([firstId]);
  });

  it("requires explicit fresh read after focus/source withdrawal, without carrying the old cursor", async () => {
    await render(); await act(async () => invalidation("revalidate"));
    expect(ids()).toEqual([]); expect(io.request).not.toHaveBeenCalled();
    io.request.mockResolvedValueOnce(Response.json(page([proposal(nextId)], false)));
    await click("重新读取最新");
    expect(new URL(io.request.mock.calls[0]![0], "https://synthetic.invalid").searchParams.has("cursor")).toBe(false);
    expect(ids()).toEqual([nextId]);
  });

  it.each(["missing-cursor", "repeated-cursor", "repeated-row", "foreign-person", "foreign-context", "changed-snapshot"])(
    "never presents failed %s continuation as a complete empty list", async mode => {
      await render();
      const body = page([proposal(nextId)], false);
      if (mode === "missing-cursor") body.has_more = true;
      if (mode === "repeated-cursor") { body.has_more = true; body.next_cursor = "mp1.next"; }
      if (mode === "repeated-row") body.proposals = [proposal()];
      if (mode === "foreign-person") body.proposals = [proposal(nextId, { person_id: OTHER })];
      if (mode === "foreign-context") {
        await render(page(), { contextId: PERSON }); body.proposals = [proposal(nextId, { relationship_context_id: OTHER })];
      }
      if (mode === "changed-snapshot") body.snapshot_at = "2026-09-23T10:00:00.123456Z";
      io.request.mockResolvedValueOnce(Response.json(body)); await click("继续查看");
      expect(ids()).toEqual([firstId]); expect(mount.querySelector('[role="alert"]')?.textContent).toBe("读取失败。");
      expect(button("继续查看")).toBeDefined();
    });

  it("a stale cursor response clears old content but releases its retry slot for a fresh read", async () => {
    await render(); io.request.mockResolvedValueOnce(Response.json({}, { status: 409 }));
    await click("继续查看"); expect(ids()).toEqual([]);
    io.request.mockResolvedValueOnce(Response.json(page([proposal(nextId)], false)));
    await click("重新读取最新"); expect(ids()).toEqual([nextId]); expect(io.request).toHaveBeenCalledTimes(2);
  });

  it("a late409 metadata body cannot expire the new scope even if its reader ignores cancellation", async () => {
    await render();
    const expired = vi.fn(); window.addEventListener("session-expired", expired);
    let finish!: (value: { done: boolean; value: Uint8Array }) => void;
    const reader = { read: vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ done: true }), cancel: vi.fn(async () => {}), releaseLock: vi.fn() };
    try {
      io.request.mockResolvedValueOnce({ ok: false, status: 409, body: { getReader: () => reader } } as unknown as Response);
      await click("继续查看");
      await render(page([proposal(nextId, { person_id: OTHER })], false), { personId: OTHER, binding: "binding-2" });
      expect(reader.cancel).toHaveBeenCalledTimes(1);
      await act(async () => finish({ done: false, value: new TextEncoder().encode(JSON.stringify({ code: "session_stale" })) }));
      expect(expired).not.toHaveBeenCalled(); expect(ids()).toEqual([nextId]);
    } finally { window.removeEventListener("session-expired", expired); }
  });

  it("never treats an oversized error body as a trustworthy login-change notification", async () => {
    await render();
    const expired = vi.fn(); window.addEventListener("session-expired", expired);
    try {
      io.request.mockResolvedValueOnce(Response.json({ code: "session_stale", padding: "x".repeat(4096) }, { status: 409 }));
      await click("继续查看");
      expect(expired).not.toHaveBeenCalled(); expect(ids()).toEqual([]);
      expect(button("重新读取最新")).toBeDefined();
    } finally { window.removeEventListener("session-expired", expired); }
  });

  it("bounded body timeout aborts and releases retry even when the old transport ignores cancellation", async () => {
    vi.useFakeTimers();
    await render(); let finish!: (response: Response) => void;
    io.request.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    await click("继续查看");
    const signal = io.request.mock.calls[0]![1].signal as AbortSignal;
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(signal.aborted).toBe(true); expect(button("继续查看").disabled).toBe(false);
    await act(async () => { finish(Response.json(page([proposal(nextId)], false))); });
    expect(ids()).toEqual([firstId]);
    io.request.mockResolvedValueOnce(Response.json(page([proposal(nextId)], false)));
    await click("继续查看"); expect(ids()).toEqual([nextId]);
  });

  it("removes expired current-page rows without claiming all proposals do not exist", async () => {
    vi.useFakeTimers();
    await render(page([proposal(firstId, { expires_at: new Date(Date.now() + 20).toISOString() })], false));
    await act(async () => vi.advanceTimersByTimeAsync(21));
    expect(ids()).toEqual([]);
    expect(mount.textContent).toContain("当前页没有可显示的提案。可重新读取最新内容。");
    expect(io.request).not.toHaveBeenCalled();
  });
});
