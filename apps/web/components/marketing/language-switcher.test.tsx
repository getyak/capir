// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "../locale-provider";
import { localeCookie } from "@/lib/marketing-locale";
import { LanguageSwitcher } from "./language-switcher";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.refresh.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  document.cookie = `${localeCookie}=; Path=/; Max-Age=0`;
  vi.unstubAllGlobals();
});

it("routes account-language changes to settings instead of offering an ineffective cookie selector", async () => {
  await act(() => root.render(<LocaleProvider locale="ja" accountLocale><LanguageSwitcher /></LocaleProvider>));
  const link = host.querySelector("a");
  expect(link?.getAttribute("href")).toBe("/workspace/settings?section=appearance");
  expect(link?.textContent).toBe("日本語");
  expect(link?.getAttribute("aria-label")).toContain("日本語");
  expect(host.querySelector("select")).toBeNull();
});

it("keeps the working cookie selector for anonymous public visitors", async () => {
  await act(() => root.render(<LocaleProvider locale="en"><LanguageSwitcher /></LocaleProvider>));
  const select = host.querySelector("select")!;
  expect(select.value).toBe("en");
  expect(select.disabled).toBe(false);
  expect(host.querySelector("a")).toBeNull();
  await act(() => {
    select.value = "ko";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(document.cookie).toContain(`${localeCookie}=ko`);
  expect(navigation.refresh).toHaveBeenCalledOnce();
});
