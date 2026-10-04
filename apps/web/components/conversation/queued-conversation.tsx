"use client";

import { ArrowDown, ArrowUp, DotsThree, PencilSimple, Stop, Trash, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ThreadPrimitive } from "@assistant-ui/react";
import { conversationHome } from "@/lib/conversation-local";
import {
  conversationRunKeyAction,
  conversationStageLabel,
} from "@/lib/conversation-execution";
import type { LegacyConversationRecovery } from "@/lib/conversation-legacy";
import { WORKSPACE_NEW_CONVERSATION_EVENT } from "@/lib/workspace-navigation";
import type { ConversationImageManifest, MemoryProposalItem } from "@talent-signal/contracts";
import { ComposerAddMenu } from "../new-conversation-add-menu";
import { WorkspaceComposer } from "../workspace-composer";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import { conversationNearBottom } from "../session-workbench/session-presentation";
import { LegacyRecoveryNotice } from "./legacy-recovery-notice";
import { ConversationImageStrip } from "./conversation-images";
import { SessionSendTime } from "./session-execution-card";
import { useConversation } from "./use-conversation";
import { useConversationAxis } from "./use-conversation-axis";
import { usePreviewPacing } from "./use-preview-pacing";
import { useRunMilestones } from "./use-run-milestones";
import { sessionHumanMessages, sessionMessages, SessionAssistantMessage, SessionUserMessage } from "./session-message-parts";
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
  // no redundant visible "（图片）" placeholder is shown. Without an attachment
  // the (empty) objective is returned unchanged.
  return images?.length ? "" : objective;
}

export function queueFailureText(code: string | null, hasImages: boolean): string {
  if (code === "MODEL_RUN_TIMEOUT") return hasImages
    ? "图片分析超时，原图已保留。可重试；反复失败时请移除并重新发送较小的图片。"
    : "本次处理超时，消息已保留。可重试。";
  return "上次未完成，请重试或移除";
}

type Props = { bootstrap?: { sessionId: string; capability: string } | null; initialDetail?: SessionDetail; scope: string; chatBinding: string; detailBinding: string; meetingLinks?: Array<{id: string; title: string}>; meetingReadFailed?: boolean; legacyRecovery?: LegacyConversationRecovery | null; entryCapability?: string | null };
export function QueuedConversation(props: Props) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(props.initialDetail?.session_id ?? null);
  const [admitted, setAdmitted] = useState(Boolean(props.initialDetail));
  const handedOff = useRef(Boolean(props.initialDetail));
  const navigating = useRef(false);
  const filePicker = useRef<HTMLInputElement>(null);
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
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [away, setAway] = useState(false);
  const viewport = useRef<HTMLDivElement>(null); const content = useRef<HTMLDivElement>(null); const follows = useRef(true); const userScroll = useRef(false);
  useConversationAxis(viewport);
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
  const imageCount = chat.attachments.length;
  const canSend = chat.ready && !chat.unavailable && !chat.preparing && !chat.submitting && Boolean(chat.draft.trim() || imageCount) && chat.draft.trim().length <= 1000 && queued.length + chat.messages.length + (active ? 1 : 0) < 50;
  const acceptsSteering = Boolean(active?.accepts_steering && !active.cancel_requested);
  const activeVisible = active && !turns.some(turn => turn.id === active.message_id);
  const paused = chat.snapshot?.paused ?? false;
  const hasContent = Boolean(turns.length || chat.messages.length || active || queued.length);
  const personLabel = chat.detail?.person_label ?? props.initialDetail?.person_label ?? "";
  const personId = (chat.detail ?? props.initialDetail)?.person_id ?? null;
  const personContextPanel = usePersonContextPanel();
  const contextLabel = chat.detail?.context_label ?? props.initialDetail?.context_label ?? "";
  const scopeLabel = personLabel && contextLabel ? `${personLabel} · ${contextLabel}` : personLabel || contextLabel || "未绑定联系人或关系情境";
  const status = chat.unavailable ? "这段对话已不可用" : chat.connection === "reconnecting" && hasContent ? "连接恢复中，消息已保留" : active?.cancel_requested ? "正在停止…" : active ? (conversationStageLabel(forming?.stage ?? active.stage) ?? "正在处理") : paused ? "已暂停，可继续发送到队列" : queued.length ? `${queued.length} 条消息等待处理` : "";
  const projectedMessages = useMemo(() => sessionMessages({
    turns, active: activeVisible ? active : null, preview: forming, milestones, queued, milestonesByMessage: milestoneRecords,
  }), [turns, activeVisible, active, forming, milestones, queued, milestoneRecords]);
  const sourceImagesByMessageId = useMemo(() => Object.fromEntries(
    turns.flatMap(sessionHumanMessages).map((turn) => [turn.id, turn.images ?? []]),
  ), [turns]);
  const sourceTextByMessageId = useMemo(() => Object.fromEntries(
    turns.flatMap(sessionHumanMessages).map((turn) => [turn.id, turn.objective ?? ""]),
  ), [turns]);
  const renderContext = {
    binding: props.chatBinding,
    meetingBinding: props.detailBinding,
    entryCapability: chat.entryCapability ?? props.entryCapability ?? null,
    scope: props.scope,
    sessionId: chat.detail?.session_id ?? id ?? "",
    status,
    sourceImagesByMessageId,
    sourceTextByMessageId,
    onCardComment: (item: MemoryProposalItem) => {
      const label = item.display_text.length > 48 ? `${item.display_text.slice(0, 48)}…` : item.display_text;
      const next = `${chat.draft}${chat.draft ? "\n" : ""}关于「${label}」：`;
      if (next.length <= 1000) chat.changeDraft(next);
      document.getElementById("queued-conversation-composer")?.focus();
    },
  };
  useEffect(() => {
    const node = content.current; const scroll = viewport.current; if (!node || !scroll) return;
    const observer = new ResizeObserver(() => { if (follows.current) scroll.scrollTop = scroll.scrollHeight; else setAway(true); });
    observer.observe(node); observer.observe(scroll); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (chat.ready && chat.draft && props.initialDetail) document.getElementById("queued-conversation-composer")?.focus(); /* Restore focus only at initial hydration. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.ready]);
  function latest() { userScroll.current = false; follows.current = true; setAway(false); viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
  async function send() { if (await chat.submit()) { userScroll.current = false; follows.current = true; setAway(false); } }
  function navigate(href: string) { navigating.current = true; router.push(href); }
  function pickFiles() { filePicker.current?.click(); }
  const onPicked = useCallback((files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (selected.length) void chat.addFiles(selected);
  }, [chat]);
  async function remove() {
    if (await chat.remove()) {
      const unhandled = window.dispatchEvent(new Event(WORKSPACE_NEW_CONVERSATION_EVENT, { cancelable: true }));
      if (unhandled) router.replace("/workspace");
    }
  }
  async function applyEdit(entry: string) { if (await chat.mutate({ kind: "edit", queue_entry_id: entry, objective: editValue.trim() })) setEditing(null); }
  // Escape pauses the queue while a run is live. IME composition owns Enter
  // and Escape: a composing key event is never an action.
  function handleCanvasKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[role="dialog"]')) return;
    const run = active && !active.cancel_requested && active.run_id ? active : null;
    if (conversationRunKeyAction({ key: event.key, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode, hasActiveRun: Boolean(run) }) === "pause-run" && run?.run_id) {
      event.preventDefault();
      void chat.mutate({ kind: "stop", run_id: run.run_id });
    }
  }
  async function prioritize(queueEntryId: string, position: number) {
    if (active && !window.confirm(`停止当前回复，优先处理第 ${position} 条？其他待处理消息顺序保留。`)) return;
    if (!active && paused && !window.confirm(`优先处理第 ${position} 条并继续队列？`)) return;
    await chat.mutate({ kind: "prioritize", queue_entry_id: queueEntryId });
  }

  return <main id="main-content" tabIndex={-1} className={styles.canvas} aria-label="对话" data-conversation-canvas data-empty={!hasContent} onKeyDown={handleCanvasKeyDown}>
    {admitted && <header className={styles.header}>
      <div className={styles.headingText}><h1 title={chat.detail?.title || "新对话"}>{chat.detail?.title || "新对话"}</h1></div>
      {personId && !chat.unavailable && <button className={styles.personContext} aria-label={`查看 ${personLabel || "联系人"} 的人物背景`} onClick={event => personContextPanel.open(personId,event.currentTarget)}>人物背景</button>}
      <details className={styles.details}><summary aria-label="对话详情"><DotsThree aria-hidden="true" size={18}/><span className={styles.detailsLabel}>对话详情</span></summary><div className={styles.detailPanel}>
      <p className={styles.detailScope}>{scopeLabel}</p>
      <p>历史回复保留当时的判断，执行前请核对当前信息。</p>
      {chat.detail && <p>保留至 {new Date(chat.detail.expires_at).toLocaleDateString("zh-CN")}</p>}
      {props.meetingLinks?.map(meeting => <a key={meeting.id} href={`/workspace/meetings?draft=${encodeURIComponent(meeting.id)}`}>{meeting.title}</a>)}
      {props.meetingReadFailed && <p>相关日程暂时无法读取。</p>}
      {!chat.unavailable && (confirmDelete ? <div className={styles.confirm}><p>删除对话、草稿和待处理消息？</p><button onClick={() => void remove()}>确认删除</button><button onClick={() => setConfirmDelete(false)}>保留</button></div> : <button className={styles.textButton} onClick={() => setConfirmDelete(true)}><Trash size={16}/>删除对话</button>)}
    </div></details></header>}
    <SessionRuntime key={`${props.chatBinding}:${id ?? "draft"}`} messages={projectedMessages} running={Boolean(activeVisible)}>
    <ThreadPrimitive.Root className={styles.runtimeRoot} data-session-runtime>
    <ThreadPrimitive.Viewport autoScroll={false} className={styles.transcript} ref={viewport} role="region" aria-label="对话记录" tabIndex={0} onWheel={event => { userScroll.current = true; if (event.deltaY < 0) follows.current = false; }} onTouchStart={() => { userScroll.current = true; }} onPointerDown={() => { userScroll.current = true; }} onKeyDown={event => { if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"].includes(event.key)) userScroll.current = true; if (["PageUp", "Home", "ArrowUp"].includes(event.key)) follows.current = false; }} onScroll={() => { if (viewport.current && userScroll.current) { follows.current = conversationNearBottom(viewport.current); setAway(!follows.current); } }}>
      <div className={styles.content} ref={content}>
        {!hasContent && <div className={styles.welcome}><span className={styles.welcomeMark} aria-hidden="true"/><h2>今天想推进什么？</h2></div>}
        <ThreadPrimitive.Messages>{({ message }) => message.role === "user"
          ? <Fragment key={message.id}><SessionSendTime at={(message as { createdAt?: unknown }).createdAt}/><SessionUserMessage context={renderContext}/></Fragment>
          : <SessionAssistantMessage key={message.id} context={renderContext}/>}</ThreadPrimitive.Messages>
        {props.meetingLinks?.filter(meeting=>!turns.some(turn=>turn.response.meetingDraft?.id===meeting.id)).map(meeting=><section key={meeting.id} className="context-calendar-draft-handoff" aria-label="日历草稿核对入口"><strong>{meeting.title}</strong><a href={`/workspace/meetings?draft=${encodeURIComponent(meeting.id)}`}>核对日历草稿 →</a></section>)}
        {chat.messages.map(message => <Fragment key={message.id}><SessionSendTime at={message.createdAt}/><article className={styles.localTurn} data-delivery={message.delivery}><div className={styles.userRow}><div className={styles.userMessage}>{displayText(message.objective, message.images)}{message.images?.length ? <ConversationImageStrip binding={props.chatBinding} images={message.images} local messageId={message.id} scope={props.scope} sessionId={id ?? ""}/> : null}</div></div>{message.delivery === "accepted" ? null : <div className={styles.delivery}>{message.delivery === "unknown" || message.delivery === "rejected" ? <>{message.error || "送达结果尚未确认，请核对后重试。"}<button onClick={() => void chat.retryDelivery(message)}>核对并重试</button>{message.delivery === "rejected" && <button onClick={() => chat.discardRejectedDelivery(message.id)}>移除</button>}</> : message.delivery === "pending" ? "等待送达" : "正在送达…"}</div>}</article></Fragment>)}
      </div>
    </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
    </SessionRuntime>
    <div className={styles.dock}>
      {away && <button className={styles.latest} onClick={latest}><ArrowDown size={15}/>回到最新</button>}
      {props.legacyRecovery && <LegacyRecoveryNotice key={props.legacyRecovery.sessionId} recovery={props.legacyRecovery}/>}
      {queued.length > 0 && <section className={styles.queue} aria-label="可控补充"><div className={styles.queueHeading}><span>{paused ? "已暂停" : queued.some(entry => entry.steers_run_id && entry.steer_state !== "unsupported") ? "本次补充" : "接下来"}<small>{queued.length}</small></span>{paused && <button disabled={chat.mutating || Boolean(active) || queued.some(entry => entry.status !== "queued")} onClick={() => void chat.mutate({kind:"continue"})}>继续处理<ArrowUp size={13}/></button>}</div>
        <ol>{queued.map((entry, index) => <li key={entry.queue_entry_id} data-status={entry.status}>{editing === entry.queue_entry_id ? <form className={styles.edit} onSubmit={event => { event.preventDefault(); void applyEdit(entry.queue_entry_id); }}><label htmlFor={`edit-${entry.queue_entry_id}`}>编辑待处理消息</label><textarea autoFocus id={`edit-${entry.queue_entry_id}`} value={editValue} maxLength={1000} onChange={event => setEditValue(event.target.value)}/><div><button type="button" onClick={() => setEditing(null)}>取消</button><button type="submit" disabled={!editValue.trim() || chat.mutating}>保存</button></div></form> : <><span className={styles.number}>{index + 1}</span><span className={styles.queueText}>{entry.host_result ? "MCP 结果已记录，继续原任务" : displayText(entry.objective, entry.images)}{entry.images?.length ? <ConversationImageStrip binding={props.chatBinding} compact images={entry.images} local={false} messageId={entry.message_id} scope={props.scope} sessionId={id ?? ""}/> : null}{entry.status === "queued" && (active || paused) && <small>{entry.steer_state === "unsupported" ? "这条消息将完整保留到下一任务" : entry.steers_run_id ? entry.steer_delivered ? "已并入当前任务" : entry.steer_state === "dispatching" ? "补充已冻结，正在并入当前任务" : "当前工具完成后并入本次任务" : active ? "完成或停止当前回复后处理" : "已暂停，继续后按此顺序处理"}</small>}{["failed", "interrupted"].includes(entry.status) && <small>{queueFailureText(entry.failure_code, Boolean(entry.images?.length))}</small>}</span><div className={styles.queueActions}>{entry.status === "queued" && entry.objective.trim() && !entry.host_result ? <button aria-label={`编辑第 ${index + 1} 条待处理消息`} disabled={chat.mutating || entry.steer_state === "dispatching" || entry.steer_delivered} onClick={() => { setEditing(entry.queue_entry_id); setEditValue(entry.objective); }}><PencilSimple size={16}/></button> : entry.status === "queued" ? null : <button disabled={chat.mutating} onClick={async () => { if (await chat.mutate({kind:"retry",queue_entry_id:entry.queue_entry_id})) await chat.mutate({kind:"continue"}); }}>重试</button>}{entry.status === "queued" && !entry.steers_run_id && (active || paused || index > 0) && <button className={styles.prioritize} disabled={chat.mutating} title={active ? "停止当前回复并优先处理这条" : "优先处理这条"} aria-label={`优先处理第 ${index + 1} 条待处理消息`} onClick={() => void prioritize(entry.queue_entry_id, index + 1)}><ArrowUp size={14}/>优先</button>}<button aria-label={`移除第 ${index + 1} 条待处理消息`} disabled={chat.mutating || entry.steer_state === "dispatching" || entry.steer_delivered} onClick={() => void chat.mutate({kind:"withdraw",queue_entry_id:entry.queue_entry_id})}><X size={16}/></button></div></>}</li>)}</ol>
      </section>}
      {(chat.error || chat.draftConflict || chat.unavailable) && <div className={styles.notice} role="status">{chat.unavailable ? "这段对话已结束或登录状态发生变化，请重新打开工作台。" : chat.draftConflict ? <>另一处也修改了草稿，当前输入已保留。<button onClick={() => void chat.keepDraft()}>保留当前草稿</button></> : chat.error}</div>}
      {imageCount > 0 && <div className={styles.composerImages} aria-label="要发送的图片">
        {chat.attachments.map((attachment, index) => <span className={styles.composerImage} key={attachment.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={attachment.manifest.file_name} src={attachment.url} />
          <button aria-label={`移除第 ${index + 1} 张图片`} className={styles.composerImageRemove} disabled={!chat.ready || chat.unavailable} onClick={() => chat.removeAttachment(attachment.id)} type="button"><X size={12} weight="bold"/></button>
        </span>)}
      </div>}
      {imageCount >= 10 && <p className={styles.composerImageHint} role="status">已达到每条消息 10 张图片的上限。</p>}
      {chat.preparing && <p className={styles.composerImageHint} role="status">正在准备图片…</p>}
      {chat.submitting && <p className={styles.composerImageHint} role="status">正在发送…</p>}
      <div className={styles.composer}>
        <input accept="image/png,image/jpeg,image/webp" aria-hidden="true" hidden multiple onChange={event => { onPicked(event.target.files); event.target.value = ""; }} ref={filePicker} tabIndex={-1} type="file" />
        <WorkspaceComposer id="queued-conversation-composer" label="消息" value={chat.draft} maxLength={1000} variant="home" layout="inline" rows={1} placeholder={active ? acceptsSteering ? "继续补充，会并入当前任务…" : "继续补充，会按顺序处理…" : paused ? "继续输入，消息会加入暂停的队列…" : imageCount ? "可加一句话说明，或直接发送图片…" : "有什么想一起理清的？"} canSubmit={canSend} disabled={!chat.ready || chat.unavailable} binding={props.detailBinding} onValueChange={chat.changeDraft} onSubmit={() => void send()} onNavigate={navigate} onFiles={files => void chat.addFiles(files)}
          footerStart={<ComposerAddMenu binding={props.detailBinding} onAttachImages={pickFiles} onNavigate={navigate}/>}
          footerEnd={<div className={styles.sendActions}>{active && <button type="button" className={styles.stop} aria-label="停止当前回复" title="停止当前回复，保留后续队列" disabled={chat.mutating || active.cancel_requested} onClick={() => void chat.mutate({kind:"stop",run_id:active.run_id!})}><Stop size={16} weight="fill"/><span>停止</span></button>}<button type="button" className={styles.send} aria-label={acceptsSteering ? "补充当前任务" : active || queued.length || paused ? "加入队列" : "发送消息"} title={acceptsSteering ? "补充当前任务" : active || paused ? "加入队列" : "发送"} disabled={!canSend} onClick={() => void send()}><ArrowUp size={20} aria-hidden="true" weight="bold"/></button></div>}/>
      </div>
      {!hasContent && <div className={styles.starters} aria-label="开始一个话题">{["你可以帮我做什么？", "梳理今天需要跟进的人"].map(text => <button key={text} onClick={() => { chat.changeDraft(text); document.getElementById("queued-conversation-composer")?.focus(); }}>{text}<ArrowUp size={13} aria-hidden="true"/></button>)}</div>}
      <div className={styles.footer}><span role="status" aria-live="polite" aria-atomic="true">{status || ""}</span><span>Enter 发送 · Shift+Enter 换行</span></div>
    </div>
  </main>;
}
