// @vitest-environment happy-dom
//
// GET-128 run control: Escape pauses the queue while a run is live, IME
// composition always owns Enter and Escape, and the composer stays usable
// during a run so supplements can be queued.
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

const SCOPE = "c".repeat(64);
const SESSION = "11111111-1111-4111-8111-111111111111";
const ACTIVE_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "66666666-6666-4666-8666-666666666666";

const initialDetail = {
  session_id: SESSION,
  revision: 4,
  updated_at: "2026-09-24T00:00:00.000Z",
  expires_at: "2026-10-01T00:00:00.000Z",
  state: "active" as const,
  title: "执行控制",
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

const active = {
  queue_entry_id: ACTIVE_ID,
  message_id: ACTIVE_ID,
  sequence: 1,
  status: "running",
  objective: "正在运行的消息",
  created_at: "2026-09-24T00:00:00.000Z",
  updated_at: "2026-09-24T00:00:01.000Z",
  revision: 2,
  run_id: RUN_ID,
  stage: "contact_read",
  cancel_requested: false,
  failure_code: null,
};

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: "2026-08-24.10",
    session_id: SESSION,
    revision: 4,
    paused: false,
    preview: null,
    active,
    queued: [],
    ...overrides,
  };
}

let mount: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(times = 6): Promise<void> {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  router.push.mockReset();
  fetcher.mockReset();
  fetcher.mockImplementation((url: string) => {
    if (String(url).endsWith("/stream")) {
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`));
        },
      })));
    }
    if (String(url).endsWith("/conversation-queue/mutations")) {
      return Promise.resolve(Response.json({
        snapshot: snapshot({ active: { ...active, cancel_requested: true } }),
        applied: { kind: "stop", queue_entry_id: null, run_id: RUN_ID, status: "running" },
      }));
    }
    if (String(url).endsWith("/conversation-queue")) return Promise.resolve(Response.json(snapshot()));
    return Promise.resolve(Response.json({ detail: initialDetail }));
  });
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
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

async function renderConversation() {
  await act(async () => {
    root?.render(createElement(QueuedConversation, {
      chatBinding: "chat-binding",
      detailBinding: "detail-binding",
      scope: SCOPE,
      initialDetail,
    }));
  });
  await flush();
}

function stopMutations() {
  return fetcher.mock.calls.filter(([, init]) =>
    init?.method === "POST" && String(init?.body ?? "").includes('"stop"'));
}

it("pauses the queue on Escape and keeps the composer usable while the run is live", async () => {
  await renderConversation();
  const composer = document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer");
  expect(composer).not.toBeNull();
  // Input stays usable during the run so supplements can be queued.
  expect(composer?.disabled).toBe(false);

  await act(async () => {
    composer?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await flush();
  const stops = stopMutations();
  expect(stops).toHaveLength(1);
  expect(JSON.parse(String(stops[0]![1]!.body))).toMatchObject({ kind: "stop", run_id: RUN_ID });
});

it("lets IME composition own Escape and never pauses the run mid-composition", async () => {
  await renderConversation();
  const composer = document.querySelector<HTMLTextAreaElement>("#queued-conversation-composer");
  await act(async () => {
    composer?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }));
    composer?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true, keyCode: 229 } as KeyboardEventInit));
    composer?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await flush();
  expect(stopMutations()).toHaveLength(0);
});
