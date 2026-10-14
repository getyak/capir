// @vitest-environment happy-dom
// These are component lifecycle checks with controlled scroll metrics. Actual
// browser layout, focus and history transitions still need surface acceptance.
import { Activity, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/sessions",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/workspace-session-request", () => ({
  WORKSPACE_SESSION_EXPIRED_EVENT: "talent-signal:workspace-session-expired",
  workspaceSessionFetch: request,
  workspaceSessionExpired: () => false,
  relationshipIntegrationFetch: request,
  relationshipIntegrationSessionExpired: () => false,
}));

import { SessionWorkbench } from "../session-workbench/session-workbench";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import { invalidateWorkspaceDirectory } from "@/lib/workspace-directory-cache";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const SCOPE = "d".repeat(64);
const OTHER_SCOPE = "e".repeat(64);
const details = new Map<string, SessionDetail>();
let root: Root;
let host: HTMLDivElement;
let height: number;
let viewportHeight: number;
let offsets: WeakMap<HTMLElement, number>;
let observers: Set<{ callback: ResizeObserverCallback; nodes: Set<Element> }>;

function detail(id = FIRST, state: SessionDetail["state"] = "active"): SessionDetail {
  const result: SessionDetail = {
    session_id: id, revision: 1, updated_at: "2026-10-13T00:00:00.000Z",
    expires_at: "2026-10-14T00:00:00.000Z", state, title: "Synthetic reading continuity",
    turn_count: 1, is_unread: false, scope_kind: "unresolved_intent", person_id: null,
    relationship_context_id: null, person_label: "", context_label: "", deleted_at: null,
    display_authority: "stale_unconfirmed", composer_draft: null, composer_draft_updated_at: null,
    turns: [{ id: "33333333-3333-4333-8333-333333333333", objective: "Synthetic earlier question",
      createdAt: "2026-10-13T00:00:00.000Z", response: {
        taskID: "synthetic", contractVersion: "2026-08-24.10", createdAt: "2026-10-13T00:00:01.000Z",
        contextManifestID: "", knowledgeSnapshotID: "", disposition: "answer", savedBlocks: [],
      } }],
  };
  if (state !== "active") {
    result.turns = [];
    result.turn_count = 0;
    result.deleted_at = "2026-10-13T01:00:00.000Z";
  }
  return result;
}

function isTranscript(node: HTMLElement) {
  return ["对话记录", "对话历史"].includes(node.getAttribute("aria-label") ?? "");
}

async function resize() {
  await act(async () => {
    for (const observer of observers) observer.callback([], observer as unknown as ResizeObserver);
  });
}

async function settleViewportFrames() {
  await act(async () => new Promise<void>((resolve) => {
    let frame: number;
    const finish = () => { window.clearTimeout(timeout); cancelAnimationFrame(frame); resolve(); };
    const timeout = window.setTimeout(finish, 200);
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish); });
  }));
}

async function open(id = FIRST, scope = SCOPE, state: SessionDetail["state"] = "active", legacy = false) {
  const initialDetail = detail(id, state);
  if (legacy) initialDetail.scope_kind = "relationship";
  details.set(id, initialDetail);
  await act(async () => {
    root.render(createElement(SessionWorkbench, {
      accountId: "synthetic", chatSessionVersion: `chat-${scope}`, sessionVersion: `detail-${scope}`,
      storageScope: scope, initialDetail, initialError: null, sessionRecoveryHref: null,
    }));
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
  await resize();
  await settleViewportFrames();
  const node = host.querySelector<HTMLElement>(legacy ? '[aria-label="对话历史"]' : '[aria-label="对话记录"]');
  // The production resolver must choose the queue runtime, not the legacy path.
  expect(node).not.toBeNull();
  if (!legacy) expect(host.querySelector("[data-session-runtime]")).not.toBeNull();
  return node!;
}

async function leave() {
  await act(async () => root.render(createElement("main", null, "People or Time destination")));
}

async function readAt(node: HTMLElement, top: number) {
  await act(async () => {
    node.dispatchEvent(new WheelEvent("wheel", { deltaY: top < node.scrollTop ? -100 : 100, bubbles: true }));
    node.scrollTop = top;
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

async function writeDraft(value: string) {
  const composer = host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    valueSetter.call(composer, value);
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T01:00:00.000Z"));
  localStorage.clear();
  details.clear();
  invalidateWorkspaceDirectory(undefined, "discard");
  height = 2400;
  viewportHeight = 600;
  offsets = new WeakMap();
  observers = new Set();
  vi.stubGlobal("ResizeObserver", class {
    callback: ResizeObserverCallback;
    nodes = new Set<Element>();
    constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.add(this); }
    observe(node: Element) { this.nodes.add(node); }
    unobserve(node: Element) { this.nodes.delete(node); }
    disconnect() { observers.delete(this); }
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return isTranscript(this) ? viewportHeight : 0; });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return isTranscript(this) ? height : 0; });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (this: HTMLElement) { return offsets.get(this) ?? 0; });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (this: HTMLElement, value: number) { offsets.set(this, Math.max(0, Math.min(value, height - viewportHeight))); });
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (this: HTMLElement, options?: ScrollToOptions | number) { this.scrollTop = typeof options === "number" ? options : options?.top ?? 0; });
  request.mockReset();
  request.mockImplementation((url: string, init?: RequestInit) => {
    const id = String(url).match(/workspace-sessions\/([^/]+)/)?.[1] ?? FIRST;
    const snapshot = { contract_version: "2026-08-24.10", session_id: id, revision: 1, paused: false, active: null, queued: [], preview: null };
    if (String(url).endsWith("/stream")) return Promise.resolve(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
        init?.signal?.addEventListener("abort", () => controller.close(), { once: true });
      },
    })));
    if (String(url).endsWith("/conversation-queue")) return Promise.resolve(Response.json(snapshot));
    if (init?.method === "PATCH" && typeof init.body === "string") {
      const body = JSON.parse(init.body) as { composer_draft?: string };
      const previous = details.get(id) ?? detail(id);
      if (typeof body.composer_draft === "string") details.set(id, {
        ...previous, revision: previous.revision + 1, composer_draft: body.composer_draft,
        composer_draft_updated_at: new Date().toISOString(),
      });
    }
    return Promise.resolve(Response.json({ detail: details.get(id) ?? detail(id) }));
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  invalidateWorkspaceDirectory(undefined, "discard");
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("returns from another destination to the same draft and earlier reading position", async () => {
  const first = await open();
  await readAt(first, 340);
  await writeDraft("  Synthetic unfinished draft\nsecond line  ");
  await leave();
  height = 2800;
  const returned = await open();
  expect(returned.scrollTop).toBe(340);
  expect(host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")?.value).toBe("  Synthetic unfinished draft\nsecond line  ");
  expect(host.textContent).toContain("回到最新");
  height = 3100; // Late transcript/image layout must not land at the new end.
  await resize();
  expect(returned.scrollTop).toBe(340);
});

it("keeps two Session drafts and reading positions independently", async () => {
  await readAt(await open(FIRST), 340);
  await writeDraft("First Session draft");
  await leave();
  await readAt(await open(SECOND), 780);
  await writeDraft("Second Session draft");
  await leave();
  expect((await open(FIRST)).scrollTop).toBe(340);
  expect(host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")?.value).toBe("First Session draft");
  await leave();
  expect((await open(SECOND)).scrollTop).toBe(780);
  expect(host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")?.value).toBe("Second Session draft");
});

it("continues following newly arrived content only when the saved reader was near latest", async () => {
  await readAt(await open(), 1760);
  await leave();
  height = 3000;
  const returned = await open();
  expect(returned.scrollTop).toBe(2400);
  expect(host.textContent).not.toContain("回到最新");
  height = 3300;
  await resize();
  expect(returned.scrollTop).toBe(2700);
});

it("lets a returning reader interrupt restoration and keeps that choice through later layout", async () => {
  await readAt(await open(), 340);
  await leave();
  const returned = await open();
  await readAt(returned, 120);
  height = 3000;
  await resize();
  expect(returned.scrollTop).toBe(120);
});

it("never restores another account's position and discards positions on identity loss while away", async () => {
  await readAt(await open(), 340);
  await leave();
  expect((await open(FIRST, OTHER_SCOPE)).scrollTop).toBe(1800);
  await leave();
  invalidateWorkspaceDirectory(undefined, "discard");
  expect((await open()).scrollTop).toBe(1800);
});

it("clamps an older offset when the reopened transcript is shorter", async () => {
  await readAt(await open(), 900);
  await leave();
  height = 1000;
  expect((await open()).scrollTop).toBe(400);
});

it("does not turn a clamped older reading position into following later arrivals", async () => {
  await readAt(await open(), 900);
  await leave();
  height = 1000;
  const returned = await open();
  await act(async () => new Promise<void>((resolve) => window.setTimeout(resolve, 1600)));
  height = 2400;
  await resize();
  expect(returned.scrollTop).toBe(400);
});

it("keeps the last finite position when viewport measurements become invalid", async () => {
  const first = await open();
  await readAt(first, 340);
  await readAt(first, Number.NaN);
  await leave();
  expect((await open()).scrollTop).toBe(340);
});

it("does not revive a position after the Session was deleted", async () => {
  await readAt(await open(), 340);
  await leave();
  await open(FIRST, SCOPE, "deleted");
  await leave();
  expect((await open()).scrollTop).toBe(1800);
});

it("restores after the viewport becomes measurable within the layout window", async () => {
  await readAt(await open(), 340);
  await leave();
  viewportHeight = 0;
  const returned = await open();
  viewportHeight = 600;
  await resize();
  expect(returned.scrollTop).toBe(340);
});

it("does not write an invalidated position back during the departing component cleanup", async () => {
  await readAt(await open(), 340);
  await act(async () => invalidateWorkspaceDirectory(`detail-${SCOPE}`, "discard"));
  await leave();
  expect((await open()).scrollTop).toBe(1800);
});

it("forgets a position at its Session expiry", async () => {
  await readAt(await open(), 340);
  await leave();
  vi.setSystemTime(new Date("2026-10-14T01:00:00.000Z"));
  expect((await open()).scrollTop).toBe(1800);
});

it("also restores the reading position in the governed relationship Session branch", async () => {
  await readAt(await open(FIRST, SCOPE, "active", true), 340);
  await leave();
  height = 2800;
  expect((await open(FIRST, SCOPE, "active", true)).scrollTop).toBe(340);
});

it("keeps the same position when the framework hides and resumes a retained Session tree", async () => {
  const initialDetail = detail();
  details.set(FIRST, initialDetail);
  async function render(mode: "visible" | "hidden") {
    await act(async () => {
      root.render(<Activity mode={mode}><SessionWorkbench
        accountId="synthetic" chatSessionVersion={`chat-${SCOPE}`} sessionVersion={`detail-${SCOPE}`}
        storageScope={SCOPE} initialDetail={initialDetail} initialError={null} sessionRecoveryHref={null}
      /></Activity>);
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    await resize();
  }
  await render("visible");
  await readAt(host.querySelector<HTMLElement>('[aria-label="对话记录"]')!, 340);
  await render("hidden");
  height = 2800;
  await render("visible");
  expect(host.querySelector<HTMLElement>('[aria-label="对话记录"]')?.scrollTop).toBe(340);
});

it("follows the new local message after the reader explicitly sends", async () => {
  await readAt(await open(), 340);
  await leave();
  const returned = await open();
  await writeDraft("Synthetic explicit new send");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')!.click());
  expect(host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")?.value).toBe("");
  height = 3000;
  await resize();
  expect(returned.scrollTop).toBe(2400);
  expect(host.textContent).not.toContain("回到最新");
});

it("keeps reading the earlier messages when the send cannot be durably admitted locally", async () => {
  await readAt(await open(), 340);
  await leave();
  const returned = await open();
  await writeDraft("Synthetic draft retained on failure");
  const denied = vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("Denied storage"); });
  try {
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')!.click());
    height = 3000;
    await resize();
    expect(host.textContent).toContain("无法保存发送状态");
    expect(returned.scrollTop).toBe(340);
    expect(host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")?.value).toBe("Synthetic draft retained on failure");
  } finally { denied.mockRestore(); }
});
