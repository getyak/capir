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
  it("offers a contact-only save without an empty Memory counter",async()=>{
    const contact={...review(),items:[],visible_item_count:0,visible_default_selected_count:0};
    fetcher.mockImplementation(() => Promise.resolve(Response.json({review_credential:"cred-1234567890",review:contact})));
    await act(async()=>root.render(createElement(MemoryReviewCard,{key:"contact-only",binding:"binding-1",proposal:{proposal_id:PROPOSAL,revision:1},purpose:"chat"})));await flush();
    expect(document.body.textContent).toContain("仅添加陈宇");
    expect(document.body.textContent).not.toContain("已选 0 条");
    expect(document.body.textContent).toContain("先保存姓名");
  });
  it("keeps a business entry fixed to its person and shows old to new in the folded preview",async()=>{
    const scoped=review();scoped.purpose="relationship";scoped.allowed_scope="relationship";scoped.contact_decision="existing";scoped.contact_status="resolved";
    scoped.items=[{...item("change","relationship","原型已发出。"),operation:"update",previous_text:"原型计划周五发出。"}];
    fetcher.mockImplementation(() => Promise.resolve(Response.json({review_credential:"cred-1234567890",review:scoped})));
    await act(async()=>root.render(createElement(MemoryReviewCard,{key:"scoped",binding:"binding-1",proposal:{proposal_id:PROPOSAL,revision:1},purpose:"relationship"})));await flush();
    expect(document.body.textContent).toContain("原型计划周五发出。 → 原型已发出。");
    expect(document.body.textContent).not.toContain("换个人");expect(document.body.textContent).not.toContain("本次不关联此人");
  });
  it("shows the pending new-contact header, real group labels and a calm folded overview", () => {
    const text = document.body.textContent ?? "";
    expect(text).toContain("陈宇");
    expect(text).toContain("本次对话 · 待添加");
    expect(text).toContain("关联已有联系人");
    expect(text).toContain("暂不添加联系人");
    expect(text).toContain("关于我");
    expect(text).toContain("关于陈宇");
    expect(text).toContain("我们之间");
    // Folded overview: exactly one checkbox per group, no per-item checkboxes
    // and no remaining link before expansion.
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    expect(text).not.toContain("查看其余");
    // Meaningful full-sentence preview is present as the disclosure target.
    expect(text).toContain("用户要求回复先给结论。");
  });

  it("expands a group inline to at most four item choices with a remaining link", async () => {
    const before = fetcher.mock.calls.length;
    await act(async () => {
      clickByText("陈宇说，他目前负责设计系统。").click();
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("陈宇说，他计划下个月换到增长团队，现在还没换。");
    // three group checkboxes plus the two inline person item checkboxes
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(5);
    // Visual disclosure must not trigger a draft write.
    const draftCalls = fetcher.mock.calls
      .slice(before)
      .filter(([path]) => typeof path === "string" && path.includes("/draft"));
    expect(draftCalls).toHaveLength(0);
  });

  it("does not reopen or reset an unsaved uncheck when the parent rerenders a new proposal object", async () => {
    const reviewsBefore = fetcher.mock.calls.filter(([path]) =>
      String(path).includes("/reviews"),
    ).length;
    // Expand the person group and uncheck one item without saving.
    await act(async () => {
      clickByText("陈宇说，他目前负责设计系统。").click();
    });
    const checkbox = document.querySelector<HTMLInputElement>(
      'input[aria-label^="选择：陈宇说，他目前负责设计系统"]',
    );
    expect(checkbox).toBeTruthy();
    await act(async () => {
      checkbox!.click();
    });
    expect(checkbox!.checked).toBe(false);
    // Re-render with a brand-new proposal object carrying the same id/revision.
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
    const reviewsAfter = fetcher.mock.calls.filter(([path]) =>
      String(path).includes("/reviews"),
    ).length;
    expect(reviewsAfter).toBe(reviewsBefore);
    const after = document.querySelector<HTMLInputElement>(
      'input[aria-label^="选择：陈宇说，他目前负责设计系统"]',
    );
    expect(after?.checked).toBe(false);
  });

  it("keeps a not-yet-expanded group free of individual checkbox targets", () => {
    // Relationship group is folded, so its sentence is not an ItemRow checkbox.
    const relationshipInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).filter((input) => input.getAttribute("aria-label")?.includes("我答应这周五"));
    expect(relationshipInputs).toHaveLength(0);
    const preview = Array.from(document.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("我答应这周五把原型发给陈宇，目前还没有发送。"),
    );
    expect(preview).toBeTruthy();
  });
});
