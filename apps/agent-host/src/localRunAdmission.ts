import { constants, promises as fs } from "node:fs";
import { join } from "node:path";

import { DatabaseSync } from "node:sqlite";

import { assertLocalRunID } from "./localResearchFiles.js";

const ADMISSION_DATABASE = "admission.sqlite";

/**
 * Thrown when another live process already holds whole-Run admission. The
 * SQLite BEGIN IMMEDIATE lock is fail-closed with a zero busy timeout: a
 * contending invocation is rejected instead of waiting or stealing.
 */
export class LocalRunAdmissionBusyError extends Error {
  constructor(runDirectory: string) {
    super(
      `The local Run directory is already being executed by another process: ${runDirectory}`,
    );
    this.name = "LocalRunAdmissionBusyError";
  }
}

export interface LocalRunAdmissionTarget {
  /** The immutable Run directory (for example `<stateRoot>/runs/<runID>`). */
  runDirectory: string;
  runID: string;
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function isBusy(error: unknown): boolean {
  if (!(error instanceof Error) || !("errcode" in error)) return false;
  const errcode = (error as { errcode?: number }).errcode;
  return errcode === 5 /* SQLITE_BUSY */ || errcode === 6 /* SQLITE_LOCKED */;
}

/**
 * Opens (or creates) the per-Run coordination database as a secure regular
 * file: owner-only directory, owner-only file, never following a symlink and
 * never replacing a non-regular target. The database stores no person or
 * provider content and no schema data; it only hosts the SQLite lock.
 */
async function openAdmissionDatabase(
  runDirectory: string,
): Promise<DatabaseSync> {
  await fs.mkdir(runDirectory, { recursive: true, mode: 0o700 });
  await fs.chmod(runDirectory, 0o700);
  const path = join(runDirectory, ADMISSION_DATABASE);
  const handle = await fs.open(
    path,
    constants.O_RDWR |
      constants.O_CREAT |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new Error("The local Run admission database must be a regular file.");
    }
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  return new DatabaseSync(path, { readOnly: false });
}

/**
 * Runs one whole-Run critical section under cross-process admission.
 *
 * A single SQLite `BEGIN IMMEDIATE` transaction on the per-Run
 * `admission.sqlite` is held across the async callback and released through
 * `COMMIT`/`ROLLBACK` plus `close` in every path, including callback failure.
 * The busy timeout is zero: a held Run fails closed with
 * {@link LocalRunAdmissionBusyError} before the callback (and therefore before
 * any model or network call) runs. SQLite corruption and I/O failures are
 * neither busy nor success. The database is never deleted while active;
 * kernel/SQLite lock ownership releases on process death, so a fresh
 * invocation reacquires without lock stealing, stale-pid unlinking, or rename
 * recovery.
 */
export async function withLocalRunAdmission<T>(
  target: LocalRunAdmissionTarget,
  execute: () => Promise<T>,
): Promise<T> {
  assertLocalRunID(target.runID);
  const database = await openAdmissionDatabase(target.runDirectory);
  let result: T | undefined;
  let completed = false;
  let inTransaction = false;
  let failed = false;
  let failure: unknown = null;
  try {
    database.exec("PRAGMA busy_timeout = 0;");
    try {
      database.exec("BEGIN IMMEDIATE");
      inTransaction = true;
    } catch (error) {
      if (isBusy(error)) {
        throw new LocalRunAdmissionBusyError(target.runDirectory);
      }
      throw error;
    }
    result = await execute();
    database.exec("COMMIT");
    inTransaction = false;
    completed = true;
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (inTransaction) {
    try {
      database.exec("ROLLBACK");
    } catch (rollbackFailure) {
      if (!failed) {
        failed = true;
        failure = rollbackFailure;
      }
    }
  }
  try {
    database.close();
  } catch (closeFailure) {
    if (!failed) {
      failed = true;
      failure = closeFailure;
    }
  }
  if (failed) throw failure;
  if (!completed) throw new Error("The local Run admission did not complete.");
  return result as T;
}
