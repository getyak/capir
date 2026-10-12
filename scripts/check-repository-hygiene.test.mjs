import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkHygiene, checkCorpusContent, checkAdrNumericIds, checkMigrationPrefixes, HISTORICAL_MIGRATION_COLLISIONS, trackedFiles } from "./check-repository-hygiene.mjs";

describe("repository hygiene", () => {
  it("rejects extracted evaluation payload and harness paths but keeps the index", () => {
    const errors = checkHygiene([
      "evals/README.md",
      "evals/v2/fixtures/ts-act-101.r1.json",
      "docs/evaluations/2026-09-04-lab-v2/README.md",
      "apps/eval-runner/src/cli.ts",
      "scripts/evals/validate-candidate-momentum.mjs",
      "apps/browser-extension/tests/fixture-contract.test.mjs",
      "apps/browser-extension/scripts/capture-round-2-evidence.mjs",
      "apps/browser-extension/scripts/compose-round-2-panel.mjs",
      "apps/browser-extension/scripts/verify-round-2.mjs",
    ]);
    assert.equal(errors.length, 8);
    assert.ok(errors.every((error) => /private getyak\/capir-evals repository|forbidden in the product repository/.test(error)));
    assert.deepEqual(checkHygiene(["evals/README.md"]), []);
  });

  it("rejects generated bundles, media, and database artifacts anywhere tracked", () => {
    for (const path of [
      "plans/overnight-proof.zip",
      "screens/recording.mov",
      "output-capture.mp4",
      "local.sqlite",
      "scratch/backup.dump",
      "raw-run.log",
    ]) {
      const errors = checkHygiene([path]);
      assert.equal(errors.length, 1, path);
      assert.match(errors[0], /generated bundle\/media\/database artifact/);
    }
  });

  it("rejects media outside admitted brand, architecture, and product asset roots", () => {
    for (const path of ["plans/panel.png", "_index/notes/shot.jpg", "capture.png", "scripts/diagram.svg", "docs/random-eval.png", "apps/backend/screenshots/capture.png", "packages/evaluation/report.png"]) {
      const errors = checkHygiene([path]);
      assert.equal(errors.length, 1, path);
      assert.match(errors[0], /media file outside admitted/);
    }
  });

  it("rejects tracked files in generated output and build trees", () => {
    for (const path of ["output/evaluation/report.json", "build/x.json", "dist/index.js", "a/node_modules/pkg/index.js", "coverage/lcov.info", "runs/latest.json"]) {
      const errors = checkHygiene([path]);
      assert.equal(errors.length, 1, path);
      assert.match(errors[0], /generated output/);
    }
  });

  it("never rejects architecture images, migration SQL, tests and fixtures, or release source", () => {
    assert.deepEqual(checkHygiene([
      "docs/talent-signal-system-architecture.png",
      "docs/talent-signal-system-architecture.svg",
      "docs/readme/panel.png",
      "brand/png/wordmark.png",
      "brand/preview.svg",
      "assets/app-icon.png",
      "apps/backend/src/database/012_feedback_learning.sql",
      "apps/backend/src/evaluation/labRegressionConsumer.test.ts",
      "apps/web/test/fixtures/diagram.png",
      "packages/evaluation/tests/fixtures/records.zip",
      "scripts/ci/ensure-release-assets.sh",
      "fastlane/Fastfile",
      "apps/ios/Resources/Assets.xcassets/AppIcon.appiconset/icon.png",
      "apps/macos/Resources/DesktopPets/pet.gif",
    ]), []);
  });

  it("passes for the real tracked repository tree", () => {
    const paths = trackedFiles();
    assert.deepEqual(checkHygiene(paths), []);
    assert.deepEqual(checkAdrNumericIds(paths.filter((path) => path.startsWith("docs/decisions/"))), []);
    assert.deepEqual(checkMigrationPrefixes(paths.filter((path) => path.startsWith("apps/backend/src/database/"))), []);
  });
});

describe("stable identifiers", () => {
  it("accepts the grandfathered historical migration collision sets and numbering gaps", () => {
    assert.deepEqual(checkMigrationPrefixes([
      "apps/backend/src/database/001_authority.sql",
      ...HISTORICAL_MIGRATION_COLLISIONS.flat().map((name) => `apps/backend/src/database/${name}`),
      "apps/backend/src/database/086_desktop_browser_login.sql",
      "apps/backend/src/database/088_username_email_alias.sql",
      "apps/backend/src/database/migration-manifest.json",
      "apps/backend/src/database/migrate.ts",
    ]), []);
  });

  it("rejects a new extra member or a reused prefix outside the historical sets", () => {
    const extraMember = checkMigrationPrefixes([
      ...HISTORICAL_MIGRATION_COLLISIONS.flat(),
      "058_product_run_monitoring.sql",
    ]);
    assert.equal(extraMember.length, 1);
    assert.match(extraMember[0], /migration prefix 058 is not a grandfathered historical collision set/);

    const reusedPrefix = checkMigrationPrefixes([
      "020_pursuit_domain.sql",
      "020_pursuit_domain_again.sql",
    ]);
    assert.equal(reusedPrefix.length, 1);
    assert.match(reusedPrefix[0], /migration prefix 020 is not a grandfathered historical collision set/);

    const renamedHistoricalMember = checkMigrationPrefixes([
      "047_proposed_extracted_text.sql",
      "047_renamed_member.sql",
    ]);
    assert.equal(renamedHistoricalMember.length, 1);
    assert.match(renamedHistoricalMember[0], /migration prefix 047/);
  });

  it("rejects colliding ADR numeric ids while dated records stay exempt", () => {
    assert.deepEqual(checkAdrNumericIds([
      "docs/decisions/0017-desktop-maintenance-controls.md",
      "docs/decisions/0024-three-scope-memory-review.md",
      "docs/decisions/2026-09-10-scoped-harness-capabilities.md",
      "docs/decisions/2026-09-24-one-click-desktop-updates.md",
    ]), []);

    const errors = checkAdrNumericIds([
      "docs/decisions/0017-desktop-maintenance-controls.md",
      "docs/decisions/0017-three-scope-memory-review.md",
      "docs/decisions/2026-09-10-scoped-harness-capabilities.md",
    ]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /ADR numeric id 0017 is not unique/);
    assert.match(errors[0], /0017-desktop-maintenance-controls\.md/);
    assert.match(errors[0], /0017-three-scope-memory-review\.md/);
  });
});

// A renamed source file must not bypass the corpus boundary; isolated product
// examples do not become a versioned benchmark simply by sharing one phrase.
it("detects embedded corpus copies while allowing isolated unit data", () => {
  const messages = ["Synthetic benchmark one", "Synthetic benchmark two", "Synthetic benchmark three"];
  const hashes = new Set(messages.map(text => createHash("sha256").update(text).digest("hex")));
  assert.equal(checkCorpusContent(messages.map(text => `text: ${JSON.stringify(text)}`).join(";"), hashes), true);
  assert.equal(checkCorpusContent(`text: ${JSON.stringify(messages[0])}`, hashes), false);
  assert.equal(checkCorpusContent(JSON.stringify({artifact:"screenshot-analysis-gold.v1",cases:[{expected:"oracle"}]})), true);
  assert.equal(checkCorpusContent(JSON.stringify({artifact:"unit-fixture",cases:[{expected:"shape"}]})), false);
});
