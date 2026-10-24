import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { TalentSignalHttpError } from "@talent-signal/contracts";
import { BackendSessionExpiredError } from "../backend-session";
const f=vi.hoisted(()=>({claims:vi.fn(),get:vi.fn(),save:vi.fn(),admit:vi.fn(),read:vi.fn(),mutate:vi.fn(),stream:vi.fn()}));
const shutdown=vi.hoisted(()=>({source:null as EventEmitter|null,scope:{} as Record<symbol,AbortSignal|undefined>}));
vi.mock("./readOnlyStreamShutdown",async importOriginal=>{
  const actual=await importOriginal<typeof import("./readOnlyStreamShutdown")>();
  return {...actual,readOnlyStreamShutdownSignal:()=>actual.readOnlyStreamShutdownSignal(shutdown.source!,shutdown.scope)};
});
vi.mock("./backendAuth",()=>({readBackendSessionClaims:f.claims,backendAuthBaseUrl:()=>"http://backend.invalid",authSecret:()=>"synthetic-test-only-secret"}));
vi.mock("./contact-handoff-session",()=>({contactHandoffSessionVersion:()=>"bound-login"}));
vi.mock("@talent-signal/contracts",async importOriginal=>{const actual=await importOriginal<typeof import("@talent-signal/contracts")>();return {...actual,TalentSignalClient:class{getAgentSession=f.get;saveAgentSession=f.save;admitConversationQueueEntry=f.admit;getConversationQueue=f.read;mutateConversationQueue=f.mutate;openConversationQueueStream=f.stream;}};});
import { conversationQueueRoute } from "./conversationQueue";
import { readOnlyStreamShutdownSignal } from "./readOnlyStreamShutdown";
const sid="72ce7ff4-a5a8-40d0-b1d7-d84a13adcd30",mid="a072ed54-6d56-413d-af4b-3ebc01ba646a";
function request(body?:unknown,binding="bound-login",origin="http://localhost:3019") {return new Request(`http://localhost:3019/api/workspace-sessions/${sid}/conversation-queue`,{method:body?"POST":"GET",headers:{"content-type":"application/json","x-workspace-session":binding,"origin":origin,"host":"localhost:3019"},...(body?{body:JSON.stringify(body)}:{})});}
const input={session_id:sid,message_id:mid,idempotency_key:mid,objective:"synthetic"};
beforeEach(()=>{Object.values(f).forEach(mock=>mock.mockReset());f.claims.mockResolvedValue({backendAccountId:"synthetic-account",backendUserId:"synthetic-user",backendExpiresAt:"2099-01-01T00:00:00Z",backendAccessToken:"synthetic"});f.get.mockResolvedValue({});f.admit.mockResolvedValue({message_id:mid});});
beforeEach(()=>{shutdown.source=new EventEmitter();shutdown.scope={};});

it("aborts an open read-only upstream subscription on process shutdown without cancelling a task",async()=>{
  f.stream.mockResolvedValue(new Response(new ReadableStream()));
  const response=await conversationQueueRoute(request(),sid,"stream");
  expect(response.status).toBe(200);
  const signal=f.stream.mock.calls[0][1] as AbortSignal;
  expect(signal.aborted).toBe(false);
  shutdown.source!.emit("SIGTERM");
  expect(signal.aborted).toBe(true);
  expect(f.mutate).not.toHaveBeenCalled();expect(f.admit).not.toHaveBeenCalled();
  await response.body!.cancel();
});

it("does not open another subscription once shutdown has begun, while ordinary reads and mutations retain their own deadlines",async()=>{
  readOnlyStreamShutdownSignal();
  shutdown.source!.emit("SIGTERM");
  f.stream.mockResolvedValue(new Response("synthetic"));
  expect((await conversationQueueRoute(request(),sid,"stream")).status).toBe(503);
  expect(f.stream).not.toHaveBeenCalled();
  f.read.mockResolvedValue({session_id:sid,active:null,queued:[]});
  f.mutate.mockResolvedValue({session_id:sid,revision:1});
  expect((await conversationQueueRoute(request(),sid,"read")).status).toBe(200);
  expect((await conversationQueueRoute(request({kind:"stop"}),sid,"mutate")).status).toBe(200);
  expect((f.read.mock.calls[0][1] as AbortSignal).aborted).toBe(false);
  expect((f.mutate.mock.calls[0][2] as AbortSignal).aborted).toBe(false);
});

it("registers a first subscription before awaiting auth, so shutdown during that await cannot open a new infinite stream",async()=>{
  const claims=await f.claims();
  let releaseClaims!:(value:unknown)=>void;
  f.claims.mockImplementationOnce(()=>new Promise(resolve=>{releaseClaims=resolve;}));
  f.stream.mockResolvedValue(new Response("synthetic"));
  const pending=conversationQueueRoute(request(),sid,"stream");
  shutdown.source!.emit("SIGTERM");
  releaseClaims(claims);
  expect((await pending).status).toBe(503);
  expect(f.stream).not.toHaveBeenCalled();
});
it.each(["read","admit","mutate","stream"] as const)("rejects stale login before %s reaches the backend",async action=>{const response=await conversationQueueRoute(request(input,"old-login"),sid,action);expect(response.status).toBe(409);expect(f.get).not.toHaveBeenCalled();expect(f.admit).not.toHaveBeenCalled();expect(f.stream).not.toHaveBeenCalled();});
it("maps expired account binding to recoverable authentication failure",async()=>{f.claims.mockRejectedValue(new BackendSessionExpiredError());expect((await conversationQueueRoute(request(),sid,"read")).status).toBe(401);});
it("rejects cross-origin mutations and oversized messages",async()=>{expect((await conversationQueueRoute(request(input,"bound-login","https://other.invalid"),sid,"admit")).status).toBe(403);expect((await conversationQueueRoute(request({...input,objective:"x".repeat(1001)}),sid,"admit")).status).toBe(400);expect(f.admit).not.toHaveBeenCalled();});
it("creates only missing Sessions and returns durable admission without invoking a model",async()=>{f.get.mockRejectedValue(new TalentSignalHttpError(404,"NOT_FOUND","missing",null));const response=await conversationQueueRoute(request(input),sid,"admit");expect(response.status).toBe(202);expect(f.save).toHaveBeenCalledWith(sid,expect.objectContaining({expected_revision:0,idempotency_key:sid}),expect.any(AbortSignal));expect(f.admit).toHaveBeenCalledWith(input,expect.any(AbortSignal));});
it("does not recreate a forbidden Session",async()=>{f.get.mockRejectedValue(new TalentSignalHttpError(403,"FORBIDDEN","forbidden",null));expect((await conversationQueueRoute(request(input),sid,"admit")).status).toBe(403);expect(f.save).not.toHaveBeenCalled();expect(f.admit).not.toHaveBeenCalled();});
it("relays an authenticated stream without consuming the full response",async()=>{f.stream.mockResolvedValue(new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('event: snapshot\ndata: {}\n\n'));controller.close();}})));const response=await conversationQueueRoute(request(),sid,"stream");expect(response.headers.get("content-type")).toContain("text/event-stream");expect(response.headers.get("cache-control")).toContain("no-store");expect(await response.text()).toContain("event: snapshot");expect(f.stream).toHaveBeenCalledWith(sid,expect.any(AbortSignal));});
it("accepts an images-only message and forwards it to durable admission",async()=>{const images=[{attachment_id:mid,file_name:"shot.png",media_type:"image/png",byte_size:8,content_hash:"a".repeat(64),data_base64:"iVBORwECAwQ="}];const response=await conversationQueueRoute(request({...input,objective:"",images}),sid,"admit");expect(response.status).toBe(202);expect(f.admit).toHaveBeenCalledWith(expect.objectContaining({objective:"",images}),expect.any(AbortSignal));});
it("still rejects an empty text-and-no-image message",async()=>{const response=await conversationQueueRoute(request({...input,objective:""}),sid,"admit");expect(response.status).toBe(400);expect(f.admit).not.toHaveBeenCalled();});
it("admits a bounded multi-megabyte base64 batch and rejects a declared over-budget body",async()=>{const images=[{attachment_id:mid,file_name:"big.png",media_type:"image/png",byte_size:8,content_hash:"a".repeat(64),data_base64:"A".repeat(11_000_000)}];const accepted=await conversationQueueRoute(request({...input,objective:"",images}),sid,"admit");expect(accepted.status).toBe(202);expect(f.admit).toHaveBeenCalledOnce();f.admit.mockClear();const oversized=new Request(`http://localhost:3019/api/workspace-sessions/${sid}/conversation-queue`,{method:"POST",headers:{"content-type":"application/json","x-workspace-session":"bound-login","origin":"http://localhost:3019","host":"localhost:3019","content-length":"41000001"},body:"{}"});const rejected=await conversationQueueRoute(oversized,sid,"admit");expect(rejected.status).toBe(413);expect(f.admit).not.toHaveBeenCalled();});


it("upgrades only the exact SSR bootstrap after actual admission, including same-message replay", async () => {
  const { mintMemoryEntryCapability, verifyMemoryEntryCapability } = await import("./memoryEntryCapability");
  const claims = await f.claims();
  const token = mintMemoryEntryCapability(claims, { purpose: "chat", sessionId: sid, stage: "bootstrap" });
  f.get.mockRejectedValueOnce(new TalentSignalHttpError(404,"NOT_FOUND","missing",null));
  const send = () => { const req = request(input); req.headers.set("x-memory-entry-capability",token); return conversationQueueRoute(req,sid,"admit"); };
  const first = await send(); expect(first.status).toBe(202);
  const firstCapability = (await first.json()).memory_entry_capability;
  expect(verifyMemoryEntryCapability(firstCapability, claims)).toMatchObject({ sessionId:sid, purpose:"chat", stage:"review" });
  const retry = await send(); expect(retry.status).toBe(202);
  expect(verifyMemoryEntryCapability((await retry.json()).memory_entry_capability, claims)).toMatchObject({ sessionId:sid, stage:"review" });
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.admit.mock.calls.map(call=>call[0].message_id)).toEqual([mid,mid]);
});
it("rejects a business or another-Session token before admission", async () => {
  const { mintMemoryEntryCapability } = await import("./memoryEntryCapability");
  const claims = await f.claims();
  for (const entry of [{purpose:"people" as const,personId:mid},{purpose:"chat" as const,sessionId:mid,stage:"bootstrap" as const}]) {
    const req=request(input);req.headers.set("x-memory-entry-capability",mintMemoryEntryCapability(claims,entry));
    expect((await conversationQueueRoute(req,sid,"admit")).status).toBe(403);
  }
  expect(f.get).not.toHaveBeenCalled();expect(f.admit).not.toHaveBeenCalled();
});

it("recovers signed exact-Session authority after owner-authorized queue read", async () => {
  const {mintMemoryEntryCapability,verifyMemoryEntryCapability}=await import("./memoryEntryCapability");
  const claims=await f.claims();f.read.mockResolvedValue({session_id:sid,active:null,queued:[]});
  const req=request();req.headers.set("x-memory-entry-capability",mintMemoryEntryCapability(claims,{purpose:"chat",sessionId:sid,stage:"bootstrap"}));
  const response=await conversationQueueRoute(req,sid,"read");
  expect(verifyMemoryEntryCapability(response.headers.get("x-memory-entry-capability"),claims)).toMatchObject({sessionId:sid,stage:"review"});
  expect(f.admit).not.toHaveBeenCalled();
  const unsigned=await conversationQueueRoute(request(),sid,"read");
  expect(unsigned.headers.get("x-memory-entry-capability")).toBeNull();
});
