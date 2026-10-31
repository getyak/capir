# GET-350: uncertain password completion recovery

Status: in progress; draft PR, not release-ready. Baseline is `2ca339c0caff6ecec30bb07c2fdb0f80213e67cf`. Related to GET-350 and the GET-325 worktree recovery audit.

## Outcome and scope

After a staged password change may have committed but its result was lost, preserve bounded context and verify that exact operation without repeating the change. A timeout, current settings or a missing record never establishes success or rollback. Preserve the current browser-owned design in [ADR0022](../docs/decisions/0022-browser-owned-macos-login.md) and the authority in [ADR0018](../docs/decisions/0018-unified-account-login-and-sync.md); do not restore the old native relay.

No new provider integration, persistent secret store or schema migration is planned. The existing one-use mutation, session/actor/Origin/intent/secret binding and absolute attempt/flow limits remain. Secrets and passwords never enter recovery URLs, returned client state or logs.

## Chosen slice

- Retain the original staged context after dispatch, on success and error, without clearing or resealing cookies from a late completion. Original expiry remains; no authorization is extended.
- Add typed read-only `POST /v1/account/login-methods/result` over the existing grant and same-ID access event. Request contains only attempt ID/secret and password intent. Response states are `pending`, `applied`, `unknown`, `invalid`; applied requires exact durable evidence, never another mutation.
- Use a consistent plain SELECT over currently active session/user/account and the bounded grant/event. Do not reuse locking `loadContext(false)` or invert the writer's lock order. Observe event existence separately from scope consistency. Pending is not permission to re-dispatch.
- Correct the producer's audit after-revision using its actual `UPDATE…RETURNING` value in the same transaction. Do not guess-repair historical audit.
- Keep one correlated password surface, original Server Action/permalink and action-state identity. A pre-dispatch nonsecret result navigation hint, explicit GET recovery and no late A cookie/UI mutation preserve reload and A/B recovery. Keep confirmed local validation editable. React pending must not remove the password from FormData before serialization.
- Native progressive-enhancement POST history is not automatically a GET checkpoint. Preserve its validation postback and explicit GET recovery, use observed terminal PRG where applicable, and test original one-use protection under forced native replay. Do not claim an unobserved browser transport guarantee.

## Milestones and evidence

- [x] Inspect current source, original dirty branch and accepted architecture; preserve the original branch/worktree.
- [x] Independently review backend binding/transaction and installed Next16.4.2 action, form and navigation contracts; record unresolved runtime tests.
- [x] Publish test-only baseline and observe correct context-loss RED: [Web job124557947844](https://github.com/getyak/capir/actions/runs/41208328135/job/124557947844), 3685 pass and only the two new retention assertions fail after the exact backend-call precondition. Boundary mock evidence is not a real database commit or browser failure.
- [x] Minimal context-retention GREEN: current-head Web quality passed lint/typecheck/all tests/build at [job124565035205](https://github.com/getyak/capir/actions/runs/41210737454/job/124565035205); other credential paths unchanged.
- [x] Real isolated PostgreSQL RED: [job124565035186](https://github.com/getyak/capir/actions/runs/41210737454/job/124565035186) executed40 cases,38 passed and only the actual wrong after-revision and missing result-route assertions failed.
- [x] First typed read-only producer/route/audit GREEN: [backend job124571470009](https://github.com/getyak/capir/actions/runs/41212898296/job/124571470009) actually ran40 isolated accountIdentity cases with no failures/skips; full negative coverage and transport still required.
- [x] Actual SDK API-absence RED: [Web job124576811845](https://github.com/getyak/capir/actions/runs/41214719897/job/124576811845) ran3687 old tests successfully and26 new cases failed at the explicit missing-public-method assertion. This initial RED does not establish request/response validation behavior.
- [ ] Implement and actually execute the public SDK reader request/schema/correlation/error cases on the current head.
- [ ] Verify actor/session renewal, wrong scope/origin/secret/intent, expiry/revocation, own and later revisions, missing/contradictory event, member access and zero repeated credential effect.
- [ ] Actual Web save/check, action response loss, first save/local rejection, reload, native POST replay/GET recovery, A/B isolation and no secret serialization.
- [ ] Controlled HTTP response loss uses the exact credential complete route and production producer/client; unrelated loss fixtures do not prove it.
- [ ] Full applicable current-head CI, independent whole-branch review, normal merge and exact main readback.
- [ ] Deploy every affected existing resident Web/backend from clean committed source under [the local backend runbook](../docs/operations/testflight-local-backend.md), verify revision and changed behavior, preserve rollback and clean only owned test resources.

## Safety regression evidence

The first real reader/SDK pass executed its previously missing-method cases. On [CI41216873943](https://github.com/getyak/capir/actions/runs/41216873943), Web ran3714 tests with3713 passed and only the unsafe integer result case failed; the isolated PostgreSQL accountIdentity suite ran51 cases with50 passed and only the future-consumption result case failed. Both reached behavior assertions after successful setup and valid-result preconditions. This commit adds only local SDK safe-integer guards and a DB-time/original-expiry receipt guard in the existing single read-only SELECT. The unchanged tests must now actually pass.

## Current boundary

Web context retention and the backend reader/route/producer first GREEN are executed. The SDK and scoped real-PG negative tests have now actually run; their two confirmed integrity gaps are addressed by narrow guards in this commit, awaiting current-head CI and independent review. Full Web save/check, response-loss transport, actor/session renewal and browser proof remain incomplete. Keep Draft; do not merge or deploy this partial feature. No real account password, provider or model was called by this work.
