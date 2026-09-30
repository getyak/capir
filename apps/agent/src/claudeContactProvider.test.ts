import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
import { ClaudeContactAgentModel } from "./claudeContactProvider.js";
import { claudeHarnessConfiguration } from "./claudeHarnessConfiguration.js";
import type { ClaudeHarnessRequest } from "./claudeHarness.js";
import { ARK_SCREENSHOT_PREPROCESS_MODEL, SCREENSHOT_PREPROCESS_CONTRACT,
  SCREENSHOT_PREPROCESS_FOLLOW_UP_REGION_LIMIT, SCREENSHOT_PREPROCESS_PROMPT_VERSION,
  SCREENSHOT_PREPROCESS_SCHEMA_VERSION } from "./screenshotPreprocess.js";

describe("multimodal contact SDK adapter", () => {
  it("passes reviewed text to the same harness with a source-specific understanding tool",async()=>{
    const text="Synthetic Person works at Example Labs.";
    const readImage=vi.fn(async()=>{throw new Error("TEXT_RUN_MUST_NOT_READ_PIXELS");});
    const execute=vi.fn(async (_configuration,request:ClaudeHarnessRequest)=>{
      expect(JSON.parse(request.context!).reviewed_source_text).toBe(text);
      expect(request.images).toEqual([]);
      expect(request.tools.map(t=>t.name)).toContain("record_text_understanding");
      expect(request.tools.map(t=>t.name)).not.toContain("record_screenshot_understanding");
      expect(request.tools.map(t=>t.name)).not.toContain("inspect_screenshot_region");
      expect(request.subagents).toEqual([]);
      return {text:"Synthetic",structuredOutput:null,sessionID:"synthetic-text",inputTokens:1,outputTokens:1,estimatedUsd:0,turns:1,toolCalls:0,toolCompletions:[],terminalReason:"completed",permissionDenials:[],reportedModels:["synthetic"]};
    });
    const model=new ClaudeContactAgentModel(claudeHarnessConfiguration({ANTHROPIC_API_KEY:"synthetic",TALENT_SIGNAL_AGENT_MODEL:"synthetic"}),execute);
    await model.run({objective:"Read source",text,images:[],systemPrompt:"Synthetic",state:{},assertCurrent:async()=>{},readImage,recordUnderstanding:vi.fn(),invoke:vi.fn()},new AbortController().signal);
    expect(execute).toHaveBeenCalledOnce();
    expect(readImage).not.toHaveBeenCalled();
  });
  it("starts with the original image and lets the Agent request understanding when useful", async () => {
    const bytes = await sharp({create:{width:20,height:40,channels:3,background:"white"}}).png().toBuffer();
    const config = claudeHarnessConfiguration({ ANTHROPIC_API_KEY: "synthetic", TALENT_SIGNAL_AGENT_MODEL: "synthetic" });
    const record = vi.fn(async () => ({ status: "unconfirmed" }));
    const execute = vi.fn(async (_configuration, request: ClaudeHarnessRequest) => {
      expect(request.images?.[0]?.contentHash).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(request.images?.[0]?.kind === "image" && request.images[0].dataBase64).toBe(bytes.toString("base64"));
      expect(record).not.toHaveBeenCalled();
      expect(request.tools.map((tool) => tool.name)).toContain("record_screenshot_understanding");
      expect(request.tools.map((tool) => tool.name)).toContain("inspect_screenshot_region");
      expect(request.tools.find(tool => tool.name === "browse_contact_source")?.readOnly).toBe(true);
      expect(request.subagents?.[0]?.tools).toEqual(["inspect_screenshot_region", "record_screenshot_source_review"]);
      expect(request.skills?.map((skill) => skill.name)).toEqual(["relationship-evidence"]);
      expect(request.outputSchema).toBeUndefined();
      const finish = request.tools.find((tool) => tool.name === "finish_contact_task")!;
      const schema = z.toJSONSchema(finish.schema) as any;
      expect(schema.properties.findings.description).toContain("Return []");
      expect(schema.properties.findings.items.properties.text.description).toContain("supported entirely by the cited original chat messages");
      expect(schema.properties.findings.items.properties.message_refs.description).toContain("All actual message_id");
      expect(schema.properties.findings.items.properties.source_excerpt.description).toContain("One contiguous exact substring");
      return { text: "Synthetic", structuredOutput: null, sessionID: "synthetic-run", inputTokens: 10, outputTokens: 10,
        estimatedUsd: 0, turns: 1, toolCalls: 0, toolCompletions: [], terminalReason: "completed", permissionDenials: [], reportedModels: ["synthetic"] };
    });
    const model = new ClaudeContactAgentModel(config, execute);
    await model.run({ objective: "Read the profile", systemPrompt: "Synthetic", state: {}, assertCurrent: async () => {}, readImage: async operation => operation(),
      images: [{ media_type: "image/png", byte_size: bytes.length, content_hash: createHash("sha256").update(bytes).digest("hex"), data_base64: bytes.toString("base64") }],
      recordUnderstanding: record, invoke: vi.fn(async () => ({})) }, new AbortController().signal);
    expect(execute).toHaveBeenCalledOnce();
    expect(record).not.toHaveBeenCalled();
    await expect(model.extract()).rejects.toThrow("USE_MULTIMODAL_RUN");
    await expect(model.next()).rejects.toThrow("USE_SDK_TOOL_LOOP");
  });
  it("uses completed preprocessing without reading or retransmitting originals",async()=>{
    const readImage=vi.fn(async()=>{throw new Error("ORIGINAL_MUST_NOT_BE_READ");});
    const preprocessing={contract_version:SCREENSHOT_PREPROCESS_CONTRACT,schema_version:SCREENSHOT_PREPROCESS_SCHEMA_VERSION,
      prompt_version:SCREENSHOT_PREPROCESS_PROMPT_VERSION,provider:"volcano_ark" as const,model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      request_receipts:[{source_image_index:0,request_id:"ark-1",input_tokens:1,output_tokens:1}],usage:{input_tokens:1,output_tokens:1},sources:[{
        source_image_index:0,source_hash:"a".repeat(64),platform:"WeChat",conversation_kind:"direct" as const,contact_name:"Synthetic",
        participants:[],messages:[],identity_clues:[],uncertainties:[],follow_up_required:false,follow_up_regions:[],width:100,height:200,
        prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}]};
    const execute=vi.fn(async(_configuration,request:ClaudeHarnessRequest)=>{
      expect(request.images).toEqual([]);
      expect(request.subagents).toEqual([]);
      expect(request.tools.map(tool=>tool.name)).not.toContain("record_screenshot_understanding");
      expect(JSON.parse(request.context!).preprocessing).toEqual(preprocessing);
      return {text:"Synthetic",structuredOutput:null,sessionID:"synthetic-preprocessed",inputTokens:1,outputTokens:1,
        estimatedUsd:0,turns:1,toolCalls:0,toolCompletions:[],terminalReason:"completed",permissionDenials:[],reportedModels:["synthetic"]};
    });
    const model=new ClaudeContactAgentModel(claudeHarnessConfiguration({ANTHROPIC_API_KEY:"synthetic",TALENT_SIGNAL_AGENT_MODEL:"synthetic"}),execute);
    await model.run({objective:"Continue",images:[],preprocessing,systemPrompt:"Synthetic",state:{},assertCurrent:async()=>{},
      readImage,recordUnderstanding:vi.fn(),invoke:vi.fn()},new AbortController().signal);
    expect(readImage).not.toHaveBeenCalled();
  });
  it("attaches only the selected original source and requires a correction receipt for preprocessing follow-up",async()=>{
    const selected=await sharp({create:{width:24,height:48,channels:3,background:"white"}}).png().toBuffer();
    const hash=createHash("sha256").update(selected).digest("hex");
    const preprocessing={contract_version:SCREENSHOT_PREPROCESS_CONTRACT,schema_version:SCREENSHOT_PREPROCESS_SCHEMA_VERSION,
      prompt_version:SCREENSHOT_PREPROCESS_PROMPT_VERSION,provider:"volcano_ark" as const,model:ARK_SCREENSHOT_PREPROCESS_MODEL,
      request_receipts:[{source_image_index:0,request_id:"ark-0",input_tokens:1,output_tokens:1},{source_image_index:1,request_id:"ark-1",input_tokens:1,output_tokens:1}],
      usage:{input_tokens:2,output_tokens:2},sources:[0,1].map(index=>({source_image_index:index,source_hash:index===1?hash:"a".repeat(64),platform:"WeChat",
        conversation_kind:"direct" as const,contact_name:"Synthetic",participants:[],messages:index===1?[
          {sequence:0,text:"Keep this message",speaker_label:"Me",speaker_side:"right" as const,time_text:null},
          {sequence:1,text:"Correct only my speaker",speaker_label:null,speaker_side:"unknown" as const,time_text:null},
        ]:[{sequence:0,text:"Earlier image message",speaker_label:"Synthetic",speaker_side:"left" as const,time_text:null}],identity_clues:[],uncertainties:index===1?["Second speaker is unclear."]:[],
        follow_up_required:index===1,follow_up_regions:index===1?[{reason:"ambiguous_speaker" as const,field:"speaker" as const,
          uncertainty_index:0,target:{kind:"message" as const,message_index:1},baseline_text:null,
          region:{left:2,top:4,width:10,height:12}}]:[],width:24,height:48,
        prepared_view:{transform:"auto-orient/native/webp92-v1",content_hash:"b".repeat(64),tile_count:0}}))};
    const record=vi.fn(async()=>({status:"unconfirmed"}));
    const execute=vi.fn(async(_configuration,request:ClaudeHarnessRequest)=>{
      expect(request.images).toHaveLength(1);
      expect(request.images?.[0]?.contentHash).toBe(hash);
      const context=JSON.parse(request.context!);
      expect(context.screenshot_image_views.map((item:{source_image_index:number})=>item.source_image_index)).toEqual([1]);
      expect(context.correction_baselines[0].extraction.messages.map((message:{message_id:string})=>message.message_id))
        .toEqual(["m2","m3"]);
      expect(request.tools.map(tool=>tool.name)).toContain("record_screenshot_corrections");
      expect(request.budget.maxToolCalls).toBeGreaterThan(SCREENSHOT_PREPROCESS_FOLLOW_UP_REGION_LIMIT);
      expect(request.systemPrompt).toContain("Filing tools remain unauthorized until that correction succeeds");
      const inspect=request.tools.find(tool=>tool.name==="inspect_screenshot_region")!;
      const inspectInput={source_image_index:1,region:{left:2,top:4,width:10,height:12}};
      const inspected=await inspect.execute(inspectInput,new AbortController().signal);
      request.onToolCompleted?.({name:inspect.name,input:inspectInput,result:inspected.content,agentID:null,agentType:null});
      const receipt=JSON.parse((inspected.content[0] as {type:"text";text:string}).text).read_receipt_id;
      const correction=request.tools.find(tool=>tool.name==="record_screenshot_corrections")!;
      const result=await correction.execute({images:[{source_image_index:1,
        message_corrections:[{message_id:"m3",speaker_side:{value:"left",read_receipt_id:receipt},
          speaker_label:{value:"Synthetic",read_receipt_id:receipt}}],identity_clue_corrections:[],
        resolved_uncertainties:[{uncertainty_index:0,read_receipt_id:receipt,field:"speaker",
          target:{kind:"message",message_id:"m3"}}],
        pixel_readings:[{read_receipt_id:receipt,field:"speaker",status:"clear",reading:"Synthetic",speaker_side:"left"}],uncertainties:[]}]},
      new AbortController().signal);
      expect(result.isError).not.toBe(true);
      expect(record).toHaveBeenCalledWith([expect.objectContaining({messages:[
        expect.objectContaining({message_id:"m2",text:"Keep this message"}),
        expect.objectContaining({message_id:"m3",text:"Correct only my speaker",speaker_side:"left",speaker_label:"Synthetic"}),
      ],uncertainties:[]})],expect.any(AbortSignal));
      return {text:"Synthetic",structuredOutput:null,sessionID:"synthetic-follow-up",inputTokens:1,outputTokens:1,
        estimatedUsd:0,turns:1,toolCalls:2,toolCompletions:[],terminalReason:"completed",permissionDenials:[],reportedModels:["synthetic"]};
    });
    const model=new ClaudeContactAgentModel(claudeHarnessConfiguration({ANTHROPIC_API_KEY:"synthetic",TALENT_SIGNAL_AGENT_MODEL:"synthetic"}),execute);
    await model.run({objective:"Continue",images:[{media_type:"image/png",byte_size:selected.length,content_hash:hash,data_base64:selected.toString("base64")}],
      imageSourceIndices:[1],preprocessing,systemPrompt:"Synthetic",state:{},assertCurrent:async()=>{},readImage:async operation=>operation(),
      recordUnderstanding:record,invoke:vi.fn()},new AbortController().signal);
  });
  it("omits only identical successful navigation state and preserves changed state, errors, evidence and run isolation", async () => {
    const initial = {allowed_tools:["search_contacts"],contact:null};
    const changed = {allowed_tools:[],contact:{person_id:"synthetic-person"}};
    const source = Object.freeze({current_state:initial, source_excerpt:"Exact original evidence", source_refs:["m1"]});
    const invoke = vi.fn();
    const execute = vi.fn(async (_configuration, request: ClaudeHarnessRequest) => {
      const tool = request.tools.find(tool => tool.name === "search_contacts")!;
      const call = async () => {
        const result = await tool.execute({query:"Synthetic"}, new AbortController().signal) as {content:Array<{text:string}>;isError:boolean};
        return {data:JSON.parse(result.content[0]!.text),isError:result.isError};
      };
      invoke.mockResolvedValueOnce(source).mockResolvedValueOnce(source)
        .mockResolvedValueOnce({error:"CONTACT_TOOL_NOT_AUTHORIZED",current_state:changed})
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce({current_state:changed,source_excerpt:"New exact evidence"});
      expect(await call()).toEqual({data:source,isError:false});
      expect(await call()).toEqual({data:{source_excerpt:source.source_excerpt,source_refs:["m1"]},isError:false});
      expect(await call()).toEqual({data:{error:"CONTACT_TOOL_NOT_AUTHORIZED",current_state:changed},isError:true});
      expect(await call()).toEqual({data:source,isError:false});
      expect(await call()).toEqual({data:{current_state:changed,source_excerpt:"New exact evidence"},isError:false});
      expect(source.current_state).toBe(initial);
      return {text:"Synthetic",structuredOutput:null,sessionID:"synthetic",inputTokens:10,outputTokens:10,
        estimatedUsd:0,turns:1,toolCalls:5,toolCompletions:[],terminalReason:"completed",permissionDenials:[],reportedModels:["synthetic"]};
    });
    const model = new ClaudeContactAgentModel(claudeHarnessConfiguration({ANTHROPIC_API_KEY:"synthetic",TALENT_SIGNAL_AGENT_MODEL:"synthetic"}),execute);
    for (let run=0;run<2;run++) await model.run({objective:"Synthetic",systemPrompt:"Synthetic",state:{},images:[],
      assertCurrent:async()=>{},readImage:async operation=>operation(),recordUnderstanding:vi.fn(),invoke},new AbortController().signal);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledTimes(10);
  });

});
