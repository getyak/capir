"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { LanguagePreference } from "@talent-signal/contracts";
import type { MarketingLocale } from "@/lib/marketing-locale";
import { translate, type TranslateVars } from "@/lib/i18n";

const LocaleContext = createContext<MarketingLocale>("zh-CN");
const AccountLocaleContext = createContext(false);
const AccountLanguageContext = createContext<LanguagePreference | null>(null);
export function LocaleProvider({
  locale,
  accountLocale = false,
  accountLanguage = null,
  children,
}: {
  locale: MarketingLocale;
  accountLocale?: boolean;
  /** Stored choice, distinct from the effective locale; null means unreadable. */
  accountLanguage?: LanguagePreference | null;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>
      <AccountLocaleContext.Provider value={accountLocale}>
        <AccountLanguageContext.Provider value={accountLanguage}>{children}</AccountLanguageContext.Provider>
      </AccountLocaleContext.Provider>
    </LocaleContext.Provider>
  );
}
export function useLocale() {
  return useContext(LocaleContext);
}
export function useAccountLocale() {
  return useContext(AccountLocaleContext);
}
export function useAccountLanguage() {
  return useContext(AccountLanguageContext);
}

export type TFunction = (key: string, vars?: TranslateVars) => string;
/** Catalog translate bound to the active display locale. */
export function useT(): TFunction {
  const locale = useLocale();
  return useCallback((key, vars) => translate(locale, key, vars), [locale]);
}
