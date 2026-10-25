import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { ScreenshotContactTaskResponseSchema, type ScreenshotContactTaskResponse } from "@talent-signal/agent/contact-intake";
import { backendAuthBaseUrl, readBackendSessionClaims, type BackendSessionClaims } from "./backendAuth";
import { contactHandoffSessionVersion } from "./contact-handoff-session";
import { backendSessionIsExpired, isBackendSessionExpiredError } from "@/lib/backend-session";

const source = z.object({
  capture_kind: z.enum(["selected_text", "page_text", "visible_tab"]),
  title: z.string().trim().min(1).max(500),
  url: z.string().max(4096).refine(value => {
    if (value === "local-file://reviewed-screenshot" || value === "screen://user-selected") return true;
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
  }),
  captured_at: z.iso.datetime(),
  time_basis: z.enum(["captured_at", "imported_at"]).optional(),
});
const envelopeSchema = z.object({
  schema_version: z.literal("browser-capture-handoff.v1"),
  request_id: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/),
  idempotency_key: z.string().min(1).max(128),
  retention_mode: z.literal("evidence_crop"),
  purpose: z.literal("candidate_conversation_evidence_review"),
  handoff_target: z.string().url(),
  session: z.object({version:z.string().min(1),credential_transport:z.literal("browser_managed")}),
  source,
  review: z.discriminatedUnion("type", [
    z.object({type:z.literal("reviewed_text"),text:z.string().trim().min(1).max(50_000),edited_from_selection:z.boolean()}),
    z.object({type:z.literal("reviewed_image"),mime_type:z.literal("image/jpeg"),width:z.number().int().positive().max(16000),height:z.number().int().positive().max(16000),data_url:z.string().max(13_400_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/)}),
  ]),
  authorization: z.object({decision:z.literal("submit_reviewed_capture"),approved_at:z.iso.datetime(),statement:z.string().min(1).max(1000)}),
});

export function browserSessionVersion(claims: BackendSessionClaims) {
  return contactHandoffSessionVersion(claims);
}

export async function browserClaims() {
  try {
    const claims = await readBackendSessionClaims();
    return claims && !backendSessionIsExpired(claims.backendExpiresAt) ? claims : null;
  } catch (error) {
    if (isBackendSessionExpiredError(error)) return null;
    throw error;
  }
}

export function browserCaptureInput(value: unknown, headers: Headers, claims: BackendSessionClaims, origin: string) {
  const envelope = envelopeSchema.parse(value);
  if (headers.get("idempotency-key") !== envelope.idempotency_key ||
      headers.get("x-talent-signal-session-version") !== browserSessionVersion(claims) ||
      envelope.session.version !== browserSessionVersion(claims) ||
      new URL(envelope.handoff_target).origin !== origin) throw new Error("会话或接收地址已变化，请重新连接后提交。");
  if ((envelope.source.capture_kind === "visible_tab") !== (envelope.review.type === "reviewed_image")) throw new Error("来源类型与提交内容不一致。");
  const sourceURL = new URL(envelope.source.url); sourceURL.search=""; sourceURL.hash="";
  const common = {
    idempotency_key: `browser-capture:${envelope.request_id}`,
    objective: "整理这次用户主动截取的来源。如果明确涉及一个人物，先查找已有联系人，再复用或创建可撤销的内部记录；保留准确来源。多人或身份含糊时询问，无人物时不创建。资料与建议保持未确认，不执行外部操作。",
    allow_public_research: false,
    browser_source: {title:envelope.source.title,locator:sourceURL.href},
    captured_at: envelope.source.captured_at,
    source: {kind:envelope.source.url.startsWith("screen:")?"screen":envelope.source.url.startsWith("local-file:")?"uploaded_image":envelope.source.capture_kind,
      title:envelope.source.title,url:sourceURL.href,time_basis:envelope.source.time_basis??"captured_at"},
  };
  if (envelope.review.type === "reviewed_text") return {...common,text:envelope.review.text};
  const bytes = Buffer.from(envelope.review.data_url.split(",")[1]!, "base64");
  return {...common,image:{media_type:"image/jpeg",byte_size:bytes.length,content_hash:createHash("sha256").update(bytes).digest("hex"),data_base64:bytes.toString("base64")}};
}

export async function browserBackend(claims: BackendSessionClaims, path: string, body?: unknown) {
  return fetch(`${backendAuthBaseUrl()}/v1/contact-agent/${path}`, {
    method: body ? "POST" : "GET", cache:"no-store", redirect:"error",
    headers:{authorization:`Bearer ${claims.backendAccessToken}`,"content-type":"application/json","x-talent-signal-platform":"web"},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(40_000),
  });
}

export function browserReceipt(value: unknown) {
  const task: ScreenshotContactTaskResponse = ScreenshotContactTaskResponseSchema.parse(value);
  if (task.status === "deleted") return {status:"deleted",task_id:task.task_id};
  return {status:"received",receipt_id:task.task_id,task_id:task.task_id,capture_id:task.capture_id,
    processing_status:task.status,person_id:task.contact?.person_id??null};
}
