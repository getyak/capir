import { Type, type Static } from "@sinclair/typebox";
import { CONTRACT_VERSION } from "./constants.js";
import { LanguagePreferenceSchema } from "./i18nSchemas.js";

const ID = Type.String({ format: "uuid" });
const Time = Type.String({ format: "date-time" });
const Name = Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" });
const Revision = Type.Integer({ minimum: 1 });
const Role = Type.Union([Type.Literal("admin"), Type.Literal("member")]);
const Status = Type.Union([Type.Literal("active"), Type.Literal("revoked")]);
export const AccountSettingsSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION),
  user: Type.Object({ id: ID, email: Type.String(), display_name: Type.String(),
    username: Type.Union([Type.String(), Type.Null()]), kind: Type.String(), revision: Revision,
    login_methods: Type.Array(Type.Union([Type.Literal("google"), Type.Literal("apple"), Type.Literal("password")])),
    email_verified_at: Type.Union([Time, Type.Null()]) }),
  sign_in_methods: Type.Array(Type.Object({
    provider: Type.Union([Type.Literal("apple"), Type.Literal("google"), Type.Literal("password")]),
    state: Type.Union([Type.Literal("connected"), Type.Literal("unconnected"), Type.Literal("legacy_unverified")]),
    hint: Type.Union([Type.String(), Type.Null()]),
    can_unlink: Type.Boolean(),
  }, { additionalProperties: false })),
  email_ownership_state: Type.Union([
    Type.Literal("verified"), Type.Literal("legacy_unverified"), Type.Literal("conflict"),
  ]),
  workspace: Type.Object({ id: ID, name: Type.String(), slug: Type.String(), revision: Revision,
    owner_user_id: Type.Union([ID, Type.Null()]), role: Role, is_owner: Type.Boolean(),
    can_manage: Type.Boolean(), is_test: Type.Boolean() }),
  sessions: Type.Array(Type.Object({ id: ID, client_label: Type.String(), created_at: Time,
    expires_at: Time, is_current: Type.Boolean(), persistent: Type.Optional(Type.Boolean()) })),
  members: Type.Array(Type.Object({ id: ID, display_name: Type.String(), email: Type.String(),
    role: Role, status: Status, is_owner: Type.Boolean() })),
  activity: Type.Array(Type.Object({ id: ID, kind: Type.String(), actor_name: Type.String(), created_at: Time })),
  lab_enabled: Type.Boolean(),
  // User-owned presentation preferences. Optional in schema so older
  // fixtures and responses remain readable; absent display_language means
  // "system" (follow the platform language).
  preferences: Type.Optional(Type.Object({
    display_language: Type.Optional(LanguagePreferenceSchema),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

const OnboardingStatus = Type.Union([
  Type.Literal("pending"),
  Type.Literal("completed"),
  Type.Literal("skipped"),
]);
const OnboardingFocus = Type.String({ maxLength: 280 });
const OnboardingProfileUrl = Type.String({
  maxLength: 2000,
  pattern: "^(|https://[^\\s]+)$",
});
export const AccountOnboardingSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    account_id: ID,
    user_id: ID,
    display_name: Type.String({ minLength: 1, maxLength: 100 }),
    focus: OnboardingFocus,
    profile_url: OnboardingProfileUrl,
    status: OnboardingStatus,
    revision: Revision,
  },
  { $id: "AccountOnboarding", additionalProperties: false },
);
export const AccountOnboardingMutationSchema = Type.Object(
  {
    id: ID,
    expected_revision: Revision,
    display_name: Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
    focus: OnboardingFocus,
    profile_url: OnboardingProfileUrl,
    status: Type.Union([Type.Literal("completed"), Type.Literal("skipped")]),
  },
  { $id: "AccountOnboardingMutation", additionalProperties: false },
);
export const AccountOnboardingPreviewRequestSchema = Type.Object(
  { url: Type.String({ minLength: 1, maxLength: 2000 }) },
  { $id: "AccountOnboardingPreviewRequest", additionalProperties: false },
);
export const AccountOnboardingPreviewSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    profile_url: Type.String({ minLength: 1, maxLength: 2000 }),
    excerpt: Type.String({ maxLength: 600 }),
    retrieved_at: Time,
  },
  { $id: "AccountOnboardingPreview", additionalProperties: false },
);

export type AccountOnboarding = Static<typeof AccountOnboardingSchema>;
export type AccountOnboardingMutation = Static<
  typeof AccountOnboardingMutationSchema
>;
export type AccountOnboardingPreviewRequest = Static<
  typeof AccountOnboardingPreviewRequestSchema
>;
export type AccountOnboardingPreview = Static<
  typeof AccountOnboardingPreviewSchema
>;

const Common = { id: ID, expected_revision: Revision };
export const AccountMutationSchema = Type.Union([
  Type.Object({ ...Common, kind: Type.Literal("profile"), name: Name }, { additionalProperties: false }),
  Type.Object({ ...Common, kind: Type.Literal("workspace"), name: Name }, { additionalProperties: false }),
  Type.Object({ ...Common, kind: Type.Literal("member"), user_id: ID, role: Role, status: Status }, { additionalProperties: false }),
  Type.Object({ ...Common, kind: Type.Literal("transfer"), user_id: ID }, { additionalProperties: false }),
  Type.Object({ id: ID, kind: Type.Literal("revoke_session"), session_id: ID }, { additionalProperties: false }),
  // Presentation-only, user-scoped: never access, roles, or person data.
  Type.Object({ ...Common, kind: Type.Literal("preferences"), display_language: LanguagePreferenceSchema }, { additionalProperties: false }),
]);
export type AccountSettings = Static<typeof AccountSettingsSchema>;
export type AccountMutation = Static<typeof AccountMutationSchema>;

// --- Sign-in methods: step-up bound credential changes (ADR 0018) -----------

export const SignInMethodProviderSchema = Type.Union([
  Type.Literal("apple"), Type.Literal("google"), Type.Literal("password"),
]);
export const CredentialChangeIntentSchema = Type.Union([
  Type.Literal("link_provider"), Type.Literal("unlink_provider"),
  Type.Literal("set_password"), Type.Literal("change_password"),
]);
export const StepUpProofSchema = Type.Union([
  Type.Object({ kind: Type.Literal("password"),
    password: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("provider"),
    provider: Type.Union([Type.Literal("apple"), Type.Literal("google")]),
    challenge_id: ID,
    identity_token: Type.String({ minLength: 100, maxLength: 20_000 }) }, { additionalProperties: false }),
]);
export const StartCredentialChangeRequestSchema = Type.Object({
  id: ID,
  intent: CredentialChangeIntentSchema,
  provider: Type.Optional(SignInMethodProviderSchema),
  origin: Type.String({ minLength: 1, maxLength: 500 }),
  client_label: Type.String({ minLength: 1, maxLength: 80 }),
  step_up: StepUpProofSchema,
  // The revisions the operation was authorized against. The backend compares
  // them transactionally before minting an attempt, so an old proof can never
  // bind to settings that changed after authorization.
  expected_account_revision: Revision,
  expected_user_revision: Revision,
}, { additionalProperties: false });
export const ProviderChallengeSchema = Type.Object({
  challenge_id: ID,
  nonce: Type.String({ minLength: 32, maxLength: 128 }),
  expires_at: Time,
}, { additionalProperties: false });
export const CredentialChangeAttemptSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION),
  attempt_id: ID,
  // Returned exactly once at start. Web keeps it server-side in an HttpOnly
  // attempt cookie; native holds it in memory for the current attempt only.
  attempt_secret: Type.String({ minLength: 32, maxLength: 200 }),
  intent: CredentialChangeIntentSchema,
  provider: Type.Union([SignInMethodProviderSchema, Type.Null()]),
  expires_at: Time,
  provider_challenge: Type.Union([ProviderChallengeSchema, Type.Null()]),
}, { additionalProperties: false });
export const CompleteCredentialChangeRequestSchema = Type.Object({
  attempt_id: ID,
  attempt_secret: Type.String({ minLength: 32, maxLength: 200 }),
  origin: Type.String({ minLength: 1, maxLength: 500 }),
  identity_token: Type.Optional(Type.String({ minLength: 100, maxLength: 20_000 })),
  password: Type.Optional(Type.String({ minLength: 8, maxLength: 128 })),
}, { additionalProperties: false });
export const CredentialChangeResultSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION),
  status: Type.Union([
    Type.Literal("linked"), Type.Literal("already_linked"),
    Type.Literal("password_set"), Type.Literal("unlinked"),
  ]),
  settings: AccountSettingsSchema,
}, { additionalProperties: false });

// --- Verified password signup -----------------------------------------------

export const PasswordRegistrationStartResponseSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION),
  status: Type.Literal("verification_sent"),
}, { additionalProperties: false });
export const PasswordVerificationConfirmRequestSchema = Type.Object({
  verification_secret: Type.String({ minLength: 32, maxLength: 200 }),
  client_label: Type.String({ minLength: 1, maxLength: 80 }),
}, { additionalProperties: false });

// --- Reviewed historical duplicate resolution -------------------------------

export const ReconciliationProofSchema = Type.Union([
  Type.Object({ kind: Type.Literal("password"),
    identifier: Type.String({ minLength: 1, maxLength: 320 }),
    password: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("provider"),
    provider: Type.Union([Type.Literal("apple"), Type.Literal("google")]),
    challenge_id: ID,
    identity_token: Type.String({ minLength: 100, maxLength: 20_000 }) }, { additionalProperties: false }),
]);
export const ReconciliationPrepareRequestSchema = Type.Object({
  id: ID,
  proof: ReconciliationProofSchema,
  // Canonical-side step-up: dual proof is required before any cross-account
  // inventory is shown or proposed.
  step_up: StepUpProofSchema,
  // The revisions the recovery screen was rendered from. The backend compares
  // them under its own transaction locks before freezing anything.
  expected_account_revision: Revision,
  expected_user_revision: Revision,
}, { additionalProperties: false });
export const ReconciliationRecordSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION),
  id: ID,
  kind: Type.Union([Type.Literal("empty_duplicate_transfer"), Type.Literal("review_required")]),
  state: Type.Union([
    Type.Literal("prepared"), Type.Literal("confirmed"),
    Type.Literal("committed"), Type.Literal("cancelled"),
  ]),
  frozen_revision: Revision,
  inventory: Type.Unknown(),
  result: Type.Optional(Type.Unknown()),
  expires_at: Time,
  created_at: Time,
}, { additionalProperties: false });
export const ReconciliationActionRequestSchema = Type.Object({
  id: ID,
}, { additionalProperties: false });

export type SignInMethodProvider = Static<typeof SignInMethodProviderSchema>;
export type CredentialChangeIntent = Static<typeof CredentialChangeIntentSchema>;
export type StepUpProof = Static<typeof StepUpProofSchema>;
export type StartCredentialChangeRequest = Static<typeof StartCredentialChangeRequestSchema>;
export type ProviderChallenge = Static<typeof ProviderChallengeSchema>;
export type CredentialChangeAttempt = Static<typeof CredentialChangeAttemptSchema>;
export type CompleteCredentialChangeRequest = Static<typeof CompleteCredentialChangeRequestSchema>;
export type CredentialChangeResult = Static<typeof CredentialChangeResultSchema>;
export type PasswordRegistrationStartResponse = Static<typeof PasswordRegistrationStartResponseSchema>;
export type PasswordVerificationConfirmRequest = Static<typeof PasswordVerificationConfirmRequestSchema>;
export type ReconciliationProof = Static<typeof ReconciliationProofSchema>;
export type ReconciliationPrepareRequest = Static<typeof ReconciliationPrepareRequestSchema>;
export type ReconciliationRecord = Static<typeof ReconciliationRecordSchema>;
export type ReconciliationActionRequest = Static<typeof ReconciliationActionRequestSchema>;
