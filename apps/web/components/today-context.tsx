"use client";

import { useLocale, useT } from "./locale-provider";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { TimeActivity } from "@talent-signal/contracts";
import { formatTodayArrangement, projectTodaySchedules, projectTodayUnread, todayScope, type TodayProjection } from "@/lib/today-context";
import type { RecentSession } from "@/lib/workspace-recent-sessions";
import { coordinatorScopeIsCurrent, requestWorkspaceRefresh, subscribeWorkspaceRefresh, workspaceRefreshGeneration } from "@/lib/workspace-refresh";
import { dateInZone, formatDay, timeHref } from "@/lib/time-workspace";
import { TimeRequestError, timeRequest } from "@/lib/time-workspace-client";
import { withAuthRequestTimeout } from "@/lib/auth-request-timeout";
import { WORKSPACE_SESSION_EXPIRED_EVENT, workspaceSessionFetch } from "./workspace-session-request";
import styles from "./today-context.module.css";

type Source<T> = TodayProjection<T> | { item: null; coverage: "loading" };
type State = { binding: string; day: string | null; zone: string | null; key: string;
  schedule: Source<TimeActivity>; unread: Source<RecentSession> };
const loading = <T,>(): Source<T> => ({ item: null, coverage: "loading" });
const unavailable = <T,>(): Source<T> => ({ item: null, coverage: "unavailable" });
const initial = (binding: string): State => ({ binding, day: null, zone: null, key: "", schedule: loading(), unread: loading() });

/** One read owner, subscribed to the workspace coordinator; no additional poller. */
export function useTodayContext(binding: string, expiresAt: string | null = null) {
  const [state, setState] = useState<State>(() => initial(binding));
  useEffect(() => {
    let released = false, revoked = false;
    let inFlight: { key: string; controller: AbortController } | null = null;
    let boundary: ReturnType<typeof setTimeout> | null = null;
    let scheduleEnd = Infinity, unreadExpiry = Infinity;
    const expiry = expiresAt ? Date.parse(expiresAt) : Infinity;
    function armBoundary(now = new Date()) {
      if (released || revoked) return;
      if (boundary) clearTimeout(boundary);
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
      const next = Math.min(midnight, expiry, ...[scheduleEnd, unreadExpiry].filter(at => at > now.getTime()));
      boundary = setTimeout(() => { boundary = null; refresh("boundary"); }, Math.max(1, next - now.getTime()));
    }
    function expire() {
      revoked = true;
      inFlight?.controller.abort();
      if (boundary) clearTimeout(boundary);
      if (!released) setState(previous => ({ ...previous, binding, schedule: unavailable(), unread: unavailable() }));
    }
    function refresh(_reason?: unknown, generation = workspaceRefreshGeneration(binding)) {
      if (released || revoked) return;
      const now = new Date();
      if (!binding || (!Number.isFinite(expiry) && expiry !== Infinity) || now.getTime() >= expiry) { expire(); return; }
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const scope = todayScope(now, zone);
      const key = `${binding}:${scope.from}:${zone}`;
      setState(previous => previous.binding === binding && previous.key === key
        ? { ...previous, schedule: previous.schedule.item?.ends_at && Date.parse(previous.schedule.item.ends_at) <= now.getTime() ? loading() : previous.schedule,
          unread: previous.unread.item && previous.unread.item.expiresAt <= now.getTime() ? loading() : previous.unread }
        : { ...initial(binding), day: scope.from, zone, key });
      // Keep known expiry deadlines even when an interval read is still pending.
      armBoundary(now);
      if (document.hidden) return;
      if (inFlight?.key === key) return;
      inFlight?.controller.abort();
      const controller = new AbortController();
      inFlight = { key, controller };
      const valid = () => !released && !revoked && !controller.signal.aborted && coordinatorScopeIsCurrent(binding, generation) &&
        Intl.DateTimeFormat().resolvedOptions().timeZone === zone && dateInZone(new Date(), zone) === scope.from;
      const pages: unknown[] = [];
      const failed = (error: unknown, source: "schedule" | "unread") => {
        if (!valid()) return;
        if (error instanceof TimeRequestError && [401, 409].includes(error.status)) { expire(); return; }
        const sourceOutage = !(error instanceof TimeRequestError) || error.status === 0 || error.status >= 500;
        if (source === "schedule" && sourceOutage && pages.length) {
          const projected = projectTodaySchedules(pages, scope, new Date());
          setState(previous => ({ ...previous, schedule: projected }));
          scheduleEnd = projected.item?.ends_at ? Date.parse(projected.item.ends_at) : Infinity;
          armBoundary();
          return;
        }
        setState(previous => ({ ...previous, [source]: unavailable() }));
      };
      const schedules = async (signal: AbortSignal) => {
        let after: string | null = null;
        for (let count = 0; count < 3; count++) {
          const query = new URLSearchParams({ ...scope, ...(after ? { after } : {}) });
          const page = await timeRequest(`/api/time/activities?${query}`, binding, { signal });
          if (!valid() || signal.aborted) return;
          pages.push(page);
          const projected = projectTodaySchedules(pages, scope, new Date());
          if (projected.coverage !== "partial" || count === 2) {
            setState(previous => ({ ...previous, schedule: projected }));
            scheduleEnd = projected.item?.ends_at ? Date.parse(projected.item.ends_at) : Infinity;
            armBoundary();
            return;
          }
          after = page.next_cursor;
        }
      };
      const sessions = async (signal: AbortSignal) => {
        const response = await workspaceSessionFetch("/api/workspace-sessions", {
          signal, headers: new Headers({ "x-workspace-session": binding }), cache: "no-store",
        });
        const payload: unknown = await response.json();
        if (!valid() || signal.aborted) return;
        if (!response.ok) throw new TimeRequestError("Directory unavailable", response.status);
        const projected = projectTodayUnread(payload, binding, new Date());
        if (payload && typeof payload === "object" && "session_version" in payload && payload.session_version !== binding) { expire(); return; }
        setState(previous => ({ ...previous, unread: projected }));
        unreadExpiry = projected.item?.expiresAt ?? Infinity;
        armBoundary();
      };
      const deadline = { timeoutMs: 15_000, signal: controller.signal };
      void Promise.all([withAuthRequestTimeout(schedules, deadline).catch(error => failed(error, "schedule")),
        withAuthRequestTimeout(sessions, deadline).catch(error => failed(error, "unread"))])
        .finally(() => { if (inFlight?.controller === controller) inFlight = null; });
    }
    const unsubscribe = binding ? subscribeWorkspaceRefresh(binding, refresh) : () => undefined;
    window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
    refresh();
    return () => { released = true; inFlight?.controller.abort(); if (boundary) clearTimeout(boundary); unsubscribe(); window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire); };
  }, [binding, expiresAt]);
  return { ...(state.binding === binding ? state : initial(binding)), retry: () => requestWorkspaceRefresh(binding) };
}

export function TodayContext({ binding, expiresAt = null }: { binding: string; expiresAt?: string | null }) {
  const t = useT();
  const locale = useLocale();
  const today = useTodayContext(binding, expiresAt);
  const schedule = today.schedule.item, unread = today.unread.item;
  const scheduleHref = schedule ? timeHref(new URLSearchParams(), { day: dateInZone(schedule.occurred_at, schedule.time_zone),
    view: "timeline", range: "day", tz: schedule.time_zone, item: `schedule:${schedule.source_id}` }) : null;
  return <section className={styles.context} aria-label={t("今日概览")}>
    <header className={styles.header}><h1 className={styles.date}>{today.day ? <time dateTime={today.day}>
      <span>{formatDay(today.day, { month: "long", day: "numeric" }, locale)}</span>
      <small>{formatDay(today.day, { year: "numeric", weekday: "long" }, locale)}</small>
    </time> : t("今日")}</h1></header>
    <div className={styles.cards}>
      <article className={styles.card} aria-labelledby="today-arrangement-heading">
        <h2 id="today-arrangement-heading">{today.schedule.coverage === "partial" ? t("已读取的安排") : t("接下来的安排")}</h2>
        {schedule && scheduleHref ? <>
          <Link className={styles.title} href={scheduleHref}>{schedule.title}</Link>
          <p>{formatTodayArrangement(schedule, locale)}</p>
          <p className={styles.note}>{t("由你记录")} · {schedule.time_zone}</p>
        </> : <p>{today.schedule.coverage === "loading" ? t("正在读取安排…") : today.schedule.coverage === "complete" ? t("未来七天暂时没有待进行的安排。") : today.schedule.coverage === "partial" ? t("尚未读完此范围，暂未找到待进行的安排。") : t("安排暂时无法读取。")}</p>}
        {today.schedule.coverage === "partial" ? <p className={styles.note}>{t("仅检查已读取的部分；打开时间查看完整范围。")}</p> : null}
        <Link className={styles.more} href="/workspace/meetings">{t("查看时间")}</Link>
      </article>
      <article className={styles.card} aria-labelledby="today-unread-heading">
        <h2 id="today-unread-heading">{t("继续一段对话")}</h2>
        {unread ? <><Link className={styles.title} href={`/workspace/sessions/${encodeURIComponent(unread.id)}`}>{unread.title}</Link><p className={styles.note}>{t("未读 · 对话中的解释仍需核对")}</p></> :
          <p>{today.unread.coverage === "loading" ? t("正在读取未读对话…") : today.unread.coverage === "complete" ? t("当前没有未读对话。") : today.unread.coverage === "partial" ? t("已读取的部分没有未读对话。") : t("未读对话暂时无法读取。")}</p>}
        {today.unread.coverage === "partial" ? <p className={styles.note}>{t("仅显示本次已读取的部分。")}</p> : null}
        <Link className={styles.more} href="/workspace/sessions">{t("查看对话")}</Link>
      </article>
    </div>
    {[today.schedule.coverage, today.unread.coverage].some(coverage => coverage === "unavailable" || coverage === "partial") ? <button className={styles.retry} type="button" onClick={today.retry}>{t("重试读取")}</button> : null}
  </section>;
}
