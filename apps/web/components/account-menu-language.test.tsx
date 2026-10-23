// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { LanguagePreference, LocaleTag } from "@talent-signal/contracts";
import { LocaleProvider } from "./locale-provider";
import { WorkspaceAccountMenu } from "./workspace-account-menu";

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it.each<[LocaleTag, LanguagePreference | null, string, string]>([
  ["en", "system", "Display language", "Follow system · English"],
  ["zh-CN", "system", "界面语言", "跟随系统 · 简体中文"],
  ["ja", "ja", "表示言語", "日本語"],
  ["zh-TW", "zh-TW", "介面語言", "繁體中文"],
  ["en", "en", "Display language", "English"],
  ["en", null, "Display language", "Preference unavailable · English"],
])("projects the actual %s preference %s in the open account menu", async (locale, preference, label, value) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  const loading = { status: "loading" } as const;
  await act(async () => root!.render(
    <LocaleProvider locale={locale} accountLocale={preference !== null} accountLanguage={preference}>
      <WorkspaceAccountMenu accountName="Synthetic User" workspaceName={null} signOutAction={() => {}}
        usage={{ subscribe: () => () => {}, getSnapshot: () => loading, dispose() {}, refresh() {} }} />
    </LocaleProvider>,
  ));
  await act(async () => mount.querySelector<HTMLButtonElement>("[data-slot='account-trigger']")!.click());
  const row = document.querySelector(`[role='group'][aria-label='${label}']`);
  expect(row?.textContent).toBe(label + value);
});
