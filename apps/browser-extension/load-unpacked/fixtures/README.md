# Optional evaluation fixtures

This directory ships empty in the public product (GET-134). The eight-case
candidate-momentum evaluation corpus has one authoritative private home: the
private `getyak/capir-evals` repository.

Private, disposable evaluation runs may inject the canonical
`evals/candidate-momentum-v1.json` from that repository as
`candidate-momentum-v1.json` in this directory. Until a suite loads
successfully, the review panel stays in live mode and the "Synthetic fixtures"
mode option stays disabled. The panel never fetches remote corpus data.

Generic fixture rendering and the local synthetic submission/transport fixtures
remain public; the corpus itself is not part of this package and is not a
required file for `scripts/validate-package.mjs`.
