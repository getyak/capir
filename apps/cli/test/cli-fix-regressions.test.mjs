import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

import { CapirBackendClient } from "../dist/http.js";
import { OperationJournal } from "../dist/journal.js";
import { browserRunnerEntry, runnerHeadless } from "../dist/runner.js";
import { runCli } from "../dist/run.js";
import { capabilitiesResponse, sandboxResponse, token43, uuid, writeEnvironment } from "./helpers.mjs";

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

it("rejects secret-bearing cross-origin redirects before sending the body", async () => {
  let received = 0;
  const target = await listen((_req, res) => { received++; res.end("received"); });
  const source = await listen((_req, res) => {
    res.writeHead(307, { location: `${target.origin}/collector` }); res.end();
  });
  try {
    const client = new CapirBackendClient(source.origin, fetch, token43("s"));
    await assert.rejects(client.exchange({ code: token43("c"), code_verifier: token43("v"),
      state: token43("a"), redirect_uri: "http://127.0.0.1:1234/capir/callback",
      web_origin: "http://127.0.0.1:3000", backend_origin: source.origin }),
    (error) => error.code === "CAPIR_TRANSPORT");
    assert.equal(received, 0);
  } finally {
    source.server.close(); target.server.close();
  }
});

it("preserves the request ID when a post-dispatch response body breaks", async () => {
  const directory = mkdtempSync(join(tmpdir(), "capir-body-break-"));
  const backendOrigin = "http://127.0.0.1:4317", webOrigin = "http://127.0.0.1:3000";
  writeEnvironment(directory, "test", backendOrigin, webOrigin);
  const requestId = uuid();
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith("/capabilities"))
      return Response.json(capabilitiesResponse(backendOrigin, webOrigin));
    assert.equal(init.redirect, "error");
    return new Response(new ReadableStream({ start(controller) {
      controller.error(new Error("connection broke after headers"));
    } }));
  };
  try {
    const result = await runCli(["sandbox", "start", "--env", "test", "--request-id", requestId], {
      env: { CAPIR_CONFIG_DIR: directory }, fetchImpl,
      credentialStore: () => ({ kind: "environment", get: async () => token43(),
        set: async () => {}, delete: async () => false }),
      openBrowser: async () => {}, interactive: false, sleep: async () => {},
      journal: new OperationJournal(directory),
    });
    const envelope = JSON.parse(result.output);
    assert.equal(envelope.error.code, "CAPIR_TRANSPORT_AMBIGUOUS");
    assert.equal(envelope.error.recoverable_request_id, requestId);
    assert.equal(envelope.client_state.journal_status, "ambiguous");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("always reads stop state independently, even after a terminal POST and wait zero", async () => {
  const directory = mkdtempSync(join(tmpdir(), "capir-stop-read-"));
  const id = uuid();
  writeEnvironment(directory, "test", "http://127.0.0.1:4317", "http://127.0.0.1:3000");
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init.method);
    return Response.json(sandboxResponse({ id, state: init.method === "POST" ? "deleted" : "deleting" }));
  };
  try {
    const result = await runCli(["sandbox", "stop", id, "--env", "test", "--wait", "0"], {
      env: { CAPIR_CONFIG_DIR: directory }, fetchImpl,
      credentialStore: () => ({ kind: "environment", get: async () => token43(),
        set: async () => {}, delete: async () => false }),
      openBrowser: async () => {}, interactive: false, sleep: async () => {},
      journal: new OperationJournal(directory),
    });
    assert.deepEqual(calls, ["POST", "GET"]);
    assert.equal(result.exitCode, 3);
    assert.equal(JSON.parse(result.output).error.code, "CAPIR_STOP_INCOMPLETE");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("preserves two processes' concurrent operation intents and status updates", async () => {
  const directory = mkdtempSync(join(tmpdir(), "capir-journal-parallel-"));
  const moduleUrl = new URL("../dist/journal.js", import.meta.url).href;
  const run = (prefix) => new Promise((resolve, reject) => {
    const code = `import {OperationJournal} from ${JSON.stringify(moduleUrl)};
      const j=new OperationJournal(${JSON.stringify(directory)});
      for(let i=0;i<30;i++){ const id=${JSON.stringify(prefix)}+i;
        j.ensureIntent({request_id:id,kind:'sandbox.start',environment:'t',backend_origin:'http://127.0.0.1:4317',web_origin:'http://127.0.0.1:3000',digest:id});
        j.updateStatus(id,'dispatched'); }
      `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code]);
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => status === 0 ? resolve() : reject(new Error(stderr)));
  });
  try {
    await Promise.all([run("a-"), run("b-")]);
    const entries = new OperationJournal(directory).read();
    assert.equal(entries.length, 60);
    assert.ok(entries.every((entry) => entry.status === "dispatched"));
    assert.equal(new Set(entries.map((entry) => entry.request_id)).size, 60);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("resolves the built runner for source-wrapper use and defaults to a headed browser", async () => {
  assert.ok(browserRunnerEntry().endsWith("/dist/browser-runner.js"));
  const moduleUrl = new URL("../src/runner.ts", import.meta.url).href;
  const child = spawn("pnpm", ["exec", "tsx", "-e",
    `import {browserRunnerEntry} from ${JSON.stringify(moduleUrl)}; console.log(browserRunnerEntry())`]);
  let stdout = "", stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  const status = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(status, 0, stderr);
  assert.ok(stdout.trim().endsWith("/dist/browser-runner.js"));
  const message = { web_origin: "http://127.0.0.1:3000", sandbox_id: randomUUID(),
    entry_path: "/workspace", handoff_secret: token43(), sandbox_expires_at: new Date().toISOString(),
    scenario_id: "daily" };
  assert.equal(runnerHeadless(message), false);
  assert.equal(runnerHeadless({ ...message, test_headless: true }), true);
});
