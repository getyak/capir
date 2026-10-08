/**
 * Deterministic CLI operation tests through the real dispatcher: consent
 * denial and callback validation over the real loopback listener, keyring
 * fail-closed behavior, operation-journal replay conflicts, read-only status,
 * logout scoping, handoff replay and cleanup reporting.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  capabilitiesResponse,
  sandboxResponse,
  token43,
  uuid,
  writeEnvironment,
} from "./helpers.mjs";

import { runCli } from "../dist/run.js";
import { runAuthLogin, validateCallback } from "../dist/login.js";
import { createCredentialTxn, createKeyringStore, environmentTokenStore } from "../dist/keyring.js";
import { OperationJournal } from "../dist/journal.js";

const directories = [];
function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "capir-cli-ops-"));
  directories.push(directory);
  return directory;
}
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const parsed = new URL(String(url));
    const record = {
      method: init.method ?? "GET",
      path: parsed.pathname,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: init.headers ?? {},
    };
    calls.push(record);
    for (const route of routes) {
      if (route.method === record.method && route.match(record.path)) {
        if (route.throwError) throw new Error("connection reset");
        return new Response(JSON.stringify(route.json(record)), {
          status: route.status ?? 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(
      JSON.stringify({ error: { code: "NO_ROUTE", message: "no route", request_id: "x" } }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  };
  fn.calls = calls;
  return fn;
}

function fakeStore(token = token43(), kind = "keyring") {
  const store = {
    kind,
    token,
    deleted: false,
    sets: [],
    deletes: 0,
    async get() {
      return store.token;
    },
    async set(value) {
      store.sets.push(value);
      store.token = value;
    },
    async delete() {
      store.deletes++;
      store.deleted = true;
      return true;
    },
  };
  return store;
}

function dependencies({ directory, fetchImpl, store, spawnRunner }) {
  return {
    env: { CAPIR_CONFIG_DIR: directory },
    fetchImpl,
    authProtocol:"capir.v1",
    credentialStore: async () => store,
    // Explicit unit adapter: the credential mutex stays inside this test's
    // scratch directory. Production wiring (canonical per-OS-user root,
    // independent of CAPIR_CONFIG_DIR) is covered by
    // credential-concurrency.test.mjs.
    credentialTxn: async (_environment, txnStore) =>
      createCredentialTxn(txnStore, join(directory, "credential.mutex.sqlite")),
    openBrowser: async () => {},
    interactive: true,
    sleep: async () => {},
    journal: new OperationJournal(directory),
    ...(spawnRunner ? { spawnRunner } : {}),
  };
}

describe("authorization loop", () => {
  it("validates callback method, host, path and state", () => {
    const expected = { state: token43("s"), port: 54321 };
    const good = {
      method: "GET",
      url: `/capir/callback?code=${token43("c")}&state=${expected.state}`,
      headers: { host: "127.0.0.1:54321" },
    };
    assert.equal(validateCallback(good, expected).kind, "valid");
    for (const bad of [
      { ...good, method: "POST" },
      { ...good, headers: { host: "evil.example:54321" } },
      { ...good, url: `/other?code=${token43("c")}&state=${expected.state}` },
      { ...good, url: `/capir/callback?code=${token43("c")}&state=${token43("x")}` },
      { ...good, url: `/capir/callback?code=short&state=${expected.state}` },
    ]) {
      assert.equal(validateCallback(bad, expected).kind, "invalid", JSON.stringify(bad));
    }
    const denied = {
      method: "GET",
      url: `/capir/callback?error=access_denied&state=${expected.state}`,
      headers: { host: "127.0.0.1:54321" },
    };
    assert.equal(validateCallback(denied, expected).kind, "denied");
  });

  it("treats consent denial as auth denial without storing anything", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const store = fakeStore(null);
    const exchanges = fakeFetch([]);
    const result = await runCli(["auth", "login", "--env", "t", "--timeout", "10"], {
      ...dependencies({ directory, fetchImpl: exchanges, store }),
      openBrowser: async (url) => {
        // Owned test browser substitute: submit the Deny outcome.
        const authorize = new URL(url);
        const redirectUri = authorize.searchParams.get("redirect_uri");
        const state = authorize.searchParams.get("state");
        const response = await fetch(
          `${redirectUri}?error=access_denied&state=${encodeURIComponent(state)}`,
        );
        assert.equal(response.status, 200);
      },
    });
    assert.equal(result.exitCode, 4);
    const envelope = JSON.parse(result.output);
    assert.equal(envelope.error.code, "CAPIR_AUTH_DENIED");
    assert.equal(store.sets.length, 0);
    assert.equal(exchanges.calls.length, 0, "no code may be exchanged after a denial");
  });

  it("keeps listening after invalid callbacks and completes on the validated one", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const store = fakeStore(null);
    const minted = token43("a");
    const exchanges = fakeFetch([
      {
        method: "POST",
        match: (path) => path === "/v1/capir/auth/exchange",
        json: () => ({
          schema_version: "capir.v1",
          access_token: minted,
          grant: {
            id: uuid(),
            client_label: "capir-cli",
            expires_at: "2026-10-01T12:00:00.000Z",
            scopes: ["sandbox:create", "sandbox:read", "sandbox:stop", "sandbox:handoff"],
            refresh_supported: false,
          },
        }),
      },
    ]);
    const result = await runCli(["auth", "login", "--env", "t", "--timeout", "10"], {
      ...dependencies({ directory, fetchImpl: exchanges, store }),
      openBrowser: async (url) => {
        const authorize = new URL(url);
        const redirectUri = authorize.searchParams.get("redirect_uri");
        const state = authorize.searchParams.get("state");
        // Invalid attempts must not complete the flow.
        const wrongState = await fetch(
          `${redirectUri}?code=${token43("c")}&state=${token43("x")}`,
        );
        assert.equal(wrongState.status, 400);
        const wrongMethod = await fetch(redirectUri, { method: "POST" });
        assert.equal(wrongMethod.status, 400);
        const validated = await fetch(
          `${redirectUri}?code=${token43("c")}&state=${encodeURIComponent(state)}`,
        );
        assert.equal(validated.status, 200);
      },
    });
    assert.equal(result.exitCode, 0, result.output);
    const envelope = JSON.parse(result.output);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.grant.client_label, "capir-cli");
    assert.equal(store.sets.length, 1);
    assert.equal(store.sets[0], minted);
    // The minted token stays out of stdout even though it was exchanged.
    assert.ok(!result.output.includes(minted));
    const exchange = exchanges.calls.find((call) => call.path === "/v1/capir/auth/exchange");
    assert.ok(exchange);
    assert.equal(typeof exchange.body.code_verifier, "string");
    assert.equal(exchange.body.web_origin, "http://127.0.0.1:3999");
  });

  it("keeps the login deadline through a hung credential exchange", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const store = fakeStore(null);
    const result = await runCli(["auth", "login", "--env", "t", "--timeout", "1"], {
      ...dependencies({ directory, fetchImpl: async () => new Promise(() => {}), store }),
      openBrowser: async (url) => {
        const authorize = new URL(url);
        await fetch(`${authorize.searchParams.get("redirect_uri")}?code=${token43("c")}&state=${authorize.searchParams.get("state")}`);
      },
    });
    assert.equal(result.exitCode, 3);
    assert.equal(JSON.parse(result.output).error.code, "CAPIR_LOGIN_TIMEOUT");
    assert.equal(store.sets.length, 0);
  });

  it("renders a cancellation envelope during credential exchange", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const store = fakeStore(null);
    let exchangeStarted;
    const started = new Promise((resolve) => { exchangeStarted = resolve; });
    const pending = runCli(["auth", "login", "--env", "t", "--timeout", "10"], {
      ...dependencies({ directory, fetchImpl: async () => {
        exchangeStarted();
        return new Promise(() => {});
      }, store }),
      openBrowser: async (url) => {
        const authorize = new URL(url);
        await fetch(`${authorize.searchParams.get("redirect_uri")}?code=${token43("c")}&state=${authorize.searchParams.get("state")}`);
      },
    });
    await started;
    process.emit("SIGINT");
    const result = await pending;
    assert.equal(result.exitCode, 130);
    assert.equal(JSON.parse(result.output).error.code, "CAPIR_LOGIN_CANCELLED");
    assert.equal(store.sets.length, 0);
  });

  it("bounds best-effort revocation after a keyring write failure", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const store = fakeStore(null);
    store.set = async () => { throw new Error("keyring unavailable"); };
    const fetchImpl = async (url) => String(url).endsWith("/auth/logout")
      ? new Promise(() => {})
      : Response.json({ schema_version: "capir.v1", access_token: token43("k"), grant: {
        id: uuid(), client_label: "capir-cli", expires_at: "2026-10-01T12:00:00.000Z",
        scopes: ["sandbox:create", "sandbox:read", "sandbox:stop", "sandbox:handoff"],
        refresh_supported: false,
      } });
    const result = await runCli(["auth", "login", "--env", "t", "--timeout", "1"], {
      ...dependencies({ directory, fetchImpl, store }),
      openBrowser: async (url) => {
        const authorize = new URL(url);
        await fetch(`${authorize.searchParams.get("redirect_uri")}?code=${token43("c")}&state=${authorize.searchParams.get("state")}`);
      },
    });
    assert.equal(result.exitCode, 3);
    assert.equal(JSON.parse(result.output).error.code, "CAPIR_LOGIN_TIMEOUT");
  });

  for (const mode of ["timeout", "SIGINT"]) {
    it(`does not return ${mode} before a delayed keyring write is removed`, async () => {
      const directory = scratch();
      writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
      const minted = token43("m");
      let releaseWrite;
      const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
      let signalWrite;
      const writeStarted = new Promise((resolve) => { signalWrite = resolve; });
      const store = fakeStore(null);
      store.delete = async () => {
        store.deletes++;
        store.token = null;
        return true;
      };
      store.set = async (value) => {
        signalWrite();
        await writeGate;
        store.token = value;
        store.sets.push(value);
      };
      let logoutCalls = 0;
      const fetchImpl = async (url) => {
        if (String(url).endsWith("/auth/logout")) {
          logoutCalls++;
          return Response.json({ schema_version: "capir.v1", revoked_grant_id: uuid() });
        }
        return Response.json({ schema_version: "capir.v1", access_token: minted, grant: {
          id: uuid(), client_label: "capir-cli", expires_at: "2026-10-01T12:00:00.000Z",
          scopes: ["sandbox:create", "sandbox:read", "sandbox:stop", "sandbox:handoff"],
          refresh_supported: false,
        } });
      };
      let returned = false;
      const pending = runCli(["auth", "login", "--env", "t", "--timeout", "1"], {
        ...dependencies({ directory, fetchImpl, store }),
        openBrowser: async (url) => {
          const authorize = new URL(url);
          await fetch(`${authorize.searchParams.get("redirect_uri")}?code=${token43("c")}&state=${authorize.searchParams.get("state")}`);
        },
      }).then((result) => { returned = true; return result; });
      await writeStarted;
      if (mode === "SIGINT") process.emit("SIGINT");
      await new Promise((resolve) => setTimeout(resolve, 1100));
      assert.equal(returned, false, "must await unabortable write settlement before returning");
      assert.equal(store.token, null);
      releaseWrite();
      const result = await pending;
      assert.equal(result.exitCode, mode === "SIGINT" ? 130 : 3, result.output);
      assert.equal(JSON.parse(result.output).error.code,
        mode === "SIGINT" ? "CAPIR_LOGIN_CANCELLED" : "CAPIR_LOGIN_TIMEOUT");
      assert.equal(store.token, null, "new credential must be removed before failure returns");
      assert.equal(store.deletes, 1);
      assert.equal(logoutCalls, 1, "revoke still runs with a fresh bounded signal");
    });
  }

  it("keeps SIGINT exit 130 when keyring cleanup crosses the deadline", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const minted = token43("q");
    let releaseWrite;
    let releaseDelete;
    let signalWrite;
    let signalDelete;
    const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
    const deleteGate = new Promise((resolve) => { releaseDelete = resolve; });
    const writeStarted = new Promise((resolve) => { signalWrite = resolve; });
    const deleteStarted = new Promise((resolve) => { signalDelete = resolve; });
    const store = fakeStore(null);
    store.set = async (value) => {
      signalWrite();
      await writeGate;
      store.token = value;
    };
    store.delete = async () => {
      signalDelete();
      await deleteGate;
      store.token = null;
      return true;
    };
    let logoutCalls = 0;
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/auth/logout")) {
        logoutCalls++;
        return Response.json({ schema_version: "capir.v1", revoked_grant_id: uuid() });
      }
      return Response.json({ schema_version: "capir.v1", access_token: minted, grant: {
        id: uuid(), client_label: "capir-cli", expires_at: "2026-10-01T12:00:00.000Z",
        scopes: ["sandbox:create", "sandbox:read", "sandbox:stop", "sandbox:handoff"],
        refresh_supported: false,
      } });
    };
    let returned = false;
    const pending = runCli(["auth", "login", "--env", "t", "--timeout", "1"], {
      ...dependencies({ directory, fetchImpl, store }),
      openBrowser: async (url) => {
        const authorize = new URL(url);
        await fetch(`${authorize.searchParams.get("redirect_uri")}?code=${token43("c")}&state=${authorize.searchParams.get("state")}`);
      },
    }).then((result) => { returned = true; return result; });
    await writeStarted;
    process.emit("SIGINT");
    releaseWrite();
    await deleteStarted;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(returned, false, "must wait for compensating keyring deletion");
    releaseDelete();
    const result = await pending;
    assert.equal(result.exitCode, 130, result.output);
    assert.equal(JSON.parse(result.output).error.code, "CAPIR_LOGIN_CANCELLED");
    assert.equal(store.token, null);
    assert.equal(logoutCalls, 1);
  });

  it("removes a native-style synchronous keyring write that crosses the deadline", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const minted = token43("n");
    let stored = null;
    let deletes = 0;
    let logoutCalls = 0;
    const keyring = { Entry: class {
      getPassword() { return stored; }
      setPassword(value) {
        // Entry.setPassword is a synchronous native API. Simulate an OS call
        // that blocks the event loop past the 1s deadline before persisting.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_200);
        stored = value;
      }
      deleteCredential() { deletes++; stored = null; return true; }
    } };
    const store = createKeyringStore(keyring, "deadline-probe");
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/auth/logout")) {
        logoutCalls++;
        return Response.json({ schema_version: "capir.v1", revoked_grant_id: uuid() });
      }
      return Response.json({ schema_version: "capir.v1", access_token: minted, grant: {
        id: uuid(), client_label: "capir-cli", expires_at: "2026-10-01T12:00:00.000Z",
        scopes: ["sandbox:create", "sandbox:read", "sandbox:stop", "sandbox:handoff"],
        refresh_supported: false,
      } });
    };
    const result = await runCli(["auth", "login", "--env", "t", "--timeout", "1"], {
      ...dependencies({ directory, fetchImpl, store }),
      openBrowser: async (url) => {
        const authorize = new URL(url);
        await fetch(`${authorize.searchParams.get("redirect_uri")}?code=${token43("c")}&state=${authorize.searchParams.get("state")}`);
      },
    });
    assert.equal(result.exitCode, 3, result.output);
    assert.equal(JSON.parse(result.output).error.code, "CAPIR_LOGIN_TIMEOUT");
    assert.equal(stored, null, "native write must be deleted before timeout returns");
    assert.equal(deletes, 1);
    assert.equal(logoutCalls, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stored, null, "no pending write can land after return");
  });

  it("preserves a pre-existing scoped credential instead of replacing it", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const prior = token43("p");
    const store = fakeStore(prior);
    const result = await runCli(["auth", "login", "--env", "t"], {
      ...dependencies({ directory, fetchImpl: async () => {
        throw new Error("no backend request expected");
      }, store }),
      openBrowser: async () => { throw new Error("no browser expected"); },
    });
    assert.equal(result.exitCode, 2);
    assert.equal(JSON.parse(result.output).error.code, "CAPIR_CREDENTIAL_EXISTS");
    assert.equal(store.token, prior);
    assert.equal(store.deletes, 0);
    assert.equal(store.sets.length, 0);
  });

  it("refuses login while an ephemeral CAPIR_TOKEN is provided", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const store = environmentTokenStore(token43("e"));
    const result = await runCli(["auth", "login", "--env", "t"], {
      ...dependencies({ directory, fetchImpl: fakeFetch([]), store }),
    });
    assert.equal(result.exitCode, 2);
    assert.equal(JSON.parse(result.output).error.code, "CAPIR_TOKEN_PROVIDED");
  });

  it("fails closed when the keyring is unavailable", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const throwing = {
      Entry: class {
        getPassword() {
          throw new Error("keychain unavailable");
        }
        setPassword() {
          throw new Error("keychain unavailable");
        }
        deleteCredential() {
          throw new Error("keychain unavailable");
        }
      },
    };
    const store = createKeyringStore(throwing, "probe");
    await assert.rejects(() => store.get(), (error) => {
      assert.equal(error.code, "CAPIR_KEYRING_UNAVAILABLE");
      assert.equal(error.exitCode, 3);
      return true;
    });
    const result = await runCli(["auth", "status", "--env", "t"], {
      ...dependencies({ directory, fetchImpl: fakeFetch([]), store }),
    });
    assert.equal(result.exitCode, 3);
    assert.equal(JSON.parse(result.output).error.code, "CAPIR_KEYRING_UNAVAILABLE");
  });
});

describe("sandbox operations", () => {
  it("rejects a parameter conflict before dispatch and resumes the same operation", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const fetchImpl = fakeFetch([
      {
        method: "GET",
        match: (path) => path === "/v1/capir/capabilities",
        json: () => capabilitiesResponse("http://127.0.0.1:4317", "http://127.0.0.1:3999"),
      },
      {
        method: "POST",
        match: (path) => path === "/v1/capir/sandboxes",
        json: (record) => sandboxResponse({ id: record.body.id, state: "ready" }),
      },
    ]);
    const store = fakeStore();
    const base = dependencies({ directory, fetchImpl, store });
    const requestId = uuid();
    const first = await runCli(
      ["sandbox", "start", "--env", "t", "--request-id", requestId],
      base,
    );
    assert.equal(first.exitCode, 0, first.output);
    assert.equal(JSON.parse(first.output).resumed, false);
    const dispatchesBefore = fetchImpl.calls.filter((c) => c.path === "/v1/capir/sandboxes").length;

    const conflict = await runCli(
      ["sandbox", "start", "--env", "t", "--request-id", requestId, "--duration-hours", "24"],
      base,
    );
    assert.equal(conflict.exitCode, 2);
    assert.equal(JSON.parse(conflict.output).error.code, "CAPIR_INTENT_CONFLICT");
    assert.equal(
      fetchImpl.calls.filter((c) => c.path === "/v1/capir/sandboxes").length,
      dispatchesBefore,
      "a conflicting resume must not dispatch",
    );

    const resumed = await runCli(
      ["sandbox", "start", "--env", "t", "--request-id", requestId],
      base,
    );
    assert.equal(resumed.exitCode, 0, resumed.output);
    assert.equal(JSON.parse(resumed.output).resumed, true);
  });

  it("reports transport ambiguity with a recoverable request id", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const fetchImpl = fakeFetch([
      {
        method: "GET",
        match: (path) => path === "/v1/capir/capabilities",
        json: () => capabilitiesResponse("http://127.0.0.1:4317", "http://127.0.0.1:3999"),
      },
      {
        method: "POST",
        match: (path) => path === "/v1/capir/sandboxes",
        throwError: true,
        json: () => ({}),
      },
    ]);
    const requestId = uuid();
    const result = await runCli(
      ["sandbox", "start", "--env", "t", "--request-id", requestId],
      dependencies({ directory, fetchImpl, store: fakeStore() }),
    );
    assert.equal(result.exitCode, 3);
    const envelope = JSON.parse(result.output);
    assert.equal(envelope.error.code, "CAPIR_TRANSPORT_AMBIGUOUS");
    assert.equal(envelope.error.recoverable_request_id, requestId);
    assert.equal(envelope.client_state.journal_status, "ambiguous");
  });

  it("keeps status read-only and never renews the sandbox TTL", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const id = uuid();
    const fetchImpl = fakeFetch([
      {
        method: "GET",
        match: (path) => path === `/v1/capir/sandboxes/${id}`,
        json: () => sandboxResponse({ id, state: "ready", expires_at: "2026-10-01T12:00:00.000Z" }),
      },
    ]);
    const base = dependencies({ directory, fetchImpl, store: fakeStore() });
    const first = await runCli(["sandbox", "status", id, "--env", "t"], base);
    const second = await runCli(["sandbox", "status", id, "--env", "t"], base);
    assert.equal(first.exitCode, 0, first.output);
    assert.equal(second.exitCode, 0, second.output);
    const a = JSON.parse(first.output);
    const b = JSON.parse(second.output);
    assert.equal(a.sandbox.expires_at, "2026-10-01T12:00:00.000Z");
    assert.equal(b.sandbox.expires_at, a.sandbox.expires_at, "TTL must be unchanged");
    assert.equal(a.read_only, true);
    assert.ok(
      fetchImpl.calls.every((call) => call.method === "GET"),
      "status without --open must not dispatch writes",
    );
  });

  it("reports a replayed handoff as a replay miss", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const id = uuid();
    const fetchImpl = fakeFetch([
      {
        method: "GET",
        match: (path) => path === `/v1/capir/sandboxes/${id}`,
        json: () => sandboxResponse({ id, state: "ready" }),
      },
      {
        method: "POST",
        match: (path) => path.endsWith("/handoffs"),
        status: 409,
        json: () => ({
          error: { code: "CAPIR_HANDOFF_REPLAY", message: "Create a fresh handoff operation.", request_id: "x" },
        }),
      },
    ]);
    const result = await runCli(
      ["sandbox", "status", id, "--env", "t", "--open", "web"],
      dependencies({
        directory,
        fetchImpl,
        store: fakeStore(),
        spawnRunner: async () => {
          throw new Error("runner must not start for a replayed handoff");
        },
      }),
    );
    assert.equal(result.exitCode, 3);
    assert.equal(JSON.parse(result.output).error.code, "CAPIR_HANDOFF_REPLAY");
  });

  it("reports deleting/failed/deleted distinctly and never early-deletes", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const id = uuid();
    const stopRoute = (finalState) => [
      {
        method: "POST",
        match: (path) => path === `/v1/capir/sandboxes/${id}/stop`,
        json: () => sandboxResponse({ id, state: "deleting" }),
      },
      {
        method: "GET",
        match: (path) => path === `/v1/capir/sandboxes/${id}`,
        json: () => sandboxResponse({ id, state: finalState }),
      },
    ];

    // Cleanup failure is reported as failure, with the run preserved.
    const failed = await runCli(
      ["sandbox", "stop", id, "--env", "t", "--wait", "1"],
      dependencies({ directory, fetchImpl: fakeFetch(stopRoute("cleanup_failed")), store: fakeStore() }),
    );
    assert.equal(failed.exitCode, 3);
    const failedEnvelope = JSON.parse(failed.output);
    assert.equal(failedEnvelope.error.code, "CAPIR_CLEANUP_FAILED");
    assert.equal(failedEnvelope.run.cleanup.observed_state, "cleanup_failed");

    // An accepted stop alone is never reported as deleted.
    const incomplete = await runCli(
      ["sandbox", "stop", id, "--env", "t", "--wait", "0"],
      dependencies({ directory, fetchImpl: fakeFetch(stopRoute("deleting")), store: fakeStore() }),
    );
    assert.equal(incomplete.exitCode, 3);
    const incompleteEnvelope = JSON.parse(incomplete.output);
    assert.equal(incompleteEnvelope.error.code, "CAPIR_STOP_INCOMPLETE");
    assert.equal(incompleteEnvelope.run.sandbox.state, "deleting");
    assert.ok(!incomplete.output.includes('"state":"deleted"'));

    // Deleted is only reported from a real zero-row readback.
    const deleted = await runCli(
      ["sandbox", "stop", id, "--env", "t", "--wait", "1"],
      dependencies({ directory, fetchImpl: fakeFetch(stopRoute("deleted")), store: fakeStore() }),
    );
    assert.equal(deleted.exitCode, 0, deleted.output);
    const deletedEnvelope = JSON.parse(deleted.output);
    assert.equal(deletedEnvelope.cleanup.observed_state, "deleted");
  });

  it("logs out only the scoped grant and its own keyring entry", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const fetchImpl = fakeFetch([
      {
        method: "POST",
        match: (path) => path === "/v1/capir/auth/logout",
        json: () => ({ schema_version: "capir.v1", revoked_grant_id: uuid() }),
      },
    ]);
    const store = fakeStore(token43("g"));
    const result = await runCli(
      ["auth", "logout", "--env", "t"],
      dependencies({ directory, fetchImpl, store }),
    );
    assert.equal(result.exitCode, 0, result.output);
    const envelope = JSON.parse(result.output);
    assert.equal(envelope.remote_revoked, true);
    assert.equal(envelope.local_credential_removed, true);
    assert.equal(store.deletes, 1);
    // Only the scoped bearer was revoked; nothing else was dispatched.
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0].path, "/v1/capir/auth/logout");
  });

  it("never persists or deletes an ephemeral CAPIR_TOKEN on logout", async () => {
    const directory = scratch();
    writeEnvironment(directory, "t", "http://127.0.0.1:4317", "http://127.0.0.1:3999");
    const fetchImpl = fakeFetch([
      {
        method: "POST",
        match: (path) => path === "/v1/capir/auth/logout",
        json: () => ({ schema_version: "capir.v1", revoked_grant_id: uuid() }),
      },
    ]);
    const store = fakeStore(token43("e"), "environment");
    const result = await runCli(
      ["auth", "logout", "--env", "t"],
      dependencies({ directory, fetchImpl, store }),
    );
    assert.equal(result.exitCode, 0, result.output);
    const envelope = JSON.parse(result.output);
    assert.equal(envelope.remote_revoked, true);
    assert.equal(envelope.local_credential_removed, false);
    assert.equal(envelope.credential_source, "CAPIR_TOKEN");
    assert.equal(store.deletes, 0);
    assert.equal(store.sets.length, 0);
    assert.ok(!result.output.includes(token43("e")));
  });
});
