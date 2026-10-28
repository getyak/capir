// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryProposalItem, MemoryReceipt } from "@talent-signal/contracts";
import { MemoryItemCard, SessionMemoryCards } from "./memory-item-card";
import type { MemoryItemOutcome, MemoryReviewController } from "./use-memory-review";
import { LocaleProvider } from "../locale-provider";

const item: MemoryProposalItem = {
  id: "77777777-7777-4777-8777-777777777777",
  scope: "person",
  subject_kind: "resolved_subject",
  relationship_kind: "none",
  operation: "update",
  statement_kind: "source_statement",
  display_text: "林岚现在负责试点合作",
  original_display_text: "林岚现在负责试点合作",
  previous_text: "林岚负责设计系统",
  previous_memory_item_id: "88888888-8888-4888-8888-888888888888",
  previous_revision: 1,
  subject_id: "99999999-9999-4999-8999-999999999999",
  speaker: "林岚",
  time_status: "known",
  sensitivity: "normal",
  admission_status: "eligible",
  judgment_kind: "ordinary",
  default_selected: false,
  reason: "职责发生了变化",
  source_excerpt: "我现在负责试点，设计系统交给陈宇了。",
  source_locator: { kind: "message", session_id: null, message_id: null },
  added_revision: 1,
  status: "pending",
};

let mount: HTMLDivElement;
let root: Root;
const decide = vi.fn();

const contactReceipt: MemoryReceipt = {
  contract_version: "2026-08-24.10", commit_id: "11111111-1111-4111-8111-111111111111",
  operation_key: "22222222-2222-4222-8222-222222222222", proposal_id: "33333333-3333-4333-8333-333333333333",
  proposal_revision: 1, status: "applied", contact_decision: "new",
  created_person_id: "44444444-4444-4444-8444-444444444444", person_display_label: "林海（测试）",
  item_count: 0, applied_item_count: 0, created_item_ids: [], updated_item_ids: [],
  skipped_item_ids: [], kept_old_item_ids: [], decisions: [],
  undo: { token: "55555555-5555-4555-8555-555555555555", allowed: true, limits: [] },
  projection_status: "pending", created_at: "2026-10-28T16:34:16.387Z",
};

function recoveredController(kind: MemoryItemOutcome["kind"], receipt: MemoryReceipt = contactReceipt) {
  return { review: null, phase: "receipt", itemOutcomes: {}, contactOutcome: { kind, receipt, operationKey: receipt.operation_key },
    frozen: false, reconciling: false, undoContact: vi.fn(async () => true), checkContact: vi.fn(async () => undefined) } as unknown as MemoryReviewController;
}

function button(label: string): HTMLButtonElement {
  const found = [...mount.querySelectorAll("button")].find((element) => element.textContent?.includes(label));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  decide.mockReset();
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
});
afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
});

describe("Session Memory item card", () => {
  it("keeps the recovered contact action tied to its canonical receipt and source Session", async () => {
    const controller = recoveredController("committed");
    const sessionId = "66666666-6666-4666-8666-666666666666";
    await act(async () => root.render(<SessionMemoryCards controller={controller} sourceSessionId={sessionId} />));
    expect(mount.querySelector("a")?.getAttribute("href")).toBe(`/workspace/people/${contactReceipt.created_person_id}?session=${sessionId}`);
    await act(async () => button("撤销").click());
    expect(controller.undoContact).toHaveBeenCalledOnce();
    await act(async () => root.render(<SessionMemoryCards controller={controller} sourceSessionId="not-a-session" />));
    expect(mount.querySelector("a")?.getAttribute("href")).toBe(`/workspace/people/${contactReceipt.created_person_id}`);
  });

  it("does not label a mixed Memory batch as a contact-only undo", async () => {
    const controller = recoveredController("committed", { ...contactReceipt, item_count: 1, applied_item_count: 1 });
    await act(async () => root.render(<SessionMemoryCards controller={controller} />));
    expect(mount.querySelector("a")).not.toBeNull();
    expect([...mount.querySelectorAll("button")].some(element => element.textContent === "撤销")).toBe(false);
  });

  it.each(["unknown", "undo_unknown", "unavailable"] as const)("does not offer a stale contact destination for %s recovery", async kind => {
    const controller = recoveredController(kind);
    await act(async () => root.render(<SessionMemoryCards controller={controller} />));
    expect(mount.querySelector("a")).toBeNull();
    expect(mount.textContent).not.toContain("已添加");
    if (kind === "unavailable") {
      expect(mount.textContent).not.toContain(contactReceipt.person_display_label);
      expect(mount.textContent).toContain("来源已失效");
    } else {
      expect(mount.textContent).toContain(kind === "undo_unknown" ? "撤销结果待核对" : "结果待核对");
      await act(async () => button("核对结果").click());
      expect(controller.checkContact).toHaveBeenCalledOnce();
    }
  });

  it("localizes decisions and unknown receipts without rewriting the evidence", async () => {
    await act(async () => root.render(<LocaleProvider locale="en"><MemoryItemCard
      item={item} personLabel="林岚" busy={false} onDecide={decide}
    /></LocaleProvider>));
    expect(button("Update memory")).toBeTruthy();
    expect(mount.textContent).toContain(item.source_excerpt);
    expect(mount.textContent).toContain(item.display_text);
    await act(async () => root.render(<LocaleProvider locale="en"><MemoryItemCard
      item={item} personLabel="林岚" busy={false} onDecide={decide} onCheck={vi.fn()}
      outcome={{ kind: "undo_unknown", receipt: null, operationKey: "unknown-undo" }}
    /></LocaleProvider>));
    expect(mount.querySelector('[role="status"]')?.textContent).toContain("Undo result awaiting check");
    expect(button("Check the result")).toBeTruthy();
  });

  it("shows the exact change and source with direct actions", async () => {
    await act(async () => root.render(createElement(MemoryItemCard, {
      item, personLabel: "林岚", busy: false, onDecide: decide,
    })));
    expect(mount.textContent).toContain("林岚负责设计系统");
    expect(mount.textContent).toContain("林岚现在负责试点合作");
    expect(mount.textContent).toContain("我现在负责试点，设计系统交给陈宇了。");
    expect(mount.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(button("更新记忆")).toBeTruthy();
    expect(button("改一下")).toBeTruthy();
    expect(button("暂不更新")).toBeTruthy();
    await act(async () => button("更新记忆").click());
    expect(decide).toHaveBeenCalledWith(item.id, "accept");
  });

  it("removes old decision buttons when the source is unavailable", async () => {
    await act(async () => root.render(createElement(MemoryItemCard, {
      item, personLabel: "林岚", busy: false, locked: true, onDecide: decide,
    })));
    expect(mount.textContent).toContain(item.source_excerpt);
    expect([...mount.querySelectorAll("button")].some((node) => node.textContent === "更新记忆")).toBe(false);
    expect(mount.textContent).toContain("无法操作");
  });

  it("redacts the old excerpt when the backend reports source revocation", async () => {
    await act(async () => root.render(createElement(MemoryItemCard, {
      item, personLabel: "林岚", busy: false, onDecide: decide,
      outcome: { kind: "unavailable", receipt: null, operationKey: "op-revoked" },
    })));
    expect(mount.textContent).not.toContain(item.source_excerpt);
    expect(mount.textContent).not.toContain(item.display_text);
    expect(mount.textContent).toContain("来源已失效");
  });

  it("shows the backend-confirmed edited value in its receipt", async () => {
    await act(async () => root.render(createElement(MemoryItemCard, {
      item, personLabel: "林岚", busy: false, onDecide: decide,
      outcome: { kind: "committed", receipt: null, operationKey: "op-edited", finalText: "林岚负责试点交付" },
    })));
    expect(mount.textContent).toContain("林岚负责试点交付");
    expect(mount.textContent).toContain("已更新记忆");
  });

  it("shows explicit conflict choices instead of a generic accept button", async () => {
    const conflict: MemoryProposalItem = { ...item, operation: "contest", admission_status: "needs_judgment", judgment_kind: "conflict" };
    await act(async () => root.render(createElement(MemoryItemCard, {
      item: conflict, personLabel: "林岚", busy: false, onDecide: decide,
    })));
    expect(button("采纳新值")).toBeTruthy();
    expect(button("保留旧值")).toBeTruthy();
    expect(button("保留两种说法")).toBeTruthy();
    expect([...mount.querySelectorAll("button")].some((node) => node.textContent === "更新记忆")).toBe(false);
    await act(async () => button("保留旧值").click());
    expect(decide).toHaveBeenCalledWith(conflict.id, "keep_old");
  });

  it("edits inside the card and submits only the revised sentence", async () => {
    await act(async () => root.render(createElement(MemoryItemCard, {
      item, personLabel: "林岚", busy: false, onDecide: decide,
    })));
    await act(async () => button("改一下").click());
    const editor = mount.querySelector("textarea")!;
    expect(editor.value).toBe(item.display_text);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "林岚负责试点合作的交付");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("保存修改").click());
    expect(decide).toHaveBeenCalledWith(item.id, "accept", "林岚负责试点合作的交付");
  });
});
