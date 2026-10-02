# Personal-Agent documentation and brand audit

Date: 2026-10-02
Scope: current product documents, repository homepage, Web guidance, and repository
Skills. This is a dated change record, not product authority or runtime acceptance.

The display brand is `capri`, following the user's latest explicit instruction.
The existing `capir` CLI command and repository, package, application, and skill
identities remain unchanged for compatibility. Display copy does not approve a
release or a persistent-identifier migration.

## Authoritative ownership

[Product](../../product.md) owns the current personal-Agent positioning and
Person/Memory/continuing-work distinctions. [Capture to action](../../capture-to-action.md)
owns intake, understanding, selective confirmation, and continuation boundaries.
[Delivery](../../delivery.md) owns proof gates.
[Web experience](../../reference/web-experience.md) translates those decisions
into the public narrative and synthetic interaction rules.

The GitHub-facing [README](../../../README.md) is a concise entry to those owners.
It does not establish production readiness. The [Web guide](../../../apps/web/README.md)
now distinguishes a runnable demonstration from authenticated runtime proof.

## Precise cleanup performed

| Surface | Removed or corrected | Authoritative replacement |
| --- | --- | --- |
| [README](../../../README.md) | Repeated architecture and Agent-runtime deep dives, recruiting-first offer example, legacy homepage screenshot embed, and unqualified broad check instructions | Product-loop narrative, capability/boundary matrix, and links to canonical docs and scoped verification |
| [Product](../../product.md) | CRM-first positioning and implementation-level recovery, transport, and UI walkthroughs inside the foundation | Concise personal-Agent decision, screenshot handoff, three independently growing layers, time/state distinctions, and current ownership boundaries |
| [Delivery](../../delivery.md) | Repeated Lab implementation chronology and an older infrastructure-first delivery sequence | Evidence-linked foundation and complete capture → update → return slices; original Lab evaluations remain linked |
| [Capture to action](../../capture-to-action.md) | Default candidate/client and assignment-only wording in outcome review | Other person and shared outcome, comparison with existing work, waiting/pause, and time-aware retrieval |
| [Web experience](../../reference/web-experience.md) | Generic professional-CRM narrative without screenshot handoff or update demonstration | Synthetic familiar conversation, observable processing stages, human review branch, current capability labels, and static reduced-motion chain |
| [Development conventions](../../../.agents/skills/talent-signal/SKILL.md) | Auto-generated conventions inferred from two old commits, generic framework rules, duplicate code examples, and unbounded error logging guidance | Task routing, affected-package patterns, relevant verification, privacy, and stable identifier boundaries |
| [Design](../../../.agents/skills/design-talent-signal/SKILL.md), [mobile UX](../../../.agents/skills/mobile-ux-reviewer/SKILL.md), and [safety](../../../.agents/skills/evidence-safety-reviewer/SKILL.md) | Recruiter as default user, candidate as default object, and mandatory recruitment-research loading | Actual-user review, Person/context wording, screenshot understanding, source/time control, waiting, and stop |
| [Panel selection](../../../.agents/skills/product-adjudicator/references/panel-map.md) | Mandatory recruiter/candidate panel for every screenshot workflow | Small scenario-grounded personal-Agent panel; recruitment specialists only for their named domain |
| [Review scenarios](../../../.agents/skills/product-adjudicator/references/test-scenarios.md) | Recruitment fixtures as the only starting set | Five added conceptual personal-Agent scenarios; retained versioned `TS-*` scenarios are explicitly contextual |

The cleanup removes obsolete or duplicate prose from current retrieval paths.
No historical document or evidence file has been deleted: this audit found no
file-level deletion with a proved authoritative replacement and no dependent
references. Git preserves the previous wording of edited human-maintained files.

## Intentionally retained material

- Recruiting research, expert lenses, and `TS-*` fixtures: valid evidence and
  methods for actual recruiting work. Changing the audience does not invalidate
  historical findings or broaden assessment authority.
- ADRs, evaluations, release notes, and historical plans: retain original
  context, versions, unresolved proof, and original terminology.
- `talent-signal` repository/package paths, tool and skill names, image filenames,
  Bundle IDs, keychain/storage keys, API names, and update channels: compatibility
  contracts, not display-brand mistakes. A separately verified migration is needed.
- Existing `gettalentsignal.com` links and GitHub URLs: live destinations have not
  been replaced or redirected by this documentation task. A new name is not a
  domain-migration authorization or proof.
- Generated Wiki bodies: not hand-edited. Any later editorial change must use
  its `_index/` owner and compiler.
- Existing README imagery files: removed from the current homepage narrative,
  retained as historical assets; no image was deleted or regenerated here.
- Product design direction versus implementation: the new complete loop and
  reminder behavior are goals with acceptance gates, not assertions of delivery.

## Verification

- `pnpm docs:check`: passed on 2026-10-02 after the canonical edits; includes
  local Markdown links, canonical context budgets, compiled Wiki consistency,
  architecture ownership, and architecture diagrams.
- `python3 .agents/skills/product-adjudicator/scripts/check_panel_skills.py`:
  passed for all 11 panel Skills after the method and reference changes.
- The five `PA-CONT-*` scenarios are authored concepts, not executable test passes.
- No native, backend, private account, GitHub settings, Figma write, production
  deployment, field-value study, or live cross-device acceptance was performed
  by this documentation owner. Those results must be reported by their actual owner.
- Final display spelling is aligned to `capri`; repository-wide integration
  checks and release acceptance remain the delivery owner's responsibility.
