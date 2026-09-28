import { Type, type Static } from "@sinclair/typebox";

/** Discloses the processor set that may receive an intentional Mac capture. */
export const DesktopCapturePolicySchema = Type.Object({
  policy_version: Type.String({ minLength: 1, maxLength: 64 }),
  available: Type.Boolean(),
  processor_labels: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 5 }),
  source_retention_days: Type.Integer({ minimum: 1, maximum: 365 }),
}, { additionalProperties: false });
export type DesktopCapturePolicy = Static<typeof DesktopCapturePolicySchema>;

/** Scope is for local recovery partitioning, not a grant to submit data. */
export const DesktopCaptureContextSchema = Type.Object({
  protocol_version: Type.Literal(1),
  owner_scope: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  login_binding: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  expires_at: Type.String({ format: "date-time" }),
  processing: DesktopCapturePolicySchema,
}, { additionalProperties: false });
export type DesktopCaptureContext = Static<typeof DesktopCaptureContextSchema>;
