"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { TimeActivityListResponseSchema, type TimeActivity, type TimeActivityListResponse, type TimeScope } from "@talent-signal/contracts";
import { validMeetingDay } from "@/lib/meeting-calendar";
import { addDays, adjacentMonth, dateInZone, formatDay, formatTime, monthDays, parseTimeLocation, timeHref } from "@/lib/time-workspace";
import { timeRequest, TimeRequestError } from "@/lib/time-workspace-client";
import { matchesTypeBox } from "@/lib/typebox-validation";
import { subscribeWorkspaceDirectoryInvalidation } from "@/lib/workspace-directory-cache";
import { coordinatorScopeIsCurrent, requestWorkspaceRefresh, subscribeWorkspaceRefresh, workspaceRefreshGeneration, type RefreshReason } from "@/lib/workspace-refresh";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
import { useRememberWorkspaceNavigationHref } from "./workspace-navigation-continuity";
import { useWorkspaceBrowse } from "./workspace-browse";
import { useLocale, useT } from "./locale-provider";
import styles from "./workspace-sidebar-calendar.module.css";

const subscribeHydration = () => () => {};
const clientHydration = () => true;
const serverHydration = () => false;
// Fixed Monday-first dates supply localized weekday names; the date remains the key.
const weekdays = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-06", "2024-01-07"];
const visibleScheduleLimit = 4;

type Preview = { anchor: string; month: string; focusedDay: string };
type Feed = { key: string; value?: TimeActivityListResponse; failed?: boolean };

function safeDay(day: string, delta: number): string | null {
  try { return validMeetingDay(addDays(day, delta)); } catch { return null; }
}

function safeMonth(day: string, delta: number): string | null {
  try { return validMeetingDay(adjacentMonth(day, delta)); } catch { return null; }
}

function sameScope(actual: TimeScope, expected: TimeScope) {
  return actual.from === expected.from && actual.to === expected.to && actual.time_zone === expected.time_zone &&
    actual.person_id === expected.person_id && actual.kind === expected.kind;
}

/** A read-only projection of the existing calendar URL and authorized schedules. */
export function WorkspaceSidebarCalendar({ binding, browseHref }: { binding: string | null; browseHref?: string }) {
  const t = useT(), locale = useLocale();
  const search = useSearchParams(), queryText = browseHref === undefined ? search.toString() : browseHref.split("?")[1] ?? "";
  const rememberRouteHref = useRememberWorkspaceNavigationHref();
  const browse = useWorkspaceBrowse();
  const rememberNavigationHref = browseHref !== undefined && browse ? browse.remember : rememberRouteHref;
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydration, serverHydration);
  const browserZone = hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : null;
  const query = useMemo(() => new URLSearchParams(queryText), [queryText]);
  const location = useMemo(() => parseTimeLocation(query, browserZone ?? "UTC"), [query, browserZone]);
  const { day, view, range, timeZone, personId } = location;
  const horizon = query.get("upcoming") === "30" ? 30 : 7;
  const [preview, setPreview] = useState<Preview | null>(null);
  const month = preview?.anchor === day ? preview.month : `${day.slice(0, 7)}-01`;
  const focusedDay = preview?.anchor === day ? preview.focusedDay : day;
  const days = monthDays(month), previousMonth = safeMonth(month, -1), nextMonth = safeMonth(month, 1);
  const today = dateInZone(new Date(), timeZone);
  const grid = useRef<HTMLTableElement>(null), pendingFocus = useRef<string | null>(null);
  const keyboardHint = useId(), horizonId = useId();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [expiredBindings, setExpiredBindings] = useState<ReadonlySet<string>>(() => new Set());
  const expired = binding !== null && expiredBindings.has(binding);
  const to = safeDay(day, horizon);
  const scope = useMemo<TimeScope | null>(() => to ? {
    from: day, to, time_zone: timeZone, kind: "schedule", ...(personId ? { person_id: personId } : {}),
  } : null, [day, to, timeZone, personId]);
  const scopeKey = JSON.stringify(scope), feedKey = `${binding}:${scopeKey}`;
  const value = !expired && binding && feed?.key === feedKey ? feed.value : undefined;
  const failed = !expired && binding && feed?.key === feedKey && feed.failed;
  const schedules = value?.activities.filter((activity) => activity.kind === "schedule" && activity.status === "planned" && activity.authority === "user_authored")
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id)) ?? [];
  const incomplete = value && (!value.complete || value.next_cursor !== null);

  useEffect(() => {
    if (!binding || expired) return;
    const activeBinding = binding, activeScope = scope;
    let owned = true, denied = false, inFlight = false, revalidationQueued = false, version = 0;
    let controller: AbortController | null = null;
    const params = activeScope ? new URLSearchParams({ ...activeScope }) : null;
    function loseAuthorization() {
      if (!owned || denied) return;
      // Fence synchronously before React commits: any scoped 401/discard can
      // revoke this reader without dispatching the recognized expiry event.
      denied = true; version++; controller?.abort(); inFlight = false;
      setFeed(null);
      setExpiredBindings((current) => new Set(current).add(activeBinding));
    }
    async function load(reason: RefreshReason, generation: number) {
      // An interval never restarts a slow read. Explicit mutations/foreground
      // reads fence its result and obtain a fresh authoritative snapshot.
      if (!owned || denied || !browserZone || !activeScope || !params || !coordinatorScopeIsCurrent(activeBinding, generation) || inFlight && reason === "interval") return;
      controller?.abort();
      const active = new AbortController(), attempt = ++version;
      controller = active; inFlight = true;
      try {
        const payload = await timeRequest(`/api/time/activities?${params}`, activeBinding, { signal: active.signal });
        if (!matchesTypeBox(TimeActivityListResponseSchema, payload) || !sameScope(payload.scope, activeScope)) {
          throw new Error("Schedule scope could not be verified.");
        }
        if (owned && !denied && attempt === version && !active.signal.aborted && coordinatorScopeIsCurrent(activeBinding, generation)) setFeed({ key: feedKey, value: payload });
      } catch (error: unknown) {
        if (!owned || denied || attempt !== version || active.signal.aborted || !coordinatorScopeIsCurrent(activeBinding, generation)) return;
        if (error instanceof TimeRequestError && (error.status === 401 || error.code === "session_stale")) {
          loseAuthorization();
        } else setFeed({ key: feedKey, failed: true });
      } finally {
        if (attempt === version) inFlight = false;
      }
    }
    const unsubscribe = browserZone && activeScope ? subscribeWorkspaceRefresh(binding, (reason, generation) => {
      void load(reason, generation);
    }) : () => {};
    const unsubscribeInvalidation = subscribeWorkspaceDirectoryInvalidation((keys, mode) => {
      if (!owned || denied || keys !== null && !keys.includes(activeBinding)) return;
      if (mode === "discard") { loseAuthorization(); return; }
      // A burst of successful mutations earns one fresh read, while discard
      // arriving before it runs still prevents any use of the old binding.
      if (revalidationQueued) return;
      revalidationQueued = true;
      queueMicrotask(() => {
        revalidationQueued = false;
        if (owned && !denied) void load("manual", workspaceRefreshGeneration(activeBinding));
      });
    });
    window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, loseAuthorization);
    void load("manual", workspaceRefreshGeneration(binding));
    return () => {
      owned = false; version++; controller?.abort(); unsubscribe(); unsubscribeInvalidation();
      window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, loseAuthorization);
    };
  }, [binding, browserZone, expired, scope, feedKey]);

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    grid.current?.querySelector<HTMLAnchorElement>(`[data-calendar-day="${pendingFocus.current}"]`)?.focus();
    pendingFocus.current = null;
  }, [month, focusedDay]);

  function browseMonth(target: string) {
    setPreview({ anchor: day, month: target, focusedDay: day.startsWith(target.slice(0, 7)) ? day : target });
  }

  function moveFocus(event: KeyboardEvent<HTMLTableElement>) {
    const current = (event.target as HTMLElement).closest<HTMLAnchorElement>("[data-calendar-day]")?.dataset.calendarDay;
    if (!current) return;
    const weekday = (new Date(`${current}T12:00:00Z`).getUTCDay() + 6) % 7;
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday };
    const delta = deltas[event.key];
    let target = delta !== undefined ? safeDay(current, delta) : null;
    if (event.key === "PageUp" || event.key === "PageDown") {
      const targetMonth = safeMonth(current, event.key === "PageUp" ? -1 : 1);
      if (targetMonth) {
        const monthEnd = new Date(`${targetMonth}T12:00:00Z`);
        monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
        const dayNumber = Math.min(Number(current.slice(8)), monthEnd.getUTCDate());
        target = validMeetingDay(`${targetMonth.slice(0, 7)}-${String(dayNumber).padStart(2, "0")}`);
      }
    }
    if (!target) return;
    event.preventDefault();
    pendingFocus.current = target;
    setPreview({ anchor: day, month: `${target.slice(0, 7)}-01`, focusedDay: target });
  }

  function dateHref(target: string) {
    return timeHref(query, {
      day: target, tz: timeZone, view, range: range === "custom" ? (view === "timeline" ? "day" : view) : range,
      from: null, to: null, item: null, draft: null,
    });
  }

  function scheduleHref(activity: TimeActivity) {
    return timeHref(query, {
      day: activity.local_day, tz: timeZone, view, range: view === "timeline" ? "day" : view,
      from: null, to: null, kind: "schedule", item: activity.id, draft: null,
    });
  }

  function changeHorizon(value: string) {
    if (browseHref !== undefined) {
      rememberNavigationHref(timeHref(query, { upcoming: value, day, tz: timeZone }));
      return;
    }
    // Native history is observed by Next.js and merges with rapid calendar actions.
    const current = new URLSearchParams(window.location.search);
    const currentLocation = parseTimeLocation(current, browserZone ?? "UTC");
    window.history.replaceState(null, "", timeHref(current, { upcoming: value, day: currentLocation.day, tz: currentLocation.timeZone }));
  }

  function browseDate(event: MouseEvent<HTMLAnchorElement>, target: string) {
    if (browseHref === undefined || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    rememberNavigationHref(dateHref(target));
  }

  const rangeHref = timeHref(query, {
    day, tz: timeZone, view: "timeline", range: "custom", from: day, to, kind: "schedule", item: null, draft: null,
  });
  return <section className={styles.calendar} aria-label={t("日历导航")}>
    <header className={styles.monthHeader}>
      <h2>{formatDay(month, { year: "numeric", month: "long" }, locale)}</h2>
      <button type="button" aria-label={t("小月历上个月")} disabled={!previousMonth} onClick={() => previousMonth && browseMonth(previousMonth)}><CaretLeft size={14} aria-hidden="true" /></button>
      <button type="button" aria-label={t("小月历下个月")} disabled={!nextMonth} onClick={() => nextMonth && browseMonth(nextMonth)}><CaretRight size={14} aria-hidden="true" /></button>
    </header>
    <p id={keyboardHint} className={styles.srOnly}>{t("方向键移动日期，Home 和 End 移动到周首或周末，Page Up 和 Page Down 切换月份，Enter 打开日期。")}</p>
    <table ref={grid} className={styles.monthGrid} role="grid" aria-label={t("{month}小月历", { month: formatDay(month, { year: "numeric", month: "long" }, locale) })} aria-describedby={keyboardHint} onKeyDown={moveFocus}>
      <thead><tr>{weekdays.map((date) => <th key={date} scope="col" aria-label={formatDay(date, { weekday: "long" }, locale)}>{formatDay(date, { weekday: "narrow" }, locale)}</th>)}</tr></thead>
      <tbody>{Array.from({ length: 6 }, (_, week) => <tr key={week}>{days.slice(week * 7, week * 7 + 7).map((date, index) => {
        const valid = validMeetingDay(date), selected = date === day;
        return <td key={week * 7 + index} role="gridcell" aria-selected={selected}>{valid ? <Link href={dateHref(date)} data-calendar-day={date} prefetch={false} onClick={event => browseDate(event, date)}
          data-selected={selected} data-today={date === today} data-outside={!date.startsWith(month.slice(0, 7))}
          tabIndex={date === focusedDay ? 0 : -1} aria-current={selected ? "date" : undefined}
          aria-label={`${formatDay(date, { year: "numeric", month: "long", day: "numeric", weekday: "long" }, locale)}${selected ? t("，已选中") : ""}${date === today ? t("，今天") : ""}`}>
          {Number(date.slice(8))}
        </Link> : <span aria-hidden="true" />}</td>;
      })}</tr>)}</tbody>
    </table>
    <div className={styles.calendarActions}><Link href={dateHref(today)} prefetch={false} onClick={event => browseDate(event, today)}>{t("今天")}</Link>{!day.startsWith(month.slice(0, 7)) ? <button type="button" onClick={() => browseMonth(`${day.slice(0, 7)}-01`)}>{t("返回选中日期")}</button> : <span>{t("已选 {day}", { day: formatDay(day, { month: "numeric", day: "numeric" }, locale) })}</span>}</div>
    <section className={styles.upcoming} aria-label={t("近期内部安排")}>
      <header className={styles.upcomingHeader}><h2>{t("近期安排")}</h2><label className={styles.srOnly} htmlFor={horizonId}>{t("近期安排范围")}</label><select id={horizonId} value={horizon} onChange={(event) => changeHorizon(event.target.value)}><option value="7">{t("{count} 天", { count: 7 })}</option><option value="30">{t("{count} 天", { count: 30 })}</option></select></header>
      <p className={styles.scope}>{t("{day}起 · 内部安排", { day: formatDay(day, { month: "numeric", day: "numeric" }, locale) })}{personId ? ` · ${t("已按人物筛选")}` : ""}</p>
      {!binding ? <p className={styles.state}>{t("登录后查看安排")}</p> : expired ? <p className={styles.state} role="status">{t("登录已失效，恢复登录后查看安排。")}</p> : !scope ? <p className={styles.state} role="status">{t("此日期超出可读取范围。")}</p> : failed ? <p className={styles.state} role="status">{t("安排暂时无法读取。")}<button type="button" onClick={() => requestWorkspaceRefresh(binding)}>{t("重试")}</button></p> : !value ? <p className={styles.state} role="status">{t("正在读取安排…")}</p> : <>
        {schedules.length ? <ol className={styles.scheduleList}>{schedules.slice(0, visibleScheduleLimit).map((activity) => <li key={activity.id}><Link className={styles.schedule} href={scheduleHref(activity)} prefetch={false} aria-label={t("{title}，{day}，{time}{person}，内部安排", { title: activity.title, day: formatDay(dateInZone(activity.occurred_at, timeZone), { month: "long", day: "numeric" }, locale), time: activity.all_day ? t("全天") : formatTime(activity.occurred_at, timeZone, locale), person: activity.person_label ? ` · ${activity.person_label}` : "" })}>
          <time dateTime={activity.occurred_at}>{formatDay(dateInZone(activity.occurred_at, timeZone), { month: "numeric", day: "numeric" }, locale)} · {activity.all_day ? t("全天") : formatTime(activity.occurred_at, timeZone, locale)}</time>
          <strong>{activity.title}</strong>{activity.person_label ? <span>{activity.person_label}</span> : null}
        </Link></li>)}</ol> : <p className={styles.state}>{incomplete ? t("已读取记录中没有待进行的内部安排。") : t("这段时间没有待进行的内部安排。")}</p>}
        {incomplete ? <p className={styles.coverage}>{t("范围尚未读完，打开日历继续查看。")}</p> : null}
        <Link className={styles.rangeLink} href={rangeHref} prefetch={false}>{schedules.length > visibleScheduleLimit ? t("查看范围内安排（已读取 {count} 条）", { count: schedules.length }) : t("查看这段时间")}</Link>
      </>}
    </section>
  </section>;
}
