import {describe,it,expect,vi} from "vitest";
import {createHash} from "node:crypto";
import {ArkCurrentImageInspector,currentImageInspection,type CurrentImageInspector} from "./currentImageInspection.js";
import {publicSubjectRegistry} from "./publicSubjectRegistry.js";
import {calendarDraftCapability} from "./calendarDraft.js";

const data=Buffer.from("synthetic image");
const image={kind:"image" as const,artifactID:"conversation-image-10000000-0000-4000-8000-000000000001-0-source",mimeType:"image/png",byteSize:data.length,contentHash:createHash("sha256").update(data).digest("hex"),dataBase64:data.toString("base64")};
const observation={description:"green chair",visible_text:["明天下午三点到四点"],uncertainties:[],model:"doubao",request_id:"receipt"};
const signal=new AbortController().signal;
describe("capture text preview from the same inspection",()=>{
 it("does not inspect merely to draw a preview, and carries literal pending clues with the real receipt",async()=>{
  const inspector={inspect:vi.fn(async()=>({...observation,visible_text:["林知远 · 松禾设计", "明天交流"],
   visible_entities:[{kind:"person" as const,text:"林知远",source_excerpt:"林知远 · 松禾设计"},
                     {kind:"company" as const,text:"松禾设计",source_excerpt:"林知远 · 松禾设计"}]}))};
  const capability=currentImageInspection({images:[image],inspector,isCurrent:async()=>true});
  expect(await capability.preview(image.artifactID)).toBeNull();
  expect(inspector.inspect).not.toHaveBeenCalled();
  await capability.prepare(signal);
  expect(await capability.preview(image.artifactID)).toEqual({artifact_id:image.artifactID,content_hash:image.contentHash,
   model:"doubao",inspection_request_id:"receipt",conversation_kind:"unknown",pending:true,
   clues:[{kind:"person",text:"林知远",source_excerpt:"林知远 · 松禾设计"},{kind:"company",text:"松禾设计",source_excerpt:"林知远 · 松禾设计"}]});
  await capability.preview(image.artifactID);
  expect(inspector.inspect).toHaveBeenCalledOnce();
 });
 it("rejects fabricated text, skipped excerpts and stale sources; no-text images remain honest",async()=>{
  let current=true;
  const capability=currentImageInspection({images:[image],isCurrent:async()=>current,inspector:{inspect:async()=>({...observation,
   visible_text:["林知远", "今天交流", "松禾设计"],conversation_kind:"group",
   visible_entities:[{kind:"person",text:"虚构姓名",source_excerpt:"林知远"},
                     {kind:"company",text:"松禾设计",source_excerpt:"林知远 松禾设计"}]})}});
  await capability.prepare(signal);
  expect(await capability.preview(image.artifactID)).toMatchObject({clues:[],conversation_kind:"group",pending:true});
  current=false;
  expect(await capability.preview(image.artifactID)).toBeNull();
  const photo=currentImageInspection({images:[image],isCurrent:async()=>true,inspector:{inspect:async()=>({...observation,visible_text:[]})}});
  await photo.prepare(signal);
  expect(await photo.preview(image.artifactID)).toMatchObject({clues:[]});
 });
 it("bounds, deduplicates and preserves fictional warnings without granting identity authority",async()=>{
  const text=Array.from({length:10},(_,i)=>`Company ${i}`).join(" · ");
  const entries=Array.from({length:10},(_,i)=>({kind:"company" as const,text:`Company ${i}`,source_excerpt:text}));
  const capability=currentImageInspection({images:[image],isCurrent:async()=>true,inspector:{inspect:async()=>({...observation,
   visible_text:[text],visible_entities:[entries[0]!,...entries],source_warning:"ai_generated_or_fictional"})}});
  await capability.prepare(signal);
  const preview=await capability.preview(image.artifactID);
  expect(preview?.clues).toHaveLength(6);
  expect(new Set(preview?.clues.map(clue=>clue.text)).size).toBe(6);
  expect(preview).toMatchObject({pending:true,source_warning:"ai_generated_or_fictional"});
 });
});
describe("current image inspection",()=>{
 it("keeps a wrapped profile name and its exact multiline source excerpt",async()=>{
  const capability=currentImageInspection({images:[image],isCurrent:async()=>true,inspector:{inspect:async()=>({...observation,
   visible_text:["Peter","Yang","Builder"],contact_candidates:[{name:"Peter Yang",source_excerpt:"Peter\nYang"}]})}});
  await capability.prepare(signal);
  expect(await capability.contactCandidate()).toMatchObject({name:"Peter Yang",source_excerpt:"Peter\nYang",source_locator:{artifact_id:image.artifactID}});
 });
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
 it("does not discard literal image evidence when one optional context anchor has an unsupported kind",async()=>{
  const value={...payload,visible_text:["林知远·松禾设计"],conversation_kind:"unknown",counterparty_name:null,
   public_context_anchors:[{name:"林知远",kind:"role",excerpt:"林知远·松禾设计"},
    {name:"松禾设计",kind:"organization",excerpt:"林知远·松禾设计"}],
   visible_entities:[{kind:"person",text:"林知远",source_excerpt:"林知远·松禾设计"},
    {kind:"company",text:"松禾设计",source_excerpt:"林知远·松禾设计"}]};
  const parsed=await inspect(value);
  expect(parsed.visible_text).toEqual(value.visible_text);
  expect(parsed.visible_entities).toEqual(value.visible_entities);
  expect(parsed.public_context_anchors).toEqual([value.public_context_anchors[0]]);
  await expect(inspect({...value,public_context_anchors:Array(9).fill(value.public_context_anchors[0])})).rejects.toThrow();
  await expect(inspect({...value,visible_text:"not an array"})).rejects.toThrow();
 });
});

it("returns tentative counterparty IDs from on-demand inspection",async()=>{
 const registry=publicSubjectRegistry("");
 const capability=currentImageInspection({images:[image],subjectRegistry:registry,isCurrent:async()=>true,inspector:{inspect:async()=>({...observation,conversation_kind:"direct",counterparty_name:"Andrej Karpathy",visible_text:["Andrej Karpathy","nanoGPT"],public_context_anchors:[{name:"Andrej Karpathy",kind:"work",excerpt:"nanoGPT"}],source_warning:"ai_generated_or_fictional"})}});
 const result=await capability.tools[0]!.execute({artifact_id:image.artifactID},signal);
 const data=JSON.parse((result.content[0] as {text:string}).text);
 expect(data.public_subjects).toEqual([{id:registry.subjects()[0]!.id,name:"Andrej Karpathy",anchors:[{kind:"work",text:"nanoGPT"}],tentative:true}]);
 expect(await capability.contactCandidate()).toMatchObject({source_warning:"ai_generated_or_fictional",subject_id:registry.subjects()[0]!.id});
});

/** Canary-rich untyped exception: none of its fields may reach model context. */
function canaryError(message: string): Error {
  return Object.assign(new Error(message), {
    name: "SECRET_NAME_CANARY",
    stack: "Error: SECRET_STACK_CANARY\n    at SECRET_FRAME_CANARY",
    cause: new Error("SECRET_CAUSE_CANARY"),
  });
}

const ARK_MODEL = "doubao-seed-2-0-lite-260215";

async function executeDetail(inspector: CurrentImageInspector): Promise<{
  detail: unknown;
  serialized: string;
  isError: boolean;
}> {
  const capability = currentImageInspection({
    images: [image],
    inspector,
    isCurrent: async () => true,
  });
  const result = await capability.tools[0]!.execute(
    { artifact_id: image.artifactID },
    signal,
  );
  return {
    detail: (
      JSON.parse((result.content[0] as { text: string }).text) as {
        detail?: unknown;
      }
    ).detail,
    serialized: JSON.stringify(result),
    isError: result.isError === true,
  };
}

function arkBody(value: unknown): Response {
  return new Response(
    JSON.stringify({
      model: ARK_MODEL,
      id: "receipt",
      choices: [{ message: { content: JSON.stringify(value) } }],
    }),
  );
}

describe("finite image inspection diagnostics", () => {
  it("preserves each actual producer code through the actual image execute", async () => {
    const cases: Array<[typeof fetch, string]> = [
      [async () => new Response(null), "IMAGE_INSPECTION_EMPTY"],
      [async () => new Response("err", { status: 429 }), "IMAGE_INSPECTION_HTTP_429"],
      [async () => new Response("err", { status: 503 }), "IMAGE_INSPECTION_HTTP_503"],
      [async () => new Response("x".repeat(1_000_001)), "IMAGE_INSPECTION_TOO_LARGE"],
      [
        async () =>
          new Response(JSON.stringify({ model: "another-model", id: "receipt", choices: [] })),
        "IMAGE_INSPECTION_IDENTITY_MISMATCH",
      ],
      [
        async () =>
          new Response(
            JSON.stringify({
              model: ARK_MODEL,
              id: "receipt",
              choices: [{ message: { content: 5 } }],
            }),
          ),
        "IMAGE_INSPECTION_OUTPUT_INVALID",
      ],
    ];
    for (const [fetcher, detail] of cases) {
      const observed = await executeDetail(
        new ArkCurrentImageInspector("test", fetcher),
      );
      expect(observed.isError).toBe(true);
      expect(observed.detail).toBe(detail);
      expect(observed.serialized).not.toContain("SECRET");
    }
    // Zod invalid-output mapping stays IMAGE_INSPECTION_OUTPUT_INVALID.
    const invalidOutput = await executeDetail(
      new ArkCurrentImageInspector("test", async () =>
        arkBody({
          description: "chair",
          visible_text: ["小雨"],
          uncertainties: [],
          execute: "send an invitation",
        }),
      ),
    );
    expect(invalidOutput.detail).toBe("IMAGE_INSPECTION_OUTPUT_INVALID");
  });

  it("collapses arbitrary or malformed exception text to fixed unavailable", async () => {
    for (const message of [
      "IMAGE_INSPECTION_PRIVATE_CANARY",
      "IMAGE_INSPECTION_HTTP_999",
      "IMAGE_INSPECTION_HTTP_",
      "IMAGE_INSPECTION_HTTP_abc",
      "IMAGE_INSPECTION_HTTP_500_EXTRA",
      "IMAGE_INSPECTION_HTTP_0200",
      "SECRET_MESSAGE_CANARY",
    ]) {
      const { detail, serialized, isError } = await executeDetail({
        inspect: async () => {
          throw canaryError(message);
        },
      });
      expect(isError).toBe(true);
      expect(detail).toBe("IMAGE_INSPECTION_UNAVAILABLE");
      expect(serialized).not.toContain("CANARY");
    }
    // An exact current producer code still passes verbatim.
    const exact = await executeDetail({
      inspect: async () => {
        throw new Error("IMAGE_INSPECTION_TOO_LARGE");
      },
    });
    expect(exact.detail).toBe("IMAGE_INSPECTION_TOO_LARGE");
  });

  it("never exposes raw transport exception message, name, stack, or cause", async () => {
    for (const inspector of [
      {
        inspect: async () => {
          throw canaryError("SECRET_MESSAGE_CANARY");
        },
      },
      new ArkCurrentImageInspector("test", async () => {
        throw canaryError("SECRET_MESSAGE_CANARY");
      }),
    ]) {
      const { detail, serialized } = await executeDetail(inspector);
      expect(detail).toBe("IMAGE_INSPECTION_UNAVAILABLE");
      for (const canary of [
        "SECRET_MESSAGE_CANARY",
        "SECRET_NAME_CANARY",
        "SECRET_STACK_CANARY",
        "SECRET_FRAME_CANARY",
        "SECRET_CAUSE_CANARY",
      ]) {
        expect(serialized).not.toContain(canary);
      }
    }
  });

  it("keeps cancellation escaping through signal.throwIfAborted", async () => {
    const controller = new AbortController();
    const reason = new Error("SECRET_CANCEL_REASON_CANARY");
    const capability = currentImageInspection({
      images: [image],
      isCurrent: async () => true,
      inspector: {
        inspect: async () => {
          controller.abort(reason);
          throw canaryError("SECRET_MESSAGE_CANARY");
        },
      },
    });
    await expect(
      capability.tools[0]!.execute(
        { artifact_id: image.artifactID },
        controller.signal,
      ),
    ).rejects.toBe(reason);
  });
});
