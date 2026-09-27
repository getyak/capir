"use client";
import { useLayoutEffect, useRef } from "react";
import type { TimeActivity } from "@talent-signal/contracts";
import { CalendarBlank, ChatCircleDots, UserPlus, Clock, ArrowUpRight } from "@phosphor-icons/react";
import { addDays, dateInZone, formatDay, formatTime, monthDays, scheduleSegments, TIME_KINDS, TIME_STATUSES, weekStart } from "@/lib/time-workspace";
import { calendarUTCFromLocal } from "@/lib/calendar-draft";
import styles from "./time-workspace.module.css";

export function TimeActivityIcon({ kind }: { kind: TimeActivity["kind"] }) {
  const Icon = kind === "session_activity" ? ChatCircleDots : kind === "person_created" ? UserPlus : kind === "meeting_draft" ? CalendarBlank : Clock;
  return <Icon aria-hidden="true" size={18} />;
}
export function TimeActivityRow({ activity, zone, selected, onSelect }: { activity: TimeActivity; zone: string; selected?: boolean; onSelect: (activity: TimeActivity) => void }) {
  return <button type="button" className={styles.activity} aria-pressed={selected} onClick={() => onSelect(activity)}>
    <time className={styles.activityTime} dateTime={activity.occurred_at}>{dateInZone(activity.occurred_at, zone) !== activity.local_day ? <small>{dateInZone(activity.occurred_at, zone).slice(5).replace("-", "/")}<br /></small> : null}{activity.all_day ? "全天" : formatTime(activity.occurred_at, zone)}</time>
    <span className={styles.activityIcon} data-kind={activity.kind}><TimeActivityIcon kind={activity.kind} /></span>
    <span className={styles.activityBody}><strong>{activity.title}</strong><span>{activity.person_label ? `${activity.person_label} · ` : ""}{activity.summary || TIME_KINDS[activity.kind]}</span></span>
    <span className={styles.activityStatus} data-status={activity.status}>{TIME_STATUSES[activity.status]}</span><ArrowUpRight className={styles.rowArrow} aria-hidden="true" size={15} />
  </button>;
}
export function TimeTimeline({ activities, zone, selected, onSelect }: { activities: TimeActivity[]; zone: string; selected: string; onSelect: (activity: TimeActivity) => void }) {
  const groups = new Map<string, TimeActivity[]>();
  for (const activity of activities) { const group = groups.get(activity.local_day) ?? []; group.push(activity); groups.set(activity.local_day, group); }
  return <div className={styles.timeline}>{[...groups].map(([day, records]) => <section key={day} aria-label={formatDay(day)} className={styles.dayGroup}>
    <div className={styles.dayHeading}><h2>{formatDay(day)}</h2><span>{records.length} 条记录</span></div>
    {records.map((activity) => <TimeActivityRow key={activity.id} activity={activity} zone={zone} selected={selected === activity.id} onSelect={onSelect} />)}
  </section>)}</div>;
}
export function TimeMonth({ activities, day, zone, onDay, onSelect }: { activities: TimeActivity[]; day: string; zone: string; onDay: (day: string) => void; onSelect: (activity: TimeActivity) => void }) {
  return <div className={styles.month} aria-label="月历"><div className={styles.weekdays}>{["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((d) => <span key={d}>{d}</span>)}</div><div className={styles.monthGrid}>{monthDays(day).map((d) => {
    const records = activities.filter((a) => a.local_day === d || a.ends_at && dateInZone(a.occurred_at, zone) < d && dateInZone(new Date(Date.parse(a.ends_at) - 1), zone) >= d);
    return <div key={d} className={styles.monthCell} data-outside={!d.startsWith(day.slice(0, 7))} data-selected={d === day}>
      <button className={styles.monthDay} aria-label={`查看 ${formatDay(d)}`} type="button" onClick={() => onDay(d)}>{Number(d.slice(8))}</button>
      {records.length === 0 && d.startsWith(day.slice(0, 7)) ? <p className={styles.monthEmpty}>没有安排</p> : null}
      {records.slice(0, 3).map((a) => <button className={styles.monthEvent} data-kind={a.kind} key={a.id} onClick={() => onSelect(a)} type="button"><span>{a.all_day ? "全天" : dateInZone(a.occurred_at, zone) < d ? "跨日" : formatTime(a.occurred_at, zone)}</span><strong>{a.title}</strong></button>)}
      {records.length > 3 ? <button className={styles.moreInDay} type="button" onClick={() => onDay(d)}>另 {records.length - 3} 条</button> : null}
    </div>;
  })}</div></div>;
}
/** DST transition days use lists, because a fixed-height wall clock would misrepresent durations. */
export function weekHasClockChange(day: string, zone: string) {
  try { const start = weekStart(day); for (let i = 0; i < 7; i++) { const d = addDays(start, i); if (Date.parse(calendarUTCFromLocal(`${addDays(d, 1)}T00:00`, zone)) - Date.parse(calendarUTCFromLocal(`${d}T00:00`, zone)) !== 86400000) return true; } return false; }
  catch { return true; }
}
export function TimeWeek({ activities, day, zone, selected, onSelect, onDay }: { activities: TimeActivity[]; day: string; zone: string; selected: string; onSelect: (a: TimeActivity) => void; onDay: (d: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i));
  const hoursViewport = useRef<HTMLDivElement>(null);
  const segments = days.map((d) => scheduleSegments(activities, d, zone));
  const startHour = Math.min(8, ...segments.flat().map((s) => Math.floor(s.start / 60)));
  useLayoutEffect(() => { if (hoursViewport.current) hoursViewport.current.scrollTop = (8 - startHour) * 56; }, [day, zone, startHour]);
  if (weekHasClockChange(day, zone)) return <><p className={styles.notice}>本周有时钟调整，使用实际时间列表显示，避免重复时段产生歧义。</p><TimeTimeline activities={activities} selected={selected} zone={zone} onSelect={onSelect} /></>;
  const endHour = Math.max(19, ...segments.flat().map((s) => Math.ceil(s.end / 60)));
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => i + startHour);
  const dayRecords = days.map((d) => activities.filter((a) => (!a.ends_at || a.all_day || a.status === "cancelled") && (a.local_day === d || a.all_day && a.ends_at && dateInZone(a.occurred_at, zone) <= d && dateInZone(new Date(Date.parse(a.ends_at) - 1), zone) >= d)));
  return <div className={styles.weekScroller}><div className={styles.week} aria-label="周日程">
    <div className={styles.weekHeader}><span>时间</span>{days.map((d) => <button key={d} type="button" onClick={() => onDay(d)} data-selected={d === day}>{formatDay(d, { weekday: "short" })}<strong>{Number(d.slice(8))}</strong></button>)}</div>
    <div className={styles.weekPoints}><span>记录 / 全天</span>{days.map((d, i) => <div key={d} data-selected={d === day}>{dayRecords[i]!.length === 0 && segments[i]!.length === 0 ? <p className={styles.weekEmpty}>没有安排</p> : dayRecords[i]!.map((a) => <button type="button" key={a.id} onClick={() => onSelect(a)} title={a.title}><TimeActivityIcon kind={a.kind} /><span>{a.title}</span></button>)}</div>)}</div>
    <div ref={hoursViewport} className={styles.weekHoursViewport} role="region" aria-label="时段网格，可滚动查看全天" tabIndex={0}><div className={styles.weekGrid} style={{ height: (endHour - startHour) * 56 }}><div className={styles.hourLabels}>{hours.map((h) => <span key={h} style={{ top: (h - startHour) * 56 }}>{String(h).padStart(2, "0")}:00</span>)}</div>
      {days.map((d, i) => <div className={styles.weekColumn} key={d} data-selected={d === day}>{segments[i]!.map((s) => <button type="button" className={styles.weekEvent} data-kind={s.activity.kind} aria-pressed={selected === s.activity.id} key={s.activity.id} onClick={() => onSelect(s.activity)} style={{ top: (s.start / 60 - startHour) * 56, height: Math.max(22, (s.end - s.start) / 60 * 56), left: `calc(${s.lane / s.lanes * 100}% + 2px)`, width: `calc(${100 / s.lanes}% - 4px)` }} title={`${s.activity.title} · ${formatTime(s.activity.occurred_at, zone)}–${formatTime(s.activity.ends_at!, zone)}`}><span>{formatTime(s.activity.occurred_at, zone)}–{formatTime(s.activity.ends_at!, zone)}</span><strong>{s.activity.title}</strong></button>)}</div>)}
    </div></div>
  </div></div>;
}
