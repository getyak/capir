import { createHash } from "node:crypto";
import { promises as fs, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

type Scenario = "fresh" | "build-failure";
type Outcome = { ok: true; value: string } | { ok: false; error: unknown };

function sqliteBusy(error: unknown): boolean {
  return error !== null && typeof error === "object" && "errcode" in error &&
    (error.errcode === 5 || error.errcode === 6);
}

function errorMetadata(error: unknown) {
  return {
    name: error instanceof Error ? error.name : typeof error,
    sqliteCode: error !== null && typeof error === "object" && "errcode" in error
      ? error.errcode : null,
    commandStatus: error !== null && typeof error === "object" && "status" in error
      ? error.status : null,
  };
}

async function exerciseFirstUseReader(scenario: Scenario): Promise<void> {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "talent-signal-build-release-")));
  const hostRoot = join(root, "apps", "agent-host");
  const testRoot = join(hostRoot, "src", "test");
  const dist = join(hostRoot, "dist");
  const entry = join(dist, "localResearchStore.js");
  const key = createHash("sha256").update(hostRoot).digest("hex").slice(0, 16);
  const lockPath = join(tmpdir(), `talent-signal-agent-host-build-${key}.sqlite`);
  const marker = join(root, "synthetic-build-invocations.txt");
  const buildFailure = "isolated fixture build command failed";
  let ownsLockPath = false;
  let writer: DatabaseSync | undefined;
  let reader: DatabaseSync | undefined;
  let probe: DatabaseSync | undefined;
  let distinctLiveReader = false;
  let readerTransaction = false;
  let probeTransaction = false;
  let observerError: unknown;
  let releaseError: unknown;
  let releaseAttempts = 0;
  let releaseAcknowledgements = 0;
  let readerChecks = 0;
  let journalMode: unknown;
  let beforeBegin: { dev: number; ino: number; size: number; header: string } | undefined;
  const events: string[] = [];
  const actualExec = DatabaseSync.prototype.exec;
  let restoreExec: (() => void) | undefined;
  let restoreStat: (() => void) | undefined;
  let restoreClose: (() => void) | undefined;

  const readSnapshot = () => {
    if (!reader || !readerTransaction) throw new Error("The actual reader is not held");
    const row = reader.prepare("SELECT COUNT(*) AS entries FROM sqlite_schema").get();
    if (row?.entries !== 0) throw new Error("The fresh lock database acquired unexpected schema");
    readerChecks += 1;
    return row;
  };
  const closeReader = () => {
    if (!reader) return;
    try {
      if (readerTransaction) actualExec.call(reader, "ROLLBACK");
    } finally {
      readerTransaction = false;
      reader.close();
      reader = undefined;
    }
  };

  try {
    for (const directory of [testRoot, dist, join(root, "apps", "agent", "src"),
      join(root, "packages", "contracts", "src")]) {
      await fs.mkdir(directory, { recursive: true });
    }
    const fixture = join(testRoot, "research-store-worker.mjs");
    // The semaphore and its only exported caller are copied byte-for-byte.
    await fs.copyFile(new URL("./test/research-store-worker.mjs", import.meta.url), fixture);
    await fs.writeFile(join(hostRoot, "src", "fresh.ts"), "export {};\n");
    if (scenario === "fresh") {
      await fs.writeFile(entry, "export {};\n");
      const future = new Date(Date.now() + 60_000);
      await fs.utimes(entry, future, future);
    } else {
      // A non-file entry makes the real freshness check request a build.
      await fs.mkdir(entry);
    }
    const bin = join(root, "bin");
    await fs.mkdir(bin);
    // This isolated command is the only executable named pnpm on this test's
    // leading PATH. It exercises execFileSync's real error, never a real build.
    await fs.writeFile(join(bin, "pnpm"), [
      "#!/bin/sh",
      "printf '%s\\n' 'synthetic-build-command' >> \"$CAPIR_BUILD_LOCK_TEST_MARKER\"",
      `printf '%s\\n' '${buildFailure}' >&2`,
      "exit 73",
      "",
    ].join("\n"), { mode: 0o700 });
    vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH ?? ""}`);
    vi.stubEnv("CAPIR_BUILD_LOCK_TEST_MARKER", marker);
    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    ownsLockPath = true;

    // Default spies forward the real methods. The exec observer also forwards
    // each call exactly once, preserving its receiver, result and thrown error.
    const statSpy = vi.spyOn(fs, "stat");
    restoreStat = () => statSpy.mockRestore();
    const closeSpy = vi.spyOn(DatabaseSync.prototype, "close");
    restoreClose = () => closeSpy.mockRestore();
    const execSpy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      if (sql === "BEGIN IMMEDIATE" && !writer) {
        const metadata = statSync(lockPath);
        beforeBegin = { dev: metadata.dev, ino: metadata.ino, size: metadata.size,
          header: readFileSync(lockPath).subarray(0, 16).toString("hex") };
        const result = actualExec.call(this, sql);
        writer = this;
        events.push("writer-acquired");
        try {
          reader = new DatabaseSync(lockPath, { readOnly: true });
          distinctLiveReader = reader !== this;
          actualExec.call(reader, "BEGIN");
          readerTransaction = true;
          readSnapshot();
          journalMode = reader.prepare("PRAGMA journal_mode").get()?.journal_mode;
          events.push("real-reader-held");
        } catch (error) {
          // An observation setup failure must not masquerade as a BUSY result
          // from the helper's acquisition. It is mandatory below, never skipped.
          observerError = error;
        }
        return result;
      }
      if (this === writer && /^(COMMIT|END|ROLLBACK)( TRANSACTION)?$/.test(sql.trim().toUpperCase())) {
        releaseAttempts += 1;
        try {
          readSnapshot();
          events.push("reader-live-at-release");
        } catch (error) {
          observerError ??= error;
        }
        try {
          const result = actualExec.call(this, sql);
          releaseAcknowledgements += 1;
          events.push("real-release-acknowledged");
          return result;
        } catch (error) {
          releaseError = error;
          events.push("real-release-rejected");
          throw error;
        }
      }
      return actualExec.call(this, sql);
    });
    restoreExec = () => execSpy.mockRestore();

    const copied = await import(pathToFileURL(fixture).href) as {
      ensureFreshHostBuild(): Promise<string>;
    };
    const outcome: Outcome = await copied.ensureFreshHostBuild().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const afterRelease = statSync(lockPath);
    const actionChecks = statSpy.mock.calls.filter(([path]) => path === entry).length;
    const ownerCloses = closeSpy.mock.contexts.filter((context) => context === writer).length;
    const evidence = JSON.stringify({ scenario, beforeBytes: beforeBegin?.size,
      beforeHeader: beforeBegin?.header, journalMode, actionChecks, ownerCloses,
      distinctLiveReader, readerChecks, releaseAttempts, releaseAcknowledgements, events,
      releaseError: releaseError === undefined ? null : errorMetadata(releaseError),
      outcome: outcome.ok ? "returned" : errorMetadata(outcome.error) });
    // Only content-free fixture metadata is emitted; no environment or paths.
    console.info("fixture-build-lock-release", evidence);
    expect(observerError, evidence).toBeUndefined();
    expect(beforeBegin?.size, evidence).toBe(0);
    expect(beforeBegin?.header, evidence).toBe("");
    expect(journalMode, evidence).toBe("delete");
    // Assert only the live identity witness, never a closed native handle.
    expect(distinctLiveReader, evidence).toBe(true);
    expect(readerTransaction, evidence).toBe(true);
    expect(readerChecks, evidence).toBe(2);
    expect(actionChecks, evidence).toBe(1);
    expect(ownerCloses, evidence).toBe(1);
    expect(afterRelease.dev, evidence).toBe(beforeBegin?.dev);
    expect(afterRelease.ino, evidence).toBe(beforeBegin?.ino);

    // The original action has settled while the same actual reader is held.
    // A new writer may acquire, but EXCLUSIVE must still be denied by that
    // reader after the original owner is closed. These are real SQLite calls.
    readSnapshot();
    probe = new DatabaseSync(lockPath);
    actualExec.call(probe, "PRAGMA busy_timeout = 0;");
    actualExec.call(probe, "BEGIN IMMEDIATE");
    probeTransaction = true;
    actualExec.call(probe, "ROLLBACK");
    probeTransaction = false;
    let exclusiveError: unknown;
    try {
      actualExec.call(probe, "BEGIN EXCLUSIVE");
      probeTransaction = true;
    } catch (error) {
      exclusiveError = error;
    }
    if (probeTransaction) {
      actualExec.call(probe, "ROLLBACK");
      probeTransaction = false;
    }
    expect(sqliteBusy(exclusiveError), evidence).toBe(true);
    closeReader();
    actualExec.call(probe, "BEGIN EXCLUSIVE");
    probeTransaction = true;
    actualExec.call(probe, "ROLLBACK");
    probeTransaction = false;

    expect(releaseAttempts, evidence).toBe(1);
    expect(releaseAcknowledgements, evidence).toBe(1);
    expect(releaseError, evidence).toBeUndefined();
    if (scenario === "fresh") {
      expect(outcome, evidence).toEqual({ ok: true, value: dist });
      await expect(fs.stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      expect(outcome.ok, evidence).toBe(false);
      if (outcome.ok) throw new Error("The isolated failing build unexpectedly returned");
      expect(outcome.error, evidence).toMatchObject({ status: 73, signal: null });
      const error = outcome.error;
      const stderr = error !== null && typeof error === "object" && "stderr" in error
        ? error.stderr : undefined;
      expect(Buffer.isBuffer(stderr), evidence).toBe(true);
      if (!Buffer.isBuffer(stderr)) throw new Error("Expected the real command's stderr buffer");
      expect(stderr.toString("utf8"), evidence).toBe(`${buildFailure}\n`);
      await expect(fs.readFile(marker, "utf8")).resolves.toBe("synthetic-build-command\n");
    }
  } finally {
    restoreExec?.();
    restoreStat?.();
    restoreClose?.();
    try {
      if (probe) {
        try {
          if (probeTransaction) actualExec.call(probe, "ROLLBACK");
        } finally {
          probe.close();
        }
      }
    } finally {
      try {
        closeReader();
      } finally {
        vi.unstubAllEnvs();
        await Promise.all([
          ownsLockPath ? fs.rm(lockPath, { force: true }) : Promise.resolve(),
          fs.rm(root, { recursive: true, force: true }),
        ]);
      }
    }
  }
}

describe("first-use shared fixture build-lock release", () => {
  it("returns a fresh entry once while a real reader survives cleanup", async () => {
    await exerciseFirstUseReader("fresh");
  }, 15_000);

  it("preserves the real build-command failure while a reader survives cleanup", async () => {
    await exerciseFirstUseReader("build-failure");
  }, 15_000);
});
