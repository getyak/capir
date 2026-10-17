/**
 * Explicit CLI request-duration propagation (no policy expansion):
 *
 * - `sandbox start|status --timeout <s>` reaches the real HTTP fetch AND its
 *   body read; when the flag is omitted the transport default stays 30s.
 * - The selected duration survives `withToken`, and an explicitly longer
 *   duration is never cut at the 30s default.
 * - The login final v1/v2 exchange receives only the REMAINING original
 *   consent deadline and can never renew it; cancellation stays prompt and
 *   keeps its first terminal reason; timers and signal listeners are disposed
 *   on success and failure.
 *
 * Injected fetch and timer probes only: no long waits, model calls, real
 * users, accounts, credentials or Simulator. Each request deadline is read at
 * dispatch time, so unrelated runtime timers can never pollute the proof.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { parseArgs, validateRequestShape } from "../dist/args.js";
import { CapirBackendClient } from "../dist/http.js";
import { runAuthLogin } from "../dist/login.js";
import { runSandboxStart, runSandboxStatus } from "../dist/sandbox.js";
import { OperationJournal } from "../dist/journal.js";
import { capabilitiesResponse, sandboxResponse, token43, uuid } from "./helpers.mjs";

const environment = {
  name: "fixture",
  backendOrigin: "http://127.0.0.1:4317",
  webOrigin: "http://127.0.0.1:3999",
};
const realSetTimeout = globalThis.setTimeout;
const sleep = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms));

function args(argv) {
  const value = parseArgs(argv);
  validateRequestShape(value);
  return value;
}

/** Durations armed through the global timer while `timerProbe` is active. */
const armed = [];

/**
 * The request deadline is armed synchronously before the fetch is dispatched,
 * so the newest armed duration at dispatch time belongs to that exact request.
 */
function recordDispatch() {
  const duration = armed[armed.length - 1];
  assert.equal(typeof duration, "number", "each request arms one deadline");
  return duration;
}

async function timerProbe(run) {
  armed.length = 0;
  globalThis.setTimeout = (fn, ms, ...rest) => {
    armed.push(ms);
    return realSetTimeout(fn, ms, ...rest);
  };
  try {
    return await run();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

async function listen(t, respond) {
  const server = createServer(respond);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

for (const command of ["start", "status"]) {
  test(`sandbox ${command} arms the explicit --timeout on every request and keeps the 30s default when omitted`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "capir-deadline-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    for (const supplied of [false, true]) {
      const id = uuid();
      const seen = [];
      const parsed = args([
        "sandbox",
        command,
        ...(command === "status" ? [id] : []),
        ...(supplied ? ["--timeout", "45"] : []),
      ]);
      const deps = {
        token: token43(),
        journal: new OperationJournal(directory),
        sleep,
        fetchImpl: async (url) => {
          seen.push(recordDispatch());
          return new Response(
            JSON.stringify(
              String(url).endsWith("/capabilities")
                ? capabilitiesResponse(environment.backendOrigin, environment.webOrigin)
                : sandboxResponse({ id }),
            ),
          );
        },
      };
      const result = await timerProbe(() =>
        (command === "start" ? runSandboxStart : runSandboxStatus)(parsed, environment, deps),
      );
      assert.equal(result.sandbox.id, id);
      // The selected duration reaches each real request; an explicitly longer
      // duration is never cut at the 30s default, and omission keeps 30s.
      assert.deepEqual(seen, Array(command === "start" ? 2 : 1).fill(supplied ? 45_000 : 30_000));
    }
  });
}

test("withToken retains the selected request duration and the default stays 30s", async () => {
  const seen = [];
  const respond = async () => {
    seen.push(recordDispatch());
    return new Response(JSON.stringify(capabilitiesResponse(environment.backendOrigin, environment.webOrigin)));
  };
  await timerProbe(() =>
    new CapirBackendClient(environment.backendOrigin, respond, token43(), 45_000)
      .withToken(token43("x"))
      .capabilities(),
  );
  assert.deepEqual(seen, [45_000]);
  await timerProbe(() =>
    new CapirBackendClient(environment.backendOrigin, respond).withToken(undefined).capabilities(),
  );
  assert.deepEqual(seen, [45_000, 30_000]);
});

test("the selected deadline governs the real HTTP fetch and a stalled response body", async (t) => {
  const silent = await listen(t, () => {
    /* intentionally never answers */
  });
  const started = Date.now();
  await assert.rejects(
    new CapirBackendClient(silent, fetch, undefined, 150).capabilities(),
    (error) => error.code === "CAPIR_TRANSPORT",
  );
  assert.ok(Date.now() - started < 5_000, "the selected fetch deadline is bounded");

  const stalled = await listen(t, (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.flushHeaders();
    res.write("{"); // headers accepted, body never completes
  });
  const bodyStarted = Date.now();
  await assert.rejects(
    new CapirBackendClient(stalled, fetch, undefined, 150).capabilities(),
    (error) => error.code === "CAPIR_TRANSPORT",
  );
  assert.ok(Date.now() - bodyStarted < 5_000, "the same deadline covers the body read");
});

test("a completed request disposes its deadline instead of aborting the settled signal later", async () => {
  let signal;
  const client = new CapirBackendClient(
    environment.backendOrigin,
    async (_url, init) => {
      signal = init.signal;
      return new Response(JSON.stringify(capabilitiesResponse(environment.backendOrigin, environment.webOrigin)));
    },
    undefined,
    25,
  );
  await client.capabilities();
  await sleep(45);
  assert.equal(signal.aborted, false, "the disposed deadline never aborts a settled request");
});

function loginStore() {
  let value = null;
  return { kind: "keyring", get: async () => value, set: async (next) => { value = next; } };
}

function v1ExchangeResponse() {
  return {
    schema_version: "capir.v1",
    access_token: token43("a"),
    grant: {
      id: uuid(),
      client_label: "fixture",
      expires_at: "2099-01-01T00:00:00.000Z",
      scopes: ["sandbox:create"],
      refresh_supported: false,
    },
  };
}

function completeCallback(consentUrl) {
  const consent = new URL(consentUrl);
  return fetch(
    `${consent.searchParams.get("redirect_uri")}?code=${token43("c")}&state=${consent.searchParams.get("state")}`,
  );
}

test("the login final v1 exchange receives only the remaining original consent deadline", async () => {
  const exchange = v1ExchangeResponse();
  const deadlines = { exchange: null };
  let dispatched = 0;
  let stored = null;
  const result = await timerProbe(() =>
    runAuthLogin(
      { environment, clientLabel: "fixture", timeoutSeconds: 2, noninteractive: false },
      {
        interactive: true,
        store: loginStore(),
        txn: { commitIfAbsent: async (token) => { stored = token; return "committed"; } },
        fetchImpl: async (url, init) => {
          if (!String(url).endsWith("/exchange")) throw new Error("unexpected dispatch");
          dispatched += 1;
          deadlines.exchange = recordDispatch();
          assert.equal(init.signal.aborted, false);
          return new Response(JSON.stringify(exchange));
        },
        openBrowser: async (value) => {
          await sleep(400); // real consent time passes before the callback
          assert.equal((await completeCallback(value)).status, 200);
        },
      },
    ),
  );
  assert.equal(dispatched, 1);
  assert.equal(stored, token43("a"));
  assert.equal(result.grant.id, exchange.grant.id);
  // The final exchange receives only what remains of the original consent
  // deadline: it is neither the full consent nor a renewed transport default.
  assert.equal(typeof deadlines.exchange, "number");
  assert.ok(deadlines.exchange > 0, "the remaining consent deadline is positive");
  assert.ok(
    deadlines.exchange <= 2000 - 350,
    `the exchange deadline is the remaining consent, not a renewal: ${deadlines.exchange}`,
  );
  assert.notEqual(deadlines.exchange, 30_000, "the final exchange never renews to the transport default");
});

test("the login final v2 exchange receives only the remaining original consent deadline", async () => {
  const grant = {
    id: uuid(),
    client_label: "fixture",
    scopes: ["grants.read", "grants.revoke"],
    web_origin: environment.webOrigin,
    backend_origin: environment.backendOrigin,
    created_at: "2026-01-01T00:00:00.000Z",
    last_verified_at: null,
    access_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_expires_at: "2099-01-02T00:00:00.000Z",
    absolute_expires_at: "2099-01-03T00:00:00.000Z",
    state: "active",
    refresh_supported: true,
  };
  const identity = {
    account_id: uuid(),
    account_slug: "synthetic",
    user_id: uuid(),
    user_email: "proof@example.invalid",
  };
  const capabilities = {
    schema_version: "capir-auth.v2",
    enabled: true,
    capabilities: Object.fromEntries(
      ["auth.authorize", "auth.exchange", "auth.refresh", "auth.status", "auth.logout", "auth.grants"]
        .map((key) => [key, "supported"]),
    ),
    device_auth: "unsupported",
    scopes: grant.scopes,
    backend_origin: environment.backendOrigin,
    web_origin: environment.webOrigin,
    lifetimes: {
      code_seconds: 60,
      access_seconds: 900,
      refresh_idle_seconds: 604800,
      refresh_absolute_seconds: 2592000,
    },
    unsupported: ["device_auth"],
  };
  const deadlines = { discovery: null, exchange: null, status: null };
  let stored = null;
  const result = await timerProbe(() =>
    runAuthLogin(
      { environment, clientLabel: "fixture", timeoutSeconds: 2, noninteractive: false, protocolV2: true },
      {
        interactive: true,
        store: loginStore(),
        txn: { commitIfAbsent: async (token) => { stored = token; return "committed"; } },
        fetchImpl: async (url) => {
          const path = new URL(url).pathname;
          if (path.endsWith("/capabilities")) {
            deadlines.discovery = recordDispatch();
            return new Response(JSON.stringify(capabilities));
          }
          if (path.endsWith("/exchange")) {
            deadlines.exchange = recordDispatch();
            return new Response(JSON.stringify({
              schema_version: "capir-auth.v2",
              access_token: token43("a"),
              refresh_token: token43("r"),
              grant,
            }));
          }
          if (path.endsWith("/status")) {
            deadlines.status = recordDispatch();
            return new Response(JSON.stringify({ schema_version: "capir-auth.v2", state: "active", grant, identity }));
          }
          throw new Error("unexpected dispatch");
        },
        openBrowser: async (value) => {
          await sleep(400);
          await completeCallback(value);
        },
      },
    ),
  );
  assert.ok(stored, "the v2 login stores its record");
  assert.equal(result.grant.id, grant.id);
  for (const [step, duration] of Object.entries(deadlines)) {
    assert.equal(typeof duration, "number", `${step} arms one deadline`);
    assert.ok(duration > 0 && duration <= 2000, `${step} stays within the original consent duration: ${duration}`);
  }
  assert.ok(
    deadlines.exchange <= 2000 - 350,
    `the exchange deadline is the remaining consent, not a renewal: ${deadlines.exchange}`,
  );
  assert.ok(
    deadlines.status <= 2000 - 350,
    `verification receives only the remaining consent too: ${deadlines.status}`,
  );
  assert.ok(deadlines.exchange < deadlines.discovery, "the remaining deadline shrinks and can never renew");
  assert.notEqual(deadlines.exchange, 30_000, "the final exchange never renews to the transport default");
});

test("cancellation stays prompt and preserves its first terminal reason", async () => {
  const before = { sigint: process.listenerCount("SIGINT"), sigterm: process.listenerCount("SIGTERM") };
  let aborted = false;
  const prompt = realSetTimeout(() => process.emit("SIGINT"), 150);
  try {
    await assert.rejects(
      runAuthLogin(
        { environment, clientLabel: "fixture", timeoutSeconds: 1, noninteractive: false },
        {
          interactive: true,
          store: loginStore(),
          txn: { commitIfAbsent: async () => "committed" },
          fetchImpl: async (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener("abort", () => {
                aborted = true;
                reject(new DOMException("Aborted", "AbortError"));
              }, { once: true });
            }),
          openBrowser: async (value) => { await completeCallback(value); },
        },
      ),
      (error) => {
        // SIGINT is the first terminal reason; the later one-second deadline
        // must never replace it.
        assert.equal(error.code, "CAPIR_LOGIN_CANCELLED");
        return true;
      },
    );
    assert.equal(aborted, true, "cancellation aborts the in-flight exchange promptly");
  } finally {
    clearTimeout(prompt);
  }
  assert.equal(process.listenerCount("SIGINT"), before.sigint, "SIGINT listeners are disposed");
  assert.equal(process.listenerCount("SIGTERM"), before.sigterm, "SIGTERM listeners are disposed");
});

test("login success and failure dispose the deadline timer and signal listeners", async () => {
  const before = { sigint: process.listenerCount("SIGINT"), sigterm: process.listenerCount("SIGTERM") };
  const exchange = v1ExchangeResponse();
  let stored = null;
  await runAuthLogin(
    { environment, clientLabel: "fixture", timeoutSeconds: 1, noninteractive: false },
    {
      interactive: true,
      store: loginStore(),
      txn: { commitIfAbsent: async (token) => { stored = token; return "committed"; } },
      fetchImpl: async () => new Response(JSON.stringify(exchange)),
      openBrowser: async (value) => { await completeCallback(value); },
    },
  );
  assert.equal(stored, token43("a"));
  assert.equal(process.listenerCount("SIGINT"), before.sigint);
  assert.equal(process.listenerCount("SIGTERM"), before.sigterm);
  await assert.rejects(
    runAuthLogin(
      { environment, clientLabel: "fixture", timeoutSeconds: 0.03, noninteractive: false },
      {
        interactive: true,
        store: loginStore(),
        txn: { commitIfAbsent: async () => "committed" },
        fetchImpl: async (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          }),
        openBrowser: async () => {},
      },
    ),
    (error) => error.code === "CAPIR_LOGIN_TIMEOUT",
  );
  assert.equal(process.listenerCount("SIGINT"), before.sigint);
  assert.equal(process.listenerCount("SIGTERM"), before.sigterm);
});
