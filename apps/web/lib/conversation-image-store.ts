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
  put(key: string, images: readonly DurableConversationImage[], expectedIds?: readonly string[]): Promise<boolean>;
  get(key: string): Promise<DurableConversationImage[]>;
  /** Optional cutoff is checked atomically against the current record. Explicit clears omit it. */
  delete(key: string, expiredBefore?: number): Promise<void>;
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
    async put(key, images, expectedIds) {
      try {
        const db = await open();
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const done = transactionDone(transaction);
        void done.catch(() => undefined);
        const objectStore = transaction.objectStore(STORE_NAME);
        if (expectedIds) {
          const previous = await requestResult<{ images?: DurableConversationImage[] } | undefined>(objectStore.get(key));
          const actual = previous?.images?.map(image => image.attachment_id) ?? [];
          if (JSON.stringify(actual) !== JSON.stringify(expectedIds)) { await done; return false; }
        }
        if (images.length) objectStore.put({ key, images: [...images] });
        else objectStore.delete(key);
        await done;
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
        throw new Error("IDB_READ_FAILED");
      }
    },
    async delete(key, expiredBefore) {
      try {
        const db = await open();
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const done = transactionDone(transaction);
        void done.catch(() => undefined);
        const objectStore = transaction.objectStore(STORE_NAME);
        if (expiredBefore !== undefined) {
          const current = await requestResult<{ images?: DurableConversationImage[] } | undefined>(objectStore.get(key));
          const expiry = recordExpiry(current?.images);
          // Inventory is only a candidate list: another tab may have replaced
          // this key. Read and conditional delete share this write transaction.
          if (Number.isFinite(expiry) && expiry > expiredBefore) { await done; return; }
        }
        objectStore.delete(key);
        await done;
      } catch {
        /* Best effort; an accepted message is already durable on the server. */
      }
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
let clearing: Promise<void> = Promise.resolve();

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

/** Captured before file preparation, so account A-B-A cannot revive old input. */
export function conversationImageGeneration(): number { return epoch; }

export type ConversationImageDraftRevision = { ids: string[] };

export const CONVERSATION_IMAGE_DRAFT = "composer-draft";
const draftWrites = new Map<string, { tail: Promise<boolean>; pending: number }>();

/** Reuse the byte store for this bounded local composing purpose. Serializing
 * a key also keeps a late old write/delete from overwriting its replacement. */
export function persistConversationImageDraft(
  scope: string, session: string, images: readonly DurableConversationImage[], generation: number, revision?: ConversationImageDraftRevision,
): Promise<boolean> {
  const key = conversationImageKey(scope, session, CONVERSATION_IMAGE_DRAFT);
  let queue = draftWrites.get(key);
  // At most two bounded snapshots may retain files while storage is slow.
  // Refusing another write leaves its originals/guard in the mounted composer.
  if (queue && queue.pending >= 2) return Promise.resolve(false);
  if (!queue) { queue = { tail: Promise.resolve(true), pending: 0 }; draftWrites.set(key, queue); }
  const owner = queue;
  owner.pending += 1;
  const write = owner.tail.catch(() => false).then(async () => {
    if (generation !== epoch) return false;
    const store = conversationImageStore();
    if (!store) return false;
    // The guarded put atomically removes an empty draft. A separate
    // best-effort delete could erase another tab's newer draft.
    if (images.some(image => image.expiresAt <= Date.now())) return false;
    const saved = await persistConversationImages(scope, session, CONVERSATION_IMAGE_DRAFT, images, revision?.ids);
    if (images.some(image => image.expiresAt <= Date.now())) {
      if (saved) await store.put(key, [], images.map(image => image.attachment_id));
      return false;
    }
    if (saved && revision) revision.ids = images.map(image => image.attachment_id);
    return saved;
  }).catch(() => false);
  owner.tail = write;
  void write.finally(() => { owner.pending -= 1; if (!owner.pending && draftWrites.get(key) === owner) draftWrites.delete(key); });
  return write;
}

export async function loadConversationImageDraft(scope: string, session: string): Promise<DurableConversationImage[]> {
  await draftWrites.get(conversationImageKey(scope, session, CONVERSATION_IMAGE_DRAFT))?.tail;
  const generation = epoch;
  await clearing;
  if (generation !== epoch) return [];
  const records = await conversationImageStore()?.get(conversationImageKey(scope, session, CONVERSATION_IMAGE_DRAFT)) ?? [];
  if (generation !== epoch) return [];
  if (records.some(image => !Number.isFinite(image.expiresAt) || image.expiresAt <= Date.now())) {
    const removed = await conversationImageStore()?.put(conversationImageKey(scope, session, CONVERSATION_IMAGE_DRAFT), [], records.map(image => image.attachment_id));
    if (!removed) throw new Error("DRAFT_CHANGED");
    return [];
  }
  return records;
}

/** Durable write that must succeed before any network admission is attempted. */
export async function persistConversationImages(
  scope: string,
  session: string,
  messageId: string,
  images: readonly DurableConversationImage[],
  expectedIds?: readonly string[],
): Promise<boolean> {
  const store = conversationImageStore();
  if (!store) return false;
  const capturedEpoch = epoch;
  const key = conversationImageKey(scope, session, messageId);
  try {
    await clearing;
    if (capturedEpoch !== epoch) return false;
    const stored = await store.put(key, images, expectedIds);
    if (capturedEpoch !== epoch) {
      if (stored) {
        if (messageId === CONVERSATION_IMAGE_DRAFT) await store.put(key, [], images.map(image => image.attachment_id));
        else await store.delete(key);
      }
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

export function clearConversationImages(
  scope?: string,
  session?: string,
): Promise<void> {
  const store = conversationImageStore();
  if (!store) return Promise.resolve();
  const prefix = scope ? `${scope}:${session ? `${session}:` : ""}` : "";
  // A new generation must not be written ahead of a slow previous deletion.
  clearing = clearing.then(() => store.deletePrefix(prefix)).catch(() => undefined);
  return clearing;
}

/** Remove every record whose bounded retention already elapsed. */
export async function purgeExpiredConversationImages(
  now = Date.now(),
): Promise<void> {
  const store = conversationImageStore();
  if (!store) return;
  for (const entry of await store.inventory()) {
    if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) {
      await store.delete(entry.key, now);
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
    if (entry.key.endsWith(`:${CONVERSATION_IMAGE_DRAFT}`)) {
      // A composing record has no outbox key. Only its current expiry can
      // authorize pruning it; a stale inventory cannot delete a new draft.
      await store.delete(entry.key, Date.now());
      continue;
    }
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
