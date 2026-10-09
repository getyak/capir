// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConversation } from "./use-conversation";
import { readConversationMessages, clearConversationLocal } from "../../lib/conversation-local";
const fetcher=vi.hoisted(()=>vi.fn());
vi.mock("../workspace-session-request",()=>({workspaceSessionFetch:fetcher}));
const sid="72ce7ff4-a5a8-40d0-b1d7-d84a13adcd30";
let chat: ReturnType<typeof useConversation>; let root: Root; let mount: HTMLDivElement;
const onAdmitted = vi.fn();
function Probe({entryCapability}:{entryCapability?:string}){const current=useConversation({entryCapability,id:sid,scope:"owner",chatBinding:"chat",detailBinding:"detail",bootstrap:"bootstrap",onAdmitted});useLayoutEffect(()=>{chat=current;});return null;}
async function flush(){await act(async()=>{await Promise.resolve();await Promise.resolve();});}
beforeEach(async()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);localStorage.clear();fetcher.mockReset();onAdmitted.mockReset();mount=document.createElement("div");document.body.append(mount);root=createRoot(mount);await act(async()=>{root.render(createElement(Probe,{}));});await flush();});
afterEach(async()=>{await act(async()=>root.unmount());mount.remove();vi.unstubAllGlobals();});
it("shows an immutable outgoing message before admission, releases composer, and preserves a new draft on failure",async()=>{
 let reject!: (reason: Error)=>void;fetcher.mockImplementation(()=>new Promise((_,no)=>{reject=no;}));
 await act(async()=>{chat.changeDraft("first");});await act(async()=>{expect(await chat.submit()).toBe(true);});
 expect(chat.draft).toBe("");expect(chat.messages[0].objective).toBe("first");expect(fetcher).toHaveBeenCalledTimes(1);
 await act(async()=>{chat.changeDraft("newer unsent");reject(new Error("network"));});
 expect(chat.draft).toBe("newer unsent");expect(chat.messages[0].delivery).toBe("unknown");expect(readConversationMessages("owner",sid)[0].id).toBe(chat.messages[0].id);
});
it("never auto-retries an unknown delivery and reuses its identity only on explicit retry",async()=>{
 fetcher.mockRejectedValue(new Error("offline"));await act(async()=>{chat.changeDraft("first");});await act(async()=>{await chat.submit();});const body=JSON.parse(fetcher.mock.calls[0][1].body);await flush();expect(fetcher).toHaveBeenCalledTimes(1);
 await act(async()=>{await chat.retryDelivery(chat.messages[0]);});await flush();const sends=fetcher.mock.calls.filter(call=>call[1]?.method==="POST");expect(sends).toHaveLength(2);expect(JSON.parse(sends[1][1].body).message_id).toBe(body.message_id);expect(JSON.parse(sends[1][1].body).idempotency_key).toBe(body.idempotency_key);
});
it("does not resurrect private outbox data when a late request rejects after logout",async()=>{
 let reject!:(reason:Error)=>void;fetcher.mockImplementation(()=>new Promise((_,no)=>{reject=no;}));await act(async()=>{chat.changeDraft("private");});await act(async()=>{await chat.submit();});await act(async()=>root.unmount());clearConversationLocal();reject(new Error("closed"));await flush();expect(readConversationMessages("owner",sid)).toEqual([]);
});
it("does not clear the draft or send when durable storage is denied",async()=>{
 const denied=vi.spyOn(window,"localStorage","get").mockImplementation(()=>{throw new Error("denied");});try{await act(async()=>{chat.changeDraft("keep this");});await act(async()=>{expect(await chat.submit()).toBe(false);});expect(chat.draft).toBe("keep this");expect(fetcher).not.toHaveBeenCalled();}finally{denied.mockRestore();}
});
it("waits for rapid serial admissions before navigating from the new conversation", async () => {
  const receipts: Array<(value: Response) => void> = [];
  fetcher.mockImplementation((_url, init) => new Promise(resolve => {
    if (init?.method === "POST") receipts.push(resolve);
  }));
  for (const text of ["first", "second", "third"]) {
    await act(async () => { chat.changeDraft(text); });
    await act(async () => { await chat.submit(); });
  }
  await act(async () => { chat.changeDraft("newer draft"); });
  expect(receipts).toHaveLength(1);
  for (let index = 0; index < 3; index++) {
    expect(onAdmitted).not.toHaveBeenCalled();
    await act(async () => { receipts[index](Response.json({}, {status:202})); });
  }
  expect(onAdmitted).toHaveBeenCalledExactlyOnceWith(sid);
  expect(chat.messages.map(message => message.delivery)).toEqual(["accepted", "accepted", "accepted"]);
  expect(chat.draft).toBe("newer draft");
});
it("can remove a rejected send but preserves an unknown delivery and a newer draft", async () => {
  fetcher.mockResolvedValueOnce(Response.json({message:"Queue full"},{status:429}));
  await act(async () => { chat.changeDraft("rejected"); });
  await act(async () => { await chat.submit(); });
  expect(chat.messages[0].delivery).toBe("rejected");
  const rejected = chat.messages[0].id;
  await act(async () => { chat.changeDraft("newer draft"); chat.discardRejectedDelivery(rejected); });
  expect(chat.messages).toEqual([]);
  expect(chat.draft).toBe("newer draft");
  fetcher.mockRejectedValue(new Error("unknown"));
  await act(async () => { await chat.submit(); });
  const uncertain = chat.messages[0].id;
  await act(async () => { chat.discardRejectedDelivery(uncertain); });
  expect(chat.messages[0].delivery).toBe("unknown");
});
it("does not navigate away while Stop is settling alongside admission", async () => {
  const receipts: Array<(response: Response) => void> = [];
  let finishStop!: (response: Response) => void;
  const snapshot = {session_id:sid,revision:1,paused:false,queued:[],preview:null,active:{message_id:"active",run_id:"run",status:"running",objective:"first"}};
  fetcher.mockImplementation((url, init) => {
    if (String(url).endsWith("/stream")) return Promise.resolve(new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));}})));
    if (String(url).endsWith("/mutations")) return new Promise(resolve => {finishStop=resolve;});
    if (init?.method === "POST") return new Promise(resolve => receipts.push(resolve));
    return Promise.resolve(Response.json({}));
  });
  for (const text of ["first", "second"]) {
    await act(async () => {chat.changeDraft(text);});
    await act(async () => {await chat.submit();});
  }
  await act(async () => {receipts[0](Response.json({},{status:202}));});
  await flush();
  let stopping!: Promise<boolean>;
  await act(async () => {stopping=chat.mutate({kind:"stop",run_id:"run"});});
  await act(async () => {receipts[1](Response.json({},{status:202}));});
  expect(onAdmitted).not.toHaveBeenCalled();
  await act(async () => {finishStop(Response.json({snapshot:{...snapshot,paused:true}}));await stopping;});
  expect(onAdmitted).toHaveBeenCalledExactlyOnceWith(sid);
});

it("retains the outbox when the signed entry expires", async () => {
  fetcher.mockResolvedValue(Response.json({code:"memory_entry_mismatch",message:"入口过期"},{status:403}));
  await act(async()=>{chat.changeDraft("keep my unsent message");});
  await act(async()=>{await chat.submit();});
  expect(chat.unavailable).toBe(false);
  expect(chat.messages[0].objective).toBe("keep my unsent message");
  expect(readConversationMessages("owner",sid)[0].id).toBe(chat.messages[0].id);
  expect(chat.error).toContain("已保留");
});
it("uses upgraded authority for the next rapid admission", async () => {
  const receipts: Array<(value:Response)=>void> = [];
  fetcher.mockImplementation((_url,init)=>new Promise(resolve=>{if(init?.method==="POST")receipts.push(resolve);}));
  for(const text of ["one","two"]){await act(async()=>chat.changeDraft(text));await act(async()=>{await chat.submit();});}
  expect(fetcher.mock.calls[0][1].headers["x-memory-entry-capability"]).toBe("bootstrap");
  await act(async()=>receipts[0](Response.json({memory_entry_capability:"formal"},{status:202})));
  const posts=fetcher.mock.calls.filter(call=>call[1]?.method==="POST");
  expect(posts[1][1].headers["x-memory-entry-capability"]).toBe("formal");
  await act(async()=>receipts[1](Response.json({memory_entry_capability:"formal"},{status:202})));
});
it("recovers a lost admission capability by owner-authorized queue read without resending", async () => {
  fetcher.mockRejectedValue(new Error("response lost"));
  await act(async()=>chat.changeDraft("saved once"));await act(async()=>{await chat.submit();});
  const message=chat.messages[0];
  fetcher.mockImplementation((url)=>{
    if(String(url).endsWith("/stream"))return new Promise(()=>{});
    if(String(url).endsWith("/conversation-queue"))return Promise.resolve(Response.json({session_id:sid,revision:1,active:{message_id:message.id},queued:[]},{headers:{"x-memory-entry-capability":"recovered"}}));
    return Promise.resolve(Response.json({}));
  });
  await act(async()=>{await chat.retryDelivery(message);});
  expect(chat.entryCapability).toBe("recovered");
  // The same-ID queue row is the authoritative receipt: the outbox identity is
  // retained as accepted until canonical history arrives — never resent and
  // never deleted before its turn exists.
  expect(chat.messages.map(entry=>entry.id)).toEqual([message.id]);
  expect(chat.messages[0].delivery).toBe("accepted");
  expect(onAdmitted).toHaveBeenCalledExactlyOnceWith(sid);
  expect(fetcher.mock.calls.filter(call=>call[1]?.method==="POST")).toHaveLength(1);
});

it("uses a refreshed SSR entry capability for the next send",async()=>{
  fetcher.mockImplementation(()=>new Promise(()=>{}));
  await act(async()=>root.render(createElement(Probe,{entryCapability:"new-rendered-authority"})));
  expect(chat.entryCapability).toBe("new-rendered-authority");
  await act(async()=>chat.changeDraft("use the refreshed entry"));await act(async()=>{await chat.submit();});
  expect(fetcher.mock.calls.find(call=>call[1]?.method==="POST")?.[1].headers["x-memory-entry-capability"]).toBe("new-rendered-authority");
});
