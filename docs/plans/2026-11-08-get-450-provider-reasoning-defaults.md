# GET-450 — Provider reasoning intent and immutable run configuration

Parent GET-439, historical C15. GitHub issue526. Branch
`codex/get-450-provider-reasoning-defaults` starts at main7c8ac82f.

## Outcome and boundary

Omitted effort must remain omitted at the provider boundary; explicit supported
policies must reach the actual adapter unchanged. The same run ID cannot resume
with different host reasoning configuration or gain a fresh budget. Preserve
lawful completed read-only replay. Claude continuation must distinguish omitted
effort from explicit high without changing its existing request enum.

Retain token, cost, output, deadline, abort, privacy/routing and tool-effect
limits. Keep explicit workspace low and scoped/contact medium policies. No
model replacement, fallback, image-capability expansion, migration, dependency
upgrade or historical unlimited-budget behavior. Do not edit GET-449 owners,
shared authentication/source/history/queue or its in-progress integration tests.

## Evidence and primary contracts

The independent28-source C15 design audit found implicit low in both GLM
adapters/backend Zhipu construction; the shared local host ignores explicit
effort. Generic SDK fingerprints and both immutable local journals omit that
per-instance configuration; the continuation digest conflates absent/high.

At this branch the manifest pins Claude Agent SDK0.3.312 and TypeScript6 alias
6.0.2. Local cached dependencies are separate evidence. The official0.3.312
declaration was verified against npm registry integrity; use it for API shape,
not the locally installed0.3.287 as proof of the pinned contract.

- [BigModel GLM-5.3](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3):
  text-only, low/high/max, provider default max; omission means no host override,
  not an observed effective effort.
- [OpenRouter GLM-5.3](https://openrouter.ai/z-ai/glm-5.3-20260816): the same
  supported reasoning levels. Preserve the existing request and routing shape.
- [Model owner](https://github.com/zai-org/GLM-5): GLM-5.2 high/max differs from
  GLM-5.3 low/high/max. Reject unsupported explicit combinations before fetch;
  do not infer capabilities from a model-name regex.
- [SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript) and
  [exact release](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/0.3.312).

## Approach and compatibility

Normalize and freeze a small host-owned provider description at construction;
allowlist intent/version/provider/model only, without secrets, prompts or ENV.
The controlled adapters expose their actual intent. Do not label an unknown
provider's configuration as a known default. Audit the remaining constructor
policies before defining their compatibility description.

Include the description in the existing SDK fingerprint and both local run
identities. Persist and strictly parse the new optional field. Missing historical
records remain legacy unknown; incomplete unknown/mismatched same-ID execution
must conflict before any provider/gateway call, keeping old checkpoints and
budgets. Keep the CLI's authorized completed-terminal replay before provider
construction. Configuration is identity metadata, not new execution authority.

Use the existing continuation digest owner with a new version and absent=null;
preserve every source/Session/prompt/tool/transport/output-schema component and
derived-binding cleanup. No historical receipt rewrite or original-history
deletion. Only promise readable intent if its exact schema/producer/parser is
implemented; a fingerprint alone does not display effective effort.

## Milestones and actual state

1. Active: freeze constructor/configuration compatibility and add meaningful
   actual-wire/fingerprint/resume/legacy tests before implementation.
   Eight new mocked wire cases executed against unchanged adapters:2 omission
   failures,6 explicit low/high/max passes;10 unrelated cases were filtered.
   No real provider call. Runtime code is still unchanged.
2. Implement the complete request, shared factory, fingerprint, strict local
   journal and continuation path. Update the existing canonical Agent guide.
3. Pass focused negative/recovery/safety checks and full applicable Hosted gates;
   independently review immutable configuration and recovery boundaries.
4. Normal exact-head merge after applicable gates. Deploy affected existing
   residents from clean source through the owning operational workflow and
   verify revision/changed behavior before task completion. Record any resource
   or operational blocker as incomplete; source checks do not imply runtime.

## Verification and remaining uncertainty

Require omission/blank ENV versus all explicit values, unsupported combinations
before fetch, both shared host factory consumers, different per-instance hashes,
both immutable journal parsers and identity conflicts, legacy-incomplete denial,
lawful completed replay with no new dispatch, and absent/high continuation
distinction. Reuse the existing cumulative-budget/unknown-usage/tool-batch tests;
do not increase limits to make a case pass. No new paid/native/release evidence
exists. Provider configuration compatibility is the remaining first-milestone
design detail, not a reason to manufacture a default or rewrite old records.
