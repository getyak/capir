// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIDEBAR_LAYOUT_KEY } from "@/lib/workspace-sidebar-layout";
import { WORKSPACE_RAIL_COLLAPSED_KEY } from "@/lib/workspace-navigation";
import { WorkspaceShellFrame } from "./workspace-shell-frame";

let root: Root;
let host: HTMLDivElement;
let mobile = false;
let mediaListeners: Set<() => void>;
let captures: Set<number>;
const edge = () => host.querySelector<HTMLDivElement>('[role="separator"]')!;
const sidebar = () => host.querySelector('aside')!;
const width = () => Number(edge().getAttribute("aria-valuenow"));
const saved = () => JSON.parse(window.localStorage.getItem(SIDEBAR_LAYOUT_KEY)!);

async function render() {
  await act(async () => root.render(
    <WorkspaceShellFrame sidebar={<button>Account</button>}>
      <main>Conversation</main>
    </WorkspaceShellFrame>,
  ));
}
async function pointer(type: string, clientX: number, options: PointerEventInit = {}) {
  await act(async () => edge().dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, clientX, ...options,
  })));
}
async function key(value: string) {
  await act(async () => edge().dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  mobile = false;
  mediaListeners = new Set();
  captures = new Set();
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({
    get matches() { return mobile; },
    addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
  }) as unknown as MediaQueryList);
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: (id: number) => captures.add(id) },
    hasPointerCapture: { configurable: true, value: (id: number) => captures.has(id) },
    releasePointerCapture: { configurable: true, value: (id: number) => captures.delete(id) },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => window.dispatchEvent(new StorageEvent("storage")));
  await act(async () => root.unmount());
  host.remove();
});

describe("desktop sidebar split", () => {
  it("previews a drag and only persists its final width, including reload", async () => {
    await render();
    await pointer("pointerdown", 248);
    await pointer("pointermove", 320);
    expect(width()).toBe(320);
    expect(window.localStorage.getItem(SIDEBAR_LAYOUT_KEY)).toBeNull();
    await pointer("pointerup", 320);
    expect(saved()).toEqual({ width: 320, hidden: false, collapsed: false });
    expect(captures.size).toBe(0);
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(width()).toBe(320);
  });

  it("hides at the threshold and restores by dragging from the same left edge", async () => {
    await render();
    await pointer("pointerdown", 248);
    await pointer("pointermove", 140);
    expect(width()).toBe(0);
    expect(sidebar().hasAttribute("inert")).toBe(true);
    expect(sidebar().getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(edge());
    await pointer("pointerup", 140);
    expect(saved().width).toBe(248);
    await pointer("pointerdown", 0);
    await pointer("pointermove", 300);
    await pointer("pointerup", 300);
    expect(width()).toBe(300);
    expect(sidebar().hasAttribute("inert")).toBe(false);
    expect(saved().hidden).toBe(false);
  });

  it.each(["pointercancel", "lostpointercapture", "Escape"])("cancels a resize on %s without saving it", async cancellation => {
    await render();
    await pointer("pointerdown", 248);
    await pointer("pointermove", 350);
    if (cancellation === "Escape") await key("Escape");
    else await pointer(cancellation, 350);
    expect(width()).toBe(248);
    expect(window.localStorage.getItem(SIDEBAR_LAYOUT_KEY)).toBeNull();
    expect(captures.size).toBe(0);
    await pointer("pointerup", 350);
    expect(width()).toBe(248);
  });

  it("supports keyboard resizing, hiding and restoring the last useful width", async () => {
    await render();
    await key("ArrowRight"); expect(width()).toBe(264);
    await key("Home"); expect(width()).toBe(0);
    await key("Enter"); expect(width()).toBe(264);
    await key("End"); expect(width()).toBeLessThanOrEqual(420);
    await key("Home");
    await act(async () => edge().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(width()).toBeGreaterThanOrEqual(200);
    await key("Home"); await key("ArrowRight"); expect(width()).toBe(200);
    await key("ArrowLeft"); expect(width()).toBe(0);
  });

  it("honors the old compact-rail preference and can drag it back to full width", async () => {
    window.localStorage.setItem(WORKSPACE_RAIL_COLLAPSED_KEY, "true");
    await render(); expect(width()).toBe(72);
    await pointer("pointerdown", 72); await pointer("pointermove", 280); await pointer("pointerup", 280);
    expect(width()).toBe(280);
    expect(window.localStorage.getItem(WORKSPACE_RAIL_COLLAPSED_KEY)).toBe("false");
  });

  it("keeps mobile navigation available after a desktop hide, including viewport changes", async () => {
    await render(); await key("Home");
    mobile = true;
    await act(async () => mediaListeners.forEach(listener => listener()));
    expect(sidebar().hasAttribute("inert")).toBe(false);
    expect(sidebar().hasAttribute("aria-hidden")).toBe(false);
    expect(host.firstElementChild?.getAttribute("data-sidebar-hidden")).toBe("false");
    mobile = false;
    await act(async () => mediaListeners.forEach(listener => listener()));
    expect(sidebar().hasAttribute("inert")).toBe(true);
  });

  it("ignores non-primary pointers and clamps width to leave room for the conversation", async () => {
    await render();
    await pointer("pointerdown", 248, { button: 2 }); await pointer("pointermove", 400); await pointer("pointerup", 400);
    expect(width()).toBe(248);
    await pointer("pointerdown", 248, { isPrimary: false }); await pointer("pointermove", 400); await pointer("pointerup", 400);
    expect(width()).toBe(248);
    Object.defineProperty(host.firstElementChild, "clientWidth", { value: 761 });
    await pointer("pointerdown", 248); await pointer("pointermove", 1000); await pointer("pointerup", 1000);
    expect(width()).toBe(401);
  });

  it("adapts a saved wide sidebar when the desktop window becomes narrower", async () => {
    window.localStorage.setItem(SIDEBAR_LAYOUT_KEY, '{"width":420,"hidden":false}');
    await render();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(761);
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(width()).toBe(401);
    expect(edge().getAttribute("aria-valuemax")).toBe("401");
    expect(saved().width).toBe(420);
  });

  it("rejects corrupt stored sizes and follows cross-window preferences", async () => {
    window.localStorage.setItem(SIDEBAR_LAYOUT_KEY, '{"width":"9999","hidden":"true"}');
    await render(); expect(width()).toBe(248);
    window.localStorage.setItem(SIDEBAR_LAYOUT_KEY, '{"width":9999,"hidden":false}');
    await act(async () => window.dispatchEvent(new StorageEvent("storage")));
    expect(width()).toBe(420);
  });

  it("keeps hide and recovery usable in memory when browser storage is denied", async () => {
    await render();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("denied"); });
    await key("Home"); expect(width()).toBe(0);
    await key("Enter"); expect(width()).toBe(248);
    await key("ArrowRight"); expect(width()).toBe(264);
  });
});
