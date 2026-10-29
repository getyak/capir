# GET-311: Recover failed Agent conversations

## Outcome and boundary

Restore the installed macOS conversation path after early Claude SDK failures and make the queue recovery state understandable. Preserve admitted messages and explicit retry authority; do not automatically replay a run or weaken tool/effect controls. Link: https://linear.app/getyak/issue/GET-311/fix-agent-execution-failures-and-make-paused-conversations-recoverable

## Observed evidence

- User conversation at 2026-10-29 13:40 CST failed after 2539 ms with queue code `MODEL_RUN_FAILED` and diagnostic code `CLAUDE_HARNESS_RUN_INTERRUPTED`.
- SDK initialized after 445 ms, reported one synthetic/error assistant frame, no real model response timing, zero tool calls. Another conversation showed the same failure.
- Resident API readiness returned 200; a synthetic direct request to the configured model returned a text message with HTTP 200. This does not establish SDK execution success.
- Resident backend revision: `235282ecf176d1caaa6c0202d58d25455426e12c`; resident Web revision/latest fetched main: `a2e97642247660bac3a868262aa0789b9d3d8cbf`.
- Original checkout has unrelated changes. Work is isolated from latest remote main.
- Docker daemon became unavailable during read-only diagnosis at 13:45 CST; investigate current ownership/state before any restart.

## Milestones

1. Complete: reproduced SDK provider refusal, HTTP 402. A tiny request succeeds, but the complete workspace tool request fails even at a 2000-token output reservation. Do not reduce answer capacity or switch provider to conceal billing restrictions.
2. Complete: preserved typed provider failure/status, projected HTTP 402 as a bounded billing code, localized the recovery explanation, and removed the disabled Resume from failed queues. Regression tests first failed for these exact behaviors; 21 backend and 47 Web targeted checks passed. Independent static review found no P0/P1 or important P2.
3. Active: final type checks and broader unit suites; create linked PR, pass current-head CI, merge. Docs/architecture and targeted lint passed. An omitted failure-code union member was caught by type checking and corrected before delivery.
4. Deploy affected resident services from clean committed source, verify revisions and complete an isolated test-account conversation plus macOS recovery.
5. Clean up test account/resources, read back Linear completion, preserve evidence and recovery references.

## Completion evidence

Record diagnostic categories without raw prompts, screenshots, credentials, provider error prose, or raw SDK transcripts. Preserve original failed entries. Prove actual application wiring and a successful full Agent request; a plain model request or mocked test is insufficient. Do not mark complete until resident deployment and real-surface acceptance pass.

## Current blocker and evidence

The current Hao credential rejects the full Agent request with HTTP 402. Lowering output reservation from 4000 to 2000 still fails for the full prompt/tools. Funding/quota correction requires the account owner; a pending user question records this prerequisite. No automatic charge, credential substitution, model switch or replay is authorized by the diagnostic result. Deployment/provider acceptance remains pending.

Task-private credentials and transient logs: `/private/tmp/ai-test-get-311.tIoTGQ/`. Test run `201a4b5f-7785-4abd-bd21-b1a93658c81e` / request `0fd90c85-aa61-429d-a9b7-d73acc110131` on staging must be stopped after acceptance or before handoff. Original user messages remain untouched.
