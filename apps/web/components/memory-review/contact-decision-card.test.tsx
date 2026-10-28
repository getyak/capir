// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactDecisionCard } from "./contact-decision-card";

let mount: HTMLDivElement;
let root: Root;
const add = vi.fn();
const pass = vi.fn();
const compare = vi.fn();
const check = vi.fn();
const correctName = vi.fn();

function render(status: "pending" | "ambiguous" = "pending", extra: Partial<React.ComponentProps<typeof ContactDecisionCard>> = {}) {
  return root.render(createElement(ContactDecisionCard, {
    displayLabel: "陈宇", relationshipContext: "试点合作",
    sourceExcerpt: "陈宇负责设计系统，我把他拉进这次试点。",
    status, busy: false, onAdd: add, onPass: pass, onCompare: compare, onCheck: check,
    onCorrectName: correctName,
    ...extra,
  }));
}
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((node) => node.textContent?.includes(label));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  add.mockReset(); pass.mockReset(); compare.mockReset(); check.mockReset(); correctName.mockReset().mockResolvedValue(true);
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
});
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); vi.unstubAllGlobals(); });

describe("Session contact decision card", () => {
  it.each(["11111111-1111-4111-8111-111111111111", "not-a-session"])("preserves only a valid source Session after creating a person: %s", async sourceSessionId => {
    const personId = "33333333-3333-4333-8333-333333333333";
    await act(async () => render("pending", {
      sourceSessionId,
      outcome: { kind: "committed", operationKey: "contact-result", receipt: {
        contract_version: "2026-08-24.10", commit_id: "contact-commit", operation_key: "contact-result",
        proposal_id: "contact-proposal", proposal_revision: 1, status: "applied", contact_decision: "new",
        created_person_id: personId, item_count: 0, applied_item_count: 0,
        created_item_ids: [], updated_item_ids: [], skipped_item_ids: [], kept_old_item_ids: [], decisions: [],
        undo: { token: "contact-undo", allowed: true, limits: [] }, projection_status: "not_required",
        created_at: "2026-10-28T16:00:00.000Z",
      } },
    }));
    const href = mount.querySelector("a")?.getAttribute("href");
    expect(href).toBe(`/workspace/people/${personId}${sourceSessionId.startsWith("1111") ? `?session=${sourceSessionId}` : ""}`);
    expect(add).not.toHaveBeenCalled();
  });

  it("shows identity and evidence with one primary action and secondary disclosure", async () => {
    await act(async () => render());
    expect(mount.textContent).toContain("陈宇");
    expect(mount.textContent).toContain("试点合作");
    expect(mount.textContent).toContain("陈宇负责设计系统，我把他拉进这次试点。");
    expect([...mount.querySelectorAll("button")].map((node) => node.textContent)).toEqual(["添加联系人", "更多操作"]);
    expect(add).not.toHaveBeenCalled();
    await act(async () => button("添加联系人").click());
    expect(add).toHaveBeenCalledWith("陈宇", "试点合作");
    await act(async () => button("更多操作").click());
    expect(button("改资料")).toBeTruthy();
    expect(button("暂不添加")).toBeTruthy();
  });

  it("routes a changed name through source rebase before any contact write", async () => {
    await act(async () => render());
    await act(async () => button("更多操作").click());
    await act(async () => button("改资料").click());
    const input = mount.querySelector<HTMLInputElement>('input[value="陈宇"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "林岚");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("核对新姓名").click());
    expect(correctName).toHaveBeenCalledWith("林岚", "试点合作");
    expect(add).not.toHaveBeenCalled();
  });

  it("allows an explicit separate new contact when a same-name record exists", async () => {
    await act(async () => render("ambiguous"));
    expect(mount.textContent).toContain("同名");
    expect(add).not.toHaveBeenCalled();
    await act(async () => button("更多操作").click());
    await act(async () => button("核对人物").click());
    expect(compare).toHaveBeenCalledTimes(1);
    await act(async () => button("添加为新联系人").click());
    expect(add).toHaveBeenCalledWith("陈宇", "试点合作");
  });

  it("preserves edited relationship fields when a rejected write is retried", async () => {
    await act(async () => render());
    await act(async () => button("更多操作").click());
    await act(async () => button("改资料").click());
    const relationship = mount.querySelectorAll("input")[1]!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(relationship, "产品合作");
      relationship.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("添加联系人").click());
    await act(async () => render("pending", { busy: true }));
    await act(async () => render()); // Definitive rejection: no receipt, same review.
    expect(mount.querySelectorAll("input")[1]?.value).toBe("产品合作");
    await act(async () => button("添加联系人").click());
    expect(add).toHaveBeenNthCalledWith(1, "陈宇", "产品合作");
    expect(add).toHaveBeenNthCalledWith(2, "陈宇", "产品合作");
  });

  it("declines only after choosing Not now in the secondary actions", async () => {
    await act(async () => render());
    await act(async () => button("更多操作").click());
    expect(pass).not.toHaveBeenCalled();
    await act(async () => button("暂不添加").click());
    expect(pass).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });

  it("restores the trigger on Escape without deciding anything", async () => {
    await act(async () => render());
    const trigger = button("更多操作");
    await act(async () => trigger.click());
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(add).not.toHaveBeenCalled();
    expect(pass).not.toHaveBeenCalled();
  });

  it("moves focus into editing and returns it after cancel without writing", async () => {
    await act(async () => render());
    await act(async () => button("更多操作").click());
    await act(async () => button("改资料").click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(document.activeElement).toBe(mount.querySelector("input"));
    await act(async () => button("取消").click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(document.activeElement).toBe(button("更多操作"));
    expect(add).not.toHaveBeenCalled();
  });

  it("uses the current reviewed identity after a rebase and omits name-only duplicate evidence", async () => {
    await act(async () => render("pending", { displayLabel: "林岚", relationshipContext: "", sourceExcerpt: "林岚" }));
    expect(mount.querySelector("blockquote")).toBeNull();
    await act(async () => button("添加联系人").click());
    expect(add).toHaveBeenLastCalledWith("林岚", "");
    await act(async () => render("pending", { displayLabel: "Alex", relationshipContext: "Partner" }));
    await act(async () => button("添加联系人").click());
    expect(add).toHaveBeenLastCalledWith("Alex", "Partner");
  });

  it("disables writes while busy and exposes unresolved outcomes without the menu", async () => {
    await act(async () => render("pending", { busy: true }));
    expect(button("添加联系人").disabled).toBe(true);
    expect(button("更多操作").disabled).toBe(true);
    await act(async () => render("pending", { outcome: { kind: "unknown", receipt: null, operationKey: "pending-operation" } }));
    expect(mount.textContent).toContain("结果待核对");
    expect(mount.textContent).not.toContain("更多操作");
    await act(async () => button("核对结果").click());
    expect(check).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });

  it("redacts identity and evidence if its source becomes unavailable", async () => {
    await act(async () => render("pending", { sourceUnavailable: true }));
    expect(mount.textContent).not.toContain("陈宇");
    expect(mount.querySelector("button")).toBeNull();
    expect(mount.querySelector('[role="alert"]')).toBeTruthy();
  });
});
