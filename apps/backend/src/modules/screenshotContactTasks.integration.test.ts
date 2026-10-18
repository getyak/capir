import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import Fastify from "fastify";
import { Pool } from "pg";
import { ARK_SCREENSHOT_PREPROCESS_MODEL, SCREENSHOT_PREPROCESS_FOLLOW_UP_REGION_LIMIT, ContactResearchToolRequestSchema,
  ArkScreenshotPreprocessor, captureObservationContent, captureProductStep, recordProductEvent, withProductRunCapture } from "@talent-signal/agent";
import type { ContactAgentModel, ContactChatExtraction, ScreenshotContactTaskRequest, ScreenshotPreprocessor } from "@talent-signal/agent";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import { deleteContactCaptureTask, deleteScreenshotPreprocessingSource, linkScreenshotContactTaskCapture, loadBrowserCaptureTask, lookupScreenshotContactReceipt, createScreenshotContactTask, ScreenshotContactTaskRunner, loadScreenshotContactTask, loadContactIntelligence, resumeScreenshotContactTask, cancelScreenshotContactTask, expireScreenshotContactTasks, loadScreenshotContactImage, confirmScreenshotContactProfile } from "./screenshotContactTasks.js";
import { registerProductRunMonitoring, ProductRunService } from "./productRuns.js";
import { registerScreenshotContactRoutes } from "./screenshotContactRoutes.js";
import { cleanupProductRunSources, productRunSink, saveProductRunOutput, saveProductRunUsageDiagnostics } from "./productRunStorage.js";
import type { AuthContext } from "./auth.js";
import type { ChatMediaStorage } from "./chatMediaStorage.js";
import { executeGrantedContactArchive, restoreContactArchive } from "./contactArchive.js";
import { createHarnessEvidenceImageReader } from "./harnessEvidenceImages.js";
import { createChatTask } from "./chat.js";
import { compileRelationshipWiki } from "./wiki.js";
import { reviewEvidenceFragment } from "./resources.js";
import { deleteCapture } from "./captures.js";
import { purgeContactImagesForCapture } from "./contactTaskImages.js";
import { createResourceCapture } from "./resourceIntake.js";

const database=process.env.CONTACT_AGENT_TEST_DATABASE_URL;
const pool=database?new Pool({connectionString:database,connectionTimeoutMillis:30_000,max:4,idleTimeoutMillis:0}):null;
const auth:AuthContext={accountId:"10000000-0000-4000-8000-000000000001",accountSlug:"fixture-alpha",userId:"10000000-0000-4000-8000-000000000011",userEmail:"recruiter@alpha.local",userKind:"simulated_human",sessionId:randomUUID()};
afterAll(async()=>{await pool?.end();});
// Establish the Docker transport before measuring product operations. On macOS
// the initial forwarded-port handshake can exceed the per-test operation budget.
beforeAll(async()=>{
  if(!pool)return;
  const clients=await Promise.all(Array.from({length:4},()=>pool.connect()));
  try{await Promise.all(clients.map(client=>client.query("SELECT 1")));}finally{clients.forEach(client=>client.release());}
},30_000);

function sdkModel(run: NonNullable<ContactAgentModel["run"]>): ContactAgentModel {
  return { run, extract: vi.fn(async()=>{throw new Error("UNEXPECTED_OCR_PREPASS");}),
    next: vi.fn(async()=>{throw new Error("UNEXPECTED_OUTER_MODEL_LOOP");}) };
}
const sdkReceipt = () => ({ providerRequestID:randomUUID(),model:"synthetic-sdk",inputTokens:10,outputTokens:10 });

function observePersonLock(base:Pool,personID:string,hooks:{before?:()=>void;after?:()=>void|Promise<void>}):Pool{
  const lockKey=`${auth.accountId}:screenshot-contact-person:${personID}`;
  return new Proxy(base,{get(target,key){
    if(key!=="connect"){const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}
    return async()=>{
      const client=await target.connect();
      return new Proxy(client,{get(connection,property){
        if(property!=="query"){const value=Reflect.get(connection,property);return typeof value==="function"?value.bind(connection):value;}
        return async(...args:any[])=>{
          const matches=typeof args[0]==="string"&&args[0].includes("pg_advisory_xact_lock")&&args[1]?.[0]===lockKey;
          if(matches)hooks.before?.();
          const result=await (connection.query as (...input:any[])=>Promise<unknown>)(...args);
          if(matches)await hooks.after?.();
          return result;
        };
      }});
    };
  }}) as Pool;
}

describe.skipIf(!pool)("GET-9 SDK screenshot authority",()=>{
  it("denies queued original-image reads after a clarification while permitting final SDK usage bookkeeping", async () => {
    const request=input();const created=await createScreenshotContactTask(pool!,auth,request);
    const operation=vi.fn(async()=>"private-derived-pixels");
    let rejected:unknown;let afterRejected:Awaited<ReturnType<typeof loadScreenshotContactTask>>|undefined;
    const sdk=sdkModel(async(admission,signal)=>{
      expect(await admission.readImage(operation,signal)).toBe("private-derived-pixels");
      rejected=await admission.invoke("ask_contact_clarification",{question:"Which author?\\nPlease select."},signal);
      afterRejected=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
      const transition=admission.invoke("ask_contact_clarification",{question:"Which visible author is the selected contact?"},signal);
      const queued=admission.readImage(operation,signal);
      const rejection=expect(queued).rejects.toMatchObject({code:"CONTACT_TASK_LEASE_LOST"});
      await transition;await rejection;await admission.assertCurrent();return sdkReceipt();
    });
    try {
      await new ScreenshotContactTaskRunner(pool!,{model:sdk,research:null}).start(auth,created.body.task_id,request.image);
      expect(rejected).toMatchObject({error:"CONTACT_QUESTION_ESCAPED_TEXT"});
      expect(afterRejected).toMatchObject({status:"running",question:null});
      expect(operation).toHaveBeenCalledOnce();
      const final=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
      expect(final.status).toBe("waiting_for_user");expect(final.capture_id).toBeNull();
      const state=(await pool!.query("SELECT state FROM screenshot_contact_tasks WHERE id=$1",[created.body.task_id])).rows[0]!.state;
      expect(state.model_receipts).toHaveLength(1);expect(JSON.stringify(state)).not.toContain("private-derived-pixels");
    } finally {await pool!.query("DELETE FROM screenshot_contact_tasks WHERE id=$1",[created.body.task_id]);}
  });

  it("withholds an in-flight original-image result if the user cancels before processing finishes",async()=>{
    const request=input();const created=await createScreenshotContactTask(pool!,auth,request);let processed=false;
    const sdk=sdkModel(async(admission,signal)=>{
      await expect(admission.readImage(async()=>{
        const current=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
        await cancelScreenshotContactTask(pool!,auth,created.body.task_id,current.revision);processed=true;return "private-derived-pixels";
      },signal)).rejects.toMatchObject({code:"CONTACT_TASK_LEASE_LOST"});
      throw new Error("CONTACT_TASK_LEASE_LOST");
    });
    try {
      await new ScreenshotContactTaskRunner(pool!,{model:sdk,research:null}).start(auth,created.body.task_id,request.image);
      expect(processed).toBe(true);
      const final=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
      expect(final.status).toBe("cancelled");expect(JSON.stringify(final)).not.toContain("private-derived-pixels");
    } finally {await pool!.query("DELETE FROM screenshot_contact_tasks WHERE id=$1",[created.body.task_id]);}
  });

  it("files exact reviewed profile text through the SDK without inventing image or confirmed-profile authority",async()=>{
    const name=`SDK text ${randomUUID().slice(0,8)}`,text=`${name}\n\nworks at Example Labs.`;
    const request={idempotency_key:randomUUID(),objective:"File the reviewed source",text,captured_at:new Date().toISOString(),allow_public_research:false,source:{kind:"page_text",title:"Synthetic profile",url:"https://example.com/profile"}};
    const created=await createScreenshotContactTask(pool!,auth,request);
    const model=sdkModel(async(input,signal)=>{
      expect(input.text).toBe(text);expect(input.images).toEqual([]);
      await input.recordUnderstanding([{platform:"Web",conversation_kind:"not_chat",contact_name:name,identity_clues:[{kind:"company",value:"Example Labs",source_excerpt:"Example Labs"}],messages:[],uncertainties:[]}],signal);
      await input.invoke("search_contacts",{query:name},signal);
      const filed=await input.invoke("create_contact",{display_name:name},signal) as {contact?:unknown};expect(filed.contact).toBeTruthy();
      await input.invoke("finish_contact_task",{summary:"Saved the reviewed source as proposed evidence.",findings:[],limitations:[]},signal);
      return sdkReceipt();
    });
    await new ScreenshotContactTaskRunner(pool!,{model,research:null}).start(auth,created.body.task_id);
    const done=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(done.status).toBe("completed");expect(done.extraction?.messages.map(m=>m.text)).toEqual([name,"works at Example Labs."]);
    const fragments=(await pool!.query("SELECT text_content,locator FROM evidence_fragments WHERE capture_id=$1 ORDER BY sequence",[done.capture_id])).rows;
    expect(fragments.map(fragment=>fragment.locator)).toEqual([
      {kind:"document_text",paragraph:1,section_label:`UTF-16 [0,${name.length})`},
      {kind:"document_text",paragraph:2,section_label:`UTF-16 [${name.length+2},${text.length})`},
    ]);
    expect(done.source_images??[]).toEqual([]);expect(done.reviewed_profile).toBeUndefined();
    expect(done.extraction?.messages[0]?.source_image_index).toBeUndefined();
    // Simulate a process stopping after governed deletion commits, before the
    // final task transaction. Migration 048 scrubs derivatives in that commit.
    await deleteCapture(pool!,auth,done.capture_id!,{idempotency_key:`delete-contact-source:${done.task_id}`,reason:"User deleted this captured source and its derived analysis."});
    const scrubbed=(await pool!.query("SELECT status,state,input_manifest FROM screenshot_contact_tasks WHERE id=$1",[done.task_id])).rows[0];
    expect(scrubbed).toEqual({status:"deleted",state:{},input_manifest:{}});
    expect((await pool!.query("SELECT count(*)::int AS count FROM contact_profile_observations WHERE task_id=$1",[done.task_id])).rows[0].count).toBe(0);
    const deleted=await deleteContactCaptureTask(pool!,auth,done.task_id,done.revision);expect(deleted.status).toBe("deleted");
  });

  it("rejects selecting a different person after read_contact is checkpointed",async()=>{
    const name=`Checkpointed scope ${randomUUID().slice(0,8)}`,seed=input();
    const seeded=await createScreenshotContactTask(pool!,auth,seed);
    await new ScreenshotContactTaskRunner(pool!,{model:model(name),research:null}).start(auth,seeded.body.task_id,seed.image);
    const person=await loadScreenshotContactTask(pool!,auth,seeded.body.task_id);
    const request=input(),base=model(name);
    const staged:ContactAgentModel={...base,next:async(arg,signal)=>{
      if((arg.state as {contact:unknown}).contact)return {calls:[{id:randomUUID(),name:"ask_contact_clarification",
        arguments:{question:"Confirm the relationship before saving."}}],providerRequestID:randomUUID(),model:"fixture-tools",inputTokens:10,outputTokens:10};
      return base.next(arg,signal);
    }};
    const created=await createScreenshotContactTask(pool!,auth,request);
    await new ScreenshotContactTaskRunner(pool!,{model:staged,research:null}).start(auth,created.body.task_id,request.image);
    const waiting=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(waiting).toMatchObject({status:"waiting_for_user",capture_id:null,
      contact:{person_id:person.contact!.person_id,relationship_context_id:person.contact!.relationship_context_id}});
    const cancelled=await cancelScreenshotContactTask(pool!,auth,waiting.task_id,waiting.revision);
    const otherPerson=randomUUID(),otherContext=randomUUID();
    await pool!.query("INSERT INTO subjects(id,account_id,external_ref,display_label) VALUES($1::uuid,$2,$1::text,'Other person')",
      [otherPerson,auth.accountId]);
    await pool!.query("INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label) VALUES($1::uuid,$2,$3,$1::text,'Other context')",
      [otherContext,auth.accountId,otherPerson]);
    await expect(resumeScreenshotContactTask(pool!,auth,cancelled.task_id,{expected_revision:cancelled.revision,
      selected_person_id:otherPerson,selected_relationship_context_id:otherContext}))
      .rejects.toMatchObject({code:"CONTACT_TASK_SCOPE_AMBIGUOUS"});
    const persisted=(await pool!.query("SELECT status,state FROM screenshot_contact_tasks WHERE id=$1",[cancelled.task_id])).rows[0]!;
    expect(persisted.status).toBe("cancelled");expect(persisted.state.response.capture_id).toBeNull();
    expect(persisted.state.response.contact.person_id).toBe(person.contact!.person_id);
  });

  it("requires human selection before filing text against a single substring namesake",async()=>{
    const name=`Text namesake ${randomUUID().slice(0,8)}`,person=randomUUID(),context=randomUUID();
    await pool!.query("INSERT INTO subjects(id,account_id,external_ref,display_label) VALUES($1::uuid,$2,$1::text,$3)",[person,auth.accountId,`${name} unrelated`]);
    await pool!.query("INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label) VALUES($1::uuid,$2,$3,$1::text,'Synthetic context')",[context,auth.accountId,person]);
    const text=`${name} works at Example Labs.`;
    const created=await createScreenshotContactTask(pool!,auth,{idempotency_key:randomUUID(),objective:"File source",text,captured_at:new Date().toISOString(),allow_public_research:false,source:{kind:"page_text",title:"Synthetic profile",url:"https://example.com/profile"}});
    const scope={person_id:person,relationship_context_id:context};
    const model=sdkModel(async(input,signal)=>{
      await input.recordUnderstanding([{platform:"Web",conversation_kind:"not_chat",contact_name:name,identity_clues:[{kind:"company",value:"Example Labs",source_excerpt:"Example Labs"}],messages:[],uncertainties:[]}],signal);
      const search=await input.invoke("search_contacts",{query:name},signal) as {candidates:unknown[]};expect(search.candidates).toHaveLength(1);
      expect(await input.invoke("read_contact",scope,signal)).toMatchObject({status:"waiting_for_user"});
      return sdkReceipt();
    });
    await new ScreenshotContactTaskRunner(pool!,{model,research:null}).start(auth,created.body.task_id);
    const waiting=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(waiting.status).toBe("waiting_for_user");expect(waiting.contact).toBeNull();expect(waiting.capture_id).toBeNull();
    expect(waiting.candidates[0]).toMatchObject(scope);
    await resumeScreenshotContactTask(pool!,auth,waiting.task_id,{expected_revision:waiting.revision,selected_person_id:person,selected_relationship_context_id:context});
    const selectedModel=sdkModel(async(input,signal)=>{
      await input.invoke("read_contact",scope,signal);
      await input.invoke("save_contact_chat",scope,signal);
      await input.invoke("finish_contact_task",{summary:"Saved to the explicitly selected person.",findings:[],limitations:[]},signal);
      return sdkReceipt();
    });
    await new ScreenshotContactTaskRunner(pool!,{model:selectedModel,research:null}).start(auth,waiting.task_id);
    const done=await loadScreenshotContactTask(pool!,auth,waiting.task_id);
    expect(done.status).toBe("completed");expect(done.contact).toMatchObject({...scope,disposition:"reused"});
    await deleteContactCaptureTask(pool!,auth,done.task_id,done.revision);
  });

  it("fails closed on invented SDK text and finishes no-person text without filing",async()=>{
    for(const invented of [false,true]){
      const created=await createScreenshotContactTask(pool!,auth,{idempotency_key:randomUUID(),objective:"Read source",text:"Weather overview",captured_at:new Date().toISOString(),source:{kind:"selected_text",title:"Weather",url:""},allow_public_research:false});
      const model=sdkModel(async(input,signal)=>{
        await input.recordUnderstanding([{platform:"Web",conversation_kind:"not_chat",contact_name:invented?"Invented Person":null,identity_clues:[],messages:[],uncertainties:[]}],signal);
        return sdkReceipt();
      });
      await new ScreenshotContactTaskRunner(pool!,{model,research:null}).start(auth,created.body.task_id);
      const done=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
      expect(done.status).toBe(invented?"failed":"completed");expect(done.contact).toBeNull();expect(done.capture_id).toBeNull();
      if(invented)expect(done.limitations).toContain("CONTACT_TEXT_EXTRACTION_NOT_SOURCE_GROUNDED");
      await deleteContactCaptureTask(pool!,auth,done.task_id,done.revision);
    }
  });

  it("recovers a lost image receipt by original key without another task or cross-owner access", async () => {
    const request = input();
    const created = await createScreenshotContactTask(pool!, auth, request);
    try {
      const recovered = await lookupScreenshotContactReceipt(pool!, auth, request.idempotency_key);
      expect(recovered.task_id).toBe(created.body.task_id);
      await expect(lookupScreenshotContactReceipt(pool!, {...auth, userId: randomUUID()}, request.idempotency_key)).rejects.toMatchObject({statusCode:404});
      await expect(lookupScreenshotContactReceipt(pool!, {...auth, accountId: randomUUID()}, request.idempotency_key)).rejects.toMatchObject({statusCode:404});
      const rows = await pool!.query("SELECT count(*)::int AS count FROM screenshot_contact_tasks WHERE account_id=$1 AND created_by_user_id=$2 AND idempotency_key=$3", [auth.accountId, auth.userId, request.idempotency_key]);
      expect(rows.rows[0].count).toBe(1);
      await pool!.query("UPDATE screenshot_contact_tasks SET status='deleted',state='{}',input_manifest='{}' WHERE id=$1", [created.body.task_id]);
      expect(await lookupScreenshotContactReceipt(pool!, auth, request.idempotency_key)).toEqual({task_id:created.body.task_id,status:"deleted"});
    } finally { await pool!.query("DELETE FROM screenshot_contact_tasks WHERE id=$1", [created.body.task_id]); }
  });

  it("clears deleted directory candidates and cached observations while keeping the original screenshot task resumable",async()=>{
    const person=randomUUID(),context=randomUUID(),marker=`Deleted candidate ${randomUUID()}`;
    await pool!.query("INSERT INTO subjects(id,account_id,external_ref,display_label) VALUES($1::uuid,$2,$1::text,$3)",[person,auth.accountId,marker]);
    await pool!.query("INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label) VALUES($1::uuid,$2,$3,$1::text,'Synthetic context')",[context,auth.accountId,person]);
    const created=await createScreenshotContactTask(pool!,auth,input());
    const task=created.body.task_id;
    try {
      const candidate={person_id:person,relationship_context_id:context,display_name:marker,relationship_label:'Synthetic context'};
      const stored=(await pool!.query('SELECT state FROM screenshot_contact_tasks WHERE id=$1',[task])).rows[0]!.state;
      stored.response.status='waiting_for_user';stored.response.candidates=[candidate];
      stored.searches=[{query:'Synthetic',candidates:[candidate]}];stored.observations=[{tool:'search_contacts',result:{candidates:[candidate]}}];
      await pool!.query("UPDATE screenshot_contact_tasks SET state=$2::jsonb,status='waiting_for_user' WHERE id=$1",[task,JSON.stringify(stored)]);
      const before=await loadScreenshotContactTask(pool!,auth,task);expect(JSON.stringify(before)).toContain(marker);
      await pool!.query('DELETE FROM assignments WHERE id=$1',[context]);
      await pool!.query('DELETE FROM subjects WHERE id=$1',[person]);
      const after=await loadScreenshotContactTask(pool!,auth,task);
      expect(after.status).toBe('waiting_for_user');expect(after.candidates).toEqual([]);expect(after.revision).toBeGreaterThan(before.revision);
      expect(JSON.stringify(after)).not.toContain(marker);
      const current=(await pool!.query('SELECT state,input_manifest FROM screenshot_contact_tasks WHERE id=$1',[task])).rows[0]!;
      expect(current.state.searches).toEqual([]);expect(current.state.observations).toEqual([]);
      expect(current.input_manifest.image).toBeDefined();
      await expect(resumeScreenshotContactTask(pool!,auth,task,{expected_revision:before.revision,selected_person_id:person,selected_relationship_context_id:context}))
        .rejects.toMatchObject({code:'CONTACT_TASK_REVISION_CHANGED'});
      expect((await resumeScreenshotContactTask(pool!,auth,task,{expected_revision:after.revision})).status).toBe('running');
    } finally {
      await pool!.query('DELETE FROM screenshot_contact_tasks WHERE id=$1',[task]);
      await pool!.query('DELETE FROM assignments WHERE id=$1',[context]);await pool!.query('DELETE FROM subjects WHERE id=$1',[person]);
    }
  });

  it("stages an editable profile without writing a person, then reuses its confirmed account after review",async()=>{
    const name=`Profile draft ${randomUUID().slice(0,8)}`;const handle=`sdk-${randomUUID()}`;
    const profile:ContactChatExtraction={platform:"Synthetic social",conversation_kind:"not_chat",contact_name:name,
      identity_clues:[{kind:"name",value:name,source_excerpt:name},{kind:"handle",value:handle,source_excerpt:handle},
        {kind:"company",value:"Old example",source_excerpt:"Old example"}],messages:[],uncertainties:[]};
    const sdk=sdkModel(async(request,signal)=>{await request.recordUnderstanding([profile],signal);return sdkReceipt();});
    const runner=new ScreenshotContactTaskRunner(pool!,{model:sdk,research:null});
    let personID:string|undefined;
    for(let index=0;index<2;index++){
      const request={...input(),browser_source:{title:"Synthetic reviewed profile",locator:"https://example.com/profile"}};
      const created=await createScreenshotContactTask(pool!,auth,request);await runner.start(auth,created.body.task_id,request.image);
      const draft=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
      expect(draft.status).toBe("waiting_for_user");expect(draft.contact).toBeNull();expect(draft.capture_id).toBeNull();
      expect(draft.contact_draft?.fields[2]?.source_excerpt).toBe("Old example");
      expect((await pool!.query("SELECT id FROM subjects WHERE account_id=$1 AND display_label=$2",[auth.accountId,name])).rowCount).toBe(index);
      const confirmation={expected_revision:draft.revision,decision:"save_reviewed_profile",display_name:name,
        fields:draft.contact_draft!.fields.map(f=>({clue_index:f.clue_index,value:f.kind==="company"?"Reviewed example":f.value}))};
      await expect(confirmScreenshotContactProfile(pool!,auth,draft.task_id,{...confirmation,expected_revision:draft.revision-1})).rejects.toMatchObject({code:"CONTACT_TASK_REVISION_CHANGED"});
      const saved=await confirmScreenshotContactProfile(pool!,auth,draft.task_id,confirmation);
      expect(saved.status).toBe("completed");expect(saved.message_count).toBe(0);expect(saved.contact_draft).toBeUndefined();
      if(index===0)personID=saved.contact!.person_id;
      expect(saved.contact!.person_id).toBe(personID);expect(saved.contact!.disposition).toBe(index?"reused":"created");
      expect(saved.extraction!.identity_clues[2]!.source_excerpt).toBe("Old example");
      expect(saved.reviewed_profile?.fields[2]).toMatchObject({value:"Reviewed example",source_excerpt:"Old example"});
      expect((await loadScreenshotContactTask(pool!,auth,saved.task_id)).reviewed_profile).toEqual(saved.reviewed_profile);
      expect((await pool!.query("SELECT input_channel,source_locator FROM source_resources WHERE account_id=$1 AND id=$2",[auth.accountId,saved.source_resource_id])).rows[0])
        .toEqual({input_channel:"browser_extension",source_locator:request.browser_source.locator});
      const stored=await pool!.query("SELECT text_content,review_status,attributed_actor,attribution_status,fragment_kind FROM evidence_fragments WHERE capture_id=$1 ORDER BY sequence",[saved.capture_id]);
      expect(stored.rows).toHaveLength(4);
      expect(stored.rows[3]).toMatchObject({text_content:"Reviewed example",review_status:"reviewed",attributed_actor:"recruiter",attribution_status:"confirmed",fragment_kind:"contact_field"});
      await expect(confirmScreenshotContactProfile(pool!,auth,draft.task_id,confirmation)).rejects.toMatchObject({code:"CONTACT_TASK_REVISION_CHANGED"});
    }
    expect((await pool!.query("SELECT id FROM subjects WHERE account_id=$1 AND display_label=$2",[auth.accountId,name])).rowCount).toBe(1);
  });

  it("keeps actual chat about a website as attributed chat evidence and rejects public references in findings", async () => {
    const name = `Chat website ${randomUUID().slice(0, 8)}`;
    const message = "The website says the launch is Friday. I will send the revised plan tomorrow.";
    const extraction: ContactChatExtraction = { platform: "Synthetic IM", conversation_kind: "direct", contact_name: name,
      identity_clues: [{kind:"name",value:name,source_excerpt:name}],
      messages: [{message_id:"m1",sequence:0,text:message,speaker_side:"left",speaker_label:name,time_text:null}], uncertainties: [] };
    const sdk = sdkModel(async (request, signal) => {
      await request.recordUnderstanding([extraction], signal);
      await request.invoke("search_contacts", {query:name}, signal);
      await request.invoke("create_contact", {display_name:name}, signal);
      const finding = {kind:"commitment",text:`${name} says the website lists Friday for launch and commits to sending the revised plan tomorrow.`,
        message_refs:["m1"],source_excerpt:message,epistemic_status:"inference"};
      await expect(request.invoke("finish_contact_task", {summary:"Synthetic chat filed.",findings:[{...finding,message_refs:["public1"]}],limitations:[]}, signal))
        .resolves.toMatchObject({error:"CONTACT_CITATION_SOURCE_UNAVAILABLE"});
      await request.invoke("finish_contact_task", {summary:"Synthetic chat filed.",findings:[finding],limitations:[]}, signal);
      return sdkReceipt();
    });
    const request=input(), created=await createScreenshotContactTask(pool!,auth,request);
    await new ScreenshotContactTaskRunner(pool!,{model:sdk,research:null}).start(auth,created.body.task_id,request.image);
    const result=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(result.status).toBe("completed");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({kind:"commitment",message_refs:["m1"],source_excerpt:message,epistemic_status:"inference"});
    expect(result.events.some(event=>event.tool==="finish_contact_task"&&event.status==="denied")).toBe(true);
  });

  it("files from the main Agent image understanding and reuses one existing contact",async()=>{
    const name=`SDK reuse ${randomUUID().slice(0,8)}`;
    const original=await model(name).extract(input().image,new AbortController().signal);
    const sdk=sdkModel(async(request,signal)=>{
      expect(request.images).toHaveLength(1);
      await request.recordUnderstanding([original.extraction],signal);
      const search=await request.invoke("search_contacts",{query:name},signal) as {candidates:Array<{person_id:string;relationship_context_id:string}>};
      if(search.candidates.length){
        const candidate=search.candidates[0]!;
        const target={person_id:candidate.person_id,relationship_context_id:candidate.relationship_context_id};
        await request.invoke("read_contact",target,signal);
        await request.invoke("save_contact_chat",target,signal);
      }else await request.invoke("create_contact",{display_name:name},signal);
      await request.invoke("finish_contact_task",{summary:"Synthetic screenshot filed.",findings:[],limitations:[]},signal);
      return sdkReceipt();
    });
    const runner=new ScreenshotContactTaskRunner(pool!,{model:sdk,research:null});
    let person:string|undefined;
    for(let attempt=0;attempt<2;attempt++){
      const request={...input(),browser_source:{title:"Synthetic reviewed chat",locator:"https://example.com/chat"}};
      const created=await createScreenshotContactTask(pool!,auth,request);
      expect((await pool!.query("SELECT input_manifest->'browser_source' AS source FROM screenshot_contact_tasks WHERE account_id=$1 AND id=$2",[auth.accountId,created.body.task_id])).rows[0]?.source).toEqual(request.browser_source);
      await expect(createScreenshotContactTask(pool!,auth,{...request,browser_source:{...request.browser_source,locator:"https://example.com/other"}})).rejects.toMatchObject({code:"CONTACT_TASK_IDEMPOTENCY_CONFLICT"});
      await runner.start(auth,created.body.task_id,request.image);
      const result=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
      expect(result.status,JSON.stringify(result)).toBe("completed");
      if(attempt===0)person=result.contact!.person_id;
      expect(result.contact!.person_id).toBe(person);
      expect(result.contact!.disposition).toBe(attempt===0?"created":"reused");
      expect(result.external_effects).toEqual([]);
      expect((await pool!.query("SELECT input_channel,source_locator FROM source_resources WHERE account_id=$1 AND id=$2",[auth.accountId,result.source_resource_id])).rows[0])
        .toEqual({input_channel:"browser_extension",source_locator:request.browser_source.locator});
    }
    expect(sdk.extract).not.toHaveBeenCalled();expect(sdk.next).not.toHaveBeenCalled();
  });

  it("blocks conflicting per-image identities and rejects a forced selection on resume",async()=>{
    const storage=new TestImageStorage();const request={...input(),additional_images:[input().image]};
    const first=await model("SDK Alice").extract(request.image,new AbortController().signal);
    const second=await model("SDK Bob").extract(request.image,new AbortController().signal);
    const sdk=sdkModel(async(input,signal)=>{await input.recordUnderstanding([first.extraction,second.extraction],signal);return sdkReceipt();});
    const runner=new ScreenshotContactTaskRunner(pool!,{model:sdk,research:null},storage);
    const created=await createScreenshotContactTask(pool!,auth,request,storage);await runner.start(auth,created.body.task_id);
    const waiting=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(waiting.status).toBe("waiting_for_user");expect(waiting.contact).toBeNull();expect(waiting.capture_id).toBeNull();
    await expect(resumeScreenshotContactTask(pool!,auth,waiting.task_id,{expected_revision:waiting.revision,new_contact_name:"SDK Alice"})).rejects.toMatchObject({code:"CONTACT_BATCH_IDENTITY_CONFLICT"});
  });

  it("does not execute a queued contact write after SDK cancellation",async()=>{
    const name=`SDK cancel ${randomUUID().slice(0,8)}`;const request=input();
    const original=await model(name).extract(request.image,new AbortController().signal);
    const created=await createScreenshotContactTask(pool!,auth,request);
    const sdk=sdkModel(async(input,signal)=>{
      await input.recordUnderstanding([original.extraction],signal);
      await input.invoke("search_contacts",{query:name},signal);
      const lock=await pool!.connect();await lock.query("BEGIN");
      await lock.query("SELECT id FROM screenshot_contact_tasks WHERE id=$1 FOR UPDATE",[created.body.task_id]);
      const cancelled=new AbortController();
      const queued=input.invoke("create_contact",{display_name:name},cancelled.signal);
      const rejection=expect(queued).rejects.toThrow("SDK_BUDGET_CANCELLED");
      cancelled.abort(new Error("SDK_BUDGET_CANCELLED"));
      await lock.query("ROLLBACK");lock.release();await rejection;
      throw new Error("SDK_BUDGET_CANCELLED");
    });
    const runner=new ScreenshotContactTaskRunner(pool!,{model:sdk,research:null});
    await runner.start(auth,created.body.task_id,request.image);
    const final=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(final.status).toBe("failed");expect(final.contact).toBeNull();expect(final.capture_id).toBeNull();
    expect((await pool!.query("SELECT id FROM subjects WHERE account_id=$1 AND display_label=$2",[auth.accountId,name])).rowCount).toBe(0);
  });
});
function input():ScreenshotContactTaskRequest{
  const bytes=Buffer.from([137,80,78,71,13,10,26,10,0]);
  return {idempotency_key:randomUUID(),objective:"File this synthetic chat and analyze the evidence.",image:{media_type:"image/png",byte_size:bytes.length,content_hash:createHash("sha256").update(bytes).digest("hex"),data_base64:bytes.toString("base64")},allow_public_research:false,captured_at:new Date().toISOString()};
}
async function createIOSCapture(seed:string,personID:string,contextID:string,discoveredFrom?:{clientResourceID:string;resourceID:string}){
  const observedAt=new Date().toISOString(),clientResourceID=`ios-share:${seed}`;
  return createResourceCapture(pool!,auth,{
    contract_version:CONTRACT_VERSION,idempotency_key:`ios:${seed}:capture`,channel:"ios_share",
    purpose:"Process one recruiter-selected screenshot into proposed relationship evidence",captured_at:observedAt,source_timezone:"UTC",
    person_scope:{status:"confirmed",person_id:personID,relationship_context:{status:"existing",relationship_context_id:contextID},
      binding_basis:"The synthetic recruiter explicitly selected this existing relationship."},
    resource:{client_resource_id:clientResourceID,kind:"conversation_screenshot",display_name:"synthetic.png",media_type:"image/png",
      observed_at:observedAt,source_timezone:"UTC",byte_size:9,source_locator:"ios-share:photosPicker",
      ...(discoveredFrom?{discovered_from_client_resource_id:discoveredFrom.clientResourceID,
        discovered_from_resource_id:discoveredFrom.resourceID}:{}),
      retention:{requested_mode:"ephemeral",source_scope:"proposed_extracted_text"}},
    fragments:[{client_resource_id:clientResourceID,kind:"message",sequence:0,text:"Synthetic linked message",
      locator:{kind:"message",source_message_id:"shared-preprocess-proposed-1",sequence:0,speaker_side:"unknown",source_image_index:0},
      attribution:{actor_kind:"unknown",status:"proposed"},review_status:"proposed",
      parser:{name:"shared-screenshot-preprocess",version:"screenshot-preprocess.v3"}}],
  });
}
function model(name:string,options:{badQuote?:boolean;badStatement?:boolean;group?:boolean;timeText?:string}={}):ContactAgentModel{
  let attemptedBad=false;
  const extraction:ContactChatExtraction={platform:"Synthetic IM",conversation_kind:options.group?"group":"direct",contact_name:name,
    identity_clues:[{kind:"name",value:name,source_excerpt:name}],messages:[{message_id:"m1",sequence:0,text:"I work at Example Labs. I can talk next Tuesday.",speaker_side:"left",speaker_label:name,time_text:options.timeText??null}],uncertainties:["Message date and speaker role are unknown."]};
  return {extract:async()=>({extraction,model:"fixture-vision",providerRequestID:randomUUID(),inputTokens:10,outputTokens:10}),next:async({state,observations})=>{
    const s=state as {contact:{person_id:string;relationship_context_id:string}|null;capture_id:string|null;profile_fields:unknown[]};
    let call:{name:string;arguments:unknown};
    const search=observations.findLast(o=>o.tool==="search_contacts")?.result as {candidates:Array<{person_id:string;relationship_context_id:string}>}|undefined;
    if(options.group)call={name:"ask_contact_clarification",arguments:{question:"Which participant should own this group chat?"}};
    else if(!search)call={name:"search_contacts",arguments:{query:name}};
    else if(!s.contact&&search.candidates.length>1)call={name:"ask_contact_clarification",arguments:{question:"Which contact is this?"}};
    else if(!s.contact&&search.candidates.length===1)call={name:"read_contact",arguments:{person_id:search.candidates[0]!.person_id,relationship_context_id:search.candidates[0]!.relationship_context_id}};
    else if(!s.contact)call={name:"create_contact",arguments:{display_name:name}};
    else if(!s.capture_id)call={name:"save_contact_chat",arguments:{person_id:s.contact.person_id,relationship_context_id:s.contact.relationship_context_id}};
    else if(options.badStatement&&!attemptedBad){attemptedBad=true;call={name:"update_contact",arguments:{person_id:s.contact.person_id,fields:[{field:"company",value:"Example Labs",source_refs:["m1"],source_excerpt:"I work at Example Labs.",epistemic_status:"source_statement"},{field:"professional_background",value:"Led engineering at Example Labs",source_refs:["m1"],source_excerpt:"I work at Example Labs.",epistemic_status:"source_statement"}]}};}
    else if(options.badQuote&&!attemptedBad){attemptedBad=true;call={name:"update_contact",arguments:{person_id:s.contact.person_id,fields:[{field:"company",value:"Invented Ltd",source_refs:["m1"],source_excerpt:"I work at Invented Ltd",epistemic_status:"source_statement"}]}};}
    else if(!s.profile_fields.length)call={name:"update_contact",arguments:{person_id:s.contact.person_id,fields:[{field:"company",value:"Example Labs",source_refs:["m1"],source_excerpt:"I work at Example Labs.",epistemic_status:"source_statement"}]}};
    else call={name:"finish_contact_task",arguments:{summary:"Saved the chat. A call is possible, but its date needs clarification.",findings:[{kind:"open_question",text:"Confirm which Tuesday before scheduling.",message_refs:["m1"],source_excerpt:"I can talk next Tuesday.",epistemic_status:"inference"}],limitations:[]}};
    return {calls:[{id:randomUUID(),...call}],providerRequestID:randomUUID(),model:"fixture-tools",inputTokens:10,outputTokens:10};
  }};
}
describe.skipIf(!pool)("screenshot contact database authority",()=>{
  it("rejects non-literal source statements atomically and recovers with source wording",async()=>{
    const request=input(), created=await createScreenshotContactTask(pool!,auth,request);
    const base=model(`Literal ${randomUUID().slice(0,8)}`,{badStatement:true});let rejectedBatchChecked=false;
    const checked:ContactAgentModel={...base,next:async(arg,signal)=>{
      if(!rejectedBatchChecked&&JSON.stringify(arg.observations).includes("CONTACT_SOURCE_STATEMENT_REQUIRES_LITERAL_VALUE")){
        rejectedBatchChecked=true;
        expect((await pool!.query("SELECT id FROM contact_profile_observations WHERE account_id=$1 AND task_id=$2",[auth.accountId,created.body.task_id])).rowCount).toBe(0);
        expect((arg.state as {profile_fields:unknown[]}).profile_fields).toEqual([]);
      }
      return base.next(arg,signal);
    }};
    await new ScreenshotContactTaskRunner(pool!,{model:checked,research:null}).start(auth,created.body.task_id,request.image);
    expect(rejectedBatchChecked).toBe(true);
    const result=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(result.status).toBe("completed");
    expect(result.profile_fields.map(field=>[field.value,field.epistemic_status])).toEqual([["Example Labs","source_statement"]]);
    expect(result.events.some(event=>event.tool==="update_contact"&&event.status==="denied")).toBe(true);
    const rows=await pool!.query("SELECT observation FROM contact_profile_observations WHERE account_id=$1 AND task_id=$2",[auth.accountId,created.body.task_id]);
    expect(rows.rows.map(row=>row.observation.value)).toEqual(["Example Labs"]);
    expect(JSON.stringify((await pool!.query("SELECT state FROM screenshot_contact_tasks WHERE id=$1",[created.body.task_id])).rows[0].state.observations)).toContain("CONTACT_SOURCE_STATEMENT_REQUIRES_LITERAL_VALUE");
  });

  it("preserves an explicitly labeled supported paraphrase without calling it source wording",async()=>{
    const request=input(),created=await createScreenshotContactTask(pool!,auth,request),base=model(`Paraphrase ${randomUUID().slice(0,8)}`);
    const inferred:ContactAgentModel={...base,next:async(arg,signal)=>{
      const reply=await base.next(arg,signal);
      const call=reply.calls[0];
      if(call?.name==="update_contact")call.arguments={person_id:(arg.state as {contact:{person_id:string}}).contact.person_id,fields:[{field:"professional_background",value:"Reports employment at Example Labs; role is unspecified.",source_refs:["m1"],source_excerpt:"I work at Example Labs.",epistemic_status:"inference"}]};
      return reply;
    }};
    await new ScreenshotContactTaskRunner(pool!,{model:inferred,research:null}).start(auth,created.body.task_id,request.image);
    const result=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(result.status).toBe("completed");expect(result.profile_fields[0]?.epistemic_status).toBe("inference");
    expect(result.profile_fields[0]?.value).toBe("Reports employment at Example Labs; role is unspecified.");
  });

  it.each(["https://example.com/people/synthetic", ""])("files reviewed web text from %s, reconciles duplicates, survives a new runner, and deletes derivatives",async(sourceURL)=>{
    const name=`Web capture proof ${randomUUID().slice(0,8)}`;
    const requestID=randomUUID();const raw=`${name} · Example Labs. I work at Example Labs. I can talk next Tuesday.`;
    const request={idempotency_key:`browser-capture:${requestID}`,objective:"File this source",text:raw,allow_public_research:false,captured_at:new Date().toISOString(),source:{kind:"page_text",title:"Synthetic professional profile",url:sourceURL,time_basis:"captured_at"}};
    const base=model(name);
    const provider:ContactAgentModel={...base,extractText:async()=>{
      const result=await base.extract(input().image,new AbortController().signal);
      return {...result,extraction:{...result.extraction,conversation_kind:"not_chat",identity_clues:[...result.extraction.identity_clues,{kind:"company",value:"Example Labs",source_excerpt:"Example Labs"}]}};
    }};
    const created=await createScreenshotContactTask(pool!,auth,request);
    const receipt=await loadBrowserCaptureTask(pool!,auth,requestID);expect(receipt.task_id).toBe(created.body.task_id);expect(receipt.source_text).toBe(raw);
    const runner=new ScreenshotContactTaskRunner(pool!,{model:provider,research:null});await runner.start(auth,receipt.task_id);
    const done=await loadScreenshotContactTask(pool!,auth,receipt.task_id);expect(done.status).toBe("completed");expect(done.contact?.disposition).toBe("created");expect(done.source?.url).toBe(request.source.url);
    const replay=await createScreenshotContactTask(pool!,auth,request);expect(replay.replayed).toBe(true);expect(replay.body.contact).toEqual(done.contact);
    await expect(createScreenshotContactTask(pool!,auth,{...request,text:"Changed source"})).rejects.toMatchObject({code:"CONTACT_TASK_IDEMPOTENCY_CONFLICT"});
    await expect(loadBrowserCaptureTask(pool!,{...auth,userId:randomUUID()},requestID)).rejects.toMatchObject({code:"CONTACT_TASK_NOT_FOUND"});
    const deleted=await deleteContactCaptureTask(pool!,auth,done.task_id,done.revision);expect(deleted.status).toBe("deleted");expect(deleted.source_text).toBeUndefined();
    const stored=await pool!.query("SELECT state,input_manifest FROM screenshot_contact_tasks WHERE id=$1",[done.task_id]);expect(stored.rows).toEqual([{state:{},input_manifest:{}}]);
    expect((await pool!.query("SELECT status FROM subjects WHERE id=$1",[done.contact!.person_id])).rows[0].status).toBe("deleted");
    await expect(createScreenshotContactTask(pool!,auth,request)).rejects.toMatchObject({code:"CONTACT_TASK_SOURCE_UNAVAILABLE"});
  });
  it("records a no-person result without creating a person and can delete an unbound source",async()=>{
    const base=model("Must not create");const provider:ContactAgentModel={...base,extractText:async()=>({extraction:{platform:"Web",conversation_kind:"not_chat",contact_name:null,identity_clues:[],messages:[],uncertainties:[]},model:"fixture-text",providerRequestID:randomUUID(),inputTokens:1,outputTokens:1}),next:async()=>{throw new Error("No person must not run filing tools");}};
    const task=await createScreenshotContactTask(pool!,auth,{idempotency_key:randomUUID(),text:"A page about weather.",objective:"Read this page",source:{kind:"page_text",title:"Weather",url:"https://example.com/weather"},allow_public_research:false,captured_at:new Date().toISOString()});
    await new ScreenshotContactTaskRunner(pool!,{model:provider,research:null}).start(auth,task.body.task_id);
    const done=await loadScreenshotContactTask(pool!,auth,task.body.task_id);expect(done.status).toBe("completed");expect(done.contact).toBeNull();expect(done.capture_id).toBeNull();
    expect((await deleteContactCaptureTask(pool!,auth,done.task_id,done.revision)).status).toBe("deleted");
  });
  it("continues an exact-revision deletion after its final scrub temporarily fails",async()=>{
    const created=await createScreenshotContactTask(pool!,auth,input());
    const originalRevision=created.body.revision;
    const suffix=randomUUID().replaceAll("-","");
    const trigger=`fail_contact_task_delete_${suffix}`;
    const fn=`fail_contact_task_delete_fn_${suffix}`;
    await pool!.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_FINAL_DELETE_FAILURE'; END $$`);
    await pool!.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON screenshot_contact_tasks
      FOR EACH ROW WHEN (NEW.id = '${created.body.task_id}'::uuid AND NEW.status = 'deleted') EXECUTE FUNCTION ${fn}()`);
    try {
      await expect(deleteContactCaptureTask(pool!,auth,created.body.task_id,originalRevision))
        .rejects.toThrow("SYNTHETIC_FINAL_DELETE_FAILURE");
      const pending=(await pool!.query<{status:string;revision:number;state:{deletion_requested?:boolean}}>(
        "SELECT status,revision,state FROM screenshot_contact_tasks WHERE id=$1",[created.body.task_id])).rows[0]!;
      expect(pending).toMatchObject({status:"cancelled",revision:originalRevision+1,state:{deletion_requested:true}});
    } finally {
      await pool!.query(`DROP TRIGGER IF EXISTS ${trigger} ON screenshot_contact_tasks`);
      await pool!.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
    const deleted=await deleteContactCaptureTask(pool!,auth,created.body.task_id,originalRevision);
    expect(deleted.status).toBe("deleted");
    expect((await pool!.query("SELECT state,input_manifest FROM screenshot_contact_tasks WHERE id=$1",[created.body.task_id])).rows)
      .toEqual([{state:{},input_manifest:{}}]);
  });
  it("creates one contact and exact unreviewed IM, reuses it on a second import, and does not replay writes",async()=>{
    const name=`Contact proof ${randomUUID().slice(0,8)}`;const request=input();
    const runner=new ScreenshotContactTaskRunner(pool!,{model:model(name,{timeText:"next Tuesday"}),research:null});
    const first=await createScreenshotContactTask(pool!,auth,request);await runner.start(auth,first.body.task_id,request.image);
    const result=await loadScreenshotContactTask(pool!,auth,first.body.task_id);
    expect(result.status,JSON.stringify(result)).toBe("completed");expect(result.contact?.disposition).toBe("created");expect(result.message_count).toBe(1);
    const fragments=await pool!.query("SELECT text_content,review_status,attributed_actor,attribution_status,locator FROM evidence_fragments WHERE capture_id=$1",[result.capture_id]);
    expect(fragments.rows).toEqual([{text_content:"I work at Example Labs. I can talk next Tuesday.",review_status:"proposed",attributed_actor:"unknown",attribution_status:"unknown",
      locator:{kind:"message",source_message_id:"m1",sequence:0,speaker_side:"left",speaker_label:name,visible_time_text:"next Tuesday"}}]);
    const retention=await pool!.query("SELECT source_scope FROM source_retention_receipts WHERE capture_id=$1",[result.capture_id]);
    expect(retention.rows).toEqual([{source_scope:"proposed_extracted_text"}]);
    const retry=await createScreenshotContactTask(pool!,auth,request);expect(retry.replayed).toBe(true);expect(retry.body.contact?.person_id).toBe(result.contact?.person_id);
    const secondInput=input();const second=await createScreenshotContactTask(pool!,auth,secondInput);await runner.start(auth,second.body.task_id,secondInput.image);
    const reused=await loadScreenshotContactTask(pool!,auth,second.body.task_id);
    expect(reused.status,JSON.stringify(reused)).toBe("completed");expect(reused.contact?.person_id).toBe(result.contact?.person_id);expect(reused.contact?.disposition).toBe("reused");
    const profile=await loadContactIntelligence(pool!,auth,result.contact!.person_id,result.contact!.relationship_context_id);expect(profile.tasks).toHaveLength(2);
    expect((await pool!.query("SELECT * FROM person_profiles WHERE subject_id=$1",[result.contact?.person_id])).rowCount).toBe(0);
    await expect(loadScreenshotContactTask(pool!,{...auth,accountId:"20000000-0000-4000-8000-000000000001",userId:"20000000-0000-4000-8000-000000000011"},first.body.task_id)).rejects.toMatchObject({code:"CONTACT_TASK_NOT_FOUND"});
    await expect(createScreenshotContactTask(pool!,auth,{...request,objective:"Changed intent"})).rejects.toMatchObject({code:"CONTACT_TASK_IDEMPOTENCY_CONFLICT"});
  });
  it("rejects invented quotations and erases task and profile derivatives when source authorization is revoked",async()=>{
    const request=input();const runner=new ScreenshotContactTaskRunner(pool!,{model:model(`Citation proof ${randomUUID().slice(0,8)}`,{badQuote:true}),research:null});
    const created=await createScreenshotContactTask(pool!,auth,request);await runner.start(auth,created.body.task_id,request.image);
    const before=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(before.profile_fields.map(f=>f.value)).toEqual(["Example Labs"]);expect(before.events.some(e=>e.tool==="update_contact"&&e.status==="denied")).toBe(true);
    await pool!.query("UPDATE source_retention_receipts SET authorization_state='revoked' WHERE capture_id=$1",[before.capture_id]);
    const after=await loadScreenshotContactTask(pool!,auth,created.body.task_id);expect(after.status).toBe("deleted");expect(after.extraction).toBeNull();
    expect((await pool!.query("SELECT * FROM contact_profile_observations WHERE task_id=$1",[created.body.task_id])).rowCount).toBe(0);
    const persisted=await pool!.query("SELECT state,input_manifest FROM screenshot_contact_tasks WHERE id=$1",[created.body.task_id]);expect(persisted.rows).toEqual([{state:{},input_manifest:{}}]);
  });
  it("keeps group-chat ambiguity in the same task without creating a contact",async()=>{
    const request=input();const name=`Group proof ${randomUUID().slice(0,8)}`;const runner=new ScreenshotContactTaskRunner(pool!,{model:model(name,{group:true}),research:null});
    const created=await createScreenshotContactTask(pool!,auth,request);await runner.start(auth,created.body.task_id,request.image);
    const result=await loadScreenshotContactTask(pool!,auth,created.body.task_id);expect(result.status).toBe("waiting_for_user");expect(result.capture_id).toBeNull();expect(result.contact).toBeNull();
  });
  it("archives only the granted current contact, supports reversal, and retracts rejected source derivatives",async()=>{
    const request=input();const runner=new ScreenshotContactTaskRunner(pool!,{model:model(`Archive proof ${randomUUID().slice(0,8)}`),research:null});
    const created=await createScreenshotContactTask(pool!,auth,request);await runner.start(auth,created.body.task_id,request.image);
    const task=await loadScreenshotContactTask(pool!,auth,created.body.task_id);expect(task.status,JSON.stringify(task)).toBe("completed");
    await expect(executeGrantedContactArchive(pool!,auth,{person_id:task.contact!.person_id,expected_revision:99,idempotency_key:randomUUID(),decision:"archive"})).rejects.toMatchObject({code:"CONTACT_ARCHIVE_TARGET_CHANGED"});
    const current=await loadContactIntelligence(pool!,auth,task.contact!.person_id,task.contact!.relationship_context_id);
    const archiveIntent={person_id:task.contact!.person_id,expected_revision:current.person_revision!,idempotency_key:randomUUID(),decision:"archive" as const};
    const archived=await executeGrantedContactArchive(pool!,auth,archiveIntent);
    expect((await loadScreenshotContactTask(pool!,auth,created.body.task_id)).status).toBe("deleted");
    const archivedReadback=await loadContactIntelligence(pool!,auth,task.contact!.person_id,task.contact!.relationship_context_id);
    expect(archivedReadback.tasks).toEqual([]);expect(archivedReadback.archive?.operation_id).toBe(archived.operation_id);
    await restoreContactArchive(pool!,auth,archived.operation_id);
    expect((await loadScreenshotContactTask(pool!,auth,created.body.task_id)).contact?.person_id).toBe(task.contact!.person_id);
    const replayTask=await createScreenshotContactTask(pool!,auth,input());
    await pool!.query(`UPDATE screenshot_contact_tasks SET state=jsonb_set(state,'{selected}',$2::jsonb)
      WHERE id=$1`,[replayTask.body.task_id,JSON.stringify({person_id:task.contact!.person_id,
        relationship_context_id:task.contact!.relationship_context_id})]);
    const replayFences:string[]=[];
    const replay=await executeGrantedContactArchive(pool!,auth,archiveIntent,taskIDs=>replayFences.push(...taskIDs));
    expect(replay).toMatchObject({operation_id:archived.operation_id,status:"restored",replayed:true});
    expect(replayFences).toEqual([]);
    expect((await pool!.query("SELECT status FROM screenshot_contact_tasks WHERE id=$1",[replayTask.body.task_id])).rows[0]?.status).toBe("running");
    await pool!.query("UPDATE evidence_fragments SET review_status='rejected' WHERE capture_id=$1",[task.capture_id]);
    expect((await loadScreenshotContactTask(pool!,auth,created.body.task_id)).extraction).toBeNull();
    expect((await pool!.query("SELECT * FROM contact_profile_observations WHERE task_id=$1",[task.task_id])).rowCount).toBe(0);
  });
  it("recovers an uncheckpointed image only with the same bytes and fences an in-flight cancelled call",async()=>{
    const request=input();const real=model(`Recovery proof ${randomUUID().slice(0,8)}`);
    const created=await createScreenshotContactTask(pool!,auth,request);
    const runner=new ScreenshotContactTaskRunner(pool!,{model:real,research:null});
    await runner.start(auth,created.body.task_id);
    const waiting=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(waiting.status).toBe("waiting_for_user");expect(waiting.capture_id).toBeNull();
    const different=input();different.image.data_base64=Buffer.from([137,80,78,71,13,10,26,10,1]).toString("base64");different.image.content_hash=createHash("sha256").update(Buffer.from(different.image.data_base64,"base64")).digest("hex");
    await expect(resumeScreenshotContactTask(pool!,auth,waiting.task_id,{expected_revision:waiting.revision,image:different.image})).rejects.toMatchObject({code:"CONTACT_IMAGE_INTEGRITY_MISMATCH"});
    await resumeScreenshotContactTask(pool!,auth,waiting.task_id,{expected_revision:waiting.revision,image:request.image});
    let release!:()=>void;let reached!:()=>void;
    const paused=new Promise<void>(r=>{release=r;});const entered=new Promise<void>(r=>{reached=r;});
    const slow:ContactAgentModel={...real,extract:async(...args)=>{reached();await paused;return real.extract(...args);}};
    const slowRunner=new ScreenshotContactTaskRunner(pool!,{model:slow,research:null});
    const running=slowRunner.start(auth,waiting.task_id,request.image);await entered;
    const current=await loadScreenshotContactTask(pool!,auth,waiting.task_id);
    await cancelScreenshotContactTask(pool!,auth,current.task_id,current.revision);release();await running;
    const cancelled=await loadScreenshotContactTask(pool!,auth,current.task_id);expect(cancelled.status).toBe("cancelled");expect(cancelled.capture_id).toBeNull();expect(cancelled.extraction).toBeNull();
    await resumeScreenshotContactTask(pool!,auth,cancelled.task_id,{expected_revision:cancelled.revision,image:request.image});
    await runner.start(auth,cancelled.task_id,request.image);
    expect((await loadScreenshotContactTask(pool!,auth,cancelled.task_id)).status).toBe("completed");
  });
  it("rejects model-requested deletion and private search without dispatch, then completes useful authorized work",async()=>{
    const request={...input(),allow_public_research:true};const base=model(`Injection proof ${randomUUID().slice(0,8)}`);let step=0;let dispatches=0;
    const injected:ContactAgentModel={...base,next:async(arg,signal)=>{
      const state=arg.state as {capture_id:string|null;contact:{person_id:string}|null};
      if(state.capture_id&&step<2){const call=step++===0?{name:"delete_contact",arguments:{person_id:state.contact!.person_id}}:{name:"search_contact_public",arguments:{channels:["web"],query:"I can talk next Tuesday private salary 100000",results_per_channel:3}};
        return {calls:[{id:randomUUID(),...call}],model:"fixture-tools",providerRequestID:randomUUID(),inputTokens:1,outputTokens:1};}
      return base.next(arg,signal);
    }};
    const runner=new ScreenshotContactTaskRunner(pool!,{model:injected,research:{execute:async()=>{dispatches++;throw new Error("UNEXPECTED_DISPATCH");}}});
    const created=await createScreenshotContactTask(pool!,auth,request);await runner.start(auth,created.body.task_id,request.image);
    const result=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(result.status,JSON.stringify(result)).toBe("completed");expect(dispatches).toBe(0);
    expect(result.events.filter(e=>e.status==="denied").map(e=>e.tool)).toEqual(["delete_contact","search_contact_public"]);
    expect((await pool!.query("SELECT status FROM subjects WHERE id=$1",[result.contact!.person_id])).rows[0].status).toBe("active");
    await pool!.query("UPDATE screenshot_contact_tasks SET expires_at=now()-interval '1 second' WHERE id=$1",[result.task_id]);
    await expireScreenshotContactTasks(pool!);
    const expired=await loadScreenshotContactTask(pool!,auth,result.task_id);expect(expired.status).toBe("deleted");expect(expired.profile_fields).toEqual([]);
    expect((await pool!.query("SELECT state,input_manifest FROM screenshot_contact_tasks WHERE id=$1",[result.task_id])).rows[0]).toEqual({state:{},input_manifest:{}});
  });

  it.each(["fetch_contact_source", "browse_contact_source"] as const)("resolves %s short references to source provenance and stores the canonical URL",async(readTool)=>{
    const name=`Public proof ${randomUUID().slice(0,8)}`;const request={...input(),allow_public_research:true};const base=model(name);let stage=0;
    const sourceID=createHash("sha256").update("exa:https://www.linkedin.com/in/contact-proof").digest("hex");
    const publicModel:ContactAgentModel={...base,extract:async(...args)=>{const result=await base.extract(...args);result.extraction.identity_clues.push({kind:"profile_url",value:"https://www.linkedin.com/in/contact-proof",source_excerpt:"https://www.linkedin.com/in/contact-proof"});return result;},next:async(arg,signal)=>{
      const state=arg.state as {capture_id:string|null;contact:{person_id:string}|null;profile_fields:unknown[]};
      if(state.capture_id&&stage===1)expect(arg.observations.findLast(item=>item.tool==="search_contact_public")?.result).toMatchObject({
        channels:[{channel:"linkedin",status:"ok",result_count:1,truncated:true,error_code:null},
          {channel:"reddit",status:"failed",result_count:0,truncated:false,error_code:"AUTH_FAILED"}],
      });
      if(state.capture_id&&stage<3){const steps=[{name:"search_contact_public",arguments:{channels:["linkedin","reddit"],query:name,results_per_channel:3}},
        {name:readTool,arguments:readTool==="fetch_contact_source"?{source_ids:["public1"]}:{source_id:"public1"}},
        {name:"update_contact",arguments:{person_id:state.contact!.person_id,fields:[{field:"public_profile",value:"https://linkedin.com/in/contact-proof/ — professional profile",source_refs:["public1"],source_excerpt:"Founder at Example Labs.",epistemic_status:"source_statement"}]}}];
        return {calls:[{id:randomUUID(),...steps[stage++]!}],model:"fixture-tools",providerRequestID:randomUUID(),inputTokens:1,outputTokens:1};}
      return base.next(arg,signal);
    }};
    const runner=new ScreenshotContactTaskRunner(pool!,{model:publicModel,research:{execute:async(unparsed)=>{const input=ContactResearchToolRequestSchema.parse(unparsed);return {contract_version:input.contract_version,task_id:input.task_id,call_id:input.call_id,external_effects:[],channels:input.input.operation==="search"?
      [{channel:"linkedin" as const,provider:"exa" as const,status:"ok" as const,result_count:1,truncated:true,error_code:null},
        {channel:"reddit" as const,provider:"tikhub" as const,status:"failed" as const,result_count:0 as const,truncated:false as const,error_code:"AUTH_FAILED" as const}]:[],
      fetch_outcomes:input.input.operation==="fetch"?input.input.sources.map(source=>({source_id:source.source_id,channel:source.channel,
        provider:"exa" as const,status:"ok" as const,error_code:null})):[],
      sources:[{source_id:sourceID,url:"https://www.linkedin.com/in/contact-proof",title:name,text:"Founder at Example Labs.",channel:"linkedin",provider_id:"exa",provider_request_id:"fixture-public",content_hash:"a".repeat(64),retrieved_at:new Date().toISOString(),stage:input.input.operation==="search"?"discovered":"fetched"}]};}}});
    const created=await createScreenshotContactTask(pool!,auth,request);await runner.start(auth,created.body.task_id,request.image);
    const result=await loadScreenshotContactTask(pool!,auth,created.body.task_id);expect(result.status,JSON.stringify(result)).toBe("completed");
    expect(result.profile_fields).toEqual([{field:"public_profile",value:"https://www.linkedin.com/in/contact-proof",source_refs:[sourceID],source_excerpt:"Founder at Example Labs.",epistemic_status:"source_statement"}]);
  });

});

class TestImageStorage implements ChatMediaStorage {
  readonly provider="local" as const;
  readonly labScopeID=randomUUID();
  readonly objects=new Map<string,Uint8Array>();
  puts=0; failPutAt=0; failPurge=false;
  async put(key:string,body:Uint8Array){this.puts++;if(this.puts===this.failPutAt)throw new Error("TEST_UPLOAD_FAILED");this.objects.set(key,body);}
  async get(key:string,contentType:string){const body=this.objects.get(key);if(!body)throw new Error("TEST_MISSING_IMAGE");return {body,contentType};}
  async delete(key:string){this.objects.delete(key);}
  async purge(key:string){if(this.failPurge)throw new Error("TEST_PURGE_FAILED");await this.delete(key);}
}

describe.skipIf(!pool)("durable multi-image contact sources",()=>{
  it("checkpoints pinned preprocessing and does not resend an ordinary original downstream",async()=>{
    const storage=new TestImageStorage();const request=input();let preprocessCalls=0,sdkCalls=0;
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>{preprocessCalls++;return {request_id:`ark-${index}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,input_tokens:11,output_tokens:7,
        source:{source_image_index:index,source_hash:source.content_hash,platform:"WeChat",conversation_kind:"direct",contact_name:"Synthetic preprocessed",
          participants:[{label:"我",side:"right",role_hint:"account_owner",visible_name:null}],
          messages:[{sequence:0,text:"I can talk next Tuesday.",speaker_label:"Synthetic preprocessed",speaker_side:"left",time_text:null}],
          identity_clues:[{kind:"name",value:"Synthetic preprocessed",source_excerpt:"Synthetic preprocessed"}],uncertainties:[],
          follow_up_required:false,follow_up_regions:[],width:100,height:200,
          prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}};}};
    const sdk=sdkModel(async(admission,signal)=>{
      sdkCalls++;expect(admission.images).toEqual([]);expect(admission.preprocessing?.sources).toHaveLength(1);
      await admission.invoke("ask_contact_clarification",{question:"Which visible person should own this source?"},signal);
      return sdkReceipt();
    });
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    const runner=new ScreenshotContactTaskRunner(pool!,{model:sdk,preprocessor,research:null},storage);
    await runner.start(auth,created.body.task_id);
    const waiting=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(waiting).toMatchObject({status:"waiting_for_user",preprocessing:{provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      usage:{input_tokens:11,output_tokens:7}}});
    expect(waiting.events.filter(event=>event.tool==="preprocess_screenshot")).toHaveLength(1);
    const state=(await pool!.query("SELECT state FROM screenshot_contact_tasks WHERE id=$1",[waiting.task_id])).rows[0]!.state;
    expect(JSON.stringify(state)).not.toContain(request.image.data_base64);
    await resumeScreenshotContactTask(pool!,auth,waiting.task_id,{expected_revision:waiting.revision});
    await runner.start(auth,waiting.task_id);
    expect(preprocessCalls).toBe(1);expect(sdkCalls).toBe(2);
  });
  it("denies automatic contact lookup for ungrounded preprocessing identity",async()=>{
    const storage=new TestImageStorage();const request=input();
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>({request_id:`ark-ungrounded-${index}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,input_tokens:3,output_tokens:2,
        source:{source_image_index:index,source_hash:source.content_hash,platform:"WeChat",conversation_kind:"direct",contact_name:"Alice",
          participants:[],messages:[{sequence:0,text:"Visible chat text",speaker_label:null,speaker_side:"unknown",time_text:null}],
          identity_clues:[{kind:"name",value:"Alice",source_excerpt:"Email alice@example.com"},
            {kind:"handle",value:"lin",source_excerpt:"Handle: @lin"},
            {kind:"profile_url",value:"https://example.com/bob",source_excerpt:"Profile https://example.com/bob"}],
          uncertainties:[],follow_up_required:false,follow_up_regions:[],width:100,height:200,
          prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}})};
    const sdk=sdkModel(async(admission,signal)=>{
      expect(admission.preprocessing?.sources[0]).toMatchObject({contact_name:"Alice"});
      expect(admission.preprocessing?.sources[0]?.identity_clues).toEqual([
        {kind:"name",value:"Alice",source_excerpt:"Email alice@example.com"},
        {kind:"handle",value:"lin",source_excerpt:"Handle: @lin"},
        {kind:"profile_url",value:"https://example.com/bob",source_excerpt:"Profile https://example.com/bob"},
      ]);
      expect(await admission.invoke("search_contacts",{query:"Alice"},signal))
        .toMatchObject({error:"CONTACT_SEARCH_NOT_AN_IDENTITY_CLUE"});
      expect(await admission.invoke("search_contacts",{query:"lin"},signal))
        .toMatchObject({error:"CONTACT_SEARCH_NOT_AN_IDENTITY_CLUE"});
      await admission.invoke("ask_contact_clarification",{question:"Which visible person should own this source?"},signal);
      return sdkReceipt();
    });
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    await new ScreenshotContactTaskRunner(pool!,{model:sdk,preprocessor,research:null},storage).start(auth,created.body.task_id);
    const waiting=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(waiting).toMatchObject({status:"waiting_for_user",contact:null,capture_id:null,
      extraction:{contact_name:"Alice",identity_clues:[{kind:"name",value:"Alice",source_excerpt:"Email alice@example.com"},
        {kind:"handle",value:"lin",source_excerpt:"Handle: @lin"},{kind:"profile_url",value:"https://example.com/bob"}]}});
  });

  it("aborts active preprocessing after a deletion fence before provider dispatch",async()=>{
    const storage=new TestImageStorage();const request={...input(),preprocess_only:true as const};
    let entered!:()=>void;const preparing=new Promise<void>(resolve=>{entered=resolve;});let providerDispatches=0;
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(_source,_index,signal)=>{
        entered();
        await new Promise<void>((_resolve,reject)=>{
          if(signal.aborted){reject(signal.reason);return;}
          signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
        });
        providerDispatches++;
        throw new Error("PROVIDER_DISPATCH_MUST_NOT_RUN");
      }};
    const runner=new ScreenshotContactTaskRunner(pool!,{model:model("unused"),preprocessor,research:null},storage);
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    const operation=runner.start(auth,created.body.task_id);await preparing;
    const active=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    const deleted=await deleteScreenshotPreprocessingSource(pool!,auth,active.task_id,active.revision,storage,
      ()=>runner.fenceSourceDeletion(auth,active.task_id));
    await operation;
    expect(deleted.status).toBe("deleted");expect(providerDispatches).toBe(0);
  });

  it("rechecks task authority after preprocessing preparation and before provider dispatch",async()=>{
    const storage=new TestImageStorage();const request={...input(),preprocess_only:true as const};
    let entered!:()=>void,release!:()=>void;const preparing=new Promise<void>(resolve=>{entered=resolve;});
    const prepared=new Promise<void>(resolve=>{release=resolve;});let providerDispatches=0;
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(_source,_index,_signal,authorizeDispatch)=>{
        entered();await prepared;await authorizeDispatch();providerDispatches++;
        throw new Error("PROVIDER_DISPATCH_MUST_NOT_RUN");
      }};
    const runner=new ScreenshotContactTaskRunner(pool!,{model:model("unused"),preprocessor,research:null},storage);
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    const operation=runner.start(auth,created.body.task_id);await preparing;
    const active=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    await cancelScreenshotContactTask(pool!,auth,active.task_id,active.revision);
    release();await operation;
    const cancelled=await loadScreenshotContactTask(pool!,auth,active.task_id);
    expect(cancelled.status).toBe("cancelled");expect(providerDispatches).toBe(0);
  });

  it.each([false,true])("keeps cancellation ownership when the runner exits first (independent revision: %s)",async(independentRevision)=>{
    const storage=new TestImageStorage();const request={...input(),preprocess_only:true as const};
    let entered!:()=>void;const preparing=new Promise<void>(resolve=>{entered=resolve;});
    let observedSignal:AbortSignal|undefined,providerDispatches=0;
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(_source,_index,signal)=>{
        observedSignal=signal;entered();
        await new Promise<void>((_resolve,reject)=>{
          if(signal.aborted){reject(signal.reason);return;}
          signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
        });
        providerDispatches++;
        throw new Error("PROVIDER_DISPATCH_MUST_NOT_RUN");
      }};
    const runner=new ScreenshotContactTaskRunner(pool!,{model:model("unused"),preprocessor,research:null},storage);
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    const operation=runner.start(auth,created.body.task_id);await preparing;
    const active=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    const other={...auth,userId:randomUUID(),sessionId:randomUUID()};let unauthorizedFence=false;
    await expect(cancelScreenshotContactTask(pool!,other,active.task_id,active.revision,()=>{
      unauthorizedFence=true;runner.fenceTaskCancellation(other,active.task_id);
    })).rejects.toMatchObject({code:"CONTACT_TASK_NOT_FOUND"});
    expect(unauthorizedFence).toBe(false);expect(observedSignal?.aborted).toBe(false);
    // Force the runner's abort cleanup to finish before cancellation locks the
    // row. Its own failure bookkeeping must not invalidate the owner's CAS.
    const cancellationPool=new Proxy(pool!,{get(target,key){
      if(key==="connect")return async()=>{
        await operation;
        if(independentRevision)await target.query("UPDATE screenshot_contact_tasks SET revision=revision+1 WHERE id=$1",[active.task_id]);
        return target.connect();
      };
      const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
    }}) as Pool;
    const cancellation=cancelScreenshotContactTask(cancellationPool,auth,active.task_id,active.revision,
      ()=>runner.fenceTaskCancellation(auth,active.task_id));
    if(independentRevision){
      await expect(cancellation).rejects.toMatchObject({code:"CONTACT_TASK_REVISION_CHANGED"});
    }else{
      expect((await cancellation).status).toBe("cancelled");
    }
    await operation;
    expect(providerDispatches).toBe(0);
  });

  it("aborts dispatch when Stop arrives between the locked row and source checks",async()=>{
    const storage=new TestImageStorage();const request={...input(),preprocess_only:true as const};
    let authorizationStarted=false,entered!:()=>void,release!:()=>void;
    const checkingSource=new Promise<void>(resolve=>{entered=resolve;});
    const continueSourceCheck=new Promise<void>(resolve=>{release=resolve;});
    const guardedPool=new Proxy(pool!,{get(target,key){
      if(key!=="connect"){const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}
      return async()=>{
        const client=await target.connect();
        return new Proxy(client,{get(connection,property){
          if(property!=="query"){const value=Reflect.get(connection,property);return typeof value==="function"?value.bind(connection):value;}
          return async(...args:any[])=>{
            if(authorizationStarted&&typeof args[0]==="string"&&args[0].includes("contact_task_directory_available")){
              entered();await continueSourceCheck;
            }
            return (connection.query as (...input:any[])=>unknown)(...args);
          };
        }});
      };
    }}) as Pool;
    let providerDispatches=0;
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(_source,_index,_signal,authorizeDispatch)=>{
        authorizationStarted=true;await authorizeDispatch();providerDispatches++;
        throw new Error("PROVIDER_DISPATCH_MUST_NOT_RUN");
      }};
    const runner=new ScreenshotContactTaskRunner(guardedPool,{model:model("unused"),preprocessor,research:null},storage);
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    const operation=runner.start(auth,created.body.task_id);await checkingSource;
    const active=await loadScreenshotContactTask(pool!,auth,created.body.task_id);let fenced=false,fenceReached!:()=>void;
    const fenceRequested=new Promise<void>(resolve=>{fenceReached=resolve;});
    const cancellation=cancelScreenshotContactTask(pool!,auth,active.task_id,active.revision,()=>{
      fenced=true;runner.fenceTaskCancellation(auth,active.task_id);fenceReached();
    });
    await fenceRequested;expect(fenced).toBe(true);release();await Promise.all([operation,cancellation]);
    const cancelled=await loadScreenshotContactTask(pool!,auth,active.task_id);
    expect(cancelled.status).toBe("cancelled");expect(providerDispatches).toBe(0);
  });

  it("fences selected-person preprocessing before archive waits on dispatch authorization",async()=>{
    const filedRequest=input();const filedCreated=await createScreenshotContactTask(pool!,auth,filedRequest);
    await new ScreenshotContactTaskRunner(pool!,{model:model(`Archive dispatch ${randomUUID().slice(0,8)}`),research:null})
      .start(auth,filedCreated.body.task_id,filedRequest.image);
    const filed=await loadScreenshotContactTask(pool!,auth,filedCreated.body.task_id);
    const intelligence=await loadContactIntelligence(pool!,auth,filed.contact!.person_id,filed.contact!.relationship_context_id);
    const storage=new TestImageStorage();const request={...input(),preprocess_only:true as const};
    let authorizationStarted=false,entered!:()=>void,release!:()=>void;
    const checkingSource=new Promise<void>(resolve=>{entered=resolve;});
    const continueSourceCheck=new Promise<void>(resolve=>{release=resolve;});
    const guardedPool=new Proxy(pool!,{get(target,key){
      if(key!=="connect"){const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}
      return async()=>{
        const client=await target.connect();
        return new Proxy(client,{get(connection,property){
          if(property!=="query"){const value=Reflect.get(connection,property);return typeof value==="function"?value.bind(connection):value;}
          return async(...args:any[])=>{
            if(authorizationStarted&&typeof args[0]==="string"&&args[0].includes("contact_task_directory_available")){
              entered();await continueSourceCheck;
            }
            return (connection.query as (...input:any[])=>unknown)(...args);
          };
        }});
      };
    }}) as Pool;
    let providerDispatches=0;
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(_source,_index,_signal,authorizeDispatch)=>{
        authorizationStarted=true;await authorizeDispatch();providerDispatches++;
        throw new Error("PROVIDER_DISPATCH_MUST_NOT_RUN");
      }};
    const runner=new ScreenshotContactTaskRunner(guardedPool,{model:model("unused"),preprocessor,research:null},storage);
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    await pool!.query(`UPDATE screenshot_contact_tasks SET state=jsonb_set(state,'{selected}',$2::jsonb)
      WHERE id=$1`,[created.body.task_id,JSON.stringify({person_id:filed.contact!.person_id,
        relationship_context_id:filed.contact!.relationship_context_id})]);
    const operation=runner.start(auth,created.body.task_id);await checkingSource;
    let fenced!:()=>void;const archiveFence=new Promise<void>(resolve=>{fenced=resolve;});
    const archive=executeGrantedContactArchive(pool!,auth,{person_id:filed.contact!.person_id,
      expected_revision:intelligence.person_revision!,idempotency_key:randomUUID(),decision:"archive"},taskIDs=>{
        taskIDs.forEach(taskID=>runner.fenceTaskCancellation(auth,taskID,"CONTACT_ARCHIVED"));fenced();
      });
    await archiveFence;release();const [archived]=await Promise.all([archive,operation]);
    expect(providerDispatches).toBe(0);
    expect((await pool!.query("SELECT status FROM screenshot_contact_tasks WHERE id=$1",[created.body.task_id])).rows[0]?.status).toBe("cancelled");
    await restoreContactArchive(pool!,auth,archived.operation_id);
  });

  it("rejects selected-person task admission queued after archive authority is locked",async()=>{
    const filedRequest=input();const filedCreated=await createScreenshotContactTask(pool!,auth,filedRequest);
    await new ScreenshotContactTaskRunner(pool!,{model:model(`Archive admission ${randomUUID().slice(0,8)}`),research:null})
      .start(auth,filedCreated.body.task_id,filedRequest.image);
    const filed=await loadScreenshotContactTask(pool!,auth,filedCreated.body.task_id);
    const intelligence=await loadContactIntelligence(pool!,auth,filed.contact!.person_id,filed.contact!.relationship_context_id);
    let archiveLocked!:()=>void,releaseArchive!:()=>void,admissionQueued!:()=>void;
    const locked=new Promise<void>(resolve=>{archiveLocked=resolve;});
    const release=new Promise<void>(resolve=>{releaseArchive=resolve;});
    const queued=new Promise<void>(resolve=>{admissionQueued=resolve;});
    const archivePool=observePersonLock(pool!,filed.contact!.person_id,{after:async()=>{archiveLocked();await release;}});
    const admissionPool=observePersonLock(pool!,filed.contact!.person_id,{before:admissionQueued});
    const archive=executeGrantedContactArchive(archivePool,auth,{person_id:filed.contact!.person_id,
      expected_revision:intelligence.person_revision!,idempotency_key:randomUUID(),decision:"archive"});
    await locked;
    const request={...input(),selected_person_id:filed.contact!.person_id,
      selected_relationship_context_id:filed.contact!.relationship_context_id};
    const admission=createScreenshotContactTask(admissionPool,auth,request).then(()=>null,error=>error);
    await queued;releaseArchive();
    const [archived,error]=await Promise.all([archive,admission]);
    expect(error).toMatchObject({code:"RELATIONSHIP_CONTEXT_NOT_FOUND"});
    expect((await pool!.query("SELECT 1 FROM screenshot_contact_tasks WHERE account_id=$1 AND idempotency_key=$2",
      [auth.accountId,request.idempotency_key])).rowCount).toBe(0);
    await restoreContactArchive(pool!,auth,archived.operation_id);
  });

  it("rejects selected-person resume queued after archive authority is locked",async()=>{
    const filedRequest=input();const filedCreated=await createScreenshotContactTask(pool!,auth,filedRequest);
    await new ScreenshotContactTaskRunner(pool!,{model:model(`Archive resume ${randomUUID().slice(0,8)}`),research:null})
      .start(auth,filedCreated.body.task_id,filedRequest.image);
    const filed=await loadScreenshotContactTask(pool!,auth,filedCreated.body.task_id);
    const intelligence=await loadContactIntelligence(pool!,auth,filed.contact!.person_id,filed.contact!.relationship_context_id);
    const candidate=await createScreenshotContactTask(pool!,auth,input());
    const cancelled=await cancelScreenshotContactTask(pool!,auth,candidate.body.task_id,candidate.body.revision);
    let archiveLocked!:()=>void,releaseArchive!:()=>void,resumeQueued!:()=>void;
    const locked=new Promise<void>(resolve=>{archiveLocked=resolve;});
    const release=new Promise<void>(resolve=>{releaseArchive=resolve;});
    const queued=new Promise<void>(resolve=>{resumeQueued=resolve;});
    const archivePool=observePersonLock(pool!,filed.contact!.person_id,{after:async()=>{archiveLocked();await release;}});
    const resumePool=observePersonLock(pool!,filed.contact!.person_id,{before:resumeQueued});
    const archive=executeGrantedContactArchive(archivePool,auth,{person_id:filed.contact!.person_id,
      expected_revision:intelligence.person_revision!,idempotency_key:randomUUID(),decision:"archive"});
    await locked;
    const resume=resumeScreenshotContactTask(resumePool,auth,cancelled.task_id,{expected_revision:cancelled.revision,
      selected_person_id:filed.contact!.person_id,
      selected_relationship_context_id:filed.contact!.relationship_context_id}).then(()=>null,error=>error);
    await queued;releaseArchive();
    const [archived,error]=await Promise.all([archive,resume]);
    expect(error).toMatchObject({code:"RELATIONSHIP_CONTEXT_NOT_FOUND"});
    expect((await loadScreenshotContactTask(pool!,auth,cancelled.task_id)).status).toBe("cancelled");
    await restoreContactArchive(pool!,auth,archived.operation_id);
  });

  it("rejects no-argument resume of an auto-bound capture queued after archive scan",async()=>{
    const request=input();const created=await createScreenshotContactTask(pool!,auth,request);
    await new ScreenshotContactTaskRunner(pool!,{model:model(`Archive bound resume ${randomUUID().slice(0,8)}`),research:null})
      .start(auth,created.body.task_id,request.image);
    const filed=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    const persisted=(await pool!.query("SELECT state,subject_id,capture_id FROM screenshot_contact_tasks WHERE id=$1",
      [filed.task_id])).rows[0]!;
    expect(persisted.state.selected).toBeNull();expect(persisted.subject_id).toBe(filed.contact!.person_id);
    expect(persisted.capture_id).toBe(filed.capture_id);
    const cancelled=await cancelScreenshotContactTask(pool!,auth,filed.task_id,filed.revision);
    const intelligence=await loadContactIntelligence(pool!,auth,filed.contact!.person_id,filed.contact!.relationship_context_id);
    let archiveLocked!:()=>void,releaseArchive!:()=>void,resumeQueued!:()=>void;
    const locked=new Promise<void>(resolve=>{archiveLocked=resolve;});
    const release=new Promise<void>(resolve=>{releaseArchive=resolve;});
    const queued=new Promise<void>(resolve=>{resumeQueued=resolve;});
    const archivePool=observePersonLock(pool!,filed.contact!.person_id,{after:async()=>{archiveLocked();await release;}});
    const resumePool=observePersonLock(pool!,filed.contact!.person_id,{before:resumeQueued});
    const archive=executeGrantedContactArchive(archivePool,auth,{person_id:filed.contact!.person_id,
      expected_revision:intelligence.person_revision!,idempotency_key:randomUUID(),decision:"archive"});
    await locked;
    let runnerStarts=0;
    const resume=resumeScreenshotContactTask(resumePool,auth,cancelled.task_id,{expected_revision:cancelled.revision})
      .then(result=>{runnerStarts++;return result;},error=>error);
    await queued;releaseArchive();
    const [archived,error]=await Promise.all([archive,resume]);
    expect(error).toMatchObject({code:"CONTACT_DIRECTORY_CHANGED_SEARCH_AGAIN"});expect(runnerStarts).toBe(0);
    expect((await pool!.query("SELECT status FROM screenshot_contact_tasks WHERE id=$1",[cancelled.task_id])).rows[0]?.status).toBe("cancelled");
    await restoreContactArchive(pool!,auth,archived.operation_id);
  });

  it("serializes canonical filing ahead of the task row when archive owns person authority",async()=>{
    const name=`Archive filing ${randomUUID().slice(0,8)}`,seed=input();
    const seeded=await createScreenshotContactTask(pool!,auth,seed);
    await new ScreenshotContactTaskRunner(pool!,{model:model(name),research:null}).start(auth,seeded.body.task_id,seed.image);
    const person=await loadScreenshotContactTask(pool!,auth,seeded.body.task_id);
    const intelligence=await loadContactIntelligence(pool!,auth,person.contact!.person_id,person.contact!.relationship_context_id);
    let readyToSave!:()=>void,releaseSave!:()=>void,archiveLocked!:()=>void,releaseArchive!:()=>void,saveQueued!:()=>void;
    const ready=new Promise<void>(resolve=>{readyToSave=resolve;});
    const saveGate=new Promise<void>(resolve=>{releaseSave=resolve;});
    const locked=new Promise<void>(resolve=>{archiveLocked=resolve;});
    const archiveGate=new Promise<void>(resolve=>{releaseArchive=resolve;});
    const queued=new Promise<void>(resolve=>{saveQueued=resolve;});let saving=false;
    const runnerPool=observePersonLock(pool!,person.contact!.person_id,{before:()=>{if(saving)saveQueued();}});
    const request=input();const scope={person_id:person.contact!.person_id,
      relationship_context_id:person.contact!.relationship_context_id};
    const sdk=sdkModel(async(admission,signal)=>{
      await admission.recordUnderstanding([{platform:"Synthetic IM",conversation_kind:"direct",contact_name:name,
        identity_clues:[{kind:"name",value:name,source_excerpt:name}],messages:[{message_id:"m1",sequence:0,
          text:"I can talk next Tuesday.",speaker_side:"left",speaker_label:name,time_text:null}],uncertainties:[]}],signal);
      await admission.invoke("search_contacts",{query:name},signal);
      await admission.invoke("read_contact",scope,signal);
      readyToSave();await saveGate;saving=true;
      await admission.invoke("save_contact_chat",scope,signal);
      return sdkReceipt();
    });
    const created=await createScreenshotContactTask(pool!,auth,request);
    const runner=new ScreenshotContactTaskRunner(runnerPool,{model:sdk,research:null});
    const operation=runner.start(auth,created.body.task_id,request.image);await ready;
    const archivePool=observePersonLock(pool!,person.contact!.person_id,{after:async()=>{archiveLocked();await archiveGate;}});
    const archive=executeGrantedContactArchive(archivePool,auth,{person_id:person.contact!.person_id,
      expected_revision:intelligence.person_revision!,idempotency_key:randomUUID(),decision:"archive"});
    await locked;releaseSave();await queued;releaseArchive();
    const [archived]=await Promise.all([archive,operation]);
    const stored=(await pool!.query("SELECT status,capture_id FROM screenshot_contact_tasks WHERE id=$1",[created.body.task_id])).rows[0]!;
    expect(stored.status).toBe("cancelled");expect(stored.capture_id).toBeNull();
    await restoreContactArchive(pool!,auth,archived.operation_id);
  });

  it("keeps unbounded uncertainty human-only even when the SDK is available",async()=>{
    const storage=new TestImageStorage();const request=input();
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>({request_id:`fixture-unbounded-${index}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,
        input_tokens:3,output_tokens:2,source:{source_image_index:index,source_hash:source.content_hash,platform:"WeChat",
          conversation_kind:"direct",contact_name:"Uncertain source",participants:[],messages:[{sequence:0,text:"Visible text",
            speaker_label:null,speaker_side:"unknown",time_text:null}],identity_clues:[],uncertainties:["Identity remains ambiguous."],
          follow_up_required:false,follow_up_regions:[],width:100,height:200,
          prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}})};
    let sdkCalls=0;const sdk=sdkModel(async()=>{sdkCalls++;throw new Error("UNBOUNDED_SOURCE_MUST_NOT_REACH_MODEL");});
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    const runner=new ScreenshotContactTaskRunner(pool!,{model:sdk,preprocessor,research:null},storage);
    await runner.start(auth,created.body.task_id);
    const waiting=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(waiting).toMatchObject({status:"waiting_for_user",contact:null,capture_id:null});
    expect(waiting.question).toContain("未声明可复读区域");expect(sdkCalls).toBe(0);
    await resumeScreenshotContactTask(pool!,auth,waiting.task_id,{expected_revision:waiting.revision});
    await runner.start(auth,waiting.task_id);
    expect((await loadScreenshotContactTask(pool!,auth,waiting.task_id)).status).toBe("waiting_for_user");
    expect(sdkCalls).toBe(0);
  });
  it("never exposes a confirmable profile draft from a preprocess-only task",async()=>{
    const storage=new TestImageStorage();const request={...input(),preprocess_only:true as const};
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>({request_id:`ark-profile-only-${index}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,
        input_tokens:3,output_tokens:2,source:{source_image_index:index,source_hash:source.content_hash,platform:"LinkedIn",
          conversation_kind:"profile",contact_name:"Profile only",participants:[],messages:[],identity_clues:[
            {kind:"name",value:"Profile only",source_excerpt:"Profile only"}],uncertainties:[],follow_up_required:false,
          follow_up_regions:[],width:100,height:200,
          prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}})};
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    await new ScreenshotContactTaskRunner(pool!,{model:model("unused"),preprocessor,research:null},storage)
      .start(auth,created.body.task_id);
    const done=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(done).toMatchObject({status:"completed",contact:null,capture_id:null});
    expect(done.contact_draft).toBeUndefined();
    await expect(confirmScreenshotContactProfile(pool!,auth,done.task_id,{expected_revision:done.revision,
      decision:"save_reviewed_profile",display_name:"Profile only",fields:[]}))
      .rejects.toMatchObject({code:"CONTACT_PREPROCESS_PROFILE_FILING_FORBIDDEN"});
    expect((await pool!.query("SELECT count(*)::int count FROM subjects WHERE account_id=$1 AND display_label='Profile only'",
      [auth.accountId])).rows[0].count).toBe(0);
  });
  it("exposes only the flagged source and merges its correction before any filing tool is authorized",async()=>{
    const storage=new TestImageStorage();const request={...input(),preprocess_only:true as const,additional_images:[input().image]};
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>({request_id:`ark-follow-up-${index}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,input_tokens:3,output_tokens:2,
        source:{source_image_index:index,source_hash:source.content_hash,platform:"WeChat",conversation_kind:"direct",contact_name:"Synthetic selected",
          participants:[],messages:[{sequence:0,text:`preprocessed-${index}`,speaker_label:"Synthetic selected",speaker_side:"left",time_text:null}],
          identity_clues:[{kind:"name",value:"Synthetic selected",source_excerpt:"Synthetic selected"}],uncertainties:index===1?["small text"]:[],
          follow_up_required:index===1,follow_up_regions:index===1?[{reason:"illegible_text",field:"text",uncertainty_index:0,target:{kind:"message",message_index:0},baseline_text:"preprocessed",region:{left:0,top:0,width:50,height:80}}]:[],width:100,height:200,
          prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}})};
    const sdk=sdkModel(async(admission,signal)=>{
      expect(admission.images).toEqual([request.additional_images[0]]);
      expect(admission.imageSourceIndices).toEqual([1]);
      expect((admission.state as any).current_state.allowed_tools).toEqual(["record_screenshot_corrections"]);
      const corrected=await admission.recordUnderstanding([{platform:"WeChat",conversation_kind:"direct",contact_name:"Synthetic selected",
        identity_clues:[{kind:"name",value:"Synthetic selected",source_excerpt:"Synthetic selected",source_image_index:1}],
        messages:[{message_id:"m1",sequence:0,text:"corrected-second",speaker_side:"left",speaker_label:"Synthetic selected",time_text:null,source_image_index:1}],uncertainties:[]}],signal);
      expect(corrected).toMatchObject({status:"completed",current_state:{allowed_tools:[]}});
      return sdkReceipt();
    });
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    await new ScreenshotContactTaskRunner(pool!,{model:sdk,preprocessor,research:null},storage).start(auth,created.body.task_id);
    const done=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(done.status,JSON.stringify(done)).toBe("completed");
    expect(done.extraction?.messages.map(message=>[message.text,message.source_image_index])).toEqual([["preprocessed-0",0],["corrected-second",1]]);
    expect(done.contact).toBeNull();expect(done.capture_id).toBeNull();
  });
  it("retries a bounded uncertainty but never re-reads a remaining human-only uncertainty",async()=>{
    const storage=new TestImageStorage();const request={...input(),preprocess_only:true as const};let sdkCalls=0;
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>({request_id:`ark-retryable-${index}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,input_tokens:3,output_tokens:2,
        source:{source_image_index:index,source_hash:source.content_hash,platform:"WeChat",conversation_kind:"direct",contact_name:"Retryable source",
          participants:[],messages:[{sequence:0,text:"baseline",speaker_label:null,speaker_side:"unknown",time_text:null}],identity_clues:[],
          uncertainties:["small text","identity unknown"],follow_up_required:true,follow_up_regions:[{reason:"illegible_text",field:"text",uncertainty_index:0,target:{kind:"message",message_index:0},baseline_text:"base",region:{left:0,top:0,width:50,height:80}}],
          width:100,height:200,prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}})};
    const sdk=sdkModel(async(admission,signal)=>{
      sdkCalls++;expect(admission.imageSourceIndices).toEqual([0]);
      const stillUncertain=sdkCalls===1;
      await admission.recordUnderstanding([{platform:"WeChat",conversation_kind:"direct",contact_name:"Retryable source",identity_clues:[],
        messages:[{message_id:"m1",sequence:0,text:stillUncertain?"still blurred":"resolved text",speaker_side:"left",speaker_label:"Retryable source",time_text:null,source_image_index:0}],
        uncertainties:stillUncertain?["text remains blurred","identity unknown"]:["identity unknown"]}],signal);
      return sdkReceipt();
    });
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    const runner=new ScreenshotContactTaskRunner(pool!,{model:sdk,preprocessor,research:null},storage);
    await runner.start(auth,created.body.task_id);
    const waiting=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(waiting.status).toBe("waiting_for_user");
    expect(waiting.preprocessing_pending_source_indices).toEqual([0]);
    const waitingState=(await pool!.query("SELECT state FROM screenshot_contact_tasks WHERE id=$1",[waiting.task_id])).rows[0]!.state;
    expect(waitingState.preprocessing_refined_indices??[]).toEqual([]);
    expect(waitingState.preprocessing_refinement_unresolved).toBe(true);
    await resumeScreenshotContactTask(pool!,auth,waiting.task_id,{expected_revision:waiting.revision});
    await runner.start(auth,waiting.task_id);
    const done=await loadScreenshotContactTask(pool!,auth,waiting.task_id);
    expect(done.status,JSON.stringify(done)).toBe("waiting_for_user");expect(done.extraction?.messages[0]?.text).toBe("resolved text");
    expect(done.preprocessing_pending_source_indices).toEqual([]);
    const doneState=(await pool!.query("SELECT state FROM screenshot_contact_tasks WHERE id=$1",[done.task_id])).rows[0]!.state;
    expect(doneState.preprocessing_refined_indices).toEqual([0]);expect(doneState.preprocessing_refinement_unresolved).toBe(true);
    expect(sdkCalls).toBe(2);
    await resumeScreenshotContactTask(pool!,auth,done.task_id,{expected_revision:done.revision});
    await runner.start(auth,done.task_id);
    expect(sdkCalls).toBe(2);
  });
  it("keeps an over-budget preprocessing baseline for human review without repeating the billed call",async()=>{
    const storage=new TestImageStorage();const request={...input(),preprocess_only:true as const,additional_images:[input().image]};
    const calls=[0,0];
    const regions=(count:number)=>Array.from({length:count},(_,left)=>({reason:"ambiguous_identity" as const,
      field:"identity" as const,uncertainty_index:left,target:{kind:"contact_name" as const},
      baseline_text:null,region:{left,top:0,width:1,height:1}}));
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>{calls[index] = (calls[index]??0)+1;
        const followUps=regions(SCREENSHOT_PREPROCESS_FOLLOW_UP_REGION_LIMIT / 2 + 1);
        return {request_id:`ark-budget-${index}-${calls[index]}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,input_tokens:3,output_tokens:2,
          source:{source_image_index:index,source_hash:source.content_hash,platform:"WeChat",conversation_kind:"direct",contact_name:"Budget source",
            participants:[],messages:[],identity_clues:[],
            uncertainties:followUps.map((_,uncertaintyIndex)=>`small text ${uncertaintyIndex}`),follow_up_required:followUps.length>0,follow_up_regions:followUps,
            width:100,height:200,prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}};}};
    const runner=new ScreenshotContactTaskRunner(pool!,{model:model("unused"),preprocessor,research:null},storage);
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    await runner.start(auth,created.body.task_id);
    const waiting=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(waiting.status).toBe("waiting_for_user");expect(waiting.preprocessing?.sources).toHaveLength(2);
    expect(waiting.preprocessing?.sources[0]?.follow_up_regions).toEqual([]);
    expect(waiting.preprocessing?.sources[1]?.follow_up_regions).toEqual([]);
    expect(waiting.preprocessing?.sources[1]?.uncertainties).toHaveLength(13);
    expect(waiting.preprocessing_pending_source_indices).toEqual([]);
    expect(waiting.limitations).toContain("SCREENSHOT_PREPROCESS_FOLLOW_UP_BUDGET");
    expect(waiting.events).toContainEqual(expect.objectContaining({tool:"authorize_screenshot_follow_up_regions",status:"denied"}));
    expect(calls).toEqual([1,1]);
    const waitingState=(await pool!.query("SELECT state FROM screenshot_contact_tasks WHERE id=$1",[waiting.task_id])).rows[0]!.state;
    expect(waitingState.preprocessing_parts).toHaveLength(2);expect(waitingState.preprocessing_inflight).toBeUndefined();
    expect(waitingState.model_receipts.map((receipt:{request_id:string})=>receipt.request_id)).toEqual([
      "ark-budget-0-1","ark-budget-1-1",
    ]);
    await resumeScreenshotContactTask(pool!,auth,waiting.task_id,{expected_revision:waiting.revision});
    await runner.start(auth,waiting.task_id);
    const resumed=await loadScreenshotContactTask(pool!,auth,waiting.task_id);
    expect(resumed.status).toBe("waiting_for_user");expect(resumed.preprocessing_pending_source_indices).toEqual([]);
    expect(calls).toEqual([1,1]);
  });
  it("links only the matching iOS source, preserves that link across retry, and purges it with the capture",async()=>{
    const filedRequest=input();const filedCreated=await createScreenshotContactTask(pool!,auth,filedRequest);
    await new ScreenshotContactTaskRunner(pool!,{model:model(`Linked capture ${randomUUID()}`),research:null}).start(auth,filedCreated.body.task_id,filedRequest.image);
    const filed=await loadScreenshotContactTask(pool!,auth,filedCreated.body.task_id);
    expect(filed.status).toBe("completed");expect(filed.contact).toBeTruthy();
    const seed=randomUUID(),canonical=await createIOSCapture(seed,filed.contact!.person_id,filed.contact!.relationship_context_id);
    const wrongSeed=randomUUID(),wrong=await createIOSCapture(wrongSeed,filed.contact!.person_id,filed.contact!.relationship_context_id);

    const storage=new TestImageStorage();const request={...input(),idempotency_key:`ios:${seed}:preprocess-v3`,preprocess_only:true as const};let sdkCalls=0;
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>({request_id:`ark-link-${index}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,input_tokens:3,output_tokens:2,
        source:{source_image_index:index,source_hash:source.content_hash,platform:"WeChat",conversation_kind:"direct",contact_name:"Linked source",
          participants:[],messages:[{sequence:0,text:"linked original",speaker_label:"Linked source",speaker_side:"left",time_text:null}],identity_clues:[],
          uncertainties:["small text"],follow_up_required:true,follow_up_regions:[{reason:"illegible_text",field:"text",uncertainty_index:0,target:{kind:"message",message_index:0},baseline_text:"original",region:{left:0,top:0,width:50,height:80}}],width:100,height:200,
          prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}})};
    const sdk=sdkModel(async(admission,signal)=>{sdkCalls++;const unresolved=sdkCalls===1;
      await admission.recordUnderstanding([{platform:"WeChat",conversation_kind:"direct",contact_name:"Linked source",identity_clues:[],
        messages:[{message_id:"m1",sequence:0,text:unresolved?"still blurred":"resolved",speaker_side:"left",speaker_label:"Linked source",time_text:null,source_image_index:0}],
        uncertainties:unresolved?["still blurred"]:[]}],signal);return sdkReceipt();});
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    const runner=new ScreenshotContactTaskRunner(pool!,{model:sdk,preprocessor,research:null},storage);
    await runner.start(auth,created.body.task_id);
    const preprocessed=await loadScreenshotContactTask(pool!,auth,created.body.task_id);expect(preprocessed.status).toBe("waiting_for_user");
    await expect(linkScreenshotContactTaskCapture(pool!,auth,preprocessed.task_id,{expected_revision:preprocessed.revision,
      capture_id:wrong.body.capture_id,source_resource_id:wrong.body.resource.id})).rejects.toMatchObject({code:"CONTACT_PREPROCESS_SOURCE_MISMATCH"});
    const linkInput={expected_revision:preprocessed.revision,capture_id:canonical.body.capture_id,source_resource_id:canonical.body.resource.id};
    const linked=await linkScreenshotContactTaskCapture(pool!,auth,preprocessed.task_id,linkInput);
    expect(linked).toMatchObject({task_id:preprocessed.task_id,capture_id:canonical.body.capture_id,source_resource_id:canonical.body.resource.id});
    expect((await linkScreenshotContactTaskCapture(pool!,auth,preprocessed.task_id,linkInput)).revision).toBe(linked.revision);
    await resumeScreenshotContactTask(pool!,auth,preprocessed.task_id,{expected_revision:linked.revision});
    await runner.start(auth,preprocessed.task_id);
    expect(sdkCalls).toBe(2);
    expect((await pool!.query("SELECT capture_id,source_resource_id FROM screenshot_contact_tasks WHERE id=$1",[preprocessed.task_id])).rows[0]).toEqual({
      capture_id:canonical.body.capture_id,source_resource_id:canonical.body.resource.id});
    await pool!.query("UPDATE source_retention_receipts SET authorization_expires_at=now()-interval '1 second' WHERE capture_id=$1",[canonical.body.capture_id]);
    await expect(loadScreenshotContactImage(pool!,auth,preprocessed.task_id,0,storage)).rejects.toMatchObject({code:"CONTACT_TASK_SOURCE_UNAVAILABLE"});
    await deleteCapture(pool!,auth,canonical.body.capture_id,{idempotency_key:randomUUID(),reason:"Synthetic canonical source deletion"});
    const scrubbed=(await pool!.query("SELECT status,state,input_manifest FROM screenshot_contact_tasks WHERE id=$1",[preprocessed.task_id])).rows[0]!;
    expect(scrubbed).toEqual({status:"deleted",state:{},input_manifest:{}});
    expect((await pool!.query("SELECT status FROM contact_task_images WHERE task_id=$1",[preprocessed.task_id])).rows[0]?.status).toBe("purge_pending");
    await purgeContactImagesForCapture(pool!,auth.accountId,canonical.body.capture_id,storage);expect(storage.objects.size).toBe(0);
    expect((await pool!.query("SELECT status FROM contact_task_images WHERE task_id=$1",[preprocessed.task_id])).rows[0]?.status).toBe("deleted");
  });
  it("purges a linked preprocessing copy without deleting its canonical capture",async()=>{
    const scope=(await pool!.query<{person_id:string;context_id:string}>(`SELECT s.id person_id,a.id context_id FROM subjects s
      JOIN assignments a ON a.account_id=s.account_id AND a.subject_id=s.id WHERE s.account_id=$1 AND s.status='active' AND a.status='active' LIMIT 1`,
    [auth.accountId])).rows[0]!;
    const seed=randomUUID(),canonical=await createIOSCapture(seed,scope.person_id,scope.context_id);
    const storage=new TestImageStorage();const request={...input(),idempotency_key:`ios:${seed}:preprocess-v3`,preprocess_only:true as const};
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>({request_id:`ark-copy-delete-${index}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,input_tokens:3,output_tokens:2,
        source:{source_image_index:index,source_hash:source.content_hash,platform:"WeChat",conversation_kind:"direct",contact_name:"Linked source",
          participants:[],messages:[{sequence:0,text:"linked original",speaker_label:"Linked source",speaker_side:"left",time_text:null}],identity_clues:[],
          uncertainties:[],follow_up_required:false,follow_up_regions:[],width:100,height:200,
          prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}})};
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    await new ScreenshotContactTaskRunner(pool!,{model:model("unused"),preprocessor,research:null},storage).start(auth,created.body.task_id);
    const preprocessed=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    const linked=await linkScreenshotContactTaskCapture(pool!,auth,preprocessed.task_id,{expected_revision:preprocessed.revision,
      capture_id:canonical.body.capture_id,source_resource_id:canonical.body.resource.id});

    const suffix=randomUUID().replaceAll("-","");
    const trigger=`fail_preprocessing_copy_delete_${suffix}`;
    const fn=`fail_preprocessing_copy_delete_fn_${suffix}`;
    await pool!.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_PREPROCESSING_COPY_DELETE_FAILURE'; END $$`);
    await pool!.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON screenshot_contact_tasks
      FOR EACH ROW WHEN (NEW.id = '${preprocessed.task_id}'::uuid AND NEW.status = 'deleted') EXECUTE FUNCTION ${fn}()`);
    try {
      await expect(deleteScreenshotPreprocessingSource(pool!,auth,preprocessed.task_id,linked.revision,storage))
        .rejects.toThrow("SYNTHETIC_PREPROCESSING_COPY_DELETE_FAILURE");
      const pending=(await pool!.query<{status:string;revision:number;state:{preprocessing_deletion_requested?:boolean}}>(
        "SELECT status,revision,state FROM screenshot_contact_tasks WHERE id=$1",[preprocessed.task_id])).rows[0]!;
      expect(pending).toMatchObject({status:"cancelled",revision:linked.revision+1,
        state:{preprocessing_deletion_requested:true}});
      await expect(loadScreenshotContactImage(pool!,auth,preprocessed.task_id,0,storage))
        .rejects.toMatchObject({code:"CONTACT_TASK_SOURCE_UNAVAILABLE"});
      await expect(resumeScreenshotContactTask(pool!,auth,preprocessed.task_id,{expected_revision:pending.revision}))
        .rejects.toMatchObject({code:"CONTACT_SOURCE_DELETION_PENDING"});
      expect((await loadScreenshotContactTask(pool!,auth,preprocessed.task_id)).status).toBe("deleted");
    } finally {
      await pool!.query(`DROP TRIGGER IF EXISTS ${trigger} ON screenshot_contact_tasks`);
      await pool!.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }

    const deleted=await deleteScreenshotPreprocessingSource(pool!,auth,preprocessed.task_id,linked.revision,storage);

    expect(deleted.status).toBe("deleted");expect(storage.objects.size).toBe(0);
    expect((await pool!.query("SELECT status FROM captures WHERE account_id=$1 AND id=$2",[auth.accountId,canonical.body.capture_id])).rows[0]?.status).toBe("active");
    expect((await pool!.query("SELECT processing_state FROM source_resources WHERE account_id=$1 AND id=$2",[auth.accountId,canonical.body.resource.id])).rows[0]?.processing_state).not.toBe("deleted");
    expect((await pool!.query("SELECT capture_id,source_resource_id,state,input_manifest FROM screenshot_contact_tasks WHERE id=$1",[preprocessed.task_id])).rows[0]).toEqual({
      capture_id:canonical.body.capture_id,source_resource_id:canonical.body.resource.id,state:{},input_manifest:{}});
  });
  it("refuses to link a matching iOS source after its authorization deadline",async()=>{
    const scope=(await pool!.query<{person_id:string;context_id:string}>(`SELECT s.id person_id,a.id context_id FROM subjects s
      JOIN assignments a ON a.account_id=s.account_id AND a.subject_id=s.id WHERE s.account_id=$1 AND s.status='active' AND a.status='active' LIMIT 1`,
    [auth.accountId])).rows[0]!;
    const seed=randomUUID(),canonical=await createIOSCapture(seed,scope.person_id,scope.context_id);
    const storage=new TestImageStorage();const request={...input(),idempotency_key:`ios:${seed}:preprocess-v3`,preprocess_only:true as const};
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>({request_id:`ark-expired-link-${index}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,input_tokens:3,output_tokens:2,
        source:{source_image_index:index,source_hash:source.content_hash,platform:"WeChat",conversation_kind:"direct",contact_name:"Expired link",
          participants:[],messages:[],identity_clues:[],uncertainties:[],follow_up_required:false,follow_up_regions:[],width:100,height:200,
          prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}})};
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    await new ScreenshotContactTaskRunner(pool!,{model:model("unused"),preprocessor,research:null},storage).start(auth,created.body.task_id);
    const preprocessed=await loadScreenshotContactTask(pool!,auth,created.body.task_id);expect(preprocessed.status).toBe("completed");
    await pool!.query("UPDATE source_retention_receipts SET authorization_expires_at=now()-interval '1 second' WHERE capture_id=$1",[canonical.body.capture_id]);
    await expect(linkScreenshotContactTaskCapture(pool!,auth,preprocessed.task_id,{expected_revision:preprocessed.revision,
      capture_id:canonical.body.capture_id,source_resource_id:canonical.body.resource.id})).rejects.toMatchObject({code:"CONTACT_PREPROCESS_SOURCE_MISMATCH"});
    expect((await pool!.query("SELECT capture_id,source_resource_id FROM screenshot_contact_tasks WHERE id=$1",[preprocessed.task_id])).rows[0]).toEqual({capture_id:null,source_resource_id:null});
    await deleteContactCaptureTask(pool!,auth,preprocessed.task_id,preprocessed.revision,storage);
  });
  it("purges a linked preprocessing original when deletion begins at an ancestor capture",async()=>{
    const scope=(await pool!.query<{person_id:string;context_id:string}>(`SELECT s.id person_id,a.id context_id FROM subjects s
      JOIN assignments a ON a.account_id=s.account_id AND a.subject_id=s.id WHERE s.account_id=$1 AND s.status='active' AND a.status='active' LIMIT 1`,
    [auth.accountId])).rows[0]!;
    const rootSeed=randomUUID(),root=await createIOSCapture(rootSeed,scope.person_id,scope.context_id);
    const childSeed=randomUUID(),child=await createIOSCapture(childSeed,scope.person_id,scope.context_id,
      {clientResourceID:`ios-share:${rootSeed}`,resourceID:root.body.resource.id});
    const storage=new TestImageStorage();const request={...input(),idempotency_key:`ios:${childSeed}:preprocess-v3`,preprocess_only:true as const};
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>({request_id:`ark-descendant-${index}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,input_tokens:3,output_tokens:2,
        source:{source_image_index:index,source_hash:source.content_hash,platform:"WeChat",conversation_kind:"direct",contact_name:"Descendant",
          participants:[],messages:[],identity_clues:[],uncertainties:[],follow_up_required:false,follow_up_regions:[],width:100,height:200,
          prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}})};
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    await new ScreenshotContactTaskRunner(pool!,{model:model("unused"),preprocessor,research:null},storage).start(auth,created.body.task_id);
    const preprocessed=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    await linkScreenshotContactTaskCapture(pool!,auth,preprocessed.task_id,{expected_revision:preprocessed.revision,
      capture_id:child.body.capture_id,source_resource_id:child.body.resource.id});
    await deleteCapture(pool!,auth,root.body.capture_id,{idempotency_key:randomUUID(),reason:"Synthetic ancestor deletion"});
    expect((await pool!.query("SELECT status FROM contact_task_images WHERE task_id=$1",[preprocessed.task_id])).rows[0]?.status).toBe("purge_pending");
    await purgeContactImagesForCapture(pool!,auth.accountId,root.body.capture_id,storage);
    expect(storage.objects.size).toBe(0);
    expect((await pool!.query("SELECT status FROM contact_task_images WHERE task_id=$1",[preprocessed.task_id])).rows[0]?.status).toBe("deleted");
  });
  it("purges the exact discarded task even behind more than one global cleanup batch",async()=>{
    const storage=new TestImageStorage();const created=await createScreenshotContactTask(pool!,auth,{...input(),preprocess_only:true},storage);
    const noise=(await pool!.query<{id:string}>(`INSERT INTO screenshot_contact_tasks
      (id,account_id,created_by_user_id,idempotency_key,request_hash,input_manifest,state,status)
      SELECT gen_random_uuid(),$1,$2,'get29-purge-noise-'||gen_random_uuid()::text,repeat('a',64),'{}'::jsonb,'{}'::jsonb,'deleted'
      FROM generate_series(1,101) RETURNING id`,[auth.accountId,auth.userId])).rows.map(row=>row.id);
    try{
      await pool!.query(`INSERT INTO contact_task_images
        (account_id,task_id,image_index,object_key,storage_scope,media_type,byte_size,content_hash,status,expires_at)
        SELECT $1,id,0,'get29-purge-noise/'||id,$2,'image/png',1,repeat('b',64),'purge_pending',now()+interval '1 day'
        FROM unnest($3::uuid[]) id`,[auth.accountId,storage.labScopeID,noise]);
      const deleted=await deleteContactCaptureTask(pool!,auth,created.body.task_id,created.body.revision,storage);
      expect(deleted.status).toBe("deleted");expect(storage.objects.size).toBe(0);
      expect((await pool!.query("SELECT status FROM contact_task_images WHERE task_id=$1",[created.body.task_id])).rows[0]?.status).toBe("deleted");
      expect((await pool!.query("SELECT count(*)::int count FROM contact_task_images WHERE task_id=ANY($1::uuid[]) AND status='purge_pending'",[noise])).rows[0].count).toBe(101);
    }finally{
      await pool!.query("DELETE FROM contact_task_images WHERE task_id=ANY($1::uuid[])",[noise]);
      await pool!.query("DELETE FROM screenshot_contact_tasks WHERE id=ANY($1::uuid[])",[noise]);
    }
  });
  it("keeps the preprocessing baseline intact when the default provider cannot issue bounded region receipts",async()=>{
    const storage=new TestImageStorage();const request={...input(),preprocess_only:true as const,additional_images:[input().image]};
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>({request_id:`ark-default-${index}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,input_tokens:3,output_tokens:2,
        source:{source_image_index:index,source_hash:source.content_hash,platform:"WeChat",conversation_kind:"direct",contact_name:"Ambiguous source",
          participants:[],messages:index===1?[
            {sequence:0,text:"preprocessed-1-first",speaker_label:"Ambiguous source",speaker_side:"left",time_text:null},
            {sequence:1,text:"preprocessed-1-untouched",speaker_label:null,speaker_side:"unknown",time_text:null},
          ]:[{sequence:0,text:"preprocessed-0",speaker_label:"Ambiguous source",speaker_side:"left",time_text:null}],identity_clues:[],
          uncertainties:index===1?["speaker unclear"]:[],follow_up_required:index===1,
          follow_up_regions:index===1?[{reason:"ambiguous_speaker",field:"speaker",uncertainty_index:0,target:{kind:"message",message_index:0},baseline_text:null,region:{left:0,top:0,width:50,height:80}}]:[],width:100,height:200,
          prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}})};
    const base=model("unused"),extract=vi.fn(async()=>{throw new Error("FULL_IMAGE_REFINEMENT_MUST_NOT_RUN");});
    const next=vi.fn(base.next);
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    await new ScreenshotContactTaskRunner(pool!,{model:{...base,extract,next},preprocessor,research:null},storage).start(auth,created.body.task_id);
    const waiting=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(waiting.status,JSON.stringify(waiting)).toBe("waiting_for_user");
    expect(waiting.question).toContain("不支持受限区域回执");expect(extract).not.toHaveBeenCalled();expect(next).not.toHaveBeenCalled();
    expect(waiting.extraction?.messages.map(message=>message.text)).toEqual([
      "preprocessed-0","preprocessed-1-first","preprocessed-1-untouched",
    ]);
    expect(waiting.events).toContainEqual(expect.objectContaining({tool:"refine_screenshot_preprocessing",status:"denied"}));
    expect(waiting.contact).toBeNull();expect(waiting.capture_id).toBeNull();
  });
  it("stops advertising zero-message refinement after the default adapter abstains",async()=>{
    const storage=new TestImageStorage();const request={...input(),preprocess_only:true as const};let preprocessCalls=0;
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>{preprocessCalls++;return {request_id:`ark-abstain-${index}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,input_tokens:3,output_tokens:2,
        source:{source_image_index:index,source_hash:source.content_hash,platform:"WeChat",conversation_kind:"direct",contact_name:"Unclear identity",
          participants:[],messages:[],identity_clues:[],uncertainties:["identity unclear"],follow_up_required:true,
          follow_up_regions:[{reason:"ambiguous_identity",field:"identity",uncertainty_index:0,target:{kind:"contact_name"},baseline_text:null,
            region:{left:0,top:0,width:50,height:80}}],width:100,height:200,
          prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}};}};
    const base=model("unused"),extract=vi.fn(async()=>{throw new Error("FULL_IMAGE_REFINEMENT_MUST_NOT_RUN");});
    const next=vi.fn(base.next);
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    const runner=new ScreenshotContactTaskRunner(pool!,{model:{...base,extract,next},preprocessor,research:null},storage);
    await runner.start(auth,created.body.task_id);
    const waiting=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(waiting.status).toBe("waiting_for_user");expect(waiting.preprocessing_pending_source_indices).toEqual([]);
    expect(waiting.extraction?.messages).toEqual([]);expect(preprocessCalls).toBe(1);
    const state=(await pool!.query("SELECT state FROM screenshot_contact_tasks WHERE id=$1",[waiting.task_id])).rows[0]!.state;
    expect(state.preprocessing_refinement_abstained_indices).toEqual([0]);
    await resumeScreenshotContactTask(pool!,auth,waiting.task_id,{expected_revision:waiting.revision});
    await runner.start(auth,waiting.task_id);
    const resumed=await loadScreenshotContactTask(pool!,auth,waiting.task_id);
    expect(resumed.status).toBe("waiting_for_user");expect(resumed.preprocessing_pending_source_indices).toEqual([]);
    expect(preprocessCalls).toBe(1);expect(extract).not.toHaveBeenCalled();expect(next).not.toHaveBeenCalled();
  });
  it("requires an explicit resume receipt before retrying an unknown preprocessing response",async()=>{
    const storage=new TestImageStorage();const request={...input(),preprocess_only:true as const};let calls=0;
    const preprocessor:ScreenshotPreprocessor={provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      preprocess:async(source,index)=>{if(++calls===1)throw new Error("SYNTHETIC_PROVIDER_INTERRUPTED");return {request_id:"ark-retry",model:ARK_SCREENSHOT_PREPROCESS_MODEL,input_tokens:3,output_tokens:2,
        source:{source_image_index:index,source_hash:source.content_hash,platform:"WeChat",conversation_kind:"direct",contact_name:"Retry proof",participants:[],
          messages:[{sequence:0,text:"retry succeeded",speaker_label:"Retry proof",speaker_side:"left",time_text:null}],identity_clues:[],uncertainties:[],
          follow_up_required:false,follow_up_regions:[],width:100,height:200,prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}};}};
    const runner=new ScreenshotContactTaskRunner(pool!,{model:model("unused"),preprocessor,research:null},storage);
    const created=await createScreenshotContactTask(pool!,auth,request,storage,{preprocessingRequired:true});
    await runner.start(auth,created.body.task_id);
    const failed=await loadScreenshotContactTask(pool!,auth,created.body.task_id);expect(failed.status).toBe("failed");
    const before=(await pool!.query("SELECT state FROM screenshot_contact_tasks WHERE id=$1",[failed.task_id])).rows[0].state;
    expect(before.preprocessing_inflight).toBe(0);
    await resumeScreenshotContactTask(pool!,auth,failed.task_id,{expected_revision:failed.revision});
    await runner.start(auth,failed.task_id);
    const done=await loadScreenshotContactTask(pool!,auth,failed.task_id);
    expect(done.status,JSON.stringify(done)).toBe("completed");expect(calls).toBe(2);
    expect(done.events.some(event=>event.tool==="preprocess_screenshot_retry_authorized"&&event.status==="completed")).toBe(true);
    expect((await pool!.query("SELECT state FROM screenshot_contact_tasks WHERE id=$1",[done.task_id])).rows[0].state.preprocessing_inflight).toBeUndefined();
  });
  it("rejects ordinary chat completion when an image naturally expires after the provider returns",async()=>{
    const storage=new TestImageStorage();const request=input();
    const uniqueBytes=Buffer.concat([Buffer.from(request.image.data_base64,"base64"),Buffer.from(randomUUID())]);
    request.image={...request.image,byte_size:uniqueBytes.length,data_base64:uniqueBytes.toString("base64"),content_hash:createHash("sha256").update(uniqueBytes).digest("hex")};
    const created=await createScreenshotContactTask(pool!,auth,request,storage);
    await new ScreenshotContactTaskRunner(pool!,{model:model(`Memory expiry ${randomUUID().slice(0,8)}`),research:null},storage).start(auth,created.body.task_id);
    const task=await loadScreenshotContactTask(pool!,auth,created.body.task_id);expect(task.status).toBe("completed");
    const fragment=(await pool!.query<{id:string}>("SELECT id FROM evidence_fragments WHERE capture_id=$1",[task.capture_id])).rows[0]!.id;
    await reviewEvidenceFragment(pool!,auth,fragment,{idempotency_key:randomUUID(),expected_review_status:"proposed",expected_last_review_id:null,
      decision:"reviewed",confirmed_speaker:"candidate",reason:"Synthetic fixture author verifies its exact text and speaker."});
    await compileRelationshipWiki(pool!,auth,task.contact!.person_id,task.contact!.relationship_context_id,
      {idempotency_key:randomUUID(),objective:"Read the synthetic screenshot evidence."});
    await pool!.query("UPDATE contact_task_images SET expires_at=clock_timestamp()+interval '2 seconds' WHERE task_id=$1",[task.task_id]);
    let providerReturned=false,delayed=false;let providerFailure:unknown;
    const delayedPool=new Proxy(pool!,{get(target,key){
      if(key!=="connect"){const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}
      return async()=>{
        const client=await target.connect();
        return new Proxy(client,{get(connection,property){
          if(property!=="query"){const value=Reflect.get(connection,property);return typeof value==="function"?value.bind(connection):value;}
          return async(...args:any[])=>{
            if(typeof args[0]==="string"&&args[0].includes("INSERT INTO audit_events")&&args[1]?.[3]==="chat_task.assembled"){
              delayed=true;await new Promise(resolve=>setTimeout(resolve,2100));
            }
            return (connection.query as (...input:any[])=>unknown)(...args);
          };
        }});
      };
    }});
    const key=randomUUID();
    const completed=await createChatTask(delayedPool,auth,{idempotency_key:key,objective:"Verify the original",person_id:task.contact!.person_id,
      relationship_context_id:task.contact!.relationship_context_id},{providerId:"claude-agent-sdk",model:"synthetic",supportsImageInput:true,
      answer:async admission=>{
        try {
        expect(admission.readEvidenceImage).toBeTypeOf("function");
        const source=await admission.readEvidenceImage!(fragment,new AbortController().signal);
        expect(source.image.content_hash).toBe(request.image.content_hash);providerReturned=true;
        return {kind:"answer",title:"Source",body:"The original reports employment.",citation_ids:[fragment],provider_id:"claude-agent-sdk",model:"synthetic",
          provider_request_id:randomUUID(),input_tokens:1,output_tokens:1};
        } catch(error) {providerFailure=error;throw error;}
      }},storage).catch(error=>error);
    expect(providerFailure).toBeUndefined();
    expect(completed).toMatchObject({code:"HARNESS_SOURCE_CHANGED"});
    expect(providerReturned).toBe(true);expect(delayed).toBe(true);
    expect((await pool!.query("SELECT id FROM context_manifests WHERE account_id=$1 AND subject_id=$2 AND objective='Verify the original'",[auth.accountId,task.contact!.person_id])).rowCount).toBe(0);
  });
  it("reconciles a partial upload, survives extraction interruption, and reads each scoped original",async()=>{
    const storage=new TestImageStorage();storage.failPutAt=2;
    const request={...input(),additional_images:[input().image]};
    await expect(createScreenshotContactTask(pool!,auth,request,storage)).rejects.toMatchObject({code:"CONTACT_IMAGE_UPLOAD_FAILED"});
    expect(storage.objects.size).toBe(1);
    const created=await createScreenshotContactTask(pool!,auth,request,storage);
    expect(created.replayed).toBe(true);expect(storage.puts).toBe(3);expect(storage.objects.size).toBe(2);
    const repeated=await createScreenshotContactTask(pool!,auth,request,storage);
    expect(repeated.body.task_id).toBe(created.body.task_id);expect(storage.puts).toBe(3);
    const batchName=`Batch proof ${randomUUID().slice(0,8)}`;
    const base=model(batchName,{timeText:"next Tuesday"});let calls=0;
    const flaky:ContactAgentModel={...base,extract:async(...args)=>{if(++calls===2)throw new Error("TEST_VISION_INTERRUPTED");return base.extract(...args);}};
    const runner=new ScreenshotContactTaskRunner(pool!,{model:flaky,research:null},storage);
    await runner.start(auth,created.body.task_id);
    const failed=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(failed.status).toBe("failed");expect(failed.extraction).toBeNull();
    await resumeScreenshotContactTask(pool!,auth,failed.task_id,{expected_revision:failed.revision});
    await runner.start(auth,failed.task_id);
    const result=await loadScreenshotContactTask(pool!,auth,failed.task_id);
    expect(result.status,JSON.stringify(result)).toBe("completed");expect(calls).toBe(3);expect(result.message_count).toBe(2);
    expect(result.extraction?.messages.map(m=>[m.message_id,m.source_image_index])).toEqual([["m1",0],["m2",1]]);
    const persisted=await pool!.query("SELECT input_manifest,state FROM screenshot_contact_tasks WHERE id=$1",[result.task_id]);
    expect(JSON.stringify(persisted.rows)).not.toContain("data_base64");
    expect(await loadScreenshotContactImage(pool!,auth,result.task_id,1,storage)).toEqual(request.additional_images[0]);
    const fragments=(await pool!.query<{id:string;locator:{source_message_id:string}}>(
      "SELECT id,locator FROM evidence_fragments WHERE capture_id=$1 ORDER BY sequence",[result.capture_id])).rows;
    expect(fragments.map(fragment=>fragment.locator)).toEqual([
      {kind:"message",source_message_id:"image1:m1",sequence:0,speaker_side:"left",speaker_label:batchName,
        visible_time_text:"next Tuesday",source_image_index:0},
      {kind:"message",source_message_id:"image2:m2",sequence:1,speaker_side:"left",speaker_label:batchName,
        visible_time_text:"next Tuesday",source_image_index:1},
    ]);
    const read=createHarnessEvidenceImageReader(pool!,auth,result.contact!.person_id,result.contact!.relationship_context_id,
      fragments.map(fragment=>fragment.id),storage,async()=>{});
    const original=await read(fragments[1]!.id,new AbortController().signal);
    expect(original).toMatchObject({evidence_id:fragments[1]!.id,task_id:result.task_id,source_image_index:1,image:request.additional_images[0]});
    await original.assertCurrent();
    await expect(read(randomUUID(),new AbortController().signal)).rejects.toMatchObject({code:"EVIDENCE_IMAGE_UNAVAILABLE"});
    const otherScope=createHarnessEvidenceImageReader(pool!,auth,result.contact!.person_id,randomUUID(),
      [fragments[1]!.id],storage,async()=>{});
    await expect(otherScope(fragments[1]!.id,new AbortController().signal)).rejects.toMatchObject({code:"EVIDENCE_IMAGE_UNAVAILABLE"});
    await expect(loadScreenshotContactImage(pool!,{...auth,userId:randomUUID()},result.task_id,1,storage)).rejects.toMatchObject({code:"CONTACT_TASK_NOT_FOUND"});
    await expect(loadScreenshotContactImage(pool!,auth,result.task_id,1,new TestImageStorage())).rejects.toThrow("CONTACT_IMAGE_STORAGE_MISMATCH");
    await pool!.query("UPDATE source_retention_receipts SET authorization_state='revoked' WHERE capture_id=$1",[result.capture_id]);
    await expect(original.assertCurrent()).rejects.toMatchObject({code:"EVIDENCE_IMAGE_UNAVAILABLE"});
    await expect(loadScreenshotContactImage(pool!,auth,result.task_id,0,storage)).rejects.toMatchObject({code:"CONTACT_TASK_SOURCE_UNAVAILABLE"});
    storage.failPurge=true;
    await expect(expireScreenshotContactTasks(pool!,storage)).rejects.toThrow("CONTACT_IMAGE_PURGE_INCOMPLETE");
    expect(storage.objects.size).toBe(2);
    storage.failPurge=false;await expireScreenshotContactTasks(pool!,storage);
    expect(storage.objects.size).toBe(0);
    expect((await pool!.query("SELECT status FROM contact_task_images WHERE task_id=$1",[result.task_id])).rows).toEqual([{status:"deleted"},{status:"deleted"}]);
  });
  it("does not let contact selection override conflicting batch identities and expires unfiled originals",async()=>{
    const storage=new TestImageStorage();const request={...input(),additional_images:[input().image]};
    const created=await createScreenshotContactTask(pool!,auth,request,storage);let count=0;
    const base=model(`Different proof ${randomUUID().slice(0,8)}`);
    const runner=new ScreenshotContactTaskRunner(pool!,{research:null,model:{...base,extract:async(...args)=>{
      const output=await base.extract(...args);return {...output,extraction:{...output.extraction,contact_name:`Different ${++count}`}};
    }}},storage);
    await runner.start(auth,created.body.task_id);
    const waiting=await loadScreenshotContactTask(pool!,auth,created.body.task_id);
    expect(waiting.status).toBe("waiting_for_user");expect(waiting.contact).toBeNull();
    await expect(resumeScreenshotContactTask(pool!,auth,waiting.task_id,{expected_revision:waiting.revision,new_contact_name:"Different 1"})).rejects.toMatchObject({code:"CONTACT_BATCH_IDENTITY_CONFLICT"});
    await pool!.query("UPDATE screenshot_contact_tasks SET expires_at=now()-interval '1 second' WHERE id=$1",[waiting.task_id]);
    await expireScreenshotContactTasks(pool!,storage);expect(storage.objects.size).toBe(0);
  });
});

// One real decodable 120x240 PNG fixture (white), generated once with sharp.
const ARK_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAHgAAADwCAIAAABE5TcwAAAACXBIWXMAAAPoAAAD6AG1e1JrAAACF0lEQVR4nO3QQQ0AAAyEsPk3fXPRFzVAwi3EmUwajTQaaTTSaKTRSKORRiONRhqNNBppNNJopNFIo5FGI41GGo00Gmk00mik0UijkUYjjUYajTQaaTTSaKTRSKORRiONRhqNNBppNNJopNFIo5FGI41GGo00Gmk00mik0UijkUYjjUYajTQaaTTSaKTRSKORRiONRhqNNBppNNJopNFIo5FGI41GGo00Gmk00mik0UijkUYjjUYajTQaaTTSaKTRSKORRiONRhqNNBppNNJopNFIo5FGI41GGo00Gmk00mik0UijkUYjjUYajTQaaTTSaKTRSKORRiONRhqNNBppNNJopNFIo5FGI41GGo00Gmk00mik0UijkUYjjUYajTQaaTTSaKTRSKORRiONRhqNNBppNNJopNFIo5FGI41GGo00Gmk00mik0UijkUYjjUYajTQaaTTSaKTRSKORRiONRhqNNBppNNJopNFIo5FGI41GGo00Gmk00mik0UijkUYjjUYajTQaaTTSaKTRSKORRiONRhqNNBppNNJopNFIo5FGI41GGo00Gmk00mik0UijkUYjjUYajTQaaTTSaKTRSKORRiONRhqNNBppNNJopNFIo5FGI41GGo00Gmk00mik0UijkUYjjUYajTQaaTTSaKTRSKORRiONRhqNNBppNNJopNFIo5FGI41GGo00Gmk00mik0UijZzwNbEIx8PhucwAAAABJRU5ErkJggg==";
function arkImage():ScreenshotContactTaskRequest["image"]{
  const bytes=Buffer.from(ARK_PNG_BASE64,"base64");
  return {media_type:"image/png",byte_size:bytes.length,content_hash:createHash("sha256").update(bytes).digest("hex"),data_base64:ARK_PNG_BASE64};
}
function arkRequest(){
  return {idempotency_key:randomUUID(),objective:"File this synthetic chat and analyze the evidence.",
    image:arkImage(),allow_public_research:false,captured_at:new Date().toISOString()};
}
const ARK_MODEL_OUTPUT={platform:"WeChat",conversation_kind:"direct",contact_name:"Synthetic Ark Person",
  participants:[{label:"我",side:"right",role_hint:"account_owner",visible_name:null}],
  messages:[{sequence:0,text:"Synthetic private source message",speaker_label:"Synthetic Ark Person",speaker_side:"left",time_text:"09:30"}],
  identity_clues:[{kind:"name",value:"Synthetic Ark Person",source_excerpt:"Synthetic Ark Person"}],
  uncertainties:[],follow_up_regions:[]};
function fakeArkFetcher(usage:unknown,onDispatch?:()=>Promise<void>|void){
  return vi.fn(async()=>{
    await onDispatch?.();
    return new Response(JSON.stringify({id:`ark-${randomUUID()}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      choices:[{message:{content:JSON.stringify(ARK_MODEL_OUTPUT)}}],...(usage===undefined?{}:{usage})}));
  }) as typeof fetch;
}
function observeRunnerLookup(base:Pool,onLookup:(rows:number)=>void):Pool{
  return new Proxy(base,{get(target,key){
    if(key==="query")return async(...args:any[])=>{
      const result=await (target.query as (...input:any[])=>Promise<unknown>).apply(target,args);
      if(typeof args[0]==="string"&&args[0].includes("FROM product_runs WHERE account_id=$1 AND user_id=$2 AND task_id=$3"))
        onLookup((result as {rows:unknown[]}).rows.length);
      return result;
    };
    const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
  }}) as unknown as Pool;
}
function arkApp(runner:ScreenshotContactTaskRunner,storage:ChatMediaStorage,runnerPool:Pool=pool!){
  const app=Fastify();
  const authenticate=async(request:import("fastify").FastifyRequest)=>{request.auth=auth;};
  registerProductRunMonitoring(app,pool!,authenticate);
  registerScreenshotContactRoutes(app,runnerPool,authenticate,storage,runner);
  return app;
}
async function settleRunner(runner:ScreenshotContactTaskRunner,taskID:string){
  for(let attempt=0;attempt<100;attempt++){
    await runner.drain();
    const current=await pool!.query<{status:string}>("SELECT status FROM screenshot_contact_tasks WHERE id=$1",[taskID]);
    if(current.rows[0]?.status!=="running")return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error("TEST_RUNNER_DID_NOT_SETTLE");
}
async function runArkScreenshotTask(usage:unknown,options:{fetcher?:ReturnType<typeof fakeArkFetcher>;model?:ContactAgentModel;request?:Partial<ScreenshotContactTaskRequest>}={}){
  const fetcher=options.fetcher??fakeArkFetcher(usage);
  const storage=new TestImageStorage();
  const preprocessor=new ArkScreenshotPreprocessor({apiKey:"synthetic",fetcher});
  const sdk=options.model??sdkModel(async(admission,signal)=>{
    await admission.invoke("ask_contact_clarification",{question:"Which visible person should own this source?"},signal);
    return sdkReceipt();
  });
  const runner=new ScreenshotContactTaskRunner(pool!,{model:sdk,preprocessor,research:null},storage);
  const app=arkApp(runner,storage);
  await app.ready();
  const request={...arkRequest(),...options.request};
  const response=await app.inject({method:"POST",url:"/v1/contact-agent/tasks",payload:request});
  const taskID=response.json().task_id as string;
  const runID=response.headers["x-talent-signal-run-id"] as string;
  await settleRunner(runner,taskID);
  const detail=await new ProductRunService(pool!).detail(auth,taskID,true);
  const waiting=await loadScreenshotContactTask(pool!,auth,taskID);
  const generation=(await pool!.query<{source_generation:string}>("SELECT source_generation FROM product_runs WHERE id=$1",[runID])).rows[0]!.source_generation;
  return {app,storage,fetcher,runner,taskID,runID,request,response,detail,waiting,generation};
}

describe.skipIf(!pool)("GET-37 source-safe screenshot usage diagnostics",()=>{
  it("keeps exact raw Ark usage diagnostics readable after ordinary checkpoints on one canonical run",async()=>{
    const fixture=await runArkScreenshotTask({prompt_tokens:12,completion_tokens:8});
    try {
      expect(fixture.response.statusCode).toBe(201);
      expect(fixture.response.json().status).toBe("running");
      // One canonical admitted run, bound to the task the background runner completed.
      const runs=await pool!.query<{id:string}>("SELECT id FROM product_runs WHERE account_id=$1 AND user_id=$2 AND task_id=$3",[auth.accountId,auth.userId,fixture.taskID]);
      expect(runs.rows.map(row=>row.id)).toEqual([fixture.runID]);
      expect(fixture.waiting.status).toBe("waiting_for_user");
      expect(fixture.waiting.revision).toBeGreaterThan(3); // several normal checkpoints
      const diagnostics=fixture.detail.spans.filter(span=>span.name==="contact.screenshot.preprocess.usage");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]!.metadata).toMatchObject({provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
        reported_model:ARK_SCREENSHOT_PREPROCESS_MODEL,raw_usage_known:true,
        raw_prompt_tokens:12,raw_completion_tokens:8,source_image_index:0});
      expect(diagnostics[0]!.input).toEqual({status:"unavailable",original_bytes:0,retained_bytes:0,sha256:null});
      expect(diagnostics[0]!.output).toEqual({status:"unavailable",original_bytes:0,retained_bytes:0,sha256:null});
      // Raw request/response content stays under its original generation fence:
      // only bounded counters are observable, never pixels or provider bodies.
      const serialized=JSON.stringify(fixture.detail.spans);
      expect(serialized).not.toContain(ARK_PNG_BASE64);
      expect(serialized).not.toContain("Synthetic private source message");
      await expect(new ProductRunService(pool!).detail({...auth,userId:randomUUID()},fixture.taskID,true))
        .rejects.toMatchObject({statusCode:404});
    } finally {await fixture.app.close();}
  });

  it.each([
    ["a provider-reported zero",{prompt_tokens:0,completion_tokens:0},true,0,0,{input_tokens:0,output_tokens:0}],
    ["missing usage",undefined,false,null,null,{input_tokens:0,output_tokens:0}],
    ["invalid raw usage",{prompt_tokens:-1,completion_tokens:2},false,null,null,{input_tokens:0,output_tokens:2}],
    ["half-observed raw usage",{prompt_tokens:7},false,null,null,{input_tokens:7,output_tokens:0}],
  ] as const)("keeps %s explicitly known or unknown in product-run metadata",async(_label,usage,known,prompt,completion,packetUsage)=>{
    const fixture=await runArkScreenshotTask(usage);
    try {
      const diagnostics=fixture.detail.spans.filter(span=>span.name==="contact.screenshot.preprocess.usage");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]!.metadata).toMatchObject({provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
        raw_usage_known:known,raw_prompt_tokens:prompt,raw_completion_tokens:completion});
      // The frozen packet keeps normalized per-field counters; they can never
      // claim a known zero. Only raw_usage_known/raw_* carry that exact claim.
      expect(fixture.waiting.preprocessing?.usage).toEqual(packetUsage);
    } finally {await fixture.app.close();}
  });

  it("binds the canonical run before background work and replays idempotently with one provider execution",async()=>{
    const storage=new TestImageStorage();
    const objective=`GET-37 binding proof ${randomUUID()}`;
    let dispatched!:()=>void;let release!:()=>void;
    const started=new Promise<void>(resolve=>{dispatched=resolve;});
    const barrier=new Promise<void>(resolve=>{release=resolve;});
    let bindingRowsAtDispatch=-1;
    let observeBinding!: (value: { runID: string; taskID: string }) => void;
    const bindingProbe=new Promise<{ runID: string; taskID: string }>(resolve=>{observeBinding=resolve;});
    const fetcher=vi.fn(async()=>{
      dispatched();
      const {runID,taskID}=await bindingProbe;
      bindingRowsAtDispatch=(await pool!.query("SELECT task_id FROM product_runs WHERE id=$1 AND task_id=$2",
        [runID,taskID])).rowCount??-1;
      await barrier;
      return new Response(JSON.stringify({id:`ark-${randomUUID()}`,model:ARK_SCREENSHOT_PREPROCESS_MODEL,
        choices:[{message:{content:JSON.stringify(ARK_MODEL_OUTPUT)}}],usage:{prompt_tokens:3,completion_tokens:2}}));
    }) as typeof fetch;
    const preprocessor=new ArkScreenshotPreprocessor({apiKey:"synthetic",fetcher});
    let sdkCalls=0;
    const sdk=sdkModel(async(admission,signal)=>{
      sdkCalls++;
      await admission.invoke("ask_contact_clarification",{question:"Which visible person should own this source?"},signal);
      return sdkReceipt();
    });
    const lookups:number[]=[];
    const runner=new ScreenshotContactTaskRunner(observeRunnerLookup(pool!,rows=>lookups.push(rows)),{model:sdk,preprocessor,research:null},storage);
    const app=arkApp(runner,storage,observeRunnerLookup(pool!,rows=>lookups.push(rows)));
    await app.ready();
    try {
      const request={...arkRequest(),objective};
      const pending=app.inject({method:"POST",url:"/v1/contact-agent/tasks",payload:request});
      const response=await pending;
      expect(response.statusCode).toBe(201);
      const runID=response.headers["x-talent-signal-run-id"] as string;
      const taskID=response.json().task_id as string;
      observeBinding({runID,taskID});
      await started;
      release();
      await runner.drain();
      // Background work observes the canonical run already bound before dispatch.
      expect(bindingRowsAtDispatch).toBe(1);
      // The runner starts from the admitted, bound run, never a response-lifetime sink.
      expect(lookups.length).toBeGreaterThan(0);
      expect(lookups[0]).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const replay=await app.inject({method:"POST",url:"/v1/contact-agent/tasks",payload:request});
      expect(replay.statusCode).toBe(200);
      expect(replay.headers["idempotent-replayed"]).toBe("true");
      expect(replay.json().task_id).toBe(taskID);
      await runner.drain();
      expect(fetcher).toHaveBeenCalledTimes(1);
      const runs=await pool!.query<{id:string;attempts:number}>("SELECT id,attempts FROM product_runs WHERE account_id=$1 AND task_id=$2",[auth.accountId,taskID]);
      expect(runs.rows).toEqual([{id:runID,attempts:2}]);
      expect(sdkCalls).toBe(1);
      const waiting=await loadScreenshotContactTask(pool!,auth,taskID);
      const resumed=await app.inject({method:"POST",url:`/v1/contact-agent/tasks/${taskID}/resume`,
        payload:{expected_revision:waiting.revision}});
      expect(resumed.statusCode).toBe(200);
      // A properly bound canonical run still supports real HTTP resume.
      await vi.waitFor(()=>expect(sdkCalls).toBe(2));
      await runner.drain();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect((await loadScreenshotContactTask(pool!,auth,taskID)).status).toBe("waiting_for_user");

    } finally {await app.close();}
  });

  it("keeps usage diagnostics readable after unrelated task drift, cleanup and a later rebind without any replay",async()=>{
    const first=await runArkScreenshotTask({prompt_tokens:9,completion_tokens:4});
    const diagnostics=(detail:{spans:Array<{name:string;metadata:Record<string,unknown>}>})=>
      detail.spans.filter(span=>span.name==="contact.screenshot.preprocess.usage");
    try {
      expect(first.detail.run.content_available).toBe(true);
      expect(diagnostics(first.detail)).toHaveLength(1);
      // A second ordinary screenshot task advances the account source generation.
      const second=input();
      const created=await createScreenshotContactTask(pool!,auth,second);
      await new ScreenshotContactTaskRunner(pool!,{model:model(`Drift ${randomUUID().slice(0,8)}`),research:null}).start(auth,created.body.task_id,second.image);
      // Direct read of the first task: no replay, no save, no rewrite of any kind.
      const drifted=await new ProductRunService(pool!).detail(auth,first.taskID,true);
      expect(drifted.run.content_available).toBe(false);
      expect(diagnostics(drifted)).toHaveLength(1);
      expect(diagnostics(drifted)[0]!.metadata).toMatchObject({provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,
        reported_model:ARK_SCREENSHOT_PREPROCESS_MODEL,raw_usage_known:true,raw_prompt_tokens:9,raw_completion_tokens:4});
      expect(Object.keys(diagnostics(drifted)[0]!.metadata).sort()).toEqual(["model","provider","raw_completion_tokens",
        "raw_prompt_tokens","raw_usage_known","reported_model","request_id_sha256","source_image_index"]);
      expect(JSON.stringify(drifted)).not.toContain(ARK_PNG_BASE64);
      expect(JSON.stringify(drifted)).not.toContain("Synthetic private source message");
      expect(JSON.stringify(drifted)).not.toContain('"request_id"');
      // A real cleanup tick must not delete the only usage span before read.
      await cleanupProductRunSources(pool!);
      const cleaned=await new ProductRunService(pool!).detail(auth,first.taskID,true);
      expect(cleaned.run.content_available).toBe(false);
      expect(diagnostics(cleaned)).toHaveLength(1);
      expect(diagnostics(cleaned)[0]!.metadata).toMatchObject({raw_usage_known:true,raw_prompt_tokens:9,raw_completion_tokens:4});
      // A later first-run rebind across the drifted generation keeps them too.
      await saveProductRunOutput(pool!,{id:first.runID,taskID:first.taskID},
        first.waiting as unknown as Record<string,unknown>,first.waiting.status);
      const rebound=await new ProductRunService(pool!).detail(auth,first.taskID,true);
      // The rebind re-admits the latest checkpointed response (product
      // semantics) but never raw request bytes or span content.
      expect(rebound.input).toEqual({status:"unavailable",original_bytes:0,retained_bytes:0,sha256:null});
      expect(diagnostics(rebound)).toHaveLength(1);
      expect(diagnostics(rebound)[0]!.metadata).toMatchObject({raw_usage_known:true,raw_prompt_tokens:9,raw_completion_tokens:4});
      expect(JSON.stringify(rebound.spans)).not.toContain(ARK_PNG_BASE64);
      expect(JSON.stringify(rebound.spans)).not.toContain("Synthetic private source message");
    } finally {await first.app.close();}
  });

  it("keeps the exact metadata-only SDK usage leaf across the final checkpoint purge",async()=>{
    const hashOne=createHash("sha256").update("synthetic-raw-sdk-id").digest("hex");
    const hashTwo=createHash("sha256").update("synthetic-raw-sdk-id-2").digest("hex");
    const timestamp=new Date().toISOString();
    const sdk=sdkModel(async(admission,signal)=>{
      await recordProductEvent("harness.sdk.assistant","llm",undefined,{content:[{text:"Synthetic private answer"}]},{
        sdk_message_id:"synthetic-raw-sdk-id",model:"synthetic-sdk-model",provider:"claude-agent-sdk",
        usage:{input_tokens:12,output_tokens:4,cache_read_input_tokens:7,cache_creation_input_tokens:2,source:"provider"},
        sdk_message_id_sha256:hashOne,sdk_input_tokens:12,sdk_output_tokens:4,sdk_cache_read_input_tokens:7,
        sdk_cache_creation_input_tokens:2,sdk_total_input_tokens:21,
        sdk_usage_basis:"per_message_provider_reported_input_excludes_cache",sdk_stop_reason:"end_turn"},
        {startedAt:timestamp,finishedAt:timestamp});
      await recordProductEvent("harness.sdk.assistant","llm",undefined,"Synthetic private source message",{
        sdk_message_id:"synthetic-raw-sdk-id-2",model:"synthetic-sdk-model",provider:"claude-agent-sdk",
        usage:{source:"unavailable"},sdk_message_id_sha256:hashTwo,sdk_input_tokens:null,sdk_output_tokens:null,
        sdk_cache_read_input_tokens:null,sdk_cache_creation_input_tokens:null,sdk_total_input_tokens:null,
        sdk_usage_basis:"per_message_provider_reported_input_excludes_cache",sdk_stop_reason:"synthetic prose stop reason"},
        {startedAt:timestamp,finishedAt:timestamp});
      await admission.invoke("ask_contact_clarification",{question:"Which visible person should own this source?"},signal);
      return sdkReceipt();
    });
    const fixture=await runArkScreenshotTask({prompt_tokens:1,completion_tokens:1},{model:sdk});
    try {
      const leaves=fixture.detail.spans.filter(span=>span.name==="harness.sdk.assistant");
      expect(leaves).toHaveLength(2);
      const known=leaves.find(span=>span.metadata.sdk_message_id_sha256===hashOne)!;
      expect(known.input).toEqual({status:"unavailable",original_bytes:0,retained_bytes:0,sha256:null});
      expect(known.metadata).toMatchObject({provider:"claude-agent-sdk",model:"synthetic-sdk-model",
        sdk_message_id_sha256:hashOne,sdk_input_tokens:12,sdk_output_tokens:4,sdk_cache_read_input_tokens:7,
        sdk_cache_creation_input_tokens:2,sdk_total_input_tokens:21,
        sdk_usage_basis:"per_message_provider_reported_input_excludes_cache",sdk_stop_reason:"end_turn"});
      expect(Object.keys(known.metadata).sort()).toEqual(["model","provider","sdk_cache_creation_input_tokens",
        "sdk_cache_read_input_tokens","sdk_input_tokens","sdk_message_id_sha256","sdk_output_tokens",
        "sdk_stop_reason","sdk_total_input_tokens","sdk_usage_basis"]);
      const unknown=leaves.find(span=>span.metadata.sdk_message_id_sha256===hashTwo)!;
      expect(unknown.metadata).toMatchObject({sdk_input_tokens:null,sdk_output_tokens:null,
        sdk_cache_read_input_tokens:null,sdk_cache_creation_input_tokens:null,sdk_total_input_tokens:null,sdk_stop_reason:null});
      const serialized=JSON.stringify(fixture.detail.spans);
      expect(serialized).not.toContain("synthetic-raw-sdk-id");
      expect(serialized).not.toContain("Synthetic private answer");
      expect(serialized).not.toContain("Synthetic private source message");
      expect(serialized).not.toContain('"usage"');
    } finally {await fixture.app.close();}
  });

  it("keeps real iOS post-review linked diagnostics while retired, expired and lost sources stay hidden",async()=>{
    const person=randomUUID(),context=randomUUID(),seed=randomUUID();
    await pool!.query("INSERT INTO subjects(id,account_id,external_ref,display_label) VALUES($1::uuid,$2,$1::text,'Transport person')",[person,auth.accountId]);
    await pool!.query("INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label) VALUES($1::uuid,$2,$3::uuid,$1::text,'Transport context')",[context,auth.accountId,person]);
    const reviewed=await runArkScreenshotTask({prompt_tokens:7,completion_tokens:2},{request:{
      idempotency_key:`ios:${seed}:preprocess-v3`,preprocess_only:true}});
    const diagnostics=async()=>{const detail=await new ProductRunService(pool!).detail(auth,reviewed.taskID,true);
      return {detail,count:detail.spans.filter(span=>span.name==="contact.screenshot.preprocess.usage").length};};
    try {
      expect(reviewed.waiting.status).toBe("completed");
      expect(reviewed.detail.run.content_available).toBe(true);
      const canonical=await createIOSCapture(seed,person,context);
      const captureID=canonical.body.capture_id;
      expect((await pool!.query("SELECT source_access_state,source_access_reason,authorization_state FROM source_retention_receipts WHERE capture_id=$1",[captureID])).rows[0])
        .toMatchObject({source_access_state:"purged",source_access_reason:"review_completed",authorization_state:"authorized"});
      // This is the real producer/link protocol, including preprocess_only,
      // exact iOS request seed, source resource and completed idempotency record.
      const linked=await linkScreenshotContactTaskCapture(pool!,auth,reviewed.taskID,{
        expected_revision:reviewed.waiting.revision,capture_id:captureID,source_resource_id:canonical.body.resource.id});
      expect(linked.capture_id).toBe(captureID);
      expect((await loadScreenshotContactTask(pool!,auth,reviewed.taskID)).status).toBe("completed");
      let read=await diagnostics();
      expect(read.detail.run.content_available).toBe(false);
      expect(read.count).toBe(1);
      expect(read.detail.spans[0]!.metadata).toMatchObject({raw_usage_known:true,raw_prompt_tokens:7,raw_completion_tokens:2});
      await pool!.query("UPDATE source_retention_receipts SET authorization_expires_at=now()-interval '1 second' WHERE capture_id=$1",[captureID]);
      expect((await diagnostics()).count).toBe(0);
      await pool!.query("UPDATE source_retention_receipts SET authorization_expires_at=now()+interval '30 days',retention_until=now()-interval '1 second' WHERE capture_id=$1",[captureID]);
      expect((await diagnostics()).count).toBe(0);
      await pool!.query("UPDATE source_retention_receipts SET retention_until=NULL WHERE capture_id=$1",[captureID]);
      expect((await diagnostics()).count).toBe(1);
      await pool!.query("UPDATE subjects SET status='deleted' WHERE id=$1",[person]);
      expect((await diagnostics()).count).toBe(0);
      await pool!.query("UPDATE subjects SET status='active' WHERE id=$1",[person]);
      // A purge/revoke AFTER linking retires this original task through 047.
      // Nothing revives its state, lease epoch or retraction record.
      await pool!.query("UPDATE source_retention_receipts SET authorization_state='revoked' WHERE capture_id=$1",[captureID]);
      expect((await loadScreenshotContactTask(pool!,auth,reviewed.taskID)).status).toBe("deleted");
      expect((await diagnostics()).count).toBe(0);
      await expect(new ProductRunService(pool!).detail({...auth,userId:randomUUID()},reviewed.taskID,true)).rejects.toMatchObject({statusCode:404});
      await cleanupProductRunSources(pool!);
      await saveProductRunUsageDiagnostics(pool!,{accountID:randomUUID(),taskID:reviewed.taskID},
        [{provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,source_image_index:0,request_id:"ark-foreign",
          reported_model:ARK_SCREENSHOT_PREPROCESS_MODEL,raw_usage_known:true,raw_prompt_tokens:7,raw_completion_tokens:2}]);
      await saveProductRunUsageDiagnostics(pool!,{accountID:auth.accountId,taskID:reviewed.taskID},
        [{provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,source_image_index:0,request_id:"ark-late",
          reported_model:ARK_SCREENSHOT_PREPROCESS_MODEL,raw_usage_known:true,raw_prompt_tokens:7,raw_completion_tokens:2}]);
      expect((await pool!.query("SELECT count(*)::int AS n FROM product_run_spans WHERE run_id=$1",[reviewed.runID])).rows[0]!.n).toBe(0);
    } finally {await reviewed.app.close();}
  });

  it("never starts unbound background work through failed POST, GET recovery or resume",async()=>{
    const storage=new TestImageStorage();
    const fetcher=fakeArkFetcher({prompt_tokens:3,completion_tokens:2});
    const sdk=vi.fn(async(admission:any,signal:AbortSignal)=>{
      await admission.invoke("ask_contact_clarification",{question:"Which visible person should own this source?"},signal);return sdkReceipt();
    });
    const runner=new ScreenshotContactTaskRunner(pool!,{model:sdkModel(sdk),
      preprocessor:new ArkScreenshotPreprocessor({apiKey:"synthetic",fetcher}),research:null},storage);
    let starts=0;
    const original=runner.start.bind(runner);
    runner.start=(...args:Parameters<ScreenshotContactTaskRunner["start"]>)=>{starts++;return original(...args);};
    const app=Fastify();
    const authenticate=async(request:import("fastify").FastifyRequest)=>{request.auth=auth;};
    app.addHook("onSend",async(request,reply,payload)=>{
      if(!request.routeOptions.url?.includes("contact-agent"))return payload;
      if(request.headers["x-test-failing-once"]==="done")return payload;
      request.headers["x-test-failing-once"]="done";
      throw new Error("SYNTHETIC_ONSEND_FAILURE");
    });
    registerProductRunMonitoring(app,pool!,authenticate);
    registerScreenshotContactRoutes(app,pool!,authenticate,storage,runner);
    await app.ready();
    try {
      const request=arkRequest();
      const response=await app.inject({method:"POST",url:"/v1/contact-agent/tasks",payload:request,
        headers:{"x-test-failing-once":"pending"}});
      expect(response.statusCode).toBe(500);
      await new Promise(resolve=>setTimeout(resolve,250));
      expect(starts).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
      const run=(await pool!.query<{task_id:string|null;status:string}>(
        "SELECT task_id,status FROM product_runs WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1",[auth.accountId])).rows[0];
      expect(run!.task_id).toBeNull();
      expect(run!.status).toBe("failed");
      const taskID=(await pool!.query("SELECT id FROM screenshot_contact_tasks WHERE account_id=$1 AND idempotency_key=$2",[auth.accountId,request.idempotency_key])).rows[0]!.id;
      const recovered=await app.inject({method:"GET",url:`/v1/contact-agent/tasks/${taskID}`,headers:{"x-test-failing-once":"done"}});
      expect(recovered.statusCode).toBe(200);
      await new Promise(resolve=>setTimeout(resolve,250));
      expect(starts).toBe(0);expect(fetcher).not.toHaveBeenCalled();expect(sdk).not.toHaveBeenCalled();
      // Deliberate non-HTTP callers retain their existing contract. Use that
      // supported producer to create a resumable orphan without inventing a run
      // binding or rewriting task state; HTTP must still refuse to dispatch it.
      await original(auth,taskID,request.image);
      const waiting=await loadScreenshotContactTask(pool!,auth,taskID);
      expect(waiting.status).toBe("waiting_for_user");
      expect(fetcher).toHaveBeenCalledTimes(1);expect(sdk).toHaveBeenCalledTimes(1);
      const resumed=await app.inject({method:"POST",url:`/v1/contact-agent/tasks/${taskID}/resume`,
        payload:{expected_revision:waiting.revision},headers:{"x-test-failing-once":"done"}});
      expect(resumed.statusCode).toBe(200);
      await new Promise(resolve=>setTimeout(resolve,250));
      expect(starts).toBe(0);expect(fetcher).toHaveBeenCalledTimes(1);expect(sdk).toHaveBeenCalledTimes(1);

    } finally {await app.close();}
  });

  it("never starts background work on premature close or stream rejection of the real reply",async()=>{
    const storage=new TestImageStorage();
    const fetcher=fakeArkFetcher({prompt_tokens:4,completion_tokens:3});
    const runner=new ScreenshotContactTaskRunner(pool!,{model:sdkModel(async()=>{throw new Error("UNEXPECTED_MODEL");}),
      preprocessor:new ArkScreenshotPreprocessor({apiKey:"synthetic",fetcher}),research:null},storage);
    let starts=0;
    const original=runner.start.bind(runner);
    runner.start=(...args:Parameters<ScreenshotContactTaskRunner["start"]>)=>{starts++;return original(...args);};
    const app=Fastify();
    const authenticate=async(request:import("fastify").FastifyRequest)=>{request.auth=auth;};
    registerProductRunMonitoring(app,pool!,authenticate);
    registerScreenshotContactRoutes(app,pool!,authenticate,storage,runner);
    app.addHook("onSend",async(request,reply,payload)=>{
      if(request.headers["x-test-mode"]==="reject"){
        reply.raw.on("error",()=>{});
        reply.raw.destroy(new Error("SYNTHETIC_STREAM_FAILURE"));
      } else await new Promise(resolve=>setTimeout(resolve,400));
      return payload;
    });
    await app.listen({port:0,host:"127.0.0.1"});
    const port=(app.server.address() as {port:number}).port;
    const post=(mode:"drop"|"reject")=>new Promise<void>(resolve=>{
      const req=httpRequest({host:"127.0.0.1",port,path:"/v1/contact-agent/tasks",method:"POST",
        headers:{"content-type":"application/json","x-test-mode":mode}},()=>{});
      req.on("error",()=>{});
      req.end(JSON.stringify(arkRequest()));
      if(mode==="drop"){setTimeout(()=>{req.destroy();resolve();},100);} else {req.on("close",()=>resolve());}
    });
    try {
      await post("drop");
      await post("reject");
      await new Promise(resolve=>setTimeout(resolve,500));
      expect(starts).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {await app.close();}
  },20_000);

  it("runs exactly one provider execution for concurrent same-key admissions",async()=>{
    const storage=new TestImageStorage();
    const fetcher=fakeArkFetcher({prompt_tokens:2,completion_tokens:1});
    const preprocessor=new ArkScreenshotPreprocessor({apiKey:"synthetic",fetcher});
    const sdk=sdkModel(async(admission,signal)=>{
      await admission.invoke("ask_contact_clarification",{question:"Which visible person should own this source?"},signal);
      return sdkReceipt();
    });
    const runner=new ScreenshotContactTaskRunner(pool!,{model:sdk,preprocessor,research:null},storage);
    const app=arkApp(runner,storage);
    await app.ready();
    try {
      const request=arkRequest();
      const responses=await Promise.all([
        app.inject({method:"POST",url:"/v1/contact-agent/tasks",payload:request}),
        app.inject({method:"POST",url:"/v1/contact-agent/tasks",payload:request}),
      ]);
      expect(responses.map(response=>response.statusCode).sort()).toEqual([200,201]);
      const taskID=responses[0]!.json().task_id as string;
      expect(new Set(responses.map(response=>response.json().task_id))).toEqual(new Set([taskID]));
      await settleRunner(runner,taskID);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const runs=await pool!.query<{id:string;attempts:number}>("SELECT id,attempts FROM product_runs WHERE account_id=$1 AND task_id=$2",[auth.accountId,taskID]);
      expect(runs.rows).toHaveLength(1);
      expect(runs.rows[0]!.attempts).toBe(2);
    } finally {await app.close();}
  });

  it("never restores raw or forbidden content after deletion, late flush or late diagnostics writes",async()=>{
    const fixture=await runArkScreenshotTask({prompt_tokens:6,completion_tokens:3});
    try {
      expect(fixture.detail.run.content_available).toBe(true);
      const deleted=await deleteContactCaptureTask(pool!,auth,fixture.taskID,fixture.waiting.revision,fixture.storage,()=>{});
      expect(deleted.status).toBe("deleted");
      await cleanupProductRunSources(pool!);
      const after=await new ProductRunService(pool!).detail(auth,fixture.taskID,true);
      expect(after.run.content_available).toBe(false);
      expect(after.spans).toEqual([]);
      const serialized=JSON.stringify(after);
      expect(serialized).not.toContain(ARK_PNG_BASE64);
      expect(serialized).not.toContain("Synthetic private source message");
      // A late append/flush under the original generation cannot restore raw content.
      const sink=productRunSink(pool!,fixture.runID,error=>{throw error;},fixture.generation);
      const timestamp=new Date().toISOString();
      await sink.append({id:randomUUID(),parent_id:null,name:"late.preprocess",kind:"llm",status:"completed",
        started_at:timestamp,finished_at:timestamp,
        input:captureObservationContent({source:"Synthetic private source message"},2000),
        output:captureObservationContent({usage:{prompt_tokens:6,completion_tokens:3}},2000),
        metadata:{provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL},error:null});
      await sink.flush();
      // A late metadata-only diagnostics write cannot recreate revoked run content.
      await saveProductRunUsageDiagnostics(pool!,{accountID:auth.accountId,taskID:fixture.taskID},
        [{provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL,source_image_index:0,request_id:"ark-late",
          reported_model:ARK_SCREENSHOT_PREPROCESS_MODEL,raw_usage_known:true,raw_prompt_tokens:6,raw_completion_tokens:3}]);
      const rows=await pool!.query<{content:string}>("SELECT span::text AS content FROM product_run_spans WHERE run_id=$1",[fixture.runID]);
      expect(JSON.stringify(rows.rows)).not.toContain("Synthetic private source message");
      expect(JSON.stringify(rows.rows)).not.toContain(ARK_PNG_BASE64);
      const diagnostics=await pool!.query("SELECT id FROM product_run_spans WHERE run_id=$1 AND span->>'name'='contact.screenshot.preprocess.usage'",[fixture.runID]);
      expect(diagnostics.rows).toEqual([]);
    } finally {await fixture.app.close();}
  });
});
