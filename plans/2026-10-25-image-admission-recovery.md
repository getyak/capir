# Image admission and recovery — 2026-10-25

## Outcome and boundary

Remove the redundant queue-row thirty-day check that rejects new image messages during clock skew. Preserve canonical Session expiry and cascade cleanup. Make Web/macOS and iOS image send errors and retries truthful, visible, and idempotent. Verify regression tests and the deployed image-to-answer flow in an isolated test workspace owned by test@cubxxw.com. No unrelated data or source changes.

## Baseline and evidence

- Frozen base: `7ad847eda470fe6011fb6b9875cd3c09749246a7`.
- Sanitized incident: `/Users/cubxxw/ops/reports/capri-image-no-response-20261025.md`.
- Pi task: `20261025-003135-b316feee`; dependency preparation completed, initial database migration timed out under VM pressure, then MiMo returned 401 Invalid API Key before producing code. No provider switch or further model retry. Codex parent owns the implementation, host regressions and delivery; independent read-only sub-agent review completed with no unresolved P0/P1/P2.
- Existing ops pause marker retained; this repair/deployment is explicitly user-directed. Initial storage audit: 50.03 GiB free; 230 Node/npm processes; 11.70 GiB swap. Another task owns active Xcode compilation; no concurrent native build started here.
- Dedicated disposable PostgreSQL Compose project: `capri-image-boundary-20261025`; no production data. Rebuildable artifacts registered at `/private/tmp/ai-test-capri-image-boundary-20261025.kKhonc`.

## Milestones

1. Complete: forward migration 105 removes only the redundant queue clock check; readiness requires it. Web and iOS feedback distinguish send/reconciliation/received states; both retry paths reconcile before same-ID admission.
2. In progress: focused host verification passes; independent review passed. Real database skew regression and native test execution remain required; local VM pressure blocks them, so cloud CI will run these gates.
3. Pending: current-head CI/merge and clean-source resident backend/Web activation.
4. Pending: real image send, model answer and history reload; verify failure recovery; stop and read back test workspace cleanup.
5. Pending: preserve formal receipts and clean task-owned resources.

## Environment observations

During preflight, host API/Web requests began timing out. Backend health changed from healthy to unhealthy during observation. CLI login timed out after 300 seconds. This is separate from the confirmed queue constraint defect and is not proof of code failure or a passing deployment. Recheck the relevant live service and network path before end-to-end acceptance. Do not restart or terminate unrelated services or builds.

## Completion proof

Record real PostgreSQL skew/idempotency/expiry regression results; frontend and native recovery tests; current commit CI/review; actual backend image/revision and Web build receipt; isolated run/session/message IDs; original image hash; model result/readback; canonical reply after reload; test stop readback; resource ownership and cleanup. Physical-device/TestFlight acceptance is distinct from Simulator or Web proof.

## Verification receipts

- Initial regressions observed failing: Web image HTTP500 explanation, failed delivery reconciliation resending retained bytes, and four history-access revocations after a queue receipt. Each was corrected and re-run; no passing claim comes from a skipped database test.
- Focused Web hook/recovery tests, backend schema/health tests, TypeScript typechecks, ESLint, localization and documentation/architecture checks have task-owned logs under `/Users/cubxxw/ops/runs/capri-image-boundary-20261025/`.
- Native regressions cover sanitized HTTP failures, receipt preservation, lost-receipt queue readback through persistence/reload, canonical reply recovery, inactive owner, and readback persistence failure. Execution is still a pending gate.
- Synthetic image fixture is purpose-built numeric/shape artwork; expected digits are absent from the question. No personal screenshot is replayed to a provider.
- Retention learning is encoded in migration/schema/real PostgreSQL tests; retry ownership and revoked-access counterexamples live in focused client tests. No always-on instruction expansion is needed.

## Concurrent integration

Main advanced to `eec402a9` with background capture and migrations103/104. The queue expiry migration was not deployed and is renamed105 before release. Its DDL is unchanged. Preserve main's complete migration history, reviewed frozen digest and translations, then append105. Regenerate the combined Xcode project and rerun all gates against the resulting head. Earlier CI records refer only to their recorded heads.
