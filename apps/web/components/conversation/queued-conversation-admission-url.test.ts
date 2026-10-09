// @vitest-environment happy-dom
//
// EXP-06 regression: activating the skip link leaves #main-content in the URL
// before the draft conversation is admitted. Admission must preserve that
// valid skip anchor while replacing the draft route with the canonical Session
// URL, and must never rewrite an unrelated hash or query intent. Asserted
// against the real window.location after history.replaceState.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fetcher = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
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

const SESSION = "33333333-3333-4333-8333-333333333333";
const SCOPE = "a".repeat(64);

let mount: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(times = 12): Promise<void> {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  });
}

async function renderDraft() {
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  window.history.replaceState(null, "", "/workspace");
  await act(async () => {
    root?.render(
      createElement(QueuedConversation, {
        bootstrap: { sessionId: SESSION, capability: "synthetic-capability" },
        chatBinding: "chat-binding",
        detailBinding: "detail-binding",
        scope: SCOPE,
      }),
    );
  });
  await flush(4);
  // The draft route exists after mount.
  expect(window.location.pathname).toBe("/workspace");
  expect(window.location.search).toBe(`?draft_session=${SESSION}`);
}

async function send() {
  const composer =
    document.querySelector<HTMLTextAreaElement>(
      "#queued-conversation-composer",
    );
  expect(composer).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(composer, "Synthetic question");
    composer?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush(4);
  const sendButton = document.querySelector<HTMLButtonElement>(
    '[aria-label="发送消息"]',
  );
  expect(sendButton).not.toBeNull();
  await act(async () => sendButton!.click());
  await flush();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  fetcher.mockReset();
  fetcher.mockImplementation(() => Promise.resolve(Response.json({})));
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  mount?.remove();
  mount = null;
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("keeps the skip anchor when the admitted draft gets its canonical Session URL", async () => {
  await renderDraft();
  window.history.replaceState(
    null,
    "",
    `/workspace?draft_session=${SESSION}#main-content`,
  );
  await send();

  expect(window.location.pathname).toBe(`/workspace/sessions/${SESSION}`);
  expect(window.location.hash).toBe("#main-content");
  expect(window.location.search).toBe("");
});

it("replaces the admitted draft with the canonical Session URL without a hash", async () => {
  await renderDraft();
  await send();

  expect(window.location.pathname).toBe(`/workspace/sessions/${SESSION}`);
  expect(window.location.hash).toBe("");
  expect(window.location.search).toBe("");
});

it("never rewrites an unrelated hash on admission", async () => {
  await renderDraft();
  window.history.replaceState(
    null,
    "",
    `/workspace?draft_session=${SESSION}#turn-42`,
  );
  await send();

  expect(window.location.pathname).toBe("/workspace");
  expect(window.location.search).toBe(`?draft_session=${SESSION}`);
  expect(window.location.hash).toBe("#turn-42");
});

it("never rewrites an unrelated query intent on admission", async () => {
  await renderDraft();
  window.history.replaceState(
    null,
    "",
    "/workspace?surface=desk#main-content",
  );
  await send();

  expect(window.location.pathname).toBe("/workspace");
  expect(window.location.search).toBe("?surface=desk");
  expect(window.location.hash).toBe("#main-content");
});

it("never rewrites a mixed query that also carries the matching draft_session", async () => {
  await renderDraft();
  const search = `?draft_session=${SESSION}&surface=desk`;
  window.history.replaceState(
    null,
    "",
    `/workspace${search}#main-content`,
  );
  await send();

  expect(window.location.pathname).toBe("/workspace");
  expect(window.location.search).toBe(search);
  expect(window.location.hash).toBe("#main-content");
});

it("never rewrites a duplicated draft_session key", async () => {
  await renderDraft();
  const search = `?draft_session=${SESSION}&draft_session=${SESSION}`;
  window.history.replaceState(
    null,
    "",
    `/workspace${search}#main-content`,
  );
  await send();

  expect(window.location.pathname).toBe("/workspace");
  expect(window.location.search).toBe(search);
  expect(window.location.hash).toBe("#main-content");
});

it("does not restore an admitted draft locator when bootstrap capability changes", async () => {
  await renderDraft();
  await send();
  expect(conversationHome(SCOPE)).toBeNull();
  await act(async () => root?.render(createElement(QueuedConversation, {
    bootstrap: { sessionId: SESSION, capability: "refreshed-synthetic-capability" },
    chatBinding: "chat-binding", detailBinding: "detail-binding", scope: SCOPE,
  })));
  await flush(4);
  expect(conversationHome(SCOPE)).toBeNull();
  expect(window.location.pathname).toBe(`/workspace/sessions/${SESSION}`);
  expect(window.location.search).toBe("");
});
