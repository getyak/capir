// Include the macOS publishing policy in the existing repository CI test gate.
import "../macos/release-policy.test.cjs";

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const workflow = readFileSync(new URL("../../.github/workflows/release-macos.yml", import.meta.url), "utf8");

test("macOS packages and publishes from the shared product version", () => {
  assert.ok(workflow.indexOf("Resolve shared product version") <
    workflow.indexOf("Package Universal app"));
  assert.match(workflow, /\.\/scripts\/ci\/product-release-version\.sh/);
  assert.match(workflow, /MACOS_VERSION=%s\\nRELEASE_TAG=%s/);
  assert.match(workflow, /scripts\/macos\/publish-versioned-release\.sh/);
  assert.doesNotMatch(workflow, /RELEASE_TAG: macos-\$\{\{/);
});
