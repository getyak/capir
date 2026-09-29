// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryProposalItem } from "@talent-signal/contracts";
import { MemoryItemCard } from "./memory-item-card";

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
