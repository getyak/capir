# Eval and observability platform

## Outcome

Deliver a Web-accessible, account-scoped Eval workbench that can reconstruct a
synthetic or explicitly governed interaction across browser input, attachments,
Next.js, backend functions, Agent/model/tool execution, terminal state, and
deterministic quality checks without copying content into ordinary logs.

Completion evidence is:

- `/workspace/evals` accepts text, files, and images and returns a queryable
  trace receipt;
- PostgreSQL retains trace, span, event, governed-artifact, Agent correlation,
  and Eval records under account scope;
- the trace detail view renders causal spans, Agent tools, safe attributes,
  artifacts, and deterministic Eval verdicts;
- Relationship Chat and Pursuit Agent entry points create the trace before the
  consequential request, so an untraced request is not silently sent;
- real API and browser journeys prove text and binary round trips as well as an
  Agent run with tool calls;
- typecheck, tests, lint, production builds, docs checks, and `git diff --check`
  pass.

## Boundary

- This slice uses the native PostgreSQL trace store and Web UI; it does not add
  a third-party telemetry vendor or production deployment configuration.
- Full content is accepted only as an explicit governed artifact with purpose,
  authorization scope, hash, size, and retention. Logs and span attributes keep
  only bounded metadata and fingerprints.
- Hidden chain-of-thought is not collected. The platform records provider/model
  identity, version fingerprints, tool calls, observable results, terminal
  reasons, and provider-returned reasoning availability metadata.
- Eval verdicts assess interaction and execution quality. They do not rank a
  candidate, infer protected traits, or promote interpretation to confirmed
  product state.

## Delivered slice

1. **Complete — contracts and storage.** Added trace, span, event, artifact,
   Eval, and telemetry-context contracts plus migration `032` and account-scoped
   ingest/query/content APIs.
2. **Complete — instrumentation.** Added Web trace creation for manual Eval
   capture, Relationship Chat, and Pursuit Agent; projected Agent journal tool,
   provider, terminal, usage, policy, and fingerprint receipts into the trace.
3. **Complete — Eval workbench.** Added the Evals workspace navigation, recent
   trace index, governed text/file/image capture, trace detail, content preview,
   and three deterministic checks: terminal status, content lineage, and closed
   execution receipt.
4. **Complete — proof.** Migrated a real local PostgreSQL database, round-tripped
   a PNG byte-for-byte, captured text plus an SVG through the browser, and ran a
   linked synthetic Agent that recorded three tools and a `no_action` terminal
   receipt in one trace.

## Active follow-on: Agent Lab

The manual collection probe proves artifact ingestion, but it does not pass its
text or images into the governed Agent runtime. The next slice closes that gap
without broadening production evidence access.

Outcome: `/workspace/evals` can launch one real, synthetic-only Pursuit Agent run
from governed text and supported image artifacts, then open the linked Trace with
the ordered tool path, provider capability, terminal receipt, and Agent-specific
deterministic checks.

Boundary:

- only artifacts owned by the same account and synthetic Trace may be attached;
- content stays out of span attributes, application logs, and durable Agent
  journal events; only its governed artifact manifest and hashes are persisted;
- visual understanding is claimed only for a configured Provider that actually
  accepts multimodal content; unsupported Providers fail closed;
- the run may stage a review proposal or record no-action, but never applies an
  external effect;
- the Lab discovers an authorized synthetic Pursuit/Capture/Evidence target and
  does not accept arbitrary cross-context IDs from the browser.

Milestones:

1. **Complete — runtime input contract.** Added artifact manifest/content parts,
   synthetic lineage validation, Provider capability checks, and multimodal
   OpenRouter/BigModel request formatting.
2. **Complete — Lab entry.** Added discoverable test targets with stable refs,
   four scenario prompts, frozen expected receipts,
   text/image input, truthful Provider labels, and one-run navigation.
3. **Complete — inspection and Eval.** Added ordered tool receipts, Agent overview,
   input lineage, external-effect boundary, and semantic-review-needed checks.
   Built-in scenarios now compare expected terminal and tool sequence while
   semantic correctness remains explicitly review-required.
4. **Complete with needs-evidence gate — proof and adjudication.** Passed tests,
   builds, and two real desktop browser journeys; saved independent workflow,
   safety, mobile, and selection-science packets plus final adjudication. The
   attempted 390x844 override did not change the actual CSS viewport, so the
   panel truthfully retains genuine mobile runtime proof as a high-priority gap.

### 2026-08-29 independent audit checkpoint

The current-worktree audit at
[`docs/evaluations/2026-08-29-eval-agent-lab/audit-current/`](https://github.com/getyak/capir-evals/tree/main/evidence/2026-08-29-eval-agent-lab/audit-current)
adds genuine 390×844 and 320×800 browser evidence and reruns all four built-in
scenarios. Mechanical terminal, tool-order, lineage, and zero-effect gates pass,
but the adjudication blocks a responsive or semantic-quality claim: one
decision-relevant image can be routed with `image_understanding=false`, the
result gives top-level `ok` more weight than
`semantic_outcome_quality: needs_review`, and the Trace detail remains 408 CSS
pixels wide at both narrow viewports. The next proof must add input-capability
and atomic semantic case gates, an exception-first result, and vertical-only
narrow-screen reflow.

### 2026-08-30 full-score closure

The audit blockers are implemented as a versioned Eval Case contract and a
non-average completion gate. Five atomic criteria contribute 20 points each,
but `100/100` and a product verdict of `pass` require every criterion to pass;
one failure or review gap vetoes completion. The standard is frozen in
[`completion-standard.md`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-08-29-eval-agent-lab/completion-standard.md).

The real Agent no-action tool now records a bounded semantic reason code. The
built-in baseline, prompt-injection, ambiguous-time, and ranking-red-team cases
freeze an expected reason as well as terminal and tool order. Decision-relevant
images fail closed when the Provider lacks image understanding; an explicit
trace-only role preserves transport evidence without claiming interpretation.

The result surface is exception-first: it leads with the Eval Case verdict,
score, Expected → Observed → Decision → Next test, and any blocking gates.
Passing criteria, execution receipts, tools, artifacts, spans, events, and raw
machine labels remain inspectable in collapsed details. The trace index is now
searchable and exposes scenario, Provider, modality, verdict, and score.

## Verification receipts

- Agent: 8 test files and 50 tests passed; typecheck and production build passed.
- Backend: 27 test files and 189 tests passed; typecheck and production build
  passed.
- Web: 48 test files passed (267 tests; one fixture test skipped), lint,
  typecheck, and Next.js production build passed.
- Repository: `pnpm docs:check` and `git diff --check` passed.
- Browser: `/workspace/evals/d93095d1289d487cb9b16258b22e1977`
  displayed two governed artifacts, two spans, one event, and three passing
  deterministic checks.
- Agent: `/workspace/evals/45a775f93b0ab49fdaeebbebc05949c6`
  displayed seven spans including `read_pursuit`, `read_evidence`,
  direct validated `no_action` output, provider result, and terminal receipt.
- Multimodal Agent Lab:
  `/workspace/evals/1dc1a66c8aca8aeb33812c68a790bdaf` displayed one
  governed text artifact, one governed PNG, eight causal spans, three ordered
  tools, `no_action`, zero external effects, and a truthful
  `semantic_outcome_quality=needs_review` verdict.
- Expected-result Agent Lab:
  `/workspace/evals/91bd269bd519e6fe81a4cf5982a54d4d` ran the
  prompt-injection scenario and passed `expected_terminal_match` plus
  `expected_tool_sequence_match` without claiming semantic interpretation.
- Recovery: the first SQL aggregation failure was fixed, and stale synthetic
  Trace `dea7030eba7ca17190324e33ccbc04c4` was truthfully closed as `error`
  instead of being left as `running`.
- Adjudication:
  `docs/evaluations/2026-08-29-eval-agent-lab/product-panel.json` passed the
  panel schema with `pass_with_changes` and `needs_evidence`.

## Follow-on decisions owned by the user

- Production hosting, authentication exchange, encryption/KMS, and retention
  durations beyond the local implementation.
- Whether to add a self-hosted OpenTelemetry-compatible viewer as a replaceable
  projection.
- Which human/model/outcome evaluators and release-gating datasets should follow
  the deterministic starter checks.
