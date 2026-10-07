/**
 * Cross-process credential mutation boundary tests (built `runAuthLogin` /
 * `runAuthLogout` / `runCli` flows with real loopback callbacks and explicit
 * keyring adapters):
 *
 * - two concurrent real login flows never overwrite each other's credential;
 *   the losing minted grant is revoked and nothing else is touched;
 * - a delayed logout completion never removes a newer login's credential;
 * - a crashed mutex holder cannot block the next login (OS crash recovery);
 * - ONE keyring identity synchronizes across DIFFERENT CAPIR_CONFIG_DIR roots
 *   (the boundary is the keyring identity, never the config root).
 *
 * Transport and keyring are explicit test adapters; the loopback callback
 * listener, the login orchestration and the credential transaction mutex are
 * the real built code.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { runAuthLogin } from "../dist/login.js";
import { runAuthLogout } from "../dist/auth.js";
import { runCli } from "../dist/run.js";
import {
  createCredentialTxn,
  credentialMutexPath,
  keyringUsername,
  KEYRING_SERVICE,
} from "../dist/keyring.js";
import { capabilitiesResponse, writeEnvironment } from "./helpers.mjs";

const LOCK_URL = new URL("../dist/lock.js", import.meta.url).href;

const directories = [];
function scratch(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

const BACKEND = "http://127.0.0.1:4317";
const WEB = "http://127.0.0.1:3999";
const environment = { name: "t", backendOrigin: BACKEND, webOrigin: WEB };

const token43 = (char) => char.repeat(43);

// Yield inside keyring operations like real native calls do across the event
// loop: without the mutation boundary this makes the check-then-commit race
// deterministic (both flows observe an empty entry and both write).
const yieldTurn = () => new Promise((resolve) => setTimeout(resolve, 25));

function grant() {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    client_label: "capir-cli",
    expires_at: "2026-10-01T12:00:00.000Z",
    scopes: ["sandbox:create", "sandbox:read", "sandbox:stop", "sandbox:handoff"],
    refresh_supported: false,
  };
}

/** One shared entry, exactly like one OS keyring entry per origin pair. */
function sharedEntry(path) {
  return {
    kind: "keyring",
    writes: [],
    async get() {
      await yieldTurn();
      try {
        return JSON.parse(readFileSync(path, "utf8")).token ?? null;
      } catch {
        return null;
      }
    },
    async set(token) {
      await yieldTurn();
      this.writes.push(token);
      writeFileSync(path, JSON.stringify({ token }), { mode: 0o600 });
    },
    async delete() {
      await yieldTurn();
      rmSync(path, { force: true });
      return true;
    },
  };
}

function fetchStub({ mintedByCode, logoutCalls, onLogout }) {
  return async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    if (path === "/v1/capir/auth/exchange") {
      const body = JSON.parse(String(init.body));
      return Response.json({
        schema_version: "capir.v1",
        access_token: mintedByCode(body.code),
        grant: grant(),
      });
    }
    if (path === "/v1/capir/auth/logout") {
      logoutCalls.push(String(init.headers?.authorization ?? ""));
      await onLogout?.();
      return Response.json({
        schema_version: "capir.v1",
        revoked_grant_id: "00000000-0000-4000-8000-000000000002",
      });
    }
    // Discovery payloads for runCli-driven flows.
    if (path === "/v1/capir/capabilities") {
      return Response.json(capabilitiesResponse(BACKEND, WEB));
    }
    return Response.json({ schema_version: "capir.v1" }, { status: 404 });
  };
}

/** Real built login flow: real loopback listener, real callback HTTP GET. */
function login(letter, { store, txn, fetchImpl, consent }) {
  return runAuthLogin(
    { environment, clientLabel: "capir-cli", timeoutSeconds: 20, noninteractive: false },
    {
      fetchImpl,
      store,
      txn,
      interactive: true,
      openBrowser:
        consent ??
        (async (url) => {
          const authorize = new URL(url);
          const response = await fetch(
            `${authorize.searchParams.get("redirect_uri")}?code=${token43(letter.toLowerCase())}&state=${encodeURIComponent(authorize.searchParams.get("state"))}`,
          );
          assert.equal(response.status, 200);
        }),
    },
  );
}

async function losingLogin({ timeoutSeconds = 20, onLogout }) {
  const directory = scratch("capir-losing-login-");
  writeEnvironment(directory, "t", BACKEND, WEB);
  const winner = token43("W");
  const loser = token43("L");
  let stored = null;
  const store = {
    kind: "keyring",
    async get() { return stored; },
    async set() { throw new Error("transaction must own mutation"); },
    async delete() { throw new Error("transaction must own mutation"); },
  };
  const txn = {
    async commitIfAbsent() {
      stored = winner; // Another login wins after this flow's initial precheck.
      return "existing_preserved";
    },
    async removeIfMatch(token) {
      assert.equal(token, loser);
      assert.equal(stored, winner);
      return "preserved_newer";
    },
  };
  const logoutCalls = [];
  const fetchImpl = fetchStub({ mintedByCode: () => loser, logoutCalls, onLogout });
  const result = await runCli(["auth", "login", "--env", "t", "--timeout", String(timeoutSeconds)], {
    env: { CAPIR_CONFIG_DIR: directory },
    fetchImpl,
    authProtocol:"capir.v1",
    credentialStore: async () => store,
    credentialTxn: async () => txn,
    openBrowser: async (url) => {
      const authorize = new URL(url);
      const response = await fetch(
        `${authorize.searchParams.get("redirect_uri")}?code=${token43("a")}&state=${encodeURIComponent(authorize.searchParams.get("state"))}`,
      );
      assert.equal(response.status, 200);
    },
    interactive: true,
    sleep: async () => {},
  });
  return { result, stored, winner, loser, logoutCalls };
}

describe("origin-pair credential mutation boundary", () => {
  it("reports an offline losing-grant revoke as unconfirmed while preserving the winner", async () => {
    const state = await losingLogin({ onLogout: async () => { throw new Error("backend offline"); } });
    const envelope = JSON.parse(state.result.output);
    assert.equal(state.result.exitCode, 3);
    assert.equal(envelope.error.code, "CAPIR_LOGIN_CLEANUP_FAILED");
    assert.match(envelope.error.message, /revocation could not be confirmed/);
    assert.doesNotMatch(envelope.error.message, /was revoked/);
    assert.deepEqual(envelope.client_state, {
      local_minted_credential_absent: true,
      remote_revoked: false,
      winner_credential_preserved: true,
    });
    assert.equal(state.stored, state.winner);
    assert.deepEqual(state.logoutCalls, [`Bearer ${state.loser}`]);
  });

  for (const mode of ["SIGINT", "timeout"]) {
    it(`keeps the ${mode} terminal cause when losing-grant revocation crosses it`, async () => {
      const state = await losingLogin({
        timeoutSeconds: mode === "timeout" ? 1 : 20,
        onLogout: async () => {
          if (mode === "SIGINT") process.emit("SIGINT");
          else await new Promise((resolve) => setTimeout(resolve, 1100));
        },
      });
      const envelope = JSON.parse(state.result.output);
      assert.equal(state.result.exitCode, mode === "SIGINT" ? 130 : 3);
      assert.equal(envelope.error.code,
        mode === "SIGINT" ? "CAPIR_LOGIN_CANCELLED" : "CAPIR_LOGIN_TIMEOUT");
      assert.equal(envelope.client_state.local_minted_credential_absent, true);
      assert.equal(envelope.client_state.remote_revoked, true);
      assert.equal(envelope.client_state.winner_credential_preserved, true);
      assert.equal(state.stored, state.winner);
      assert.deepEqual(state.logoutCalls, [`Bearer ${state.loser}`]);
    });
  }

  it("anchors the mutex namespace to OS user information and fails closed without it", () => {
    const osHome = scratch("capir-os-user-home-");
    const username = keyringUsername(BACKEND, WEB);
    const fromOs = credentialMutexPath(KEYRING_SERVICE, username, () => ({ homedir: osHome }));
    assert.ok(fromOs.startsWith(`${osHome}/`), "the injected OS identity determines the root");
    assert.equal(fromOs, credentialMutexPath(KEYRING_SERVICE, username, () => ({ homedir: osHome })));
    assert.throws(() => credentialMutexPath(KEYRING_SERVICE, username, () => ({ homedir: "" })),
      (error) => error.code === "CAPIR_KEYRING_UNAVAILABLE");
    assert.throws(() => credentialMutexPath(KEYRING_SERVICE, username, () => ({ homedir: "relative/home" })),
      (error) => error.code === "CAPIR_KEYRING_UNAVAILABLE");
    assert.throws(() => credentialMutexPath(KEYRING_SERVICE, username, () => { throw new Error("OS lookup failed"); }),
      (error) => error.code === "CAPIR_KEYRING_UNAVAILABLE");
  });

  it("settles two concurrent real login flows without overwriting a credential", async () => {
    const directory = scratch("capir-login-race-");
    const entry = sharedEntry(join(directory, "keyring-entry.json"));
    const txn = createCredentialTxn(entry, join(directory, "credential.mutex.sqlite"));
    const logoutCalls = [];
    const fetchImpl = fetchStub({
      mintedByCode: (code) => token43(code[0] === "a" ? "A" : "B"),
      logoutCalls,
    });
    // Synchronize both consent windows so both flows have passed their
    // pre-existing-credential check and are mid-consent at the same time; the
    // race is then resolved only by the commit-time mutation boundary.
    let arrived = 0;
    let openGate;
    const bothArrived = new Promise((resolve) => { openGate = resolve; });
    const consentFor = (letter) => async (url) => {
      arrived += 1;
      if (arrived === 2) openGate();
      await bothArrived;
      const authorize = new URL(url);
      const response = await fetch(
        `${authorize.searchParams.get("redirect_uri")}?code=${token43(letter)}&state=${encodeURIComponent(authorize.searchParams.get("state"))}`,
      );
      assert.equal(response.status, 200);
    };
    const attempts = await Promise.all(
      ["a", "b"].map(async (letter) => {
        try {
          const value = await login(letter, {
            store: entry,
            txn,
            fetchImpl,
            consent: consentFor(letter),
          });
          return { letter, token: token43(letter.toUpperCase()), ok: true, value };
        } catch (error) {
          return { letter, token: token43(letter.toUpperCase()), ok: false, error };
        }
      }),
    );
    const winner = attempts.find((attempt) => attempt.ok);
    const loser = attempts.find((attempt) => !attempt.ok);
    assert.ok(winner, "exactly one login may win the credential");
    assert.ok(loser, "exactly one login must yield");
    assert.equal(loser.error.code, "CAPIR_CREDENTIAL_EXISTS");
    assert.equal(loser.error.exitCode, 2);

    // The stored credential belongs to the winner; it was never overwritten.
    assert.equal(await entry.get(), winner.token);
    assert.equal(entry.writes.length, 1, "the losing flow must not write the keyring entry");

    // The losing minted grant is revoked; the winner's grant is untouched.
    assert.deepEqual(logoutCalls, [`Bearer ${loser.token}`], "the losing minted grant was revoked");
  });

  it("lets a delayed logout never delete a newer login's credential", async () => {
    const directory = scratch("capir-logout-delay-");
    const entry = sharedEntry(join(directory, "keyring-entry.json"));
    const mutexFile = join(directory, "credential.mutex.sqlite");
    const logoutCalls = [];
    let releaseFirstLogout;
    const firstLogoutGate = new Promise((resolve) => { releaseFirstLogout = resolve; });
    let logoutSeen = 0;
    let firstLogoutStarted;
    const firstLogoutStartedPromise = new Promise((resolve) => { firstLogoutStarted = resolve; });
    const fetchImpl = fetchStub({
      mintedByCode: (code) => token43(code[0] === "a" ? "A" : "C"),
      logoutCalls,
      onLogout: async () => {
        logoutSeen += 1;
        if (logoutSeen === 1) {
          firstLogoutStarted();
          await firstLogoutGate;
        }
      },
    });

    // 1) A real first login stores credential T1.
    await login("a", { store: entry, txn: createCredentialTxn(entry, mutexFile), fetchImpl });
    assert.equal(await entry.get(), token43("A"));

    // 2) An older logout (owns T1) stalls in its network roundtrip.
    const older = runAuthLogout(environment, {
      fetchImpl,
      store: entry,
      txn: createCredentialTxn(entry, mutexFile),
      token: token43("A"),
    });
    await firstLogoutStartedPromise;

    // 3) A retried logout completes the removal of T1 while the older one is
    //    still in flight; then a new real login commits credential T2.
    const retry = await runAuthLogout(environment, {
      fetchImpl,
      store: entry,
      txn: createCredentialTxn(entry, mutexFile),
      token: token43("A"),
    });
    assert.equal(retry.local_credential_removed, true);
    assert.equal(retry.local_credential_state, "removed");
    await login("c", { store: entry, txn: createCredentialTxn(entry, mutexFile), fetchImpl });
    assert.equal(await entry.get(), token43("C"), "the newer login stored its credential");

    // 4) The older logout finally returns and must not remove the newer
    //    login's credential or claim it removed anything.
    releaseFirstLogout();
    const olderResult = await older;
    assert.equal(olderResult.remote_revoked, true);
    assert.equal(olderResult.local_credential_removed, false);
    assert.equal(olderResult.local_credential_state, "preserved_newer");
    assert.equal(await entry.get(), token43("C"), "the newer credential survives the delayed logout");

    // Both logout roundtrips revoked exactly their own T1 grant; the newer
    // grant was never revoked or overwritten.
    assert.deepEqual(logoutCalls, [`Bearer ${token43("A")}`, `Bearer ${token43("A")}`]);
  });

  it("recovers the credential mutex after a crashed holder and completes login", async () => {
    const directory = scratch("capir-login-crash-");
    const entry = sharedEntry(join(directory, "keyring-entry.json"));
    const mutexFile = join(directory, "credential.mutex.sqlite");
    const crashed = spawn(process.execPath, ["--input-type=module", "-e", `
      import { ProcessLock } from ${JSON.stringify(LOCK_URL)};
      const lock = new ProcessLock(${JSON.stringify(mutexFile)});
      lock.acquire();
      process.stdout.write("held\\n");
      setInterval(() => {}, 1000);
    `]);
    let crashedOut = "";
    crashed.stdout.on("data", (chunk) => { crashedOut += chunk; });
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 10_000;
      const poll = () => {
        if (crashedOut.includes("held")) return resolve();
        if (crashed.exitCode !== null) return reject(new Error("crashed holder exited early"));
        if (Date.now() >= deadline) return reject(new Error("crashed holder never reported"));
        setTimeout(poll, 20);
      };
      poll();
    });
    crashed.kill("SIGKILL");
    await new Promise((resolve) => crashed.once("close", resolve));

    const logoutCalls = [];
    const fetchImpl = fetchStub({ mintedByCode: () => token43("D"), logoutCalls });
    const startedAt = Date.now();
    await login("d", { store: entry, txn: createCredentialTxn(entry, mutexFile), fetchImpl });
    assert.ok(Date.now() - startedAt < 5_000, "a dead mutex holder must not block login");
    assert.equal(await entry.get(), token43("D"));
    assert.ok(existsSync(mutexFile), "the mutex file survives (never unlinked) and holds no stale state");
    assert.deepEqual(logoutCalls, []);
  });

  it("synchronizes ONE keyring identity across DIFFERENT CAPIR_CONFIG_DIR roots", async () => {
    // Distinct fake origins per run => a unique, test-owned canonical mutex.
    const backendOrigin = `http://127.0.0.1:${30000 + Math.floor(Math.random() * 20000)}`;
    const webOrigin = `http://127.0.0.1:${30000 + Math.floor(Math.random() * 20000)}`;
    const username = keyringUsername(backendOrigin, webOrigin);
    const mutexFile = credentialMutexPath(KEYRING_SERVICE, username);
    // The boundary is the keyring identity: it must NOT live under, or embed,
    // any CAPIR_CONFIG_DIR root (parent-lock-precheck/scope.json defect).
    assert.ok(mutexFile.startsWith(userInfo().homedir), "canonical per-OS-user mutex root");
    const configA = scratch("capir-config-a-");
    const configB = scratch("capir-config-b-");
    assert.ok(!mutexFile.includes(configA) && !mutexFile.includes(configB));

    const entry = sharedEntry(join(scratch("capir-shared-keyring-"), "keyring-entry.json"));
    writeEnvironment(configA, "t", backendOrigin, webOrigin);
    writeEnvironment(configB, "t", backendOrigin, webOrigin);
    const logoutCalls = [];
    const fetchImpl = fetchStub({
      mintedByCode: (code) => token43(code[0] === "a" ? "A" : "B"),
      logoutCalls,
    });
    // Two real built login flows through the production dispatcher wiring,
    // differing ONLY in CAPIR_CONFIG_DIR, sharing one keyring entry.
    let arrived = 0;
    let openGate;
    const bothArrived = new Promise((resolve) => { openGate = resolve; });
    const consentFor = (letter) => async (url) => {
      arrived += 1;
      if (arrived === 2) openGate();
      await bothArrived;
      const authorize = new URL(url);
      const response = await fetch(
        `${authorize.searchParams.get("redirect_uri")}?code=${token43(letter)}&state=${encodeURIComponent(authorize.searchParams.get("state"))}`,
      );
      assert.equal(response.status, 200);
    };
    const runLogin = (configDir, letter) => runCli(
      ["auth", "login", "--env", "t", "--timeout", "20"],
      {
        env: { CAPIR_CONFIG_DIR: configDir },
        fetchImpl,
        authProtocol:"capir.v1",
    credentialStore: async () => entry,
        openBrowser: consentFor(letter),
        interactive: true,
        sleep: async () => {},
      },
    );
    const results = await Promise.all([
      runLogin(configA, "a").then((result) => ({ result, token: token43("A") })),
      runLogin(configB, "b").then((result) => ({ result, token: token43("B") })),
    ]);
    const winners = results.filter((entryResult) => entryResult.result.exitCode === 0);
    const losers = results.filter((entryResult) => entryResult.result.exitCode !== 0);
    assert.equal(winners.length, 1, "one keyring identity across config roots: exactly one winner");
    assert.equal(losers.length, 1);
    const loserEnvelope = JSON.parse(losers[0].result.output);
    assert.equal(loserEnvelope.error.code, "CAPIR_CREDENTIAL_EXISTS");
    assert.equal(await entry.get(), winners[0].token, "the winner's credential is preserved");
    assert.equal(entry.writes.length, 1, "no overwrite across config roots");
    assert.deepEqual(logoutCalls, [`Bearer ${losers[0].token}`], "the losing minted grant was revoked");

    // Exact owned lock resource cleanup only.
    rmSync(mutexFile, { force: true });
  });
});
