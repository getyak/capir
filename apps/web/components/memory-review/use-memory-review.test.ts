// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryProposalItem, MemoryReceipt, MemoryReviewView, MemoryScopedOperationView } from "@talent-signal/contracts";

import {
  createDraftState,
  expandGroup,
  toggleItem,
  visibleItems,
} from "@/lib/memory-review-draft";
import { useMemoryReview, type MemoryReviewController } from "./use-memory-review";
import { SessionMemoryCards } from "./memory-item-card";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("../workspace-session-request", () => ({
  workspaceSessionFetch: fetcher,
}));

const SCOPE = "11111111-1111-4111-8111-111111111111";
const PROPOSAL = "22222222-2222-4222-8222-222222222222";
const OPERATION = "66666666-6666-4666-8666-666666666666";
const PERSON = "33333333-3333-4333-8333-333333333333";
const SOURCE_SESSION = "77777777-7777-4777-8777-777777777777";

// The actual scoped-operation producer returns a complete canonical receipt,
// including when no Memory item was written by a contact-only decision.
function scopedContactView(overrides: Partial<MemoryScopedOperationView> = {}): MemoryScopedOperationView {
  const receipt: MemoryReceipt = {
    contract_version: "2026-08-24.10", commit_id: SCOPE, operation_key: OPERATION,
    proposal_id: PROPOSAL, proposal_revision: 1, status: "applied", contact_decision: "new",
    created_person_id: PERSON, person_display_label: "林海（测试）", created_relationship_context_id: null,
    undo_contact_outcome: null, undo_context_outcome: null,
    item_count: 0, applied_item_count: 0, created_item_ids: [], updated_item_ids: [],
    skipped_item_ids: [], kept_old_item_ids: [], decisions: [],
    undo: { token: "88888888-8888-4888-8888-888888888888", allowed: true, limits: [] },
    projection_status: "pending", created_at: "2026-10-28T16:34:16.387Z", undone_at: null,
  };
  return {
    contract_version: "2026-08-24.10", operation_key: OPERATION, commit_id: SCOPE, commit_revision: 1,
    state: "applied", purpose: "chat", person_id: null, relationship_context_id: null,
    source_session_id: SOURCE_SESSION, visible_effect_count: 0, visible_receipt: receipt,
    undo: { allowed: true, limits: [] }, ...overrides,
  };
}

function item(id: string, scope: MemoryProposalItem["scope"]): MemoryProposalItem {
  const text = `记忆 ${id}`;
  return {
    id,
    scope,
    subject_kind: scope === "self" ? "owner_self" : "resolved_subject",
    relationship_kind: "none",
    operation: "add",
    statement_kind: "fact",
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
    item("self-1", "self"),
    item("self-2", "self"),
    item("person-1", "person"),
    item("person-2", "person"),
    item("rel-1", "relationship"),
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

let controller: MemoryReviewController;
let root: Root;
let mount: HTMLDivElement;

function Probe({ capability = "test-capability", binding = "binding-1", sessionId, showCards = false }: { capability?: string; binding?: string; sessionId?: string; showCards?: boolean }) {
  const current = useMemoryReview({
    binding,
    proposal: { proposal_id: PROPOSAL, revision: 1 },
    purpose: "chat",
    entryCapability: capability,
    sessionId,
  });
  useLayoutEffect(() => {
    controller = current;
  });
  return showCards ? createElement(SessionMemoryCards, { controller: current, sourceSessionId: sessionId }) : null;
}

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
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => {
    root.render(createElement(Probe, {}));
  });
  await flush();
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("shared Memory review controller", () => {
  it("restores a processed contact from a fresh entry and keeps its source-return link", async () => {
    expect(window.sessionStorage.length).toBe(0);
    await act(async () => root.render(createElement(Probe, { sessionId: SOURCE_SESSION, showCards: true })));
    const view = scopedContactView();
    fetcher.mockResolvedValueOnce(Response.json({ error: { code: "MEMORY_REVIEW_PROCESSED", details: { operation_key: OPERATION } } }, { status: 409 }));
    fetcher.mockResolvedValueOnce(Response.json(view));
    await act(async () => { await controller.open(); });
    expect(controller.review).toBeNull();
    expect(controller.phase).toBe("receipt");
    expect(controller.receipt).toEqual(view.visible_receipt);
    expect(controller.contactOutcome).toEqual({ kind: "committed", receipt: view.visible_receipt, operationKey: OPERATION });
    expect(mount.querySelector(`a[href="/workspace/people/${PERSON}?session=${SOURCE_SESSION}"]`)?.textContent).toBe("查看人物");
    expect(mount.textContent).not.toContain("这次内容已处理。");
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      `/api/memory/proposals/${PROPOSAL}/reviews`, `/api/memory/operation-views/${OPERATION}?purpose=chat`,
    ]);
    const stored = window.sessionStorage.getItem(`get40:memory-locator:binding-1:${PROPOSAL}:chat`)!;
    expect(stored).toContain(OPERATION);
    expect(stored).not.toContain(PERSON);
    expect(stored).not.toContain("林海");
    expect(stored).not.toContain(view.visible_receipt!.undo.token);
  });

  it.each([
    ["preflight", "无法核对联系人保存结果，本次尚未撤销。"],
    ["blocked", "联系人已有后续记录，不能从这里撤销。"],
    ["rejected", "保存后的内容已变化，本次未撤销。请先查看最新记录。"],
    ["lost-response", "正在核对联系人撤销结果…"],
  ] as const)("shows actual recovered-contact undo feedback after %s", async (failure, message) => {
    await act(async () => root.render(createElement(Probe, { sessionId: SOURCE_SESSION, showCards: true })));
    fetcher.mockResolvedValueOnce(Response.json({ code: "MEMORY_REVIEW_PROCESSED", details: { operation_key: OPERATION } }, { status: 409 }));
    fetcher.mockResolvedValueOnce(Response.json(scopedContactView()));
    await act(async () => { await controller.open(); });
    if (failure === "preflight") fetcher.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    else if (failure === "blocked") {
      const blocked = scopedContactView({ undo: { allowed: false, limits: ["Subsequent records retain the contact."] } });
      blocked.visible_receipt!.undo = { ...blocked.visible_receipt!.undo, allowed: false };
      fetcher.mockResolvedValueOnce(Response.json(blocked));
    }
    else {
      fetcher.mockResolvedValueOnce(Response.json(scopedContactView()));
      if (failure === "rejected") fetcher.mockResolvedValueOnce(Response.json({ code: "MEMORY_UNDO_BLOCKED" }, { status: 409 }));
      else fetcher.mockRejectedValueOnce(new Error("lost undo response"));
    }
    const undo = [...mount.querySelectorAll("button")].find(button => button.textContent === "撤销")!;
    await act(async () => { undo.click(); });
    expect(controller.contactOutcome?.kind).toBe(failure === "lost-response" ? "undo_unknown" : "committed");
    const feedback = [...mount.querySelectorAll(failure === "lost-response" ? '[role="status"]' : '[role="alert"]')]
      .find(element => element.textContent === message);
    expect(feedback).toBeTruthy();
    expect(mount.textContent).not.toContain("已撤销本次添加");
    expect(mount.textContent).not.toContain("已撤销这次添加");
    const writes = fetcher.mock.calls.filter(([path]) => String(path).endsWith("/undo"));
    expect(writes).toHaveLength(failure === "preflight" || failure === "blocked" ? 0 : 1);
  });

  it.each(["retained", "reclaimed"] as const)("recovers an undone contact as %s without restoring a reclaimed destination", async undoOutcome => {
    await act(async () => root.render(createElement(Probe, { sessionId: SOURCE_SESSION, showCards: true })));
    const view = scopedContactView({ state: "undone", undo: { allowed: false, limits: [] } });
    view.visible_receipt = { ...view.visible_receipt!, status: "undone", undo_contact_outcome: undoOutcome,
      undo: { ...view.visible_receipt!.undo, allowed: false }, undone_at: "2026-10-28T17:00:00Z" };
    fetcher.mockResolvedValueOnce(Response.json({ code: "MEMORY_REVIEW_PROCESSED", details: { operation_key: OPERATION } }, { status: 409 }));
    fetcher.mockResolvedValueOnce(Response.json(view));
    await act(async () => { await controller.open(); });
    expect(controller.phase).toBe("undone");
    expect(controller.contactOutcome?.kind).toBe("undone");
    expect(controller.canUndo).toBe(false);
    expect(Boolean(mount.querySelector(`a[href="/workspace/people/${PERSON}?session=${SOURCE_SESSION}"]`))).toBe(undoOutcome === "retained");
    expect(mount.textContent).toContain(undoOutcome === "retained" ? "联系人因后续记录保留" : "已撤销本次添加");
  });

  it("keeps a recovered contact undo unknown across reload until canonical compensation readback", async () => {
    window.sessionStorage.setItem(`get40:memory-locator:binding-1:${PROPOSAL}:chat`, JSON.stringify({
      version: 1, binding: "binding-1", proposal_id: PROPOSAL, purpose: "chat",
      person_id: null, relationship_context_id: null, operation_key: OPERATION,
      undo_key: null, contact_undo_key: "99999999-9999-4999-8999-999999999999",
    }));
    await act(async () => root.render(createElement(Probe, { sessionId: SOURCE_SESSION, showCards: true })));
    fetcher.mockResolvedValueOnce(Response.json(scopedContactView()));
    await act(async () => { await controller.open(); });
    expect(controller.phase).toBe("unknown");
    expect(controller.contactOutcome?.kind).toBe("undo_unknown");
    expect(mount.querySelector("a")).toBeNull();
    expect(mount.textContent).toContain("撤销结果待核对");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(["operation", "receipt-operation", "proposal", "purpose", "person", "context", "session", "status"])("refuses a recovered result with a mismatched %s", async mismatch => {
    await act(async () => root.render(createElement(Probe, { sessionId: SOURCE_SESSION, showCards: true })));
    const view = scopedContactView();
    const other = "99999999-9999-4999-8999-999999999999";
    if (mismatch === "operation") view.operation_key = other;
    if (mismatch === "receipt-operation") view.visible_receipt!.operation_key = other;
    if (mismatch === "proposal") view.visible_receipt!.proposal_id = other;
    if (mismatch === "purpose") view.purpose = "people";
    if (mismatch === "person") view.person_id = other;
    if (mismatch === "context") view.relationship_context_id = other;
    if (mismatch === "session") view.source_session_id = other;
    if (mismatch === "status") view.visible_receipt!.status = "undone";
    fetcher.mockResolvedValueOnce(Response.json({ code: "MEMORY_REVIEW_PROCESSED", details: { operation_key: OPERATION } }, { status: 409 }));
    fetcher.mockResolvedValueOnce(Response.json(view));
    await act(async () => { await controller.open(); });
    expect(controller.phase).toBe("unknown");
    expect(controller.receipt).toBeNull();
    expect(controller.contactOutcome).toBeNull();
    expect(mount.querySelector("a")).toBeNull();
    expect(controller.canUndo).toBe(false);
  });

  it.each(["pending", "unavailable", "scope_mismatch", "source_revoked", "applied"] as const)("does not turn a %s readback without a receipt into contact success", async state => {
    const view = scopedContactView({ state, visible_receipt: null, undo: { allowed: false, limits: [] } });
    fetcher.mockResolvedValueOnce(Response.json({ code: "MEMORY_REVIEW_PROCESSED", details: { operation_key: OPERATION } }, { status: 409 }));
    fetcher.mockResolvedValueOnce(Response.json(view));
    await act(async () => { await controller.open(); });
    expect(controller.phase).toBe(state === "source_revoked" ? "error" : "unknown");
    expect(controller.receipt).toBeNull();
    expect(controller.contactOutcome).toBeNull();
  });

  it("rejects a malformed scoped result rather than manufacturing its missing receipt fields", async () => {
    const view = scopedContactView();
    const receiptWithoutUndo = { ...view.visible_receipt!, undo: undefined };
    fetcher.mockResolvedValueOnce(Response.json({ code: "MEMORY_REVIEW_PROCESSED", details: { operation_key: OPERATION } }, { status: 409 }));
    fetcher.mockResolvedValueOnce(Response.json({ ...view, visible_receipt: receiptWithoutUndo }));
    await act(async () => { await controller.open(); });
    expect(controller.phase).toBe("unknown");
    expect(controller.receipt).toBeNull();
    expect(controller.contactOutcome).toBeNull();
  });

  it("ends gracefully when an already processed proposal has no visible receipt",async()=>{
    fetcher.mockResolvedValueOnce(Response.json({code:"MEMORY_REVIEW_PROCESSED",details:{operation_key:null}},{status:409}));
    await act(async()=>{await controller.open();});
    expect(controller.phase).toBe("processed");expect(controller.error).toBeNull();expect(controller.receipt).toBeNull();
  });
  it("keeps the review interactive after only the entry capability refreshes", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-1234567890", review: review() }));
    await act(async () => { await controller.open(); });
    await act(async () => { root.render(createElement(Probe, { capability: "refreshed-capability" })); });
    await act(async () => { await controller.open(); });
    expect(controller.phase).toBe("review");
    expect(controller.frozen).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(Response.json({ review: { ...review(), review_revision: 1 } }));
    await act(async () => {
      controller.dispatchDraft(toggleItem(controller.draft!, controller.review!.items[0]!));
      await controller.flushDraft();
    });
    expect(fetcher.mock.calls[1]![1].headers["x-memory-entry-capability"]).toBe("refreshed-capability");
  });

  it("does not repeat an acknowledged draft when disclosure schedules during the in-flight write", async () => {
    vi.useFakeTimers();
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-1234567890", review: review() }));
    await act(async () => { await controller.open(); });
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    await act(async () => {
      controller.dispatchDraft(toggleItem(controller.draft!, controller.review!.items[0]!));
      controller.scheduleDraft();
      vi.advanceTimersByTime(601);
    });
    await act(async () => {
      expect(controller.dispatchDraft(expandGroup(controller.draft!, "person", true))).toBe(false);
      controller.scheduleDraft(); // Defensively handle a caller scheduling anyway.
      finish(Response.json({ review: { ...review(), review_revision: 1 } }));
      await Promise.resolve();
    });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith("/draft"))).toHaveLength(1);
  });

  it("opens the purpose-bound review and returns a one-time credential in memory only", async () => {
    fetcher.mockResolvedValueOnce(
      Response.json({ review_credential: "cred-1234567890", review: review() }),
    );
    await act(async () => {
      await controller.open();
    });
    const [path, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/memory/proposals/${PROPOSAL}/reviews`);
    expect(init.method).toBe("POST");
    expect(controller.review?.review_scope_id).toBe(SCOPE);
    expect(controller.phase).toBe("review");
    // The credential is never written to browser storage.
    expect(JSON.stringify(window.sessionStorage)).not.toContain("cred-1234567890");
  });

  it("undoes a contact-only approval while reporting that dependent records retain the contact", async () => {
    const opened = review();
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-1234567890", review: opened }));
    await act(async () => { await controller.open(); });
    fetcher.mockResolvedValueOnce(Response.json({ replayed: false,
      receipt: { operation_key: "op-contact", created_person_id: "33333333-3333-4333-8333-333333333333", applied_item_count: 0,
        undo: { allowed: true, limits: [] } }, proposal_revision: 2, remaining_pending_item_count: 5 }));
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-next", review: { ...opened,
      contact_decision: "existing", contact_status: "resolved", proposal_revision: 2 } }));
    await act(async () => { await controller.decideContactOnly({ displayLabel: "陈宇", relationshipContext: "设计合作" }); });
    fetcher.mockResolvedValueOnce(Response.json({ state: "applied", commit_revision: 1, undo: { allowed: true, limits: [] }, visible_receipt: { operation_key: "op-contact" } }));
    fetcher.mockResolvedValueOnce(Response.json({ receipt: { operation_key: "op-contact", status: "undone", undo_contact_outcome: "retained" } }));
    await act(async () => { await controller.undoContact(); });
    expect(controller.contactOutcome?.kind).toBe("undone");
    expect(controller.contactOutcome?.receipt?.undo_contact_outcome).toBe("retained");
  });

  it("restores a contact receipt after reload before enabling Memory siblings", async () => {
    window.sessionStorage.setItem(`get40:memory-locator:binding-1:${PROPOSAL}:chat`, JSON.stringify({
      version: 1, binding: "binding-1", proposal_id: PROPOSAL, purpose: "chat",
      person_id: null, relationship_context_id: null,
      operation_key: "op-contact", contact_operation_key: "op-contact", contact_pending: true,
      undo_key: null,
    }));
    const resolved = { ...review(), contact_decision: "existing" as const, contact_status: "resolved" as const };
    fetcher.mockImplementation((path: string) => String(path).includes("/operation-views/op-contact")
      ? Promise.resolve(Response.json({ state: "applied", visible_receipt: {
          operation_key: "op-contact", created_person_id: "33333333-3333-4333-8333-333333333333",
          applied_item_count: 0, decisions: [],
        }, undo: { allowed: true, limits: [] } }))
      : Promise.resolve(Response.json({ review_credential: "cred-next", review: resolved })));
    await act(async () => { await controller.open(); });
    expect(controller.contactOutcome?.kind).toBe("committed");
    expect(controller.review?.contact_status).toBe("resolved");
    expect(controller.review?.items.filter((entry) => entry.status === "pending")).toHaveLength(5);
  });

  it("adds a contact without deciding the pending Memory cards", async () => {
    const opened = review();
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-1234567890", review: opened }));
    await act(async () => { await controller.open(); });
    fetcher.mockResolvedValueOnce(Response.json({
      replayed: false, receipt: { operation_key: "op-contact", created_person_id: "33333333-3333-4333-8333-333333333333", applied_item_count: 0 },
      proposal_revision: 2, remaining_pending_item_count: 5,
    }));
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-next", review: {
      ...opened, contact_decision: "existing", contact_status: "resolved", proposal_revision: 2,
    } }));
    await act(async () => { await controller.decideContactOnly({ displayLabel: "陈宇", relationshipContext: "设计合作" }); });
    expect(controller.contactOutcome?.kind).toBe("committed");
    expect(controller.contactOutcome?.receipt?.created_person_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(controller.review?.items.filter((entry) => entry.status === "pending")).toHaveLength(5);
    const call = fetcher.mock.calls.find(([path]) => String(path).endsWith("/contact-decisions")) as [string, RequestInit];
    expect(call[0]).toBe(`/api/memory/reviews/${SCOPE}/contact-decisions`);
    expect(JSON.parse(call[1].body as string)).not.toHaveProperty("selected_item_ids");
  });

  it("does not send an item decision when its recovery key cannot be saved", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-1234567890", review: review() }));
    await act(async () => { await controller.open(); });
    const callsBefore = fetcher.mock.calls.length;
    const storage = vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    await act(async () => { await controller.decideItem({ itemId: "self-1", decision: "accept" }); });
    expect(fetcher.mock.calls.length).toBe(callsBefore);
    expect(controller.error).toContain("无法保存这次操作");
    storage.mockRestore();
  });

  it("drops the former account's review and item receipts when the binding changes", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-1234567890", review: review() }));
    await act(async () => { await controller.open(); });
    expect(controller.review).not.toBeNull();
    await act(async () => { root.render(createElement(Probe, { binding: "binding-2" })); });
    expect(controller.review).toBeNull();
    expect(controller.itemOutcomes).toEqual({});
    expect(controller.receipt).toBeNull();
  });

  it("keeps a lost undo unresolved until authoritative readback says undone", async () => {
    const opened = review();
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-1234567890", review: opened }));
    await act(async () => { await controller.open(); });
    fetcher.mockResolvedValueOnce(Response.json({ kind: "committed", item_id: "self-1", replayed: false,
      receipt: { operation_key: "op-one", decisions: [{ proposal_item_id: "self-1", decision: "accept" }] },
      proposal_revision: 1, remaining_pending_item_count: 4 }));
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-next", review: opened }));
    await act(async () => { await controller.decideItem({ itemId: "self-1", decision: "accept" }); });
    fetcher.mockResolvedValueOnce(Response.json({ state: "applied", commit_revision: 1,
      undo: { allowed: true, limits: [] }, visible_receipt: { operation_key: "op-one" } }));
    fetcher.mockRejectedValueOnce(new Error("undo response lost"));
    await act(async () => { await controller.undoItem("self-1"); });
    expect(controller.itemOutcomes["self-1"]?.kind).toBe("undo_unknown");
    fetcher.mockResolvedValueOnce(Response.json({ state: "applied", visible_receipt: { operation_key: "op-one" }, undo: { allowed: true, limits: [] } }));
    await act(async () => { await controller.checkItem("self-1"); });
    expect(controller.itemOutcomes["self-1"]?.kind).toBe("undo_unknown");
    fetcher.mockResolvedValueOnce(Response.json({ state: "undone", visible_receipt: { operation_key: "op-one", status: "undone" }, undo: { allowed: false, limits: [] } }));
    await act(async () => { await controller.checkItem("self-1"); });
    expect(controller.itemOutcomes["self-1"]?.kind).toBe("undone");
  });

  it("undoes the exact item receipt without touching a sibling", async () => {
    const opened = review();
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-1234567890", review: opened }));
    await act(async () => { await controller.open(); });
    fetcher.mockResolvedValueOnce(Response.json({ kind: "committed", item_id: "self-1", replayed: false,
      receipt: { operation_key: "op-one", decisions: [{ proposal_item_id: "self-1", decision: "accept" }] },
      proposal_revision: 1, remaining_pending_item_count: 4 }));
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-next", review: opened }));
    await act(async () => { await controller.decideItem({ itemId: "self-1", decision: "accept" }); });
    fetcher.mockResolvedValueOnce(Response.json({ state: "applied", commit_revision: 1,
      undo: { allowed: true, limits: [] }, visible_receipt: { operation_key: "op-one" } }));
    fetcher.mockResolvedValueOnce(Response.json({ receipt: { operation_key: "op-one", status: "undone" } }));
    await act(async () => { await controller.undoItem("self-1"); });
    expect(controller.itemOutcomes["self-1"]?.kind).toBe("undone");
    expect(controller.review?.items.find((entry) => entry.id === "self-2")?.status).toBe("pending");
    const decision = fetcher.mock.calls.find(([path]) => String(path).endsWith("/item-decisions")) as [string, RequestInit];
    const operationKey = JSON.parse(decision[1].body as string).idempotency_key;
    const undo = fetcher.mock.calls.find(([path]) => String(path).includes(`/operation-views/${operationKey}/undo`)) as [string, RequestInit];
    expect(undo[0]).toContain(`${operationKey}/undo`);
    expect(JSON.parse(undo[1].body as string).expected_commit_revision).toBe(1);
  });

  it("recognizes a nested backend terminal code after the last item is skipped", async () => {
    const single = { ...review(), items: [item("self-1", "self")] };
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-1234567890", review: single }));
    await act(async () => { await controller.open(); });
    fetcher.mockResolvedValueOnce(Response.json({ kind: "skipped", item_id: "self-1", replayed: false,
      receipt: null, proposal_revision: 1, remaining_pending_item_count: 0 }));
    fetcher.mockResolvedValueOnce(Response.json({ error: { code: "MEMORY_REVIEW_DISMISSED" } }, { status: 409 }));
    await act(async () => { await controller.decideItem({ itemId: "self-1", decision: "skip" }); });
    expect(controller.phase).toBe("dismissed");
    expect(controller.error).toBeNull();
    expect(controller.itemOutcomes["self-1"]?.kind).toBe("skipped");
  });

  it("closes stale actions when the final item has been processed", async () => {
    const single = { ...review(), items: [item("self-1", "self")] };
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-1234567890", review: single }));
    await act(async () => { await controller.open(); });
    fetcher.mockResolvedValueOnce(Response.json({
      kind: "committed", item_id: "self-1", replayed: false,
      receipt: { operation_key: "op-final", decisions: [{ proposal_item_id: "self-1", decision: "accept" }] },
    }));
    fetcher.mockResolvedValueOnce(Response.json({ code: "MEMORY_REVIEW_PROCESSED" }, { status: 409 }));
    await act(async () => { await controller.decideItem({ itemId: "self-1", decision: "accept" }); });
    expect(controller.phase).toBe("processed");
    expect(controller.itemOutcomes["self-1"]?.kind).toBe("committed");
  });

  it("decides one item through the protected route and keeps the sibling visible", async () => {
    const opened = review();
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-1234567890", review: opened }));
    await act(async () => { await controller.open(); });
    fetcher.mockResolvedValueOnce(Response.json({
      contract_version: "2026-08-24.10",
      kind: "committed",
      item_id: "self-1",
      replayed: false,
      receipt: { operation_key: "op-item-1", decisions: [{ proposal_item_id: "self-1", decision: "accept" }] },
      proposal_revision: 1,
      remaining_pending_item_count: 4,
    }));
    fetcher.mockResolvedValueOnce(Response.json({ review: {
      ...opened,
      items: opened.items.filter((entry) => entry.id !== "self-1"),
    } }));
    const locatorKey = `get40:memory-locator:binding-1:${PROPOSAL}:chat`;
    const prior = JSON.parse(window.sessionStorage.getItem(locatorKey)!);
    window.sessionStorage.setItem(locatorKey, JSON.stringify({ ...prior, contact_operation_key: "op-contact" }));
    await act(async () => {
      await controller.decideItem({ itemId: "self-1", decision: "accept" });
    });
    const call = fetcher.mock.calls.find(([path]) => String(path).endsWith("/item-decisions")) as [string, RequestInit];
    expect(call[0]).toBe(`/api/memory/reviews/${SCOPE}/item-decisions`);
    const body = JSON.parse(call[1].body as string);
    expect(body.item_id).toBe("self-1");
    expect(body.decision).toBe("accept");
    expect(body).not.toHaveProperty("selected_item_ids");
    expect(controller.itemOutcomes["self-1"]?.kind).toBe("committed");
    expect(controller.review?.items.find((entry) => entry.id === "self-1")?.status).toBe("committed");
    expect(controller.review?.items.find((entry) => entry.id === "self-2")?.status).toBe("pending");
    expect(JSON.parse(window.sessionStorage.getItem(locatorKey)!).contact_operation_key).toBe("op-contact");
  });

  it("persists the exact 16-item selection through the review draft endpoint", async () => {
    vi.useFakeTimers();
    fetcher.mockResolvedValueOnce(
      Response.json({ review_credential: "cred-1234567890", review: review() }),
    );
    await act(async () => {
      await controller.open();
    });
    const opened = controller.review!;
    let draft = createDraftState(opened);
    draft = toggleItem(draft, opened.items.find((entry) => entry.id === "person-1")!);
    expect(visibleItems(opened.items, draft.contactDecision).filter((entry) => draft.selected[entry.id])).toHaveLength(4);
    fetcher.mockResolvedValueOnce(
      Response.json({ review: { ...opened, review_revision: 1 } }),
    );
    await act(async () => {
      controller.dispatchDraft(draft);
      controller.scheduleDraft();
      vi.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });
    const draftCall = fetcher.mock.calls.find(
      ([path]) => typeof path === "string" && path.includes("/draft"),
    ) as [string, RequestInit];
    expect(draftCall).toBeTruthy();
    expect(draftCall[0]).toBe(`/api/memory/reviews/${SCOPE}/draft`);
    expect((draftCall[1].headers as Record<string, string>)["x-memory-review-credential"]).toBe(
      "cred-1234567890",
    );
    expect((draftCall[1].headers as Record<string, string>)["x-memory-entry-capability"]).toBe(
      "test-capability",
    );
    const body = JSON.parse(draftCall[1].body as string) as {
      expected_review_revision: number;
      selected_item_ids: string[];
      contact_decision: string;
    };
    expect(body.expected_review_revision).toBe(0);
    expect(body.selected_item_ids).toHaveLength(4);
    expect(body.selected_item_ids).not.toContain("person-1");
    expect(body.contact_decision).toBe("new");
    expect(controller.draftStatus).toBe("saved");
  });

  it("rebases to an explicitly chosen person with human selection authority", async () => {
    fetcher.mockResolvedValueOnce(
      Response.json({ review_credential: "cred-1234567890", review: review() }),
    );
    await act(async () => {
      await controller.open();
    });
    fetcher.mockResolvedValueOnce(
      Response.json({ replayed: false, proposal: { revision: 2 }, review_credential: null }),
    );
    fetcher.mockResolvedValueOnce(
      Response.json({ review_credential: "cred-next", review: { ...review(), proposal_revision: 2 } }),
    );
    await act(async () => {
      await controller.rebase({
        contactDecision: "existing",
        personId: "33333333-3333-4333-8333-333333333333",
        contextId: "44444444-4444-4444-8444-444444444444",
      });
    });
    const rebaseCall = fetcher.mock.calls.find(
      ([path]) => typeof path === "string" && path.includes("/rebases"),
    ) as [string, RequestInit];
    expect(rebaseCall).toBeTruthy();
    const body = JSON.parse(rebaseCall[1].body as string) as {
      contact_decision: string;
      identity_authority: string;
      person_id: string;
      relationship_context_id: string;
    };
    expect(body.contact_decision).toBe("existing");
    expect(body.identity_authority).toBe("human_selection");
    expect(body.person_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(body.relationship_context_id).toBe("44444444-4444-4444-8444-444444444444");
    expect(controller.rebaseState).toBe("idle");
    expect(controller.review?.proposal_revision).toBe(2);
    expect(controller.notice).toContain("请重新勾选");
    fetcher.mockResolvedValueOnce(Response.json({ replayed: false, receipt: {
      contract_version: "2026-08-24.10", commit_id: SCOPE, operation_key: "op-rebased",
      proposal_id: PROPOSAL, proposal_revision: 2, status: "applied", contact_decision: "existing",
      item_count: 1, applied_item_count: 1, created_item_ids: ["person-1"], updated_item_ids: [],
      skipped_item_ids: [], kept_old_item_ids: [], decisions: [],
      undo: { token: "undo-rebased", allowed: true, limits: [] },
      projection_status: "not_required", created_at: new Date().toISOString(),
    } }));
    await act(async () => { await controller.commit({ contactDecision: "existing",
      selectedItemIds: ["person-1"], editedText: {}, itemDecisions: {}, expectedItemVersions: {},
    }); });
    expect(controller.phase).toBe("receipt");
    expect(controller.notice).toBeNull();
    expect(controller.canUndo).toBe(true);
  });

  it("does not claim successful regeneration when the new review cannot be read", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-old", review: review() }));
    await act(async () => { await controller.open(); });
    // Switch before the 600 ms debounce fires; preserve independent self intent.
    await act(async () => {
      controller.dispatchDraft(toggleItem(controller.draft!, controller.review!.items[0]!));
      controller.scheduleDraft();
    });
    fetcher.mockResolvedValueOnce(Response.json({ review: { ...review(), review_revision: 1 } }));
    fetcher.mockResolvedValueOnce(Response.json({ proposal: { revision: 2 } }));
    fetcher.mockResolvedValueOnce(Response.json({ code: "UNAVAILABLE" }, { status: 503 }));
    let switched: boolean | undefined;
    await act(async () => { switched = await controller.rebase({ contactDecision: "existing", personId: "33333333-3333-4333-8333-333333333333" }); });
    expect(switched).toBe(false);
    expect(controller.phase).toBe("error");
    expect(controller.notice).toBeNull();
    expect(controller.review).toBeNull();
    expect(controller.error).toContain("联系人已切换，但新内容尚未读取成功");
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-new", review: { ...review(), proposal_revision: 2 } }));
    await act(async () => { await controller.open(); });
    expect(controller.phase).toBe("review");
    expect(controller.review?.proposal_revision).toBe(2);
    expect(controller.draft?.selected["self-1"]).toBe(false);
    const draftPut = fetcher.mock.calls.findIndex(([path]) => String(path).endsWith("/draft"));
    const rebasePost = fetcher.mock.calls.findIndex(([path]) => String(path).endsWith("/rebases"));
    expect(draftPut).toBeGreaterThan(0);
    expect(draftPut).toBeLessThan(rebasePost);
  });

  it("flushes the latest draft intent once before the commit and keeps double-click to one commit", async () => {
    fetcher.mockResolvedValueOnce(
      Response.json({ review_credential: "cred-1234567890", review: review() }),
    );
    await act(async () => {
      await controller.open();
    });
    const opened = controller.review!;
    const draftBodies: Array<{ selected_item_ids: string[] }> = [];
    const commitBodies: Array<Record<string, unknown>> = [];
    fetcher.mockImplementation((path: string, init?: RequestInit) => {
      if (path.includes("/draft")) {
        draftBodies.push(JSON.parse(init?.body as string) as { selected_item_ids: string[] });
        return Promise.resolve(Response.json({ review: { ...opened, review_revision: draftBodies.length } }));
      }
      if (path.includes("/commits")) {
        commitBodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
        return Promise.resolve(Response.json({
          replayed: false,
          receipt: {
            contract_version: "2026-08-24.10",
            commit_id: SCOPE,
            operation_key: "op-1",
            proposal_id: PROPOSAL,
            proposal_revision: 1,
            status: "applied",
            contact_decision: "new",
            item_count: 0,
            applied_item_count: 0,
            created_item_ids: [],
            updated_item_ids: [],
            skipped_item_ids: [],
            kept_old_item_ids: [],
            decisions: [],
            undo: { token: "undo-1", allowed: true, limits: [] },
            projection_status: "not_required",
            created_at: new Date().toISOString(),
          },
        }));
      }
      return Promise.resolve(Response.json({ review: opened }));
    });
    let draft = createDraftState(opened);
    draft = toggleItem(draft, opened.items.find((entry) => entry.id === "person-1")!);
    draft = toggleItem(draft, opened.items.find((entry) => entry.id === "person-2")!);
    controller.dispatchDraft(draft);
    const body = {
      contactDecision: "new" as const,
      selectedItemIds: opened.items.map((item) => item.id),
      editedText: {},
      itemDecisions: {},
      expectedItemVersions: {},
    };
    await act(async () => {
      await Promise.all([controller.commit(body), controller.commit(body)]);
    });
    expect(draftBodies).toHaveLength(1);
    expect(draftBodies[0]!.selected_item_ids).not.toContain("person-1");
    expect(draftBodies[0]!.selected_item_ids).not.toContain("person-2");
    expect(commitBodies).toHaveLength(1);
  });

  it("recovers a lost skip response from the same operation key", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-1234567890", review: review() }));
    await act(async () => { await controller.open(); });
    fetcher.mockImplementation((path: string) => {
      if (path.endsWith("/item-decisions")) return Promise.reject(new Error("response lost"));
      if (path.includes("/operation-views/")) return Promise.resolve(Response.json({
        state: "skipped", dismissed_item_id: "self-1", visible_receipt: null,
        undo: { allowed: false, limits: [] },
      }));
      return Promise.resolve(Response.json({ review_credential: "cred-next", review: review() }));
    });
    await act(async () => { await controller.decideItem({ itemId: "self-1", decision: "skip" }); });
    expect(controller.phase).toBe("unknown");
    await act(async () => { await controller.reconcile(); });
    expect(controller.itemOutcomes["self-1"]?.kind).toBe("skipped");
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith("/item-decisions"))).toHaveLength(1);
  });

  it("reconciles a lost item response into that card without another POST", async () => {
    const opened = review();
    fetcher.mockResolvedValueOnce(Response.json({ review_credential: "cred-1234567890", review: opened }));
    await act(async () => { await controller.open(); });
    fetcher.mockImplementation((path: string) => {
      if (path.endsWith("/item-decisions")) return Promise.reject(new Error("response lost"));
      if (path.includes("/operation-views/")) return Promise.resolve(Response.json({
        state: "applied",
        visible_receipt: {
          operation_key: "op-reconciled",
          decisions: [{ proposal_item_id: "self-1", decision: "accept" }],
        },
        undo: { allowed: true, limits: [] },
      }));
      return Promise.resolve(Response.json({ review_credential: "cred-next", review: opened }));
    });
    await act(async () => { await controller.decideItem({ itemId: "self-1", decision: "accept" }); });
    expect(controller.phase).toBe("unknown");
    const stored = window.sessionStorage.getItem(`get40:memory-locator:binding-1:${PROPOSAL}:chat`)!;
    expect(stored).not.toContain("cred-1234567890");
    expect(JSON.parse(stored).operation_key).toBeTruthy();
    await act(async () => { await controller.reconcile(); });
    expect(controller.itemOutcomes["self-1"]?.kind).toBe("committed");
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith("/item-decisions"))).toHaveLength(1);
  });

  it("shows a reconcilable unknown state after a lost commit response and reconciles the same operation", async () => {
    fetcher.mockResolvedValueOnce(
      Response.json({ review_credential: "cred-1234567890", review: review() }),
    );
    await act(async () => {
      await controller.open();
    });
    const opened = controller.review!;
    fetcher.mockImplementation((path: string) => {
      if (path.includes("/commits")) {
        return Promise.reject(new Error("network"));
      }
      if (path.includes("/operation-views/")) {
        const operationKey = path.split("/operation-views/")[1]!.split("?")[0]!;
        const view = scopedContactView({ operation_key: operationKey });
        view.visible_receipt = { ...view.visible_receipt!, operation_key: operationKey };
        return Promise.resolve(
          Response.json(view),
        );
      }
      return Promise.resolve(Response.json({ review: opened }));
    });
    await act(async () => {
      await controller.commit({
        contactDecision: "new",
        selectedItemIds: [],
        editedText: {},
        itemDecisions: {},
        expectedItemVersions: {},
      });
    });
    expect(controller.phase).toBe("unknown");
    expect(controller.canReconcile).toBe(true);
    await act(async () => {
      await controller.reconcile();
    });
    expect(controller.phase).toBe("receipt");
    expect(controller.receipt?.applied_item_count).toBe(0);
  });

  it("does not write a draft for pure disclosure, and writes once for a semantic change", async () => {
    fetcher.mockResolvedValueOnce(
      Response.json({ review_credential: "cred-1234567890", review: review() }),
    );
    await act(async () => {
      await controller.open();
    });
    const opened = controller.review!;
    const putBodies: unknown[] = [];
    fetcher.mockImplementation((path: string, init?: RequestInit) => {
      if (path.includes("/draft")) {
        putBodies.push(JSON.parse(init?.body as string));
        return Promise.resolve(Response.json({ review: { ...opened, review_revision: putBodies.length } }));
      }
      return Promise.resolve(Response.json({ review: opened }));
    });
    await act(async () => {
      controller.dispatchDraft(expandGroup(controller.draft!, "person", true));
    });
    await act(async () => {
      await controller.flushDraft();
    });
    expect(putBodies).toHaveLength(0);
    await act(async () => {
      controller.dispatchDraft(
        toggleItem(controller.draft!, opened.items.find((entry) => entry.id === "person-1")!),
      );
    });
    await act(async () => {
      await controller.flushDraft();
    });
    expect(putBodies).toHaveLength(1);
  });

  it("reconciles a pending item after reload before showing its action again", async () => {
    window.sessionStorage.setItem(`get40:memory-locator:binding-1:${PROPOSAL}:chat`, JSON.stringify({
      version: 1, binding: "binding-1", proposal_id: PROPOSAL, purpose: "chat",
      person_id: null, relationship_context_id: null,
      operation_key: "op-unknown", item_pending_id: "self-1",
      item_operation_keys: { "self-1": "op-unknown" }, undo_key: null,
    }));
    fetcher.mockImplementation((path: string) => String(path).includes("/operation-views/op-unknown")
      ? Promise.resolve(Response.json({ state: "applied", visible_receipt: {
          operation_key: "op-unknown", decisions: [{ proposal_item_id: "self-1", decision: "accept" }],
        }, undo: { allowed: true, limits: [] } }))
      : Promise.resolve(Response.json({ review_credential: "cred-next", review: review() })));
    await act(async () => { await controller.open(); });
    expect(controller.itemOutcomes["self-1"]?.kind).toBe("committed");
    expect(controller.phase).toBe("review");
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith("/item-decisions"))).toHaveLength(0);
  });

  it("restores a skipped item card after its proposal is dismissed", async () => {
    window.sessionStorage.setItem(`get40:memory-locator:binding-1:${PROPOSAL}:chat`, JSON.stringify({
      version: 1, binding: "binding-1", proposal_id: PROPOSAL, purpose: "chat",
      person_id: null, relationship_context_id: null,
      operation_key: null, item_operation_keys: { "self-1": "op-skip" }, undo_key: null,
    }));
    fetcher.mockImplementation((path: string) => String(path).includes("/operation-views/op-skip")
      ? Promise.resolve(Response.json({ state: "skipped", dismissed_item_id: "self-1",
          item_snapshot: { ...item("self-1", "self"), status: "skipped" }, visible_receipt: null,
          undo: { allowed: false, limits: [] } }))
      : Promise.resolve(Response.json({ error: { code: "MEMORY_REVIEW_DISMISSED" } }, { status: 409 })));
    await act(async () => { await controller.open(); });
    expect(controller.phase).toBe("dismissed");
    expect(controller.itemOutcomes["self-1"]?.kind).toBe("skipped");
    expect(controller.itemOutcomes["self-1"]?.snapshot?.status).toBe("skipped");
  });

  it("restores an item receipt on reload and leaves another item actionable", async () => {
    window.sessionStorage.setItem(`get40:memory-locator:binding-1:${PROPOSAL}:chat`, JSON.stringify({
      version: 1, binding: "binding-1", proposal_id: PROPOSAL, purpose: "chat",
      person_id: null, relationship_context_id: null,
      operation_key: null, item_pending_id: null,
      item_operation_keys: { "self-1": "op-saved" }, undo_key: null,
    }));
    const refreshed = { ...review(), items: review().items.filter((entry) => entry.id !== "self-1") };
    fetcher.mockImplementation((path: string) => String(path).includes("/operation-views/op-saved")
      ? Promise.resolve(Response.json({ state: "applied", visible_receipt: {
          operation_key: "op-saved", decisions: [{ proposal_item_id: "self-1", decision: "accept" }],
        }, item_snapshot: { ...item("self-1", "self"), status: "committed" },
        undo: { allowed: true, limits: [] } }))
      : Promise.resolve(Response.json({ review_credential: "cred-next", review: refreshed })));
    await act(async () => { await controller.open(); });
    expect(controller.itemOutcomes["self-1"]?.kind).toBe("committed");
    expect(controller.review?.items.find((entry) => entry.id === "self-1")?.status).toBe("committed");
    expect(controller.review?.items.find((entry) => entry.id === "self-2")?.status).toBe("pending");
  });

  it("reconciles a closed proposal receipt from the locator without opening a review", async () => {
    window.sessionStorage.setItem(
      `get40:memory-locator:binding-1:${PROPOSAL}:chat`,
      JSON.stringify({
        version: 1,
        binding: "binding-1",
        proposal_id: PROPOSAL,
        purpose: "chat",
        person_id: null,
        relationship_context_id: null,
        operation_key: OPERATION,
        undo_key: null,
      }),
    );
    fetcher.mockReset();
    fetcher.mockImplementation((path: string) => {
      if (path.includes(`/operation-views/${OPERATION}`)) {
        const view = scopedContactView({ visible_effect_count: 3 });
        const ids = [
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        ];
        view.visible_receipt = { ...view.visible_receipt!, contact_decision: "existing", created_person_id: null,
          item_count: 3, applied_item_count: 3, created_item_ids: ids,
          decisions: ids.map(proposalItemId => ({ proposal_item_id: proposalItemId, decision: "accept", memory_item_id: proposalItemId })) };
        return Promise.resolve(
          Response.json(view),
        );
      }
      return Promise.resolve(Response.json({ capability: "cap" }));
    });
    await act(async () => {
      await controller.open();
    });
    expect(controller.phase).toBe("receipt");
    expect(controller.receipt?.applied_item_count).toBe(3);
    expect(controller.contactOutcome).toBeNull();
    expect(
      fetcher.mock.calls.some(([path]) => String(path).includes("/reviews")),
    ).toBe(false);
  });

  it("keeps the latest local intent across a 409 draft conflict instead of overlaying the server draft", async () => {
    fetcher.mockResolvedValueOnce(
      Response.json({ review_credential: "cred-1234567890", review: review() }),
    );
    await act(async () => {
      await controller.open();
    });
    const opened = controller.review!;
    const serverDraftReview = {
      ...opened,
      review_revision: 5,
      draft: {
        contact_decision: "new" as const,
        selected_item_ids: ["person-1", "person-2"],
        edited_text: {},
        item_decisions: {},
        revision: 5,
        updated_at: new Date().toISOString(),
      },
    };
    const putBodies: Array<{ selected_item_ids: string[]; expected_review_revision: number }> = [];
    let putCount = 0;
    fetcher.mockImplementation((path: string, init?: RequestInit) => {
      if (path.includes("/draft")) {
        putBodies.push(JSON.parse(init?.body as string) as { selected_item_ids: string[]; expected_review_revision: number });
        putCount += 1;
        if (putCount === 1) {
          return Promise.resolve(Response.json({ error: { code: "MEMORY_REVIEW_DRAFT_STALE" } }, { status: 409 }));
        }
        return Promise.resolve(Response.json({ review: serverDraftReview }));
      }
      if (path.includes(`/api/memory/reviews/${SCOPE}`)) {
        return Promise.resolve(Response.json({ review: serverDraftReview }));
      }
      return Promise.resolve(Response.json({ review: opened }));
    });
    let draft = createDraftState(opened);
    draft = toggleItem(draft, opened.items.find((entry) => entry.id === "person-1")!);
    controller.dispatchDraft(draft);
    await act(async () => {
      await controller.flushDraft();
    });
    expect(putBodies.length).toBeGreaterThanOrEqual(2);
    expect(putBodies[0]!.selected_item_ids).not.toContain("person-1");
    expect(putBodies[1]!.selected_item_ids).not.toContain("person-1");
    expect(putBodies[1]!.expected_review_revision).toBe(5);
  });
});
