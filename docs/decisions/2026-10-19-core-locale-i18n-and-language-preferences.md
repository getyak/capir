# Core-locale i18n and two-scope language preferences

Status: accepted, 2026-10-19.

## Context

capri has no i18n framework. Web copy is hardcoded (500+ files carry Chinese
literals), iOS ships `en` + `zh-Hans` in String Catalogs, macOS ships none,
and the extensions ship English strings inline. Users need the product in
en, zh-CN, zh-TW, ja, and ko, with two independent language choices: what
language the assistant writes in, and what language the interface displays
(the latter defaulting to the system language). Language choices must survive
across web, iOS, macOS, and extensions, and generated output must never
rewrite stored evidence.

## Choice

1. **One canonical locale model in `packages/contracts`.** Supported tags are
   `en`, `zh-CN`, `zh-TW`, `ja`, `ko`; each platform maps them natively
   (Apple `zh-Hans`/`zh-Hant`, Chrome `_locales` `zh_CN`/`zh_TW`). Fallback:
   exact tag → script/region base match (`zh-Hant|zh-HK|zh-MO`→`zh-TW`,
   `zh-Hans|zh`→`zh-CN`, `en-*`→`en`, `ja-*`→`ja`, `ko-*`→`ko`) → `en`.
   Adding a locale touches one constant plus per-platform catalogs.
2. **Two stored user preferences, both defaulting to `system`.**
   `display_language` resolves per platform (browser/OS language) and drives
   UI chrome only. `prompt_output_language` drives generated assistant text
   only; when `system`, it resolves to the same language the display resolves
   to, so one knob is enough unless the user wants them different.
   Prompt-output language never translates or rewrites `source_excerpt`,
   quoted evidence, stored conversations, or provenance text.
3. **Persist server-side in the two existing user-scoped stores.**
   `prompt_output_language` extends the agent-preference store
   (`agent_user_preferences`, mirroring `response_style` with revision +
   `user_setting` provenance). `display_language` extends account settings
   (`AccountSettings.preferences`, mutation with `expected_revision`). Both
   are read by every surface so choices travel across devices and apps.
4. **Platform-idiomatic rendering, no new web framework.** Web gets an
   in-repo typed catalog runtime (`apps/web/lib/i18n`, JSON catalogs per
   locale) — settings-driven locale does not need URL routing or middleware,
   and existing vitest coverage stays deterministic. iOS extends
   `Localizable.xcstrings` (add `zh-Hant`, `ja`, `ko`) and resolves an
   in-app display-language override through a language-specific bundle;
   macOS gets its own String Catalog; the Tauri hybrid and both extensions
   use small dictionaries keyed by the canonical tags (Chrome `_locales` for
   the extensions).
5. **Prompt assembly carries an explicit output-language rule.** The
   preference is resolved at prompt build time (same path as
   `response_style`), and the rule states that it changes generated output
   only. An explicit pin overrides workspace language defaults in prompts;
   with no preference the existing "use the user's language" behavior stands.

## Consequences

- Translation authoring is the bulk of the work: ~2,750 iOS keys × 3 new
  locales, ~500 web files of extracted strings, plus macOS and extensions.
  zh-TW must be authored as Traditional Chinese with Taiwan terminology, not
  converted from zh-CN; ja/ko must be native-quality.
- A CJK-literal guard test makes hardcoded-string regressions fail checks.
- Backend, web, and agent change together, so deployment covers the resident
  services those surfaces call (per operations docs).
- Evidence text remains in its source language everywhere; only labels and
  chrome localize. This keeps provenance auditable in every locale.

## Reconsideration signals

- If locale-prefixed URLs or SEO localization ever becomes a requirement,
  revisit the web runtime (next-intl-style middleware) — the catalogs
  transfer unchanged.
- If more than ~8 locales ship, move catalog QA to a translation pipeline
  with reviewer workflow instead of in-repo authored JSON.
- If iOS per-app language override proves fragile in practice, fall back to
  system-language-only on Apple platforms and document the difference.
