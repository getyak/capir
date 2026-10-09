import { Type, type Static } from "@sinclair/typebox";

/**
 * Browser-owned CLI authorization, `capir-auth.v2`.
 *
 * This module is the explicit versioned successor to the legacy `capir.v1`
 * human-grant surface. The legacy schema keeps `refresh_supported=false` and
 * must never be mutated into pretend rotation support: only a grant negotiated
 * under `capir-auth.v2` carries a rotating refresh credential.
 *
 * The v2 protocol binds every grant to the real browser identity, the exact
 * configured backend/Web origin pair, the literal loopback redirect, the PKCE
 * S256 challenge, and the browser state. All token material returned here is
 * opaque high-entropy data; the server stores only SHA-256 digests and the
 * client stores the full record only in the OS keyring (or an ephemeral
 * `CAPIR_TOKEN`).
 */

const ID = Type.String({ format: "uuid" });
const Time = Type.String({ format: "date-time" });
const Origin = Type.String({ minLength: 1, maxLength: 240 });
/** 32 random bytes, base64url without padding (state, codes, tokens). */
const Secret = Type.String({ pattern: "^[A-Za-z0-9_-]{43}$", minLength: 43, maxLength: 43 });
const Verifier = Type.String({ pattern: "^[A-Za-z0-9._~-]{43,128}$" });

export const CAPIR_AUTH_SCHEMA_VERSION = "capir-auth.v2" as const;

/**
 * Scopes are fixed by the shared contract. The minimal user grant only ever
 * reads and revokes the caller's own grants; test scopes are displayed and
 * requested only for users the server has admitted with a durable test
 * entitlement.
 */
export const CAPIR_AUTH_SCOPES = [
  "grants.read",
  "grants.revoke",
  "test.create",
  "test.status",
  "test.stop",
  "test.handoff",
] as const;
export type CapirAuthScope = (typeof CAPIR_AUTH_SCOPES)[number];

export const CAPIR_AUTH_CAPABILITY_NAMES = [
  "auth.authorize",
  "auth.exchange",
  "auth.refresh",
  "auth.status",
  "auth.logout",
  "auth.grants",
] as const;
export type CapirAuthCapabilityName = (typeof CAPIR_AUTH_CAPABILITY_NAMES)[number];

const ScopeArray = Type.Array(
  Type.Union(CAPIR_AUTH_SCOPES.map((scope) => Type.Literal(scope))),
  { maxItems: CAPIR_AUTH_SCOPES.length },
);

/**
 * Anonymous discovery. Protocol metadata only: it advertises the negotiated
 * contract version, which auth capabilities are actually implemented, and the
 * server-owned credential lifetimes. It never adds trust; the operator must
 * explicitly configure the backend/Web origin pair.
 */
export const CapirAuthCapabilitiesResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_AUTH_SCHEMA_VERSION),
    enabled: Type.Boolean(),
    capabilities: Type.Record(
      Type.Union(CAPIR_AUTH_CAPABILITY_NAMES.map((name) => Type.Literal(name))),
      Type.Union([Type.Literal("supported"), Type.Literal("unsupported")]),
    ),
    // Optional device-code authentication is explicitly unsupported in v2.
    device_auth: Type.Literal("unsupported"),
    scopes: ScopeArray,
    backend_origin: Type.String({maxLength:240}),
    web_origin: Type.String({maxLength:240}),
    lifetimes: Type.Object(
      {
        code_seconds: Type.Integer({ minimum: 30, maximum: 300 }),
        access_seconds: Type.Integer({ minimum: 60, maximum: 3600 }),
        refresh_idle_seconds: Type.Integer({ minimum: 600 }),
        refresh_absolute_seconds: Type.Integer({ minimum: 600 }),
      },
      { additionalProperties: false },
    ),
    unsupported: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

/** Browser consent request dispatched by the Web layer after an intentional,
 * session-bound CSRF POST. The `consent` literal is proof of an explicit
 * human click; a GET, prefetch or mail scanner can never reach this route. */
export const CapirAuthAuthorizeRequestSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_AUTH_SCHEMA_VERSION),
    redirect_uri: Type.String({ minLength: 1, maxLength: 240 }),
    state: Secret,
    code_challenge: Secret,
    code_challenge_method: Type.Literal("S256"),
    // Exactly the scopes rendered on the consent screen for this click. The
    // code freezes them and the minted grant can never exceed them.
    scopes: ScopeArray,
    web_origin: Origin,
    backend_origin: Origin,
    consent: Type.Literal(true),
    client_label: Type.String({ minLength: 1, maxLength: 80 }),
  },
  { additionalProperties: false },
);

export const CapirAuthAuthorizeResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_AUTH_SCHEMA_VERSION),
    code: Secret,
    state: Secret,
    redirect_uri: Type.String(),
    expires_at: Time,
  },
  { additionalProperties: false },
);

export const CapirAuthExchangeRequestSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_AUTH_SCHEMA_VERSION),
    code: Secret,
    code_verifier: Verifier,
    state: Secret,
    redirect_uri: Type.String({ maxLength: 240 }),
    web_origin: Origin,
    backend_origin: Origin,
  },
  { additionalProperties: false },
);

/** The server-owned view of one grant. It never contains token material. */
export const CapirAuthGrantSchema = Type.Object(
  {
    id: ID,
    client_label: Type.String(),
    scopes: ScopeArray,
    web_origin: Origin,
    backend_origin: Origin,
    created_at: Time,
    last_verified_at: Type.Union([Time, Type.Null()]),
    access_expires_at: Time,
    refresh_expires_at: Time,
    absolute_expires_at: Time,
    state: Type.Union([
      Type.Literal("active"),
      Type.Literal("expired"),
      Type.Literal("revoked"),
    ]),
    // v2 grants negotiate real rotation. Legacy single-token records are read
    // truthfully but can never claim refresh support.
    refresh_supported: Type.Literal(true),
  },
  { additionalProperties: false },
);

export const CapirAuthExchangeResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_AUTH_SCHEMA_VERSION),
    access_token: Secret,
    refresh_token: Secret,
    grant: CapirAuthGrantSchema,
  },
  { additionalProperties: false },
);

export const CapirAuthRefreshRequestSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_AUTH_SCHEMA_VERSION),
    refresh_token: Secret,
    web_origin: Origin,
    backend_origin: Origin,
  },
  { additionalProperties: false },
);

export const CapirAuthRefreshResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_AUTH_SCHEMA_VERSION),
    access_token: Secret,
    refresh_token: Secret,
    grant: CapirAuthGrantSchema,
  },
  { additionalProperties: false },
);

export const CapirAuthV2StatusResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_AUTH_SCHEMA_VERSION),
    // "unverified" is returned when the server cannot confirm liveness; the
    // CLI renders a cached identity only as "last verified", never as current.
    state: Type.Union([
      Type.Literal("active"),
      Type.Literal("expired"),
      Type.Literal("revoked"),
      Type.Literal("unverified"),
    ]),
    grant: Type.Union([CapirAuthGrantSchema, Type.Null()]),
    identity: Type.Union([
      Type.Object(
        {
          account_id: ID,
          account_slug: Type.String(),
          user_id: ID,
          user_email: Type.String(),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

/**
 * Logout revokes the whole refresh family and the grant. An expired access
 * token must not force a refresh first: a purpose-specific refresh proof may
 * be presented instead, and a grant that can prove neither is still reported
 * with its exact retryable state.
 */
export const CapirAuthLogoutRequestSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_AUTH_SCHEMA_VERSION),
    refresh_token: Type.Optional(Secret),
  },
  { additionalProperties: false },
);

export const CapirAuthLogoutResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_AUTH_SCHEMA_VERSION),
    revoked_grant_id: ID,
    revoked_at: Time,
  },
  { additionalProperties: false },
);

/** Web "account and security" management: current real account only. */
export const CapirAuthManagedGrantSchema = Type.Object(
  {
    id: ID,
    client_label: Type.String(),
    environment: Type.Object(
      { backend_origin: Origin, web_origin: Origin },
      { additionalProperties: false },
    ),
    scopes: ScopeArray,
    created_at: Time,
    last_used_at: Type.Union([Time, Type.Null()]),
    access_expires_at: Time,
    absolute_expires_at: Time,
    state: Type.Union([
      Type.Literal("active"),
      Type.Literal("expired"),
      Type.Literal("revoked"),
    ]),
  },
  { additionalProperties: false },
);

export const CapirAuthGrantListResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_AUTH_SCHEMA_VERSION),
    grants: Type.Array(CapirAuthManagedGrantSchema),
  },
  { additionalProperties: false },
);

export const CapirAuthGrantRevokeRequestSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_AUTH_SCHEMA_VERSION),
    grant_id: ID,
  },
  { additionalProperties: false },
);

export const CapirAuthGrantRevokeResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_AUTH_SCHEMA_VERSION),
    revoked_grant_id: ID,
    revoked_at: Time,
  },
  { additionalProperties: false },
);

export type CapirAuthCapabilitiesResponse = Static<
  typeof CapirAuthCapabilitiesResponseSchema
>;
export type CapirAuthAuthorizeRequest = Static<
  typeof CapirAuthAuthorizeRequestSchema
>;
export type CapirAuthAuthorizeResponse = Static<
  typeof CapirAuthAuthorizeResponseSchema
>;
export type CapirAuthExchangeRequest = Static<
  typeof CapirAuthExchangeRequestSchema
>;
export type CapirAuthExchangeResponse = Static<
  typeof CapirAuthExchangeResponseSchema
>;
export type CapirAuthRefreshRequest = Static<typeof CapirAuthRefreshRequestSchema>;
export type CapirAuthRefreshResponse = Static<typeof CapirAuthRefreshResponseSchema>;
export type CapirAuthGrant = Static<typeof CapirAuthGrantSchema>;
export type CapirAuthV2StatusResponse = Static<typeof CapirAuthV2StatusResponseSchema>;
export type CapirAuthLogoutRequest = Static<typeof CapirAuthLogoutRequestSchema>;
export type CapirAuthLogoutResponse = Static<typeof CapirAuthLogoutResponseSchema>;
export type CapirAuthManagedGrant = Static<typeof CapirAuthManagedGrantSchema>;
export type CapirAuthGrantListResponse = Static<
  typeof CapirAuthGrantListResponseSchema
>;
export type CapirAuthGrantRevokeRequest = Static<
  typeof CapirAuthGrantRevokeRequestSchema
>;
export type CapirAuthGrantRevokeResponse = Static<
  typeof CapirAuthGrantRevokeResponseSchema
>;
