// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useConversation } from "./use-conversation";
import { requestWorkspaceRefresh } from "@/lib/workspace-refresh";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import { readConversationDraft } from "@/lib/conversation-local";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("../workspace-session-request", () => ({ workspaceSessionFetch: fetcher }));

const sid = "e904c65d-d51d-486e-8ad6-4ce79cb30fa0";

function turn(id: string, objective: string) {
  return {
    id,
    objective,
    images: [],
    response: { answer: `回复 ${id}`, meetingDraft: null, memoryProposal: null },
  } as never;
}

function detail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    session_id: sid,
    revision: 3,
    updated_at: "2026-09-24T19:51:06.000Z",
    expires_at: "2030-01-01T00:00:00.000Z",
    state: "active",
    title: "跨端同步核对",
    turn_count: 1,
    is_unread: false,
    scope_kind: "unresolved_intent",
    person_id: null,
    relationship_context_id: null,
    person_label: "",
    context_label: "",
    deleted_at: null,
    display_authority: "stale_unconfirmed",
    composer_draft: null,
    composer_draft_updated_at: null,
    turns: [turn("turn-1", "第一条")],
    ...overrides,
  };
}

let chat: ReturnType<typeof useConversation>;
let root: Root;
let mount: HTMLDivElement;

function Probe() {
  const current = useConversation({
    id: sid,
    scope: "owner",
    chatBinding: "chat",
    detailBinding: "detail",
    initial: detail(),
    onAdmitted: () => undefined,
  });
  useLayoutEffect(() => {
    chat = current;
  });
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  fetcher.mockReset();
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => {
    root.render(createElement(Probe));
  });
  await flush();
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
});

function mockDetailReadback(next: SessionDetail) {
  fetcher.mockImplementation(async () =>
    new Response(JSON.stringify({ detail: next }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

it("shows another device's committed message in the open conversation and keeps the unsent draft", async () => {
  await act(async () => {
    chat.changeDraft("Web 未发送草稿：远端更新后必须保留。");
  });
  mockDetailReadback(
    detail({
      revision: 4,
      turns: [turn("turn-1", "第一条"), turn("9faf5af8-9979-4275-9493-215c7f842599", "远端提交的新消息")],
    }),
  );
  await act(async () => {
    requestWorkspaceRefresh("owner", "manual");
    await flush();
  });
  const turnIds = (chat.detail?.turns ?? []).map((entry) => entry.id);
  expect(turnIds).toContain("9faf5af8-9979-4275-9493-215c7f842599");
  expect(chat.draft).toBe("Web 未发送草稿：远端更新后必须保留。");
});

it.each([401, 403, 410])("retains text only for reauthentication, not denied/deleted access (%s)", async status => {
  await act(async () => chat.changeDraft("Bounded synthetic recovery text"));
  fetcher.mockImplementation(async () => Response.json({ code: status === 401 ? "SESSION_EXPIRED" : "SESSION_UNAVAILABLE" }, { status }));
  await act(async () => { await chat.keepDraft(); });
  expect(chat.unavailable).toBe(true);
  expect(chat.detail).toBeNull();
  expect(chat.draft).toBe("");
  expect(readConversationDraft("owner", sid)?.value ?? null).toBe(status === 401 ? "Bounded synthetic recovery text" : null);
});

it("applies a remote tombstone without resurrecting deleted history", async () => {
  mockDetailReadback(
    detail({
      state: "deleted",
      deleted_at: "2026-09-24T20:00:00.000Z",
      turns: [],
    }),
  );
  await act(async () => {
    requestWorkspaceRefresh("owner", "manual");
    await flush();
  });
  expect(chat.unavailable).toBe(true);
  expect(chat.detail?.turns ?? []).toEqual([]);
});

it("never overwrites newer local state from a regressed remote revision", async () => {
  mockDetailReadback(detail({ revision: 2, turns: [] }));
  await act(async () => {
    requestWorkspaceRefresh("owner", "manual");
    await flush();
  });
  expect(chat.detail?.revision).toBe(3);
  expect(chat.detail?.turns ?? []).toHaveLength(1);
});

it("drops a late readback for a different session scope", async () => {
  mockDetailReadback(
    detail({ session_id: "0d4d7a44-1f45-4f6c-9f0e-2f7dc2a6a1b3", revision: 9, turns: [] }),
  );
  await act(async () => {
    requestWorkspaceRefresh("owner", "manual");
    await flush();
  });
  expect(chat.detail?.session_id).toBe(sid);
  expect(chat.detail?.turns ?? []).toHaveLength(1);
});

it("drops a late readback after the surface unmounts", async () => {
  let resolveReadback: ((value: Response) => void) | undefined;
  fetcher.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        resolveReadback = resolve;
      }),
  );
  await act(async () => {
    requestWorkspaceRefresh("owner", "manual");
    await Promise.resolve();
  });
  await act(async () => {
    root.unmount();
  });
  await act(async () => {
    resolveReadback?.(
      new Response(JSON.stringify({ detail: detail({ revision: 99, turns: [] }) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await flush();
  });
  // The unmounted scope publishes nothing and nothing crashes.
  expect(chat.draft).toBe("");
});

it("never lets a refresh overwrite a concurrent remote draft silently", async () => {
  await act(async () => {
    chat.changeDraft("L：本地未发送草稿");
    await flush();
  });
  // The other device writes draft R and commits at revision 4 while the local
  // save is still pending (750ms debounce).
  mockDetailReadback(
    detail({
      revision: 4,
      composer_draft: "R：另一台设备的草稿",
      turns: [turn("turn-1", "第一条")],
    }),
  );
  await act(async () => {
    requestWorkspaceRefresh("owner", "manual");
    await flush();
  });
  // The reader decides: their draft stays and the conflict is visible.
  expect(chat.draft).toBe("L：本地未发送草稿");
  expect(chat.draftConflict).toBe(true);
  // The debounced timer must not PUT over the remote draft.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  const puts = fetcher.mock.calls.filter((call) => call[1]?.method === "PUT");
  expect(puts).toHaveLength(0);
});

it("merges committed turns normally when the remote draft is unchanged", async () => {
  mockDetailReadback(
    detail({
      revision: 4,
      turns: [turn("turn-1", "第一条"), turn("turn-2", "远端提交")],
    }),
  );
  await act(async () => {
    requestWorkspaceRefresh("owner", "manual");
    await flush();
  });
  expect(chat.draftConflict).toBe(false);
  expect((chat.detail?.turns ?? []).map((entry) => entry.id)).toContain("turn-2");
});
