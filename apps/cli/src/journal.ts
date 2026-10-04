/**
 * Private, owner-scoped operation journal.
 *
 * Client intent is persisted (request IDs and semantic digests only, never
 * secrets) BEFORE the first dispatch so an ambiguous retry can resume the same
 * operation instead of creating a copy. The journal file lives in the private
 * config directory with owner-only permissions.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { configDirectory } from "./config.js";
import { ProcessLock, type ProcessLockOptions } from "./lock.js";

export type OperationKind =
  | "sandbox.start"
  | "sandbox.stop"
  | "sandbox.handoff"
  | "test.create"
  | "test.stop"
  | "test.handoff";
export type JournalStatus = "intent" | "dispatched" | "ambiguous" | "completed";

export interface JournalEntry {
  request_id: string;
  kind: OperationKind;
  environment: string;
  backend_origin: string;
  web_origin: string;
  digest: string;
  created_at: string;
  status: JournalStatus;
  sandbox_id?: string;
  /** Nonsecret recovery metadata only: never a password or any hash of one. */
  run_id?: string;
  credential_identity?: "generated" | "supplied";
}

export function semanticDigest(input: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    const value = input[key];
    if (value !== undefined) sorted[key] = value;
  }
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

export class OperationJournal {
  readonly path: string;
  private readonly lockOptions: ProcessLockOptions;

  constructor(directory = configDirectory(), lockOptions: ProcessLockOptions = {}) {
    this.path = join(directory, "operations.json");
    this.lockOptions = lockOptions;
  }

  read(): JournalEntry[] {
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(raw) ? (raw as JournalEntry[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  find(requestId: string): JournalEntry | undefined {
    return this.read().find((entry) => entry.request_id === requestId);
  }

  /** Atomic across CLI processes: check conflicts and persist before dispatch. */
  ensureIntent(entry: Omit<JournalEntry, "created_at" | "status">): JournalEntry | undefined {
    return this.locked(() => {
      const existing = this.find(entry.request_id);
      if (!existing) this.write([
        ...this.read(),
        { ...entry, created_at: new Date().toISOString(), status: "intent" },
      ]);
      return existing;
    });
  }
  recordIntent(entry: Omit<JournalEntry, "created_at" | "status">): void {
    this.ensureIntent(entry);
  }

  updateStatus(requestId: string, status: JournalStatus): void {
    this.locked(() => this.write(
      this.read().map((entry) =>
        entry.request_id === requestId ? { ...entry, status } : entry,
      ),
    ));
  }

  /** Record the created run id on the exact operation entry. */
  attachRun(requestId: string, runId: string): void {
    this.locked(() => this.write(
      this.read().map((entry) =>
        entry.request_id === requestId ? { ...entry, run_id: runId } : entry,
      ),
    ));
  }

  /** Nonsecret credential mode for exact replay; never a password value. */
  setCredentialIdentity(
    requestId: string,
    credentialIdentity: "generated" | "supplied",
  ): void {
    this.locked(() => this.write(
      this.read().map((entry) =>
        entry.request_id === requestId
          ? { ...entry, credential_identity: credentialIdentity }
          : entry,
      ),
    ));
  }

  /**
   * One crash-safe boundary for read-check-write journal mutation: a killed
   * writer is recovered by the OS reservation protocol and a live writer is
   * never stolen from (see lock.ts). The journal mutex file sits beside the
   * journal, so CAPIR_CONFIG_DIR still isolates operation journals.
   */
  private locked<T>(operation: () => T): T {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    return new ProcessLock(`${this.path}.mutex.sqlite`, this.lockOptions).run(operation);
  }

  private write(entries: JournalEntry[]): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporary, this.path);
  }
}
