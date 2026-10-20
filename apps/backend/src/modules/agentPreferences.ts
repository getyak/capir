import { CONTRACT_VERSION, type AgentPreferenceMutation, type AgentPreferenceResponse, type LanguagePreference } from "@talent-signal/contracts";
import type { Pool } from "pg";
import { inTransaction, type DatabaseClient } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import { ApiError } from "../lib/apiError.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import { appendAudit } from "../lib/audit.js";
import type { ResponsePreference } from "@talent-signal/agent";

export async function loadAgentResponsePreference(database: DatabaseClient, auth: AuthContext): Promise<ResponsePreference | undefined> {
  const { preference } = await readAgentPreference(database, auth);
  const language = preference.prompt_output_language ?? "system";
  return (preference.response_style === "conclusion_first" || language !== "system") && preference.provenance && preference.updated_at
    ? { responseStyle: preference.response_style, sourceID: preference.provenance.source_id, updatedAt: preference.updated_at,
      ...(language !== "system" ? { promptOutputLanguage: language } : {}) } : undefined;
}

export async function readAgentPreference(database: DatabaseClient, auth: AuthContext): Promise<AgentPreferenceResponse> {
  const row = (await database.query<{ response_style: "default" | "conclusion_first"; prompt_output_language: LanguagePreference; revision: number; updated_at: Date }>(
    "SELECT response_style,prompt_output_language,revision,updated_at FROM agent_user_preferences WHERE account_id=$1 AND user_id=$2", [auth.accountId, auth.userId])).rows[0];
  return { contract_version: CONTRACT_VERSION, preference: row ? { response_style: row.response_style,
    prompt_output_language: row.prompt_output_language, revision: row.revision,
    updated_at: row.updated_at.toISOString(), provenance: { kind: "user_setting", user_id: auth.userId,
      source_id: `user-preference:${auth.userId}:${row.revision}` } }
    : { response_style: "default", prompt_output_language: "system", revision: 0, updated_at: null, provenance: null } };
}

/** Human settings route only; deliberately absent from all Agent tool manifests. */
export async function saveAgentPreference(pool: Pool, auth: AuthContext, input: AgentPreferenceMutation): Promise<AgentPreferenceResponse> {
  return inTransaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('talent-signal-agent-preference'),hashtext($1))", [`${auth.accountId}:${auth.userId}`]);
    const actor = { accountId: auth.accountId, actorUserId: auth.userId };
    const claim = await claimIdempotency(client, actor, "save_agent_preference", input.idempotency_key, input);
    const current = await readAgentPreference(client, auth);
    if (claim.replay) {
      const replay = claim.replay.body as AgentPreferenceResponse;
      if (replay.preference?.revision !== current.preference.revision) throw new ApiError(409, "AGENT_PREFERENCE_CHANGED", "The preference changed after that request. Read its current value.");
      return current;
    }
    if (current.preference.revision !== input.expected_revision) throw new ApiError(409, "AGENT_PREFERENCE_CHANGED", "Read the current preference before saving your change.");
    // Legacy clients only edit response_style; an omitted language preserves
    // the saved pin. Explicit "system" removes the pin and keeps the prompt's
    // existing user-language behavior.
    const promptOutputLanguage = input.prompt_output_language ?? current.preference.prompt_output_language ?? "system";
    await client.query(`INSERT INTO agent_user_preferences(account_id,user_id,response_style,prompt_output_language,revision) VALUES($1,$2,$3,$4,1)
      ON CONFLICT(account_id,user_id) DO UPDATE SET response_style=EXCLUDED.response_style,
        prompt_output_language=EXCLUDED.prompt_output_language,
        revision=agent_user_preferences.revision+1,updated_at=clock_timestamp()`,
      [auth.accountId, auth.userId, input.response_style, promptOutputLanguage]);
    const result = await readAgentPreference(client, auth);
    await appendAudit(client, actor, "agent_preference.saved", "user", auth.userId,
      { response_style: input.response_style, revision: result.preference.revision, source: "explicit_user_setting", external_effect_count: 0 });
    await completeIdempotency(client, claim, 200, result);
    return result;
  });
}
