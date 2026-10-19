# Internationalization

How capri speaks to users, and where each language decision lives. Rationale
for the framework and storage choices is in
[`decisions/2026-10-19-core-locale-i18n-and-language-preferences.md`](decisions/2026-10-19-core-locale-i18n-and-language-preferences.md).

## Supported locales

| Canonical tag | UI name (endonym) | Apple identifier | Chrome `_locales` |
| --- | --- | --- | --- |
| `en` | English | `en` | `en` |
| `zh-CN` | 简体中文 | `zh-Hans` | `zh_CN` |
| `zh-TW` | 繁體中文 | `zh-Hant` | `zh_TW` |
| `ja` | 日本語 | `ja` | `ja` |
| `ko` | 한국어 | `ko` | `ko` |

The canonical list lives in `packages/contracts` (`SUPPORTED_LOCALES`,
`LocaleTag`) and every surface maps from it. Option labels are always shown
in the language they select (endonyms), never translated.

### Fallback chain

Exact tag → base-language match (`zh-Hant`, `zh-HK`, `zh-MO` → `zh-TW`;
`zh-Hans`, `zh` → `zh-CN`; `en-*` → `en`; `ja-*` → `ja`; `ko-*` → `ko`) →
`en`. Unknown or missing locale never blocks rendering.

## The two language settings

Both are stored user preferences; both default to `system`.

1. **Display language** (`display_language`): the language of interface
   chrome — navigation, labels, buttons, empty/error/loading states, system
   messages. `system` follows the device/browser language through the
   fallback chain. Stored with account settings
   (`AccountSettings.preferences`); every surface reads the same value.
2. **Prompt-output language** (`prompt_output_language`): the language the
   agent writes in — replies, drafts, generated summaries. `system` resolves
   to the same language display language resolves to. Stored in the
   agent-preference store alongside `response_style`. Wired into prompt
   assembly as an explicit output-language rule.

### What language settings never change

- Evidence text: `source_excerpt`, quoted conversations, screenshots, and
  stored personal content stay in their original language. The agent never
  translates or rewrites them to satisfy prompt-output language.
- Provenance and state distinctions: evidence, confirmed state,
  interpretation, action, and observed outcome stay distinct in every locale.
- User-entered content (names, notes, workspace names) is displayed as
  entered.

An explicit prompt-output pin overrides workspace language defaults embedded
in prompts; with no pin, prompts keep their existing "use the user's
language" behavior.

## Where strings live per surface

| Surface | Mechanism | Catalog location |
| --- | --- | --- |
| Web (`apps/web`) | In-repo typed catalog runtime (`apps/web/lib/i18n`: `getT(locale)` for server components, `useT()` for client) | `apps/web/i18n/locales/{en,zh-CN,zh-TW,ja,ko}.json` plus locale-keyed copy modules (`lib/marketing-copy.ts`, `subpageCopy`, story dicts) |
| iOS (`apps/ios`) | String Catalogs | `apps/ios/Resources/Localizable.xcstrings` (`zh-Hans` → also `zh-Hant`, `ja`, `ko`) |
| macOS native (`apps/macos`) | String Catalog | `apps/macos/Resources/Localizable.xcstrings` |
| macOS hybrid (`apps/macos-hybrid`) | Small JS dictionary keyed by canonical tag | alongside `index.html` / `quick-panel.html` |
| Extensions | Chrome `_locales` + `chrome.i18n`, manifest `__MSG_*__` | `load-unpacked/_locales/{en,zh_CN,zh_TW,ja,ko}/messages.json` |

### Web key styles

The web catalogs use two key styles in one lookup:

- **semantic keys** (`language.save`) for named UI labels, with an explicit
  entry in every locale;
- **gettext-style keys** — the zh-CN source string is the key. `zh-CN` is the
  source language of the existing web UI, so extraction wraps a literal in
  `t()`/`useT()` without renaming meaning, and zh-CN resolves to identity.

Resolution order: active locale → original Chinese for zh-family locales →
`en` → caller fallback → key. Locale-keyed copy modules (structured
narrative copy with arrays and nested groups) count as catalogs; the guard
suite treats values in those modules as extracted.

Web interpolation uses `{name}` placeholders; plurals use `.one` / `.other`
key suffixes with `Intl.PluralRules`. Dates, numbers, and lists format via
`Intl.*` for the active locale.

## Translation quality rules

- Web source strings are zh-CN (the existing UI language); `en` is the
  source language for iOS/macOS/extension keys.
- `zh-TW` is Traditional Chinese authored for Taiwan readers (terminology
  and idiom), not converted `zh-CN`.
- `ja` and `ko` are native-quality, respecting each locale's politeness
  convention for UI copy.
- `en` is the source language for web/macOS/extension keys; iOS source is
  `en`.
- Keep the evidence vocabulary consistent: a shared glossary translates
  evidence / confirmed / interpretation / proposal terms the same way
  everywhere so state distinctions stay crisp.
- Machine-translation drafts must be reviewed before shipping; untranslated
  keys fall back to `en`, never to raw keys.

## Checks that enforce this

- A guard test fails if CJK or other non-source literals appear in
  user-facing code outside catalogs (documented allowlist only).
- Catalog completeness tests fail if any locale misses a key present in `en`.
- `pnpm docs:check` covers documentation changes.

## Adding a locale

1. Add the canonical tag + platform mappings and fallback entry in
   `packages/contracts`.
2. Add the locale to each catalog surface (web JSON, `Localizable.xcstrings`
   entries, extension `messages.json`, hybrid dictionary).
3. Add the endonym to the language pickers' option list.
4. Extend completeness/guard tests and verify key surfaces in the new locale.

## Language pickers (settings)

Workspace settings shows two labeled controls under one language section:
display language ("Follow system" default) and prompt-output language
("Follow system" default). Labels describe behavior; they never rank people,
candidates, or languages.
