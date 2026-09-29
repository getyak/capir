// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DesktopSettingsLink, DesktopUpdateButton, desktopVersion } from "./desktop-chrome";
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
  it("offers one context-correct Settings entry in the avatar menu", async () => {
    const host = document.createElement("div"); document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(WorkspaceAccountMenu, {
      accountName: "Synthetic User", workspaceName: "Fixture Workspace", signOutAction: () => {},
    })));
    const settingsLinks = () => host.querySelectorAll(
      'a[href="/workspace/settings"], a[href="talentsignal-desktop://settings"]',
    );
    expect(settingsLinks()).toHaveLength(1);
    expect(settingsLinks()[0].getAttribute("href")).toBe("/workspace/settings");

    await act(async () => {
      window.talentSignalDesktop = { protocolVersion: 1, surface: "workspace", availableVersion: null };
      window.dispatchEvent(new Event("talent-signal-desktop"));
    });
    expect(settingsLinks()).toHaveLength(1);
    expect(settingsLinks()[0].getAttribute("href")).toBe("talentsignal-desktop://settings");
    expect(settingsLinks()[0].textContent).toContain("设置");
  });

  it("uses the Web settings route in browsers and the native window in a supported host", async () => {
    const host = document.createElement("div"); document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement("div", null,
      createElement(DesktopUpdateButton), createElement(DesktopSettingsLink, { onClick() {} }))));
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/workspace/settings");
    expect(host.querySelector("kbd")).toBeNull();
    await act(async () => {
      window.talentSignalDesktop = { protocolVersion: 1, availableVersion: null };
      window.dispatchEvent(new Event("talent-signal-desktop"));
    });
    expect(host.textContent).toContain("设置");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("talentsignal-desktop://settings");
    expect(host.querySelector("kbd")?.textContent).toBe("⌘ ,");
    expect(host.querySelector('[href="talentsignal-desktop://updates"]')).toBeNull();
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
