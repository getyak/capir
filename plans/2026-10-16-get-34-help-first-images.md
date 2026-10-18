# GET-34: Help-first image conversation

## Outcome and boundary

An intentionally shared image completes the user's current request without
forcing contact administration. A useful next step is a suggestion, including
no action; contacts and Memory remain independently reviewed, never auto-saved.
This fixes the generic workspace Chat path, not the explicitly authorized
capture-to-contact filing API. No new public protocol, model provider, budget,
data retention, or collection scope is introduced.

Base: `50a4feae108f345912ad61419bb7e7e5ae839ec7`.
Branch: `codex/get-34-screenshot-help-first`.

## Design and alternatives

The bundled workspace prompt already starts with natural assistance, but the
host's image-only objective and inspection context force relationship tools
before the answer. Two host fallback paths can also research/stage a contact
from a historical screenshot on a later text-only turn.

Keep the existing admission, image inspection, streaming, source retention,
optional direct-chat contact review, and explicit capture pipeline. Change the
image-only objective and prompt to useful content first, with an optional
source-grounded next step. Apply one current-message image eligibility rule to
both default contact paths, while historical images remain available for
questions. Enforce explicit analysis-only/no-action/no-save decisions at the
host proposal boundary as well as in model guidance. Do not infer refusal from
image text, previous assistant text, or generated host instructions.

Rejected: a prompt-only edit (cannot fix automatic host staging); disabling all
contact suggestions (loses the established direct-chat review option); a new
classifier/model call (extra cost and latency for an existing host boundary).

## Fixed acceptance matrix

| Scenario | Required result | Failure condition / proof |
| --- | --- | --- |
| Image-only direct chat | Useful answer; one source-grounded optional review; no canonical write | Host behavioral test, stage/research counts and human-commit boundary |
| Article or no contact | Explain the actual material; no invented counterparty or forced task | Host article observation test; live synthetic article answer and tool trace |
| Ambiguous/group image | Useful bounded answer; no group-to-one contact or private recall | Host group/unknown tests; live synthetic ambiguity |
| Explicit only-analyze/no_action/no-save | Answer preserved; zero proposal stage or first-contact search, even if model asks | Failing-then-passing host tests for fallback and model tools |
| Current text, historical image | Historical image available for answering; no automatic contact merge/research | Distinct current/source UUID behavioral tests |
| Direct current image plus explicit useful preference | Keep existing self + contact review option when allowed | Existing combined proposal regression |
| Source revoked/cancelled or optional stage fails | No stale proposal; no false saved claim; retain answer only when still authorized | Existing/current-source and failure regression tests |

Relative source dates remain literal. Every proposal needs original excerpts and
an admitted locator; namesakes stay human-reviewed. No-action does not promise
that Session/audit retention is disabled. Suggestions are never external effect
authorization. Existing queue progress/streaming and source archival are retained.

## Execution ledger

- [x] Verify GetYak workspace, owner, queue and dependencies; claim GET-34.
- [x] Inspect current production entry and isolate from latest remote main.
- [x] Fix design and acceptance before production edits.
- [x] Add behavioral regressions; observe the intended failures.
- [x] Implement host boundary and consistent image guidance.
- [ ] Run focused and package checks, docs policy, and synthetic model comparison.
- [x] Independent sub-agent review; fix and re-review all confirmed P0/P1.
- [ ] Create linked PR; current-head CI and repository protection must pass.
- [ ] Merge, deploy affected resident services from clean source, verify actual
      revision and changed behavior, then read back Linear completion.

## Evidence and recovery

Private control/evidence root:
`/Users/cubxxw/.local/state/linear-hourly-delivery/`.
No raw personal screenshots or credentials belong in this plan or Git.
The current author is the authenticated default test owner; its valid refresh
grant can provision one named isolated acceptance run. Keep its request/run IDs
for replay and verify cleanup at the end.

Resource preflight found less than 30 GiB free. Retired framework build outputs
were checked against clean source, active/last-five release protection, process
paths, open files and Docker mounts; receipts retain their build IDs and source
SHAs. Source, active releases, databases and other tasks were preserved.
Package-manager activation failed before installation after metadata pruning;
restore normal pinned-version activation before attempting checks. This is not
a source/test failure.

## Implementation verification (before PR)

Agent package: 430 passed / 1 skipped. Backend package without the optional DB
DSN: 1055 passed / 558 skipped. Targeted intent/steering tests after final
review fixes: 30 passed. Separate disposable PostgreSQL 18 domain suites:
87 passed across proposal withdrawal, MCP interactions and OAuth cleanup.
Backend TypeScript, documentation/wiki/architecture checks and diff whitespace
checks passed. Skipped integration suites are not represented as passed.

Independent reviewer `get34_review` completed three rounds. Fixed and rechecked:
exact current-image locator with historical context, no-action on alternate
proposal tools, historical contact authorization distinct from self-note saves,
and late steering withdrawing durable pending review authority. Withdrawal is
restricted to the exact account/user/Session/live Run, source and revision;
already saved Memory and submitted operations remain intact and are reported.
An open contact decision is closed even when its self Memory was already saved.
No schema migration or public tool/protocol change is needed.

All negative regressions were observed failing before their corresponding fix,
including a mutation test with the historical-image guard removed. The final
review found no unresolved P0/P1. Reviewed source-content fingerprint:
`07d4cca87893ed16efe5c653430f5f858ee292cb1488d8c790ce661ee28200c4`.

The authenticated isolated acceptance run has verified its real owner/target,
expiry and daily synthetic data counts. The old resident version answered the
synthetic article usefully without a contact; this is a baseline observation,
not candidate proof. Actual model comparison, current-head CI and deployment
remain delivery gates. Private credentials, browser state and DB DSNs remain
only in the owned temporary artifact and must not enter Git or formal evidence.

### CI-driven multi-image correction

The first PR head (`5565e72a`) failed the real Memory integration case with two
images in the same current message. The historical guard had confused default
single-image fallback eligibility with current-message membership. A new host
regression reproduced this failure. The guard now checks membership in all
current-message images; the single-image default remains unchanged. The real
Memory integration suite plus image-intent tests passed 111/111 on PostgreSQL.
The independent reviewer checked the correction and its TypeScript narrowing.

Old-resident live baseline: article-only and direct-chat analysis/no-save both
answered usefully. Group-only instead explained why it would not prepare a
contact card and invited a one-to-one screenshot, without helping prioritize
the visible export/layout questions. Preserve this observed failure when
comparing the candidate; do not infer a model-quality improvement from the
host tests alone. Infisical authentication was restored through the existing
browser login and the 24-name backend runtime contract now passes.
