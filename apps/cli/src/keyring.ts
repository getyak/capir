/**
 * OS keyring credential storage.
 *
 * Credentials are stored through the @napi-rs/keyring native API only. There
 * is no plaintext fallback: when the keyring is unavailable every credential
 * operation fails closed. Store access errors are surfaced as errors and are
 * never treated as "no credential".
 *
 * The keyring entry is bound to the exact configured origin pair, so a
 * credential minted for one test environment can never be silently reused for
 * another. `CAPIR_TOKEN` (when set) is used directly and is never persisted by
 * login or logout.
 */
import { createHash } from "node:crypto";
import { userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import { CapirCliError, EXIT } from "./errors.js";
import { ProcessLock, type ProcessLockOptions } from "./lock.js";

export interface CredentialStore {
  readonly kind: "keyring" | "environment";
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  delete(): Promise<boolean>;
}

export interface KeyringEntry {
  // @napi-rs/keyring Entry is synchronous. AsyncEntry is a separate API and
  // must not be substituted here: an uncancellable pending write could land
  // after login has reported a timeout.
  setPassword(password: string): void;
  getPassword(): string | null;
  deleteCredential(): boolean;
}

export interface KeyringModule {
  Entry: new (service: string, username: string) => KeyringEntry;
}

export const KEYRING_SERVICE = "talent-signal.capir";

export function keyringUsername(backendOrigin: string, webOrigin: string): string {
  return `capir:${backendOrigin}|${webOrigin}`;
}

function unavailable(cause: unknown): CapirCliError {
  return new CapirCliError(
    "CAPIR_KEYRING_UNAVAILABLE",
    EXIT.INFRASTRUCTURE,
    `The OS keyring is unavailable; credentials must be stored in the OS keyring only and there is no plaintext fallback. ${cause instanceof Error ? cause.message : ""}`.trim(),
  );
}

export function createKeyringStore(
  keyring: KeyringModule | null,
  username: string,
  service = KEYRING_SERVICE,
): CredentialStore {
  return {
    kind: "keyring",
    async get() {
      if (!keyring) throw unavailable(new Error("native module not loaded"));
      try {
        return new keyring.Entry(service, username).getPassword();
      } catch (cause) {
        throw unavailable(cause);
      }
    },
    async set(token: string) {
      if (!keyring) throw unavailable(new Error("native module not loaded"));
      try {
        new keyring.Entry(service, username).setPassword(token);
      } catch (cause) {
        throw unavailable(cause);
      }
    },
    async delete() {
      if (!keyring) throw unavailable(new Error("native module not loaded"));
      try {
        return new keyring.Entry(service, username).deleteCredential();
      } catch (cause) {
        throw unavailable(cause);
      }
    },
  };
}

/** Ephemeral preprovisioned token from the environment; never persisted. */
export function environmentTokenStore(token: string): CredentialStore {
  return {
    kind: "environment",
    async get() {
      return token;
    },
    async set() {
      throw new CapirCliError(
        "CAPIR_TOKEN_PROVIDED",
        EXIT.INVALID_ARGUMENTS,
        "CAPIR_TOKEN is ephemeral and must not be persisted to the keyring.",
      );
    },
    async delete() {
      return false;
    },
  };
}

/** Fail-closed store used when no credential source can exist. */
export function missingCredentialStore(): CredentialStore {
  return {
    kind: "keyring",
    async get() {
      return null;
    },
    async set() {
      throw unavailable(new Error("no credential store"));
    },
    async delete() {
      throw unavailable(new Error("no credential store"));
    },
  };
}

/**
 * Cross-process credential mutation boundary for one exact origin pair.
 *
 * Every credential mutation (login commit, login compensation, logout local
 * removal) runs through this transaction under the same process-lifetime OS
 * reservation (lock.ts), so:
 *
 * - a login rechecks before committing and never overwrites a credential that
 *   another login stored first (the losing minted grant is revoked instead);
 * - logout and cancellation compensation remove only the exact credential they
 *   own, so a delayed completion cannot delete a newer login's credential.
 *
 * A plain second read without this mutual exclusion does not close the race.
 */
export type CredentialCommit = "committed" | "existing_preserved";
export type CredentialRemoval = "removed" | "already_absent" | "preserved_newer" | "unverified";

export interface CredentialTxn {
  /** Store `token` only when no credential exists; never overwrite. */
  commitIfAbsent(token: string): Promise<CredentialCommit>;
  /** Remove the stored credential only when it is exactly `token`. */
  removeIfMatch(token: string): Promise<CredentialRemoval>;
}

/**
 * Canonical per-OS-user mutex root for one keyring identity, INDEPENDENT of
 * CAPIR_CONFIG_DIR: the OS keyring service+username are identical across
 * config roots, so the mutation boundary must be too. A config-root-derived
 * lock would let two config roots synchronize on different locks for the SAME
 * keyring entry and re-open the I2 race (parent-lock-precheck/scope.json).
 * Operation journals stay per config dir and use their own mutex files.
 */
export function credentialMutexPath(
  service: string,
  username: string,
  getOsUserInfo: () => { homedir: string } = userInfo,
): string {
  let osHome: unknown;
  try {
    osHome = getOsUserInfo().homedir;
  } catch (cause) {
    throw unavailable(cause);
  }
  if (typeof osHome !== "string" || !isAbsolute(osHome)) {
    throw unavailable(new Error("The OS user home directory is missing or invalid."));
  }
  return join(
    osHome,
    ".local",
    "state",
    "talent-signal",
    "capir-mutex",
    `credential-${createHash("sha256").update(`${service}\n${username}`).digest("hex")}.sqlite`,
  );
}

export function createCredentialTxn(
  store: CredentialStore,
  mutexFile: string,
  lockOptions?: ProcessLockOptions,
): CredentialTxn {
  return {
    async commitIfAbsent(token: string): Promise<CredentialCommit> {
      return new ProcessLock(mutexFile, lockOptions).runAsync(async () => {
        const current = await store.get();
        if (current) return "existing_preserved";
        await store.set(token);
        return "committed";
      });
    },
    async removeIfMatch(token: string): Promise<CredentialRemoval> {
      return new ProcessLock(mutexFile, lockOptions).runAsync(async () => {
        const current = await store.get();
        if (current === null) return "already_absent";
        if (current !== token) return "preserved_newer";
        const deleted = await store.delete();
        if (deleted) return "removed";
        // The store could not confirm a delete; verify the observed post-state
        // before claiming removal.
        return (await store.get()) === token ? "unverified" : "removed";
      });
    },
  };
}
