import {createHash,randomUUID} from "node:crypto";
import type {RemoteChatAnswerRequest} from "./chatAnswerProvider.js";
import type {RunArtifact,RunFileAdmission} from "@talent-signal/agent";
import type {DatabaseClient} from "../database/pool.js";
import type {AuthContext} from "./auth.js";
import {ApiError} from "../lib/apiError.js";
import {assertHarnessLabAuthority} from "./harnessSourceGuard.js";

const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const unavailable=()=>new ApiError(410,"RUN_ARTIFACT_UNAVAILABLE","This file's source is no longer available. Create it again from current evidence.");
type Pending={receipt:RunArtifact;content:string;source_file_ids:string[]};
export async function createHarnessRunFiles(database:DatabaseClient,auth:AuthContext,input:RemoteChatAnswerRequest,
  manifestID:string,sessionID:string|undefined,sourceTaskIDs:readonly string[],previousRun?:{id:string;expiresAt:Date}) {
  if(!input.assertCurrent||input.mode==="unscoped_conversation"||input.observation?.source_refs?.kind!=="product")return undefined;
  const assertCurrent=input.assertCurrent;
  await assertCurrent();
  const evidenceReview=(await database.query<{id:string;review_status:string;attribution_status:string}>(
    "SELECT id,review_status,attribution_status FROM evidence_fragments WHERE account_id=$1 AND id=ANY($2::uuid[]) AND status='active' ORDER BY id",
    [auth.accountId,input.allowed_citation_ids])).rows;
  if(evidenceReview.length!==new Set(input.allowed_citation_ids).size||evidenceReview.some(row=>row.review_status!=="reviewed"||row.attribution_status!=="confirmed"))return undefined;
  const content=JSON.stringify({authority:"governed_snapshot_not_execution_permission",evidence_review:evidenceReview,
    status_meaning:"evidence_review is the reviewed excerpt and speaker. Each block.status concerns relationship state or interpretation; proposed does not mean the source excerpt is unreviewed.",blocks:input.context_blocks});
  if(!input.context_blocks.length||Buffer.byteLength(content)>240_000)return undefined;
  const generation=(await database.query<{generation:string}>("SELECT generation FROM harness_source_generations WHERE account_id=$1",[auth.accountId])).rows[0]?.generation;
  if(generation===undefined)return undefined;
  const sourceImages=(await database.query<{task_id:string;image_index:number;content_hash:string;expires_at:Date}>(
    `SELECT i.task_id,i.image_index,i.content_hash,i.expires_at FROM contact_task_images i
     JOIN screenshot_contact_tasks t ON t.account_id=i.account_id AND t.id=i.task_id
     WHERE i.account_id=$1 AND i.task_id=ANY($2::uuid[]) AND t.created_by_user_id=$3 AND i.status='stored'`,
  [auth.accountId,[...sourceTaskIDs],auth.userId])).rows;
  const parentAuthority=(await database.query<{identity_expiry:Date|null;session_authority:unknown}>(`SELECT
    (SELECT min(valid_until) FROM identity_handles WHERE account_id=$1 AND subject_id=ANY($2::uuid[]) AND status='confirmed') AS identity_expiry,
    (SELECT jsonb_build_object('person_id',payload->>'personID','context_id',payload->>'relationshipContextID',
      'turn_hashes',COALESCE((SELECT jsonb_agg(encode(sha256(convert_to(turn::text,'UTF8')),'hex'))
        FROM jsonb_array_elements(payload->'turns') turn),'[]'::jsonb))
      FROM agent_sessions WHERE account_id=$1 AND created_by_user_id=$3 AND id=$4 AND deleted_at IS NULL) AS session_authority`,
    [auth.accountId,input.observation.source_refs.person_ids,auth.userId,sessionID??null])).rows[0]!;
  if(sessionID&&!parentAuthority.session_authority)throw unavailable();
  const expiresAt=new Date(Math.min(parentAuthority.identity_expiry?.valueOf()??Infinity,previousRun?.expiresAt.valueOf()??Infinity,Date.parse(input.observation.source_refs.expires_at),...sourceImages.map(i=>i.expires_at.valueOf())));
  const files=[{id:randomUUID(),name:"relationship-memory.json",media_type:"application/json" as const,content,
    content_hash:hash(content),evidence_ids:[...input.allowed_citation_ids]}];
  const pending:Pending[]=[];
  const admission:RunFileAdmission={files,assertCurrent,saveArtifact:async(file,signal)=>{
    signal.throwIfAborted();await assertCurrent();
    if(pending.length>=3||file.source_file_ids.some(id=>!files.some(f=>f.id===id))||!file.source_file_ids.length
      ||Buffer.byteLength(file.content)>64_000||!/^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,83}$/u.test(file.name))throw new Error("RUN_ARTIFACT_INVALID");
    const receipt={id:randomUUID(),name:file.name,media_type:file.media_type,byte_size:Buffer.byteLength(file.content),
      content_hash:hash(file.content),expires_at:expiresAt.toISOString()};
    pending.push({receipt,content:file.content,source_file_ids:[...file.source_file_ids]});return {...receipt};
  }};
  return {admission,receipts:()=>pending.map(p=>({...p.receipt})),persist:async()=>{
    await assertCurrent();
    for(const {receipt,content,source_file_ids} of pending)await database.query(`INSERT INTO harness_run_artifacts
      (id,account_id,user_id,manifest_id,session_id,source_generation,source_images,source_files,name,media_type,content,content_hash,byte_size,expires_at,session_authority,previous_run_id)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)`,
      [receipt.id,auth.accountId,auth.userId,manifestID,sessionID??null,generation,
        JSON.stringify(sourceImages.map(({expires_at,...image})=>image)),JSON.stringify(files.filter(f=>source_file_ids.includes(f.id)).map(({content,...file})=>file)),
        receipt.name,receipt.media_type,content,receipt.content_hash,receipt.byte_size,expiresAt,JSON.stringify(parentAuthority.session_authority),previousRun?.id??null]);
    await assertCurrent();
  }};
}

export async function purgeUnavailableRunArtifacts(database:DatabaseClient){
  await database.query("UPDATE harness_run_artifacts SET content=NULL,name='unavailable',source_files='[]',source_images='[]' WHERE content IS NOT NULL AND NOT harness_run_artifact_available(id)");
}
export async function listHarnessRunArtifacts(database:DatabaseClient,auth:AuthContext,taskID:string):Promise<RunArtifact[]>{
  await assertHarnessLabAuthority(database,auth);
  return (await database.query<RunArtifact>(`SELECT a.id,a.name,a.media_type,a.byte_size,a.content_hash,a.expires_at::text
    FROM harness_run_artifacts a JOIN context_manifests m ON m.account_id=a.account_id AND m.id=a.manifest_id
    WHERE a.account_id=$1 AND a.user_id=$2 AND m.task_id=$3 AND harness_run_artifact_available(a.id) ORDER BY a.created_at,a.id`,
  [auth.accountId,auth.userId,taskID])).rows.map(row=>({...row,expires_at:new Date(row.expires_at).toISOString()}));
}
export async function readHarnessRunArtifact(database:DatabaseClient,auth:AuthContext,taskID:string,artifactID:string){
  await assertHarnessLabAuthority(database,auth);
  const row=(await database.query<{id:string;name:string;media_type:string;content:string;content_hash:string}>(`SELECT a.id,a.name,a.media_type,a.content,a.content_hash
    FROM harness_run_artifacts a JOIN context_manifests m ON m.account_id=a.account_id AND m.id=a.manifest_id
    WHERE a.id=$1 AND a.account_id=$2 AND a.user_id=$3 AND m.task_id=$4 AND harness_run_artifact_available(a.id)`,
  [artifactID,auth.accountId,auth.userId,taskID])).rows[0];
  if(!row||hash(row.content)!==row.content_hash)throw unavailable();
  await assertHarnessLabAuthority(database,auth,"recheck");
  if(!(await database.query<{available:boolean}>("SELECT harness_run_artifact_available($1) AS available",[row.id])).rows[0]?.available)throw unavailable();
  return row;
}
