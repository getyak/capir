"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MarketingLocale } from "@/lib/marketing-locale";
import { translate, type TranslateVars } from "@/lib/i18n";

const LocaleContext = createContext<MarketingLocale>("zh-CN");
export function MarketingLocaleProvider({
  locale,
  children,
}: {
  locale: MarketingLocale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}
export function useMarketingLocale() {
  return useContext(LocaleContext);
}

export type TFunction = (key: string, vars?: TranslateVars) => string;
/** Catalog translate bound to the active display locale. */
export function useT(): TFunction {
  const locale = useMarketingLocale();
  return (key, vars) => translate(locale, key, vars);
}
