import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// A fresh process exercises the real contracts -> CLI formats import order.
// Help exits before configuration, credentials, browser or backend access.
test("cold CLI startup after importing the contracts client does not double-register formats", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/cli.js", import.meta.url)), "--help"], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /DuplicateFormat|duplicate format/i);
  assert.match(result.stdout, /capir/);
});
