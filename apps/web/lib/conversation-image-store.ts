/**
 * Durable local bytes for inline conversation images.
 *
 * Only raw image bytes live here. The localStorage outbox keeps the ordered
 * metadata manifest (ids, names, MIME, bytes, hashes) so a reload can rebuild
 * the exact admission without ever putting base64 or pixels into localStorage.
 *
 * IndexedDB is the browser-durable store. It is intentionally injectable so a
 * host without IndexedDB, a denied origin, or a test can prove the failed-write
 * path without weakening the real contract.
 */

import type { ConversationImageManifest } from "@talent-signal/contracts";

export type DurableConversationImage = ConversationImageManifest & {
  position: number;
  blob: Blob;
  /** Bounded retention independent of any mounted chat. */
  expiresAt: number;
};

export interface ConversationImageStore {
  put(key: string, images: readonly DurableConversationImage[]): Promise<boolean>;
  get(key: string): Promise<DurableConversationImage[]>;
  delete(key: string): Promise<void>;
  /** Confirms the readwrite transaction completed, rather than best-effort disposal. */
  deleteConfirmed?(key: string): Promise<boolean>;
  deletePrefix(prefix: string): Promise<void>;
  inventory(): Promise<Array<{ key: string; expiresAt: number }>>;
}

const DB_NAME = "talent-signal-conversation-images-v1";
const STORE_NAME = "images";
const DB_VERSION = 1;

export function conversationImageKey(
  scope: string,
  session: string,
  messageId: string,
): string {
  return `${scope}:${session}:${messageId}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IDB_REQUEST_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IDB_TX_FAILED"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IDB_TX_ABORTED"));
  });
}

export function createIndexedDbConversationImageStore(
  factory: IDBFactory,
): ConversationImageStore {
  let database: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!database) {
      database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IDB_OPEN_FAILED"));
      }).catch((error) => {
        database = null;
        throw error;
      });
    }
    return database;
  };
  return {
    async put(key, images) {
      try {
        const db = await open();
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put({ key, images: [...images] });
        await transactionDone(transaction);
        return true;
      } catch {
        return false;
      }
    },
    async get(key) {
      try {
        const db = await open();
        const transaction = db.transaction(STORE_NAME, "readonly");
        const record = await requestResult<{ images?: DurableConversationImage[] } | undefined>(
          transaction.objectStore(STORE_NAME).get(key),
        );
        return Array.isArray(record?.images) ? record!.images : [];
      } catch {
        return [];
      }
    },
    async delete(key) {
      try {
        const db = await open();
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(key);
        await transactionDone(transaction);
      } catch {
        /* Best effort; an accepted message is already durable on the server. */
      }
    },
    async deleteConfirmed(key) {
      try {
        const db = await open();
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(key);
        await transactionDone(transaction);
        return true;
      } catch { return false; }
    },
    async deletePrefix(prefix) {
      try {
        const db = await open();
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const cursorRequest = store.openCursor();
        await new Promise<void>((resolve) => {
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) {
              resolve();
              return;
            }
            const value = cursor.value as { key?: unknown };
            if (typeof value?.key === "string" && value.key.startsWith(prefix)) {
              cursor.delete();
            }
            cursor.continue();
          };
          cursorRequest.onerror = () => resolve();
        });
        await transactionDone(transaction);
      } catch {
        /* Best effort. */
      }
    },
    async inventory() {
      try {
        const db = await open();
        const transaction = db.transaction(STORE_NAME, "readonly");
        const cursorRequest = transaction.objectStore(STORE_NAME).openCursor();
        const entries: Array<{ key: string; expiresAt: number }> = [];
        await new Promise<void>((resolve) => {
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) {
              resolve();
              return;
            }
            const value = cursor.value as { key?: unknown; images?: DurableConversationImage[] };
            if (typeof value?.key === "string") {
              entries.push({ key: value.key, expiresAt: recordExpiry(value.images) });
            }
            cursor.continue();
          };
          cursorRequest.onerror = () => resolve();
        });
        return entries;
      } catch {
        return [];
      }
    },
  };
}

function recordExpiry(images: readonly DurableConversationImage[] | undefined): number {
  let expiry = Number.POSITIVE_INFINITY;
  for (const image of images ?? []) {
    if (Number.isFinite(image.expiresAt)) expiry = Math.min(expiry, image.expiresAt);
  }
  return Number.isFinite(expiry) ? expiry : Number.POSITIVE_INFINITY;
}

let override: ConversationImageStore | null | undefined;
let cached: ConversationImageStore | null | undefined;
let epoch = 0;

/** Test seam; `undefined` restores the real browser resolution. */
export function setConversationImageStoreForTest(
  store: ConversationImageStore | null | undefined,
): void {
  override = store;
}

/**
 * Invalidate in-flight durable writes (logout, account switch, delete). A late
 * put that resolves after this fence is removed instead of resurrecting bytes
 * a cleared session no longer owns.
 */
export function invalidateConversationImageStore(): void {
  epoch += 1;
}

export function conversationImageStore(): ConversationImageStore | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  const factory = typeof indexedDB === "undefined" ? null : indexedDB;
  cached = factory ? createIndexedDbConversationImageStore(factory) : null;
  return cached;
}

/** Durable write that must succeed before any network admission is attempted. */
export async function persistConversationImages(
  scope: string,
  session: string,
  messageId: string,
  images: readonly DurableConversationImage[],
): Promise<boolean> {
  const store = conversationImageStore();
  if (!store) return false;
  const capturedEpoch = epoch;
  const key = conversationImageKey(scope, session, messageId);
  try {
    const stored = await store.put(key, images);
    if (capturedEpoch !== epoch) {
      await store.delete(key);
      return false;
    }
    return stored;
  } catch {
    return false;
  }
}

export async function loadConversationImages(
  scope: string,
  session: string,
  messageId: string,
): Promise<DurableConversationImage[]> {
  const store = conversationImageStore();
  if (!store) return [];
  try {
    return await store.get(conversationImageKey(scope, session, messageId));
  } catch {
    return [];
  }
}

export async function removeConversationImages(
  scope: string,
  session: string,
  messageId: string,
): Promise<void> {
  await conversationImageStore()?.delete(conversationImageKey(scope, session, messageId));
}

export async function removeConversationImagesConfirmed(scope: string, session: string, messageId: string): Promise<boolean> {
  const store = conversationImageStore();
  if (!store?.deleteConfirmed) return false;
  try { return await store.deleteConfirmed(conversationImageKey(scope, session, messageId)); }
  catch { return false; }
}

export async function clearConversationImages(
  scope?: string,
  session?: string,
): Promise<void> {
  const store = conversationImageStore();
  if (!store) return;
  if (scope && session) {
    await store.deletePrefix(`${scope}:${session}:`);
    return;
  }
  if (scope) {
    await store.deletePrefix(`${scope}:`);
    return;
  }
  await store.deletePrefix("");
}

/** Remove every record whose bounded retention already elapsed. */
export async function purgeExpiredConversationImages(
  now = Date.now(),
): Promise<void> {
  const store = conversationImageStore();
  if (!store) return;
  for (const entry of await store.inventory()) {
    if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) {
      await store.delete(entry.key);
    }
  }
}

/**
 * Remove records whose message id is no longer in the local outbox: the crash
 * window between a successful blob put and the localStorage metadata commit.
 * Expired records are already bounded by `expiresAt`, so this only speeds up
 * recovery; it never keeps bytes forever.
 */
export async function pruneConversationImages(
  validKeys: ReadonlySet<string>,
  scopePrefix = "",
): Promise<void> {
  const store = conversationImageStore();
  if (!store) return;
  for (const entry of await store.inventory()) {
    if (!entry.key.startsWith(scopePrefix)) continue;
    if (!validKeys.has(entry.key)) await store.delete(entry.key);
  }
}

/** Chunked base64 so a 10 MB image cannot overflow the argument limit. */
export function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export async function base64FromBlob(blob: Blob): Promise<string> {
  return base64FromBytes(new Uint8Array(await blob.arrayBuffer()));
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
