// @vitest-environment happy-dom
//
// Home + queue regression for the pre-queue conversation-home send record.
//
// The seeded records use the real `session-drafts` storage helpers and the real
// account partition key, so these tests exercise the exact bytes an old build
// left on this device. Nothing here mocks the legacy store.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetcher = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("./workspace-session-request", () => ({
  RELATIONSHIP_SESSION_EXPIRED_EVENT: "talent-signal:workspace-session-expired",
  WORKSPACE_SESSION_EXPIRED_EVENT: "talent-signal:workspace-session-expired",
  relationshipIntegrationFetch: fetcher,
  relationshipIntegrationSessionExpired: () => false,
  workspaceSessionExpired: () => false,
  workspaceSessionFetch: fetcher,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("./workspace-search", () => ({
  useWorkspaceDirectory: () => ({
    data: { sessions: { session_version: "session-binding", sessions: [] }, people: { people: [] } },
    loading: false, failed: false, retry: vi.fn(),
  }),
  WorkspaceGlobalSearchDialog: ({ label }: { label: string }) => createElement("button", { "aria-label": label }, "Search"),
}));

import { conversationHome, writeConversationDraft } from "@/lib/conversation-local";
import { newConversationPendingDraft } from "@/lib/new-conversation";
import { WORKSPACE_NEW_CONVERSATION_EVENT } from "@/lib/workspace-navigation";
import { WorkspaceNewConversation } from "./new-conversation";
import { QueuedConversation } from "./conversation/queued-conversation";
import { WorkspaceShellNav } from "./workspace-shell-nav";
import { WorkspaceRecentSessions } from "./workspace-recent-sessions";
import { SessionWorkbench } from "./session-workbench/session-workbench";
import type { SessionDetail } from "./session-workbench/session-detail-state";
import {
  writePendingSessionDraft,
  type PendingSessionDraft,
} from "./session-workbench/session-draft-pending";

const SCOPE = "a".repeat(64);
const OTHER_SCOPE = "b".repeat(64);
const SESSION_ID = "72ce7ff4-a5a8-40d0-b1d7-d84a13adcd30";
const OTHER_SESSION_ID = "1b2c3d4e-5f60-4712-8a9b-0c1d2e3f4a5b";
const REQUEST_ID = "8f1c2f6e-9d24-4c9a-9d3d-2f6c1a5b7e10";
const OBJECTIVE = "旧版草稿  保留空格\n第二行";

type Props = {
  bootstrap?: { sessionId: string; capability: string };
  accountId: string | null;
  sessionBinding: string | null;
  sessionVersion: string | null;
  storageScope: string | null;
};
const READY: Props = {
  accountId: "account-1",
  sessionBinding: "session-binding",
  sessionVersion: "session-version",
  storageScope: SCOPE,
};

function draftKey(scope: string, sessionId: string): string {
  return `talent-signal:session-draft-pending:v1:${scope}:${sessionId}`;
}

function legacyRecord(options: {
  scope?: string;
  sessionId?: string;
  objective?: string;
  attempted?: boolean;
} = {}): PendingSessionDraft {
  const pending = newConversationPendingDraft({
    baseRevision: 1,
    intent: {
      requestId: REQUEST_ID,
      sessionId: options.sessionId ?? SESSION_ID,
      updatedAt: "2026-09-19T08:00:00.000Z",
    },
    objective: options.objective ?? OBJECTIVE,
    storageScope: options.scope ?? SCOPE,
  });
  return options.attempted === undefined
    ? pending
    : ({ ...pending, attempted: options.attempted } as PendingSessionDraft);
}

function seedLegacy(record: PendingSessionDraft): void {
  expect(writePendingSessionDraft(record)).toBe(true);
}

function setComposerValue(element: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(text),
  );
}

let mount: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render(props: Props = READY): Promise<void> {
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => {
    root?.render(createElement(WorkspaceNewConversation, props));
  });
}

async function receiveFreshServerBootstrap(): Promise<void> {
  expect(document.body.textContent).toContain("正在打开新对话");
  const pushOrder = router.push.mock.invocationCallOrder.at(-1) ?? 0;
  const replaceOrder = router.replace.mock.invocationCallOrder.at(-1) ?? 0;
  expect(pushOrder).toBeGreaterThan(replaceOrder);
  const href = router.push.mock.calls.at(-1)?.[0];
  const sessionId = new URL(href, "http://localhost").searchParams.get("draft_session");
  expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
  // Next navigation resolves a fresh server-signed capability; a client reset
  // must not reuse the previous Session authority while waiting for it.
  window.history.replaceState(null, "", href);
  await act(async () => root?.render(createElement(WorkspaceNewConversation, {
    ...READY, bootstrap: { sessionId: sessionId!, capability: `new-server-capability:${sessionId}` },
  })));
  await flush();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  window.history.replaceState(null, "", "/workspace");
  fetcher.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
  router.replace.mockReset();
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  mount?.remove();
  mount = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("explicit New conversation focus handoff", () => {
  const saved: SessionDetail = {
    session_id: SESSION_ID, revision: 1, updated_at: "2026-10-13T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z", state: "active", title: "Synthetic saved Session",
    turn_count: 0, is_unread: false, scope_kind: "unresolved_intent", person_id: null,
    relationship_context_id: null, person_label: "", context_label: "", deleted_at: null,
    display_authority: "stale_unconfirmed", composer_draft: null, composer_draft_updated_at: null, turns: [],
  };

  function sidebarCanvas(surface: "saved" | "home", props: Props = READY) {
    return createElement("div", null,
      createElement(WorkspaceShellNav, { binding: "session-binding", storageScope: SCOPE }),
      createElement(WorkspaceRecentSessions, { binding: "session-binding", storageScope: SCOPE }),
      surface === "saved" ? createElement(SessionWorkbench, {
        accountId: "account-1", chatSessionVersion: "session-version", sessionVersion: "session-binding",
        storageScope: SCOPE, initialDetail: saved, initialError: null, sessionRecoveryHref: null,
      }) : createElement(WorkspaceNewConversation, props),
    );
  }

  async function open(surface: "saved" | "home", props: Props = READY) {
    mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
    await act(async () => root?.render(sidebarCanvas(surface, props)));
    await flush();
  }

  function newAction(presentation: "expanded" | "collapsed") {
    return document.querySelector<HTMLButtonElement>(presentation === "expanded"
      ? 'section[aria-label="最近对话"] button[aria-label="开始新对话"]'
      : '[data-collapsed-only="true"] button[aria-label="开始新对话"]')!;
  }

  async function resolveNavigation() {
    const href = String(router.push.mock.calls.at(-1)?.[0]);
    const sessionId = new URL(href, "http://localhost").searchParams.get("draft_session")!;
    window.history.replaceState(null, "", href);
    await act(async () => root?.render(sidebarCanvas("home", {
      ...READY, bootstrap: { sessionId, capability: `new-server-capability:${sessionId}` },
    })));
    await flush();
    return document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
  }

  it.each(["expanded", "collapsed"] as const)("focuses the fresh composer after %s sidebar navigation from a saved Session", async (presentation) => {
    fetcher.mockImplementation(() => new Promise<Response>(() => {}));
    window.history.replaceState(null, "", `/workspace/sessions/${SESSION_ID}`);
    await open("saved");
    const action = newAction(presentation); action.focus();
    await act(async () => action.click());
    const composer = await resolveNavigation();
    expect(composer.disabled).toBe(false);
    expect(document.activeElement).toBe(composer);
    expect(router.push).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it.each(["expanded", "collapsed"] as const)("focuses once after the %s sidebar resets a mounted Home", async (presentation) => {
    writeConversationDraft(SCOPE, SESSION_ID, { value: "Synthetic retained unsent draft", writer: "focus-test", updatedAt: new Date().toISOString(), expiresAt: Date.now() + 60_000 });
    await open("home", { ...READY, bootstrap: { sessionId: SESSION_ID, capability: "old-server-capability" } });
    const previous = document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
    const action = newAction(presentation); action.focus();
    await act(async () => action.click());
    expect(document.querySelector("#queued-conversation-composer")).toBeNull();
    const composer = await resolveNavigation();
    expect(composer).not.toBe(previous);
    expect(composer.value).toBe("");
    expect(document.activeElement).toBe(composer);
    expect(router.push).toHaveBeenCalledOnce();
    action.focus();
    await act(async () => root?.render(sidebarCanvas("home", {
      ...READY, bootstrap: { sessionId: conversationHome(SCOPE)!, capability: "same-server-capability" },
    })));
    await flush();
    expect(document.activeElement).toBe(action);
    expect(new URL(window.location.href).searchParams.has("intent")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();

    // Reopening this retained draft is reading continuity, not another compose
    // action. A new queue mount must not inherit the already consumed request.
    const sessionId = conversationHome(SCOPE)!;
    fetcher.mockImplementation(() => new Promise<Response>(() => {}));
    window.history.replaceState(null, "", `/workspace/sessions/${SESSION_ID}`);
    await act(async () => root?.render(sidebarCanvas("saved")));
    window.history.replaceState(null, "", `/workspace?draft_session=${sessionId}`);
    action.focus();
    await act(async () => root?.render(sidebarCanvas("home", {
      ...READY, bootstrap: { sessionId, capability: "retained-server-capability" },
    })));
    await flush();
    expect(document.activeElement).toBe(action);
  });

  it("waits for account readiness before focusing a newly mounted composer", async () => {
    window.history.replaceState(null, "", `/workspace?draft_session=${SESSION_ID}&intent=compose`);
    const pending = { ...READY, sessionBinding: null, bootstrap: { sessionId: SESSION_ID, capability: "server-capability" } };
    await open("home", pending);
    const action = newAction("collapsed"); action.focus();
    expect(document.activeElement).toBe(action);
    expect(document.querySelector("#queued-conversation-composer")).toBeNull();
    act(() => root?.render(sidebarCanvas("home", { ...READY, bootstrap: pending.bootstrap })));
    const composer = document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
    expect(composer.disabled).toBe(true);
    expect(document.activeElement).toBe(action);
    await flush();
    expect(document.querySelector("#queued-conversation-composer")).toBe(composer);
    expect(composer.disabled).toBe(false);
    expect(document.activeElement).toBe(composer);
  });

  it.each(["", `?draft_session=${OTHER_SESSION_ID}&intent=compose`])("keeps sidebar focus when Home has no compose request for its Session (%s)", async (search) => {
    writeConversationDraft(SCOPE, SESSION_ID, { value: "Synthetic recovered draft", writer: "focus-test", updatedAt: new Date().toISOString(), expiresAt: Date.now() + 60_000 });
    window.history.replaceState(null, "", `/workspace${search}`);
    mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
    act(() => root?.render(sidebarCanvas("home", {
      ...READY, bootstrap: { sessionId: SESSION_ID, capability: "server-capability" },
    })));
    const action = newAction("collapsed"); action.focus();
    await flush();
    expect(document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")?.value).toBe("Synthetic recovered draft");
    expect(document.activeElement).toBe(action);
  });

  it("never focuses a disabled unavailable Session for a compose request", async () => {
    mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
    const action = document.createElement("button"); document.body.append(action); action.focus();
    await act(async () => root?.render(createElement(QueuedConversation, {
      initialDetail: { ...saved, state: "deleted", deleted_at: "2026-10-13T00:00:00.000Z" },
      scope: SCOPE, chatBinding: "session-version", detailBinding: "session-binding", focusComposer: true,
    })));
    await flush();
    expect(document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")?.disabled).toBe(true);
    expect(document.activeElement).toBe(action);
    action.remove();
  });
});

describe("authenticated home with a legacy conversation-home record", () => {
  it("keeps the old record recoverable and sends every new message through the durable queue", async () => {
    seedLegacy(legacyRecord({ attempted: true }));
    // Delayed network: the receipt never arrives during the assertions.
    fetcher.mockImplementation(() => new Promise<Response>(() => {}));
    await render();
    await flush();

    // One composer, owned by the queue surface; never the legacy canvas.
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
    expect(document.querySelector("#queued-conversation-composer")).not.toBeNull();
    expect(document.querySelector("#new-conversation-objective")).toBeNull();

    // The old blocking send is never repeated, and its exact record is intact.
    expect(fetcher).not.toHaveBeenCalled();
    const stored = JSON.parse(
      localStorage.getItem(draftKey(SCOPE, SESSION_ID)) ?? "null",
    ) as PendingSessionDraft & { attempted?: boolean };
    expect(stored.latest.draft).toBe(OBJECTIVE);
    expect(stored.latest.idempotencyKey).toBe(REQUEST_ID);
    expect(stored.attempted).toBe(true);

    // The notice cannot enter the legacy controller, which would rebase the
    // uncertain home intent as a draft and lose the original retry identity.
    expect(
      document.querySelector(
        `a[href="/workspace/sessions/${SESSION_ID}"]`,
      ),
    ).toBeNull();
    expect(document.body.textContent).toContain("旧版消息");

    // Original whitespace is visible on demand, not truncated or normalized.
    const reveal = button("查看原文");
    expect(reveal).toBeDefined();
    await act(async () => reveal?.click());
    expect(document.querySelector("pre")?.textContent).toBe(OBJECTIVE);

    // A new send echoes immediately and releases the composer before receipt.
    const composer = document.querySelector<HTMLTextAreaElement>(
      "#queued-conversation-composer",
    );
    expect(composer).not.toBeNull();
    await act(async () => {
      if (composer) setComposerValue(composer, "全新的消息");
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')
        ?.click();
    });
    await flush();

    expect(
      document.querySelector<HTMLTextAreaElement>(
        "#queued-conversation-composer",
      )?.value,
    ).toBe("");
    expect(document.body.textContent).toContain("全新的消息");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/conversation-queue$/);
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.objective).toBe("全新的消息");
    expect(JSON.stringify(body)).not.toContain("旧版草稿");
    // Admission never converts, re-keys or clears the legacy record.
    expect(localStorage.getItem(draftKey(SCOPE, SESSION_ID))).not.toBeNull();
  });

  it("keeps the same focused composer and second draft when admission returns", async () => {
    let acceptFirst: ((response: Response) => void) | undefined;
    let admittedId = "";
    fetcher.mockImplementation((url, init) => {
      if (init?.method === "POST" && String(url).endsWith("/conversation-queue")) {
        admittedId = String(url).split("/").at(-2)!;
        if (!acceptFirst) return new Promise<Response>((resolve) => { acceptFirst = resolve; });
        return Promise.resolve(Response.json({}, { status: 202 }));
      }
      return new Promise<Response>(() => {});
    });
    // Model a route transition replacing the page while the server reads it.
    // This reproduces the production failure if admission triggers navigation.
    router.replace.mockImplementation(() => {
      root?.render(createElement("div", null, "Loading the Session"));
    });
    await render();
    await flush();
    const composer = document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
    await act(async () => {
      composer.focus();
      setComposerValue(composer, "First synthetic message");
    });
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.click());
    await flush();
    expect(acceptFirst).toBeDefined();
    expect(composer.value).toBe("");
    await act(async () => setComposerValue(composer, "Second draft still being edited"));
    composer.setSelectionRange(7, 12);

    await act(async () => acceptFirst?.(Response.json({}, { status: 202 })));
    await flush();
    expect(document.querySelector("#queued-conversation-composer")).toBe(composer);
    expect(document.activeElement).toBe(composer);
    expect(composer.value).toBe("Second draft still being edited");
    expect([composer.selectionStart, composer.selectionEnd]).toEqual([7, 12]);
    expect(window.location.pathname).toBe(`/workspace/sessions/${admittedId}`);
    expect(router.replace).not.toHaveBeenCalled();
    expect(document.querySelector("h1")?.textContent).toBe("新对话");

    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.click());
    await flush();
    const admissions = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(admissions).toHaveLength(2);
    expect(admissions[1][0]).toBe(admissions[0][0]);
    expect(JSON.parse(String(admissions[1][1].body)).objective).toBe("Second draft still being edited");
    expect(composer.value).toBe("");
    expect(document.activeElement).toBe(composer);

    await act(async () => {
      window.history.replaceState(null, "", "/workspace");
      window.dispatchEvent(new Event(WORKSPACE_NEW_CONVERSATION_EVENT));
    });
    await flush();
    expect(document.querySelector("#queued-conversation-composer")).not.toBe(composer);
    expect(document.querySelector("h1")).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });

  it.each(["/workspace/private", "/workspace/people", "/workspace?person=synthetic-person"])(
    "does not replace an intervening navigation to %s when admission finishes",
    async (destination) => {
      let accept: ((response: Response) => void) | undefined;
      fetcher.mockImplementation(() => new Promise<Response>((resolve) => { accept = resolve; }));
      await render();
      await flush();
      const composer = document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
      await act(async () => setComposerValue(composer, "Synthetic navigation race"));
      await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.click());
      await flush();
      expect(accept).toBeDefined();
      window.history.replaceState(null, "", destination);
      await act(async () => accept?.(Response.json({}, { status: 202 })));
      await flush();
      expect(window.location.pathname + window.location.search).toBe(destination);
      expect(router.replace).not.toHaveBeenCalled();
    },
  );

  it.each(["before first receipt", "after first receipt"])(
    "preserves another tab's home draft created %s",
    async (timing) => {
      let accept: ((response: Response) => void) | undefined;
      fetcher.mockImplementation((url, init) => {
        if (init?.method === "POST" && String(url).endsWith("/conversation-queue")) {
          return new Promise<Response>((resolve) => { accept = resolve; });
        }
        return new Promise<Response>(() => {});
      });
      await render();
      await flush();
      const composer = document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
      await act(async () => setComposerValue(composer, "Tab A first"));
      await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.click());
      if (timing === "after first receipt") {
        await act(async () => accept?.(Response.json({}, { status: 202 })));
        await flush();
        await act(async () => setComposerValue(composer, "Tab A second"));
        await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.click());
      }
      // Another tab created a fresh Home while A's network receipt is pending.
      conversationHome(SCOPE, OTHER_SESSION_ID);
      writeConversationDraft(SCOPE, OTHER_SESSION_ID, {
        value: "Tab B unsent draft", updatedAt: new Date().toISOString(),
        expiresAt: Date.now() + 60_000, writer: "tab-b",
      });
      await act(async () => accept?.(Response.json({}, { status: 202 })));
      await flush();
      expect(conversationHome(SCOPE)).toBe(OTHER_SESSION_ID);
      await act(async () => root?.unmount());
      mount?.remove();
      window.history.replaceState(null, "", "/workspace");
      await render();
      await flush();
      expect(document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")?.value).toBe("Tab B unsent draft");
    },
  );

  it.each(["/workspace/private", "/workspace/people", "/workspace?person=synthetic-person"])(
    "does not interrupt an uncommitted Link transition to %s",
    async (destination) => {
      let accept: ((response: Response) => void) | undefined;
      fetcher.mockImplementation(() => new Promise<Response>((resolve) => { accept = resolve; }));
      await render();
      await flush();
      const composer = document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
      await act(async () => setComposerValue(composer, "Pending navigation"));
      await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.click());
      const link = document.createElement("a");
      link.href = destination;
      // Like Next Link: prevent browser navigation while the server route loads.
      link.addEventListener("click", (event) => event.preventDefault());
      mount?.append(link);
      link.click();
      expect(window.location.pathname).toBe("/workspace");
      const replace = vi.spyOn(window.history, "replaceState");
      try {
        await act(async () => accept?.(Response.json({}, { status: 202 })));
        await flush();
        expect(replace).not.toHaveBeenCalled();
        expect(router.replace).not.toHaveBeenCalled();
      } finally { replace.mockRestore(); }
    },
  );

  it("resets the retained Home when the brand link returns to the start", async () => {
    fetcher.mockImplementation((url, init) => init?.method === "POST" && String(url).endsWith("/conversation-queue")
      ? Promise.resolve(Response.json({}, { status: 202 })) : new Promise<Response>(() => {}));
    await render();
    await flush();
    const composer = document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
    await act(async () => setComposerValue(composer, "Before home link"));
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.click());
    await flush();
    const admittedPath = window.location.pathname;
    const link = document.createElement("a");
    link.href = "/workspace";
    link.addEventListener("click", (event) => {
      // Like Next Link, respect the fresh-bootstrap navigation owner.
      if (event.defaultPrevented) return;
      event.preventDefault();
      window.history.replaceState(null, "", "/workspace");
    });
    mount?.append(link);
    await act(async () => link.click());
    await flush();
    await receiveFreshServerBootstrap();
    const fresh = document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
    expect(fresh).not.toBe(composer);
    expect(document.querySelector("h1")).toBeNull();
    await act(async () => setComposerValue(fresh, "After home link"));
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.click());
    await flush();
    expect(window.location.pathname).not.toBe(admittedPath);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });

  it("resets a retained Home after deleting its admitted conversation", async () => {
    let sessionId = "";
    fetcher.mockImplementation((url, init) => {
      if (init?.method === "POST") {
        sessionId = String(url).split("/").at(-2)!;
        return Promise.resolve(Response.json({}, { status: 202 }));
      }
      if (String(url).endsWith("/stream")) {
        const snapshot = { session_id: sessionId, revision: 1, paused: false, queued: [], active: null, preview: null };
        return Promise.resolve(new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
        } })));
      }
      return Promise.resolve(Response.json({ detail: {
        session_id: sessionId, revision: init?.method === "DELETE" ? 2 : 1,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        state: init?.method === "DELETE" ? "deleted" : "active",
        turns: [], title: "Synthetic deletion", composer_draft: "",
      } }));
    });
    router.replace.mockImplementation((href: string) => window.history.replaceState(null, "", href));
    await render();
    await flush();
    const composer = document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
    await act(async () => setComposerValue(composer, "First session"));
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.click());
    await flush();
    const deletedId = sessionId;
    await act(async () => button("删除对话")?.click());
    await act(async () => button("确认删除")?.click());
    await flush();
    await receiveFreshServerBootstrap();
    const fresh = document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
    expect(fresh).not.toBe(composer);
    expect(fresh.disabled).toBe(false);
    expect(fresh.value).toBe("");
    expect(window.location.pathname).toBe("/workspace");
    expect(document.querySelector("h1")).toBeNull();
    await act(async () => setComposerValue(fresh, "Fresh after delete"));
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.click());
    await flush();
    expect(sessionId).not.toBe(deletedId);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });

  it.each([
    ["missing", undefined],
    ["explicitly false", false],
  ] as const)(
    "treats a %s attempted flag as unknown and never submits it",
    async (_label, attempted) => {
      seedLegacy(legacyRecord({ attempted }));
      await render();
      await flush();

      expect(document.body.textContent).toContain("旧版消息");
      expect(document.body.textContent).toContain("是否已提交未知");
      expect(fetcher).not.toHaveBeenCalled();
      expect(localStorage.getItem(draftKey(SCOPE, SESSION_ID))).not.toBeNull();
    },
  );

  it("retains the same unresolved recovery across a home reset without duplicating it", async () => {
    seedLegacy(legacyRecord({ attempted: true }));
    await render();
    await flush();
    expect(
      document.querySelectorAll('[aria-label="旧版未完成消息"]'),
    ).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new Event(WORKSPACE_NEW_CONVERSATION_EVENT));
    });
    await flush();
    await receiveFreshServerBootstrap();

    expect(
      document.querySelectorAll('[aria-label="旧版未完成消息"]'),
    ).toHaveLength(1);
    expect(document.body.textContent).toContain("旧版消息");
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem(draftKey(SCOPE, SESSION_ID)) ?? "null")
        .latest.draft,
    ).toBe(OBJECTIVE);
  });

  it("retains the same unresolved recovery across a fresh remount without duplicating it", async () => {
    seedLegacy(legacyRecord({ attempted: true }));
    await render();
    await flush();
    expect(
      document.querySelectorAll('[aria-label="旧版未完成消息"]'),
    ).toHaveLength(1);

    if (root) await act(async () => root?.unmount());
    root = null;
    mount?.remove();
    mount = null;

    await render();
    await flush();
    expect(
      document.querySelectorAll('[aria-label="旧版未完成消息"]'),
    ).toHaveLength(1);
    expect(document.body.textContent).toContain("旧版消息");
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem(draftKey(SCOPE, SESSION_ID)) ?? "null")
        .latest.draft,
    ).toBe(OBJECTIVE);
  });

  it("never surfaces another account partition's legacy record", async () => {
    seedLegacy(
      legacyRecord({ scope: OTHER_SCOPE, sessionId: OTHER_SESSION_ID }),
    );
    await render();
    await flush();

    expect(document.body.textContent).not.toContain("旧版消息");
    expect(document.body.textContent).not.toContain(OBJECTIVE);
    expect(
      document.querySelector('a[href*="/workspace/sessions/"]'),
    ).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("drops the recovery when another tab removes its exact record", async () => {
    seedLegacy(legacyRecord({ attempted: true }));
    await render();
    await flush();
    expect(document.body.textContent).toContain("旧版消息");

    localStorage.removeItem(draftKey(SCOPE, SESSION_ID));
    await act(async () => {
      const event = new Event("storage");
      Object.defineProperty(event, "key", {
        value: draftKey(SCOPE, SESSION_ID),
      });
      window.dispatchEvent(event);
    });
    await flush();

    expect(document.body.textContent).not.toContain("旧版消息");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("drops a record that is already expired at mount without claiming recovery", async () => {
    const expired = legacyRecord({ attempted: true });
    const savedAt = new Date(Date.now() - 48 * 60 * 60 * 1_000).toISOString();
    const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    localStorage.setItem(
      draftKey(SCOPE, SESSION_ID),
      JSON.stringify({ ...expired, expiresAt, savedAt }),
    );

    await render();
    await flush();

    expect(document.body.textContent).not.toContain("旧版消息");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("drops the recovery at its own expiry without extending it", async () => {
    const record = legacyRecord({ attempted: true });
    seedLegacy({
      ...record,
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
    } as PendingSessionDraft);

    await render();
    await flush();
    expect(document.body.textContent).toContain("旧版消息");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_400));
    });

    expect(document.body.textContent).not.toContain("旧版消息");
    expect(document.body.textContent).not.toContain(OBJECTIVE);
    expect(localStorage.getItem(draftKey(SCOPE, SESSION_ID))).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("resets the queue surface across an account switch in the same root", async () => {
    const aHomeId = { value: "" };
    fetcher.mockImplementation((url, init) => {
      const target = String(url);
      const stream = target.match(
        /workspace-sessions\/([^/]+)\/conversation-queue\/stream$/,
      );
      if (stream) {
        const sessionId = stream[1];
        // A's live queue is observable; B's stream stays pending so any
        // carried-over A snapshot would stay visible if the surface were
        // reused instead of remounted.
        if (sessionId !== aHomeId.value) return new Promise<Response>(() => {});
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    `event: snapshot\ndata: ${JSON.stringify({
                      session_id: sessionId,
                      revision: 1,
                      paused: false,
                      queued: [
                        {
                          queue_entry_id: "e1",
                          message_id: "m1",
                          objective: "A 的队列消息",
                          status: "queued",
                        },
                      ],
                      preview: null,
                      active: null,
                    })}\n\n`,
                  ),
                );
              },
            }),
          ),
        );
      }
      const queue = target.match(/workspace-sessions\/([^/]+)\/conversation-queue$/);
      if (queue && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        if (body.objective === "A 的发送中消息") aHomeId.value = queue[1];
        return Promise.resolve(Response.json({}, { status: 202 }));
      }
      return Promise.resolve(Response.json({}));
    });

    await render();
    await flush();
    const composer = document.querySelector<HTMLTextAreaElement>(
      "#queued-conversation-composer",
    );
    await act(async () => {
      if (composer) setComposerValue(composer, "A 的发送中消息");
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')
        ?.click();
    });
    await flush();
    expect(document.body.textContent).toContain("A 的发送中消息");
    expect(document.body.textContent).toContain("A 的队列消息");
    const callsBeforeSwitch = fetcher.mock.calls.length;

    await act(async () => {
      root?.render(
        createElement(WorkspaceNewConversation, {
          accountId: "account-2",
          sessionBinding: "session-binding-b",
          sessionVersion: "session-version-b",
          storageScope: OTHER_SCOPE,
        }),
      );
    });
    await flush();

    expect(document.body.textContent).not.toContain("A 的发送中消息");
    expect(document.body.textContent).not.toContain("A 的队列消息");
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
    expect(
      document.querySelector<HTMLTextAreaElement>(
        "#queued-conversation-composer",
      )?.value,
    ).toBe("");

    const bComposer = document.querySelector<HTMLTextAreaElement>(
      "#queued-conversation-composer",
    );
    await act(async () => {
      if (bComposer) setComposerValue(bComposer, "B 的新消息");
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')
        ?.click();
    });
    await flush();

    const afterSwitch = fetcher.mock.calls.slice(callsBeforeSwitch);
    expect(
      afterSwitch.some((call) =>
        String(call[1]?.body ?? "").includes("A 的"),
      ),
    ).toBe(false);
    const bSend = afterSwitch.find(
      (call) =>
        call[1]?.method === "POST" &&
        String(call[0]).endsWith("/conversation-queue") &&
        String(call[1]?.body).includes("B 的新消息"),
    );
    expect(bSend).toBeDefined();
    expect(JSON.parse(String(bSend?.[1]?.body)).objective).toBe("B 的新消息");
  });

  it("renders the queue composer when local draft storage is inaccessible", async () => {
    const denied = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    try {
      await render();
      await flush();
      expect(
        document.querySelector("#queued-conversation-composer"),
      ).not.toBeNull();
      expect(document.body.textContent).not.toContain("旧版消息");
    } finally {
      denied.mockRestore();
    }
  });

  it("server-renders the queue surface for authenticated-ready props, not a live legacy controller", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceNewConversation, READY),
    );
    expect(html).toContain("queued-conversation-composer");
    expect(html).toContain("从一段对话开始");
    expect(html).not.toContain("new-conversation-objective");
  });
});
