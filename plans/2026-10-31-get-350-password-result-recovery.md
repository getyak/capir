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
- [ ] Minimal context-retention GREEN; existing unrelated credential paths unchanged.
- [ ] Real isolated PostgreSQL RED for the wrong audit after-revision and missing authenticated outcome route, then implement the typed reader and correct producer.
- [ ] Verify actor/session renewal, wrong scope/origin/secret/intent, expiry/revocation, own and later revisions, missing/contradictory event, member access and zero repeated credential effect.
- [ ] Actual Web save/check, action response loss, first save/local rejection, reload, native POST replay/GET recovery, A/B isolation and no secret serialization.
- [ ] Controlled HTTP response loss uses the exact credential complete route and production producer/client; unrelated loss fixtures do not prove it.
- [ ] Full applicable current-head CI, independent whole-branch review, normal merge and exact main readback.
- [ ] Deploy every affected existing resident Web/backend from clean committed source under [the local backend runbook](../docs/operations/testflight-local-backend.md), verify revision and changed behavior, preserve rollback and clean only owned test resources.

## Current boundary

Only the first Web regression evidence is executed. The new PG assertions and route test still need real execution in the existing CI-owned `account_proof` database; absence of that environment/skip does not count. A partial green suite cannot complete this plan. No real account password, provider or model was called by this work. Completion requires the actual outcome above and runtime acceptance, not just retained cookies.
