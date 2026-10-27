"use client";

import { ArrowDown, ArrowUp, DotsThree, PencilSimple, Trash, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ThreadPrimitive } from "@assistant-ui/react";
import { conversationHome } from "@/lib/conversation-local";
import {
  conversationRunKeyAction,
  conversationStageLabel,
} from "@/lib/conversation-execution";
import type { LegacyConversationRecovery } from "@/lib/conversation-legacy";
import { WORKSPACE_NEW_CONVERSATION_EVENT } from "@/lib/workspace-navigation";
import type { ConversationImageManifest, ConversationQueueEntry, MemoryProposalItem } from "@talent-signal/contracts";
import type { LocalMessage } from "@/lib/conversation-local";
import { WorkspaceComposer } from "../workspace-composer";
import { useLocale, useT, type TFunction } from "../locale-provider";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import { conversationNearBottom } from "../session-workbench/session-presentation";
import { LegacyRecoveryNotice } from "./legacy-recovery-notice";
import { SessionSendTime } from "./session-execution-card";
import { useConversation } from "./use-conversation";
import { useConversationAxis } from "./use-conversation-axis";
import { useConversationReadingPosition } from "./use-conversation-reading-position";
import { usePreviewPacing } from "./use-preview-pacing";
import { useRunMilestones } from "./use-run-milestones";
import { sessionHumanMessages, sessionMessages, SessionAssistantMessage, SessionUserMessage } from "./session-message-parts";
import { createAnswerSeamRegistry } from "./answer-seam";
import { conversationWorkStatus, unresolvedConversationCount, type ConversationWorkStatus } from "./conversation-feedback";
import { SessionTaskCapsule, SessionTaskProvider } from "./session-task-capsule";
import { SessionRuntime } from "./session-runtime";
import { usePersonContextPanel } from "../person-context-panel";
import styles from "./queued-conversation.module.css";
// Admission may rewrite the draft URL only when the query is empty or holds
// exactly one draft_session parameter for this session. A duplicated key or
// any extra parameter is a separate navigation intent whose contents
// admission must not discard.
function onlyDraftSessionSearch(search: string, sessionId: string): boolean {
  if (search === "" || search === "?") return true;
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  return keys.length === 1 && keys[0] === "draft_session" && params.getAll("draft_session").length === 1 && params.get("draft_session") === sessionId;
}
export function displayText(objective: string, images: readonly ConversationImageManifest[] | undefined): string {
  if (objective.trim()) return objective;
  // An attached image strip already renders this message; its per-image alt
  // text plus the loading/error/retry states carry the accessible meaning, so
  // no redundant visible image placeholder is shown. Without an attachment
  // the (empty) objective is returned unchanged.
  return images?.length ? "" : objective;
}

/**
 * Bounded failure copy for a failed or interrupted queue entry.
 *
 * The default (no translator) return is compatibility-stable: each zh-CN
 * source string is its own gettext key, so the untranslated call returns
 * exactly the historical copy. Rendering passes `useT()` to localize at the
 * boundary; raw provider or backend errors never reach this text.
 */
export function queueFailureText(code: string | null, hasImages: boolean, t?: TFunction): string {
  const key = code === "MODEL_RUN_TOKEN_BUDGET_EXHAUSTED" || code === "CLAUDE_HARNESS_TOKEN_BUDGET_EXHAUSTED"
    ? hasImages
      ? "图片分析已达到本次处理的 token 预算，原图已保留。可重试或移除。"
      : "本次处理已达到 token 预算，消息已保留。可重试或移除。"
    : code === "MODEL_RUN_TIMEOUT"
      ? hasImages
        ? "图片分析超时，原图已保留。可重试；反复失败时请移除并重新发送较小的图片。"
        : "本次处理超时，消息已保留。可重试。"
      : "上次未完成，请重试或移除";
  return t ? t(key) : key;
}

type QueueEditOperation = {
  entry: string;
  owner: symbol;
  sessionId: string | null;
  token: symbol;
  focusOwned: boolean;
  saveToken: symbol | null;
};

/** Body is a valid fallback only after this editor actually owned focus and
 * no explicit pointer or focus transfer relinquished that ownership. */
function editorOwnedFocus(form: HTMLFormElement | null, operation: QueueEditOperation | null): boolean {
  const active = document.activeElement;
  return Boolean(operation?.focusOwned && (!active || active === document.body || form?.contains(active)));
}

type Props = { bootstrap?: { sessionId: string; capability: string } | null; focusComposer?: boolean; initialDetail?: SessionDetail; scope: string; chatBinding: string; detailBinding: string; meetingLinks?: Array<{id: string; title: string}>; meetingReadFailed?: boolean; legacyRecovery?: LegacyConversationRecovery | null; entryCapability?: string | null };
export function QueuedConversation(props: Props) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [id, setId] = useState<string | null>(props.initialDetail?.session_id ?? null);
  const [admitted, setAdmitted] = useState(Boolean(props.initialDetail));
  const handedOff = useRef(Boolean(props.initialDetail));
  const navigating = useRef(false);
  // Home admits the exact draft's compose intent before bootstrap canonicalizes
  // its URL. Keep it only for this mount, until the asynchronous editor is ready.
  const focusRequested = useRef(props.focusComposer ?? false);
  useEffect(() => {
    // A Next Link can be pending while the old pathname is still visible.
    const leaving = () => { navigating.current = true; };
    const linkIntent = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const destination = new URL(link.href);
      if (destination.origin === window.location.origin && (destination.pathname !== window.location.pathname || destination.search !== window.location.search)) {
        leaving();
        // The retained Home tree is reused when a brand link returns home.
        if (!props.initialDetail && handedOff.current && destination.pathname === "/workspace" && !destination.search && !destination.hash) {
          const unhandled = window.dispatchEvent(new Event(WORKSPACE_NEW_CONVERSATION_EVENT, { cancelable: true }));
          if (!unhandled) event.preventDefault();
        }
      }
    };
    document.addEventListener("click", linkIntent, true);
    window.addEventListener("popstate", leaving);
    return () => { document.removeEventListener("click", linkIntent, true); window.removeEventListener("popstate", leaving); };
  }, [props.initialDetail]);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (!current || props.initialDetail || handedOff.current) return;
      const previous = conversationHome(props.scope);
      const explicit = new URL(window.location.href).searchParams.get("draft_session");
      if (props.bootstrap && previous && previous !== props.bootstrap.sessionId && !explicit) {
        router.replace(`/workspace?draft_session=${previous}`);
        return;
      }
      const next = props.bootstrap?.sessionId ?? previous ?? crypto.randomUUID();
      conversationHome(props.scope, next);
      if (props.bootstrap) window.history.replaceState(null, "", `/workspace?draft_session=${next}`);
      setId(next);
    });
    return () => { current = false; };
  }, [props.scope, props.initialDetail, props.bootstrap, router]);
  const chat = useConversation({ entryCapability: props.entryCapability, bootstrap: props.bootstrap?.capability, id, scope: props.scope, chatBinding: props.chatBinding, detailBinding: props.detailBinding, initial: props.initialDetail, onAdmitted: sessionId => {
    if (handedOff.current) return;
    handedOff.current = true;
    setAdmitted(true);
    if (conversationHome(props.scope) === sessionId) conversationHome(props.scope, null);
    // Admission must not reload the route and unmount an actively edited composer.
    // Next integrates native History API updates with usePathname; refresh still
    // opens the canonical Session. Do not rewrite an intervening navigation.
    // https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api
    // The skip link's #main-content anchor is valid on the canonical Session
    // URL and must survive the replace. Any other hash, or a query that is not
    // exactly this one draft_session parameter, is unrelated navigation
    // intent and stays untouched.
    const anchor = window.location.hash;
    if (!navigating.current && window.location.pathname === "/workspace" && onlyDraftSessionSearch(window.location.search, sessionId) && (anchor === "" || anchor === "#main-content")) {
      window.history.replaceState(null, "", `/workspace/sessions/${sessionId}${anchor}`);
    }
  } });
  useEffect(() => {
    if (!chat.attachmentDraftUnsafe || chat.unavailable) return;
    const route = window.location.href;
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const warning = t("图片尚未保存在本机，离开可能丢失。仍要离开吗？");
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const link = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const target = new URL(anchor.href, route);
      const current = new URL(route);
      if (target.origin === current.origin && target.pathname === current.pathname && target.search === current.search) return;
      if (!window.confirm(warning)) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const beforeTraversal = (event: Event) => {
      const traversal = event as Event & { navigationType: string; destination: { url: string; sameDocument: boolean } };
      if (traversal.navigationType !== "traverse" || !traversal.destination.sameDocument || !event.cancelable) return;
      const destination = new URL(traversal.destination.url);
      const current = new URL(route);
      if (destination.origin === current.origin && destination.pathname === current.pathname && destination.search === current.search) return;
      // This event precedes URL/history commitment and App Router's popstate
      // restore. Cancelling it keeps the actual entry, subtree and original
      // files in place; a post-popstate push cannot restore unmounted files.
      if (!window.confirm(warning)) event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    // Link capture precedes the delegated Link handler. History traversal
    // needs the browser's pre-commit event, not listener order on popstate.
    window.addEventListener("click", link, true);
    if (navigation) navigation.addEventListener("navigate", beforeTraversal);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("click", link, true);
      if (navigation) navigation.removeEventListener("navigate", beforeTraversal);
    };
  }, [chat.attachmentDraftUnsafe, chat.unavailable, t]);
  const [editing, setEditing] = useState<Pick<QueueEditOperation, "entry" | "owner" | "sessionId" | "token"> | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [away, setAway] = useState(false);
  // Queue edit focus lifecycle: the auto-focused form is transient, so its
  // departure records who owned focus and where it returns. Restoration lands
  // on the same row's Edit button, or on the composer when that row left the
  // queue — never into a new account/session, a disabled control or a
  // detached node, and never after the user intentionally moved elsewhere.
  const editForm = useRef<HTMLFormElement | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const editingRef = useRef<string | null>(null);
  const editOwner = useRef<QueueEditOperation | null>(null);
  const editReturn = useRef<QueueEditOperation | null>(null);
  const queueFocus = useRef<{ owner: symbol; messageId: string; section: HTMLElement; focusOwned: boolean } | null>(null);
  const viewport = useRef<HTMLDivElement>(null); const content = useRef<HTMLDivElement>(null); const follows = useRef(true); const userScroll = useRef(false);
  useConversationAxis(viewport);
  const reading = useConversationReadingPosition({ viewportRef: viewport, contentRef: content, followsLatestRef: follows, onAwayChange: setAway,
    scope: props.scope, sessionId: id, binding: props.detailBinding, ready: chat.ready, unavailable: chat.unavailable,
    expiresAt: chat.detail?.expires_at ?? props.initialDetail?.expires_at });
  const active = chat.snapshot?.active;
  const queued = useMemo(() => chat.snapshot?.queued ?? [], [chat.snapshot?.queued]);
  const turns = useMemo(() => chat.detail?.turns ?? [], [chat.detail?.turns]);
  // Presentation pacing: forming text paints at most once per interval while
  // terminal states and errors stay prompt.
  const pacedPreview = usePreviewPacing(chat.preview);
  // Observed milestones are recorded per run identity only when a real stage
  // transition arrives; a new run starts an empty record.
  const forming = pacedPreview?.run_id === active?.run_id ? pacedPreview : null;
  const milestones = useRunMilestones(active?.run_id ?? null, forming?.stage ?? active?.stage ?? null);
  const [milestoneRecords, setMilestoneRecords] = useState<Record<string, typeof milestones>>({});
  useEffect(() => {
    const messageId = active?.message_id;
    if (!messageId || !milestones.length) return;
    let current = true;
    queueMicrotask(() => { if (current) setMilestoneRecords(records => records[messageId] === milestones ? records : { ...records, [messageId]: milestones }); });
    return () => { current = false; };
  }, [active?.message_id, milestones]);
  // Resolving the local Home session ID is initialization, not a new editing
  // context. Keep the same native editor through readiness and focus handoff;
  // explicit Session or account changes still create a new composition owner.
  const composerSession = props.initialDetail?.session_id ?? props.bootstrap?.sessionId ?? "home";
  const composerScope = `${props.scope}:${props.chatBinding}:${props.detailBinding}:${composerSession}`;
  const composerOwner = useMemo(() => Symbol(composerScope), [composerScope]);
  // Readback and queue edits belong to the actual live Session, while Home
  // deliberately retains its stable IME owner during local ID resolution.
  const readbackOwner = useMemo(() => Symbol(`${composerScope}:${id ?? "unresolved"}`), [composerScope, id]);
  const composingRef = useRef<{ owner: symbol | null; value: boolean }>({ owner: composerOwner, value: false });
  const [composition, setComposition] = useState({ owner: composerOwner, value: false });
  useLayoutEffect(() => {
    composingRef.current = { owner: composerOwner, value: false };
    return () => { composingRef.current = { owner: null, value: false }; };
  }, [composerOwner]);
  const composing = composition.owner === composerOwner && composition.value;
  function composingChanged(value: boolean) {
    if (composingRef.current.owner !== composerOwner) return;
    composingRef.current = { owner: composerOwner, value };
    setComposition({ owner: composerOwner, value });
  }
  useLayoutEffect(() => () => {
    editOwner.current = null;
    editingRef.current = null;
    editReturn.current = null;
    queueFocus.current = null;
  }, [readbackOwner, id]);
  function beginEdit(entryId: string, objective: string) {
    const operation: QueueEditOperation = { entry: entryId, owner: readbackOwner, sessionId: id,
      token: Symbol(entryId), focusOwned: false, saveToken: null };
    editOwner.current = operation;
    editReturn.current = null;
    editingRef.current = entryId;
    setEditValue(objective);
    setEditing({ entry: operation.entry, owner: operation.owner, sessionId: operation.sessionId, token: operation.token });
  }
  // A pointer on nonfocusable space can leave document.activeElement at body.
  // Record that intent before native blur while queue controls or an editor
  // can disappear; a later handoff must not override the user's chosen focus.
  useLayoutEffect(() => {
    if (!queued.length && (!editing || editing.owner !== readbackOwner || editing.sessionId !== id)) return;
    const moved = (event: PointerEvent) => {
      const focused = queueFocus.current;
      if (focused?.owner === readbackOwner) focused.focusOwned = Boolean(event.target instanceof Node && focused.section.contains(event.target));
      const operation = editOwner.current;
      if (!editing || operation?.token !== editing.token) return;
      operation.focusOwned = Boolean(event.target instanceof Node && editForm.current?.contains(event.target));
    };
    document.addEventListener("pointerdown", moved, true);
    return () => document.removeEventListener("pointerdown", moved, true);
  }, [editing, readbackOwner, id, queued.length]);
  function finishEditing(entryId: string, restore: boolean, operation = editOwner.current) {
    if (!operation || editOwner.current?.token !== operation.token || editingRef.current !== entryId
      || operation.entry !== entryId || operation.owner !== readbackOwner || operation.sessionId !== id) return;
    editReturn.current = restore && editorOwnedFocus(editForm.current, operation) ? operation : null;
    editingRef.current = null;
    editOwner.current = null;
    setEditing(null);
  }
  function restoreEditFocus() {
    const target = editReturn.current;
    editReturn.current = null;
    if (!target || editOwner.current) return;
    // Never restore into a new account, Session or a reopened editor.
    if (target.owner !== readbackOwner || target.sessionId !== id) return;
    const button = editButtons.current.get(target.entry);
    if (button?.isConnected && !button.disabled) { button.focus({ preventScroll: true }); return; }
    const composer = document.getElementById("queued-conversation-composer");
    if (composer instanceof HTMLElement && composer.isConnected && !("disabled" in composer && composer.disabled)) composer.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!editing) restoreEditFocus();
  });
  useLayoutEffect(() => {
    const operation = editOwner.current;
    if (!operation || queued.some(entry => entry.queue_entry_id === operation.entry)) return;
    // The row has unmounted; the recorded focus ownership distinguishes that
    // automatic loss from an earlier deliberate move to blank space.
    finishEditing(operation.entry, true, operation);
    restoreEditFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued]);
  useLayoutEffect(() => {
    const focused = queueFocus.current;
    if (!focused || focused.owner !== readbackOwner || queued.some(entry => entry.message_id === focused.messageId)) return;
    queueFocus.current = null;
    const activeElement = document.activeElement;
    if (!focused.focusOwned || (activeElement && activeElement !== document.body && !focused.section.contains(activeElement))) return;
    const composer = document.getElementById("queued-conversation-composer");
    if (composer instanceof HTMLTextAreaElement && composer.isConnected && !composer.disabled) composer.focus({ preventScroll: true });
  }, [queued, readbackOwner]);
  const imageCount = chat.attachments.length;
  const canSend = !composing && chat.ready && !chat.unavailable && !chat.preparing && !chat.submitting && Boolean(chat.draft.trim() || imageCount) && chat.draft.trim().length <= 1000 && unresolvedConversationCount(chat.messages, chat.snapshot) < 50;
  const acceptsSteering = Boolean(active?.accepts_steering && !active.cancel_requested);
  const activeVisible = active && !turns.some(turn => turn.id === active.message_id);
  const paused = chat.snapshot?.paused ?? false;
  const hasContent = Boolean(turns.length || chat.messages.length || active || queued.length || Object.keys(chat.handoffEntries).length);
  // Display-only one-shot completion attention: only runs actually watched
  // finishing may sweep once. History loaded later never claims it.
  const attention = useMemo(() => createAnswerSeamRegistry({ scope: props.scope, sessionId: id ?? "" }), [props.scope, id]);
  const activeMessageId = active?.message_id ?? null;
  useEffect(() => {
    if (id && activeMessageId) attention.observe(activeMessageId);
  }, [id, activeMessageId, attention]);
  const personLabel = chat.detail?.person_label ?? props.initialDetail?.person_label ?? "";
  const personId = (chat.detail ?? props.initialDetail)?.person_id ?? null;
  const personContextPanel = usePersonContextPanel();
  const contextLabel = chat.detail?.context_label ?? props.initialDetail?.context_label ?? "";
  const scopeLabel = personLabel && contextLabel ? `${personLabel} · ${contextLabel}` : personLabel || contextLabel || t("conversation.detail.unbound");
  const stageLabel = active ? t(conversationStageLabel(forming?.stage ?? active.stage) ?? "正在处理") : "";
  const status = chat.unavailable ? t("conversation.status.unavailable") : chat.connection === "reconnecting" && hasContent ? t("conversation.status.reconnecting") : active?.cancel_requested ? t("conversation.status.stopping") : active ? stageLabel : paused ? t("conversation.status.paused") : queued.length ? t("conversation.status.waiting", { count: queued.length }) : "";
  // Canonical history owns a settled message. Until then the local outbox row
  // (or its observed server entry) is the only truthful representation; rows
  // already projected from history, the active run or the queue are hidden
  // here instead of deleting their evidence early.
  const settledIds = useMemo(() => new Set(turns.flatMap(sessionHumanMessages).map((human) => human.id)), [turns]);
  const representedIds = useMemo(() => new Set([
    ...settledIds,
    ...queued.map((entry) => entry.message_id),
    ...(activeMessageId ? [activeMessageId] : []),
  ]), [settledIds, queued, activeMessageId]);
  const outboxRows = useMemo(() => {
    const messages = new Map<string, LocalMessage & { previewText?: string }>(chat.messages.map(message => [message.id, message]));
    for (const entry of Object.values(chat.handoffEntries)) {
      // The observed server entry owns edits and source timestamps, even when
      // the user reopened this run without any local outbox row.
      const local = messages.get(entry.message_id);
      messages.set(entry.message_id, { ...local, id: entry.message_id, objective: entry.objective, images: entry.images, createdAt: entry.created_at, delivery: "accepted", expiresAt: local?.expiresAt ?? Date.parse(chat.detail?.expires_at ?? ""), receiptUncertain: false, previewText: chat.handoffPreviews[entry.message_id]?.text });
    }
    return [...messages.values()].filter(message => !representedIds.has(message.id));
  }, [chat.messages, chat.handoffEntries, chat.handoffPreviews, chat.detail?.expires_at, representedIds]);
  const projectedMessages = useMemo(() => sessionMessages({
    turns, active: activeVisible ? active : null, preview: forming, milestones, queued, milestonesByMessage: milestoneRecords,
    handoff: outboxRows.map((message) => ({
      messageId: message.id,
      objective: message.objective,
      images: message.images,
      createdAt: message.createdAt,
      previewText: message.previewText,
    })),
  }), [turns, activeVisible, active, forming, milestones, queued, milestoneRecords, outboxRows]);
  const workByMessageId = useMemo(() => {
    const map: Record<string, ConversationWorkStatus> = {};
    const compute = (messageId: string, delivery: LocalMessage["delivery"], error: string | undefined, hasImages: boolean, entry: ConversationQueueEntry | null, entrySlot: "active" | "queued" | null) => {
      map[messageId] = conversationWorkStatus({
        delivery, error, settled: settledIds.has(messageId), entry, entrySlot,
        paused, connection: chat.connection,
        stage: forming?.stage ?? active?.stage ?? null,
        outcome: chat.runOutcome[messageId] ?? null,
        readbackStalled: chat.readbackStalled.includes(messageId),
        hasImages,
      });
    };
    for (const message of outboxRows) {
      const isActive = active?.message_id === message.id;
      const entry = (isActive ? active : queued.find((item) => item.message_id === message.id) ?? chat.handoffEntries[message.id]) ?? null;
      const slot = isActive ? "active" : queued.some((item) => item.message_id === message.id) ? "queued" : null;
      compute(message.id, message.delivery, message.error, Boolean(message.images?.length), entry, slot);
    }
    return map;
  }, [outboxRows, chat.connection, chat.runOutcome, chat.readbackStalled, settledIds, paused, forming, active, queued, chat.handoffEntries]);
  // Explicit readback refresh: local idle/loading/failed feedback per message
  // with a synchronous in-flight fence against repeat clicks. Success returns
  // to idle without claiming a persisted answer; failure keeps the retained
  // row and offers a usable retry. Stale feedback is dropped when the
  // account/session owner or the message lifecycle changes.
  type RefreshOperation = { owner: symbol; token: symbol; lifecycle: symbol };
  type RefreshFeedback = { phase: "loading" | "failed"; lifecycle: symbol };
  const [refreshFeedback, setRefreshFeedback] = useState<{ owner: symbol; messages: Record<string, RefreshFeedback> }>({ owner: readbackOwner, messages: {} });
  const refreshPending = useRef(new Map<string, RefreshOperation>());
  const refreshScope = useRef<symbol | null>(null);
  const refreshLifecycles = useRef(new Map<string, { signature: string; token: symbol }>());
  useLayoutEffect(() => {
    const pending = refreshPending.current;
    refreshScope.current = readbackOwner;
    pending.clear();
    refreshLifecycles.current.clear();
    return () => {
      if (refreshScope.current !== readbackOwner) return;
      refreshScope.current = null;
      pending.clear();
    };
  }, [readbackOwner]);
  useLayoutEffect(() => {
    const next = new Map<string, { signature: string; token: symbol }>();
    for (const [messageId, work] of Object.entries(workByMessageId)) {
      if (work.recover !== "refresh") continue;
      const runId = chat.handoffEntries[messageId]?.run_id ?? (active?.message_id === messageId ? active.run_id : null);
      const signature = JSON.stringify([work.phase, runId]);
      const previous = refreshLifecycles.current.get(messageId);
      next.set(messageId, previous?.signature === signature ? previous : { signature, token: Symbol(messageId) });
    }
    refreshLifecycles.current = next;
    for (const [messageId, operation] of refreshPending.current) {
      if (next.get(messageId)?.token !== operation.lifecycle) refreshPending.current.delete(messageId);
    }
    queueMicrotask(() => {
      if (refreshScope.current !== readbackOwner || refreshLifecycles.current !== next) return;
      setRefreshFeedback(state => {
        if (state.owner !== readbackOwner) return { owner: readbackOwner, messages: {} };
        const messages = Object.fromEntries(Object.entries(state.messages).filter(([messageId, feedback]) => next.get(messageId)?.token === feedback.lifecycle));
        return Object.keys(messages).length === Object.keys(state.messages).length ? state : { owner: readbackOwner, messages };
      });
    });
  }, [readbackOwner, workByMessageId, chat.handoffEntries, active]);
  function completeRefresh(messageId: string, operation: RefreshOperation, succeeded: boolean) {
    const pending = refreshPending.current.get(messageId);
    // Check the exact request before deleting its lock: an old A1 completion
    // must never release A2 after an owner or message-lifecycle round trip.
    if (refreshScope.current !== operation.owner || pending?.owner !== operation.owner
      || pending.token !== operation.token || refreshLifecycles.current.get(messageId)?.token !== operation.lifecycle) return;
    refreshPending.current.delete(messageId);
    setRefreshFeedback(state => {
      if (state.owner !== operation.owner || state.messages[messageId]?.lifecycle !== operation.lifecycle) return state;
      const messages = { ...state.messages };
      if (succeeded) delete messages[messageId];
      else messages[messageId] = { phase: "failed", lifecycle: operation.lifecycle };
      return { owner: operation.owner, messages };
    });
  }
  function refreshReadback(messageId: string) {
    const lifecycle = refreshLifecycles.current.get(messageId);
    if (refreshScope.current !== readbackOwner || !lifecycle || refreshPending.current.has(messageId)) return;
    const operation = { owner: readbackOwner, token: Symbol(messageId), lifecycle: lifecycle.token };
    refreshPending.current.set(messageId, operation);
    setRefreshFeedback(state => ({ owner: readbackOwner, messages: {
      ...(state.owner === readbackOwner ? state.messages : {}),
      [messageId]: { phase: "loading", lifecycle: lifecycle.token },
    } }));
    void chat.refreshDetail().then(
      () => completeRefresh(messageId, operation, true),
      () => completeRefresh(messageId, operation, false),
    );
  }
  const sourceImagesByMessageId = useMemo(() => Object.fromEntries(
    turns.flatMap(sessionHumanMessages).map((turn) => [turn.id, turn.images ?? []]),
  ), [turns]);
  const sourceTextByMessageId = useMemo(() => Object.fromEntries(
    turns.flatMap(sessionHumanMessages).map((turn) => [turn.id, turn.objective ?? ""]),
  ), [turns]);
  // Queue management lives with the same message identity in the transcript.
  // Admission must not mount a second copy of its text above the composer.
  function renderQueueActions(messageId: string) {
    const index = queued.findIndex(entry => entry.message_id === messageId);
    const entry = queued[index];
    if (!entry || chat.unavailable) return null;
    const owned = (action: () => void) => { if (refreshScope.current === readbackOwner) action(); };
    const editingEntry = editing?.entry === entry.queue_entry_id && editing.owner === readbackOwner && editing.sessionId === id;
    const supplement = entry.steers_run_id && entry.steer_state !== "unsupported";
    const showOrder = queued.length > 1 || paused || Boolean(entry.steers_run_id);
    return <section className={styles.inlineQueue} aria-label={t("conversation.queue.label")} data-queued-message={messageId} data-status={entry.status}
      onFocusCapture={event => { queueFocus.current = { owner: readbackOwner, messageId, section: event.currentTarget, focusOwned: true }; }}
      onBlurCapture={event => {
        const focused = queueFocus.current;
        if (!focused || focused.owner !== readbackOwner || focused.messageId !== messageId || event.currentTarget.contains(event.relatedTarget)) return;
        const target = event.target;
        if (!target.isConnected || (target instanceof HTMLButtonElement && target.disabled && !event.relatedTarget)) return;
        focused.focusOwned = false;
      }}>
      {showOrder && <div className={styles.queueHeading}>
        <span>{paused ? t("conversation.queue.paused") : supplement ? t("conversation.queue.thisSupplement") : t("conversation.queue.upNext")}<small>{index + 1}</small></span>
        {paused && index === 0 && <button disabled={chat.mutating || Boolean(active) || queued.some(item => item.status !== "queued")} onClick={() => owned(() => { void chat.mutate({ kind: "continue" }); })}>{t("conversation.queue.continue")}<ArrowUp size={13}/></button>}
      </div>}
      {editingEntry ? <form className={styles.edit} ref={editForm}
        onFocusCapture={() => { const operation = editOwner.current; if (operation?.token === editing.token) operation.focusOwned = true; }}
        onBlurCapture={event => {
          const operation = editOwner.current;
          if (operation?.token !== editing.token || event.currentTarget.contains(event.relatedTarget)) return;
          const target = event.target;
          if (!target.isConnected || (target instanceof HTMLButtonElement && target.disabled && !event.relatedTarget)) return;
          operation.focusOwned = false;
        }} onSubmit={event => { event.preventDefault(); owned(() => { void applyEdit(entry.queue_entry_id); }); }}>
        <label htmlFor={`edit-${entry.queue_entry_id}`}>{t("conversation.queue.editLabel")}</label>
        <textarea autoFocus id={`edit-${entry.queue_entry_id}`} value={editValue} maxLength={1000} onChange={event => setEditValue(event.target.value)}/>
        <div><button type="button" onClick={() => finishEditing(entry.queue_entry_id, true)}>{t("conversation.queue.cancel")}</button>
          <button type="submit" disabled={!editValue.trim() || chat.mutating}>{t("conversation.queue.save")}</button></div>
      </form> : <div className={styles.inlineQueueRow}>
        <span className={styles.queueText}>
          {entry.status === "queued" && (active || paused || entry.steers_run_id) && <small>{entry.steer_state === "unsupported" ? t("conversation.queue.steerUnsupported") : entry.steers_run_id ? entry.steer_delivered ? t("conversation.queue.steerDelivered") : entry.steer_state === "dispatching" ? t("conversation.queue.steerDispatching") : t("conversation.queue.steerPending") : active ? t("conversation.queue.afterRun") : t("conversation.queue.afterResume")}</small>}
          {["failed", "interrupted"].includes(entry.status) && <small>{queueFailureText(entry.failure_code, Boolean(entry.images?.length), t)}</small>}
        </span>
        <div className={styles.queueActions}>
          {entry.status === "queued" && entry.objective.trim() && !entry.host_result ? <button
            ref={node => { if (node) editButtons.current.set(entry.queue_entry_id, node); else editButtons.current.delete(entry.queue_entry_id); }}
            aria-label={t("conversation.queue.editItem", { position: index + 1 })} disabled={entry.steer_state === "dispatching" || entry.steer_delivered}
            onClick={() => owned(() => beginEdit(entry.queue_entry_id, entry.objective))}><PencilSimple size={16}/></button>
            : entry.status === "queued" ? null : <button disabled={chat.mutating} onClick={() => owned(() => { void retryEntry(entry.queue_entry_id); })}>{t("conversation.queue.retry")}</button>}
          {entry.status === "queued" && !entry.steers_run_id && (active || paused || index > 0) && <button className={styles.prioritize} disabled={chat.mutating}
            title={active ? t("conversation.queue.prioritizeStopTitle") : t("conversation.queue.prioritizeTitle")}
            aria-label={t("conversation.queue.prioritizeItem", { position: index + 1 })} onClick={() => owned(() => { void prioritize(entry.queue_entry_id, index + 1); })}><ArrowUp size={14}/>{t("conversation.queue.prioritize")}</button>}
          <button aria-label={t("conversation.queue.removeItem", { position: index + 1 })} disabled={chat.mutating || entry.steer_state === "dispatching" || entry.steer_delivered}
            onClick={() => owned(() => { void chat.mutate({ kind: "withdraw", queue_entry_id: entry.queue_entry_id }); })}><X size={16}/></button>
        </div>
      </div>}
      {index === 0 && queued.some(item => item.steers_run_id) && <p className={styles.queueWithdrawalNote}>{t("conversation.queue.withdrawGroupHint")}</p>}
    </section>;
  }
  const renderContext = {
    queueActions: renderQueueActions,
    binding: props.chatBinding,
    meetingBinding: props.detailBinding,
    entryCapability: chat.entryCapability ?? props.entryCapability ?? null,
    scope: props.scope,
    sessionId: chat.detail?.session_id ?? id ?? "",
    status,
    attention,
    workByMessageId,
    recoveryActions: (messageId: string) => {
      const work = workByMessageId[messageId];
      const message = chat.messages.find(item => item.id === messageId);
      if (work?.recover === "check" && message) return <><button disabled={chat.checkingDeliveries?.includes(messageId)} onClick={() => { if (refreshScope.current === readbackOwner) void chat.retryDelivery(message); }}>{t(chat.checkingDeliveries?.includes(messageId) ? "conversation.recovery.checking" : "conversation.recovery.check")}</button>{message.delivery === "rejected" ? <button onClick={() => { if (refreshScope.current === readbackOwner) chat.discardRejectedDelivery(message.id); }}>{t("conversation.recovery.discard")}</button> : null}</>;
      if (work?.recover === "refresh") {
        const phase = refreshFeedback.owner === readbackOwner ? refreshFeedback.messages[messageId]?.phase ?? "idle" : "idle";
        return <><button disabled={phase === "loading"} onClick={() => refreshReadback(messageId)}>{phase === "loading" ? t("conversation.recovery.refreshing") : phase === "failed" ? t("conversation.recovery.refreshRetry") : t("conversation.recovery.refresh")}</button>{phase === "failed" ? <small role="status">{t("conversation.recovery.refreshFailed")}</small> : null}</>;
      }
      return null;
    },
    sourceImagesByMessageId,
    sourceTextByMessageId,
    onCardComment: (item: MemoryProposalItem) => {
      const label = item.display_text.length > 48 ? `${item.display_text.slice(0, 48)}…` : item.display_text;
      const next = `${chat.draft}${chat.draft ? "\n" : ""}${t("conversation.card.comment", { text: label })}`;
      if (next.length <= 1000) chat.changeDraft(next);
      document.getElementById("queued-conversation-composer")?.focus();
    },
  };
  useEffect(() => {
    const node = content.current; const scroll = viewport.current; if (!node || !scroll) return;
    const observer = new ResizeObserver(() => { if (reading.restoring.current) reading.restore(); else if (follows.current) scroll.scrollTop = scroll.scrollHeight; else setAway(true); });
    observer.observe(node); observer.observe(scroll); return () => observer.disconnect();
  }, [reading]);
  useEffect(() => { if (chat.ready && chat.draft && props.initialDetail) document.getElementById("queued-conversation-composer")?.focus({ preventScroll: true }); /* Restore focus only at initial hydration. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.ready]);
  useEffect(() => {
    if (!focusRequested.current || !chat.ready || chat.unavailable || props.initialDetail || navigating.current) return;
    const composer = document.getElementById("queued-conversation-composer");
    if (!(composer instanceof HTMLTextAreaElement) || composer.disabled) return;
    focusRequested.current = false;
    composer.focus({ preventScroll: true });
  }, [chat.ready, chat.unavailable, props.initialDetail]);
  function latest() { reading.cancelRestore(); userScroll.current = false; follows.current = true; setAway(false); viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); reading.remember(); }
  async function send() { if (composingRef.current.owner === composerOwner && composingRef.current.value) return; if (await chat.submit()) { reading.cancelRestore(); userScroll.current = false; follows.current = true; setAway(false); reading.remember(); } }
  function navigate(href: string) {
    if (chat.attachmentDraftUnsafe && !window.confirm(t("图片尚未保存在本机，离开可能丢失。仍要离开吗？"))) return;
    navigating.current = true; router.push(href);
  }
  async function remove() {
    if (await chat.remove()) {
      reading.forget();
      const unhandled = window.dispatchEvent(new Event(WORKSPACE_NEW_CONVERSATION_EVENT, { cancelable: true }));
      if (unhandled) router.replace("/workspace");
    }
  }
  async function applyEdit(entry: string) {
    const operation = editOwner.current;
    if (!operation || operation.entry !== entry || operation.owner !== readbackOwner || operation.sessionId !== id || operation.saveToken) return;
    const token = Symbol("save");
    operation.saveToken = token;
    const ok = await chat.mutate({ kind: "edit", queue_entry_id: entry, objective: editValue.trim() });
    const current = editOwner.current;
    if (current?.token !== operation.token || current.owner !== operation.owner || current.sessionId !== operation.sessionId
      || operation.saveToken !== token || editingRef.current !== entry) return;
    operation.saveToken = null;
    if (!ok) {
      if (editorOwnedFocus(editForm.current, operation)) {
        const field = editForm.current?.querySelector("textarea");
        if (field instanceof HTMLElement && field.isConnected && !field.disabled) field.focus({ preventScroll: true });
      }
      return;
    }
    finishEditing(entry, true, operation);
  }
  // Escape pauses the queue while a run is live. IME composition owns Enter
  // and Escape: a composing key event is never an action.
  function handleCanvasKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || chat.mutating) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[role="dialog"]')) return;
    const run = active && !active.cancel_requested && active.run_id ? active : null;
    if (conversationRunKeyAction({ key: event.key, isComposing: event.nativeEvent.isComposing || composingRef.current.value, keyCode: event.nativeEvent.keyCode, hasActiveRun: Boolean(run) }) === "pause-run" && run?.run_id) {
      event.preventDefault();
      void chat.mutate({ kind: "stop", run_id: run.run_id });
    }
  }
  async function retryEntry(queueEntryId: string) {
    const owner = readbackOwner;
    if (await chat.mutate({ kind: "retry", queue_entry_id: queueEntryId }) && refreshScope.current === owner) await chat.mutate({ kind: "continue" });
  }
  async function prioritize(queueEntryId: string, position: number) {
    if (active && !window.confirm(t("conversation.queue.prioritizeConfirmStop", { position }))) return;
    if (!active && paused && !window.confirm(t("conversation.queue.prioritizeConfirmResume", { position }))) return;
    await chat.mutate({ kind: "prioritize", queue_entry_id: queueEntryId });
  }

  return <SessionTaskProvider observation={chat.taskObservation} connection={chat.connection} mutating={chat.mutating}
    onStop={runId => void chat.mutate({ kind: "stop", run_id: runId })} onContinue={() => void chat.mutate({ kind: "continue" })}
    onRetry={queueEntryId => void retryEntry(queueEntryId)} recoveryActions={renderContext.recoveryActions}>
  <main id="main-content" tabIndex={-1} className={styles.canvas} aria-label={t("conversation.canvas.label")} data-conversation-canvas data-empty={!hasContent} onKeyDown={handleCanvasKeyDown}>
    {admitted && <header className={styles.header}>
      <div className={styles.headingText}><h1 title={chat.detail?.title || t("conversation.new")}>{chat.detail?.title || t("conversation.new")}</h1></div>
      {personId && !chat.unavailable && <button className={styles.personContext} aria-label={t("conversation.person.view", { person: personLabel || t("conversation.person.fallback") })} onClick={event => personContextPanel.open(personId,event.currentTarget)}>{t("conversation.person.context")}</button>}
      <div className={styles.taskSlot}>{!chat.unavailable && <SessionTaskCapsule/>}</div>
      <details className={styles.details}><summary aria-label={t("conversation.detail.label")}><DotsThree aria-hidden="true" size={18}/><span className={styles.detailsLabel}>{t("conversation.detail.label")}</span></summary><div className={styles.detailPanel}>
      <p>{chat.detail?.title || t("conversation.new")}</p>
      <p className={styles.detailScope}>{scopeLabel}</p>
      <p>{t("conversation.detail.historyHint")}</p>
      {chat.detail && <p>{t("conversation.detail.retention", { date: new Date(chat.detail.expires_at).toLocaleDateString(locale) })}</p>}
      {props.meetingLinks?.map(meeting => <a key={meeting.id} href={`/workspace/meetings?draft=${encodeURIComponent(meeting.id)}`}>{meeting.title}</a>)}
      {props.meetingReadFailed && <p>{t("conversation.detail.meetingsFailed")}</p>}
      {!chat.unavailable && (confirmDelete ? <div className={styles.confirm}><p>{t("conversation.detail.deleteConfirm")}</p><button onClick={() => void remove()}>{t("conversation.detail.deleteConfirmAction")}</button><button onClick={() => setConfirmDelete(false)}>{t("conversation.detail.deleteKeep")}</button></div> : <button className={styles.textButton} onClick={() => setConfirmDelete(true)}><Trash size={16}/>{t("conversation.detail.delete")}</button>)}
    </div></details></header>}
    <SessionRuntime key={`${props.chatBinding}:${id ?? "draft"}`} messages={projectedMessages} running={Boolean(activeVisible)}>
    <ThreadPrimitive.Root className={styles.runtimeRoot} data-session-runtime>
    <ThreadPrimitive.Viewport autoScroll={false} scrollToBottomOnInitialize={false} scrollToBottomOnThreadSwitch={false} scrollToBottomOnRunStart={false} className={styles.transcript} ref={viewport} role="region" aria-label={t("conversation.transcript.label")} tabIndex={0} onWheel={event => { reading.cancelRestore(); userScroll.current = true; if (event.deltaY < 0) follows.current = false; }} onTouchStart={() => { reading.cancelRestore(); userScroll.current = true; }} onPointerDown={() => { reading.cancelRestore(); userScroll.current = true; }} onKeyDown={event => { if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"].includes(event.key)) { reading.cancelRestore(); userScroll.current = true; } if (["PageUp", "Home", "ArrowUp"].includes(event.key)) follows.current = false; }} onScroll={() => { if (!reading.restoring.current && viewport.current && userScroll.current) { follows.current = conversationNearBottom(viewport.current); setAway(!follows.current); reading.remember(); } }}>
      <div className={styles.content} ref={content}>
        {!hasContent && <div className={styles.welcome}><span className={styles.welcomeMark} aria-hidden="true"/><div><h2>{t("conversation.welcome.title")}</h2><p>{t("conversation.welcome.body")}</p></div></div>}
        <ThreadPrimitive.Messages>{({ message }) => message.role === "user"
          ? <Fragment key={message.id}><SessionSendTime at={(message as { createdAt?: unknown }).createdAt}/><SessionUserMessage context={renderContext}/></Fragment>
          : <SessionAssistantMessage key={message.id} context={renderContext}/>}</ThreadPrimitive.Messages>
        {props.meetingLinks?.filter(meeting=>!turns.some(turn=>turn.response.meetingDraft?.id===meeting.id)).map(meeting=><section key={meeting.id} className="context-calendar-draft-handoff" aria-label={t("conversation.meeting.entry")}><strong>{meeting.title}</strong><a href={`/workspace/meetings?draft=${encodeURIComponent(meeting.id)}`}>{t("conversation.meeting.review")}</a></section>)}
      </div>
    </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
    </SessionRuntime>
    <div className={styles.dock}>
      {away && <button className={styles.latest} onClick={latest}><ArrowDown size={15}/>{t("conversation.latest")}</button>}
      {props.legacyRecovery && <LegacyRecoveryNotice key={props.legacyRecovery.sessionId} recovery={props.legacyRecovery}/>}
      {(chat.error || chat.draftConflict || chat.unavailable) && <div className={styles.notice} role="status">{chat.unavailable ? t("conversation.notice.unavailable") : chat.draftConflict ? <>{t("conversation.notice.draftConflict")}<button onClick={() => void chat.keepDraft()}>{t("conversation.notice.keepDraft")}</button></> : t(chat.error)}</div>}
      {imageCount > 0 && <div className={styles.composerImages} aria-label={t("conversation.images.label")}>
        {chat.attachments.map((attachment, index) => <span className={styles.composerImage} key={attachment.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={attachment.manifest.file_name} src={attachment.url} />
          <button aria-label={t("conversation.images.removeItem", { position: index + 1 })} className={styles.composerImageRemove} disabled={!chat.ready || chat.unavailable || chat.preparing} onClick={() => chat.removeAttachment(attachment.id)} type="button"><X size={12} weight="bold"/></button>
        </span>)}
      </div>}
      {imageCount >= 10 && <p className={styles.composerImageHint} role="status">{t("conversation.images.limit")}</p>}
      {chat.attachmentDraftUnsafe && !chat.preparing && !chat.unavailable && <button type="button" onClick={() => void chat.retryAttachmentDraft()}>{t("重试保存图片")}</button>}
      {chat.attachmentDraftRecoveryNeeded && !chat.preparing && !chat.unavailable && <button type="button" onClick={() => {
        if (window.confirm(t("这会放弃当前页的图片预览并载入本机草稿，文字不变。继续吗？"))) void chat.useStoredAttachmentDraft();
      }}>{t("使用本机已保存的图片")}</button>}
      {chat.preparing && <p className={styles.composerImageHint} role="status">{t("conversation.images.preparing")}</p>}
      {chat.submitting && <p className={styles.composerImageHint} role="status">{t("conversation.images.sending")}</p>}
      <div className={styles.composer}>
        <WorkspaceComposer key={composerScope} id="queued-conversation-composer" viewKey={id} label={t("conversation.composer.label")} value={chat.draft} maxLength={1000} variant="home" layout="inline" rows={1} placeholder={active ? acceptsSteering ? t("conversation.composer.steerPlaceholder") : t("conversation.composer.queuePlaceholder") : paused ? t("conversation.composer.pausedPlaceholder") : imageCount ? t("conversation.composer.imagesPlaceholder") : t("conversation.composer.defaultPlaceholder")} canSubmit={canSend} disabled={!chat.ready || chat.unavailable} binding={props.detailBinding} onValueChange={chat.changeDraft} onSubmit={() => void send()} onComposingChange={composingChanged} onNavigate={navigate} onFiles={files => void chat.addFiles(files)}
          footerEnd={<div className={styles.sendActions}><button type="button" className={styles.send} data-send-mode={acceptsSteering ? "steer" : active || queued.length || paused ? "queue" : "send"} aria-label={acceptsSteering ? t("conversation.send.steerAction") : active || queued.length || paused ? t("conversation.send.queueAction") : t("conversation.send.label")} title={acceptsSteering ? t("conversation.send.steerAction") : active || paused ? t("conversation.send.queueAction") : t("conversation.send.title")} disabled={!canSend} onClick={() => void send()}>{(active || queued.length || paused) && <span>{acceptsSteering ? t("conversation.send.steer") : t("conversation.send.queue")}</span>}<ArrowUp size={20} aria-hidden="true" weight="bold"/></button></div>}/>
      </div>
      {!hasContent && <div className={styles.starters} aria-label={t("conversation.starters.label")}>{[t("conversation.starters.help"), t("conversation.starters.prepare")].map(text => <button key={text} onClick={() => { chat.changeDraft(text); document.getElementById("queued-conversation-composer")?.focus(); }}>{text}<ArrowUp size={13} aria-hidden="true"/></button>)}</div>}
      <div className={styles.footer}><span role="status" aria-live="polite" aria-atomic="true">{chat.unavailable ? t("conversation.status.unavailable") : chat.connection === "reconnecting" && hasContent && !active && !queued.length ? t("conversation.status.reconnecting") : ""}</span><span>{t("conversation.footer.keys")}</span></div>
    </div>
  </main></SessionTaskProvider>;
}
