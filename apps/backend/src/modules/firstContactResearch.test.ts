import {createHash,randomUUID} from "node:crypto";
import {describe,it,expect,vi} from "vitest";
import {ScriptedAgentProvider,CONTACT_RESEARCH_CONTRACT,type ContactResearchToolRequest,type ContactPublicSource,type ContactResearchToolResponse} from "@talent-signal/agent";
import {executeWorkspaceConversationAgentCore,type WorkspaceMemoryLookup} from "./workspaceConversationAgent.js";
import {createFirstContactResearch,firstContactNameCandidate,withFirstContactNameCandidate,firstContactResearchAnswerAlreadyCovered} from "./firstContactResearch.js";
import {createWorkspacePublicResearch} from "./workspacePublicResearch.js";
const bytes=Buffer.from("synthetic pixels");
const image={kind:"image" as const,artifactID:"conversation-image-10000000-0000-4000-8000-000000000001-0-source",mimeType:"image/png",byteSize:bytes.length,contentHash:createHash("sha256").update(bytes).digest("hex"),dataBase64:bytes.toString("base64")};
const source:ContactPublicSource={source_id:createHash("sha256").update("exa:https://example.org/profile").digest("hex"),url:"https://example.org/profile",title:"Synthetic public profile",text:"Synthetic research background",channel:"web",provider_id:"exa",provider_request_id:"synthetic",content_hash:"b".repeat(64),retrieved_at:"2026-10-04T15:00:00Z",stage:"discovered"};
const observation={description:"Synthetic fictional direct chat",visible_text:["Andrej Karpathy","nanoGPT"],uncertainties:[],conversation_kind:"direct" as const,counterparty_name:"Andrej Karpathy",public_context_anchors:[{name:"Andrej Karpathy",kind:"work" as const,excerpt:"nanoGPT"}],source_warning:"ai_generated_or_fictional" as const,model:"stub",request_id:"stub"};
function client(hook?:()=>void){
 const execute=vi.fn(async(request:ContactResearchToolRequest):Promise<ContactResearchToolResponse>=>{hook?.();return {contract_version:CONTACT_RESEARCH_CONTRACT,task_id:request.task_id,call_id:request.call_id,sources:[{...source,stage:request.input.operation==="search"?"discovered":"fetched"}],channels:request.input.operation==="search"?[{channel:"web",provider:"exa",status:"ok",result_count:1,truncated:false,error_code:null}]:[],fetch_outcomes:request.input.operation==="fetch"?[{source_id:source.source_id,channel:"web",provider:"exa",status:"ok",error_code:null}]:[],external_effects:[]};});return {execute};
}
async function run(options:{objective?:string;hook?:()=>void;current?:()=>boolean;signal?:AbortSignal;provider?:ScriptedAgentProvider}={}){
 const researchClient=client(options.hook), stage=vi.fn<WorkspaceMemoryLookup["stage"]>(async()=>({proposalID:randomUUID(),proposalRevision:1,itemCount:1,defaultSelectedCount:0,scopeCounts:{self:0,person:1,relationship:0},contactStatus:"pending" as const,personID:null,personDisplayLabel:"Andrej Karpathy"}));
 const onToolCompletion=vi.fn();
 const execution=await executeWorkspaceConversationAgentCore({workspaceID:"synthetic",objective:options.objective??"Prepare this contact",sourceText:"",provider:options.provider??new ScriptedAgentProvider([],{outcome:"reply",title:"Contact",body:"Synthetic answer"}),inputParts:[image],imageInspector:{inspect:async()=>observation},imageIsCurrent:async()=>options.current?.()??true,researchClient,...(options.signal?{signal:options.signal}:{}),contacts:{search:async()=>[],read:vi.fn()},memory:{recall:async()=>({items:[],hasMore:false,nextCursor:null}),stage},onToolCompletion});
 return {execution,researchClient,stage,onToolCompletion};
}
describe("host first-contact research",()=>{
 it("searches name+public context, fetches before review, retains name and authentic tool records without model tools",async()=>{
  const {execution,researchClient,stage,onToolCompletion}=await run();
  expect(researchClient.execute.mock.calls.map(([r])=>r.input.operation)).toEqual(["search","fetch"]);
  expect(researchClient.execute.mock.calls[0]![0].input).toMatchObject({query:"Andrej Karpathy nanoGPT"});
  expect(researchClient.execute.mock.calls[0]![0].anchors).toEqual(["Andrej Karpathy","nanoGPT"]);
  expect(stage).toHaveBeenCalledOnce();expect(stage.mock.calls[0]![0]).toMatchObject({nameCandidate:{scope:"person",source_excerpt:"Andrej Karpathy",statement_kind:"source_statement"}});
  expect(execution.providerResult.toolCompletions?.map(r=>r.name)).toEqual(["search_public_subject","fetch_public_sources"]);
  expect(onToolCompletion).toHaveBeenCalledTimes(2);expect(execution.block.body).toContain("身份待确认");expect(execution.block.body).toContain(source.retrieved_at);
 });
 it.each(["不要搜索，先准备联系人","不用搜索，先准备联系人","Don't search; prepare this contact"])("honors objective opt-out with empty image source: %s",async objective=>{
  const {execution,researchClient,stage}=await run({objective});expect(researchClient.execute).not.toHaveBeenCalled();expect(stage).toHaveBeenCalledOnce();expect(execution.firstContactResearch[0]?.status).toBe("opted_out");
 });
 it("does not continue staging when cancelled during search",async()=>{
  const controller=new AbortController();await expect(run({signal:controller.signal,hook:()=>controller.abort(new Error("USER_CANCELLED"))})).rejects.toThrow();
 });
 it("does not present a proposal when the image is revoked during search",async()=>{
  let current=true;await expect(run({current:()=>current,hook:()=>{current=false;}})).rejects.toThrow("PUBLIC_RESEARCH_SUBJECT_NOT_CURRENT");
 });
 it("model Memory creation uses the same mandatory research",async()=>{
  const provider=new ScriptedAgentProvider([{tool:"memory_review",input:{operation:"propose",contact_decision:"new",person_display_label:"Andrej Karpathy",new_contact_source_locator:{kind:"image_region",artifact_id:image.artifactID,image_index:0},items:[]}}],{outcome:"reply",title:"Contact",body:"Review"});
  const {researchClient,stage}=await run({provider});expect(researchClient.execute).toHaveBeenCalledTimes(2);expect(stage).toHaveBeenCalledOnce();
 });
 it("reuses previously fetched same-run results without spending another dispatch",async()=>{
  const c=client();const research=createWorkspacePublicResearch({client:c,taskID:randomUUID(),authorizedSubjects:()=>[{id:"subject",name:"Andrej Karpathy"}]});
  await research.execute("search_public_subject",{subject_id:"subject"});await research.execute("fetch_public_sources",{source_ids:[source.source_id]});
  const runner=createFirstContactResearch({research,searchOptedOut:()=>false});const result=await runner.attempt({id:"subject",name:"Andrej Karpathy"});
  expect(c.execute).toHaveBeenCalledTimes(2);expect(result.status).toBe("searched");expect(result.citations[0]?.stage).toBe("fetched");
 });
 it("does not let a model URL suppress identity/time provenance or a relationship excerpt suppress name Memory",()=>{
  const candidate=firstContactNameCandidate({name:"Andrej Karpathy",nameExcerpt:"Andrej Karpathy",sourceLocator:{kind:"message",session_id:null,message_id:null}})!;
  expect(withFirstContactNameCandidate([{...candidate,scope:"relationship",source_excerpt:"Andrej Karpathy 推荐 nanoGPT",display_text:"讨论 nanoGPT"}],candidate)).toHaveLength(2);
  expect(firstContactResearchAnswerAlreadyCovered(`身份已经确认 ${source.url}`,[{status:"searched",identity_status:"tentative",subject_id:"subject",subject_name:"Andrej Karpathy",searched_at:source.retrieved_at,citations:[{...source,stage:"fetched"}],summary:"synthetic"}])).toBe(false);
 });
});

 it("researches source-grounded text contact creation with project context and a message name candidate",async()=>{
  const researchClient=client(),stage=vi.fn<WorkspaceMemoryLookup["stage"]>(async()=>({proposalID:randomUUID(),proposalRevision:1,itemCount:1,defaultSelectedCount:0,scopeCounts:{self:0,person:1,relationship:0},contactStatus:"pending" as const,personID:null,personDisplayLabel:"Andrej Karpathy"}));
  const execution=await executeWorkspaceConversationAgentCore({workspaceID:"synthetic",messageID:"10000000-0000-4000-8000-000000000001",objective:"Create Andrej Karpathy as a contact; Andrej Karpathy created nanoGPT",provider:new ScriptedAgentProvider([{tool:"memory_review",input:{operation:"propose",contact_decision:"new",person_display_label:"Andrej Karpathy",new_contact_source_locator:{kind:"message",session_id:null,message_id:"10000000-0000-4000-8000-000000000001"},items:[]}}],{outcome:"reply",title:"Contact",body:"Review"}),researchClient,contacts:{search:async()=>[],read:vi.fn()},memory:{recall:async()=>({items:[],hasMore:false,nextCursor:null}),stage}});
  expect(execution.memoryProposal).toBeTruthy();expect(researchClient.execute.mock.calls[0]![0].input).toMatchObject({query:"Andrej Karpathy nanoGPT"});
  expect(stage.mock.calls[0]![0]).toMatchObject({nameCandidate:{source_excerpt:"Andrej Karpathy",source_locator:{kind:"message",message_id:"10000000-0000-4000-8000-000000000001"}}});
 });
 it("researches a contact_workspace create proposal before exposing its review event",async()=>{
  const researchClient=client();
  const execution=await executeWorkspaceConversationAgentCore({workspaceID:"synthetic",objective:"Create Andrej Karpathy as a contact for nanoGPT",provider:new ScriptedAgentProvider([{tool:"contact_workspace",input:{operation:"propose_create",display_name:"Andrej Karpathy",relationship_context:"nanoGPT",identity_clue:null,source_excerpts:["Andrej Karpathy","nanoGPT"],reason:"Explicit synthetic contact request"}}],results=>({outcome:"contact_change_proposal",candidate_fingerprint:results[0]?.candidateFingerprint})),researchClient,contacts:{search:async()=>[],read:vi.fn()}});
  expect(execution.event?.kind).toBe("contact_change_proposal");expect(researchClient.execute.mock.calls.map(([r])=>r.input.operation)).toEqual(["search","fetch"]);expect(researchClient.execute.mock.calls[0]![0].input).toMatchObject({query:"Andrej Karpathy nanoGPT"});
 });

it("keeps exact literal name evidence and each subject's membership in a shared fetched page",async()=>{
 const raw="Ａｎｄｒｅｊ Ｋａｒｐａｔｈｙ";
 expect(firstContactNameCandidate({name:raw,nameExcerpt:raw,sourceLocator:{kind:"message",session_id:null,message_id:null}})?.source_excerpt).toBe(raw);
 const c=client();const research=createWorkspacePublicResearch({client:c,taskID:randomUUID(),authorizedSubjects:()=>[{id:"first",name:"Andrej Karpathy"},{id:"second",name:"Alice Smith"}]});
 await research.execute("search_public_subject",{subject_id:"first"});await research.execute("fetch_public_sources",{source_ids:[source.source_id]});await research.execute("search_public_subject",{subject_id:"second"});
 for(const id of ["first","second"]){expect(research.subjectSearchState(id).sources[0]?.stage).toBe("fetched");}
 const result=await createFirstContactResearch({research,searchOptedOut:()=>false}).attempt({id:"first",name:"Andrej Karpathy"});
 expect(result.status).toBe("searched");expect(c.execute).toHaveBeenCalledTimes(3);
});
