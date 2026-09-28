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

function render(status: "pending" | "ambiguous" = "pending") {
  return root.render(createElement(ContactDecisionCard, {
    displayLabel: "陈宇", relationshipContext: "试点合作",
    sourceExcerpt: "陈宇负责设计系统，我把他拉进这次试点。",
    status, busy: false, onAdd: add, onPass: pass, onCompare: compare, onCheck: check,
    onCorrectName: correctName,
  }));
}
function button(label: string): HTMLButtonElement {
  const found = [...mount.querySelectorAll("button")].find((node) => node.textContent?.includes(label));
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
  it("shows identity, relationship and exact source with direct actions", async () => {
    await act(async () => render());
    expect(mount.textContent).toContain("陈宇");
    expect(mount.textContent).toContain("试点合作");
    expect(mount.textContent).toContain("陈宇负责设计系统，我把他拉进这次试点。");
    await act(async () => button("添加联系人").click());
    expect(add).toHaveBeenCalledWith("陈宇", "试点合作");
    expect(button("改资料")).toBeTruthy();
    expect(button("暂不添加")).toBeTruthy();
  });

  it("routes a changed name through source rebase before any contact write", async () => {
    await act(async () => render());
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

  it("does not preselect or create a person when identity is ambiguous", async () => {
    await act(async () => render("ambiguous"));
    expect(mount.textContent).toContain("同名");
    expect([...mount.querySelectorAll("button")].some((node) => node.textContent === "添加联系人")).toBe(false);
    await act(async () => button("核对人物").click());
    expect(compare).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });
});
