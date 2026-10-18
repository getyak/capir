import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";

const LOCAL_RECORD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** Canonical lowercase SHA-256 digest, exactly as current producers emit. */
const LOCAL_RECORD_FINGERPRINT = /^[0-9a-f]{64}$/u;

/**
 * Fixed content-free message for malformed persisted JSON. Node's
 * `JSON.parse` `SyntaxError.message` may quote the persisted person/provider
 * payload, so the raw parser error is never propagated, logged, or attached as
 * a cause.
 */
export const LOCAL_JSON_MALFORMED_MESSAGE =
  "The persisted local JSON record is malformed.";

/** Fixed content-free message for a present record with a corrupt envelope. */
export const LOCAL_JSON_CORRUPT_MESSAGE =
  "The persisted local JSON record is corrupt.";

export const LOCAL_RECORD_NOT_REGULAR_MESSAGE =
  "The persisted local JSON record must be a regular file.";

/**
 * Fixed content-free message for a nonempty JSONL journal whose final record
 * lacks its terminating newline. Such a record may be a torn write whose
 * partial line would even parse as JSON; it is never treated as a complete
 * record, so a future append cannot silently concatenate JSON objects.
 */
export const LOCAL_JSONL_TRUNCATED_MESSAGE =
  "The persisted local JSONL record is truncated.";

/** Content-free, kind-specific corruption error used by record validators. */
export function localRecordCorruptError(kind: string): Error {
  return new Error(`The persisted local ${kind} record is corrupt.`);
}

export function isLocalRecordID(value: unknown): value is string {
  return typeof value === "string" && LOCAL_RECORD_ID.test(value);
}

export function isLocalRecordFingerprint(value: unknown): value is string {
  return typeof value === "string" && LOCAL_RECORD_FINGERPRINT.test(value);
}

export function isLocalRecordTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isLocalRecordObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

export function isLocalRecordStringArray(
  value: unknown,
): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isLocalRecordFingerprintArray(
  value: unknown,
): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => isLocalRecordFingerprint(item))
  );
}

/** Persisted call counts and journal positions cannot create new allowance. */
export function isLocalRecordCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Membership guard for the existing closed string vocabularies. */
export function isLocalRecordEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && allowed.some((item) => item === value);
}

export function assertLocalRunID(runID: string): void {
  if (!isLocalRecordID(runID)) throw new Error("The local run ID must be a UUID.");
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

export type LocalRecordParser<T> = (value: Record<string, unknown>) => T;

/**
 * Opens one persisted record for reading, returning `null` only when the path
 * is genuinely absent (ENOENT). The open is non-blocking and never follows a
 * symlink: a FIFO or other non-regular target is rejected by the post-open
 * fstat instead of blocking this reader before the stat. All other I/O errors
 * propagate. The returned handle is owned by the caller and must be closed.
 */
async function openPersistedRegularFile(
  path: string,
): Promise<fs.FileHandle | null> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    if (isErrno(error, "ELOOP")) {
      throw new Error(LOCAL_RECORD_NOT_REGULAR_MESSAGE);
    }
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error(LOCAL_RECORD_NOT_REGULAR_MESSAGE);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/**
 * Reads one persisted JSON record. Returns `null` only when the path is
 * genuinely absent (ENOENT). The open is non-blocking and never follows a
 * symlink: a FIFO or other non-regular target is rejected by the post-open
 * fstat instead of blocking this reader before the stat. Malformed JSON raises
 * the fixed content-free message; a null/array/other non-object envelope is
 * corrupt, not absent. All other I/O errors propagate.
 */
export async function readPersistedJsonRecord<T>(
  path: string,
  parse: LocalRecordParser<T>,
): Promise<T | null> {
  const handle = await openPersistedRegularFile(path);
  if (handle === null) return null;
  try {
    const text = await handle.readFile("utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(LOCAL_JSON_MALFORMED_MESSAGE);
    }
    if (!isLocalRecordObject(parsed)) throw new Error(LOCAL_JSON_CORRUPT_MESSAGE);
    return parse(parsed);
  } finally {
    await handle.close();
  }
}

/**
 * Reads the complete newline-terminated records of one persisted JSONL file.
 * Returns `[]` when the path is genuinely absent (ENOENT) or empty. The same
 * private-file, no-follow, non-blocking, regular-file guarantees as
 * {@link readPersistedJsonRecord} apply. A nonempty file whose final record
 * lacks its terminating newline is a torn write and raises the fixed
 * {@link LOCAL_JSONL_TRUNCATED_MESSAGE} even when that partial line would
 * parse as JSON; the ordinary trailing newline stays valid.
 */
export async function readPersistedJsonlLines(path: string): Promise<string[]> {
  const handle = await openPersistedRegularFile(path);
  if (handle === null) return [];
  try {
    const text = await handle.readFile("utf8");
    if (text.length === 0) return [];
    if (!text.endsWith("\n")) throw new Error(LOCAL_JSONL_TRUNCATED_MESSAGE);
    return text.split("\n").slice(0, -1);
  } finally {
    await handle.close();
  }
}

export interface ImmutableRecordPublication<T> {
  record: T;
  replayed: boolean;
}

/**
 * Publishes one immutable record without ever replacing an existing target.
 *
 * The record is written to a complete same-directory exclusive temporary file
 * (0600), flushed, then atomically published with `fs.link(temp, target)`.
 * `link` fails with EEXIST instead of replacing a published record. On EEXIST
 * the authoritative persisted record is read back and validated by
 * `resolveExisting`, which either returns the original record (equivalent
 * replay) or throws (conflict/corrupt). Only the temporary file created and
 * owned by this invocation is ever cleaned up; a pre-existing temporary path
 * (exclusive-create collision) keeps its bytes and fails this publication.
 */
export async function publishImmutableJsonRecord<T>(
  path: string,
  record: T,
  resolveExisting: LocalRecordParser<T>,
): Promise<ImmutableRecordPublication<T>> {
  const temporary = join(
    dirname(path),
    `${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let publication: ImmutableRecordPublication<T> | null = null;
  let ownsTemporary = false;
  let failed = false;
  let failure: unknown = null;
  try {
    const handle = await fs.open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    ownsTemporary = true;
    try {
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, path);
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
      const existing = await readPersistedJsonRecord(path, resolveExisting);
      if (existing === null) {
        throw new Error(
          "The existing persisted local record disappeared during publication.",
        );
      }
      publication = { record: existing, replayed: true };
    }
    publication ??= { record, replayed: false };
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (ownsTemporary) {
    try {
      await fs.unlink(temporary);
    } catch (cleanupFailure) {
      if (!isErrno(cleanupFailure, "ENOENT") && !failed) {
        failed = true;
        failure = cleanupFailure;
      }
    }
  }
  if (failed) throw failure;
  if (publication === null) {
    throw new Error("The immutable local record publication did not complete.");
  }
  return publication;
}

/**
 * Replaces one mutable record (checkpoint only) with an atomic same-directory
 * rename. The temporary file is created exclusively so this invocation owns
 * exactly one temporary file, which is cleaned up on every path including
 * partial write or serialization failure; a pre-existing temporary path keeps
 * its bytes and fails this write.
 */
export async function replaceMutableJsonRecord(
  path: string,
  value: unknown,
): Promise<void> {
  const temporary = join(
    dirname(path),
    `${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let ownsTemporary = false;
  let failed = false;
  let failure: unknown = null;
  try {
    const handle = await fs.open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    ownsTemporary = true;
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, path);
    // Rename consumed our directory entry. A later writer may now own this
    // temporary pathname, so no subsequent cleanup may unlink it.
    ownsTemporary = false;
    await fs.chmod(path, 0o600);
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (ownsTemporary) {
    try {
      await fs.unlink(temporary);
    } catch (cleanupFailure) {
      if (!isErrno(cleanupFailure, "ENOENT") && !failed) {
        failed = true;
        failure = cleanupFailure;
      }
    }
  }
  if (failed) throw failure;
}
