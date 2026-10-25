import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { webRequest } from "../load-unpacked/lib/web-transport.js";
import { sessionCopy } from "../load-unpacked/lib/handoff-contract.js";

test("actual injected Web transport preserves HTTP status without trusting error text or leaking credentials", async () => {
  const saved = globalThis.chrome, origin = "http://localhost:3000", calls = [];
  let status = 503, malformed = false;
  globalThis.chrome = { tabs: { async query() { return [{ id: 1, url: origin + "/" }]; } },
    scripting: { async executeScript({ func, args }) {
      const context = vm.createContext({ location: { origin }, AbortSignal, fetch: async (url, options) => {
        calls.push({ url, options }); return { status, json: async () => { if (malformed) throw new Error("PRIVATE_ERROR"); return { code: "session_stale" }; } };
      } });
      return [{ result: await vm.runInContext(`(${func.toString()})`, context)(...args) }];
    } },
  };
  try {
    for (const code of [403, 419, 429, 500, 503]) {
      status = code;
      const result = await webRequest(origin, "/api/browser-extension/session");
      assert.equal(result.status, code);
      assert.equal(sessionCopy(result.status, result.body).state, "unavailable");
      assert.notEqual(sessionCopy(result.status, result.body).authentication_required, true);
    }
    status = 401; malformed = true;
    const denied = await webRequest(origin, "/api/browser-extension/session");
    assert.equal(denied.status, 401);
    assert.equal(sessionCopy(denied.status, denied.body).authentication_required, true);
    assert.ok(calls.every(call => call.options.credentials === "same-origin" && !call.options.headers.authorization));
    assert.ok(calls.every(call => call.options.method === "GET"));
  } finally { if (saved === undefined) delete globalThis.chrome; else globalThis.chrome = saved; }
});
