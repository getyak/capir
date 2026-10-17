# GET-18: DeepSeek text-task provider seam (product-owned)

## Outcome and boundary

Give user-authorized GET-18 one product-owned DeepSeek text-task seam so a
host can run real `.answer` product tasks against DeepSeek without copying the
serializer/parser into an evaluator-only provider. The implementation owns
`apps/agent/src/**`, the backend unscoped-chat retry and processor-disclosure boundaries, and this plan.
GET-157 CSS and GET-39 live in other worktrees. Actual A/B, private harness CNY
metering, calibrated judging, deployment and release remain pending; no real
provider call, credential access or environment change is established here.

## Evidence and design

The real text-task path is `ZhipuChatAnswerProvider.answerInternal`
text-only serialization plus `parseJsonObject`/`parseProviderAnswer`
(citation allowlist, JSON shape, source and prompt candidate rules). Both are
product code in `apps/agent/src/chatAnswerProvider.ts`, which is a capped
architecture hotspot (1006 lines), so the seam must be extracted, not
appended. Parent verified the official DeepSeek endpoint and pricing docs on
2026-10-18: `https://api.deepseek.com/chat/completions`, requested model
`deepseek-flash` (a documented mutable alias; reported identity may be exactly
`deepseek-flash` or documented `DeepSeek-V4.1-Flash-1017`). Alias identity is
never claimed to pin immutable weights.

Approach:

1. Extract the existing text-only message serialization and answer parsing
   into one narrow shared module (`chatAnswerTextTask.ts`): request guards,
   governed context payload, prompt-snapshot candidate rule, system/user
   messages, shared wire fields (`response_format json_object`, `temperature 0`,
   `max_tokens 1600`, `stream false`), and one answer parser with an
   error-label parameter so existing Zhipu error semantics are byte-identical.
2. Keep `ZhipuChatAnswerProvider.answer` on that same seam with unchanged GLM
   wire semantics (`thinking enabled`, conditional `reasoning_effort`, BigModel
   URL/model gates, vision `.run` untouched) and unchanged GLM configuration
   digests (frozen-baseline values asserted in tests).
3. Add `DeepSeekRelationshipTextProvider` (text-only `RemoteChatAnswerProviding`
   exported through the existing `chat-answer-provider` subpath) with the pinned
   profile: explicit `thinking {type:disabled}`, `temperature 0`, `max_tokens
   1600`, `response_format json_object`, `stream false`, single attempt (no
   retries), timeout 15000 composed with host cancellation. It exposes no
   `run`/`runWithPromptPreset` member. An explicitly opted-in host uses its
   text-answer branch for both relationship and unscoped conversation; this
   provides no tool-agent capability and does not replace the current Claude
   Agent configuration. `.answer` rejects images rather than dropping them.
   The host must also preserve the one-attempt profile after a provider failure.
4. Pin profile version and honest mutable-alias identity policy in a DeepSeek
   `runtimePolicyDigest` (never a reused GLM digest). Propagate requested model,
   actual reported model, request id, and usage; reject missing/wrong reported
   models.
5. Expose optional cache-hit/cache-miss token counts from actual provider
   usage through one shared rule (both nonnegative safe integers summing
   `prompt_tokens`; anything partial/malformed/inconsistent is unknown, never a
   fabricated zero). No pricing in the product provider; `costUsd` never holds
   CNY.
6. Host-only `createEnvironmentChatAnswerProvider` branch
   `TALENT_SIGNAL_CHAT_PROVIDER=deepseek` with `DEEPSEEK_API_KEY` and required
   `TALENT_SIGNAL_CHAT_MODEL=deepseek-flash`; default Claude/zhipu behavior and
   the actual environment stay unchanged.

Rejected alternatives: an evaluator-only DeepSeek provider duplicating the
parser (explicitly forbidden); loosening BigModel URL/model validation (would
weaken GLM gates); implementing `run` that throws (would falsely advertise tool-agent
capability); mutable-alias claims of immutable weights (dishonest);
fabricating `0` cache counts when the split is unknown; any pricing/CNY field in
the product provider. The existing host text fallback is supported explicitly;
absence of a `run` member is not proof that the host rejects all conversation.

## Milestones

| Milestone | Evidence |
| --- | --- |
| Failing tests first | shared serializer/parser equivalence across both providers, DeepSeek wire/profile/no-image/invalid-citation/invalid-model/usage/cache/cancellation, host configuration and default preservation, frozen GLM digests |
| Shared seam extraction | `chatAnswerTextTask.ts`; Zhipu `.answer` behavior unchanged on existing tests |
| DeepSeek provider + host branch | new provider module, factory branch, subpath export |
| Local verification | `pnpm --filter @talent-signal/agent typecheck`; vitest on `chatAnswerProvider.test.ts` + `relationshipTaskConfiguration.test.ts`; full `@talent-signal/agent` test run; `pnpm docs:check`; `git diff --check` |

## Pending beyond this slice

Independent review found malformed provider usage marked as measured zero and
a second billable DeepSeek request in the host fallback. Parent corrections
validate nonnegative safe counts and safe sums, preserve genuine zero, and
disable DeepSeek host retries without changing the GLM fallback. Red tests
reproduced both failures; the corrected suites pass 84 focused Agent tests,
488 full Agent tests (9 skipped), focused backend tests and backend
typechecking. The processor disclosure also names DeepSeek correctly while
keeping image upload unavailable. Independent review closed both findings;
the disclosure correction also passed review. Delivery gates remain pending.

Real DeepSeek provider A/B against frozen datasets, private harness CNY
cache hit/miss metering and `costUsd` contract naming (private, parent-owned),
human-reviewed calibrated judge inputs, backend/runner wiring review (e.g.
provider display labels), deployment of affected resident services from clean
committed source, and release. None of these are claimed here; GET-18 stays
open until parent acceptance.
