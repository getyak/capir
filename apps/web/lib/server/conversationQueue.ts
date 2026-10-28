import { isConversationMemoryDraftTarget, memoryDraftFailureKey } from "../conversation-memory-draft-target";
import { mintMemoryEntryCapability, verifyMemoryEntryCapability } from "./memoryEntryCapability";
import { TalentSignalClient, TalentSignalHttpError, type ConversationQueueAdmitRequest, type ConversationQueueMutationRequest } from "@talent-signal/contracts";
import { backendAuthBaseUrl, readBackendSessionClaims } from "./backendAuth";
import { contactHandoffSessionVersion } from "./contact-handoff-session";
import { BackendSessionExpiredError, backendSessionIsExpired } from "../backend-session";
import { isAllowedMutationOrigin } from "../request-origin";
import { workspaceSessionTitle } from "./workspaceChat";
import { readOnlyStreamShutdownSignal } from "./readOnlyStreamShutdown";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
// 30,000,000 binary bytes encode to 40,000,000 base64 characters; this bound
// adds a small JSON envelope without permitting an unbounded buffer anywhere.
const MAX_ADMIT_BODY_BYTES = 40_100_000;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

/** Every observation and mutation remains bound to the rendered login, including SSE. */
export async function conversationQueueRoute(request: Request, id: string, action: "read" | "admit" | "admit-memory-draft" | "mutate" | "stream") {
  // A proxy can reuse a draining HTTP/1 connection for subscription retries.
  // Close that transport after both successful and rejected observations so
  // those retries cannot keep Next's server.close() waiting indefinitely.
  const responseHeaders = action === "stream" ? { ...headers, Connection: "close" } : headers;
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: responseHeaders });
  try {
    if (!uuid.test(id)) return json({ message: "对话标识无效。" }, 400);
    if (action === "admit" || action === "admit-memory-draft" || action === "mutate") {
      if (!isAllowedMutationOrigin(request.headers)) return json({ message: "跨站请求已拒绝。" }, 403);
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ message: "请求格式无效。" }, 415);
    }
    // Register before the first await: shutdown during auth must also fence a
    // first subscription that has not opened its upstream transport yet.
    const shutdownSignal = action === "stream" ? readOnlyStreamShutdownSignal() : request.signal;
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) return json({ code: "backend_session_expired", message: "请重新登录。" }, 401);
    if (request.headers.get("x-workspace-session") !== contactHandoffSessionVersion(claims)) return json({ code: "session_stale", message: "登录已改变，请重新打开对话。" }, 409);
    const client = new TalentSignalClient(backendAuthBaseUrl(), claims.backendAccessToken);
    const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
    if (action === "read") {
      const snapshot = await client.getConversationQueue(id, deadline);
      const entry = verifyMemoryEntryCapability(request.headers.get("x-memory-entry-capability"), claims);
      const response = json(snapshot);
      // The queue read is owner-authorized by the backend. A matching signed
      // entry can recover its capability after an admission response was lost.
      if (entry?.purpose === "chat" && entry.sessionId === id) {
        response.headers.set("x-memory-entry-capability", mintMemoryEntryCapability(claims, { purpose: "chat", sessionId: id }));
      }
      return response;
    }
    if (action === "stream") {
      const signal = AbortSignal.any([request.signal, shutdownSignal]);
      signal.throwIfAborted();
      const upstream = await client.openConversationQueueStream(id, signal);
      if (!upstream.ok) return json({ code: "queue_unavailable", message: "暂时无法连接回复。" }, upstream.status);
      return new Response(upstream.body, { headers: { ...responseHeaders, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
    }
    let body: unknown;
    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_ADMIT_BODY_BYTES) {
      return json({ message: "每次发送的图片总计不能超过 30 MB。" }, 413);
    }
    try { body = await request.json(); } catch { return json({ message: "请求格式无效。" }, 400); }
    if (action === "mutate") return json(await client.mutateConversationQueue(id, body as ConversationQueueMutationRequest, deadline));
    const entryToken = request.headers.get("x-memory-entry-capability");
    const entry = verifyMemoryEntryCapability(entryToken, claims);
    if (entryToken && (!entry || entry.purpose !== "chat" || entry.sessionId !== id)) {
      return json({ code: "memory_entry_mismatch", message: "请重新打开这段对话后发送。" }, 403);
    }
    const input = body as ConversationQueueAdmitRequest;
    const images = Array.isArray(input?.images) ? input.images : [];
    if (action === "admit-memory-draft" && !isConversationMemoryDraftTarget(input?.memory_draft_target)) return json({ code: "MEMORY_DRAFT_TARGET_ADMISSION_REQUIRED", message: "composer.memoryDraft.unavailable" }, 422);
    if (!input || input.session_id !== id || !uuid.test(input.message_id ?? "") || typeof input.objective !== "string" || input.objective.length > 1000 || images.length > 10) return json({ message: "请发送 1–1000 字的消息，或最多 10 张图片。" }, 400);
    if (input.memory_draft_target !== undefined && (!isConversationMemoryDraftTarget(input.memory_draft_target) || !input.objective.trim() || images.length)) {
      return json({ code: images.length ? "MEMORY_DRAFT_TARGET_TEXT_ONLY" : "MEMORY_DRAFT_TARGET_TEXT_REQUIRED", message: images.length ? "composer.memoryDraft.textOnly" : "composer.memoryDraft.textRequired" }, 422);
    }
    if (!input.objective.trim() && images.length === 0) return json({ message: "请发送 1–1000 字的消息，或最多 10 张图片。" }, 400);
    try { await client.getAgentSession(id, deadline); }
    catch (error) {
      if (!(error instanceof TalentSignalHttpError) || error.status !== 404) throw error;
      try { await client.saveAgentSession(id, { expected_revision: 0, idempotency_key: id, payload: {
        id, scopeKind: "unresolved_intent", personDisplayLabel: "", contextDisplayLabel: "", title: input.objective.trim() ? workspaceSessionTitle(input.objective) : "图片",
        turns: [], updatedAt: new Date().toISOString(), isUnread: false,
      } }, deadline); }
      catch (creationError) {
        if (!(creationError instanceof TalentSignalHttpError) || creationError.status !== 409) throw creationError;
        // Another tab can win creation of the same home intent; ownership is
        // re-read before admitting this distinct immutable message.
        await client.getAgentSession(id, deadline);
      }
    }
    const admitted = await client.admitConversationQueueEntry(input, deadline);
    return json({ ...admitted, ...(entry ? { memory_entry_capability: mintMemoryEntryCapability(claims, { purpose: "chat", sessionId: id }) } : {}) }, 202);
  } catch (error) {
    if (error instanceof BackendSessionExpiredError) return json({ code: "backend_session_expired", message: "请重新登录。" }, 401);
    if (error instanceof TalentSignalHttpError) {
      const unsupported = action === "admit-memory-draft" && error.status === 404 && !memoryDraftFailureKey(error.code);
      return json({ code: unsupported ? "MEMORY_DRAFT_TARGET_UNSUPPORTED" : error.code, message: unsupported ? "composer.memoryDraft.serviceUnavailable" : memoryDraftFailureKey(error.code) ?? error.message }, error.status);
    }
    return json({ code: "queue_unavailable", message: "连接暂时中断，消息仍保留。" }, 503);
  }
}

/**
 * Original inline-image readback proxy.
 *
 * The bytes never reach an unscoped `<img src>` URL: the browser fetches this
 * same-origin route with the captured Session binding, and the route rechecks
 * the current login before forwarding to the backend. The backend revalidates
 * queue ownership and Session lifecycle and returns no-store/nosniff bytes.
 */
export async function conversationImageRoute(request: Request, id: string, messageId: string, indexValue: string) {
  try {
    if (!uuid.test(id) || !uuid.test(messageId)) return json({ message: "图片标识无效。" }, 400);
    const index = Number.parseInt(indexValue, 10);
    if (!Number.isInteger(index) || index < 0 || index > 9 || String(index) !== indexValue) {
      return json({ message: "图片位置无效。" }, 400);
    }
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) return json({ code: "backend_session_expired", message: "请重新登录。" }, 401);
    if (request.headers.get("x-workspace-session") !== contactHandoffSessionVersion(claims)) return json({ code: "session_stale", message: "登录已改变，请重新打开对话。" }, 409);
    const client = new TalentSignalClient(backendAuthBaseUrl(), claims.backendAccessToken);
    const upstream = await client.openConversationMessageImage(id, messageId, index, AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]));
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      },
    });
  } catch (error) {
    if (error instanceof BackendSessionExpiredError) return json({ code: "backend_session_expired", message: "请重新登录。" }, 401);
    if (error instanceof TalentSignalHttpError) return json({ code: error.code, message: memoryDraftFailureKey(error.code) ?? error.message }, error.status);
    return json({ code: "image_unavailable", message: "图片暂时无法读取。" }, 503);
  }
}
