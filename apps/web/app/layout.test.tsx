import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { expect, it, vi } from "vitest";
import type { LanguagePreference, LocaleTag } from "@talent-signal/contracts";
import { useT } from "@/components/locale-provider";
import { LanguageSwitcher } from "@/components/marketing/language-switcher";

const request = vi.hoisted(() => ({ locale: "en" as LocaleTag, accountLanguage: null as LanguagePreference | null }));
vi.mock("@/lib/server/marketing-locale", () => ({
  getMarketingLocale: async () => request.locale,
  accountDisplayLanguage: async () => request.accountLanguage,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import RootLayout from "./layout";

function InterfaceLabel() {
  const t = useT();
  return <main id="main-content"><button>{t("language.save")}</button></main>;
}

it.each(["en", "ja", "ko", "zh-TW"] as const)("keeps translated controls in the %s document language", async locale => {
  request.locale = locale;
  request.accountLanguage = null;
  const window = new Window();
  window.document.write(renderToStaticMarkup(await RootLayout({ children: <InterfaceLabel /> })));
  const control = window.document.querySelector("main button")!;
  expect(control.closest("[lang]")?.getAttribute("lang")).toBe(locale);
  expect(window.document.documentElement.lang).toBe(locale);
});

it.each(["system", "ja", null] as const)("passes readable account language %s to the public language control", async accountLanguage => {
  request.locale = "ja";
  request.accountLanguage = accountLanguage;
  const window = new Window();
  window.document.write(renderToStaticMarkup(await RootLayout({ children: <LanguageSwitcher /> })));
  if (accountLanguage !== null) {
    expect(window.document.querySelector('a[href="/workspace/settings?section=appearance"]')?.textContent).toBe("日本語");
    expect(window.document.querySelector("select")).toBeNull();
  } else {
    expect(window.document.querySelector("option[selected]")?.getAttribute("value")).toBe("ja");
  }
});
