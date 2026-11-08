/** Bounded DTOs from already selected rows. None of these pure helpers can
 * load, authorize, retain or publish Memory; real owners must do that work. */
import { Value } from "@sinclair/typebox/value";
import type { Static, TSchema } from "@sinclair/typebox";
import { canonicalMemoryLiteralJson, captureMemoryLiteralData, freezeMemoryLiteralData, MEMORY_LITERAL_UUID,
  MemoryLiteralDraftV2Schema, MemoryLiteralRecallItemV2Schema, MemoryLiteralReceiptFactsV2Schema, MemoryLiteralReviewItemV2Schema,
  resolveMemoryContentProtocol, describeMemoryText, validateMemoryLiteralDescriptor,
  type MemoryLiteralTarget, type MemoryLiteralDescriptor } from "@talent-signal/contracts";
import { sha256 } from "../lib/hash.js";
import { createMemoryLiteralPreview } from "./memoryLiteralContent.js";
import { captureMemoryLiteralRow, memoryLiteralUnavailable, pickMemoryLiteralRow, pickMemoryLiteralRows,
  verifyMemoryLiteralAcceptedRow, verifyMemoryLiteralProposalRow, type LiteralRow } from "./memoryLiteralIntegrity.js";

function projected<T extends TSchema>(schema: T, output: unknown): Readonly<Static<T>> {
  if (!Value.Check(schema, output) || Buffer.byteLength(JSON.stringify(output), "utf8") > 1024 * 1024) return memoryLiteralUnavailable();
  return freezeMemoryLiteralData(output as Static<T>);
}
function locator(row: LiteralRow) {
  const source = row.locator as LiteralRow;
  if (!source || typeof source !== "object") return memoryLiteralUnavailable();
  return source.kind === "document" ? { kind: "document" as const, source_resource_id: source.source_resource_id ?? null,
    locator_sha256: sha256(canonicalMemoryLiteralJson(source)) } : source;
}
function preview(row: LiteralRow, target: MemoryLiteralTarget, text: unknown, descriptor: unknown = null) {
  const protocol = resolveMemoryContentProtocol(row.content_protocol);
  return createMemoryLiteralPreview({ target, text, content_protocol: protocol,
    ...(target.kind === "review_draft" ? {} : { content_manifest_digest: row.content_manifest_digest ?? null,
      ...(protocol === "literal-v2" ? { stored_descriptor: descriptor } : {}) }) });
}
const descriptiveKeys = ["id", "scope", "statement_kind", "subject_id", "relationship_context_id", "speaker", "reporter",
  "valid_time", "observed_time", "time_status", "sensitivity"] as const;
function description(row: LiteralRow): LiteralRow {
  return Object.fromEntries(descriptiveKeys.map(key => [key, row[key] ?? null]));
}

export async function projectMemoryLiteralReviewItem(value: unknown) {
  const row = captureMemoryLiteralRow(value), manifest = await verifyMemoryLiteralProposalRow(row);
  const target = (field: "display_text" | "original_display_text" | "source_excerpt"): MemoryLiteralTarget => ({ kind: "proposal_item",
    item_id: row.id as string, item_added_revision: row.added_revision as number, field });
  return projected(MemoryLiteralReviewItemV2Schema, { content_protocol: "literal-v2", ...description(row),
    subject_kind: row.subject_kind, relationship_kind: row.relationship_kind, operation: row.operation,
    display_text_preview: preview(row, target("display_text"), row.display_text, manifest?.display_text),
    original_display_text_preview: row.original_display_text === null ? null
      : preview(row, target("original_display_text"), row.original_display_text, manifest?.original_display_text),
    source_excerpt_preview: preview(row, target("source_excerpt"), row.source_excerpt, manifest?.source_excerpt),
    // Model previous_text has no accepted-row proof. A real owner may separately
    // load/project the previous accepted item; this helper never certifies it.
    previous_memory: null, previous_memory_item_id: row.previous_memory_item_id ?? null, previous_revision: row.previous_revision ?? null,
    admission_status: row.admission_status, judgment_kind: row.judgment_kind, judgment_reason: row.admission_reason ?? null,
    default_selected: row.default_selected, reason: row.reason, source_locator: locator(row), added_revision: row.added_revision, status: row.status });
}

export async function projectMemoryLiteralDraft(value: unknown, reading: unknown) {
  // A durable draft may accumulate 200x32KiB over several valid requests. Its
  // storage validation must not apply a single-request 256KiB/1MiB budget.
  const row = captureMemoryLiteralData(pickMemoryLiteralRow(value, ["id", "revision", "content_protocol", "contact_decision",
    "selected_item_ids", "edited_text", "item_decisions", "updated_at"]), 8 * 1024 * 1024) as LiteralRow;
  const scope = captureMemoryLiteralData(reading) as LiteralRow;
  if (!scope || Array.isArray(scope) || Object.keys(scope).sort().join(",") !== "review_scope_id,visible_item_ids"
    || typeof scope.review_scope_id !== "string" || !MEMORY_LITERAL_UUID.test(scope.review_scope_id)
    || !Array.isArray(scope.visible_item_ids) || scope.visible_item_ids.length > 200) return memoryLiteralUnavailable();
  const ids = (items: unknown): string[] => {
    if (!Array.isArray(items) || items.length > 200 || items.some(id => typeof id !== "string" || !MEMORY_LITERAL_UUID.test(id))
      || new Set(items).size !== items.length) return memoryLiteralUnavailable();
    return items as string[];
  };
  const visible = new Set(ids(scope.visible_item_ids)), selected = ids(row.selected_item_ids);
  const protocol = resolveMemoryContentProtocol(row.content_protocol), edited = row.edited_text, decisions = row.item_decisions;
  if (!edited || typeof edited !== "object" || Array.isArray(edited) || !decisions || typeof decisions !== "object" || Array.isArray(decisions)) return memoryLiteralUnavailable();
  const edits = edited as LiteralRow, itemDecisions = decisions as LiteralRow;
  if (Object.keys(edits).length > 200 || Object.keys(itemDecisions).length > 200) return memoryLiteralUnavailable();
  for (const [key, text] of Object.entries(edits)) {
    if (!MEMORY_LITERAL_UUID.test(key) || typeof text !== "string" || describeMemoryText(text).utf8_bytes > 32_768) return memoryLiteralUnavailable();
  }
  for (const [key, decision] of Object.entries(itemDecisions)) {
    if (!MEMORY_LITERAL_UUID.test(key) || !["accept", "keep_old", "accept_new", "retain_conflict", "skip"].includes(decision as string)) return memoryLiteralUnavailable();
  }
  const outputEdits = Object.fromEntries(Object.entries(edits).filter(([key]) => visible.has(key)).map(([key, text]) => [key,
    preview({ content_protocol: protocol }, { kind: "review_draft", draft_id: row.id as string, draft_revision: row.revision as number,
      review_scope_id: scope.review_scope_id as string, item_id: key, field: "edited_text" }, text)]));
  return projected(MemoryLiteralDraftV2Schema, { content_protocol: "literal-v2", draft_id: row.id, revision: row.revision,
    review_scope_id: scope.review_scope_id, contact_decision: row.contact_decision, selected_item_ids: selected.filter(id => visible.has(id)),
    edits: outputEdits, item_decisions: Object.fromEntries(Object.entries(itemDecisions).filter(([key]) => visible.has(key))), updated_at: row.updated_at });
}

export async function projectMemoryLiteralRecallItem(value: unknown) {
  const outer = pickMemoryLiteralRow(value, ["item", "evidence", "can_edit"]);
  if (typeof outer.can_edit !== "boolean") return memoryLiteralUnavailable();
  // Capture every row before the first role producer awaits.
  const item = captureMemoryLiteralRow(outer.item), evidence = pickMemoryLiteralRows(outer.evidence, 10).map(captureMemoryLiteralRow);
  const proofs = await verifyMemoryLiteralAcceptedRow(item, evidence);
  const target = (field: "display_text" | "original_display_text"): MemoryLiteralTarget => ({ kind: "memory_item",
    item_id: item.id as string, item_version: item.version as number, field });
  return projected(MemoryLiteralRecallItemV2Schema, { content_protocol: "literal-v2", ...description(item), version: item.version,
    display_text_preview: preview(item, target("display_text"), item.display_text, proofs.manifest?.display_text),
    original_display_text_preview: item.original_display_text === null ? null
      : preview(item, target("original_display_text"), item.original_display_text, proofs.manifest?.original_display_text),
    supersedes_id: item.supersedes_id ?? null, conflict_group_id: item.conflict_group_id ?? null,
    evidence_retained: evidence.length > 0, can_edit: outer.can_edit, created_at: item.created_at,
    evidence_refs: evidence.map((row, index) => ({ evidence_id: row.id,
      excerpt_preview: preview(row, { kind: "memory_evidence", evidence_id: row.id as string, content_version: 1, field: "excerpt" },
        row.excerpt, proofs.evidenceManifests[index]?.excerpt), locator: locator(row), capture_id: row.capture_id ?? null,
      source_resource_id: row.source_resource_id ?? null, source_session_id: row.source_session_id ?? null,
      source_message_id: row.source_message_id ?? null, source_artifact_id: row.source_artifact_id ?? null })) });
}

export async function projectMemoryLiteralReceiptFacts(value: unknown) {
  const row = pickMemoryLiteralRow(value, ["changes"]);
  // Intentionally do not traverse discarded old receipt prose.
  const changes = pickMemoryLiteralRows(row.changes, 200).map(change => captureMemoryLiteralData(pickMemoryLiteralRow(change,
    ["proposal_item_id", "decision", "memory_item_id", "accepted_content"])) as LiteralRow);
  const output = projected(MemoryLiteralReceiptFactsV2Schema, { content_protocol: "literal-v2", changes });
  const tuple = (d: MemoryLiteralDescriptor | null) => d === null ? null : [d.sha256, d.utf8_bytes, d.utf16_code_units, d.unicode_scalar_count];
  for (const change of output.changes) {
    const facts = change.accepted_content;
    if (facts === null) continue;
    validateMemoryLiteralDescriptor(facts.final_descriptor);
    if (facts.original_descriptor !== null) validateMemoryLiteralDescriptor(facts.original_descriptor);
    else if (facts.original_content_protocol !== "legacy-v1") return memoryLiteralUnavailable();
    const refs = facts.reviewed_evidence;
    if (new Set(refs.map(ref => ref.evidence_id)).size !== refs.length) return memoryLiteralUnavailable();
    const sorted = [...refs].sort((a, b) => a.evidence_id < b.evidence_id ? -1 : a.evidence_id > b.evidence_id ? 1 : 0);
    if (canonicalMemoryLiteralJson(refs) !== canonicalMemoryLiteralJson(sorted)) return memoryLiteralUnavailable();
    const digest = sha256(JSON.stringify(["memory-accepted-literal.v1", facts.original_content_protocol, tuple(facts.final_descriptor),
      tuple(facts.original_descriptor), refs.map(ref => [ref.evidence_id, ref.content_protocol, ref.content_version, ref.content_manifest_digest])]));
    if (digest !== facts.content_manifest_digest) return memoryLiteralUnavailable();
  }
  return output;
}
