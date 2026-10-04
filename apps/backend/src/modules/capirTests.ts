import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  CAPIR_TEST_SCHEMA_VERSION,
  type CapirTestCapabilitiesResponse,
  type CapirTestCreateRequest,
  type CapirTestHandoffExchangeRequest,
  type CapirTestHandoffExchangeResponse,
  type CapirTestHandoffRequest,
  type CapirTestHandoffResponse,
  type CapirTestRun,
  type CapirTestStopRequest,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import type { BackendConfig } from "../config.js";
import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";
import {
  CAPIR_TEST_DAILY_COUNTS,
  capirTestPreset,
  capirTestPresets,
  loadCapirTestScenario,
  verifyCapirTestScenario,
} from "./capirTestScenarios.js";
import {
  admitLabPasswordSession,
  lockLabRunForAdmission,
  type LabPasswordIdentity,
} from "./capirTestSessions.js";
import type { ChatMediaStorage } from "./chatMediaStorage.js";
import type { LabWorkspaceService } from "./labWorkspaces.js";
import { encodePasswordCredential, verifyPasswordCredential } from "./passwordCredential.js";

/**
 * Operator-owned test-account provisioning (`capir test create`, Task 1).
 *
 * The provisioning credential is a high-entropy service key bound to an exact
 * registered origin pair and generation; it can only create and manage its own
 * synthetic test runs. It never reads real workspaces, resets existing
 * passwords, grants privileges or promotes test identities into ordinary
 * accounts. The backend stores only salted scrypt password credentials and
 * never echoes a password, token or handoff secret in any projection.
 */

export const CAPIR_TEST_ENTRY_PATH = "/capir/test-entry";
export const CAPIR_TEST_UNSUPPORTED_SCOPES = [
  "auth.authorize",
  "auth.exchange",
  "auth.grants",
  "sandbox.create",
  "sandbox.strict_replay",
  "live_model_execution",
  "account.invites",
  "provider.linking",
  "password.reset",
  "account.promotion",
] as const;
const CAPIR_TEST_COMMANDS = ["test.create", "test.status", "test.stop", "test.handoffs"] as const;

const HANDLE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}$/;
// Domain segments cannot consume separators, so dotted input has one parse.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const LAB_EMAIL_DOMAIN = "@lab.invalid";
const HANDOFF_TTL_MS = 10 * 60 * 1_000;

export interface CapirTestPrincipal {
  id: string;
  label: string;
  generation: number;
  state: "enabled" | "revoked";
  webOrigin: string;
  backendOrigin: string;
  maxActiveRuns: number;
}

interface LockedPrincipalRow {
  id: string;
  label: string;
  generation: number;
  state: "enabled" | "revoked";
  web_origin: string;
  backend_origin: string;
  max_active_runs: number;
}

interface RunRow {
  id: string;
  request_id: string;
  principal_id: string;
  principal_generation: number;
  workspace_id: string;
  account_id: string;
  user_id: string;
  username: string;
  email: string;
  preset: "daily" | "empty";
  preset_version: string;
  preset_digest: string;
  counts: unknown;
  web_origin: string;
  backend_origin: string;
  created_at: Date;
  requested_username: string | null;
  workspace_state: "active" | "deleting" | "deleted";
  workspace_expires_at: Date;
  workspace_cleanup_error: CapirTestRun["cleanup_error"];
  duration_hours: number;
  principal_live: boolean;
}

const RUN_COLUMNS = `r.id, r.request_id, r.principal_id, r.principal_generation, r.workspace_id,
  r.account_id, r.user_id, r.username, r.requested_username, r.email, r.preset, r.preset_version,
  r.preset_digest, r.counts, r.web_origin, r.backend_origin, r.created_at,
  w.state AS workspace_state, w.expires_at AS workspace_expires_at,
  w.cleanup_error AS workspace_cleanup_error, w.duration_hours,
  (p.state = 'enabled' AND p.generation = r.principal_generation
    AND p.web_origin = r.web_origin AND p.backend_origin = r.backend_origin) AS principal_live`;

const RUN_FROM = `FROM capir_test_runs r
  JOIN lab_test_workspaces w ON w.id = r.workspace_id
  LEFT JOIN capir_test_provisioners p ON p.id = r.principal_id`;

function runState(row: RunRow): CapirTestRun["state"] {
  if (row.workspace_state === "deleting") return "deleting";
  if (row.workspace_state === "deleted") return "deleted";
  // Canonical status never claims an inaccessible run is ready: a rotated or
  // revoked provisioning principal denies every admission immediately.
  if (!row.principal_live) return "revoked";
  return row.workspace_expires_at.getTime() <= Date.now() ? "expired" : "ready";
}

function describeRun(row: RunRow): CapirTestRun {
  return {
    id: row.id,
    request_id: row.request_id,
    account_id: row.account_id,
    user_id: row.user_id,
    username: row.username,
    email: row.email,
    preset: row.preset,
    preset_version: row.preset_version,
    preset_digest: row.preset_digest,
    counts: {
      contacts: Number((row.counts as { contacts?: number })?.contacts ?? 0),
      observations: Number((row.counts as { observations?: number })?.observations ?? 0),
      tasks: Number((row.counts as { tasks?: number })?.tasks ?? 0),
    },
    state: runState(row),
    expires_at: row.workspace_expires_at.toISOString(),
    cleanup_error: row.workspace_cleanup_error,
    login_url: `${row.web_origin}${CAPIR_TEST_ENTRY_PATH}?run=${row.id}`,
  };
}

function disabled(): never {
  throw new ApiError(403, "CAPIR_TESTS_DISABLED", "Internal test-account provisioning is disabled on this service.");
}

/** The exact optional username intent of an operation. */
function requestedUsernameIntent(username: string | undefined): string | null {
  return username === undefined ? null : username.trim().toLowerCase();
}

/**
 * Materialize the explicitly configured provisioning principal (control
 * scope). The credential value itself never reaches the database; only its
 * SHA-256 hash, the exact origin pair and the configured generation do.
 *
 * Strict generation authority: a credential or origin change requires a higher
 * generation (rotation revokes every entry recorded earlier), a lower
 * configured generation never downgrades a newer record, and a revoked
 * principal is never revived by a restart.
 */
export async function ensureCapirTestProvisioningPrincipal(
  pool: Pool,
  capir: BackendConfig["capirTests"],
): Promise<void> {
  if (!capir?.enabled) return;
  const key = capir.provisioningKey;
  const webOrigin = capir.webOrigin;
  const backendOrigin = capir.backendOrigin;
  if (!key || !webOrigin || !backendOrigin) return;
  const credentialHash = sha256(key);
  await inTransaction(pool, async (client) => {
    const existing = (
      await client.query<{
        id: string;
        credential_hash: string;
        generation: number;
        state: "enabled" | "revoked";
        web_origin: string;
        backend_origin: string;
        max_active_runs: number;
      }>(
        `SELECT id, credential_hash, generation, state, web_origin, backend_origin, max_active_runs
           FROM capir_test_provisioners WHERE label = 'configured' FOR UPDATE`,
      )
    ).rows[0];
    if (!existing) {
      await client.query(
        `INSERT INTO capir_test_provisioners(
           id, label, credential_hash, generation, web_origin, backend_origin, max_active_runs
         ) VALUES ($1, 'configured', $2, $3, $4, $5, $6)`,
        [randomUUID(), credentialHash, capir.provisioningGeneration, webOrigin, backendOrigin, capir.maxActiveRuns],
      );
      return;
    }
    if (existing.state === "revoked") {
      throw new ApiError(
        403,
        "CAPIR_TEST_PRINCIPAL_REVOKED",
        "This provisioning principal is revoked and cannot be revived by configuration.",
      );
    }
    if (existing.generation > capir.provisioningGeneration) {
      throw new ApiError(
        409,
        "CAPIR_TEST_PRINCIPAL_GENERATION_DOWNGRADE",
        "The configured provisioning generation is older than the recorded one.",
      );
    }
    const semanticChange =
      existing.credential_hash !== credentialHash ||
      existing.web_origin !== webOrigin ||
      existing.backend_origin !== backendOrigin;
    if (semanticChange && existing.generation === capir.provisioningGeneration) {
      // Rotating the key or the exact origin pair without bumping the
      // generation would keep old entries admitted against changed authority.
      throw new ApiError(
        409,
        "CAPIR_TEST_PRINCIPAL_ROTATION_REQUIRED",
        "A provisioning credential or origin change requires a higher generation.",
      );
    }
    if (semanticChange) {
      await client.query(
        `UPDATE capir_test_provisioners
            SET credential_hash = $2, generation = $3, web_origin = $4,
                backend_origin = $5, max_active_runs = $6
          WHERE id = $1`,
        [existing.id, credentialHash, capir.provisioningGeneration, webOrigin, backendOrigin, capir.maxActiveRuns],
      );
    } else if (existing.generation < capir.provisioningGeneration) {
      await client.query(
        `UPDATE capir_test_provisioners SET generation = $2, max_active_runs = $3 WHERE id = $1`,
        [existing.id, capir.provisioningGeneration, capir.maxActiveRuns],
      );
    } else {
      await client.query(
        `UPDATE capir_test_provisioners SET max_active_runs = $2 WHERE id = $1`,
        [existing.id, capir.maxActiveRuns],
      );
    }
  });
}

export async function resolveCapirTestProvisioningPrincipal(
  pool: Pool,
  credential: string,
): Promise<CapirTestPrincipal | null> {
  const row = (
    await pool.query<{
      id: string;
      label: string;
      generation: number;
      state: "enabled" | "revoked";
      web_origin: string;
      backend_origin: string;
      max_active_runs: number;
    }>(
      `SELECT id, label, generation, state, web_origin, backend_origin, max_active_runs
         FROM capir_test_provisioners WHERE credential_hash = $1`,
      [sha256(credential)],
    )
  ).rows[0];
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    generation: row.generation,
    state: row.state,
    webOrigin: row.web_origin,
    backendOrigin: row.backend_origin,
    maxActiveRuns: row.max_active_runs,
  };
}

export function capirTestWebConsumerAuthorized(
  expected: string | undefined,
  presented: string | undefined,
): boolean {
  if (!expected || !presented) return false;
  const left = sha256(expected);
  const right = sha256(presented);
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export class CapirTestsService {
  constructor(
    readonly pool: Pool,
    private readonly config: BackendConfig,
    private readonly storage: ChatMediaStorage,
    private readonly labWorkspaces: LabWorkspaceService,
  ) {}

  get settings(): NonNullable<BackendConfig["capirTests"]> | undefined {
    return this.config.capirTests;
  }

  get enabled(): boolean {
    return this.config.internalLabEnabled === true && this.config.capirTests?.enabled === true;
  }

  get webHandoffAvailable(): boolean {
    return this.enabled && Boolean(this.config.capirTests?.webConsumerKey);
  }

  capabilities(): CapirTestCapabilitiesResponse {
    const enabled = this.enabled;
    return {
      schema_version: CAPIR_TEST_SCHEMA_VERSION,
      enabled,
      presets: capirTestPresets.map((preset) => ({
        id: preset.id,
        version: preset.version,
        digest: preset.digest,
      })),
      duration_hours: [1, 4, 24],
      max_active_runs: this.config.capirTests?.maxActiveRuns ?? 0,
      web_handoff_available: this.webHandoffAvailable,
      supported: enabled ? [...CAPIR_TEST_COMMANDS] : [],
      unsupported: [
        ...CAPIR_TEST_UNSUPPORTED_SCOPES,
        ...(enabled ? [] : [...CAPIR_TEST_COMMANDS]),
      ],
    };
  }

  private requireEnabled(): void {
    if (!this.enabled) disabled();
    if (!this.storage.labScopeID || !this.storage.purgeForLab || !this.storage.existsForLab) {
      throw new ApiError(
        503,
        "CAPIR_TEST_STORAGE_UNSUPPORTED",
        "Verified test-media cleanup is unavailable for this storage provider.",
      );
    }
  }

  private async ownedRun(
    client: Pick<Pool, "query"> | PoolClient,
    principal: CapirTestPrincipal,
    id: string,
  ): Promise<RunRow> {
    const row = (
      await client.query<RunRow>(
        `SELECT ${RUN_COLUMNS} ${RUN_FROM}
          WHERE r.id = $1 AND r.principal_id = $2`,
        [id, principal.id],
      )
    ).rows[0];
    if (!row) {
      throw new ApiError(404, "CAPIR_TEST_RUN_NOT_FOUND", "This test run is not available to this provisioning principal.");
    }
    return row;
  }

  /** The admitted principal itself must still be enabled. Run-level liveness
   * (generation/origins) is projected as `revoked` state instead of hiding the
   * operator's own audit metadata. */
  private assertPrincipalActive(principal: CapirTestPrincipal): void {
    if (principal.state !== "enabled") {
      throw new ApiError(403, "CAPIR_TEST_PRINCIPAL_INACTIVE", "This provisioning principal is no longer active.");
    }
  }

  async status(principal: CapirTestPrincipal, id: string): Promise<CapirTestRun> {
    this.requireEnabled();
    this.assertPrincipalActive(principal);
    return describeRun(await this.ownedRun(this.pool, principal, id));
  }

  async create(principal: CapirTestPrincipal, request: CapirTestCreateRequest): Promise<CapirTestRun> {
    this.requireEnabled();
    this.assertPrincipalActive(principal);
    if (request.web_origin !== principal.webOrigin) {
      throw new ApiError(
        403,
        "CAPIR_TEST_ORIGIN_DENIED",
        "This provisioning principal is scoped to an exact registered origin pair.",
      );
    }
    const preset = capirTestPreset(request.preset);
    if (!preset) {
      throw new ApiError(400, "CAPIR_TEST_PRESET_UNKNOWN", "This preset is not a versioned synthetic scenario.");
    }
    const runId = randomUUID();
    const handle = this.resolveHandle(request.username, runId);
    // Every generated email lives in the reserved lab.invalid namespace and
    // follows the chosen handle so no real address can ever be claimed.
    const email = EMAIL_SHAPE.test(handle) ? handle : `${handle}${LAB_EMAIL_DOMAIN}`;
    try {
      await inTransaction(this.pool, async (client) => {
        const locked = (
          await client.query<LockedPrincipalRow>(
            `SELECT id, label, generation, state, web_origin, backend_origin, max_active_runs
               FROM capir_test_provisioners WHERE id = $1 FOR UPDATE`,
            [principal.id],
          )
        ).rows[0];
        if (!locked) {
          throw new ApiError(403, "CAPIR_TEST_PRINCIPAL_INACTIVE", "This provisioning principal is no longer active.");
        }
        // The locked principal must be exactly the authority admitted at
        // request time: a rotation or revocation between authentication and
        // this lock must not create an unusable but `ready` run.
        if (
          locked.state !== "enabled" ||
          locked.id !== principal.id ||
          locked.generation !== principal.generation ||
          locked.web_origin !== principal.webOrigin ||
          locked.backend_origin !== principal.backendOrigin
        ) {
          throw new ApiError(
            403,
            "CAPIR_TEST_PRINCIPAL_INACTIVE",
            "This provisioning principal changed while the request was being processed.",
          );
        }
        const previous = (
          await client.query<RunRow>(
            `SELECT ${RUN_COLUMNS} ${RUN_FROM}
              WHERE r.principal_id = $1 AND r.request_id = $2`,
            [principal.id, request.request_id],
          )
        ).rows[0];
        if (previous) return;
        const active = Number(
          (
            await client.query<{ count: string }>(
              `SELECT count(*) AS count FROM capir_test_runs r
                 JOIN lab_test_workspaces w ON w.id = r.workspace_id
                WHERE r.principal_id = $1 AND w.state <> 'deleted'`,
              [principal.id],
            )
          ).rows[0]!.count,
        );
        if (active >= (locked.max_active_runs ?? principal.maxActiveRuns)) {
          throw new ApiError(
            409,
            "CAPIR_TEST_QUOTA_EXCEEDED",
            "End and clean an existing test run before creating another.",
          );
        }
        // The exact identity lock used by account identity reservation: a
        // supplied handle is compared with existing login usernames and
        // primary emails under the actual login normalizer, so an allocation
        // can never add a second identifier match that breaks an existing
        // user's login.
        const identifiers = [...new Set([handle.trim().toLowerCase(), email.trim().toLowerCase()])].sort();
        for (const identifier of identifiers) {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
            `account-email:${identifier}`,
          ]);
          const collision = await client.query(
            `SELECT 1 FROM users WHERE lower(username) = $1 OR lower(btrim(email)) = $1 LIMIT 1`,
            [identifier],
          );
          if (collision.rows[0]) {
            throw new ApiError(
              409,
              "CAPIR_TEST_USERNAME_TAKEN",
              "An account already uses that username or email.",
            );
          }
        }
        const accountId = randomUUID();
        const userId = randomUUID();
        await client.query("INSERT INTO accounts(id, slug, name) VALUES ($1, $2, $3)", [
          accountId,
          `lab-${runId}`,
          `Test workspace · ${runId.slice(0, 8)}`,
        ]);
        await client.query(
          `INSERT INTO users(id, account_id, email, display_name, kind, username, onboarding_status)
           VALUES ($1, $2, $3, 'Test user', 'lab_human', $4, 'skipped')`,
          [userId, accountId, email, handle],
        );
        await client.query(
          `INSERT INTO lab_test_workspaces(
             id, owner_account_id, owner_user_id, owner_principal_id,
             target_account_id, target_user_id, duration_hours, expires_at, media_scope_hash
           ) VALUES ($1, NULL, NULL, $2, $3, $4, $5::integer, now() + $5::integer * interval '1 hour', $6)`,
          [runId, principal.id, accountId, userId, request.duration_hours, this.storage.labScopeID],
        );
        const emptyBaseline = (
          await client.query("SELECT 1 FROM harness_source_generations WHERE account_id=$1 AND generation=0", [accountId])
        ).rowCount;
        const tables = await this.labWorkspaces.tables(client);
        if (emptyBaseline !== 1 || (await this.labWorkspaces.dataRows(client, accountId, tables)) !== 1) {
          throw new ApiError(409, "CAPIR_TEST_RUN_NOT_EMPTY", "The new test account did not verify as empty.");
        }
        await client.query(
          `INSERT INTO password_credentials(account_id, user_id, password_scrypt)
           VALUES ($1, $2, $3)`,
          [accountId, userId, await encodePasswordCredential(request.password)],
        );
        const targetAuth: AuthContext = {
          accountId,
          accountSlug: `lab-${runId}`,
          userId,
          userEmail: email,
          userKind: "lab_human",
          sessionId: randomUUID(),
        };
        await loadCapirTestScenario(client, targetAuth, request.preset);
        const counts = await verifyCapirTestScenario(client, accountId, request.preset);
        await client.query(
          `INSERT INTO capir_test_runs(
             id, request_id, principal_id, principal_generation, workspace_id,
             account_id, user_id, username, requested_username, email, preset, preset_version,
             preset_digest, counts, web_origin, backend_origin
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16)`,
          [
            runId,
            request.request_id,
            principal.id,
            principal.generation,
            runId,
            accountId,
            userId,
            handle,
            requestedUsernameIntent(request.username),
            email,
            request.preset,
            preset.version,
            preset.digest,
            JSON.stringify(counts),
            principal.webOrigin,
            principal.backendOrigin,
          ],
        );
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        // The request ID already owns an allocation: never allocate twice.
        return this.replay(principal, request);
      }
      throw error;
    }
    return this.replay(principal, request);
  }

  /**
   * Exact-request recovery. The stored scrypt credential is verified against
   * the submitted password; an opaque identity match or a fresh salted-hash
   * equality is never sufficient, and a different password is a semantic
   * conflict that never rotates the previous credential.
   */
  private async replay(principal: CapirTestPrincipal, request: CapirTestCreateRequest): Promise<CapirTestRun> {
    return inTransaction(this.pool, async (client) => {
      const row = (
        await client.query<RunRow>(
          `SELECT ${RUN_COLUMNS} ${RUN_FROM}
            WHERE r.principal_id = $1 AND r.request_id = $2`,
          [principal.id, request.request_id],
        )
      ).rows[0];
      if (!row) {
        throw new ApiError(409, "CAPIR_TEST_REQUEST_CONFLICT", "This request ID already belongs to a different test-run operation.");
      }
      // The same account's stop/admission lock order also governs replay.
      // Keep authority and the operation stable throughout async scrypt work.
      await lockLabRunForAdmission(client, this.config, {
        accountId: row.account_id, userId: row.user_id,
        accountName: `Test workspace · ${row.workspace_id.slice(0, 8)}`,
        accountSlug: `lab-${row.workspace_id}`, displayName: "Test user",
        role: "member", userEmail: row.email, userKind: "lab_human", username: row.username,
      });
      await client.query("SELECT id FROM capir_test_runs WHERE id=$1 FOR UPDATE", [row.id]);
      const credential = (
        await client.query<{ password_scrypt: string }>(
          "SELECT password_scrypt FROM password_credentials WHERE account_id=$1 AND user_id=$2 FOR UPDATE",
          [row.account_id, row.user_id],
        )
      ).rows[0];
      const passwordMatches = credential
        ? await verifyPasswordCredential(request.password, credential.password_scrypt)
        : false;
      // The exact original intent decides replay: an omitted username must be
      // omitted again, and any added, removed or changed username argument is
      // a semantic conflict. Preset, lifetime and origins stay exact too.
      const semanticMatch =
        row.requested_username === requestedUsernameIntent(request.username) &&
        row.preset === request.preset &&
        row.duration_hours === request.duration_hours &&
        row.web_origin === request.web_origin;
      if (!passwordMatches || !semanticMatch) {
        throw new ApiError(
          409,
          "CAPIR_TEST_REQUEST_CONFLICT",
          "This request ID already belongs to different test-run parameters.",
        );
      }
      return describeRun(row);
    });
  }

  async stop(principal: CapirTestPrincipal, id: string, request: CapirTestStopRequest): Promise<CapirTestRun> {
    this.requireEnabled();
    this.assertPrincipalActive(principal);
    const run = await this.ownedRun(this.pool, principal, id);
    // Access is revoked before verified cleanup; local deletion and pending
    // external broker effects remain distinct in the run readback.
    await this.labWorkspaces.stopOperatorRun(run.workspace_id, request.request_id);
    return this.status(principal, id);
  }

  /**
   * Canonical run readback for a live operator-owned test session (the direct
   * password and private handoff banner source). The shared Lab authority
   * predicate has already admitted this session; the run must target exactly
   * this account/user and own this session's Lab entry.
   */
  async currentRun(auth: AuthContext): Promise<CapirTestRun> {
    this.requireEnabled();
    if (auth.userKind !== "lab_human") {
      throw new ApiError(404, "CAPIR_TEST_RUN_NOT_FOUND", "This session is not an operator-provisioned test identity.");
    }
    const row = (
      await this.pool.query<RunRow>(
        `SELECT ${RUN_COLUMNS} ${RUN_FROM}
          WHERE r.account_id = $1 AND r.user_id = $2
            AND EXISTS (
              SELECT 1 FROM lab_test_workspace_entries e
               WHERE e.workspace_id = w.id AND e.session_id = $3
                 AND e.owner_principal_id = r.principal_id
                 AND e.principal_generation = r.principal_generation
                 AND e.revoked_at IS NULL AND e.expires_at > clock_timestamp())`,
        [auth.accountId, auth.userId, auth.sessionId],
      )
    ).rows[0];
    if (!row) {
      throw new ApiError(404, "CAPIR_TEST_RUN_NOT_FOUND", "This test run is not available to this session.");
    }
    return describeRun(row);
  }

  private resolveHandle(username: string | undefined, runId: string): string {
    if (username === undefined) return `qa-${runId.slice(0, 8)}`;
    const trimmed = username.trim();
    if (HANDLE_PATTERN.test(trimmed)) return trimmed.toLowerCase();
    if (EMAIL_SHAPE.test(trimmed)) {
      const normalized = trimmed.toLowerCase();
      if (!normalized.endsWith(LAB_EMAIL_DOMAIN)) {
        throw new ApiError(
          400,
          "CAPIR_TEST_USERNAME_EMAIL_DOMAIN_INVALID",
          "Email-shaped test usernames are accepted only in the reserved lab.invalid namespace.",
        );
      }
      return normalized;
    }
    throw new ApiError(
      400,
      "CAPIR_TEST_USERNAME_INVALID",
      "The test username must be a valid handle or a lab.invalid address.",
    );
  }


  /**
   * One-use Web handoff. The plaintext secret is disclosed exactly once to the
   * authenticated provisioning caller and never appears in a URL, log or
   * readback; only its hash is stored.
   */
  async createHandoff(
    principal: CapirTestPrincipal,
    id: string,
    request: CapirTestHandoffRequest,
  ): Promise<CapirTestHandoffResponse> {
    this.requireEnabled();
    if (!this.webHandoffAvailable) {
      throw new ApiError(403, "CAPIR_TESTS_DISABLED", "Private Web handoff is not configured on this service.");
    }
    this.assertPrincipalActive(principal);
    const secret = randomBytes(32).toString("base64url");
    const handoffId = randomUUID();
    return inTransaction(this.pool, async (client) => {
      const run = await this.ownedRun(client, principal, id);
      if (runState(run) !== "ready") {
        throw new ApiError(410, "LAB_TEST_WORKSPACE_CLOSED", "This test workspace is closed or being cleaned up.");
      }
      const previous = (
        await client.query(
          "SELECT 1 FROM capir_test_handoffs WHERE run_id = $1 AND request_id = $2",
          [run.id, request.request_id],
        )
      ).rows[0];
      if (previous) {
        // A one-use secret cannot be re-disclosed; recovery starts a new
        // handoff request instead of overwriting or replaying this one.
        throw new ApiError(
          409,
          "CAPIR_TEST_HANDOFF_CONFLICT",
          "This request ID already belongs to a one-use handoff. Start a new handoff request.",
        );
      }
      const expiresAt = new Date(
        Math.min(run.workspace_expires_at.getTime(), Date.now() + HANDOFF_TTL_MS),
      );
      await client.query(
        `INSERT INTO capir_test_handoffs(
           id, request_id, run_id, account_id, user_id, secret_hash,
           web_origin, backend_origin, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          handoffId,
          request.request_id,
          run.id,
          run.account_id,
          run.user_id,
          sha256(secret),
          run.web_origin,
          run.backend_origin,
          expiresAt,
        ],
      );
      return {
        schema_version: CAPIR_TEST_SCHEMA_VERSION,
        handoff_id: handoffId,
        handoff_secret: secret,
        expires_at: expiresAt.toISOString(),
        entry_path: CAPIR_TEST_ENTRY_PATH,
        run_id: run.id,
      };
    });
  }

  /**
   * Private Web-consumer exchange (verified trusted consumer key). Consumes
   * the one-use secret and installs only the target test session, with the
   * same lineage/expiry recheck as direct password admission.
   */
  async exchangeHandoff(request: CapirTestHandoffExchangeRequest): Promise<CapirTestHandoffExchangeResponse> {
    this.requireEnabled();
    if (!this.webHandoffAvailable) {
      throw new ApiError(403, "CAPIR_TESTS_DISABLED", "Private Web handoff is not configured on this service.");
    }
    return inTransaction(this.pool, async (client) => {
      // Lock order matches stop and password admission: the one-use consume
      // updates the handoff row only after the workspace row is locked, so the
      // verified cleanup wipe cannot deadlock with a live exchange.
      const row = (
        await client.query<{
          id: string; web_origin: string; backend_origin: string; consumed_at: Date | null; expires_at: Date;
          run_id: string; account_id: string; user_id: string; username: string; email: string;
          principal_generation: number; workspace_id: string;
          workspace_state: "active" | "deleting" | "deleted";
          principal_state: "enabled" | "revoked" | null;
          principal_generation_current: number | null;
          principal_web_origin: string | null; principal_backend_origin: string | null;
        }>(
          `SELECT h.id, h.web_origin, h.backend_origin, h.consumed_at, h.expires_at,
                  r.id AS run_id, r.account_id, r.user_id, r.username, r.email,
                  r.principal_generation, r.workspace_id,
                  w.state AS workspace_state,
                  p.state AS principal_state, p.generation AS principal_generation_current,
                  p.web_origin AS principal_web_origin, p.backend_origin AS principal_backend_origin
             FROM capir_test_handoffs h
             JOIN capir_test_runs r ON r.id = h.run_id
             JOIN lab_test_workspaces w ON w.id = r.workspace_id
             JOIN capir_test_provisioners p ON p.id = r.principal_id
            WHERE h.secret_hash = $1`,
          [sha256(request.handoff_secret)],
        )
      ).rows[0];
      if (!row) {
        throw new ApiError(404, "CAPIR_TEST_HANDOFF_INVALID", "This handoff is not available.");
      }
      if (row.consumed_at !== null || row.expires_at.getTime() <= Date.now()) {
        throw new ApiError(409, "CAPIR_TEST_HANDOFF_CONSUMED", "This one-use handoff has already been exchanged.");
      }
      if (
        request.web_origin !== row.web_origin ||
        row.web_origin !== this.config.capirTests?.webOrigin ||
        row.backend_origin !== this.config.capirTests?.backendOrigin
      ) {
        throw new ApiError(403, "CAPIR_TEST_ORIGIN_DENIED", "This handoff is bound to an exact origin.");
      }
      const principalActive =
        row.principal_state === "enabled" &&
        row.principal_generation_current === row.principal_generation &&
        row.principal_web_origin === row.web_origin &&
        row.principal_backend_origin === row.backend_origin;
      if (!principalActive) {
        throw new ApiError(403, "CAPIR_TEST_PRINCIPAL_INACTIVE", "This test run's provisioning principal is no longer active.");
      }
      const session = await admitLabPasswordSession(
        client,
        this.config,
        {
          accountId: row.account_id,
          accountName: `Test workspace · ${row.workspace_id.slice(0, 8)}`,
          accountSlug: `lab-${row.workspace_id}`,
          displayName: "Test user",
          role: "member",
          userEmail: row.email,
          userId: row.user_id,
          userKind: "lab_human",
          username: row.username,
        },
        "capir-test-web",
      );
      const consumed = (
        await client.query(
          `UPDATE capir_test_handoffs SET consumed_at = now()
            WHERE id = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING id`,
          [row.id],
        )
      ).rowCount;
      if (consumed !== 1) {
        throw new ApiError(409, "CAPIR_TEST_HANDOFF_CONSUMED", "This one-use handoff has already been exchanged.");
      }
      return {
        schema_version: CAPIR_TEST_SCHEMA_VERSION,
        session,
        entry_path: CAPIR_TEST_ENTRY_PATH,
        run_id: row.run_id,
      };
    });
  }
}
