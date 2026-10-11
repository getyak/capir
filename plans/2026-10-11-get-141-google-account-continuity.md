# GET-141: Google account continuity after OAuthAccountNotLinked

## Outcome and boundary

Turn the red "log in the old way, then find Settings yourself" collision error
into an elegant, verified continuity journey: a friendly neutral panel explains
that existing records are preserved and no empty account is created, one
explicit action verifies the original login method and connects Google (or
Apple) on the authenticated Settings surface, and the original safe callback —
including CLI and Mac browser confirmations — continues only after the link is
verified by backend readback. No backend changes, no auto email linking, no
data merge; historical duplicate resolution keeps its existing protected
conflict screen.

## Verified baseline and important unknowns

- Worktree at `71c86a91`; existing web suite green before edits (267 files,
  2092 tests). Web only: `apps/web/*`, `docs/operations/account-access.md`,
  this plan.
- Collision wiring: the backend returns `GOOGLE_ACCOUNT_LINK_REQUIRED` /
  `APPLE_ACCOUNT_LINK_REQUIRED` when a verified provider email already belongs
  to an account; `postOAuthEndpoint` maps it to `OAuthAccountLinkRequired`, the
  jwt callback rethrows `AccountLinkRequired` (static type
  `OAuthAccountNotLinked`), and Auth.js redirects to `/login?error=…` with a
  red generic message. The original callback survives only via the sealed
  Auth.js `talent-signal.callback-url` cookie (`oauthRetryTarget`).
- `@auth/core` 0.41.3 (next-auth `5.0.0-beta.32`) inspected at the installed
  source: an `AuthError` thrown from the `jwt` callback aborts the callback
  action before any cookie is pushed; `sessionStore.clean()` runs only on
  success paths and the error response is a bare redirect. A prior session is
  therefore neither replaced nor cleared on a rejected login; the rejected
  exchange retains no token (the Google attempt cookie is deleted before the
  exchange). Verified by inspection plus callback-level tests of the boundary
  we own — this is not a live OAuth end-to-end proof.
- Settings already owns the safe chain: consent copy, password or linked
  provider step-up (provider-only accounts need no password), fresh target
  proof, staged one-use proof cookies, session/revision bindings, replay and
  stale-tab checks, fail-closed completion on
  `/workspace/settings/link-complete`, success only after authoritative
  `accountSettings` readback. The historical conflict screen and reconciliation
  stay untouched.

## Design

- **Sealed collision hint** (`lib/server/loginCollision.ts`): a rejected unbound
  sign-in seals only `{provider, sealedAt}` in a short-lived HttpOnly cookie.
  It is the sole authority for collision messaging; a forged
  `?error=OAuthAccountNotLinked` or an expired hint shows only the generic
  neutral error and discloses nothing.
- **Continuity panel** (`app/login/login-connect-continuity.tsx`): concise
  neutral copy (title, one paragraph: sign in the original way, connect the
  provider, records stay in the same account; one supporting line), one
  explicit verify-then-connect action and a quiet escape to ordinary login.
- **Navigation-only hints** (`lib/login-continuity.ts`): `?connect=` (allowlisted
  provider) routes completed logins (already-authenticated arrivals included)
  to `/workspace/settings?section=account&connect=…&returnTo=…`; `returnTo` is a
  sanitized same-origin target (login/onboarding/external values are dropped)
  and survives the production canonical hop (`canonicalLoginTarget`). Hints
  steer navigation and are never proof of collision, account or link success.
- **Browser-safe redirect validation** (`lib/safe-redirect.ts`):
  `safeRedirectTarget` lives in a module with no Node/server imports so client
  components can use the hint helpers; `auth-config` re-exports it.
- **Preselected connecting panel**: Settings opens the existing
  `AccountSignInMethods` link panel for the hinted provider — consent,
  current-identity verification (password or linked provider, never a
  mandatory password), fresh target proof and readback as before. `returnTo` is
  sealed inside the operation (minimal navigation state, no tokens) and
  appended to completion redirects.
- **Hints survive every recoverable hop**: the unauthenticated Settings
  redirect keeps the validated hints inside the callback URL (session expiry at
  the connection entry resumes the same journey); initial-action and
  `continueTargetLink` failures return with the sealed (else sanitized form)
  hints; an unknown earlier-round error keeps the sealed operation untouched
  and only carries its sanitized hints. Ref-specific cancellation clears only
  the matched operation, keeps only its sanitized `returnTo`, shows a neutral
  cancelled result and never reopens the panel; foreign/old refs never clear or
  expose a newer operation. A locally cancelled panel leaves a visible
  return-to-work action.
- **Continue and recovery**: readback-verified success offers *continue to the
  original task*; failures return to Settings with a retry hint (`connect=`)
  and a neutral escape, never a success claim.

## Files

- `apps/web/lib/login-continuity.ts`, `apps/web/lib/safe-redirect.ts`,
  `apps/web/lib/server/loginCollision.ts` (new); `apps/web/auth.ts` (seal hint
  on rejected exchange).
- `apps/web/app/login/page.tsx`, `login-connect-continuity.tsx`,
  `login.module.css`; `apps/web/lib/onboarding-navigation.ts` and
  `lib/auth-config.ts` (allowlisted canonical passthrough; re-export).
- `apps/web/lib/server/stagedAuth.ts` (`returnTo` field), settings link actions
  and `link-complete/route.ts` / `link-cancel/route.ts` (hint propagation,
  neutral ref-tied cancellation), Settings page → `SettingsWorkspace` →
  `AccountSettingsPanel` → `AccountSignInMethods` (preselection, hidden return
  field, continue/escape, cancelled result).
- Tests: `lib/login-continuity.test.ts`, `lib/server/loginCollision.test.ts`,
  `lib/login-collision-flow.test.ts` (real jwt callback),
  `app/login/page.test.tsx` (real page composition),
  `app/login/login-connect-continuity.test.tsx`,
  `app/workspace/settings/link-complete/route.test.ts`,
  `app/workspace/settings/link-cancel/route.test.ts` (completion and cancel
  redirects), extended `components/account-sign-in-methods.test.tsx`,
  `app/workspace/settings/login-methods/actions.test.ts`,
  `lib/settings-page-render.test.ts`, `lib/onboarding-navigation.test.ts`.

## Milestones

1. Complete: baseline diagnosis, framework behavior inspection, plan.
2. Complete: sealed hint + continuity panel + hint plumbing + Settings
   preselection with return continuation and recoverable failures.
3. Complete: review hardening — hints preserved through the unauthenticated
   Settings hop, the authenticated login entry, action/continuation failures and
   ref-tied cancellation; browser-safe redirect module; concise copy.
4. Complete: integration tests (callback, action, page, component) and all
   repository gates for the web package, `pnpm docs:check`, and a production
   `next build` client-bundle check.
5. Parent-owned: independent review, live provider round trip, resident
  deployment from clean committed source with live-revision verification, UI
  acceptance and issue closure.

## Verification

- `pnpm --filter @talent-signal/web test` — 274 files / 2142 tests green,
  including real-callback collision staging, real page composition (sealed vs
  forged vs expired hints, CLI/Mac callback preservation, authenticated and
  signed-out continuation redirects, staged-error hint recovery, refusal to
  clear a newer operation), completion/cancel route redirects (verified success
  + backend call; cancelled/expired/stale/cross-account fail closed with no
  write; forged return dropped; neutral ref-tied cancellation) and component
  behavior (provider-only flow, readback-gated continue, recoverable retry,
  cancelled result without panel reopen, return action after local cancel).
- `pnpm --filter @talent-signal/web lint` — exit 0 (six pre-existing warnings
  unchanged); `pnpm --filter @talent-signal/web typecheck` — exit 0.
- `AUTH_SECRET=ci-build-only-not-a-deployment-secret pnpm --filter
  @talent-signal/web build` — exit 0, `✓ Compiled successfully`, client
  chunks contain no Node built-ins (browser-safety of the hint modules proven
  in the production client bundle, not just Vitest).
- `pnpm docs:check` — documentation gate.

## Limitations (not performed, not claimed)

- No live Google OAuth round trip against the resident backend was executed in
  this batch; the callback/action/page/component tests are integration tests of
  the wiring we own and do not establish a full OAuth end-to-end pass.
- Full live Apple OAuth is not an acceptance requirement for this Google issue
  and was not performed.
- Resident deployment, live-revision verification, screenshot-level UI
  acceptance and issue closure remain parent-owned.
