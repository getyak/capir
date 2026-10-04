# Retrieval craft and independent visual review

Status: complete. Final independent craft scores are mobile 97/100 and workflow 95/100; relevant native and documentation checks pass.

## Outcome

Rework the Sessions/People viewport after the user's rejection of the initial
polish. Implement first, then freeze a visual rubric and screenshots for
independent sub-agent review. Iterate until each visual reviewer awards at least
95/100 under the unchanged rubric and functional gates pass. Ratings remain
subjective review evidence, not a claim of universal design quality.

## Boundary

Own retrieval controls, row presentation, and secondary chrome that interferes
with these two pages. Preserve page navigation, local state, Person identity,
read/unread semantics, exact-source access, menu affordances and external-write
approval. Preserve unrelated edits. Synthetic screenshots only.

## Sequence

1. Done: simplify the complete viewport, improve typography and row rhythm,
   reduce tool-banner competition, and compact repeated metadata.
2. Done: freeze rubric v1 and a numbered screenshot bundle with source hashes.
3. Done: independently review visual craft and recruiter legibility; preserve each
   score and concrete defects. Implement justified fixes and recapture.
4. Done: run relevant native checks, update the narrow canonical design guidance and
   publish the final artifact/score evidence in the local evaluation folder.

## Review integrity

Reviewers get the same frozen artifact and rubric, no target score or previous
reviewer's opinion. Do not change weights, suppress low scores, or ask a reviewer
to raise its score. A high rating does not excuse an accessibility or safety
failure. Keep full-screen shell chrome in the evidence.

## Evidence and corrections

- [Round 1 evidence](https://github.com/getyak/capir-evals/tree/main/evidence/2026-09-06-ios-retrieval-craft/round-1):
  mobile craft 80, workflow craft 74. Both behavioral reviews are 2/4,
  pass with changes, screenshots-only. No functional inference from stills.
- Addressed clipped navigation, oversized chrome glyphs, singular result
  grammar, inconsistent session identity placement, and the AX5 surname column.
  Primary record text still follows the requested Dynamic Type category;
  bounded utility chrome has large-content alternatives.
- Verification exposed an anchor bug even when a cold rerun passed: the saved
  row overlapped the viewport by only 1.667 points. Root and an independent
  read-only reviewer traced it to custom row coordinates across UIKit List cells.
  Row and viewport now use global coordinates with two-axis visibility checks.
  Baseline UI tests require the entire normal row inside the List.
- Final focused run: long People, long Sessions, compact People, and Chinese dark
  AX5/menu checks all pass. Eleven distinct relevant tests have passing evidence;
  [test chronology](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-ios-retrieval-craft/test-summary.txt)
  preserves failed and superseded intermediate checks.
- Ten [round 2 images](https://github.com/getyak/capir-evals/tree/main/evidence/2026-09-06-ios-retrieval-craft/round-2)
  and source hashes are frozen. Mobile scored 93/100; workflow scored 92/100.
  Both behavioral reviews are 3/4. Their exact deductions remain archived.
- Round 3 implements width-fitting utility metadata, full-width AX5 identity
  without a decorative avatar row, matching separator insets, smaller status
  glyphs, localized app-owned role labels, explicit quiet unread text alongside
  elevation, and a subdued native-material composer. Record text stays uncapped.
  Targeted tests pass, including localized role search and native AX5 menus.
  Ten full-viewport captures and source hashes are frozen in round-3. Two fresh
  specialists independently applied the original rubric: mobile 97/100 and
  workflow 95/100. Both behavior scores stay 3/4. The panel accepts the bounded
  implementation with documented optional refinements; no external release.
- Final evidence and handoff: [evaluation README](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-ios-retrieval-craft/README.md)
  and [panel result](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-ios-retrieval-craft/panel-result.json).
  Source/image hashes match, the frozen rubric is unchanged, git diff checks
  pass for owned files, and pnpm docs:check passes.
