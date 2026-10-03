"use client";

import type { CalendarDraft, MeetingDraftRecord } from "@talent-signal/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  calendarDraftFile,
  calendarLocalTime,
  calendarUTCFromLocal,
} from "@/lib/calendar-draft";
import { meetingDraftCalendarValue } from "@/lib/meeting-calendar";
import {
  clearPendingMeetingDraftEdit,
  meetingDraftIntentIsKnownClean,
  readPendingMeetingDraftEdit,
  writePendingMeetingDraftEdit,
} from "@/lib/meeting-draft-pending";
import { workspaceSessionFetch } from "./workspace-session-request";

import styles from "./agent-review-form.module.css";

export type CalendarDraftPersistence = {
  draftId: string;
  expiresAt: string;
  revision: number;
  sessionVersion: string;
};

type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";
type ReviewValues = { title: string; starts_at: string; ends_at: string };
type DraftConflict = { draft: CalendarDraft; revision: number; record: MeetingDraftRecord };

class DraftRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly current?: MeetingDraftRecord,
  ) {
    super(message);
  }
}

function reviewedDraft(
  draft: CalendarDraft,
  title: string,
  start: string,
  end: string,
): CalendarDraft {
  const reviewed = {
    ...draft,
    title: title.trim(),
    starts_at: calendarUTCFromLocal(start, draft.time_zone),
    ends_at: calendarUTCFromLocal(end, draft.time_zone),
  };
  const duration = Date.parse(reviewed.ends_at) - Date.parse(reviewed.starts_at);
  if (!reviewed.title || duration <= 0 || duration > 7 * 86_400_000) {
    throw new Error("invalid_interval");
  }
  return reviewed;
}

function values(draft: CalendarDraft): ReviewValues {
  return {
    title: draft.title,
    starts_at: draft.starts_at,
    ends_at: draft.ends_at,
  };
}

function sessionLocalInterval(start: string, end: string): string {
  const day = (value: string): string | null => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(value)) return null;
    const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
    if (!Number.isFinite(date.getTime())) return null;
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "numeric", day: "numeric", weekday: "short", timeZone: "UTC",
    }).format(date);
  };
  const startDay = day(start);
  const endDay = day(end);
  if (!startDay || !endDay) return "时间待核对";
  const startTime = start.slice(11, 16);
  const endTime = end.slice(11, 16);
  return start.slice(0, 10) === end.slice(0, 10)
    ? `${startDay} · ${startTime}–${endTime}`
    : `${startDay} ${startTime} – ${endDay} ${endTime}`;
}

function sameValues(left: ReviewValues, right: ReviewValues): boolean {
  return left.title === right.title &&
    left.starts_at === right.starts_at &&
    left.ends_at === right.ends_at;
}

function downloadCalendarDraft(draft: CalendarDraft) {
  const url = URL.createObjectURL(
    new Blob([calendarDraftFile(draft)], { type: "text/calendar;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "calendar-draft.ics";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CalendarDraftReview({
  draft,
  persistence,
  variant = "page",
  onDismiss,
  onDraftSaved,
}: {
  draft: CalendarDraft;
  persistence: CalendarDraftPersistence;
  variant?: "page" | "session";
  onDismiss?: () => void;
  onDraftSaved?: (draft: MeetingDraftRecord) => void;
}) {
  const router = useRouter();
  const [generated, setGenerated] = useState(false);
  const [sessionEditing, setSessionEditing] = useState(false);
  const [title, setTitle] = useState(draft.title);
  const [start, setStart] = useState(() =>
    calendarLocalTime(draft.starts_at, draft.time_zone));
  const [end, setEnd] = useState(() =>
    calendarLocalTime(draft.ends_at, draft.time_zone));
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const currentRevision = useRef(persistence?.revision ?? 1);
  const lastSaved = useRef<ReviewValues>(values(draft));
  const attempt = useRef<{
    expectedRevision: number;
    key: string;
    value: ReviewValues;
  } | null>(null);
  const saving = useRef<Promise<CalendarDraft> | null>(null);
  const blockedByConflict = useRef(false);
  const unknownServerOutcome = useRef(false);
  const latest = useRef({
    end: calendarLocalTime(draft.ends_at, draft.time_zone),
    start: calendarLocalTime(draft.starts_at, draft.time_zone),
    title: draft.title,
  });
  const dirty = useRef(false);
  const composing = useRef(false);

  const forgetRecoverableAttempt = useCallback(function forgetRecoverableAttempt() {
    attempt.current = null;
    if (persistence) {
      clearPendingMeetingDraftEdit(
        persistence.draftId,
        persistence.sessionVersion,
      );
    }
  }, [persistence]);

  const rememberPending = useCallback(function rememberPending(
    next: ReviewValues,
    key: string,
    expectedRevision: number,
  ): boolean {
    if (!persistence) return true;
    return writePendingMeetingDraftEdit({
      draftId: persistence.draftId,
      end: calendarLocalTime(next.ends_at, draft.time_zone),
      expectedRevision,
      expiresAt: persistence.expiresAt,
      idempotencyKey: key,
      savedAt: new Date().toISOString(),
      sessionVersion: persistence.sessionVersion,
      start: calendarLocalTime(next.starts_at, draft.time_zone),
      title: next.title,
      v: 1,
    });
  }, [draft.time_zone, persistence]);

  async function persist(reviewed: CalendarDraft): Promise<CalendarDraft> {
    if (!persistence) return reviewed;
    const next = values(reviewed);
    if (meetingDraftIntentIsKnownClean(
      next,
      lastSaved.current,
      unknownServerOutcome.current,
    )) {
      dirty.current = false;
      attempt.current = null;
      clearPendingMeetingDraftEdit(persistence.draftId, persistence.sessionVersion);
      setSaveState("saved");
      return reviewed;
    }
    if (saving.current) return saving.current;

    if (!attempt.current || !sameValues(attempt.current.value, next)) {
      attempt.current = {
        expectedRevision: currentRevision.current,
        key: crypto.randomUUID(),
        value: next,
      };
    }
    const requestAttempt = attempt.current;
    if (!rememberPending(
      next,
      requestAttempt.key,
      requestAttempt.expectedRevision,
    )) {
      forgetRecoverableAttempt();
      const persistenceError = new Error(
        "浏览器无法先保存这次修改意图，已停止向后端发送。",
      );
      setSaveState("error");
      setError(persistenceError.message);
      throw persistenceError;
    }
    setSaveState("saving");
    setError(null);
    const promise = (async () => {
      const response = await workspaceSessionFetch(
        `/api/meeting-drafts/${encodeURIComponent(persistence.draftId)}`,
        {
          body: JSON.stringify({
            expected_revision: requestAttempt.expectedRevision,
            idempotency_key: requestAttempt.key,
            ...next,
          }),
          headers: {
            "content-type": "application/json",
            "x-workspace-session": persistence.sessionVersion,
          },
          keepalive: true,
          method: "PUT",
        },
      );
      const payload = (await response.json()) as {
        code?: string;
        draft?: MeetingDraftRecord;
        message?: string;
      };
      if (!response.ok || !payload.draft) {
        throw new DraftRequestError(
          payload.message || "会议草稿无法保存。",
          payload.code,
          payload.draft,
        );
      }
      const current = meetingDraftCalendarValue(payload.draft);
      if (!current) throw new Error("后端返回的草稿已不可核对。");
      const canonicalStart = calendarLocalTime(
        current.starts_at,
        current.time_zone,
      );
      const canonicalEnd = calendarLocalTime(
        current.ends_at,
        current.time_zone,
      );
      setTitle(current.title);
      setStart(canonicalStart);
      setEnd(canonicalEnd);
      latest.current = {
        end: canonicalEnd,
        start: canonicalStart,
        title: current.title,
      };
      currentRevision.current = payload.draft.revision;
      onDraftSaved?.(payload.draft);
      lastSaved.current = values(current);
      unknownServerOutcome.current = false;
      attempt.current = null;
      dirty.current = false;
      blockedByConflict.current = false;
      clearPendingMeetingDraftEdit(persistence.draftId, persistence.sessionVersion);
      setConflict(null);
      setSaveState("saved");
      return current;
    })();
    saving.current = promise;
    try {
      return await promise;
    } catch (caught) {
      const knownServerOutcome = caught instanceof DraftRequestError && (
        caught.code?.startsWith("MEETING_DRAFT_") ||
        [
          "backend_session_expired",
          "invalid_content_type",
          "meeting_draft_invalid",
          "origin_rejected",
          "session_stale",
        ].includes(caught.code ?? "")
      );
      unknownServerOutcome.current = !knownServerOutcome;
      setSaveState("error");
      setError(caught instanceof Error ? caught.message : "会议草稿无法保存。");
      if (
        caught instanceof DraftRequestError &&
        caught.code === "MEETING_DRAFT_REVISION_CONFLICT" &&
        caught.current
      ) {
        const current = meetingDraftCalendarValue(caught.current);
        if (current) {
          blockedByConflict.current = true;
          setConflict({ draft: current, revision: caught.current.revision, record: caught.current });
        } else {
          clearPendingMeetingDraftEdit(persistence.draftId, persistence.sessionVersion);
          dirty.current = false;
          attempt.current = null;
          router.refresh();
        }
      } else if (
        caught instanceof DraftRequestError &&
        caught.code?.startsWith("MEETING_DRAFT_")
      ) {
        clearPendingMeetingDraftEdit(persistence.draftId, persistence.sessionVersion);
        dirty.current = false;
        attempt.current = null;
        router.refresh();
      }
      throw caught;
    } finally {
      saving.current = null;
    }
  }

  useEffect(() => {
    if (!persistence) return;
    const pending = readPendingMeetingDraftEdit(
      persistence.draftId,
      persistence.sessionVersion,
    );
    if (!pending) return;
    let pendingValues: ReviewValues;
    try {
      pendingValues = {
        title: pending.title.trim(),
        starts_at: calendarUTCFromLocal(pending.start, draft.time_zone),
        ends_at: calendarUTCFromLocal(pending.end, draft.time_zone),
      };
    } catch {
      clearPendingMeetingDraftEdit(persistence.draftId, persistence.sessionVersion);
      return;
    }
    const timer = window.setTimeout(() => {
      latest.current = {
        end: pending.end,
        start: pending.start,
        title: pending.title,
      };
      attempt.current = {
        expectedRevision: pending.expectedRevision,
        key: pending.idempotencyKey,
        value: pendingValues,
      };
      unknownServerOutcome.current = true;
      dirty.current = true;
      setTitle(pending.title);
      setStart(pending.start);
      setEnd(pending.end);
      setSaveState("dirty");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draft, persistence]);

  useEffect(() => {
    if (!persistence || saveState !== "dirty" || isComposing) return;
    const timer = window.setTimeout(() => {
      let reviewed: CalendarDraft;
      try {
        reviewed = reviewedDraft(draft, title, start, end);
      } catch {
        forgetRecoverableAttempt();
        setError("请核对标题和起止时间；夏令时切换产生的重复或不存在时间不能保存。");
        setSaveState("error");
        return;
      }
      void persist(reviewed).then(() => router.refresh()).catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(timer);
  // `persist` intentionally uses the current render's reviewed values. Saving
  // disables inputs, so no second edit can race an in-flight optimistic write.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, end, isComposing, persistence, saveState, start, title]);

  useEffect(() => {
    if (!persistence) return;
    const flushOnExit = () => {
      if (
        !dirty.current ||
        saving.current ||
        blockedByConflict.current ||
        composing.current
      ) return;
      let reviewed: CalendarDraft;
      try {
        reviewed = reviewedDraft(
          draft,
          latest.current.title,
          latest.current.start,
          latest.current.end,
        );
      } catch {
        forgetRecoverableAttempt();
        return;
      }
      const next = values(reviewed);
      if (meetingDraftIntentIsKnownClean(
        next,
        lastSaved.current,
        unknownServerOutcome.current,
      )) {
        dirty.current = false;
        attempt.current = null;
        clearPendingMeetingDraftEdit(
          persistence.draftId,
          persistence.sessionVersion,
        );
        return;
      }
      if (!attempt.current || !sameValues(attempt.current.value, next)) {
        attempt.current = {
          expectedRevision: currentRevision.current,
          key: crypto.randomUUID(),
          value: next,
        };
      }
      if (!rememberPending(
        next,
        attempt.current.key,
        attempt.current.expectedRevision,
      )) {
        forgetRecoverableAttempt();
        return;
      }
      void workspaceSessionFetch(
        `/api/meeting-drafts/${encodeURIComponent(persistence.draftId)}`,
        {
          body: JSON.stringify({
            expected_revision: attempt.current.expectedRevision,
            idempotency_key: attempt.current.key,
            ...next,
          }),
          headers: {
            "content-type": "application/json",
            "x-workspace-session": persistence.sessionVersion,
          },
          keepalive: true,
          method: "PUT",
        },
      ).catch(() => undefined);
    };
    window.addEventListener("pagehide", flushOnExit);
    return () => {
      window.removeEventListener("pagehide", flushOnExit);
      flushOnExit();
    };
  }, [draft, forgetRecoverableAttempt, persistence, rememberPending]);

  useEffect(() => {
    if (
      !persistence ||
      conflict ||
      dirty.current ||
      persistence.revision === currentRevision.current
    ) return;
    currentRevision.current = persistence.revision;
    lastSaved.current = values(draft);
    latest.current = {
      end: calendarLocalTime(draft.ends_at, draft.time_zone),
      start: calendarLocalTime(draft.starts_at, draft.time_zone),
      title: draft.title,
    };
    setTitle(latest.current.title);
    setStart(latest.current.start);
    setEnd(latest.current.end);
    setSaveState("clean");
  }, [conflict, draft, persistence]);

  function changed(setter: (value: string) => void, value: string) {
    setter(value);
    if (setter === setTitle) latest.current.title = value;
    else if (setter === setStart) latest.current.start = value;
    else latest.current.end = value;
    dirty.current = Boolean(persistence);
    if (persistence && !conflict) {
      try {
        const next = values(reviewedDraft(
          draft,
          latest.current.title,
          latest.current.start,
          latest.current.end,
        ));
        if (!attempt.current || !sameValues(attempt.current.value, next)) {
          attempt.current = {
            expectedRevision: currentRevision.current,
            key: crypto.randomUUID(),
            value: next,
          };
        }
        if (!rememberPending(
          next,
          attempt.current.key,
          attempt.current.expectedRevision,
        )) {
          forgetRecoverableAttempt();
          setGenerated(false);
          setError("浏览器无法先保存这次修改意图，已停止向后端发送。");
          setSaveState("error");
          return;
        }
      } catch {
        // The latest raw edit supersedes any older valid operation. Keep the
        // raw fields visible, but make reload recovery ineligible immediately.
        forgetRecoverableAttempt();
        setGenerated(false);
        setError("请核对标题和起止时间；当前输入不会在刷新后自动提交。");
        setSaveState("error");
        return;
      }
    }
    setGenerated(false);
    if (!conflict) setError(null);
    setSaveState(persistence ? (conflict ? "error" : "dirty") : "clean");
  }

  async function flushCurrent() {
    if (
      !persistence ||
      !dirty.current ||
      saving.current ||
      blockedByConflict.current ||
      composing.current
    ) return;
    try {
      const reviewed = reviewedDraft(
        draft,
        latest.current.title,
        latest.current.start,
        latest.current.end,
      );
      await persist(reviewed);
      router.refresh();
    } catch {
      // `persist` exposes a visible error and any current server version.
    }
  }

  function useServerVersion() {
    if (!conflict || !persistence) return;
    const local = {
      end: calendarLocalTime(conflict.draft.ends_at, conflict.draft.time_zone),
      start: calendarLocalTime(conflict.draft.starts_at, conflict.draft.time_zone),
      title: conflict.draft.title,
    };
    currentRevision.current = conflict.revision;
    onDraftSaved?.(conflict.record);
    lastSaved.current = values(conflict.draft);
    latest.current = local;
    attempt.current = null;
    dirty.current = false;
    blockedByConflict.current = false;
    unknownServerOutcome.current = false;
    clearPendingMeetingDraftEdit(
      persistence.draftId,
      persistence.sessionVersion,
    );
    setTitle(local.title);
    setStart(local.start);
    setEnd(local.end);
    setConflict(null);
    setError(null);
    setSaveState("saved");
    router.refresh();
  }

  function reapplyLocalVersion() {
    if (!conflict) return;
    currentRevision.current = conflict.revision;
    lastSaved.current = values(conflict.draft);
    attempt.current = null;
    dirty.current = true;
    blockedByConflict.current = false;
    unknownServerOutcome.current = false;
    setConflict(null);
    setError(null);
    setSaveState("dirty");
  }

  async function exportDraft() {
    let reviewed: CalendarDraft;
    try {
      reviewed = reviewedDraft(draft, title, start, end);
      reviewed = await persist(reviewed);
      if (persistence) {
        const response = await workspaceSessionFetch(
          `/api/meeting-drafts/${encodeURIComponent(persistence.draftId)}`,
          {
            body: JSON.stringify({ expected_revision: currentRevision.current }),
            headers: {
              "content-type": "application/json",
              "x-workspace-session": persistence.sessionVersion,
            },
            method: "POST",
          },
        );
        const payload = (await response.json()) as {
          draft?: MeetingDraftRecord;
          message?: string;
        };
        if (!response.ok || !payload.draft) {
          throw new Error(payload.message || "导出前无法确认草稿仍然有效。");
        }
        const authorized = meetingDraftCalendarValue(payload.draft);
        if (!authorized) throw new Error("草稿来源不再可用，已停止导出。");
        currentRevision.current = payload.draft.revision;
        reviewed = authorized;
      }
      setError(null);
      downloadCalendarDraft(reviewed);
      setGenerated(true);
      setSaveState("saved");
    } catch (caught) {
      setGenerated(false);
      const validationError = caught instanceof Error && (
        caught.message === "invalid_interval" || caught.message === "CALENDAR_DRAFT_INVALID"
        || caught.message.startsWith("CALENDAR_LOCAL_TIME_")
      );
      setError(
        caught instanceof Error && !validationError
          ? caught.message
          : "请核对标题和起止时间；夏令时切换产生的重复或不存在时间不能直接导出。",
      );
      if (persistence) router.refresh();
    }
  }

  function retrySave() {
    let reviewed: CalendarDraft;
    try {
      reviewed = reviewedDraft(draft, title, start, end);
    } catch {
      setError("请核对标题和起止时间；夏令时切换产生的重复或不存在时间不能保存。");
      return;
    }
    void persist(reviewed).then(() => router.refresh()).catch(() => undefined);
  }

  const busy = saveState === "saving";
  if (variant === "session") {
    return <section className={`${styles.review} ${styles.sessionCard}`} aria-label="日历草稿" data-testid="session-calendar-draft-card">
      <div className={styles.sessionCardHead}><span>日历 · 待安排</span><span>日历文件</span></div>
      <h3>{title}</h3>
      <p className={styles.sessionCardTime}>{sessionLocalInterval(start, end)} · {draft.time_zone}</p>
      <blockquote>{draft.source_excerpt}</blockquote>
      {sessionEditing ? <div className={styles.sessionCardFields}>
        <label className={styles.field}>标题<input value={title} maxLength={200} disabled={busy}
          onBlur={() => void flushCurrent()}
          onChange={(event) => {
            if ((event.nativeEvent as InputEvent).isComposing || composing.current) {
              setTitle(event.target.value);
              latest.current.title = event.target.value;
              return;
            }
            changed(setTitle, event.target.value);
          }}
          onCompositionStart={() => { composing.current = true; setIsComposing(true); }}
          onCompositionEnd={(event) => { composing.current = false; setIsComposing(false); changed(setTitle, event.currentTarget.value); }}/></label>
        <label className={styles.field}>开始时间<input type="datetime-local" value={start} disabled={busy} onChange={(event) => changed(setStart, event.target.value)} onBlur={() => void flushCurrent()}/></label>
        <label className={styles.field}>结束时间<input type="datetime-local" value={end} disabled={busy} onChange={(event) => changed(setEnd, event.target.value)} onBlur={() => void flushCurrent()}/></label>
        <button className={styles.secondary} type="button" onClick={() => { void flushCurrent(); setSessionEditing(false); }}>完成修改</button>
      </div> : null}
      {conflict ? <section className={styles.conflict} role="alert"><strong>这份草稿已在别处修改</strong><p>你的输入仍保留。请选择一个版本。</p>
        <div className={styles.actions}><button className={styles.secondary} type="button" onClick={useServerVersion}>使用服务器版本</button><button className={styles.secondary} type="button" onClick={reapplyLocalVersion}>重新应用我的编辑</button></div>
      </section> : null}
      <div className={styles.sessionCardActions}>
        <button className={styles.primary} type="button" disabled={busy || Boolean(conflict)} onClick={() => void exportDraft()}>下载日历草稿</button>
        <button className={styles.secondary} type="button" disabled={busy} onClick={() => setSessionEditing(!sessionEditing)}>{sessionEditing ? "收起编辑" : "改时间"}</button>
        <button className={styles.secondary} type="button" disabled={busy} onClick={onDismiss}>暂不安排</button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <p role="status">{generated ? "已生成日历草稿，请在日历应用中确认导入" : saveState === "saving" ? "正在保存修改…" : saveState === "error" ? "更改尚未保存" : "导入由日历应用确认"}</p>
    </section>;
  }
  return (
    <section className={styles.review} aria-label="日历草稿" data-testid="calendar-draft-review">
      <h3>核对日历草稿</h3>
      <label className={styles.field}>
        标题
        <input
          disabled={busy}
          maxLength={200}
          onBlur={() => void flushCurrent()}
          onChange={(event) => {
            if ((event.nativeEvent as InputEvent).isComposing || composing.current) {
              setTitle(event.target.value);
              latest.current.title = event.target.value;
              return;
            }
            changed(setTitle, event.target.value);
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            setIsComposing(false);
            changed(setTitle, event.currentTarget.value);
          }}
          onCompositionStart={() => {
            composing.current = true;
            setIsComposing(true);
          }}
          value={title}
        />
      </label>
      <label className={styles.field}>
        开始时间
        <input
          disabled={busy}
          onBlur={() => void flushCurrent()}
          onChange={(event) => changed(setStart, event.target.value)}
          type="datetime-local"
          value={start}
        />
      </label>
      <label className={styles.field}>
        结束时间
        <input
          disabled={busy}
          onBlur={() => void flushCurrent()}
          onChange={(event) => changed(setEnd, event.target.value)}
          type="datetime-local"
          value={end}
        />
      </label>
      <p>{draft.time_zone} · 待确认，尚未创建日历事件</p>
      {persistence ? (
        <p aria-live="polite" role="status">
          {saveState === "saving"
            ? "正在保存核对内容…"
            : saveState === "dirty"
              ? "更改尚未保存"
              : saveState === "error"
                ? "更改未保存"
                : saveState === "saved"
                  ? "核对内容已保存"
                  : "编辑后会自动保存到这份草稿"}
        </p>
      ) : null}
      <details>
        <summary>查看原文</summary>
        <blockquote>{draft.source_excerpt}</blockquote>
      </details>
      {conflict ? (
        <section aria-label="草稿版本冲突" className={styles.conflict} role="alert">
          <strong>这份草稿已在别处修改</strong>
          <p>
            服务器版本：{conflict.draft.title} ·
            {calendarLocalTime(conflict.draft.starts_at, conflict.draft.time_zone)}–
            {calendarLocalTime(conflict.draft.ends_at, conflict.draft.time_zone)}
          </p>
          <p>你的编辑仍保留在上方输入框中。请选择一个版本后再导出。</p>
          <div className={styles.actions}>
            <button className={styles.secondary} onClick={useServerVersion} type="button">
              使用服务器版本
            </button>
            <button className={styles.primary} onClick={reapplyLocalVersion} type="button">
              重新应用我的编辑
            </button>
          </div>
        </section>
      ) : null}
      {saveState === "error" && !conflict ? (
        <button className={styles.secondary} onClick={retrySave} type="button">
          重试保存
        </button>
      ) : null}
      <button
        className={styles.primary}
        disabled={busy || Boolean(conflict)}
        onClick={() => void exportDraft()}
        type="button"
      >
        {busy ? "正在保存…" : conflict ? "先处理版本冲突" : "下载日历草稿"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      <p role="status">
        {generated
          ? "已生成日历文件，请在日历应用中核对并确认导入。"
          : "只导出标题和时间，导入由你的日历应用确认。"}
      </p>
    </section>
  );
}
