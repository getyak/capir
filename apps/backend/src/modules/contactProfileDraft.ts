import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ContactChatExtractionSchema, type ContactChatExtraction, type ContactProfileConfirmation,
  type ScreenshotContactTaskResponse } from "@talent-signal/agent";
import { CONTRACT_VERSION, type IdentityHandleHint, type ResourceCaptureRequest } from "@talent-signal/contracts";
import type { AuthContext } from "./auth.js";
import { ApiError } from "../lib/apiError.js";
import { searchPeople, getRelationshipScope } from "./people.js";
import { createResourceCaptureInTransaction } from "./resourceIntake.js";

type Draft = NonNullable<ScreenshotContactTaskResponse["contact_draft"]>;
const normalized = (value:string) => value.normalize("NFKC").trim().toLowerCase();

/** Profile images have no messages. Keep their interpretation separate from chat filing. */
export function profileUnderstanding(parts:ContactChatExtraction[]): {extraction:ContactChatExtraction;draft:Draft}|null {
  if (!parts.length || parts.some(p=>p.messages.length)) return null;
  if(new Set(parts.map(p=>normalized(p.platform))).size!==1)return null;
  const names=new Set(parts.map(p=>p.contact_name).filter((n):n is string=>Boolean(n)).map(normalized));
  // Different profiles require separate tasks, including incompatible stable account clues.
  const stable=new Map<string,Set<string>>();
  for(const part of parts)for(const clue of part.identity_clues.filter(c=>["handle","profile_url"].includes(c.kind))){
    const key=`${normalized(part.platform)}:${clue.kind}`;
    const values=stable.get(key)??new Set<string>();values.add(normalized(clue.value));stable.set(key,values);
  }
  if(names.size>1 || [...stable.values()].some(values=>values.size>1)) return null;
  const clues=parts.flatMap((p,index)=>p.identity_clues.map(c=>({...c,source_image_index:index}))).slice(0,12);
  if(!clues.length && names.size===0)return null;
  const extraction=ContactChatExtractionSchema.parse({platform:parts[0]!.platform,conversation_kind:parts.every(p=>p.conversation_kind==="profile")?"profile":"not_chat",
    contact_name:parts.find(p=>p.contact_name)?.contact_name??null,identity_clues:clues,messages:[],
    uncertainties:[...new Set(parts.flatMap(p=>p.uncertainties))].slice(0,15)});
  return {extraction,draft:{platform:extraction.platform,display_name:extraction.contact_name??"",fields:clues.map((c,clue_index)=>({...c,clue_index}))}};
}

function handleFor(platform:string,kind:string,value:string):IdentityHandleHint|null{
  if(kind==="profile_url"){
    let url:URL;try{url=new URL(value);}catch{throw new ApiError(422,"CONTACT_PROFILE_URL_INVALID","请填写完整的 HTTPS 资料链接。");}
    if(url.protocol!=="https:"||url.username||url.password)throw new ApiError(422,"CONTACT_PROFILE_URL_INVALID","请填写完整的 HTTPS 资料链接。");
    return {type:"public_profile_url",value};
  }
  return kind==="handle"?{type:"source_native_id",value:`${normalized(platform)}:${value.normalize("NFKC").trim()}`} : null;
}

export async function saveReviewedContactProfile(client:PoolClient,auth:AuthContext,input:{
  taskID:string;draft:Draft;extraction:ContactChatExtraction;review:ContactProfileConfirmation;
  capturedAt:string;expiresAt:string;imageHashes:string[];
  browserSource?: {title:string;locator:string};
}){
  const {review,draft,extraction}=input;
  if(Boolean(review.selected_person_id)!==Boolean(review.selected_relationship_context_id))throw new ApiError(409,"CONTACT_TASK_SCOPE_INCOMPLETE","请选择完整的联系人关系。");
  const indices=new Set<number>();
  const reviewed=review.fields.map(field=>{
    const source=draft.fields.find(c=>c.clue_index===field.clue_index);
    if(!source||indices.has(field.clue_index))throw new ApiError(422,"CONTACT_PROFILE_FIELD_INVALID","资料字段已变化，请重新查看草稿。");
    indices.add(field.clue_index);return {...source,value:field.value};
  });
  const handles=reviewed.map(c=>handleFor(extraction.platform,c.kind,c.value)).filter((h):h is IdentityHandleHint=>Boolean(h));
  if(handles.length>5)throw new ApiError(422,"CONTACT_PROFILE_TOO_MANY_HANDLES","每次最多确认五个账号线索。");
  // The caller holds reviewed-profile admission authority before its task row,
  // so identity discovery and canonical binding share archive-safe lock order.
  const matches=new Map<string,{person_id:string;relationship_context_id:string;display_name:string;relationship_label:string}>();
  for(const handle of handles){
    const result=await searchPeople(client,auth,`${handle.type==="source_native_id"?"source":"profile"}:${handle.value}`);
    for(const p of result.people.filter(p=>p.identity_matches.some(match=>match.kind==="confirmed_handle")))for(const context of p.contexts)matches.set(`${p.id}:${context.id}`,{
      person_id:p.id,relationship_context_id:context.id,display_name:p.display_label,relationship_label:context.display_label});
  }
  let selected=review.selected_person_id?{person_id:review.selected_person_id,relationship_context_id:review.selected_relationship_context_id!}:null;
  if(selected){
    await getRelationshipScope(client,auth,selected.person_id,selected.relationship_context_id);
    if([...matches.values()].some(c=>c.person_id!==selected!.person_id))throw new ApiError(409,"CONTACT_PROFILE_HANDLE_CONFLICT","账号线索属于另一个联系人，请先核对。");
  }else if(review.create_new && matches.size>0){
    return {candidates:[...matches.values()].slice(0,10),saved:null};
  }else if(matches.size===1){selected=[...matches.values()][0]!;
  }else if(matches.size>1){return {candidates:[...matches.values()].slice(0,10),saved:null};}
  if(!selected&&!review.create_new){
    const sameName=await searchPeople(client,auth,review.display_name);
    const candidates=sameName.people.filter(p=>normalized(p.display_label)===normalized(review.display_name))
      .flatMap(p=>p.contexts.map(c=>({person_id:p.id,relationship_context_id:c.id,display_name:p.display_label,relationship_label:c.display_label})));
    if(candidates.length)return {candidates:candidates.slice(0,10),saved:null};
  }
  const resourceID=`profile-review:${input.taskID}`;
  // This is the user's reviewed contact record. Original visual evidence remains
  // in the expiring task; edits must never masquerade as exact screenshot quotes.
  const fragments:ResourceCaptureRequest["fragments"]=[{client_resource_id:resourceID,kind:"contact_field",sequence:0,
    text:review.display_name,locator:{kind:"contact_field",field:"display_name",source_record_version:`${input.taskID}:${review.expected_revision}`},
    attribution:{actor_kind:"recruiter",status:"confirmed"},review_status:"reviewed",parser:{name:"human-profile-review",version:"1"}},
    ...reviewed.map((field,index)=>({client_resource_id:resourceID,kind:"contact_field" as const,sequence:index+1,text:field.value,
      locator:{kind:"contact_field" as const,field:field.kind,source_record_version:`${input.taskID}:${review.expected_revision}:clue${field.clue_index}`},
      attribution:{actor_kind:"recruiter" as const,status:"confirmed" as const},review_status:"reviewed" as const,parser:{name:"human-profile-review",version:"1"}}))];
  const contentHash=createHash("sha256").update(JSON.stringify({fragments,imageHashes:input.imageHashes})).digest("hex");
  const result=await createResourceCaptureInTransaction(client,auth,{
    contract_version:CONTRACT_VERSION,idempotency_key:resourceID,channel:input.browserSource?"browser_extension":"chat",purpose:"Explicitly reviewed contact draft from original profile screenshots",
    captured_at:input.capturedAt,source_timezone:"UTC",
    person_scope:selected?{status:"confirmed",person_id:selected.person_id,relationship_context:{status:"existing",relationship_context_id:selected.relationship_context_id},binding_basis:"Human-reviewed profile saved to an explicitly selected contact or unique confirmed account match."}
      :{status:"new_person",display_label:review.display_name,relationship_context:{status:"proposed",label:"联系人资料",purpose:"User-reviewed relationship context"},binding_basis:"Human confirmed this contact draft after current duplicate checks."},
    resource:{client_resource_id:resourceID,kind:"contact_record",display_name:`${review.display_name} · 已核对资料`,media_type:"application/json",
      observed_at:input.capturedAt,source_timezone:"UTC",content_hash:contentHash,
      ...(input.browserSource?{source_locator:input.browserSource.locator}:{}),
      retention:{requested_mode:"evidence_crop",source_scope:"reviewed_extracted_text",requested_retention_until:input.expiresAt}},
    ...(handles.length?{confirmed_identity_handles:handles.map(h=>({...h,source_client_resource_id:resourceID}))}:{}),fragments,
  });
  const identity=result.body.identity;
  if(!identity.person_id||!identity.relationship_context_id)throw new ApiError(409,"CONTACT_PROFILE_STORAGE_SCOPE_MISSING","资料保存未获得联系人回执。");
  return {candidates:[],saved:{contact:{person_id:identity.person_id,relationship_context_id:identity.relationship_context_id,
    display_name:identity.person_display_label??review.display_name,disposition:selected?"reused" as const:"created" as const},
    capture_id:result.body.capture_id,source_resource_id:result.body.resource.id,
    reviewed_profile:{platform:draft.platform,display_name:review.display_name,fields:reviewed}}};
}
