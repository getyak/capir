/**
 * Real-transport regression for the private one-use handoff POSTs.
 *
 * The owned runner request helpers drive Playwright's actual API request
 * transport against a loopback server that records the wire headers and
 * bodies: the test-run POST must carry the exact configured Origin plus the
 * nonsecret expected run id (never the secret in a URL), while the frozen
 * legacy sandbox POST keeps its original shape. Redirects are refused.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, describe, it } from "node:test";

import { request } from "playwright";

import {
  postSandboxHandoff,
  postTestHandoff,
  SANDBOX_HANDOFF_PATH,
  TEST_ENTRY_EXCHANGE_PATH,
} from "../dist/browser-runner.js";

const WEB_ORIGIN_CANDIDATE = "http://127.0.0.1";
const SECRET = "h".repeat(43);
const RUN_ID = "11111111-1111-4111-8111-111111111111";

async function startRecordingServer(behaviour = "accept") {
  const records = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      records.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      if (behaviour === "redirect") {
        response.writeHead(302, { location: "https://evil.example.test/steal" });
        response.end();
        return;
      }
      response.writeHead(303, { location: "/workspace" });
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    records,
    origin: `${WEB_ORIGIN_CANDIDATE}:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const contexts = [];
after(async () => {
  for (const context of contexts) await context.dispose();
});

async function apiContext() {
  const context = await request.newContext();
  contexts.push(context);
  return context;
}

describe("owned runner handoff POST transport", () => {
  it("sends the exact Origin and nonsecret run id on the private test POST", async () => {
    const server = await startRecordingServer();
    const api = await apiContext();
    try {
      const result = await postTestHandoff(api, {
        exchangeUrl: `${server.origin}${TEST_ENTRY_EXCHANGE_PATH}`,
        origin: server.origin,
        handoffSecret: SECRET,
        runId: RUN_ID,
      });
      assert.equal(result.accepted, true);
      assert.equal(result.status, 303);
      assert.equal(result.location, "/workspace");
      assert.equal(server.records.length, 1);
      const record = server.records[0];
      assert.equal(record.url, TEST_ENTRY_EXCHANGE_PATH, "the secret never appears in a URL");
      assert.ok(!record.url.includes(SECRET));
      assert.equal(record.headers.origin, server.origin, "the exact configured Origin is sent");
      assert.equal(record.headers["content-type"], "application/json");
      const body = JSON.parse(record.body);
      assert.equal(body.handoff_secret, SECRET);
      assert.equal(body.run_id, RUN_ID, "the nonsecret expected run id travels in the body");
    } finally {
      await server.close();
    }
  });

  it("never follows a redirect on the private POST", async () => {
    const server = await startRecordingServer("redirect");
    const api = await apiContext();
    try {
      const result = await postTestHandoff(api, {
        exchangeUrl: `${server.origin}${TEST_ENTRY_EXCHANGE_PATH}`,
        origin: server.origin,
        handoffSecret: SECRET,
        runId: RUN_ID,
      });
      assert.equal(result.accepted, false, "a redirect is never an accepted exchange");
      assert.equal(result.status, 302);
    } finally {
      await server.close();
    }
  });

  it("keeps the frozen legacy sandbox POST shape unchanged", async () => {
    const server = await startRecordingServer();
    const api = await apiContext();
    try {
      const result = await postSandboxHandoff(api, {
        exchangeUrl: `${server.origin}${SANDBOX_HANDOFF_PATH}`,
        handoffSecret: SECRET,
      });
      assert.equal(result.accepted, true);
      const record = server.records[0];
      assert.equal(record.url, SANDBOX_HANDOFF_PATH);
      assert.equal(record.headers.origin, undefined, "the legacy POST sends no Origin header");
      assert.deepEqual(JSON.parse(record.body), { handoff_secret: SECRET });
    } finally {
      await server.close();
    }
  });
});
