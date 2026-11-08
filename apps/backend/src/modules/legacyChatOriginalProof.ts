/** Server-only original admission metadata. Never accept this from a request or
 * use its hash as a credential. Restoration requires a trusted owner-joined row. */
import { types } from "node:util";
import type { AuthContext } from "./auth.js";

export interface LegacyChatLabBinding {
  readonly entry: string; readonly workspace: string; readonly parent: string | null;
  readonly principal: string | null; readonly generation: number | null;
  readonly ownerAccount: string | null; readonly ownerUser: string | null;
  readonly grant: string | null; readonly entitlementGeneration: number | null; readonly run: string | null;
}
export interface LegacyChatOriginalProof {
  readonly version: 1;
  readonly tokenHash: string;
  readonly accountId: string; readonly userId: string; readonly sessionId: string;
  readonly userKind: AuthContext["userKind"];
  readonly tokenBranch: "current" | "previous";
  readonly originalDeadline: string;
  readonly deployment: Readonly<{ enabled: boolean; userAuthEnabled: boolean;
    webOrigin: string | null; backendOrigin: string | null }>;
  readonly labBinding: Readonly<LegacyChatLabBinding> | null;
}
export class LegacyChatOriginalProofError extends Error {
  readonly code = "LEGACY_CHAT_ORIGINAL_PROOF_INVALID";
  constructor() { super("LEGACY_CHAT_ORIGINAL_PROOF_INVALID"); this.name = "LegacyChatOriginalProofError"; }
}
const invalid = (): never => { throw new LegacyChatOriginalProofError(); };

/** Shared by the two private snapshot schemas. Own data only: never execute a
 * getter/toJSON/coercion/Proxy trap while decoding stored metadata. */
export function readLegacyChatSnapshotRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return invalid();
    result[key] = descriptor.value;
  }
  return result;
}

export function legacyChatProofText(value: unknown, maxBytes = 8192): string {
  if (typeof value !== "string" || value.length > maxBytes || !value.length || value.includes("\0")) return invalid();
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++index);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return invalid();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return invalid();
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) return invalid();
  return value;
}
export function legacyChatProofId(value: unknown): string {
  const id = legacyChatProofText(value, 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(id)) return invalid();
  return id;
}

/** Validate calendar shape without converting the saved/SQL value to a Date:
 * Date is used only for the millisecond calendar check; all six digits survive. */
export function legacyChatProofDeadline(value: unknown): string {
  const exact = legacyChatProofText(value, 27);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(exact) || exact.startsWith("0000-")) return invalid();
  const milliseconds = exact.slice(0, 23) + "Z";
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== milliseconds) return invalid();
  return exact;
}
function kind(value: unknown): AuthContext["userKind"] {
  if (typeof value !== "string" || !["simulated_human", "apple_human", "password_human", "lab_human", "google_human"].includes(value)) return invalid();
  return value as AuthContext["userKind"];
}
const nullableId = (value: unknown) => value === null ? null : legacyChatProofId(value);
// Disabled deployment config may retain an empty string. Preserve that exact
// tuple instead of normalizing it to null or inventing a new admission policy.
const nullableText = (value: unknown) => value === null || value === "" ? value : legacyChatProofText(value);
function generation(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return invalid();
  return value;
}
function binding(value: unknown): Readonly<LegacyChatLabBinding> {
  const source = readLegacyChatSnapshotRecord(value, ["entry", "workspace", "parent", "principal", "generation",
    "ownerAccount", "ownerUser", "grant", "entitlementGeneration", "run"]);
  const result: LegacyChatLabBinding = { entry: legacyChatProofId(source.entry), workspace: legacyChatProofId(source.workspace),
    parent: nullableId(source.parent), principal: nullableId(source.principal), generation: generation(source.generation),
    ownerAccount: nullableId(source.ownerAccount), ownerUser: nullableId(source.ownerUser), grant: nullableId(source.grant),
    entitlementGeneration: generation(source.entitlementGeneration), run: nullableId(source.run) };
  // Preserve the actual two canonical Lab lineage shapes, including nullable
  // integer generations. Do not manufacture a generation or another parent.
  if (result.parent !== null) {
    if (result.principal !== null || result.generation !== null || result.ownerAccount === null || result.ownerUser === null
      || result.run !== null || (result.grant === null) !== (result.entitlementGeneration === null)) return invalid();
  } else if (result.principal === null || result.generation === null || result.ownerAccount !== null || result.ownerUser !== null
    || result.grant !== null || result.entitlementGeneration !== null || result.run === null) return invalid();
  return Object.freeze(result);
}

/** Clone only route-authenticator fields; none of the email/slug data is part
 * of either durable proof. This stabilizes the trusted scope across awaits. */
export function snapshotLegacyChatAuth(value: AuthContext): Readonly<AuthContext> {
  const source = readLegacyChatSnapshotRecord(value, ["accountId", "accountSlug", "userId", "userEmail", "userKind", "sessionId"]);
  if (typeof source.accountSlug !== "string" || typeof source.userEmail !== "string") return invalid();
  return Object.freeze({ accountId: legacyChatProofId(source.accountId), userId: legacyChatProofId(source.userId),
    sessionId: legacyChatProofId(source.sessionId), userKind: kind(source.userKind), accountSlug: source.accountSlug, userEmail: source.userEmail });
}
export function validateLegacyChatOriginalProof(value: unknown): Readonly<LegacyChatOriginalProof> {
  const source = readLegacyChatSnapshotRecord(value, ["version", "tokenHash", "accountId", "userId", "sessionId", "userKind",
    "tokenBranch", "originalDeadline", "deployment", "labBinding"]);
  if (source.version !== 1 || typeof source.tokenHash !== "string" || !/^[a-f0-9]{64}$/u.test(source.tokenHash)
    || (source.tokenBranch !== "current" && source.tokenBranch !== "previous")) return invalid();
  const deployment = readLegacyChatSnapshotRecord(source.deployment, ["enabled", "userAuthEnabled", "webOrigin", "backendOrigin"]);
  if (typeof deployment.enabled !== "boolean" || typeof deployment.userAuthEnabled !== "boolean") return invalid();
  const userKind = kind(source.userKind);
  if ((userKind === "lab_human") === (source.labBinding === null)) return invalid();
  return Object.freeze({ version: 1, tokenHash: source.tokenHash, accountId: legacyChatProofId(source.accountId),
    userId: legacyChatProofId(source.userId), sessionId: legacyChatProofId(source.sessionId), userKind,
    tokenBranch: source.tokenBranch, originalDeadline: legacyChatProofDeadline(source.originalDeadline),
    deployment: Object.freeze({ enabled: deployment.enabled, userAuthEnabled: deployment.userAuthEnabled,
      webOrigin: nullableText(deployment.webOrigin), backendOrigin: nullableText(deployment.backendOrigin) }),
    labBinding: source.labBinding === null ? null : binding(source.labBinding) });
}
