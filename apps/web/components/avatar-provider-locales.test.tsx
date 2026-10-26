// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocaleTag } from "@talent-signal/contracts";
import { translate } from "@/lib/i18n";
// Hold the editor suspended so the provider's own loading status is observable.
const loading = new Promise<never>(() => undefined);
vi.mock("./avatar-editor-dialog", () => ({ default: () => { throw loading; } }));
import { AvatarEditor } from "./avatar-editor";
import { AvatarPreferencesProvider } from "./avatar-preferences-provider";
import { LocaleProvider } from "./locale-provider";
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it.each(["en", "ja", "ko", "zh-TW"] as LocaleTag[])("announces the lazy avatar editor in %s", async locale => {
  await act(async () => root.render(<LocaleProvider locale={locale}><AvatarPreferencesProvider scope="locale"><AvatarEditor id="one" label="中文原名" /></AvatarPreferencesProvider></LocaleProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.querySelector('[role="status"]')?.textContent).toBe(translate(locale, "正在打开头像设置…"));
  expect(localStorage.length).toBe(0);
});
