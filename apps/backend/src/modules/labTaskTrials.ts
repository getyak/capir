import { createHash, randomUUID } from "node:crypto";
import type { LabTaskTrial, LabTaskTrialRequest, LabTrialObservation, LabTrialObservationPlan,
  LabTrialSummary } from "@talent-signal/contracts";
import type { Pool } from "pg";
import { inTransaction, type DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { retainsRenewableSessionReplaySQL } from "./sessionReplayRetention.js";
import { type RemoteChatAnswerProviding } from "./chatAnswerProvider.js";
import { taskModelCatalog, taskPromptRevision, trialProvider, type LabTaskKind, type TrialRunMeasurement } from "./labTaskConfiguration.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scope = (auth: AuthContext) => [auth.accountId, auth.userId, auth.sessionId];
const allowedDurations = [5, 15, 30, 60] as const;

function defaultPlan(duration: number): LabTrialObservationPlan {
  const window = allowedDurations.includes(duration as (typeof allowedDurations)[number]) ? duration : 15;
  return { question: "Does this configuration complete normal product tasks without fallback?",
    success_metric: "product_adoption", guardrail_metric: "fallback_or_product_failure",
    minimum_samples: 5, stop_after_adverse_outcomes: 1, sample_unit: "unique_product_request",
    assignment_mode: "current_authenticated_session_opt_in", rollback: "task_default",
    window_minutes: window as LabTrialObservationPlan["window_minutes"] };
}

function normalizeTrial(value: LabTaskTrial): LabTaskTrial {
  const legacy = value as LabTaskTrial & { observation_plan?: LabTrialObservationPlan; stop_reason?: LabTaskTrial["stop_reason"] };
  return { ...value, observation_plan: legacy.observation_plan ?? defaultPlan(
    Math.max(5, Math.round((Date.parse(value.expires_at)-Date.parse(value.created_at))/60_000))),
  stop_reason: legacy.stop_reason ?? (value.status === "expired" ? "expired" : value.status === "stopped" ? "unknown" : null) };
}

export class LabTaskTrialService {
  constructor(private readonly pool: Pool,
    readonly providers: Map<string, RemoteChatAnswerProviding>,
    readonly defaultProvider: RemoteChatAnswerProviding | null,
    readonly backendRevision: string | null) {}

  sessionScope(auth: AuthContext): string { return hash(auth.sessionId); }

  taskContext(auth: AuthContext, task: LabTaskKind, requestIdentity: string) {
    const values: Array<{ trial: LabTaskTrial; measurement: TrialRunMeasurement }> = [];
    return {
      select: (client: DatabaseClient) => this.resolveProvider(client, auth, task, (trial, measurement) => { values.push({ trial, measurement }); }),
      finish: (outcome: LabTrialObservation["product_outcome"] = "unverified") => values.length > 0
        ? this.recordMeasurements(auth, requestIdentity, values, outcome) : Promise.resolve(null),
    };
  }

  get tasks() {
    const catalog = taskModelCatalog(this.providers.values());
    return (["relationship_text", "relationship_image", "unscoped_chat"] as const).map((id) => ({
      id, models: catalog.filter((entry) => entry.task === id).map((entry) => ({ id: entry.model, prompt_presets: entry.promptPresets })),
      default_model: id === "relationship_image" ? this.defaultProvider?.imageModel ?? null : this.defaultProvider?.model ?? null,
    }));
  }

  private async expire(client: DatabaseClient, auth: AuthContext) {
    await client.query(`UPDATE lab_task_trials SET status='expired',
      record=jsonb_set(jsonb_set(record,'{status}','"expired"'),'{stop_reason}','"expired"')
      WHERE account_id=$1 AND user_id=$2 AND auth_session_id=$3 AND status='active' AND expires_at <= now()`, scope(auth));
  }

  async list(auth: AuthContext): Promise<{ trials: LabTaskTrial[]; observations: LabTrialObservation[];
    summaries: LabTrialSummary[] }> {
    await this.expire(this.pool, auth);
    const trials = await this.pool.query<{ record: LabTaskTrial }>(
      `SELECT record FROM lab_task_trials WHERE account_id=$1 AND user_id=$2 AND auth_session_id=$3
       ORDER BY (status='active') DESC, created_at DESC LIMIT 12`, scope(auth));
    const observations = await this.pool.query<{ record: LabTrialObservation }>(
      `SELECT o.record FROM lab_trial_observations o JOIN lab_task_trials t
       ON t.account_id=o.account_id AND t.user_id=o.user_id AND t.id=o.trial_id
       WHERE t.account_id=$1 AND t.user_id=$2 AND t.auth_session_id=$3
       AND o.created_at > now()-interval '7 days' ORDER BY o.created_at DESC LIMIT 30`, scope(auth));
    const records = trials.rows.map((x) => normalizeTrial(x.record));
    const all = records.length === 0 ? [] : (await this.pool.query<{ record: LabTrialObservation }>(
      `SELECT record FROM lab_trial_observations WHERE account_id=$1 AND user_id=$2 AND trial_id=ANY($3::uuid[])`,
      [auth.accountId, auth.userId, records.map((x) => x.id)])).rows.map((x) => x.record);
    const summaries = records.map((trial) => this.summary(trial, all.filter((x) => x.trial_id === trial.id)));
    return { trials: records, observations: observations.rows.map((x) => x.record), summaries };
  }

  async start(auth: AuthContext, request: LabTaskTrialRequest): Promise<LabTaskTrial> {
    const plan = request.observation_plan ?? defaultPlan(request.duration_minutes);
    if (plan.window_minutes !== request.duration_minutes) {
      throw new ApiError(422, "LAB_TRIAL_WINDOW_MISMATCH", "The observation window must match this session trial's expiry.");
    }
    const requestHash = hash({ task: request.task, model: request.model, prompt_preset: request.prompt_preset,
      duration_minutes: request.duration_minutes, replaces_trial_id: request.replaces_trial_id, observation_plan: plan });
    return inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`lab-trial:${scope(auth).join(":")}:${request.task}`]);
      await this.expire(client, auth);
      const prior = await client.query<{ record: LabTaskTrial; request_hash: string; auth_session_id: string }>(
        `SELECT record,request_hash,auth_session_id FROM lab_task_trials WHERE account_id=$1 AND user_id=$2 AND id=$3`,
        [auth.accountId, auth.userId, request.id]);
      if (prior.rows[0]) {
        if (prior.rows[0].auth_session_id !== auth.sessionId || prior.rows[0].request_hash !== requestHash) {
          throw new ApiError(409, "LAB_TRIAL_ID_CONFLICT", "This trial ID belongs to a different session or configuration.");
        }
        return prior.rows[0].record; // Stopped and expired IDs never reactivate on retry.
      }
      const entry = taskModelCatalog(this.providers.values()).find((x) => x.task === request.task && x.model === request.model);
      if (!entry || !entry.promptPresets.includes(request.prompt_preset)) {
        throw new ApiError(422, "LAB_TASK_CONFIGURATION_UNAVAILABLE", "Choose an admitted model and preset for this task.");
      }
      const active = await client.query<{ id: string }>(
        `SELECT id FROM lab_task_trials WHERE account_id=$1 AND user_id=$2 AND auth_session_id=$3 AND task=$4 AND status='active'`,
        [...scope(auth), request.task]);
      if ((active.rows[0]?.id ?? null) !== request.replaces_trial_id) {
        throw new ApiError(409, "LAB_TRIAL_STALE", "The active trial changed. Refresh before replacing it.");
      }
      const session = await client.query<{ expires_at: Date }>(
        `SELECT expires_at FROM sessions WHERE account_id=$1 AND user_id=$2 AND id=$3 AND revoked_at IS NULL AND expires_at > now()`, scope(auth));
      if (!session.rows[0]) throw new ApiError(401, "SESSION_EXPIRED", "Sign in again before starting a trial.");
      const now = new Date();
      const expiresAt = new Date(Math.min(+now + request.duration_minutes * 60_000, +session.rows[0].expires_at));
      const record: LabTaskTrial = { session_scope_id: this.sessionScope(auth), id: request.id, task: request.task, model: request.model,
        prompt_preset: request.prompt_preset,
        prompt_revision: taskPromptRevision(entry, request.prompt_preset),
        backend_revision: this.backendRevision, status: "active", created_at: now.toISOString(), expires_at: expiresAt.toISOString(),
        scope: "this_authenticated_session", online_assignment: false, observation_plan: plan, stop_reason: null };
      if (active.rows[0]) await client.query(`UPDATE lab_task_trials SET status='stopped',
        record=jsonb_set(jsonb_set(record,'{status}','"stopped"'),'{stop_reason}','"replaced"')
        WHERE account_id=$1 AND user_id=$2 AND id=$3`, [auth.accountId, auth.userId, active.rows[0].id]);
      await client.query(`INSERT INTO lab_task_trials(id,account_id,user_id,auth_session_id,task,request_hash,record,status,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'active',$8,$9)`,
      [record.id, ...scope(auth), record.task, requestHash, JSON.stringify(record), record.created_at, record.expires_at]);
      return record;
    });
  }

  async read(auth: AuthContext, id: string): Promise<LabTaskTrial> {
    await this.expire(this.pool, auth);
    const result = await this.pool.query<{ record: LabTaskTrial }>(
      `SELECT record FROM lab_task_trials WHERE account_id=$1 AND user_id=$2 AND auth_session_id=$3 AND id=$4`, [...scope(auth), id]);
    if (!result.rows[0]) throw new ApiError(404, "LAB_TRIAL_NOT_FOUND", "This session's trial was not found.");
    return normalizeTrial(result.rows[0].record);
  }

  async stop(auth: AuthContext, id: string): Promise<LabTaskTrial> {
    await this.expire(this.pool, auth);
    const result = await this.pool.query<{ record: LabTaskTrial }>(
      `UPDATE lab_task_trials SET status=CASE WHEN status='active' THEN 'stopped' ELSE status END,
       record=CASE WHEN status='active' THEN jsonb_set(jsonb_set(record,'{status}','"stopped"'),'{stop_reason}','"manual"') ELSE record END
       WHERE account_id=$1 AND user_id=$2 AND auth_session_id=$3 AND id=$4 RETURNING record`, [...scope(auth), id]);
    if (!result.rows[0]) throw new ApiError(404, "LAB_TRIAL_NOT_FOUND", "This session's trial was not found.");
    return normalizeTrial(result.rows[0].record);
  }

  /** Called only after the product's idempotency replay check, using its existing transaction connection. */
  async resolveProvider(client: DatabaseClient, auth: AuthContext, task: LabTaskKind,
    measured: (trial: LabTaskTrial, value: TrialRunMeasurement) => void): Promise<RemoteChatAnswerProviding | null> {
    const result = await client.query<{ record: LabTaskTrial }>(
      `SELECT record FROM lab_task_trials WHERE account_id=$1 AND user_id=$2 AND auth_session_id=$3
       AND task=$4 AND status='active' AND expires_at > now()`, [...scope(auth), task]);
    const record = result.rows[0]?.record ? normalizeTrial(result.rows[0].record) : undefined;
    if (!record) return this.defaultProvider;
    const entry = taskModelCatalog(this.providers.values()).find((x) => x.task === task && x.model === record.model);
    const revision = entry ? taskPromptRevision(entry, record.prompt_preset) : null;
    if (!entry || revision !== record.prompt_revision || record.backend_revision !== this.backendRevision) {
      throw new ApiError(409, "LAB_TRIAL_CONFIGURATION_CHANGED", "The trial configuration changed. Stop it or create a new verified trial.");
    }
    return trialProvider(entry, record.prompt_preset, (value) => measured(record, value));
  }

  /** Runs after the product transaction has released its connection. Contains no objective, evidence, or output. */
  async recordMeasurements(auth: AuthContext, requestIdentity: string,
    values: Array<{ trial: LabTaskTrial; measurement: TrialRunMeasurement }>,
    productOutcome: LabTrialObservation["product_outcome"] = "unverified"): Promise<boolean> {
    try {
      for (const [index, value] of values.entries()) {
        const record: LabTrialObservation = { id: randomUUID(), trial_id: value.trial.id, task: value.trial.task,
          observed_at: new Date().toISOString(), measurement: value.measurement, product_outcome: productOutcome };
        const inserted = await this.pool.query(`INSERT INTO lab_trial_observations(id,account_id,user_id,trial_id,request_fingerprint,record)
          VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(account_id,user_id,trial_id,request_fingerprint) DO NOTHING RETURNING id`,
        [record.id, auth.accountId, auth.userId, record.trial_id, hash([requestIdentity, index]), JSON.stringify(record)]);
        if (inserted.rowCount) {
          const adverse = Number((await this.pool.query<{ count: string }>(`SELECT count(*)::text AS count
            FROM lab_trial_observations WHERE account_id=$1 AND user_id=$2 AND trial_id=$3
            AND record->>'product_outcome' IN ('fallback','product_failed')`,
          [auth.accountId, auth.userId, record.trial_id])).rows[0]?.count ?? 0);
          if (adverse >= value.trial.observation_plan.stop_after_adverse_outcomes) {
            await this.pool.query(`UPDATE lab_task_trials SET status='stopped',
              record=jsonb_set(jsonb_set(record,'{status}','"stopped"'),'{stop_reason}','"guardrail"')
              WHERE account_id=$1 AND user_id=$2 AND id=$3 AND status='active'`,
            [auth.accountId, auth.userId, record.trial_id]);
          }
        }
        await this.pool.query(`DELETE FROM lab_trial_observations WHERE id IN
          (SELECT id FROM lab_trial_observations WHERE account_id=$1 AND user_id=$2 AND trial_id=$3
           ORDER BY created_at DESC OFFSET 100)`, [auth.accountId, auth.userId, record.trial_id]);
      }
      return true;
    } catch { return false; } // Measurement failure must not turn a completed product write into a failed request.
  }

  async scrubExpired(): Promise<void> {
    await this.pool.query("DELETE FROM lab_trial_observations WHERE created_at < now()-interval '7 days'");
    // Retain configuration ID tombstones while their authenticated session can still replay them.
    await this.pool.query(`DELETE FROM lab_task_trials t USING sessions s
      WHERE t.auth_session_id=s.id AND COALESCE(s.revoked_at,s.expires_at) < now()-interval '7 days'
        AND NOT ${retainsRenewableSessionReplaySQL}`);
  }

  private summary(trial: LabTaskTrial, observations: LabTrialObservation[]): LabTrialSummary {
    const count = (outcome: string) => observations.filter((x) => (x.product_outcome ?? "unverified") === outcome).length;
    const accepted=count("accepted"), fallback=count("fallback"), productFailed=count("product_failed"), unverified=count("unverified");
    const evidence: LabTrialSummary["evidence_state"] = trial.stop_reason === "guardrail" ? "guardrail_stopped"
      : observations.length >= trial.observation_plan.minimum_samples && unverified > 0 ? "outcomes_incomplete"
      : observations.length >= trial.observation_plan.minimum_samples ? "minimum_reached"
      : trial.status === "active" ? "collecting" : "ended_below_minimum";
    return { trial_id: trial.id, samples: observations.length, accepted, fallback, product_failed: productFailed,
      unverified, remote_executions: observations.filter((x) => x.measurement.execution === "remote").length,
      local_executions: observations.filter((x) => x.measurement.execution === "local_only").length,
      evidence_state: evidence, causal_claim_allowed: false };
  }
}
