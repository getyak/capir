// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  applyTheme,
  commitTheme,
  previewTheme,
  revertTheme,
  subscribeTheme,
  themePreferenceSnapshot,
  themeSnapshot,
} from "./theme-preference";

afterEach(() => {
  revertTheme();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

function stubMedia(initialDark: boolean) {
  const listeners = new Set<() => void>();
  let dark = initialDark;
  const query = {
    get matches() { return dark; },
    addEventListener: (_event: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_event: string, listener: () => void) => { listeners.delete(listener); },
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    setDark(next: boolean) {
      dark = next;
      for (const listener of listeners) listener();
    },
  };
}

it("updates the active view when another settings window changes the theme", () => {
  const changed = vi.fn(); const stop = subscribeTheme(changed);
  window.dispatchEvent(new StorageEvent("storage", { key: "talent-signal-theme", newValue: "dark" }));
  expect(themeSnapshot()).toBe("dark"); expect(changed).toHaveBeenCalledOnce();
  window.dispatchEvent(new StorageEvent("storage", { key: "foreign", newValue: "light" }));
  expect(themeSnapshot()).toBe("dark");
  stop();
});

it("still applies a theme when local persistence fails", () => {
  vi.stubGlobal("localStorage", { setItem() { throw new Error("disabled"); } });
  applyTheme("dark"); expect(themeSnapshot()).toBe("dark");
});

it("catches a change from another window before hydration subscribes", () => {
  document.documentElement.dataset.theme = "light";
  localStorage.setItem("talent-signal-theme", "dark");
  const stop = subscribeTheme(() => {});
  expect(themeSnapshot()).toBe("dark");
  stop();
});

it("stages an appearance preview without persisting it", () => {
  previewTheme("dark");
  expect(themeSnapshot()).toBe("dark");
  // Preview must not become the saved choice.
  expect(themePreferenceSnapshot()).toBe("system");
  expect(localStorage.getItem("talent-signal-theme")).toBeNull();

  expect(commitTheme("dark")).toBe(true);
  expect(themePreferenceSnapshot()).toBe("dark");
  expect(localStorage.getItem("talent-signal-theme")).toBe("dark");
});

it("reverts an unsaved preview to the saved preference", () => {
  commitTheme("dark");
  previewTheme("light");
  expect(themeSnapshot()).toBe("light");
  revertTheme();
  expect(themeSnapshot()).toBe("dark");
  expect(themePreferenceSnapshot()).toBe("dark");
});

it("keeps a draft preview when commit cannot persist", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem() { throw new Error("disabled"); },
    removeItem() { throw new Error("disabled"); },
  });
  previewTheme("dark");
  expect(commitTheme("dark")).toBe(false);
  expect(themeSnapshot()).toBe("dark");
  expect(themePreferenceSnapshot()).toBe("system");
});

it("follows the device preference and repaints when it changes", () => {
  const media = stubMedia(false);
  delete document.documentElement.dataset.theme;
  const changed = vi.fn();
  const stop = subscribeTheme(changed);
  expect(themeSnapshot()).toBe("light");

  media.setDark(true);
  expect(themeSnapshot()).toBe("dark");
  expect(changed).toHaveBeenCalled();

  stop();
  media.setDark(false);
  expect(themeSnapshot()).toBe("dark");
});

it("persists follow-system as no override and keeps following the device", () => {
  const media = stubMedia(false);
  commitTheme("system");
  expect(localStorage.getItem("talent-signal-theme")).toBeNull();
  expect(themePreferenceSnapshot()).toBe("system");
  expect(themeSnapshot()).toBe("light");

  const changed = vi.fn();
  const stop = subscribeTheme(changed);
  media.setDark(true);
  expect(themeSnapshot()).toBe("dark");
  expect(changed).toHaveBeenCalled();
  stop();
});
