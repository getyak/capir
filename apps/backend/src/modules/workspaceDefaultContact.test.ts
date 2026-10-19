import {createHash} from "node:crypto";
import {describe,it,expect,vi} from "vitest";
import {ScriptedAgentProvider,type CurrentImageObservation} from "@talent-signal/agent";
import {executeWorkspaceConversationAgentCore,type WorkspaceMemoryLookup} from "./workspaceConversationAgent.js";

const bytes=Buffer.from("synthetic pixels");
const artifactID="conversation-image-10000000-0000-4000-8000-000000000001-0-source";
const image={kind:"image" as const,artifactID,mimeType:"image/png",byteSize:bytes.length,contentHash:createHash("sha256").update(bytes).digest("hex"),dataBase64:bytes.toString("base64")};
const observation:CurrentImageObservation={conversation_kind:"direct",counterparty_name:"小雨",visible_text:["小雨","最近在读 Andrew 写的东西。"],description:"Two person chat",uncertainties:[],model:"doubao",request_id:"test-receipt"};
async function run(options:{observation?:CurrentImageObservation;objective?:string;current?:()=>boolean;bound?:boolean;multiple?:boolean;provider?:ScriptedAgentProvider}={}) {
 const stage=vi.fn<WorkspaceMemoryLookup["stage"]>(async()=>({proposalID:"10000000-0000-4000-8000-000000000002",proposalRevision:1,itemCount:0,defaultSelectedCount:0,scopeCounts:{self:0,person:0,relationship:0},contactStatus:"ambiguous" as const,personID:null,personDisplayLabel:"小雨",relationshipDisplayLabel:"已暂存的关系标签"}));
 const inspector={inspect:vi.fn(async()=>options.observation??observation)};
 const provider=options.provider??new ScriptedAgentProvider([],{outcome:"reply",title:"需要确认",body:"Andrew 是哪一位，需要链接确认。"});
 const result=await executeWorkspaceConversationAgentCore({workspaceID:"test",messageID:"10000000-0000-4000-8000-000000000001",objective:options.objective??"了解聊天里讨论的 Andrew",provider,
  inputParts:options.multiple?[image,{...image,artifactID:artifactID+"2"}]:[image],imageInspector:inspector,imageIsCurrent:async()=>options.current?.()??true,
  ...(options.bound?{humanIdentityBinding:{personID:"10000000-0000-4000-8000-000000000003",contextID:null}}:{}),
  contacts:{search:vi.fn(async()=>[]),read:vi.fn()},memory:{recall:async()=>({items:[],hasMore:false,nextCursor:null}),stage}});
 return {result,stage,inspector};
}
describe("default direct-chat contact review",()=>{
 it.each(["profile", "public post", "group participant", "event poster", "photo caption"])("offers an editable contact from a %s without a private relationship or handle",async kind=>{
  const {result,stage}=await run({objective:"想添加截图里的这位",observation:{...observation,conversation_kind:"unknown",counterparty_name:null,
   description:kind,visible_text:["Peter Yang · Product creator"],contact_candidates:[{name:"Peter Yang",source_excerpt:"Peter Yang · Product creator"}]}});
  expect(result.memoryProposal).toBeTruthy();
  expect(stage).toHaveBeenCalledWith(expect.objectContaining({contactDecision:"new",identityAuthority:"tentative",identityClue:null,
   newContact:expect.objectContaining({display_label:"Peter Yang",relationship_context:"",source_locator:{kind:"image_region",artifact_id:artifactID,image_index:0}}),
   nameCandidate:expect.objectContaining({source_excerpt:"Peter Yang · Product creator",source_locator:{kind:"image_region",artifact_id:artifactID,image_index:0}})}));
 });
 it.each(["了解聊天里讨论的 Andrew","准备日历草稿","描述图片内容"])("keeps a name-only option during %s",async objective=>{
  const {result,stage,inspector}=await run({objective});
  expect(inspector.inspect).toHaveBeenCalledOnce();expect(stage).toHaveBeenCalledOnce();
  expect(stage).toHaveBeenCalledWith(expect.objectContaining({personID:null,contactDecision:"new",identityAuthority:"tentative",items:[],newContact:{display_label:"小雨",relationship_context:"",source_locator:{kind:"image_region",artifact_id:artifactID,image_index:0}}}));
  expect(result.memoryProposal).toBeTruthy();
 });
 it.each(["group","unknown"] as const)("does not invent a target in a %s without visible candidates",async conversation_kind=>{
  expect((await run({observation:{...observation,conversation_kind}})).stage).not.toHaveBeenCalled();
 });
 it("does not invent an unreadable name",async()=>{
  expect((await run({observation:{...observation,counterparty_name:"Hidden person"}})).stage).not.toHaveBeenCalled();
 });
 it.each(["不要添加联系人，先看图片","Please don't create contacts; describe the photo"])("respects a current-user decline: %s",async objective=>{
  expect((await run({objective})).stage).not.toHaveBeenCalled();
 });
 it("keeps a new-person option available even when another person is bound",async()=>{
  expect((await run({bound:true})).result.memoryProposal).toBeTruthy();
 });
 it("offers one tentative review for a repeated visible label across screenshots",async()=>{
  const {result,stage}=await run({multiple:true});
  expect(result.memoryProposal).toBeTruthy();
  expect(stage).toHaveBeenCalledOnce();
  expect(stage).toHaveBeenCalledWith(expect.objectContaining({identityAuthority:"tentative",personID:null}));
 });
 it("rechecks source after model execution before offering a name",async()=>{
  let current=true;
  const provider=new ScriptedAgentProvider([],{outcome:"reply",title:"说明",body:"图片内容"});
  const original=provider.run.bind(provider);
  vi.spyOn(provider,"run").mockImplementation(async(...args)=>{const result=await original(...args);current=false;return result;});
  expect((await run({provider,current:()=>current})).stage).not.toHaveBeenCalled();
 });
});

const contactInput=(name="小雨")=>({operation:"propose",contact_decision:"new",person_display_label:name,new_contact_source_locator:{kind:"image_region",artifact_id:artifactID,image_index:0},items:[]});
describe("model and host use the same contact boundary",()=>{
 it("keeps a main-Agent image draft reviewable when the secondary reading has no name",async()=>{
  const provider=new ScriptedAgentProvider([{tool:"memory_review",input:contactInput()}],{outcome:"reply",title:"待添加",body:"请核对名字。"});
  const {result,stage}=await run({provider,objective:"添加这个人",observation:{...observation,visible_text:[],counterparty_name:null}});
  expect(result.memoryProposal).toBeTruthy();
  expect(stage).toHaveBeenCalledWith(expect.objectContaining({newContact:expect.objectContaining({display_label:"小雨"}),items:[]}));
  expect(stage.mock.calls[0]![0]).not.toHaveProperty("nameCandidate");
 });
 it("keeps an authored label bound to the message when an unrelated image also mentions it",async()=>{
  const provider=new ScriptedAgentProvider([{tool:"memory_review",input:{...contactInput("Andrew"),
   new_contact_source_locator:{kind:"message",message_id:"10000000-0000-4000-8000-000000000001"}}}],{outcome:"reply",title:"待添加",body:"可编辑后添加。"});
  const {stage}=await run({provider,objective:"给我同事 Andrew 建个联系人"});
  expect(stage).toHaveBeenCalledWith(expect.objectContaining({newContact:expect.objectContaining({source_locator:expect.objectContaining({kind:"message"})}),
   nameCandidate:expect.objectContaining({source_locator:expect.objectContaining({kind:"message"})})}));
 });
 it("preserves a self preference when combining a contact from multiple current images",async()=>{
  const provider=new ScriptedAgentProvider([{tool:"memory_review",input:{operation:"propose",contact_decision:"none",items:[{scope:"self",operation:"add",statement_kind:"source_statement",display_text:"先给结论",source_excerpt:"先给结论",source_locator:{kind:"message"},time_status:"known",sensitivity:"normal",reason:"Communication preference"}]}}],{outcome:"reply",title:"说明",body:"可核对。"});
  const {stage}=await run({provider,objective:"先给结论",multiple:true});
  expect(stage).toHaveBeenCalledWith(expect.objectContaining({contactDecision:"new",items:[expect.objectContaining({scope:"self",source_excerpt:"先给结论"})]}));
 });
 it("reports the staged relationship label even when a replay differs from this request",async()=>{
  const provider=new ScriptedAgentProvider([],{outcome:"reply",title:"说明",body:"可核对"});
  vi.spyOn(provider,"run").mockImplementation(async(_request,invoke)=>{
   const result=await invoke("memory_review",contactInput());
   expect(result.ok).toBe(true);
   expect(result.data).toMatchObject({relationship_display_label:"已暂存的关系标签"});
   return {structuredOutput:{outcome:"reply",title:"说明",body:"可核对"},inputTokens:0,outputTokens:0,estimatedUsd:0,turns:1,permissionDenials:[]};
  });
  await run({provider});
 });
 it("rejects a model-created contact when the user declined it",async()=>{
  const provider=new ScriptedAgentProvider([{tool:"memory_review",input:contactInput()}],{outcome:"reply",title:"说明",body:"图片内容"});
  expect((await run({objective:"不要添加联系人，先看图片",provider})).stage).not.toHaveBeenCalled();
 });
 it.each(["image_region","message",null])("accepts a selected discussed person with source provenance %s",async(kind)=>{
  const provider=new ScriptedAgentProvider([{tool:"memory_review",input:{...contactInput("Andrew"),new_contact_source_locator:kind==="image_region"?contactInput().new_contact_source_locator:kind==="message"?{kind:"message",session_id:null,message_id:null}:null,items:kind===null?[{scope:"self",operation:"add",statement_kind:"source_statement",display_text:"Andrew",source_excerpt:"Andrew",source_locator:{kind:"message",session_id:null,message_id:null},time_status:"known",sensitivity:"normal",reason:"test"}]:[]}}],{outcome:"reply",title:"说明",body:"Andrew 身份不明"});
  const {result,stage}=await run({provider,objective:"想添加 Andrew"});expect(result.memoryProposal).toBeTruthy();expect(stage).toHaveBeenCalledOnce();expect(stage).toHaveBeenCalledWith(expect.objectContaining({newContact:expect.objectContaining({display_label:"Andrew"})}));
 });
 it("combines self memory and the default contact in one proposal",async()=>{
  const provider=new ScriptedAgentProvider([{tool:"memory_review",input:{operation:"propose",contact_decision:"none",items:[{scope:"self",operation:"add",statement_kind:"source_statement",display_text:"先给结论",source_excerpt:"先给结论",source_locator:{kind:"message",session_id:null,message_id:null},time_status:"known",sensitivity:"normal",reason:"Communication preference"}]}}],{outcome:"reply",title:"说明",body:"可核对"});
  const {stage}=await run({provider,objective:"先给结论"});expect(stage).toHaveBeenCalledOnce();expect(stage).toHaveBeenCalledWith(expect.objectContaining({contactDecision:"new",newContact:expect.objectContaining({display_label:"小雨"}),items:[expect.objectContaining({scope:"self"})]}));
 });
 it("reserves the one proposal slot across concurrent model calls",async()=>{
  const provider=new ScriptedAgentProvider([],{outcome:"reply",title:"说明",body:"可核对"});
  vi.spyOn(provider,"run").mockImplementation(async(_request,invoke)=>{
   const results=await Promise.all([invoke("memory_review",contactInput()),invoke("memory_review",contactInput())]);
   expect(results.filter(r=>r.ok)).toHaveLength(1);
   return {structuredOutput:{outcome:"reply",title:"说明",body:"可核对"},inputTokens:0,outputTokens:0,estimatedUsd:0,turns:1,permissionDenials:[]};
  });
  expect((await run({provider})).stage).toHaveBeenCalledOnce();
 });
});
