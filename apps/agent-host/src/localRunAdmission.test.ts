import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  LocalRunAdmissionBusyError,
  withLocalRunAdmission,
} from "./localRunAdmission.js";
import {
  cleanupResearchWorkers,
  ensureFreshHostBuild,
  spawnResearchWorker,
} from "./test/research-store-worker.mjs";

const temporaryDirectories: string[] = [];
const runID = "11111111-1111-4111-8111-111111111111";
const otherRunID = "12121212-1212-4121-8121-121212121212";

beforeAll(async () => {
  await ensureFreshHostBuild();
}, 180_000);

afterEach(async () => {
  // Terminate and settle owned workers before removing their state
  // directories, even when a barrier failed while a holder is blocked.
  await cleanupResearchWorkers();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makeRunDirectory() {
  const stateRoot = await fs.mkdtemp(
    join(tmpdir(), "talent-signal-admission-"),
  );
  temporaryDirectories.push(stateRoot);
  return join(stateRoot, "runs", runID);
}

describe("local whole-Run admission", () => {
  it("runs one callback under admission and keeps owner-only coordination files", async () => {
    const runDirectory = await makeRunDirectory();
    let calls = 0;
    const value = await withLocalRunAdmission(
      { runDirectory, runID },
      async () => {
        calls += 1;
        return "done";
      },
    );
    expect(value).toBe("done");
    expect(calls).toBe(1);

    const database = join(runDirectory, "admission.sqlite");
    const databaseMetadata = await fs.stat(database);
    expect(databaseMetadata.isFile()).toBe(true);
    expect(databaseMetadata.mode & 0o777).toBe(0o600);
    expect((await fs.stat(runDirectory)).mode & 0o777).toBe(0o700);

    // Normal release: the same Run is immediately acquirable again.
    await expect(
      withLocalRunAdmission({ runDirectory, runID }, async () => "again"),
    ).resolves.toBe("again");
  });

  it("releases admission when the callback fails", async () => {
    const runDirectory = await makeRunDirectory();
    await expect(
      withLocalRunAdmission({ runDirectory, runID }, async () => {
        throw new Error("callback failed");
      }),
    ).rejects.toThrow("callback failed");
    await expect(
      withLocalRunAdmission({ runDirectory, runID }, async () => "released"),
    ).resolves.toBe("released");
  });

  it("rejects a held Run before the callback and admits a different Run", async () => {
    const runDirectory = await makeRunDirectory();
    const holder = spawnResearchWorker({
      kind: "hold-admission",
      runDirectory,
      runID,
      holdUntil: "release",
    });
    await holder.waitFor("ready");
    holder.send("go");
    await holder.waitFor("acquired");

    let called = false;
    await expect(
      withLocalRunAdmission({ runDirectory, runID }, async () => {
        called = true;
      }),
    ).rejects.toBeInstanceOf(LocalRunAdmissionBusyError);
    expect(called).toBe(false);

    // A second real process is rejected busy before its own callback runs.
    const duplicate = spawnResearchWorker({
      kind: "hold-admission",
      runDirectory,
      runID,
      holdUntil: "release",
    });
    await duplicate.waitFor("ready");
    duplicate.send("go");
    await expect(duplicate.result).resolves.toMatchObject({
      ok: false,
      errorName: "LocalRunAdmissionBusyError",
    });
    expect(
      duplicate.log.filter((event) => event.event === "acquired"),
    ).toHaveLength(0);

    // A different Run stays independently executable.
    await expect(
      withLocalRunAdmission(
        { runDirectory: join(dirname(runDirectory), otherRunID), runID: otherRunID },
        async () => "independent",
      ),
    ).resolves.toBe("independent");

    holder.send("release");
    await expect(holder.result).resolves.toMatchObject({ ok: true });
    await expect(
      withLocalRunAdmission({ runDirectory, runID }, async () => "released"),
    ).resolves.toBe("released");
  });

  it("reacquires after killing the owner without deleting the lock", async () => {
    const runDirectory = await makeRunDirectory();
    const holder = spawnResearchWorker({
      kind: "hold-admission",
      runDirectory,
      runID,
      holdUntil: "kill",
    });
    await holder.waitFor("ready");
    holder.send("go");
    await holder.waitFor("acquired");
    holder.kill("SIGKILL");
    await expect(holder.result).rejects.toThrow();

    // The kernel releases the lock on process death; a fresh invocation
    // reacquires against the same coordination database, which is never
    // deleted or renamed away.
    await expect(
      withLocalRunAdmission({ runDirectory, runID }, async () => "reacquired"),
    ).resolves.toBe("reacquired");
    const database = await fs.stat(join(runDirectory, "admission.sqlite"));
    expect(database.isFile()).toBe(true);
    expect(database.mode & 0o777).toBe(0o600);
  });

  it("treats a corrupt coordination database as an error, not busy or success", async () => {
    const runDirectory = await makeRunDirectory();
    await fs.mkdir(runDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      join(runDirectory, "admission.sqlite"),
      "not a sqlite database",
      { mode: 0o600 },
    );
    let called = false;
    const failure = await withLocalRunAdmission(
      { runDirectory, runID },
      async () => {
        called = true;
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(LocalRunAdmissionBusyError);
    expect(called).toBe(false);
  });

  it("rejects a symlinked or non-regular coordination database", async () => {
    const runDirectory = await makeRunDirectory();
    await fs.mkdir(runDirectory, { recursive: true, mode: 0o700 });
    const target = join(runDirectory, "elsewhere.sqlite");
    await fs.writeFile(target, "private-target", { mode: 0o600 });
    const databasePath = join(runDirectory, "admission.sqlite");
    await fs.symlink(target, databasePath);

    let called = false;
    const failure = await withLocalRunAdmission(
      { runDirectory, runID },
      async () => {
        called = true;
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(LocalRunAdmissionBusyError);
    expect(called).toBe(false);
    expect(await fs.readFile(target, "utf8")).toBe("private-target");
    expect((await fs.lstat(databasePath)).isSymbolicLink()).toBe(true);

    await fs.unlink(databasePath);
    await fs.mkdir(databasePath);
    const nonRegularFailure = await withLocalRunAdmission(
      { runDirectory, runID },
      async () => {
        called = true;
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(nonRegularFailure).toBeInstanceOf(Error);
    expect(nonRegularFailure).not.toBeInstanceOf(LocalRunAdmissionBusyError);
    expect(called).toBe(false);

    // A FIFO target is rejected as non-regular instead of blocking the open.
    await fs.rmdir(databasePath);
    execFileSync("mkfifo", [databasePath]);
    const fifoFailure = await withLocalRunAdmission(
      { runDirectory, runID },
      async () => {
        called = true;
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(fifoFailure).toBeInstanceOf(Error);
    expect(fifoFailure).not.toBeInstanceOf(LocalRunAdmissionBusyError);
    expect(called).toBe(false);
  });

  it("cleans up its own blocked holder and settles pending IPC waiters", async () => {
    const runDirectory = await makeRunDirectory();
    const holder = spawnResearchWorker({
      kind: "hold-admission",
      runDirectory,
      runID,
      holdUntil: "release",
    });
    await holder.waitFor("ready");
    holder.send("go");
    await holder.waitFor("acquired");
    const abandoned = holder.waitFor("event-that-never-arrives");

    // Barrier failure simulation: cleanup terminates the blocked holder this
    // module owns and settles every pending waiter without any sleep race.
    await cleanupResearchWorkers();

    await expect(holder.result).rejects.toThrow(/before a result/u);
    await expect(abandoned).rejects.toThrow(/waiter was pending/u);
    expect(
      holder.child.exitCode !== null || holder.child.signalCode !== null,
    ).toBe(true);

    // Cleanup is idempotent and the Run state becomes removable afterwards
    // (afterEach removes temporary directories only after this cleanup).
    await cleanupResearchWorkers();
    await expect(
      withLocalRunAdmission({ runDirectory, runID }, async () => "released"),
    ).resolves.toBe("released");
  });
});
