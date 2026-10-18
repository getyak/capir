import { Pool, type PoolClient } from "pg";
import { createHash } from "node:crypto";
import { inTransaction } from "../database/pool.js";
import { observationID, type ProductRunSpan } from "@talent-signal/agent";
import { labHash } from "./labJobCases.js";

/** Freeze the exact returned version. A resumed task cannot inherit its earlier rating. */
export async function saveProductRunOutput(client: Pool | PoolClient, match: { id?: string; accountID?: string; taskID?: string },
  output: Record<string, unknown>, status: string): Promise<void> {
  if (client instanceof Pool) return inTransaction(client, transaction => saveProductRunOutput(transaction, match, output, status));
  // Match checkpoint lock order: canonical task before its diagnostic run.
  // A directory invalidation may advance the task while its old HTTP result is in flight.
  const canonical=match.taskID?(await client.query<{revision:number}>(`SELECT t.revision FROM screenshot_contact_tasks t
    JOIN product_runs r ON r.account_id=t.account_id AND r.task_id=t.id
    WHERE t.id=$3::uuid AND r.task_kind='screenshot'
      AND ($1::uuid IS NOT NULL AND r.id=$1 OR $1 IS NULL AND r.account_id=$2::uuid) FOR SHARE OF t`,
    [match.id??null,match.accountID??null,match.taskID])).rows[0]:undefined;
  if(canonical && Number(output.revision??0)<canonical.revision)return;
  const admitted=(await client.query<{id:string;task_id:string|null;task_kind:string;revision:number}>(`SELECT id,task_id,task_kind,
    COALESCE((output->>'revision')::int,0) AS revision FROM product_runs
    WHERE ($1::uuid IS NOT NULL AND id=$1 OR $1 IS NULL AND account_id=$2::uuid AND task_id=$3::uuid) FOR UPDATE`,
    [match.id??null,match.accountID??null,match.taskID??null])).rows[0];
  if (!admitted || admitted.task_id && admitted.task_id!==match.taskID
    || admitted.task_kind==='screenshot' && admitted.revision>Number(output.revision??0)) return;
  const hash = labHash(output);
  // Screenshot checkpoints legitimately update their own source generation.
  // Rebind only to a currently admitted canonical screenshot, never to failure.
  // The forward purge keeps only the strictly sanitized usage diagnostics that
  // the narrow admission still allows; raw input/output stays generation-fenced.
  if (match.taskID && !(["failed","deleted","expired","cancelled"] as string[]).includes(status)) {
    await client.query(`UPDATE product_runs r SET source_generation=g.generation
      FROM harness_source_generations g WHERE g.account_id=r.account_id AND r.task_kind='screenshot'
        AND r.task_id=$3::uuid AND ($1::uuid IS NOT NULL AND r.id=$1 OR $1 IS NULL AND r.account_id=$2::uuid)
        AND r.expires_at>clock_timestamp()
        AND agent_session_screenshot_context_available(r.account_id,r.task_id)`,[match.id??null,match.accountID??null,match.taskID]);
  }
  await client.query(`UPDATE product_runs SET task_id=COALESCE(task_id,$3::uuid),
    output=CASE WHEN $6 NOT IN ('failed','deleted','expired','cancelled') AND product_run_source_available(id) THEN $4::jsonb ELSE NULL END,output_hash=$5,
    status=$6,updated_at=now(),finished_at=CASE WHEN $6='running' THEN NULL
      WHEN status IS DISTINCT FROM $6 OR output_hash IS DISTINCT FROM $5 THEN clock_timestamp()
      ELSE COALESCE(finished_at,clock_timestamp()) END,
    sentiment=CASE WHEN output_hash=$5 THEN sentiment ELSE NULL END,
    reasons=CASE WHEN output_hash=$5 THEN reasons ELSE '[]'::jsonb END,
    comment=CASE WHEN output_hash=$5 THEN comment ELSE '' END,
    correction=CASE WHEN output_hash=$5 THEN correction ELSE '' END,
    selected_text=CASE WHEN output_hash=$5 THEN selected_text ELSE '' END,
    feedback_updated_at=CASE WHEN output_hash=$5 THEN feedback_updated_at ELSE NULL END
    WHERE ($1::uuid IS NOT NULL AND id=$1 OR $1 IS NULL AND account_id=$2::uuid AND task_id=$3::uuid)
    AND (output_hash IS NULL OR $3::uuid IS NOT NULL AND (task_id IS NULL OR task_id=$3))
    AND (task_kind<>'screenshot' OR COALESCE((output->>'revision')::int,0)<=COALESCE(($4::jsonb->>'revision')::int,0))`,
  [match.id ?? null, match.accountID ?? null, match.taskID ?? null, JSON.stringify(output), hash, status]);
}

const omitted = () => ({ status: "unavailable" as const, original_bytes: 0, retained_bytes: 0, sha256: null });
// One shared allowlist for both the sink placeholder and cleanupSQL. The flat
// sdk_* usage keys are bounded numeric/string diagnostics hashed upstream; the
// raw SDK message id and nested usage stay full-source only. Every value must
// remain a flat primitive, so this list never widens retained metadata.
const metadataKeys = ["model", "provider", "prompt_revision", "input_tokens", "output_tokens", "duration_ms", "usage", "cost_usd", "session_id", "message_id", "queue_entry_id", "run_id", "task_id", "attempt",
    "failure_code", "sdk_initialized_ms", "sdk_first_response_ms", "model_responses", "tool_calls", "usage_complete",
    "api_retry_count", "last_api_status", "sdk_session_id", "phase",
    "sdk_message_id_sha256", "sdk_input_tokens", "sdk_output_tokens", "sdk_cache_read_input_tokens",
    "sdk_cache_creation_input_tokens", "sdk_total_input_tokens", "sdk_usage_basis", "sdk_stop_reason",
    "reported_model", "raw_usage_known", "raw_prompt_tokens", "raw_completion_tokens",
    "source_image_index", "request_id_sha256"];
export function metadataOnlyProductSpan<T extends { input: unknown; output: unknown; error: string | null; metadata: Record<string, unknown> }>(span: T) {

  return { ...span, input: omitted(), output: omitted(), error: span.error ? "Operation failed" : null,
    metadata: Object.fromEntries(Object.entries(span.metadata).filter(([key,value]) => metadataKeys.includes(key)
      && (typeof value === "number" || typeof value === "boolean" || typeof value === "string" || value === null))) };
}

// Strict per-field sanitizer for the two known source-safe usage span shapes:
// `contact.screenshot.preprocess.usage` and `harness.sdk.assistant`, both
// kind=llm. Allowed values and identifier shapes only; raw request or message
// ids, nested usage, prose, credentials and arbitrary keys never pass. This is
// the single schema behind detail projection, cleanup preservation, the
// generation rebind purge and admitted writes (SQL twin:
// screenshot_usage_diagnostic_metadata). Everything else is dropped.
const ARK_USAGE_SPAN = "contact.screenshot.preprocess.usage";
const SDK_ASSISTANT_SPAN = "harness.sdk.assistant";
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SDK_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const HASH64_PATTERN = /^[a-f0-9]{64}$/;
const SDK_USAGE_BASIS = "per_message_provider_reported_input_excludes_cache";
const SDK_STOP_REASONS = new Set(["end_turn", "tool_use", "max_tokens", "stop_sequence", "pause_turn", "refusal"]);

const boundedCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function usageDiagnosticMetadata(span: { name: string; kind: string; metadata: Record<string, unknown> }): Record<string, unknown> | null {
  const metadata = span.metadata ?? {};
  if (span.name === ARK_USAGE_SPAN && span.kind === "llm") {
    const model = metadata.model, requestHash = metadata.request_id_sha256, sourceIndex = metadata.source_image_index;
    if (metadata.provider !== "volcano_ark" || typeof model !== "string" || !MODEL_PATTERN.test(model)
      || typeof requestHash !== "string" || !HASH64_PATTERN.test(requestHash)
      || typeof sourceIndex !== "number" || !Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex > 9) return null;
    const prompt = boundedCount(metadata.raw_prompt_tokens), completion = boundedCount(metadata.raw_completion_tokens);
    const known = metadata.raw_usage_known === true && prompt !== null && completion !== null;
    return { provider: "volcano_ark", model,
      reported_model: typeof metadata.reported_model === "string" && MODEL_PATTERN.test(metadata.reported_model) ? metadata.reported_model : null,
      raw_usage_known: known, raw_prompt_tokens: known ? prompt : null, raw_completion_tokens: known ? completion : null,
      source_image_index: sourceIndex, request_id_sha256: requestHash };
  }
  if (span.name === SDK_ASSISTANT_SPAN && span.kind === "llm") {
    const model = metadata.model, messageHash = metadata.sdk_message_id_sha256;
    if (metadata.provider !== "claude-agent-sdk" || typeof model !== "string" || !SDK_MODEL_PATTERN.test(model)
      || typeof messageHash !== "string" || !HASH64_PATTERN.test(messageHash)
      || metadata.sdk_usage_basis !== SDK_USAGE_BASIS) return null;
    return { provider: "claude-agent-sdk", model, sdk_message_id_sha256: messageHash,
      sdk_input_tokens: boundedCount(metadata.sdk_input_tokens), sdk_output_tokens: boundedCount(metadata.sdk_output_tokens),
      sdk_cache_read_input_tokens: boundedCount(metadata.sdk_cache_read_input_tokens),
      sdk_cache_creation_input_tokens: boundedCount(metadata.sdk_cache_creation_input_tokens),
      sdk_total_input_tokens: boundedCount(metadata.sdk_total_input_tokens), sdk_usage_basis: SDK_USAGE_BASIS,
      sdk_stop_reason: typeof metadata.sdk_stop_reason === "string" && SDK_STOP_REASONS.has(metadata.sdk_stop_reason) ? metadata.sdk_stop_reason : null };
  }
  return null;
}

/** Strict metadata-only projection for the narrow usage-diagnostics read path. */
export function usageDiagnosticProjection(span: ProductRunSpan): ProductRunSpan | null {
  const metadata = usageDiagnosticMetadata({ name: span.name, kind: span.kind, metadata: span.metadata });
  if (!metadata) return null;
  return { ...span, input: omitted(), output: omitted(), error: span.error ? "Operation failed" : null, metadata };
}

/** Explicitly observed Ark raw usage, one bounded record per provider receipt. */
export interface ScreenshotUsageDiagnostic {
  provider: string;
  model: string;
  reported_model: string | null;
  source_image_index: number;
  request_id: string;
  raw_usage_known: boolean;
  raw_prompt_tokens: number | null;
  raw_completion_tokens: number | null;
}

/** Persist source-safe usage diagnostics for the canonical admitted screenshot
 * run. Counters only: raw input/output stays generation-fenced and every write
 * revalidates the narrow same-owner source admission (SQL twin of the read,
 * purge and cleanup paths), so a revoked, expired or deleted source can never
 * be recreated. Absent or invalid raw usage is stored as explicitly unknown; a
 * provider-reported zero stays an exact zero. */
export async function saveProductRunUsageDiagnostics(client: Pool | PoolClient,
  match: { accountID: string; taskID: string }, diagnostics: readonly ScreenshotUsageDiagnostic[]): Promise<void> {
  for (const diagnostic of diagnostics) {
    if (typeof diagnostic.request_id !== "string" || !diagnostic.request_id || diagnostic.request_id.length > 200) continue;
    const metadata = usageDiagnosticMetadata({ name: ARK_USAGE_SPAN, kind: "llm", metadata: {
      provider: diagnostic.provider, model: diagnostic.model,
      reported_model: diagnostic.reported_model ?? null,
      raw_usage_known: diagnostic.raw_usage_known === true,
      raw_prompt_tokens: diagnostic.raw_prompt_tokens ?? null,
      raw_completion_tokens: diagnostic.raw_completion_tokens ?? null,
      source_image_index: diagnostic.source_image_index,
      request_id_sha256: createHash("sha256").update(diagnostic.request_id).digest("hex"),
    } });
    if (!metadata) continue;
    const timestamp = new Date().toISOString();
    const span = { id: observationID(`${match.taskID}:usage:${diagnostic.request_id}`), parent_id: null,
      name: ARK_USAGE_SPAN, kind: "llm", started_at: timestamp, finished_at: timestamp,
      status: "completed", input: omitted(), output: omitted(), metadata, error: null };
    await client.query(`INSERT INTO product_run_spans(id,run_id,span)
      SELECT $1,r.id,$2::jsonb FROM product_runs r
      WHERE r.account_id=$3 AND r.task_id=$4::uuid AND r.task_kind='screenshot'
        AND screenshot_usage_diagnostics_available(r.id)
      ON CONFLICT(id) DO UPDATE SET span=EXCLUDED.span
      WHERE product_run_spans.run_id=EXCLUDED.run_id`,
    [span.id,JSON.stringify(span),match.accountID,match.taskID]);
  }
}

/** Content stays request-local until a committed product source admits it.
 * Each DB statement only retains metadata during execution; a late append can
 * never recreate revoked content after cleanup. */
export function productRunSink(pool: Pool, id: string, onError: (error: unknown) => void, admittedGeneration?: string | null) {
  let writes: Promise<void> = Promise.resolve();
  let retainedBytes = 0;
  let sourceExpiresAt: number | undefined;
  const pending = new Map<string, ProductRunSpan>();
  return {
    async append(span: ProductRunSpan) {
      const safe = metadataOnlyProductSpan(span);
      const input=span.input.value as {observation?:{source_refs?:{kind?:string;expires_at?:string}}} | undefined;
      const refs=input?.observation?.source_refs;
      if (refs?.kind === "product") {
        const expiry=Date.parse(refs.expires_at??"");
        sourceExpiresAt=Math.min(sourceExpiresAt??Infinity,Number.isFinite(expiry)?expiry:0);
      }
      const bytes = Buffer.byteLength(JSON.stringify(span));
      if (span.status === "completed" && retainedBytes + bytes <= 16_000_000) { pending.set(span.id, span); retainedBytes += bytes; }
      writes = writes.then(async () => {
        await pool.query("INSERT INTO product_run_spans(id,run_id,span) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING", [span.id,id,JSON.stringify(safe)]);
      }).catch(onError);
    },
    async flush() {
      await writes;
      try {
        await inTransaction(pool, async client => {
          if (sourceExpiresAt !== undefined) await client.query("UPDATE product_runs SET expires_at=LEAST(expires_at,$2) WHERE id=$1",[id,new Date(sourceExpiresAt)]);
          // Short authority locks serialize with source revocation, not the SDK.
          const row = (await client.query<{available:boolean}>(`SELECT product_run_source_available(r.id)
              AND r.source_generation=$2::bigint AS available
            FROM product_runs r JOIN harness_source_generations g ON g.account_id=r.account_id
            WHERE r.id=$1 FOR SHARE OF r,g NOWAIT`,[id,admittedGeneration??null])).rows[0];
          if (!row?.available) return;
          for (const span of pending.values()) {
            // Cleanup can remove the metadata placeholder before the task commits.
            // Restore the request-local event only under the exact source lease above.
            await client.query(`INSERT INTO product_run_spans(id,run_id,span)
              SELECT $1,$2,$3::jsonb WHERE product_run_source_available($2)
              ON CONFLICT(id) DO UPDATE SET span=EXCLUDED.span
              WHERE product_run_spans.run_id=EXCLUDED.run_id`,[span.id,id,JSON.stringify(span)]);
          }
        });
      } catch (error) { onError(error); }
      finally { pending.clear(); retainedBytes=0; sourceExpiresAt=undefined; }
    },
  };
}

/** Keep bounded diagnostic metadata for unsuccessful attempts, never revoked content.
 * Usage diagnostics of a still admitted same-owner screenshot run survive
 * unrelated account generation drift as strictly sanitized metadata-only
 * spans; every other span and every raw field is removed exactly as before. */
export async function cleanupProductRunSources(pool: Pool): Promise<void> {
  await inTransaction(pool, async client => {
    await client.query(`UPDATE product_run_spans s SET span=(s.span-'input'-'output'-'error'-'metadata')
      || jsonb_build_object('input',$1::jsonb,'output',$1::jsonb,
        'error',CASE WHEN s.span->>'error' IS NULL THEN NULL ELSE 'Operation failed' END,
        'metadata',COALESCE(screenshot_usage_diagnostic_metadata(s.span),'{}'::jsonb))
      FROM product_runs r WHERE r.id=s.run_id AND r.status<>'failed'
        AND NOT product_run_source_available(r.id)
        AND screenshot_usage_diagnostics_available(r.id)`,[JSON.stringify(omitted())]);
    await client.query(`DELETE FROM product_run_spans s USING product_runs r
      WHERE r.id=s.run_id AND r.status<>'failed'
        AND NOT product_run_source_available(r.id)
        AND screenshot_usage_diagnostics_available(r.id)
        AND screenshot_usage_diagnostic_metadata(s.span) IS NULL`);
    await client.query(`DELETE FROM product_run_spans WHERE run_id IN
      (SELECT id FROM product_runs WHERE NOT product_run_source_available(id)
        AND NOT (status<>'failed' AND screenshot_usage_diagnostics_available(id))
        AND (expires_at<=clock_timestamp() OR (task_id IS NOT NULL AND status<>'failed')))`);
    await client.query(`UPDATE product_run_spans s SET span=(s.span-'input'-'output'-'error'-'metadata')
      || jsonb_build_object('input',$1::jsonb,'output',$1::jsonb,
        'error',CASE WHEN s.span->>'error' IS NULL THEN NULL ELSE 'Operation failed' END,
        'metadata',COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(s.span->'metadata')
          WHERE key=ANY($2::text[]) AND jsonb_typeof(value) IN ('string','number','boolean','null')),'{}'::jsonb))
      FROM product_runs r WHERE r.id=s.run_id AND NOT product_run_source_available(r.id)
        AND r.expires_at>clock_timestamp() AND (r.task_id IS NULL OR r.status='failed')`,
    [JSON.stringify(omitted()),metadataKeys]);
    await client.query(`UPDATE product_run_feedback_events SET output='null'::jsonb,comment='',correction='',selected_text=''
      WHERE run_id IN (SELECT id FROM product_runs WHERE NOT product_run_source_available(id))`);
    await client.query(`UPDATE product_runs SET input=NULL,output=NULL,objective='',comment='',correction='',selected_text=''
      WHERE NOT product_run_source_available(id) AND
        (input IS NOT NULL OR output IS NOT NULL OR objective<>'' OR comment<>'' OR correction<>'' OR selected_text<>'')`);
  });
}
