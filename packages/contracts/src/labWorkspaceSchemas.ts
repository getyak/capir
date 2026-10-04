import { Type, type Static } from "@sinclair/typebox";
import { CONTRACT_VERSION } from "./constants.js";
import { CurrentSessionResponseSchema } from "./schemas.js";

const ID = Type.String({ format: "uuid" });
const Time = Type.String({ format: "date-time" });
const NullableTime = Type.Union([Time, Type.Null()]);
const NullableID = Type.Union([ID, Type.Null()]);
export const LabWorkspaceCreateRequestSchema = Type.Object({
  id: ID, duration_hours: Type.Union([Type.Literal(1), Type.Literal(4), Type.Literal(24)]),
}, { additionalProperties: false });
export const LabWorkspaceEntryRequestSchema = Type.Object({
  id: ID,
  // The client saves 32 cryptographically random bytes in protected recovery
  // before sending this intent. The server persists only their SHA-256 hash.
  access_token: Type.String({ pattern: "^[A-Za-z0-9_-]{43}$", minLength: 43, maxLength: 43 }),
}, { additionalProperties: false });
export const LabWorkspaceStopRequestSchema = Type.Object({ id: ID }, { additionalProperties: false });
export const LabWorkspaceSchema = Type.Object({
  id: ID,
  // Ownership lineage is exclusive: either the human owner pair or exactly one
  // control-scope provisioning principal. The two forms never coexist.
  owner_account_id: NullableID, owner_user_id: NullableID, owner_principal_id: NullableID,
  account_id: ID, user_id: ID,
  name: Type.String(), state: Type.Union([Type.Literal("active"), Type.Literal("expired"), Type.Literal("deleting"), Type.Literal("deleted")]),
  created_at: Time, empty_verified_at: NullableTime, expires_at: Time,
  duration_hours: Type.Integer(), stop_id: Type.Union([ID,Type.Null()]),
  stop_reason: Type.Union([Type.Literal("manual"),Type.Literal("expired"),Type.Null()]),
  stopped_at: NullableTime, deleted_at: NullableTime,
  cleanup_error: Type.Union([Type.Literal("schema_changed"),Type.Literal("media_scope_changed"),
    Type.Literal("media_unsettled"),Type.Literal("media_cleanup_failed"),Type.Literal("data_cleanup_failed"),Type.Null()]),
  data_rows: Type.Union([Type.Integer({minimum:0}),Type.Null()]), active_sessions: Type.Integer({minimum:0}),
  pending_media_writes: Type.Integer({minimum:0}),
  scope: Type.Literal("isolated_test_account"),
}, { additionalProperties: false });
export const LabWorkspaceResponseSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION), workspace: LabWorkspaceSchema,
}, { additionalProperties:false });
export const LabWorkspaceListResponseSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION), enabled: Type.Boolean(),
  workspaces: Type.Array(LabWorkspaceSchema),
}, { additionalProperties:false });
export const LabWorkspaceEntrySchema = Type.Object({
  id: ID, workspace_id: ID, session_id: ID, expires_at: Time, revoked_at: NullableTime,
  state: Type.Union([Type.Literal("active"),Type.Literal("expired"),Type.Literal("revoked")]),
  session: Type.Union([CurrentSessionResponseSchema,Type.Null()]),
}, { additionalProperties:false });
export const LabWorkspaceEntryResponseSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION), entry: LabWorkspaceEntrySchema,
}, { additionalProperties:false });
export type LabWorkspaceCreateRequest = Static<typeof LabWorkspaceCreateRequestSchema>;
export type LabWorkspaceEntryRequest = Static<typeof LabWorkspaceEntryRequestSchema>;
export type LabWorkspace = Static<typeof LabWorkspaceSchema>;
export type LabWorkspaceEntry = Static<typeof LabWorkspaceEntrySchema>;
