import { z } from "zod";

const Id = z.string().uuid();
const EvidenceRefs = z.array(Id).min(1).max(50);

const ProposalItemCommon = {
  item_key: z.string().trim().min(1).max(80),
  basis_kind: z.literal("evidence_supported"),
  epistemic_status: z.enum(["fact", "inference", "unknown", "disputed"]),
  evidence_refs: EvidenceRefs,
  reason: z.string().trim().min(1).max(1_000),
  effect_summary: z.string().trim().min(1).max(500),
};

const ProposalItemSchema = z.discriminatedUnion("change_kind", [
  z.strictObject({
    ...ProposalItemCommon,
    change_kind: z.literal("set_milestone"),
    proposed_value: z.string().trim().min(1).max(120),
  }),
  z.strictObject({
    ...ProposalItemCommon,
    change_kind: z.literal("set_pursuit_status"),
    proposed_value: z.enum([
      "draft",
      "active",
      "paused",
      "succeeded",
      "failed",
      "cancelled",
    ]),
  }),
  z.strictObject({
    ...ProposalItemCommon,
    change_kind: z.literal("set_role_status"),
    role_id: Id,
    proposed_value: z.enum(["active", "quiet", "removed"]),
  }),
  z.strictObject({
    ...ProposalItemCommon,
    change_kind: z.literal("add_gap"),
    proposed_value: z.strictObject({
      title: z.string().trim().min(1).max(240),
      basis_summary: z.string().trim().min(1).max(1_000),
      close_condition: z.string().trim().min(1).max(1_000),
    }),
  }),
  z.strictObject({
    ...ProposalItemCommon,
    change_kind: z.literal("add_action"),
    proposed_value: z.strictObject({
      title: z.string().trim().min(1).max(240),
      owner_user_id: Id,
      due_at: z.iso.datetime().nullable(),
    }),
  }),
]);

export const ReadPursuitInputSchema = z.strictObject({});
export const ReadEvidenceInputSchema = z.strictObject({
  evidence_refs: EvidenceRefs,
});
export const SearchWebInputSchema = z.strictObject({
  query: z.string().trim().min(2).max(240),
  maximum_results: z.number().int().min(1).max(10).default(5),
  recency_days: z.number().int().min(1).max(3_650).nullable().default(null),
});
export const FetchWebInputSchema = z.strictObject({
  result_id: z.string().regex(/^[0-9a-f]{64}$/),
});
export const SearchPublicProfilesInputSchema = z.strictObject({
  visible_identity_clue: z.string().trim().min(2).max(100),
  source_artifact_id: z.string().trim().min(1).max(200),
  maximum_results: z.number().int().min(1).max(10).default(5),
});
export const CreateResearchArtifactInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(8_000),
  limitations: z.string().trim().max(2_000).default(""),
  claims: z
    .array(
      z.strictObject({
        statement: z.string().trim().min(1).max(1_000),
        source_refs: z
          .array(z.string().regex(/^[0-9a-f]{64}$/))
          .min(1)
          .max(5),
      }),
    )
    .min(1)
    .max(20),
});
export const CreatePersonResearchArtifactInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(8_000),
  limitations: z.string().trim().min(1).max(2_000),
  identity_status: z.enum(["possible_match", "ambiguous"]),
  observed_clues: z
    .array(
      z.strictObject({
        kind: z.enum(["display_name", "handle", "profile_url", "platform"]),
        value: z.string().trim().min(1).max(300),
        source_artifact_id: z.string().trim().min(1).max(200),
        observation_status: z.literal("unreviewed_screenshot_observation"),
      }),
    )
    .min(1)
    .max(10),
  candidates: z
    .array(
      z.strictObject({
        result_id: z.string().regex(/^[0-9a-f]{64}$/u),
        match_basis: z.string().trim().min(1).max(1_000),
      }),
    )
    .min(1)
    .max(10),
  claims: z
    .array(
      z.strictObject({
        statement: z.string().trim().min(1).max(1_000),
        epistemic_status: z.enum(["provider_observation", "agent_inference"]),
        source_refs: z
          .array(z.string().regex(/^[0-9a-f]{64}$/u))
          .min(1)
          .max(5),
      }),
    )
    .min(1)
    .max(20),
});
export const StageProposalInputSchema = z.strictObject({
  summary: z.string().trim().min(1).max(1_000),
  items: z.array(ProposalItemSchema).min(1).max(50),
});

const ContactIdentityClueSchema = z.strictObject({
  type: z.enum([
    "email",
    "phone",
    "linkedin_url",
    "public_profile_url",
  ]),
  value: z.string().trim().min(1).max(500).describe(
    "Copy the identity clue verbatim from one contiguous substring of the current user message. Never infer, normalize, translate, or combine values. If absent, set the parent identity_clue to null instead of inventing a value.",
  ),
});

const ContactSourceExcerptSchema = z.string().trim().min(1).max(1_000).describe(
  "An exact verbatim substring of the current user message, including its original words and punctuation. The excerpts must contain each proposed field.",
);
const ContactDisplayNameSchema = z.string().trim().min(1).max(200).describe(
  "For a new contact, copy the name verbatim from the current user message; never infer a name from an email or invent a missing name. For an update, keep the exact resolved Person label.",
);
const ContactRelationshipContextSchema = z.string().trim().max(200).describe(
  "For a new relationship, copy a VERBATIM CONTIGUOUS SUBSTRING of the current user message/source excerpt, character for character. Never paraphrase, translate, join separate excerpts, or remove words or particles. Prefer the shortest exact relationship label. Use an empty string when the relationship is absent. For an existing relationship update, keep its exact resolved label.",
);

export const ContactSourceClueSchema = z.strictObject({
  clue: z.string().trim().min(2).max(120).describe(
    "One bounded clue observed in the admitted image, such as a single handle. Never a wildcard, concatenated list, or enumerating query.",
  ),
  source_locator: z.strictObject({
    kind: z.literal("image_region"),
    artifact_id: z.string().min(1).max(200),
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
});

export const ContactWorkspaceInputSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("search"),
    query: z.string().trim().min(2).max(200).describe(
      "One exact contiguous clue from current text or an admitted image. For image-only clues also provide source_clue with the matching clue and actual input_images artifact_id. Never combine separate name, email, or relationship excerpts.",
    ),
    maximum_results: z.number().int().min(1).max(6).default(4),
    source_clue: ContactSourceClueSchema.nullable().optional(),
  }),
  z.strictObject({
    operation: z.literal("read"),
    person_id: Id,
    relationship_context_id: Id,
  }),
  z.strictObject({
    operation: z.literal("propose_create"),
    display_name: ContactDisplayNameSchema,
    relationship_context: ContactRelationshipContextSchema,
    identity_clue: ContactIdentityClueSchema.nullable().default(null),
    source_excerpts: z.array(ContactSourceExcerptSchema).min(1).max(5),
    reason: z.string().trim().min(1).max(500),
  }),
  z.strictObject({
    operation: z.literal("propose_update"),
    person_id: Id,
    relationship_context_id: Id.nullable().default(null),
    base_revision: z.number().int().min(1),
    display_name: ContactDisplayNameSchema,
    relationship_context: ContactRelationshipContextSchema,
    identity_clue: ContactIdentityClueSchema.nullable().default(null),
    source_excerpts: z.array(ContactSourceExcerptSchema).min(1).max(5),
    reason: z.string().trim().min(1).max(500),
  }),
]);

// Claude's in-process MCP helper consumes a Zod object shape. Keep this
// model-facing superset object beside the discriminated boundary parser; the
// executor always validates again with ContactWorkspaceInputSchema.
export const ContactWorkspaceToolInputSchema = z.strictObject({
  operation: z.enum(["search", "read", "propose_create", "propose_update"]),
  query: z.string().trim().min(2).max(200).optional(),
  maximum_results: z.number().int().min(1).max(6).optional(),
  source_clue: ContactSourceClueSchema.nullable().optional(),
  person_id: Id.optional(),
  relationship_context_id: Id.nullable().optional(),
  base_revision: z.number().int().min(1).optional(),
  display_name: ContactDisplayNameSchema.optional(),
  relationship_context: ContactRelationshipContextSchema.optional(),
  identity_clue: ContactIdentityClueSchema.nullable().optional(),
  source_excerpts: z.array(ContactSourceExcerptSchema).min(1).max(5).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

// Optional title metadata must never discard an otherwise valid answer.
const OptionalSessionTitleSchema = z.string().trim().min(1)
  .refine(value => Array.from(value).length <= 256, "Session title exceeds 256 code points")
  .optional().catch(undefined);

export const WorkspaceConversationFinalOutputSchema = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({
      outcome: z.literal("reply"),
      title: z.string().trim().min(1).max(160),
      // Successful work may intentionally have no conversational prose.
      body: z.string().trim().max(4_000),
      session_title: OptionalSessionTitleSchema,
    }),
    z.strictObject({
      outcome: z.literal("clarification"),
      title: z.string().trim().min(1).max(160),
      body: z.string().trim().min(1).max(1_000),
      session_title: OptionalSessionTitleSchema,
    }),
    z.strictObject({
      outcome: z.literal("use_contact"),
      person_id: Id,
      relationship_context_id: Id,
    }),
    z.strictObject({
      outcome: z.literal("contact_change_proposal"),
      candidate_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    }),
  ],
);
export const PursuitNoActionReasonCodeSchema = z.enum([
  "NO_MATERIAL_CHANGE",
  "INSUFFICIENT_EVIDENCE",
  "UNTRUSTED_INSTRUCTION",
  "AMBIGUOUS_TIME",
  "PROHIBITED_PERSON_ASSESSMENT",
  "UNSUPPORTED_INPUT_CAPABILITY",
]);
export const PublicResearchNoActionReasonCodeSchema = z.enum([
  "NO_MATERIAL_CHANGE",
  "INSUFFICIENT_EVIDENCE",
  "UNTRUSTED_INSTRUCTION",
  "PUBLIC_RESEARCH_UNAVAILABLE",
]);
export const PersonResearchNoActionReasonCodeSchema = z.enum([
  "NO_VISIBLE_IDENTITY_CLUE",
  "AMBIGUOUS_IDENTITY_CLUE",
  "NO_PUBLIC_PROFILE_MATCH",
  "UNTRUSTED_INSTRUCTION",
  "PROHIBITED_PERSON_ASSESSMENT",
  "PERSON_RESEARCH_UNAVAILABLE",
]);
const NoActionFields = {
  outcome: z.literal("no_action"),
  reason: z.string().trim().min(1).max(1_000),
  missing_evidence_refs: z.array(Id).max(50).default([]),
};
export const PursuitNoActionOutputSchema = z.strictObject({
  ...NoActionFields,
  reason_code: PursuitNoActionReasonCodeSchema,
});
export const PublicResearchNoActionOutputSchema = z.strictObject({
  ...NoActionFields,
  reason_code: PublicResearchNoActionReasonCodeSchema,
});
export const PersonResearchNoActionOutputSchema = z.strictObject({
  outcome: z.literal("no_action"),
  reason_code: PersonResearchNoActionReasonCodeSchema,
  reason: z.string().trim().min(1).max(1_000),
  missing_evidence_refs: z.array(z.never()).max(0).default([]),
});
export const NoActionOutputSchema = z.strictObject({
  ...NoActionFields,
  reason_code: z.union([
    PursuitNoActionReasonCodeSchema,
    PublicResearchNoActionReasonCodeSchema,
  ]),
});
const ProposalOutputSchema = z.strictObject({
  outcome: z.literal("proposal"),
  candidate_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
const ArtifactOutputSchema = z.strictObject({
  outcome: z.literal("artifact"),
  candidate_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
const PersonResearchArtifactOutputSchema = z.strictObject({
  outcome: z.literal("person_research_artifact"),
  candidate_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
});

export const PursuitAgentFinalOutputSchema = z.discriminatedUnion("outcome", [
  ProposalOutputSchema,
  PursuitNoActionOutputSchema,
]);
export const PublicResearchAgentFinalOutputSchema = z.discriminatedUnion(
  "outcome",
  [ArtifactOutputSchema, PublicResearchNoActionOutputSchema],
);
export const PersonResearchAgentFinalOutputSchema = z.discriminatedUnion(
  "outcome",
  [PersonResearchArtifactOutputSchema, PersonResearchNoActionOutputSchema],
);

export const AgentFinalOutputSchema = z.discriminatedUnion("outcome", [
  ProposalOutputSchema,
  NoActionOutputSchema,
  ArtifactOutputSchema,
]);

export type StageProposalInput = z.infer<typeof StageProposalInputSchema>;
export type ContactWorkspaceInput = z.infer<
  typeof ContactWorkspaceInputSchema
>;
export type WorkspaceConversationFinalOutput = z.infer<
  typeof WorkspaceConversationFinalOutputSchema
>;
export type NoActionOutput = z.infer<typeof NoActionOutputSchema>;
export type PursuitNoActionOutput = z.infer<
  typeof PursuitNoActionOutputSchema
>;
export type PublicResearchNoActionOutput = z.infer<
  typeof PublicResearchNoActionOutputSchema
>;
export type NoActionReasonCode = NoActionOutput["reason_code"];
export type CreateResearchArtifactInput = z.infer<
  typeof CreateResearchArtifactInputSchema
>;
export type CreatePersonResearchArtifactInput = z.infer<
  typeof CreatePersonResearchArtifactInputSchema
>;
export type PersonResearchNoActionOutput = z.infer<
  typeof PersonResearchNoActionOutputSchema
>;
