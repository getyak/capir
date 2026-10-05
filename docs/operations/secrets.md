# Secret delivery

## Purpose

Infisical is Talent Signal's canonical secret store. Applications remain
provider-neutral and consume runtime environment variables; Infisical delivers
those values to the process that needs them. Do not export the Infisical project
to a persistent `.env` file as an ordinary workflow.

The existing project is `talent-signal`, with project ID
`6e8dbb8d-93b9-4979-8248-62100d86e733`. The committed `.infisical.json` binds
local commands to this project and defaults to `dev`. Environment selection is
always explicit for staging and production.

## Local development

Install the Infisical CLI, then authenticate as the current human developer:

```sh
infisical login
pnpm secrets:check:dev
pnpm dev:infisical
```

`secrets:check:dev` prints only whether the expected names are present. It never
prints values. `dev:infisical` injects `dev:/shared` and `dev:/web` into the web
process for the lifetime of that process.

Start the local Docker backend with the same transient injection:

```sh
pnpm backend:up:infisical
```

The repository does not provide a command that exports Infisical to `.env`.
When a value changes, update Infisical and restart the affected process. A
pre-existing ignored `.env` may be retained only for a bounded offline recovery
window and should be removed after the new paths have been verified.

Human CLI sessions keep Infisical's encrypted, mode-`0600` last-successful-fetch
cache for local offline recovery; the encryption key stays in the operating
system keychain. Production cannot use that path: the shared wrapper requires
`INFISICAL_TOKEN`, and Machine Identity fetch failure stops the command.

If an authorized local API operation needs the human CLI token, capture
`infisical user get token --plain --silent` in memory and reject multiline or
malformed output before constructing a request. Never print the captured value,
request headers, response bodies, or exception text that can contain them;
report only the operation and status. A rejected or revoked session requires
`infisical login`, not a copied human token in a workload identity. Diagnose
authorization at the intended operation: an unrelated probe returning 404 does
not establish an expired session, and successful project access does not prove
organization Identity EditAuth authority. An OIDC attach denied for that action
requires an eligible organization principal; do not widen the workload role or
substitute human credentials in Actions.

## Workload identities

Use a separate least-privilege Machine Identity for each workload and
environment:

- GitHub Actions authenticates with GitHub OIDC and a subject restricted to the
  exact repository, workflow, branch or GitHub Environment;
- the owner-operated TestFlight backend reads only `staging` and only the paths
  needed by that backend;
- production API and web workloads have separate identities and read only
  `prod` paths needed by their capability;
- rotation or migration jobs use short-lived, separately authorized identities.

Do not reuse a human CLI session in CI or production. Do not use an OAuth
Application for workload secret delivery. Do not choose a long-lived Service
Token when OIDC or Universal Auth with a short-lived access token is available.

The Infisical identity ID is safe to commit. Its client secret, a Universal Auth
access token, and any provider API key are secrets and must never enter Git,
logs, build arguments, chat, or generated artifacts.

## Paths and names

Keep stable process environment names so providers remain replaceable. Group
authorization in Infisical with folders and identity permissions rather than
renaming application variables per environment.

The authoritative names and runtime contracts live in
`config/infisical-secrets.json`. The folders are:

- `/shared`: provider and cross-surface runtime configuration;
- `/agent-host`: local open-world Tool provider configuration and credentials;
- `/web`: Next.js server credentials and web-only policy;
- `/backend`: database, authentication, API, and storage configuration;
- `/release`: App Store Connect, signing, Tailscale, and release configuration;
- `/operations`: human-operated GitHub, Linear, and weather integrations.

An application requests only the paths declared by its contract. The shared
wrapper rejects unknown environments and paths, and nested injection composes
multiple explicit folders without recursive root access:

```sh
./scripts/infisical/run.sh dev /shared /web -- pnpm --filter @talent-signal/web dev
pnpm secrets:check:agent-host
./scripts/infisical/run.sh dev /shared /agent-host -- pnpm agent:research -- --objective "..." --subject company --anchor "Example Company" --allow-domain example.com
./scripts/infisical/run.sh staging /shared /backend -- node scripts/infisical/verify-contract.mjs testflightBackend
```

Use `scripts/infisical/migrate.mjs` only for a reviewed, allowlisted one-time
copy. It refuses to write without `--apply`, filters names through the manifest,
uses a mode-`0600` temporary file, removes that file, and prints only the count
and destination path. Import a multiline private key with
`--source-key-file=NAME:PATH`; this delegates the raw file to the Infisical CLI
instead of serializing it through dotenv. Verify a provider can parse the
Infisical readback before removing the source file. Never copy the reserved
`PATH` name into a folder.

## GitHub Actions cutover

The iOS workflows prefer the pinned Infisical Secrets Action with GitHub OIDC.
The identity is restricted to the exact immutable subject
`repo:getyak@269524475/capir@1322192683:environment:testflight`, custom audience
`infisical://talent-signal/testflight`, environment `staging`, and path
`/release`. The OIDC discovery URL is the provider origin
`https://token.actions.githubusercontent.com`; Infisical performs discovery
from that origin. Its base project access remains `no-access`; a path-scoped
Additional Privilege grants only `describeSecret` and `readValue`. This keeps
the same least-privilege boundary on plans where custom roles are unavailable.

Repository names in OIDC subjects and `workflow_ref` claims can change even
when their numeric IDs remain the same. After a rename, read the authoritative
prefix with `gh api repos/getyak/capir/actions/oidc/customization/sub`, then
update only the exact name-bound subject and workflow reference on the existing
TestFlight/macOS release identities. Preserve owner/repository IDs, protected
environments, workflow paths, branch claims, audiences, token limits and scoped
permissions; read back the field diff before retrying the failed release.
Never replace an exact subject with a wildcard to repair a rename.

The `INFISICAL_TESTFLIGHT_IDENTITY_ID` variable is bound to the protected
release identity. Release `0.1.13 (20260828111000)` completed Apple processing
and internal distribution through that identity, after which the legacy GitHub
secrets and fallback branches were removed. The workflows now deliberately fail
closed when Infisical cannot supply the complete contract.

## Provider keys

Use separate credentials for provider capabilities and environments. In
particular, keep `OPENROUTER_API_KEY`, `ARK_API_KEY`, and `ZHIPU_API_KEY`
distinct. A model key grants compute access; it does not grant private-evidence
admission. Keep `TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING=false` until the
provider contract and observed data path satisfy the integration admission
checklist.

Public-web research selects one environment provider with
`TALENT_SIGNAL_AGENT_WEB_SEARCH_PROVIDER=brave` or `tavily`. Keep
`BRAVE_SEARCH_API_KEY` and `TAVILY_API_KEY` as separate `/agent-host` secrets; do
not place either key in an Agent definition, MCP configuration visible to the
model, backend container, or client bundle. Load `/shared` for the selected
model provider and `/agent-host` for the search provider into the local Agent
process only. The selector is application configuration, while the API key
remains the secret. Provider subscription and invoice ownership stay in the
vendor account; Infisical owns delivery and rotation, and the local host owns
Run budgets and provider readback. Do not configure silent cross-provider
fallback because it changes ranking, data processing, cost, and attribution
without changing the Run authorization.

General public-page reads require `FIRECRAWL_API_KEY` from the same
`/agent-host` boundary. This keeps the standalone Agent independent of the
Talent Signal product runtime without relying on network-dependent anonymous
access. `fetch_web` may send only the exact public HTTPS URL discovered in
the current governed Run; it sends no cookies, private headers, conversation
content, or product credentials. Firecrawl returns bounded main-content
Markdown with PDF parsing while provider caching is disabled and zero data
retention is requested only after the Firecrawl account has that capability and
`TALENT_SIGNAL_FIRECRAWL_ZERO_DATA_RETENTION=true`. Keep this credential out of
backend, Web, iOS, release, and model-visible configuration. The standalone
Agent Host command does not require the Talent Signal product runtime.

Screenshot-driven public-person research uses a separate Agent-host contract.
Keep `EXA_API_KEY`, `TIKHUB_API_KEY`, and `TIKHUB_BASE_URL` in
`<environment>:/agent-host`, pin
`TALENT_SIGNAL_AGENT_VISION_MODEL` in `<environment>:/shared`, and verify only the names
with `pnpm secrets:check:person-research`. The command loads `/shared` and
`/agent-host` into the Agent Host process or sidecar only. Exa serves LinkedIn
and general-Web contact discovery while TikHub serves the admitted social
profile channels; no API process, Web, iOS, release job, or model prompt
receives either credential. Neither provider is a fallback for the other: the
purposes, data paths, cost, and source semantics differ.

The runtime also requires `TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING=true`
before it will send the intentional screenshot to the pinned vision provider.
Keep that gate false until the provider contract and observed configuration
satisfy the model-provider admission checklist. The gate admits only the image
under the immutable local person-research Task; it does not admit whole
conversation history, background enrichment, canonical evidence, identity
binding, or any external write.

Verify TikHub with `/api/v1/health/check` and the authenticated
`/api/v1/tikhub/user/get_user_info` envelope while printing only `ok` or
`authorized`. Do not print the account, balance, response headers, or secret.
Do not issue a billable person search as a credential check. An expired or
revoked token fails closed; replace it in the same Infisical path and rerun the
name and account-envelope checks before attempting a real Run.

Product ingress is separately controlled by
`TALENT_SIGNAL_PERSON_RESEARCH_ENABLED` under `/backend`. Keep it `false` until
the TikHub account envelope, vision-provider admission, and a synthetic
end-to-end Run all pass. Compose fixes the socket path inside its private shared
volume; do not place the TikHub credential in API environment variables merely
to make the socket client work.

Recruiter dictation uses the narrower
`TALENT_SIGNAL_ALLOW_REMOTE_VOICE_TRANSCRIPTION` gate. Set it only for a
runtime whose authenticated flow records in the foreground, stops before
upload, discloses the remote transcription boundary, returns an editable
draft, and deletes its temporary audio. Enabling recruiter dictation does not
admit screenshots, candidate-call recordings, or private candidate evidence
to another model path.

Relationship Ask has its own narrower
`TALENT_SIGNAL_ALLOW_REMOTE_CHAT_PROCESSING` gate. When enabled, configure
`TALENT_SIGNAL_CHAT_PROVIDER=zhipu`, pin `TALENT_SIGNAL_CHAT_MODEL=glm-5.3`,
and keep the environment-specific `ZHIPU_API_KEY` in that environment's
`/shared` path. The backend sends only the user's submitted question and the
minimum selected, published, reviewed relationship blocks. Chat photos remain
local unless the same environment also sets
`TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING=true` and pins
`TALENT_SIGNAL_CHAT_VISION_MODEL`; only then are manifest-bound images sent as
unreviewed task material to that vision model. This still does not admit whole
transcripts, provider keys, or contact, message, and calendar write authority.
The server rejects citations outside the supplied evidence manifest and falls
back to the deterministic response when the provider is disabled or fails.
The remote Chat gate alone does not enable the broader Agent runtime or image
processing.

Use a dedicated credential for each environment. In particular, do not copy
`dev:/shared/ZHIPU_API_KEY` into `staging:/shared`; create a staging key in the
provider account, write it directly to Infisical, then prove it with the
synthetic Relationship Ask probe. The iOS app and `/release` workflows never
receive this key.

For GLM, the Agent runtime accepts either a direct BigModel credential with
`TALENT_SIGNAL_AGENT_PROVIDER=zhipu` and a pinned `glm-*` model, or the existing
OpenRouter credential with a pinned `z-ai/glm-*` model. Screenshot analysis
selects `TALENT_SIGNAL_SCREENSHOT_PROVIDER=zhipu` and uses a separately pinned
vision model. Do not treat the text-only GLM Agent model as proof of image
support.

## Recovery and verification

- Revoke the affected workload identity before rotating a suspected credential.
- Verify the destination process starts and the relevant provider health check
  succeeds; a successful secret write is not runtime proof.
- Never diagnose by printing the whole environment. Check only names and
  presence.
- Keep the prior provider credential valid only for the shortest rollback
  window, then revoke it after destination readback succeeds.
- Remove legacy `.env`, host environment files, and GitHub secret copies only
  after the corresponding runtime or workflow has passed its real health gate.
- If Infisical is unavailable, fail closed for production model, storage, auth,
  and database credentials. Do not silently fall back to committed or shared
  personal credentials.

The browser research sidecar requires `TALENT_SIGNAL_BROWSER_EXECUTOR_URL` and
`TALENT_SIGNAL_BROWSER_EXECUTOR_TOKEN` from `staging:/agent-host`. The URL must
use the verified private guest-to-host IPv4 route; the token is64 random hex
characters. Only the research sidecar receives these values in Compose. The
trusted Mac executor receives the same token through an owner-only file and a
clean, explicit environment; no model or database credentials belong in that
process. The TestFlight contract refuses deployment when either value is
missing. See the [browser runtime contract](../../apps/agent-host/browser/README.md)
for daemon/image pinning, local listener ownership and recovery requirements.
