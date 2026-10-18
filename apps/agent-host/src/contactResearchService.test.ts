import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CONTACT_RESEARCH_CONTRACT } from "@talent-signal/agent";
import { runContactResearchTool } from "./contactResearchService.js";
import type { TikHubProvider } from "./tikHubProvider.js";
import { ExaProvider } from "./exaProvider.js";

const source={url:"https://www.linkedin.com/in/example/",title:"Example Person",text:"Engineer at Example Labs",publishedAt:null,
  retrievedAt:"2026-09-06T00:00:00.000Z",contentHash:"a".repeat(64),providerID:"exa" as const,providerRequestID:"public-request"};
const request=(channels=["linkedin"],query="Example Person")=>({contract_version:CONTACT_RESEARCH_CONTRACT,task_id:randomUUID(),call_id:randomUUID(),anchors:["Example Person"],input:{operation:"search",channels,query,maximum_results_per_channel:2}});
const exaFetch=(url:string,overrides:Partial<typeof source>={})=>({...source,...overrides,url,contentHash:createHash("sha256").update(url).digest("hex")});
describe("public contact research boundary",()=>{
  it.each([
    [402,"REJECTED"], [401,"AUTH_FAILED"], [403,"AUTH_FAILED"],
    [429,"RATE_LIMITED"], [500,"REJECTED"],
  ] as const)("classifies actual Exa HTTP %s before generic transport errors",async(status,error_code)=>{
    const fetcher=vi.fn(async()=>new Response('{"message":"provider-body-canary"}',{status}));
    const exa=new ExaProvider({apiKey:"fixture-only",fetcher});
    const result=await runContactResearchTool(request(["web"]),{},{exa});
    expect(result.channels).toEqual([{channel:"web",provider:"exa",status:"failed",result_count:0,truncated:false,error_code}]);
    expect(result.sources).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("provider-body-canary");
  });
  it("preserves genuine Exa transport unavailability as retryable",async()=>{
    const exa=new ExaProvider({apiKey:"fixture-only",fetcher:vi.fn(async()=>{throw new TypeError("fetch failed");})});
    const result=await runContactResearchTool(request(["web"]),{},{exa});
    expect(result.channels[0]).toMatchObject({status:"failed",error_code:"UNAVAILABLE"});
  });
  it("does not classify an Exa contents credit refusal as temporary missing content",async()=>{
    const discovered={source_id:createHash("sha256").update(`exa:${source.url}`).digest("hex"),url:source.url,
      title:source.title,text:source.text,channel:"web",provider_id:"exa",provider_request_id:source.providerRequestID,
      content_hash:source.contentHash,retrieved_at:source.retrievedAt,stage:"discovered"};
    const fetcher=vi.fn(async()=>new Response("{}",{status:402}));
    const result=await runContactResearchTool({...request(),input:{operation:"fetch",sources:[discovered]}},{},
      {exa:new ExaProvider({apiKey:"fixture-only",fetcher})});
    expect(result.fetch_outcomes).toEqual([{source_id:discovered.source_id,channel:"web",provider:"exa",status:"failed",error_code:"REJECTED"}]);
    expect(result.sources).toEqual([]);expect(fetcher).toHaveBeenCalledOnce();
  });
  it("records browser provenance separately from discovery and forwards cancellation",async()=>{
    const exa={searchProfiles:vi.fn().mockResolvedValue([source]),searchWeb:vi.fn(),fetchContents:vi.fn()};
    const first=request();const discovered=await runContactResearchTool(first,{},{exa});
    const browser=vi.fn().mockResolvedValue({url:source.url,title:"Rendered public page",text:"Rendered engineer biography",
      engine:"chromium",engineVersion:"123.0",requests:2,blockedRequests:1,httpRequests:3,responseBytes:300});
    const call={...first,call_id:randomUUID(),input:{operation:"browse",source:discovered.sources[0]}};
    const result=await runContactResearchTool(call,{},{browse:browser,exa});
    expect(exa.fetchContents).not.toHaveBeenCalled();
    expect(result.sources[0]).toMatchObject({provider_id:"browser",stage:"fetched",text:"Rendered engineer biography",
      provider_request_id:call.call_id,browser_observation:{discovered_source_id:discovered.sources[0]?.source_id,engine:"chromium",blocked_requests:1}});
    expect(result.sources[0]?.content_hash).toBe(createHash("sha256").update("Rendered engineer biography").digest("hex"));
    expect(result.fetch_outcomes).toEqual([]);
    const abort=new AbortController();abort.abort();
    await expect(runContactResearchTool(call,{},{browse:browser},abort.signal)).rejects.toThrow();
    expect(browser).toHaveBeenCalledOnce();
  });
  it("dispatches LinkedIn and web concurrently, preserving ordered outcomes and fetched provenance",async()=>{
    const exa={searchProfiles:vi.fn().mockResolvedValue([source]),searchWeb:vi.fn().mockResolvedValue([source]),fetchContents:vi.fn().mockResolvedValue([source])};
    const first=request(["linkedin","web"]);const result=await runContactResearchTool(first,{}, {exa});
    expect(exa.searchProfiles).toHaveBeenCalledWith("Example Person",2,expect.any(AbortSignal));expect(exa.searchWeb).toHaveBeenCalledOnce();
    expect(result).toMatchObject({task_id:first.task_id,call_id:first.call_id,external_effects:[],
      channels:[{channel:"linkedin",provider:"exa",status:"ok",result_count:1,truncated:false,error_code:null},
        {channel:"web",provider:"exa",status:"ok",result_count:0,truncated:true,error_code:null}],
      sources:[{provider_id:"exa",stage:"discovered",content_hash:source.contentHash}]});
    expect(result.sources).toHaveLength(1); // The same canonical URL is deduplicated across channels.
    const discovered=result.sources[0]!;
    const fetched=await runContactResearchTool({...first,call_id:randomUUID(),input:{operation:"fetch",sources:[discovered]}},{},{exa});
    expect(fetched).toMatchObject({channels:[],sources:[{source_id:discovered.source_id,stage:"fetched"}],
      fetch_outcomes:[{source_id:discovered.source_id,channel:"linkedin",provider:"exa",status:"ok",error_code:null}]});
    expect(exa.fetchContents).toHaveBeenCalledWith([source.url],expect.any(AbortSignal));
  });
  it("reads several Exa URLs in one contents request and preserves requested order",async()=>{
    const first=exaFetch("https://example.com/one",{title:"One"});
    const second=exaFetch("https://example.com/two",{title:"Two"});
    const third=exaFetch("https://example.com/three",{title:"Three"});
    const dispatched=[first,second,third].map(item=>({source_id:createHash("sha256").update(`exa:${item.url}`).digest("hex"),
      url:item.url,title:item.title,text:item.text,channel:"web" as const,provider_id:"exa" as const,provider_request_id:"public-request",
      content_hash:item.contentHash,retrieved_at:item.retrievedAt,stage:"discovered" as const}));
    // Provider returns the middle source first; the service must restore request order.
    const fetchContents=vi.fn().mockResolvedValue([exaFetch(second.url,{title:"Two"}),exaFetch(first.url,{title:"One"}),exaFetch(third.url,{title:"Three"})]);
    const result=await runContactResearchTool({...request(),input:{operation:"fetch",sources:dispatched}},{},{exa:{searchProfiles:vi.fn(),searchWeb:vi.fn(),fetchContents}});
    expect(fetchContents).toHaveBeenCalledOnce();
    expect(fetchContents).toHaveBeenCalledWith([first.url,second.url,third.url],expect.any(AbortSignal));
    expect(result.sources.map(item=>item.source_id)).toEqual(dispatched.map(item=>item.source_id));
    expect(result.sources.map(item=>item.title)).toEqual(["One","Two","Three"]);
    expect(result.fetch_outcomes.map(item=>[item.source_id,item.status])).toEqual([
      [dispatched[0]!.source_id,"ok"],[dispatched[1]!.source_id,"ok"],[dispatched[2]!.source_id,"ok"]]);
  });
  it("returns Exa success plus an explicit TikHub unsupported outcome without cross-provider fallback",async()=>{
    const discovered=await runContactResearchTool(request(),{},{exa:{searchProfiles:vi.fn().mockResolvedValue([source]),searchWeb:vi.fn(),fetchContents:vi.fn()}});
    const exaSource=discovered.sources[0]!;
    const social={source_id:createHash("sha256").update("tikhub:https://xiaohongshu.example/user/example").digest("hex"),
      url:"https://xiaohongshu.example/user/example",title:"Example Person",text:"Public professional summary",channel:"xiaohongshu" as const,
      provider_id:"tikhub" as const,provider_request_id:"social-request",content_hash:"b".repeat(64),retrieved_at:"2026-09-06T00:00:00.000Z",stage:"profile_observation" as const};
    const fetchContents=vi.fn().mockResolvedValue([exaFetch(exaSource.url,{title:exaSource.title})]);
    const result=await runContactResearchTool({...request(),input:{operation:"fetch",sources:[social,exaSource]}},
      {},{exa:{searchProfiles:vi.fn(),searchWeb:vi.fn(),fetchContents}});
    // Only the Exa URL reaches Exa; the TikHub profile URL is never forwarded.
    expect(fetchContents).toHaveBeenCalledWith([exaSource.url],expect.any(AbortSignal));
    expect(fetchContents.mock.calls.flat(2)).not.toContain(social.url);
    expect(result.sources.map(item=>item.source_id)).toEqual([exaSource.source_id]);
    expect(result.sources[0]).toMatchObject({source_id:exaSource.source_id,stage:"fetched",provider_id:"exa"});
    expect(result.fetch_outcomes).toEqual([
      {source_id:social.source_id,channel:"xiaohongshu",provider:"tikhub",status:"unsupported",error_code:"UNSUPPORTED"},
      {source_id:exaSource.source_id,channel:"linkedin",provider:"exa",status:"ok",error_code:null},
    ]);
  });
  it("turns missing returned content and provider failure into bounded per-source outcomes",async()=>{
    const discovered=await runContactResearchTool(request(),{},{exa:{searchProfiles:vi.fn().mockResolvedValue([source]),searchWeb:vi.fn(),fetchContents:vi.fn()}});
    const present=discovered.sources[0]!;
    const missing={...present,source_id:createHash("sha256").update("exa:https://example.com/missing").digest("hex"),
      url:"https://example.com/missing",provider_request_id:null};
    const empty=await runContactResearchTool({...request(),input:{operation:"fetch",sources:[present,missing]}},
      {},{exa:{searchProfiles:vi.fn(),searchWeb:vi.fn(),fetchContents:vi.fn().mockResolvedValue([exaFetch(present.url)])}});
    expect(empty.fetch_outcomes).toEqual([
      {source_id:present.source_id,channel:"linkedin",provider:"exa",status:"ok",error_code:null},
      {source_id:missing.source_id,channel:"linkedin",provider:"exa",status:"failed",error_code:"UNAVAILABLE"},
    ]);
    expect(empty.sources.map(item=>item.source_id)).toEqual([present.source_id]);
    const failed=await runContactResearchTool({...request(),input:{operation:"fetch",sources:[present]}},
      {},{exa:{searchProfiles:vi.fn(),searchWeb:vi.fn(),fetchContents:vi.fn().mockRejectedValue(Object.assign(new Error("denied"),{code:"EXA_RATE_LIMITED"}))}});
    expect(failed).toMatchObject({sources:[],fetch_outcomes:[{source_id:present.source_id,status:"failed",error_code:"RATE_LIMITED"}]});
  });
  it("propagates cancellation instead of swallowing it as a per-source failure",async()=>{
    const discovered=await runContactResearchTool(request(),{},{exa:{searchProfiles:vi.fn().mockResolvedValue([source]),searchWeb:vi.fn(),fetchContents:vi.fn()}});
    const controller=new AbortController();
    const fetchContents=vi.fn().mockImplementation(async()=>{controller.abort();throw controller.signal.reason;});
    await expect(runContactResearchTool({...request(),input:{operation:"fetch",sources:[discovered.sources[0]!]}},
      {},{exa:{searchProfiles:vi.fn(),searchWeb:vi.fn(),fetchContents}},controller.signal)).rejects.toThrow();
  });
  it("blocks unrelated and private lookups before any provider dispatch",async()=>{
    const exa={searchProfiles:vi.fn(),searchWeb:vi.fn(),fetchContents:vi.fn()};
    await expect(runContactResearchTool(request(["linkedin"],"Another Person"),{},{exa})).rejects.toThrow("CONTACT_RESEARCH_QUERY_OUT_OF_SCOPE");
    await expect(runContactResearchTool(request(["web"],"Example Person home address"),{},{exa})).rejects.toThrow("CONTACT_RESEARCH_PRIVATE_LOOKUP_PROHIBITED");
    expect(exa.searchProfiles).not.toHaveBeenCalled();expect(exa.searchWeb).not.toHaveBeenCalled();
  });
  it("dispatches every TikHub platform and preserves partial failure without fallback",async()=>{
    const social=["xiaohongshu","reddit","douyin","tiktok","weibo","threads","instagram"];
    const searchProfiles=vi.fn(async({platform}:{platform:string})=>{
      if(platform==="reddit")throw Object.assign(new Error("denied"),{code:"TIKHUB_AUTH_FAILED"});
      return [{platform,providerID:"tikhub" as const,providerRequestID:"social-request",profileID:"1",displayName:"Example Person",handle:"example",biography:"Public professional summary",profileUrl:`https://${platform}.example/user/example`,avatarUrl:null,verified:null,contentHash:"b".repeat(64),retrievedAt:"2026-09-06T00:00:00.000Z"}];
    });
    const tikhub={searchProfiles:searchProfiles as TikHubProvider["searchProfiles"]};
    const result=await runContactResearchTool(request(social),{},{tikhub});
    expect(searchProfiles).toHaveBeenCalledTimes(7);
    for(const channel of social)expect(searchProfiles).toHaveBeenCalledWith({platform:channel,query:"Example Person",maximumResults:2},expect.any(AbortSignal));
    expect(result.sources).toHaveLength(6);
    expect(result.channels).toEqual(social.map(channel=>channel==="reddit"
      ? {channel,provider:"tikhub",status:"failed",result_count:0,truncated:false,error_code:"AUTH_FAILED"}
      : {channel,provider:"tikhub",status:"ok",result_count:1,truncated:false,error_code:null}));
  });
  it("marks channel outcomes when the combined response cap omits normalized results",async()=>{
    const social=["xiaohongshu","douyin","tiktok","weibo","threads","instagram"];
    const searchProfiles=vi.fn(async({platform}:{platform:string})=>Array.from({length:5},(_,index)=>({
      platform,providerID:"tikhub" as const,providerRequestID:"social-request",profileID:`${platform}-${index}`,
      displayName:`Example Person ${index}`,handle:`example-${platform}-${index}`,biography:null,
      profileUrl:`https://${platform}.example/user/${index}`,avatarUrl:null,verified:null,
      contentHash:createHash("sha256").update(`${platform}-${index}`).digest("hex"),retrievedAt:"2026-09-06T00:00:00.000Z",
    })));
    const input=request(social);input.input.maximum_results_per_channel=5;
    const result=await runContactResearchTool(input,{}, {tikhub:{searchProfiles:searchProfiles as TikHubProvider["searchProfiles"]}});
    expect(result.sources).toHaveLength(25);
    expect(result.channels.at(-1)).toMatchObject({channel:"instagram",status:"ok",result_count:0,truncated:true});
  });
  it("rejects a changed source identity before fetching",async()=>{
    const exa={searchProfiles:vi.fn(),searchWeb:vi.fn(),fetchContents:vi.fn()};
    const input={...request(),input:{operation:"fetch",sources:[{source_id:createHash("sha256").update("exa:https://different.example/").digest("hex"),url:source.url,title:source.title,text:source.text,
      channel:"linkedin",provider_id:"exa",provider_request_id:"public-request",content_hash:source.contentHash,retrieved_at:source.retrievedAt,stage:"discovered"}]}};
    await expect(runContactResearchTool(input,{},{exa})).rejects.toThrow("CONTACT_RESEARCH_SOURCE_ID_MISMATCH");expect(exa.fetchContents).not.toHaveBeenCalled();
  });
  it("rejects duplicate, empty, excess and foreign fetch lists before provider dispatch",async()=>{
    const exa={searchProfiles:vi.fn(),searchWeb:vi.fn(),fetchContents:vi.fn()};
    const discovered=await runContactResearchTool(request(),{},{exa:{searchProfiles:vi.fn().mockResolvedValue([source]),searchWeb:vi.fn(),fetchContents:vi.fn()}});
    const one=discovered.sources[0]!;
    const duplicate={...request(),input:{operation:"fetch",sources:[one,one]}};
    await expect(runContactResearchTool(duplicate,{},{exa})).rejects.toThrow("unique");
    const empty={...request(),input:{operation:"fetch",sources:[]}};
    await expect(runContactResearchTool(empty,{},{exa})).rejects.toThrow();
    const excess={...request(),input:{operation:"fetch",sources:[one,{...one,source_id:"1".repeat(64)}, {source_id:"2".repeat(64)}, {source_id:"3".repeat(64)}, {source_id:"4".repeat(64)}, {source_id:"5".repeat(64)}]}};
    await expect(runContactResearchTool(excess,{},{exa})).rejects.toThrow();
    expect(exa.fetchContents).not.toHaveBeenCalled();
  });
});
