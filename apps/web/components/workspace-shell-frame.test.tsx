// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIDEBAR_LAYOUT_KEY } from "@/lib/workspace-sidebar-layout";
import { WORKSPACE_RAIL_COLLAPSED_KEY } from "@/lib/workspace-navigation";
import { WorkspaceShellFrame } from "./workspace-shell-frame";
import styles from "./workspace-shell.module.css";

let root: Root;
let host: HTMLDivElement;
let mobile = false;
let mediaListeners: Set<() => void>;
let captures: Set<number>;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const edge = () => host.querySelector<HTMLDivElement>('[role="separator"]')!;
const sidebar = () => host.querySelector('aside')!;
const width = () => Number(edge().getAttribute("aria-valuenow"));
const saved = () => JSON.parse(window.localStorage.getItem(SIDEBAR_LAYOUT_KEY)!);

async function render(surface: "route" | "conversation" | "legacy" | "error" | "loading" = "route") {
  await act(async () => root.render(
    <WorkspaceShellFrame sidebar={<button data-sidebar-collapse-toggle>Account</button>}>
      <div className={styles.workspace}>
        {surface === "route" || surface === "legacy" ? <header className={styles.routeHeader} style={surface === "legacy" ? { display: "none" } : undefined}>Workspace</header> : null}
        <div className={styles.stage}>
          <aside aria-label="Test workspace">Synthetic data ready</aside>
          {surface === "conversation" ? <main data-conversation-canvas><header>Conversation</header></main>
            : surface === "legacy" ? <div className="context-workspace"><main><header className="context-topbar">Relationship</header></main></div>
              : surface === "error" ? <section role="alert">Session unavailable</section>
                : surface === "loading" ? <section role="status">Loading Session</section>
                  : <main>People</main>}
        </div>
      </div>
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
async function paint() {
  await act(async () => {
    const current = [...frames.values()];
    frames.clear();
    current.forEach(callback => callback(performance.now()));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  window.history.replaceState(null, "", "/workspace");
  mobile = false;
  mediaListeners = new Set();
  captures = new Set();
  frames = new Map();
  nextFrame = 0;
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(frame => { frames.delete(frame); });
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
  it.each([140, 320])("restores the starting width when a drag returns from %s", async destination => {
    await render();
    await pointer("pointerdown", 236);
    await pointer("pointermove", destination);
    await pointer("pointermove", 236);
    await pointer("pointerup", 236);
    expect(width()).toBe(236);
    expect(saved()).toEqual({ width: 236, hidden: false, collapsed: false });
  });

  it("previews a drag and only persists its final width, including reload", async () => {
    await render();
    await pointer("pointerdown", 236);
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
    await pointer("pointerdown", 236);
    await pointer("pointermove", 140);
    expect(width()).toBe(0);
    expect(sidebar().hasAttribute("inert")).toBe(true);
    expect(sidebar().getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(edge());
    await pointer("pointerup", 140);
    expect(saved().width).toBe(236);
    await pointer("pointerdown", 0);
    await pointer("pointermove", 300);
    await pointer("pointerup", 300);
    expect(width()).toBe(300);
    expect(sidebar().hasAttribute("inert")).toBe(false);
    expect(saved().hidden).toBe(false);
  });

  it.each(["pointercancel", "lostpointercapture", "Escape"])("cancels a resize on %s without saving it", async cancellation => {
    await render();
    await pointer("pointerdown", 236);
    await pointer("pointermove", 350);
    if (cancellation === "Escape") await key("Escape");
    else await pointer(cancellation, 350);
    expect(width()).toBe(236);
    expect(window.localStorage.getItem(SIDEBAR_LAYOUT_KEY)).toBeNull();
    expect(captures.size).toBe(0);
    await pointer("pointerup", 350);
    expect(width()).toBe(236);
  });

  it("supports keyboard resizing, hiding and restoring the last useful width", async () => {
    await render();
    await key("ArrowRight"); expect(width()).toBe(252);
    await key("Home"); expect(width()).toBe(0);
    await key("Enter"); expect(width()).toBe(252);
    await key("End"); expect(width()).toBeLessThanOrEqual(420);
    await key("Home");
    await act(async () => edge().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(width()).toBeGreaterThanOrEqual(200);
    await key("Home"); await key("ArrowRight"); expect(width()).toBe(200);
    await key("ArrowLeft"); expect(width()).toBe(0);
  });

  it("offers a visible restore control and returns focus to the expanded sidebar without changing its saved width", async () => {
    await render();
    expect(host.querySelector('button[aria-label="显示侧边栏"]')).toBeNull();
    await key("ArrowRight");
    await key("Home");
    const restore = host.querySelector<HTMLButtonElement>('button[aria-label="显示侧边栏"]')!;
    expect(restore.getAttribute("aria-controls")).toBe(sidebar().id);
    expect(restore.getAttribute("aria-expanded")).toBe("false");
    restore.focus();
    await act(async () => restore.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await paint();
    expect(width()).toBe(252);
    expect(saved()).toEqual({ width: 252, hidden: false, collapsed: false });
    expect(sidebar().hasAttribute("inert")).toBe(false);
    expect(host.querySelector('button[aria-label="显示侧边栏"]')).toBeNull();
    expect(document.activeElement).toBe(sidebar().querySelector("[data-sidebar-collapse-toggle]"));
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(width()).toBe(252);
  });

  it.each(["route", "conversation", "legacy"] as const)("places restoration in the actual %s header instead of over a preceding test banner", async surface => {
    await render(surface);
    await key("Home");
    const restore = host.querySelector<HTMLButtonElement>('button[aria-label="显示侧边栏"]')!;
    const expected = surface === "conversation" ? "[data-conversation-canvas] > header"
      : surface === "legacy" ? ".context-topbar" : `.${styles.routeHeader}`;
    expect(restore.parentElement).toBe(host.querySelector(expected));
    expect(host.querySelector('aside[aria-label="Test workspace"]')?.contains(restore)).toBe(false);
    expect(restore.closest(`.${styles.shell}`)).toBe(host.firstElementChild);
  });

  it("follows a replaced working header while the saved sidebar remains hidden", async () => {
    await render("legacy");
    await key("Home");
    const initial = host.querySelector('button[aria-label="显示侧边栏"]')!;
    expect(initial.parentElement?.className).toBe("context-topbar");
    await render("conversation");
    expect(host.querySelector('button[aria-label="显示侧边栏"]')?.parentElement)
      .toBe(host.querySelector("[data-conversation-canvas] > header"));
    expect(host.querySelectorAll('button[aria-label="显示侧边栏"]')).toHaveLength(1);
    expect(saved().hidden).toBe(true);
  });

  it("ignores an inactive header beneath an aria-hidden ancestor", async () => {
    await act(async () => root.render(
      <WorkspaceShellFrame sidebar={<button data-sidebar-collapse-toggle>Account</button>}>
        <div className={styles.workspace}>
          <section aria-hidden="true"><main data-conversation-canvas><header>Inactive Session</header></main></section>
          <div className={styles.stage}><div className="context-workspace"><header className="context-topbar">Current relationship</header></div></div>
        </div>
      </WorkspaceShellFrame>,
    ));
    await key("Home");
    expect(host.querySelector('button[aria-label="显示侧边栏"]')?.parentElement)
      .toBe(host.querySelector(".context-topbar"));
  });

  it.each(["error", "loading"] as const)("keeps restoration in a separate chrome row on a headerless %s page", async surface => {
    await render(surface);
    await key("Home");
    const fallback = host.querySelector("[data-sidebar-restore-fallback]")!;
    const restore = fallback.querySelector<HTMLButtonElement>('button[aria-label="显示侧边栏"]')!;
    expect(fallback.parentElement).toBe(host.querySelector(`.${styles.workspace}`));
    expect(host.querySelector(`.${styles.stage}`)?.contains(fallback)).toBe(false);
    expect(host.querySelector('aside[aria-label="Test workspace"]')?.contains(restore)).toBe(false);
    await act(async () => restore.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await paint();
    expect(width()).toBe(236);
    expect(host.querySelector("[data-sidebar-restore-fallback]")).toBeNull();
    expect(document.activeElement).toBe(sidebar().querySelector("[data-sidebar-collapse-toggle]"));
  });

  it("moves between headerless recovery and actual chrome while the saved sidebar remains hidden", async () => {
    await render("error");
    await key("Home");
    await render("conversation");
    expect(host.querySelector("[data-sidebar-restore-fallback]")).toBeNull();
    expect(host.querySelector('button[aria-label="显示侧边栏"]')?.parentElement)
      .toBe(host.querySelector("[data-conversation-canvas] > header"));
    await render("loading");
    expect(host.querySelectorAll('button[aria-label="显示侧边栏"]')).toHaveLength(1);
    expect(host.querySelector('button[aria-label="显示侧边栏"]')?.parentElement)
      .toBe(host.querySelector("[data-sidebar-restore-fallback]"));
    expect(saved().hidden).toBe(true);
  });

  it("retries a focus request rejected while the browser applies the restored inert state", async () => {
    await render();
    await key("Home");
    const toggle = sidebar().querySelector<HTMLButtonElement>("[data-sidebar-collapse-toggle]")!;
    const actualFocus = toggle.focus.bind(toggle);
    const focus = vi.spyOn(toggle, "focus").mockImplementationOnce(() => {}).mockImplementation(actualFocus);
    await act(async () => host.querySelector('button[aria-label="显示侧边栏"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(focus).not.toHaveBeenCalled();
    await paint();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(toggle);
    await paint();
    expect(document.activeElement).toBe(toggle);
    await paint();
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it("does not take focus back from a later user choice", async () => {
    await render();
    await key("Home");
    await act(async () => host.querySelector('button[aria-label="显示侧边栏"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const other = document.createElement("button");
    other.textContent = "Continue working";
    host.append(other);
    other.focus();
    await paint();
    expect(document.activeElement).toBe(other);
    expect(frames.size).toBe(0);
  });

  it("cancels deferred restoration when the sidebar is hidden again", async () => {
    await render();
    await key("Home");
    await act(async () => host.querySelector('button[aria-label="显示侧边栏"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await key("Home");
    await paint();
    expect(sidebar().inert).toBe(true);
    expect(document.activeElement).not.toBe(sidebar().querySelector("[data-sidebar-collapse-toggle]"));
    expect(frames.size).toBe(0);
  });

  it.each(["route", "pointer", "blur", "mobile"] as const)("cancels a deferred request after a later %s change", async change => {
    await render();
    await key("Home");
    const toggle = sidebar().querySelector<HTMLButtonElement>("[data-sidebar-collapse-toggle]")!;
    const focus = vi.spyOn(toggle, "focus");
    await act(async () => host.querySelector('button[aria-label="显示侧边栏"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })));
    if (change === "route") window.history.pushState(null, "", "/workspace/sessions/another");
    if (change === "pointer") document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    if (change === "blur") window.dispatchEvent(new Event("blur"));
    if (change === "mobile") {
      mobile = true;
      await act(async () => mediaListeners.forEach(listener => listener()));
    }
    await paint();
    expect(focus).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("bounds native focus rejection to three frames", async () => {
    await render();
    await key("Home");
    const toggle = sidebar().querySelector<HTMLButtonElement>("[data-sidebar-collapse-toggle]")!;
    const focus = vi.spyOn(toggle, "focus").mockImplementation(() => {});
    await act(async () => host.querySelector('button[aria-label="显示侧边栏"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })));
    for (let count = 0; count < 4; count++) await paint();
    expect(focus).toHaveBeenCalledTimes(3);
    expect(frames.size).toBe(0);
  });

  it("does not add fallback chrome to the independent review surface", async () => {
    await act(async () => root.render(
      <WorkspaceShellFrame sidebar={<button data-sidebar-collapse-toggle>Account</button>}>
        <div className={styles.workspace}><div className={styles.stage}><main className="review-workspace">Review</main></div></div>
      </WorkspaceShellFrame>,
    ));
    await key("Home");
    expect(host.querySelector("[data-sidebar-restore-fallback]")).toBeNull();
    expect(host.querySelector('button[aria-label="显示侧边栏"]')).toBeNull();
  });

  it("honors the old compact-rail preference and can drag it back to full width", async () => {
    window.localStorage.setItem(WORKSPACE_RAIL_COLLAPSED_KEY, "true");
    await render(); expect(width()).toBe(72);
    await pointer("pointerdown", 72); await pointer("pointermove", 280); await pointer("pointerup", 280);
    expect(width()).toBe(280);
    expect(window.localStorage.getItem(WORKSPACE_RAIL_COLLAPSED_KEY)).toBe("false");
  });

  it.each([224, 248, 320])("retains a saved %spx width with navigation labels available", async savedWidth => {
    window.localStorage.setItem(SIDEBAR_LAYOUT_KEY, JSON.stringify({ width: savedWidth, hidden: false }));
    await render();
    expect(width()).toBe(savedWidth);
    expect(host.firstElementChild?.getAttribute("data-sidebar-compact")).toBe("false");
    await key("Home");
    await key("Enter");
    expect(width()).toBe(savedWidth);
  });

  it("keeps mobile navigation available after a desktop hide, including viewport changes", async () => {
    await render(); await key("Home");
    expect(host.querySelector('button[aria-label="显示侧边栏"]')).not.toBeNull();
    mobile = true;
    await act(async () => mediaListeners.forEach(listener => listener()));
    expect(sidebar().hasAttribute("inert")).toBe(false);
    expect(sidebar().hasAttribute("aria-hidden")).toBe(false);
    expect(host.firstElementChild?.getAttribute("data-sidebar-hidden")).toBe("false");
    expect(host.querySelector('button[aria-label="显示侧边栏"]')).toBeNull();
    mobile = false;
    await act(async () => mediaListeners.forEach(listener => listener()));
    expect(sidebar().hasAttribute("inert")).toBe(true);
  });

  it("ignores non-primary pointers and clamps width to leave room for the conversation", async () => {
    await render();
    await pointer("pointerdown", 236, { button: 2 }); await pointer("pointermove", 400); await pointer("pointerup", 400);
    expect(width()).toBe(236);
    await pointer("pointerdown", 236, { isPrimary: false }); await pointer("pointermove", 400); await pointer("pointerup", 400);
    expect(width()).toBe(236);
    Object.defineProperty(host.firstElementChild, "clientWidth", { value: 761 });
    await pointer("pointerdown", 236); await pointer("pointermove", 1000); await pointer("pointerup", 1000);
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
    await render(); expect(width()).toBe(236);
    window.localStorage.setItem(SIDEBAR_LAYOUT_KEY, '{"width":9999,"hidden":false}');
    await act(async () => window.dispatchEvent(new StorageEvent("storage")));
    expect(width()).toBe(420);
  });

  it("keeps hide and recovery usable in memory when browser storage is denied", async () => {
    await render();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("denied"); });
    await key("Home"); expect(width()).toBe(0);
    await key("Enter"); expect(width()).toBe(236);
    await key("ArrowRight"); expect(width()).toBe(252);
  });

  it("preserves in-memory sizing across unrelated storage events when writes fail", async () => {
    await render();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await key("Home"); expect(width()).toBe(0);
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "theme" })));
    expect(width()).toBe(0);
    await key("Enter"); await key("ArrowRight");
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "locale" })));
    expect(width()).toBe(252);
  });
});
