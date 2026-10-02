// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DesktopAccountLink, DesktopDeviceSettingsLink, desktopVersion } from "./desktop-chrome";
import { WorkspaceAccountMenu, WeeklyUsageRow } from "./workspace-account-menu";
import { WorkspaceDownloadEntry, WorkspaceFooterStrip } from "./workspace-footer";
import type { WeeklyUsageStore, WeeklyUsageView } from "@/lib/weekly-usage";
import type { WeeklyUsageResponse } from "@talent-signal/contracts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  delete window.talentSignalDesktop;
  document.body.innerHTML = "";
});

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

async function showDesktop(state: Record<string, unknown> | null) {
  await act(async () => {
    if (state) window.talentSignalDesktop = state as never;
    else delete window.talentSignalDesktop;
    window.dispatchEvent(new Event("talent-signal-desktop"));
  });
}

function usageResponse(count: number): WeeklyUsageResponse {
  return {
    contract_version: "2026-08-24.10",
    schema_version: "workspace-weekly-usage.v1",
    window: {
      start: "2026-09-27T16:00:00.000Z",
      end: "2026-10-04T16:00:00.000Z",
      timezone: "Asia/Shanghai",
    },
    count,
    allowance: 1000,
    computed_at: "2026-09-30T02:00:00.000Z",
  };
}

/** Deterministic store so component states never depend on timing. */
function manualStore(view: WeeklyUsageView): WeeklyUsageStore & { set: (v: WeeklyUsageView) => void; refreshed: number } {
  let snapshot = view;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    dispose() {},
    refresh() {
      this.refreshed += 1;
    },
    refreshed: 0,
    set(next) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

describe("native desktop chrome", () => {
  it("gates support mail on host capability and gives old hosts a usable copy fallback", async () => {
    const host = await render(createElement(WorkspaceAccountMenu, {
      accountName: "Synthetic User", workspaceName: null, signOutAction: () => {},
    }));
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    await showDesktop({ protocolVersion: 1, availableVersion: null });
    expect(host.querySelector("a[href^='mailto:']")).toBeNull();
    expect(host.textContent).toContain("hello@talentsignal.ai");
    const button = Array.from(host.querySelectorAll("button")).find(item => item.textContent === "复制支持邮箱");
    await act(async () => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(copy).toHaveBeenCalledWith("hello@talentsignal.ai");
    expect(host.textContent).toContain("已复制支持邮箱");
    await showDesktop({ protocolVersion: 1, availableVersion: null, supportMailHandoff: true });
    expect(host.querySelector("a[href^='mailto:hello@talentsignal.ai?subject=']")).not.toBeNull();
  });
  it("keeps account management in the browser and device settings in the native window", async () => {
    const host = await render(createElement("div", null,
      createElement(DesktopAccountLink, { onClick() {} }),
      createElement(DesktopDeviceSettingsLink, { onClick() {} })));
    // A plain browser gets the ordinary Web settings route and no device chrome.
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/workspace/settings");
    expect(host.querySelector("a")?.textContent).toContain("账号与偏好");
    expect(host.querySelector("[href^='talentsignal-desktop://']")).toBeNull();
    expect(host.querySelector("kbd")).toBeNull();

    await showDesktop({ protocolVersion: 1, availableVersion: null });
    // Hosted: account management is still handed to the real browser session.
    expect(host.querySelector("a[href='talentsignal-desktop://account-settings']")?.textContent)
      .toContain("账号与偏好");
    expect(host.querySelector("a[href='/workspace/settings']")).toBeNull();
    // Device settings are the only thing the native window owns.
    const device = host.querySelector("a[href='talentsignal-desktop://settings']");
    expect(device?.textContent).toContain("此 Mac 设置");
    expect(device?.querySelector("kbd")?.textContent).toBe("⌘ ,");
  });

  it("offers both account and device entries in the avatar menu without ambiguity", async () => {
    const host = await render(createElement(WorkspaceAccountMenu, {
      accountName: "Synthetic User", workspaceName: "Fixture Workspace", signOutAction: () => {},
    }));
    const accountLinks = () =>
      Array.from(host.querySelectorAll("a[aria-label^='账号与偏好']"));
    const deviceLinks = () => host.querySelectorAll("a[href='talentsignal-desktop://settings']");
    expect(accountLinks()).toHaveLength(1);
    expect(deviceLinks()).toHaveLength(0);
    // Ordinary Web users stay in their current workspace and session.
    expect(host.textContent).not.toContain("浏览器登录状态可能与本应用不同");
    expect(accountLinks()[0].textContent).toBe("账号与偏好");
    expect(accountLinks()[0].getAttribute("aria-label")).toBe("账号与偏好");
    // The settings utility is a plain Web route here, distinct from support's
    // "工作区设置" shortcut.
    expect(accountLinks()[0].getAttribute("href")).toBe("/workspace/settings");
    expect(host.querySelectorAll("a[href='/workspace/settings']")).toHaveLength(2);
    // No fake multi-account capability is offered.
    expect(host.textContent).not.toContain("添加账号");
    expect(host.textContent).not.toContain("添加账户");

    await showDesktop({ protocolVersion: 1, surface: "workspace", availableVersion: null });
    const account = () => host.querySelectorAll("a[href='talentsignal-desktop://account-settings']");
    expect(account()).toHaveLength(1);
    expect(account()[0].textContent).toContain("账号与偏好 ↗");
    expect(host.textContent).toContain("浏览器登录状态可能与本应用不同");
    expect(deviceLinks()).toHaveLength(2);
    expect(Array.from(deviceLinks(), link => link.textContent)).toContain("此 Mac 设置与检测");
    // The support shortcut stays an ordinary Web route; only the account
    // handoff moves to the default browser.
    expect(host.querySelectorAll("a[href='/workspace/settings']")).toHaveLength(1);
    // Neither entry may claim to bring account data back into the app.
    expect(host.textContent).not.toContain("同步");
  });

  it("keeps menu utilities on real routes: mobile entry, support diagnostics and site contact", async () => {
    const host = await render(createElement(WorkspaceAccountMenu, {
      accountName: "Synthetic User", workspaceName: null, signOutAction: () => {},
    }));
    const mobile = host.querySelector("a[href='/download']");
    expect(mobile?.textContent).toContain("移动端 capri");
    expect(mobile?.getAttribute("aria-label")).toContain("手机");
    const support = host.querySelector("summary[aria-label='帮助与支持']");
    const supportLinks = Array.from(
      host.querySelectorAll("details details a"),
      (link) => link.getAttribute("href"),
    );
    expect(support?.textContent).toContain("帮助与支持");
    expect(supportLinks).toContain("/workspace/settings/diagnostics");
    expect(supportLinks).toContain("/workspace/settings");
    expect(supportLinks.some((href) => href?.startsWith("mailto:hello@talentsignal.ai"))).toBe(true);
    // Support is the configured contact, never a fabricated assistant.
    expect(host.textContent).not.toContain("机器人");
    expect(host.textContent).not.toContain("智能客服");
    // No native scheme URL may appear without a host.
    expect(host.querySelector("[href^='talentsignal-desktop://']")).toBeNull();
  });
});

describe("workspace footer strip", () => {
  it("keeps Connect apps on both hosts and exposes only real update state", async () => {
    const host = await render(createElement(WorkspaceFooterStrip, null,
      createElement("span", { "data-probe": "menu" }),
    ));
    expect(host.querySelector("[data-hosted='false']")).not.toBeNull();
    expect(host.querySelector("a[href='/workspace/extensions']")).not.toBeNull();
    await showDesktop({ protocolVersion: 1, availableVersion: null });
    expect(host.querySelector("[data-hosted='true']")).not.toBeNull();
    const pill = host.querySelector("a[href='/workspace/extensions']");
    expect(pill?.textContent).toContain("连接应用");
    expect(pill?.getAttribute("aria-label")).toContain("不会自动连接");
  });

  it("gives idle hosts a download entry without inventing an available release", async () => {
    const host = await render(createElement(WorkspaceDownloadEntry));
    // Without a host there is no native scheme URL: the entry is a plain download route.
    const browserEntry = host.querySelector("a");
    expect(browserEntry?.getAttribute("href")).toBe("/download");
    expect(host.querySelector("[href^='talentsignal-desktop://']")).toBeNull();
    await showDesktop({ protocolVersion: 1, availableVersion: null });
    const entry = host.querySelector("a");
    expect(entry?.getAttribute("href")).toBe("/download");
    expect(entry?.getAttribute("aria-label")).toBe("下载 capri");
    expect(host.textContent).not.toContain("0.2.0");
    expect(host.textContent).not.toContain("可用");
    const tooltip = host.querySelector("[role='tooltip']");
    expect(tooltip?.textContent).toContain("下载");
  });

  it("widens into an update entry with the real host version in a custom tooltip, never a native one", async () => {
    const host = await render(createElement(WorkspaceDownloadEntry));
    await showDesktop({
      protocolVersion: 1, availableVersion: "0.2.0 (12)", phase: "available",
      offerID: "b75e9546-2b27-4ee6-bdb2-bcb11f882652",
    });
    const entry = host.querySelector("a");
    expect(entry?.getAttribute("href")).toContain("install-update?offer=b75e9546");
    expect(entry?.getAttribute("aria-label")).toContain("0.2.0 (12) 并重启");
    expect(entry?.textContent).toContain("更新");
    // The version is custom tooltip content; no native title duplicates it.
    expect(entry?.getAttribute("title")).toBeNull();
    expect(host.querySelector("[title]")).toBeNull();
    const tooltip = host.querySelector("[role='tooltip']");
    expect(tooltip?.textContent).toContain("macOS 0.2.0 (12) 可用");
    expect(entry?.getAttribute("aria-describedby")).toBe(tooltip?.getAttribute("id"));

    // Hover or keyboard focus never executes an effect by itself.
    await act(async () => {
      entry?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      entry?.dispatchEvent(new MouseEvent("mouseenter"));
      entry?.focus();
    });
    expect(entry?.getAttribute("href")).toContain("install-update?offer=b75e9546");
    expect(entry?.getAttribute("onclick")).toBeNull();

    // Legacy hosts keep their review flow and label.
    await showDesktop({ protocolVersion: 1, availableVersion: "0.2.0 (12)", phase: "available" });
    const legacy = host.querySelector("a");
    expect(legacy?.getAttribute("href")).toBe("talentsignal-desktop://updates");
    expect(legacy?.getAttribute("aria-label")).toContain("查看 macOS 0.2.0 (12) 更新");
    expect(legacy?.textContent).toBe("更新");
  });

  it("disables repeat effects during download or install and keeps failure retry visible", async () => {
    const host = await render(createElement(WorkspaceDownloadEntry));
    await showDesktop({
      protocolVersion: 1, availableVersion: "0.2.0 (12)", phase: "downloading", progress: 41,
      offerID: "b75e9546-2b27-4ee6-bdb2-bcb11f882652",
    });
    expect(host.querySelector("a")).toBeNull();
    const status = host.querySelector("[role='status']");
    expect(status?.getAttribute("data-interactive")).toBe("false");
    expect(status?.getAttribute("aria-label")).toContain("41%");

    await showDesktop({
      protocolVersion: 1, availableVersion: "0.2.0 (12)", phase: "installing",
      offerID: "b75e9546-2b27-4ee6-bdb2-bcb11f882652",
    });
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector("[role='status']")?.textContent).toContain("更新中");

    await showDesktop({ protocolVersion: 1, availableVersion: null, phase: "failed" });
    const retry = host.querySelector("a");
    expect(retry?.getAttribute("href")).toBe("talentsignal-desktop://updates");
    expect(retry?.getAttribute("aria-label")).toContain("重新检查");
  });

  it("puts an explicit install/restart banner at the top of the avatar popover", async () => {
    const host = await render(createElement(WorkspaceAccountMenu, {
      accountName: "Synthetic User", workspaceName: null, signOutAction: () => {},
    }));
    const popover = host.querySelector("[aria-label='账号与空间操作']");
    await showDesktop({
      protocolVersion: 1, availableVersion: "0.2.0 (12)", phase: "available",
      offerID: "b75e9546-2b27-4ee6-bdb2-bcb11f882652",
    });
    const banner = popover?.querySelector("[role=status]");
    expect(banner?.textContent).toContain("macOS 0.2.0 (12)");
    const action = banner?.querySelector("a");
    expect(action?.getAttribute("href")).toContain("install-update?offer=b75e9546");
    expect(action?.textContent).toBe("安装");
    expect(action?.getAttribute("aria-label")).toContain("并重启");

    await showDesktop({ protocolVersion: 1, availableVersion: null });
    expect(popover?.textContent).not.toContain("macOS 0.2.0 (12)");
    expect(popover?.querySelector("[href*='install-update'], a[href='talentsignal-desktop://updates']")).toBeNull();
  });

  it("rejects unknown protocols and malformed display values", () => {
    expect(desktopVersion({ protocolVersion: 2, availableVersion: "2.0" })).toBeNull();
    expect(desktopVersion({ protocolVersion: 1, availableVersion: "<script>" })).toBeNull();
    expect(desktopVersion({ protocolVersion: 1, availableVersion: "a".repeat(41) })).toBeNull();
    expect(desktopVersion({ protocolVersion: 1, availableVersion: "0.2.0 (12)" })).toBe("0.2.0 (12)");
  });
});

describe("weekly usage row", () => {
  it("shows the plain count with a disclosure of window, allowance and retention truth", async () => {
    const store = manualStore({ status: "ready", usage: usageResponse(12) });
    const host = await render(createElement(WeeklyUsageRow, { store }));
    expect(host.textContent).toContain("本周已记录运行");
    expect(host.textContent).toContain("12");
    const disclosure = host.querySelector("button");
    expect(disclosure?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      disclosure?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("9月28日 – 10月5日");
    expect(host.textContent).toContain("北京时间，每周一重置");
    expect(host.textContent).toContain("每周参考额度 1000");
    expect(host.textContent).toContain("不限制使用");
    expect(host.textContent).toContain("不是付费余额");
    expect(host.textContent).toContain("重试不重复计数");
  });

  it("keeps a read failure visible with retry and never a fabricated 0", async () => {
    const store = manualStore({ status: "error" });
    const host = await render(createElement(WeeklyUsageRow, { store }));
    expect(host.textContent).toContain("暂时无法读取");
    expect(host.textContent).not.toMatch(/本周已记录运行[^]*?0[^]*?每周参考额度/);
    const retry = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "重试",
    );
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(store.refreshed).toBe(1);
  });

  it("shows loading honestly and hides a previous account's result after switching", async () => {
    const loading = manualStore({ status: "loading" });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(WeeklyUsageRow, { store: loading })));
    expect(host.textContent).toContain("读取中…");

    const stale = manualStore({ status: "ready", usage: usageResponse(99) });
    const menu = (accountName: string, store: WeeklyUsageStore | null) =>
      createElement(WorkspaceAccountMenu, { accountName, workspaceName: null, signOutAction: () => {}, usage: store });
    await act(async () => root!.render(menu("Account A", stale)));
    expect(host.textContent).toContain("99");
    // Switching account scope must not keep the old account's count visible.
    await act(async () => root!.render(menu("Account B", null)));
    expect(host.textContent).not.toContain("99");
    expect(host.textContent).toContain("读取中…");
  });
});
