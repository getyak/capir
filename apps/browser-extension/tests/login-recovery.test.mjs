import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { contactHandoffInWeb, submitContactTaskInWeb, recoverContactTaskInWeb } from "../load-unpacked/lib/contact-handoff.js";
import { sessionCopy, sessionAfterHandoff, classifyReceiptResponse, classifyTransportError } from "../load-unpacked/lib/handoff-contract.js";
import { submitReviewedCapture, readCaptureReceipt } from "../load-unpacked/lib/handoff-transport.js";

const origin = "http://localhost:3000", session = "original-session";
const task = "10000000-0000-4000-8000-000000000001";
const payload = { idempotency_key: "original-reviewed-request", image: { data_base64: "synthetic-only" } };
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const ready = () => response(200, { status: "ready", session_version: session, contact_agent: true });

async function withWeb(fetcher, run) {
  const saved = { fetch: globalThis.fetch, location: globalThis.location };
  globalThis.fetch = fetcher;
  globalThis.location = { origin, pathname: "/contact-agent" };
  try { return await run(); }
  finally {
    globalThis.fetch = saved.fetch;
    if (saved.location === undefined) delete globalThis.location; else globalThis.location = saved.location;
  }
}

test("only confirmed HTTP401 requests sign-in; other preflight failures preserve the reviewed packet", async () => {
  for (const status of [403, 408, 419, 429, 500, 502, 503, 504]) {
    const calls = [];
    await withWeb(async (url, options) => { calls.push({ url, options }); return response(status, { code: "session_stale", message: "PRIVATE_ERROR" }); }, async () => {
      const result = await submitContactTaskInWeb(origin, session, payload);
      assert.equal(result.no_submit, true);
      assert.equal(result.code, "connection_unavailable", String(status));
      assert.notEqual(result.authentication_required, true);
      assert.doesNotMatch(JSON.stringify(result), /sign in|sign-in|PRIVATE_ERROR/i);
      assert.equal(calls.length, 1);
      assert.equal(payload.idempotency_key, "original-reviewed-request");
    });
  }
  await withWeb(async () => response(401, { code: "session_stale" }), async () => {
    const result = await submitContactTaskInWeb(origin, session, payload);
    assert.equal(result.authentication_required, true);
    assert.equal(result.no_submit, true);
  });
});

test("session binding changes are explicit and do not imply a missing login", async () => {
  let calls = 0;
  await withWeb(async () => { calls++; return response(200, { status: "ready", contact_agent: true, session_version: "replacement" }); }, async () => {
    const result = await submitContactTaskInWeb(origin, session, payload);
    assert.equal(result.code, "session_changed");
    assert.notEqual(result.authentication_required, true);
    assert.equal(result.no_submit, true);
    assert.equal(calls, 1);
  });
});

test("preflight network and malformed replies cannot become confirmed logout", async () => {
  for (const fetcher of [async () => { throw new TypeError("PRIVATE_ERROR"); }, async () => ({ ok: true, status: 200, json: async () => { throw new Error("PRIVATE_ERROR"); } })]) {
    await withWeb(fetcher, async () => {
      const result = await submitContactTaskInWeb(origin, session, payload);
      assert.equal(result.code, "connection_unavailable");
      assert.equal(result.no_submit, true);
      assert.notEqual(result.authentication_required, true);
    });
  }
});

test("POST and receipt failures remain unknown without an automatic second POST", async () => {
  for (const stage of ["post-503", "post-network", "post-json", "read-503", "read-network", "read-json"]) {
    const calls = [];
    await withWeb(async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("session")) return ready();
      const target = options.method === "POST" ? "post" : "read";
      if (stage === target + "-network") throw new TypeError("PRIVATE_ERROR");
      if (stage === target + "-json") return { status: 200, ok: true, json: async () => { throw new Error("PRIVATE_ERROR"); } };
      return response(stage === target + "-503" ? 503 : 201, { task_id: task });
    }, async () => {
      const result = await submitContactTaskInWeb(origin, session, payload);
      assert.equal(result.state, "unknown", stage);
      assert.notEqual(result.no_submit, true);
      assert.notEqual(result.authentication_required, true);
      assert.equal(calls.filter(call => call.options.method === "POST").length, 1);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ERROR/);
    });
  }
});

test("receipt recovery remains read-only across temporary failures and unchanged identity", async () => {
  for (const status of [403, 429, 503]) {
    const calls = [];
    await withWeb(async (url, options) => { calls.push({ url, options }); return url.endsWith("session") ? ready() : response(status, {}); }, async () => {
      const result = await recoverContactTaskInWeb(origin, session, payload.idempotency_key);
      assert.equal(result.state, "unknown");
      assert.notEqual(result.authentication_required, true);
      assert.ok(calls.every(call => call.options.method !== "POST"));
      assert.equal(calls[1].url, "/api/contact-agent/tasks?handoff_request_id=original-reviewed-request");
    });
  }
});

test("connection copies retain the same opaque binding during outages without prompting sign-in", () => {
  const original = { state: "ready", workspace_label: "Original workspace", session_version: session, origin };
  for (const status of [0, 403, 419, 429, 500, 503]) {
    const result = sessionCopy(status, {}, original);
    assert.equal(result.state, "unavailable");
    assert.equal(result.session_version, session);
    assert.equal(result.workspace_label, original.workspace_label);
    assert.notEqual(result.authentication_required, true);
    assert.doesNotMatch(result.message, /sign in|sign-in/i);
  }
  assert.equal(sessionCopy(401, {}, original).authentication_required, true);
  assert.equal(sessionCopy(200, { status: "ready", session_version: "new", contact_agent: false }, original).state, "unavailable");
});

test("capture response and transport classification never guess logout from permission or server failure", () => {
  for (const status of [402, 403, 407, 419, 429, 451, 500, 503]) {
    const result = classifyReceiptResponse(status, { code: "session_stale" });
    assert.equal(result.state, "unknown");
    assert.notEqual(result.authentication_required, true);
  }
  assert.equal(classifyReceiptResponse(401, {}).authentication_required, true);
  assert.equal(classifyReceiptResponse(409, { code: "session_stale" }).code, "session_changed");
  assert.equal(classifyTransportError(new TypeError("network interrupted")).state, "unknown");
});

test("the actual injected function runs without module closures and recovers after a temporary failure", async () => {
  const calls = [];
  let unavailable = true;
  const context = vm.createContext({ location: { origin, pathname: "/contact-agent" }, AbortSignal,
    fetch: async (url, options) => { calls.push({ url, options }); return url.endsWith("session")
      ? unavailable ? response(503, {}) : ready() : response(200, { task_id: task, status: "running" }); } });
  const injected = vm.runInContext(`(${contactHandoffInWeb.toString()})`, context);
  assert.equal((await injected(origin, session, "submit", payload)).no_submit, true);
  assert.equal(calls.length, 1);
  unavailable = false;
  const recovered = await injected(origin, session, "recover", payload.idempotency_key);
  assert.equal(recovered.contact_task_id, task);
  assert.ok(calls.every(call => call.options.method !== "POST"));
  const receipt = await injected(origin, session, "submit", payload);
  assert.equal(receipt.contact_task_id, task);
  assert.equal(calls.filter(call => call.options.method === "POST").length, 1);
  assert.equal(JSON.parse(calls.find(call => call.options.method === "POST").options.body).idempotency_key, payload.idempotency_key);
});

test("the panel's production receipt transport requests only the original image recovery key", async () => {
  const oldChrome = globalThis.chrome, messages = [];
  globalThis.chrome = { runtime: { sendMessage: async message => { messages.push(message); return { state: "unknown" }; } } };
  try {
    const identity = { request_id: "original-request", idempotency_key: payload.idempotency_key };
    await submitReviewedCapture(origin, { source: { capture_kind: "visible_tab" }, idempotency_key: payload.idempotency_key });
    await readCaptureReceipt(origin, "visible_tab", identity);
    await readCaptureReceipt(origin, "visible_tab", identity);
    assert.deepEqual(messages.map(message => message.type), ["handoff.reviewed-image", "handoff.recover", "handoff.recover"]);
    assert.equal(messages[1].requestKey, payload.idempotency_key);
    assert.equal(messages[2].requestKey, payload.idempotency_key);
    assert.deepEqual(Object.keys(messages[1]).sort(), ["requestKey", "type"]);
  } finally { if (oldChrome === undefined) delete globalThis.chrome; else globalThis.chrome = oldChrome; }
});

test("submission feedback preserves session metadata and only confirmed401 enables sign-in", () => {
  const original = { state: "ready", session_version: session, workspace_label: "Original", origin };
  const offline = sessionAfterHandoff(original, { state: "failed", code: "connection_unavailable", no_submit: true });
  assert.equal(offline.session_version, session);
  assert.equal(offline.origin, origin);
  assert.equal(offline.state, "unavailable");
  assert.notEqual(offline.authentication_required, true);
  const changed = sessionAfterHandoff(original, { code: "session_changed", message: "Recheck the original workspace." });
  assert.equal(changed.state, "changed");
  assert.notEqual(changed.authentication_required, true);
  assert.equal(sessionAfterHandoff(original, { authentication_required: true }).authentication_required, true);
});
