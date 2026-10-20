import type { LocaleTag } from "@talent-signal/contracts";
import en from "@/i18n/locales/en.json";
import zhCN from "@/i18n/locales/zh-CN.json";
import zhTW from "@/i18n/locales/zh-TW.json";
import ja from "@/i18n/locales/ja.json";
import ko from "@/i18n/locales/ko.json";

/**
 * The web catalog runtime (docs/internationalization.md).
 *
 * Two key styles share one lookup:
 * - semantic keys (`language.save`) — explicit labels, full entry per locale;
 * - gettext-style keys — the zh-CN source string IS the key, so extraction
 *   wraps a literal without renaming its meaning; zh-CN resolves to identity.
 *
 * Interpolation uses `{name}` placeholders. Resolution: active locale ->
 * original Chinese for zh-family locales -> `en` -> caller fallback -> key.
 * Rendering never blocks on translation state.
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

const CJK = /[\u3040-\u30ff\u3400-\u9fff]/;

export function translate(
  locale: LocaleTag,
  key: string,
  vars?: TranslateVars,
  fallback?: string,
): string {
  const resolved =
    catalogs[locale][key]
    ?? (CJK.test(key) && locale.startsWith("zh") ? key : undefined)
    ?? catalogs.en[key]
    ?? fallback
    ?? key;
  return interpolate(resolved, vars);
}
