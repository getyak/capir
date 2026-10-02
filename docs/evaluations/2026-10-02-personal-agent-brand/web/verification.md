# Web implementation verification

## Result and boundary

The homepage now demonstrates a lightweight screenshot handoff and continuation of one unfinished thing. The source is a synthetic, Chinese WeChat-style transcript with explicit speaker and absolute source time. The Agent response precedes a user-controlled save. A later synthetic screenshot proposes an update to item 01 and requires separate confirmation. Reminder pause retains context; source removal retracts dependent current answers, including the shared person-page projection. Replay never restores a removed source. A named new synthetic demo explicitly reloads the sample.

No demonstration action reads an account, connects to WeChat, saves actual records, schedules reminders, or sends messages. Scope is visible beside the Agent response. Actual product availability remains distinct from this target experience.

## Brand and copy

User-visible Web display names use capri, with shared site configuration for brand mark, public metadata, manifest, email request subject, and footer. Product/method/trust/pricing copy explains intentional capture, identity review, time-bounded context, distinct work, waiting, and source withdrawal. Blog index and RSS now describe general relationship research; published recruiting articles retain their original scenarios and historical source citations. Existing recruiting demonstration fixtures remain specific.

Persistent package names, URLs, support email, storage keys, authentication protocol, iCalendar PRODID, and historical fixture actors remain compatible. Download copy explicitly explains that existing published packages may retain the Talent Signal display name; a website rename is not a new package release.

Nine isolated legacy homepage film/universe/vision files were removed only after a repository-wide reference check. Their existing playback safety is covered by the replacement reducer tests.

## Checks

- `pnpm --filter @talent-signal/web exec vitest run components/workspace-chrome-states.test.ts components/desktop-chrome.test.ts lib/workspace-shell-render.test.ts components/conversation/queued-conversation-transcript.test.ts components/session-workbench/session-presentation-workbench.test.ts lib/personal-agent-copy.test.ts components/marketing/personal-agent-demo.test.tsx lib/personal-agent-demo.test.ts lib/workspace-composer.test.ts lib/auth-config.test.ts lib/workspace-loading.test.ts`: 11 files, 95 tests passed.
- Web full ESLint: 0 errors, 6 pre-existing unused-variable warnings in unrelated account/server files. Narrow ESLint over new homepage, demo, state, localized FAQ and tests: 0 warnings/errors.
- Web `tsc6 --noEmit`: passed. The first check overlapped removal of legacy files and reported missing files; a fresh run passed.
- Production `next build`: first compilation and TypeScript passed, then the existing production AUTH_SECRET guard rejected absent configuration. Re-run with a disposable, build-only secret passed compilation, TypeScript, page collection, all 41 static pages, and route finalization. No live credentials were accessed. The final one-line pre-rAF hidden-page guard was subsequently source-reviewed independently; it does not change the product contract or persisted state.
- `git diff --check -- apps/web`: passed.

The visible localized FAQ and FAQPage structured data share `lib/personal-agent-copy.ts`; English schema is no longer Chinese or a different set of questions.

## Rendering and review

Static A desktop/mobile evidence and source prototypes are retained here. The parent independently rendered both A and B, selected A's source-to-result hero plus B's continuity section, and owns final real-browser verification at desktop/mobile, light/dark, keyboard, reduced motion, source removal, update, and pause. These visual results are reported in the parent's evidence, not inferred from build success.

The prototype server on port 4913 was stopped. Isolated temporary Chrome profiles were removed. No simulator or native build was started by this Web task.

## Full CI correction

The first complete Web run passed 1,662 tests and found one stale marketing-locale
assertion requiring the former demo anchor. The same test also held the legacy
email-subject expectation, masked by its first failure. Both expectations now
match the actual new homepage anchor and capri access subject. Four relevant
files / 25 tests passed after correction; no production behavior changed.
Latest-head CI is verified separately through the associated GitHub PR checks.
