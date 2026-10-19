import { withProductRunCapture, captureProductStep } from "@talent-signal/agent";
import { saveProductRunOutput, productRunSink, saveProductRunUsageDiagnostics, type ScreenshotUsageDiagnostic } from "./productRunStorage.js";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  ARK_SCREENSHOT_PREPROCESS_MODEL, ArkScreenshotPreprocessor,
  SCREENSHOT_PREPROCESS_CONTRACT, SCREENSHOT_PREPROCESS_PROMPT_VERSION,
  SCREENSHOT_PREPROCESS_SCHEMA_VERSION, SCREENSHOT_PREPROCESS_FOLLOW_UP_REGION_LIMIT,
  CONTACT_INTAKE_TOOLS, CONTACT_RESEARCH_CONTRACT, CONTACT_TASK_PUBLIC_SOURCE_LIMIT, ContactProfileFieldSchema,
  ScreenshotContactTaskRequestSchema, ScreenshotContactTaskResponseSchema, TextContactTaskRequestSchema,
  ZhipuContactAgentModel, groundContactTextExtraction, contactDocumentBlocks,
  ClaudeContactAgentModel, claudeHarnessConfiguration, ContactChatExtractionSchema,
  ContactProfileConfirmationSchema,
  ScreenshotPreprocessPacketSchema, assertScreenshotPreprocessAgreement,
  extractionFromPreprocess, preprocessNeedsOriginalMultimodalRead,
  resolveProductPrompt, type PromptSnapshot,
  type ContactAgentModel, type ContactAgentToolCall, type ContactIntakeToolName,
  type ContactPublicSource, type ContactProfileField, type ContactResearchToolResponse,
  type ScreenshotPreprocessor, type ScreenshotPreprocessResult,
  type ScreenshotContactTaskRequest, type ScreenshotContactTaskResponse, type TextContactTaskRequest,
} from "@talent-signal/agent";
import { CONTRACT_VERSION, type ResourceCaptureRequest } from "@talent-signal/contracts";
import { inTransaction } from "../database/pool.js";
import { deleteCapture } from "./captures.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import type { AuthContext } from "./auth.js";
import { lockContactTaskPerson } from "./contactTaskConcurrency.js";
import { searchPeople, getRelationshipScope } from "./people.js";
import { createResourceCaptureInTransaction } from "./resourceIntake.js";
import type { ChatMediaStorage } from "./chatMediaStorage.js";
import { contactImages, validateContactImage, reserveContactImages, persistContactImages, readContactImage, purgeExpiredContactImages, purgeContactImagesForTask, type ContactImageManifest } from "./contactTaskImages.js";
import { mergeContactExtractions } from "./mergeContactExtractions.js";
import { profileUnderstanding, saveReviewedContactProfile } from "./contactProfileDraft.js";
import { LocalContactResearchClient, type ContactResearchClient } from "./contactResearchClient.js";
import {
  boundedDiagnosticCode,
  RESEARCH_TOOL_ERROR_CODE_SET,
} from "../lib/diagnosticCodes.js";

type Response = ScreenshotContactTaskResponse;
type Manifest = Omit<ScreenshotContactTaskRequest, "image" | "additional_images"> & { image?: ContactImageManifest; additional_images?: ContactImageManifest[]; text?: string };
interface TaskState {
  deletion_requested?: boolean;
  preprocessing_deletion_requested?: boolean;
  extraction_parts?: NonNullable<Response["extraction"]>[];
  preprocessing_required?: boolean;
  preprocessing_inflight?: number;
  preprocessing_parts?: ScreenshotPreprocessResult[];
  preprocessing_follow_up_abstained?: boolean;
  preprocessing_refinement_abstained_indices?: number[];
  preprocessing_refined_indices?: number[];
  preprocessing_refinement_unresolved?: boolean;
  batch_conflict?: boolean;
  prompts?: { transcription: PromptSnapshot; contact: PromptSnapshot };
  response: Response;
  searches: Array<{ query: string; candidates: Response["candidates"] }>;
  observations: Array<{ tool: string; result: unknown }>;
  model_receipts: Array<{ model: string; request_id: string; input_tokens: number; output_tokens: number;
    provider?: string; source_image_index?: number; reported_model?: string | null; raw_usage_known?: boolean;
    raw_prompt_tokens?: number | null; raw_completion_tokens?: number | null }>;
  turns: number;
  tokens: number;
  selected: { person_id: string; relationship_context_id: string } | null;
  pending_research: string | null;
  user_contact_label?: string;
}
interface Row {
  id: string; account_id: string; created_by_user_id: string; idempotency_key: string; request_hash: string;
  input_manifest: Manifest; state: TaskState; status: Response["status"];
  revision: number; lease_epoch: number; expires_at: Date;
  capture_id: string | null; source_resource_id: string | null; subject_id: string | null; assignment_id: string | null;
  created_at: Date; updated_at: Date;
}
export interface ScreenshotContactDependencies {
  model: ContactAgentModel;
  preprocessor?: ScreenshotPreprocessor;
  research: ContactResearchClient | null;
}
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase().trim();
const normalizedEvidence = (value: string) => normalized(value).replace(/\s+/gu," ");
const searchableIdentityKinds = new Set(["name","handle","profile_url"]);
const identityWords = (value: string) => normalizedEvidence(value).match(/[\p{L}\p{N}]+/gu)??[];
const identityHandleTokens = (value: string) => normalizedEvidence(value).match(/[\p{L}\p{N}_.+@-]+/gu)??[];
const identityAdjacency = /[\p{L}\p{N}_.+@/\\?&=#%-]/u;
function hasStandaloneVisibleName(value:string,sourceExcerpt:string):boolean{
  const expected=normalizedEvidence(value),excerpt=normalizedEvidence(sourceExcerpt);
  if(!expected)return false;
  for(let index=excerpt.indexOf(expected);index>=0;index=excerpt.indexOf(expected,index+expected.length)){
    const before=Array.from(excerpt.slice(0,index)).at(-1)??"";
    const after=Array.from(excerpt.slice(index+expected.length))[0]??"";
    if(!identityAdjacency.test(before)&&!identityAdjacency.test(after))return true;
  }
  return false;
}
function canonicalProfileURL(value:string):string|null{
  try{
    const url=new URL(value);if(!["http:","https:"].includes(url.protocol))return null;
    url.hash="";url.hostname=url.hostname.toLocaleLowerCase();
    url.pathname=url.pathname.replace(/\/+$/u,"")||"/";
    return url.toString();
  }catch{return null;}
}
function isGroundedIdentityClue(clue:NonNullable<Response["extraction"]>["identity_clues"][number]):boolean{
  const value=normalizedEvidence(clue.value),excerpt=normalizedEvidence(clue.source_excerpt);
  if(!value||!excerpt)return false;
  if(clue.kind==="profile_url"){
    const expected=canonicalProfileURL(value);if(!expected)return false;
    return (excerpt.match(/https?:\/\/[^\s<>"']+/giu)??[]).some(candidate=>canonicalProfileURL(
      candidate.replace(/[),.;!?]+$/u,""))===expected);
  }
  if(clue.kind==="handle"){
    const expected=value.replace(/^@/u,"");
    return identityHandleTokens(excerpt).some(token=>token.replace(/^@/u,"")===expected);
  }
  if(clue.kind==="name")return hasStandaloneVisibleName(value,excerpt);
  const expected=identityWords(value),visible=identityWords(excerpt);
  if(!expected.length)return false;
  return visible.some((_,index)=>expected.every((word,offset)=>visible[index+offset]===word));
}
function automaticIdentityEvidence(row:Row){
  const extraction=row.state.response.extraction;
  // Clarification is intentionally available before understanding exists.
  if(!extraction)return {contactName:null,clues:[]};
  if(!row.state.response.preprocessing)return {contactName:extraction.contact_name,clues:extraction.identity_clues};
  // Preserve every provider clue in its original position for target-bound
  // follow-up correction. Only project grounded values at action boundaries.
  const clues=extraction.identity_clues.filter(isGroundedIdentityClue);
  const contactName=extraction.contact_name&&clues.some(clue=>clue.kind==="name"&&
    normalizedEvidence(clue.value)===normalizedEvidence(extraction.contact_name!))?extraction.contact_name:null;
  return {contactName,clues};
}
function deny(code: string): never { throw new ApiError(409, code, code); }
/**
 * Declared fixed policy codes of this task surface and the shared Agent
 * contact-surface producers that reach it (intake extraction, screenshot
 * preprocessing, model adapters, and evidence admission), plus the runner's
 * abort reasons. Mapped only through this finite set: locally constructed
 * typed policy errors never surface anything outside it, and unknown
 * exception content maps to the stable fallback.
 */
const CONTACT_TASK_POLICY_CODES: readonly string[] = [
  // Shared Agent contact intake / model adapter producers.
  "CONTACT_AGENT_EXPECTED_ONE_TOOL_CALL",
  "CONTACT_AGENT_OUTPUT_INVALID",
  "CONTACT_AGENT_PROVIDER_EMPTY_RESPONSE",
  "CONTACT_AGENT_PROVIDER_ENDPOINT_INVALID",
  "CONTACT_AGENT_PROVIDER_IDENTITY_MISMATCH",
  "CONTACT_AGENT_PROVIDER_INVALID_JSON",
  "CONTACT_AGENT_PROVIDER_NOT_CONFIGURED",
  "CONTACT_AGENT_PROVIDER_RESPONSE_TOO_LARGE",
  "CONTACT_AGENT_TOKEN_BUDGET_EXHAUSTED",
  "CONTACT_AGENT_TOOL_CALL_INVALID",
  "CONTACT_IMAGE_FORMAT_INVALID",
  "CONTACT_IMAGE_OVERVIEW_TOO_LARGE",
  "CONTACT_IMAGE_REGION_OUT_OF_BOUNDS",
  "CONTACT_IMAGE_VIEW_LIMIT",
  "CONTACT_IMAGE_VIEW_SELECTION_INVALID",
  "CONTACT_TEXT_EXTRACTION_NOT_SOURCE_GROUNDED",
  // Evidence admission and original-pixel boundaries.
  "EVIDENCE_IMAGE_SCOPE_MISMATCH",
  "GENERATION_REVOKED",
  "IMAGE_EXPIRED",
  "ORIGINAL_MUST_NOT_BE_READ",
  "SCREENSHOT_AUTHORITY_REVOKED",
  "SOURCE_EXPIRED",
  "SOURCE_REVOKED",
  "TEXT_RUN_MUST_NOT_READ_PIXELS",
  // Shared screenshot preprocessing producers.
  "SCREENSHOT_PREPROCESS_CONTRACT_MISMATCH",
  "SCREENSHOT_PREPROCESS_CREDENTIAL_REQUIRED",
  "SCREENSHOT_PREPROCESS_IMAGE_FORMAT_INVALID",
  "SCREENSHOT_PREPROCESS_IMAGE_INTEGRITY_MISMATCH",
  "SCREENSHOT_PREPROCESS_IMAGE_TOO_LARGE",
  "SCREENSHOT_PREPROCESS_MODEL_MISMATCH",
  "SCREENSHOT_PREPROCESS_OUTPUT_INVALID",
  "SCREENSHOT_PREPROCESS_OVERVIEW_TOO_LARGE",
  "SCREENSHOT_PREPROCESS_PROMPT_MISMATCH",
  "SCREENSHOT_PREPROCESS_PROVIDER_EMPTY_RESPONSE",
  "SCREENSHOT_PREPROCESS_PROVIDER_IDENTITY_MISMATCH",
  "SCREENSHOT_PREPROCESS_PROVIDER_INVALID_JSON",
  "SCREENSHOT_PREPROCESS_PROVIDER_MISMATCH",
  "SCREENSHOT_PREPROCESS_REGION_OUT_OF_BOUNDS",
  "SCREENSHOT_PREPROCESS_RESPONSE_TOO_LARGE",
  "SCREENSHOT_PREPROCESS_SCHEMA_MISMATCH",
  "SCREENSHOT_PREPROCESS_TILE_LIMIT",
  "SCREENSHOT_PREPROCESS_VIEW_BUDGET",
  "SCREENSHOT_PREPROCESS_VIEW_TOO_LARGE",
  // Screenshot contact task policy codes.
  "CONTACT_AGENT_SERVER_STOPPED",
  "CONTACT_BATCH_IDENTITY_CONFLICT",
  "CONTACT_CHAT_HAS_NO_MESSAGES",
  "CONTACT_CHAT_IDENTITY_AMBIGUOUS",
  "CONTACT_CHAT_STORAGE_SCOPE_MISSING",
  "CONTACT_CITATION_EXCERPT_MISMATCH",
  "CONTACT_CITATION_SOURCE_UNAVAILABLE",
  "CONTACT_CREATE_REQUIRES_EMPTY_SEARCH",
  "CONTACT_CREATE_REQUIRES_VISIBLE_NAME",
  "CONTACT_DIRECTORY_CHANGED_SEARCH_AGAIN",
  "CONTACT_EXTRACTION_ALREADY_CHECKPOINTED",
  "CONTACT_FETCH_SOURCE_DUPLICATE",
  "CONTACT_FINISH_REQUIRES_STORAGE_READBACK",
  "CONTACT_HANDOFF_NOT_FOUND",
  "CONTACT_IMAGE_INTEGRITY_MISMATCH",
  "CONTACT_IMAGE_REFERENCE_INVALID",
  "CONTACT_IMAGE_UNAVAILABLE",
  "CONTACT_IMAGE_UPLOAD_FAILED",
  "CONTACT_ORIGINAL_IMAGE_REQUIRED",
  "CONTACT_PREPROCESS_CAPTURE_CONFLICT",
  "CONTACT_PREPROCESS_DELETE_REQUIRED",
  "CONTACT_PREPROCESS_LINK_REQUIRED",
  "CONTACT_PREPROCESS_NOT_LINKABLE",
  "CONTACT_PREPROCESS_PROFILE_FILING_FORBIDDEN",
  "CONTACT_PREPROCESS_SOURCE_MISMATCH",
  "CONTACT_PROFILE_FIELD_LIMIT",
  "CONTACT_PROFILE_NOT_REVIEWABLE",
  "CONTACT_PROFILE_REQUIRES_EXACT_CITED_URL",
  "CONTACT_PROFILE_REVIEW_INVALID",
  "CONTACT_PROFILE_REVIEW_REQUIRED",
  "CONTACT_PROFILE_SELECTED_SCOPE_REQUIRED",
  "CONTACT_PUBLIC_IDENTITY_UNCORROBORATED",
  "CONTACT_PUBLIC_QUERY_NOT_IDENTITY_ONLY",
  "CONTACT_QUESTION_ESCAPED_TEXT",
  "CONTACT_READ_REQUIRES_UNIQUE_SCOPE",
  "CONTACT_RESEARCH_NOT_AUTHORIZED",
  "CONTACT_RESEARCH_NOT_CONFIGURED",
  "CONTACT_SEARCH_NOT_AN_IDENTITY_CLUE",
  "CONTACT_SELECTED_REUSE_REQUIRED",
  "CONTACT_SOURCE_DELETION_PENDING",
  "CONTACT_SOURCE_NOT_DISCOVERED",
  "CONTACT_SOURCE_STATEMENT_REQUIRES_LITERAL_VALUE",
  "CONTACT_SUMMARY_ESCAPED_TEXT",
  "CONTACT_TARGET_UNAVAILABLE",
  "CONTACT_TASK_ALREADY_FILED",
  "CONTACT_TASK_BUDGET_EXHAUSTED",
  "CONTACT_TASK_CANCELLED",
  "CONTACT_TASK_IDEMPOTENCY_CONFLICT",
  "CONTACT_TASK_INPUT_INVALID",
  "CONTACT_TASK_LEASE_LOST",
  "CONTACT_TASK_NOT_FOUND",
  "CONTACT_TASK_NOT_RESUMABLE",
  "CONTACT_TASK_OPERATION_FAILED",
  "CONTACT_TASK_REVISION_CHANGED",
  "CONTACT_TASK_SCOPE_AMBIGUOUS",
  "CONTACT_TASK_SCOPE_INCOMPLETE",
  "CONTACT_TASK_SESSION_DELETED",
  "CONTACT_TASK_SOURCE_UNAVAILABLE",
  "CONTACT_TASK_TIMEOUT",
  "CONTACT_TEXT_PROCESSOR_UNAVAILABLE",
  "CONTACT_TEXT_REUSE_REQUIRES_SELECTION",
  "CONTACT_TOOL_NOT_AUTHORIZED",
  "CONTACT_UNDERSTANDING_ALREADY_USED",
  "CONTACT_UNDERSTANDING_REQUIRED",
  "CONTACT_UPDATE_REQUIRES_STORED_CHAT",
  "CONTACT_WRITE_SCOPE_MISMATCH",
  "SCREENSHOT_PREPROCESSOR_NOT_CONFIGURED",
  "SCREENSHOT_PREPROCESS_CHECKPOINT_INCOMPLETE",
  "SCREENSHOT_PREPROCESS_RECEIPT_MISMATCH",
  "SCREENSHOT_PREPROCESS_RESPONSE_UNKNOWN",
  "SCREENSHOT_PREPROCESS_SOURCE_REQUIRED",
];
/** Everything this task surface may legitimately report as a diagnostic. */
export const CONTACT_TASK_DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set([
  ...RESEARCH_TOOL_ERROR_CODE_SET,
  ...CONTACT_TASK_POLICY_CODES,
]);
/**
 * Fixed bounded failure diagnostic. A code-shaped Error.message, an arbitrary
 * error.code, or a raw Error.name never becomes a task diagnostic: unknown
 * content maps to the stable fallback and cannot enter limitations,
 * observations, or logging.
 */
export function contactTaskDiagnosticCode(error: unknown): string {
  return boundedDiagnosticCode(
    error,
    CONTACT_TASK_DIAGNOSTIC_CODE_SET,
    "CONTACT_TASK_OPERATION_FAILED",
  );
}
/**
 * Span-persistence failure logging uses only the fixed operation diagnostic:
 * a raw Error.name or message never reaches the console.
 */
export function reportScreenshotSpanPersistenceFailure(error: unknown): void {
  console.error(
    "Product screenshot span persistence failed",
    contactTaskDiagnosticCode(error),
  );
}
function terminalResponse(row: Row, status: Response["status"]): Response {
  return { task_id: row.id,revision: row.revision,status,contact:null,capture_id:null,source_resource_id:null,
    message_count:0,extraction:null,summary:"",findings:[],profile_fields:[],public_sources:[],question:null,
    candidates:[],limitations:[],events:[],external_effects:[],created_at:row.created_at.toISOString(),updated_at:row.updated_at.toISOString() };
}

async function rowFor(client: Pool | PoolClient, auth: AuthContext, id: string, lock = false): Promise<Row> {
  const result = await client.query<Row>(`SELECT * FROM screenshot_contact_tasks
    WHERE account_id=$1 AND id=$2 AND created_by_user_id=$3 ${lock ? "FOR UPDATE" : ""}`, [auth.accountId,id,auth.userId]);
  if (!result.rows[0]) throw new ApiError(404,"CONTACT_TASK_NOT_FOUND","Contact task not found.");
  return result.rows[0];
}

const sourceDeletionRequested = (row: Row) =>
  row.state.deletion_requested === true || row.state.preprocessing_deletion_requested === true;

async function assertSourceCurrent(client: Pool | PoolClient, row: Row): Promise<void> {
  if (row.expires_at.getTime() <= Date.now() || row.status === "deleted" || sourceDeletionRequested(row))
    deny("CONTACT_TASK_SOURCE_UNAVAILABLE");
  const directory=(await client.query<{available:boolean}>("SELECT contact_task_directory_available($1,$2::jsonb) AS available",[row.account_id,JSON.stringify(row.state)])).rows[0];
  if(!directory?.available)deny("CONTACT_DIRECTORY_CHANGED_SEARCH_AGAIN");
  if (!row.capture_id) return;
  if(row.input_manifest.preprocess_only===true){
    const linked=await client.query(`SELECT 1 FROM captures c
      JOIN subjects s ON s.account_id=c.account_id AND s.id=c.subject_id
      JOIN assignments a ON a.account_id=c.account_id AND a.id=c.assignment_id AND a.subject_id=c.subject_id
      JOIN source_resources r ON r.account_id=c.account_id AND r.capture_id=c.id
      JOIN source_retention_receipts sr ON sr.account_id=c.account_id AND sr.capture_id=c.id
      WHERE c.account_id=$1 AND c.id=$2 AND c.status='active' AND s.status='active' AND c.subject_id=$3
        AND c.assignment_id=$4 AND a.status='active' AND r.id=$5 AND r.processing_state<>'deleted'
        AND sr.authorization_state='authorized'
        AND (sr.authorization_expires_at IS NULL OR sr.authorization_expires_at>statement_timestamp())`,
      [row.account_id,row.capture_id,row.subject_id,row.assignment_id,row.source_resource_id]);
    if(!linked.rowCount)deny("CONTACT_TASK_SOURCE_UNAVAILABLE");
    return;
  }
  const found = await client.query(`SELECT 1 FROM captures c JOIN subjects s ON s.account_id=c.account_id AND s.id=c.subject_id
    JOIN source_retention_receipts r ON r.account_id=c.account_id AND r.capture_id=c.id
    WHERE c.account_id=$1 AND c.id=$2 AND c.status='active' AND s.status='active'
    AND c.subject_id=$3
    AND r.authorization_state='authorized' AND r.source_access_state NOT IN ('purged','deleted')
    AND c.retention_until > now()`,[row.account_id,row.capture_id,row.subject_id]);
  if (!found.rowCount) deny("CONTACT_TASK_SOURCE_UNAVAILABLE");
}

async function save(client: PoolClient, row: Row) {
  const response = row.state.response;
  const linkedPreprocessing = row.input_manifest.preprocess_only===true && row.capture_id!==null;
  const subjectID=linkedPreprocessing?row.subject_id:response.contact?.person_id??null;
  const assignmentID=linkedPreprocessing?row.assignment_id:response.contact?.relationship_context_id??null;
  const captureID=linkedPreprocessing?row.capture_id:response.capture_id;
  const sourceResourceID=linkedPreprocessing?row.source_resource_id:response.source_resource_id;
  response.limitations=response.limitations.slice(-20);
  const result = await client.query<{revision:number;updated_at:Date}>(`UPDATE screenshot_contact_tasks
    SET state=$3::jsonb,status=$4,revision=revision+1,subject_id=$5,assignment_id=$6,capture_id=$7,source_resource_id=$8,
      updated_at=now(),lease_until=CASE WHEN $4='running' THEN now()+interval '90 seconds' ELSE NULL END
    WHERE account_id=$1 AND id=$2 AND status <> 'deleted' AND lease_epoch=$9
    RETURNING revision,updated_at`,[row.account_id,row.id,JSON.stringify(row.state),response.status,
      subjectID,assignmentID,captureID,sourceResourceID,row.lease_epoch]);
  if (!result.rows[0]) deny("CONTACT_TASK_LEASE_LOST");
  row.revision=result.rows[0].revision;
  row.status=response.status;
  row.capture_id=captureID;
  row.source_resource_id=sourceResourceID;
  row.subject_id=subjectID;
  row.assignment_id=assignmentID;
  response.revision=row.revision;response.updated_at=result.rows[0].updated_at.toISOString();
  await saveProductRunOutput(client,{accountID:row.account_id,taskID:row.id},response as unknown as Record<string,unknown>,response.status);
  // Refresh the source-safe usage counters after every admitted checkpoint so
  // they survive the rebind purge of this same save and stay readable.
  await saveProductRunUsageDiagnostics(client,{accountID:row.account_id,taskID:row.id},usageDiagnostics(row.state.model_receipts));
}

/** Carry explicitly observed raw usage from a preprocessing receipt into
 * bounded diagnostics. Unknown, invalid or half-observed raw usage stays
 * explicitly unknown; normalized packet counters never claim a known zero. */
function arkUsageReceipt(output:ScreenshotPreprocessResult){
  const fields=output as unknown as Record<string,unknown>;
  const count=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:null;
  const prompt=count(fields.raw_prompt_tokens),completion=count(fields.raw_completion_tokens);
  const observed=fields.raw_usage_known===true&&prompt!==null&&completion!==null;
  return {reported_model:typeof fields.reported_model==="string"&&fields.reported_model?fields.reported_model.slice(0,200):null,
    raw_usage_known:observed,raw_prompt_tokens:observed?prompt:null,raw_completion_tokens:observed?completion:null};
}

function usageDiagnostics(receipts:TaskState["model_receipts"]):ScreenshotUsageDiagnostic[]{
  return receipts.filter(receipt=>receipt.provider==="volcano_ark").map(receipt=>({
    provider:"volcano_ark",model:receipt.model,reported_model:receipt.reported_model??null,
    source_image_index:typeof receipt.source_image_index==="number"?receipt.source_image_index:0,
    request_id:receipt.request_id,raw_usage_known:receipt.raw_usage_known===true,
    raw_prompt_tokens:receipt.raw_prompt_tokens??null,raw_completion_tokens:receipt.raw_completion_tokens??null}));
}

export async function loadScreenshotContactTask(pool: Pool, auth: AuthContext, id: string): Promise<Response> {
  const row=await rowFor(pool,auth,id);
  try { await assertSourceCurrent(pool,row); } catch (error) {
    if (error instanceof ApiError && ["CONTACT_TASK_SOURCE_UNAVAILABLE", "CONTACT_DIRECTORY_CHANGED_SEARCH_AGAIN"].includes(error.code)) {
      return terminalResponse(row,"deleted");
    }
    // A failed availability lookup is not evidence that the source was deleted.
    throw error;
  }
  return ScreenshotContactTaskResponseSchema.parse({...row.state.response,
    preprocessing_pending_source_indices:pendingPreprocessRefinementIndices(row),
    revision:row.revision,updated_at:row.updated_at.toISOString()});
}

export async function resumeScreenshotContactTask(pool:Pool,auth:AuthContext,id:string,input:{
  expected_revision:number; selected_person_id?:string; selected_relationship_context_id?:string;
  new_contact_name?:string; image?:ScreenshotContactTaskRequest["image"];
}):Promise<Response>{
  await inTransaction(pool,async client=>{
    const observed=await rowFor(client,auth,id);
    const personIDs=[...new Set([
      input.selected_person_id,
      observed.state.selected?.person_id,
      observed.subject_id??undefined,
      observed.state.response.contact?.person_id,
    ].filter((value):value is string=>Boolean(value)))].sort();
    for(const personID of personIDs)await lockContactTaskPerson(client,auth.accountId,personID);
    const row=await rowFor(client,auth,id,true);
    if(sourceDeletionRequested(row))deny("CONTACT_SOURCE_DELETION_PENDING");
    await assertSourceCurrent(client,row);
    if(row.revision!==input.expected_revision)deny("CONTACT_TASK_REVISION_CHANGED");
    if(!["waiting_for_user","partial","failed","cancelled"].includes(row.status))deny("CONTACT_TASK_NOT_RESUMABLE");
    if(Boolean(input.selected_person_id)!==Boolean(input.selected_relationship_context_id))deny("CONTACT_TASK_SCOPE_INCOMPLETE");
    if(input.new_contact_name&&input.selected_person_id)deny("CONTACT_TASK_SCOPE_AMBIGUOUS");
    if(input.image){
      if(row.state.response.extraction)deny("CONTACT_EXTRACTION_ALREADY_CHECKPOINTED");
      const manifest=validateContactImage(input.image);
      if(manifest.content_hash!==row.input_manifest.image?.content_hash)deny("CONTACT_IMAGE_INTEGRITY_MISMATCH");
    }
    if(row.state.batch_conflict) throw new ApiError(409,"CONTACT_BATCH_IDENTITY_CONFLICT","这些截图包含不同联系人，请分别发送。 ");
    if(row.state.response.contact_draft)deny("CONTACT_PROFILE_REVIEW_REQUIRED");
    if(input.new_contact_name){
      if(row.state.response.capture_id)deny("CONTACT_TASK_ALREADY_FILED");
      if(row.state.response.contact)deny("CONTACT_TASK_SCOPE_AMBIGUOUS");
      row.state.user_contact_label=input.new_contact_name.trim();
    }
    if(input.selected_person_id){
      if(row.state.response.capture_id)deny("CONTACT_TASK_ALREADY_FILED");
      const checkpointed=row.state.response.contact;
      if(checkpointed&&(checkpointed.person_id!==input.selected_person_id||
        checkpointed.relationship_context_id!==input.selected_relationship_context_id))deny("CONTACT_TASK_SCOPE_AMBIGUOUS");
      await getRelationshipScope(client,auth,input.selected_person_id,input.selected_relationship_context_id!);
      row.state.selected={person_id:input.selected_person_id,relationship_context_id:input.selected_relationship_context_id!};
    }
    const unknownPreprocessIndex=row.state.preprocessing_inflight;
    if(unknownPreprocessIndex!==undefined){
      delete row.state.preprocessing_inflight;
      row.state.response.events.push({sequence:row.state.response.events.length+1,tool:"preprocess_screenshot_retry_authorized",status:"completed",occurred_at:new Date().toISOString()});
    }
    row.state.response.status="running";row.state.response.question=null;row.state.turns=0;row.state.tokens=0;
    row.state.model_receipts=row.state.model_receipts.slice(-50);
    row.state.response.events=row.state.response.events.slice(-60).map((event,index)=>({...event,sequence:index+1}));
    await save(client,row);
    await client.query("UPDATE screenshot_contact_tasks SET lease_until=NULL,lease_epoch=lease_epoch+1 WHERE account_id=$1 AND id=$2",[auth.accountId,id]);
    await appendAudit(client,{accountId:auth.accountId,actorUserId:auth.userId},"contact_task.resumed","screenshot_contact_task",id,
      {selected_person_id:input.selected_person_id??null,preprocess_retry_authorized_for_image:unknownPreprocessIndex??null});
  });
  return loadScreenshotContactTask(pool,auth,id);
}

/** Deliberately absent from the Agent tool registry: this decision comes from a human client. */
export async function confirmScreenshotContactProfile(pool:Pool,auth:AuthContext,id:string,raw:unknown):Promise<Response>{
  const parsed=ContactProfileConfirmationSchema.safeParse(raw);
  if(!parsed.success)throw new ApiError(422,"CONTACT_PROFILE_REVIEW_INVALID","请核对姓名和资料字段后再保存。");
  const review=parsed.data;
  const observed=await rowFor(pool,auth,id);
  const personIDs=[...new Set([
    review.selected_person_id,
    observed.state.selected?.person_id,
    observed.subject_id??undefined,
    observed.state.response.contact?.person_id,
  ].filter((value):value is string=>Boolean(value)))].sort();
  await inTransaction(pool,async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${auth.accountId}:reviewed-profile-admission`]);
    for(const personID of personIDs)await lockContactTaskPerson(client,auth.accountId,personID);
    const row=await rowFor(client,auth,id,true);await assertSourceCurrent(client,row);
    if(row.input_manifest.preprocess_only===true)deny("CONTACT_PREPROCESS_PROFILE_FILING_FORBIDDEN");
    if(row.revision!==review.expected_revision)deny("CONTACT_TASK_REVISION_CHANGED");
    if(row.status!=="waiting_for_user"||!row.state.response.contact_draft||!row.state.response.extraction||row.state.batch_conflict)deny("CONTACT_PROFILE_NOT_REVIEWABLE");
    const response=row.state.response;
    if(row.state.selected && !review.create_new && (review.selected_person_id!==row.state.selected.person_id||review.selected_relationship_context_id!==row.state.selected.relationship_context_id))deny("CONTACT_PROFILE_SELECTED_SCOPE_REQUIRED");
    const result=await saveReviewedContactProfile(client,auth,{taskID:id,draft:response.contact_draft!,extraction:response.extraction!,review,
      capturedAt:row.input_manifest.captured_at,expiresAt:row.expires_at.toISOString(),
      ...(row.input_manifest.browser_source?{browserSource:row.input_manifest.browser_source}:{}),
      imageHashes:row.input_manifest.text?[digest(row.input_manifest.text)]:[row.input_manifest.image!,...row.input_manifest.additional_images??[]].map(image=>image.content_hash)});
    if(result.saved){
      Object.assign(response,result.saved);response.status="completed";response.question=null;response.candidates=[];
      response.summary="已保存你核对的联系人资料。";response.message_count=0;
      delete response.contact_draft;
    }else{response.candidates=result.candidates;response.question="找到已有联系人，请选择要保存到的关系。";}
    await save(client,row);
    await client.query("UPDATE screenshot_contact_tasks SET lease_epoch=lease_epoch+1,lease_until=NULL WHERE account_id=$1 AND id=$2",[auth.accountId,id]);
    await appendAudit(client,{accountId:auth.accountId,actorUserId:auth.userId},result.saved?"contact_profile.confirmed":"contact_profile.identity_review_required","screenshot_contact_task",id,
      {reviewed_revision:review.expected_revision,person_id:result.saved?.contact.person_id??null,field_indices:review.fields.map(f=>f.clue_index)});
  });
  return loadScreenshotContactTask(pool,auth,id);
}

export async function cancelScreenshotContactTask(pool:Pool,auth:AuthContext,id:string,expectedRevision:number,
  onCancellationRequested?:()=>void){
  // Authenticate exact task ownership and the observed revision before an
  // in-memory abort can affect a concurrent owner request. The transaction
  // below repeats the checks under the task row lock.
  const preflight=await rowFor(pool,auth,id);
  if(preflight.revision!==expectedRevision)deny("CONTACT_TASK_REVISION_CHANGED");
  onCancellationRequested?.();
  await inTransaction(pool,async client=>{
    const row=await rowFor(client,auth,id,true);await assertSourceCurrent(client,row);
    if(row.revision!==expectedRevision)deny("CONTACT_TASK_REVISION_CHANGED");
    row.state.response.status="cancelled";await save(client,row);
    await client.query("UPDATE screenshot_contact_tasks SET lease_epoch=lease_epoch+1,lease_until=NULL WHERE account_id=$1 AND id=$2",[auth.accountId,id]);
    await appendAudit(client,{accountId:auth.accountId,actorUserId:auth.userId},"contact_task.cancelled","screenshot_contact_task",id,{});
  });
  return loadScreenshotContactTask(pool,auth,id);
}

export async function expireScreenshotContactTasks(pool:Pool,storage?:ChatMediaStorage):Promise<void>{
  await inTransaction(pool,async client=>{
    await client.query(`DELETE FROM contact_profile_observations o USING screenshot_contact_tasks t
      WHERE o.account_id=t.account_id AND o.task_id=t.id AND t.expires_at<=now()`);
    await client.query(`UPDATE screenshot_contact_tasks SET state='{}'::jsonb,input_manifest='{}'::jsonb,status='deleted',
      lease_until=NULL,lease_epoch=lease_epoch+1,revision=revision+1,updated_at=now() WHERE expires_at<=now() AND status<>'deleted'`);
  });
  if(storage) await purgeExpiredContactImages(pool,storage);
}

export async function loadContactIntelligence(pool:Pool,auth:AuthContext,personID:string,contextID:string){
  const archived=await pool.query<{operation_id:string;display_name:string;version:number}>(`SELECT o.id AS operation_id,s.display_label AS display_name,s.version
    FROM contact_archive_operations o JOIN subjects s ON s.account_id=o.account_id AND s.id=o.subject_id
    WHERE o.account_id=$1 AND o.subject_id=$2 AND o.decided_by_user_id=$3 AND o.status='archived'
    AND s.status='deleted' AND s.version=o.archived_revision ORDER BY o.created_at DESC LIMIT 1`,[auth.accountId,personID,auth.userId]);
  if(archived.rows[0])return {scope:null,person_revision:archived.rows[0].version,tasks:[] as Response[],archive:{operation_id:archived.rows[0].operation_id,display_name:archived.rows[0].display_name}};
  const scope=await getRelationshipScope(pool,auth,personID,contextID);
  const person=await pool.query<{version:number}>("SELECT version FROM subjects WHERE account_id=$1 AND id=$2 AND status='active'",[auth.accountId,personID]);
  const tasks=await pool.query<Row>(`SELECT t.* FROM screenshot_contact_tasks t
    JOIN captures c ON c.account_id=t.account_id AND c.id=t.capture_id
    JOIN source_retention_receipts r ON r.account_id=c.account_id AND r.capture_id=c.id
    WHERE t.account_id=$1 AND t.subject_id=$2 AND t.assignment_id=$3 AND t.created_by_user_id=$4
    AND t.status<>'deleted' AND t.expires_at>now() AND c.status='active' AND c.retention_until>now()
    AND r.authorization_state='authorized' AND r.source_access_state='available'
    ORDER BY t.created_at DESC LIMIT 20`,[auth.accountId,personID,contextID,auth.userId]);
  return {scope,archive:null,person_revision:person.rows[0]?.version,tasks:tasks.rows.map(row=>ScreenshotContactTaskResponseSchema.parse({...row.state.response,
    preprocessing_pending_source_indices:pendingPreprocessRefinementIndices(row),
    revision:row.revision,updated_at:row.updated_at.toISOString()}))};
}

/** Recovery reads only the caller's operation identity; no pixels, model run or write. */
export async function lookupScreenshotContactReceipt(pool: Pool, auth: AuthContext, requestKey: string) {
  const result = await pool.query<{id: string; status: string; expires_at: Date}>(
    `SELECT id,status,expires_at FROM screenshot_contact_tasks WHERE account_id=$1 AND created_by_user_id=$2 AND idempotency_key=$3`,
    [auth.accountId, auth.userId, requestKey]);
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "CONTACT_HANDOFF_NOT_FOUND", "No task receipt is available for this request.");
  return { task_id: row.id, status: row.expires_at <= new Date() ? "expired" : row.status };
}

export async function listScreenshotContactTasks(pool:Pool,auth:AuthContext){
  const result=await pool.query<Row>(`SELECT * FROM screenshot_contact_tasks WHERE account_id=$1 AND created_by_user_id=$2
    AND status<>'deleted' AND expires_at>now() ORDER BY created_at DESC LIMIT 20`,[auth.accountId,auth.userId]);
  const tasks=[];
  for(const row of result.rows){try{await assertSourceCurrent(pool,row);tasks.push({task_id:row.id,status:row.status,revision:row.revision,
    source:row.state.response.source,contact:row.state.response.contact,summary:row.state.response.summary,created_at:row.created_at.toISOString()});}catch{}}
  return {tasks};
}

export async function deleteContactCaptureTask(pool:Pool,auth:AuthContext,id:string,expectedRevision:number,
  storage?:ChatMediaStorage,onDeletionFenced?:()=>void){
  const captureID=await inTransaction(pool,async client=>{
    const row=await rowFor(client,auth,id,true);
    if(row.status==="deleted")return row.capture_id;
    if(!row.state.deletion_requested){
      if(row.revision!==expectedRevision)deny("CONTACT_TASK_REVISION_CHANGED");
      // Fence in-flight model work before removing governed evidence. Once the
      // intent commits, the same user may continue deletion with the original
      // revision after a later phase fails; the intent itself is irreversible.
      row.state.deletion_requested=true;row.state.response.status="cancelled";
      row.state.response.limitations.push("CONTACT_SOURCE_DELETION_PENDING");await save(client,row);
      await client.query("UPDATE screenshot_contact_tasks SET lease_epoch=lease_epoch+1,lease_until=NULL WHERE account_id=$1 AND id=$2",[auth.accountId,id]);
    }
    return row.capture_id;
  });
  onDeletionFenced?.();
  if(captureID)await deleteCapture(pool,auth,captureID,{idempotency_key:`delete-contact-source:${id}`,reason:"User deleted this captured source and its derived analysis."});
  await inTransaction(pool,async client=>{
    const row=await rowFor(client,auth,id,true);
    if(row.status==="deleted")return;
    await client.query("DELETE FROM contact_profile_observations WHERE account_id=$1 AND task_id=$2",[auth.accountId,id]);
    await client.query(`UPDATE screenshot_contact_tasks SET state='{}'::jsonb,input_manifest='{}'::jsonb,status='deleted',
      revision=revision+1,lease_epoch=lease_epoch+1,lease_until=NULL,updated_at=now() WHERE account_id=$1 AND id=$2 AND status<>'deleted'`,[auth.accountId,id]);
    await appendAudit(client,{accountId:auth.accountId,actorUserId:auth.userId},"contact_task.deleted","screenshot_contact_task",id,{});
  });
  if(storage)await purgeContactImagesForTask(pool,auth.accountId,id,storage);
  return loadScreenshotContactTask(pool,auth,id);
}

/** Remove a preprocessing task's retained copy without deleting a canonical
 * capture that was linked after the copy was created. Full task deletion is a
 * separate user operation and continues to cascade through deleteCapture. */
export async function deleteScreenshotPreprocessingSource(pool:Pool,auth:AuthContext,id:string,expectedRevision:number,
  storage?:ChatMediaStorage,onDeletionFenced?:()=>void){
  await inTransaction(pool,async client=>{
    const row=await rowFor(client,auth,id,true);
    if(row.status==="deleted")return;
    if(row.input_manifest.preprocess_only!==true)deny("CONTACT_PREPROCESS_DELETE_REQUIRED");
    if(!row.state.preprocessing_deletion_requested){
      if(row.revision!==expectedRevision)deny("CONTACT_TASK_REVISION_CHANGED");
      row.state.preprocessing_deletion_requested=true;row.state.response.status="cancelled";
      row.state.response.limitations.push("CONTACT_PREPROCESS_SOURCE_DELETION_PENDING");await save(client,row);
      await client.query("UPDATE screenshot_contact_tasks SET lease_epoch=lease_epoch+1,lease_until=NULL WHERE account_id=$1 AND id=$2",[auth.accountId,id]);
    }
  });
  onDeletionFenced?.();
  await inTransaction(pool,async client=>{
    const row=await rowFor(client,auth,id,true);
    if(row.status==="deleted")return;
    await client.query("DELETE FROM contact_profile_observations WHERE account_id=$1 AND task_id=$2",[auth.accountId,id]);
    await client.query(`UPDATE screenshot_contact_tasks SET state='{}'::jsonb,input_manifest='{}'::jsonb,status='deleted',
      revision=revision+1,lease_epoch=lease_epoch+1,lease_until=NULL,updated_at=now() WHERE account_id=$1 AND id=$2 AND status<>'deleted'`,[auth.accountId,id]);
    await appendAudit(client,{accountId:auth.accountId,actorUserId:auth.userId},"contact_task.preprocessing_source_deleted","screenshot_contact_task",id,{});
  });
  if(storage)await purgeContactImagesForTask(pool,auth.accountId,id,storage);
  return loadScreenshotContactTask(pool,auth,id);
}

export async function linkScreenshotContactTaskCapture(pool:Pool,auth:AuthContext,id:string,input:{
  expected_revision:number;capture_id:string;source_resource_id:string;
}){
  return inTransaction(pool,async client=>{
    const row=await rowFor(client,auth,id,true);await assertSourceCurrent(client,row);
    if(row.input_manifest.preprocess_only!==true)deny("CONTACT_PREPROCESS_LINK_REQUIRED");
    if(row.capture_id){
      if(row.capture_id!==input.capture_id||row.source_resource_id!==input.source_resource_id)
        deny("CONTACT_PREPROCESS_CAPTURE_CONFLICT");
      return {task_id:id,revision:row.revision,capture_id:row.capture_id,source_resource_id:input.source_resource_id};
    }
    if(row.revision!==input.expected_revision)deny("CONTACT_TASK_REVISION_CHANGED");
    if(!["completed","waiting_for_user"].includes(row.status))deny("CONTACT_PREPROCESS_NOT_LINKABLE");
    // New tasks use v3. Keep exact v2 linkage for retained receipts created
    // before the baseline_text contract upgrade; they are never replayed as v3.
    const seed=/^ios:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):preprocess-v(?:2|3)$/u.exec(row.idempotency_key)?.[1];
    if(!seed)deny("CONTACT_PREPROCESS_SOURCE_MISMATCH");
    const capture=await client.query<{subject_id:string;assignment_id:string}>(`SELECT c.subject_id,c.assignment_id
      FROM captures c JOIN source_resources r ON r.account_id=c.account_id AND r.capture_id=c.id
      JOIN subjects s ON s.account_id=c.account_id AND s.id=c.subject_id
      JOIN assignments a ON a.account_id=c.account_id AND a.id=c.assignment_id AND a.subject_id=c.subject_id
      JOIN source_retention_receipts sr ON sr.account_id=c.account_id AND sr.capture_id=c.id
      JOIN idempotency_records k ON k.account_id=c.account_id AND k.actor_user_id=c.created_by_user_id
      WHERE c.account_id=$1 AND c.id=$2 AND c.created_by_user_id=$3 AND c.status='active'
        AND r.id=$4 AND r.processing_state<>'deleted' AND c.source_kind='conversation_screenshot'
        AND r.resource_kind='conversation_screenshot' AND r.input_channel='ios_share' AND r.client_resource_id=$5
        AND k.operation_scope='create_resource_capture' AND k.idempotency_key=$6 AND k.status='completed'
        AND k.response_body->>'capture_id'=c.id::text AND s.status='active' AND a.status='active'
        AND sr.authorization_state='authorized'
        AND (sr.authorization_expires_at IS NULL OR sr.authorization_expires_at>statement_timestamp())
      FOR UPDATE OF c,r,s,a,sr,k`,[auth.accountId,input.capture_id,auth.userId,input.source_resource_id,`ios-share:${seed}`,`ios:${seed}:capture`]);
    if(!capture.rows[0])deny("CONTACT_PREPROCESS_SOURCE_MISMATCH");
    const linked=await client.query<{revision:number}>(`UPDATE screenshot_contact_tasks SET capture_id=$4,source_resource_id=$5,
      subject_id=$6,assignment_id=$7,revision=revision+1,updated_at=now()
      WHERE account_id=$1 AND id=$2 AND created_by_user_id=$3 AND status<>'deleted' RETURNING revision`,
      [auth.accountId,id,auth.userId,input.capture_id,input.source_resource_id,capture.rows[0].subject_id,capture.rows[0].assignment_id]);
    const revision=linked.rows[0]!.revision;
    await appendAudit(client,{accountId:auth.accountId,actorUserId:auth.userId},"contact_task.capture_linked","screenshot_contact_task",id,
      {capture_id:input.capture_id,source_resource_id:input.source_resource_id});
    return {task_id:id,revision,capture_id:input.capture_id,source_resource_id:input.source_resource_id};
  });
}

export async function loadBrowserCaptureTask(pool: Pool, auth: AuthContext, requestID: string) {
  const result=await pool.query<{id:string}>(`SELECT id FROM screenshot_contact_tasks
    WHERE account_id=$1 AND created_by_user_id=$2 AND idempotency_key=$3`,
    [auth.accountId,auth.userId,`browser-capture:${requestID}`]);
  if(!result.rows[0])throw new ApiError(404,"CONTACT_TASK_NOT_FOUND","Capture receipt not found.");
  return loadScreenshotContactTask(pool,auth,result.rows[0].id);
}

function imageManifest(request: ScreenshotContactTaskRequest | TextContactTaskRequest): Manifest {
  if ("text" in request) return request;
  const {image, additional_images, ...rest}=request;
  return {...rest,image:validateContactImage(image),...(additional_images?.length?{additional_images:additional_images.map(validateContactImage)}:{})};
}

export async function loadScreenshotContactImage(pool:Pool,auth:AuthContext,id:string,index:number,storage:ChatMediaStorage){
  await assertSourceCurrent(pool,await rowFor(pool,auth,id));
  const image=await readContactImage(pool,auth,id,index,storage);
  if(!image)throw new ApiError(404,"CONTACT_IMAGE_UNAVAILABLE","原图暂时不可用，请重试。");
  await assertSourceCurrent(pool,await rowFor(pool,auth,id));
  return image;
}

/** Revalidate a derived view without retaining or fetching its pixels again. */
export async function assertScreenshotContactImageCurrent(pool:Pool,auth:AuthContext,id:string,index:number,hash:string){
  await assertSourceCurrent(pool,await rowFor(pool,auth,id));
  if (!(await pool.query(`SELECT 1 FROM contact_task_images WHERE account_id=$1 AND task_id=$2
    AND image_index=$3 AND content_hash=$4 AND status='stored' AND expires_at>clock_timestamp()`,
  [auth.accountId,id,index,hash])).rowCount) deny("CONTACT_IMAGE_UNAVAILABLE");
}

export async function createScreenshotContactTask(pool: Pool,auth: AuthContext,raw: unknown, storage?:ChatMediaStorage,
  options: { preprocessingRequired?: boolean } = {}): Promise<{body:Response;replayed:boolean}> {
  const parsed=ScreenshotContactTaskRequestSchema.or(TextContactTaskRequestSchema).safeParse(raw);
  if (!parsed.success) throw new ApiError(422,"CONTACT_TASK_INPUT_INVALID","请选择最多 10 张截图，每张不超过 10 MB，总计不超过 30 MB。");
  const request=parsed.data;const images="image" in request?contactImages(request):[];const manifest=imageManifest(request);const hash=digest(JSON.stringify(manifest));
  if (Boolean(request.selected_person_id)!==Boolean(request.selected_relationship_context_id)) deny("CONTACT_TASK_SCOPE_INCOMPLETE");
  const result = await inTransaction(pool,async(client)=>{
    // Serialize admission with Session deletion so an unknown receipt cannot
    // create a new task after its Session's deletion tombstone commits.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
      `${auth.accountId}:${auth.userId}:agent-sessions`,
    ]);
    const removedSession=await client.query(`SELECT 1 FROM agent_sessions retired
      WHERE retired.account_id=$1 AND retired.created_by_user_id=$2 AND retired.screenshot_admission_key_hash=$3
        AND (retired.deleted_at IS NOT NULL OR retired.expires_at<=now())
        AND NOT EXISTS (SELECT 1 FROM agent_sessions active
          WHERE active.account_id=$1 AND active.created_by_user_id=$2 AND active.deleted_at IS NULL AND active.expires_at>now()
            AND (active.screenshot_admission_key_hash=$3 OR EXISTS (
              SELECT 1 FROM screenshot_contact_tasks task WHERE task.account_id=$1 AND task.created_by_user_id=$2
                AND task.idempotency_key=$4 AND COALESCE(active.payload->'screenshotTaskIDs','[]'::jsonb) ? task.id::text)))
      LIMIT 1`,[auth.accountId,auth.userId,digest(request.idempotency_key),request.idempotency_key]);
    if(removedSession.rowCount) throw new ApiError(410,"CONTACT_TASK_SESSION_DELETED","The Session for this screenshot request was deleted or expired.");
    if(request.selected_person_id){
      await lockContactTaskPerson(client,auth.accountId,request.selected_person_id);
      await getRelationshipScope(client,auth,request.selected_person_id,request.selected_relationship_context_id!);
    }
    const id=randomUUID();const now=new Date().toISOString();
    const response:Response={...(request.source?{source:request.source,source_captured_at:request.captured_at}:{}),...("text" in request?{source_text:request.text}:{}),...(storage?{source_images:images.map((image,image_index)=>({...validateContactImage(image),image_index}))}:{}),task_id:id,revision:1,status:"running",contact:null,capture_id:null,source_resource_id:null,
      message_count:0,extraction:null,summary:"",findings:[],profile_fields:[],public_sources:[],question:null,candidates:[],
      limitations:[],events:[],external_effects:[],created_at:now,updated_at:now};
    const state:TaskState={response,preprocessing_required:options.preprocessingRequired===true&&"image" in request,
      searches:[],observations:[],model_receipts:[],turns:0,tokens:0,pending_research:null,
      selected:request.selected_person_id?{person_id:request.selected_person_id,relationship_context_id:request.selected_relationship_context_id!}:null};
    const result=await client.query(`INSERT INTO screenshot_contact_tasks(id,account_id,created_by_user_id,idempotency_key,request_hash,input_manifest,state,status)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'running') ON CONFLICT(account_id,created_by_user_id,idempotency_key) DO NOTHING RETURNING id`,
      [id,auth.accountId,auth.userId,request.idempotency_key,hash,JSON.stringify(manifest),JSON.stringify(state)]);
    if(!result.rowCount){
      const prior=await client.query<Row>(`SELECT * FROM screenshot_contact_tasks WHERE account_id=$1 AND created_by_user_id=$2 AND idempotency_key=$3`,[auth.accountId,auth.userId,request.idempotency_key]);
      const row=prior.rows[0]!;if(row.request_hash!==hash) deny("CONTACT_TASK_IDEMPOTENCY_CONFLICT");
      await assertSourceCurrent(client,row);
      return {body:{...row.state.response,revision:row.revision,updated_at:row.updated_at.toISOString()},replayed:true};
    }
    if(storage) await reserveContactImages(client,auth,id,images.map(validateContactImage),storage);
    await appendAudit(client,{accountId:auth.accountId,actorUserId:auth.userId},"contact_task.created","screenshot_contact_task",id,
      {image_content_hashes:images.map(image=>image.content_hash),raw_image_storage_requested:Boolean(storage),
        automatic_internal_filing:!("preprocess_only" in request&&request.preprocess_only===true),
        preprocess_only:"preprocess_only" in request&&request.preprocess_only===true,public_research:request.allow_public_research});
    return {body:response,replayed:false};
  });
  if(storage && images.length) {
    try { await persistContactImages(pool,auth,result.body.task_id,images,storage); }
    catch { throw new ApiError(503,"CONTACT_IMAGE_UPLOAD_FAILED","图片尚未全部保存，请重试本次发送。"); }
  }
  return {...result,body:await loadScreenshotContactTask(pool,auth,result.body.task_id)};
}

function toolsFor(row: Row): ContactIntakeToolName[] {
  const response=row.state.response;
  if(row.input_manifest.preprocess_only||row.state.preprocessing_refinement_unresolved) return [];
  if(pendingPreprocessRefinementIndices(row).length) return [];
  if (!response.contact) return ["search_contacts","read_contact","create_contact","ask_contact_clarification"];
  if (!response.capture_id) return ["save_contact_chat","ask_contact_clarification"];
  const tools:ContactIntakeToolName[]=["update_contact","finish_contact_task","ask_contact_clarification"];
  if(row.input_manifest.allow_public_research && row.state.turns<14 && response.public_sources.length<CONTACT_TASK_PUBLIC_SOURCE_LIMIT) tools.push("search_contact_public");
  // Text fetch requires an Exa-discovered source; social profiles use the isolated browse tool.
  if(response.public_sources.some(source=>source.provider_id==="exa"&&source.stage==="discovered") && row.state.turns<15) tools.push("fetch_contact_source");
  if(response.public_sources.length>0 && row.state.turns<15) tools.push("browse_contact_source");
  return tools;
}

/** Keep the provider receipt and durable task projection identical at the task-wide source cap. */
export function retainContactResearchResult(
  existingSources: ContactPublicSource[],
  result: ContactResearchToolResponse,
): ContactResearchToolResponse {
  const retained: ContactPublicSource[] = [];
  for (const source of result.sources) {
    const existingIndex=existingSources.findIndex(item=>item.source_id===source.source_id);
    if(existingIndex>=0){existingSources[existingIndex]=source;retained.push(source);continue;}
    if(existingSources.length<CONTACT_TASK_PUBLIC_SOURCE_LIMIT){existingSources.push(source);retained.push(source);}
  }
  const retainedByChannel=new Map<string,number>();
  for(const source of retained)retainedByChannel.set(source.channel,(retainedByChannel.get(source.channel)??0)+1);
  const channels=result.channels.map(outcome=>{
    if(outcome.status==="failed")return outcome;
    const resultCount=retainedByChannel.get(outcome.channel)??0;
    return {...outcome,result_count:resultCount,truncated:outcome.truncated||resultCount<outcome.result_count};
  });
  return {...result,sources:retained,channels};
}

function personAuthoritiesForCall(call:ContactAgentToolCall):string[]{
  if(!["read_contact","save_contact_chat","update_contact"].includes(call.name))return [];
  const personID=(call.arguments as {person_id?:unknown}).person_id;
  return typeof personID==="string"?[personID]:[];
}

function currentToolState(row: Row) {
  const response=row.state.response, extraction=response.extraction;
  const identity=extraction?automaticIdentityEvidence(row):null;
  return { allowed_tools:response.status!=="running" ? [] : !extraction ? ["record_screenshot_understanding"]
    : pendingPreprocessRefinementIndices(row).length ? ["record_screenshot_corrections"] : toolsFor(row), contact:response.contact, capture_id:response.capture_id,
    message_count:response.message_count,
    public_query_tokens:identity ? [identity.contactName,...identity.clues
      .filter(clue=>["name","handle","company","job_title"].includes(clue.kind)).map(clue=>clue.value)].filter(Boolean) : [],
    query_rule:"Combine only these literal public identity tokens, with spaces. Do not add career keywords, translations, private messages, or contact details." };
}

function pendingPreprocessRefinementIndices(row: Row): number[] {
  const completed=new Set(row.state.preprocessing_refined_indices??[]);
  const abstained=new Set(row.state.preprocessing_refinement_abstained_indices??[]);
  return row.state.response.preprocessing?.sources
    .filter(source=>source.follow_up_regions.length>0&&!completed.has(source.source_image_index)&&
      !abstained.has(source.source_image_index))
    .map(source=>source.source_image_index)??[];
}

function hasHumanOnlyPreprocessUncertainty(row:Row):boolean{
  return row.state.response.preprocessing?.sources.some(source=>{
    const regionBound=new Set(source.follow_up_regions.map(region=>region.uncertainty_index));
    return source.uncertainties.some((_,index)=>!regionBound.has(index));
  })??false;
}

function boundedRefinementStillUnresolved(row:Row,sourceImageIndex:number,
  part:NonNullable<Response["extraction"]>):boolean{
  const source=row.state.response.preprocessing?.sources.find(item=>item.source_image_index===sourceImageIndex);
  if(!source)return false;
  const baseline=new Set(source.uncertainties);
  const bounded=new Set(source.follow_up_regions.map(region=>source.uncertainties[region.uncertainty_index]).filter(Boolean));
  // A new uncertainty is necessarily backed by one of this Run's declared
  // region receipts. Baseline uncertainties without a region stay human-only.
  return part.uncertainties.some(item=>bounded.has(item)||!baseline.has(item));
}

function normalizeRefinedExtraction(part:NonNullable<Response["extraction"]>,sourceImageIndex:number):NonNullable<Response["extraction"]>{
  return ContactChatExtractionSchema.parse({...part,
    messages:part.messages.map(message=>({...message,source_image_index:sourceImageIndex})),
    identity_clues:part.identity_clues.map(clue=>({...clue,source_image_index:sourceImageIndex}))});
}

async function summarizeExtractionParts(client:PoolClient,auth:AuthContext,row:Row):Promise<void>{
  const parts=row.state.extraction_parts??[];
  if(!parts.length)deny("CONTACT_UNDERSTANDING_REQUIRED");
  delete row.state.response.contact_draft;
  delete row.state.batch_conflict;
  row.state.response.question=null;
  if(row.state.preprocessing_refinement_unresolved){
    const merged=parts.length===1?{extraction:parts[0]!}:mergeContactExtractions(parts);
    row.state.response.extraction=merged.extraction;row.state.response.status="waiting_for_user";
    row.state.response.question="限定原图补读后仍有无法可靠确认的字段。请核对原图并重新发送更清晰或范围更完整的截图。";
    return;
  }
  if(hasHumanOnlyPreprocessUncertainty(row)){
    const merged=parts.length===1?{extraction:parts[0]!}:mergeContactExtractions(parts);
    row.state.response.extraction=merged.extraction;row.state.response.status="waiting_for_user";
    row.state.response.question="预处理仍有未声明可复读区域的不确定字段。为避免扩大原图暴露，请人工核对或重新发送更清晰、范围更完整的截图。";
    row.state.response.summary=row.input_manifest.preprocess_only
      ? "截图已完成共享预处理，但仍有仅供人工核对的字段；未执行联系人或证据写入。"
      : "截图预处理已保留；未授权额外模型读取，等待人工核对。";
    return;
  }
  if(parts.every(part=>!part.contact_name&&!part.identity_clues.length&&!part.messages.length)){
    row.state.response.extraction=parts[0]!;row.state.response.status="completed";
    row.state.response.summary="未发现可归档的人物。来源已保存，可检查原图或删除本次采集。";return;
  }
  if(row.input_manifest.preprocess_only===true){
    const merged=parts.length===1?{extraction:parts[0]!,question:null as string|null,identityConflict:false}:mergeContactExtractions(parts);
    const mergedExtraction=merged.extraction??parts[0]!;
    row.state.response.extraction=mergedExtraction;
    const unresolved=Boolean(merged.question)||parts.some(part=>part.uncertainties.length>0);
    row.state.response.status=unresolved?"waiting_for_user":"completed";
    row.state.response.question=merged.question??(unresolved
      ? "共享预处理仍有无法可靠确认的字段；请核对原图或重新发送更清晰、范围更完整的截图。"
      : null);
    row.state.response.summary=unresolved
      ? "截图已完成共享预处理，但仍有具体字段需要人工核对；未执行联系人或证据写入。"
      : "截图已完成共享预处理；结构化结果仍需用户核对，未执行联系人或证据写入。";
    return;
  }
  const profile=profileUnderstanding(parts);
  if(profile){
    row.state.response.extraction=profile.extraction;row.state.response.contact_draft=profile.draft;
    row.state.response.status="waiting_for_user";row.state.response.question="请核对联系人资料，修改后保存。";
    if(row.state.selected){
      const scope=await getRelationshipScope(client,auth,row.state.selected.person_id,row.state.selected.relationship_context_id);
      row.state.response.candidates=[{...row.state.selected,display_name:scope.person.display_label,relationship_label:scope.relationship_context.display_label}];
    }
    return;
  }
  const merged=parts.length===1?{extraction:parts[0]!,question:null as string|null,identityConflict:false}:mergeContactExtractions(parts);
  if(parts.every(part=>["profile","not_chat"].includes(part.conversation_kind)))
    merged.question="无法把这些资料截图核对为同一平台的同一联系人，请按联系人和平台分别发送。";
  row.state.response.extraction=merged.extraction;
  if(merged.question){row.state.response.status="waiting_for_user";row.state.response.question=merged.question;row.state.batch_conflict=merged.identityConflict;}
  else row.state.response.status="running";
}

function sourceExcerpt(row:Row,refs:string[],quote:string,publicAllowed:boolean) {
  const extraction=row.state.response.extraction!;
  const sources=refs.map(ref=> {
    const message=extraction.messages.find(m=>m.message_id===ref);
    if(message)return message.text;
    const clueIndex=/^clue([1-9][0-9]*)$/u.exec(ref);
    const clue=clueIndex?extraction.identity_clues[Number(clueIndex[1])-1]:null;
    if(publicAllowed&&clue)return clue.source_excerpt;
    const source=row.state.response.public_sources.find(s=>s.source_id===ref);
    if(publicAllowed&&source?.stage==="fetched")return source.text;
    deny("CONTACT_CITATION_SOURCE_UNAVAILABLE");
  });
  if(!sources.some(text=>text.includes(quote)))deny("CONTACT_CITATION_EXCERPT_MISMATCH");
}

function canonicalSourceRef(row:Row,ref:string):string{
  const match=/^public([1-9][0-9]*)$/u.exec(ref);
  if(!match)return ref;
  const source=row.state.response.public_sources[Number(match[1])-1];
  if(!source)deny("CONTACT_CITATION_SOURCE_UNAVAILABLE");
  return source.source_id;
}
function comparableProfileURL(value:string):string|null{
  try{const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password)return null;
    return `${url.hostname.replace(/^www\./u,"")}${url.pathname.replace(/\/$/u,"")}${url.search}`;
  }catch{return null;}
}

async function storeChat(client:PoolClient,auth:AuthContext,row:Row,displayName?:string) {
  const response=row.state.response;
  if(response.capture_id)return {capture_id:response.capture_id,source_resource_id:response.source_resource_id,message_count:response.message_count,contact:response.contact,replayed:true};
  const extraction=response.extraction!;const manifest=row.input_manifest;
  if(extraction.messages.length===0)deny("CONTACT_CHAT_HAS_NO_MESSAGES");
  if(manifest.text&&!displayName&&!row.state.selected)deny("CONTACT_TEXT_REUSE_REQUIRES_SELECTION");
  const clientResourceID=`screenshot-contact:${row.id}`;
  const documentBlocks=manifest.text&&extraction.conversation_kind==="not_chat"?contactDocumentBlocks(manifest.text):null;
  const request:ResourceCaptureRequest={contract_version:CONTRACT_VERSION,idempotency_key:clientResourceID,
    channel:(manifest.source?.url||manifest.browser_source)?"browser_extension":manifest.text||extraction.conversation_kind==="not_chat"?"web_upload":"chat",purpose:"User-authorized internal person filing from an intentional capture; extracted content remains proposed",
    captured_at:manifest.captured_at,source_timezone:"UTC",
    person_scope:displayName?{status:"new_person",display_label:displayName,relationship_context:{status:"proposed",label:extraction.conversation_kind==="not_chat"?"采集资料":"聊天记录",purpose:"User-authorized relationship context"},
      binding_basis:"Intentional screenshot import authorizes internal filing; visible name is a source label, not verified real-world identity."}
      :{status:"confirmed",person_id:response.contact!.person_id,relationship_context:{status:"existing",relationship_context_id:response.contact!.relationship_context_id},
        binding_basis:row.state.selected?"User selected this existing contact for filing.":"Unique internal contact match to visible screenshot label; content remains unreviewed source evidence."},
    resource:{client_resource_id:clientResourceID,kind:extraction.conversation_kind==="not_chat"?"document":manifest.text?"conversation_transcript":"conversation_screenshot",display_name:manifest.source?.title??`${extraction.platform} 聊天截图`,media_type:manifest.image?.media_type??"text/plain",
      observed_at:manifest.captured_at,source_timezone:"UTC",byte_size:manifest.text?Buffer.byteLength(manifest.text):[manifest.image!,...manifest.additional_images??[]].reduce((sum,image)=>sum+image.byte_size,0),content_hash:manifest.text?digest(manifest.text):manifest.additional_images?.length?digest(JSON.stringify([manifest.image,...manifest.additional_images])):manifest.image!.content_hash,
      ...(manifest.browser_source?{source_locator:manifest.browser_source.locator}:{}),
      retention:{requested_mode:"evidence_crop",source_scope:"proposed_extracted_text",requested_retention_until:row.expires_at.toISOString()}},
    fragments:extraction.messages.map(m=>({client_resource_id:clientResourceID,kind:extraction.conversation_kind==="not_chat"?"document_text":"message",sequence:m.sequence,text:m.text,
      locator:extraction.conversation_kind==="not_chat"?{kind:"document_text",paragraph:documentBlocks?.[m.sequence]?.paragraph??m.sequence+1,
        ...(documentBlocks?.[m.sequence]?{section_label:`UTF-16 [${documentBlocks[m.sequence]!.start},${documentBlocks[m.sequence]!.end})`}:{})}:{kind:"message",source_message_id:m.source_image_index===undefined?m.message_id:`image${m.source_image_index+1}:${m.message_id}`,sequence:m.sequence,speaker_side:m.speaker_side,
          ...(m.source_image_index===undefined?{}:{source_image_index:m.source_image_index}),
          ...(m.speaker_label?{speaker_label:m.speaker_label}:{}),...(m.time_text?{visible_time_text:m.time_text}:{})},
      attribution:{actor_kind:"unknown",status:"unknown"},review_status:"proposed",parser:{name:"screenshot-contact-agent",version:"1"}})),
  };
  const result=await createResourceCaptureInTransaction(client,auth,request);
  const identity=result.body.identity;
  if(!identity.person_id||!identity.relationship_context_id)deny("CONTACT_CHAT_STORAGE_SCOPE_MISSING");
  response.contact={person_id:identity.person_id,relationship_context_id:identity.relationship_context_id,
    display_name:identity.person_display_label??displayName??response.contact!.display_name,disposition:displayName?"created":"reused"};
  response.capture_id=result.body.capture_id;response.source_resource_id=result.body.resource.id;
  response.message_count=result.body.resource.fragment_count;
  return {contact:response.contact,capture_id:response.capture_id,source_resource_id:response.source_resource_id,message_count:response.message_count,raw_image_persisted:Boolean(response.source_images?.length)};
}

async function executeLocalTool(client:PoolClient,auth:AuthContext,row:Row,call:ContactAgentToolCall):Promise<unknown> {
  const response=row.state.response;const extraction=response.extraction!;
  const identity=automaticIdentityEvidence(row);
  switch(call.name){
    case "search_contacts":{
      const args=CONTACT_INTAKE_TOOLS.search_contacts.schema.parse(call.arguments);
      const strictPreprocessing=Boolean(response.preprocessing);
      const exactUserLabel=Boolean(row.state.user_contact_label&&normalized(row.state.user_contact_label)===normalized(args.query));
      const exactVisibleName=Boolean(identity.contactName&&normalized(identity.contactName)===normalized(args.query)&&
        (!strictPreprocessing||identity.clues.some(clue=>clue.kind==="name"&&normalized(clue.value)===normalized(args.query))));
      const exactProfileURL=strictPreprocessing&&identity.clues.some(clue=>clue.kind==="profile_url"&&normalized(clue.value)===normalized(args.query));
      const ordinaryClue=!strictPreprocessing&&identity.clues.some(clue=>searchableIdentityKinds.has(clue.kind)&&
        normalized(clue.value)===normalized(args.query));
      // For a preprocessing projection, a bare handle is not a typed directory
      // query: searchPeople would treat it as a display-label substring and
      // could bind @lin to Linda. Require an exact visible name or confirmed URL.
      if(!exactUserLabel&&!exactVisibleName&&!exactProfileURL&&!ordinaryClue)deny("CONTACT_SEARCH_NOT_AN_IDENTITY_CLUE");
      const found=await searchPeople(client,auth,args.query);
      const eligiblePeople=strictPreprocessing?found.people.filter(person=>exactProfileURL
        ? person.identity_matches.some(match=>match.kind==="confirmed_handle")
        : normalized(person.display_label)===normalized(args.query)):found.people;
      const candidates=eligiblePeople.flatMap(p=>p.contexts.map(c=>({person_id:p.id,display_name:p.display_label,relationship_context_id:c.id,relationship_label:c.display_label}))).slice(0,10);
      response.candidates=candidates;row.state.searches.push({query:args.query,candidates});
      return {query:args.query,candidates,unique:candidates.length===1,selected:row.state.selected};
    }
    case "read_contact":{
      const args=CONTACT_INTAKE_TOOLS.read_contact.schema.parse(call.arguments);
      const selected=row.state.selected;
      const match=selected??(row.state.searches.at(-1)?.candidates.length===1?row.state.searches.at(-1)!.candidates[0]:null);
      if(!match||match.person_id!==args.person_id||match.relationship_context_id!==args.relationship_context_id)deny("CONTACT_READ_REQUIRES_UNIQUE_SCOPE");
      if(row.input_manifest.text&&!selected){
        response.status="waiting_for_user";
        response.question="找到可能同名的联系人，请确认是否把这次来源归入该人物。";
        return {status:response.status,question:response.question,candidates:response.candidates};
      }
      const scope=await getRelationshipScope(client,auth,args.person_id,args.relationship_context_id);
      const person=await client.query<{display_label:string}>(`SELECT display_label FROM subjects WHERE account_id=$1 AND id=$2 AND status='active'`,[auth.accountId,args.person_id]);
      if(!person.rows[0])deny("CONTACT_TARGET_UNAVAILABLE");
      response.contact={...args,display_name:person.rows[0].display_label,disposition:"reused"};response.candidates=[];
      return {contact:response.contact,scope};
    }
    case "create_contact":{
      const args=CONTACT_INTAKE_TOOLS.create_contact.schema.parse(call.arguments);
      if(row.state.selected)deny("CONTACT_SELECTED_REUSE_REQUIRED");
      const filingName=row.state.user_contact_label??identity.contactName;
      if(!filingName||normalized(filingName)!==normalized(args.display_name))deny("CONTACT_CREATE_REQUIRES_VISIBLE_NAME");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${auth.accountId}:contact:${normalized(args.display_name)}`]);
      return storeChat(client,auth,row,args.display_name);
    }
    case "save_contact_chat":{
      const args=CONTACT_INTAKE_TOOLS.save_contact_chat.schema.parse(call.arguments);
      if(args.person_id!==response.contact?.person_id||args.relationship_context_id!==response.contact.relationship_context_id)deny("CONTACT_WRITE_SCOPE_MISMATCH");
      await getRelationshipScope(client,auth,args.person_id,args.relationship_context_id);
      return storeChat(client,auth,row);
    }
    case "update_contact":{
      const args=CONTACT_INTAKE_TOOLS.update_contact.schema.parse(call.arguments);
      if(!response.capture_id||args.person_id!==response.contact?.person_id)deny("CONTACT_UPDATE_REQUIRES_STORED_CHAT");
      for(const field of args.fields){
        field.source_refs=field.source_refs.map(ref=>canonicalSourceRef(row,ref));
        sourceExcerpt(row,field.source_refs,field.source_excerpt,true);
        if(field.field!=="public_profile"&&field.epistemic_status==="source_statement"&&!field.source_excerpt.includes(field.value))deny("CONTACT_SOURCE_STATEMENT_REQUIRES_LITERAL_VALUE");
        if(response.profile_fields.length>=50&&!response.profile_fields.some(f=>JSON.stringify(f)===JSON.stringify(field)))deny("CONTACT_PROFILE_FIELD_LIMIT");
        // A public name match alone does not establish that the source describes this contact.
        const publicSources=field.source_refs.map(ref=>response.public_sources.find(s=>s.source_id===ref)).filter((s):s is ContactPublicSource=>Boolean(s));
        if(field.field==="public_profile"){
          const urls=[...publicSources.map(s=>s.url),...identity.clues.filter(c=>c.kind==="profile_url").map(c=>c.value)];
          const suppliedURL=field.value.match(/https:\/\/[^\s<>]+/u)?.[0];
          const citedURL=suppliedURL?urls.find(url=>comparableProfileURL(url)!==null&&comparableProfileURL(url)===comparableProfileURL(suppliedURL)):undefined;
          if(!citedURL)deny("CONTACT_PROFILE_REQUIRES_EXACT_CITED_URL");
          field.value=citedURL;field.epistemic_status="source_statement";
        }
        for(const source of publicSources){
          const visibleProfile=identity.clues.some(c=>c.kind==="profile_url"&&normalized(c.value)===normalized(source.url));
          const corroborated=identity.contactName&&normalized(`${source.title} ${source.text}`).includes(normalized(identity.contactName))&&
            identity.clues.some(c=>["company","handle"].includes(c.kind)&&normalized(`${source.title} ${source.text} ${source.url}`).includes(normalized(c.value)));
          if(!visibleProfile&&!corroborated)deny("CONTACT_PUBLIC_IDENTITY_UNCORROBORATED");
        }
        await client.query(`INSERT INTO contact_profile_observations(id,account_id,subject_id,assignment_id,task_id,capture_id,observation_hash,observation)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(account_id,task_id,observation_hash) DO NOTHING`,
          [randomUUID(),auth.accountId,args.person_id,response.contact.relationship_context_id,row.id,response.capture_id,digest(JSON.stringify(field)),JSON.stringify(field)]);
        if(!response.profile_fields.some(f=>JSON.stringify(f)===JSON.stringify(field)))response.profile_fields.push(field);
      }
      const readback=await client.query<{observation:ContactProfileField}>(`SELECT observation FROM contact_profile_observations WHERE account_id=$1 AND task_id=$2 ORDER BY created_at,id`,[auth.accountId,row.id]);
      response.profile_fields=readback.rows.map(r=>ContactProfileFieldSchema.parse(r.observation));
      return {person_id:args.person_id,profile_fields:response.profile_fields,user_authored_profile_unchanged:true};
    }
    case "finish_contact_task":{
      const args=CONTACT_INTAKE_TOOLS.finish_contact_task.schema.parse(call.arguments);
      if(/\\[nr]/u.test(args.summary))deny("CONTACT_SUMMARY_ESCAPED_TEXT");
      if(!response.contact||!response.capture_id||!response.message_count)deny("CONTACT_FINISH_REQUIRES_STORAGE_READBACK");
      for(const finding of args.findings){
        sourceExcerpt(row,finding.message_refs,finding.source_excerpt,false);
        if(finding.epistemic_status==="source_statement"&&finding.text!==finding.source_excerpt)finding.epistemic_status="inference";
      }
      response.summary=args.summary;response.findings=args.findings;
      response.limitations=[...new Set([...response.limitations,...args.limitations])].slice(0,20);
      const latestToolStatus=new Map(response.events.map(event=>[event.tool,event.status]));
      // A corrected retry resolves the prior failed call; historical failures remain in the trace.
      latestToolStatus.set("finish_contact_task","completed");
      response.status=[...latestToolStatus.values()].some(status=>status==="failed")?"partial":"completed";
      response.question=null;response.candidates=[];
      return {status:response.status,contact:response.contact,capture_id:response.capture_id};
    }
    case "ask_contact_clarification":{
      const args=CONTACT_INTAKE_TOOLS.ask_contact_clarification.schema.parse(call.arguments);
      if(/\\[nr]/u.test(args.question))deny("CONTACT_QUESTION_ESCAPED_TEXT");
      response.question=args.question;response.status="waiting_for_user";return {status:response.status,question:args.question,candidates:response.candidates};
    }
    default:deny("CONTACT_TOOL_NOT_AUTHORIZED");
  }
}

export class ScreenshotContactTaskRunner {
  private readonly active=new Map<string,Promise<void>>();
  private readonly controllers=new Map<string,AbortController>();
  constructor(private readonly pool:Pool,private readonly dependencies:ScreenshotContactDependencies,private readonly storage?:ChatMediaStorage){}
  start(auth:AuthContext,id:string,image?:ScreenshotContactTaskRequest["image"]):Promise<void> {
    const key=`${auth.accountId}:${id}`;const existing=this.active.get(key);if(existing)return existing;
    const controller=new AbortController();this.controllers.set(key,controller);
    const operation=this.observedRun(auth,id,image,controller.signal).finally(()=>{this.active.delete(key);this.controllers.delete(key);});this.active.set(key,operation);return operation;
  }
  fenceSourceDeletion(auth:AuthContext,id:string):void{
    this.fenceTaskCancellation(auth,id,"CONTACT_SOURCE_DELETION_PENDING");
  }
  fenceTaskCancellation(auth:AuthContext,id:string,reason="CONTACT_TASK_CANCELLED"):void{
    this.controllers.get(`${auth.accountId}:${id}`)?.abort(new Error(reason));
  }
  private async observedRun(auth:AuthContext,id:string,image:ScreenshotContactTaskRequest["image"]|undefined,signal:AbortSignal) {
    const result=await this.pool.query<{id:string;source_generation:string|null}>("SELECT id,source_generation FROM product_runs WHERE account_id=$1 AND user_id=$2 AND task_id=$3 AND task_kind='screenshot' ORDER BY created_at LIMIT 1",[auth.accountId,auth.userId,id]);
    const runID=result.rows[0]?.id;
    if(!runID) {
      // Background work never inherits a response-lifetime request sink: without
      // a canonical admitted run there is nothing an early HTTP flush could
      // honestly promote, and the admitted run binds before this work starts.
      return withProductRunCapture({async append(){}},()=>this.run(auth,id,image,signal));
    }
    const sink=productRunSink(this.pool,runID,reportScreenshotSpanPersistenceFailure,result.rows[0]?.source_generation);
    try { await withProductRunCapture(sink,()=>this.run(auth,id,image,signal)); } finally { await sink.flush(); }
  }
  async drain(){await Promise.allSettled(this.active.values());}
  async close(){for(const controller of this.controllers.values())controller.abort(new Error("CONTACT_AGENT_SERVER_STOPPED"));await this.drain();}
  private async checkpoint<T>(auth:AuthContext,id:string,epoch:number,operation:(client:PoolClient,row:Row)=>Promise<T>,personIDs:string[]=[]):Promise<T>{
    return inTransaction(this.pool,async client=>{
      for(const personID of [...new Set(personIDs)].sort())await lockContactTaskPerson(client,auth.accountId,personID);
      const row=await rowFor(client,auth,id,true);
      if(row.lease_epoch!==epoch||row.status!=="running")deny("CONTACT_TASK_LEASE_LOST");
      await assertSourceCurrent(client,row);const result=await operation(client,row);await save(client,row);return result;
    });
  }
  private async preprocess(auth:AuthContext,id:string,epoch:number,image:ScreenshotContactTaskRequest["image"]|undefined,signal:AbortSignal):Promise<void>{
    let row=await rowFor(this.pool,auth,id);
    if(!row.state.preprocessing_required||row.state.response.preprocessing)return;
    const preprocessor=this.dependencies.preprocessor;
    if(!preprocessor)deny("SCREENSHOT_PREPROCESSOR_NOT_CONFIGURED");
    assertScreenshotPreprocessAgreement({provider:preprocessor.provider,model:preprocessor.model,
      contractVersion:SCREENSHOT_PREPROCESS_CONTRACT,schemaVersion:SCREENSHOT_PREPROCESS_SCHEMA_VERSION,
      promptVersion:SCREENSHOT_PREPROCESS_PROMPT_VERSION});
    const manifests=row.input_manifest.image?[row.input_manifest.image,...row.input_manifest.additional_images??[]]:[];
    if(!manifests.length)deny("SCREENSHOT_PREPROCESS_SOURCE_REQUIRED");
    for(let index=0;index<manifests.length;index++){
      row=await rowFor(this.pool,auth,id);
      if(row.state.preprocessing_parts?.some(part=>part.source.source_image_index===index))continue;
      // A process loss after dispatch has an unknown provider receipt. Do not
      // silently repeat a possibly billed request; a fresh user intent is required.
      if(row.state.preprocessing_inflight!==undefined)deny("SCREENSHOT_PREPROCESS_RESPONSE_UNKNOWN");
      await assertSourceCurrent(this.pool,row);
      const stored=this.storage?await readContactImage(this.pool,auth,id,index,this.storage):null;
      const current=stored??(index===0?image:undefined);
      if(!current)deny("CONTACT_ORIGINAL_IMAGE_REQUIRED");
      validateContactImage(current);
      if(current.content_hash!==manifests[index]!.content_hash)deny("CONTACT_IMAGE_INTEGRITY_MISMATCH");
      await this.checkpoint(auth,id,epoch,async(_,latest)=>{latest.state.preprocessing_inflight=index;});
      const output=await preprocessor.preprocess(current,index,signal,async()=>{
        signal.throwIfAborted();
        // Hold the task row while source/directory authority is checked. A
        // concurrent Stop/archive then commits only after this check and its
        // route aborts the same controller before the request can continue.
        await inTransaction(this.pool,async client=>{
          const authorized=await rowFor(client,auth,id,true);
          if(authorized.lease_epoch!==epoch||authorized.status!=="running")deny("CONTACT_TASK_LEASE_LOST");
          await assertSourceCurrent(client,authorized);
          signal.throwIfAborted();
        });
        signal.throwIfAborted();
      });
      if(output.source.source_image_index!==index||output.source.source_hash!==current.content_hash||output.model!==preprocessor.model)
        deny("SCREENSHOT_PREPROCESS_RECEIPT_MISMATCH");
      const committedRegionCount=(row.state.preprocessing_parts??[]).reduce(
        (count,part)=>count+part.source.follow_up_regions.length,0);
      const alreadyAbstained=row.state.preprocessing_follow_up_abstained===true;
      const overRegionBudget=alreadyAbstained||committedRegionCount+output.source.follow_up_regions.length>
        SCREENSHOT_PREPROCESS_FOLLOW_UP_REGION_LIMIT;
      await this.checkpoint(auth,id,epoch,async(_,latest)=>{
        latest.state.preprocessing_parts??=[];
        // The provider call already happened. If its region proposals would
        // exceed the packet-wide budget, checkpoint the useful baseline and
        // receipt but remove those extra original-pixel permissions. Its
        // uncertainties then remain human-review-only, so Resume cannot
        // repeat the same deterministic, billed preprocessing request.
        const committed=overRegionBudget?{...output,source:{...output.source,
          follow_up_required:false,follow_up_regions:[]}}:output;
        if(overRegionBudget){
          latest.state.preprocessing_follow_up_abstained=true;
          latest.state.preprocessing_parts=latest.state.preprocessing_parts.map(part=>({...part,source:{...part.source,
            follow_up_required:false,follow_up_regions:[]}}));
        }
        if(!latest.state.preprocessing_parts.some(part=>part.source.source_image_index===index))latest.state.preprocessing_parts.push(committed);
        delete latest.state.preprocessing_inflight;
        latest.state.tokens+=output.input_tokens+output.output_tokens;
        latest.state.model_receipts.push({model:output.model,request_id:output.request_id,input_tokens:output.input_tokens,output_tokens:output.output_tokens,
          provider:preprocessor.provider,source_image_index:index,...arkUsageReceipt(output)});
        latest.state.response.events.push({sequence:latest.state.response.events.length+1,tool:"preprocess_screenshot",status:"completed",occurred_at:new Date().toISOString()});
        if(overRegionBudget&&!alreadyAbstained){
          latest.state.response.limitations.push("SCREENSHOT_PREPROCESS_FOLLOW_UP_BUDGET");
          latest.state.response.events.push({sequence:latest.state.response.events.length+1,
            tool:"authorize_screenshot_follow_up_regions",status:"denied",occurred_at:new Date().toISOString()});
        }
      });
    }
    await this.checkpoint(auth,id,epoch,async(client,latest)=>{
      const parts=[...(latest.state.preprocessing_parts??[])].sort((a,b)=>a.source.source_image_index-b.source.source_image_index);
      if(parts.length!==manifests.length||parts.some((part,index)=>part.source.source_image_index!==index))deny("SCREENSHOT_PREPROCESS_CHECKPOINT_INCOMPLETE");
      const packet=ScreenshotPreprocessPacketSchema.parse({
        contract_version:SCREENSHOT_PREPROCESS_CONTRACT,
        schema_version:SCREENSHOT_PREPROCESS_SCHEMA_VERSION,
        prompt_version:SCREENSHOT_PREPROCESS_PROMPT_VERSION,
        provider:"volcano_ark",
        model:ARK_SCREENSHOT_PREPROCESS_MODEL,
        request_receipts:parts.map(part=>({source_image_index:part.source.source_image_index,request_id:part.request_id,
          input_tokens:part.input_tokens,output_tokens:part.output_tokens})),
        usage:{input_tokens:parts.reduce((sum,part)=>sum+part.input_tokens,0),output_tokens:parts.reduce((sum,part)=>sum+part.output_tokens,0)},
        sources:parts.map(part=>part.source),
      });
      latest.state.response.preprocessing=packet;
      const extractions=parts.map(part=>extractionFromPreprocess(part.source));
      latest.state.extraction_parts=extractions;
      if(preprocessNeedsOriginalMultimodalRead(packet)){
        const merged=extractions.length===1?{extraction:extractions[0]!}:mergeContactExtractions(extractions);
        latest.state.response.extraction=merged.extraction;
        latest.state.response.status="running";
        latest.state.response.question=null;
        return;
      }
      await summarizeExtractionParts(client,auth,latest);
    });
  }
  private async run(auth:AuthContext,id:string,image?:ScreenshotContactTaskRequest["image"],shutdown?:AbortSignal):Promise<void>{
    const claimed=await this.pool.query<{lease_epoch:number}>(`UPDATE screenshot_contact_tasks SET lease_epoch=lease_epoch+1,lease_until=now()+interval '90 seconds'
      WHERE account_id=$1 AND id=$2 AND created_by_user_id=$3 AND status='running' AND expires_at>now()
      AND (lease_until IS NULL OR lease_until<now()) RETURNING lease_epoch`,[auth.accountId,id,auth.userId]);
    if(!claimed.rows[0])return;const epoch=claimed.rows[0].lease_epoch;
    const signal=AbortSignal.any([AbortSignal.timeout(300_000),...(shutdown?[shutdown]:[])]);
    // The authenticated cancellation transaction owns its terminal write. Its
    // early dispatch fence must not race runner failure bookkeeping into a new
    // revision. Timeouts and server shutdown still use the recovery path.
    const ownerCancellationFenced=()=>shutdown?.aborted===true&&contactTaskDiagnosticCode(shutdown.reason)==="CONTACT_TASK_CANCELLED";
    try{
      let row=await rowFor(this.pool,auth,id);
      if(!row.state.prompts){
        const [transcription,contact]=await Promise.all([resolveProductPrompt(row.input_manifest.text?"capture/text-transcription":"capture/transcription"),resolveProductPrompt("capture/contact")]);
        await this.checkpoint(auth,id,epoch,async(_,r)=>{r.state.prompts??={transcription,contact};});
        row=await rowFor(this.pool,auth,id);
      }
      await this.preprocess(auth,id,epoch,image,signal);
      row=await rowFor(this.pool,auth,id);
      if(row.status!=="running")return;
      const refinementIndices=pendingPreprocessRefinementIndices(row);
      if(row.state.response.preprocessing&&!refinementIndices.length&&
        (row.state.preprocessing_refinement_unresolved||hasHumanOnlyPreprocessUncertainty(row))){
        await this.checkpoint(auth,id,epoch,async(client,latest)=>{await summarizeExtractionParts(client,auth,latest);});
        return;
      }
      if(row.input_manifest.preprocess_only&&!pendingPreprocessRefinementIndices(row).length){
        await this.checkpoint(auth,id,epoch,async(_,latest)=>{
          if(latest.state.response.status==="running"){
            latest.state.response.status="completed";latest.state.response.question=null;
          }
          latest.state.response.summary=latest.state.response.status==="waiting_for_user"
            ? "截图已完成共享预处理，但仍有具体字段无法可靠确认；未执行联系人或证据写入。"
            : "截图已完成共享预处理；结构化结果仍需用户核对，未执行联系人或证据写入。";
        });
        return;
      }
      if (this.dependencies.model.run) {
        await this.runSDK(auth, id, epoch, row, image, signal);
        return;
      }
      if(refinementIndices.length){
        // The plain Chat Completions vision adapter cannot enforce native
        // region receipts or field patches. Keep the Ark baseline intact and
        // abstain instead of re-sending a full original and accepting a full
        // model replacement. Claude SDK mode above owns bounded follow-up.
        await this.checkpoint(auth,id,epoch,async(_,latest)=>{
          latest.state.preprocessing_refinement_unresolved=true;
          latest.state.preprocessing_refinement_abstained_indices=[...new Set([
            ...(latest.state.preprocessing_refinement_abstained_indices??[]),...refinementIndices,
          ])].sort((a,b)=>a-b);
          latest.state.response.status="waiting_for_user";
          latest.state.response.question="共享预处理标记了需要核对的原图字段；当前处理器不支持受限区域回执。请在原图中核对，或重新发送更清晰的截图。";
          latest.state.response.summary=latest.input_manifest.preprocess_only
            ? "截图已完成共享预处理，但仍有具体字段需要人工核对；未执行联系人或证据写入。"
            : "截图预处理已保留，受限原图补读未执行；等待人工核对。";
          this.observe(latest,"refine_screenshot_preprocessing",{
            image_indices:refinementIndices,reason:"BOUNDED_REGION_RECEIPTS_UNAVAILABLE",
          },"denied");
        });
        return;
      }
      if(!row.state.response.extraction){
        if(row.input_manifest.text){
          if(!this.dependencies.model.extractText)deny("CONTACT_TEXT_PROCESSOR_UNAVAILABLE");
          const output=await this.dependencies.model.extractText(row.input_manifest.text,signal,row.state.prompts!.transcription.text);
          await this.checkpoint(auth,id,epoch,async(_,r)=>{
            r.state.extraction_parts=[output.extraction];
            r.state.tokens+=output.inputTokens+output.outputTokens;
            r.state.model_receipts.push({model:output.model,request_id:output.providerRequestID,input_tokens:output.inputTokens,output_tokens:output.outputTokens});
            r.state.response.events.push({sequence:r.state.response.events.length+1,tool:"extract_web_text",status:"completed",occurred_at:new Date().toISOString()});
          });
        }
        const manifests=row.input_manifest.image?[row.input_manifest.image,...row.input_manifest.additional_images??[]]:[];
        for(let index=row.state.extraction_parts?.length??0;index<manifests.length;index++) {
          await assertSourceCurrent(this.pool,await rowFor(this.pool,auth,id));
          const source=this.storage?await readContactImage(this.pool,auth,id,index,this.storage):null;
          const current=source??(index===0?image:undefined);
          if(!current){await this.checkpoint(auth,id,epoch,async(_,r)=>{r.state.response.status="waiting_for_user";r.state.response.question=r.state.response.source_images?.length?"图片尚未全部保存，请重试原来的发送。":"识别尚未完成，请重新附上原截图继续。";});return;}
          validateContactImage(current);
          if(current.content_hash!==manifests[index]!.content_hash)deny("CONTACT_IMAGE_INTEGRITY_MISMATCH");
          // Refresh the lease for each bounded image read, and checkpoint each result.
          await this.checkpoint(auth,id,epoch,async()=>{});
          const output=await this.dependencies.model.extract(current,signal,row.state.prompts!.transcription.text);
          await this.checkpoint(auth,id,epoch,async(_,r)=>{
            r.state.extraction_parts??=[];r.state.extraction_parts.push(output.extraction);
            r.state.tokens+=output.inputTokens+output.outputTokens;
            r.state.model_receipts.push({model:output.model,request_id:output.providerRequestID,input_tokens:output.inputTokens,output_tokens:output.outputTokens});
            r.state.response.events.push({sequence:r.state.response.events.length+1,tool:"extract_chat_screenshot",status:"completed",occurred_at:new Date().toISOString()});
          });
        }
        await this.checkpoint(auth,id,epoch,async(_,r)=>{
          const parts=r.state.extraction_parts!;
          const merged=parts.length===1?{extraction:parts[0]!,question:null,identityConflict:false}:mergeContactExtractions(parts);
          r.state.response.extraction=merged.extraction;
          if(merged.extraction && !merged.extraction.contact_name && !merged.extraction.identity_clues.length && !merged.extraction.messages.length){
            r.state.response.status="completed";r.state.response.summary="未发现可归档的人物。来源已保存，可检查原文或删除本次采集。";
          } else if(merged.question){r.state.response.status="waiting_for_user";r.state.response.question=merged.question;r.state.batch_conflict=merged.identityConflict;}
        });
      }
      // Unknown public-read responses are visible; do not silently repeat billed requests after recovery.
      await this.checkpoint(auth,id,epoch,async(_,r)=>{if(r.state.pending_research){r.state.observations.push({tool:r.state.pending_research,result:{error:"CONTACT_RESEARCH_RESPONSE_UNKNOWN"}});r.state.pending_research=null;}}).catch(error=>{if(contactTaskDiagnosticCode(error)!=="CONTACT_TASK_LEASE_LOST")throw error;});
      while(!signal.aborted){
        row=await rowFor(this.pool,auth,id);if(row.status!=="running")return;
        if(row.state.turns>=18||row.state.tokens>=80_000)deny("CONTACT_TASK_BUDGET_EXHAUSTED");
        const tools=toolsFor(row);
        const reply=await this.dependencies.model.next({objective:row.input_manifest.objective,extraction:row.state.response.extraction!,
          systemPrompt:row.state.prompts!.contact.text,
          state:{contact:row.state.response.contact,capture_id:row.state.response.capture_id,selected:row.state.selected,
            searched_queries:row.state.searches.map(s=>({query:s.query,match_count:s.candidates.length})),
            user_selected_contact_name:row.state.user_contact_label??null,
            screenshot_identity_clues:row.state.response.extraction!.identity_clues.map((clue,index)=>({source_ref:`clue${index+1}`,...clue})),
            public_sources:row.state.response.public_sources.map((source,index)=>({...source,source_ref:`public${index+1}`,text:source.text.slice(0,8_000)})).slice(-5),
            profile_fields:row.state.response.profile_fields,remaining_turns:18-row.state.turns},observations:row.state.observations.slice(-12).map(observation=>{
              if(observation.tool!=="search_contact_public"&&observation.tool!=="fetch_contact_source"&&observation.tool!=="browse_contact_source")return observation;
              const result=observation.result as {sources?:ContactPublicSource[];channels?:ContactResearchToolResponse["channels"];fetch_outcomes?:ContactResearchToolResponse["fetch_outcomes"]};
              return result.sources?{tool:observation.tool,result:{
                sources:result.sources.map(source=>({source_id:source.source_id,title:source.title,url:source.url,stage:source.stage})),
                ...(result.channels?{channels:result.channels.map(outcome=>({channel:outcome.channel,provider:outcome.provider,
                  status:outcome.status,result_count:outcome.result_count,truncated:outcome.truncated,error_code:outcome.error_code}))}:{}),
                ...(result.fetch_outcomes?{fetch_outcomes:result.fetch_outcomes.map(outcome=>({source_id:outcome.source_id,channel:outcome.channel,
                  provider:outcome.provider,status:outcome.status,error_code:outcome.error_code}))}:{}),
              }}:observation;
            }),tools,
          remainingTokens:Math.min(4000,80_000-row.state.tokens)},signal);
        await this.checkpoint(auth,id,epoch,async(_,r)=>{r.state.turns++;r.state.tokens+=reply.inputTokens+reply.outputTokens;
          r.state.model_receipts.push({model:reply.model,request_id:reply.providerRequestID,input_tokens:reply.inputTokens,output_tokens:reply.outputTokens});});
        const call=reply.calls[0];if(reply.calls.length!==1||!call)deny("CONTACT_AGENT_EXPECTED_ONE_TOOL_CALL");
        try{
          if(!tools.includes(call.name as ContactIntakeToolName))deny("CONTACT_TOOL_NOT_AUTHORIZED");
          if(call.name==="search_contact_public"||call.name==="fetch_contact_source"||call.name==="browse_contact_source")await captureProductStep(call.name,"tool",call.arguments,()=>this.research(auth,id,epoch,call,signal));
          else await this.checkpoint(auth,id,epoch,async(client,r)=>{
            const result=await captureProductStep(call.name,"tool",call.arguments,()=>executeLocalTool(client,auth,r,call));this.observe(r,call.name,result,"completed");
            await appendAudit(client,{accountId:auth.accountId,actorUserId:auth.userId},"contact_task.tool_completed","screenshot_contact_task",id,
              {tool:call.name,model:reply.model,provider_request_id:reply.providerRequestID,turn:r.state.turns});
          },personAuthoritiesForCall(call));
        }catch(error){
          if(ownerCancellationFenced()||contactTaskDiagnosticCode(error)==="CONTACT_TASK_LEASE_LOST")return;
          await this.checkpoint(auth,id,epoch,async(_,r)=>{this.observe(r,call.name,{error:contactTaskDiagnosticCode(error)},error instanceof ApiError?"denied":"failed");r.state.pending_research=null;});
        }
      }
      deny("CONTACT_TASK_TIMEOUT");
    }catch(error){
      if(ownerCancellationFenced()||contactTaskDiagnosticCode(error)==="CONTACT_TASK_LEASE_LOST")return;
      await this.checkpoint(auth,id,epoch,async(_,r)=>{
        r.state.response.status=r.state.response.capture_id?"partial":"failed";
        r.state.response.limitations.push(contactTaskDiagnosticCode(error));
        r.state.response.summary=r.state.response.capture_id?"聊天记录已保存，后续分析尚未完成。":"任务尚未完成，可重试继续。";
      }).catch(()=>{});
    }
  }
  private observe(row:Row,tool:string,result:unknown,status:"completed"|"failed"|"denied"){
    row.state.observations.push({tool,result});row.state.observations=row.state.observations.slice(-15);
    row.state.response.events.push({sequence:row.state.response.events.length+1,tool,status,occurred_at:new Date().toISOString()});
  }
  private async runSDK(auth:AuthContext,id:string,epoch:number,row:Row,image:ScreenshotContactTaskRequest["image"]|undefined,parentSignal:AbortSignal){
    const controller=new AbortController();
    const signal=AbortSignal.any([parentSignal,controller.signal]);
    // Product state remains durable and serialized; the SDK owns only planning.
    let pending:Promise<unknown>=Promise.resolve();
    const serial=<T>(operation:()=>Promise<T>):Promise<T>=>{
      const next=pending.then(()=>{signal.throwIfAborted();return operation();});
      pending=next.catch(()=>{});return next;
    };
    const current=async()=>{
      signal.throwIfAborted();
      const latest=await rowFor(this.pool,auth,id);
      if(latest.lease_epoch!==epoch||!["running","completed","waiting_for_user"].includes(latest.status))deny("CONTACT_TASK_LEASE_LOST");
      await assertSourceCurrent(this.pool,latest);signal.throwIfAborted();
    };
    let renewal:Promise<void>|null=null;
    const heartbeat=setInterval(()=>{
      if(renewal)return;
      // Renewal must not queue behind a slow external read on the tool lane.
      renewal=(async()=>{
        await current();
        await this.pool.query(`UPDATE screenshot_contact_tasks SET lease_until=now()+interval '90 seconds'
          WHERE account_id=$1 AND id=$2 AND created_by_user_id=$3 AND lease_epoch=$4
            AND status='running' AND expires_at>now()`,[auth.accountId,id,auth.userId,epoch]);
      })().catch(()=>controller.abort(new Error("CONTACT_TASK_LEASE_LOST"))).finally(()=>{renewal=null;});
    },20_000);
    try{
      const allManifests=row.input_manifest.image?[row.input_manifest.image,...row.input_manifest.additional_images??[]]:[];
      const imageSourceIndices=row.state.response.preprocessing
        ? pendingPreprocessRefinementIndices(row)
        : allManifests.map((_,index)=>index);
      const images:ScreenshotContactTaskRequest["image"][]=[];
      for(const index of imageSourceIndices){
        await current();
        const source=this.storage?await readContactImage(this.pool,auth,id,index,this.storage):null;
        const original=source??(index===0?image:undefined);
        if(!original)throw new Error("CONTACT_ORIGINAL_IMAGE_REQUIRED");
        validateContactImage(original);
        if(original.content_hash!==allManifests[index]!.content_hash)deny("CONTACT_IMAGE_INTEGRITY_MISMATCH");
        images.push(original);
      }
      await this.checkpoint(auth,id,epoch,async(_,r)=>{
        if(r.state.pending_research){r.state.observations.push({tool:r.state.pending_research,result:{error:"CONTACT_RESEARCH_RESPONSE_UNKNOWN"}});r.state.pending_research=null;}
      });
      const result=await this.dependencies.model.run!({
        objective:row.input_manifest.objective,images,imageSourceIndices,...(row.input_manifest.text?{text:row.input_manifest.text}:{}),
        ...(row.state.response.preprocessing?{preprocessing:row.state.response.preprocessing}:{}),systemPrompt:row.state.prompts!.contact.text,
        state:{response:row.state.response,selected:row.state.selected,current_state:currentToolState(row),observations:row.state.observations.slice(-12)},
        assertCurrent:current,
        readImage:(operation,executionSignal)=>serial(async()=>{
          await this.checkpoint(auth,id,epoch,async()=>{executionSignal.throwIfAborted();});
          const result=await operation();
          await this.checkpoint(auth,id,epoch,async()=>{executionSignal.throwIfAborted();});
          return result;
        }),
        recordUnderstanding:(raw,executionSignal)=>serial(()=>this.checkpoint(auth,id,epoch,async(client,r)=>{
          executionSignal.throwIfAborted();
          if(r.state.response.capture_id||r.state.searches.length)deny("CONTACT_UNDERSTANDING_ALREADY_USED");
          if(raw.length!==(row.input_manifest.text?1:images.length))deny("CONTACT_IMAGE_REFERENCE_INVALID");
          const parts=raw.map(part=>ContactChatExtractionSchema.parse(part));
          if(r.input_manifest.text)parts.forEach(part=>groundContactTextExtraction(r.input_manifest.text!,part));
          if(r.state.response.preprocessing){
            const mergedParts=[...(r.state.extraction_parts??[])];
            parts.forEach((part,slot)=>{const sourceIndex=imageSourceIndices[slot];if(sourceIndex===undefined)deny("CONTACT_IMAGE_REFERENCE_INVALID");mergedParts[sourceIndex]=normalizeRefinedExtraction(part,sourceIndex);});
            r.state.extraction_parts=mergedParts;
            const unresolvedIndices=imageSourceIndices.filter((sourceIndex,slot)=>
              Boolean(parts[slot]&&boundedRefinementStillUnresolved(r,sourceIndex,parts[slot]!)));
            const unresolved=new Set(unresolvedIndices);
            r.state.preprocessing_refinement_unresolved=parts.some(part=>part.uncertainties.length>0);
            r.state.preprocessing_refined_indices=[...new Set([
              ...(r.state.preprocessing_refined_indices??[]).filter(index=>!unresolved.has(index)),
              ...imageSourceIndices.filter(index=>!unresolved.has(index)),
            ])].sort((a,b)=>a-b);
            await summarizeExtractionParts(client,auth,r);
            if(r.input_manifest.preprocess_only){
              if(r.state.response.status==="running"){
                r.state.response.status="completed";r.state.response.question=null;
              }
              r.state.response.summary=r.state.response.status==="waiting_for_user"
                ? "截图已完成共享预处理和限定补读，但仍有具体字段无法可靠确认；未执行联系人或证据写入。"
                : "截图已完成共享预处理和限定补读；结构化结果仍需用户核对，未执行联系人或证据写入。";
            }
            this.observe(r,"refine_screenshot_preprocessing",{status:r.state.response.status,image_indices:imageSourceIndices},"completed");
            return {status:r.state.response.status,extraction:r.state.response.extraction,question:r.state.response.question,current_state:currentToolState(r)};
          }
          if(parts.every(part=>!part.contact_name&&!part.identity_clues.length&&!part.messages.length)){r.state.response.extraction=parts[0]!;r.state.response.status="completed";r.state.response.summary="未发现可归档的人物。来源已保存，可检查原文或删除本次采集。";return {status:"completed",contact:null};}
          const profile=r.input_manifest.text?null:profileUnderstanding(parts);
          if(profile){
            r.state.extraction_parts=parts;r.state.response.extraction=profile.extraction;r.state.response.contact_draft=profile.draft;
            r.state.response.status="waiting_for_user";r.state.response.question="请核对联系人资料，修改后保存。";
            if(r.state.selected){
              const scope=await getRelationshipScope(client,auth,r.state.selected.person_id,r.state.selected.relationship_context_id);
              r.state.response.candidates=[{...r.state.selected,display_name:scope.person.display_label,relationship_label:scope.relationship_context.display_label}];
            }
            this.observe(r,"record_screenshot_understanding",{status:"draft_requires_human_review",image_count:images.length},"completed");
            return {status:r.state.response.status,contact_draft:profile.draft,question:r.state.response.question};
          }
          const merged=r.input_manifest.text&&parts.length===1?{extraction:parts[0]!,question:null as string|null,identityConflict:false}:mergeContactExtractions(parts);
          if(!r.input_manifest.text&&parts.every(part=>["profile","not_chat"].includes(part.conversation_kind)))merged.question="无法把这些资料截图核对为同一平台的同一联系人，请按联系人和平台分别发送。";
          r.state.extraction_parts=parts;r.state.response.extraction=merged.extraction;
          if(merged.question){r.state.response.status="waiting_for_user";r.state.response.question=merged.question;r.state.batch_conflict=merged.identityConflict;}
          this.observe(r,"record_screenshot_understanding",{status:"unconfirmed",image_count:images.length},"completed");
          return {status:r.state.response.status,extraction:merged.extraction,question:merged.question,current_state:currentToolState(r)};
        })),
        invoke:(name,args,executionSignal)=>serial(async()=>{
          executionSignal.throwIfAborted();
          const call:ContactAgentToolCall={id:randomUUID(),name,arguments:args};
          try{
            await this.checkpoint(auth,id,epoch,async(_,r)=>{
              executionSignal.throwIfAborted();
              if(!r.state.response.extraction&&name!=="ask_contact_clarification")deny("CONTACT_UNDERSTANDING_REQUIRED");
              if(!toolsFor(r).includes(name))deny("CONTACT_TOOL_NOT_AUTHORIZED");
              if(r.state.turns>=24)deny("CONTACT_TASK_BUDGET_EXHAUSTED");
              r.state.turns++;
            });
            if(name==="search_contact_public"||name==="fetch_contact_source"||name==="browse_contact_source"){
              await this.research(auth,id,epoch,call,AbortSignal.any([signal,executionSignal]));
              return (await rowFor(this.pool,auth,id)).state.observations.at(-1)?.result;
            }
            return await this.checkpoint(auth,id,epoch,async(client,r)=>{
              signal.throwIfAborted();
              executionSignal.throwIfAborted();
              if(!toolsFor(r).includes(name))deny("CONTACT_TOOL_NOT_AUTHORIZED");
              const value=await executeLocalTool(client,auth,r,call);
              this.observe(r,name,value,"completed");return {...value as Record<string,unknown>,current_state:currentToolState(r)};
            },personAuthoritiesForCall(call));
          }catch(error){
            if(signal.aborted||executionSignal.aborted||contactTaskDiagnosticCode(error)==="CONTACT_TASK_LEASE_LOST")throw error;
            const state=await this.checkpoint(auth,id,epoch,async(_,r)=>{this.observe(r,name,{error:contactTaskDiagnosticCode(error)},"denied");return currentToolState(r);});
            return {error:contactTaskDiagnosticCode(error),current_state:state,instruction:contactTaskDiagnosticCode(error)==="CONTACT_QUESTION_ESCAPED_TEXT"
              ? "Write one concise identity/source question using ordinary prose and actual line breaks, never literal backslash-n/backslash-r text. Previously completed work is unchanged; retry only ask_contact_clarification."
              : contactTaskDiagnosticCode(error)==="CONTACT_SUMMARY_ESCAPED_TEXT"
              ? "Write ordinary prose with actual line breaks, not literal backslash-n/backslash-r escape text. Retry only the rejected finish call."
              : contactTaskDiagnosticCode(error)==="CONTACT_SOURCE_STATEMENT_REQUIRES_LITERAL_VALUE"
              ? "A source_statement field value must copy a contiguous part of its exact cited excerpt. Keep only the supported source wording, or explicitly label a justified, qualified interpretation as inference. Discussing a topic does not prove work experience; separated dated roles do not establish a direct job transfer. Correct this update only; prior filing remains complete."
              : contactTaskDiagnosticCode(error)==="CONTACT_CITATION_EXCERPT_MISMATCH"
              ? "Copy one contiguous exact excerpt from ONE cited source; never concatenate, translate, or insert ellipses. finish_contact_task findings can cite only original chat messages. Public claims belong in update_contact fields with their fetched page references. Correct the rejected call; completed filing must not be repeated."
              : "Choose from current allowed tools and use exact source tokens. Completed filing must not be repeated; no success is implied for this failed call."};
          }
        }),
      },signal);
      await current();
      await inTransaction(this.pool,async client=>{
        const latest=await rowFor(client,auth,id,true);
        if(latest.lease_epoch!==epoch)deny("CONTACT_TASK_LEASE_LOST");
        await assertSourceCurrent(client,latest);signal.throwIfAborted();
        latest.state.tokens+=result.inputTokens+result.outputTokens;
        latest.state.model_receipts.push({model:result.model,request_id:result.providerRequestID,input_tokens:result.inputTokens,output_tokens:result.outputTokens});
        if(latest.status==="running"){
          latest.state.response.status=latest.state.response.capture_id?"partial":"failed";
          latest.state.response.limitations.push("CONTACT_SDK_TERMINAL_RECEIPT_MISSING");
        }
        await save(client,latest);
      });
    }catch(error){controller.abort(error);throw error;}
    finally{clearInterval(heartbeat);await renewal;await pending;}
  }
  private async research(auth:AuthContext,id:string,epoch:number,call:ContactAgentToolCall,signal:AbortSignal){
    if(!this.dependencies.research)deny("CONTACT_RESEARCH_NOT_CONFIGURED");
    const input=await this.checkpoint(auth,id,epoch,async(_,row)=>{
      if(!row.state.response.capture_id||!row.input_manifest.allow_public_research)deny("CONTACT_RESEARCH_NOT_AUTHORIZED");
      const identity=automaticIdentityEvidence(row);
      const anchors=[identity.contactName,...identity.clues.filter(c=>["name","handle","company"].includes(c.kind)).map(c=>c.value)].filter((v):v is string=>Boolean(v)).slice(0,5);
      let operation;
      if(call.name==="search_contact_public"){
        const args=CONTACT_INTAKE_TOOLS.search_contact_public.schema.parse(call.arguments);
        // A query is assembled solely from visible public identity tokens; no IM sentences leave this boundary.
        const permitted=[...anchors,...identity.clues.filter(c=>c.kind==="job_title").map(c=>c.value),
          "linkedin","LinkedIn","web","小红书","xiaohongshu","Reddit","reddit","抖音","微博",
          "douyin","tiktok","threads","weibo","Instagram","instagram"];
        let remaining=normalized(args.query);
        for(const token of permitted.sort((a,b)=>b.length-a.length))remaining=remaining.replaceAll(normalized(token),"");
        if(remaining.replace(/[\s,，、@|]+/gu,"").length)deny("CONTACT_PUBLIC_QUERY_NOT_IDENTITY_ONLY");
        operation={operation:"search" as const,channels:args.channels,query:args.query,
          maximum_results_per_channel:args.results_per_channel};
      }else if(call.name==="fetch_contact_source"){
        const args=CONTACT_INTAKE_TOOLS.fetch_contact_source.schema.parse(call.arguments);
        // Resolve every short reference to its original durable source before dispatch.
        const resolved=args.source_ids.map(ref=>{
          const source=row.state.response.public_sources.find(s=>s.source_id===canonicalSourceRef(row,ref));
          if(!source)deny("CONTACT_SOURCE_NOT_DISCOVERED");
          return source;
        });
        if(new Set(resolved.map(source=>source.source_id)).size!==resolved.length)deny("CONTACT_FETCH_SOURCE_DUPLICATE");
        operation={operation:"fetch" as const,sources:resolved};
      }else{
        const args=CONTACT_INTAKE_TOOLS.browse_contact_source.schema.parse(call.arguments);
        const source=row.state.response.public_sources.find(s=>s.source_id===canonicalSourceRef(row,args.source_id));if(!source)deny("CONTACT_SOURCE_NOT_DISCOVERED");
        operation={operation:"browse" as const,source};
      }
      row.state.pending_research=call.name;
      return {contract_version:CONTACT_RESEARCH_CONTRACT,task_id:id,call_id:randomUUID(),anchors,input:operation};
    });
    const result=await this.dependencies.research.execute(input,signal);
    return this.checkpoint(auth,id,epoch,async(_,row)=>{
      const retained=retainContactResearchResult(row.state.response.public_sources,result);
      for(const outcome of retained.channels.filter(item=>item.status==="failed")){
        const limitation=`CONTACT_PUBLIC_SEARCH_${outcome.channel.toUpperCase()}_${outcome.error_code}`;
        if(!row.state.response.limitations.includes(limitation))row.state.response.limitations.push(limitation);
      }
      if(retained.channels.some(item=>item.status==="ok"&&item.truncated)&&
        !row.state.response.limitations.includes("CONTACT_PUBLIC_SEARCH_RESULT_LIMIT"))
        row.state.response.limitations.push("CONTACT_PUBLIC_SEARCH_RESULT_LIMIT");
      for(const outcome of retained.fetch_outcomes.filter(item=>item.status!=="ok")){
        const limitation=`CONTACT_PUBLIC_FETCH_${outcome.status.toUpperCase()}_${outcome.channel.toUpperCase()}`;
        if(!row.state.response.limitations.includes(limitation))row.state.response.limitations.push(limitation);
      }
      row.state.pending_research=null;this.observe(row,call.name,{sources:retained.sources,channels:retained.channels,
        fetch_outcomes:retained.fetch_outcomes},"completed");
      return retained;
    });
  }
}

export function environmentScreenshotContactDependencies(environment:NodeJS.ProcessEnv=process.env):ScreenshotContactDependencies|null {
  if(environment.TALENT_SIGNAL_SCREENSHOT_CONTACT_AGENT_ENABLED!=="true")return null;
  if(environment.TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING!=="true")throw new Error("CONTACT_AGENT_SENSITIVE_AI_NOT_ENABLED");
  const preprocessor=new ArkScreenshotPreprocessor({apiKey:environment.ARK_API_KEY??""});
  if(environment.TALENT_SIGNAL_AGENT_PROVIDER==="claude")return {
    model:new ClaudeContactAgentModel(claudeHarnessConfiguration(environment)),
    preprocessor,
    research:environment.TALENT_SIGNAL_PERSON_RESEARCH_SOCKET?new LocalContactResearchClient(environment.TALENT_SIGNAL_PERSON_RESEARCH_SOCKET):null};
  return {model:new ZhipuContactAgentModel({apiKey:environment.ZHIPU_API_KEY??"",model:environment.TALENT_SIGNAL_CHAT_MODEL??"glm-5.3",
    visionModel:environment.TALENT_SIGNAL_AGENT_VISION_MODEL??"glm-4.6v-flash",...(environment.ZHIPU_BASE_URL?{baseUrl:environment.ZHIPU_BASE_URL}:{})}),
    preprocessor,
    research:environment.TALENT_SIGNAL_PERSON_RESEARCH_SOCKET?new LocalContactResearchClient(environment.TALENT_SIGNAL_PERSON_RESEARCH_SOCKET):null};
}
