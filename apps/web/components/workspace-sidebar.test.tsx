// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSidebarShell } from "./workspace-sidebar";
import { setRailRevealed } from "@/lib/workspace-rail-preference";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  setRailRevealed(false);
  window.localStorage.clear();
  window.localStorage.setItem("talent-signal:workspace-rail-collapsed", "true");
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width: 761px"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  void original;
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.useRealTimers();
});

function mount() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(WorkspaceSidebarShell, null, createElement("nav", { "aria-label": "probe" }, "rail")),
    );
  });
  return host;
}

function aside(): HTMLElement {
  return host!.querySelector<HTMLElement>("aside[aria-label='Talent Signal 工作台']")!;
}

function strip(): HTMLElement | null {
  return host!.querySelector<HTMLElement>(":scope > div[aria-hidden='true']");
}

function fire(
  target: EventTarget,
  type: string,
  extra: { relatedTarget?: Node | null } = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  if ("relatedTarget" in extra) {
    Object.defineProperty(event, "relatedTarget", {
      value: extra.relatedTarget ?? null,
    });
  }
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** React synthesizes pointerenter/leave from pointerover/out. */
function hover(target: EventTarget, enters: boolean) {
  fire(target, enters ? "pointerover" : "pointerout", {
    relatedTarget: document.body,
  });
}

describe("collapsed rail with floating edge-hover reveal", () => {
  it("floats the expanded sidebar on edge hover without touching the persisted preference", () => {
    mount();
    expect(aside().dataset.floating).toBeUndefined();
    expect(strip()).not.toBeNull();

    hover(strip()!, true);
    expect(aside().dataset.floating).toBe("true");
    // The reveal never writes the collapse preference.
    expect(window.localStorage.getItem("talent-signal:workspace-rail-collapsed")).toBe("true");
  });

  it("closes after a short grace when the pointer leaves, and on Escape", () => {
    vi.useFakeTimers();
    mount();
    hover(strip()!, true);
    expect(aside().dataset.floating).toBe("true");

    hover(aside(), false);
    expect(aside().dataset.floating).toBe("true");
    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(aside().dataset.floating).toBeUndefined();

    hover(strip()!, true);
    expect(aside().dataset.floating).toBe("true");
    fire(window, "keydown", {});
    // Escape needs a real key; dispatch through a KeyboardEvent below.
    expect(aside().dataset.floating).toBe("true");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(aside().dataset.floating).toBeUndefined();
  });

  it("reveals on keyboard focus and closes when focus truly leaves", () => {
    vi.useFakeTimers();
    mount();
    const link = document.createElement("a");
    link.href = "#";
    aside().append(link);
    fire(aside(), "focusin");
    expect(aside().dataset.floating).toBe("true");

    fire(aside(), "focusout", { relatedTarget: document.body });
    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(aside().dataset.floating).toBeUndefined();

    // Focus moving within the sidebar never closes the reveal.
    fire(aside(), "focusin");
    fire(aside(), "focusout", { relatedTarget: link });
    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(aside().dataset.floating).toBe("true");
  });

  it("keeps the expanded rail static with no edge strip and no floating state", () => {
    window.localStorage.setItem("talent-signal:workspace-rail-collapsed", "false");
    mount();
    expect(strip()).toBeNull();
    hover(aside(), true);
    expect(aside().dataset.floating).toBeUndefined();
  });

  it("targets the real spring widths: 236 expanded, 56 collapsed", async () => {
    mount();
    expect(aside().style.getPropertyValue("--sidebar-rail-width")).toBe("56px");
    window.localStorage.setItem("talent-signal:workspace-rail-collapsed", "false");
    act(() => {
      window.dispatchEvent(new Event("talent-signal:workspace-rail-preference"));
    });
    // The interruptible spring animates the width to the expanded target.
    await vi.waitFor(
      () => {
        expect(aside().style.getPropertyValue("--sidebar-rail-width")).toBe("236px");
      },
      { timeout: 4000 },
    );
  });
});
