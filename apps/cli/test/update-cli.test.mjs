/**
 * Real CLI subprocess tests for the standalone update family: offline help,
 * version and doctor surfaces, stdout/stderr purity, coherent unmanaged
 * errors, and update-keyword routing before model parsing. Nothing here
 * touches the network.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { readVersion } from "../dist/version.js";
import { runCliBin } from "./helpers.mjs";

const directories = [];
function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "capir-update-cli-"));
  directories.push(directory);
  return directory;
}
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function isolatedEnv() {
  const config = scratch();
  return { CAPIR_CONFIG_DIR: config, config };
}

describe("built CLI subprocess: offline update surfaces", () => {
  it("renders readable update help offline with empty stderr", async () => {
    const result = await runCliBin(["update", "--help"]);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /capir update - check, install and roll back managed standalone releases/);
    assert.match(result.stdout, /capir update --check/);
    assert.match(result.stdout, /CAPIR_UPDATE_UNMANAGED/);
    assert.match(result.stdout, /Windows is source-install only/);
    assert.match(result.stdout, /CAPIR_DISABLE_UPDATE_CHECK=1/);
  });

  it("renders the stable update help schema with --json", async () => {
    const result = await runCliBin(["help", "update", "--json"]);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, "help");
    assert.equal(envelope.help.path, "update");
    assert.deepEqual(envelope.help.install.supported_platforms, [
      "darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64",
    ]);
    assert.match(envelope.help.install.bootstrap_url, /getyak\/capir\/releases\/download\/capir-stable\/install\.sh$/);
    for (const entry of envelope.help.error_codes) {
      assert.equal(typeof entry.code, "string");
      assert.equal(typeof entry.exit_code, "number");
    }
    assert.deepEqual(envelope.help.paths, ["update", "update --check", "update --rollback"]);
  });

  it("keeps --version and doctor offline and stderr-clean", async () => {
    const { CAPIR_CONFIG_DIR } = isolatedEnv();
    const version = await runCliBin(["--version"], { CAPIR_CONFIG_DIR });
    assert.equal(version.code, 0);
    assert.equal(version.stderr, "");
    assert.equal(JSON.parse(version.stdout).version, readVersion());

    // doctor is offline by contract: it reports network as not_checked and
    // never opens a socket; without a configured model it fails coherently.
    const doctor = await runCliBin(["doctor", "--json"], { CAPIR_CONFIG_DIR });
    assert.equal(doctor.stderr, "");
    const payload = JSON.parse(doctor.stdout);
    assert.equal(payload.command, "doctor");
    assert.equal(payload.checks.network, "not_checked");
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "CAPIR_MODEL_SETUP");
    assert.equal(doctor.code, 2);
  });

  it("refuses unmanaged updates with exact safe guidance and writes nothing", async () => {
    const { CAPIR_CONFIG_DIR } = isolatedEnv();
    const installRoot = scratch();
    const result = await runCliBin(["update", "--json"], {
      CAPIR_CONFIG_DIR,
      CAPIR_INSTALL_DIR: installRoot,
    });
    assert.equal(result.code, 3);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "CAPIR_UPDATE_UNMANAGED");
    assert.match(payload.error.message, /curl -fsSL https:\/\/github\.com\/getyak\/capir\/releases\/download\/capir-stable\/install\.sh/);
    assert.match(payload.error.message, /never modifies source checkouts or package-manager files/);
    assert.equal(readdirSync(installRoot).length, 0);
    assert.equal(existsSync(join(CAPIR_CONFIG_DIR, "operations.json")), false);
  });

  it("routes update keywords before model parsing and keeps errors coherent", async () => {
    const { CAPIR_CONFIG_DIR } = isolatedEnv();
    // Extra positionals are an update-family error, never a model prompt.
    const positional = await runCliBin(["update", "bogus", "--json"], { CAPIR_CONFIG_DIR });
    assert.equal(positional.code, 2);
    const positionalPayload = JSON.parse(positional.stdout);
    assert.equal(positionalPayload.error.code, "CAPIR_CLI_INVALID_ARGUMENT");
    assert.equal(positionalPayload.command, "update");

    // Flag-first forms reach the update family too (no model sees them).
    const routed = await runCliBin(["--json", "update", "--rollback"], { CAPIR_CONFIG_DIR });
    assert.equal(routed.code, 3);
    const routedPayload = JSON.parse(routed.stdout);
    assert.equal(routedPayload.error.code, "CAPIR_UPDATE_UNMANAGED");
    assert.equal(routedPayload.command, "update --rollback");

    // --check and --rollback are mutually exclusive.
    const conflict = await runCliBin(["update", "--check", "--rollback", "--json"], { CAPIR_CONFIG_DIR });
    assert.equal(conflict.code, 2);
    assert.equal(JSON.parse(conflict.stdout).error.code, "CAPIR_CLI_INVALID_ARGUMENT");

    // Unknown flags fail before any side effect.
    const unknown = await runCliBin(["update", "--bogus"], { CAPIR_CONFIG_DIR });
    assert.equal(unknown.code, 2);
    assert.match(unknown.stdout, /CAPIR_CLI_UNKNOWN_FLAG/);
  });

  it("prints one human-readable error block by default for unmanaged updates", async () => {
    const { CAPIR_CONFIG_DIR } = isolatedEnv();
    const result = await runCliBin(["update"], { CAPIR_CONFIG_DIR });
    assert.equal(result.code, 3);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^error CAPIR_UPDATE_UNMANAGED: /);
    assert.match(result.stdout, /Install a managed standalone copy instead:/);
    // The --check JSON envelope shape is covered with fixture transports in
    // update.test.mjs; subprocess runs stay strictly offline.
  });
});
