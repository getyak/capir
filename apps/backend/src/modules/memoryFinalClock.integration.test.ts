import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { CONTRACT_VERSION, type MemoryProposalCandidate, type MemoryProposalStageRequest } from "@talent-signal/contracts";
import { inTransaction } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import { resolveSessionSourceAuthority, stageMemoryProposal, type MemorySourceAuthority } from "./memoryReview.js";
import * as pending from "./memoryProposalSourceEligibility.js";
import * as lab from "./labWorkspaceAccess.js";

const databaseURL = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (databaseURL) {
  let url: URL;
  try { url = new URL(databaseURL); } catch { throw new Error("Owned disposable loopback database required."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.search || url.hash
    || !["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/lab_regression_ci")
    throw new Error("Owned disposable loopback lab_regression_ci without URL options required.");
}
const pool = databaseURL ? new Pool({ connectionString: databaseURL, max: 2,
  connectionTimeoutMillis: 2_000, statement_timeout: 5_000, query_timeout: 6_000 }) : null;
let poolFailed = false;
pool?.on("error", () => { poolFailed = true; });
afterAll(async () => { await pool?.end(); expect(poolFailed).toBe(false); });
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
async function q<T extends QueryResultRow>(database: Pool | PoolClient, sql: string, args: unknown[] = []) {
  try { return await database.query<T>(sql, args); }
  catch { throw new Error("Synthetic Memory clock query failed; connection/row details withheld."); }
}
function requiredSQL(owner: object, name: string): string {
  const value: unknown = Reflect.get(owner, name);
  expect(typeof value, `Additive server SQL export ${name} must exist before PG semantics`).toBe("string");
  if (typeof value !== "string") throw new Error("Additive Memory clock SQL is unavailable.");
  return value;
}
async function makeAuth(): Promise<AuthContext> {
  const accountId = randomUUID(), userId = randomUUID(), sessionId = randomUUID();
  await q(pool!, "INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic Memory clock')", [accountId, "clock-" + accountId]);
  await q(pool!, "INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Synthetic owner','simulated_human')",
    [userId, accountId, userId + "@example.invalid"]);
  await q(pool!, `INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at)
    VALUES($1,$2,$3,$4,'Synthetic Memory clock',clock_timestamp()+interval '1 hour')`,
  [sessionId, accountId, userId, hash("synthetic-login:" + randomUUID())]);
  return { accountId, userId, sessionId, accountSlug: "clock-" + accountId,
    userEmail: userId + "@example.invalid", userKind: "simulated_human" };
}
const text = "I prefer conclusions first";
function candidate(media: boolean): MemoryProposalCandidate {
  return { scope: media ? "relationship" : "self", operation: "add", statement_kind: "fact", display_text: text,
    subject_id: null, relationship_context_id: null, speaker: null, reporter: null, valid_time: null, observed_time: null,
    time_status: "known", sensitivity: "normal", source_excerpt: text,
    source_locator: media ? { kind: "image_region", artifact_id: "image-0" } : { kind: "message", session_id: null, message_id: null },
    previous_memory_item_id: null, previous_text: null, previous_revision: null, reason: "Useful next time" };
}

/** Same synthetic retained Session/image and admitted media shapes as the
 * existing memoryReview PG fixture. No HTTP login, OCR or provider is claimed. */
async function stageSource(auth: AuthContext, media: boolean) {
  const sessionID = randomUUID(), messageID = randomUUID(), attachmentID = randomUUID(), queueID = randomUUID();
  const bytes = Buffer.from([1, 2, 3, 4]), contentHash = hash(bytes), stamp = new Date().toISOString();
  await q(pool!, `INSERT INTO agent_sessions(account_id,id,created_by_user_id,revision,payload,expires_at)
    VALUES($1,$2,$3,1,$4::jsonb,clock_timestamp()+interval '1 hour')`, [auth.accountId, sessionID, auth.userId,
    JSON.stringify({ id: sessionID, scopeKind: "unresolved_intent", personDisplayLabel: "", contextDisplayLabel: "",
      title: "Synthetic clock source", updatedAt: stamp, isUnread: false, turns: [{ id: messageID, objective: text, createdAt: stamp,
        response: { contractVersion: CONTRACT_VERSION, taskID: randomUUID(), contextManifestID: "none-unbound-conversation",
          knowledgeSnapshotID: "none-unbound-conversation", disposition: "answer", createdAt: stamp },
        ...(media ? {} : { images: [{ attachment_id: attachmentID, file_name: "synthetic.png", media_type: "image/png", byte_size: 4, content_hash: contentHash }] }) }] })]);
  let personID: string | null = null, contextID: string | null = null, authority: MemorySourceAuthority;
  if (media) {
    personID = randomUUID(); contextID = randomUUID();
    await q(pool!, "INSERT INTO subjects(id,account_id,external_ref,display_label,status) VALUES($1,$2,$3,'Synthetic contact','active')", [personID, auth.accountId, "clock-person:" + personID]);
    await q(pool!, "INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label,status) VALUES($1,$2,$3,$4,'Synthetic context','active')", [contextID, auth.accountId, personID, "clock-context:" + contextID]);
    const mediaID = randomUUID();
    await q(pool!, `INSERT INTO chat_media_assets(id,account_id,subject_id,assignment_id,created_by_user_id,idempotency_key,
      file_name,media_type,byte_size,storage_provider,object_key,status)
      VALUES($1,$2,$3,$4,$5,$6,'synthetic.png','image/png',4,'local',$7,'ready')`,
    [mediaID, auth.accountId, personID, contextID, auth.userId, "media-" + mediaID, "synthetic/clock/" + mediaID]);
    authority = { text, sessionId: sessionID, messageId: messageID, sourceTaskId: null, captureIds: [], imageManifest: [],
      messageTextHash: hash(text), captureVersion: null, captureSubjectId: null, captureContextId: null,
      artifacts: [{ artifactId: "image-0", sourceArtifactId: mediaID, kind: "image", sessionId: sessionID, messageId: messageID,
        captureId: null, sourceResourceId: null, evidenceFragmentId: null, contentHash: null, captureVersion: null }] };
  } else {
    await q(pool!, `INSERT INTO conversation_queue_entries(account_id,session_id,id,message_id,created_by_user_id,sequence,status,
      content_state,objective,idempotency_key,expires_at) VALUES($1,$2,$3,$4,$5,1,'completed','retained',$6,$7,clock_timestamp()+interval '1 hour')`,
    [auth.accountId, sessionID, queueID, messageID, auth.userId, text, "clock-queue:" + queueID]);
    await q(pool!, `INSERT INTO conversation_message_images(account_id,session_id,message_id,queue_entry_id,image_index,attachment_id,
      file_name,media_type,byte_size,content_hash,content,expires_at)
      VALUES($1,$2,$3,$4,0,$5,'synthetic.png','image/png',4,$6,$7,clock_timestamp()+interval '1 hour')`,
    [auth.accountId, sessionID, messageID, queueID, attachmentID, contentHash, bytes]);
    authority = await resolveSessionSourceAuthority(pool!, auth, sessionID, messageID);
  }
  const request: MemoryProposalStageRequest = { idempotency_key: randomUUID(), surface: media ? "relationship" : "chat",
    session_id: sessionID, source_task_id: randomUUID(), source_message_id: messageID, person_id: personID,
    relationship_context_id: contextID, contact_decision: media ? "existing" : "none",
    ...(media ? { identity_authority: "human_selection" as const } : {}), identity_clue: null, new_contact: null,
    proposer: { kind: "human", name: "clock-integration", version: "1" }, items: [candidate(media)] };
  const staged = await inTransaction(pool!, client => stageMemoryProposal(client, auth, request, authority));
  expect(staged).toBeTruthy();
  return { sessionID, messageID, queueID, proposalID: staged!.proposal.proposal_id };
}
async function qualify(client: PoolClient, auth: AuthContext, proposalID: string, atTick: string) {
  const row = (await q<{ legacy: boolean; fixed: boolean }>(client, `WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at)
    SELECT COALESCE(${pending.MEMORY_PROPOSAL_SOURCE_ELIGIBILITY_SQL},false) AS legacy,
      COALESCE(${atTick},false) AS fixed FROM memory_proposals p JOIN memory_proposal_items i
      ON i.account_id=p.account_id AND i.proposal_id=p.id CROSS JOIN tick
    WHERE p.account_id=$1 AND p.id=$3`, [auth.accountId, auth.userId, proposalID])).rows;
  expect(row).toHaveLength(1); return row[0]!;
}
async function waitExpired(auth: AuthContext, sessionID: string, image: boolean) {
  const until = performance.now() + 4_000;
  while (performance.now() < until) {
    const sql = image
      ? "SELECT expires_at<=clock_timestamp() AS expired FROM conversation_message_images WHERE account_id=$1 AND session_id=$2 AND image_index=0"
      : "SELECT expires_at<=clock_timestamp() AS expired FROM agent_sessions WHERE account_id=$1 AND id=$2";
    if ((await q<{ expired: boolean }>(pool!, sql, [auth.accountId, sessionID])).rows[0]?.expired) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Synthetic source expiry was not observed within its finite DB-clock budget.");
}

type LabTTL = "human_workspace" | "human_entry" | "parent" | "grant" | "operator_workspace" | "operator_entry";
async function makeLab(target: AuthContext, change: LabTTL) {
  const operator = change.startsWith("operator"), parent = operator ? null : await makeAuth();
  const workspace = randomUUID(), entry = randomUUID(), principal = randomUUID(), grant = randomUUID();
  const web = "https://memory-clock-web.example.invalid", backend = "https://memory-clock-api.example.invalid";
  await q(pool!, "UPDATE users SET kind='lab_human' WHERE account_id=$1 AND id=$2", [target.accountId, target.userId]);
  if (operator) await q(pool!, `INSERT INTO capir_test_provisioners(id,label,credential_hash,generation,web_origin,backend_origin)
    VALUES($1,$2,$3,1,$4,$5)`, [principal, "Memory clock " + principal, hash("synthetic-principal:" + randomUUID()), web, backend]);
  if (change === "grant") {
    await q(pool!, `INSERT INTO capir_user_test_entitlements(id,account_id,user_id,scopes,granted_by)
      VALUES($1,$2,$3,ARRAY['test.handoff'],'Synthetic clock fixture')`, [randomUUID(), parent!.accountId, parent!.userId]);
    await q(pool!, `INSERT INTO capir_auth_grants(id,account_id,user_id,backing_session_id,client_label,web_origin,backend_origin,
      scopes,test_entitlement_generation,absolute_expires_at,protocol_version)
      VALUES($1,$2,$3,$4,'Synthetic Memory clock grant',$5,$6,ARRAY['test.handoff'],1,clock_timestamp()+interval '1 hour','capir-auth.v2')`,
    [grant, parent!.accountId, parent!.userId, parent!.sessionId, web, backend]);
  }
  await q(pool!, `INSERT INTO lab_test_workspaces(id,owner_account_id,owner_user_id,owner_principal_id,target_account_id,
    target_user_id,duration_hours,expires_at,media_scope_hash) VALUES($1,$2,$3,$4,$5,$6,1,clock_timestamp()+interval '1 hour',$7)`,
  [workspace, parent?.accountId ?? null, parent?.userId ?? null, operator ? principal : null, target.accountId, target.userId, "a".repeat(64)]);
  if (operator) await q(pool!, `INSERT INTO capir_test_runs(id,request_id,principal_id,principal_generation,workspace_id,
    account_id,user_id,username,email,preset,preset_version,preset_digest,counts,web_origin,backend_origin)
    VALUES($1,$2,$3,1,$1,$4,$5,$6,$7,'empty','clock-v1',$8,'{}'::jsonb,$9,$10)`,
  [workspace, randomUUID(), principal, target.accountId, target.userId, "clock-" + workspace, target.userEmail, "b".repeat(64), web, backend]);
  await q(pool!, `INSERT INTO lab_test_workspace_entries(id,workspace_id,owner_session_id,owner_principal_id,principal_generation,
    session_id,token_hash,expires_at) SELECT $1,$2,$3,$4,$5,id,token_hash,expires_at FROM sessions
    WHERE id=$6 AND account_id=$7 AND user_id=$8`, [entry, workspace, parent?.sessionId ?? null, operator ? principal : null,
    operator ? 1 : null, target.sessionId, target.accountId, target.userId]);
  // Closed synthetic table/column choices, not caller SQL or an auth API.
  const table = change.endsWith("workspace") ? "lab_test_workspaces" : change.endsWith("entry") ? "lab_test_workspace_entries"
    : change === "grant" ? "capir_auth_grants" : "sessions";
  const column = change === "grant" ? "absolute_expires_at" : "expires_at";
  const id = change.endsWith("workspace") ? workspace : change.endsWith("entry") ? entry : change === "grant" ? grant : parent!.sessionId;
  return { web, backend, operator, async shorten() {
    return (await q<{ deadline: string }>(pool!, `UPDATE ${table} SET ${column}=clock_timestamp()+interval '1 second'
      WHERE id=$1 RETURNING to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deadline`, [id])).rows[0]!.deadline;
  } };
}

describe.skipIf(!pool)("additive fixed-clock Memory SQL over real disposable PostgreSQL", () => {
  it.each([false, true])("uses the current tick after a real TTL crosses transaction-start now (media=%s)", async media => {
    const fixed = requiredSQL(pending, "MEMORY_PROPOSAL_SOURCE_ELIGIBILITY_AT_TICK_SQL");
    const auth = await makeAuth(), source = await stageSource(auth, media), client = await pool!.connect();
    try {
      await q(client, "BEGIN");
      await q(pool!, media
        ? "UPDATE agent_sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE account_id=$1 AND id=$2"
        : "UPDATE conversation_message_images SET expires_at=clock_timestamp()+interval '1 second' WHERE account_id=$1 AND session_id=$2",
      [auth.accountId, source.sessionID]);
      expect(await qualify(client, auth, source.proposalID, fixed)).toEqual({ legacy: true, fixed: true });
      await waitExpired(auth, source.sessionID, !media);
      expect(await qualify(client, auth, source.proposalID, fixed)).toEqual({ legacy: true, fixed: false });
      if (!media) {
        // A wrong-index live row makes the fixed image count equal1 again.
        // The expired expected index0 must still fail its separate TTL site.
        const extra = Buffer.from([5, 6, 7, 8]);
        await q(pool!, `INSERT INTO conversation_message_images(account_id,session_id,message_id,queue_entry_id,image_index,
          attachment_id,file_name,media_type,byte_size,content_hash,content,expires_at)
          VALUES($1,$2,$3,$4,1,$5,'wrong-index.png','image/png',4,$6,$7,clock_timestamp()+interval '1 hour')`,
        [auth.accountId, source.sessionID, source.messageID, source.queueID, randomUUID(), hash(extra), extra]);
        expect((await q<{ count: number }>(pool!, "SELECT count(*)::int AS count FROM conversation_message_images WHERE account_id=$1 AND session_id=$2 AND expires_at>clock_timestamp()",
          [auth.accountId, source.sessionID])).rows[0]?.count).toBe(1);
        expect(await qualify(client, auth, source.proposalID, fixed)).toEqual({ legacy: false, fixed: false });
      }
    } finally { try { await q(client, "ROLLBACK"); } finally { client.release(); } }
  }, 15_000);

  it.each(["human_workspace", "human_entry", "parent", "grant", "operator_workspace", "operator_entry"] as const)(
    "shares a real materialized Lab tick across its %s TTL, then denies a fresh expired tick", async change => {
      const fixed = requiredSQL(lab, "labWorkspaceSessionActiveAtTickSQL");
      const serving = requiredSQL(lab, "memoryContentOperatorLabDeploymentActiveSQL");
      const auth = await makeAuth(), fixture = await makeLab(auth, change), deadline = await fixture.shorten();
      const query = (hold: boolean) => `WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at),
        held AS MATERIALIZED (SELECT ${hold ? "pg_sleep(1.1)" : "1"} FROM tick),
        reserved AS (SELECT $4::text,$5::text,$6::timestamptz)
        SELECT COALESCE(${lab.labWorkspaceSessionActiveSQL},false) AS legacy,COALESCE(${fixed},false) AS fixed,
          COALESCE(${serving},false) AS serving,tick.checked_at<$11::timestamptz AS tick_before,
          clock_timestamp()>=$11::timestamptz AS crossed
        FROM users JOIN sessions ON sessions.account_id=users.account_id AND sessions.user_id=users.id
        CROSS JOIN tick CROSS JOIN held CROSS JOIN reserved
        WHERE users.account_id=$1 AND users.id=$2 AND sessions.id=$3`;
      const args: unknown[] = [auth.accountId, auth.userId, auth.sessionId, "not-serving-enabled", "not-serving-web",
        "2099-01-01T00:00:00Z", true, fixture.web, fixture.backend, true, deadline];
      const before = (await q(pool!, query(false), args)).rows[0];
      expect(before).toEqual({ legacy: true, fixed: true, serving: true, tick_before: true, crossed: false });
      // This is primitive one-tick semantics, not permission to deliver after
      // the roundtrip. The future joint reader must also charge that delay.
      const held = (await q(pool!, query(true), args)).rows[0];
      expect(held).toEqual({ legacy: false, fixed: true, serving: true, tick_before: true, crossed: true });
      expect((await q(pool!, query(false), args)).rows[0])
        .toEqual({ legacy: false, fixed: false, serving: true, tick_before: false, crossed: true });
      const wrongOrigin = [...args]; wrongOrigin[7] = "https://foreign.example.invalid";
      expect((await q(pool!, query(false), wrongOrigin)).rows[0]?.serving).toBe(!fixture.operator && change !== "grant");
    }, 15_000);
});
