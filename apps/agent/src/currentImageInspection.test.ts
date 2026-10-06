import {describe,it,expect,vi} from "vitest";
import {createHash} from "node:crypto";
import {ArkCurrentImageInspector,currentImageInspection} from "./currentImageInspection.js";
import {publicSubjectRegistry} from "./publicSubjectRegistry.js";
import {calendarDraftCapability} from "./calendarDraft.js";

const data=Buffer.from("synthetic image");
const image={kind:"image" as const,artifactID:"conversation-image-10000000-0000-4000-8000-000000000001-0-source",mimeType:"image/png",byteSize:data.length,contentHash:createHash("sha256").update(data).digest("hex"),dataBase64:data.toString("base64")};
const observation={description:"green chair",visible_text:["明天下午三点到四点"],uncertainties:[],model:"doubao",request_id:"receipt"};
const signal=new AbortController().signal;
describe("current image inspection",()=>{
 it("hands registered image-only topic IDs to the preflight model context",async()=>{
  let current=true;const registry=publicSubjectRegistry("查一下截图提到的作者");
  const excerpt="我最近在读 Maggie Appleton 的文章";
  const capability=currentImageInspection({images:[image],subjectRegistry:registry,isCurrent:async()=>current,
    inspector:{inspect:async()=>({...observation,visible_text:[excerpt],counterparty_name:"乔木",discussed_public_people:[{name:"Maggie Appleton",source_excerpt:excerpt}]})}});
  const prepared=await capability.prepare(signal);
  expect(prepared?.public_subjects).toEqual([{id:registry.subjects()[0]!.id,name:"Maggie Appleton"}]);
  expect(prepared?.public_subjects[0]?.id).toMatch(/^[a-f0-9]{24}$/u);
  current=false;expect(await capability.prepare(signal)).toBeNull();
 });
 it("coalesces concurrent inspection of the same admitted bytes",async()=>{
  let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
  const inspector={inspect:vi.fn(async()=>{await barrier;return observation;})};
  const capability=currentImageInspection({images:[image],inspector,isCurrent:async()=>true});
  const calls=[1,2].map(()=>capability.tools[0]!.execute({artifact_id:image.artifactID},signal));
  release();expect((await Promise.all(calls)).every(r=>!r.isError)).toBe(true);
  expect(inspector.inspect).toHaveBeenCalledOnce();
 });
 it("never dispatches foreign, changed or revoked images",async()=>{
  const inspector={inspect:vi.fn(async()=>observation)};
  for(const images of [[image],[{...image,contentHash:"a".repeat(64)}]]){
   const capability=currentImageInspection({images,inspector,isCurrent:async()=>false});
   expect((await capability.tools[0]!.execute({artifact_id:image.artifactID},signal)).isError).toBe(true);
   expect((await capability.tools[0]!.execute({artifact_id:"foreign"},signal)).isError).toBe(true);
  }
  expect(inspector.inspect).not.toHaveBeenCalled();
 });
 it("requires observed literal text and revalidates after inspection and before staging",async()=>{
  let current=true;
  const inspector={inspect:vi.fn(async()=>observation)};
  const capability=currentImageInspection({images:[image],inspector,isCurrent:async()=>current});
  expect(await capability.supportsExcerpt(image.artifactID,"明天下午三点到四点")).toBe(false);
  expect((await capability.tools[0]!.execute({artifact_id:image.artifactID},signal)).isError).toBe(false);
  expect(await capability.supportsExcerpt(image.artifactID,"invented text")).toBe(false);
  const calendar=()=>calendarDraftCapability({sourceRequestID:"10000000-0000-4000-8000-000000000001",referenceTime:"2026-09-23T02:00:00Z",timeZone:"Asia/Shanghai",validateImageExcerpt:capability.supportsExcerpt},"prepare a calendar");
  const draft={title:"Coffee",starts_at:"2026-09-24T15:00:00+08:00",ends_at:"2026-09-24T16:00:00+08:00",time_zone:"Asia/Shanghai",source_excerpt:"明天下午三点到四点",source_image_artifact_id:image.artifactID};
  expect((await calendar().tools[0]!.execute(draft,signal)).isError).toBe(false);
  current=false;
  expect((await calendar().tools[0]!.execute(draft,signal)).isError).toBe(true);
 });
 it("does not accept an observation when its image is revoked during the request",async()=>{
  let current=true;
  const capability=currentImageInspection({images:[image],isCurrent:async()=>current,inspector:{inspect:async()=>{current=false;return observation;}}});
  expect((await capability.tools[0]!.execute({artifact_id:image.artifactID},signal)).isError).toBe(true);
  expect(await capability.supportsExcerpt(image.artifactID,"明天下午三点到四点")).toBe(false);
 });
 it("accepts consecutive observed poster lines but never skips or reorders them",async()=>{
  let current=true;
  const visible_text=["Reading afternoon","2026-10-02","14:30 - 16:00","Shanghai"];
  const capability=currentImageInspection({images:[image],isCurrent:async()=>current,inspector:{inspect:async()=>({...observation,visible_text})}});
  await capability.prepare(signal);
  for(const separator of ["\n"," "]){
   expect(await capability.supportsExcerpt(image.artifactID,visible_text.join(separator))).toMatchObject({content_hash:image.contentHash});
  }
  for(const excerpt of ["Reading afternoon 14:30 - 16:00","Shanghai 2026-10-02","2026-10-02 14:00 - 16:00","Reading afternoon Shanghai"]){
   expect(await capability.supportsExcerpt(image.artifactID,excerpt)).toBe(false);
  }
  current=false;
  expect(await capability.supportsExcerpt(image.artifactID,visible_text.join("\n"))).toBe(false);
 });
});

describe("Ark observation parsing",()=>{
 const payload={description:"chair",visible_text:["小雨"],uncertainties:[],conversation_kind:"direct",counterparty_name:"小雨"};
 const inspect=(value:unknown)=>new ArkCurrentImageInspector("test",async()=>new Response(JSON.stringify({model:"doubao-seed-2-0-lite-260215",id:"receipt",choices:[{message:{content:JSON.stringify(value)}}]}))).inspect(image,signal);
 it("accepts observed data with only inert echoed schema annotations",async()=>{
  expect(await inspect({...payload,$schema:"https://json-schema.org/draft/2020-12/schema",type:"object"})).toMatchObject({counterparty_name:"小雨",request_id:"receipt"});
 });
 it("rejects unexpected fields or a schema document in place of observations",async()=>{
  await expect(inspect({...payload,execute:"send an invitation"})).rejects.toThrow();
  await expect(inspect({type:"object",properties:{description:{type:"string"}}})).rejects.toThrow();
 });
});

it("returns tentative counterparty IDs from on-demand inspection",async()=>{
 const registry=publicSubjectRegistry("");
 const capability=currentImageInspection({images:[image],subjectRegistry:registry,isCurrent:async()=>true,inspector:{inspect:async()=>({...observation,conversation_kind:"direct",counterparty_name:"Andrej Karpathy",visible_text:["Andrej Karpathy","nanoGPT"],public_context_anchors:[{name:"Andrej Karpathy",kind:"work",excerpt:"nanoGPT"}],source_warning:"ai_generated_or_fictional"})}});
 const result=await capability.tools[0]!.execute({artifact_id:image.artifactID},signal);
 const data=JSON.parse((result.content[0] as {text:string}).text);
 expect(data.public_subjects).toEqual([{id:registry.subjects()[0]!.id,name:"Andrej Karpathy",anchors:[{kind:"work",text:"nanoGPT"}],tentative:true}]);
 expect(await capability.counterparty()).toMatchObject({source_warning:"ai_generated_or_fictional",subject_id:registry.subjects()[0]!.id});
});
