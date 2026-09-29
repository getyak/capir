// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DesktopAccountLink, DesktopDeviceSettingsLink, DesktopUpdateButton, desktopVersion } from "./desktop-chrome";
import { WorkspaceAccountMenu } from "./workspace-account-menu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  delete window.talentSignalDesktop;
  document.body.innerHTML = "";
});

describe("native desktop chrome", () => {
  it("keeps account management in the browser and device settings in the native window", async () => {
    const host = document.createElement("div"); document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement("div", null,
      createElement(DesktopAccountLink, { onClick() {} }),
      createElement(DesktopDeviceSettingsLink, { onClick() {} }))));
    // A plain browser gets the ordinary Web settings route and no device chrome.
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/workspace/settings");
    expect(host.querySelector("a")?.textContent).toContain("账号与偏好");
    expect(host.querySelector("[href^='talentsignal-desktop://']")).toBeNull();
    expect(host.querySelector("kbd")).toBeNull();

    await act(async () => {
      window.talentSignalDesktop = { protocolVersion: 1, availableVersion: null };
      window.dispatchEvent(new Event("talent-signal-desktop"));
    });
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
    const host = document.createElement("div"); document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(WorkspaceAccountMenu, {
      accountName: "Synthetic User", workspaceName: "Fixture Workspace", signOutAction: () => {},
    })));
    const accountLinks = () => host.querySelectorAll("a[href='/workspace/settings']");
    const deviceLinks = () => host.querySelectorAll("a[href='talentsignal-desktop://settings']");
    expect(accountLinks()).toHaveLength(1);
    expect(deviceLinks()).toHaveLength(0);
    // Ordinary Web users stay in their current workspace and session.
    expect(host.textContent).not.toContain("浏览器登录状态可能与本应用不同");
    expect(accountLinks()[0].textContent).toBe("账号与偏好");
    expect(accountLinks()[0].getAttribute("aria-label")).toBe("账号与偏好");

    await act(async () => {
      window.talentSignalDesktop = { protocolVersion: 1, surface: "workspace", availableVersion: null };
      window.dispatchEvent(new Event("talent-signal-desktop"));
    });
    const account = () => host.querySelectorAll("a[href='talentsignal-desktop://account-settings']");
    expect(account()).toHaveLength(1);
    expect(account()[0].textContent).toContain("账号与偏好 ↗");
    expect(host.textContent).toContain("浏览器登录状态可能与本应用不同");
    expect(deviceLinks()).toHaveLength(1);
    expect(deviceLinks()[0].textContent).toContain("此 Mac 设置…");
    // Neither entry may claim to bring account data back into the app.
    expect(host.textContent).not.toContain("同步");
  });

  it("shows no device chrome and stays usable when the update state is absent", async () => {
    const host = document.createElement("div"); document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement("div", null,
      createElement(DesktopUpdateButton), createElement(DesktopDeviceSettingsLink, { onClick() {} }))));
    expect(host.textContent).toBe("");
    await act(async () => {
      window.talentSignalDesktop = { protocolVersion: 1, availableVersion: "0.2.0" };
      window.dispatchEvent(new Event("talent-signal-desktop"));
    });
    const update = host.querySelector('[href="talentsignal-desktop://updates"]');
    expect(update?.getAttribute("aria-label")).toContain("0.2.0");
    expect(update?.textContent).toBe("更新");
    await act(async () => {
      window.talentSignalDesktop = { protocolVersion: 1, availableVersion: null };
      window.dispatchEvent(new Event("talent-signal-desktop"));
    });
    expect(host.querySelector('[href="talentsignal-desktop://updates"]')).toBeNull();
  });

  it("rejects unknown protocols and malformed display values", () => {
    expect(desktopVersion({ protocolVersion: 2, availableVersion: "2.0" })).toBeNull();
    expect(desktopVersion({ protocolVersion: 1, availableVersion: "<script>" })).toBeNull();
    expect(desktopVersion({ protocolVersion: 1, availableVersion: "a".repeat(41) })).toBeNull();
    expect(desktopVersion({ protocolVersion: 1, availableVersion: "0.2.0 (12)" })).toBe("0.2.0 (12)");
  });

  it("names one-click restart, prevents repeat clicks during progress and exposes failure recovery", async () => {
    const host = document.createElement("div"); document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(DesktopUpdateButton)));
    async function show(phase: "available" | "downloading" | "installing" | "failed" | "idle", progress: number | null = null) {
      await act(async () => {
        window.talentSignalDesktop = { protocolVersion: 1, availableVersion: "0.2.0 (12)", phase, progress, offerID: "b75e9546-2b27-4ee6-bdb2-bcb11f882652" };
        window.dispatchEvent(new Event("talent-signal-desktop"));
      });
    }
    await show("available");
    expect(host.querySelector("a")?.textContent).toBe("更新并重启");
    expect(host.querySelector("a")?.getAttribute("href")).toContain("install-update?offer=b75e9546");
    expect(host.querySelector("a")?.getAttribute("aria-label")).toContain("0.2.0 (12) 并重启");
    await show("downloading", 41);
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector('[role="status"]')?.getAttribute("aria-label")).toContain("41%");
    await show("installing");
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toBe("更新中");
    await show("failed");
    expect(host.querySelector("a")?.getAttribute("aria-label")).toContain("重新检查");
    await show("idle");
    expect(host.textContent).toBe("");
  });
});
