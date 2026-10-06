// @vitest-environment happy-dom
//
// The composer add menu: unique ids, lazily loaded people directory, honest
// starter staging (never submit, never authority), nested-view keyboard flow,
// outside dismissal, and a portaled panel that keeps the workspace theme.

import { act, createElement, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useWorkspaceDirectoryMock } = vi.hoisted(() => ({
  useWorkspaceDirectoryMock: vi.fn(),
}));

vi.mock("@/components/workspace-search", () => ({
  useWorkspaceDirectory: useWorkspaceDirectoryMock,
}));

import { ComposerAddMenu } from "@/components/new-conversation-add-menu";
import { WORKSPACE_SLASH_COMMANDS } from "@/lib/workspace-composer";
import { AvatarPreferencesProvider } from "./avatar-preferences-provider";
import { createAvatarStore } from "@/lib/avatar-preferences";

const PEOPLE_PAYLOAD = {
  people: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      display_label: "陈晨",
      contexts: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          display_label: "合作洽谈",
        },
      ],
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      display_label: "林一",
      contexts: [],
    },
  ],
};

let mount: HTMLDivElement | null = null;
let root: Root | null = null;

function defaultProps() {
  return {
    binding: "binding-1",
    onCapture: vi.fn(),
    onNavigate: vi.fn(),
    onInsertText: vi.fn(),
    onAttachFiles: vi.fn(),
  };
}

async function render(
  node: (props: ReturnType<typeof defaultProps>) => ReactNode,
  wrapperClass?: string,
): Promise<ReturnType<typeof defaultProps>> {
  const props = defaultProps();
  mount = document.createElement("div");
  if (wrapperClass) mount.className = wrapperClass;
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => {
    root?.render(createElement("div", {}, node(props)));
  });
  return props;
}

async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

function trigger(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>("[data-add-trigger]")!;
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-add-panel]");
}

function rows(): HTMLButtonElement[] {
  return Array.from(
    panel()?.querySelectorAll<HTMLButtonElement>("[data-add-focus]") ?? [],
  );
}

function rowByLabel(text: string): HTMLButtonElement {
  const row = rows().find((button) => button.textContent?.includes(text));
  if (!row) throw new Error(`no row for ${text}`);
  return row;
}

async function openMenu(): Promise<void> {
  await act(async () => {
    trigger().click();
  });
  await flushFrame();
}

async function press(element: HTMLElement, key: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    element.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useWorkspaceDirectoryMock.mockImplementation(
    (_binding: string | null, enabled: boolean) => ({
      data: enabled
        ? { people: PEOPLE_PAYLOAD, sessions: { sessions: [] } }
        : null,
      loading: false,
      failed: false,
      retry: vi.fn(),
    }),
  );
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  mount?.remove();
  mount = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("composer add menu identity and semantics", () => {
  it("uses unique panel and group ids with no native title tooltips", async () => {
    await render((props) => [
      createElement(ComposerAddMenu, { key: "a", ...props }),
      createElement(ComposerAddMenu, { key: "b", ...props }),
    ]);
    const triggers = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-add-trigger]"),
    );
    expect(triggers).toHaveLength(2);

    // Each instance is opened in turn: an open menu legitimately dismisses
    // when focus moves into another one, so ids are captured per instance.
    const seenPanelIds: string[] = [];
    const seenGroupIds: string[] = [];
    for (const triggerButton of triggers) {
      await act(async () => {
        triggerButton.click();
      });
      await flushFrame();
      const element = panel()!;
      seenPanelIds.push(element.id);
      expect(triggerButton.getAttribute("aria-controls")).toBe(element.id);
      expect(element.getAttribute("role")).toBe("dialog");
      for (const group of element.querySelectorAll<HTMLElement>('[role="group"]')) {
        seenGroupIds.push(group.id);
        const labelledBy = group.getAttribute("aria-labelledby");
        expect(labelledBy).toBeTruthy();
        expect(element.querySelector(`[id="${labelledBy}"]`)).not.toBeNull();
      }
      await press(element, "Escape");
    }
    expect(new Set(seenPanelIds).size).toBe(2);
    expect(new Set(seenGroupIds).size).toBeGreaterThanOrEqual(2);
    expect(seenGroupIds.some((id) => seenPanelIds.includes(id))).toBe(false);

    // No native title tooltips anywhere in the menu surface.
    expect(document.querySelectorAll("[title]").length).toBe(0);
  });

  it("portals the panel to document.body inside the mirrored workspace theme", async () => {
    await render(
      (props) => createElement(ComposerAddMenu, props),
      "ts-workspace-theme quiet-workspace",
    );
    await openMenu();
    const element = panel()!;
    expect(element.parentElement).toBe(document.body);
    expect(element.classList.contains("ts-workspace-theme")).toBe(true);
    expect(element.classList.contains("quiet-workspace")).toBe(true);
    expect(element.getAttribute("role")).toBe("dialog");
    // The trigger keeps aria wiring to the portaled panel.
    expect(trigger().getAttribute("aria-controls")).toBe(element.id);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
  });
});

describe("composer add menu directory loading", () => {
  it("loads the people directory only while the people view is active", async () => {
    await render((props) => createElement(ComposerAddMenu, props));
    expect(useWorkspaceDirectoryMock).toHaveBeenLastCalledWith("binding-1", false);
    await openMenu();
    expect(useWorkspaceDirectoryMock).toHaveBeenLastCalledWith("binding-1", false);

    await act(async () => {
      rowByLabel("工具与技能").click();
    });
    expect(useWorkspaceDirectoryMock).toHaveBeenLastCalledWith("binding-1", false);

    // Escape from a nested view returns to the root view, not to the app.
    await press(panel()!, "Escape");
    await act(async () => {
      rowByLabel("查找人物").click();
    });
    await flushFrame();
    expect(useWorkspaceDirectoryMock).toHaveBeenLastCalledWith("binding-1", true);
    expect(document.body.textContent).toContain("陈晨");
    expect(document.body.textContent).toContain("查看全部人物");
  });
});

describe("composer add menu actions", () => {
  it("stages starter prompts as editable text and never submits or navigates", async () => {
    const props = await render((p) => createElement(ComposerAddMenu, p));
    await openMenu();
    await act(async () => {
      rowByLabel("工具与技能").click();
    });
    // Starters are labelled honestly: never "installed skills".
    expect(document.body.textContent).toContain("起稿提示");
    expect(document.body.textContent).not.toContain("已安装技能");
    const starter = WORKSPACE_SLASH_COMMANDS.find(
      (command) => command.kind === "starter",
    )!;
    await act(async () => {
      rowByLabel(starter.title).click();
    });
    expect(props.onInsertText).toHaveBeenCalledTimes(1);
    expect(props.onInsertText).toHaveBeenCalledWith(starter.insert);
    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(props.onAttachFiles).not.toHaveBeenCalled();
    expect(props.onCapture).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
  });

  it("exposes the extension management route for connected apps and tools", async () => {
    const props = await render((p) => createElement(ComposerAddMenu, p));
    await openMenu();
    await act(async () => {
      rowByLabel("工具与技能").click();
    });
    await act(async () => {
      rowByLabel("管理连接的应用与工具").click();
    });
    expect(props.onNavigate).toHaveBeenCalledWith("/workspace/extensions");
  });

  it("opens a person's page from the secondary people view", async () => {
    const props = await render((p) => createElement(ComposerAddMenu, p));
    await openMenu();
    await act(async () => {
      rowByLabel("查找人物").click();
    });
    await flushFrame();
    await act(async () => {
      rowByLabel("陈晨").click();
    });
    expect(props.onNavigate).toHaveBeenCalledTimes(1);
    expect(props.onNavigate).toHaveBeenCalledWith(
      "/workspace?person=11111111-1111-4111-8111-111111111111&context=22222222-2222-4222-8222-222222222222",
    );
  });

  it("keeps person display preferences consistent when another tab changes an avatar", async () => {
    const store = createAvatarStore("composer-avatar-parity", () => localStorage);
    store.clear();
    store.save("person:11111111-1111-4111-8111-111111111111", { style: "glass" });
    try {
      await render((p) => (
        <AvatarPreferencesProvider scope="composer-avatar-parity">
          <ComposerAddMenu {...p} />
        </AvatarPreferencesProvider>
      ));
      await openMenu();
      await act(async () => { rowByLabel("查找人物").click(); });
      await flushFrame();
      const selected = () => rowByLabel("陈晨").querySelector("[data-avatar-style]");
      expect(selected()?.getAttribute("data-avatar-style")).toBe("glass");
      expect(rowByLabel("林一").querySelector("[data-avatar-style]")?.getAttribute("data-avatar-style")).toBe("initials");
      await act(async () => {
        store.save("person:11111111-1111-4111-8111-111111111111", { style: "shapes" });
        window.dispatchEvent(new StorageEvent("storage", { key: store.key }));
      });
      expect(selected()?.getAttribute("data-avatar-style")).toBe("shapes");
      expect(rowByLabel("林一").querySelector("[data-avatar-style]")?.getAttribute("data-avatar-style")).toBe("initials");
    } finally {
      store.clear();
    }
  });

  it("offers the local file row only when a real handler is wired", async () => {
    const props = await render((p) => createElement(ComposerAddMenu, p));
    await openMenu();
    await act(async () => {
      rowByLabel("添加文件").click();
    });
    expect(props.onAttachFiles).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
  });

  it("offers no file row and no starters without real handlers", async () => {
    await render((p) =>
      createElement(ComposerAddMenu, {
        ...p,
        onAttachFiles: undefined,
        onInsertText: undefined,
      }),
    );
    await openMenu();
    expect(() => rowByLabel("添加文件")).toThrow();
    // Without an insertion handler no starter rows and no starter copy show.
    await act(async () => {
      rowByLabel("工具与技能").click();
    });
    expect(document.body.textContent).not.toContain("起稿提示");
    expect(document.body.textContent).not.toContain("整理这段对话");
  });

  it("stays inert when disabled", async () => {
    await render((p) => createElement(ComposerAddMenu, { ...p, disabled: true }));
    expect(trigger().disabled).toBe(true);
    await act(async () => {
      trigger().click();
    });
    expect(panel()).toBeNull();
  });
});

describe("composer add menu keyboard and dismissal", () => {
  it("leaves IME candidate navigation and cancellation to the search field", async () => {
    await render((p) => createElement(ComposerAddMenu, p));
    await openMenu();
    await act(async () => rowByLabel("查找人物").click());
    await flushFrame();
    const search = panel()!.querySelector("input")!;
    for (const key of ["ArrowDown", "ArrowUp", "Escape"]) {
      const event = new KeyboardEvent("keydown", { key, isComposing: true, bubbles: true, cancelable: true });
      await act(async () => search.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(search);
      expect(panel()!.querySelector("input")).toBe(search);
    }
  });
  it("moves focus with Arrow keys and Home/End across rows", async () => {
    await render((p) => createElement(ComposerAddMenu, p));
    await openMenu();
    const buttons = rows();
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    expect(document.activeElement).toBe(buttons[0]);

    await press(panel()!, "ArrowDown");
    expect(document.activeElement).toBe(buttons[1]);
    await press(panel()!, "ArrowUp");
    expect(document.activeElement).toBe(buttons[0]);
    await press(panel()!, "ArrowUp");
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    await press(panel()!, "Home");
    expect(document.activeElement).toBe(buttons[0]);
    await press(panel()!, "End");
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it("lets Tab leave the popover without a focus trap", async () => {
    await render((p) => createElement(ComposerAddMenu, p));
    await openMenu();
    const event = await press(panel()!, "Tab");
    expect(event.defaultPrevented).toBe(false);
  });

  it("unwinds Escape from nested view to root and then restores trigger focus", async () => {
    const parentKeys: string[] = [];
    const props = defaultProps();
    mount = document.createElement("div");
    document.body.append(mount);
    root = createRoot(mount);
    await act(async () => {
      root?.render(
        createElement(
          "div",
          {
            onKeyDown: (event: { key: string }) => {
              parentKeys.push(event.key);
            },
          },
          createElement(ComposerAddMenu, props),
        ),
      );
    });
    await openMenu();
    await act(async () => {
      rowByLabel("查找人物").click();
    });
    await flushFrame();

    await press(panel()!, "Escape");
    // First Escape leaves the people view only; the panel stays open and the
    // Escape never reaches the parent surface (it must not stop a live run).
    expect(panel()).not.toBeNull();
    expect(document.body.textContent).toContain("工具与技能");
    expect(parentKeys).toEqual([]);

    await press(panel()!, "Escape");
    expect(panel()).toBeNull();
    expect(parentKeys).toEqual([]);
    expect(document.activeElement).toBe(trigger());
  });

  it("dismisses on outside pointer and outside focus", async () => {
    await render((p) => createElement(ComposerAddMenu, p));
    await openMenu();
    const outside = document.createElement("button");
    document.body.append(outside);
    await act(async () => {
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(panel()).toBeNull();

    await openMenu();
    await act(async () => {
      outside.dispatchEvent(new Event("focusin", { bubbles: true }));
    });
    expect(panel()).toBeNull();
    outside.remove();
  });

  it("cancels its pending animation frames on close", async () => {
    // A controlled rAF double keeps the frames pending so cancellation is
    // observable instead of racing happy-dom timers.
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    const request = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        const id = nextId++;
        pending.set(id, callback as FrameRequestCallback);
        return id;
      });
    const cancel = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        pending.delete(id);
      });
    await render((p) => createElement(ComposerAddMenu, p));
    await act(async () => {
      trigger().click();
    });
    expect(pending.size).toBeGreaterThan(0);
    await press(panel()!, "Escape");
    expect(cancel).toHaveBeenCalled();
    expect(pending.size).toBe(0);
    request.mockRestore();
    cancel.mockRestore();
  });

  it("discards an open menu when the surface becomes disabled or changes binding", async () => {
    const listeners = new Set<() => void>();
    let current: Parameters<typeof ComposerAddMenu>[0] = { ...defaultProps() };
    function Harness() {
      const [, force] = useState(0);
      useEffect(() => {
        const listener = () => force((value) => value + 1);
        listeners.add(listener);
        return () => void listeners.delete(listener);
      }, []);
      return createElement(ComposerAddMenu, current);
    }
    mount = document.createElement("div");
    document.body.append(mount);
    root = createRoot(mount);
    await act(async () => {
      root?.render(createElement(Harness));
    });
    await openMenu();
    expect(panel()).not.toBeNull();

    await act(async () => {
      current = { ...current, disabled: true };
      listeners.forEach((listener) => listener());
    });
    expect(panel()).toBeNull();

    await act(async () => {
      current = { ...current, disabled: false };
      listeners.forEach((listener) => listener());
    });
    await openMenu();
    expect(panel()).not.toBeNull();
    await act(async () => {
      current = { ...current, binding: "binding-2" };
      listeners.forEach((listener) => listener());
    });
    expect(panel()).toBeNull();
  });
});

describe("composer add menu server rendering", () => {
  it("renders to string with document and window truly unavailable", async () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("window", undefined);
    let html = "";
    expect(() => {
      html = renderToString(
        createElement(ComposerAddMenu, {
          binding: null,
          onCapture: () => {},
          onNavigate: () => {},
        }),
      );
    }).not.toThrow();
    expect(html).toContain("data-add-trigger");
    expect(html).not.toContain("data-add-panel");
  });
});

describe("composer add menu portal geometry", () => {
  it("clamps the panel to the actual visual viewport before paint", async () => {
    await render((p) => createElement(ComposerAddMenu, p));
    const anchor = trigger();
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      x: 4,
      y: 100,
      top: 100,
      bottom: 144,
      left: 4,
      right: 48,
      width: 44,
      height: 44,
      toJSON: () => ({}),
    } as DOMRect);
    // The panel wants 500px of content in a 200x200 visual viewport.
    const originalScroll = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    const originalViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-add-panel") ? 500 : 0;
      },
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        offsetTop: 0,
        offsetLeft: 0,
        width: 200,
        height: 200,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });

    await act(async () => {
      anchor.click();
    });
    const element = panel()!;
    // 200 - 2*8 margin: the panel never exceeds the visual viewport.
    expect(element.style.width).toBe("184px");
    // Only 84px fits above the trigger; the rest scrolls inside the panel.
    expect(element.dataset.side).toBe("above");
    expect(element.style.maxHeight).toBe("84px");
    expect(element.style.top).toBe("8px");
    expect(element.style.left).toBe("8px");
    if (originalScroll) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollHeight",
        originalScroll,
      );
    }
    if (originalViewport) {
      Object.defineProperty(window, "visualViewport", originalViewport);
    }
  });

  it("lets a tall panel scroll instead of overflowing", async () => {
    const { readFile } = await import("node:fs/promises");
    const css = await readFile(
      "components/new-conversation-add-menu.module.css",
      "utf8",
    );
    expect(css).toContain("overflow-y: auto");
  });

  it("mirrors scoped theme tokens into the portaled panel", async () => {
    await render(
      (p) => createElement(ComposerAddMenu, p),
      "ts-workspace-theme quiet-workspace",
    );
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) =>
        name === "--surface" ? "#fcfbf7" : name === "--ink" ? "#171715" : "",
    } as unknown as CSSStyleDeclaration);
    await act(async () => {
      trigger().click();
    });
    const element = panel()!;
    expect(element.style.getPropertyValue("--surface")).toBe("#fcfbf7");
    expect(element.style.getPropertyValue("--ink")).toBe("#171715");
    expect(element.classList.contains("ts-workspace-theme")).toBe(true);
    expect(element.classList.contains("quiet-workspace")).toBe(true);
  });

  it("keeps the root view free of explanatory footers", async () => {
    await render((p) => createElement(ComposerAddMenu, p));
    await openMenu();
    const text = panel()!.textContent ?? "";
    expect(text).not.toContain("发送由你决定");
    expect(text).not.toContain("未发送内容留在本机");
  });

  it("keeps the tools footer to one short honest sentence", async () => {
    await render((p) => createElement(ComposerAddMenu, p));
    await openMenu();
    await act(async () => {
      rowByLabel("工具与技能").click();
    });
    const text = panel()!.textContent ?? "";
    expect(text).toContain("起稿提示只把文字插入草稿，发送由你决定。");
    expect(text).not.toContain("已安装技能");
    expect(text).not.toContain("技能市场");
  });
});
