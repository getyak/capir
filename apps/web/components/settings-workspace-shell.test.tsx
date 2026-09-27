// @vitest-environment happy-dom
import {
  act,
  type AnchorHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";

const linkState = vi.hoisted(() => ({ intercepted: 0 }));
// Stand-in for next/link: a client-side link intercepts the click and prevents
// the document navigation, which is exactly what the macOS WKWebView delegate
// must not see for outbound destinations.
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({
      children,
      ...rest
    }: { children?: ReactNode } & Record<string, unknown>) =>
      React.createElement(
        "a",
        {
          ...(rest as AnchorHTMLAttributes<HTMLAnchorElement>),
          onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => {
            linkState.intercepted += 1;
            event.preventDefault();
          },
        },
        children,
      ),
  };
});

vi.mock("./account-settings", () => ({ AccountSettingsPanel: () => null }));
vi.mock("./avatar-editor", () => ({ AvatarDefaultSettings: () => null }));
vi.mock("@/app/workspace/settings/actions", () => ({ saveAccountSettings: vi.fn() }));

import { SettingsWorkspace } from "./settings-workspace";
import { revertTheme, themePreferenceSnapshot } from "@/lib/theme-preference";

let root: Root;
let host: HTMLDivElement;

function render(overrides: Partial<Parameters<typeof SettingsWorkspace>[0]> = {}) {
  return act(() =>
    root.render(
      <SettingsWorkspace
        avatarUrl={null}
        initial={null}
        labEnabled={false}
        section="connections"
        sessionVersion="session-version"
        {...overrides}
      />,
    ),
  );
}

async function clickButton(text: string) {
  const button = [...host.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === text,
  );
  expect(button, `button “${text}”`).toBeTruthy();
  await act(() => button!.click());
}

async function type(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="搜索设置"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

async function press(target: Element, key: string) {
  await act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  revertTheme();
  delete document.documentElement.dataset.theme;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  revertTheme();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe("settings shell", () => {
  it("renders one settings navigation whose selected section matches the content title", async () => {
    const navs = host.querySelectorAll("[data-settings-navigation]");
    expect(navs).toHaveLength(1);
    expect(navs[0].getAttribute("aria-label")).toBe("设置分区");

    const selected = host.querySelector('[aria-current="page"]');
    expect(selected?.textContent).toBe("连接与权限");
    expect(host.querySelector("[data-settings-scope]")?.textContent).toBe("当前空间");
    // The content title is the selected section, not a repeated hero.
    expect(host.querySelector("h2")?.textContent).toBe("连接与权限");
  });

  it("hides the Lab testing section until the workspace enables it", async () => {
    expect(host.textContent).not.toContain("测试与诊断");
    await render({ labEnabled: true });
    expect(host.textContent).toContain("测试与诊断");
  });
});

describe("settings search", () => {
  it("finds Chinese aliases and links to the real owner with scope", async () => {
    await type("截屏");
    const hit = host.querySelector<HTMLAnchorElement>('[data-settings-hit="captures"]')!;
    expect(hit).toBeTruthy();
    expect(hit.getAttribute("href")).toBe("/workspace/captures");
    expect(hit.textContent).toContain("截图与文档");
    expect(hit.textContent).toContain("当前空间");
    expect(hit.textContent).toContain("资料 · 截图与文档");

    await type("屏幕录制");
    const recording = host.querySelector<HTMLAnchorElement>(
      '[data-settings-hit="screen-recording-permission"]',
    )!;
    expect(recording).toBeTruthy();
    expect(recording.getAttribute("href")).toBe(
      "/workspace/settings?section=advanced#device-permissions",
    );
    expect(recording.textContent).toContain("macOS 设备");
    expect(host.querySelector('[data-settings-hit="captures"]')).toBeNull();
    expect(host.textContent).toContain("macOS 系统设置");

    await type("屏幕录制权限");
    expect(host.querySelector('[data-settings-hit="screen-recording-permission"]')).toBeTruthy();

    await type("跟随系统");
    expect(host.querySelector('[data-settings-hit="appearance"]')).toBeTruthy();
  });

  it("moves focus with the keyboard, opens the active result, and returns focus on Escape", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const input = await type("截图");
    await press(input.closest("[class]")!, "ArrowDown");
    const focused = document.activeElement as HTMLAnchorElement;
    expect(focused.getAttribute("href")).toBe("/workspace/captures");

    await press(focused, "Enter");
    expect(click).toHaveBeenCalled();

    await type("截图");
    await press(host.querySelector("[data-settings-search-results]")!, "Escape");
    expect((document.activeElement as HTMLInputElement).getAttribute("aria-label")).toBe(
      "搜索设置",
    );
  });

  it("shows a useful empty state without exposing relationship data", async () => {
    await type("张三的联系方式");
    const empty = host.querySelector("[data-settings-search-empty]")!;
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain("没有找到");
    expect(empty.textContent).toContain("关系资料不会出现在设置搜索中");
    expect(host.querySelectorAll("[data-settings-result]")).toHaveLength(0);
  });
});

describe("appearance", () => {
  it("previews, cancels and saves a theme draft, then reloads the saved choice", async () => {
    await render({ section: "appearance" });
    expect(host.textContent).toContain("下面是示例，不会使用真实联系人内容。");

    const dark = () => host.querySelector<HTMLButtonElement>('[data-theme-option="dark"]')!;
    expect(dark().getAttribute("aria-checked")).toBe("false");

    await act(() => dark().click());
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(host.textContent).toContain("预览未保存");
    expect(localStorage.getItem("talent-signal-theme")).toBeNull();

    await clickButton("取消");
    expect(host.textContent).not.toContain("预览未保存");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(dark().getAttribute("aria-checked")).toBe("false");

    await act(() => dark().click());
    await clickButton("保存偏好");
    expect(localStorage.getItem("talent-signal-theme")).toBe("dark");
    expect(themePreferenceSnapshot()).toBe("dark");
    expect(host.textContent).not.toContain("预览未保存");

    // Reload the surface: the persisted choice is selected without a draft.
    await act(() => root.unmount());
    root = createRoot(host);
    await render({ section: "appearance" });
    expect(dark().getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).not.toContain("预览未保存");
  });

  it("keeps an unsaved state when the browser refuses to persist", async () => {
    await render({ section: "appearance" });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem() {
        throw new Error("quota");
      },
      removeItem() {
        throw new Error("quota");
      },
    });
    await act(() => host.querySelector<HTMLButtonElement>('[data-theme-option="dark"]')!.click());
    await clickButton("保存偏好");
    expect(host.textContent).toContain("偏好未能保存到本机浏览器");
    expect(host.textContent).toContain("预览未保存");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("reapplies the saved preference when leaving Appearance with an unsaved draft", async () => {
    await render({ section: "appearance" });
    await act(() => host.querySelector<HTMLButtonElement>('[data-theme-option="dark"]')!.click());
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("talent-signal-theme")).toBeNull();

    // Section change unmounts AppearancePane; the unsaved preview must not leak.
    await render({ section: "connections" });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("talent-signal-theme")).toBeNull();
    expect(host.textContent).toContain("查看数据与操作边界");
  });

  it("pairs browser and Mac persistence copy without granting capability", async () => {
    await render({ section: "appearance" });
    // Both copies are in the DOM; CSS shows the one that matches the surface.
    expect(host.textContent).toContain("仅此浏览器 · 本机保存");
    expect(host.textContent).toContain("仅此 Mac · 本机保存");
    expect(host.textContent).toContain("偏好只保存在这台设备的浏览器中");
    expect(host.textContent).toContain("偏好只保存在这台 Mac 的应用中");

    await render({ section: "overview" });
    expect(host.querySelector("[data-settings-scope]")?.textContent).toBe("账号 · 本机头像");
  });
});

describe("connections contract", () => {
  it("shows the read → propose → approve process and routes sources to their owners", async () => {
    expect(host.textContent).toContain("可读取");
    expect(host.textContent).toContain("可提议");
    expect(host.textContent).toContain("待你批准");
    // Named as an explanatory process and destination list, not live status.
    expect(host.textContent).toContain("边界如何生效");
    expect(host.textContent).toContain("流程说明");
    expect(host.textContent).toContain("来源与目的地");
    const captures = host.querySelector<HTMLAnchorElement>('a[href="/workspace/captures"]')!;
    const extensions = host.querySelector<HTMLAnchorElement>('a[href="/workspace/extensions"]')!;
    const boundaries = host.querySelector<HTMLAnchorElement>('a[href="/workspace/boundaries"]')!;
    expect(captures).toBeTruthy();
    expect(extensions).toBeTruthy();
    expect(boundaries.textContent).toContain("查看数据与操作边界");
    // No invented source counts, assumed connection states, or fake Agent link.
    expect(host.textContent).not.toContain("尚未连接");
    expect(host.textContent).not.toContain("打开 Agent");
    expect(host.textContent).not.toMatch(/\d+\s*项/);
  });
});

describe("device permissions", () => {
  it("explains screen-recording ownership in a named, linked section", async () => {
    await render({ section: "advanced" });
    const section = host.querySelector("#device-permissions")!;
    expect(section).toBeTruthy();
    expect(section.textContent).toContain("屏幕录制权限");
    expect(section.textContent).toContain("「此设备」");
    expect(section.textContent).toContain("macOS 系统设置");
    expect(section.textContent).toContain("这个 Web 设置页无法授予或更改系统权限");
    expect(section.textContent).toContain("授权后回到应用，重新检查状态");
    // The surface explains ownership; it never renders an active permission toggle.
    expect(section.querySelector("input, button")).toBeNull();
  });
});

describe("navigation contract", () => {
  async function clickAnchor(selector: string) {
    const anchor = host.querySelector<HTMLAnchorElement>(selector);
    expect(anchor, selector).toBeTruthy();
    const before = linkState.intercepted;
    let prevented = false;
    await act(() => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      anchor!.dispatchEvent(event);
      prevented = event.defaultPrevented;
    });
    return { prevented, intercepted: linkState.intercepted - before };
  }

  it("uses document anchors for outbound destinations and Link only for settings routes", async () => {
    // Outbound workspace destinations must reach the native delegate untouched.
    expect(await clickAnchor('a[href="/workspace/captures"]')).toEqual({ prevented: false, intercepted: 0 });
    expect(await clickAnchor('a[href="/workspace/boundaries"]')).toEqual({ prevented: false, intercepted: 0 });
    // Settings-owned navigation stays client-side inside the Settings window.
    expect(await clickAnchor('a[href="/workspace/settings?section=account"]')).toEqual({ prevented: true, intercepted: 1 });

    await render({ section: "appearance" });
    expect(await clickAnchor('a[href="/workspace/preferences"]')).toEqual({ prevented: false, intercepted: 0 });

    await render({ section: "advanced", labEnabled: true });
    expect(await clickAnchor('a[href="/workspace/monitor"]')).toEqual({ prevented: false, intercepted: 0 });
    expect(await clickAnchor('a[href="/workspace/lab"]')).toEqual({ prevented: false, intercepted: 0 });
    expect(await clickAnchor('a[href="/workspace/settings/diagnostics"]')).toEqual({ prevented: true, intercepted: 1 });
  });
});
