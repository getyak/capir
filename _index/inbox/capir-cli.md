# capir CLI capture

Raw intake for the capir CLI reference page ([[capir-cli]]).

Source of the claim set:

- approved design `docs/superpowers/specs/2026-10-04-capir-test-create-design.md`
  (command surface, credentials, output rules);
- implementation plan `docs/superpowers/plans/2026-10-04-capir-test-create.md`
  Task 2 (help, CLI and Web entry);
- built CLI offline help (`capir help test create`) as the executable source of
  argument schemas, defaults and error codes.

Editorial notes kept with the capture:

- the page documents the recurring command surface only; operational
  procedures stay in `docs/operations/account-access.md` (one home per claim);
- no dated proof output, receipt dumps or staging addresses belong on the
  page; sanitized evidence lives under ignored `output/evaluation/`;
- the offline-help and `--json` compatibility claims are verified by the CLI
  test suites (`apps/cli/test/test-help.test.mjs`, `test-create.test.mjs`).
