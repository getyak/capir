"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react";
import type { TimeActivity } from "@talent-signal/contracts";
import { activityHref, dateInZone, formatDay, formatTime, TIME_KINDS, TIME_STATUSES } from "@/lib/time-workspace";
import { useT } from "./locale-provider";
import { TimeActivityIcon } from "./time-workspace-views";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { useRequestSessionSourceFocus } from "./workspace-navigation-continuity";
import styles from "./time-workspace.module.css";

const narrowQuery = "(max-width: 1000px)";
function subscribeViewport(listener: () => void) {
  const query = window.matchMedia?.(narrowQuery);
  query?.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
}
const narrowSnapshot = () => window.matchMedia?.(narrowQuery).matches ?? false;
const serverSnapshot = () => false;

// This shell belongs to the selected URL, not a request generation. A refresh
// replaces its contents with honest loading/error states without reopening it.
// Editable schedules and meeting drafts deliberately keep their own lifecycle.
export function TimeReadOnlyInspector({ binding, activity, loading, error, complete, navigationNotice, zone, onClose, onRetry, onPersonTimeline }: {
  binding: string; activity: TimeActivity | null; loading: boolean; error: string | null; complete: boolean; navigationNotice: string; zone: string; onClose: () => void; onRetry: () => void; onPersonTimeline: (personId: string) => void;
}) {
  const t = useT();
  const requestSourceFocus = useRequestSessionSourceFocus();
  const narrow = useSyncExternalStore(subscribeViewport, narrowSnapshot, serverSnapshot);
  const composing = useRef(false);
  const desktopTitle = useRef<HTMLHeadingElement>(null);
  const previousNarrow = useRef(narrow);
  useLayoutEffect(() => {
    if (previousNarrow.current && !narrow) desktopTitle.current?.focus();
    previousNarrow.current = narrow;
  }, [narrow]);
  const source = activity ? activityHref(activity) : null;
  const details = <section className={styles.detail} aria-busy={loading}>
    {activity ? <>
      <div className={styles.detailIcon}><TimeActivityIcon kind={activity.kind} /></div>
      <h2>{activity.title}</h2><span className={styles.badge}>{t(TIME_STATUSES[activity.status])}</span><p>{activity.summary}</p>
      <dl><div><dt>{t("时间")}</dt><dd>{formatDay(dateInZone(activity.occurred_at, zone))} {activity.all_day ? t("全天") : formatTime(activity.occurred_at, zone)}</dd></div>
        {activity.person_label ? <div><dt>{t("人物")}</dt><dd>{activity.person_label}{activity.context_label ? ` · ${activity.context_label}` : ""}</dd></div> : null}
        <div><dt>{t("来源")}</dt><dd>{t(TIME_KINDS[activity.kind])} · {t(activity.authority === "unconfirmed" ? "尚待核对" : activity.authority === "user_authored" ? "由你记录" : "系统活动记录")}</dd></div></dl>
      {activity.person_id ? <Button variant="outline" onClick={() => onPersonTimeline(activity.person_id!)}>{t("查看这个人的时间线")}</Button> : null}
      {navigationNotice ? <p className={styles.staleNote} role="status">{navigationNotice}</p> : null}
      {source ? <Link className={styles.sourceLink} href={source} onNavigate={() => { if (activity.kind === "session_activity") requestSourceFocus(binding, activity.source_id); }}>{t("打开来源")}<ArrowUpRight size={16} /></Link> : null}
    </> : <><p role={error ? "alert" : "status"}>{loading ? t("正在整理这段时间…") : error || (complete ? t("这份记录已不在当前范围。") : t("当前只显示已读取的记录，不能据此判断其余时段为空。"))}</p>{error ? <Button variant="outline" onClick={onRetry}>{t("重新读取")}</Button> : null}</>}
  </section>;
  if (!narrow) return <section><div className={styles.inspectorHeading}><h2 ref={desktopTitle} tabIndex={-1} className={styles.readOnlyDesktopTitle}>{t("记录详情")}</h2><Button variant="ghost" size="icon" aria-label={t("关闭详情")} onClick={onClose}>×</Button></div>{details}</section>;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className={styles.readOnlyDialog} closeLabel={t("关闭详情")} aria-describedby={undefined}
      onCloseAutoFocus={(event) => { event.preventDefault(); }}
      onCompositionStartCapture={() => { composing.current = true; }}
      onCompositionEndCapture={() => { composing.current = false; }}
      onEscapeKeyDown={(event) => {
        event.stopPropagation();
        if (composing.current || event.isComposing || event.keyCode === 229) event.preventDefault();
      }}>
      <DialogTitle className={styles.readOnlyTitle}>{t("记录详情")}</DialogTitle>
      {details}
    </DialogContent>
  </Dialog>;
}
