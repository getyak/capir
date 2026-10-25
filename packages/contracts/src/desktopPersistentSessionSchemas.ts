import { Type, type Static } from "@sinclair/typebox";
import { CONTRACT_VERSION } from "./constants.js";
import { SessionResponseSchema } from "./schemas.js";

const ID = Type.String({ format: "uuid" });
const Secret = Type.String({ minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]{43}$" });
const Origin = Type.String({ minLength: 1, maxLength: 200 });
export const DesktopPersistentSessionEnrollRequestSchema = Type.Object({
  device_secret: Secret, web_origin: Origin,
}, { additionalProperties: false });
export const DesktopPersistentSessionProofSchema = Type.Object({
  device_secret: Secret, web_origin: Origin, account_id: ID, user_id: ID,
}, { additionalProperties: false });
/** Destructive-only original proof never enrolls or renews a session. */
export const DesktopPersistentSessionRevokeRequestSchema = Type.Object({
  ...DesktopPersistentSessionProofSchema.properties,
  session_id: Type.Optional(ID), original_access_token: Type.Optional(Secret),
}, { additionalProperties: false });
/** Server-to-server only. The BFF installs the access token via Auth.js. */
export const DesktopPersistentSessionResponseSchema = Type.Object({
  ...SessionResponseSchema.properties, session_id: ID,
}, { additionalProperties: false });
export const DesktopPersistentSessionStatusSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION), status: Type.Literal("authenticated"),
  account_id: ID, user_id: ID, session_id: ID,
  session_expires_at: Type.String({ format: "date-time" }),
}, { additionalProperties: false });
export const DesktopPersistentSessionRevokeResponseSchema = Type.Object({
  revoked: Type.Literal(true),
}, { additionalProperties: false });
export type DesktopPersistentSessionEnrollRequest = Static<typeof DesktopPersistentSessionEnrollRequestSchema>;
export type DesktopPersistentSessionProof = Static<typeof DesktopPersistentSessionProofSchema>;
export type DesktopPersistentSessionRevokeRequest = Static<typeof DesktopPersistentSessionRevokeRequestSchema>;
export type DesktopPersistentSessionResponse = Static<typeof DesktopPersistentSessionResponseSchema>;
export type DesktopPersistentSessionStatus = Static<typeof DesktopPersistentSessionStatusSchema>;
