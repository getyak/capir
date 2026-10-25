import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { contactRecoveryJournal } from "../load-unpacked/lib/contact-recovery.js";
import { submitReviewedCapture, readCaptureReceipt } from "../load-unpacked/lib/handoff-transport.js";

const origin = "http://localhost:3000", sessionVersion = "original-session";
const requestKey = "original-reviewed-request", task = "10000000-0000-4000-8000-000000000001";
const envelope = { handoff_target: origin, source: { capture_kind: "visible_tab", captured_at: "2026-10-26T00:00:00Z" },
  review: { type: "reviewed_image", mime_type: "image/png", data_url: "data:image/png;base64,c3ludGhldGlj" },
  authorization: { decision: "submit_reviewed_capture" }, retention_mode: "evidence_crop", idempotency_key: requestKey,
  session: { version: sessionVersion } };

test("real panel→worker→serialized Web function keeps unknown operations through restart and GET-only recovery", async () => {
  const saved = globalThis.chrome, values = {}, calls = [];
  let listener, mode = "post-503", imported = 0;
  const storage = {
    async setAccessLevel() {}, async get() { return structuredClone(values); },
    async set(data) { Object.assign(values, structuredClone(data)); }, async remove(key) { delete values[key]; },
  };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("session")) return { ok: mode !== "preflight-503", status: mode === "preflight-503" ? 503 : 200,
      json: async () => ({ status: "ready", contact_agent: true, session_version: mode === "replacement" ? "other-session" : sessionVersion }) };
    return { ok: mode === "received", status: mode === "received" ? 200 : 503,
      json: async () => ({ task_id: task, status: "running" }) };
  };
  const tab = { id: 7, status: "complete", url: origin + "/contact-agent" };
  globalThis.chrome = {
    storage: { local: storage }, sidePanel: { async setPanelBehavior() {} },
    tabs: { async create() { return tab; }, async get() { return tab; }, async update() {} },
    scripting: { async executeScript({ func, args }) {
      const context = vm.createContext({ location: { origin, pathname: "/contact-agent" }, fetch: fetcher, AbortSignal });
      const injected = vm.runInContext(`(${func.toString()})`, context);
      return [{ result: await injected(...args) }];
    } },
    runtime: { id: "synthetic-extension", onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener(value) { listener = value; } },
      sendMessage(message) { return new Promise((resolve, reject) => {
        if (listener(message, { id: "synthetic-extension" }, resolve) !== true) reject(new Error("MESSAGE_NOT_HANDLED"));
      }); },
    },
  };
  const restart = () => import(`../load-unpacked/service-worker.js?worker-recovery-${++imported}`);
  const journal = contactRecoveryJournal(storage);
  try {
    await restart();
    const uncertain = await submitReviewedCapture(origin, envelope);
    assert.equal(uncertain.state, "unknown");
    assert.equal(calls.filter(call => call.options.method === "POST").length, 1);
    const original = await journal.list();
    assert.equal(original.length, 1);
    assert.deepEqual({ ...original[0], createdAt: 0 }, { origin, sessionVersion, requestKey, createdAt: 0 });

    await restart(); mode = "preflight-503";
    const blocked = await submitReviewedCapture(origin, envelope);
    assert.equal(blocked.no_submit, true);
    assert.equal(blocked.code, "connection_unavailable");
    assert.deepEqual(await journal.list(), original);
    assert.equal(calls.filter(call => call.options.method === "POST").length, 1);

    mode = "replacement";
    const foreign = await readCaptureReceipt(origin, "visible_tab", { idempotency_key: requestKey });
    assert.equal(foreign.code, "session_changed");
    assert.deepEqual(await journal.list(), original);

    mode = "read-503"; await restart();
    const unverified = await readCaptureReceipt(origin, "visible_tab", { idempotency_key: requestKey });
    assert.equal(unverified.state, "unknown");
    assert.deepEqual(await journal.list(), original);
    assert.equal(calls.filter(call => call.options.method === "POST").length, 1);

    mode = "received";
    const recovered = await readCaptureReceipt(origin, "visible_tab", { idempotency_key: requestKey });
    assert.equal(recovered.contact_task_id, task);
    assert.equal((await journal.list())[0].completed, true);
    assert.equal(calls.filter(call => call.options.method === "POST").length, 1);
    assert.doesNotMatch(JSON.stringify(values), /data_base64|data_url|image|password|cookie|token/);
  } finally { if (saved === undefined) delete globalThis.chrome; else globalThis.chrome = saved; }
});
