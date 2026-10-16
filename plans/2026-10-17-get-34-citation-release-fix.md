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
