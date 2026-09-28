// @vitest-environment happy-dom
//
// Whole-surface regression: a completed queued screenshot turn that carries a
// GET40 Memory proposal reference must actually render the contact/memory review
// card inside the conversation, not just persist the reference.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryProposalItem, MemoryReviewView } from "@talent-signal/contracts";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../workspace-session-request", () => ({
  WORKSPACE_SESSION_EXPIRED_EVENT: "talent-signal:workspace-session-expired",
  workspaceSessionFetch: fetcher,
  workspaceSessionExpired: () => false,
  relationshipIntegrationFetch: fetcher,
  relationshipIntegrationSessionExpired: () => false,
}));

import { QueuedConversation } from "./queued-conversation";

const SESSION = "33333333-3333-4333-8333-333333333333";
const MESSAGE = "44444444-4444-4444-8444-444444444444";
const PROPOSAL = "55555555-5555-4555-8555-555555555555";
const SCOPE_ID = "66666666-6666-4666-8666-666666666666";

function item(): MemoryProposalItem {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    scope: "relationship",
    subject_kind: "proposal_target",
    relationship_kind: "proposal_target_context",
    operation: "add",
    statement_kind: "source_statement",
    display_text: "周明与用户在南街读书群互称姓名",
    original_display_text: "周明与用户在南街读书群互称姓名",
    speaker: "周明",
    time_status: "unknown",
    sensitivity: "normal",
    admission_status: "eligible",
    judgment_kind: "ordinary",
    default_selected: true,
    reason: "以后跟进这段关系时有用",
    source_excerpt: "周明",
    source_locator: { kind: "image_region", artifact_id: "image-0", image_index: 0 },
    added_revision: 1,
    status: "pending",
  };
}

function review(): MemoryReviewView {
  return {
    contract_version: "2026-08-24.10",
    review_scope_id: SCOPE_ID,
    review_revision: 0,
    purpose: "chat",
    proposal_id: PROPOSAL,
    proposal_revision: 1,
    allowed_scope: "all",
    person_id: null,
    relationship_context_id: null,
    person_display_label: "周明",
    relationship_display_label: "松风9月读书群（南街）",
    contact_decision: "new",
    contact_status: "pending",
    status: "open",
    expires_at: "2026-10-01T00:00:00.000Z",
    visible_item_count: 1,
    visible_default_selected_count: 1,
    source_status: "available",
    source_unavailable_visible_item_count: 0,
    items: [item()],
    draft: null,
  };
}

const initialDetail = {
  session_id: SESSION,
  revision: 1,
  updated_at: "2026-09-22T00:00:00.000Z",
  expires_at: "2026-10-01T00:00:00.000Z",
  state: "expired" as const,
  title: "截图关系梳理",
  turn_count: 1,
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
  turns: [{
    id: MESSAGE,
    objective: "",
    images: [{
      attachment_id: "88888888-8888-4888-8888-888888888888",
      file_name: "synthetic-screenshot.png",
      media_type: "image/png" as const,
      byte_size: 8,
      content_hash: "a".repeat(64),
    }],
    createdAt: "2026-09-22T00:00:00.000Z",
    response: {
      contractVersion: "2026-08-24.10",
      taskID: "99999999-9999-4999-8999-999999999999",
      contextManifestID: "",
      knowledgeSnapshotID: "",
      disposition: "answer",
      createdAt: "2026-09-22T00:00:00.000Z",
      unboundConversationBlocks: [{
        id: "block-1",
        kind: "answer",
        title: "已整理",
        body: "这位是周明，来自松风9月读书群（南街）。",
        status: "informational",
        citation_dependency_ids: [],
        requires_user_decision: false as const,
        allows_static_share: false,
        target_ref: null,
      }],
      memoryProposal: { proposal_id: PROPOSAL, revision: 1 },
    },
  }],
};

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

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher.mockReset();
  fetcher.mockImplementation((url: string) => {
    if (String(url).includes("/conversation-images/")) {
      return Promise.resolve(new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })));
    }
    if (String(url).includes("/reviews")) {
      return Promise.resolve(Response.json({ review_credential: "cred-1234567890", review: review() }));
    }
    return Promise.resolve(Response.json({}));
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  mount?.remove();
  mount = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("queued conversation memory review", () => {
  it("renders the Session through one assistant-ui transcript while retaining the existing composer", async () => {
    await act(async () => root?.render(createElement(QueuedConversation, {
      chatBinding: "chat-binding", detailBinding: "detail-binding", initialDetail,
      scope: "a".repeat(64),
    })));
    await flush();
    expect(document.querySelectorAll("[data-session-runtime]")).toHaveLength(1);
    expect(document.querySelectorAll("#queued-conversation-composer")).toHaveLength(1);
    expect(mount?.textContent).toContain("这位是周明");
    expect(mount?.textContent).toContain("周明");
  });
  it("shows a direct calendar handoff for a completed queue turn",async()=>{
    const detail={...initialDetail,turns:initialDetail.turns.map(turn=>({...turn,response:{...turn.response,meetingDraft:{id:PROPOSAL,title:"Coffee"}}}))};
    await act(async()=>root?.render(createElement(QueuedConversation,{chatBinding:"chat-binding",detailBinding:"detail-binding",initialDetail:detail,scope:"a".repeat(64)})));
    await flush();
    const link=document.querySelector(`a[href='/workspace/meetings?draft=${PROPOSAL}']`);
    expect(link?.textContent).toContain("核对日历草稿");
    expect(link?.closest("details")).toBeNull();
  });
  it("renders the staged contact/memory review card for a completed image-only turn", async () => {
    await act(async () => {
      root?.render(createElement(QueuedConversation, {
        chatBinding: "chat-binding",
        detailBinding: "detail-binding",
        entryCapability: "entry-capability",
        initialDetail,
        scope: "a".repeat(64),
      }));
    });
    await flush();

    // The card is present and is a real review, not just a stored reference.
    expect(document.querySelector("[data-memory-review]")).not.toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).toContain("周明");
    expect(text).toContain("松风9月读书群（南街）");
    // The image-only user message shows no redundant placeholder.
    expect(text).not.toContain("（图片）");
    expect(document.querySelector("[aria-label='消息中的 1 张图片']")).not.toBeNull();
  });
});
