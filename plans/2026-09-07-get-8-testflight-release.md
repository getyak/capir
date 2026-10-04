# GET-8 TestFlight release

## Outcome and authorization

The user explicitly requested commit, push, merge and a new TestFlight version
after the completed GET-8 implementation. Publish the reviewed native retrieval,
Today and Meetings changes through the existing main-only release workflow.
Completion requires the merged source, a valid exact App Store Connect build,
the automation-owned release receipt and internal tester access readback.
Public App Store submission and new invitations are outside this request.

## Starting evidence

- Branch: `codex/get-8-retrieval-meetings`; clean base and current remote main:
  `a2eaaeae120bf4747e45f824af3b809e550fb61a`.
- Latest existing release at intake: `v0.1.62`.
- [Implementation evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-07-get-8/README.md):
  108 focused unit tests, 23 distinct native UI cases, Release Simulator
  compilation, localization and documentation checks passed. All captures use
  synthetic data. Device frame rate remains unmeasured.
- No backend or release-pipeline change is required by this native slice.

## Milestones

1. Done: commit the reviewed changes, push the branch and open a PR.
2. Done: pass required CI and Security on the final PR source, then merge with an
   exact-head check and verify the resulting source tree.
3. Done: publish through the serialized Release iOS workflow after the required
   PR gates and merge-tree verification; reuse its exact IPA if upload or
   finalization requires recovery.
4. Done: verify the version, build, commit, processed-build receipt and existing
   internal group access without resending invitations; preserve the receipt.

Version selection belongs to `scripts/ci/next-ios-version.sh`; do not create a
manual tag or duplicate an active release. Follow
[CI/CD operations](../docs/operations/ci-cd.md) for gates and recovery.

## Publication progress

- [PR #151](https://github.com/getyak/talent-signal/pull/151) contains source
  `c7e24f16c0be00c89239aa08ff828e4b71078ffa`; automatic merge was enabled with
  that exact head after remote preservation and staged-diff checks.
- [CI 34104735291](https://github.com/getyak/talent-signal/actions/runs/34104735291)
  passed, including Release compilation, 516 unit tests, all nine isolated UI
  smoke cases, and repository, Web and backend checks.
  [Security 34104735293](https://github.com/getyak/talent-signal/actions/runs/34104735293)
  passed, including the required aggregate.
- PR #151 merged at `2026-09-07T09:43:42Z` as
  `f6f6f025e0e3088167df81c76aebe5cab29f334c`. Its source tree and the tested PR
  head both resolve to `4c1677f038e75ecdbf2e4c8cc41dde9c38904cbf`.
- [Release iOS 34107690118](https://github.com/getyak/talent-signal/actions/runs/34107690118)
  was manually dispatched on main with publication enabled after that readback.
  This follows the documented manual release path and overlaps the equivalent
  post-merge main CI without bypassing any PR gate. No release was active at
  dispatch. The global release lock and trusted receipt govern any subsequent
  automatic run.
- The release selected `0.1.63 (20260907094527)`. Its API contract probe and
  isolated signing access passed. All four release jobs succeeded. Apple processing
  completed at `2026-09-07T09:56:40Z`. IPA attestation binds SHA-256
  `ab436fed6a55f5d16f49f1ce5f15768b9e234d0917c5928333d8a815fc58201f`.
- The automation-owned `v0.1.63` release receipt matches the merged commit,
  exact version/build and successful workflow. The tag target, retained IPA
  digest and downloaded receipt digest match their independent readbacks.
  [Publication evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-07-get-8/release.md).
- [Final read-only access audit](https://github.com/getyak/talent-signal/actions/runs/34108872288)
  passed: `0.1.63 (20260907094527)` is `VALID`, group membership and all-build
  access are enabled, and server access is ready. No relationship or invitation
  changed. This proves server availability, not installation of this new build.
- [Read-only access preflight](https://github.com/getyak/talent-signal/actions/runs/34104746841)
  confirmed `0.1.62 (20260907013413)` is `VALID`, group membership and all-build
  access are enabled, and server access is ready. Neither access repair nor
  invitation resend was requested. This is not proof for the new build.

## Completion

The requested source was committed, pushed and merged, and the new TestFlight
version completed Apple processing with verified internal access. The
[release evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-07-get-8/release.md) is the durable
record for this operation. The subsequent evidence-only commit does not change
the released application or require another version.
