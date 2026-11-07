import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { MemorySurface } from "@talent-signal/contracts";
import { ApiError } from "../lib/apiError.js";

export const MEMORY_PROPOSAL_PAGE_SIZE = 50;
export const MEMORY_PROPOSAL_CURSOR_TTL_MS = 15 * 60_000;

export interface MemoryProposalCursorScope {
  accountId: string;
  userId: string;
  loginSessionId: string;
  purpose: MemorySurface;
  personId: string | null;
  contextId: string | null;
  sourceSessionId: string | null;
}

export interface MemoryProposalCursorState {
  snapshotAt: string;
  beforeCreatedAt: string;
  beforeId: string;
  validUntilMs: number;
}

interface CursorBounds { nowMs: number; sessionExpiresAtMs: number }
const domain = "capir:memory-proposal-cursor:v1";

function stale(): never {
  throw new ApiError(409, "MEMORY_PROPOSAL_CURSOR_STALE",
    "The proposal list changed. Start a fresh read.");
}

function key(material: string | null): Buffer {
  if (!material || !/^[a-f0-9]{64}$/u.test(material)) return stale();
  return createHash("sha256").update(domain + ":key:").update(material).digest();
}

function aad(scope: MemoryProposalCursorScope): Buffer {
  return Buffer.from(JSON.stringify([domain, scope.accountId, scope.userId, scope.loginSessionId,
    scope.purpose, scope.personId, scope.contextId, scope.sourceSessionId]), "utf8");
}

function exactTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value)) return false;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 19) === value.slice(0, 19);
}

function validate(value: unknown, bounds: CursorBounds): MemoryProposalCursorState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return stale();
  const row = value as MemoryProposalCursorState;
  if (Object.keys(row).sort().join(",") !== "beforeCreatedAt,beforeId,snapshotAt,validUntilMs"
    || !exactTimestamp(row.snapshotAt) || !exactTimestamp(row.beforeCreatedAt)
    || row.beforeCreatedAt > row.snapshotAt || Date.parse(row.snapshotAt) > bounds.nowMs
    || typeof row.beforeId !== "string"
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(row.beforeId)
    || !Number.isSafeInteger(bounds.nowMs) || !Number.isSafeInteger(bounds.sessionExpiresAtMs)
    || !Number.isSafeInteger(row.validUntilMs) || row.validUntilMs <= bounds.nowMs
    || row.validUntilMs > bounds.sessionExpiresAtMs
    || row.validUntilMs > Date.parse(row.snapshotAt) + MEMORY_PROPOSAL_CURSOR_TTL_MS) return stale();
  return row;
}

/** Opaque traversal encoding, not authorization or server-issued authenticity.
 * Session token_hash is SHA256(bearer): its holder can derive this material and
 * mint another valid encoding. It is not confidential from that holder, and
 * the anchor has already been returned. The caller must load the same live
 * authenticated session and repeat all scope/source predicates on every page.
 */
export function sealMemoryProposalCursor(
  material: string | null, scope: MemoryProposalCursorScope,
  state: MemoryProposalCursorState, bounds: CursorBounds,
): string {
  const row = validate(state, bounds);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(material), nonce);
  cipher.setAAD(aad(scope));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(row), "utf8"), cipher.final()]);
  return "mp1." + Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function openMemoryProposalCursor(
  token: string, material: string | null, scope: MemoryProposalCursorScope, bounds: CursorBounds,
): MemoryProposalCursorState {
  try {
    if (token.length > 1024 || !/^mp1\.[A-Za-z0-9_-]+$/u.test(token)) return stale();
    const encoded = token.slice(4);
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length <= 28 || bytes.toString("base64url") !== encoded) return stale();
    const decipher = createDecipheriv("aes-256-gcm", key(material), bytes.subarray(0, 12));
    decipher.setAAD(aad(scope));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    return validate(JSON.parse(plaintext.toString("utf8")), bounds);
  } catch { return stale(); }
}
