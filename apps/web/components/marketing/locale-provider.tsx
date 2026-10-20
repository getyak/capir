"use client";

/**
 * Compatibility shim: the locale context lives in `components/locale-provider`
 * so workspace surfaces can share it without importing from `marketing/`.
 */
export {
  LocaleProvider as MarketingLocaleProvider,
  useLocale as useMarketingLocale,
  useAccountLocale,
  useT,
  type TFunction,
} from "../locale-provider";
