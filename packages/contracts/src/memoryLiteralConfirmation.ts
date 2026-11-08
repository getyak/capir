/** Consistency tuples, not signatures, access grants, or proof of human
 * reading. The real host still owns current membership and atomic publication. */
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describeMemoryText, encodeMemoryLiteralRequest, requireMemoryLiteral, type MemoryLiteralDescriptor } from "./memoryContent.js";
import { MemoryLiteralDescriptorSchema, MemoryLiteralReferenceSchema } from "./memoryLiteralSchemas.js";
import { MemoryDecisionSchema } from "./memorySchemas.js";
import { MemoryLiteralEntryScopeV2Schema, MemoryLiteralReviewedEvidenceV2Schema } from "./memoryLiteralV2Schemas.js";
import { captureMemoryLiteralData, freezeMemoryLiteralData, MEMORY_LITERAL_HASH, memoryLiteralInvalid } from "./memoryLiteralData.js";

type Digest = (text: string) => string | Promise<string>;
const obj = { additionalProperties: false } as const;
const id = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const rev = Type.Integer({ minimum: 1, maximum: 2_147_483_647 });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const provenance = Type.Union([Type.Literal("legacy-v1"), Type.Literal("literal-v2")]);
const ReviewInputSchema = Type.Object({ version: Type.Literal("memory-literal-confirmation.v1"), account_id: id, actor_user_id: id,
  review_scope_id: id, review_revision: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }), proposal_id: id, proposal_revision: rev,
  entry_scope: MemoryLiteralEntryScopeV2Schema, item_id: id, item_added_revision: rev, decision: MemoryDecisionSchema,
  previous_item_version: nullable(rev), proposal_manifest_digest: nullable(hash), final: Type.Union([
    Type.Object({ kind: Type.Literal("proposal"), reference: MemoryLiteralReferenceSchema }, obj),
    Type.Object({ kind: Type.Literal("draft"), reference: MemoryLiteralReferenceSchema }, obj),
    Type.Object({ kind: Type.Literal("inline"), edited_text: Type.String({ minLength: 1, maxLength: 32_768 }), descriptor: MemoryLiteralDescriptorSchema }, obj),
  ]) }, obj);
const MutationInputSchema = Type.Object({ version: Type.Literal("memory-item-mutation-confirmation.v1"), account_id: id, actor_user_id: id,
  item_id: id, expected_item_version: rev, operation: Type.Union([Type.Literal("correct"), Type.Literal("delete")]),
  entry_scope: MemoryLiteralEntryScopeV2Schema, expected_content_protocol: provenance, expected_content_manifest_digest: nullable(hash),
  expected_stored_descriptor: MemoryLiteralDescriptorSchema, original_content_protocol: provenance,
  original_descriptor: nullable(MemoryLiteralDescriptorSchema),
  evidence: Type.Array(MemoryLiteralReviewedEvidenceV2Schema, { minItems: 1, maxItems: 10 }),
  final_descriptor: nullable(MemoryLiteralDescriptorSchema) }, obj);
type ReviewInput = Static<typeof ReviewInputSchema>;
type MutationInput = Static<typeof MutationInputSchema>;
export type MemoryReviewConfirmationV1 = ReviewInput & { confirmation_digest: string };
export type MemoryItemMutationConfirmationV1 = MutationInput & { confirmation_digest: string };

function check<T extends TSchema>(schema: T, input: unknown): Static<T> {
  if (!Value.Check(schema, input)) return memoryLiteralInvalid();
  return input as Static<T>;
}
export function validateMemoryLiteralDescriptor(value: MemoryLiteralDescriptor, maximum = 32_768): void {
  const snapshot = check(MemoryLiteralDescriptorSchema, captureMemoryLiteralData(value));
  const { utf8_bytes: bytes, utf16_code_units: units, unicode_scalar_count: scalars } = snapshot;
  if (bytes > maximum || scalars > units || units > 2 * scalars
    || units > bytes || bytes > 4 * scalars) return memoryLiteralInvalid();
}
function reviewInput(value: unknown): ReviewInput {
  const input = check(ReviewInputSchema, value), final = input.final;
  if (final.kind === "inline") {
    requireMemoryLiteral(final.edited_text, "statement");
    validateMemoryLiteralDescriptor(final.descriptor);
    const stats = describeMemoryText(final.edited_text);
    if (stats.utf8_bytes !== final.descriptor.utf8_bytes || stats.utf16_code_units !== final.descriptor.utf16_code_units
      || stats.unicode_scalar_count !== final.descriptor.unicode_scalar_count) return memoryLiteralInvalid();
  } else {
    const ref = final.reference, target = ref.target;
    validateMemoryLiteralDescriptor(ref.descriptor);
    if (final.kind === "proposal") {
      if (target.kind !== "proposal_item" || target.field !== "display_text" || target.item_id !== input.item_id
        || target.item_added_revision !== input.item_added_revision || ref.content_manifest_digest !== input.proposal_manifest_digest) return memoryLiteralInvalid();
    } else if (target.kind !== "review_draft" || target.review_scope_id !== input.review_scope_id || target.item_id !== input.item_id
      || target.field !== "edited_text" || ref.content_manifest_digest !== null) return memoryLiteralInvalid();
  }
  return input;
}
function mutationInput(value: unknown): MutationInput {
  const input = check(MutationInputSchema, value);
  if ((input.expected_content_protocol === "legacy-v1") !== (input.expected_content_manifest_digest === null)
    || (input.original_content_protocol === "literal-v2" && input.original_descriptor === null)
    || (input.operation === "delete") !== (input.final_descriptor === null)) return memoryLiteralInvalid();
  validateMemoryLiteralDescriptor(input.expected_stored_descriptor);
  if (input.original_descriptor !== null) validateMemoryLiteralDescriptor(input.original_descriptor);
  if (input.final_descriptor !== null) validateMemoryLiteralDescriptor(input.final_descriptor);
  const ids = new Set(input.evidence.map(ref => ref.evidence_id));
  if (ids.size !== input.evidence.length) return memoryLiteralInvalid();
  // Captured arrays are immutable. Sort a new array of independent references.
  return { ...input, evidence: [...input.evidence].sort((a, b) => a.evidence_id < b.evidence_id ? -1 : a.evidence_id > b.evidence_id ? 1 : 0) };
}
const descriptorTuple = (value: MemoryLiteralDescriptor | null) => value === null ? null
  : [value.sha256, value.utf8_bytes, value.utf16_code_units, value.unicode_scalar_count];
function entryTuple(entry: ReviewInput["entry_scope"]): unknown[] {
  return [entry.purpose, entry.person_id, entry.relationship_context_id, entry.source_session_id, entry.pursuit_id,
    entry.pursuit_role_id, entry.pursuit_role_evidence_fragment_id, entry.pursuit_capture_id, entry.pursuit_capture_version];
}
function referenceTuple(reference: Exclude<ReviewInput["final"], { kind: "inline" }>["reference"]): unknown[] {
  const t = reference.target;
  const target = t.kind === "review_draft" ? [t.kind, t.draft_id, t.draft_revision, t.review_scope_id, t.item_id, t.field]
    : t.kind === "proposal_item" ? [t.kind, t.item_id, t.item_added_revision, t.field]
      : t.kind === "memory_item" ? [t.kind, t.item_id, t.item_version, t.field] : [t.kind, t.evidence_id, t.content_version, t.field];
  return [1, target, reference.content_protocol, reference.content_manifest_digest, descriptorTuple(reference.descriptor)];
}
function reviewTuple(input: ReviewInput): string {
  const final = input.final.kind === "inline" ? ["inline", descriptorTuple(input.final.descriptor)]
    : [input.final.kind, referenceTuple(input.final.reference)];
  return JSON.stringify([input.version, input.account_id, input.actor_user_id, input.review_scope_id, input.review_revision,
    input.proposal_id, input.proposal_revision, entryTuple(input.entry_scope), input.item_id, input.item_added_revision,
    input.decision, input.previous_item_version, input.proposal_manifest_digest, final]);
}
function mutationTuple(input: MutationInput): string {
  return JSON.stringify([input.version, input.account_id, input.actor_user_id, input.item_id, input.expected_item_version,
    input.operation, entryTuple(input.entry_scope), input.expected_content_protocol, input.expected_content_manifest_digest,
    descriptorTuple(input.expected_stored_descriptor), input.original_content_protocol, descriptorTuple(input.original_descriptor),
    input.evidence.map(ref => [ref.evidence_id, ref.content_protocol, ref.content_version, ref.content_manifest_digest]), descriptorTuple(input.final_descriptor)]);
}
async function safeHash(text: string, digest: Digest): Promise<string> {
  try {
    const hash = await digest(text);
    if (typeof hash !== "string" || !MEMORY_LITERAL_HASH.test(hash)) return memoryLiteralInvalid();
    return hash;
  } catch { return memoryLiteralInvalid(); }
}
async function reviewHash(input: ReviewInput, digest: Digest): Promise<string> {
  if (input.final.kind === "inline" && await safeHash(input.final.edited_text, digest) !== input.final.descriptor.sha256) return memoryLiteralInvalid();
  return safeHash(reviewTuple(input), digest);
}
function confirmed(value: unknown): { payload: Record<string, unknown>; hash: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return memoryLiteralInvalid();
  const { confirmation_digest, ...payload } = value as Record<string, unknown>;
  if (typeof confirmation_digest !== "string" || !MEMORY_LITERAL_HASH.test(confirmation_digest)) return memoryLiteralInvalid();
  return { payload, hash: confirmation_digest };
}
export async function createMemoryReviewConfirmationV1(value: unknown, digest: Digest): Promise<Readonly<MemoryReviewConfirmationV1>> {
  const input = reviewInput(captureMemoryLiteralData(value));
  encodeMemoryLiteralRequest(input);
  return freezeMemoryLiteralData({ ...input, confirmation_digest: await reviewHash(input, digest) });
}
export async function verifyMemoryReviewConfirmationV1(value: unknown, current: unknown, digest: Digest): Promise<boolean> {
  try {
    // Both complete snapshots precede the first digest await.
    const prior = confirmed(captureMemoryLiteralData(value)), input = reviewInput(prior.payload);
    const now = reviewInput(captureMemoryLiteralData(current));
    return reviewTuple(input) === reviewTuple(now) && await reviewHash(input, digest) === prior.hash
      && await reviewHash(now, digest) === prior.hash;
  } catch { return false; }
}
export async function verifyMemoryReviewConfirmationBatchV1(values: unknown, current: unknown, digest: Digest): Promise<boolean> {
  try {
    const saved = captureMemoryLiteralData(values), actual = captureMemoryLiteralData(current);
    encodeMemoryLiteralRequest(saved);
    if (!Array.isArray(saved) || !Array.isArray(actual) || actual.length === 0 || actual.length > 200 || saved.length !== actual.length) return false;
    const inputs = actual.map(reviewInput), confirmations = saved.map(value => {
      const c = confirmed(value); return { hash: c.hash, input: reviewInput(c.payload) };
    });
    if (new Set(inputs.map(item => item.item_id)).size !== inputs.length
      || new Set(confirmations.map(item => item.input.item_id)).size !== confirmations.length) return false;
    const first = inputs[0]!;
    const context = (item: ReviewInput) => JSON.stringify([item.account_id, item.actor_user_id, item.review_scope_id,
      item.review_revision, item.proposal_id, item.proposal_revision, entryTuple(item.entry_scope)]);
    if (inputs.some(item => context(item) !== context(first))) return false;
    for (const now of inputs) {
      const prior = confirmations.find(item => item.input.item_id === now.item_id);
      if (!prior || reviewTuple(prior.input) !== reviewTuple(now) || await reviewHash(prior.input, digest) !== prior.hash
        || await reviewHash(now, digest) !== prior.hash) return false;
    }
    return true;
  } catch { return false; }
}
export async function createMemoryItemMutationConfirmationV1(value: unknown, digest: Digest): Promise<Readonly<MemoryItemMutationConfirmationV1>> {
  const input = mutationInput(captureMemoryLiteralData(value));
  return freezeMemoryLiteralData({ ...input, confirmation_digest: await safeHash(mutationTuple(input), digest) });
}
export async function verifyMemoryItemMutationConfirmationV1(value: unknown, current: unknown, digest: Digest): Promise<boolean> {
  try {
    const prior = confirmed(captureMemoryLiteralData(value)), input = mutationInput(prior.payload);
    const now = mutationInput(captureMemoryLiteralData(current));
    return mutationTuple(input) === mutationTuple(now) && await safeHash(mutationTuple(input), digest) === prior.hash;
  } catch { return false; }
}
