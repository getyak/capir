import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { failureEnvelope } from "../dist/output.js";
import { runCliBin, startStubBackend, token43, writeEnvironment } from "./helpers.mjs";

async function withError(error, check, status = 401) {
  const directory = mkdtempSync(join(tmpdir(), "capir-error-envelope-"));
  const stub = await startStubBackend(() => ({ status, json: { error } }));
  try {
    writeEnvironment(directory, "test", stub.origin, "http://127.0.0.1:3999");
    await check((extra = []) => runCliBin(["auth", "status", "--env", "test", ...extra], {
      CAPIR_CONFIG_DIR: directory,
      CAPIR_TOKEN: token43("k"),
    }));
  } finally {
    await stub.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("backend error codes cannot echo credentials in JSON or human output", async () => {
  for (const code of [token43("k"), `CAPIR_${"A".repeat(43)}`]) {
    await withError({ code, message: "Synthetic denial" }, async (invoke) => {
      for (const extra of [[], ["--human"]]) {
        const result = await invoke(extra);
        assert.equal(result.code, 4);
        assert.ok(!result.stdout.includes(code));
        assert.ok(!result.stderr.includes(code));
        if (!extra.length) assert.equal(JSON.parse(result.stdout).error.code, "HTTP_401");
      }
    });
  }
});

test("malformed backend error codes retain one stable JSON error envelope", async () => {
  for (const code of [{ credential: token43("k") }, [token43("k")], 42, null]) {
    await withError({ code, message: "Synthetic denial" }, async (invoke) => {
      const result = await invoke();
      assert.equal(result.code, 4);
      const envelope = JSON.parse(result.stdout);
      assert.equal(envelope.schema_version, "capir.v1");
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, "HTTP_401");
      assert.ok(!result.stdout.includes(token43("k")));
      assert.ok(!result.stderr.includes(token43("k")));
    });
  }
});

test("malformed backend messages do not crash the real CLI renderer", async () => {
  for (const message of [{ credential: token43("k") }, [token43("k")], 42, null]) {
    await withError({ code: "CAPIR_AUTH_DENIED", message }, async (invoke) => {
      const result = await invoke();
      assert.equal(result.code, 4);
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout);
      assert.equal(envelope.error.code, "CAPIR_AUTH_DENIED");
      assert.equal(envelope.error.message, "The capir backend returned HTTP 401.");
    });
  }
});

test("HTTP status preserves auth and capacity exits when error fields are absent", async () => {
  for (const [status, exit] of [[401, 4], [403, 4], [429, 5], [503, 3]]) {
    await withError(null, async (invoke) => {
      const result = await invoke();
      assert.equal(result.code, exit);
      assert.equal(JSON.parse(result.stdout).error.code, `HTTP_${status}`);
    }, status);
  }
});

test("the final failure envelope also redacts token-shaped error codes", () => {
  const canary = token43("k");
  const result = failureEnvelope("auth status", { code: canary, message: "Synthetic denial" });
  assert.equal(result.error.code, "[REDACTED]");
  assert.ok(!JSON.stringify(result).includes(canary));
});
