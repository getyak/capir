"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { MarketingLocale } from "@/lib/marketing-locale";
import { translate, type TranslateVars } from "@/lib/i18n";

const LocaleContext = createContext<MarketingLocale>("zh-CN");
const AccountLocaleContext = createContext(false);
export function LocaleProvider({
  locale,
  accountLocale = false,
  children,
}: {
  locale: MarketingLocale;
  accountLocale?: boolean;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>
      <AccountLocaleContext.Provider value={accountLocale}>{children}</AccountLocaleContext.Provider>
    </LocaleContext.Provider>
  );
}
export function useLocale() {
  return useContext(LocaleContext);
}
export function useAccountLocale() {
  return useContext(AccountLocaleContext);
}

export type TFunction = (key: string, vars?: TranslateVars) => string;
/** Catalog translate bound to the active display locale. */
export function useT(): TFunction {
  const locale = useLocale();
  return useCallback((key, vars) => translate(locale, key, vars), [locale]);
}
