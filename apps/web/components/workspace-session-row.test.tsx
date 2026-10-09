// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_ORGANIZATION_PREFIX,
  resetSessionOrganizationStores,
} from "@/lib/workspace-session-organization";
import {
  WorkspaceSessionRow,
  type SessionRowOrganization,
} from "./workspace-session-row";
import { WorkspaceRecentSessions } from "./workspace-recent-sessions";

const directory = vi.hoisted(() => ({
  data: null as unknown,
  loading: false,
  failed: false,
  retry: vi.fn(),
}));
vi.mock("./workspace-search", () => ({
  useWorkspaceDirectory: () => directory,
  WorkspaceGlobalSearchDialog: () => null,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SCOPE = "c".repeat(64);

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  window.localStorage.clear();
  resetSessionOrganizationStores();
  directory.data = {
    sessions: {
      session_version: "binding",
      sessions: [
        { session_id: SESSION_A, state: "active", title: "准备下周沟通", expires_at: "2030-01-01T00:00:00Z", is_unread: false },
        { session_id: SESSION_B, state: "active", title: "整理试点记录", expires_at: "2030-01-01T00:00:00Z", is_unread: false },
      ],
    },
  };
  directory.loading = false;
  directory.failed = false;
});

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

function pointer(target: EventTarget, type: string, x: number, y = 40) {
  let notCanceled = true;
  act(() => {
    notCanceled = target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }),
    );
  });
  return notCanceled;
}

function mountRow(organization: Partial<SessionRowOrganization> = {}) {
  const onToggle = vi.fn();
  mount(
    createElement(
      WorkspaceSessionRow,
      {
        organization: {
          archived: false,
          pinned: false,
          onToggle,
          rowLabel: "准备下周沟通",
          ...organization,
        },
      },
      createElement("a", { href: "/workspace/sessions/x" }, "准备下周沟通"),
    ),
  );
  const shell = host!.querySelector<HTMLElement>("[data-open]")!;
  const slide = shell.querySelector<HTMLElement>("a")!.parentElement!;
  return { onToggle, shell, slide };
}

describe("swipe-to-organize session rows", () => {
  it("opens from a horizontal trackpad wheel and keeps the first action clickable", async () => {
    const { shell, onToggle } = mountRow();
    const event = new WheelEvent("wheel", { deltaX: 110, deltaY: 0, bubbles: true, cancelable: true });
    act(() => shell.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 160)); });
    expect(shell.dataset.open).toBe("true");
    act(() => shell.querySelector<HTMLButtonElement>('[data-action="archive"]')!.click());
    expect(onToggle).toHaveBeenCalledExactlyOnceWith("archived", true);
  });
  it("keeps hidden tray actions inert and cancels a pointer swipe without committing", () => {
    const { shell } = mountRow();
    expect(shell.querySelector('[aria-hidden="true"][inert]')).not.toBeNull();
    pointer(shell, "pointerdown", 140); pointer(shell, "pointermove", 20);
    pointer(shell, "pointercancel", 20);
    expect(shell.dataset.open).toBe("false");
    const event = new WheelEvent("wheel", { deltaX: 4, deltaY: 100, bubbles: true, cancelable: true });
    act(() => shell.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  });

  it("reveals Archive and Pin on a left swipe and suppresses the row click", async () => {
    const { shell, slide } = mountRow();
    expect(shell.dataset.open).toBe("false");

    pointer(shell, "pointerdown", 140);
    pointer(shell, "pointermove", 100);
    pointer(shell, "pointermove", 20);
    // 1:1 tracking: the row follows the pointer during the drag.
    await vi.waitFor(() => expect(slide.style.transform).toContain("translateX("));
    pointer(shell, "pointerup", 20);

    expect(shell.dataset.open).toBe("true");
    const actions = [...shell.querySelectorAll<HTMLButtonElement>("[data-action]")];
    expect(actions.map((button) => button.dataset.action)).toEqual(["pin", "archive"]);
    expect(actions[0]!.getAttribute("aria-label")).toBe("置顶：准备下周沟通");
    expect(actions[1]!.getAttribute("aria-label")).toBe("归档：准备下周沟通");

    // A finished swipe never also navigates the row.
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    let notCanceled = true;
    act(() => {
      notCanceled = shell.dispatchEvent(click);
    });
    expect(notCanceled).toBe(false);
    expect(click.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(slide.style.transform).toContain("-132px"));

  });

  it("keeps the named menu so the gesture is optional", () => {
    const { onToggle, shell } = mountRow({ pinned: true });
    const summary = shell.querySelector<HTMLElement>("summary")!;
    expect(summary.getAttribute("aria-label")).toBe("更多操作：准备下周沟通");
    act(() => summary.click());
    const items = [...shell.querySelectorAll<HTMLButtonElement>("details button")];
    expect(items.map((item) => item.textContent?.trim())).toEqual(["取消置顶", "归档"]);
    act(() => items[1]!.click());
    expect(onToggle).toHaveBeenCalledWith("archived", true);
    act(() => items[0]!.click());
    expect(onToggle).toHaveBeenLastCalledWith("pinned", false);
  });

  it("exposes the same named actions in the tray with honest state", () => {
    const { onToggle, shell } = mountRow({ archived: true });
    const actions = [...shell.querySelectorAll<HTMLButtonElement>("[data-action]")];
    expect(actions[0]!.getAttribute("aria-label")).toBe("置顶：准备下周沟通");
    expect(actions[1]!.getAttribute("aria-label")).toBe("恢复：准备下周沟通");
    act(() => actions[1]!.click());
    expect(onToggle).toHaveBeenCalledWith("archived", false);
  });
});

describe("local organization in the recent list", () => {
  function expand() {
    act(() => {
      host!.querySelector<HTMLButtonElement>("button[aria-controls]")!.click();
    });
  }

  it("keeps pinned rows first, archives locally and restores without losing the row", () => {
    const stamp = new Date().toISOString();
    window.localStorage.setItem(
      SESSION_ORGANIZATION_PREFIX + SCOPE,
      JSON.stringify({
        v: 1,
        scope: SCOPE,
        entries: {
          [SESSION_A]: { archived: true, pinned: true, updatedAt: stamp },
          [SESSION_B]: { archived: false, pinned: true, updatedAt: stamp },
        },
      }),
    );
    mount(createElement(WorkspaceRecentSessions, { binding: "binding", storageScope: SCOPE }));
    expand();

    const visibleLinks = [...host!.querySelectorAll<HTMLAnchorElement>('a[href^="/workspace/sessions/"]')]
      .filter((link) => link.getAttribute("data-archived") !== "true");
    expect(visibleLinks.map((link) => link.getAttribute("href"))).toEqual([
      `/workspace/sessions/${SESSION_B}`,
    ]);
    expect(visibleLinks[0]!.textContent).toContain("整理试点记录");
    // The archived conversation stays reachable in the labeled local archive.
    const archiveToggle = [...host!.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("已归档 · 本机整理"));
    expect(archiveToggle).toBeDefined();
    expect(archiveToggle!.textContent).toContain("（1）");
    act(() => archiveToggle!.click());
    const archivedLink = host!.querySelector<HTMLAnchorElement>('a[data-archived="true"]')!;
    expect(archivedLink).not.toBeNull();
    expect(archivedLink.getAttribute("href")).toBe(`/workspace/sessions/${SESSION_A}`);
    // Restore is a named accessible button — the gesture is never required.
    const restore = [...host!.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.getAttribute("aria-label")?.startsWith("恢复："));
    expect(restore).toBeDefined();
    act(() => restore!.click());
    expect(host!.textContent).toContain("准备下周沟通");
    expect(host!.querySelector('a[data-archived="true"]')).toBeNull();
  });

  it("falls back visibly to page-local flags when storage writes fail", () => {
    mount(createElement(WorkspaceRecentSessions, { binding: "binding", storageScope: SCOPE }));
    expand();
    const working = window.localStorage;
    const failing = {
      getItem: (key: string) => working.getItem(key),
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: (key: string) => working.removeItem(key),
      clear: () => working.clear(),
      key: (index: number) => working.key(index),
      get length() {
        return working.length;
      },
    } as unknown as Storage;
    Object.defineProperty(window, "localStorage", { configurable: true, value: failing });
    try {
      const pin = host!.querySelector<HTMLButtonElement>('[data-action="pin"]')!;
      act(() => pin.click());
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: working });
    }
    expect(host!.textContent).toContain("本机存储不可用 · 归档与置顶仅在本页保留");
    // The pin still applies for this page and is visible as pinned.
    expect(host!.querySelectorAll('a[aria-label$="（已置顶）"]').length).toBe(1);
  });
});
