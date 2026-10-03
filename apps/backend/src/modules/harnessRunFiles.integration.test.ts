import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,it,expect} from "vitest";
import {Pool} from "pg";
import {ClaudeChatProvider,claudeHarnessConfiguration} from "@talent-signal/agent";
import {buildApp} from "../app.js";
import {compileRelationshipWiki} from "./wiki.js";
import type {AuthContext} from "./auth.js";
import {LabWorkspaceService} from "./labWorkspaces.js";
import {LocalChatMediaStorage} from "./chatMediaStorage.js";
import {createChatTask} from "./chat.js";
import {mutateAgentSession} from "./agentSessions.js";
import {purgeUnavailableRunArtifacts} from "./harnessRunFiles.js";
const database=process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if(database&&!["localhost","127.0.0.1"].includes(new URL(database).hostname))throw new Error("Use an owned disposable loopback database.");
const pool=database?new Pool({connectionString:database,max:6}):null;
const auth:AuthContext={accountId:randomUUID(),accountSlug:`file-proof-${randomUUID()}`,userId:randomUUID(),
  userEmail:"file-proof@example.test",userKind:"simulated_human",sessionId:randomUUID()};
let app:Awaited<ReturnType<typeof buildApp>>,headers:{authorization:string},otherHeaders:{authorization:string};
let afterTool:(()=>Promise<void>)|undefined;
let script="const data=JSON.parse(input.files[0].text);return {source_blocks:data.blocks.length,status:'derived_unconfirmed'}";
const provider=new ClaudeChatProvider(claudeHarnessConfiguration({ANTHROPIC_API_KEY:"synthetic",TALENT_SIGNAL_AGENT_MODEL:"synthetic"}),async(_configuration,request)=>{
  const inventory=JSON.parse(request.context!).run_files;
  if(!inventory?.length)throw new Error("RUN_FILES_NOT_ADMITTED");
  const receipt=await request.tools.find(t=>t.name==="run_javascript")!.execute({source_file_ids:[inventory[0].id],
    code:script,output_name:"analysis",output_format:"json"},new AbortController().signal);
  if(receipt.isError)throw new Error("COMPUTATION_FAILED");
  await request.tools.find(t=>t.name==="cite_evidence")!.execute({source_ids:JSON.parse(request.context!).allowed_citation_ids.slice(0,1)},new AbortController().signal);
  await afterTool?.();
  return {text:"已根据当前资料生成文件。",structuredOutput:null,sessionID:randomUUID(),inputTokens:10,outputTokens:20,
    estimatedUsd:0.01,turns:1,toolCalls: 2, toolCompletions: [], terminalReason:"completed",permissionDenials:[],reportedModels:["synthetic"]};
});
beforeAll(async()=>{
  if(!pool||!database)return;
  await pool.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic file proof')",[auth.accountId,auth.accountSlug]);
  for(const [id,email] of [[auth.userId,auth.userEmail],[randomUUID(),"other@example.test"]])await pool.query(
    "INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Synthetic file owner','simulated_human')",[id,auth.accountId,email]);
  app=await buildApp({pool,config:{databaseUrl:database,host:"127.0.0.1",port:0,allowedOrigins:[],appleSignInAudiences:[],
    appleSignInEnabled:false,passwordAuthEnabled:false,passwordRegistrationEnabled:false,simulatedAuthEnabled:true,
    internalLabEnabled:false,retentionSweepIntervalMs:60000,sessionTtlSeconds:3600},remoteChatProvider:provider,personResearchProvider:null});
  for(const email of [auth.userEmail,"other@example.test"]){
    const login=await app.inject({method:"POST",url:"/v1/auth/simulated-login",payload:{account_slug:auth.accountSlug,user_email:email,client_label:"file-proof"}});
    expect(login.statusCode,login.body).toBe(200);const h={authorization:`Bearer ${login.json().access_token}`};
    if(email===auth.userEmail)headers=h;else otherHeaders=h;
  }
},30000);
afterAll(async()=>{await app?.close();await pool?.end();});
async function fixture(fixtureAuth=auth){
  const person=randomUUID(),context=randomUUID(),capture=randomUUID(),resource=randomUUID(),fragment=randomUUID();
  await pool!.query("INSERT INTO subjects(id,account_id,external_ref,display_label) VALUES($1::uuid,$2,$1::text,'Synthetic Person')",[person,fixtureAuth.accountId]);
  await pool!.query("INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label) VALUES($1::uuid,$2,$3,$1::text,'Synthetic Context')",[context,fixtureAuth.accountId,person]);
  await pool!.query(`INSERT INTO captures(id,account_id,created_by_user_id,subject_id,assignment_id,source_kind,source_metadata,identity_status,identity_context,purpose)
    VALUES($1,$2,$3,$4,$5,'conversation_transcript','{}','bound','{}','Synthetic file proof')`,[capture,fixtureAuth.accountId,fixtureAuth.userId,person,context]);
  await pool!.query(`INSERT INTO source_resources(id,account_id,capture_id,created_by_user_id,client_resource_id,resource_kind,input_channel,display_name,media_type,observed_at,retention_scope,processing_state)
    VALUES($1::uuid,$2,$3,$4,$1::text,'conversation_transcript','chat','Synthetic source','text/plain',now(),'reviewed_selected_text','ready')`,[resource,fixtureAuth.accountId,capture,fixtureAuth.userId]);
  await pool!.query(`INSERT INTO source_retention_receipts(receipt_id,account_id,capture_id,policy_version,requested_mode,effective_mode,source_scope,source_access_state,source_access_reason,created_at,updated_at)
    VALUES($1,$2,$3,'source-retention.v2','ephemeral','ephemeral','reviewed_selected_text','available','awaiting_review_completion',now(),now())`,[randomUUID(),fixtureAuth.accountId,capture]);
  await pool!.query(`INSERT INTO evidence_fragments(id,account_id,capture_id,resource_id,fragment_kind,sequence,text_content,content_hash,locator,attributed_actor,attribution_status,parser_name,parser_version,review_status)
    VALUES($1,$2,$3,$4,'message',0,'Synthetic source: two preparation hours and five discussion hours.',repeat('a',64),'{"kind":"message","source_message_id":"synthetic-work-log","sequence":0,"speaker_side":"right"}','recruiter','confirmed','fixture','1','reviewed')`,[fragment,fixtureAuth.accountId,capture,resource]);
  await compileRelationshipWiki(pool!,fixtureAuth,person,context,{idempotency_key:randomUUID(),objective:"Compile synthetic file evidence"});
  return {person,context,capture,fragment};
}
async function ask(f:Awaited<ReturnType<typeof fixture>>,key=randomUUID(),extra:Record<string,unknown>={}){
  return app.inject({method:"POST",url:"/v1/chat/tasks",headers,payload:{idempotency_key:key,person_id:f.person,
    relationship_context_id:f.context,...extra,objective:"请把当前授权资料的条目数计算并导出 JSON 文件"}});
}
describe.skipIf(!pool)("scoped file artifact HTTP and PostgreSQL lifecycle",()=>{
  it("returns the real VM result, authenticated download and idempotent replay",async()=>{
    const f=await fixture(),key=randomUUID(),response=await ask(f,key);expect(response.statusCode,response.body).toBe(201);
    const result=response.json();expect(result.artifacts).toHaveLength(1);const artifact=result.artifacts[0];
    expect((await app.inject({method:"GET",url:`/v1/chat/tasks/${result.task_id}/readback`,headers})).statusCode).toBe(200);
    const url=`/v1/chat/tasks/${result.task_id}/artifacts/${artifact.id}`;
    const read=await app.inject({method:"GET",url,headers});expect(read.statusCode,read.body).toBe(200);
    expect(read.json().source_blocks).toBeGreaterThan(0);expect(read.headers["cache-control"]).toBe("no-store");
    expect(read.headers["content-disposition"]).toBe('attachment; filename="analysis.json"');
    expect((await app.inject({method:"GET",url,headers:otherHeaders})).statusCode).toBe(410);
    expect((await app.inject({method:"GET",url})).statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:`/v1/chat/tasks/${randomUUID()}/artifacts/${artifact.id}`,headers})).statusCode).toBe(410);
    const list=await app.inject({method:"GET",url:`/v1/chat/tasks/${result.task_id}/artifacts`,headers});expect(list.json()).toEqual(result.artifacts);
    expect((await ask(f,key)).json().artifacts).toEqual(result.artifacts);
    expect((await pool!.query("SELECT count(*)::int AS count FROM harness_run_artifacts WHERE manifest_id=$1",[result.context_manifest_id])).rows[0].count).toBe(1);
  });
  it("purges content synchronously when source generation changes",async()=>{
    const f=await fixture(),response=await ask(f);expect(response.statusCode,response.body).toBe(201);const result=response.json();
    await pool!.query("UPDATE evidence_fragments SET review_status='rejected' WHERE id=$1",[f.fragment]);
    const id=result.artifacts[0].id;
    expect((await app.inject({method:"GET",url:`/v1/chat/tasks/${result.task_id}/artifacts/${id}`,headers})).statusCode).toBe(410);
    expect((await pool!.query("SELECT content,source_files FROM harness_run_artifacts WHERE id=$1",[id])).rows[0]).toEqual({content:null,source_files:[]});
  });
  it("does not persist staged artifacts after provider failure",async()=>{
    const f=await fixture();afterTool=async()=>{throw new Error("SYNTHETIC_PROVIDER_FAILURE");};
    try{const response=await ask(f);expect(response.statusCode,response.body).toBe(201);const result=response.json();expect(result.artifacts).toBeUndefined();
      expect((await pool!.query("SELECT id FROM harness_run_artifacts WHERE manifest_id=$1",[result.context_manifest_id])).rows).toEqual([]);
    }finally{afterTool=undefined;}
  });
  it("rolls back the entire artifact turn when the source changes during computation",async()=>{
    const f=await fixture();afterTool=async()=>{await pool!.query("UPDATE evidence_fragments SET review_status='rejected' WHERE id=$1",[f.fragment]);};
    try{const response=await ask(f);expect(response.statusCode,response.body).toBe(409);
      expect((await pool!.query("SELECT id FROM context_manifests WHERE subject_id=$1",[f.person])).rows).toEqual([]);
    }finally{afterTool=undefined;}
  });
  it("inherits identity expiry and refuses download without a worker update",async()=>{
    const f=await fixture(),handle=randomUUID(),expiry=new Date(Date.now()+2000);
    await pool!.query(`INSERT INTO identity_handles(id,account_id,subject_id,handle_type,normalized_value_hash,status,valid_until,freshness_policy_version,validity_basis)
      VALUES($1::uuid,$2,$3,'source_native_id',$1::text,'confirmed',$4,'identity-freshness-2026-08-07.v1','policy_default')`,[handle,auth.accountId,f.person,expiry]);
    const response=await ask(f);expect(response.statusCode,response.body).toBe(201);const result=response.json(),artifact=result.artifacts[0];
    expect(Date.parse(artifact.expires_at)).toBeLessThanOrEqual(expiry.valueOf());
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,expiry.valueOf()-Date.now()+10)));
    expect((await app.inject({method:"GET",url:`/v1/chat/tasks/${result.task_id}/artifacts/${artifact.id}`,headers})).statusCode).toBe(410);
    expect((await pool!.query("SELECT status FROM identity_handles WHERE id=$1",[handle])).rows[0].status).toBe("confirmed");
    await purgeUnavailableRunArtifacts(pool!);expect((await pool!.query("SELECT content FROM harness_run_artifacts WHERE id=$1",[artifact.id])).rows[0].content).toBeNull();
  });
  it("preserves appended Session turns but purges on history retraction or scope change",async()=>{
    for(const change of ["retract","scope"]){
      const f=await fixture(),session=randomUUID();
      const payload={id:session,scopeKind:"relationship" as const,personID:f.person,relationshipContextID:f.context,
        personDisplayLabel:"Synthetic Person",contextDisplayLabel:"Synthetic Context",title:"File proof",updatedAt:new Date().toISOString(),isUnread:false,turns:[]};
      await mutateAgentSession(pool!,auth,session,{idempotency_key:randomUUID(),expected_revision:0,payload});
      const first=await ask(f,randomUUID(),{session_id:session});expect(first.statusCode,first.body).toBe(201);
      const result=first.json();
      const turn={id:randomUUID(),objective:"Synthetic first calculation",createdAt:new Date().toISOString(),response:{
        contractVersion:result.contract_version,taskID:result.task_id,contextManifestID:result.context_manifest_id,
        knowledgeSnapshotID:result.knowledge_snapshot_id,disposition:result.disposition,createdAt:result.created_at,
        savedBlocks:result.blocks.map((block:any)=>({...block,citation_dependency_ids:[],requires_user_decision:false}))}};
      await mutateAgentSession(pool!,auth,session,{idempotency_key:randomUUID(),expected_revision:1,payload:{...payload,turns:[turn]}});
      expect((await app.inject({method:"GET",url:`/v1/chat/tasks/${result.task_id}/artifacts/${result.artifacts[0].id}`,headers})).statusCode).toBe(200);
      const second=await ask(f,randomUUID(),{session_id:session});expect(second.statusCode,second.body).toBe(201);
      const next=second.json(),url=`/v1/chat/tasks/${next.task_id}/artifacts/${next.artifacts[0].id}`;
      expect((await app.inject({method:"GET",url,headers})).statusCode).toBe(200);
      if(change==="retract")await pool!.query("UPDATE agent_sessions SET payload=jsonb_set(payload,'{turns}','[]'::jsonb) WHERE id=$1",[session]);
      else await pool!.query("UPDATE agent_sessions SET payload=jsonb_set(payload,'{personID}',to_jsonb($2::text)) WHERE id=$1",[session,randomUUID()]);
      expect((await app.inject({method:"GET",url,headers})).statusCode).toBe(410);
      expect((await pool!.query("SELECT content FROM harness_run_artifacts WHERE id=$1",[next.artifacts[0].id])).rows[0].content).toBeNull();
    }
  });
  it("inherits the previous answer dependency and rejects its later expiry",async()=>{
    const f=await fixture(),first=await ask(f);expect(first.statusCode,first.body).toBe(201);
    const parent=first.json();const second=await ask(f,randomUUID(),{previous_task_id:parent.task_id});
    expect(second.statusCode,second.body).toBe(201);const result=second.json(),id=result.artifacts[0].id;
    const stored=(await pool!.query("SELECT previous_run_id FROM harness_run_artifacts WHERE id=$1",[id])).rows[0];expect(stored.previous_run_id).toBeTruthy();
    await pool!.query("UPDATE product_runs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[stored.previous_run_id]);
    expect((await app.inject({method:"GET",url:`/v1/chat/tasks/${result.task_id}/artifacts/${id}`,headers})).statusCode).toBe(410);
    await purgeUnavailableRunArtifacts(pool!);expect((await pool!.query("SELECT content FROM harness_run_artifacts WHERE id=$1",[id])).rows[0].content).toBeNull();
  });
  it("removes generated file content through the real Lab stop and all-table cleanup",async()=>{
    const workspaceID=randomUUID(),service=new LabWorkspaceService(pool!,new LocalChatMediaStorage(`/tmp/get9-file-lab-${workspaceID}`),3600);
    await pool!.query("INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'Synthetic file Lab',now()+interval '1 hour') ON CONFLICT DO NOTHING",
      [auth.sessionId,auth.accountId,auth.userId,randomUUID()]);
    const workspace=await service.create(auth,{id:workspaceID,duration_hours:1});
    const target={...auth,accountId:workspace.account_id,userId:workspace.user_id,userKind:"lab_human" as const};
    try{
      const f=await fixture(target),result=await createChatTask(pool!,target,{idempotency_key:randomUUID(),person_id:f.person,
        relationship_context_id:f.context,objective:"Export the count of current source blocks as JSON"},provider);
      expect(result.body.artifacts).toHaveLength(1);
      expect((await pool!.query("SELECT content FROM harness_run_artifacts WHERE account_id=$1",[target.accountId])).rows[0].content).toBeTruthy();
      const stopped=await service.stop(auth,workspaceID,randomUUID());
      expect(stopped).toMatchObject({state:"deleted",cleanup_error:null,data_rows:0});
      expect((await pool!.query("SELECT id FROM harness_run_artifacts WHERE account_id=$1",[target.accountId])).rows).toEqual([]);
    }finally{await service.stop(auth,workspaceID,randomUUID());}
  });
  it("denies natural expiry before sweeping and clears retained content on sweep",async()=>{
    const f=await fixture(),key=randomUUID(),response=await ask(f,key);expect(response.statusCode,response.body).toBe(201);const result=response.json(),id=result.artifacts[0].id;
    await pool!.query("UPDATE harness_run_artifacts SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
    expect((await app.inject({method:"GET",url:`/v1/chat/tasks/${result.task_id}/artifacts/${id}`,headers})).statusCode).toBe(410);
    const replay=await ask(f,key);expect(replay.statusCode,replay.body).toBe(410);expect(replay.body).not.toContain(result.artifacts[0].name);expect(replay.body).not.toContain(result.artifacts[0].content_hash);
    await purgeUnavailableRunArtifacts(pool!);expect((await pool!.query("SELECT content FROM harness_run_artifacts WHERE id=$1",[id])).rows[0].content).toBeNull();
    const cached=(await pool!.query("SELECT response_body FROM idempotency_records WHERE account_id=$1 AND idempotency_key=$2",[auth.accountId,key])).rows[0].response_body;
    expect(cached).toEqual({task_id:result.task_id,source_context_unavailable:true});
    expect((await ask(f,key)).statusCode).toBe(409);
  });
});
