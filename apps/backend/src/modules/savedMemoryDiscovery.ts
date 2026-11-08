/** Bounded literal ANY discovery, never semantic absence or identity authority.
 * This owner is not advertised until durable writer/publication/readback hooks
 * are complete. All arguments and current authority come from the real host. */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { SavedMemorySearchInputSchema } from "@talent-signal/agent";
import { describeMemoryText, requireMemoryLiteral } from "@talent-signal/contracts";
import { ApiError } from "../lib/apiError.js";
import type { DatabaseClient } from "../database/pool.js";
import { SavedMemoryReadSet, captureSavedMemoryStamp, savedMemoryBudgetLimited, savedMemoryDeadline,
  captureSavedMemoryAuthority, captureSavedMemoryReadProof, savedMemoryOwnArray, savedMemoryOwnRecord, savedMemoryUnavailable, savedMemoryUUID,
  type SavedMemoryAuthority, type SavedMemoryReadProof, type SavedMemoryStamp } from "./savedMemoryLineage.js";
import { withSavedMemoryTransaction } from "./savedMemoryLineageMaintenance.js";

/** Root capacity decision: two32KiB texts need393216 JSON bytes at6x. This
 * 512KiB is a physical frame cap ONLY, not a larger24k Run/context/token limit.
 * Fixed metadata bounds and the worst-case projection test must stay in sync. */
export const SAVED_MEMORY_PAGE_MAX_JSON_BYTES = 512 * 1024;
export const SAVED_MEMORY_RUN_CONTEXT_MAX = 24_000;
export const SAVED_MEMORY_PROVENANCE_MAX = 10;
export const SAVED_MEMORY_METADATA_MAX_BYTES = 2048;
export const SAVED_MEMORY_ARTIFACT_MAX_BYTES = 1024;
const HASH = /^[a-f0-9]{64}$/;
const CURSOR_PART = /^[A-Za-z0-9_-]+$/;
const reset = (): never => { throw new ApiError(409, "SAVED_MEMORY_QUERY_RESET", "Read saved Memory again with a new query."); };
interface Anchor { readonly created_at: string; readonly id: string }
interface QueryState { readonly id: string; readonly key: Buffer; readonly cutoff: string; readonly expiresAt: string }
/** Host-only parameters. The owning login/queue/source SQL must compose
 * saved_memory_discovery_current with ALL of its own live authority in ONE
 * final SELECT. A callback's existence or a boolean returned by a model is not
 * that proof. Terms/patterns are transient input; never ledger/log content. */
export interface SavedMemoryFinalReadDomain {
  readonly proof: Readonly<SavedMemoryReadProof>;
  readonly query_id: string;
  readonly query_digest: string;
  readonly projection_version: 1;
  readonly cutoff: string;
  readonly query_expires_at: string;
  readonly literal_patterns: readonly string[];
  readonly page_limit: number;
  readonly delivered_stamps: readonly Readonly<SavedMemoryStamp>[];
}
export interface SavedMemoryDiscoveryContext {
  readonly pool: Pool;
  readonly database: DatabaseClient;
  readonly authority: SavedMemoryAuthority;
  readonly reads: SavedMemoryReadSet;
  /** Actual cumulative Run owner, never a page-local counter/default reset. */
  readonly remainingContextCharacters: () => number;
  readonly chargeContextCharacters: (characters: number) => boolean;
  /** Required real owner integration, not optional/fallback authorization.
   * Return the actual single SELECT row with exactly available/checked_at/
   * read_until. read_until is the minimum ORIGINAL query/Run/login-branch/
   * claim/source/retention deadline. Supply that SELECT's MATERIALIZED DB tick
   * to all three STABLE Memory predicates; no browser credential substitution. */
  readonly finalizeRead: (domain: Readonly<SavedMemoryFinalReadDomain>) => Promise<unknown>;
}
function microseconds(value: string): bigint {
  savedMemoryDeadline(value);
  return BigInt(Date.parse(value.slice(0, 23) + "Z")) * 1000n + BigInt(value.slice(23, 26));
}
/** No exported constructor or caller-supplied ticket. Charge the entire final
 * owner roundtrip conservatively from BEFORE its SELECT, plus all synchronous
 * serialization/admission time afterwards. This never renews a deadline. */
async function finalTicket(context: SavedMemoryDiscoveryContext, domain: Readonly<SavedMemoryFinalReadDomain>) {
  const started = process.hrtime.bigint(), value = await context.finalizeRead(domain);
  const row = savedMemoryOwnRecord(value, ["available", "checked_at", "read_until"]);
  const checked = savedMemoryDeadline(row.checked_at), until = savedMemoryDeadline(row.read_until);
  if (row.available !== true || until > domain.proof.expires_at || until > domain.query_expires_at) return savedMemoryUnavailable();
  const remaining = microseconds(until) - microseconds(checked);
  if (remaining <= 0n) return savedMemoryUnavailable();
  const deadline = started + remaining * 1000n;
  const ticket = Object.freeze({ assertLive: () => { if (process.hrtime.bigint() >= deadline) return savedMemoryUnavailable(); } });
  ticket.assertLive(); return ticket;
}
export interface SavedMemoryDiscoveryPage {
  readonly matching: "literal_terms_any";
  readonly coverage: "current_authorized_matches_under_fixed_cutoff";
  readonly semantic_absence: false;
  readonly items: readonly Readonly<Record<string, unknown>>[];
  readonly has_more: boolean;
  readonly next_cursor: string | null;
}
function bytes(value: unknown, max: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string") return savedMemoryUnavailable();
  try { if (describeMemoryText(value).utf8_bytes > max) return savedMemoryUnavailable(); }
  catch { return savedMemoryUnavailable(); }
  return value;
}
function nullableID(value: unknown) { return value === null ? null : savedMemoryUUID(value); }
function literal(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string") return savedMemoryUnavailable();
  try { return requireMemoryLiteral(value, "statement"); } catch { return savedMemoryUnavailable(); }
}
function encodeCursor(state: QueryState, anchor: Anchor, binding: string): string {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", state.key, nonce);
  cipher.setAAD(Buffer.from(binding, "utf8"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ v: 1, cutoff: state.cutoff, ...anchor }), "utf8"), cipher.final()]);
  return ["sm1", state.id, nonce.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}
function part(value: string, max: number): Buffer {
  if (!CURSOR_PART.test(value) || value.length > max) return reset();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) return reset();
  return decoded;
}
function decodeCursor(token: string, state: QueryState, binding: string): Anchor {
  try {
    const parts = token.split(".");
    if (parts.length !== 5 || parts[0] !== "sm1" || parts[1] !== state.id) return reset();
    const nonce = part(parts[2]!, 16), tag = part(parts[4]!, 22);
    if (nonce.byteLength !== 12 || tag.byteLength !== 16) return reset();
    const decipher = createDecipheriv("aes-256-gcm", state.key, nonce);
    decipher.setAAD(Buffer.from(binding, "utf8")); decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(part(parts[3]!, 768)), decipher.final()]).toString("utf8");
    const value = savedMemoryOwnRecord(JSON.parse(text), ["v", "cutoff", "created_at", "id"]);
    if (value.v !== 1 || value.cutoff !== state.cutoff) return reset();
    const time = savedMemoryDeadline(value.created_at);
    if (time > state.cutoff) return reset();
    return Object.freeze({ created_at: time, id: savedMemoryUUID(value.id) });
  } catch { return reset(); }
}
async function queryState(context: SavedMemoryDiscoveryContext, digest: string, cursor?: string): Promise<QueryState> {
  const { auth } = context.authority;
  if (cursor) {
    const id = cursor.split(".")[1];
    if (cursor.split(".").length !== 5 || !id) return reset();
    try { savedMemoryUUID(id); } catch { return reset(); }
    const row = (await context.database.query<{ id: string; cursor_key: Buffer; cutoff: string; expires_at: string }>(`SELECT id,cursor_key,
      to_char(cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cutoff,
      to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at
      FROM memory_discovery_queries WHERE account_id=$1 AND reader_actor_id=$2 AND id=$3
        AND query_digest=$4 AND projection_version=1 AND expires_at>clock_timestamp()`, [auth.accountId, auth.userId, id, digest])).rows[0];
    if (!row) return reset();
    const r = savedMemoryOwnRecord(row, ["id", "cursor_key", "cutoff", "expires_at"]);
    if (r.id !== id || !Buffer.isBuffer(r.cursor_key) || r.cursor_key.byteLength !== 32) return reset();
    return Object.freeze({ id, key: Buffer.from(r.cursor_key), cutoff: savedMemoryDeadline(r.cutoff), expiresAt: savedMemoryDeadline(r.expires_at) });
  }
  const id = randomUUID(), key = randomBytes(32);
  // A separate, finite metadata Tx releases the quota lock before model/tool
  // exposure. It never nests a transaction on the caller's source client. A
  // saturated one-client pool reports unavailable within2s, never waits on
  // itself indefinitely or resets the Run/model budget.
  return withSavedMemoryTransaction(context.pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`saved-memory-query:${auth.accountId}:${auth.userId}`]);
    await client.query(`DELETE FROM memory_discovery_queries WHERE account_id=$1 AND reader_actor_id=$2 AND expires_at<=clock_timestamp()`, [auth.accountId, auth.userId]);
    const row = (await client.query<{ cutoff: string; expires_at: string }>(`WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at)
      INSERT INTO memory_discovery_queries(account_id,reader_actor_id,id,query_digest,projection_version,cursor_key,created_at,cutoff,expires_at)
      SELECT $1,$2,$3,$4,1,$5,tick.checked_at,tick.checked_at,LEAST(tick.checked_at+interval '15 minutes',$6::timestamptz)
      FROM tick WHERE tick.checked_at<$6::timestamptz AND (SELECT count(*) FROM memory_discovery_queries
        WHERE account_id=$1 AND reader_actor_id=$2 AND expires_at>tick.checked_at)<16
      RETURNING to_char(cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cutoff,
        to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at`,
    [auth.accountId, auth.userId, id, digest, key, context.authority.expiresAt])).rows[0];
    if (!row) return reset();
    const r = savedMemoryOwnRecord(row, ["cutoff", "expires_at"]);
    return Object.freeze({ id, key: Buffer.from(key), cutoff: savedMemoryDeadline(r.cutoff), expiresAt: savedMemoryDeadline(r.expires_at) });
  });
}

const ROW_KEYS = ["id", "version", "display_text", "original_display_text", "statement_kind", "scope", "subject_id", "relationship_context_id", "person_label",
  "speaker", "reporter", "valid_time", "observed_time", "time_status", "sensitivity", "supersedes_id", "superseded_by_id", "conflict_group_id", "cursor_time", "stamp", "evidence_refs", "representation_ok"] as const;
export function projectSavedMemoryDiscoveryRow(value: unknown): { item: Readonly<Record<string, unknown>>; stamp: SavedMemoryStamp; anchor: Anchor } {
  const r = savedMemoryOwnRecord(value, ROW_KEYS);
  if (r.representation_ok !== true || !["self", "person", "relationship"].includes(r.scope as string)
    || !["known", "unknown", "future", "past"].includes(r.time_status as string)
    || !["normal", "sensitive"].includes(r.sensitivity as string)
    || !["fact", "source_statement", "user_opinion"].includes(r.statement_kind as string)) return savedMemoryUnavailable();
  const stamp = captureSavedMemoryStamp(r.stamp), id = savedMemoryUUID(r.id);
  if (stamp.item_id !== id || stamp.item_version !== r.version || stamp.scope !== r.scope
    || stamp.subject_id !== r.subject_id || stamp.relationship_context_id !== r.relationship_context_id) return savedMemoryUnavailable();
  const references = savedMemoryOwnArray(r.evidence_refs, SAVED_MEMORY_PROVENANCE_MAX).map(value => {
    const e = savedMemoryOwnRecord(value, ["evidence_id", "source_kind", "capture_id", "source_resource_id", "source_session_id", "source_message_id", "source_artifact_id", "locator_sha256"]);
    if (!["message", "image_region", "document", "other"].includes(e.source_kind as string)
      || !(e.locator_sha256 === null || (typeof e.locator_sha256 === "string" && HASH.test(e.locator_sha256)))) return savedMemoryUnavailable();
    return Object.freeze({ evidence_id: savedMemoryUUID(e.evidence_id), source_kind: e.source_kind as string,
      capture_id: nullableID(e.capture_id), source_resource_id: nullableID(e.source_resource_id), source_session_id: nullableID(e.source_session_id),
      source_message_id: nullableID(e.source_message_id), source_artifact_id: bytes(e.source_artifact_id, SAVED_MEMORY_ARTIFACT_MAX_BYTES, true), locator_sha256: e.locator_sha256 });
  });
  if (!references.length) return savedMemoryUnavailable();
  const item = Object.freeze({ id, version: stamp.item_version, display_text: literal(r.display_text), original_display_text: literal(r.original_display_text, true), statement_kind: r.statement_kind as string,
    scope: stamp.scope, person_id: stamp.subject_id, relationship_context_id: stamp.relationship_context_id,
    person_display_label: bytes(r.person_label, SAVED_MEMORY_METADATA_MAX_BYTES, true),
    speaker: bytes(r.speaker, SAVED_MEMORY_METADATA_MAX_BYTES, true), reporter: bytes(r.reporter, SAVED_MEMORY_METADATA_MAX_BYTES, true),
    valid_time: r.valid_time === null ? null : savedMemoryDeadline(r.valid_time), observed_time: r.observed_time === null ? null : savedMemoryDeadline(r.observed_time),
    time_status: r.time_status as string, sensitivity: r.sensitivity as string, supersedes_id: nullableID(r.supersedes_id), superseded_by_id: nullableID(r.superseded_by_id), conflict_group_id: nullableID(r.conflict_group_id),
    provenance: Object.freeze({ evidence_retained: true, excerpts_included: false, locator_body_included: false, refs: Object.freeze(references) }) });
  return { item, stamp, anchor: Object.freeze({ created_at: savedMemoryDeadline(r.cursor_time), id }) };
}

export async function searchSavedMemory(context: SavedMemoryDiscoveryContext, value: unknown): Promise<Readonly<SavedMemoryDiscoveryPage>> {
  try {
  const parsed = SavedMemorySearchInputSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "SAVED_MEMORY_QUERY_INVALID", "Use a finite list of nonempty literal clues.");
  const authority = captureSavedMemoryAuthority(context.authority);
  context = { ...context, authority };
  const input = parsed.data, { auth } = authority;
  if (typeof context.finalizeRead !== "function") return savedMemoryUnavailable();
  await context.authority.assertCurrent();
  await context.reads.assertCurrent(context.database);
  const binding = JSON.stringify(["saved-memory-query.v1", auth.accountId, auth.userId, input.terms, input.limit]);
  const digest = createHash("sha256").update(binding, "utf8").digest("hex");
  const state = await queryState(context, digest, input.cursor), anchor = input.cursor ? decodeCursor(input.cursor, state, binding) : null;
  const patterns = input.terms.map(term => "%" + term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_") + "%");
  const result = await context.database.query(`WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at)
    SELECT m.id,m.version,CASE WHEN octet_length(m.display_text)<=32768 THEN m.display_text END AS display_text,
      CASE WHEN m.original_display_text IS NULL OR octet_length(m.original_display_text)<=32768 THEN m.original_display_text END AS original_display_text,
      m.statement_kind,m.scope,CASE WHEN m.scope='self' THEN NULL ELSE m.subject_id END AS subject_id,m.relationship_context_id,CASE WHEN octet_length(s.display_label)<=2048 THEN s.display_label END AS person_label,
      CASE WHEN octet_length(m.speaker)<=2048 THEN m.speaker END AS speaker,CASE WHEN octet_length(m.reporter)<=2048 THEN m.reporter END AS reporter,
      to_char(m.valid_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS valid_time,
      to_char(m.observed_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_time,
      m.time_status,m.sensitivity,m.supersedes_id,m.superseded_by_id,m.conflict_group_id,
      to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
      jsonb_build_object('item_id',m.id::text,'item_version',m.version,'lineage_epoch',l.epoch::text,
        'memory_owner_id',m.owner_user_id::text,'scope',m.scope,'subject_id',CASE WHEN m.scope='self' THEN NULL ELSE m.subject_id::text END,'relationship_context_id',m.relationship_context_id::text) AS stamp,
      (SELECT jsonb_agg(jsonb_build_object('evidence_id',e.id::text,'source_kind',CASE WHEN e.locator->>'kind' IN ('message','image_region','document') THEN e.locator->>'kind' ELSE 'other' END,
        'capture_id',e.capture_id::text,'source_resource_id',e.source_resource_id::text,'source_session_id',e.source_session_id::text,'source_message_id',e.source_message_id::text,
        'source_artifact_id',CASE WHEN octet_length(e.source_artifact_id)<=1024 THEN e.source_artifact_id END,
        'locator_sha256',CASE WHEN e.content_protocol='literal-v2' THEN e.content_manifest->>'source_locator_sha256' ELSE NULL END) ORDER BY e.id)
        FROM (SELECT * FROM memory_item_evidence e WHERE e.account_id=m.account_id AND e.memory_item_id=m.id AND e.status='active' ORDER BY e.id LIMIT 11) e) AS evidence_refs,
      (octet_length(m.display_text)<=32768 AND (m.original_display_text IS NULL OR octet_length(m.original_display_text)<=32768)
        AND (m.speaker IS NULL OR octet_length(m.speaker)<=2048) AND (m.reporter IS NULL OR octet_length(m.reporter)<=2048)
        AND (s.display_label IS NULL OR octet_length(s.display_label)<=2048)
        AND NOT EXISTS (SELECT 1 FROM memory_item_evidence e WHERE e.account_id=m.account_id AND e.memory_item_id=m.id
          AND e.status='active' AND octet_length(e.source_artifact_id)>1024)) AS representation_ok
    FROM memory_items m JOIN memory_item_lineage l ON l.account_id=m.account_id AND l.memory_item_id=m.id
    LEFT JOIN subjects s ON s.account_id=m.account_id AND s.id=m.subject_id CROSS JOIN tick
    WHERE m.account_id=$1 AND m.owner_user_id=$2 AND saved_memory_item_readable($1,$2,m.id,true)
      AND m.created_at<=$4::timestamptz AND tick.checked_at<$5::timestamptz
      AND (m.display_text ILIKE ANY($3::text[]) OR m.original_display_text ILIKE ANY($3::text[]) OR s.display_label ILIKE ANY($3::text[]))
      AND ($6::timestamptz IS NULL OR m.created_at<$6::timestamptz OR (m.created_at=$6::timestamptz AND m.id>$7::uuid))
    ORDER BY m.created_at DESC,m.id LIMIT $8`, [auth.accountId, auth.userId, patterns, state.cutoff, state.expiresAt, anchor?.created_at ?? null, anchor?.id ?? null, input.limit + 1]);
  const rows = savedMemoryOwnArray(result.rows, 21), selected: ReturnType<typeof projectSavedMemoryDiscoveryRow>[] = [];
  const remaining = context.remainingContextCharacters();
  if (!Number.isSafeInteger(remaining) || remaining < 0) return savedMemoryBudgetLimited();
  const contextLimit = Math.min(SAVED_MEMORY_RUN_CONTEXT_MAX, remaining);
  const page = (values: typeof selected, more: boolean): SavedMemoryDiscoveryPage => Object.freeze({ matching: "literal_terms_any",
    coverage: "current_authorized_matches_under_fixed_cutoff", semantic_absence: false, items: Object.freeze(values.map(value => value.item)),
    has_more: more, next_cursor: more && values.length ? encodeCursor(state, values[values.length - 1]!.anchor, binding) : null });
  let output = page([], false);
  for (const row of rows.slice(0, input.limit)) {
    const next = projectSavedMemoryDiscoveryRow(row), candidate = [...selected, next], possible = page(candidate, rows.length > candidate.length);
    const json = JSON.stringify(possible);
    if (Buffer.byteLength(json, "utf8") > SAVED_MEMORY_PAGE_MAX_JSON_BYTES || json.length > contextLimit) break;
    selected.push(next); output = possible;
  }
  if (rows.length && !selected.length) return savedMemoryBudgetLimited();
  const proof = context.reads.snapshot();
  const candidates = selected.map(value => value.stamp);
  // The admission preview below is private metadata only. Its source recheck
  // uses the original epochs captured beside the text, never a new baseline.
  const merged = new Map(proof.stamps.map(stamp => [stamp.item_id, stamp]));
  for (const stamp of candidates) {
    const prior = merged.get(stamp.item_id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(stamp)) return savedMemoryUnavailable();
    merged.set(stamp.item_id, stamp);
  }
  if (merged.size > 256) return savedMemoryBudgetLimited();
  const prospective = captureSavedMemoryReadProof({ ...proof, stamps: [...merged.values()].sort((a, b) => a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0) });
  const ticket = await finalTicket(context, Object.freeze({ proof: prospective, query_id: state.id, query_digest: digest,
    projection_version: 1, cutoff: state.cutoff, query_expires_at: state.expiresAt, literal_patterns: Object.freeze([...patterns]),
    page_limit: input.limit, delivered_stamps: Object.freeze(candidates) }));
  // Nothing asynchronous may follow the real owner's final envelope.
  if (JSON.stringify(context.reads.snapshot()) !== JSON.stringify(proof)) return savedMemoryUnavailable();
  const json = JSON.stringify(output);
  if (Buffer.byteLength(json, "utf8") > SAVED_MEMORY_PAGE_MAX_JSON_BYTES || json.length > contextLimit) return savedMemoryBudgetLimited();
  if (!context.chargeContextCharacters(json.length)) return savedMemoryBudgetLimited();
  context.reads.admit(candidates);
  ticket.assertLive();
  return output;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Never pass arbitrary SQL/callback/private exception prose to a tool.
    // The Run owner latches this terminal if an earlier Memory read was admitted.
    return savedMemoryUnavailable();
  }
}
