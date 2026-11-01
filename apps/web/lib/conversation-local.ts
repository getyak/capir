/** Small, expiring delivery outbox. Each immutable message has its own key so tabs cannot overwrite each other. */
import type { ConversationImageManifest, ConversationMemoryDraftTarget } from "@talent-signal/contracts";

import { isConversationMemoryDraftTarget } from "./conversation-memory-draft-target";

const PREFIX = "talent-signal:conversation:v1:";
const DAY = 86_400_000;
const uuid = /^[0-9a-f-]{36}$/iu;
export type Delivery = "pending" | "sending" | "unknown" | "accepted" | "rejected";
export type LocalMessage = { id: string; objective: string; images?: ConversationImageManifest[]; memoryDraftTarget?: ConversationMemoryDraftTarget; memoryDraftTargetLabel?: string; createdAt: string; delivery: Delivery; expiresAt: number; error?: string; receiptUncertain?: boolean };
export type LocalDraft = { value: string; updatedAt: string; expiresAt: number; writer: string };
function storage(): Storage | null { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } }
function key(scope: string, session: string, suffix: string) { return `${PREFIX}${scope}:${session}:${suffix}`; }
function parse<T>(value: string | null): T | null { try { return value ? JSON.parse(value) as T : null; } catch { return null; } }
/** Payload-free durable intent; only confirmed exact IDs authorize retirement. */
type WithdrawalIdentity = { version: 1; operation: string; queueEntryId: string; targetMessageId: string; expectedRevision: number; createdAt: number; protectUntil: number };
export type LocalWithdrawalRecord = WithdrawalIdentity & ({ state: "pending" } | { state: "confirmed"; messageIds: string[]; cleanup: "pending" | "confirmed" });
const withdrawalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function validWithdrawal(value: unknown): value is LocalWithdrawalRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as LocalWithdrawalRecord;
  const fields = ["version", "operation", "queueEntryId", "targetMessageId", "expectedRevision", "createdAt", "protectUntil", "state",
    ...(record.state === "confirmed" ? ["messageIds", "cleanup"] : [])];
  return Object.keys(record).length === fields.length && Object.keys(record).every(field => fields.includes(field)) &&
    new TextEncoder().encode(JSON.stringify(record)).length <= 4096 && record.version === 1 &&
    [record.operation, record.queueEntryId, record.targetMessageId].every(id => typeof id === "string" && withdrawalUuid.test(id)) &&
    Number.isSafeInteger(record.expectedRevision) && record.expectedRevision >= 0 && Number.isSafeInteger(record.createdAt) && record.createdAt >= 0 &&
    Number.isSafeInteger(record.protectUntil) && record.protectUntil >= record.createdAt + DAY &&
    (record.state === "pending" || (record.state === "confirmed" && validWithdrawalIds(record.messageIds, record.targetMessageId) && ["pending", "confirmed"].includes(record.cleanup)));
}
function validWithdrawalIds(ids: unknown, target: string): ids is string[] {
  return Array.isArray(ids) && ids.length > 0 && ids.length <= 51 && new Set(ids).size === ids.length && ids.includes(target) &&
    ids.every(id => typeof id === "string" && withdrawalUuid.test(id));
}
function parseWithdrawal(serialized: string | null): LocalWithdrawalRecord | null {
  if (serialized === null || new TextEncoder().encode(serialized).length > 4096) return null;
  const record = parse<LocalWithdrawalRecord>(serialized);
  return validWithdrawal(record) ? record : null;
}
export function readConversationWithdrawals(scope: string, session: string, target = storage()): { status: "known"; records: LocalWithdrawalRecord[] } | { status: "unknown" } {
  try {
    if (!target) return { status: "unknown" };
    const prefix = key(scope, session, "withdrawal:"); const records: LocalWithdrawalRecord[] = [];
    const length = target.length;
    for (let index = 0; index < length; index++) {
      const name = target.key(index); if (name === null) return { status: "unknown" };
      if (!name.startsWith(prefix)) continue;
      const record = parseWithdrawal(target.getItem(name));
      if (!validWithdrawal(record) || name !== prefix + record.operation) return { status: "unknown" };
      records.push(record);
    }
    return target.length === length ? { status: "known", records } : { status: "unknown" };
  } catch { return { status: "unknown" }; }
}
function readWithdrawal(scope: string, session: string, operation: string, target: Storage | null): LocalWithdrawalRecord | null {
  if (!target || !withdrawalUuid.test(operation)) return null;
  const record = parseWithdrawal(target.getItem(key(scope, session, `withdrawal:${operation}`)));
  return validWithdrawal(record) && record.operation === operation ? record : null;
}
function writeWithdrawal(scope: string, session: string, record: LocalWithdrawalRecord, target: Storage | null): boolean {
  if (!target || !validWithdrawal(record)) return false;
  const name = key(scope, session, `withdrawal:${record.operation}`); const serialized = JSON.stringify(record);
  target.setItem(name, serialized); return target.getItem(name) === serialized;
}
export function reserveConversationWithdrawal(scope: string, session: string, record: LocalWithdrawalRecord, target = storage()): boolean {
  try {
    if (!target || !validWithdrawal(record) || record.state !== "pending") return false;
    const previous = target.getItem(key(scope, session, `withdrawal:${record.operation}`));
    if (previous !== null) return previous === JSON.stringify(record);
    return writeWithdrawal(scope, session, record, target);
  } catch { return false; }
}
export function confirmConversationWithdrawal(scope: string, session: string, operation: string, messageIds: string[], target = storage()): boolean {
  try {
    const previous = readWithdrawal(scope, session, operation, target);
    if (!previous || !validWithdrawalIds(messageIds, previous.targetMessageId)) return false;
    if (previous.state === "confirmed") return JSON.stringify(previous.messageIds) === JSON.stringify(messageIds);
    return writeWithdrawal(scope, session, { ...previous, state: "confirmed", messageIds: [...messageIds], cleanup: "pending" }, target);
  } catch { return false; }
}
export function completeConversationWithdrawalCleanup(scope: string, session: string, operation: string, target = storage()): boolean {
  try {
    const previous = readWithdrawal(scope, session, operation, target);
    if (!previous || previous.state !== "confirmed") return false;
    return previous.cleanup === "confirmed" || writeWithdrawal(scope, session, { ...previous, cleanup: "confirmed" }, target);
  } catch { return false; }
}
function removeWithdrawal(scope: string, session: string, record: LocalWithdrawalRecord, target: Storage | null): boolean {
  if (!target) return false;
  const name = key(scope, session, `withdrawal:${record.operation}`);
  if (target.getItem(name) !== JSON.stringify(record)) return false;
  target.removeItem(name); return target.getItem(name) === null;
}
export function removeRejectedConversationWithdrawal(scope: string, session: string, operation: string, target = storage()): boolean {
  try { const record = readWithdrawal(scope, session, operation, target); return record?.state === "pending" && removeWithdrawal(scope, session, record, target); } catch { return false; }
}
export function removeConversationWithdrawalIfSafe(scope: string, session: string, operation: string, now: number, target = storage()): boolean {
  try { const record = readWithdrawal(scope, session, operation, target); return Boolean(record?.state === "confirmed" && record.cleanup === "confirmed" && now >= record.protectUntil && removeWithdrawal(scope, session, record, target)); } catch { return false; }
}
export function removeConversationMessageConfirmed(scope: string, session: string, messageId: string, target = storage()): boolean {
  try {
    if (!target || !withdrawalUuid.test(messageId)) return false;
    const name = key(scope, session, `message:${messageId}`); target.removeItem(name); return target.getItem(name) === null;
  } catch { return false; }
}
export function conversationExpiry(sessionExpiry?: string) { return Math.min(Date.now() + DAY, sessionExpiry ? Date.parse(sessionExpiry) : Infinity); }
export function readConversationDraft(scope: string, session: string, target = storage()): LocalDraft | null {
  try {
    const value = parse<LocalDraft>(target?.getItem(key(scope, session, "draft")) ?? null);
    if (value && typeof value.value === "string" && value.value.length <= 12000 && typeof value.writer === "string" && Number.isFinite(Date.parse(value.updatedAt)) && value.expiresAt > Date.now() && value.expiresAt <= Date.now() + DAY) return value;
    return null;
  } catch { return null; }
}
export function writeConversationDraft(scope: string, session: string, draft: LocalDraft, target = storage()): boolean {
  try { if (!target) return false; target.setItem(key(scope, session, "draft"), JSON.stringify(draft)); return true; } catch { return false; }
}
export function writeConversationMessage(scope: string, session: string, message: LocalMessage, target = storage()): boolean {
  try {
    if (!target || !Number.isFinite(message.expiresAt) || message.expiresAt <= Date.now() || message.expiresAt > Date.now() + DAY) return false;
    const authority = readConversationWithdrawals(scope, session, target);
    if (authority.status === "unknown" || authority.records.some(record => record.state === "confirmed" && record.messageIds.includes(message.id))) return false;
    const name = key(scope, session, `message:${message.id}`);
    const previous = parse<LocalMessage>(target.getItem(name));
    const next = previous && Number.isFinite(previous.expiresAt) ? { ...message, expiresAt: Math.min(previous.expiresAt, message.expiresAt) } : message;
    if (next.expiresAt <= Date.now()) return false;
    target.setItem(name, JSON.stringify(next)); return true;
  } catch { return false; }
}
export function removeConversationMessage(scope: string, session: string, id: string, target = storage()) {
  try { target?.removeItem(key(scope, session, `message:${id}`)); } catch { /* Best effort; replay still uses the same identity. */ }
}
export function readConversationMessages(scope: string, session: string, target = storage()): LocalMessage[] {
  const entries: LocalMessage[] = [];
  const authority = readConversationWithdrawals(scope, session, target);
  const retired = new Set(authority.status === "known" ? authority.records.flatMap(record => record.state === "confirmed" ? record.messageIds : []) : []);
  const uncertain = authority.status === "unknown" || authority.records.some(record => record.state === "pending");
  try {
    if (!target) return entries;
    const prefix = key(scope, session, "message:");
    for (let i = target.length - 1; i >= 0; i--) {
      const entryKey = target.key(i); if (!entryKey?.startsWith(prefix)) continue;
      const entry = parse<LocalMessage>(target.getItem(entryKey));
      const imagesValid = entry?.images === undefined || (Array.isArray(entry.images) && entry.images.length > 0 && entry.images.length <= 10 && entry.images.every(image =>
        uuid.test(image.attachment_id) && typeof image.file_name === "string" && image.file_name.length > 0 && image.file_name.length <= 200 &&
        ["image/png", "image/jpeg", "image/webp"].includes(image.media_type) &&
        Number.isInteger(image.byte_size) && image.byte_size > 0 && image.byte_size <= 10_000_000 &&
        /^[a-f0-9]{64}$/u.test(image.content_hash)));
      // A damaged explicit scope must never silently become an unbound send.
      const targetValid = entry?.memoryDraftTarget === undefined || (isConversationMemoryDraftTarget(entry.memoryDraftTarget) && typeof entry.objective === "string" && Boolean(entry.objective.trim()));
      const labelValid = entry?.memoryDraftTargetLabel === undefined || (typeof entry.memoryDraftTargetLabel === "string" && entry.memoryDraftTargetLabel.length <= 200);
      if (!entry || !targetValid || !labelValid || !uuid.test(entry.id) || typeof entry.objective !== "string" || entry.objective.length > 1000 || (!entry.objective.trim() && !(entry.images?.length)) || !imagesValid || !Number.isFinite(Date.parse(entry.createdAt)) || !["pending", "sending", "unknown", "accepted", "rejected"].includes(entry.delivery) || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now() || entry.expiresAt > Date.now() + DAY) { target.removeItem(entryKey); continue; }
      if (!retired.has(entry.id)) entries.push(uncertain ? { ...entry, delivery: "unknown", receiptUncertain: true } : entry);
    }
  } catch { /* Keep the valid rows already read. */ }
  return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export function conversationHome(scope: string, next?: string | null): string | null {
  try {
    const target = storage(); const homeKey = `${PREFIX}${scope}:home`;
    if (next === null) target?.removeItem(homeKey);
    else if (next) target?.setItem(homeKey, JSON.stringify({ id: next, expiresAt: Date.now() + DAY }));
    const item = parse<{ id: string; expiresAt: number }>(target?.getItem(homeKey) ?? null);
    return item && uuid.test(item.id) && item.expiresAt > Date.now() ? item.id : null;
  } catch { return null; }
}
export function clearConversationLocal(scope?: string, session?: string, target = storage()) {
  try { if (!target) return; const prefix = scope ? `${PREFIX}${scope}:${session ? `${session}:` : ""}` : PREFIX;
    for (let i = target.length - 1; i >= 0; i--) { const entryKey = target.key(i); if (entryKey?.startsWith(prefix) && !entryKey.includes(":withdrawal:")) target.removeItem(entryKey); }
  } catch { /* Logout must not fail if storage is unavailable. */ }
}

/**
 * Image-store keys for every live outbox message that still claims images.
 * Used to prune blobs orphaned by a crash between the durable put and the
 * localStorage metadata commit. A denied inventory leaves expiry as the bound.
 */
export function listConversationImageKeys(scope?: string, target = storage()): string[] {
  const keys: string[] = [];
  try {
    if (!target) return keys;
    const prefix = scope ? `${PREFIX}${scope}:` : PREFIX;
    const marker = ":message:";
    for (let index = 0; index < target.length; index += 1) {
      const entryKey = target.key(index);
      if (!entryKey?.startsWith(prefix)) continue;
      const rest = entryKey.slice(PREFIX.length);
      const markerIndex = rest.indexOf(marker);
      if (markerIndex < 0) continue;
      const owner = rest.slice(0, markerIndex);
      const entry = parse<LocalMessage>(target.getItem(entryKey));
      if (entry && entry.images?.length && entry.expiresAt > Date.now()) {
        const split = owner.lastIndexOf(":");
        const authority = readConversationWithdrawals(owner.slice(0, split), owner.slice(split + 1), target);
        if (authority.status !== "known" || !authority.records.some(record => record.state === "confirmed" && record.messageIds.includes(entry.id))) keys.push(`${owner}:${entry.id}`);
      }
    }
  } catch { /* Best effort. */ }
  return keys;
}
export function pruneConversationLocal(scope: string, target = storage()) {
  try { if (!target) return;
    for (let i = target.length - 1; i >= 0; i--) { const entryKey = target.key(i); if (!entryKey?.startsWith(PREFIX)) continue;
      if (entryKey.includes(":withdrawal:")) continue;
      const record = parse<{ expiresAt: number }>(target.getItem(entryKey));
      if (!entryKey.startsWith(`${PREFIX}${scope}:`) || !record || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now() || record.expiresAt > Date.now() + DAY) target.removeItem(entryKey);
    }
  } catch { /* A denied inventory is handled by the composer. */ }
}
