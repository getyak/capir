/**
 * Process-lifetime OS writer-reservation lock (one internal SQLite mutex file
 * per logical lock), shared by the operation journal and the origin-pair
 * credential mutation boundary so both use one safe protocol.
 *
 * Protocol: acquisition is a single SQLite `BEGIN IMMEDIATE`, which takes the
 * database file's POSIX advisory write reservation (sqlite.org/lockingv3.html)
 * and holds it for the length of an open transaction until release commits.
 * There is deliberately NO check-then-mutate step anywhere in this protocol:
 * the reservation, the critical section and the release are one OS-enforced
 * sequence, so a contender can never steal a live holder's lock the way a
 * read-owner-then-rename protocol can (see the parent-lock-precheck
 * counterexample for that failure mode).
 *
 * Crash recovery is the OS's: advisory locks are released the moment a process
 * dies, and SQLite rolls back the dead holder's uncommitted transaction on the
 * next access (sqlite.org/lang_transaction.html). No owner liveness heuristics,
 * PID-reuse windows, stale reclamation or manual recovery exist. The mutex
 * file is intentionally NEVER unlinked or renamed by release: splitting the
 * inode would split the lock. It stores no credential or business data (only
 * an uncommitted, self-deleted holder record) and is kept mode 0600.
 *
 * Wait modes: `acquire`/`run` are for synchronous critical sections only and
 * sleep between bounded non-blocking attempts; `acquireAsync`/`runAsync`
 * yield to the event loop between attempts so a contender in this process can
 * never freeze timers behind a holder that awaits inside the lock.
 *
 * Platform: Node's built-in `node:sqlite` (DatabaseSync) — no external
 * dependency. Verified against the installed Node runtime and
 * https://nodejs.org/api/sqlite.html ; `timeout: 0` makes contention return
 * SQLITE_BUSY immediately instead of blocking.
 */
import { createRequire } from "node:module";
import { chmodSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export interface ProcessLockOptions {
  /** How long a caller waits for a live holder before failing. */
  acquireTimeoutMs?: number;
  retryIntervalMs?: number;
  /**
   * Test-only scheduling seam for deterministic interleaving regressions:
   * invoked before every reservation attempt. Synchronous callers must pass a
   * synchronous seam (e.g. a SIGSTOP gate); async callers may await.
   */
  beforeAttempt?: (attempt: number) => void | Promise<void>;
}

interface MutexStatement {
  run(...params: unknown[]): unknown;
}

interface MutexDatabase {
  exec(sql: string): void;
  prepare(sql: string): MutexStatement;
  close(): void;
}

type SqliteDatabase = {
  DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean; timeout?: number },
  ) => MutexDatabase;
};

let sqlite: SqliteDatabase | null = null;

function loadSqlite(): SqliteDatabase {
  if (!sqlite) {
    const require = createRequire(import.meta.url);
    // node:sqlite is built in but still labeled experimental on Node 22 and
    // prints one load-time ExperimentalWarning. Suppress exactly that known
    // line (restoring process.emitWarning immediately) so the CLI's stderr
    // stays deterministic; no behavior or error is hidden.
    const emitWarning = process.emitWarning;
    process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
      if (String(warning).includes("SQLite is an experimental feature")) return;
      return (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
    }) as typeof process.emitWarning;
    try {
      sqlite = require("node:sqlite") as SqliteDatabase;
    } finally {
      process.emitWarning = emitWarning;
    }
  }
  return sqlite;
}

function isBusy(error: unknown): boolean {
  const code = (error as { errcode?: number }).errcode;
  const message = error instanceof Error ? error.message : String(error);
  return code === 5 /* SQLITE_BUSY */ || code === 6 /* SQLITE_LOCKED */ ||
    message.includes("database is locked") || message.includes("database table is locked");
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class ProcessLock {
  /** Mutex file path; never unlinked or renamed while or after in use. */
  readonly path: string;
  private readonly acquireTimeoutMs: number;
  private readonly retryIntervalMs: number;
  private readonly beforeAttempt: ((attempt: number) => void | Promise<void>) | undefined;
  private db: MutexDatabase | null = null;
  private held = false;
  private readonly owner = {
    pid: process.pid,
    owner_id: randomUUID(),
    acquired_at: new Date().toISOString(),
  };

  constructor(mutexFile: string, options: ProcessLockOptions = {}) {
    this.path = mutexFile;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? 10_000;
    this.retryIntervalMs = options.retryIntervalMs ?? 10;
    this.beforeAttempt = options.beforeAttempt;
  }

  /**
   * Bounded blocking acquisition for synchronous critical sections (journal).
   * The seam is invoked synchronously; async seams belong to acquireAsync.
   */
  acquire(): void {
    const deadline = Date.now() + this.acquireTimeoutMs;
    for (let attempt = 1; !this.tryOnceSync(attempt); attempt++) {
      if (Date.now() >= deadline) throw this.heldError();
      sleepMs(this.retryIntervalMs);
    }
  }

  /**
   * Non-blocking acquisition for asynchronous critical sections (credential
   * transactions): waits on timers so a contender in this process can never
   * block the event loop behind a holder that awaits inside the lock.
   */
  async acquireAsync(): Promise<void> {
    const deadline = Date.now() + this.acquireTimeoutMs;
    for (let attempt = 1; ; attempt++) {
      await this.beforeAttempt?.(attempt);
      if (this.reserve()) return;
      if (Date.now() >= deadline) throw this.heldError();
      await new Promise((resolve) => setTimeout(resolve, this.retryIntervalMs));
    }
  }

  release(): void {
    if (!this.held || !this.db) return;
    this.held = false;
    const db = this.db;
    this.db = null;
    try {
      db.prepare("DELETE FROM mutex_owner").run();
      db.exec("COMMIT");
    } catch {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* the reservation is gone either way */
      }
    }
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }

  run<T>(operation: () => T): T {
    this.acquire();
    try {
      return operation();
    } finally {
      this.release();
    }
  }

  async runAsync<T>(operation: () => T | Promise<T>): Promise<T> {
    await this.acquireAsync();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private tryOnceSync(attempt: number): boolean {
    const seam = this.beforeAttempt?.(attempt) as unknown;
    if (seam && typeof (seam as Promise<void>).then === "function") {
      throw new Error("ProcessLock.acquire() requires a synchronous beforeAttempt seam.");
    }
    return this.reserve();
  }

  private reserve(): boolean {
    const db = (this.db ??= this.open());
    try {
      db.exec("BEGIN IMMEDIATE");
    } catch (error) {
      if (isBusy(error)) return false;
      throw error;
    }
    try {
      db.prepare(
        "CREATE TABLE IF NOT EXISTS mutex_owner(pid INTEGER NOT NULL, owner_id TEXT NOT NULL, acquired_at TEXT NOT NULL)",
      ).run();
      db.prepare("INSERT INTO mutex_owner(pid, owner_id, acquired_at) VALUES(?,?,?)").run(
        this.owner.pid,
        this.owner.owner_id,
        this.owner.acquired_at,
      );
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* nothing was reserved */
      }
      throw error;
    }
    this.held = true;
    return true;
  }

  private open(): MutexDatabase {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const { DatabaseSync } = loadSqlite();
    // timeout: 0 => contention surfaces as SQLITE_BUSY immediately; the retry
    // loops above own all waiting policy.
    const db = new DatabaseSync(this.path, { readOnly: false, timeout: 0 });
    chmodSync(this.path, 0o600);
    return db;
  }

  private heldError(): Error {
    return new Error(
      `Lock ${this.path} is held by another process; waited ${this.acquireTimeoutMs}ms.`,
    );
  }
}
