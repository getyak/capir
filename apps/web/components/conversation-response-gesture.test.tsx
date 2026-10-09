// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ConversationResponse } from "./conversation-response";

const LONG_ANSWER = [
  "## 试点合作进展",
  "",
  "陈宇负责设计协作。试点阶段的时间已经确认，下周会给出第一版排期。",
  "",
  "回复偏好保持不变：先确认时间，再约定后续跟进方式。合同细节仍然需要法务复核后才能进入下一步，因此暂不推进对外承诺。",
  "",
  "目前有三个未决事项需要你来判断：第一，排期是否接受两周缓冲；第二，合同主体用现有模板还是新模板；第三，是否先安排一次三人对齐会。",
  "",
  "已经核对过的事实是：陈宇在上一轮明确提出设计协作由他负责；试点预算已由财务口头确认；对外发布节奏暂缓，等你确认之后再推进。",
  "",
  "下一步建议：先回复排期意见，其余两项可以在同一个回复里一并说明，我会把结论整理进关系记录并标注依据来源。",
  "",
  "依据来源：上一轮对话记录、财务预算确认邮件，以及陈宇主页中的协作说明。需要你决定的事项会保持待确认状态，不会自动批准。",
].join("\n");

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function mount(element: React.ReactElement) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

function surface(): HTMLElement {
  const element = host!.querySelector<HTMLElement>("[data-folded]");
  expect(element).not.toBeNull();
  return element!;
}

function gesture(target: EventTarget, type: string, scale: number): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "scale", { value: scale });
  let notCanceled = true;
  act(() => {
    notCanceled = target.dispatchEvent(event);
  });
  return notCanceled;
}

function wheel(target: EventTarget, init: { deltaY: number; ctrlKey?: boolean }): boolean {
  // happy-dom's WheelEvent does not carry modifier keys from its init dict;
  // define the pinch marker (WebKit sends ctrl+wheel for trackpad pinch) the
  // same way the gesture scale is attached above.
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: init.deltaY });
  if (init.ctrlKey) Object.defineProperty(event, "ctrlKey", { value: true });
  let notCanceled = true;
  act(() => {
    notCanceled = target.dispatchEvent(event);
  });
  return notCanceled;
}

describe("long-answer pinch fold", () => {
  it("keeps long code-only responses visible without an empty fold", () => {
    mount(createElement(ConversationResponse, { foldable: true }, "```text\n" + "code\n\n".repeat(80) + "```"));
    expect(host!.querySelector("[data-folded]")).toBeNull();
  });

  it("folds to an extractive preview on pinch inward and unfolds on spread", () => {
    mount(createElement(ConversationResponse, { foldable: true }, LONG_ANSWER));
    const fold = surface();
    expect(fold.dataset.folded).toBe("false");

    gesture(fold, "gesturestart", 1);
    gesture(fold, "gesturechange", 0.8);
    expect(fold.dataset.folded).toBe("true");
    // Extractive preview visible; the exact full text stays in the DOM.
    expect(fold.querySelector("[data-fold-preview]")?.textContent).toContain("陈宇负责设计协作。");
    expect(fold.textContent).toContain("合同细节仍然需要法务复核后才能进入下一步，因此暂不推进对外承诺。");

    gesture(fold, "gesturestart", 1);
    gesture(fold, "gesturechange", 1.2);
    expect(fold.dataset.folded).toBe("false");
  });

  it("handles scoped ctrl-wheel as pinch and leaves plain wheel untouched", () => {
    mount(createElement(ConversationResponse, { foldable: true }, LONG_ANSWER));
    const fold = surface();

    expect(wheel(fold, { deltaY: -120 })).toBe(true);
    expect(fold.dataset.folded).toBe("false");

    wheel(fold, { deltaY: 1, ctrlKey: true });
    expect(fold.dataset.folded).toBe("false");
    expect(wheel(fold, { deltaY: 120, ctrlKey: true })).toBe(false);
    expect(fold.dataset.folded).toBe("true");

    expect(wheel(fold, { deltaY: -120, ctrlKey: true })).toBe(false);
    expect(fold.dataset.folded).toBe("false");
  });

  it("never hijacks code, table or selected-text gestures", () => {
    mount(createElement(ConversationResponse, { foldable: true }, LONG_ANSWER));
    const fold = surface();
    const pre = document.createElement("pre");
    fold.append(pre);

    expect(wheel(pre, { deltaY: 120, ctrlKey: true })).toBe(true);
    expect(fold.dataset.folded).toBe("false");
    expect(gesture(pre, "gesturestart", 1)).toBe(true);
    gesture(pre, "gesturechange", 0.7);
    expect(fold.dataset.folded).toBe("false");

    const getSelection = window.getSelection;
    window.getSelection = () => ({ isCollapsed: false, toString: () => "选中的文字" }) as Selection;
    try {
      expect(wheel(fold, { deltaY: 120, ctrlKey: true })).toBe(true);
      expect(fold.dataset.folded).toBe("false");
      expect(gesture(fold, "gesturestart", 1)).toBe(true);
      gesture(fold, "gesturechange", 0.7);
      expect(fold.dataset.folded).toBe("false");
    } finally {
      window.getSelection = getSelection;
    }
  });

  it("offers a keyboard and screen-reader toggle with honest expanded state", () => {
    mount(createElement(ConversationResponse, { foldable: true }, LONG_ANSWER));
    const fold = surface();
    const toggle = fold.querySelector<HTMLButtonElement>("button[aria-expanded]");
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute("aria-expanded")).toBe("true");
    expect(toggle!.textContent).toBe("收起");

    act(() => toggle!.click());
    expect(fold.dataset.folded).toBe("true");
    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
    expect(toggle!.textContent).toBe("展开全文");

    act(() => toggle!.click());
    expect(fold.dataset.folded).toBe("false");
  });

  it("keeps fold state across rerenders but restores full text when content changes", () => {
    mount(createElement(ConversationResponse, { foldable: true }, LONG_ANSWER));
    const fold = surface();
    act(() => surface().querySelector<HTMLButtonElement>("button")!.click());
    expect(fold.dataset.folded).toBe("true");

    // Same answer identity/content: a rerender must not expand it again.
    act(() => root!.render(createElement(ConversationResponse, { foldable: true }, LONG_ANSWER)));
    expect(fold.dataset.folded).toBe("true");

    // New content: the fold restores the full answer text.
    act(() => root!.render(createElement(ConversationResponse, { foldable: true }, `${LONG_ANSWER}\n\n补充：排期已发给陈宇确认。`)));
    expect(surface().dataset.folded).toBe("false");
  });

  it("leaves short answers and forming replies as plain complete-safe text", () => {
    mount(createElement(ConversationResponse, { foldable: true }, "先把一页方案整理清楚。"));
    expect(host!.querySelector("[data-folded]")).toBeNull();
    expect(host!.querySelector("button[aria-expanded]")).toBeNull();
    expect(host!.textContent).toContain("先把一页方案整理清楚。");
  });

  it("never folds a forming streamed reply, even a long one", () => {
    // The streaming preview renders without `foldable`: a partial reply must
    // not look complete or hide its pending decisions behind a fold.
    mount(createElement(ConversationResponse, null, LONG_ANSWER));
    expect(host!.querySelector("[data-folded]")).toBeNull();
    expect(host!.querySelector("[data-fold-preview]")).toBeNull();
    expect(host!.querySelector("button[aria-expanded]")).toBeNull();
    expect(host!.textContent).toContain("陈宇负责设计协作。");
  });
});
