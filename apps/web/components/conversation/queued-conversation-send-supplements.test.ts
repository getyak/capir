// @vitest-environment happy-dom
//
// GET-49 Web/macOS send surface: the sent message stays in place without a
// routine success footnote after durable admit, and later messages remain
// controllable supplements with an explicit prioritize control.
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

import { writeConversationMessage } from "@/lib/conversation-local";
import { QueuedConversation, queueFailureText } from "./queued-conversation";

it("explains a bounded timeout without exposing provider detail", () => {
  expect(queueFailureText("MODEL_RUN_TIMEOUT", true)).toContain("图片分析超时");
  expect(queueFailureText("MODEL_RUN_TIMEOUT", false)).toContain("消息已保留");
  expect(queueFailureText("MODEL_RUN_FAILED", true)).toBe("上次未完成，请重试或移除");
});

const SCOPE = "b".repeat(64);
const SESSION = "11111111-1111-4111-8111-111111111111";
const ACTIVE_ID = "22222222-2222-4222-8222-222222222222";
const QUEUE_ID = "33333333-3333-4333-8333-333333333333";
const LOCAL_ACCEPTED = "44444444-4444-4444-8444-444444444444";
const LOCAL_UNKNOWN = "55555555-5555-4555-8555-555555555555";

const initialDetail = {
  session_id: SESSION,
  revision: 4,
  updated_at: "2026-09-24T00:00:00.000Z",
  expires_at: "2026-10-01T00:00:00.000Z",
  state: "active" as const,
  title: "补充处理",
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

const snapshot = {
  contract_version: "2026-08-24.10",
  session_id: SESSION,
  revision: 4,
  paused: false,
  preview: null,
  active: {
    queue_entry_id: ACTIVE_ID,
    message_id: ACTIVE_ID,
    sequence: 1,
    status: "running",
    objective: "正在处理的原位消息",
    created_at: "2026-09-24T00:00:00.000Z",
    updated_at: "2026-09-24T00:00:00.000Z",
    revision: 2,
    run_id: "66666666-6666-4666-8666-666666666666",
    stage: "answer",
    cancel_requested: false,
    failure_code: null,
  },
  queued: [{
    queue_entry_id: QUEUE_ID,
    message_id: QUEUE_ID,
    sequence: 2,
    status: "queued",
    objective: "可控补充的下一条",
    created_at: "2026-09-24T00:00:01.000Z",
    updated_at: "2026-09-24T00:00:01.000Z",
    revision: 1,
    run_id: null,
    stage: null,
    cancel_requested: false,
    failure_code: null,
  }],
};

let mount: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(times = 8): Promise<void> {
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
          controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
        },
      })));
    }
    if (String(url).endsWith("/conversation-queue")) return Promise.resolve(Response.json(snapshot));
    return Promise.resolve(Response.json({ detail: initialDetail }));
  });
  const expiresAt = Date.now() + 60 * 60 * 1000;
  writeConversationMessage(SCOPE, SESSION, {
    id: LOCAL_ACCEPTED,
    objective: "已接收的原位消息",
    createdAt: "2026-09-24T00:00:02.000Z",
    delivery: "accepted",
    receiptUncertain: false,
    expiresAt,
  });
  writeConversationMessage(SCOPE, SESSION, {
    id: LOCAL_UNKNOWN,
    objective: "送达未知的消息",
    createdAt: "2026-09-24T00:00:03.000Z",
    delivery: "unknown",
    receiptUncertain: true,
    expiresAt,
    error: "送达结果尚未确认，可核对并重试。",
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

it("keeps the accepted message in place without a success footnote and preserves recovery for unknown delivery", async () => {
  await act(async () => {
    root?.render(createElement(QueuedConversation, {
      chatBinding: "chat-binding",
      detailBinding: "detail-binding",
      scope: SCOPE,
      initialDetail,
    }));
  });
  await flush();

  expect(document.body.textContent).toContain("已接收的原位消息");
  expect(document.body.textContent).not.toContain("已送达");
  expect(document.body.textContent).toContain("送达结果尚未确认，可核对并重试。");
  expect(document.body.textContent).toContain("核对并重试");
  // In-place processing status stays on the live turn, not a separate chrome bar.
  expect(document.body.textContent).toContain("正在处理的原位消息");
  expect(document.body.textContent).toContain("正在回复");
});

it("offers prioritize as an explicit control on a waiting supplement and posts the server mutation", async () => {
  await act(async () => {
    root?.render(createElement(QueuedConversation, {
      chatBinding: "chat-binding",
      detailBinding: "detail-binding",
      scope: SCOPE,
      initialDetail,
    }));
  });
  await flush();

  const queue = document.querySelector("[aria-label='可控补充']");
  expect(queue).not.toBeNull();
  expect(queue?.closest('[role="region"]')).not.toBeNull();
  expect(queue?.textContent).not.toContain("可控补充的下一条");
  expect(document.body.textContent!.split("可控补充的下一条").length - 1).toBe(1);
  expect(queue?.textContent).toContain("完成或停止当前回复后处理");

  const prioritize = document.querySelector<HTMLButtonElement>("button[aria-label='优先处理第 1 条待处理消息']");
  expect(prioritize).not.toBeNull();
  const confirm = vi.fn(() => true);
  vi.stubGlobal("confirm", confirm);
  await act(async () => { prioritize?.click(); });
  await flush();
  expect(confirm).toHaveBeenCalled();

  const mutation = fetcher.mock.calls.find(([, init]) =>
    init?.method === "POST" && String(init?.body ?? "").includes('"prioritize"'));
  expect(mutation).toBeDefined();
  expect(JSON.parse(String(mutation![1]!.body))).toMatchObject({
    kind: "prioritize",
    queue_entry_id: QUEUE_ID,
    expected_revision: 4,
  });
});
