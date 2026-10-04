import { randomUUID } from "node:crypto";
import { CONTRACT_VERSION, type LabWorkspace, type LabWorkspaceCreateRequest,
  type LabWorkspaceEntry, type LabWorkspaceEntryRequest } from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";
import type { ChatMediaStorage } from "./chatMediaStorage.js";
import { labWorkspaceSessionActiveSQL } from "./labWorkspaceAccess.js";
import { recordLabStopCleanup, reconcileMcpOAuthCleanup } from "./mcpOauthCleanup.js";
import { labStopAuthorityKeySQL } from "./labStopAuthority.js";

type Query = Pick<Pool,"query"> | PoolClient;
interface WorkspaceRow {
  external_cleanup_pending: number;
  id:string; owner_account_id:string|null; owner_user_id:string|null; owner_principal_id:string|null;
  target_account_id:string; target_user_id:string;
  duration_hours:number; created_at:Date; empty_verified_at:Date|null; expires_at:Date;
  state:"active"|"deleting"|"deleted"; stop_id:string|null; stop_reason:"manual"|"expired"|null;
  stopped_at:Date|null; deleted_at:Date|null; media_scope_hash:string;
  media_manifest:Array<{object_key:string;storage_provider:string}>; cleanup_error:LabWorkspace["cleanup_error"];
}
interface EntryRow {id:string;workspace_id:string;owner_session_id:string|null;owner_principal_id:string|null;
  principal_generation:number|null;session_id:string;token_hash:string;
  expires_at:Date;revoked_at:Date|null;}
const iso = (value:Date|null)=>value?.toISOString()??null;
const access = (auth:AuthContext,w:WorkspaceRow)=>
  (w.owner_account_id===auth.accountId && w.owner_user_id===auth.userId) ||
  (auth.userKind==="lab_human" && w.target_account_id===auth.accountId && w.target_user_id===auth.userId);
function conflict(): never { throw new ApiError(409,"LAB_WORKSPACE_INTENT_CONFLICT","This intent already belongs to different test-workspace parameters."); }
function translate(error:unknown): never {
  if ((error as {code?:string})?.code==="23505") conflict();
  throw error;
}

export class LabWorkspaceService {
  constructor(readonly pool:Pool, readonly storage:ChatMediaStorage, readonly sessionTTLSeconds:number) {}
  get supported() { return Boolean(this.storage.labScopeID && this.storage.purgeForLab && this.storage.existsForLab); }

  async tables(client:Query=this.pool):Promise<string[]> {
    const rows=(await client.query<{table_name:string;scope:string;exists:boolean;has_account:boolean;guarded:boolean}>(
      `SELECT m.table_name,m.scope,t.table_name IS NOT NULL AS exists,
        EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
          AND c.table_name=m.table_name AND c.column_name='account_id') AS has_account,
        EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=g.tgfoid
          WHERE n.nspname='public' AND c.relname=m.table_name AND NOT g.tgisinternal
            AND g.tgenabled IN ('O','A') AND g.tgname='lab_test_workspace_write_guard'
            AND p.proname='lab_test_workspace_write_guard') AS guarded
       FROM lab_test_workspace_table_manifest m LEFT JOIN information_schema.tables t
         ON t.table_schema='public' AND t.table_type='BASE TABLE' AND t.table_name=m.table_name
       UNION ALL SELECT t.table_name,'unknown',true,false,false FROM information_schema.tables t
         WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
           AND NOT EXISTS(SELECT 1 FROM lab_test_workspace_table_manifest m WHERE m.table_name=t.table_name)`)).rows;
    if (rows.length===0 || rows.some(r=>!r.exists || !/^[a-z][a-z0-9_]*$/.test(r.table_name) || r.scope==="unknown" ||
      (r.scope==="account" && (!r.has_account || !r.guarded)) ||
      (["global","cascade"].includes(r.scope) && r.has_account))) {
      throw new ApiError(503,"LAB_WORKSPACE_SCHEMA_CHANGED","Test-workspace cleanup coverage must be updated for this database schema.");
    }
    return rows.filter(r=>r.scope==="account").map(r=>r.table_name).sort();
  }

  async dataRows(client:Query,accountId:string,tables:string[]):Promise<number> {
    const result=await client.query<{count:string}>(`SELECT sum(n)::text AS count FROM (
      ${tables.map(t=>`SELECT count(*) AS n FROM "${t}" WHERE account_id=$1`).join(" UNION ALL ")}
      UNION ALL SELECT count(*) FROM lab_experiment_attempts a JOIN lab_experiment_jobs j ON j.id=a.job_id
        WHERE j.account_id=$1) counts`,[accountId]);
    return Number(result.rows[0]?.count??0);
  }

  private async row(client:Query,auth:AuthContext,id:string,lock=false):Promise<WorkspaceRow> {
    const w=(await client.query<WorkspaceRow>(`SELECT * FROM lab_test_workspaces WHERE id=$1
      AND ((owner_account_id=$2 AND owner_user_id=$3) OR (target_account_id=$2 AND target_user_id=$3 AND $4))
      ${lock?"FOR UPDATE":""}`,[id,auth.accountId,auth.userId,auth.userKind==="lab_human"])).rows[0];
    if(!w || !access(auth,w))throw new ApiError(404,"LAB_WORKSPACE_NOT_FOUND","This test workspace is not available to this identity.");
    return w;
  }

  private async ownerSession(client:Query,auth:AuthContext):Promise<Date> {
    if(auth.userKind==="lab_human")throw new ApiError(403,"LAB_WORKSPACE_NESTING_DENIED","Return to the original account before creating or entering a test workspace.");
    const session=(await client.query<{expires_at:Date}>(`SELECT s.expires_at FROM sessions s
      JOIN users u ON u.account_id=s.account_id AND u.id=s.user_id
      WHERE s.id=$1 AND s.account_id=$2 AND s.user_id=$3 AND s.revoked_at IS NULL
        AND s.expires_at>clock_timestamp() AND u.status='active' AND u.kind<>'lab_human'`,
      [auth.sessionId,auth.accountId,auth.userId])).rows[0];
    if(!session)throw new ApiError(401,"SESSION_INVALID","The creating session is no longer active.");
    return session.expires_at;
  }

  private async describe(w:WorkspaceRow,client:Query=this.pool):Promise<LabWorkspace> {
    let count:number|null=null, schemaChanged=false;
    // The UI counts test content; the generation baseline is coordination
    // metadata. Creation and final cleanup still inspect every physical table.
    try { count=await this.dataRows(client,w.target_account_id,(await this.tables(client)).filter(table=>table!=="harness_source_generations")); }
    catch(error) {if(!(error instanceof ApiError) || error.code!=="LAB_WORKSPACE_SCHEMA_CHANGED")throw error;schemaChanged=true;}
    const metadata=(await client.query<{sessions:string;pending:string}>(`SELECT
      (SELECT count(*) FROM sessions JOIN users ON users.id=sessions.user_id AND users.account_id=sessions.account_id
        WHERE sessions.account_id=$1 AND sessions.user_id=$2 AND sessions.revoked_at IS NULL
          AND sessions.expires_at>clock_timestamp() AND ${labWorkspaceSessionActiveSQL}) AS sessions,
      (SELECT count(*) FROM lab_test_workspace_media_writes WHERE workspace_id=$3 AND state<>'settled') AS pending`,
      [w.target_account_id,w.target_user_id,w.id])).rows[0]!;
    return {id:w.id,owner_account_id:w.owner_account_id,owner_user_id:w.owner_user_id,
      owner_principal_id:w.owner_principal_id,
      account_id:w.target_account_id,user_id:w.target_user_id,name:`Test workspace · ${w.id.slice(0,8)}`,
      state:w.state==="active"&&w.expires_at.getTime()<=Date.now()?"expired":w.state,
      created_at:w.created_at.toISOString(),empty_verified_at:iso(w.empty_verified_at),expires_at:w.expires_at.toISOString(),
      duration_hours:w.duration_hours,stop_id:w.stop_id,stop_reason:w.stop_reason,stopped_at:iso(w.stopped_at),deleted_at:iso(w.deleted_at),
      cleanup_error:schemaChanged?"schema_changed":w.cleanup_error,data_rows:count,active_sessions:Number(metadata.sessions),
      pending_media_writes:Number(metadata.pending),scope:"isolated_test_account"};
  }

  async list(auth:AuthContext):Promise<LabWorkspace[]> {
    const rows=(await this.pool.query<WorkspaceRow>(`SELECT * FROM lab_test_workspaces
      WHERE (owner_account_id=$1 AND owner_user_id=$2) OR (target_account_id=$1 AND target_user_id=$2 AND $3)
      ORDER BY created_at DESC LIMIT 50`,[auth.accountId,auth.userId,auth.userKind==="lab_human"])).rows;
    const result:LabWorkspace[]=[];for(const row of rows)result.push(await this.describe(row));return result;
  }
  async read(auth:AuthContext,id:string):Promise<LabWorkspace> { return this.describe(await this.row(this.pool,auth,id)); }

  async create(auth:AuthContext,request:LabWorkspaceCreateRequest):Promise<LabWorkspace> {
    if(!this.supported)throw new ApiError(503,"LAB_WORKSPACE_STORAGE_UNSUPPORTED","Verified test-media cleanup is unavailable for this storage provider.");
    try { return await inTransaction(this.pool,async client=>{
      await this.ownerSession(client,auth);
      await client.query("SELECT id FROM users WHERE account_id=$1 AND id=$2 FOR UPDATE",[auth.accountId,auth.userId]);
      const previous=(await client.query<WorkspaceRow>("SELECT * FROM lab_test_workspaces WHERE id=$1",[request.id])).rows[0];
      if(previous){if(previous.owner_account_id!==auth.accountId||previous.owner_user_id!==auth.userId||previous.duration_hours!==request.duration_hours)conflict();return this.describe(previous,client);}
      const tables=await this.tables(client);
      const count=Number((await client.query<{n:string}>(`SELECT count(*) AS n FROM lab_test_workspaces
        WHERE owner_account_id=$1 AND owner_user_id=$2 AND state<>'deleted'`,[auth.accountId,auth.userId])).rows[0]!.n);
      if(count>=3)throw new ApiError(409,"LAB_WORKSPACE_LIMIT","End and clean an existing test workspace before creating another.");
      const account=randomUUID(),user=randomUUID();
      await client.query("INSERT INTO accounts(id,slug,name) VALUES ($1,$2,$3)",[account,`lab-${request.id}`,`Test workspace · ${request.id.slice(0,8)}`]);
      await client.query(`INSERT INTO users(id,account_id,email,display_name,kind) VALUES ($1,$2,$3,'Test user','lab_human')`,[user,account,`test-${request.id}@lab.invalid`]);
      const w=(await client.query<WorkspaceRow>(`INSERT INTO lab_test_workspaces(id,owner_account_id,owner_user_id,target_account_id,target_user_id,
        duration_hours,expires_at,media_scope_hash) VALUES ($1,$2,$3,$4,$5,$6::integer,now()+$6::integer*interval '1 hour',$7) RETURNING *`,
        [request.id,auth.accountId,auth.userId,account,user,request.duration_hours,this.storage.labScopeID])).rows[0]!;
      const emptyBaseline = (await client.query("SELECT 1 FROM harness_source_generations WHERE account_id=$1 AND generation=0",[account])).rowCount;
      if(emptyBaseline!==1 || await this.dataRows(client,account,tables)!==1)throw new ApiError(409,"LAB_WORKSPACE_NOT_EMPTY","The new workspace did not verify as empty.");
      w.empty_verified_at=(await client.query<{empty_verified_at:Date}>("UPDATE lab_test_workspaces SET empty_verified_at=now() WHERE id=$1 RETURNING empty_verified_at",[w.id])).rows[0]!.empty_verified_at;
      return this.describe(w,client);
    }); }catch(error){return translate(error);}
  }

  private async describeEntry(client:Query,w:WorkspaceRow,e:EntryRow):Promise<LabWorkspaceEntry> {
    // The shared authority predicate governs the entry's session for both
    // lineage forms: a human parent session or an operator-principal entry.
    const s=(await client.query<{active:boolean}>(`SELECT EXISTS(SELECT 1 FROM sessions
      JOIN users ON users.account_id=sessions.account_id AND users.id=sessions.user_id
      WHERE sessions.id=$1 AND sessions.account_id=$2 AND sessions.user_id=$3
      AND sessions.revoked_at IS NULL AND sessions.expires_at>clock_timestamp()
      AND users.status='active' AND ${labWorkspaceSessionActiveSQL}) AS active`,
      [e.session_id,w.target_account_id,w.target_user_id])).rows[0]!;
    const state:LabWorkspaceEntry["state"]=e.revoked_at||w.state!=="active"?"revoked":
      e.expires_at.getTime()<=Date.now()||w.expires_at.getTime()<=Date.now()?"expired":!s.active?"revoked":"active";
    return {id:e.id,workspace_id:w.id,session_id:e.session_id,expires_at:e.expires_at.toISOString(),revoked_at:iso(e.revoked_at),state,
      session:state!=="active"?null:{contract_version:CONTRACT_VERSION,expires_at:e.expires_at.toISOString(),
        account:{id:w.target_account_id,slug:`lab-${w.id}`,name:`Test workspace · ${w.id.slice(0,8)}`},
        user:{id:w.target_user_id,email:`test-${w.id}@lab.invalid`,display_name:"Test user",kind:"lab_human",role:"member",username:null}}};
  }

  async enter(auth:AuthContext,id:string,request:LabWorkspaceEntryRequest):Promise<LabWorkspaceEntry> {
    const bytes=Buffer.from(request.access_token,"base64url");
    if(bytes.length!==32||bytes.toString("base64url")!==request.access_token)throw new ApiError(400,"LAB_WORKSPACE_TOKEN_INVALID","The entry credential must encode exactly 32 random bytes.");
    try {return await inTransaction(this.pool,async client=>{
      const parentExpiry=await this.ownerSession(client,auth),w=await this.row(client,auth,id,true);
      const hash=sha256(request.access_token);
      const previous=(await client.query<EntryRow>("SELECT * FROM lab_test_workspace_entries WHERE id=$1",[request.id])).rows[0];
      if(previous){if(previous.workspace_id!==w.id||previous.token_hash!==hash)conflict();return this.describeEntry(client,w,previous);}
      if(w.state!=="active"||w.expires_at.getTime()<=Date.now())throw new ApiError(410,"LAB_TEST_WORKSPACE_CLOSED","This test workspace is closed or expired.");
      if(!this.supported||w.media_scope_hash!==this.storage.labScopeID)throw new ApiError(503,"LAB_WORKSPACE_MEDIA_SCOPE_CHANGED","The test workspace's media storage is no longer available.");
      await this.tables(client);
      const entries=Number((await client.query<{n:string}>(`SELECT count(*) AS n FROM lab_test_workspace_entries e
        JOIN sessions s ON s.id=e.session_id WHERE e.workspace_id=$1 AND e.revoked_at IS NULL
          AND e.expires_at>clock_timestamp() AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`,[id])).rows[0]!.n);
      if(entries>=5)throw new ApiError(409,"LAB_WORKSPACE_ENTRY_LIMIT","Leave an existing test session before starting another.");
      const sessionId=randomUUID(),expires=new Date(Math.min(w.expires_at.getTime(),parentExpiry.getTime(),Date.now()+this.sessionTTLSeconds*1000));
      await client.query(`INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at)
        VALUES ($1,$2,$3,$4,'Lab test workspace',$5)`,[sessionId,w.target_account_id,w.target_user_id,hash,expires]);
      const e=(await client.query<EntryRow>(`INSERT INTO lab_test_workspace_entries(id,workspace_id,owner_session_id,session_id,token_hash,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,[request.id,id,auth.sessionId,sessionId,hash,expires])).rows[0]!;
      return this.describeEntry(client,w,e);
    });}catch(error){return translate(error);}
  }

  async leave(auth:AuthContext,id:string,entryId:string):Promise<LabWorkspaceEntry> {
    return inTransaction(this.pool,async client=>{
      const w=await this.row(client,auth,id,true);
      const e=(await client.query<EntryRow>("SELECT * FROM lab_test_workspace_entries WHERE id=$1 AND workspace_id=$2 FOR UPDATE",[entryId,id])).rows[0];
      if(!e || (auth.userKind==="lab_human"&&e.session_id!==auth.sessionId))throw new ApiError(404,"LAB_WORKSPACE_ENTRY_NOT_FOUND","The test entry is not available to this session.");
      await client.query("UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND account_id=$2 AND user_id=$3",[e.session_id,w.target_account_id,w.target_user_id]);
      e.revoked_at=(await client.query<{revoked_at:Date}>("UPDATE lab_test_workspace_entries SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 RETURNING revoked_at",[entryId])).rows[0]!.revoked_at;
      return this.describeEntry(client,w,e);
    });
  }

  private async beginStop(id:string,stopId:string,reason:"manual"|"expired",auth?:AuthContext):Promise<void> {
    await inTransaction(this.pool,async client=>{
      const admitted=auth?await this.row(client,auth,id):(await client.query<WorkspaceRow>("SELECT * FROM lab_test_workspaces WHERE id=$1",[id])).rows[0];
      if(!admitted||admitted.state!=="active"||(reason==="expired"&&admitted.expires_at.getTime()>Date.now()))return;
      // Publish stop intent before waiting for product writes' workspace SHARE
      // locks. Independent SDK heartbeats see this lock and roll back promptly.
      await client.query(`SELECT pg_advisory_xact_lock(${labStopAuthorityKeySQL})`,[admitted.target_account_id]);
      const w=auth?await this.row(client,auth,id,true):(await client.query<WorkspaceRow>("SELECT * FROM lab_test_workspaces WHERE id=$1 FOR UPDATE",[id])).rows[0];
      if(!w||w.state!=="active")return;
      if(reason==="expired"&&w.expires_at.getTime()>Date.now())return;
      const media=(await client.query<{object_key:string;storage_provider:string}>("SELECT object_key,storage_provider FROM chat_media_assets WHERE account_id=$1",[w.target_account_id])).rows;
      await client.query(`UPDATE lab_test_workspaces SET state='deleting',stop_id=$2,stop_reason=$3,
        stopped_at=now(),media_manifest=$4::jsonb WHERE id=$1`,[id,stopId,reason,JSON.stringify(media)]);
      await client.query("UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE account_id=$1",[w.target_account_id]);
      await client.query("UPDATE lab_test_workspace_entries SET revoked_at=coalesce(revoked_at,now()) WHERE workspace_id=$1",[id]);
      await client.query("UPDATE users SET status='revoked' WHERE account_id=$1 AND id=$2 AND kind='lab_human'",[w.target_account_id,w.target_user_id]);
    });
  }

  async clean(id:string):Promise<void> {
    let failure:LabWorkspace["cleanup_error"]="data_cleanup_failed";
    try {
      const w=(await this.pool.query<WorkspaceRow>("SELECT * FROM lab_test_workspaces WHERE id=$1",[id])).rows[0];
      if(!w||w.state!=="deleting")return;
      if(w.external_cleanup_pending>0){
        // Local data was already wiped; only the external broker cleanup is
        // outstanding. Reconcile it and keep the deletion claim honest.
        await reconcileMcpOAuthCleanup(this.pool);
        const remaining=Number((await this.pool.query<{n:string}>("SELECT count(*) AS n FROM mcp_oauth_cleanup WHERE lab_workspace_id=$1 AND (state<>'confirmed' OR closure_state='open')",[id])).rows[0]!.n);
        await this.pool.query("UPDATE lab_test_workspaces SET state=$2,deleted_at=CASE WHEN $3=0 THEN coalesce(deleted_at,now()) ELSE deleted_at END,external_cleanup_pending=$3 WHERE id=$1",[id,remaining===0?"deleted":"deleting",remaining]);
        return;
      }
      const identity=(await this.pool.query<{valid:boolean}>(`SELECT EXISTS(SELECT 1 FROM users WHERE id=$2
        AND account_id=$1 AND kind='lab_human' AND status='revoked') AS valid`,[w.target_account_id,w.target_user_id])).rows[0]!;
      if(!identity.valid||w.owner_account_id===w.target_account_id)throw new Error("Invalid test-account ownership");
      failure="schema_changed";const tables=await this.tables();
      failure="media_scope_changed";
      if(!this.supported||w.media_scope_hash!==this.storage.labScopeID)throw new Error("Changed media storage scope");
      failure="media_unsettled";
      const pending=Number((await this.pool.query<{n:string}>("SELECT count(*) AS n FROM lab_test_workspace_media_writes WHERE workspace_id=$1 AND state<>'settled'",[id])).rows[0]!.n);
      if(pending>0)throw new Error("Unsettled object PUT intent");
      failure="media_cleanup_failed";
      for(const media of w.media_manifest){
        if(media.storage_provider!==this.storage.provider||!media.object_key.startsWith(`${w.target_account_id}/`)||media.object_key.split('/').some(p=>p==='.'||p==='..'))throw new Error("Invalid media ownership");
        await this.storage.purgeForLab!(media.object_key);
        if(await this.storage.existsForLab!(media.object_key))throw new Error("Media readback still present");
      }
      failure="data_cleanup_failed";
      await inTransaction(this.pool,async client=>{
        // Same canonical lock order as stop and password admission: the
        // Lab-stop advisory key first, then the workspace row, then rows.
        await client.query(`SELECT pg_advisory_xact_lock(${labStopAuthorityKeySQL})`,[w.target_account_id]);
        const current=(await client.query<WorkspaceRow>("SELECT * FROM lab_test_workspaces WHERE id=$1 FOR UPDATE",[id])).rows[0];
        if(!current||current.state!=="deleting")return;
        const currentTables=await this.tables(client);
        if(currentTables.join("\0")!==tables.join("\0")||current.target_account_id!==w.target_account_id||
          current.media_scope_hash!==w.media_scope_hash||JSON.stringify(current.media_manifest)!==JSON.stringify(w.media_manifest))throw new Error("Cleanup scope changed");
        const unsettled=Number((await client.query<{n:string}>("SELECT count(*) AS n FROM lab_test_workspace_media_writes WHERE workspace_id=$1 AND state<>'settled'",[id])).rows[0]!.n);
        if(unsettled>0){failure="media_unsettled";throw new Error("A media write became unsettled");}
        // Preserve the only outstanding broker-cleanup identities before the
        // wipe removes their source rows: the cleanup ledger (control scope)
        // survives so external OAuth credentials can still be removed.
        const externalPending = await recordLabStopCleanup(client, w.target_account_id, id, w.target_user_id);
        // A single statement preserves the existing NO ACTION FK contract while
        // deleting the mutually referring account graph. Never disable constraints.
        await client.query("SELECT set_config('talent_signal.lab_cleanup_account',$1,true)",[w.target_account_id]);
        const targets=[...tables,"sessions"];
        await client.query(`WITH ${targets.map((t,i)=>`d${i} AS (DELETE FROM "${t}" WHERE account_id=$1 RETURNING 1)`).join(",")}
          SELECT ${targets.map((_,i)=>`(SELECT count(*) FROM d${i})`).join("+")} AS removed`,[w.target_account_id]);
        if(await this.dataRows(client,w.target_account_id,tables)!==0)throw new Error("Test data readback not empty");
        const sessions=Number((await client.query<{n:string}>("SELECT count(*) AS n FROM sessions WHERE account_id=$1",[w.target_account_id])).rows[0]!.n);
        if(sessions!==0)throw new Error("Test credentials not removed");
        await client.query("DELETE FROM lab_test_workspace_media_writes WHERE workspace_id=$1",[id]);
        // Honest claim: local data deletion is verified by readback, but the
        // workspace is not "deleted" while external broker cleanup is still
        // pending; reconciliation finalizes it when every cleanup confirms.
        await client.query("UPDATE lab_test_workspaces SET state=$2,deleted_at=CASE WHEN $3=0 THEN now() ELSE deleted_at END,cleanup_error=NULL,media_manifest='[]'::jsonb,external_cleanup_pending=$3 WHERE id=$1",[id,externalPending===0?"deleted":"deleting",externalPending]);
      });
    }catch{
      await this.pool.query("UPDATE lab_test_workspaces SET cleanup_error=$2 WHERE id=$1 AND state='deleting'",[id,failure]);
    }
  }

  async stop(auth:AuthContext,id:string,stopId:string):Promise<LabWorkspace> {
    await this.row(this.pool,auth,id);
    await this.beginStop(id,stopId,"manual",auth);await this.clean(id);return this.read(auth,id);
  }
  /** Operator-owned run stop: access is revoked before verified cleanup. The
   * caller has already verified exact operator ownership of the run. */
  async stopOperatorRun(id:string,stopId:string):Promise<void> {
    await this.beginStop(id,stopId,"manual");await this.clean(id);
  }
  async sweep():Promise<void> {
    const rows=(await this.pool.query<{id:string}>(`SELECT id FROM lab_test_workspaces
      WHERE state='deleting' OR (state='active' AND expires_at<=clock_timestamp()) ORDER BY created_at LIMIT 10`)).rows;
    for(const row of rows){await this.beginStop(row.id,randomUUID(),"expired");await this.clean(row.id);}
  }
}
