import { Type, type Static } from "@sinclair/typebox";

/**
 * Canonical locale model (docs/internationalization.md).
 *
 * One list, one fallback chain, every surface maps from here. The full
 * translation mechanism is per platform; this file owns only identity and
 * resolution of locales.
 */
export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW", "ja", "ko"] as const;

export const LocaleTagSchema = Type.Union([
  Type.Literal("en"),
  Type.Literal("zh-CN"),
  Type.Literal("zh-TW"),
  Type.Literal("ja"),
  Type.Literal("ko"),
]);

/**
 * A user's language choice. `system` follows the platform language through
 * the fallback chain. Display language and prompt-output language both use
 * this shape and default to `system`.
 */
export const LanguagePreferenceSchema = Type.Union([
  Type.Literal("system"),
  LocaleTagSchema,
]);

export type LocaleTag = (typeof SUPPORTED_LOCALES)[number];
export type LanguagePreference = Static<typeof LanguagePreferenceSchema>;

/** Endonyms: each supported language named in itself, for language pickers. */
export const LOCALE_ENDONYMS: Record<LocaleTag, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
};

const isLocaleTag = (value: string): value is LocaleTag =>
  (SUPPORTED_LOCALES as readonly string[]).includes(value);

/**
 * Match one requested BCP-47 tag to a supported locale.
 * Exact tag -> script/region base match -> undefined (caller falls through).
 */
function matchLocale(rawTag: string): LocaleTag | undefined {
  const tag = rawTag.trim().replace(/_/g, "-").toLowerCase();
  if (!tag) return undefined;
  if (isLocaleTag(rawTag.trim())) return rawTag.trim() as LocaleTag;
  if (tag.startsWith("zh")) {
    const region = tag.split("-").slice(1).join("-");
    return /hant|(^|-)(tw|hk|mo)($|-)/.test(region) ? "zh-TW" : "zh-CN";
  }
  if (tag.startsWith("ja")) return "ja";
  if (tag.startsWith("ko")) return "ko";
  if (tag.startsWith("en")) return "en";
  return undefined;
}

/**
 * Resolve the effective locale.
 *
 * An explicit preference wins. `system` scans the requested platform
 * languages in order through the fallback chain and always ends at `en`;
 * an unknown or missing locale never blocks rendering.
 */
export function resolveDisplayLocale(
  preference: LanguagePreference,
  requested: readonly string[] = [],
): LocaleTag {
  if (preference !== "system") return preference;
  for (const candidate of requested) {
    const match = matchLocale(candidate);
    if (match) return match;
  }
  return "en";
}
