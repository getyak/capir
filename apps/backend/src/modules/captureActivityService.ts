import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";
import { ApiError } from "../lib/apiError.js";
import { registerRecurringJob } from "../lib/recurringJob.js";
import { currentSession, type AuthContext } from "./auth.js";
import { assertSessionForChat } from "./agentSessionSources.js";
import { subscribeConversationQueueLive } from "./conversationQueueLive.js";
import { CaptureAPNsProvider, captureActivityPayload, captureActivityPhase, decryptActivityToken,
  encryptActivityToken, readCaptureAPNsConfig, type CaptureAPNsConfig, type CapturePushSending } from "./captureActivity.js";

interface Registration {
  account_id: string; user_id: string; session_id: string; message_id: string;
  activity_instance_id: string; auth_session_id: string; token_ciphertext: string;
  environment: string; last_sent_revision: string; last_phase: string | null; terminal_since: Date | null;
  registration_version: string; token_generation: string; delivery_sequence: string;
  last_sent_at: Date | null; last_dispatched_at: Date | null;
}
const owner = (r: Registration) => [r.account_id, r.user_id, r.session_id, r.activity_instance_id].join(":");
const selector = (r: Registration) => [r.account_id, r.user_id, r.session_id, r.activity_instance_id, r.registration_version];
const WHERE = "account_id=$1 AND user_id=$2 AND session_id=$3 AND activity_instance_id=$4 AND registration_version=$5";

/** A durable, bounded projection. Queue execution never depends on a push. */
export class CaptureActivityService {
  private active: Promise<void> | undefined;
  constructor(private readonly pool: Pool, private readonly config: CaptureAPNsConfig,
    private readonly provider: CapturePushSending = new CaptureAPNsProvider(config)) {}

  async register(auth: AuthContext, sessionID: string, input: {
    message_id: string; activity_instance_id: string; token: string; environment: string; token_generation: number;
  }): Promise<void> {
    await currentSession(this.pool, auth);
    await assertSessionForChat(this.pool, auth, sessionID);
    if (input.environment !== this.config.environment) throw new ApiError(422, "CAPTURE_PUSH_ENVIRONMENT", "The build and push environment do not match.");
    const admitted = await this.pool.query("SELECT id FROM conversation_queue_entries WHERE account_id=$1 AND created_by_user_id=$2 AND session_id=$3 AND message_id=$4",
      [auth.accountId, auth.userId, sessionID, input.message_id]);
    if (!admitted.rowCount) throw new ApiError(404, "CAPTURE_MESSAGE_NOT_ADMITTED", "The original image message has not been admitted.");
    const count = await this.pool.query<{ count: string }>("SELECT count(*) FROM capture_activity_registrations WHERE account_id=$1 AND user_id=$2 AND expires_at>now() AND NOT(session_id=$3 AND activity_instance_id=$4)", [auth.accountId, auth.userId, sessionID, input.activity_instance_id]);
    if (Number(count.rows[0]?.count) >= 32) throw new ApiError(429, "CAPTURE_ACTIVITY_LIMIT", "Too many active capture activities.");
    const binding = [auth.accountId, auth.userId, sessionID, input.activity_instance_id].join(":");
    const encrypted = encryptActivityToken(input.token, this.config.privateKey, binding);
    // Conflict on the opaque token cannot transfer a capability to another owner.
    const stored = await this.pool.query(`INSERT INTO capture_activity_registrations(account_id,user_id,session_id,message_id,activity_instance_id,auth_session_id,token_ciphertext,token_hash,environment,token_generation)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(account_id,user_id,session_id,activity_instance_id) DO UPDATE SET
      token_ciphertext=EXCLUDED.token_ciphertext,token_hash=EXCLUDED.token_hash,auth_session_id=EXCLUDED.auth_session_id,
      next_attempt_at=now(),last_sent_revision=-1,token_generation=EXCLUDED.token_generation,
      registration_version=capture_activity_registrations.registration_version+1
      WHERE capture_activity_registrations.message_id=EXCLUDED.message_id
        AND (EXCLUDED.token_generation>capture_activity_registrations.token_generation OR
          (EXCLUDED.token_generation=capture_activity_registrations.token_generation
            AND EXCLUDED.token_hash=capture_activity_registrations.token_hash
            AND EXCLUDED.auth_session_id=capture_activity_registrations.auth_session_id))`,
      [auth.accountId, auth.userId, sessionID, input.message_id, input.activity_instance_id, auth.sessionId,
        encrypted, createHash("sha256").update(input.token).digest("hex"), input.environment, input.token_generation]);
    if (!stored.rowCount) throw new ApiError(409, "CAPTURE_ACTIVITY_IDENTITY_CONFLICT", "This Activity already belongs to a different admitted message.");
  }

  pump(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.deliver().finally(() => { this.active = undefined; });
    return this.active;
  }
  private async remove(row: Registration) { await this.pool.query(`DELETE FROM capture_activity_registrations WHERE ${WHERE}`, selector(row)); }
  private async deliver(): Promise<void> {
    // Remove revoked ownership before the fenced batch claim. One retired
    // account must not poison delivery for unrelated active accounts.
    await this.pool.query(`DELETE FROM capture_activity_registrations WHERE expires_at<=now()
      OR account_id IN (SELECT id FROM accounts WHERE retired_at IS NOT NULL)`);
    const claimed = await this.pool.query<Registration>(`UPDATE capture_activity_registrations SET next_attempt_at=now()+interval '30 seconds'
      WHERE (account_id,user_id,session_id,activity_instance_id) IN (
        SELECT account_id,user_id,session_id,activity_instance_id FROM capture_activity_registrations
        WHERE next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 32 FOR UPDATE SKIP LOCKED) RETURNING *`);
    for (const row of claimed.rows) {
      try {
        // Session revocation, retired account, test-workspace revocation and user
        // status use exactly the same authority as an authenticated app request.
        const auth: AuthContext = { accountId: row.account_id, userId: row.user_id, sessionId: row.auth_session_id,
          accountSlug: "", userEmail: "", userKind: "apple_human" };
        await currentSession(this.pool, auth);
        await assertSessionForChat(this.pool, auth, row.session_id);
        const result = await this.pool.query<{ status: string; revision: number; paused: boolean }>(`SELECT e.status,s.revision,s.paused FROM conversation_queue_entries e
          JOIN conversation_queue_state s USING(account_id,session_id)
          WHERE e.account_id=$1 AND e.created_by_user_id=$2 AND e.session_id=$3 AND e.message_id=$4
            AND EXISTS(SELECT 1 FROM conversation_message_images i WHERE i.account_id=e.account_id AND i.session_id=e.session_id AND i.message_id=e.message_id)`,
          [row.account_id, row.user_id, row.session_id, row.message_id]);
        const state = result.rows[0];
        if (!state) { await this.remove(row); continue; }
        const phase = captureActivityPhase(state.status, state.paused);
        const terminal = ["review", "failed", "paused"].includes(phase);
        const end = terminal && row.terminal_since != null && Date.now() - row.terminal_since.valueOf() >= 30_000;
        const fresh = row.last_sent_at != null && Date.now() - row.last_sent_at.valueOf() < 30_000;
        if (!end && Number(row.last_sent_revision) >= state.revision && row.last_phase === phase && (terminal || fresh)) continue;
        const now = new Date();
        if (row.last_dispatched_at && Math.floor(now.valueOf()/1000) <= Math.floor(row.last_dispatched_at.valueOf()/1000)) {
          await this.pool.query(`UPDATE capture_activity_registrations SET next_attempt_at=now()+interval '1 second' WHERE ${WHERE}`, selector(row));
          continue;
        }
        let token: string;
        try { token = decryptActivityToken(row.token_ciphertext, this.config.privateKey, owner(row)); }
        catch { await this.remove(row); continue; } // Key rotation requires device re-registration.
        // Reserve before external dispatch. Rotation fences old outcomes; the
        // retained timestamp also prevents same-second APNs ordering ambiguity.
        const reserved = await this.pool.query<{ delivery_sequence: string }>(`UPDATE capture_activity_registrations
          SET last_dispatched_at=now(),delivery_sequence=delivery_sequence+1 WHERE ${WHERE} RETURNING delivery_sequence`, selector(row));
        if (!reserved.rowCount) continue;
        const eventRevision = Number(row.registration_version)*1_000_000 + Number(reserved.rows[0]!.delivery_sequence);
        const pushed = await this.provider.send(token, captureActivityPayload(phase, eventRevision-100, now, end));
        if (pushed.invalidToken || (pushed.accepted && end)) { await this.remove(row); continue; }
        if (pushed.accepted) await this.pool.query(`UPDATE capture_activity_registrations SET last_sent_revision=$6,last_phase=$7,last_sent_at=now(),
          terminal_since=CASE WHEN $8 THEN COALESCE(terminal_since,now()) ELSE NULL END,
          next_attempt_at=now()+interval '5 seconds' WHERE ${WHERE}`,
          [...selector(row), state.revision, phase, terminal]);
      } catch (error) {
        if (error instanceof ApiError && [401, 403, 404, 410].includes(error.statusCode)) await this.remove(row);
        // A transient transport/database failure preserves the durable capability
        // for its next bounded retry. Never log the error or push token.
      }
    }
  }
}

export function registerCaptureActivityRoutes(app: FastifyInstance, pool: Pool, authenticate: preHandlerHookHandler) {
  const config = readCaptureAPNsConfig();
  const service = config ? new CaptureActivityService(pool, config) : null;
  app.post<{ Params: { id: string }; Body: { message_id: string; activity_instance_id: string; token: string; environment: string; token_generation: number } }>(
    "/v1/agent-sessions/:id/capture-activity", { preHandler: authenticate,
      bodyLimit: 4096, schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }, { additionalProperties: false }),
        body: Type.Object({ message_id: Type.String({ format: "uuid" }), activity_instance_id: Type.String({ format: "uuid" }),
          token: Type.String({ pattern: "^[0-9a-f]{32,1024}$" }), token_generation: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
          environment: Type.Union([Type.Literal("production"), Type.Literal("sandbox")]) }, { additionalProperties: false }) } },
    async (request, reply) => {
      if (!service) throw new ApiError(503, "CAPTURE_PUSH_UNAVAILABLE", "Background activity updates are not configured. The admitted Session continues processing.");
      await service.register(request.auth, request.params.id, request.body);
      void service.pump().catch(() => undefined);
      return reply.code(200).send({ registered: true });
    });
  if (service) {
    const unsubscribe = subscribeConversationQueueLive((event) => {
      if (event.type !== "preview") void pool.query("UPDATE capture_activity_registrations SET next_attempt_at=now() WHERE account_id=$1 AND session_id=$2", [event.accountId, event.sessionId])
        .then(() => service.pump()).catch(() => undefined);
    });
    registerRecurringJob(app, { name: "capture-activity-delivery", intervalMs: 5000, run: () => service.pump() });
    app.addHook("preClose", async () => { unsubscribe(); await service.pump(); });
  }
  return service;
}
