// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryProposalItem, MemoryReviewView } from "@talent-signal/contracts";

import { MemoryReviewCard } from "./memory-review-card";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("../workspace-session-request", () => ({
  workspaceSessionFetch: fetcher,
}));

const SCOPE = "11111111-1111-4111-8111-111111111111";
const PROPOSAL = "22222222-2222-4222-8222-222222222222";

function item(id: string, scope: MemoryProposalItem["scope"], text: string): MemoryProposalItem {
  return {
    id,
    scope,
    subject_kind: scope === "self" ? "owner_self" : "resolved_subject",
    relationship_kind: "none",
    operation: "add",
    statement_kind: scope === "self" ? "user_opinion" : "source_statement",
    display_text: text,
    original_display_text: text,
    time_status: "known",
    sensitivity: "normal",
    admission_status: "eligible",
    judgment_kind: "ordinary",
    default_selected: true,
    reason: "以后会用得上",
    source_excerpt: text,
    source_locator: { kind: "message", session_id: null, message_id: null },
    added_revision: 1,
    status: "pending",
  };
}

function review(): MemoryReviewView {
  const items = [
    item("self-1", "self", "用户要求回复先给结论。"),
    item("self-2", "self", "用户这季度在寻找设计合作者，下季度还没决定。"),
    item("person-1", "person", "陈宇说，他目前负责设计系统。"),
    item("person-2", "person", "陈宇说，他计划下个月换到增长团队，现在还没换。"),
    item("rel-1", "relationship", "我答应这周五把原型发给陈宇，目前还没有发送。"),
  ];
  return {
    contract_version: "2026-08-24.10",
    review_scope_id: SCOPE,
    review_revision: 0,
    purpose: "chat",
    proposal_id: PROPOSAL,
    proposal_revision: 1,
    allowed_scope: "all",
    person_id: null,
    relationship_context_id: null,
    person_display_label: "陈宇",
    relationship_display_label: null,
    contact_decision: "new",
    contact_status: "pending",
    status: "open",
    expires_at: "2026-09-23T00:00:00.000Z",
    visible_item_count: items.length,
    visible_default_selected_count: items.length,
    source_status: "available",
    source_unavailable_visible_item_count: 0,
    items,
    draft: null,
  };
}

let root: Root;
let mount: HTMLDivElement;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher.mockReset();
  window.sessionStorage.clear();
  fetcher.mockImplementation(() => Promise.resolve(
    Response.json({ review_credential: "cred-1234567890", review: review() }),
  ));
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => {
    root.render(
      createElement(MemoryReviewCard, {
        binding: "binding-1",
        proposal: { proposal_id: PROPOSAL, revision: 1 },
        purpose: "chat",
      }),
    );
  });
  await flush();
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
});

function clickByText(text: string) {
  const button = Array.from(document.querySelectorAll("button")).find((node) =>
    node.textContent?.includes(text),
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

describe("shared Memory review card", () => {
  it("hides source-derived contact and Memory text when the source is withdrawn", async () => {
    fetcher.mockResolvedValue(Response.json({ review_credential: "cred-revoked", review: {
      ...review(), source_status: "unavailable",
    } }));
    await act(async () => root.render(createElement(MemoryReviewCard, {
      key: "revoked", binding: "binding-1", proposal: { proposal_id: PROPOSAL, revision: 1 }, purpose: "chat",
    })));
    await flush();
    expect(mount.textContent).toContain("来源已失效");
    expect(mount.textContent).not.toContain("陈宇");
    expect(mount.textContent).not.toContain("用户要求回复先给结论");
    expect(mount.textContent).not.toContain("陈宇说，他目前负责设计系统");
    expect([...mount.querySelectorAll("button")].some((button) => button.textContent === "添加联系人")).toBe(false);
  });
  it("keeps exact text and a single screenshot accessible on a contact-only card", async () => {
    const sessionId = "33333333-3333-4333-8333-333333333333";
    const messageId = "44444444-4444-4444-8444-444444444444";
    const attachmentId = "55555555-5555-4555-8555-555555555555";
    fetcher.mockResolvedValue(Response.json({ review_credential: "cred-contact-only", review: {
      ...review(), source_session_id: sessionId, source_message_id: messageId,
      items: [], visible_item_count: 0, visible_default_selected_count: 0,
    } }));
    await act(async () => root.render(createElement(MemoryReviewCard, {
      key: "contact-only", binding: "binding-1", entryCapability: "entry-capability",
      proposal: { proposal_id: PROPOSAL, revision: 1 }, purpose: "chat",
      sessionId, sourceMessageId: messageId, sourceText: "陈宇负责设计系统。我偏好先看试点结果。",
      sourceImages: [{ attachment_id: attachmentId, file_name: "source.png", media_type: "image/png",
        byte_size: 8, content_hash: "a".repeat(64) }],
    })));
    await flush();
    const card = document.querySelector('[data-contact-decision-card]')!;
    expect(card.textContent).toContain("陈宇负责设计系统");
    expect([...card.querySelectorAll("button")].some((button) => button.textContent === "查看原图")).toBe(true);
  });
  it("keeps a verified item receipt visible after the proposal closes and the Session reloads", async () => {
    window.sessionStorage.setItem(`get40:memory-locator:binding-1:${PROPOSAL}:chat`, JSON.stringify({
      version: 1, binding: "binding-1", proposal_id: PROPOSAL, purpose: "chat",
      person_id: null, relationship_context_id: null, operation_key: null,
      item_operation_keys: { "self-1": "op-closed" }, undo_key: null,
    }));
    fetcher.mockImplementation((path: string) => String(path).includes("/operation-views/op-closed")
      ? Promise.resolve(Response.json({ state: "applied", visible_receipt: {
          operation_key: "op-closed", decisions: [{ proposal_item_id: "self-1", decision: "accept" }],
        }, item_snapshot: { ...item("self-1", "self", "用户要求回复先给结论。"), status: "committed" },
        undo: { allowed: true, limits: [] } }))
      : Promise.resolve(Response.json({ code: "MEMORY_REVIEW_PROCESSED" }, { status: 409 })));
    await act(async () => root.render(createElement(MemoryReviewCard, {
      key: "processed", binding: "binding-1", proposal: { proposal_id: PROPOSAL, revision: 1 }, purpose: "chat",
    })));
    await flush();
    const saved = document.querySelector('[data-memory-item-card="self-1"]');
    expect(saved?.textContent).toContain("已记住");
    expect([...saved!.querySelectorAll("button")].some((button) => button.textContent === "记住")).toBe(false);
  });

  it("saves one self item and leaves the next card actionable in place", async () => {
    const latest = { ...review(), items: review().items.map((entry) => entry.id === "self-1"
      ? { ...entry, status: "committed" } : entry) };
    fetcher.mockImplementation((path: string) => String(path).endsWith("/item-decisions")
      ? Promise.resolve(Response.json({ kind: "committed", item_id: "self-1", replayed: false,
          receipt: { operation_key: "op-one", decisions: [{ proposal_item_id: "self-1", decision: "accept" }] },
          proposal_revision: 1, remaining_pending_item_count: 4 }))
      : Promise.resolve(Response.json({ review_credential: "cred-next", review: latest })));
    const first = document.querySelector<HTMLElement>('[data-memory-item-card="self-1"]')!;
    const save = [...first.querySelectorAll("button")].find((button) => button.textContent === "记住")!;
    await act(async () => save.click());
    await flush();
    expect(first.textContent).toContain("已记住");
    expect([...first.querySelectorAll("button")].some((button) => button.textContent === "撤销")).toBe(true);
    expect(document.querySelector('[data-memory-item-card="self-2"] button')?.textContent).toContain("记住");
    const call = fetcher.mock.calls.find(([path]) => String(path).endsWith("/item-decisions")) as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body.item_id).toBe("self-1");
    expect(body).not.toHaveProperty("selected_item_ids");
  });

  it("shows three direct Session cards with source and no selection checklist", () => {
    expect(document.querySelectorAll("[data-memory-item-card]")).toHaveLength(3);
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(document.body.textContent).toContain("用户要求回复先给结论。");
    expect(clickByText("记住")).toBeTruthy();
    expect(clickByText("更多建议")).toBeTruthy();
  });
  it("adds the contact in its card and leaves Memory decisions separate", async () => {
    const fresh = { ...review(), contact_decision: "existing" as const, contact_status: "resolved" as const,
      person_id: "33333333-3333-4333-8333-333333333333", proposal_revision: 2 };
    fetcher.mockImplementation((path: string) => String(path).endsWith("/contact-decisions")
      ? Promise.resolve(Response.json({ replayed: false,
          receipt: { operation_key: "op-contact", created_person_id: fresh.person_id, person_display_label: "陈宇", applied_item_count: 0 },
          remaining_pending_item_count: 5, proposal_revision: 2 }))
      : Promise.resolve(Response.json({ review_credential: "cred-next", review: fresh })));
    await act(async () => clickByText("添加联系人").click());
    await flush();
    const contact = document.querySelector("[data-contact-decision-card]")!;
    expect(contact.textContent).toContain("已添加联系人");
    expect(document.querySelector('[data-memory-item-card="self-1"] button')?.textContent).toContain("记住");
    const call = fetcher.mock.calls.find(([path]) => String(path).endsWith("/contact-decisions")) as [string, RequestInit];
    expect(JSON.parse(call[1].body as string)).not.toHaveProperty("selected_item_ids");
  });

  it("keeps a contact-only proposal visible without an empty Memory counter",async()=>{
    const contact={...review(),items:[],visible_item_count:0,visible_default_selected_count:0};
    fetcher.mockImplementation(() => Promise.resolve(Response.json({review_credential:"cred-1234567890",review:contact})));
    await act(async()=>root.render(createElement(MemoryReviewCard,{key:"contact-only",binding:"binding-1",proposal:{proposal_id:PROPOSAL,revision:1},purpose:"chat"})));await flush();
    expect(document.querySelector("[data-contact-decision-card]")).not.toBeNull();
    expect(clickByText("添加联系人")).toBeTruthy();
    expect(document.body.textContent).not.toContain("已选 0 条");
  });
  it("keeps a business entry fixed to its person and shows old to new in the folded preview",async()=>{
    const scoped=review();scoped.purpose="relationship";scoped.allowed_scope="relationship";scoped.contact_decision="existing";scoped.contact_status="resolved";
    scoped.items=[{...item("change","relationship","原型已发出。"),operation:"update",previous_text:"原型计划周五发出。"}];
    fetcher.mockImplementation(() => Promise.resolve(Response.json({review_credential:"cred-1234567890",review:scoped})));
    await act(async()=>root.render(createElement(MemoryReviewCard,{key:"scoped",binding:"binding-1",proposal:{proposal_id:PROPOSAL,revision:1},purpose:"relationship"})));await flush();
    expect(document.body.textContent).toContain("原型计划周五发出。 → 原型已发出。");
    expect(document.body.textContent).not.toContain("换个人");expect(document.body.textContent).not.toContain("本次不关联此人");
  });
  it("shows direct source-backed decisions without checkboxes", () => {
    const text = document.body.textContent ?? "";
    expect(text).toContain("关于陈宇");
    expect(text).toContain("关于我");
    expect(text).toContain("更多建议 · 2");
    expect(document.querySelectorAll("[data-memory-item-card]")).toHaveLength(3);
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it("reveals remaining cards without writing a decision or draft", async () => {
    const before = fetcher.mock.calls.length;
    await act(async () => { clickByText("更多建议").click(); });
    expect(document.querySelectorAll("[data-memory-item-card]")).toHaveLength(5);
    expect(document.body.textContent).toContain("我答应这周五把原型发给陈宇");
    expect(fetcher.mock.calls).toHaveLength(before);
  });

  it("retains an inline edit when the parent rerenders the same proposal", async () => {
    const reviewsBefore = fetcher.mock.calls.filter(([path]) => String(path).includes("/reviews")).length;
    await act(async () => { clickByText("改一下").click(); });
    const editor = document.querySelector<HTMLTextAreaElement>("[data-memory-item-card] textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(editor,"我希望先看结论和依据。");
      editor.dispatchEvent(new Event("input",{bubbles:true}));
    });
    await act(async () => root.render(createElement(MemoryReviewCard,{
      binding:"binding-1",proposal:{proposal_id:PROPOSAL,revision:1},purpose:"chat",
    })));
    await flush();
    expect(document.querySelector<HTMLTextAreaElement>("[data-memory-item-card] textarea")?.value).toBe("我希望先看结论和依据。");
    expect(fetcher.mock.calls.filter(([path]) => String(path).includes("/reviews"))).toHaveLength(reviewsBefore);
  });

  it("does not hide a selectable item behind a checkbox", () => {
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(document.body.textContent).not.toContain("我答应这周五把原型发给陈宇，目前还没有发送。");
  });
});
