// @vitest-environment happy-dom
//
// Suggestion-menu geometry on the shared composer. The popup is anchored to the
// outer composer shell and must fit the region a reader can actually see: the
// visual viewport intersected with every clipping ancestor's scrollport. The
// production effect assigns `data-side`/`maxHeight`; those observable values are
// asserted against the resident 390x844 evidence (clip 185..766, outer composer
// 442..570, editor inside it 462..620), never against CSS strings.

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./workspace-search", () => ({
  useWorkspaceDirectory: () => ({
    data: { people: { people: [] } },
    loading: false,
    failed: false,
    retry: vi.fn(),
  }),
}));

import { WorkspaceComposer } from "./workspace-composer";
import styles from "./workspace-composer.module.css";

type Rect = { top: number; bottom: number };

/** Resident evidence geometry. */
const GAP = 8;
const CANVAS: Rect = { top: 185, bottom: 766 };
const OUTER: Rect = { top: 442, bottom: 570 };
const EDITOR: Rect = { top: 462, bottom: 620 };
const WRONG_ORIGIN_MAX = 261; // 462 - GAP - (185 + GAP)
const RIGHT_MAX = 241; // 442 - GAP - (185 + GAP)

function mockBox(element: Element, rect: Rect): void {
  element.getBoundingClientRect = () =>
    ({
      top: rect.top,
      bottom: rect.bottom,
      height: rect.bottom - rect.top,
      left: 0,
      right: 390,
      width: 390,
      x: 0,
      y: rect.top,
      toJSON: () => ({}),
    }) as unknown as DOMRect;
  Object.defineProperty(element, "clientTop", {
    value: 0,
    configurable: true,
  });
  Object.defineProperty(element, "clientHeight", {
    value: rect.bottom - rect.top,
    configurable: true,
  });
}

type FakeObserver = {
  callback: ResizeObserverCallback;
  targets: Set<Element>;
  disconnected: boolean;
};

const observers: FakeObserver[] = [];
const windowAdded: Array<{ type: string; fn: EventListenerOrEventListenerObject }> = [];
const windowRemoved: Array<{ type: string; fn: EventListenerOrEventListenerObject }> = [];
const viewportAdded: Array<{ type: string; fn: EventListenerOrEventListenerObject }> = [];
const viewportRemoved: Array<{ type: string; fn: EventListenerOrEventListenerObject }> = [];
let viewport: {
  offsetTop: number;
  height: number;
  addEventListener: (type: string, fn: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, fn: EventListenerOrEventListenerObject) => void;
};

let canvas: HTMLDivElement;
let root: Root | null = null;
const submit = vi.fn();

function Harness() {
  const [value, setValue] = useState("/");
  return (
    <WorkspaceComposer
      binding="account-one"
      canSubmit
      id="editor"
      label="消息"
      maxLength={1000}
      onNavigate={() => {}}
      onSubmit={submit}
      onValueChange={setValue}
      placeholder="输入"
      variant="home"
      value={value}
    />
  );
}

function menu(): HTMLDivElement {
  return canvas.querySelector<HTMLDivElement>(`.${styles.menu}`)!;
}

function assignedMaxHeight(): number {
  return Number.parseFloat(menu().style.maxHeight);
}

/** Open the slash menu with keyboard caret state, like the real editor. */
async function openMenu(): Promise<HTMLTextAreaElement> {
  const textarea = canvas.querySelector("textarea")!;
  await act(async () => {
    textarea.setSelectionRange(1, 1);
    textarea.focus();
  });
  expect(menu()).toBeTruthy();
  return textarea;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observers.length = 0;
  windowAdded.length = 0;
  windowRemoved.length = 0;
  viewportAdded.length = 0;
  viewportRemoved.length = 0;
  viewport = {
    offsetTop: 0,
    height: 844,
    addEventListener: (type, fn) => viewportAdded.push({ type, fn }),
    removeEventListener: (type, fn) => viewportRemoved.push({ type, fn }),
  };
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      targets = new Set<Element>();
      disconnected = false;
      constructor(public callback: ResizeObserverCallback) {
        observers.push(this);
      }
      observe(target: Element) {
        this.targets.add(target);
      }
      unobserve() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  );
  vi.spyOn(window, "addEventListener").mockImplementation((type, fn) => {
    windowAdded.push({ type, fn });
  });
  vi.spyOn(window, "removeEventListener").mockImplementation((type, fn) => {
    windowRemoved.push({ type, fn });
  });
  Object.defineProperty(window, "innerWidth", {
    value: 390,
    configurable: true,
  });
  submit.mockClear();
  canvas = document.createElement("div");
  canvas.style.overflowY = "auto";
  mockBox(canvas, CANVAS);
  document.body.append(canvas);
  root = createRoot(canvas);
  await act(async () => {
    root?.render(<Harness />);
  });
  const composer = canvas.querySelector(`.${styles.composer}`)!;
  mockBox(composer, OUTER);
  mockBox(composer.querySelector("textarea")!.parentElement!, EDITOR);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  canvas.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("anchors the popup to the outer composer and keeps selected-first geometry inside the clip region", async () => {
  await openMenu();
  const popup = menu();
  // Observable placement: the production effect must budget from the outer
  // composer (442), not the editor inside it (462), and honour the clip top.
  expect(popup.dataset.side).toBe("above");
  expect(assignedMaxHeight()).toBe(RIGHT_MAX);
  const menuTop = OUTER.top - GAP - assignedMaxHeight();
  const menuBottom = OUTER.top - GAP;
  expect(menuTop).toBeGreaterThanOrEqual(CANVAS.top);
  expect(menuBottom).toBeLessThanOrEqual(CANVAS.bottom);
  // First aria-selected option sits below the list padding (border 1 + 6).
  const optionTop = menuTop + 7;
  expect(optionTop).toBeGreaterThanOrEqual(CANVAS.top);
  expect(optionTop + 57).toBeLessThanOrEqual(CANVAS.bottom);
  // The 462 editor origin is the wrong anchor: its 261 budget lands at 173,
  // which the clipping canvas erases even though the viewport is 844 tall.
  expect(OUTER.top - GAP - WRONG_ORIGIN_MAX).toBeLessThan(CANVAS.top);
  expect(assignedMaxHeight()).toBeLessThan(WRONG_ORIGIN_MAX);
});

it("repositions an open popup when a clipping ancestor is resized by a health banner", async () => {
  await openMenu();
  const positionObserver = observers.find((observer) =>
    observer.targets.has(canvas),
  );
  expect(positionObserver).toBeDefined();
  // A banner pushes the canvas clip top from 185 down to 260.
  mockBox(canvas, { top: 260, bottom: CANVAS.bottom });
  await act(async () => {
    positionObserver!.callback([], positionObserver as unknown as ResizeObserver);
  });
  const popup = menu();
  expect(popup.dataset.side).toBe("below");
  expect(assignedMaxHeight()).toBe(180);
  const menuTop = OUTER.bottom + GAP;
  expect(menuTop + assignedMaxHeight()).toBeLessThanOrEqual(CANVAS.bottom);
});

it("keeps keyboard focus in the editor while the menu is open and after choosing", async () => {
  const textarea = await openMenu();
  expect(document.activeElement).toBe(textarea);
  await act(async () => {
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  await act(async () => {
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(textarea);
  expect(textarea.value).toContain("跟进消息");
  expect(submit).not.toHaveBeenCalled();
});

it("disconnects the popup observers and listeners on close and unmount", async () => {
  const textarea = await openMenu();
  const positionObserver = observers.find((observer) =>
    observer.targets.has(canvas),
  );
  expect(positionObserver).toBeDefined();
  await act(async () => {
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(positionObserver!.disconnected).toBe(true);
  for (const entry of windowAdded.filter((item) => item.type === "scroll")) {
    expect(windowRemoved).toContainEqual(entry);
  }
  for (const entry of viewportAdded.filter((item) => item.type === "scroll")) {
    expect(viewportRemoved).toContainEqual(entry);
  }
  await act(async () => root?.unmount());
  root = null;
  for (const observer of observers) expect(observer.disconnected).toBe(true);
  for (const entry of windowAdded) expect(windowRemoved).toContainEqual(entry);
  for (const entry of viewportAdded) expect(viewportRemoved).toContainEqual(entry);
});

it("keeps keyboard selection when layout crosses a stationary pointer, then follows real mouse movement", async () => {
  const textarea = await openMenu();
  const options = Array.from(menu().querySelectorAll('[role="option"]'));
  await act(async () => {
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  expect(options[1].getAttribute("aria-selected")).toBe("true");
  // Scrolling/reflow can put another option under a stationary mouse. Entering
  // its boundary alone must not replace the keyboard's current selection.
  await act(async () => {
    options[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  expect(options[1].getAttribute("aria-selected")).toBe("true");
  await act(async () => {
    options[0].dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "touch" }));
  });
  expect(options[1].getAttribute("aria-selected")).toBe("true");
  await act(async () => {
    options[0].dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
  });
  expect(options[0].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(textarea);
  expect(submit).not.toHaveBeenCalled();
});
