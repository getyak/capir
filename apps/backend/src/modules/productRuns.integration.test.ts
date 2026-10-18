import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureProductStep, captureObservationContent, withProductRunCapture } from "@talent-signal/agent";
import { registerProductRunMonitoring, ProductRunService } from "./productRuns.js";
import { inTransaction } from "../database/pool.js";
import { saveProductRunOutput, productRunSink, metadataOnlyProductSpan, cleanupProductRunSources } from "./productRunStorage.js";
import type { AuthContext } from "./auth.js";

const database = process.env.PRODUCT_RUN_TEST_DATABASE_URL;
if (database && (!['127.0.0.1','localhost'].includes(new URL(database).hostname) || !['/get23_proof','/lab_regression_ci','/get9_eval','/opik_capture_test','/get37_trace_isolated'].includes(new URL(database).pathname)))
  throw new Error('Use the owned get23_proof disposable database.');
const pool = database ? new Pool({ connectionString: database, max: 6 }) : null;
const auth: AuthContext = { accountId: randomUUID(), accountSlug: `runs-${randomUUID()}`, userId: randomUUID(),
  userEmail: 'runs@example.test', userKind: 'simulated_human', sessionId: randomUUID() };
const app = Fastify();
let service: ProductRunService;
let heldStarted: (()=>void) | undefined;
let heldRelease: Promise<void> | undefined;
let arrived=0; let release:()=>void; const barrier=new Promise<void>(resolve=>{release=resolve;});
beforeAll(async () => {
  if (!pool) return;
  await pool.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'GET23 isolated test')",[auth.accountId,auth.accountSlug]);
  await pool.query("INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'GET23','simulated_human')",[auth.userId,auth.accountId,auth.userEmail]);
  const authenticate = async (request: import('fastify').FastifyRequest) => { request.auth = auth; };
  registerProductRunMonitoring(app,pool,authenticate);
  app.post('/v1/chat/tasks',{preHandler:authenticate},async request => {
    const input=request.body as { task_id:string; fail?:boolean; concurrent?:boolean; held?:boolean; secret?:string };
    if(input.concurrent) return inTransaction(pool!, async client=>{
      await client.query('SELECT 1'); arrived++; if(arrived===6) release(); await barrier;
      return captureProductStep('transaction.answer','context',{},async()=>({task_id:input.task_id,blocks:[{body:'transaction done'}]}));
    });
    return captureProductStep('test.answer','context',{ objective:'Test concurrent capture', memory:input.secret},async()=> {
      if(input.held) { heldStarted?.(); await heldRelease; throw new Error('HARNESS_SOURCE_CHANGED: '+input.secret); }
      if(input.fail) throw new Error('synthetic provider failure');
      return {task_id:input.task_id,blocks:[{title:'Answer',body:'Wednesday is tentative.\nAsk "which date".'}]};
    });
  });
  await app.ready(); service=new ProductRunService(pool);
},30_000);
afterAll(async()=>{await app.close();await pool?.end();});
const suite=database?describe:describe.skip;
suite('product runs and durable feedback',()=>{
  async function run(platform='web',fail=false){
    const id=randomUUID(),payload={task_id:id,idempotency_key:randomUUID(),objective:'Clarify the date',fail};
    const response=await app.inject({method:'POST',url:'/v1/chat/tasks',headers:{'x-talent-signal-platform':platform},payload});
    return {id,payload,response};
  }
  it('captures every request before any vote, including failure and isolated concurrent spans',async()=>{
    const [web,ios,failed]=await Promise.all([run(),run('ios'),run('web',true)]);
    expect(failed.response.statusCode).toBe(500);
    const all=await service.list(auth,{});expect(all.counts).toEqual({all:3,helpful:0,unhelpful:0,unrated:3});
    for(const result of [web,ios]){
      const detail=await service.detail(auth,result.id,true);expect(detail.run.feedback.sentiment).toBeNull();
      expect(detail.spans).toHaveLength(1);expect(detail.output).toEqual(result.response.json());
    }
    expect((await service.detail(auth,failed.response.headers['x-talent-signal-run-id'] as string)).run.status).toBe('failed');
    await expect(service.detail({...auth,userId:randomUUID()},web.id,true)).rejects.toMatchObject({statusCode:404});
    // Native JSONEncoder may reorder object keys between exact-intent retries.
    await app.inject({method:'POST',url:'/v1/chat/tasks',headers:{'x-talent-signal-platform':'web'},payload:Object.fromEntries(Object.entries(web.payload).reverse())});
    expect((await service.list(auth,{})).counts.all).toBe(3);
    expect((await service.detail(auth,web.id,true)).run.attempts).toBe(2);
  });
  it('does not exhaust the connection pool while every admitted handler owns a transaction',async()=>{
    const results=await Promise.all(Array.from({length:6},()=>app.inject({method:'POST',url:'/v1/chat/tasks',
      payload:{task_id:randomUUID(),idempotency_key:randomUUID(),objective:'Concurrent transaction',concurrent:true}})));
    expect(results.map(result=>result.statusCode)).toEqual(Array(6).fill(200));
  },30_000);
  it('retracts monitor content when canonical screenshot-followup lineage is withdrawn',async()=>{
    const fixture=await run();
    await pool!.query('INSERT INTO agent_session_retracted_tasks(account_id,task_id) VALUES($1,$2)',[auth.accountId,fixture.id]);
    const detail=await service.detail(auth,fixture.id,true);expect(detail.run.content_available).toBe(false);expect(detail.output).toBeNull();
  });
  it('saves helpful/unhelpful/withdrawal and preserves exact retry and version history',async()=>{
    const fixture=await run();let detail=await service.detail(auth,fixture.id,true);
    const operation={idempotency_key:randomUUID(),expected_revision:0,output_hash:detail.run.output_hash!,sentiment:'helpful' as const,reasons:['new_insight'],comment:'Useful',correction:'',selected_text:'tentative.\nAsk "which date"'};
    detail=await service.react(auth,fixture.id,operation,'web');expect(detail.run.feedback.revision).toBe(1);
    expect((await service.react(auth,fixture.id,operation,'web')).history).toHaveLength(1);
    await expect(service.react(auth,fixture.id,{...operation,idempotency_key:randomUUID()},'ios')).rejects.toMatchObject({code:'FEEDBACK_CHANGED'});
    detail=await service.react(auth,fixture.id,{...operation,idempotency_key:randomUUID(),expected_revision:1,sentiment:'unhelpful',reasons:['incorrect_information']},'ios');
    expect(detail.run.feedback.sentiment).toBe('unhelpful');expect(detail.history[0]!.platform).toBe('ios');
    detail=await service.react(auth,fixture.id,{...operation,idempotency_key:randomUUID(),expected_revision:2,sentiment:null,reasons:[],comment:'',selected_text:''},'web');
    expect(detail.run.feedback.sentiment).toBeNull();expect(detail.history).toHaveLength(3);
    expect(detail.history[1]!.output).toEqual(fixture.response.json());
  });
  it('hides direct screenshot content when its canonical context expires',async()=>{
    const fixture=await run('ios');
    await pool!.query(`INSERT INTO screenshot_contact_tasks(id,account_id,created_by_user_id,idempotency_key,request_hash,input_manifest,state,status)
      VALUES($1,$2,$3,$4,$5,'{}','{}','completed')`,[fixture.id,auth.accountId,auth.userId,randomUUID(),'a'.repeat(64)]);
    expect((await service.detail(auth,fixture.id,true)).run.content_available).toBe(true);
    await pool!.query("UPDATE screenshot_contact_tasks SET expires_at=now()-interval '1 second' WHERE id=$1",[fixture.id]);
    const detail=await service.detail(auth,fixture.id,true);
    expect(detail.run.content_available).toBe(false);expect(detail.output).toBeNull();expect(detail.spans).toEqual([]);
  });
  it('rejects wrong passages and invalid reason labels, and expires source content',async()=>{
    const fixture=await run();const detail=await service.detail(auth,fixture.id,true);
    const operation={idempotency_key:randomUUID(),expected_revision:0,output_hash:detail.run.output_hash!,sentiment:'helpful' as const,reasons:[],comment:'',correction:'',selected_text:'not part of this answer'};
    await expect(service.react(auth,fixture.id,operation,'web')).rejects.toMatchObject({code:'FEEDBACK_SELECTION_INVALID'});
    await expect(service.react(auth,fixture.id,{...operation,reasons:['wrong_memory']},'web')).rejects.toMatchObject({code:'FEEDBACK_REASON_INVALID'});
    await pool!.query("UPDATE product_runs SET expires_at=now()-interval '1 second' WHERE id=$1",[detail.run.id]);
    const gone=await service.detail(auth,fixture.id,true);expect(gone.output).toBeNull();expect(gone.spans).toEqual([]);expect(gone.run.content_available).toBe(false);
    await expect(service.react(auth,fixture.id,{...operation,selected_text:''},'web')).rejects.toMatchObject({code:'PRODUCT_RUN_EXPIRED'});
  });
  it('keeps newer asynchronous output, resets a rating when the answer changes, and freezes history',async()=>{
    const fixture=await run();let detail=await service.detail(auth,fixture.id,true);
    await pool!.query("UPDATE product_runs SET task_kind='screenshot' WHERE id=$1",[detail.run.id]);
    await saveProductRunOutput(pool!,{id:detail.run.id,taskID:fixture.id},{task_id:fixture.id,revision:2,summary:'First answer'},'completed');
    detail=await service.detail(auth,fixture.id,true);
    await service.react(auth,fixture.id,{idempotency_key:randomUUID(),expected_revision:0,output_hash:detail.run.output_hash!,sentiment:'helpful',reasons:[],comment:'',correction:'',selected_text:''},'web');
    await saveProductRunOutput(pool!,{id:detail.run.id,taskID:fixture.id},{task_id:fixture.id,revision:3,summary:'Revised answer'},'completed');
    await saveProductRunOutput(pool!,{id:detail.run.id,taskID:fixture.id},{task_id:fixture.id,revision:1,summary:'Stale answer'},'running');
    detail=await service.detail(auth,fixture.id,true);expect(detail.output).toMatchObject({revision:3});expect(detail.run.feedback.sentiment).toBeNull();
    expect(detail.history[0]!.output).toMatchObject({summary:'First answer'});
  });
  it('keeps paused and revoked failed context out of durable monitoring, including late spans',async()=>{
    const marker='synthetic-revoked-memory-'+randomUUID();
    let arrived!:()=>void,release!:()=>void;
    const started=new Promise<void>(resolve=>{arrived=resolve;});
    heldStarted=arrived;heldRelease=new Promise<void>(resolve=>{release=resolve;});
    const taskID=randomUUID();
    const pending=app.inject({method:'POST',url:'/v1/chat/tasks',payload:{task_id:taskID,idempotency_key:randomUUID(),objective:marker,secret:marker,held:true}}).then(value=>value);
    await started;
    const run=(await pool!.query<{id:string}>("SELECT id FROM product_runs WHERE account_id=$1 AND status='running' ORDER BY created_at DESC LIMIT 1",[auth.accountId])).rows[0]!;
    const during=await service.detail(auth,run.id);
    expect(during.run.content_available).toBe(false);expect(during.input).toBeNull();expect(during.output).toBeNull();
    // A real source-retraction trigger advances the account generation while execution is paused.
    await pool!.query('INSERT INTO agent_session_retracted_tasks(account_id,task_id) VALUES($1,$2)',[auth.accountId,taskID]);
    release();const response=await pending;expect(response.statusCode).toBe(500);
    const failed=await service.detail(auth,run.id);expect(failed.run.status).toBe('failed');
    expect(failed.input).toBeNull();expect(failed.output).toBeNull();expect(JSON.stringify(failed)).not.toContain(marker);
    const sink=productRunSink(pool!,run.id,error=>{throw error;});
    const timestamp=new Date().toISOString();
    await sink.append({id:randomUUID(),parent_id:null,name:'late.tool',kind:'tool',status:'completed',started_at:timestamp,finished_at:timestamp,
      input:captureObservationContent(marker,1000),output:captureObservationContent(marker,1000),metadata:{},error:null});
    await sink.flush();
    const rows=await pool!.query("SELECT row_to_json(r)::text AS body FROM product_runs r WHERE id=$1 UNION ALL SELECT span::text FROM product_run_spans WHERE run_id=$1",[run.id]);
    expect(JSON.stringify(rows.rows)).not.toContain(marker);
    heldStarted=undefined;heldRelease=undefined;
  });
  it('restores an in-flight event removed by cleanup only after its exact source is admitted',async()=>{
    const fixture=await run();const detail=await service.detail(auth,fixture.id,true);
    const generation=(await pool!.query<{source_generation:string}>('SELECT source_generation FROM product_runs WHERE id=$1',[detail.run.id])).rows[0]!.source_generation;
    const sink=productRunSink(pool!,detail.run.id,error=>{throw error;},generation);
    await withProductRunCapture(sink,()=>captureProductStep('host.context','context',{objective:'synthetic pending context'},async()=>({observed:true})));
    // Deterministically reproduce the cleanup tick that previously lost an early event.
    await expect.poll(async()=>Number((await pool!.query("SELECT count(*) AS n FROM product_run_spans WHERE run_id=$1 AND span->>'name'='host.context'",[detail.run.id])).rows[0].n)).toBe(1);
    await pool!.query('DELETE FROM product_run_spans WHERE run_id=$1',[detail.run.id]);
    await sink.flush();
    const restored=await service.detail(auth,fixture.id,true);
    expect(restored.spans).toHaveLength(1);
    expect(restored.spans[0]!.input.value).toEqual({objective:'synthetic pending context'});
    const revoked=productRunSink(pool!,detail.run.id,error=>{throw error;},generation);
    await withProductRunCapture(revoked,()=>captureProductStep('revoked.context','context',{secret:'synthetic revoked context'},async()=>({observed:true})));
    await expect.poll(async()=>Number((await pool!.query("SELECT count(*) AS n FROM product_run_spans WHERE run_id=$1 AND span->>'name'='revoked.context'",[detail.run.id])).rows[0].n)).toBe(1);
    await pool!.query('INSERT INTO agent_session_retracted_tasks(account_id,task_id) VALUES($1,$2)',[auth.accountId,fixture.id]);
    await pool!.query('DELETE FROM product_run_spans WHERE run_id=$1',[detail.run.id]);
    await revoked.flush();
    expect((await pool!.query('SELECT id FROM product_run_spans WHERE run_id=$1',[detail.run.id])).rows).toEqual([]);
  });
  it('never revives deleted candidate context or delayed spans when a screenshot checkpoint advances',async()=>{
    const fixture=await run();const person=randomUUID(),marker='synthetic-deleted-candidate-'+randomUUID();
    const initial=await service.detail(auth,fixture.id,true);
    await pool!.query("INSERT INTO subjects(id,account_id,external_ref,display_label) VALUES($1::uuid,$2,$1::text,$3)",[person,auth.accountId,marker]);
    await pool!.query(`INSERT INTO screenshot_contact_tasks(id,account_id,created_by_user_id,idempotency_key,request_hash,input_manifest,state,status)
      VALUES($1,$2,$3,$4,$5,'{}','{}','running')`,[fixture.id,auth.accountId,auth.userId,randomUUID(),'a'.repeat(64)]);
    await pool!.query("UPDATE product_runs SET task_kind='screenshot' WHERE id=$1",[initial.run.id]);
    await saveProductRunOutput(pool!,{id:initial.run.id,taskID:fixture.id},{task_id:fixture.id,revision:2,summary:marker},'running');
    const generation=(await pool!.query<{source_generation:string}>('SELECT source_generation FROM product_runs WHERE id=$1',[initial.run.id])).rows[0]!.source_generation;
    const sink=productRunSink(pool!,initial.run.id,error=>{throw error;},generation);
    await withProductRunCapture(sink,()=>captureProductStep('search_contact','tool',{},async()=>
      (await pool!.query('SELECT display_label FROM subjects WHERE id=$1',[person])).rows));
    await sink.flush();
    const before=await service.detail(auth,fixture.id,true);expect(JSON.stringify(before.spans)).toContain(marker);
    await service.react(auth,fixture.id,{idempotency_key:randomUUID(),expected_revision:0,output_hash:before.run.output_hash!,
      sentiment:'unhelpful',reasons:[],comment:marker,correction:'',selected_text:''},'web');
    const late=productRunSink(pool!,initial.run.id,error=>{throw error;},generation);
    // The provider has already consumed this result when its source is deleted.
    await withProductRunCapture(late,()=>captureProductStep('late.search','tool',{},async()=>({candidate:marker})));
    await pool!.query('DELETE FROM subjects WHERE id=$1',[person]);
    expect((await service.detail(auth,fixture.id,true)).run.content_available).toBe(false);
    await saveProductRunOutput(pool!,{id:initial.run.id,taskID:fixture.id},{task_id:fixture.id,revision:1,summary:'stale'},'running');
    expect((await service.detail(auth,fixture.id,true)).run.content_available).toBe(false);
    await saveProductRunOutput(pool!,{id:initial.run.id,taskID:fixture.id},{task_id:fixture.id,revision:3,summary:'Current canonical checkpoint'},'running');
    await late.flush();
    const after=await service.detail(auth,fixture.id,true);expect(after.run.content_available).toBe(true);
    expect(after.output).toMatchObject({revision:3});expect(JSON.stringify(after)).not.toContain(marker);
    const stored=await pool!.query("SELECT span::text AS content FROM product_run_spans WHERE run_id=$1 UNION ALL SELECT row_to_json(e)::text FROM product_run_feedback_events e WHERE run_id=$1",[initial.run.id]);
    expect(JSON.stringify(stored.rows)).not.toContain(marker);
    // A current directory checkpoint can be newer than the monitor's last output.
    await pool!.query('UPDATE screenshot_contact_tasks SET revision=4 WHERE id=$1',[fixture.id]);
    await saveProductRunOutput(pool!,{id:initial.run.id,taskID:fixture.id},{task_id:fixture.id,revision:3,summary:marker},'running');
    const lateOutput=await pool!.query('SELECT output FROM product_runs WHERE id=$1',[initial.run.id]);
    expect(JSON.stringify(lateOutput.rows)).not.toContain(marker);
  });
  it('keeps the shared bounded usage diagnostics when cleanup strips failed source content',async()=>{
    // Last on purpose: cleanup is account-wide and every earlier fixture keeps its own assertions.
    const fixture=await run('web',true);
    const runID=fixture.response.headers['x-talent-signal-run-id'] as string;
    const timestamp=new Date().toISOString();
    const full={id:randomUUID(),parent_id:null,name:'harness.sdk.assistant',kind:'llm',started_at:timestamp,finished_at:timestamp,status:'completed',
      input:captureObservationContent({objective:'synthetic private body'},2000),
      output:captureObservationContent({content:[{text:'synthetic private answer'}]},2000),
      metadata:{model:'claude-sonnet-5',provider:'claude-agent-sdk',input_tokens:12,output_tokens:4,duration_ms:33020,
        sdk_message_id:'synthetic-raw-sdk-id',
        usage:{input_tokens:12,output_tokens:4,cache_read_input_tokens:7,cache_creation_input_tokens:2,source:'provider'},
        sdk_message_id_sha256:'a'.repeat(64),sdk_input_tokens:12,sdk_output_tokens:4,sdk_cache_read_input_tokens:7,
        sdk_cache_creation_input_tokens:2,sdk_total_input_tokens:21,
        sdk_usage_basis:'per_message_provider_reported_input_excludes_cache',sdk_stop_reason:null,
        synthetic_nested:{secret:'synthetic nested secret'},synthetic_unrecognized:'synthetic unrecognized key'},
      error:null};
    await pool!.query('INSERT INTO product_run_spans(id,run_id,span) VALUES($1,$2,$3::jsonb)',[full.id,runID,JSON.stringify(full)]);
    await cleanupProductRunSources(pool!);
    const row=(await pool!.query<{span:unknown}>('SELECT span FROM product_run_spans WHERE id=$1',[full.id])).rows[0];
    // cleanupSQL and the read-side projection retain one shared key list.
    expect(row?.span).toEqual(metadataOnlyProductSpan(full));
    const serialized=JSON.stringify(row?.span??null);
    expect(serialized).not.toContain('synthetic private body');
    expect(serialized).not.toContain('synthetic private answer');
    expect(serialized).not.toContain('synthetic-raw-sdk-id');
    expect(serialized).not.toContain('synthetic nested secret');
    expect(serialized).not.toContain('synthetic unrecognized key');
  });

});
