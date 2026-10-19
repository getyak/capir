import type { LocaleTag } from "@talent-signal/contracts";
import en from "@/i18n/locales/en.json";
import zhCN from "@/i18n/locales/zh-CN.json";
import zhTW from "@/i18n/locales/zh-TW.json";
import ja from "@/i18n/locales/ja.json";
import ko from "@/i18n/locales/ko.json";

/**
 * The web catalog runtime (docs/internationalization.md).
 *
 * Flat key -> string catalogs per canonical locale. Interpolation uses
 * `{name}` placeholders. A missing key falls back to `en`, then to the key
 * itself — rendering never blocks on translation state.
 */
export type Catalog = Readonly<Record<string, string>>;

export const catalogs: Readonly<Record<LocaleTag, Catalog>> = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja,
  ko,
};

export type TranslateVars = Readonly<Record<string, string | number>>;

/** `{name}` placeholder substitution; unknown names stay as written. */
export function interpolate(
  template: string,
  vars?: TranslateVars,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function translate(
  locale: LocaleTag,
  key: string,
  vars?: TranslateVars,
): string {
  const template = catalogs[locale][key] ?? catalogs.en[key] ?? key;
  return interpolate(template, vars);
}
