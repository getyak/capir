/**
 * Dedicated credential stores for `capir test ...`.
 *
 * - The operator provisioning credential is HIGH ENTROPY service material,
 *   never a human grant: it resolves from the ephemeral
 *   `CAPIR_TEST_OPERATOR_TOKEN` environment variable or a dedicated OS
 *   keyring entry. It is strictly separate from the human `CAPIR_TOKEN`
 *   store and is never persisted by these commands.
 * - Run passwords live in a run-specific OS keyring item bound to the exact
 *   operator credential fingerprint, origin pair and request id. Creation
 *   persists the generated password BEFORE the first dispatch under a locked
 *   create-if-absent boundary: an existing conflicting item is reported and
 *   never overwritten, so recovery can never rotate a credential.
 *
 * The credential fingerprint is a SHA-256 identifier of the high-entropy
 * operator credential combined with the exact origin pair and request id. It
 * is not a password hash and grants no authority; the raw operator credential
 * stays only in the private environment or keyring.
 */
import { createHash, randomBytes } from "node:crypto";
import { CapirCliError, EXIT } from "./errors.js";
import {
  createKeyringStore,
  credentialMutexPath,
  environmentTokenStore,
  type CredentialStore,
  type KeyringModule,
} from "./keyring.js";
import { ProcessLock, type ProcessLockOptions } from "./lock.js";

export const OPERATOR_KEYRING_SERVICE = "talent-signal.capir-test-operator";
export const RUN_PASSWORD_KEYRING_SERVICE = "talent-signal.capir-test-run";

export interface RunPasswordStore {
  readonly kind: "keyring" | "environment";
  get(): Promise<string | null>;
  /** Locked create-if-absent: never overwrites a different existing value. */
  createIfAbsent(
    value: string,
  ): Promise<"stored" | "existing_identical" | "conflict">;
  delete(): Promise<boolean>;
}

export function operatorCredentialUsername(
  backendOrigin: string,
  webOrigin: string,
): string {
  return `capir-test-operator:${backendOrigin}|${webOrigin}`;
}

/**
 * Nonsecret identity marker for operation intent: a SHA-256 fingerprint of
 * the HIGH ENTROPY operator credential. It uniquely resolves the server
 * principal, is not a password hash and grants no authority. Never hash a
 * supplied or generated password into the journal.
 */
export function operatorCredentialFingerprint(operatorCredential: string): string {
  return createHash("sha256").update(operatorCredential).digest("hex");
}

export interface RunPasswordAccountInput {
  operatorCredential: string;
  backendOrigin: string;
  webOrigin: string;
  requestId: string;
}

/**
 * Principal-scoped keyring account for one run credential. The SHA-256
 * fingerprint of the high-entropy operator credential uniquely resolves the
 * server principal; it is combined with the exact origin pair and request id
 * so no two operations ever share an item.
 */
export function runPasswordAccount(input: RunPasswordAccountInput): string {
  const credentialFingerprint = operatorCredentialFingerprint(input.operatorCredential);
  const account = createHash("sha256")
    .update(
      `${credentialFingerprint}\n${input.backendOrigin}\n${input.webOrigin}\n${input.requestId}`,
    )
    .digest("hex");
  return `run:${input.requestId}:${account}`;
}

/** >=128 bits of OS cryptographic entropy, usable in ordinary password login. */
export function generatePassword(): string {
  return randomBytes(21).toString("base64url"); // 168 bits, 28 characters
}

/**
 * Run-password keyring store with a locked create-if-absent boundary.
 * The lock is canonical per OS user and keyring identity, independent of
 * CAPIR_CONFIG_DIR, exactly like the human credential mutex.
 */
export function createRunPasswordStore(
  keyring: KeyringModule | null,
  username: string,
  options: { lockOptions?: ProcessLockOptions } = {},
): RunPasswordStore {
  const store = createKeyringStore(
    keyring,
    username,
    RUN_PASSWORD_KEYRING_SERVICE,
  );
  const mutex = credentialMutexPath(RUN_PASSWORD_KEYRING_SERVICE, username);
  return {
    kind: store.kind,
    get: () => store.get(),
    async createIfAbsent(value) {
      return new ProcessLock(mutex, options.lockOptions).runAsync(async () => {
        const existing = await store.get();
        if (existing === null) {
          await store.set(value);
          return "stored";
        }
        return existing === value ? "existing_identical" : "conflict";
      });
    },
    delete: () => store.delete(),
  };
}

/**
 * Operator provisioning credential: ephemeral `CAPIR_TEST_OPERATOR_TOKEN`
 * first (never persisted), else the dedicated keyring entry. The human
 * `CAPIR_TOKEN` is never accepted here.
 */
export function operatorCredentialStore(
  env: NodeJS.ProcessEnv,
  keyring: KeyringModule | null,
  environment: { backendOrigin: string; webOrigin: string },
): CredentialStore {
  const token = env.CAPIR_TEST_OPERATOR_TOKEN?.trim();
  if (token) return environmentTokenStore(token);
  return createKeyringStore(
    keyring,
    operatorCredentialUsername(environment.backendOrigin, environment.webOrigin),
    OPERATOR_KEYRING_SERVICE,
  );
}

export async function requireOperatorCredential(
  store: CredentialStore,
): Promise<string> {
  const token = await store.get();
  if (!token) {
    throw new CapirCliError(
      "CAPIR_TEST_OPERATOR_CREDENTIAL_MISSING",
      EXIT.AUTH_DENIED,
      "No test-provisioning operator credential exists for this exact origin pair. Authorized installation provisions it in the dedicated keyring entry or as ephemeral CAPIR_TEST_OPERATOR_TOKEN; nothing was allocated.",
    );
  }
  return token;
}
