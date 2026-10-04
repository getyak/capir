/**
 * Offline help contract for the `capir test` family.
 *
 * Help must be readable by default, machine-stable under `--json`, and side
 * effect free: no environment resolution, no stdin read, no keyring access, no
 * network call, no operation journal — even when hostile-looking flags
 * (secret values, password-stdin, unknown request ids) are present.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { CLI_PATH, runCliBin } from "./helpers.mjs";
import { renderTestHelp } from "../dist/testHelp.js";

const directories = [];
function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "capir-test-help-"));
  directories.push(directory);
  return directory;
}
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

/** Built-CLI run whose stdin stays OPEN: a stdin read hangs until the deadline. */
function runWithOpenStdin(args, env = {}, deadlineMs = 8000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdin.write("stdin-secret-value\n"); // written but never ended
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: "TIMEOUT", stdout, stderr, hung: true });
    }, deadlineMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, hung: false });
    });
  });
}

const FAMILY_NEEDLES = ["capir test create", "capir test create --env", "4h", "daily"];
const CREATE_NEEDLES = ["--preset", "--expires-in", "capir test create --env", "4h", "daily"];
const STATUS_NEEDLES = ["capir test status <run-id> --env", "never reveals a password"];
const STOP_NEEDLES = ["capir test stop <run-id> --env", "revoked before cleanup"];

const READABLE_CASES = [
  { argv: ["help"], needles: FAMILY_NEEDLES },
  { argv: ["help", "test"], needles: FAMILY_NEEDLES },
  { argv: ["help", "test", "create"], needles: CREATE_NEEDLES },
  { argv: ["help", "test", "status"], needles: STATUS_NEEDLES },
  { argv: ["help", "test", "stop"], needles: STOP_NEEDLES },
  { argv: ["test", "--help"], needles: FAMILY_NEEDLES },
  { argv: ["test", "create", "--help"], needles: CREATE_NEEDLES },
  { argv: ["test", "status", "--help"], needles: STATUS_NEEDLES },
  { argv: ["test", "stop", "--help"], needles: STOP_NEEDLES },
];

describe("offline readable help", () => {
  for (const { argv, needles } of READABLE_CASES) {
    it(`renders readable help for "capir ${argv.join(" ")}"`, async () => {
      const directory = scratch();
      const result = await runCliBin(argv, {
        CAPIR_CONFIG_DIR: join(directory, "missing-config"),
        CAPIR_TEST_OPERATOR_TOKEN: "operator-token-value-for-help-must-not-appear",
        CAPIR_TOKEN: "human-token-value-for-help-must-not-appear",
      });
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.ok(!result.stdout.trim().startsWith("{"), "plain help is readable text, not a JSON envelope");
      for (const needle of needles) {
        assert.ok(result.stdout.includes(needle), `help must mention ${needle}`);
      }
      // Nothing was allocated, journaled or configured by help.
      assert.ok(!existsSync(join(directory, "missing-config", "operations.json")));
      assert.ok(!result.stdout.includes("operator-token-value"));
      assert.ok(!result.stdout.includes("human-token-value"));
    });
  }

  it("never resolves an environment, reads stdin, touches the keyring or journals on help", async () => {
    const directory = scratch();
    const config = join(directory, "config");
    const keyringFile = join(directory, "keyring.json");
    const result = await runWithOpenStdin(
      [
        "help",
        "test",
        "create",
        "--env",
        "does-not-exist",
        "--password-stdin",
        "--password",
        "chosen-supplied-secret-9",
        "--username",
        "ghost",
        "--request-id",
        "not-a-uuid",
        "--expires-in",
        "99h",
        "--preset",
        "bogus",
      ],
      {
        CAPIR_CONFIG_DIR: config,
        FAKE_KEYRING_FILE: keyringFile,
        NODE_OPTIONS: `--import ${join(import.meta.dirname, "fake-keyring-preload.mjs")}`,
      },
    );
    assert.notEqual(result.code, "TIMEOUT", "help must not block on password stdin");
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes("capir test create"));
    assert.ok(!result.stdout.includes("chosen-supplied-secret-9"), "help never echoes a supplied password");
    assert.ok(!result.stdout.includes("stdin-secret-value"), "help never echoes stdin content");
    assert.ok(!result.hung);
    // No keyring entry, no journal, no environment file was created or read.
    assert.equal(existsSync(keyringFile), false);
    assert.ok(!existsSync(join(config, "operations.json")));
  });

  it("keeps the machine help schema stable and complete under --json", async () => {
    const directory = scratch();
    const run = async () => {
      const result = await runCliBin(["help", "test", "create", "--json"], {
        CAPIR_CONFIG_DIR: join(directory, "missing-config"),
      });
      assert.equal(result.code, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const first = await run();
    const second = await run();
    assert.deepEqual(first, second, "machine help is deterministic");
    assert.equal(first.schema_version, "capir.v1");
    assert.equal(first.ok, true);
    assert.equal(first.command, "help");
    assert.equal(first.help.path, "test create");
    assert.ok(typeof first.help.summary === "string" && first.help.summary.length > 0);

    const argumentsByName = new Map(first.help.arguments.map((entry) => [entry.name, entry]));
    const env = argumentsByName.get("--env");
    assert.equal(env.required, true);
    assert.equal(argumentsByName.get("--password").exclusive_with.includes("--password-stdin"), true);
    assert.equal(argumentsByName.get("--password-stdin").exclusive_with.includes("--password"), true);
    assert.equal(argumentsByName.get("--username").required, false);
    assert.equal(argumentsByName.get("--expires-in").default, "4h");
    assert.deepEqual([...argumentsByName.get("--expires-in").values].sort(), ["1d", "1h", "24h", "4h"]);
    assert.equal(argumentsByName.get("--preset").default, "daily");
    assert.deepEqual([...argumentsByName.get("--preset").values].sort(), ["daily", "empty"]);
    assert.equal(argumentsByName.get("--request-id").required, false);

    assert.equal(first.help.defaults.preset, "daily");
    assert.equal(first.help.defaults.expires_in, "4h");
    assert.deepEqual(first.help.defaults.preset_counts, {
      contacts: 12,
      observations: 30,
      tasks: 4,
    });
    assert.ok(first.help.examples.length >= 3);
    for (const example of first.help.examples) {
      assert.ok(Array.isArray(example.argv) && example.argv[0] === "capir");
    }
    assert.ok(first.help.errors.length >= 3);
    for (const error of first.help.errors) {
      assert.equal(typeof error.code, "string");
      assert.equal(typeof error.exit_code, "number");
      assert.equal(typeof error.meaning, "string");
    }
    assert.deepEqual(first.help.next_steps, [
      "capir test status <run-id> --env <name>",
      "capir test stop <run-id> --env <name>",
    ]);
  });

  it("documents every test path and the --json compatibility path in the global machine help", async () => {
    const result = await runCliBin(["--help", "--json"], {});
    assert.equal(result.code, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.schema_version, "capir.v1");
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, "help");
    assert.ok(envelope.usage.summary.length > 0);
    const paths = envelope.help_paths ?? envelope.usage.help_paths;
    for (const path of ["test", "test create", "test status", "test stop"]) {
      assert.ok(paths.includes(path), `global help must route to ${path}`);
    }
  });

  it("machine help for status and stop documents the run-id target and read-only semantics", async () => {
    for (const [path, argv] of [
      ["test status", ["help", "test", "status", "--json"]],
      ["test stop", ["help", "test", "stop", "--json"]],
    ]) {
      const result = await runCliBin(argv, {});
      assert.equal(result.code, 0, result.stderr);
      const envelope = JSON.parse(result.stdout);
      assert.equal(envelope.help.path, path);
      const target = envelope.help.arguments.find((entry) => entry.name === "<run-id>");
      assert.ok(target, "the positional run id is documented");
      assert.equal(target.required, true);
    }
    const stop = JSON.parse((await runCliBin(["help", "test", "stop", "--json"], {})).stdout);
    assert.ok(stop.help.arguments.some((entry) => entry.name === "--request-id"));
  });

  it("renderTestHelp is offline and covers the whole test family", () => {
    for (const path of ["test", "test create", "test status", "test stop"]) {
      const human = renderTestHelp(path, "human");
      assert.equal(typeof human, "string");
      assert.ok(human.includes("capir test"));
      const json = renderTestHelp(path, "json");
      const parsed = JSON.parse(json);
      assert.equal(parsed.path, path);
    }
    assert.throws(() => renderTestHelp("test bogus", "human"), /help path/i);
  });
});
