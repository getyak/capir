"use client";

import { useEffect, useState } from "react";
import type { MeetingDraftRecord } from "@talent-signal/contracts";
import { meetingDraftCalendarValue } from "@/lib/meeting-calendar";
import { CalendarDraftReview } from "../calendar-draft-review";
import { workspaceSessionFetch } from "../workspace-session-request";

type PendingDismiss = { version: 1; operationKey: string; revision: number; expiresAt: string };
function dismissStorageKey(binding: string, draftId: string) {
  return `talent-signal:session-calendar-dismiss:${binding}:${draftId}`;
}
function readPendingDismiss(key: string): PendingDismiss | null {
  try {
    const value = window.sessionStorage.getItem(key);
    if (!value) return null;
    const parsed = JSON.parse(value) as PendingDismiss;
    return parsed.version === 1 && Date.parse(parsed.expiresAt) > Date.now() ? parsed : null;
  } catch { return null; }
}
function savePendingDismiss(key: string, pending: PendingDismiss): boolean {
  try {
    const value = JSON.stringify(pending);
    window.sessionStorage.setItem(key, value);
    return window.sessionStorage.getItem(key) === value;
  } catch { return false; }
}

export function SessionCalendarDraftCard(props: { draftId: string; binding: string; sessionId: string }) {
  return <SessionCalendarDraftCardContent key={`${props.binding}:${props.sessionId}:${props.draftId}`} {...props}/>;
}

function SessionCalendarDraftCardContent({ draftId, binding, sessionId }: { draftId: string; binding: string; sessionId: string }) {
  const [record, setRecord] = useState<MeetingDraftRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissPhase, setDismissPhase] = useState<"ready" | "sending" | "unknown" | "dismissed">("ready");
  const [canRetryDismiss, setCanRetryDismiss] = useState(false);
  const key = dismissStorageKey(binding, draftId);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await workspaceSessionFetch(`/api/meeting-drafts/${encodeURIComponent(draftId)}`, {
          method: "GET", cache: "no-store", signal: abort.signal,
          headers: { "x-workspace-session": binding },
        });
        if (!response.ok) throw new Error("会议草稿暂时无法读取。");
        const payload = (await response.json()) as { draft?: MeetingDraftRecord; session_version?: string };
        if (payload.session_version !== binding || payload.draft?.id !== draftId) throw new Error("登录或草稿已变化，请重新打开会话。");
        if (payload.draft.origin_session_id !== sessionId) throw new Error("这份草稿不属于这段会话。");
        if (abort.signal.aborted) return;
        setRecord(payload.draft);
        if (payload.draft.status === "dismissed") {
          window.sessionStorage.removeItem(key);
          setDismissPhase("dismissed");
        } else if (readPendingDismiss(key)) setDismissPhase("unknown");
      } catch (caught) {
        if (!abort.signal.aborted) setError(caught instanceof Error && caught.message === "这份草稿不属于这段会话。"
          ? caught.message : "会议草稿暂时无法读取，请稍后核对。");
      }
    })();
    return () => abort.abort();
  }, [draftId, binding, sessionId, key]);

  async function readCurrent(): Promise<MeetingDraftRecord | null> {
    const response = await workspaceSessionFetch(`/api/meeting-drafts/${encodeURIComponent(draftId)}`, {
      method: "GET", cache: "no-store", headers: { "x-workspace-session": binding },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { draft?: MeetingDraftRecord; session_version?: string };
    return payload.session_version === binding && payload.draft?.id === draftId
      && payload.draft.origin_session_id === sessionId ? payload.draft : null;
  }

  async function checkDismiss() {
    try {
      const current = await readCurrent();
      if (!current) { setError("暂时无法核对日历草稿，请稍后重试。"); return; }
      setRecord(current);
      if (current.status === "dismissed") {
        window.sessionStorage.removeItem(key);
        setDismissPhase("dismissed");
        setCanRetryDismiss(false);
        setError(null);
      } else if (current.status !== "needs_review" || !current.content_available) {
        setDismissPhase("ready");
        setError("来源已变化，暂不安排的结果需要重新核对。");
      } else {
        const pending = readPendingDismiss(key);
        if (!pending || pending.revision !== current.revision) {
          window.sessionStorage.removeItem(key);
          setDismissPhase("ready");
          setCanRetryDismiss(false);
          setError("草稿已变化，请重新核对后决定。");
        } else {
          setDismissPhase("unknown");
          setCanRetryDismiss(true);
          setError(null);
        }
      }
    } catch { setError("暂时无法核对日历草稿，请稍后重试。"); }
  }

  async function dismiss() {
    if (!record || record.status !== "needs_review" || !record.content_available
      || !(dismissPhase === "ready" || (dismissPhase === "unknown" && canRetryDismiss))) return;
    const prior = readPendingDismiss(key);
    if (dismissPhase === "unknown" && !prior) return;
    const pending: PendingDismiss = prior ?? { version: 1, operationKey: crypto.randomUUID(), revision: record.revision, expiresAt: record.expires_at };
    if (!savePendingDismiss(key, pending)) { setError("浏览器无法保存这次操作，已停止提交。"); return; }
    setDismissPhase("sending");
    setCanRetryDismiss(false);
    setError(null);
    try {
      const response = await workspaceSessionFetch(`/api/meeting-drafts/${encodeURIComponent(draftId)}/dismiss`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-workspace-session": binding },
        body: JSON.stringify({ expected_revision: pending.revision, idempotency_key: pending.operationKey }),
      });
      if (!response.ok) {
        const failure = await response.clone().json().catch(() => null);
        if (failure?.code === "IDEMPOTENCY_REQUEST_IN_PROGRESS") {
          setDismissPhase("unknown");
        } else if (response.status >= 400 && response.status < 500) {
          window.sessionStorage.removeItem(key);
          setDismissPhase("ready");
          setError("草稿已变化或来源已失效，请重新核对。");
        } else setDismissPhase("unknown");
        return;
      }
      const payload = (await response.json()) as { draft?: MeetingDraftRecord; session_version?: string };
      if (payload.session_version !== binding || payload.draft?.id !== draftId || payload.draft.status !== "dismissed") {
        setDismissPhase("unknown");
        return;
      }
      setRecord(payload.draft);
      window.sessionStorage.removeItem(key);
      setDismissPhase("dismissed");
      setCanRetryDismiss(false);
    } catch { setDismissPhase("unknown"); }
  }

  if (error && !record) return <section className="context-calendar-draft-handoff" role="alert">{error} <a href={`/workspace/meetings?draft=${encodeURIComponent(draftId)}`}>在时间页核对日历草稿</a></section>;
  if (!record) return <section className="context-calendar-draft-handoff" role="status">正在读取日历草稿…</section>;
  if (dismissPhase === "dismissed" || record.status === "dismissed") return <section className="context-calendar-draft-handoff" role="status">本次不安排 · {record.title ?? "日历草稿"}</section>;
  if (dismissPhase === "sending" || dismissPhase === "unknown") return <section className="context-calendar-draft-handoff" role="status">
    <strong>{record.title ?? "日历草稿"}</strong><p>{dismissPhase === "sending" ? "正在记录本次决定…" : "结果待核对"}</p>
    {dismissPhase === "unknown" ? <button type="button" onClick={() => void checkDismiss()}>核对结果</button> : null}
    {dismissPhase === "unknown" && canRetryDismiss ? <button type="button" onClick={() => void dismiss()}>重试原操作</button> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
  const draft = meetingDraftCalendarValue(record);
  if (!draft) return <section className="context-calendar-draft-handoff" role="alert">来源已失效，这份日历草稿不能导出。</section>;
  return <div>{error ? <p role="alert">{error}</p> : null}<CalendarDraftReview draft={draft} persistence={{
    draftId: record.id,
    expiresAt: record.expires_at,
    revision: record.revision,
    sessionVersion: binding,
  }} variant="session" onDismiss={() => void dismiss()} onDraftSaved={setRecord}/>
    <a className="context-calendar-draft-handoff" href={`/workspace/meetings?draft=${encodeURIComponent(draftId)}`}>在时间页查看日历草稿</a>
  </div>;
}
