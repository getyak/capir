/**
 * Crash-recovery and mutual-exclusion tests for the shared process-lifetime OS
 * reservation lock and the operation journal built on it: a terminated writer
 * must be recoverable by the OS protocol (no manual reclamation), its request
 * record must stay recoverable, an independent next intent must be
 * recordable, a live holder must never be stolen from, and racing contenders
 * must not lose mutations.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { OperationJournal } from "../dist/journal.js";
import { ProcessLock } from "../dist/lock.js";

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

const journalMutex = (directory) => join(directory, "operations.json.mutex.sqlite");

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
    exited(timeoutMs = 10_000) {
      return new Promise((resolve, reject) => {
        if (child.exitCode !== null) return resolve(child.exitCode);
        child.once("close", (code) => resolve(code));
        setTimeout(() => reject(new Error(`child did not exit: ${stdout}${stderr}`)), timeoutMs).unref();
      });
    },
  };
}

const holdScript = (mutexFile) => `
  import { ProcessLock } from ${JSON.stringify(LOCK_URL)};
  const lock = new ProcessLock(${JSON.stringify(mutexFile)});
  lock.acquire();
  process.stdout.write("held\\n");
  setInterval(() => {}, 1000);
`;

describe("journal crash recovery (OS reservation protocol)", () => {
  it("does not deadlock an async holder behind an in-process async contender", async () => {
    const directory = scratch("capir-lock-async-");
    const mutexFile = join(directory, "async.mutex.sqlite");
    const order = [];
    const holder = new ProcessLock(mutexFile, { acquireTimeoutMs: 5_000 }).runAsync(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      order.push("holder");
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const contender = new ProcessLock(mutexFile, { acquireTimeoutMs: 5_000 }).runAsync(async () => {
      order.push("contender");
    });
    await Promise.all([holder, contender]);
    assert.deepEqual(order, ["holder", "contender"]);
    assert.ok(existsSync(mutexFile), "release must never unlink the mutex file");
  });

  it("recovers a terminated writer, recovers its request, and records an independent next intent", async () => {
    const directory = scratch("capir-journal-crash-");
    const journal = new OperationJournal(directory);
    const mutexFile = journalMutex(directory);
    const writer = spawnScript(`
      import { OperationJournal } from ${JSON.stringify(JOURNAL_URL)};
      import { ProcessLock } from ${JSON.stringify(LOCK_URL)};
      const journal = new OperationJournal(${JSON.stringify(directory)});
      journal.ensureIntent(${JSON.stringify(intent("req-a"))});
      journal.updateStatus("req-a", "ambiguous");
      const lock = new ProcessLock(${JSON.stringify(mutexFile)});
      lock.acquire();
      process.stdout.write("held\\n");
      setInterval(() => {}, 1000);
    `);
    await writer.waitForOutput("held");
    writer.child.kill("SIGKILL");
    assert.equal(await writer.exited(), null); // SIGKILL: no cleanup ran
    assert.ok(existsSync(mutexFile), "the killed writer leaves the mutex file (never unlinked)");

    // Restart recovery is the OS's: the dead holder's reservation is already
    // gone and its uncommitted transaction rolls back automatically.
    const startedAt = Date.now();
    const existing = journal.find("req-a");
    assert.equal(existing?.status, "ambiguous", "prior request remains recoverable");
    journal.updateStatus("req-a", "dispatched");
    journal.ensureIntent(intent("req-b"));
    assert.ok(Date.now() - startedAt < 5_000, "recovery must not wait out a dead lock");
    assert.equal(journal.find("req-a")?.status, "dispatched");
    assert.equal(journal.find("req-b")?.status, "intent");
  });

  it("never steals a live writer's lock", async () => {
    const directory = scratch("capir-journal-live-");
    const journal = new OperationJournal(directory);
    journal.ensureIntent(intent("req-a"));
    const mutexFile = journalMutex(directory);
    const holder = spawnScript(`
      import { OperationJournal } from ${JSON.stringify(JOURNAL_URL)};
      import { ProcessLock } from ${JSON.stringify(LOCK_URL)};
      const lock = new ProcessLock(${JSON.stringify(mutexFile)});
      lock.acquire();
      process.stdout.write("held\\n");
      process.stdin.on("data", () => {
        lock.release();
        const journal = new OperationJournal(${JSON.stringify(directory)});
        journal.updateStatus("req-a", "dispatched");
        process.stdout.write("released\\n");
        process.exit(0);
      });
    `);
    await holder.waitForOutput("held");
    try {
      const observer = new OperationJournal(directory, {
        acquireTimeoutMs: 500,
        retryIntervalMs: 20,
      });
      assert.throws(() => observer.ensureIntent(intent("req-b")), /held by another process/);
      assert.deepEqual(
        new OperationJournal(directory).read().map((entry) => entry.request_id),
        ["req-a"],
        "the failed contender wrote nothing",
      );
      // The live holder still owns its lock: its own later mutation succeeds.
      holder.child.stdin.write("go\n");
      await holder.waitForOutput("released");
      assert.equal(new OperationJournal(directory).find("req-a")?.status, "dispatched");
    } finally {
      holder.child.kill("SIGKILL");
      await holder.exited().catch(() => {});
    }
    // After the holder is gone the next mutation recovers promptly.
    journal.ensureIntent(intent("req-b"));
    assert.equal(journal.find("req-b")?.status, "intent");
  });

  it("lets racing contenders after a crashed writer record every intent", async () => {
    const directory = scratch("capir-journal-race-");
    const journal = new OperationJournal(directory);
    const mutexFile = journalMutex(directory);
    const crashed = spawnScript(holdScript(mutexFile));
    await crashed.waitForOutput("held");
    crashed.child.kill("SIGKILL");
    await crashed.exited();

    const contenders = Array.from({ length: 4 }, (_, index) => spawnScript(`
      import { OperationJournal } from ${JSON.stringify(JOURNAL_URL)};
      const journal = new OperationJournal(${JSON.stringify(directory)});
      journal.ensureIntent(${JSON.stringify(intent(`race-${index}`))});
      process.stdout.write("recorded\\n");
    `));
    const codes = await Promise.all(contenders.map((contender) => contender.exited()));
    assert.deepEqual(codes, [0, 0, 0, 0], contenders.map((c) => c.stdout).join(" | "));
    const ids = journal.read().map((entry) => entry.request_id).sort();
    assert.deepEqual(ids, ["race-0", "race-1", "race-2", "race-3"], "no lost update under contention");
  });

  it("keeps the mutex file private, persistent and free of residue", async () => {
    const directory = scratch("capir-lock-file-");
    const mutexFile = join(directory, "proto.mutex.sqlite");
    const lock = new ProcessLock(mutexFile, { acquireTimeoutMs: 2_000 });
    lock.run(() => {});
    assert.ok(existsSync(mutexFile), "release must never unlink or rename the mutex file");
    assert.equal(statSync(mutexFile).mode & 0o777, 0o600, "mutex file stays owner-only");
    // A crashed holder leaves no manual recovery step behind.
    const crashed = spawnScript(holdScript(mutexFile));
    await crashed.waitForOutput("held");
    crashed.child.kill("SIGKILL");
    await crashed.exited();
    const started = Date.now();
    assert.equal(new ProcessLock(mutexFile, { acquireTimeoutMs: 2_000 }).run(() => "ok"), "ok");
    assert.ok(Date.now() - started < 1_500, "no stale reclamation delay after a crash");
  });
});
