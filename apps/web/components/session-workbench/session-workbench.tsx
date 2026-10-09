"use client";

import { forgetSessionOrganization } from "@/lib/workspace-session-organization";

import {
  Copy,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { QueuedConversation } from "../conversation/queued-conversation";
import { useWorkspaceChat } from "../relationship-workspace/use-workspace-chat";
import { ConversationProvenance, ConversationResponse } from "../conversation-response";
import { WorkspaceComposer } from "../workspace-composer";
import { workspaceSessionFetch } from "@/components/workspace-session-request";
import {
  subscribeWorkspaceRefresh,
  workspaceRefreshGeneration,
} from "@/lib/workspace-refresh";
import { applyOpenSessionRefresh } from "./session-open-refresh";

import {
  applyDraftInput,
  applyReload,
  buildSaveRequest,
  canDeleteSession,
  deletedNotice,
  initialDetailState,
  isDetailConflictResponse,
  isDetailGoneResponse,
  markConflict,
  markDeleted,
  markSaveError,
  markSaved,
  markSaving,
  shouldRetainDraftAfterConflict,
  type SaveRequestBody,
  type DetailState,
  type SessionDetail,
} from "./session-detail-state";
import { SessionSaveDrain, type SaveDrainContext } from "./session-save-drain";
import {
  beginPendingSessionDraft,
  clearPendingSessionDraft,
  createPendingSessionDraft,
  pendingSessionDraftRequest,
  prunePendingSessionDrafts,
  readPendingSessionDraft,
  rebasePendingSessionDraft,
  resolvePendingSessionDraft,
  writePendingSessionDraft,
  type PendingSessionDraft,
} from "./session-draft-pending";
import {
  canPersistSessionDraft,
  captureSessionSendCleanupIdentity,
  clearSentDraftStorage,
  forcedNoopCleanupKey,
  planDraftPersistence,
  resolveSessionSendCompletion,
} from "./session-send-cleanup";
import {
  conflictView,
  draftStatusLabel,
  formatSessionTime,
  sessionDisplayTitle,
  sessionExpiryNotice,
  sessionScopeView,
  sessionStateLabel,
  sessionStateNotice,
  shouldPersistDraft,
} from "./session-view";
import {
  conversationNearBottom,
  conversationScrollBehavior,
  sessionBlockTitle,
  sessionSupportsSend,
  sessionTurnBlocks,
} from "./session-presentation";
import styles from "./session-workbench.module.css";
import chatStyles from "./session-conversation.module.css";

const DEBOUNCE_MS = 900;

type Props = {
  meetingLinks?: Array<{id: string; title: string}>;
  meetingReadFailed?: boolean;
  accountId?: string;
  chatSessionVersion?: string;
  entryCapability?: string | null;
  initialDetail: SessionDetail;
  sessionVersion: string | null;
  initialError: string | null;
  sessionRecoveryHref: string | null;
  storageScope: string;
};

type DetailResponse = {
  code?: string;
  detail?: SessionDetail;
  message?: string;
  session_version?: string;
};

export function SessionWorkbench(props: Props) {
  const eligible = props.initialDetail.scope_kind === "unresolved_intent" && props.chatSessionVersion && props.sessionVersion;
  if (!eligible) return <LegacySessionWorkbench {...props}/>;
  return <SessionComposerMode key={`${props.storageScope}:${props.initialDetail.session_id}:${props.chatSessionVersion}:${props.sessionVersion}`} {...props}/>;
}

function SessionComposerMode(props: Props) {
  const [legacy, setLegacy] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    // Background tabs may never receive an animation frame. Resolve storage
    // before mounting either composer so the legacy path cannot send or save
    // during the hydration window and create its own recovery marker.
    void Promise.resolve().then(() => {
      if (mounted) setLegacy(Boolean(readPendingSessionDraft(props.storageScope, props.initialDetail.session_id)));
    });
    return () => { mounted = false; };
  }, [props.storageScope, props.initialDetail.session_id]);
  if (legacy === null) return <section aria-label="正在加载对话"><h1>{props.initialDetail.title}</h1><p role="status">正在加载对话…</p></section>;
  if (!legacy) return <QueuedConversation initialDetail={props.initialDetail} scope={props.storageScope} chatBinding={props.chatSessionVersion!} detailBinding={props.sessionVersion!} meetingLinks={props.meetingLinks} meetingReadFailed={props.meetingReadFailed} entryCapability={props.entryCapability ?? null}/>;
  return <LegacySessionWorkbench {...props}/>;
}

function LegacySessionWorkbench({
  initialDetail,
  meetingLinks = [],
  meetingReadFailed = false,
  accountId,
  chatSessionVersion,
  sessionVersion,
  initialError,
  sessionRecoveryHref,
  storageScope,
}: Props) {
  const router = useRouter();
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [state, setState] = useState<DetailState>(() =>
    initialDetailState(initialDetail),
  );
  const [binding, setBinding] = useState(sessionVersion);
  const [busy, setBusy] = useState<"reload" | "delete" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState(initialError ?? "");
  const [sending, setSending] = useState(false);
  const [sendPending, setSendPending] = useState(false);
  const sendLock = useRef(false);
  const sendAttempt = useRef<PendingSessionDraft | null>(null);
  const { ask } = useWorkspaceChat(accountId ?? null, chatSessionVersion ?? null,
    state.detail.state === "active" && state.detail.scope_kind === "unresolved_intent", setNotice);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveAttemptRef = useRef<SaveRequestBody | null>(null);
  const pendingDraftRef = useRef<PendingSessionDraft | null>(null);
  const foreignPendingRef = useRef(false);
  const saveDrainRef = useRef(new SessionSaveDrain());
  const deleteKeyRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  const bindingRef = useRef(binding);
  stateRef.current = state;
  bindingRef.current = binding;

  // Conversation canvas structure: one named details disclosure and one named
  // scroll region. Neither stores conversation content, only viewport state.
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const detailsSummaryRef = useRef<HTMLElement>(null);
  const transcriptRef = useRef<HTMLElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingDelete = useRef(false);

  useEffect(() => {
    if (confirmingDelete) deleteCancelRef.current?.focus();
    else if (wasConfirmingDelete.current) {
      const trigger = deleteTriggerRef.current;
      if (trigger && !trigger.disabled && detailsRef.current?.open) trigger.focus();
      else detailsSummaryRef.current?.focus();
    }
    wasConfirmingDelete.current = confirmingDelete;
  }, [confirmingDelete]);
  const followLatestRef = useRef(true);
  const landedRef = useRef(false);
  const [awayFromLatest, setAwayFromLatest] = useState(false);

  const commitState = useCallback((update: (current: DetailState) => DetailState) => {
    const next = update(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  // Outside pointer/focus closes the details disclosure without stealing focus.
  useEffect(() => {
    function closeFromOutside(event: Event) {
      const node = detailsRef.current;
      if (
        node?.open &&
        event.target instanceof Node &&
        !node.contains(event.target)
      ) {
        node.open = false;
      }
    }
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("focusin", closeFromOutside);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("focusin", closeFromOutside);
    };
  }, []);

  // Passive scroll tracking: incoming turns follow only while the reader is
  // already at the latest message. Reopening lands at the latest turn once.
  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    function update() {
      if (!node) return;
      const near = conversationNearBottom({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
      });
      followLatestRef.current = near;
      setAwayFromLatest(!near);
    }
    update();
    node.addEventListener("scroll", update, { passive: true });
    // A growing draft, recovery notice, or shorter window changes the reading
    // viewport without a scroll event. Preserve the reader's previous intent.
    const resize = new ResizeObserver(() => {
      if (followLatestRef.current) node.scrollTop = node.scrollHeight;
      update();
    });
    resize.observe(node);
    return () => {
      resize.disconnect();
      node.removeEventListener("scroll", update);
    };
  }, []);

  // Shared active refresh for the OPEN conversation: foreground, focus,
  // network recovery and the bounded active interval merge newly committed
  // remote turns and tombstones while the composing draft, IME composition,
  // pending writes and the reader's scroll intent stay exactly as they are.
  // Late completions are fenced by the scope generation and the mounted scope.
  const detailIdentity = state.detail.session_id;
  useEffect(() => {
    if (state.detail.state !== "active") forgetSessionOrganization(storageScope, state.detail.session_id);
  }, [state.detail.state, state.detail.session_id, storageScope]);

  useEffect(() => {
    if (state.detail.state !== "active" || !storageScope) return;
    let disposed = false;
    const unsubscribe = subscribeWorkspaceRefresh(storageScope, (_reason, generation) => {
      void (async () => {
        const activeBinding = bindingRef.current;
        if (!activeBinding) return;
        try {
          const readback = await readSession(detailIdentity, activeBinding);
          if (disposed || !mounted.current || !readback) return;
          commitState((current) => {
            const result = applyOpenSessionRefresh(current, readback, {
              generation,
              activeGeneration: workspaceRefreshGeneration(storageScope),
              sessionId: detailIdentity,
            });
            // A stale scope drop keeps every byte of local state; a failed
            // refresh keeps recovery state and never claims synchronization.
            return result.kind === "stale" ? current : result.state;
          });
        } catch {
          // Offline or failed read: the previous conversation and draft stay
          // available with their existing recovery affordances.
        }
      })();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [storageScope, detailIdentity, state.detail.state, commitState]);

  const turnCount = state.detail.turns.length;
  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    if (!landedRef.current) {
      landedRef.current = true;
      node.scrollTop = node.scrollHeight;
      return;
    }
    if (!followLatestRef.current) return;
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollTo({
      behavior: conversationScrollBehavior(reducedMotion),
      top: node.scrollHeight,
    });
  }, [turnCount]);

  const detail = state.detail;
  const scope = sessionScopeView({
    contextLabel: detail.context_label,
    personId: detail.person_id,
    personLabel: detail.person_label,
    relationshipContextId: detail.relationship_context_id,
    scopeKind: detail.scope_kind,
    sessionId: detail.session_id,
  });

  const clearDurableDraft = useCallback(
    (expectedIdempotencyKey?: string) => {
      clearPendingSessionDraft(
        storageScope,
        initialDetail.session_id,
        expectedIdempotencyKey,
      );
    },
    [initialDetail.session_id, storageScope],
  );

  useEffect(() => {
    prunePendingSessionDrafts(storageScope);
    const recovered = readPendingSessionDraft(
      storageScope,
      initialDetail.session_id,
    );
    if (!recovered) return;
    if (recovered.purpose === "session-send") {
      sendAttempt.current = recovered;
      setSendPending(true);
      commitState(previous => ({ ...previous, draft: recovered.latest.draft, status: "idle" }));
      setNotice("上次发送结果尚未确认。重试会核对同一条消息，不会另建对话。");
      return;
    }
    const resolution = resolvePendingSessionDraft(
      recovered,
      stateRef.current.detail,
    );
    if (resolution.kind === "settled" || resolution.kind === "unavailable") {
      clearDurableDraft(recovered.latest.idempotencyKey);
      return;
    }
    const pending = resolution.kind === "continue" ? resolution.pending : recovered;
    pendingDraftRef.current = pending;
    if (resolution.kind === "continue") writePendingSessionDraft(pending);
    commitState((previous) => {
      const restored = applyDraftInput(previous, pending.latest.draft);
      return resolution.kind === "conflict" ? markConflict(restored) : restored;
    });
    setNotice(
      resolution.kind === "conflict"
        ? "已恢复离开前的本机草稿；服务端版本已变化，不会自动覆盖。"
        : "已恢复离开前尚未确认保存的草稿。",
    );
  }, [clearDurableDraft, commitState, initialDetail.session_id, storageScope]);

  const executePersist = useCallback(
    async ({ force, isCurrent }: SaveDrainContext) => {
      if (sendAttempt.current) return;
      const current = stateRef.current;
      if (!canPersistSessionDraft(current)) return;
      const activeBinding = bindingRef.current;
      if (!activeBinding) return;
      let durablePending = pendingDraftRef.current;
      let request = saveAttemptRef.current;
      if (
        !request &&
        durablePending?.latest.draft === current.draft &&
        current.draft !== current.lastSavedDraft
      ) {
        durablePending = beginPendingSessionDraft(
          durablePending,
          current.detail.revision,
        );
        pendingDraftRef.current = durablePending;
        if (!writePendingSessionDraft(durablePending)) {
          setNotice("本机草稿恢复存储不可用；请等待保存完成后再离开。");
        }
        request = pendingSessionDraftRequest(
          durablePending,
          current.detail.revision,
        );
      }
      request ??= buildSaveRequest(
        current,
        crypto.randomUUID(),
        new Date().toISOString(),
      );
      if (!request) {
        if (force && current.detail.state === "active") {
          saveAttemptRef.current = null;
          const cleanupKey = forcedNoopCleanupKey({
            foreign: foreignPendingRef.current,
            pending: pendingDraftRef.current,
          });
          if (cleanupKey) {
            clearDurableDraft(cleanupKey);
            pendingDraftRef.current = null;
            foreignPendingRef.current = false;
          }
        }
        return;
      }
      saveAttemptRef.current = request;
      commitState(markSaving);
      try {
        const response = await workspaceSessionFetch(
          `/api/workspace-sessions/${encodeURIComponent(current.detail.session_id)}`,
          {
            body: JSON.stringify(request),
            cache: "no-store",
            headers: {
              "content-type": "application/json",
              "x-workspace-session": activeBinding,
            },
            keepalive: true,
            method: "PUT",
          },
        );
        const payload = (await response.json()) as DetailResponse;
        if (!isCurrent()) return;
        if (payload.session_version) {
          bindingRef.current = payload.session_version;
          setBinding(payload.session_version);
        }
        if (isDetailConflictResponse(response.status)) {
          if (saveAttemptRef.current === request) saveAttemptRef.current = null;
          if (!shouldRetainDraftAfterConflict(response.status, payload.code)) {
            pendingDraftRef.current = null;
            foreignPendingRef.current = false;
            clearDurableDraft();
            setNotice(payload.message || "登录已改变，请重新打开这段对话。");
          }
          commitState(markConflict);
          return;
        }
        if (isDetailGoneResponse(response.status)) {
          if (saveAttemptRef.current === request) saveAttemptRef.current = null;
          pendingDraftRef.current = null;
          foreignPendingRef.current = false;
          clearDurableDraft();
          setNotice(payload.message || "这段对话已删除或过期。");
          try {
            const readback = await readSession(current.detail.session_id, activeBinding);
            if (!isCurrent()) return;
            if (readback) commitState((previous) => markDeleted(previous, readback));
          } catch {
            if (isCurrent()) {
              commitState((previous) =>
                markSaveError(previous, payload.message || "内容不可用。"),
              );
            }
          }
          return;
        }
        if (!response.ok || !payload.detail) {
          throw new Error(payload.message || "保存失败。");
        }
        if (payload.detail.state !== "active") {
          forgetSessionOrganization(storageScope, payload.detail.session_id);
          if (saveAttemptRef.current === request) saveAttemptRef.current = null;
          pendingDraftRef.current = null;
          foreignPendingRef.current = false;
          clearDurableDraft();
          commitState((previous) =>
            markDeleted(previous, payload.detail as SessionDetail),
          );
          return;
        }
        if (saveAttemptRef.current === request) saveAttemptRef.current = null;
        const latestPending = pendingDraftRef.current;
        if (latestPending?.latest.idempotencyKey === request.idempotency_key) {
          clearDurableDraft(request.idempotency_key);
          pendingDraftRef.current = null;
          foreignPendingRef.current = false;
        } else if (latestPending) {
          const rebased = rebasePendingSessionDraft(
            latestPending,
            payload.detail.revision,
          );
          pendingDraftRef.current = rebased;
          if (!writePendingSessionDraft(rebased)) {
            setNotice("本机草稿恢复存储不可用；请等待保存完成后再离开。");
          }
        }
        commitState((previous) =>
          markSaved(
            previous,
            payload.detail as SessionDetail,
            request.composer_draft,
          ),
        );
      } catch (caught) {
        if (isCurrent()) {
          commitState((previous) =>
            markSaveError(
              previous,
              caught instanceof Error ? caught.message : "保存失败，草稿仍在本机。",
            ),
          );
        }
      }
    },
    [clearDurableDraft, commitState, storageScope],
  );

  const persist = useCallback(
    (force = false) => saveDrainRef.current.run(executePersist, force),
    [executePersist],
  );

  const updateDraft = useCallback(
    (value: string) => {
      const current = stateRef.current;
      const plan = planDraftPersistence({
        adopted: foreignPendingRef.current ? pendingDraftRef.current : null,
        current,
        idempotencyKey: crypto.randomUUID(),
        predecessor: saveAttemptRef.current,
        sessionId: current.detail.session_id,
        storageScope,
        updatedAt: new Date().toISOString(),
        value,
      });
      foreignPendingRef.current = plan.foreign;
      pendingDraftRef.current = plan.pending;
      if (plan.clear) clearDurableDraft();
      if (plan.write && plan.pending && !writePendingSessionDraft(plan.pending)) {
        setNotice("本机草稿恢复存储不可用；请等待保存完成后再离开。");
      }
      commitState(() => plan.state);
    },
    [clearDurableDraft, commitState, storageScope],
  );

  // Debounced persistence. Lifecycle flush keeps a committed draft from being
  // lost when the tab is backgrounded or removed.
  useEffect(() => {
    if (state.status !== "pending" || sending || sendPending) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist();
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state.draft, state.status, persist, sending, sendPending]);

  useEffect(() => {
    const saveDrain = saveDrainRef.current;
    function flush() {
      const current = stateRef.current;
      if (sendAttempt.current) return;
      if (
        current.detail.state === "active" &&
        shouldPersistDraft({
          debounceMs: 0,
          elapsedMs: 0,
          lastSaved: current.lastSavedDraft,
          next: current.draft,
          status: current.status,
        })
      ) {
        void persist();
      }
    }
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      saveDrain.invalidate();
    };
  }, [persist]);

  async function reload() {
    const activeBinding = bindingRef.current;
    if (!activeBinding) return;
    saveDrainRef.current.invalidate();
    setBusy("reload");
    setNotice("");
    try {
      const readback = await readSession(detail.session_id, activeBinding);
      if (readback) {
        commitState((previous) => {
          const next = applyReload(previous, readback);
          saveAttemptRef.current = null;
          deleteKeyRef.current = null;
          return next;
        });
        setNotice("已载入最新版本；你的草稿仍保留在上方输入框中。");
      }
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "无法重新载入。");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (sendAttempt.current || sending) return;
    const activeBinding = bindingRef.current;
    if (!activeBinding) return;
    saveDrainRef.current.invalidate();
    setBusy("delete");
    setNotice("");
    try {
      const response = await workspaceSessionFetch(
        `/api/workspace-sessions/${encodeURIComponent(detail.session_id)}`,
        {
          body: JSON.stringify({
            expected_revision: detail.revision,
            idempotency_key:
              deleteKeyRef.current ??
              (deleteKeyRef.current = crypto.randomUUID()),
          }),
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "x-workspace-session": activeBinding,
          },
          method: "DELETE",
        },
      );
      const payload = (await response.json()) as DetailResponse;
      if (payload.session_version) {
        bindingRef.current = payload.session_version;
        setBinding(payload.session_version);
      }
      if (isDetailConflictResponse(response.status)) {
        setConfirmingDelete(false);
        deleteKeyRef.current = null;
        commitState(markConflict);
        return;
      }
      if (!response.ok || !payload.detail) {
        throw new Error(payload.message || "删除失败。");
      }
      setConfirmingDelete(false);
      deleteKeyRef.current = null;
      pendingDraftRef.current = null;
      foreignPendingRef.current = false;
      clearDurableDraft();
      commitState((previous) =>
        markDeleted(previous, payload.detail as SessionDetail),
      );
      setNotice(deletedNotice());
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "删除失败。");
    } finally {
      setBusy(null);
    }
  }

  async function sendMessage() {
    if (sendLock.current || sending || !accountId || !chatSessionVersion || stateRef.current.detail.state !== "active" || stateRef.current.detail.scope_kind !== "unresolved_intent") return;
    const objective = stateRef.current.draft.trim();
    if (!objective || objective.length > 1000 || stateRef.current.conflict) return;
    sendLock.current = true;
    setSending(true);
    if (timer.current) clearTimeout(timer.current);
    try {
      if (!sendAttempt.current) {
        await persist(true);
        if (!mounted.current) return;
        await saveDrainRef.current.whenIdle();
        if (!mounted.current) return;
        const current = stateRef.current;
        if (current.conflict || current.status === "error" || current.detail.state !== "active") return;
        const cleanup = captureSessionSendCleanupIdentity(current);
        sendAttempt.current = {
          ...createPendingSessionDraft({
            storageScope, sessionId: current.detail.session_id, baseRevision: current.detail.revision,
            draft: objective, idempotencyKey: crypto.randomUUID(), updatedAt: new Date().toISOString(), predecessor: null,
          }),
          purpose: "session-send",
          ...(cleanup ? { cleanup } : {}),
        };
        if (!writePendingSessionDraft(sendAttempt.current)) {
          sendAttempt.current = null;
          setNotice("无法保存发送状态，请恢复浏览器存储后重试。草稿仍保留。");
          return;
        }
        setSendPending(true);
      }
      if (!mounted.current) return;
      const attempt = sendAttempt.current;
      const delivered = await ask(attempt.latest.draft, {
        sessionId: attempt.sessionId, requestId: attempt.latest.idempotencyKey,
      });
      if (!mounted.current || !delivered || !bindingRef.current) return;
      const readback = await readSession(attempt.sessionId, bindingRef.current);
      if (!mounted.current || !readback) return;
      const storageStatus = clearSentDraftStorage(
        storageScope,
        attempt.sessionId,
        attempt.latest.idempotencyKey,
      );
      const competing =
        storageStatus === "competing"
          ? readPendingSessionDraft(storageScope, attempt.sessionId)
          : null;
      const completion = resolveSessionSendCompletion({
        competing,
        identity: attempt.cleanup,
        readback,
        storage: storageStatus,
      });
      saveAttemptRef.current = null;
      sendAttempt.current = null;
      setSendPending(false);
      foreignPendingRef.current = completion.foreign;
      pendingDraftRef.current = completion.pending;
      commitState(() => completion.state);
      if (completion.cleanupWrite) {
        // The readback exact-matches the draft captured before the ask. Empty
        // it with the readback revision as the CAS guard; persist() derives
        // the request from this state and never writes a new local pending
        // record, so a competing pending draft cannot be replaced.
        await persist(true);
        if (!mounted.current) return;
      }
      setNotice(completion.notice);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "发送结果尚未确认，请重试同一条消息。");
    } finally { sendLock.current = false; if (mounted.current) setSending(false); }
  }

  function endSendRetry() {
    if (sending) return;
    const attempt = sendAttempt.current;
    if (attempt) clearDurableDraft(attempt.latest.idempotencyKey);
    sendAttempt.current = null;
    setSendPending(false);
    setNotice("已结束重试，草稿保留。上一条消息可能已完成，可重新载入核对历史。");
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(state.draft);
      setNotice("草稿已复制到剪贴板。");
    } catch {
      setNotice("无法访问剪贴板，请手动选择并复制草稿。");
    }
  }

  const stateNotice = sessionStateNotice(detail.state);
  const expiryNotice = sessionExpiryNotice(detail.expires_at);
  const statusLabel = draftStatusLabel(state.status);
  const canAsk = sessionSupportsSend(detail);
  const deleteWarning = confirmingDelete
    ? "删除后历史内容不再提供，也无法在本机恢复。请确认要删除这条对话。"
    : null;

  // Retrying an unconfirmed send is still a submission; the explicit retry
  // button and Enter both reuse the stored attempt.
  const canSend = Boolean(
    accountId &&
      chatSessionVersion &&
      canAsk &&
      !state.conflict &&
      !sending &&
      state.draft.trim().length > 0 &&
      state.draft.trim().length <= 1000,
  );

  function jumpToLatest() {
    const node = transcriptRef.current;
    if (!node) return;
    followLatestRef.current = true;
    setAwayFromLatest(false);
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollTo({
      behavior: conversationScrollBehavior(reducedMotion),
      top: node.scrollHeight,
    });
  }

  function closeDetails(returnFocus = false) {
    if (detailsRef.current) detailsRef.current.open = false;
    if (returnFocus) detailsSummaryRef.current?.focus();
  }

  return (
    <section
      aria-labelledby="session-title"
      className={chatStyles.conversation}
      data-conversation-canvas="session"
    >
      <header className={chatStyles.header}>
        <div className={chatStyles.headingText}>
          <h1 className={chatStyles.title} id="session-title">
            {sessionDisplayTitle(detail.title)}
          </h1>
          <p className={chatStyles.subtitle}>{scope.label}</p>
        </div>
        <details
          className={chatStyles.conversationDetails}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeDetails(true);
            }
          }}
          ref={detailsRef}
        >
          <summary ref={detailsSummaryRef}>对话详情</summary>
          <div className={chatStyles.detailsPanel}>
            <p className={styles.metaLine}>
              {scope.label} · {sessionStateLabel(detail.state)} ·{" "}
              {formatSessionTime(detail.updated_at)}
            </p>
            <p>{scope.note}</p>
            <Link className={styles.primary} href={scope.returnHref}>
              {scope.returnLabel}
            </Link>
            <div className={styles.actions}>
              <button
                className={styles.secondary}
                disabled={
                  !canPersistSessionDraft(state) ||
                  state.status === "saving" ||
                  sending ||
                  sendPending
                }
                onClick={() => void persist(true)}
                type="button"
              >
                立即保存
              </button>
              <button
                className={styles.secondary}
                disabled={detail.state !== "active"}
                onClick={() => void copyDraft()}
                type="button"
              >
                <Copy aria-hidden="true" size={16} />
                <span>复制草稿</span>
              </button>
              {detail.state === "active" ? (
                confirmingDelete ? (
                  <>
                    <button
                      className={styles.danger}
                      disabled={busy !== null}
                      onClick={() => void remove()}
                      type="button"
                    >
                      {busy === "delete" ? "正在删除…" : "确认删除"}
                    </button>
                    <button
                      className={styles.secondary}
                      disabled={busy !== null}
                      ref={deleteCancelRef}
                      onClick={() => setConfirmingDelete(false)}
                      type="button"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.secondary}
                    disabled={!canDeleteSession(state) || sending || sendPending}
                    ref={deleteTriggerRef}
                    onClick={() => setConfirmingDelete(true)}
                    type="button"
                  >
                    <Trash aria-hidden="true" size={16} />
                    <span>删除对话</span>
                  </button>
                )
              ) : null}
            </div>
          </div>
        </details>
      </header>

      <div className={chatStyles.feedback}>
        {deleteWarning ? (
          <p className={styles.warning} role="status">
            {deleteWarning}
          </p>
        ) : null}
        {stateNotice ? (
          <p className={styles.warning} role="status">
            {stateNotice}
          </p>
        ) : null}
        {expiryNotice && detail.state === "active" ? (
          <p className={styles.hint} role="status">
            {expiryNotice}
          </p>
        ) : null}
        {notice && notice !== "消息已保存。" ? (
          <p className={styles.notice} role="status">
            {notice}
            {sessionRecoveryHref ? (
              <>
                {" "}
                <Link href={sessionRecoveryHref}>重新登录</Link>
              </>
            ) : null}
          </p>
        ) : null}

        {state.conflict ? (
          <div className={styles.conflict} role="alert">
            <Warning aria-hidden="true" size={18} />
            <div>
              <p>{conflictView().message}</p>
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={busy !== null}
                  onClick={() => void reload()}
                  type="button"
                >
                  {busy === "reload" ? "正在载入…" : conflictView().reloadLabel}
                </button>
                <button
                  className={styles.secondary}
                  onClick={() => void copyDraft()}
                  type="button"
                >
                  <Copy aria-hidden="true" size={16} />
                  <span>{conflictView().keepDraftLabel}</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <section
        aria-label="对话历史"
        className={chatStyles.transcript}
        ref={transcriptRef}
        tabIndex={0}
      >
        {detail.turns.length === 0 ? (
          <p className={styles.hint}>
            {detail.state === "active"
              ? "这条对话还没有回复。你可以在下方写下要保留的内容。"
              : "没有可显示的历史内容。"}
          </p>
        ) : (
          <ol className={chatStyles.turnList}>
            {detail.turns.map((turn) => {
              const blocks = sessionTurnBlocks(turn.response);
              return (
                <li className={chatStyles.turn} key={turn.id}>
                  <p className={chatStyles.userMessage}>{turn.objective}</p>
                  <p className={chatStyles.messageMeta}>
                    {formatSessionTime(turn.createdAt)}
                  </p>
                  {blocks.length ? (
                    <div className={chatStyles.assistantMessage}>
                      <p className={chatStyles.assistantLabel}>Talent Signal</p>
                      {blocks.map((block) => {
                        const title = sessionBlockTitle(block.title);
                        return (
                          <article key={block.id}>
                            {title ? <h3>{title}</h3> : null}
                            <ConversationResponse foldable={block.kind === "answer" && !block.requires_user_decision} lead={!title}>{block.body}</ConversationResponse>
                            <ConversationProvenance sources={block.public_source_refs} />
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {meetingLinks.length > 0 ? <aside aria-label="待审阅日程">
        <p>这条对话中的会议草稿</p>
        {meetingLinks.map(item => <Link key={item.id} href={`/workspace/meetings?draft=${item.id}`}>审阅 {item.title}</Link>)}
      </aside> : null}
      {meetingReadFailed ? <p role="status">暂时无法读取关联日程。<Link href="/workspace/meetings">打开日程重试</Link></p> : null}
      <section aria-label="草稿" className={chatStyles.composerDock}>
        {awayFromLatest ? (
          <button className={chatStyles.jumpToLatest} onClick={jumpToLatest} type="button">
            回到最新消息
          </button>
        ) : null}
        <WorkspaceComposer
          binding={binding}
          canSubmit={canSend}
          describedBy="session-draft-status"
          disabled={detail.state !== "active"}
          footerEnd={
            <div className={styles.actions}>
              {sendPending && !sending ? <button className={styles.secondary} type="button" onClick={endSendRetry}>保留草稿，结束重试</button> : null}
              {accountId && chatSessionVersion && canAsk ? <button className={`${styles.primary} ${styles.send}`} aria-label={sending ? "发送中" : sendPending ? "重试同一条消息" : "发送"} title="发送 · Enter" type="button"
                disabled={!canSend}
                onClick={() => void sendMessage()}><span>{sending ? "发送中" : sendPending ? "重试" : "发送"}</span></button> : null}
            </div>
          }
          footerStart={
            <p
              className={
                state.status === "error" || state.conflict
                  ? styles.error
                  : styles.status
              }
              id="session-draft-status"
              role={state.status === "error" ? "alert" : "status"}
            >
              {sending ? "正在回复…" : statusLabel}
              {state.error ? ` ${state.error}` : ""}
            </p>
          }
          id="session-composer-draft"
          label="继续这条对话"
          maxLength={12_000}
          onNavigate={(href) => router.push(href)}
          onSubmit={() => void sendMessage()}
          onValueChange={updateDraft}
          placeholder={detail.state === "active" ? "输入消息，或粘贴一段内容…" : "对话不可用，无法编辑草稿。"}
          readOnly={sending || sendPending}
          rows={3}
          suggestionsEnabled={
            detail.state === "active" && !sending && !sendPending && !state.conflict
          }
          value={state.draft}
          variant="session"
        />
        {detail.state === "active" ? (
          <p className={canAsk ? chatStyles.keyboardHint : styles.hint}>
            {canAsk
              ? "Enter 发送 · Shift+Enter 换行"
              : <Link href={scope.returnHref}>{scope.returnLabel}</Link>}
          </p>
        ) : null}
      </section>
    </section>
  );
}

async function readSession(
  sessionId: string,
  binding: string,
): Promise<SessionDetail | null> {
  const response = await workspaceSessionFetch(
    `/api/workspace-sessions/${encodeURIComponent(sessionId)}`,
    { cache: "no-store", headers: { "x-workspace-session": binding } },
  );
  const payload = (await response.json()) as DetailResponse;
  if (!response.ok || !payload.detail) {
    throw new Error(payload.message || "无法读取这段对话。");
  }
  return payload.detail;
}
