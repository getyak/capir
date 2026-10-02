# capri web

The Web app presents capri's personal-Agent direction: keep important people
and unfinished things from intentionally shared conversations, then retrieve
or update that context later. It contains a public product narrative, synthetic
interaction demonstrations, and an authenticated governed workspace.

A runnable demo is not proof of live screenshot persistence, a complete
cross-device journey, or private WeChat access. Availability depends on the
configured account, backend, and admitted capabilities. Current product intent
lives in [Product](../../docs/product.md); delivery evidence and boundaries live
in [Delivery](../../docs/delivery.md).

## Routes

- `/`: product narrative, interactive source-to-state redline, decision
  boundaries, research, and FAQ.
- `/login`: Google, Apple, configured email/password, and optional default-account sign-in.
- `/workspace/settings`: account/security and existing workspace member management.
- `/workspace/settings/testing`: internal isolated test workspaces, entry and cleanup.
- `/workspace`: authenticated eight-case evidence-review workspace with
  identity/time resolution, atomic fact decisions, separate action approval,
  and truthful fixture outcome states.
- `/demo`: deterministic local evidence extraction plus an optional,
  explicitly selected server-side AI review route, with loading, empty,
  ambiguity, error, edit, confirm, dismiss, and restore states.
- `/privacy`: product privacy principles and demo data-handling disclosure.
- `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, and `/opengraph-image`: SEO and sharing infrastructure.

## Stack

- Next.js App Router and React
- Tailwind CSS v4 as the CSS build foundation
- Native CSS interaction feedback for the marketing surface and Motion for
  demo state transitions
- Phosphor Icons

## Local development

From the repository root:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Authentication

Auth.js uses encrypted JWT sessions. Copy `.env.example` to `.env.local`, set
`AUTH_SECRET`, and enable only the providers you have configured.

Generate a password hash for the configured email account:

```bash
pnpm --filter @talent-signal/web auth:hash-password "your password"
```

Place the output in `AUTH_DEFAULT_ACCOUNT_PASSWORD_SCRYPT`. The optional
`AUTH_DEFAULT_ACCOUNT_QUICK_LOGIN=true` setting exposes a password-free default
account button in development only. Configured default-account providers are
disabled in production. Backend identities are required for account management.
See [account access](../../docs/operations/account-access.md) for owners,
active sessions, and isolated test workspaces.

Google uses `/api/auth/callback/google`. Apple uses
`/api/auth/callback/apple` and also requires an Apple Services ID, an associated
primary App ID, registered domains, and the exact return URL in the Apple
Developer portal.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Local mode is deterministic and browser-side. It does not upload or persist the
conversation text. When configured, private AI mode must be selected explicitly,
uses a server-side key, requests zero-data-retention routing, and does not
persist the note in capri.

The authenticated workspace can read a shared local development backend by
setting `TALENT_SIGNAL_BACKEND_URL` to a localhost origin. It requests
`/v1/candidate-momentum/cases` and accepts only the complete frozen suite with
an explicit `data_mode` of `fixture` or `synchronized`. Missing, invalid, or
unavailable responses visibly fall back to the bundled synthetic fixtures.

Copy `.env.example` to `.env.local` to configure the optional route. Production
keeps the public AI route disabled unless the explicit production gate is set;
authenticated access and a durable rate limiter are required before a real
candidate-data launch.
