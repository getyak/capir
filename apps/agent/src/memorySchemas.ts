import { z } from "zod";

/**
 * Typed Agent recall/stage capability for the three-scope Memory review. The
 * model can read current authorized memory and stage review-only candidates;
 * it can never accept memory or create a contact.
 */

const Id = z.string().uuid();
const MemoryScopeSchema = z.enum(["self", "person", "relationship"]);
const MemoryOperationSchema = z.enum(["add", "update", "contest"]);
const MemoryStatementKindSchema = z.enum([
  "fact",
  "source_statement",
  "user_opinion",
]);
const MemoryTimeStatusSchema = z.enum(["known", "unknown", "future", "past"]);
const MemorySensitivitySchema = z.enum(["normal", "sensitive"]);
const MemoryContactDecisionSchema = z.enum(["existing", "new", "none"]);

export const MemorySourceLocatorInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("message"),
    session_id: Id.nullable().optional(),
    message_id: Id.nullable().optional(),
    character_start: z.number().int().min(0).optional(),
    character_end: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    kind: z.literal("image_region"),
    artifact_id: z.string().min(1).max(200),
    session_id: Id.nullable().optional(),
    image_index: z.number().int().min(0).max(9).optional(),
    region: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0).max(1),
        height: z.number().min(0).max(1),
      })
      .strict()
      .nullable()
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("document"),
    source_resource_id: Id.nullable().optional(),
    // An open JSON object, like the host locator contract. The pinned SDK/Zod
    // converter bridge throws for record(string, unknown), causing MCP tools/list to
    // drop the entire server's tools. A loose object preserves the same input.
    locator: z.looseObject({}),
  }),
]);

export const MemoryProposalCandidateInputSchema = z.strictObject({
  scope: MemoryScopeSchema.describe("Required on this individual item; a top-level scope does not replace it."),
  operation: MemoryOperationSchema,
  statement_kind: MemoryStatementKindSchema,
  dependence_kind: z
    .enum(["independent_self", "contact", "relationship"])
    .optional(),
  display_text: z.string().trim().min(1).max(1_000),
  subject_id: Id.nullable().optional(),
  relationship_context_id: Id.nullable().optional(),
  speaker: z.string().max(200).nullable().optional(),
  reporter: z.string().max(200).nullable().optional(),
  valid_time: z.string().datetime().nullable().optional(),
  observed_time: z.string().datetime().nullable().optional(),
  time_status: MemoryTimeStatusSchema,
  sensitivity: MemorySensitivitySchema,
  source_excerpt: z.string().trim().min(1).max(4_000),
  source_locator: MemorySourceLocatorInputSchema,
  previous_memory_item_id: Id.nullable().optional(),
  previous_text: z.string().max(1_000).nullable().optional(),
  previous_revision: z.number().int().min(1).nullable().optional(),
  reason: z.string().trim().min(1).max(500),
});

/**
 * Model-facing superset object. Claude's in-process MCP helper consumes a Zod
 * object shape; the executor always re-parses with the discriminated union.
 */
export const MemoryReviewToolInputSchema = z.strictObject({
  operation: z.enum(["recall", "propose"]),
  scope: MemoryScopeSchema.optional(),
  cursor: z.string().max(500).optional(),
  person_id: Id.nullable().optional(),
  relationship_context_id: Id.nullable().optional(),
  contact_decision: MemoryContactDecisionSchema.optional(),
  person_display_label: z.string().max(200).nullable().optional(),
  relationship_display_label: z.string().max(200).nullable().optional(),
  new_contact_source_locator: MemorySourceLocatorInputSchema.nullable().optional(),
  items: z.array(MemoryProposalCandidateInputSchema).max(40).optional(),
});

export const MemoryReviewInputSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("recall"),
    scope: MemoryScopeSchema.optional(),
    cursor: z.string().max(500).optional(),
    person_id: Id.nullable().optional(),
    relationship_context_id: Id.nullable().optional(),
  }),
  z.strictObject({
    operation: z.literal("propose"),
    scope: MemoryScopeSchema.optional(),
    person_id: Id.nullable().optional(),
    relationship_context_id: Id.nullable().optional(),
    contact_decision: MemoryContactDecisionSchema,
    person_display_label: z.string().max(200).nullable().optional(),
    relationship_display_label: z.string().max(200).nullable().optional(),
    new_contact_source_locator: MemorySourceLocatorInputSchema.nullable().optional(),
    items: z.array(MemoryProposalCandidateInputSchema).max(40),
  }).refine(input => !input.scope || input.items.every(item => item.scope === input.scope),
    "Top-level scope must agree with every proposed item; omit it for mixed scopes.").refine(input => input.items.length > 0 || (input.contact_decision === "new" && Boolean(input.person_display_label?.trim()) && Boolean(input.new_contact_source_locator)),
    "An empty Memory proposal requires a source-grounded new contact."),
]);

export type MemoryReviewToolInput = z.infer<typeof MemoryReviewToolInputSchema>;
export type MemoryReviewInput = z.infer<typeof MemoryReviewInputSchema>;
export type MemoryProposalCandidateInput = z.infer<
  typeof MemoryProposalCandidateInputSchema
>;

/** SDK objects keep each operation's required fields truthful. The host union
 * still owns every cross-field constraint; no missing fact or scope is inferred. */
export function memoryReviewSDKOperationTools() {
  return MemoryReviewInputSchema.options.map(hostSchema => {
    const operation = hostSchema.shape.operation.value;
    const fields = Object.fromEntries(Object.entries(hostSchema.shape)
      .filter(([name]) => name !== "operation" && !(operation === "propose" && name === "scope")));
    const schema = z.strictObject(fields).superRefine((input, context) => {
      const result = MemoryReviewInputSchema.safeParse({ ...input, operation });
      if (!result.success) for (const issue of result.error.issues) context.addIssue({
        code: "custom", path: issue.path, message: "Memory request does not satisfy the host contract.",
      });
    });
    const description = operation === "recall"
      ? "Recall accepted, still-authorized Memory for this task. Set scope self/person/relationship only within the supplied account and view. Follow next_cursor when completeness matters; empty or partial coverage cannot prove absence. Source references do not authorize actions."
      : "Prepare a Memory review, never save accepted state or a contact. contact_decision is required: none for independent self, existing for a resolved contact, or new for an editable source-backed contact draft. Each item requires its own scope, exact source excerpt and locator, speaker/time limits and future-use reason. Keep ambiguity and conflicts. A contact-only draft may use items:[] only with contact_decision:new, person_display_label and new_contact_source_locator. Human review still decides what to save.";
    return { name: `memory_review_${operation}`, operation, description, schema, readOnly: operation === "recall" };
  });
}

/**
 * Ground every image/document locator in an artifact admitted to this Run.
 * Name-only or face similarity is never accepted as a stable identity clue.
 */
export function memoryLocatorAdmissionError(
  items: readonly MemoryProposalCandidateInput[],
  admittedArtifactIds: readonly string[],
): string | null {
  const admitted = new Set(admittedArtifactIds);
  for (const item of items) {
    if (item.source_locator.kind === "image_region") {
      if (!admitted.has(item.source_locator.artifact_id)) {
        return `MEMORY_SOURCE_ARTIFACT_NOT_ADMITTED:${item.source_locator.artifact_id}`;
      }
    }
  }
  return null;
}

export const MEMORY_RELATIONSHIP_RECALL_DESCRIPTION =
  "Recall accepted, still-authorized Memory for the exact relationship of this chat. Returns only this contact's person/relationship statements with their statement kind and time; private self memory is never returned here. Read before answering a recollection question.";

/** Host-only hooks the relationship Chat provider exposes as one typed tool. */
export interface RemoteChatMemoryProposalReference {
  proposal_id: string;
  proposal_revision: number;
  item_count: number;
  default_selected_count: number;
}

export interface RemoteChatMemoryReviewHooks {
  recall(input?: { scope?: "person" | "relationship" | undefined; cursor?: string | undefined }): Promise<import("./memoryContext.js").AgentMemoryPage>;
  stage(input: {
    contact_decision: "existing" | "new" | "none";
    person_display_label?: string | null;
    items: MemoryProposalCandidateInput[];
  }): Promise<RemoteChatMemoryProposalReference | null>;
}

export const MEMORY_REVIEW_TOOL_DESCRIPTION = [
  "Recall or stage the three-scope Memory review for the authenticated account.",
  'Use {"operation":"recall"} to read accepted, still-valid self/person/relationship memory for the current task scope before answering. Private self memory is never available on a relationship-scoped business view.',
  "Recall supports scope self/person/relationship and the returned next_cursor. Follow pagination when completeness matters; no result means no currently available evidence, not proof something never happened.",
  'Use {"operation":"propose", ...} for a durable change or a named new counterparty in a direct-chat image. Name or nickname alone is enough for the editable Add contact option: contact_decision="new", person_display_label, new_contact_source_locator; items=[] is valid when no durable Memory item is needed. No email or company is required.',
  "Each item must copy one exact contiguous excerpt from the admitted source, name its scope, keep the statement kind (fact, source statement, or user opinion), and preserve speaker/reporter, time, and limiting conditions.",
  "Never infer a person's personality, motive, quality, or acceptance from one message, and never turn 'I want to work with X' into a mutual agreement. A future plan is not a completed fact.",
  "This tool never writes accepted memory or a contact; it stages a review card that the human confirms, edits, or skips.",
].join(" ");
