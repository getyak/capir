# Panel map

Choose the smallest set that covers the decision. `Required` means required when the condition is in scope, not for every review.

| Skill | Professional lineage / role | Apply when | Do not ask it to decide |
|---|---|---|---|
| `recruiter-workflow-reviewer` | Synthetic boutique-search operator | Recruiting-specific product or workflow review | Candidate quality or legal compliance |
| `evidence-safety-reviewer` | Evidence custodian; AESC/privacy/auditable-AI principles | OCR, identity, private data, state, actions, permissions, retention | Product-market fit or legal certification |
| `mobile-ux-reviewer` | Apple/WCAG-informed mobile craft critic | iOS/responsive screens, flows, recordings, builds | Hidden runtime correctness from screenshots |
| `selection-science-auditor` | I-O selection and evaluation science | Candidate assessment, rubrics, graders, benchmarks, outcome claims | Unvalidated candidate recommendation |
| `candidate-experience-guardrail` | Katrina Collier's public human-first lens | Candidate-facing communication, waiting, automation, consent, follow-through | Product visual craft or psychometrics |
| `performance-outcome-fit` | Lou Adler's public performance-based lens | Role briefs, comparable accomplishment, career value, win-win action | Candidate fit without role outcomes/evidence |
| `candidate-decision-motivation` | Geoff Smart/ghSMART public decision/sell principles | Competing offer, decision drivers, unresolved tradeoffs, closing process | Manipulative persuasion or acceptance prediction |
| `executive-potential-evidence` | Claudio Fernández-Aráoz public potential framework | Longitudinal executive assessment with multiple episodes and target role | Screenshot-based potential inference |
| `inclusive-sourcing-recall` | Glen Cathey's public sourcing/search lens | Search query, talent pool, recall, sparse profiles, exclusion audit | Current screenshot-to-action runtime unless sourcing is added |
| `recruiting-trend-radar` | Hung Lee's public curation/sensemaking lens | Roadmap, frontier scan, competitive change, recent market assumptions | Release gate from trend popularity |
| `product-adjudicator` | Evidence-led editor-in-chief | Combine independent packets and decide next proof | Generate a missing specialist opinion |

## Supporting project skills

- `candidate-signal-analysis` is the recruiting-specific system-under-test workflow for extracting explicit facts and proposing reviewable actions. It is not an independent judge of itself.
- `design-talent-signal`, when present, checks product-specific visual-system and provenance-state conformance. Use it alongside, not instead of, `mobile-ux-reviewer`.

## Default panels

### Personal-Agent screenshot continuity release

`evidence-safety-reviewer` + `mobile-ux-reviewer`, plus a scenario-grounded
usefulness review against the current Product contract. Use `design-talent-signal`
for product-specific hierarchy and state conformance. Record the usefulness
reviewer's actual method and evidence; artifact review cannot prove field value.

Check useful understanding before organization, independent Person/Memory/work
choices, updated existing work, retrieval, waiting, stop, and source deletion.
Add `selection-science-auditor` for model/grader or experiment design.

### Recruiting-specific screenshot release

Add `recruiter-workflow-reviewer` and `candidate-experience-guardrail` to the
personal-Agent panel when the actual flow concerns recruiting. Add
`selection-science-auditor` when any output approaches candidate assessment.

### Role/candidate advisory concept

`recruiter-workflow-reviewer` + `candidate-experience-guardrail` +
`performance-outcome-fit` + `candidate-decision-motivation` +
`selection-science-auditor`

Add `executive-potential-evidence` only with its minimum evidence threshold.

### Sourcing product concept

`recruiter-workflow-reviewer` + `inclusive-sourcing-recall` +
`selection-science-auditor` + `evidence-safety-reviewer`

### Roadmap/frontier review

`recruiting-trend-radar` + `recruiter-workflow-reviewer` +
the domain reviewer for the proposed capability. Trends never stand alone.
