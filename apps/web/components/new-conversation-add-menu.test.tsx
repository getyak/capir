// @vitest-environment happy-dom
//
// The composer add menu: unique ids, lazily loaded people directory, honest
// starter staging (never submit, never authority), nested-view keyboard flow,
// outside dismissal, and a portaled panel that keeps the workspace theme in
// step with live source and OS colour-scheme changes.

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

/** Apply a live theme change and let MutationObserver deliveries run. */
async function applyThemeChange(update: () => void): Promise<void> {
  await act(async () => {
    update();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Live token values as the browser would report them for each source. */
function stubTokens(
  tokens:
    | Record<string, string>
    | ((element: Element) => Record<string, string>),
): void {
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    ((element: Element) => {
      const values = typeof tokens === "function" ? tokens(element) : tokens;
      return { getPropertyValue: (name: string) => values[name] ?? "" };
    }) as unknown as typeof window.getComputedStyle,
  );
}

type ColorScheme = "light" | "dark";

/**
 * A matchMedia stand-in that models query matching like a browser: a
 * value-sensitive `prefers-color-scheme: dark|light` flips with the OS, a
 * valueless `prefers-color-scheme` stays matched in both schemes and never
 * reports a change, and unrelated queries never fire. A stub that blindly
 * fires every query would hide a wrongly installed query, so change events
 * are delivered only when a query's match state actually moves.
 */
function stubColorScheme(initial: ColorScheme = "light") {
  let scheme = initial;
  const queries: string[] = [];
  const subscribed = new Set<string>();
  const lists: Array<{ media: string; matches: boolean; listeners: Set<(event: unknown) => void> }> = [];

  function evaluate(query: string): boolean {
    const valued = /prefers-color-scheme\s*:\s*(dark|light)/i.exec(query);
    if (valued) return valued[1].toLowerCase() === scheme;
    // A valueless media feature matches whenever it is supported: in light
    // and dark alike, so its match state can never change.
    return /prefers-color-scheme/i.test(query);
  }

  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    queries.push(query);
    const listeners = new Set<(event: unknown) => void>();
    const list = { media: query, matches: evaluate(query), listeners };
    lists.push(list);
    return {
      media: query,
      get matches() {
        return list.matches;
      },
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        if (type !== "change") return;
        subscribed.add(query);
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: unknown) => void) => {
        listeners.delete(listener);
      },
    } as unknown as MediaQueryList;
  });

  return {
    queries,
    subscribed,
    listenerCount: () =>
      lists.reduce((count, list) => count + list.listeners.size, 0),
    setScheme(next: ColorScheme) {
      scheme = next;
      for (const list of lists) {
        const matches = evaluate(list.media);
        if (matches === list.matches) continue;
        list.matches = matches;
        for (const listener of list.listeners) {
          listener({ matches, media: list.media });
        }
      }
    },
  };
}

type ObservedRecord = {
  targets: Set<Node>;
  callbacks: number;
  disconnected: boolean;
};

/**
 * Trace MutationObserver ownership: which nodes are observed, how often the
 * callback runs, and whether cleanup really disconnected the observer.
 */
function trackObservers(): { records: ObservedRecord[] } {
  const records: ObservedRecord[] = [];
  const Base = window.MutationObserver;
  class TrackedMutationObserver extends Base {
    private record: ObservedRecord = {
      targets: new Set(),
      callbacks: 0,
      disconnected: false,
    };
    constructor(callback: MutationCallback) {
      super((entries, observer) => {
        this.record.callbacks += 1;
        callback(entries, observer);
      });
      records.push(this.record);
    }
    observe(target: Node, options?: MutationObserverInit) {
      this.record.targets.add(target);
      super.observe(target, options);
    }
    disconnect() {
      this.record.disconnected = true;
      super.disconnect();
    }
  }
  vi.stubGlobal("MutationObserver", TrackedMutationObserver);
  return { records };
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

describe("composer add menu portal theme liveness", () => {
  it("follows ancestor light→dark→light while the same panel stays open", async () => {
    const tokens: Record<string, string> = {
      "--surface": "#fcfbf7",
      "--ink": "#171715",
      "--accent": "#a2491c",
    };
    stubTokens(tokens);
    await render(
      (p) => createElement(ComposerAddMenu, p),
      "ts-workspace-theme quiet-workspace",
    );
    mount!.setAttribute("data-theme", "light");
    await openMenu();
    // Nest into a view first: theme changes must neither close the panel nor
    // change what view it shows.
    await act(async () => {
      rowByLabel("工具与技能").click();
    });
    const element = panel()!;
    expect(element.getAttribute("data-theme")).toBe("light");
    expect(element.classList.contains("ts-workspace-theme")).toBe(true);
    expect(element.classList.contains("quiet-workspace")).toBe(true);
    expect(element.style.getPropertyValue("--surface")).toBe("#fcfbf7");

    // Ancestor flips to dark under the still-open panel, and computed
    // custom properties move with it.
    await applyThemeChange(() => {
      mount!.setAttribute("data-theme", "dark");
      tokens["--surface"] = "#1b1b19";
      tokens["--ink"] = "#f2f0ea";
      delete tokens["--accent"];
    });
    expect(panel()).toBe(element);
    expect(element.getAttribute("data-theme")).toBe("dark");
    expect(element.style.getPropertyValue("--surface")).toBe("#1b1b19");
    expect(element.style.getPropertyValue("--ink")).toBe("#f2f0ea");
    expect(element.style.getPropertyValue("--accent")).toBe("");

    // And back to light: the mirror round-trips instead of freezing.
    await applyThemeChange(() => {
      mount!.setAttribute("data-theme", "light");
      tokens["--surface"] = "#fcfbf7";
      tokens["--ink"] = "#171715";
    });
    expect(panel()).toBe(element);
    expect(element.getAttribute("data-theme")).toBe("light");
    expect(element.style.getPropertyValue("--surface")).toBe("#fcfbf7");
    expect(element.style.getPropertyValue("--ink")).toBe("#171715");

    // Same panel, same view: nothing closed, reopened, or navigated.
    expect(panel()).toBe(element);
    expect(panel()!.textContent).toContain("管理连接的应用与工具");
    expect(panel()!.textContent).toContain("起稿提示只把文字插入草稿，发送由你决定。");
  });

  it("drops stale mirrored state on source removal and never mirrors from itself", async () => {
    const fallback = document.createElement("div");
    const mountTokens: Record<string, string> = {
      "--surface": "#fcfbf7",
      "--accent": "#a2491c",
    };
    const fallbackTokens: Record<string, string> = {
      "--surface": "#e9e5da",
      "--focus": "#2f5d50",
    };
    stubTokens((element) =>
      element === mount
        ? mountTokens
        : element === fallback
          ? fallbackTokens
          : {},
    );
    await render(
      (p) => createElement(ComposerAddMenu, p),
      "ts-workspace-theme quiet-workspace",
    );
    mount!.setAttribute("data-theme", "light");
    await openMenu();
    const element = panel()!;
    expect(element.getAttribute("data-theme")).toBe("light");
    expect(element.style.getPropertyValue("--accent")).toBe("#a2491c");

    // A second themed surface arrives after the open panel. In document
    // order the panel itself already carries the mirrored classes and
    // precedes this fallback, so source selection must skip the panel.
    fallback.className = "ts-workspace-theme";
    fallback.setAttribute("data-theme", "dark");
    document.body.append(fallback);
    try {
      await applyThemeChange(() => {
        mount!.classList.remove("ts-workspace-theme", "quiet-workspace");
        mount!.removeAttribute("data-theme");
        delete mountTokens["--accent"];
      });
      // Source classes, `data-theme`, and a copied token are gone; the
      // fallback source wins instead of any stale panel output.
      expect(panel()).toBe(element);
      expect(element.classList.contains("ts-workspace-theme")).toBe(true);
      expect(element.classList.contains("quiet-workspace")).toBe(false);
      expect(element.getAttribute("data-theme")).toBe("dark");
      expect(element.style.getPropertyValue("--surface")).toBe("#e9e5da");
      expect(element.style.getPropertyValue("--focus")).toBe("#2f5d50");
      expect(element.style.getPropertyValue("--accent")).toBe("");

      // The changed nearest theme scope is watched from now on.
      await applyThemeChange(() => {
        fallback.setAttribute("data-theme", "light");
        fallbackTokens["--surface"] = "#f6f4ee";
      });
      expect(element.getAttribute("data-theme")).toBe("light");
      expect(element.style.getPropertyValue("--surface")).toBe("#f6f4ee");

      // The last source goes away: the mirrored classes must fall off the
      // panel even though the panel itself carries them — mirror output is
      // never its own source.
      await applyThemeChange(() => {
        fallback.classList.remove("ts-workspace-theme");
        fallback.removeAttribute("data-theme");
      });
      expect(element.classList.contains("ts-workspace-theme")).toBe(false);
      expect(element.classList.contains("quiet-workspace")).toBe(false);
      expect(element.hasAttribute("data-theme")).toBe(false);
      expect(element.style.getPropertyValue("--surface")).toBe("");
      expect(element.style.getPropertyValue("--focus")).toBe("");
    } finally {
      fallback.remove();
    }
  });

  it("follows OS colour-scheme flips through an explicit dark query", async () => {
    const tokens: Record<string, string> = {
      "--surface": "#fcfbf7",
      "--background": "#ffffff",
    };
    stubTokens(tokens);
    const media = stubColorScheme("light");
    await render((p) => createElement(ComposerAddMenu, p), "quiet-workspace");
    await openMenu();
    const element = panel()!;
    expect(element.style.getPropertyValue("--surface")).toBe("#fcfbf7");

    // The installed colour-scheme query must be value-sensitive and dark:
    // a valueless `(prefers-color-scheme)` stays matched in light and dark
    // alike and would never report this transition.
    const schemeQueries = media.queries.filter((query) =>
      query.includes("prefers-color-scheme"),
    );
    expect(schemeQueries).toContain("(prefers-color-scheme: dark)");
    expect(schemeQueries).not.toContain("(prefers-color-scheme)");
    expect(
      [...media.subscribed].filter((query) =>
        query.includes("prefers-color-scheme"),
      ),
    ).toEqual(["(prefers-color-scheme: dark)"]);

    // Under this mock a valueless colour-scheme list stays matched in both
    // schemes and never fires change: a wrong query cannot pass this suite.
    const valuelessFired = vi.fn();
    window
      .matchMedia("(prefers-color-scheme)")
      .addEventListener("change", valuelessFired);

    // The OS flips with zero DOM mutation; only computed values move.
    await act(async () => {
      tokens["--surface"] = "#1b1b19";
      delete tokens["--background"];
      media.setScheme("dark");
    });
    expect(panel()).toBe(element);
    expect(element.style.getPropertyValue("--surface")).toBe("#1b1b19");
    expect(element.style.getPropertyValue("--background")).toBe("");

    await act(async () => {
      tokens["--surface"] = "#fcfbf7";
      tokens["--background"] = "#ffffff";
      media.setScheme("light");
    });
    expect(panel()).toBe(element);
    expect(element.style.getPropertyValue("--surface")).toBe("#fcfbf7");
    expect(element.style.getPropertyValue("--background")).toBe("#ffffff");
    expect(valuelessFired).not.toHaveBeenCalled();
  });

  it("disposes every subscription on close and unmount and reopens fresh", async () => {
    const tokens: Record<string, string> = { "--surface": "#fcfbf7" };
    stubTokens(tokens);
    const media = stubColorScheme("light");
    const observers = trackObservers();
    const active = () =>
      observers.records.filter((record) => !record.disconnected);
    await render((p) => createElement(ComposerAddMenu, p), "quiet-workspace");
    await openMenu();
    const element = panel()!;
    expect(active().length).toBe(1);
    expect(media.listenerCount()).toBe(1);

    // Mirror output is never observed, so a sync can never feed back into
    // itself and grow a callback loop.
    for (const record of observers.records) {
      for (const target of record.targets) {
        expect(target === element || element.contains(target)).toBe(false);
      }
    }

    // A view change must not touch the subscription set at all.
    await act(async () => {
      rowByLabel("工具与技能").click();
    });
    await press(panel()!, "Escape");
    expect(active().length).toBe(1);
    expect(media.listenerCount()).toBe(1);

    // One source change is exactly one sync: no repeated-callback growth.
    const callbacks = () =>
      observers.records.reduce((count, record) => count + record.callbacks, 0);
    const before = callbacks();
    await applyThemeChange(() => {
      mount!.setAttribute("data-theme", "dark");
    });
    expect(callbacks() - before).toBe(1);
    await applyThemeChange(() => {});
    expect(callbacks() - before).toBe(1);

    // Close disposes every observer and listener.
    await press(element, "Escape");
    expect(panel()).toBeNull();
    expect(active().length).toBe(0);
    expect(media.listenerCount()).toBe(0);

    // A closed panel is dead state: source or OS changes never reach it.
    await applyThemeChange(() => {
      mount!.classList.remove("quiet-workspace");
      mount!.setAttribute("data-theme", "light");
      tokens["--surface"] = "#1b1b19";
    });
    media.setScheme("dark");
    expect(element.classList.contains("quiet-workspace")).toBe(true);
    expect(element.getAttribute("data-theme")).toBe("dark");
    expect(element.style.getPropertyValue("--surface")).toBe("#fcfbf7");

    // Reopening attaches exactly one fresh subscription set.
    await openMenu();
    const reopened = panel()!;
    expect(reopened).not.toBe(element);
    expect(active().length).toBe(1);
    expect(media.listenerCount()).toBe(1);
    expect(observers.records.length).toBe(2);
    const freshBefore = callbacks();
    await applyThemeChange(() => {
      mount!.setAttribute("data-theme", "dark");
    });
    expect(reopened.getAttribute("data-theme")).toBe("dark");
    expect(callbacks() - freshBefore).toBe(1);

    // Unmount with the panel open disposes just as completely.
    await act(async () => {
      root?.unmount();
    });
    root = null;
    expect(panel()).toBeNull();
    expect(active().length).toBe(0);
    expect(media.listenerCount()).toBe(0);
    await applyThemeChange(() => {
      mount!.setAttribute("data-theme", "dark");
      tokens["--surface"] = "#f6f4ee";
    });
    media.setScheme("dark");
    expect(reopened.getAttribute("data-theme")).toBe("dark");
    // Frozen at the value mirrored while it was alive: the post-unmount
    // `#f6f4ee` must never reach the detached panel.
    expect(reopened.style.getPropertyValue("--surface")).toBe("#1b1b19");
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
