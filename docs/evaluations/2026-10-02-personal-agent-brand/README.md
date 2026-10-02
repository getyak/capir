# capri personal Agent rebuild evidence

## Delivered source and external design state

The user requested parallel website/design, visible brand, generic personal Agent
copy, GitHub presentation and obsolete-guidance cleanup. The latest explicit
spelling `capri` governs display names. Existing `capir` CLI commands, installed
application identities, package imports, domains and historical records remain
compatible.

The hero demonstrates one synthetic WeChat-style source becoming an attributable
understanding, a human-reviewed unfinished item, and a reviewed update to that
same item. The shared person projection withdraws context when sources are
removed. This is an interactive website demonstration; it is not evidence that
all proposed mobile/backend stories have been newly implemented end to end.

- [Web design directions](web/design-tree.md) and [implementation checks](web/verification.md).
- [Client display and compatibility audit](client-audit.md).
- [Backend/Agent copy and contract audit](core-copy-audit.md).
- [Canonical documentation and obsolete content audit](docs-audit.md).
- [Figma mutation and identity readback](figma/README.md).
- [Browser verification](web/browser-verification.md).

GitHub repository description was written and read back as:
`capri — a personal Agent for important people and unfinished work. Screenshot-first, source-linked, and human-reviewed.`
The repository remains `getyak/talent-signal`; its existing service homepage URL
is retained. The main README changes through the reviewed branch/PR.

## Review and verification boundary

An independent reviewer inspected the current diff against `3c1e7559` and new
files. Two confirmed P2 findings were repaired and rechecked: locale/visible FAQ
versus JSON-LD disagreement, and initially hidden pages queuing autoplay through
requestAnimationFrame. The final review has no unresolved P0, P1 or P2.

Host verification includes Web 95 focused tests, ESLint/TypeScript/production
build, affected Backend and Agent tests, 42 browser-extension tests, 14 Hybrid
presentation tests, Swift syntax parsing of 60 changed files, iOS localization,
brand, documentation, Wiki and architecture checks. Counts across overlapping
runs are not added. CI and real deployment state are independently verified by
the delivery owner; builds and source edits alone do not prove installed-client
upgrades or public availability.

Native and Docker builds have not been started locally: the storage guard
reports 78 GiB free, below its 80 GiB heavy-build threshold. Other tasks' files,
shared devices and running services were preserved. The published macOS package
still uses the legacy name; download copy explicitly distinguishes it from this
new website display brand.
