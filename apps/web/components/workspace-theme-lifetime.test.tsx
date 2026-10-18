// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commitTheme, previewTheme, revertTheme } from "@/lib/theme-preference";
import { AvatarPreferencesProvider } from "./avatar-preferences-provider";
import { ComposerAddMenu } from "./new-conversation-add-menu";
import { WorkspaceAccountMenu } from "./workspace-account-menu";

let root: Root | undefined;
let host: HTMLDivElement;

function systemAppearance() {
  let dark = false;
  const queries = new Map<string, MediaQueryList>();
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    let media = queries.get(query);
    if (!media) {
      media = new EventTarget() as MediaQueryList;
      Object.defineProperties(media, {
        media: { value: query },
        matches: { get: () => query === "(prefers-color-scheme: dark)" && dark },
      });
      queries.set(query, media);
    }
    return media;
  });
  return (next: boolean) => {
    if (dark === next) return;
    dark = next;
    queries.get("(prefers-color-scheme: dark)")?.dispatchEvent(new Event("change"));
  };
}

async function settle(change: () => void) {
  await act(async () => {
    change();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mountWorkspace() {
  root = createRoot(host);
  await act(async () => root!.render(
    <AvatarPreferencesProvider scope="theme-lifetime">
      <WorkspaceAccountMenu accountName="Synthetic User" workspaceName={null} signOutAction={() => {}} />
      <ComposerAddMenu binding={null} onNavigate={() => {}} />
    </AvatarPreferencesProvider>,
  ));
  expect(document.querySelector('[aria-label="账号与空间操作"]')).toBeNull();
  await settle(() => host.querySelector<HTMLButtonElement>("[data-add-trigger]")!.click());
  const panel = document.querySelector<HTMLElement>("[data-add-panel]")!;
  expect(panel).not.toBeNull();
  expect(host.contains(panel)).toBe(false);
  return panel;
}

function expectTheme(panel: HTMLElement, theme: "light" | "dark") {
  expect(document.documentElement.dataset.theme).toBe(theme);
  expect(document.querySelector("[data-add-panel]")).toBe(panel);
  expect(panel.dataset.theme).toBe(theme);
  const surface = theme === "dark" ? "#1b1b19" : "#fcfbf7";
  expect(window.getComputedStyle(host).getPropertyValue("--surface")).toBe(surface);
  expect(panel.style.getPropertyValue("--surface")).toBe(surface);
  expect(document.querySelector('[aria-label="账号与空间操作"]')).toBeNull();
}

function storageChange(value: "light" | "dark" | null) {
  if (value === null) localStorage.removeItem("talent-signal-theme");
  else localStorage.setItem("talent-signal-theme", value);
  window.dispatchEvent(new StorageEvent("storage", {
    key: "talent-signal-theme", newValue: value, storageArea: localStorage,
  }));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  revertTheme();
  host = document.createElement("div");
  host.className = "ts-workspace-theme quiet-workspace";
  document.body.append(host);
  // happy-dom does not recalculate custom properties after ancestor attribute
  // changes. Stand in for CSS resolution only, using the production-painted
  // document theme; neither the test nor this stand-in installs a subscriber.
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const computed = computedStyle(element, pseudo);
    if (element !== host) return computed;
    return new Proxy(computed, {
      get(target, property) {
        if (property === "getPropertyValue") return (name: string) => name === "--surface"
          ? document.documentElement.dataset.theme === "dark" ? "#1b1b19" : "#fcfbf7"
          : target.getPropertyValue(name);
        return Reflect.get(target, property);
      },
    });
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  localStorage.clear();
  revertTheme();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workspace theme lifetime with account controls closed", () => {
  it("follows saved system appearance through the source and the same open composer portal", async () => {
    const setDark = systemAppearance();
    commitTheme("system");
    const panel = await mountWorkspace();
    expectTheme(panel, "light");
    await settle(() => setDark(true));
    expectTheme(panel, "dark");
    await settle(() => setDark(false));
    expectTheme(panel, "light");
  });

  it("synchronizes another tab's saved override and return to system without opening account controls", async () => {
    const setDark = systemAppearance();
    commitTheme("system");
    const panel = await mountWorkspace();
    await settle(() => storageChange("dark"));
    expectTheme(panel, "dark");
    await settle(() => { setDark(true); setDark(false); });
    expectTheme(panel, "dark");
    await settle(() => storageChange(null));
    expectTheme(panel, "light");
  });

  it("protects an unsaved preview from system and cross-tab changes until cancel", async () => {
    const setDark = systemAppearance();
    commitTheme("light");
    const panel = await mountWorkspace();
    await settle(() => previewTheme("dark"));
    expectTheme(panel, "dark");
    await settle(() => { storageChange(null); setDark(true); setDark(false); });
    expectTheme(panel, "dark");
    await settle(() => { revertTheme(); });
    expectTheme(panel, "light");
  });

  it("stops source updates from system and storage after the workspace unmounts", async () => {
    const setDark = systemAppearance();
    commitTheme("system");
    const panel = await mountWorkspace();
    await settle(() => setDark(true));
    expectTheme(panel, "dark");
    await act(async () => root!.unmount());
    root = undefined;
    await settle(() => setDark(false));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await settle(() => storageChange("light"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
