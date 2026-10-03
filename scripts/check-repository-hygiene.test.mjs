import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkHygiene, trackedFiles } from "./check-repository-hygiene.mjs";

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
    assert.deepEqual(checkHygiene(trackedFiles()), []);
  });
});
