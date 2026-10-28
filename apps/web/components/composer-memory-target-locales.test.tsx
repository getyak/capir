// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// Capture the navigation contract while retaining the visible explicit link.
// The production Next Link reads this false before viewport/hover/touch prefetch.
vi.mock("next/link", () => ({ default: ({ prefetch, children, ...props }: { prefetch?: boolean; href: string; children: ReactNode }) => <a {...props} data-prefetch={String(prefetch)}>{children}</a> }));
import { translate } from "../lib/i18n";
import { memoryDraftFailureKey } from "../lib/conversation-memory-draft-target";
import { LocaleProvider } from "./locale-provider";
import { ComposerPersonReference } from "./composer-person-reference";
import zh from "../i18n/locales/zh-CN.json";
import tw from "../i18n/locales/zh-TW.json";
import en from "../i18n/locales/en.json";
import ja from "../i18n/locales/ja.json";
import ko from "../i18n/locales/ko.json";
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const fixtures = [["zh-CN", zh], ["zh-TW", tw], ["en", en], ["ja", ja], ["ko", ko]] as const;
it.each(fixtures)("localizes the explicit reversible action in %s without submitting or fetching Memory", async (locale, catalog) => {
  const prepare = vi.fn();
  await act(async () => root.render(<LocaleProvider locale={locale}><ComposerPersonReference person={{ id: "11111111-1111-4111-8111-111111111111", label: "Lin", detail: "", avatarUrl: null, contexts: [] }} onPrepareMemoryDraft={prepare}/></LocaleProvider>));
  await act(async () => host.querySelector("button")!.click());
  const action = [...document.querySelectorAll("button")].find(button => button.textContent === catalog["composer.memoryDraft.prepare"]);
  expect(action).toBeDefined(); expect(prepare).not.toHaveBeenCalled();
  const profile = document.querySelector<HTMLAnchorElement>(`a[href="/workspace/people/11111111-1111-4111-8111-111111111111"]`)!;
  expect(profile.dataset.prefetch).toBe("false");
  await act(async () => action!.click()); expect(prepare).toHaveBeenCalledOnce();
  for (const key of Object.keys(zh).filter(key => key.startsWith("composer.memoryDraft."))) expect((catalog as Record<string, string>)[key]).toBeTruthy();
  expect(catalog["composer.memoryDraft.target"]).toContain("{person}");
  expect(translate(locale, memoryDraftFailureKey("MEMORY_DRAFT_TARGET_UNSUPPORTED")!)).toBe(catalog["composer.memoryDraft.serviceUnavailable"]);
  expect(catalog["composer.memoryDraft.serviceUnavailable"]).not.toBe(catalog["composer.memoryDraft.unconfirmed"]);
  expect(translate(locale, memoryDraftFailureKey("MEMORY_DRAFT_TARGET_UNAVAILABLE")!)).toBe(catalog["composer.memoryDraft.unavailable"]);
});
