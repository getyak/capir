import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { contactTaskFromReviewedImage, contactTaskReviewURL, submitContactTaskInWeb } from "../load-unpacked/lib/contact-handoff.js";

const bytes=Buffer.from("synthetic-reviewed-pixels"), taskID="10000000-0000-4000-8000-000000000001";
const envelope={source:{capture_kind:"visible_tab",captured_at:"2026-09-09T02:00:00.000Z"},
 review:{type:"reviewed_image",mime_type:"image/png",data_url:`data:image/png;base64,${bytes.toString("base64")}`},
 authorization:{decision:"submit_reviewed_capture"},retention_mode:"evidence_crop",idempotency_key:"same-reviewed-intent",
 handoff_target:"http://localhost:3000"};
test("hashes only reviewed bytes and disables unapproved public research",async()=>{
 const payload=await contactTaskFromReviewedImage(envelope);
 assert.equal(payload.image.content_hash,createHash("sha256").update(bytes).digest("hex"));
 assert.equal(payload.image.byte_size,bytes.length);assert.equal(payload.allow_public_research,false);
 assert.equal(payload.idempotency_key,envelope.idempotency_key);
 const sourced=await contactTaskFromReviewedImage({...envelope,source:{...envelope.source,title:"Synthetic profile",url:"https://example.com/profile?token=discard-me#secret"}});
 assert.deepEqual(sourced.browser_source,{title:"Synthetic profile",locator:"https://example.com/profile"});
 await assert.rejects(contactTaskFromReviewedImage({...envelope,source:{...envelope.source,title:"Synthetic",url:"https://user:password@example.com/profile"}}));
 await assert.rejects(contactTaskFromReviewedImage({...envelope,retention_mode:"ephemeral"}));
 await assert.rejects(contactTaskFromReviewedImage({...envelope,authorization:{decision:"preview"}}));
 assert.match(contactTaskReviewURL(envelope.handoff_target,taskID),/workspace\/captures\?task=/u);
 assert.throws(()=>contactTaskReviewURL(envelope.handoff_target,"../../elsewhere"));
});
test("keeps credentials in Web, checks the intended account and reads back the exact task",async()=>{
 const oldFetch=globalThis.fetch,oldLocation=globalThis.location;const calls=[];
 globalThis.location={origin:envelope.handoff_target,pathname:"/contact-agent"};
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,status:201,json:async()=>url.endsWith("session")
  ?{status:"ready",session_version:"same-session",contact_agent:true}:{task_id:taskID}};};
 try{
  const payload=await contactTaskFromReviewedImage(envelope);
  assert.equal((await submitContactTaskInWeb(envelope.handoff_target,"other-session",payload)).code,"session_changed");
  assert.equal(calls.length,1);calls.length=0;
  const receipt=await submitContactTaskInWeb(envelope.handoff_target,"same-session",payload);
  assert.equal(receipt.contact_task_id,taskID);assert.equal(calls.length,3);
  assert.equal(calls[1].options.credentials,"same-origin");assert.equal(calls[1].options.headers.authorization,undefined);
  assert.equal(calls[1].options.headers["x-contact-handoff-session"],"same-session");
  assert.equal(calls[2].options.headers["x-contact-handoff-session"],"same-session");
  assert.equal(calls[2].url,`/api/contact-agent/tasks/${taskID}`);
 }finally{globalThis.fetch=oldFetch;if(oldLocation===undefined)delete globalThis.location;else globalThis.location=oldLocation;}
});
