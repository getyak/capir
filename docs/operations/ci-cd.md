# CI/CD and GitHub operations

## Design

The delivery system separates reversible verification from external
publication:

```text
pull request / push
        |
        +--> CI required
        |      docs + workflow policy
        |      web lint/typecheck/test/build
        |      backend typecheck/test/build
        |      iOS unit tests + tiered build/UI checks when relevant
        |      macOS Hybrid build and native boundary checks when relevant
        |
        +--> Security required
               dependency review on pull requests
               full production dependency audit
               credential hygiene
               CodeQL for web and Actions

main / weekly / manual Security
        |
        +--> Swift CodeQL when relevant

successful main CI + iOS product change
        |
        +--> main-only testflight environment
                isolated match signing -> archive
                provenance attestation + retained IPA -> TestFlight upload
                exact build-upload polling -> processing complete
                internal group automatic distribution
                receipt + version tag + GitHub prerelease + retained IPA
```

`CI required` and `Security required` are intentionally stable job names for
branch rules. Matrix jobs and path-sensitive jobs feed those aggregators, so
branch protection does not depend on a changing list of individual contexts.

## Low-cost scope policy

CI and Security stay deterministic and fully automatic; no workflow calls a
model or an AI service. To keep pull-request cost proportional to risk, a
fail-closed classifier (`scripts/ci/has-runtime-changes.sh`) reports whether a
change set is documentation/knowledge-only. It returns `true` for code,
workflow, or configuration paths, empty diffs, missing revisions, and any
ambiguous input, and `false` only when every changed path is a Markdown file or
lives under `docs/` or `_index/`.

- `Repository policy and docs` and `Secret hygiene` run on every change.
- `Full production dependency audit` runs on every security event and must
  succeed; scope classification never skips, suppresses, or narrows it. It
  audits the complete production dependency graph and runs the local
  dependency-patch regression tests.
- `Web quality`, `Backend quality`, `Phase one`, and JS/Actions CodeQL are
  skipped only for an automatic documentation-only pull request or `main` push.
- `macOS Hybrid boundary` runs only when its app, `workspace-ui`, macOS tooling,
  root dependency inputs, or CI definition changed. Missing or ambiguous
  revisions fail closed to running it.
- The aggregators accept those intentional skips only when the classifier
  reported documentation-only scope; every other scope still requires success.
- Manual `CI` and `Security` dispatch always runs the full scope, and scheduled
  or manual Security scans keep the complete scan including Swift CodeQL.

The `Release iOS` workflow listens only to `CI` runs on `main`, so a
pull-request CI completion no longer produces a skipped release run. Manual
release dispatch remains available and the release decision logic is unchanged.

The production dependency audit is currently clean. The locally patched
`braces` depth bound leaves its upstream advisory visible in the
development-inclusive audit because no fixed upstream release is published;
report that as an open upstream advisory rather than adding a broad audit
ignore.

## Waiting on required checks

Use one bounded command instead of repeated ad-hoc polling:

```bash
./scripts/ci/wait-for-required-checks.sh [PR_NUMBER] [TIMEOUT_SECONDS]
```

The waiter reads only `gh pr checks` output for `CI required` and `Security
required`, prints a clear failure or timeout, and never mutates the repository,
the pull request, or any check. Override the bounded scope with newline-separated
`REQUIRED_CHECKS` and the poll interval with `WAIT_INTERVAL` when needed.

## User-directed model review

First-pass review of a pull request is one user-directed local MiMo review,
not an unattended service: `mimo-review prepare`, `mimo-review run`, inspect
the findings, then publish one scoped `COMMENT` on the pull request.

- The review binds to the exact current pull-request head recorded at
  preparation time, so findings describe one stable revision instead of an
  evolving branch.
- Inspect before publishing. Only findings that survive owner inspection are
  posted, scoped to the changed files and to claims the reviewer can support.
  The model comment is review input; it is never a required approval, a CI
  success, or evidence that a gate passed.
- Rerun the review only when the head materially changed, such as after a
  confirmed P0/P1 fix; do not buy repeated reviews of the same commit.
- Independent Codex judgment remains mandatory for security, migration,
  architecture, and safety-boundary issues. Deterministic CI and Security
  gates and branch protection stay mandatory in every case.
- The local Xiaomi Token Plan key is used only in user-initiated local
  sessions. No GitHub Actions workflow runs an unattended model review, and
  there is no broad provider failover to an unbudgeted per-usage service.

## Workflow inventory

| Workflow | Trigger | Mutation | Concurrency policy |
| --- | --- | --- | --- |
| `CI` | pull request, `main` push, manual | none | cancel stale run per branch or PR |
| `Security` | pull request, `main` push, weekly, manual | CodeQL results | cancel stale run per branch or PR |
| `Pull request labels` | pull request metadata | labels only | one short job |
| `Release iOS` | successful `CI` run on `main`, explicit manual request | TestFlight, tag, prerelease, attestation | serialize all releases; never cancel |
| `Refresh iOS signing` | explicit manual confirmation on `main` | App Store profile in the isolated match repository | serialize with releases; never cancel |
| `TestFlight Access` | explicit manual request on `main` | scoped tester group/build access and invitation | serialize access repair; never cancel |

All third-party actions are pinned to full commit SHAs. Dependabot proposes
weekly updates for GitHub Actions, pnpm, and Bundler.

## Release gates

An ordinary release workflow dispatch defaults to **not** publishing
TestFlight. A manual caller must explicitly set `publish_testflight`, and an
automatic release is considered only when the verified `main` tip contains iOS
release inputs that have changed since the latest trusted TestFlight release
receipt. The `testflight` GitHub Environment permits only `main`; it
intentionally has no required reviewer because internal TestFlight delivery is
the continuous delivery target.

On a `main` push, CI and `Release iOS` select only a non-draft semantic GitHub
release created by `github-actions[bot]` with both `TalentSignal.ipa` and
`testflight-release-receipt.json`. The receipt is generated only after Fastlane
has uploaded the exact build and App Store Connect has finished processing it;
it binds the version, build number, commit, processing time, and workflow run.
A hand-created tag, empty GitHub Release, draft, or copied IPA is not a release
receipt and cannot suppress delivery. When no trusted receipt exists, CI runs
the iOS gate and the release workflow publishes conservatively.

This cumulative baseline keeps unreleased iOS work in scope after a newer
non-iOS push cancels an older run. The replacement run tests the complete
unreleased iOS range, and `Release iOS` applies the equivalent cumulative
comparison before publication. The release-specific set includes product,
Fastlane, signing dependency, versioning, classifier, receipt policy, and
release-workflow changes. A change to the release decision itself therefore
receives the same real TestFlight proof as an iOS product change.

The iOS job uses the host simulator architecture only (`arm64` on hosted
`macos-26`), without changing the device archive or macOS distribution targets.
Pull requests build Debug once, run all unit tests, and execute the 23 core
journeys in `scripts/ios/ci-quick-tests.txt`. Main pushes retain the separate
Release build and all 20 journeys in `scripts/ios/ci-smoke-tests.txt`, including
both existing large-text/dark-mode accessibility audits and the contact-review
accessibility check. Both tiers cover the long-image source, image-local
processing, unavailable-review recovery, contact-only confirmation with pending
details, and a corrected name's separate second confirmation. These are
deterministic native fixtures; real-provider contact acceptance remains opt-in
and is not included in either automatic list. Every UI journey still uses an
isolated XCTest runner to contain known Simulator failures.

Automatic checks stop after a failed test part, after the existing single
retry for recognized Simulator failures. They preserve completed native results
and partial bundles; a stopped suite is a failure, never complete coverage.
Manual CI defaults to `smoke`, also offers `quick` and `full`, retains Release
compilation, and continues collecting results after failures. Local checks
retain Release compilation and default to the full suite. Explicit local
`IOS_CHECK_RELEASE_BUILD=false` and `IOS_FAIL_FAST=true` select faster feedback.

Simulator CI watches iOS product/build/test inputs and its own workflow and
scope policy. Markdown documentation and release-only Fastlane, Ruby, upload,
versioning, and release-workflow inputs do not independently trigger simulator
work; their policy checks and publication classification remain separate.
PRs compare against their merge base, so target-branch-only changes do not
inflate scope. Missing revisions still require checks, and the main-branch
cumulative trusted-receipt baseline described above remains in force. As a
result, an unrelated main push still runs iOS checks when unverified/unreleased
iOS changes remain; it must not bypass the pre-publication gate.

Swift CodeQL still runs on relevant `main` pushes, the weekly Security run, and
manual Security runs. It is not duplicated in pull-request latency because the
blocking iOS Debug compilation and tests already reject build failures, while
the main and scheduled scans preserve repository-wide Swift security analysis.

The release job exchanges GitHub's OIDC token for a short-lived Infisical token,
loads only `staging:/release`, and checks required names without printing their
values. It joins the internal TestFlight tailnet as an ephemeral `tag:ci` node,
writes the validated `TALENT_SIGNAL_API_BASE_URL` into the app build
configuration, verifies tailnet reachability and a current Apple
authentication challenge before signing, retries that end-to-end contract probe
three times across a short bounded window to absorb transient tailnet path
negotiation, writes signing material only under the runner temporary directory,
verifies read access to the isolated private match repository, and removes
those files even after failure. The workflow attests and retains the exact IPA
before a separate job uploads it. That upload job polls Apple's build-upload
resource for the exact marketing version and build number, tolerates transient
lookup failures, and fails immediately on an Apple processing rejection. A
retry restores the same archived IPA and skips transport when that exact upload
already exists instead of generating or blindly uploading a new build. The
receipt, tag, and GitHub prerelease with the retained IPA are created only after
the linked build reaches `VALID`, not merely after transport upload. Editing or
promoting that release later does not invalidate the receipt as long as its
automation owner and both assets remain intact.

Provisioning-profile renewal is a separate maintenance operation. The
`Refresh iOS signing` workflow requires explicit confirmation and a dedicated
`MATCH_MAINTENANCE_DEPLOY_KEY` with write access to the isolated match
repository. The workflow regenerates profiles for `com.talentsignal.app`,
`com.talentsignal.app.share`, and `com.talentsignal.app.live-activity` after
the required App ID capabilities are enabled. It then downloads the primary
app profile through the scoped App Store Connect credential, verifies its
bundle ID, profile name, Sign in with Apple entitlement, and isolated match
distribution certificate, and encrypts the profile into match. It
does not archive or upload the app and shares the release concurrency lock.
Ordinary TestFlight CI keeps using its dedicated read-only key and cannot write
the signing repository.

App Store Connect owns the last delivery hop. Talent Signal must have an
internal testing group with automatic distribution enabled and at least one
eligible App Store Connect user. A green workflow proves upload and processing;
the App Store Connect group and an invited-device installation prove that the
build is usable on a phone.

`TestFlight Access` audits the active team user, pending team invitation,
TestFlight tester state, internal group membership, and latest valid build
without exposing the configured tester email. It repairs missing group or build
relationships and resends an unaccepted invitation when requested. A result of
`SERVER_ACCESS_READY` proves only the server-side access path; tester states
`INVITED`, `ACCEPTED`, and `INSTALLED` remain distinct, and only the last one
proves a device download.

## Required GitHub settings

- Repository visibility: public.
- Workflow token default: read-only.
- Actions must be pinned to full commit SHAs.
- Secret scanning, validity checks, and push protection: enabled.
- Dependabot alerts and security updates: enabled.
- Private vulnerability reporting: enabled.
- `main`: pull request required, force-push and deletion blocked, `CI required`
  and `Security required` required.
- `testflight`: only `main`, without a required reviewer.
- Infisical `staging:/release/TALENT_SIGNAL_API_BASE_URL`: the stable HTTPS
  origin selected for the current release stage, with a reachable,
  contract-current Apple authentication challenge. The internal stage may use
  a tailnet-only Tailscale Serve origin; external testing and production require
  the public production origin.
- Infisical `staging:/release/TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET`: a
  Tailscale trust credential limited to ephemeral `tag:ci` nodes with
  device-core and auth-key write scopes. The tag is admin-owned and the
  credential is never written into the app.
- `testflight` variable `INFISICAL_TESTFLIGHT_IDENTITY_ID`: the non-secret ID of
  the OIDC Machine Identity. Its Infisical role permits only secret description
  and value reads in `staging:/release`. Its OIDC discovery origin is
  `https://token.actions.githubusercontent.com`, and its subject is the immutable
  repository-ID form for this repository's `testflight` GitHub Environment.
- Private match repository: `getyak/talent-signal-certs`, with only encrypted
  Talent Signal signing assets and a dedicated read-only CI deploy key.
- Public App Store submission remains an explicit promotion after metadata,
  agreements, App Review readiness, and a human release decision are verified.

The release, signing-refresh, and TestFlight-access workflows use only the
Infisical OIDC identity and fail closed when it cannot supply the complete
contract. The former GitHub secret fallback was removed after release
`0.1.13 (20260828111000)` completed Apple processing and internal distribution.
Profile refresh deletes only the three exact App Store profile names, regenerates
them through the maintenance key, then verifies the shared App Group on all
three and Sign in with Apple on the main app before accepting the new Match
repository revision.

## Link checking policy

Repository-owned documentation integrity is a required gate. The deterministic
documentation check verifies the knowledge map, required Agent guidance,
canonical-document context budgets, local links, and the boundary that keeps
implementation-level specifications out of foundational documents.

Lychee separately checks external HTTP links and publishes its findings in the
job summary, but external reachability is advisory. A third-party timeout,
connection reset, rate limit, or anti-automation response is not evidence that
the tested revision is unsafe, so it cannot block CI or TestFlight delivery.
Contributors should still repair confirmed broken destinations when editing the
owning document. HTTP 202 and 429 remain accepted, while known runner-inaccessible
CAC and exact OpenAI documentation URLs remain excluded to keep the report
useful rather than noisy.

## Wiki compilation gate

Knowledge articles are edited in `_index/` and compiled into generated `docs/`
pages. The repository CI runs the compiler tests and a read-only
`node scripts/wiki.mjs check`. The check compares every generated page
byte-for-byte, validates metadata and wiki links, and rejects missing, stale, or
orphaned generated files.

Contributors should install `.githooks/pre-push` with `pnpm hooks:install`.
When a push contains `_index/`, generated `docs/`, or compiler changes, the
hook runs both the repository knowledge contract and the read-only compiler
check. A stale compilation must be resolved by running `pnpm wiki:build`,
reviewing and committing the source plus generated diff, and then pushing
again. The hook never mutates a commit during push.

## Contributor workflow

Keep the automatic gates meaningful by batching and stabilizing work before you
push:

1. Batch locally verified fixes. Run the narrow deterministic scripts for the
   changed surface, use `pnpm check` for changes spanning several runtime
   boundaries, and run `./scripts/ios/check.sh` for iOS changes, so one push
   carries a coherent change set instead of speculative pushes.
2. After pushing, wait with the bounded
   `scripts/ci/wait-for-required-checks.sh` command rather than polling
   repeatedly by hand.
3. Inspect a failure's logs once with `gh pr checks <PR>` and `gh run view
   <RUN_ID> --log-failed`; do not re-read the same failed run.
4. Retain the deterministic `CI` and `Security` gates. Documentation-only
   changes legitimately skip runtime quality and JS/Actions CodeQL jobs, while
   unrelated runtime changes can skip the path-scoped macOS Hybrid job. Never
   disable or weaken a required gate to make a change pass.
5. Request the user-directed model review on a stable current head as described
   in [User-directed model review](#user-directed-model-review). After a
   material P0/P1 fix, rerun it at most once on the new head; do not stream
   intermediate pushes into repeated reviews.

## Failure and recovery

- Use `gh run list`, `gh run view RUN_ID`, and `gh run rerun RUN_ID --failed`
  to inspect or retry checks.
- If an iOS regression requires the complete UI suite, dispatch `CI` with
  `ios_test_scope=full`. Do not enlarge the blocking smoke list as a substitute
  for an explicit full run.
- A failed TestFlight upload creates no release tag. The archive job preserves
  and attests the exact IPA before upload, so rerunning only `Upload exact
  TestFlight IPA` reuses the same version and build instead of generating a new
  binary. Correct source or signing state and start a new workflow only when
  App Store Connect conclusively rejects that binary.
- A manually created semantic release or tag does not count as a TestFlight
  success. Leave it in place for auditability and dispatch `Release iOS` with
  `publish_testflight=true`; version selection skips occupied tags and the new
  automation-owned release becomes the next trusted baseline.
- A missing, non-HTTPS, redirected, unreachable, or contract-stale iOS API URL
  fails before signing. Repair the `testflight` Environment variable or backend
  deployment; never substitute the marketing site or a Release fixture.
- If Xcode reports that the match profile lacks a required entitlement, enable
  the capability for every affected App ID, run `Refresh iOS signing` with
  explicit confirmation, and rerun the failed verified release. The scoped App
  Manager API key and maintenance key have live proof for regenerating the app
  and extension profiles. Do not remove a product capability to fit a stale
  profile.
- `Upload exact TestFlight IPA` treats the transport command as advisory and
  independently requires the exact version/build to become valid. This handles
  an ambiguous transport failure without promoting it to a release. Rerun that
  job to reuse the retained IPA; it checks for the exact upload first and skips
  resubmission when Apple already has it. If later tag, receipt, or GitHub
  metadata fails, rerun only `Finalize TestFlight release`; it restores the
  same IPA and never uploads another build.
- If a release waits before receiving a runner, inspect environment protection
  rules and the global `release-ios` concurrency group. Cancel obsolete waiting
  runs before changing a gate so a stale build cannot begin unexpectedly.
- Never bypass the `main` environment restriction to solve a signing problem.
  Rotate or repair the scoped deploy key or secret instead.
