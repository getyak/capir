import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  CAPIR_AUTH_CAPABILITY_NAMES,
  CAPIR_AUTH_SCOPES,
  CAPIR_AUTH_SCHEMA_VERSION,
  type CapirAuthScope,
  type CapirAuthAuthorizeRequest,
  type CapirAuthAuthorizeResponse,
  type CapirAuthCapabilitiesResponse,
  type CapirAuthExchangeRequest,
  type CapirAuthExchangeResponse,
  type CapirAuthGrant,
  type CapirAuthGrantListResponse,
  type CapirAuthGrantRevokeResponse,
  type CapirAuthLogoutResponse,
  type CapirAuthManagedGrant,
  type CapirAuthRefreshRequest,
  type CapirAuthRefreshResponse,
  type CapirAuthV2StatusResponse,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import type { BackendConfig } from "../config.js";
import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import { assertAccountActive } from "./accountIdentity.js";
import type { AuthContext } from "./auth.js";

/**
 * Browser-owned CLI authorization service (`capir-auth.v2`).
 *
 * Every credential is opaque high-entropy material and only its SHA-256 digest
 * is stored. A grant is bound to the real browser identity, the exact
 * configured backend/Web origin pair, the literal loopback redirect, the PKCE
 * S256 challenge and the browser state. Grants rotate refresh credentials per
 * family; a consumed refresh token is durable history and its replay revokes
 * the family inside one committed transaction before any error is raised.
 *
 * Each grant owns exactly one independent canonical backing session whose
 * generic session token never leaves the backend. The grant is live only while
 * that backing session is live, so ordinary Web session revocation of the
 * backing session immediately invalidates the grant. Browser logout and CLI
 * logout stay independent.
 */

export interface CapirGrantAdmission {
  grantId: string;
  accountId: string;
  accountSlug: string;
  userId: string;
  userEmail: string;
  scopes: string[];
  webOrigin: string;
  backendOrigin: string;
  backingSessionId: string;
  /** Entitlement generation frozen at mint; NULL means no test authority. */
  testEntitlementGeneration: number | null;
}

export interface CapirUserTestAuthority {
  grantId: string;
  accountId: string;
  userId: string;
  backingSessionId: string;
  webOrigin: string;
  backendOrigin: string;
}

export type CapirRevokeReason =
  | "logout"
  | "refresh_replay"
  | "user_revoked"
  | "account_retired"
  | "membership_revoked"
  | "backing_session_revoked";

export const CAPIR_AUTH_TEST_SCOPES = [
  "test.create",
  "test.status",
  "test.stop",
  "test.handoff",
] as const;

const REDIRECT_PATTERN = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/capir\/callback$/;

const secret = (): string => randomBytes(32).toString("base64url");

/** RFC 7636 S256: BASE64URL-ENCODED(SHA256(ASCII(verifier))). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function capirAuthRedirectValid(redirectUri: string): boolean {
  const match = REDIRECT_PATTERN.exec(redirectUri);
  if (!match) return false;
  const port = Number(match[1]);
  return port >= 1 && port <= 65535;
}

interface GrantRow {
  id: string;
  account_id: string;
  account_slug: string;
  user_id: string;
  user_email: string;
  client_label: string;
  web_origin: string;
  backend_origin: string;
  scopes: string[];
  state: "active" | "revoked";
  created_at: Date;
  last_verified_at: Date | null;
  absolute_expires_at: Date;
  access_expires_at: Date | null;
  backing_session_id: string;
  test_entitlement_generation: number | null;
  backing_live: boolean;
  user_active: boolean;
  refresh_expires_at: Date | null;
}

const GRANT_COLUMNS = `g.id, g.account_id, a.slug AS account_slug, g.user_id, u.email AS user_email,
  g.client_label, g.web_origin, g.backend_origin, g.scopes, g.state, g.created_at,
  g.last_verified_at, g.absolute_expires_at, g.access_expires_at, g.backing_session_id,
  g.test_entitlement_generation,
  (s.revoked_at IS NULL AND s.expires_at > clock_timestamp()) AS backing_live,
  (u.status = 'active') AS user_active,
  (SELECT min(f.expires_at) FROM capir_auth_refresh_tokens f
    WHERE f.grant_id = g.id AND f.consumed_at IS NULL AND f.revoked_at IS NULL) AS refresh_expires_at`;

const GRANT_FROM = `FROM capir_auth_grants g
  JOIN accounts a ON a.id = g.account_id
  JOIN users u ON u.account_id = g.account_id AND u.id = g.user_id
  JOIN sessions s ON s.id = g.backing_session_id`;

function grantState(row: GrantRow, now = Date.now()): CapirAuthGrant["state"] {
  if (row.state === "revoked" || !row.backing_live || !row.user_active) return "revoked";
  if (row.absolute_expires_at.getTime() <= now) return "expired";
  return "active";
}

function describeGrant(row: GrantRow): CapirAuthGrant {
  return {
    id: row.id,
    client_label: row.client_label,
    scopes: row.scopes as CapirAuthGrant["scopes"],
    web_origin: row.web_origin,
    backend_origin: row.backend_origin,
    created_at: row.created_at.toISOString(),
    last_verified_at: row.last_verified_at ? row.last_verified_at.toISOString() : null,
    access_expires_at: (row.access_expires_at ?? row.created_at).toISOString(),
    refresh_expires_at: (row.refresh_expires_at ?? row.absolute_expires_at).toISOString(),
    absolute_expires_at: row.absolute_expires_at.toISOString(),
    state: grantState(row),
    refresh_supported: true,
  };
}

function describeManagedGrant(row: GrantRow): CapirAuthManagedGrant {
  return {
    id: row.id,
    client_label: row.client_label,
    environment: {
      backend_origin: row.backend_origin,
      web_origin: row.web_origin,
    },
    scopes: row.scopes as CapirAuthManagedGrant["scopes"],
    created_at: row.created_at.toISOString(),
    last_used_at: row.last_verified_at ? row.last_verified_at.toISOString() : null,
    access_expires_at: (row.access_expires_at ?? row.created_at).toISOString(),
    absolute_expires_at: row.absolute_expires_at.toISOString(),
    state: grantState(row),
  };
}

function invalidProof(): ApiError {
  return new ApiError(
    401,
    "CAPIR_AUTH_PROOF_INVALID",
    "The authorization proof did not match this request; no credential was issued.",
  );
}

export class CapirAuthService {
  constructor(
    readonly pool: Pool,
    private readonly config: BackendConfig,
    private readonly deploymentWorkspaceIds?:readonly string[],
  ) {}

  get settings(): NonNullable<BackendConfig["capirAuth"]> | undefined {
    return this.config.capirAuth;
  }

  get enabled(): boolean {
    return this.config.capirAuth?.enabled === true;
  }

  private requireEnabled(): NonNullable<BackendConfig["capirAuth"]> {
    const settings = this.settings;
    if (!this.enabled || !settings) {
      throw new ApiError(
        403,
        "CAPIR_AUTH_DISABLED",
        "Browser-owned CLI authorization is disabled on this service.",
      );
    }
    return settings;
  }

  /** The serving instance answers only its explicitly configured pair. */
  private requireOrigins(webOrigin: string, backendOrigin: string): void {
    const settings = this.requireEnabled();
    if (webOrigin !== settings.webOrigin || backendOrigin !== settings.backendOrigin) {
      throw new ApiError(
        403,
        "CAPIR_ORIGIN_DENIED",
        "This request is scoped to an exact registered backend/Web origin pair.",
      );
    }
  }

  capabilities(): CapirAuthCapabilitiesResponse {
    const settings = this.settings;
    const supported = this.enabled;
    return {
      schema_version: CAPIR_AUTH_SCHEMA_VERSION,
      enabled: supported,
      capabilities: Object.fromEntries(
        CAPIR_AUTH_CAPABILITY_NAMES.map((name) => [
          name,
          supported ? ("supported" as const) : ("unsupported" as const),
        ]),
      ) as CapirAuthCapabilitiesResponse["capabilities"],
      device_auth: "unsupported",
      scopes: supported ? [...CAPIR_AUTH_SCOPES] : [],
      backend_origin: settings?.backendOrigin ?? "",
      web_origin: settings?.webOrigin ?? "",
      lifetimes: {
        code_seconds: settings?.codeTtlSeconds ?? 60,
        access_seconds: settings?.accessTtlSeconds ?? 900,
        refresh_idle_seconds: settings?.refreshIdleTtlSeconds ?? 604800,
        refresh_absolute_seconds: settings?.refreshAbsoluteTtlSeconds ?? 2592000,
      },
      unsupported: supported
        ? ["device_auth", "auth.device_code"]
        : [...CAPIR_AUTH_CAPABILITY_NAMES, "device_auth", "auth.device_code"],
    };
  }

  /**
   * Revalidate and HOLD the real primary browser identity through commit:
   * the consenting session must still be live, the user a real non-Lab
   * primary identity, and the account admitted. Lock order: account share,
   * session share, user share.
   */
  private async lockPrimaryBrowserIdentity(
    client: PoolClient,
    auth: { accountId: string; userId: string; sessionId: string },
  ): Promise<void> {
    if(this.deploymentWorkspaceIds && !this.deploymentWorkspaceIds.includes(auth.accountId))
      throw new ApiError(403,'DEPLOYMENT_WORKSPACE_NOT_ADMITTED','This workspace is outside the deployment audience.');
    await assertAccountActive(client, auth.accountId);
    const session = await client.query<{ live: boolean }>(
      `SELECT (revoked_at IS NULL AND expires_at > clock_timestamp()) AS live
         FROM sessions WHERE id = $1 AND account_id = $2 AND user_id = $3
         FOR SHARE`,
      [auth.sessionId, auth.accountId, auth.userId],
    );
    const user = await client.query<{ status: string; kind: string }>(
      `SELECT status, kind FROM users WHERE account_id = $1 AND id = $2 FOR SHARE`,
      [auth.accountId, auth.userId],
    );
    const row = user.rows[0];
    if (
      !session.rows[0]?.live ||
      !row ||
      row.status !== "active" ||
      row.kind === "lab_human"
    ) {
      throw new ApiError(
        401,
        "CAPIR_GRANT_REVOKED",
        "This sign-in session is no longer active; sign in again before authorizing the CLI.",
      );
    }
  }

  async consentContext(auth: AuthContext): Promise<{scopes: CapirAuthScope[]; identity: {account_id:string; user_id:string}}> {
    this.requireEnabled();
    return inTransaction(this.pool, async client => {
      await this.lockPrimaryBrowserIdentity(client, auth);
      const entitled = await client.query<{scopes:string[]}>(`SELECT scopes FROM capir_user_test_entitlements
        WHERE account_id=$1 AND user_id=$2 AND state='active' FOR SHARE`, [auth.accountId,auth.userId]);
      return {identity:{account_id:auth.accountId,user_id:auth.userId}, scopes:CAPIR_AUTH_SCOPES.filter(scope =>
        !scope.startsWith('test.') || entitled.rows[0]?.scopes.includes(scope))};
    });
  }

  /**
   * Browser consent, reached only through an intentional session-bound CSRF
   * POST from the Web layer. The code binds the granting user, the exact
   * origin pair, the literal loopback redirect, the browser state, the PKCE
   * S256 challenge and the exact displayed scopes. No grant is created here.
   */
  async authorize(
    auth: AuthContext,
    request: CapirAuthAuthorizeRequest,
  ): Promise<CapirAuthAuthorizeResponse> {
    const settings = this.requireEnabled();
    this.requireOrigins(request.web_origin, request.backend_origin);
    if (!capirAuthRedirectValid(request.redirect_uri)) {
      throw new ApiError(
        403,
        "CAPIR_REDIRECT_DENIED",
        "The redirect must be the literal loopback address 127.0.0.1 on an ephemeral port.",
      );
    }
    return inTransaction(this.pool, async (client) => {
      // Route admission is not enough: the consent must still be backed by a
      // live primary session and admitted account/user through the commit.
      await this.lockPrimaryBrowserIdentity(client, auth);
      const entitlement = await client.query<{scopes:string[]}>(`SELECT scopes FROM capir_user_test_entitlements
        WHERE account_id=$1 AND user_id=$2 AND state='active' FOR SHARE`, [auth.accountId,auth.userId]);
      if (!request.scopes.length || new Set(request.scopes).size !== request.scopes.length || request.scopes.some(scope =>
        scope.startsWith('test.') && !entitlement.rows[0]?.scopes.includes(scope)))
        throw new ApiError(403, 'CAPIR_SCOPE_DENIED', 'The displayed scopes are no longer available to this user.');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,139))',[auth.sessionId]);
      // Bound rate limiting: one browser session cannot mint unlimited codes.
      const open = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM capir_auth_codes
          WHERE browser_session_id = $1 AND consumed_at IS NULL AND expires_at > now()`,
        [auth.sessionId],
      );
      if (Number(open.rows[0]!.count) >= 5) {
        throw new ApiError(
          429,
          "CAPIR_AUTH_RATE_LIMITED",
          "Too many pending CLI authorizations; finish or cancel one before starting another.",
        );
      }
      const code = secret();
      const expiresAt = new Date(Date.now() + settings.codeTtlSeconds * 1_000);
      await client.query(
        `INSERT INTO capir_auth_codes(
           id, code_hash, account_id, user_id, browser_session_id,
           web_origin, backend_origin, redirect_uri, state_hash, code_challenge,
           scopes, client_label, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          randomUUID(),
          sha256(code),
          auth.accountId,
          auth.userId,
          auth.sessionId,
          request.web_origin,
          request.backend_origin,
          request.redirect_uri,
          sha256(request.state),
          request.code_challenge,
          [...request.scopes],
          request.client_label,
          expiresAt,
        ],
      );
      return {
        schema_version: CAPIR_AUTH_SCHEMA_VERSION,
        code,
        state: request.state,
        redirect_uri: request.redirect_uri,
        expires_at: expiresAt.toISOString(),
      };
    });
  }

  /**
   * Code exchange. The code is consumed on its FIRST attempt and stays
   * consumed on a bad proof or replay (safe abuse policy). Only a fully
   * verified proof mints the grant, its backing session and the rotating
   * refresh family.
   */
  async exchange(request: CapirAuthExchangeRequest): Promise<CapirAuthExchangeResponse> {
    const settings = this.requireEnabled();
    this.requireOrigins(request.web_origin, request.backend_origin);
    if (!capirAuthRedirectValid(request.redirect_uri)) {
      throw new ApiError(
        403,
        "CAPIR_REDIRECT_DENIED",
        "The redirect is not a literal loopback callback.",
      );
    }
    type ExchangeOutcome =
      | { kind: "minted"; response: CapirAuthExchangeResponse }
      | { kind: "rejected"; error: ApiError };
    const outcome = await inTransaction<ExchangeOutcome>(this.pool, async (client) => {
      const claimed = (
        await client.query<{
          id: string;
          account_id: string;
          user_id: string;
          browser_session_id: string;
          web_origin: string;
          backend_origin: string;
          redirect_uri: string;
          state_hash: string;
          code_challenge: string;
          scopes: string[];
          client_label: string;
        }>(
          `UPDATE capir_auth_codes SET consumed_at = now()
            WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now()
            RETURNING id, account_id, user_id, browser_session_id, web_origin, backend_origin,
                      redirect_uri, state_hash, code_challenge, scopes, client_label`,
          [sha256(request.code)],
        )
      ).rows[0];
      if (!claimed) {
        const known = await client.query<{ consumed_at: Date | null }>(
          `SELECT consumed_at FROM capir_auth_codes WHERE code_hash = $1`,
          [sha256(request.code)],
        );
        const row = known.rows[0];
        throw new ApiError(
          401,
          row?.consumed_at ? "CAPIR_AUTH_CODE_REPLAY" : "CAPIR_AUTH_CODE_INVALID",
          row?.consumed_at
            ? "This authorization code was already used; start the login again."
            : "This authorization code is not valid; start the login again.",
        );
      }
      // The code is durably consumed by THIS transaction. Every failure below
      // returns a committed rejection, so consumption survives a bad proof, a
      // dead browser session or a replay attempt.
      const proofOk =
        sameSecret(sha256(request.state), claimed.state_hash) &&
        sameSecret(pkceChallenge(request.code_verifier), claimed.code_challenge) &&
        request.redirect_uri === claimed.redirect_uri &&
        request.web_origin === claimed.web_origin &&
        request.backend_origin === claimed.backend_origin;
      if (!proofOk) {
        await client.query(
          `UPDATE capir_auth_codes SET failed_attempts = failed_attempts + 1 WHERE id = $1`,
          [claimed.id],
        );
        return { kind: "rejected", error: invalidProof() };
      }
      try {
        // The consenting primary browser session, its user and the account
        // must still be live and held through the mint commit.
        await this.lockPrimaryBrowserIdentity(client, {
          accountId: claimed.account_id,
          userId: claimed.user_id,
          sessionId: claimed.browser_session_id,
        });
      } catch (error) {
        return {
          kind: "rejected",
          error: error instanceof ApiError ? error : invalidProof(),
        };
      }
      const entitled=(await client.query<{scopes:string[]}>(`SELECT scopes FROM capir_user_test_entitlements
        WHERE account_id=$1 AND user_id=$2 AND state='active' FOR SHARE`,[claimed.account_id,claimed.user_id])).rows[0];
      if (claimed.scopes.some(scope=>scope.startsWith('test.') && !entitled?.scopes.includes(scope)))
        return {kind:'rejected',error:new ApiError(403,'CAPIR_SCOPE_DENIED','Test access was withdrawn before the exchange.')};
      return {
        kind: "minted",
        response: await this.mintGrant(client, {
          accountId: claimed.account_id,
          userId: claimed.user_id,
          clientLabel: claimed.client_label,
          webOrigin: claimed.web_origin,
          backendOrigin: claimed.backend_origin,
          // Exactly the scopes frozen at the consent click; never broadened.
          scopes: claimed.scopes,
          settings,
        }),
      };
    });
    if (outcome.kind === "rejected") throw outcome.error;
    return outcome.response;
  }

  private async mintGrant(
    client: PoolClient,
    input: {
      accountId: string;
      userId: string;
      clientLabel: string;
      webOrigin: string;
      backendOrigin: string;
      /** Scopes frozen at the consent click; never broadened afterwards. */
      scopes: string[];
      settings: NonNullable<BackendConfig["capirAuth"]>;
    },
  ): Promise<CapirAuthExchangeResponse> {
    const { settings } = input;
    const now = Date.now();
    const absoluteExpiresAt = new Date(now + settings.refreshAbsoluteTtlSeconds * 1_000);
    const accessExpiresAt = new Date(now + settings.accessTtlSeconds * 1_000);
    const refreshIdleExpiresAt = new Date(
      Math.min(now + settings.refreshIdleTtlSeconds * 1_000, absoluteExpiresAt.getTime()),
    );
    // The backing session's generic token never leaves the backend; only its
    // digest is stored, exactly like every other credential.
    const backingSessionToken = secret();
    const backingSessionId = randomUUID();
    await client.query(
      `INSERT INTO sessions(id, account_id, user_id, token_hash, client_label, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        backingSessionId,
        input.accountId,
        input.userId,
        sha256(backingSessionToken),
        `capir-cli:${input.clientLabel}`,
        absoluteExpiresAt,
      ],
    );
    const accessToken = secret();
    const refreshToken = secret();
    const grantId = randomUUID();
    // Entitlement generation observed at mint: authority derived under this
    // generation can never be resurrected by a later revoke -> regrant.
    const entitlement = await client.query<{ generation: number }>(
      `SELECT generation FROM capir_user_test_entitlements
        WHERE account_id = $1 AND user_id = $2 AND state = 'active' FOR SHARE`,
      [input.accountId, input.userId],
    );
    const entitlementGeneration = entitlement.rows[0]?.generation ?? null;
    await client.query(
      `INSERT INTO capir_auth_grants(
         id, account_id, user_id, backing_session_id, client_label, web_origin,
         backend_origin, scopes, state, test_entitlement_generation,
         absolute_expires_at, access_token_hash,
         access_expires_at, last_verified_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $11, $12, now())`,
      [
        grantId,
        input.accountId,
        input.userId,
        backingSessionId,
        input.clientLabel,
        input.webOrigin,
        input.backendOrigin,
        [...input.scopes],
        entitlementGeneration,
        absoluteExpiresAt,
        sha256(accessToken),
        accessExpiresAt,
      ],
    );
    await client.query(
      `INSERT INTO capir_auth_refresh_tokens(
         id, grant_id, family_id, generation, account_id, token_hash,
         expires_at, absolute_expires_at
       ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
      [
        randomUUID(),
        grantId,
        randomUUID(),
        input.accountId,
        sha256(refreshToken),
        refreshIdleExpiresAt,
        absoluteExpiresAt,
      ],
    );
    const row = (
      await client.query<GrantRow>(`SELECT ${GRANT_COLUMNS} ${GRANT_FROM} WHERE g.id = $1`, [
        grantId,
      ])
    ).rows[0]!;
    return {
      schema_version: CAPIR_AUTH_SCHEMA_VERSION,
      access_token: accessToken,
      refresh_token: refreshToken,
      grant: describeGrant(row),
    };
  }

  /**
   * Rotation. The presented token row and the grant are locked and rechecked
   * through commit. A consumed token is replay: the whole family and the grant
   * are revoked INSIDE this transaction, which commits before the replay error
   * is raised so the revocation can never be rolled back.
   */
  async refresh(request: CapirAuthRefreshRequest): Promise<CapirAuthRefreshResponse> {
    const settings = this.requireEnabled();
    this.requireOrigins(request.web_origin, request.backend_origin);
    type RefreshOutcome =
      | { kind: "rotated"; response: CapirAuthRefreshResponse }
      | { kind: "replay" };
    const outcome = await inTransaction<RefreshOutcome>(this.pool, async (client) => {
      const located = (await client.query<{grant_id:string}>('SELECT grant_id FROM capir_auth_refresh_tokens WHERE token_hash=$1', [sha256(request.refresh_token)])).rows[0];
      if (!located) throw new ApiError(401, 'CAPIR_REFRESH_INVALID', 'Sign in again.');
      await client.query('SELECT id FROM capir_auth_grants WHERE id=$1 FOR UPDATE', [located.grant_id]);
      const token = (
        await client.query<{
          id: string;
          grant_id: string;
          family_id: string;
          generation: number;
          account_id: string;
          expires_at: Date;
          absolute_expires_at: Date;
          consumed_at: Date | null;
          revoked_at: Date | null;
        }>(
          `SELECT id, grant_id, family_id, generation, account_id, expires_at,
                  absolute_expires_at, consumed_at, revoked_at
             FROM capir_auth_refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
          [sha256(request.refresh_token)],
        )
      ).rows[0];
      if (!token) {
        throw new ApiError(
          401,
          "CAPIR_REFRESH_INVALID",
          "This credential cannot be refreshed; sign in again.",
        );
      }
      const grant = (
        await client.query<{
          id: string;
          state: string;
          absolute_expires_at: Date;
          backing_session_id: string;
          web_origin: string;
          backend_origin: string;
          account_id: string;
          user_id: string;
        }>(
          `SELECT id, state, absolute_expires_at, backing_session_id, web_origin,
                  backend_origin, account_id, user_id
             FROM capir_auth_grants WHERE id = $1 FOR UPDATE`,
          [token.grant_id],
        )
      ).rows[0]!;
      if (token.consumed_at) {
        // Replay of consumed history: revoke family + grant + backing session
        // inside this transaction and let it commit before failing.
        await this.revokeFamilyLocked(client, token.family_id, grant.id, "refresh_replay");
        return { kind: "replay" };
      }
      if (
        token.revoked_at ||
        grant.state !== "active" ||
        grant.web_origin !== request.web_origin ||
        grant.backend_origin !== request.backend_origin ||
        grant.absolute_expires_at.getTime() <= Date.now() ||
        token.expires_at.getTime() <= Date.now() ||
        token.absolute_expires_at.getTime() <= Date.now()
      ) {
        throw new ApiError(
          401,
          "CAPIR_REFRESH_EXPIRED",
          "This credential can no longer be refreshed; sign in again.",
        );
      }
      // Locked-write authority recheck through commit.
      await assertAccountActive(client, grant.account_id);
      const backing = await client.query<{ live: boolean }>(
        `SELECT (revoked_at IS NULL AND expires_at > clock_timestamp()) AS live
           FROM sessions WHERE id = $1 FOR SHARE`,
        [grant.backing_session_id],
      );
      const user = await client.query<{ status: string }>(
        `SELECT status FROM users WHERE account_id = $1 AND id = $2 FOR SHARE`,
        [grant.account_id, grant.user_id],
      );
      if (!backing.rows[0]?.live || user.rows[0]?.status !== "active") {
        throw new ApiError(
          401,
          "CAPIR_GRANT_REVOKED",
          "This CLI authorization is no longer active; sign in again.",
        );
      }
      const now = Date.now();
      const accessExpiresAt = new Date(now + settings.accessTtlSeconds * 1_000);
      const refreshIdleExpiresAt = new Date(
        Math.min(now + settings.refreshIdleTtlSeconds * 1_000, token.absolute_expires_at.getTime()),
      );
      await client.query(
        `UPDATE capir_auth_refresh_tokens SET consumed_at = now()
          WHERE id = $1 AND consumed_at IS NULL`,
        [token.id],
      );
      const accessToken = secret();
      const refreshToken = secret();
      await client.query(
        `INSERT INTO capir_auth_refresh_tokens(
           id, grant_id, family_id, generation, account_id, token_hash,
           expires_at, absolute_expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          grant.id,
          token.family_id,
          token.generation + 1,
          grant.account_id,
          sha256(refreshToken),
          refreshIdleExpiresAt,
          token.absolute_expires_at,
        ],
      );
      await client.query(
        `UPDATE capir_auth_grants
            SET access_token_hash = $2, access_expires_at = $3, last_verified_at = now()
          WHERE id = $1`,
        [grant.id, sha256(accessToken), accessExpiresAt],
      );
      const row = (
        await client.query<GrantRow>(`SELECT ${GRANT_COLUMNS} ${GRANT_FROM} WHERE g.id = $1`, [
          grant.id,
        ])
      ).rows[0]!;
      return {
        kind: "rotated",
        response: {
          schema_version: CAPIR_AUTH_SCHEMA_VERSION,
          access_token: accessToken,
          refresh_token: refreshToken,
          grant: describeGrant(row),
        },
      };
    });
    if (outcome.kind === "replay") {
      // Raised only after the revocation transaction committed.
      throw new ApiError(
        401,
        "CAPIR_REFRESH_REPLAY",
        "This refresh credential was already used; its credential family was revoked. Sign in again.",
      );
    }
    return outcome.response;
  }

  async status(accessToken: string): Promise<CapirAuthV2StatusResponse> {
    this.requireEnabled();
    const row = await this.findGrantByAccessToken(accessToken);
    if (!row) {
      return {
        schema_version: CAPIR_AUTH_SCHEMA_VERSION,
        state: "unverified",
        grant: null,
        identity: null,
      };
    }
    const originsMatch=row.web_origin===this.settings?.webOrigin && row.backend_origin===this.settings?.backendOrigin;
    const audienceMatch=!this.deploymentWorkspaceIds || this.deploymentWorkspaceIds.includes(row.account_id);
    const projected = originsMatch && audienceMatch ? grantState(row) : 'revoked';
    const state: CapirAuthV2StatusResponse["state"] =
      projected !== "active"
        ? projected
        : !row.backing_live || !row.user_active
          ? "revoked"
          : !row.access_expires_at || row.access_expires_at.getTime() <= Date.now()
            ? "expired"
            : "active";
    return {
      schema_version: CAPIR_AUTH_SCHEMA_VERSION,
      state,
      grant: describeGrant(row),
      identity: {
        account_id: row.account_id,
        account_slug: row.account_slug,
        user_id: row.user_id,
        user_email: row.user_email,
      },
    };
  }

  /**
   * Grant-scoped route admission. Verifies the presented grant, its backing
   * session liveness, the account/user authority and the exact origin pair
   * before any scoped route body runs.
   */
  async admitGrantToken(
    accessToken: string,
    origins: { webOrigin?: string | undefined; backendOrigin?: string | undefined },
  ): Promise<CapirGrantAdmission> {
    this.requireEnabled();
    const row = await this.findGrantByAccessToken(accessToken);
    if (!row) {
      throw new ApiError(
        401,
        "CAPIR_AUTH_REQUIRED",
        "A scoped capir CLI credential is required.",
      );
    }
    this.requireOrigins(row.web_origin,row.backend_origin);
    if(this.deploymentWorkspaceIds && !this.deploymentWorkspaceIds.includes(row.account_id))
      throw new ApiError(403,'DEPLOYMENT_WORKSPACE_NOT_ADMITTED','This workspace is outside the deployment audience.');
    if (row.state !== "active" || !row.backing_live || !row.user_active) {
      throw new ApiError(
        401,
        "CAPIR_GRANT_REVOKED",
        "This CLI authorization is no longer active.",
      );
    }
    if (
      row.absolute_expires_at.getTime() <= Date.now() ||
      !row.access_expires_at ||
      row.access_expires_at.getTime() <= Date.now()
    ) {
      throw new ApiError(
        401,
        "CAPIR_GRANT_EXPIRED",
        "This CLI credential has expired; refresh or sign in again.",
      );
    }
    if (
      (origins.webOrigin && origins.webOrigin !== row.web_origin) ||
      (origins.backendOrigin && origins.backendOrigin !== row.backend_origin)
    ) {
      throw new ApiError(
        403,
        "CAPIR_ORIGIN_DENIED",
        "This credential is scoped to an exact registered backend/Web origin pair.",
      );
    }
    return {
      grantId: row.id,
      accountId: row.account_id,
      accountSlug: row.account_slug,
      userId: row.user_id,
      userEmail: row.user_email,
      scopes: row.scopes,
      webOrigin: row.web_origin,
      backendOrigin: row.backend_origin,
      backingSessionId: row.backing_session_id,
      testEntitlementGeneration: row.test_entitlement_generation,
    };
  }

  /**
   * User test entitlement admission (deny by default). Rechecked inside every
   * locked test write through `assertUserTestAuthorityLocked`.
   */
  async requireTestScope(
    admission: CapirGrantAdmission,
    scope: string,
  ): Promise<CapirUserTestAuthority> {
    if (!admission.scopes.includes(scope)) {
      throw new ApiError(
        403,
        "CAPIR_SCOPE_DENIED",
        "This CLI grant does not include the requested scope.",
      );
    }
    const entitled = await this.pool.query<{ generation: number }>(
      `SELECT generation FROM capir_user_test_entitlements
        WHERE account_id = $1 AND user_id = $2 AND state = 'active' AND $3 = ANY(scopes)`,
      [admission.accountId, admission.userId, scope],
    );
    const generation = entitled.rows[0]?.generation;
    if (
      generation === undefined ||
      admission.testEntitlementGeneration === null ||
      admission.testEntitlementGeneration !== generation
    ) {
      throw new ApiError(
        403,
        "CAPIR_TEST_ENTITLEMENT_REQUIRED",
        "This account has not been granted test access.",
      );
    }
    return {
      grantId: admission.grantId,
      accountId: admission.accountId,
      userId: admission.userId,
      backingSessionId: admission.backingSessionId,
      webOrigin: admission.webOrigin,
      backendOrigin: admission.backendOrigin,
    };
  }

  /** Logout by access token or purpose-specific refresh proof; never both. */
  async logout(input: {
    accessToken?: string | undefined;
    refreshToken?: string | undefined;
  }): Promise<CapirAuthLogoutResponse> {
    this.requireEnabled();
    const revoked = await inTransaction(this.pool, async (client) => {
      let grantId: string | null = null;
      if (input.refreshToken) {
        // A refresh proof identifies its grant even when it is already
        // consumed: logout is destructive-only for exactly that grant and
        // must work without refreshing an expired access token first.
        const found = await client.query<{ grant_id: string }>(
          `SELECT grant_id FROM capir_auth_refresh_tokens WHERE token_hash = $1`,
          [sha256(input.refreshToken)],
        );
        grantId = found.rows[0]?.grant_id ?? null;
      }
      if (!grantId && input.accessToken) {
        const found = await client.query<{ id: string }>(
          `SELECT id FROM capir_auth_grants WHERE access_token_hash = $1`,
          [sha256(input.accessToken)],
        );
        grantId = found.rows[0]?.id ?? null;
      }
      if (!grantId) {
        throw new ApiError(
          401,
          "CAPIR_AUTH_REQUIRED",
          "This credential cannot be resolved to a CLI grant.",
        );
      }
      return this.revokeGrantLocked(client, grantId, "logout");
    });
    return {
      schema_version: CAPIR_AUTH_SCHEMA_VERSION,
      revoked_grant_id: revoked.grantId,
      revoked_at: revoked.revokedAt.toISOString(),
    };
  }

  /** Web management: the caller's own grants only, current real account only. */
  async listGrants(auth: AuthContext): Promise<CapirAuthGrantListResponse> {
    this.requireEnabled();
    const rows = await this.pool.query<GrantRow>(
      `SELECT ${GRANT_COLUMNS} ${GRANT_FROM}
        WHERE g.account_id = $1 AND g.user_id = $2
        ORDER BY g.created_at DESC`,
      [auth.accountId, auth.userId],
    );
    return {
      schema_version: CAPIR_AUTH_SCHEMA_VERSION,
      grants: rows.rows.map(describeManagedGrant),
    };
  }

  async revokeGrant(
    auth: AuthContext,
    grantId: string,
  ): Promise<CapirAuthGrantRevokeResponse> {
    this.requireEnabled();
    const revoked = await inTransaction(this.pool, (client) =>
      this.revokeGrantLocked(client, grantId, "user_revoked", {
        accountId: auth.accountId,
        userId: auth.userId,
      }),
    );
    return {
      schema_version: CAPIR_AUTH_SCHEMA_VERSION,
      revoked_grant_id: revoked.grantId,
      revoked_at: revoked.revokedAt.toISOString(),
    };
  }

  private async findGrantByAccessToken(accessToken: string): Promise<GrantRow | null> {
    const row = await this.pool.query<GrantRow>(
      `SELECT ${GRANT_COLUMNS} ${GRANT_FROM} WHERE g.access_token_hash = $1`,
      [sha256(accessToken)],
    );
    return row.rows[0] ?? null;
  }

  /**
   * Revoke one grant, its whole refresh family and its backing session inside
   * the caller's transaction. A missing or already revoked grant is reported
   * honestly instead of being silently treated as freshly revoked.
   */
  private async revokeGrantLocked(
    client: PoolClient,
    grantId: string,
    reason: CapirRevokeReason,
    owner?: { accountId: string; userId: string },
  ): Promise<{ grantId: string; revokedAt: Date; alreadyRevoked: boolean }> {
    const locked = (
      await client.query<{
        id: string;
        state: string;
        revoked_at: Date | null;
      }>(
        `SELECT id, state, revoked_at FROM capir_auth_grants
          WHERE id = $1 ${owner ? "AND account_id = $2 AND user_id = $3" : ""}
          FOR UPDATE`,
        owner ? [grantId, owner.accountId, owner.userId] : [grantId],
      )
    ).rows[0];
    if (!locked) {
      throw new ApiError(
        404,
        "CAPIR_GRANT_NOT_FOUND",
        "This CLI authorization is not available on your account.",
      );
    }
    if (locked.state === "revoked") {
      return {
        grantId: locked.id,
        revokedAt: locked.revoked_at ?? new Date(),
        alreadyRevoked: true,
      };
    }
    const result = await client.query<{ revoked_at: Date }>(
      `WITH revoked AS (
         UPDATE capir_auth_grants
            SET state = 'revoked', revoked_at = now(), revoke_reason = $2
          WHERE id = $1 AND state = 'active'
          RETURNING id, revoked_at, backing_session_id
       ), sessions_revoked AS (
         UPDATE sessions SET revoked_at = revoked.revoked_at
           FROM revoked WHERE sessions.id = revoked.backing_session_id
           RETURNING sessions.id
       ), tokens AS (
         UPDATE capir_auth_refresh_tokens f
            SET revoked_at = now()
           FROM revoked WHERE f.grant_id = revoked.id AND f.revoked_at IS NULL
           RETURNING f.id
       )
       SELECT revoked.revoked_at FROM revoked`,
      [grantId, reason],
    );
    return {
      grantId: locked.id,
      revokedAt: result.rows[0]?.revoked_at ?? new Date(),
      alreadyRevoked: false,
    };
  }

  /** Revoke a whole refresh family and its grant; committed before failure. */
  private async revokeFamilyLocked(
    client: PoolClient,
    familyId: string,
    grantId: string,
    reason: CapirRevokeReason,
  ): Promise<void> {
    await client.query(
      `UPDATE capir_auth_refresh_tokens SET revoked_at = now()
        WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
    await client.query(
      `UPDATE capir_auth_grants
          SET state = 'revoked', revoked_at = now(), revoke_reason = $2
        WHERE id = $1 AND state = 'active'`,
      [grantId, reason],
    );
    await client.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE id = (SELECT backing_session_id FROM capir_auth_grants WHERE id = $1)
          AND revoked_at IS NULL`,
      [grantId],
    );
  }
}

/**
 * Locked-write authority recheck: the current grant, its backing session,
 * the real user and the server-owned test entitlement must all still admit
 * this exact scope, origin pair and entitlement generation through commit.
 * Rows are locked in the stable order account share, grant update, session
 * share, user share, entitlement share so late withdrawals block the write
 * instead of racing it.
 */
export async function assertUserTestAuthorityLocked(
  client: PoolClient,
  authority: CapirUserTestAuthority,
  scope: string,
): Promise<void> {
  await assertAccountActive(client, authority.accountId);
  const grant = (
    await client.query<{
      state: string;
      absolute_expires_at: Date;
      scopes: string[];
      web_origin: string;
      backend_origin: string;
      test_entitlement_generation: number | null;
    }>(
      `SELECT state, absolute_expires_at, scopes, web_origin, backend_origin,
              test_entitlement_generation
         FROM capir_auth_grants
        WHERE id = $1 AND account_id = $2 AND user_id = $3 AND backing_session_id = $4
        FOR UPDATE`,
      [authority.grantId, authority.accountId, authority.userId, authority.backingSessionId],
    )
  ).rows[0];
  const session = await client.query<{ live: boolean }>(
    `SELECT (revoked_at IS NULL AND expires_at > clock_timestamp()) AS live
       FROM sessions WHERE id = $1 FOR SHARE`,
    [authority.backingSessionId],
  );
  const user = await client.query<{ status: string }>(
    `SELECT status FROM users WHERE account_id = $1 AND id = $2 FOR SHARE`,
    [authority.accountId, authority.userId],
  );
  const entitlement = await client.query<{ generation: number }>(
    `SELECT generation FROM capir_user_test_entitlements
      WHERE account_id = $1 AND user_id = $2 AND state = 'active' AND $3 = ANY(scopes)
      FOR SHARE`,
    [authority.accountId, authority.userId, scope],
  );
  const generation = entitlement.rows[0]?.generation;
  if (
    !grant ||
    grant.state !== "active" ||
    grant.absolute_expires_at.getTime() <= Date.now() ||
    !session.rows[0]?.live ||
    user.rows[0]?.status !== "active" ||
    !grant.scopes.includes(scope) ||
    grant.web_origin !== authority.webOrigin ||
    grant.backend_origin !== authority.backendOrigin ||
    generation === undefined ||
    grant.test_entitlement_generation === null ||
    grant.test_entitlement_generation !== generation
  ) {
    throw new ApiError(
      403,
      "CAPIR_TEST_ENTITLEMENT_REQUIRED",
      "This CLI grant or test entitlement is no longer active.",
    );
  }
}
