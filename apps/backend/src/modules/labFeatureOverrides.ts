import { createHash } from "node:crypto";
import type {
  LabFeatureAdoptionReceipt,
  LabFeatureCatalogEntry,
  LabFeatureConfiguration,
  LabFeatureOverride,
  LabFeatureOverrideRequest,
} from "@talent-signal/contracts";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import type { Pool } from "pg";
import { inTransaction, type DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { retainsRenewableSessionReplaySQL } from "./sessionReplayRetention.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scope = (auth: AuthContext) => [auth.accountId, auth.userId, auth.sessionId];

const FEATURES: LabFeatureCatalogEntry[] = [{
  id: "relationship_evidence_preview",
  name: "Relationship evidence preview",
  summary: "Show each already-authorized exact citation excerpt directly beneath its source.",
  definition_revision: "relationship-evidence-preview/1",
  server_value: "source_only",
  allowed_values: ["source_only", "inline_excerpt"],
  dependency: "relationship_text_citations",
  safety_boundary: "Presentation only. Evidence review, authorization, provenance, source opening, and action authority remain required.",
}];
const CATALOG_REVISION = `lab-features/${hash(FEATURES).slice(0, 16)}`;

export class LabFeatureOverrideService {
  readonly catalogRevision = CATALOG_REVISION;
  readonly features = FEATURES;

  constructor(private readonly pool: Pool, readonly backendRevision: string | null) {}

  sessionScope(auth: AuthContext): string { return hash(auth.sessionId); }

  private async expire(client: DatabaseClient, auth: AuthContext): Promise<void> {
    await client.query(`UPDATE lab_feature_overrides SET status='expired',
      record=jsonb_set(jsonb_set(record,'{status}','"expired"'),'{stop_reason}','"expired"')
      WHERE account_id=$1 AND user_id=$2 AND auth_session_id=$3
      AND status='active' AND expires_at <= now()`, scope(auth));
    await client.query(`UPDATE lab_feature_overrides SET status='stopped',
      record=jsonb_set(jsonb_set(record,'{status}','"stopped"'),'{stop_reason}','"configuration_changed"')
      WHERE account_id=$1 AND user_id=$2 AND auth_session_id=$3 AND status='active'
      AND (record->>'catalog_revision' <> $4 OR record->>'backend_revision' IS DISTINCT FROM $5::text)`,
    [...scope(auth), this.catalogRevision, this.backendRevision]);
  }

  async configuration(auth: AuthContext, enabled = true): Promise<LabFeatureConfiguration> {
    await this.expire(this.pool, auth);
    const result = await this.pool.query<{ record: LabFeatureOverride }>(
      `SELECT record FROM lab_feature_overrides
       WHERE account_id=$1 AND user_id=$2 AND auth_session_id=$3
       ORDER BY (status='active') DESC, created_at DESC LIMIT 12`, scope(auth));
    return { contract_version: CONTRACT_VERSION, session_scope_id: this.sessionScope(auth), enabled,
      backend_revision: this.backendRevision, catalog_revision: this.catalogRevision,
      features: this.features, overrides: result.rows.map((row) => row.record) };
  }

  async start(auth: AuthContext, request: LabFeatureOverrideRequest): Promise<LabFeatureOverride> {
    const feature = this.features.find((entry) => entry.id === request.feature_id);
    if (!feature || !feature.allowed_values.includes(request.value)) {
      throw new ApiError(422, "LAB_FEATURE_UNAVAILABLE", "Choose an admitted feature value from the current catalog.");
    }
    if (request.value === feature.server_value) {
      throw new ApiError(422, "LAB_FEATURE_OVERRIDE_REDUNDANT", "Return to the server value by stopping the active override.");
    }
    const requestHash = hash({ feature_id: request.feature_id, value: request.value,
      duration_minutes: request.duration_minutes, replaces_override_id: request.replaces_override_id,
      catalog_revision: this.catalogRevision, definition_revision: feature.definition_revision,
      backend_revision: this.backendRevision });
    return inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",
        [`lab-feature:${scope(auth).join(":")}:${request.feature_id}`]);
      await this.expire(client, auth);
      const prior = await client.query<{ record: LabFeatureOverride; request_hash: string; auth_session_id: string }>(
        `SELECT record,request_hash,auth_session_id FROM lab_feature_overrides
         WHERE account_id=$1 AND user_id=$2 AND id=$3`, [auth.accountId, auth.userId, request.id]);
      if (prior.rows[0]) {
        if (prior.rows[0].auth_session_id !== auth.sessionId || prior.rows[0].request_hash !== requestHash) {
          throw new ApiError(409, "LAB_FEATURE_OVERRIDE_ID_CONFLICT", "This override ID belongs to a different session or configuration.");
        }
        return prior.rows[0].record;
      }
      const active = await client.query<{ id: string }>(
        `SELECT id FROM lab_feature_overrides WHERE account_id=$1 AND user_id=$2
         AND auth_session_id=$3 AND feature_id=$4 AND status='active'`, [...scope(auth), request.feature_id]);
      if ((active.rows[0]?.id ?? null) !== request.replaces_override_id) {
        throw new ApiError(409, "LAB_FEATURE_OVERRIDE_STALE", "The active override changed. Refresh before replacing it.");
      }
      const session = await client.query<{ expires_at: Date }>(
        `SELECT expires_at FROM sessions WHERE account_id=$1 AND user_id=$2 AND id=$3
         AND revoked_at IS NULL AND expires_at > now()`, scope(auth));
      if (!session.rows[0]) throw new ApiError(401, "SESSION_EXPIRED", "Sign in again before starting an override.");
      const now = new Date();
      const expiresAt = new Date(Math.min(+now + request.duration_minutes * 60_000, +session.rows[0].expires_at));
      const record: LabFeatureOverride = {
        session_scope_id: this.sessionScope(auth), id: request.id, feature_id: request.feature_id,
        server_value: feature.server_value, override_value: request.value, effective_value: request.value,
        catalog_revision: this.catalogRevision, definition_revision: feature.definition_revision,
        backend_revision: this.backendRevision, status: "active", created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(), scope: "this_authenticated_session", stop_reason: null,
      };
      if (active.rows[0]) await client.query(`UPDATE lab_feature_overrides SET status='stopped',
        record=jsonb_set(jsonb_set(record,'{status}','"stopped"'),'{stop_reason}','"replaced"')
        WHERE account_id=$1 AND user_id=$2 AND id=$3`, [auth.accountId, auth.userId, active.rows[0].id]);
      await client.query(`INSERT INTO lab_feature_overrides(
        id,account_id,user_id,auth_session_id,feature_id,request_hash,record,status,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'active',$8,$9)`,
      [record.id, ...scope(auth), record.feature_id, requestHash, JSON.stringify(record), record.created_at, record.expires_at]);
      return record;
    });
  }

  async read(auth: AuthContext, id: string): Promise<LabFeatureOverride> {
    await this.expire(this.pool, auth);
    const result = await this.pool.query<{ record: LabFeatureOverride }>(
      `SELECT record FROM lab_feature_overrides WHERE account_id=$1 AND user_id=$2
       AND auth_session_id=$3 AND id=$4`, [...scope(auth), id]);
    if (!result.rows[0]) throw new ApiError(404, "LAB_FEATURE_OVERRIDE_NOT_FOUND", "This session's feature override was not found.");
    return result.rows[0].record;
  }

  async stop(auth: AuthContext, id: string): Promise<LabFeatureOverride> {
    await this.expire(this.pool, auth);
    const result = await this.pool.query<{ record: LabFeatureOverride }>(
      `UPDATE lab_feature_overrides SET status=CASE WHEN status='active' THEN 'stopped' ELSE status END,
       record=CASE WHEN status='active' THEN jsonb_set(jsonb_set(record,'{status}','"stopped"'),'{stop_reason}','"manual"') ELSE record END
       WHERE account_id=$1 AND user_id=$2 AND auth_session_id=$3 AND id=$4 RETURNING record`, [...scope(auth), id]);
    if (!result.rows[0]) throw new ApiError(404, "LAB_FEATURE_OVERRIDE_NOT_FOUND", "This session's feature override was not found.");
    return result.rows[0].record;
  }

  /** Resolve only inside a new product task transaction, after its idempotency replay check. */
  async adoptionReceipt(client: DatabaseClient, auth: AuthContext): Promise<LabFeatureAdoptionReceipt | null> {
    await this.expire(client, auth);
    const result = await client.query<{ record: LabFeatureOverride }>(
      `SELECT record FROM lab_feature_overrides WHERE account_id=$1 AND user_id=$2
       AND auth_session_id=$3 AND feature_id='relationship_evidence_preview'
       AND status='active' AND expires_at > now()`, scope(auth));
    const record = result.rows[0]?.record;
    if (!record) return null;
    const feature = this.features.find((entry) => entry.id === record.feature_id);
    if (!feature || record.catalog_revision !== this.catalogRevision ||
        record.definition_revision !== feature.definition_revision || record.backend_revision !== this.backendRevision) {
      return null;
    }
    return { override_id: record.id, feature_id: record.feature_id, server_value: record.server_value,
      override_value: record.override_value, effective_value: record.effective_value,
      catalog_revision: record.catalog_revision, definition_revision: record.definition_revision,
      backend_revision: record.backend_revision, scope: record.scope, observed_at: new Date().toISOString() };
  }

  async scrubExpired(): Promise<void> {
    await this.pool.query(`DELETE FROM lab_feature_overrides o USING sessions s
      WHERE o.auth_session_id=s.id AND COALESCE(s.revoked_at,s.expires_at) < now()-interval '7 days'
        AND NOT ${retainsRenewableSessionReplaySQL}`);
  }
}
