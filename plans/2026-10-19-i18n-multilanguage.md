# i18n multi-language support (goal mvfbrrdm-gbxwjh)

## Outcome

Full multi-language support across all capri surfaces (web, iOS, macOS,
browser-extension, chrome-extension) for five locales — en, zh-CN, zh-TW, ja,
ko — with two independent settings: prompt-output language and system display
language (default: follow system). Prompt-output language is wired into agent
prompts. Work completes only after a product-adjudicator multi-lens review
shows zero open P0/P1 and affected resident services are deployed and verified.

## Worktree and base

- Worktree: `/Users/xiongxinwei/data/mine/cubxxw/personal/talent-signal-i18n`
- Branch: `agent/i18n-multilang`
- Base revision: `50047ca02c0c4f83950c9269cda38ddc5e21e06e`
  (`50047ca0 Merge remote-tracking branch 'origin/main'`)
- The main worktree keeps its unrelated uncommitted changes; this work must
  not touch them.

## Scope

In scope:

1. Shared i18n architecture and locale model (design first).
2. Persisted language preferences + settings UI (two controls).
3. Web UI localization into core 5.
4. iOS and macOS localization into core 5.
5. browser-extension and chrome-extension localization into core 5.
6. Agent prompt-output language wiring (generated output language only).
7. Checks, docs, adjudicator review (P0/P1 gate), deployment + live verification.

Out of scope:

- Locales beyond the core five (architecture stays extensible).
- Translating stored evidence, personal conversations, user content, or
  canonical repository documentation (docs stay English).
- Ranking, scoring, or person-evaluation changes of any kind.

## Current evidence and unknowns

- No i18n framework exists anywhere in `apps/*` or `packages/*` (grep over
  ts/tsx/js/json found only lighthouse artifacts under `output/`). Greenfield.
- Web settings page lives at `apps/web/app/workspace/settings/`.
- Unknowns to resolve during design: which web i18n library fits the existing
  Next.js app-router setup; where user preferences are persisted today (need
  to inspect settings actions / backend); how prompts are assembled in
  `apps/agent`; how much hardcoded string surface exists per app.

## Milestones (mirrors goal tasks)

- [x] M0 Worktree + branch from clean base (this plan created there).
- [x] M1 i18n architecture + locale model design doc —
      `docs/internationalization.md` +
      `docs/decisions/2026-10-19-core-locale-i18n-and-language-preferences.md`.
- [ ] M2 Language preference model, persistence, settings UI (two controls) —
      DONE: contracts `i18nSchemas` + additive preference fields, migration
      `101_user_language_preferences` (incl. audit kind allowlist),
      display-language group in Appearance pane, prompt-output language on
      `/workspace/preferences`, 5-locale language pickers (endonyms), web
      catalog runtime + first slice; integration-tested on PostgreSQL 17
      (17 tests incl. revision/idempotency/audit/lab-account cases).
- [ ] M3 Web localization (core 5).
- [ ] M4 iOS + macOS localization (core 5).
- [ ] M5 Extensions localization (core 5).
- [ ] M6 Agent prompt-output language wiring + tests.
- [ ] M7 Checks green + docs updated (pnpm docs:check when docs change).
- [ ] M8 product-adjudicator review; zero open P0/P1.
- [ ] M9 Deploy affected resident services per
      `docs/operations/testflight-local-backend.md`; verify live revision and
      behavior.

One milestone active at a time.

## Completion demonstration

See goal task verification contracts. Summary: checks pass per touched surface,
adjudicator report retained with zero open P0/P1, live deployment revision
recorded and both language settings verified on the real surface in at least
two non-English locales, goal topic re-read item by item.

## Deviations

(None yet.)
