import { normalizeLocalOrigin } from "./handoff-contract.js";

/** Only explicitly reviewed pixels enter the shared screenshot Agent. */
export async function contactTaskFromReviewedImage(envelope) {
  if (envelope?.source?.capture_kind !== "visible_tab" || envelope.review?.type !== "reviewed_image"
    || envelope.authorization?.decision !== "submit_reviewed_capture" || envelope.retention_mode !== "evidence_crop"
    || typeof envelope.idempotency_key !== "string" || envelope.idempotency_key.length > 128
    || !Number.isFinite(Date.parse(envelope.source.captured_at))) throw new Error("CONTACT_HANDOFF_INVALID");
  normalizeLocalOrigin(envelope.handoff_target);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(envelope.review.data_url ?? "");
  if (!match || match[0].length > 8_000_000 || match[1] !== envelope.review.mime_type) throw new Error("CONTACT_HANDOFF_IMAGE_INVALID");
  const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
  if (!bytes.length) throw new Error("CONTACT_HANDOFF_IMAGE_EMPTY");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let browserSource;
  if (envelope.source.url && envelope.source.title) {
    const url=new URL(envelope.source.url);
    if (url.username || url.password || (!["https:","http:"].includes(url.protocol) && url.href!=="local-file://reviewed-screenshot" && url.href!=="screen://user-selected")) throw new Error("CONTACT_HANDOFF_SOURCE_INVALID");
    url.search=""; url.hash="";
    if(url.href.length>1000)throw new Error("CONTACT_HANDOFF_SOURCE_TOO_LONG");
    browserSource={title:envelope.source.title.slice(0,500),locator:url.href};
  }
  return { idempotency_key: envelope.idempotency_key, captured_at: envelope.source.captured_at,
    ...(browserSource?{browser_source:browserSource,source:{kind:browserSource.locator.startsWith("screen:")?"screen":browserSource.locator.startsWith("local-file:")?"uploaded_image":"visible_tab",title:browserSource.title,url:browserSource.locator,time_basis:envelope.source.time_basis??"captured_at"}}:{}),
    objective: "整理这张我已审阅的截图；聊天按来源归档，个人主页生成可编辑的联系人草稿。",
    image: { media_type: match[1], byte_size: bytes.length, content_hash: [...digest].map(byte => byte.toString(16).padStart(2,"0")).join(""), data_base64: match[2] },
    allow_public_research: false };
}

export function contactTaskReviewURL(origin, taskID) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(taskID)) throw new Error("CONTACT_TASK_ID_INVALID");
  const url = new URL("/workspace/captures", normalizeLocalOrigin(origin));
  url.searchParams.set("task", taskID); url.searchParams.set("source", "browser-extension"); return url.toString();
}

/** Passed directly to chrome.scripting: every helper must remain inside this
 * function's serialization scope. Cookies and renewal proof stay in Web. */
export async function contactHandoffInWeb(origin, sessionVersion, operation, input) {
  let dispatched = false;
  const unknown = () => ({ state: operation === "recover" || dispatched ? "unknown" : "failed",
    code: "connection_unavailable", retryable: true, no_submit: !dispatched,
    message: dispatched || operation === "recover"
      ? "Receipt could not be verified. Your recovery record is kept; check the same task again before submitting another copy."
      : "Connection could not be verified. Your reviewed capture is kept; retry the connection before submitting." });
  const signedOut = () => ({ state: dispatched || operation === "recover" ? "unknown" : "failed",
    code: "session_stale", authentication_required: true, no_submit: !dispatched,
    message: "The Web session requires sign-in. Keep this review and check the original task after signing in." });
  const changed = () => ({ state: "failed", code: "session_changed", no_submit: !dispatched,
    message: "The Web workspace or session changed. Recheck the original connection before continuing this review." });
  const options = (timeout = 10_000) => ({ credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeout) });
  const document = async response => {
    const value = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_REPLY");
    return value;
  };
  const validTask = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
  if (location.origin !== origin || location.pathname !== "/contact-agent" || !["submit", "recover"].includes(operation)) return changed();
  try {
    const preflight = await fetch("/api/browser-extension/session", options());
    if (preflight.status === 401) return signedOut();
    if (!preflight.ok) return unknown();
    const session = await document(preflight);
    if (session.status !== "ready" || session.contact_agent !== true || typeof session.session_version !== "string" || !session.session_version) return unknown();
    if (!sessionVersion || session.session_version !== sessionVersion) return changed();
    const headers = { "x-contact-handoff-session": sessionVersion };
    let response, created;
    if (operation === "submit") {
      dispatched = true;
      response = await fetch("/api/contact-agent/tasks", { ...options(40_000), method: "POST",
        headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(input) });
      if (response.status === 401) return signedOut();
      if (!response.ok) return unknown();
      created = await document(response);
      if (!validTask(created.task_id)) return unknown();
    } else if (typeof input !== "string" || !input || input.length > 128) return changed();
    const path = operation === "recover" ? `/api/contact-agent/tasks?handoff_request_id=${encodeURIComponent(input)}` : `/api/contact-agent/tasks/${created.task_id}`;
    const readback = await fetch(path, { ...options(), headers });
    if (readback.status === 401) return signedOut();
    if (!readback.ok) return unknown();
    const saved = await document(readback);
    if (!validTask(saved.task_id) || created && saved.task_id !== created.task_id) return unknown();
    if (["deleted", "expired", "cancelled"].includes(saved.status)) return { state: "unavailable", code: "contact_handoff_unavailable",
      message: "The original task is no longer available. It was not recreated." };
    return { state: "received", contact_task_id: saved.task_id, receipt_id: saved.task_id, capture_id: saved.task_id,
      duplicate: operation === "recover" || response.status === 200,
      message: operation === "recover" ? "Recovered the original task. No image was submitted again."
        : "The reviewed image reached the shared Agent. Continue in Web; profile fields still require your review." };
  } catch { return unknown(); }
}

// Convenience entry points for local callers. The worker injects the complete
// contactHandoffInWeb function, never these module-dependent wrappers.
export function submitContactTaskInWeb(origin, sessionVersion, payload) {
  return contactHandoffInWeb(origin, sessionVersion, "submit", payload);
}
export function recoverContactTaskInWeb(origin, sessionVersion, requestKey) {
  return contactHandoffInWeb(origin, sessionVersion, "recover", requestKey);
}
