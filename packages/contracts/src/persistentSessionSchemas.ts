import { Type, type Static } from "@sinclair/typebox";
import { SessionResponseSchema } from "./schemas.js";

const ID = Type.String({ format: "uuid" });
const Secret = Type.String({ minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]{43}$" });

/** First-party login continuation; intentionally separate from Mac and CLI grants. */
export const PersistentSessionEnrollRequestSchema = Type.Object({
  renewal_secret: Secret,
  client_kind: Type.Union([Type.Literal("web"), Type.Literal("ios")]),
}, { additionalProperties: false });
export const PersistentSessionProofSchema = Type.Object({
  renewal_secret: Secret, account_id: ID, user_id: ID, session_id: ID,
}, { additionalProperties: false });
/** Pending enrollment can always be fenced, even across a lost commit reply.
 * The original bearer is destructive-only proof and never extends access. */
export const PersistentSessionRevokeRequestSchema = Type.Object({
  ...PersistentSessionProofSchema.properties,
  original_access_token: Type.Optional(Secret),
}, { additionalProperties: false });
export const PersistentSessionResponseSchema = Type.Object({
  ...SessionResponseSchema.properties, session_id: ID,
}, { additionalProperties: false });
export const PersistentSessionRevokeResponseSchema = Type.Object({
  revoked: Type.Literal(true),
}, { additionalProperties: false });

export type PersistentSessionEnrollRequest = Static<typeof PersistentSessionEnrollRequestSchema>;
export type PersistentSessionProof = Static<typeof PersistentSessionProofSchema>;
export type PersistentSessionRevokeRequest = Static<typeof PersistentSessionRevokeRequestSchema>;
export type PersistentSessionResponse = Static<typeof PersistentSessionResponseSchema>;
