/** Opt-in DTOs only. Legacy canonical prose fields keep their old contracts.
 * A reference, preview, confirmation or descriptor is never an access grant. */
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { MemoryAdmissionSchema, MemoryContactDecisionSchema, MemoryDecisionSchema,
  MemoryDependenceKindSchema, MemoryJudgmentSchema, MemoryOperationSchema, MemoryProposalItemStatusSchema,
  MemoryRelationshipKindSchema, MemoryScopeSchema, MemorySensitivitySchema, MemoryStatementKindSchema,
  MemorySubjectKindSchema, MemorySurfaceSchema, MemoryTimeStatusSchema } from "./memorySchemas.js";
import { MemoryDraftLiteralReferenceSchema,
  MemoryLiteralDescriptorSchema, MemoryLiteralPageSchema } from "./memoryLiteralSchemas.js";

const obj = { additionalProperties: false } as const;
const id = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 1, maximum: 2_147_483_647 });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const optional = <T extends TSchema>(schema: T) => Type.Optional(nullable(schema));
const text = (maxLength: number) => Type.String({ maxLength });
const stamp = text(35);
const itemTarget = Type.Object({ kind: Type.Literal("proposal_item"), item_id: id, item_added_revision: revision,
  field: Type.Union([Type.Literal("display_text"), Type.Literal("original_display_text"), Type.Literal("source_excerpt")]) }, obj);
const acceptedTarget = Type.Union([
  Type.Object({ kind: Type.Literal("memory_item"), item_id: id, item_version: revision,
    field: Type.Union([Type.Literal("display_text"), Type.Literal("original_display_text")]) }, obj),
  Type.Object({ kind: Type.Literal("memory_evidence"), evidence_id: id, content_version: Type.Literal(1), field: Type.Literal("excerpt") }, obj),
]);
const statementCount = Type.Integer({ minimum: 1, maximum: 32_768 });
const statementDescriptor = Type.Object({ sha256: hash, utf8_bytes: statementCount,
  utf16_code_units: statementCount, unicode_scalar_count: statementCount }, obj);
const referenceFor = <T extends TSchema, D extends TSchema>(target: T, descriptor: D) => Type.Union([
  Type.Object({ reference_version: Type.Literal(1), target, descriptor,
    content_protocol: Type.Literal("legacy-v1"), content_manifest_digest: Type.Null() }, obj),
  Type.Object({ reference_version: Type.Literal(1), target, descriptor,
    content_protocol: Type.Literal("literal-v2"), content_manifest_digest: hash }, obj),
]);
const previewFor = <T extends TSchema>(reference: T, draft = false) => Type.Object({ preview_version: Type.Literal(1),
  text_preview: Type.String({ minLength: draft ? 0 : 1, maxLength: 256 }), reference,
  coverage: Type.Object({ status: Type.Union([Type.Literal("complete"), Type.Literal("partial")]), start: Type.Literal(0),
    end: Type.Integer({ minimum: 0, maximum: 256 }), total_utf16_code_units: Type.Integer({ minimum: draft ? 0 : 1, maximum: 65_536 }),
    total_utf8_bytes: Type.Integer({ minimum: draft ? 0 : 1, maximum: 65_536 }) }, obj) }, obj);
const proposalPreview = (field: "display_text" | "original_display_text" | "source_excerpt") => previewFor(referenceFor(
  Type.Object({ kind: Type.Literal("proposal_item"), item_id: id, item_added_revision: revision, field: Type.Literal(field) }, obj),
  field === "source_excerpt" ? MemoryLiteralDescriptorSchema : statementDescriptor));
const acceptedPreview = (field: "display_text" | "original_display_text") => previewFor(referenceFor(
  Type.Object({ kind: Type.Literal("memory_item"), item_id: id, item_version: revision, field: Type.Literal(field) }, obj), statementDescriptor));
export const MemoryLiteralEntryScopeV2Schema = Type.Object({ purpose: MemorySurfaceSchema, person_id: nullable(id),
  relationship_context_id: nullable(id), source_session_id: nullable(id), pursuit_id: nullable(id), pursuit_role_id: nullable(id),
  pursuit_role_evidence_fragment_id: nullable(id), pursuit_capture_id: nullable(id), pursuit_capture_version: nullable(revision) }, obj);
const pageRequest = <T extends TSchema>(reference: T) => Type.Object({ page_version: Type.Literal(1), reference,
  offset: Type.Integer({ minimum: 0, maximum: 65_536 }) }, obj);
export const MemoryLiteralReviewPageRequestV2Schema = Type.Object({ content_protocol: Type.Literal("literal-v2"),
  page: pageRequest(Type.Union([referenceFor(itemTarget, MemoryLiteralDescriptorSchema), MemoryDraftLiteralReferenceSchema])) }, obj);
export const MemoryLiteralAcceptedPageRequestV2Schema = Type.Object({ content_protocol: Type.Literal("literal-v2"),
  entry_scope: MemoryLiteralEntryScopeV2Schema, page: pageRequest(referenceFor(acceptedTarget, MemoryLiteralDescriptorSchema)) }, obj);
export const MemoryLiteralPageResponseV2Schema = Type.Object({ content_protocol: Type.Literal("literal-v2"), page: MemoryLiteralPageSchema }, obj);

export const MemoryLiteralSourceLocatorV2Schema = Type.Union([
  Type.Object({ kind: Type.Literal("message"), session_id: nullable(id), message_id: nullable(id),
    character_start: Type.Optional(Type.Integer({ minimum: 0, maximum: 2_147_483_647 })),
    character_end: Type.Optional(Type.Integer({ minimum: 0, maximum: 2_147_483_647 })) }, obj),
  Type.Object({ kind: Type.Literal("image_region"), artifact_id: text(200), session_id: nullable(id),
    image_index: Type.Optional(Type.Integer({ minimum: 0, maximum: 9 })), region: Type.Optional(nullable(Type.Object({
      x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }),
      width: Type.Number({ minimum: 0, maximum: 1 }), height: Type.Number({ minimum: 0, maximum: 1 }) }, obj))) }, obj),
  Type.Object({ kind: Type.Literal("document"), source_resource_id: nullable(id), locator_sha256: hash }, obj),
]);
export const MemoryLiteralCandidateV2Schema = Type.Object({ scope: MemoryScopeSchema, operation: MemoryOperationSchema,
  statement_kind: MemoryStatementKindSchema, dependence_kind: Type.Optional(MemoryDependenceKindSchema),
  display_text: Type.String({ minLength: 1, maxLength: 32_768 }), source_excerpt: Type.String({ minLength: 1, maxLength: 65_536 }),
  subject_id: optional(id), relationship_context_id: optional(id), speaker: optional(text(200)), reporter: optional(text(200)),
  valid_time: optional(stamp), observed_time: optional(stamp), time_status: MemoryTimeStatusSchema, sensitivity: MemorySensitivitySchema,
  previous_memory_item_id: optional(id), previous_text: optional(text(32_768)), previous_revision: optional(revision),
  reason: Type.String({ minLength: 1, maxLength: 500 }),
  source_locator: Type.Union([MemoryLiteralSourceLocatorV2Schema.anyOf[0], MemoryLiteralSourceLocatorV2Schema.anyOf[1],
    Type.Object({ kind: Type.Literal("document"), source_resource_id: nullable(id), locator: Type.Record(Type.String(), Type.Unknown()) }, obj)]) }, obj);

export const MemoryLiteralReviewItemV2Schema = Type.Object({ content_protocol: Type.Literal("literal-v2"), id,
  scope: MemoryScopeSchema, subject_kind: MemorySubjectKindSchema, relationship_kind: MemoryRelationshipKindSchema,
  operation: MemoryOperationSchema, statement_kind: MemoryStatementKindSchema,
  display_text_preview: proposalPreview("display_text"), original_display_text_preview: nullable(proposalPreview("original_display_text")),
  source_excerpt_preview: proposalPreview("source_excerpt"), previous_memory: nullable(acceptedPreview("display_text")),
  previous_memory_item_id: nullable(id), previous_revision: nullable(revision), subject_id: nullable(id), relationship_context_id: nullable(id),
  speaker: nullable(text(200)), reporter: nullable(text(200)), valid_time: nullable(stamp), observed_time: nullable(stamp),
  time_status: MemoryTimeStatusSchema, sensitivity: MemorySensitivitySchema, admission_status: MemoryAdmissionSchema,
  judgment_kind: MemoryJudgmentSchema, judgment_reason: nullable(text(500)), default_selected: Type.Boolean(), reason: text(500),
  source_locator: MemoryLiteralSourceLocatorV2Schema, added_revision: revision, status: MemoryProposalItemStatusSchema }, obj);
export const MemoryLiteralDraftV2Schema = Type.Object({ content_protocol: Type.Literal("literal-v2"), draft_id: id,
  revision, review_scope_id: id, contact_decision: MemoryContactDecisionSchema,
  selected_item_ids: Type.Array(id, { maxItems: 200, uniqueItems: true }),
  edits: Type.Record(id, previewFor(MemoryDraftLiteralReferenceSchema, true), { maxProperties: 200, additionalProperties: false }),
  item_decisions: Type.Record(id, MemoryDecisionSchema, { maxProperties: 200, additionalProperties: false }), updated_at: stamp }, obj);

export const MemoryLiteralReviewedEvidenceV2Schema = Type.Union([
  Type.Object({ evidence_id: id, content_version: Type.Literal(1), content_protocol: Type.Literal("legacy-v1"), content_manifest_digest: Type.Null() }, obj),
  Type.Object({ evidence_id: id, content_version: Type.Literal(1), content_protocol: Type.Literal("literal-v2"), content_manifest_digest: hash }, obj),
]);
const acceptedFacts = { content_protocol: Type.Literal("literal-v2"), content_manifest_digest: hash, final_descriptor: statementDescriptor,
  reviewed_evidence: Type.Array(MemoryLiteralReviewedEvidenceV2Schema, { minItems: 1, maxItems: 10 }) };
export const MemoryLiteralAcceptedFactsV2Schema = Type.Union([
  Type.Object({ ...acceptedFacts, original_content_protocol: Type.Literal("legacy-v1"), original_descriptor: nullable(statementDescriptor) }, obj),
  Type.Object({ ...acceptedFacts, original_content_protocol: Type.Literal("literal-v2"), original_descriptor: statementDescriptor }, obj),
]);
export const MemoryLiteralReceiptFactsV2Schema = Type.Object({ content_protocol: Type.Literal("literal-v2"),
  changes: Type.Array(Type.Union([
    Type.Object({ proposal_item_id: id, decision: Type.Union([Type.Literal("accept"), Type.Literal("accept_new"), Type.Literal("retain_conflict")]),
      memory_item_id: id, accepted_content: MemoryLiteralAcceptedFactsV2Schema }, obj),
    Type.Object({ proposal_item_id: id, decision: Type.Union([Type.Literal("keep_old"), Type.Literal("skip")]),
      memory_item_id: Type.Null(), accepted_content: Type.Null() }, obj),
  ]), { maxItems: 200 }) }, obj);
export const MemoryLiteralRecallItemV2Schema = Type.Object({ content_protocol: Type.Literal("literal-v2"), id,
  scope: MemoryScopeSchema, statement_kind: MemoryStatementKindSchema, display_text_preview: acceptedPreview("display_text"),
  original_display_text_preview: nullable(acceptedPreview("original_display_text")), subject_id: nullable(id), relationship_context_id: nullable(id),
  speaker: nullable(text(200)), reporter: nullable(text(200)), valid_time: nullable(stamp), observed_time: nullable(stamp),
  time_status: MemoryTimeStatusSchema, sensitivity: MemorySensitivitySchema, version: revision, supersedes_id: nullable(id),
  conflict_group_id: nullable(id), evidence_retained: Type.Boolean(), can_edit: Type.Boolean(),
  evidence_refs: Type.Array(Type.Object({ evidence_id: id, excerpt_preview: previewFor(referenceFor(acceptedTarget.anyOf[1], MemoryLiteralDescriptorSchema)),
    locator: MemoryLiteralSourceLocatorV2Schema, capture_id: nullable(id), source_resource_id: nullable(id), source_session_id: nullable(id),
    source_message_id: nullable(id), source_artifact_id: nullable(text(200)) }, obj), { maxItems: 10 }), created_at: stamp }, obj);

export type MemoryLiteralEntryScopeV2 = Static<typeof MemoryLiteralEntryScopeV2Schema>;
export type MemoryLiteralReviewItemV2 = Static<typeof MemoryLiteralReviewItemV2Schema>;
export type MemoryLiteralDraftV2 = Static<typeof MemoryLiteralDraftV2Schema>;
export type MemoryLiteralRecallItemV2 = Static<typeof MemoryLiteralRecallItemV2Schema>;
export type MemoryLiteralReceiptFactsV2 = Static<typeof MemoryLiteralReceiptFactsV2Schema>;
