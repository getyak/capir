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
  try { if (!target) return false; target.setItem(key(scope, session, `message:${message.id}`), JSON.stringify(message)); return true; } catch { return false; }
}
export function removeConversationMessage(scope: string, session: string, id: string, target = storage()) {
  try { target?.removeItem(key(scope, session, `message:${id}`)); } catch { /* Best effort; replay still uses the same identity. */ }
}
export function readConversationMessages(scope: string, session: string, target = storage()): LocalMessage[] {
  const entries: LocalMessage[] = [];
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
      entries.push(entry);
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
    for (let i = target.length - 1; i >= 0; i--) { const entryKey = target.key(i); if (entryKey?.startsWith(prefix)) target.removeItem(entryKey); }
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
        keys.push(`${owner}:${entry.id}`);
      }
    }
  } catch { /* Best effort. */ }
  return keys;
}
export function pruneConversationLocal(scope: string, target = storage()) {
  try { if (!target) return;
    for (let i = target.length - 1; i >= 0; i--) { const entryKey = target.key(i); if (!entryKey?.startsWith(PREFIX)) continue;
      const record = parse<{ expiresAt: number }>(target.getItem(entryKey));
      if (!entryKey.startsWith(`${PREFIX}${scope}:`) || !record || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now() || record.expiresAt > Date.now() + DAY) target.removeItem(entryKey);
    }
  } catch { /* A denied inventory is handled by the composer. */ }
}
