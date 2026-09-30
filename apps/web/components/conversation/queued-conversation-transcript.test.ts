// @vitest-environment happy-dom
//
// GET-128/129 transcript composition: centered per-send time, trailing user
// bubble content, leading Agent identity, ephemeral milestone updates and the
// in-place collapsible execution record, with the final result standalone.
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

import type { SessionDetail } from "../session-workbench/session-detail-state";
import { QueuedConversation } from "./queued-conversation";

const SCOPE = "d".repeat(64);
const SESSION = "11111111-1111-4111-8111-111111111111";
const TURN_ID = "22222222-2222-4222-8222-222222222222";
const ACTIVE_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "66666666-6666-4666-8666-666666666666";

const initialDetail = ({
  session_id: SESSION,
  revision: 4,
  updated_at: "2026-09-24T00:00:10.000Z",
  expires_at: "2026-10-01T00:00:00.000Z",
  state: "active" as const,
  title: "试点合作 · 下一步",
  turn_count: 1,
  is_unread: false,
  scope_kind: "unresolved_intent" as const,
  person_id: null,
  relationship_context_id: null,
  person_label: "林晓",
  context_label: "试点范围",
  deleted_at: null,
  display_authority: "stale_unconfirmed" as const,
  composer_draft: null,
  composer_draft_updated_at: null,
  turns: [{
    id: TURN_ID,
    objective: "帮我整理林晓和周予的合作进展。",
    createdAt: "2026-09-24T00:00:00.000Z",
    response: {
      contractVersion: "2026-08-24.10",
      taskID: "77777777-7777-4777-8777-777777777777",
      contextManifestID: "",
      knowledgeSnapshotID: "",
      disposition: "answer",
      createdAt: "2026-09-24T00:00:08.000Z",
      unboundConversationBlocks: [{
        id: "block-1", kind: "answer", title: "建议下一次先确认试点范围。",
        body: "林晓愿意讨论小范围试点。", status: "informational",
        citation_dependency_ids: [], requires_user_decision: false, allows_static_share: false, target_ref: null,
      }],
      meetingDraft: { id: "88888888-8888-4888-8888-888888888888", title: "确认试点范围" },
    },
  }],
} as unknown) as SessionDetail;

const snapshot = {
  contract_version: "2026-08-24.10",
  session_id: SESSION,
  revision: 5,
  paused: false,
  preview: { run_id: RUN_ID, message_id: ACTIVE_ID, revision: 3, stage: "contact_lookup", text: "我先核对两人的沟通记录。再看下一步该确认什么。" },
  active: {
    queue_entry_id: ACTIVE_ID,
    message_id: ACTIVE_ID,
    sequence: 2,
    status: "running",
    objective: "下一次沟通，最值得确认什么？",
    created_at: "2026-09-24T00:00:11.000Z",
    updated_at: "2026-09-24T00:00:12.000Z",
    revision: 2,
    run_id: RUN_ID,
    stage: "contact_lookup",
    cancel_requested: false,
    failure_code: null,
  },
  queued: [],
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

it("composes the transcript: send time, user objective, milestone updates, execution record and standalone result", async () => {
  await act(async () => {
    root?.render(createElement(QueuedConversation, {
      chatBinding: "chat-binding",
      detailBinding: "detail-binding",
      scope: SCOPE,
      initialDetail,
    }));
  });
  await flush();
  const text = document.body.textContent ?? "";
  // Centered per-send timestamps are rendered from real message time.
  expect(text.match(/\d+月\d+日 \d{2}:\d{2}/gu)?.length).toBe(2);
  // User objective and the trailing bubble carry the message content.
  expect(text).toContain("帮我整理林晓和周予的合作进展。");
  // Milestone-only dialogue updates are separate from the semantic result.
  expect(document.querySelectorAll("[data-run-update]").length).toBeGreaterThan(0);
  expect(text).toContain("我先核对两人的沟通记录。");
  // The in-place execution record reports observed state and elapsed time.
  const phases = [...document.querySelectorAll("[data-phase]")].map((node) => node.getAttribute("data-phase"));
  expect(phases).toContain("running");
  expect(phases).toContain("completed"); // Pending status requires the governed card readback, not a reference.
  const running = document.querySelector('[data-phase="running"]');
  expect(running?.querySelector("[data-elapsed-ms]")).not.toBeNull();
  expect(text).not.toContain("%");
  // The final result is standalone and its pending decision is a distinct block.
  expect(text).toContain("建议下一次先确认试点范围。");
  expect(text).toContain("林晓愿意讨论小范围试点。");
  // The pending calendar decision renders as its own block beside the result.
  expect(text).toContain("会议草稿");
  // Leading Agent identity is the reused brand mark with an accessible name.
  const identity = document.querySelector('[role="img"][aria-label="Talent Signal"]');
  expect(identity).not.toBeNull();
  // The session title floats as the single centered heading.
  expect(document.querySelector("h1")?.textContent).toBe("试点合作 · 下一步");
  // Historical readback carries the collapsed execution record for its turn.
  expect(text).toContain("执行完成");
  expect(text).not.toContain("待你确认");
});

it("clears waiting-review on this execution card after canonical calendar dismissal", async () => {
  const draftId = "88888888-8888-4888-8888-888888888888";
  const record = { id: draftId, external_effect: "none", revision: 2, source_task_id: "77777777-7777-4777-8777-777777777777", origin_session_id: SESSION, created_at: "2026-09-24T00:00:00Z", updated_at: "2026-09-24T00:00:00Z", expires_at: "2026-10-12T00:00:00Z", content_available: true, status: "needs_review", dismissed_at: null, redacted_at: null, title: "Synthetic follow-up", starts_at: "2026-10-06T06:00:00Z", ends_at: "2026-10-06T06:30:00Z", time_zone: "Asia/Shanghai", source_excerpt: "Synthetic authorized source", reference_time: "2026-09-24T00:00:00Z" };
  fetcher.mockImplementation((url: string) => {
    if (String(url).includes(`/meeting-drafts/${draftId}`)) return Promise.resolve(Response.json({ session_version: "detail-binding", draft: String(url).endsWith("/dismiss") ? { ...record, status: "dismissed", revision: 3, dismissed_at: "2026-10-01T01:00:00Z" } : record }));
    if (String(url).endsWith("/stream")) return Promise.resolve(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)); } })));
    if (String(url).endsWith("/conversation-queue")) return Promise.resolve(Response.json(snapshot));
    return Promise.resolve(Response.json({ detail: initialDetail }));
  });
  await act(async () => root?.render(createElement(QueuedConversation, { chatBinding: "chat-binding", detailBinding: "detail-binding", scope: SCOPE, initialDetail })));
  await flush();
  expect(document.querySelector('[data-phase="waiting-review"]')).not.toBeNull();
  const dismiss = [...document.querySelectorAll("button")].find(button => button.textContent?.includes("暂不安排"));
  expect(dismiss).toBeDefined();
  await act(async () => dismiss!.click());
  await flush();
  expect(document.body.textContent).toContain("本次不安排");
  expect(document.querySelector('[data-phase="waiting-review"]')).toBeNull();
  expect(document.querySelector('[data-phase="completed"]')).not.toBeNull();
});
