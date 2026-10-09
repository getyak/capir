"use client";

import { forgetSessionOrganization } from "@/lib/workspace-session-organization";
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeWorkspaceRefresh, workspaceRefreshGeneration } from "@/lib/workspace-refresh";
import type {
  ConversationImageManifest,
  ConversationImageUpload,
  ConversationQueueMutationRequest,
  ConversationQueueEntry,
  ConversationQueuePreview,
  ConversationQueueSnapshot,
} from "@talent-signal/contracts";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import { workspaceSessionFetch } from "../workspace-session-request";
import { validateAttachmentBatch } from "../contact-agent/capture-intake";
import { sameConversationImages, unresolvedConversationCount } from "./conversation-feedback";
import { acceptConversationPreview, acceptConversationSnapshot, ConversationFrames } from "@/lib/conversation-stream";
import { clearConversationLocal, conversationExpiry, readConversationDraft, readConversationMessages, removeConversationMessage, writeConversationDraft, writeConversationMessage, type LocalMessage } from "@/lib/conversation-local";
import {
  base64FromBlob,
  loadConversationImages,
  persistConversationImages,
  removeConversationImages,
  sha256Hex,
  type DurableConversationImage,
} from "@/lib/conversation-image-store";
import { clearConversationImageStore } from "@/lib/conversation-image-lifecycle";

type Options = { entryCapability?: string | null; bootstrap?: string | null; id: string | null; scope: string; chatBinding: string; detailBinding: string; initial?: SessionDetail; onAdmitted?: (id: string) => void };
class RequestError extends Error { constructor(message: string, readonly status: number, readonly code?: string) { super(message); } }
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
  const timer = setTimeout(finish, ms); signal.addEventListener("abort", finish, { once: true });
});

export type ConversationAttachment = {
  id: string;
  file: File;
  url: string;
  manifest: ConversationImageManifest;
};

export function useConversation(options: Options) {
  const { id, scope, chatBinding, detailBinding, initial } = options;
  const [entryCapability, setEntryCapability] = useState(options.entryCapability ?? null);
  const [renderedEntry, setRenderedEntry] = useState(options.entryCapability);
  if (options.entryCapability !== renderedEntry) {
    setRenderedEntry(options.entryCapability);
    setEntryCapability(options.entryCapability ?? null);
  }
  const entryCapabilityRef = useRef(entryCapability);
  useEffect(() => { entryCapabilityRef.current = entryCapability; }, [entryCapability]);
  const [detail, setDetail] = useState(initial ?? null);
  const [draft, setDraft] = useState(initial?.composer_draft ?? "");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [attachments, setAttachments] = useState<ConversationAttachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [snapshot, setSnapshot] = useState<ConversationQueueSnapshot | null>(null);
  const [preview, setPreview] = useState<ConversationQueuePreview | null>(null);
  const previewRef = useRef<ConversationQueuePreview | null>(null);
  const [handoffPreviews, setHandoffPreviews] = useState<Record<string, ConversationQueuePreview>>({});
  const [connection, setConnection] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [serverExists, setServerExists] = useState(Boolean(initial));
  const [unavailable, setUnavailable] = useState(initial ? initial.state !== "active" : false);
  const [draftConflict, setDraftConflict] = useState(false);
  const [mutating, setMutating] = useState(false);
  const local = useRef(messages); const draftRef = useRef(draft); const detailRef = useRef(detail);
  const attachmentsRef = useRef<ConversationAttachment[]>([]);
  const snapshotRef = useRef(snapshot); const lifecycle = useRef<AbortController | null>(null);
  const sender = useRef(false); const saving = useRef(false); const lastSaved = useRef(initial?.composer_draft ?? "");
  // Separate draft baseline: the last remote composer draft this client has
  // reconciled with. A refresh may merge committed turns freely, but a CHANGED
  // remote draft triggers the conflict UI before any save can overwrite it.
  const remoteDraftBaseline = useRef(initial?.composer_draft ?? "");
  const mutationBusy = useRef(false); const pendingHandoff = useRef<string | null>(null);
  const stopObserved = useRef(new Set<string>()); const readbackTimers = useRef<number[]>([]);
  const [handoffEntries, setHandoffEntries] = useState<Record<string, ConversationQueueEntry>>({});
  const [runOutcome, setRunOutcome] = useState<Record<string, "completed" | "stopped">>({});
  const [readbackStalled, setReadbackStalled] = useState<string[]>([]);
  const writer = useRef(""); const draftStamp = useRef(""); const loaded = useRef(false);
  const submitLock = useRef(false); const preparingRef = useRef(false); const prepareGeneration = useRef(0);
  const pendingPreparations = useRef(0);
  const prepareChain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (options.initial?.session_id === id && options.initial.state !== "active" && id) {
      forgetSessionOrganization(scope, id);
    }
  }, [options.initial?.session_id, options.initial?.state, id, scope]);
  const admitted = useRef(options.onAdmitted);
  useEffect(() => { admitted.current = options.onAdmitted; }, [options.onAdmitted]);
  const expiry = () => conversationExpiry(detailRef.current?.expires_at);
  const queueUrl = `/api/workspace-sessions/${id}/conversation-queue`;
  // The mounted lifecycle controller is the single identity for this
  // account/session/binding. Every awaited step rechecks it before committing.
  const stillCurrent = useCallback((controller: AbortController | null) =>
    controller !== null && lifecycle.current === controller && !controller.signal.aborted, []);

  const storeMessages = useCallback((next: LocalMessage[]) => { local.current = next; setMessages(next); }, []);
  // Canonical history is the only handoff that retires a local outbox row.
  // Until its turn exists — carrying the same ordered image manifests — the
  // exact message identity and its local attachment bytes are the durable
  // evidence of what was sent; renders hide duplicates instead of deleting
  // them before the canonical history arrives.
  const reconcile = useCallback((history: SessionDetail | null) => {
    if (!id) return;
    const settled = new Set((history?.turns ?? []).filter(turn => {
      const message = local.current.find(item => item.id === turn.id);
      return Boolean(message) && sameConversationImages(message?.images, turn.images);
    }).map(turn => turn.id));
    const remaining = local.current.filter(message => { if (!settled.has(message.id)) return true; removeConversationMessage(scope, id, message.id); void removeConversationImages(scope, id, message.id); return false; });
    if (remaining.length !== local.current.length) storeMessages(remaining);
  }, [id, scope, storeMessages]);

  async function request(url: string, init: RequestInit = {}, binding = chatBinding) {
    const controller = lifecycle.current;
    if (!controller || controller.signal.aborted) throw new DOMException("Closed", "AbortError");
    const response = await workspaceSessionFetch(url, { ...init, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      headers: { "x-workspace-session": binding, ...((entryCapabilityRef.current ?? options.bootstrap) ? { "x-memory-entry-capability": entryCapabilityRef.current ?? options.bootstrap! } : {}), ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new RequestError(body.message ?? "连接暂时中断，请重试。", response.status, body.code); }
    if (controller.signal.aborted) throw new DOMException("Closed", "AbortError");
    const recovered = response.headers.get("x-memory-entry-capability");
    if (recovered) { entryCapabilityRef.current = recovered; setEntryCapability(recovered); }
    return response;
  }
  function applyDetail(next: SessionDetail) {
    if (next.session_id !== id || (detailRef.current && next.revision < detailRef.current.revision)) return;
    // Concurrent remote draft: differ from our baseline and from the local
    // value means another device wrote this draft. Surface the conflict and
    // let the reader decide; nothing is overwritten silently.
    const remoteDraft = next.composer_draft ?? "";
    if (remoteDraft !== remoteDraftBaseline.current && remoteDraft !== draftRef.current) {
      setDraftConflict(true);
    }
    detailRef.current = next; setDetail(next); reconcile(next);
    const settled = new Set(next.turns.map(turn => turn.id));
    setHandoffEntries(previous => Object.fromEntries(Object.entries(previous).filter(([messageId]) => !settled.has(messageId))));
    setHandoffPreviews(previous => Object.fromEntries(Object.entries(previous).filter(([messageId]) => !settled.has(messageId))));
    if (next.state !== "active") { forgetSessionOrganization(scope, id!); clearConversationLocal(scope, id!); clearConversationImageStore(scope, id!); storeMessages([]); setPreview(null); setHandoffPreviews({}); previewRef.current = null; setHandoffEntries({}); setUnavailable(true); }
  }
  async function refreshDetail(generation?: number) {
    if (!id) return;
    const response = await request(`/api/workspace-sessions/${id}`, {}, detailBinding);
    const body = await response.json();
    // Scope fencing: a late readback from a previous account, endpoint or
    // scope generation is dropped instead of painting stale data.
    if (generation !== undefined && generation !== workspaceRefreshGeneration(scope)) return;
    if (body.detail && !lifecycle.current?.signal.aborted) applyDetail(body.detail);
  }

  // Shared bounded active refresh for the OPEN conversation on the default
  // path: foreground, focus, network recovery and relevant mutations merge
  // newly committed remote turns and tombstones while the composing draft,
  // IME composition, pending messages and reader position stay untouched.
  useEffect(() => {
    if (!id || !scope) return;
    let disposed = false;
    const unsubscribe = subscribeWorkspaceRefresh(scope, (_reason, generation) => {
      if (disposed) return;
      void refreshDetail(generation).catch(() => {
        // Offline or failed read: keep the previous conversation and draft
        // with their existing recovery affordances.
      });
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, scope, detailBinding]);
  function setAttachmentState(next: ConversationAttachment[]) {
    attachmentsRef.current = next;
    setAttachments(next);
  }
  function clearAttachments() {
    for (const attachment of attachmentsRef.current) URL.revokeObjectURL(attachment.url);
    setAttachmentState([]);
  }
  function refuse(error: unknown) {
    // Entry expiry is recoverable with a fresh SSR entry. Preserve every
    // unsent message/image so reopening the same URL can retry its exact ID.
    if (error instanceof RequestError && error.code === "memory_entry_mismatch") {
      setError("对话入口已过期。请刷新页面后重试，未送达的文字和图片已保留。");
      return;
    }
    if (error instanceof RequestError && (error.status === 401 || error.status === 403 || error.status === 410 || error.code === "session_stale")) {
      setUnavailable(true); setHandoffEntries({}); setHandoffPreviews({}); previewRef.current = null; setPreview(null); setDetail(null); setDraft(""); storeMessages([]); clearAttachments(); if (id) { clearConversationLocal(scope, id); clearConversationImageStore(scope, id); }
    }
  }
  function updateMessage(id: string, update: Partial<LocalMessage>) {
    storeMessages(local.current.map(message => { if (message.id !== id) return message; const next = { ...message, ...update }; writeConversationMessage(scope, options.id!, next); return next; }));
  }
  // Minimal bounded passive readback after a settled run leaves the active
  // slot: GET only, never a POST and never a new authorization, and only while
  // this mounted lifecycle owns the conversation.
  function scheduleReadback(messageId: string) {
    const controller = lifecycle.current;
    const arm = (delay: number, final: boolean) => {
      const timer = window.setTimeout(() => {
        readbackTimers.current = readbackTimers.current.filter(entry => entry !== timer);
        if (!stillCurrent(controller) || detailRef.current?.turns.some(turn => turn.id === messageId)) return;
        // A stalled readback stays recoverable: the identity is retained and
        // the surface exposes the passive refresh.
        if (final) { setReadbackStalled(current => current.includes(messageId) ? current : [...current, messageId]); return; }
        void refreshDetail().catch(() => { /* Keep the retained row recoverable. */ });
      }, delay);
      readbackTimers.current.push(timer);
    };
    arm(2_000, false); arm(6_000, false); arm(12_000, true);
  }
  function commitSnapshot(next: ConversationQueueSnapshot) {
    const accepted = acceptConversationSnapshot(snapshotRef.current, next, id!);
    if (!accepted || accepted !== next) return;
    const previous = snapshotRef.current;
    snapshotRef.current = next; setSnapshot(next);
    const entries = [next.active, ...(next.queued ?? [])].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    for (const entry of entries) {
      if (entry.cancel_requested && entry.run_id) stopObserved.current.add(entry.run_id);
      // The same-ID server row is the authoritative receipt for a lost POST
      // response: reconcile the unknown delivery without any resend.
      const message = local.current.find(item => item.id === entry.message_id);
      if (message?.delivery === "unknown") updateMessage(entry.message_id, { delivery: "accepted", error: undefined });
    }
    // Observe the completed-event handoff: the active slot can empty before the
    // canonical history read succeeds. Remember the outcome so the surface can
    // show saving/readback pending — or the truthful stopped state — instead
    // of a blank transcript.
    const previousActive = previous?.active?.message_id ?? null;
    const stillListed = next.active?.message_id === previousActive || (next.queued ?? []).some(entry => entry.message_id === previousActive);
    if (previousActive && !stillListed && !detailRef.current?.turns.some(turn => turn.id === previousActive)) {
      const outcome = previous?.active?.run_id && stopObserved.current.has(previous.active.run_id) ? "stopped" : "completed";
      setHandoffEntries(current => ({ ...current, [previousActive]: previous!.active! }));
      const visible = previewRef.current;
      if (visible?.run_id === previous?.active?.run_id) setHandoffPreviews(current => ({ ...current, [previousActive]: visible! }));
      setRunOutcome(current => ({ ...current, [previousActive]: outcome }));
      scheduleReadback(previousActive);
    }
    if (next.active) {
      const messageId = next.active.message_id;
      setHandoffEntries(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== messageId)));
      setHandoffPreviews(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== messageId)));
      if (previous?.active?.run_id !== next.active.run_id) setReadbackStalled(current => current.filter(key => key !== messageId));
    }
    reconcile(detailRef.current);
  }
  function handoffWhenSettled() {
    if (sender.current || mutationBusy.current || lifecycle.current?.signal.aborted || !pendingHandoff.current) return;
    const sessionId = pendingHandoff.current; pendingHandoff.current = null;
    admitted.current?.(sessionId);
  }
  async function drain() {
    if (sender.current || !id || !ready || unavailable) return;
    sender.current = true;
    const controller = lifecycle.current;
    let didAdmit = false;
    try {
      for (;;) {
        if (!controller || controller.signal.aborted || lifecycle.current !== controller) break;
        const message = local.current.find(item => item.delivery !== "accepted");
        if (!message || message.delivery !== "pending") break;
        const uploads = await uploadsFor(message);
        if (!controller || controller.signal.aborted || lifecycle.current !== controller) break;
        if (message.images?.length && !uploads) {
          const uncertain = message.receiptUncertain !== false;
          updateMessage(message.id, { delivery: uncertain ? "unknown" : "rejected", error: uncertain ? "本机图片暂时无法读取，送达结果仍未确认。恢复连接后请核对。" : "本机图片数据已丢失，无法重发。请移除这条消息后重新选择图片。" });
          break;
        }
        updateMessage(message.id, { delivery: "sending", receiptUncertain: true, error: undefined });
        try {
          const response = await request(queueUrl, { method: "POST", body: JSON.stringify({ session_id: id, message_id: message.id, idempotency_key: `web-queue:${message.id}`, objective: message.objective, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(uploads && uploads.length ? { images: uploads } : {}) }) });
          const admission = await response.json();
          if (!controller || controller.signal.aborted || lifecycle.current !== controller) break;
          if (typeof admission.memory_entry_capability === "string") {
            entryCapabilityRef.current = admission.memory_entry_capability;
            setEntryCapability(admission.memory_entry_capability);
          }
          // Accepted only means the server committed the same message identity.
          // Keep the local preview until canonical history reconciles it, so the
          // only thumbnail is never deleted before the server one exists.
          updateMessage(message.id, { delivery: "accepted" }); setServerExists(true); didAdmit = true;
        } catch (caught) {
          // No response is not a rejected message. Its immutable identity stays in the outbox.
          if (!controller || controller.signal.aborted || lifecycle.current !== controller) break;
          const definitive = message.receiptUncertain === false && caught instanceof RequestError && caught.status >= 400 && caught.status < 500 && caught.status !== 408;
          updateMessage(message.id, { delivery: definitive ? "rejected" : "unknown", receiptUncertain: !definitive, error: definitive ? caught.message : "送达结果尚未确认，可核对并重试。" });
          if (!controller || controller.signal.aborted) break;
          refuse(caught);
          break;
        }
      }
    } finally {
      sender.current = false;
      // Notify the parent only after serial admissions and mutations settle.
      // The live composer must remain mounted when its canonical URL changes.
      if (didAdmit && controller && !controller.signal.aborted && lifecycle.current === controller) { pendingHandoff.current = id; handoffWhenSettled(); }
    }
  }

  async function uploadsFor(message: LocalMessage): Promise<ConversationImageUpload[] | null> {
    if (!message.images?.length || !id) return [];
    const stored = await loadConversationImages(scope, id, message.id);
    if (stored.length !== message.images.length) return null;
    const ordered = [...stored].sort((a, b) => a.position - b.position);
    const uploads: ConversationImageUpload[] = [];
    for (const [index, record] of ordered.entries()) {
      const manifest = message.images[index];
      if (!manifest || record.attachment_id !== manifest.attachment_id || record.content_hash !== manifest.content_hash || record.byte_size !== manifest.byte_size) return null;
      uploads.push({
        attachment_id: manifest.attachment_id,
        file_name: manifest.file_name,
        media_type: manifest.media_type,
        byte_size: manifest.byte_size,
        content_hash: manifest.content_hash,
        data_base64: await base64FromBlob(record.blob),
      });
    }
    return uploads;
  }

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController(); lifecycle.current = controller; writer.current = crypto.randomUUID();
    queueMicrotask(() => {
    if (controller.signal.aborted) return;
    const recoveredDraft = readConversationDraft(scope, id);
    draftStamp.current = recoveredDraft?.updatedAt ?? "";
    const value = recoveredDraft?.value ?? initial?.composer_draft ?? "";
    draftRef.current = value; setDraft(value);
    storeMessages(readConversationMessages(scope, id).map(message => message.delivery === "sending" ? { ...message, delivery: "unknown" } : message));
    loaded.current = true; setReady(true);
    });
    function changed(event: StorageEvent) {
      if (!event.key?.startsWith(`talent-signal:conversation:v1:${scope}:${id}:`)) return;
      const other = readConversationDraft(scope, id!);
      if (other && other.writer !== writer.current && other.updatedAt > draftStamp.current && other.value !== draftRef.current) setDraftConflict(true);
      const found = readConversationMessages(scope, id!);
      const own = new Map(local.current.map(item => [item.id, item]));
      for (const message of found) if (!own.has(message.id)) own.set(message.id, { ...message, delivery: message.delivery === "pending" || message.delivery === "sending" ? "unknown" : message.delivery });
      storeMessages([...own.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    }
    window.addEventListener("storage", changed);
    return () => { loaded.current = false; controller.abort(); for (const timer of readbackTimers.current) window.clearTimeout(timer); readbackTimers.current = []; prepareGeneration.current += 1; pendingPreparations.current = 0; preparingRef.current = false; clearAttachments(); window.removeEventListener("storage", changed); };
    // The binding identifies this entire mounted conversation. Never migrate live state between accounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, scope, chatBinding, detailBinding]);

  useEffect(() => { if (ready) void drain(); /* Dispatch only messages that have never been attempted. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, messages]);

  useEffect(() => {
    if (!id || !ready || !serverExists || unavailable) return;
    const owner = lifecycle.current; if (!owner) return;
    const controller = new AbortController();
    const stop = () => controller.abort(); owner.signal.addEventListener("abort", stop, { once: true });
    const current = () => !controller.signal.aborted && !owner.signal.aborted;
    async function connect() {
      let failures = 0;
      while (current()) {
        try {
          const response = await workspaceSessionFetch(`${queueUrl}/stream`, { cache: "no-store", headers: { "x-workspace-session": chatBinding }, signal: controller.signal });
          if (!response.ok) { const body = await response.json().catch(() => ({})); throw new RequestError(body.message ?? "暂时无法连接回复。", response.status, body.code); }
          if (!response.body) throw new Error("没有可读取的回复连接。");
          failures = 0; setConnection("live");
          const reader = response.body.getReader(); const decoder = new TextDecoder(); const parser = new ConversationFrames();
          try {
            while (current()) {
              const chunk = await reader.read(); if (chunk.done) break;
              for (const frame of parser.push(decoder.decode(chunk.value, { stream: true }))) {
                if (!current()) break;
                if (frame.event === "snapshot") {
                  const next = acceptConversationSnapshot(snapshotRef.current, frame.data as ConversationQueueSnapshot, id!);
                  if (!next) continue;
                  commitSnapshot(next);
                  const previous = previewRef.current;
                  const accepted = next.preview ? acceptConversationPreview(previous, next.preview, next) : previous?.run_id === next.active?.run_id ? previous : null;
                  previewRef.current = accepted;
                  setPreview(accepted);
                  void refreshDetail().catch(caught => { if (current()) refuse(caught); });
                } else if (frame.event === "preview") {
                  // Frames in one network chunk can precede the next React
                  // render. Keep the accepted stream state synchronous so a
                  // completion frame retains text from the preceding preview.
                  const accepted = acceptConversationPreview(previewRef.current, frame.data as ConversationQueuePreview, snapshotRef.current);
                  previewRef.current = accepted;
                  setPreview(accepted);
                }
                else if (frame.event === "unavailable") { setPreview(null); throw new RequestError("这段对话已不可用，请重新打开。", 410); }
              }
            }
          } finally { await reader.cancel().catch(() => {}); }
        } catch (caught) {
          if (!current()) break;
          if (caught instanceof RequestError && [401, 403, 409, 410].includes(caught.status)) { refuse(caught); setError(caught.message); break; }
          failures++;
        }
        if (!current()) break;
        setConnection("reconnecting"); await sleep(Math.min(1000 * 2 ** failures, 10000), controller.signal);
      }
    }
    void connect();
    return () => { controller.abort(); owner.signal.removeEventListener("abort", stop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, scope, chatBinding, ready, serverExists, unavailable]);

  function changeDraft(value: string) {
    draftRef.current = value; setDraft(value);
    if (!id) return;
    const existing = readConversationDraft(scope, id);
    if (existing && existing.writer !== writer.current && existing.updatedAt > draftStamp.current && existing.value !== value) { setDraftConflict(true); return; }
    const updatedAt = new Date().toISOString();
    if (!writeConversationDraft(scope, id, { value, updatedAt, expiresAt: expiry(), writer: writer.current })) setError("本机草稿存储不可用，请保留此页。发送前需要恢复存储。");
    else draftStamp.current = updatedAt;
  }

  function addFiles(files: File[]): Promise<void> {
    if (!files.length) return Promise.resolve();
    const generation = prepareGeneration.current;
    const controller = lifecycle.current;
    if (!id || unavailable || !controller || controller.signal.aborted) return Promise.resolve();
    pendingPreparations.current += 1;
    preparingRef.current = true; setPreparing(true);
    prepareChain.current = prepareChain.current
      .then(() => prepareFiles(files, generation, controller))
      .catch(() => undefined)
      .finally(() => {
        if (generation !== prepareGeneration.current || !stillCurrent(controller)) return;
        pendingPreparations.current -= 1;
        preparingRef.current = pendingPreparations.current > 0;
        setPreparing(preparingRef.current);
      });
    return prepareChain.current;
  }
  async function prepareFiles(files: File[], generation: number, controller: AbortController): Promise<void> {
    if (generation !== prepareGeneration.current || !stillCurrent(controller)) return;
    const current = attachmentsRef.current;
    const result = validateAttachmentBatch(current.map(attachment => attachment.file), files);
    if (!result.ok) { if (generation === prepareGeneration.current) setError(result.error); return; }
    if (generation !== prepareGeneration.current || !stillCurrent(controller)) return;
    const added: ConversationAttachment[] = [];
    try {
      for (const file of result.accepted) {
        const contentHash = await sha256Hex(await file.arrayBuffer());
        if (generation !== prepareGeneration.current || !stillCurrent(controller)) return;
        if (!/^[a-f0-9]{64}$/u.test(contentHash)) throw new Error("HASH");
        added.push({
          id: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
          manifest: {
            attachment_id: crypto.randomUUID(),
            file_name: file.name.slice(0, 200) || "image",
            media_type: file.type as ConversationImageManifest["media_type"],
            byte_size: file.size,
            content_hash: contentHash,
          },
        });
      }
      if (generation !== prepareGeneration.current || !stillCurrent(controller)) return;
      // Revalidate the committed batch as the single transaction: a concurrent
      // removal or a stale preparation may never push the set over its limits.
      const latest = attachmentsRef.current;
      const recheck = validateAttachmentBatch(latest.map(attachment => attachment.file), added.map(attachment => attachment.file));
      if (!recheck.ok) { setError(recheck.error); return; }
      setAttachmentState([...latest, ...added]);
    } catch {
      if (generation === prepareGeneration.current) setError("图片无法读取，未添加。请重试或换一张图片。");
    } finally {
      const committed = new Set(attachmentsRef.current.map(attachment => attachment.url));
      for (const attachment of added) if (!committed.has(attachment.url)) URL.revokeObjectURL(attachment.url);
    }
  }
  function removeAttachment(attachmentId: string) {
    const target = attachmentsRef.current.find(attachment => attachment.id === attachmentId);
    if (target) URL.revokeObjectURL(target.url);
    setAttachmentState(attachmentsRef.current.filter(attachment => attachment.id !== attachmentId));
  }

  async function submit(): Promise<boolean> {
    if (submitLock.current) return false;
    const objective = draftRef.current.trim();
    const capturedDraftValue = draftRef.current;
    const capturedAttachments = attachmentsRef.current.slice();
    if (!ready || !id || unavailable || preparingRef.current || (!objective && capturedAttachments.length === 0) || capturedDraftValue.length > 1000 || unresolvedConversationCount(local.current, snapshotRef.current) >= 50) return false;
    const controller = lifecycle.current;
    if (!controller) return false;
    // Single-flight from before the first await: a second Enter cannot create
    // a second message while the durable put or admission is still in flight.
    submitLock.current = true; setSubmitting(true); setError("");
    try {
      const messageId = crypto.randomUUID();
      const manifests = capturedAttachments.map(attachment => attachment.manifest);
      if (capturedAttachments.length > 0) {
        const durable = await persistConversationImages(scope, id, messageId, capturedAttachments.map((attachment, position): DurableConversationImage => ({ ...attachment.manifest, position, blob: attachment.file, expiresAt: expiry() })));
        if (!stillCurrent(controller)) { await removeConversationImages(scope, id, messageId); return false; }
        if (!durable) { setError("图片无法安全保存在本机，草稿和图片仍在输入框中。请恢复存储后重试。"); return false; }
      }
      const lastCreated = local.current.at(-1)?.createdAt;
      const message: LocalMessage = { id: messageId, objective, ...(manifests.length > 0 ? { images: manifests } : {}), createdAt: new Date(Math.max(Date.now(), lastCreated ? Date.parse(lastCreated) + 1 : 0)).toISOString(), delivery: "pending", receiptUncertain: false, expiresAt: expiry() };
      if (!writeConversationMessage(scope, id, message)) { await removeConversationImages(scope, id, messageId); setError("无法保存发送状态，内容仍在输入框中。请恢复浏览器存储后重试。"); return false; }
      if (!stillCurrent(controller)) { removeConversationMessage(scope, id, messageId); await removeConversationImages(scope, id, messageId); return false; }
      // Only clear the exact captured draft. Text typed while the put awaited
      // is newer intent and must survive.
      if (draftRef.current === capturedDraftValue) {
        const stamp = new Date().toISOString();
        if (writeConversationDraft(scope, id, { value: "", updatedAt: stamp, expiresAt: expiry(), writer: writer.current })) {
          draftStamp.current = stamp; draftRef.current = ""; setDraft("");
        }
      }
      // Remove only the captured thumbnails; images added during the put stay.
      const capturedIds = new Set(capturedAttachments.map(attachment => attachment.id));
      const remaining = attachmentsRef.current.filter(attachment => !capturedIds.has(attachment.id));
      for (const attachment of capturedAttachments) if (!remaining.some(candidate => candidate.id === attachment.id)) URL.revokeObjectURL(attachment.url);
      setAttachmentState(remaining);
      storeMessages([...local.current, message]); setError(""); return true;
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  async function retryDelivery(message: LocalMessage) {
    // First reconcile a lost receipt with an owner-authorized queue read. Only
    // an explicit retry can repeat its stable admission — and never when the
    // same-ID server row already owns the message.
    let confirmed = false;
    try {
      const response = await request(queueUrl);
      const next = await response.json() as ConversationQueueSnapshot;
      commitSnapshot(next);
      confirmed = Boolean(snapshotRef.current?.active?.message_id === message.id
        || (snapshotRef.current?.queued ?? []).some(item => item.message_id === message.id)
        || (detailRef.current?.turns ?? []).some(turn => turn.id === message.id));
      if (confirmed) { setServerExists(true); pendingHandoff.current = id; handoffWhenSettled(); }
      await refreshDetail();
      confirmed ||= Boolean(detailRef.current?.turns.some(turn => turn.id === message.id));
    }
    catch (caught) { if (caught instanceof RequestError && caught.status !== 404) { refuse(caught); if ([401, 403, 410].includes(caught.status)) return; } }
    if (confirmed) return;
    if (local.current.some(item => item.id === message.id)) updateMessage(message.id, { delivery: "pending", receiptUncertain: message.receiptUncertain ?? message.delivery === "unknown", error: undefined });
  }
  function discardRejectedDelivery(messageId: string) {
    if (!id || !local.current.some(message => message.id === messageId && message.delivery === "rejected")) return;
    // An unknown receipt must be reconciled; only a definitive rejection can
    // be removed locally without risking an invisible accepted intention.
    removeConversationMessage(scope, id, messageId);
    void removeConversationImages(scope, id, messageId);
    storeMessages(local.current.filter(message => message.id !== messageId));
  }
  async function mutate(input: Omit<ConversationQueueMutationRequest, "expected_revision" | "idempotency_key"> & { objective?: string; queue_entry_id?: string; run_id?: string }) {
    if (mutationBusy.current || !snapshotRef.current) return false;
    const withdrawnMessageId = input.kind === "withdraw"
      ? (snapshotRef.current.queued ?? []).find(entry => entry.queue_entry_id === input.queue_entry_id)?.message_id ?? null
      : null;
    mutationBusy.current = true; setMutating(true); setError("");
    try {
      const operation = crypto.randomUUID();
      let response: Response;
      try { response = await request(`${queueUrl}/mutations`, { method: "POST", body: JSON.stringify({ ...input, expected_revision: snapshotRef.current.revision, idempotency_key: operation }) }); }
      catch (caught) {
        // A concurrent admission may advance the queue while Stop is in flight.
        // Rebase only a rejected CAS and only while the same run still owns it.
        if (input.kind !== "stop" || !(caught instanceof RequestError) || caught.status !== 409) throw caught;
        const latest = await (await request(queueUrl)).json() as ConversationQueueSnapshot;
        commitSnapshot(latest);
        if (latest.active?.run_id !== input.run_id) return true;
        response = await request(`${queueUrl}/mutations`, { method: "POST", body: JSON.stringify({ ...input, expected_revision: latest.revision, idempotency_key: operation }) });
      }
      const body = await response.json(); commitSnapshot(body.snapshot);
      if (withdrawnMessageId) {
        // The reader explicitly removed this queued message; drop the local
        // copy and its bytes exactly like a definitive rejection removal.
        removeConversationMessage(scope, id!, withdrawnMessageId);
        void removeConversationImages(scope, id!, withdrawnMessageId);
        storeMessages(local.current.filter(message => message.id !== withdrawnMessageId));
      }
      return true;
    } catch (caught) {
      refuse(caught); setError(caught instanceof RequestError && caught.status === 409 ? "队列刚刚有变化，已更新。请核对后再操作。" : "操作结果尚未确认，已保留内容。请核对队列后重试。");
      try { const response = await request(queueUrl); const next = await response.json(); commitSnapshot(next); } catch { /* Keep the last known state. */ }
      return false;
    } finally { mutationBusy.current = false; if (!lifecycle.current?.signal.aborted) { setMutating(false); handoffWhenSettled(); } }
  }

  async function saveDraft(force = false) {
    if (!id || !serverExists || saving.current || unavailable || (!force && draftConflict) || draftRef.current === lastSaved.current || !detailRef.current) return;
    saving.current = true;
    const value = draftRef.current; const base = lastSaved.current;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await request(`/api/workspace-sessions/${id}`, { method: "PUT", body: JSON.stringify({ expected_revision: detailRef.current!.revision, idempotency_key: crypto.randomUUID(), composer_draft: value, composer_draft_updated_at: new Date().toISOString() }) }, detailBinding);
          const body = await response.json(); lastSaved.current = value; remoteDraftBaseline.current = value; applyDetail(body.detail); return;
        } catch (caught) {
          if (!(caught instanceof RequestError) || caught.status !== 409) throw caught;
          await refreshDetail();
          if ((detailRef.current?.composer_draft ?? "") !== base && !force) { setDraftConflict(true); return; }
        }
      }
    } catch (caught) { refuse(caught); /* The local draft remains durable; background retries never erase it. */ }
    finally { saving.current = false; }
  }
  useEffect(() => { if (!ready || !serverExists) return; const timer = setTimeout(() => { void saveDraft(); }, 750); return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, ready, serverExists, detail?.revision]);
  async function keepDraft() {
    // The reader explicitly keeps THEIR draft: acknowledge the remote value as
    // seen, then write deliberately.
    remoteDraftBaseline.current = detailRef.current?.composer_draft ?? remoteDraftBaseline.current;
    setDraftConflict(false);
    if (id) { const updatedAt = new Date().toISOString(); writeConversationDraft(scope, id, { value: draftRef.current, updatedAt, writer: writer.current, expiresAt: expiry() }); draftStamp.current = updatedAt; }
    await saveDraft(true);
  }
  async function remove() {
    if (!detailRef.current || !id) return false;
    try { const response = await request(`/api/workspace-sessions/${id}`, { method: "DELETE", body: JSON.stringify({ expected_revision: detailRef.current.revision, idempotency_key: crypto.randomUUID() }) }, detailBinding); const body = await response.json(); applyDetail(body.detail); return true; }
    catch (caught) { setError(caught instanceof Error ? caught.message : "删除尚未确认，请重试。"); await refreshDetail().catch(() => {}); return false; }
  }
  return { entryCapability, detail, draft, messages, attachments, preparing, submitting, snapshot, preview, connection, error, ready, unavailable, draftConflict, mutating, handoffEntries, handoffPreviews, runOutcome, readbackStalled, addFiles, removeAttachment, changeDraft, submit, retryDelivery, discardRejectedDelivery, mutate, keepDraft, remove, refreshDetail };
}
