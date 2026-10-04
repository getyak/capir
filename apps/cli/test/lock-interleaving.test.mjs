/**
 * Deterministic regression for the reclaimed-lock-steals-live-holder defect
 * (parent-lock-precheck counterexample): a stale contender paused at its
 * scheduling seam — right where the old read-owner-then-rename protocol had
 * already decided the lock was abandoned and was about to claim it — while
 * another contender publishes a live hold. When the stale contender resumes it
 * must NOT steal the live holder's lock and no journal/credential mutation may
 * be lost.
 *
 * The OS reservation protocol has no check-then-mutate window at all, so the
 * seam (`beforeAttempt`) models the old protocol's decision point: the paused
 * contender has observed the crashed holder's abandoned state and is about to
 * act. The interleaving is scripted explicitly (no timing luck): promise gates
 * for the credential flavor, SIGSTOP/SIGCONT for the journal flavor.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { OperationJournal } from "../dist/journal.js";
import { ProcessLock } from "../dist/lock.js";
import { createCredentialTxn } from "../dist/keyring.js";

const JOURNAL_URL = new URL("../dist/journal.js", import.meta.url).href;
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

const token43 = (char) => char.repeat(43);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function spawnScript(code) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", code]);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return {
    child,
    get stdout() { return stdout; },
    waitForOutput(marker, timeoutMs = 10_000) {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const poll = () => {
          if (stdout.includes(marker)) return resolve();
          if (child.exitCode !== null) return reject(new Error(`child exited ${child.exitCode}: ${stderr}`));
          if (Date.now() >= deadline) return reject(new Error(`marker "${marker}" not seen: ${stdout}${stderr}`));
          setTimeout(poll, 20);
        };
        poll();
      });
    },
    exited(timeoutMs = 15_000) {
      return new Promise((resolve, reject) => {
        if (child.exitCode !== null) return resolve(child.exitCode);
        child.once("close", (code) => resolve(code));
        setTimeout(() => reject(new Error(`child did not exit: ${stdout}${stderr}`)), timeoutMs).unref();
      });
    },
  };
}

/** Shared keyring-entry adapter (explicit test adapter; the mutex is real). */
function sharedEntry(path, options = {}) {
  return {
    kind: "keyring",
    writes: [],
    async get() {
      await sleep(25);
      try {
        return JSON.parse(readFileSync(path, "utf8")).token ?? null;
      } catch {
        return null;
      }
    },
    async set(token) {
      await sleep(25);
      await options.onSet?.(token);
      this.writes.push(token);
      writeFileSync(path, JSON.stringify({ token }), { mode: 0o600 });
    },
    async delete() {
      await sleep(25);
      rmSync(path, { force: true });
      return true;
    },
  };
}

function intent(id) {
  return {
    request_id: id,
    kind: "sandbox.start",
    environment: "t",
    backend_origin: "http://127.0.0.1:4317",
    web_origin: "http://127.0.0.1:3000",
    digest: `digest-${id}`,
  };
}

describe("reclaimed lock never steals a live holder (deterministic interleave)", () => {
  it("credential boundary: paused stale contender cannot overwrite or pass a live hold", async () => {
    const directory = scratch("capir-interleave-cred-");
    const mutexFile = join(directory, "credential.mutex.sqlite");
    const entry = sharedEntry(join(directory, "keyring-entry.json"));

    // Phase 0 — stale precondition: a crashed holder (SIGKILL mid-hold).
    const crashed = spawnScript(`
      import { ProcessLock } from ${JSON.stringify(LOCK_URL)};
      const lock = new ProcessLock(${JSON.stringify(mutexFile)});
      lock.acquire();
      process.stdout.write("held\\n");
      setInterval(() => {}, 1000);
    `);
    await crashed.waitForOutput("held");
    crashed.child.kill("SIGKILL");
    await crashed.exited();

    // Phase 1 — the stale contender pauses at its scheduling seam, exactly
    // where the old protocol decided "abandoned, claim it" after its owner
    // liveness check.
    const paused = deferred();
    const resume = deferred();
    const staleTxn = createCredentialTxn(entry, mutexFile, {
      retryIntervalMs: 20,
      beforeAttempt: (attempt) => {
        if (attempt === 1) {
          paused.resolve();
          return resume.promise;
        }
      },
    });
    const staleCommit = staleTxn.commitIfAbsent(token43("S"));
    let staleSettled = false;
    staleCommit.then(() => { staleSettled = true; }, () => { staleSettled = true; });
    await paused.promise;

    // Phase 2 — another contender reclaims the crashed state and publishes a
    // LIVE hold (its commit is gated inside the critical section).
    const inside = deferred();
    const release = deferred();
    const gated = sharedEntry(join(directory, "keyring-entry.json"), {
      onSet: async () => {
        inside.resolve();
        await release.promise;
      },
    });
    const holderTxn = createCredentialTxn(gated, mutexFile, { retryIntervalMs: 20 });
    const holderCommit = holderTxn.commitIfAbsent(token43("B"));
    await inside.promise; // live holder is now published and holding

    // Phase 3 — resume the stale contender while the live hold is live.
    resume.resolve();
    await sleep(500);
    assert.equal(staleSettled, false, "the stale contender must not steal the live hold");

    // Phase 4 — release the live holder; the stale contender proceeds but must
    // not overwrite the committed credential (no lost mutation).
    release.resolve();
    assert.equal(await holderCommit, "committed");
    assert.equal(await staleCommit, "existing_preserved");
    assert.equal(await entry.get(), token43("B"), "the live holder's credential survives");
    assert.deepEqual(gated.writes, [token43("B")], "the live holder's write landed exactly once");
    assert.deepEqual(entry.writes, [], "the stale contender never wrote");
  });

  it("journal boundary: SIGSTOPped stale contender cannot pass a live holder and loses no intent", async () => {
    const directory = scratch("capir-interleave-journal-");
    const journal = new OperationJournal(directory);
    const mutexFile = join(directory, "operations.json.mutex.sqlite");

    // Phase 0 — stale precondition: a crashed holder (SIGKILL mid-hold).
    const crashed = spawnScript(`
      import { ProcessLock } from ${JSON.stringify(LOCK_URL)};
      const lock = new ProcessLock(${JSON.stringify(mutexFile)});
      lock.acquire();
      process.stdout.write("held\\n");
      setInterval(() => {}, 1000);
    `);
    await crashed.waitForOutput("held");
    crashed.child.kill("SIGKILL");
    await crashed.exited();

    // Phase 1 — the stale contender SIGSTOPs itself at its scheduling seam
    // (deterministic pause: the process is frozen right before its claim).
    const stale = spawnScript(`
      import { OperationJournal } from ${JSON.stringify(JOURNAL_URL)};
      import { writeSync } from "node:fs";
      const journal = new OperationJournal(${JSON.stringify(directory)}, {
        retryIntervalMs: 20,
        beforeAttempt: (attempt) => {
          if (attempt === 1) {
            writeSync(1, "paused\\n");
            process.kill(process.pid, "SIGSTOP");
          }
        },
      });
      journal.ensureIntent(${JSON.stringify(intent("S"))});
      writeSync(1, "done\\n");
    `);
    await stale.waitForOutput("paused");

    // Phase 2 — another contender records its intent (the reclaim) and a live
    // holder publishes its hold.
    journal.ensureIntent(intent("R"));
    const live = spawnScript(`
      import { ProcessLock } from ${JSON.stringify(LOCK_URL)};
      import { writeSync } from "node:fs";
      const lock = new ProcessLock(${JSON.stringify(mutexFile)}, { retryIntervalMs: 20 });
      lock.acquire();
      writeSync(1, "held\\n");
      process.stdin.on("data", () => {
        lock.release();
        writeSync(1, "released\\n");
        process.exit(0);
      });
    `);
    await live.waitForOutput("held");

    // Phase 3 — resume the stale contender while the live hold is live.
    stale.child.kill("SIGCONT");
    await sleep(600);
    assert.ok(!stale.stdout.includes("done"), "the stale contender must not steal the live hold");
    assert.deepEqual(
      journal.read().map((entry) => entry.request_id),
      ["R"],
      "no mutation may land while the live holder holds",
    );

    // Phase 4 — release the live holder; the stale contender completes and no
    // intent is lost.
    live.child.stdin.write("go\n");
    await live.waitForOutput("released");
    await stale.waitForOutput("done");
    assert.equal(await stale.exited(), 0);
    assert.deepEqual(
      journal.read().map((entry) => entry.request_id).sort(),
      ["R", "S"],
      "both intents survive: no lost journal mutation",
    );
  });
});
