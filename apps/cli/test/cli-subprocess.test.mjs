/**
 * Real built-CLI subprocess tests: stdout JSON envelopes, strict arguments,
 * credential redaction, unsupported-before-allocation, and browser launch
 * failure preserving the ready run.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import {
  capabilitiesResponse,
  runCliBin,
  sandboxResponse,
  startStubBackend,
  token43,
  writeEnvironment,
} from "./helpers.mjs";

const directories = [];
function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "capir-cli-test-"));
  directories.push(directory);
  return directory;
}
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe("built CLI subprocess", () => {
  it("prints one parseable capir.v1 JSON document on stdout for machine help", async () => {
    // The intentional readable-help default keeps its machine compatibility
    // path: existing JSON callers pass --json explicitly.
    const result = await runCliBin(["--help", "--json"]);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout); // real subprocess JSON.parse
    assert.equal(envelope.schema_version, "capir.v1");
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, "help");
    assert.ok(envelope.usage.summary.length > 0);
  });

  it("rejects unknown flags before any side effect", async () => {
    const directory = scratch();
    const result = await runCliBin(["sandbox", "start", "--env", "t", "--bogus"], {
      CAPIR_CONFIG_DIR: directory,
      CAPIR_TOKEN: token43(),
    });
    assert.equal(result.code, 2);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "CAPIR_CLI_UNKNOWN_FLAG");
    // Nothing may have been journaled or dispatched by a rejected invocation.
    assert.equal(existsSync(join(directory, "operations.json")), false);
  });

  it("rejects missing and invalid environments", async () => {
    const directory = scratch();
    const missing = await runCliBin(["auth", "status", "--env", "nope"], {
      CAPIR_CONFIG_DIR: directory,
    });
    assert.equal(missing.code, 2);
    assert.equal(JSON.parse(missing.stdout).error.code, "CAPIR_ENVIRONMENT_MISSING");

    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(directory, "environments.json"),
      JSON.stringify({
        environments: {
          bad: {
            backend_origin: "http://example.com:4317/path",
            web_origin: "https://example.com",
          },
        },
      }),
    );
    const invalid = await runCliBin(["auth", "status", "--env", "bad"], {
      CAPIR_CONFIG_DIR: directory,
    });
    assert.equal(invalid.code, 2);
    assert.equal(JSON.parse(invalid.stdout).error.code, "CAPIR_ENVIRONMENT_INVALID");
  });

  it("redacts tokens from stdout and backend error messages", async () => {
    const directory = scratch();
    const token = token43("k");
    const stub = await startStubBackend(({ path }) => {
      if (path === "/v1/capir/auth/status") {
        return {
          status: 401,
          json: {
            error: {
              code: "CAPIR_AUTH_DENIED",
              message: `token ${token} is revoked`,
              request_id: "r",
            },
          },
        };
      }
      return { status: 404, json: { error: { code: "NO", message: "no", request_id: "r" } } };
    });
    writeEnvironment(directory, "t", stub.origin, "http://127.0.0.1:3999");
    const result = await runCliBin(["auth", "status", "--env", "t"], {
      CAPIR_CONFIG_DIR: directory,
      CAPIR_TOKEN: token,
    });
    await stub.close();
    assert.equal(result.code, 4);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, "CAPIR_AUTH_DENIED");
    assert.ok(!result.stdout.includes(token), "stdout must not contain the token");
    assert.ok(result.stdout.includes("[REDACTED]"), "redaction must be visible");
    assert.ok(!result.stderr.includes(token), "stderr must not contain the token");
  });

  it("redacts legal base64url boundary canaries from the failure envelope and preserves digests", async () => {
    const directory = scratch();
    const digest = "a".repeat(64); // public scenario digest, must survive
    for (const canary of [token43("-"), token43("_"), `-${token43("x").slice(1)}`, `${token43("y").slice(0, 42)}-`]) {
      const stub = await startStubBackend(({ path }) => {
        if (path === "/v1/capir/auth/status") {
          return {
            status: 401,
            json: {
              error: {
                code: "CAPIR_AUTH_DENIED",
                message: `token ${canary} is revoked for digest ${digest}`,
                request_id: "r",
              },
            },
          };
        }
        return { status: 404, json: { error: { code: "NO", message: "no", request_id: "r" } } };
      });
      writeEnvironment(directory, "t", stub.origin, "http://127.0.0.1:3999");
      const result = await runCliBin(["auth", "status", "--env", "t"], {
        CAPIR_CONFIG_DIR: directory,
        CAPIR_TOKEN: canary,
      });
      await stub.close();
      assert.equal(result.code, 4);
      const envelope = JSON.parse(result.stdout); // actual failure envelope
      assert.equal(envelope.error.code, "CAPIR_AUTH_DENIED");
      assert.ok(!result.stdout.includes(canary), `stdout leaked ${JSON.stringify(canary.slice(0, 6))}…`);
      assert.ok(!result.stderr.includes(canary), "stderr must not contain the canary");
      assert.ok(envelope.error.message.includes("[REDACTED]"));
      assert.ok(envelope.error.message.includes(digest), "public scenario digests survive redaction");
    }
  });

  it("rejects unsupported clients before creating anything", async () => {
    const directory = scratch();
    const stub = await startStubBackend(() => ({
      status: 200,
      json: capabilitiesResponse("http://127.0.0.1:4317", "http://127.0.0.1:3999"),
    }));
    writeEnvironment(directory, "t", stub.origin, "http://127.0.0.1:3999");
    for (const args of [
      ["sandbox", "start", "--env", "t", "--surface", "native"],
      ["sandbox", "start", "--env", "t", "--model-policy", "live"],
      ["sandbox", "start", "--env", "t", "--model-policy", "record"],
      ["sandbox", "start", "--env", "t", "--scenario", "weekly"],
    ]) {
      const result = await runCliBin(args, {
        CAPIR_CONFIG_DIR: directory,
        CAPIR_TOKEN: token43(),
      });
      assert.equal(result.code, 3, args.join(" "));
      assert.equal(JSON.parse(result.stdout).error.code, "CAPIR_UNSUPPORTED");
    }
    assert.equal(
      stub.calls.length,
      0,
      "no request may reach the backend before an unsupported request is rejected",
    );
    await stub.close();
  });

  it("preserves the ready run when the sandbox entry browser fails to launch", async () => {
    const directory = scratch();
    const webOrigin = "http://127.0.0.1:3999";
    const stub = await startStubBackend(({ method, path }) => {
      if (path === "/v1/capir/capabilities") {
        return { status: 200, json: capabilitiesResponse(stub.origin, webOrigin) };
      }
      if (method === "POST" && path === "/v1/capir/sandboxes") {
        return { status: 200, json: sandboxResponse({ state: "ready" }) };
      }
      if (method === "POST" && path.endsWith("/handoffs")) {
        return {
          status: 200,
          json: {
            schema_version: "capir.v1",
            handoff_secret: token43("h"),
            expires_at: "2026-10-01T12:00:00.000Z",
            entry_path: "/capir/sandboxes/test",
          },
        };
      }
      return { status: 404, json: { error: { code: "NO", message: "no", request_id: "r" } } };
    });
    writeEnvironment(directory, "t", stub.origin, webOrigin);
    const result = await runCliBin(["sandbox", "start", "--env", "t", "--open", "web"], {
      CAPIR_CONFIG_DIR: directory,
      CAPIR_TOKEN: token43(),
      // Force a real Playwright launch failure in the owned runner child.
      PLAYWRIGHT_BROWSERS_PATH: join(directory, "no-such-browser-registry"),
    });
    await stub.close();
    assert.equal(result.code, 3, result.stdout + result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "CAPIR_BROWSER_LAUNCH_FAILED");
    // The ready run and the client state survive the browser failure.
    assert.equal(envelope.run.sandbox.state, "ready");
    assert.ok(envelope.run.request_id);
    assert.equal(envelope.client_state.kind, "sandbox.handoff");
    assert.ok(envelope.client_state.request_id);
    assert.equal(envelope.browser.launched, false);
  });

  it("fails closed when the configured backend is unreachable", async () => {
    const directory = scratch();
    const webOrigin = "http://127.0.0.1:3999";
    const stub = await startStubBackend(({ path }) => ({
      status: 200,
      json: capabilitiesResponse(stub.origin, webOrigin),
    }));
    writeEnvironment(directory, "t", stub.origin, webOrigin);
    await stub.close();
    const result = await runCliBin(["sandbox", "start", "--env", "t"], {
      CAPIR_CONFIG_DIR: directory,
      CAPIR_TOKEN: token43(),
    });
    assert.equal(result.code, 3);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, "CAPIR_TRANSPORT");
  });
});

it("the advertised source wrapper reaches the built browser runner with a stub sandbox", async () => {
  const directory = scratch();
  const webOrigin = "http://127.0.0.1:3999";
  const stub = await startStubBackend(({ method, path }) => {
    if (path === "/v1/capir/capabilities")
      return { status: 200, json: capabilitiesResponse(stub.origin, webOrigin) };
    if (method === "POST" && path === "/v1/capir/sandboxes")
      return { status: 200, json: sandboxResponse({ state: "ready" }) };
    if (method === "POST" && path.endsWith("/handoffs"))
      return { status: 200, json: { schema_version: "capir.v1", handoff_secret: token43("h"),
        expires_at: "2026-10-01T12:00:00.000Z", entry_path: "/capir/sandboxes/test" } };
    return { status: 404, json: { error: { code: "NO", message: "no", request_id: "r" } } };
  });
  writeEnvironment(directory, "t", stub.origin, webOrigin);
  try {
    const child = spawn("pnpm", ["capir", "--", "sandbox", "start", "--env", "t", "--open", "web"], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CAPIR_CONFIG_DIR: directory,
        CAPIR_TOKEN: token43(), PLAYWRIGHT_BROWSERS_PATH: join(directory, "no-browser") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve) => child.on("close", resolve));
    const jsonLine = stdout.split("\n").find((line) => line.startsWith('{"schema_version":"capir.v1"'));
    assert.ok(jsonLine, stdout + stderr);
    const envelope = JSON.parse(jsonLine);
    assert.equal(code, 3, stdout + stderr);
    assert.equal(envelope.error.code, "CAPIR_BROWSER_LAUNCH_FAILED");
    assert.equal(envelope.run.sandbox.state, "ready");
  } finally { await stub.close(); }
});
