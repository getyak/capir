import {
  resolveDisplayLocale,
  SUPPORTED_LOCALES,
  type LocaleTag,
} from "@talent-signal/contracts";

/**
 * The public-site locale negotiation, aligned to the canonical locale model
 * (docs/internationalization.md). Names stay `marketing*` for compatibility
 * with existing surfaces; the identity and fallback chain live in
 * `@talent-signal/contracts`.
 */
export const marketingLocales = SUPPORTED_LOCALES;
export type MarketingLocale = LocaleTag;
export const localeCookie = "talent-signal-locale";

export function isMarketingLocale(value: unknown): value is MarketingLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Transitional narrowing for copy that still ships as zh-CN/en inline
 * dictionaries: zh-TW reads zh-CN copy, ja/ko read en. Removed by the web-i18n
 * extraction when every dictionary moves into the five-locale catalogs.
 */
export function legacyCopyLocale(locale: MarketingLocale): "zh-CN" | "en" {
  return locale.startsWith("zh") ? "zh-CN" : "en";
}

/**
 * Explicit preference wins; otherwise honor the browser's weighted language
 * list through the canonical fallback chain (zh-Hant|zh-HK|zh-MO -> zh-TW,
 * zh-Hans|zh -> zh-CN, ja-* -> ja, ko-* -> ko, en-* -> en) and always end at
 * `en`. An unknown preference is ignored, never a rendering blocker.
 */
export function resolveMarketingLocale(
  preference?: string,
  acceptLanguage = "",
): MarketingLocale {
  if (isMarketingLocale(preference)) return preference;
  const languages = acceptLanguage
    .split(",")
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().toLowerCase().split(";");
      const q = parameters.find((parameter) =>
        parameter.trim().startsWith("q="),
      );
      return { tag, index, weight: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter(
      ({ weight }) => Number.isFinite(weight) && weight > 0 && weight <= 1,
    )
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return resolveDisplayLocale("system", languages.map(({ tag }) => tag));
}
