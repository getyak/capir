# GET-34: restore source-selected relationship citations

## Outcome and boundary

Unblock GET-34's release without changing the mandatory deployment probe or its
evidence-citation gate. Relationship answers that use governed snapshot evidence
must select the relevant allowed evidence through the existing citation tool.
Reading a snapshot alone is not a citation receipt. Accepted Memory recollection
keeps its separate source-lineage contract. No new tools, writes, retries,
provider/model changes, budgets, public protocol or schema changes are intended.

## Evidence and design

The frozen real-provider failure is retained in the hourly delivery evidence as
`provider-citation-failure-case.json`, request
`500f9fec-ef84-47c4-8c79-8918a0d44215`. The model reads the supplied confirmed
`relationship_context` block and uses its content, but never invokes
`cite_evidence`. The host correctly produces `clarification` with no citations.
The old deployed probe explicitly requested a citation; it is not a same-input
control. This behavior predates the GET-34 implementation.

The formal relationship prompt requires relevant allowed citations. Its natural
SDK adapter currently describes the citation duty as applying to "Wiki
relationship evidence", while the read tool returns a governed relationship
snapshot and `evidence_fragment_ids`. That vocabulary leaves the required
snapshot-to-citation step ambiguous. This is a source-contract hypothesis, not
proof that a particular wording guarantees model compliance.

Clarify that step in the existing relationship adapter guidance: using snapshot
blocks requires selecting their relevant `evidence_fragment_ids` intersected
with `allowed_citation_ids` through `cite_evidence` before the final answer;
reading alone is insufficient. Retain the accepted Memory distinction. Keep the
workspace/image guidance unchanged. Verify the actual consuming model rather
than adding a prompt-substring test.

Rejected alternatives: changing the probe objective or check would conceal the
failure; automatically citing every allowed source would fabricate selection;
an extra corrective model call would introduce new budget, cancellation and
continuation behavior without evidence it is needed. Keep the current fail-closed
host behavior when the model still omits citations.

## Fixed acceptance before implementation

| Scenario | Expected | Verification | Failure |
| --- | --- | --- | --- |
| Exact frozen natural question and single block | Useful scope-gap answer, successful citation receipt for synthetic-evidence-0001 | One controlled actual provider call using committed candidate guidance and original input/check | Missing/forged citation, clarification, unsupported claim |
| Same question with an unrelated second block/source | Read relevant context and cite only used source | One controlled actual provider call with tool trace | Blind all-ID citation or unrelated evidence |
| Model uses record but omits citation | Host retains clarification/empty citations | Real adapter with external harness fixture replaying observed failure | Host invents citation or reports cited answer |
| Successful in-scope selection among multiple IDs | Only successful selected ID returned | Real adapter/tool execution test | Automatic expansion or out-of-scope success |
| Accepted Memory recollection / cancelled source | Existing attribution and source guards unchanged | Affected Agent regression suite/typecheck | Unrelated Wiki citation requirement, write or stale-source acceptance |
| GET-34 image behavior | Original fixed matrix remains required | Original integration evidence plus actual isolated production UI/model comparison after deployment | Forced CRM, no-action side effect, unhelpful image refusal |

Real-provider calls are fixed to these two cases once per reviewed candidate;
preserve failures, do not retry unchanged inputs until green. The controlled
artifact may mount a freshly compiled committed Agent module into the existing
verified image for diagnosis, with truthful source/hash receipts; this is not a
production deployment artifact. Canonical production must use a newly validated
image and matching Web artifact after review and current CI. Heavy builds still
require the resource gate.

## Milestones

1. Freeze this design and failure/negative controls, then clarify the adapter.
2. Run focused/full Agent checks and the two controlled model cases; retain exact
   commit, source/module hashes, inputs, tool receipts and results.
3. Independent Codex review, PR/current-head CI and merge under repository gates.
4. Build and deploy all affected resident services, preserve rollback, complete
   the original GET-34 production acceptance and test-run cleanup, then close it.

Status: design frozen before corrective implementation. The original screenshot
plan and all production acceptance remain outstanding.

## First candidate evidence and revised design

Candidate `c4cdf9b0` passed the unchanged citation gate in both fixed model cases,
but failed the pre-existing useful-answer criterion. The single-block final
reply claimed the question had already been answered and omitted a concrete next
question. The multiple-block reply selected only the relevant citation, but
suggested asking the contact to provide the very role scope the contact had
requested from the user. Both failed samples remain retained; neither permits
PR delivery or production activation.

The answer path has no steering/preparation Stop hook and returns the SDK's
final `result.result`. No evidence establishes host text truncation. Clarify the
same adapter's existing final-answer requirement: tool prefaces are not delivered
by this answer call, so the final reply must itself contain the requested answer.
Preserve who asked whom for what; help the user satisfy a contact's information
request before proposing a follow-up, rather than bouncing it back. Do not
concatenate intermediate text, manufacture a host answer, add calls, change
tool authority or relax either fixed case.

For the next source candidate, use the same two inputs and per-candidate call
limit. In addition to citation receipts, manually check final-answer usefulness
and request direction. The single case must give a usable next question after
supplying the missing role scope (unknown role details remain placeholders); the
multiple case must preserve that direction and omit the irrelevant facility
source. A scalar `passed` field proves only the mechanical citation check.

## Second candidate checkpoint

Candidate `144d7181` passed Agent432/1skip, compilation and documentation checks,
and independent code review found no P0/P1. Its single-block model sample returned
the correct selected citation and preserved the request direction. However, its
draft asked whether "the time we discussed" still worked. The supplied context
does not establish any previously discussed time. Independent business review
rejected this unsupported premise, despite the unchanged mechanical probe
returning `passed=true`. Request `1af842f2-c7b8-414d-bd05-043e88737cbc` is retained
in the delivery evidence with a separate business-failure assessment.

The second case was not run for this candidate. Neither local candidate is
approved for PR delivery, deployment or issue closure. No resident service was
changed in this follow-up. Before another source candidate, reconsider the
answer design and its treatment of missing draft premises; do not repeatedly
append sample-specific prohibitions or retry an unchanged source. Keep the
original input, citation gate, model/budget, source/request-direction standards
and GET-34 business matrix. A documentation-only commit is not a new behavioral
candidate. Production builds also remain gated by at least30GiB available space;
the fresh safe-cleanup audit found no eligible large artifact.

## Evidence-to-draft design, frozen before implementation

The next slice changes responsibility boundaries instead of appending a ban for
the last failed phrase. The formal relationship prompt owns product behavior:
keep source facts, unknown premises and proposed wording distinct, preserve the
direction of requests, and omit unnecessary assumptions or use placeholders for
missing details a useful draft needs. Prior messages, commitments, actions and
times in a proposed draft need the same source support as factual narration.
No fixed response template or sample-specific wording is required.

The natural SDK adapter owns transport and tool protocol. Remove its obsolete
contact-directory routing instructions: `answer()` does not offer those tools,
while both workspace execution paths already use their own routing guidance.
Move request-direction policy to the formal prompt rather than duplicating it.
Retain citation receipts, accepted Memory lineage/coverage, complete final output,
title metadata and truthful write receipts. Workspace/image routing is unchanged.
This separation matches the canonical Context engineering ownership; it is a
design hypothesis, not a proven explanation of model errors.

Rejected alternatives remain host-generated citations/answers, concatenated tool
prefaces, changing the probe or model, and an added corrective model call. This
slice does not add capability, budget, persistence, retries or external effects.

One behavioral candidate is allowed in this round. Keep the exact frozen single
and selective multi-source cases and their citation/semantic standards. Add a
separate counterexample: a source explicitly records a meeting on2026-10-20 at
15:00 Asia/Shanghai and an outstanding role-scope request; the user asks for a
concise reply with the scope placeholder and recorded meeting time. The final
draft must preserve that known time, preserve the request direction, use a scope
placeholder and cite its supporting source. This detects a blanket ban on time
references or excessive clarification. Each case runs once and only after the
preceding final reply passes independent semantic review. Any failure stops this
candidate and this round's model attempts; elapsed time or documentation commits
do not permit a retry.

Run the full Agent suite, typecheck/compile and documentation checks, then an
independent code review before local commit/model validation. The controlled
image must carry and hash-read-back both changed compiled modules, since a
provider-only patch would leave the formal product prompt stale. It is diagnosis
only. On acceptance, create PR and verify current CI, merge and build both real
resident artifacts under the resource gate, then complete the unchanged GET-34
production matrix. The issue remains In Progress until then.

## Evidence-to-draft candidate outcome

Candidate `d0469a10` passed Node24 Agent432/1skip, typecheck, compilation,
documentation/architecture and independent source review. Both changed compiled
modules were copied and SHA256-read-back before model startup, and the actual
bundled formal prompt digest was verified before the model call.

The frozen single case passed independent semantic review: its indirect question
kept scope uncertainty conditional and did not invent a meeting time. The
selective multi-source case selected only the relevant citation, but failed
business acceptance. Its introductory advice correctly said to supply the
requested scope, while its suggested question substituted a position title for
the scope and moved to scheduling. The final explanation then claimed that the
requested information had been included. A title does not resolve the recorded
scope prerequisite. That contradiction cannot be excused by the correct
introductory paragraph or the successful citation receipt.

The failed request `62fb23c9-fc0a-4035-80fc-766cbb9d8950` and passing single
request `6c0cddcf-086e-48bc-a4c8-3712f19de796` remain preserved with separate
mechanical and semantic decisions. The known-meeting control was not run. This
round's sole candidate is rejected for PR/deployment; no resident service was
changed. Do not retry it or add another prompt amendment in this round.

Next design work must address unresolved prerequisites in proposed wording,
including whether a partial answer falsely claims to satisfy the prerequisite.
This observed model inconsistency is not proof of a particular source-code root
cause. Keep the original cases and all failed outputs; do not use aggregate
scores, an easier objective, automatic citations, or a different provider to
declare the requirement satisfied. Capture provider-reported model metadata in
future diagnostics as well as the configured alias; previous records did not
retain that field and must not be backfilled by inference.
