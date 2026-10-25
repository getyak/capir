import { webRequest } from "./web-transport.js";
import { classifyReceiptResponse } from "./handoff-contract.js";

export async function submitReviewedCapture(origin, envelope) {
  if (envelope.source.capture_kind === "visible_tab") {
    return chrome.runtime.sendMessage({ type: "handoff.reviewed-image", envelope });
  }
  const response = await webRequest(origin, "/api/browser-extension/captures", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": envelope.idempotency_key,
      "X-Talent-Signal-Session-Version": envelope.session.version }, body: JSON.stringify(envelope),
  });
  return classifyReceiptResponse(response.status, response.body);
}

/** Receipt checks cannot dispatch an image POST or regenerate its identity. */
export async function readCaptureReceipt(origin, kind, requestIdentity) {
  if (kind === "visible_tab") {
    return chrome.runtime.sendMessage({ type: "handoff.recover", requestKey: requestIdentity.idempotency_key });
  }
  const response = await webRequest(origin, `/api/browser-extension/captures/${encodeURIComponent(requestIdentity.request_id)}`);
  return classifyReceiptResponse(response.status, response.body);
}
