"use client";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarBlank, Plus, SlidersHorizontal, Sparkle, ArrowUpRight } from "@phosphor-icons/react";
import { TimeActivityListResponseSchema, TimeReviewResponseSchema, TimeScheduleResponseSchema, type TimeActivity, type TimeActivityListResponse, type TimeReviewResponse, type TimeScheduleRecord } from "@talent-signal/contracts";
import { activityHref, addDays, adjacentMonth, dateInZone, formatDay, formatTime, mergeTimePages, parseTimeLocation, TIME_KINDS, TIME_STATUSES, timeHref, type TimePerson } from "@/lib/time-workspace";
import { clearTimeOperation, pendingTimeOperation, readTimeSchedule, timeRequest, TimeRequestError } from "@/lib/time-workspace-client";
import { readTimeEditorDraft, clearTimeEditorDraft, clearTimeWorkspaceStorage, purgeExpiredTimeWorkspaceStorage } from "@/lib/time-workspace-storage";
import { matchesTypeBox } from "@/lib/typebox-validation";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
import { TimeActivityIcon, TimeMonth, TimeTimeline, TimeWeek } from "./time-workspace-views";
import { TimeScheduleEditor } from "./time-schedule-editor";
import { TimeMeetingInspector } from "./time-meeting-inspector";
import styles from "./time-workspace.module.css";

const subscribeHydration = () => () => {};
const clientHydration = () => true;
const serverHydration = () => false;

// Next.js synchronizes native history with useSearchParams. Read the current URL
// at action time so rapid filters compose before React commits the next render.
function updateTimeLocation(patch: Record<string, string | null>, method: "push" | "replace" = "replace") {
  const href = timeHref(new URLSearchParams(window.location.search), patch);
  if (method === "push") window.history.pushState(null, "", href);
  else window.history.replaceState(null, "", href);
}

type Feed = { key: string; value?: TimeActivityListResponse; error?: string };
export function TimeWorkspace({ people, peopleError, binding, legacyDraft }: { people: TimePerson[]; peopleError: string | null; binding: string; legacyDraft: { id: string; day: string; zone: string; unavailable: boolean; revision: number } | null }) {
  const router = useRouter(), search = useSearchParams(), queryText = search.toString();
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydration, serverHydration);
  const browserZone = hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : null;
  const [refresh, setRefresh] = useState(0), [historyRevision, setHistoryRevision] = useState(0), [selectionRevision, setSelectionRevision] = useState(0);
  const location = useMemo(() => parseTimeLocation(new URLSearchParams(queryText), browserZone ?? "UTC"), [queryText, browserZone]);
  const { day, view, range, timeZone, scope, selected, personId, kind } = location;
  const scopeKey = JSON.stringify(scope), feedKey = `${binding}:${scopeKey}:${refresh}`;
  const [feed, setFeed] = useState<Feed | null>(null), [moreBusy, setMoreBusy] = useState(false), [moreError, setMoreError] = useState("");
  const [authInvalid, setAuthInvalid] = useState(false), [filters, setFilters] = useState(false);
  const [review, setReview] = useState<{ key: string; value: TimeReviewResponse } | null>(null), [reviewBusy, setReviewBusy] = useState(false), [reviewError, setReviewError] = useState("");
  const [objective, setObjective] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [editor, setEditor] = useState<{ key: string; record: TimeScheduleRecord | null } | null>(null), [editorError, setEditorError] = useState("");
  const pending = hydrated ? pendingTimeOperation(binding) : null;
  const savedDraft = hydrated ? readTimeEditorDraft(binding) : null;
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const recoveryLock = useRef(false), recoveryAbort = useRef<AbortController | null>(null);
  const [recovery, setRecovery] = useState("");
  const [customFrom, setCustomFrom] = useState(""), [customTo, setCustomTo] = useState("");
  const reviewAbort = useRef<AbortController | null>(null), selectAbort = useRef<AbortController | null>(null);
  const latestKey = useRef(feedKey);
  useEffect(() => { latestKey.current = feedKey; }, [feedKey]);
  const moreLock = useRef(false), reviewLock = useRef(false);
  const refreshData = useCallback(() => { setReview(null); reviewAbort.current?.abort(); setReviewBusy(false); reviewLock.current = false; setRefresh((v) => v + 1); }, []);
  function canLeaveEditor() {
    if (recoveryLock.current) return false;
    if (editorDirty) {
      if (!window.confirm("离开会放弃未提交输入。尚未核实的提交仍保留操作凭据，可以稍后恢复。")) return false;
      clearTimeEditorDraft(binding); setEditorDirty(false); return true;
    }
    if (savedDraft && !editor && !pending) { setRecovery("请先恢复或放弃上次未保存的编辑。"); return false; }
    return true;
  }
  function navigate(patch: Record<string, string | null>) {
    if (!canLeaveEditor()) return;
    selectAbort.current?.abort(); setEditor(null); setEditorError(""); setReviewError("");
    updateTimeLocation({ ...patch, item: null, draft: null }, "push");
  }
  useEffect(() => {
    if (!legacyDraft || legacyDraft.unavailable || !search.get("draft") || search.get("day")) return;
    updateTimeLocation({ day: legacyDraft.day, tz: legacyDraft.zone, range: "day", view: "timeline", item: `meeting_draft:${legacyDraft.id}` });
  }, [legacyDraft, search, queryText, router]);
  const historyChanged = useEffectEvent(() => {
    selectAbort.current?.abort(); recoveryAbort.current?.abort(); reviewAbort.current?.abort();
    recoveryLock.current = false; reviewLock.current = false; setReviewBusy(false); setReview(null); setRecoveryBusy(false);
    // Keep the live editor when input may exist only in memory (for example a
    // full/disabled sessionStorage). A history change cannot discard that input.
    if (editorDirty) { setRecovery("未保存的编辑仍保留在详情中，请先保存或关闭编辑。"); return; }
    setEditor(null); setEditorError(""); setHistoryRevision((v) => v + 1);
  });
  useEffect(() => {
    const expired = () => { clearTimeWorkspaceStorage(); recoveryAbort.current?.abort(); setAuthInvalid(true); setFeed(null); setReview(null); setEditor(null); reviewAbort.current?.abort(); selectAbort.current?.abort(); };
    const resume = () => { if (document.visibilityState === "visible") { refreshData(); router.refresh(); } else { reviewAbort.current?.abort(); setReview(null); } };
    window.addEventListener("popstate", historyChanged);
    window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expired); document.addEventListener("visibilitychange", resume);
    const timer = setInterval(() => { purgeExpiredTimeWorkspaceStorage(); if (document.visibilityState === "visible" && !reviewLock.current) refreshData(); }, 60000);
    return () => { window.removeEventListener("popstate", historyChanged); window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expired); document.removeEventListener("visibilitychange", resume); clearInterval(timer); recoveryAbort.current?.abort(); reviewAbort.current?.abort(); selectAbort.current?.abort(); };
  }, [refreshData, router, binding]);
  useEffect(() => {
    if (!browserZone || authInvalid) return;
    const controller = new AbortController();
    reviewAbort.current?.abort(); reviewLock.current = false; moreLock.current = false;
    // Loading state belongs to this request generation; obsolete results remain hidden by key.
    queueMicrotask(() => { if (!controller.signal.aborted) { setReview(null); setReviewBusy(false); setMoreError(""); setMoreBusy(false); } });
    const params = new URLSearchParams(JSON.parse(scopeKey));
    timeRequest(`/api/time/activities?${params}`, binding, { signal: controller.signal }).then((value) => {
      if (!matchesTypeBox(TimeActivityListResponseSchema, value)) throw new Error("时间记录格式暂时无法核实。");
      if (!controller.signal.aborted) setFeed({ key: feedKey, value });
    }).catch((error: unknown) => { if (!controller.signal.aborted) { if (error instanceof TimeRequestError && (error.status === 401 || error.code === "session_stale")) setAuthInvalid(true); setFeed({ key: feedKey, error: error instanceof Error ? error.message : "时间记录读取失败。" }); } });
    return () => controller.abort();
  }, [feedKey, binding, browserZone, scopeKey, authInvalid]);
  const value = feed?.key === feedKey ? feed.value : undefined;
  const activities = value?.activities ?? [];
  const selectedActivity = activities.find((a) => a.id === selected || location.draft === a.source_id && a.kind === "meeting_draft") ?? null;
  const selectedScheduleId = selected && /^schedule:[0-9a-f-]{36}$/iu.test(selected) ? selected.slice(9) : null;
  const openSelectedSchedule = useEffectEvent((id: string, controller: AbortController) => {
    if (new URLSearchParams(window.location.search).get("item") !== `schedule:${id}` || recoveryLock.current || editorDirty || editor?.record?.id === id || !editor && readTimeEditorDraft(binding)) return;
    readTimeSchedule(id, binding, controller.signal).then((record) => { if (!controller.signal.aborted && new URLSearchParams(window.location.search).get("item") === `schedule:${id}`) setEditor({ key: record.id, record }); }).catch((error: unknown) => { if (!controller.signal.aborted) setEditorError(error instanceof Error ? error.message : "安排读取失败。"); });
  });
  useEffect(() => {
    if (!selectedScheduleId) return;
    const controller = new AbortController(); selectAbort.current?.abort(); selectAbort.current = controller;
    openSelectedSchedule(selectedScheduleId, controller);
    return () => controller.abort();
  }, [selectedScheduleId, binding, historyRevision, selectionRevision]);
  async function loadMore() {
    if (!value?.next_cursor || moreLock.current) return;
    moreLock.current = true; setMoreBusy(true); setMoreError(""); const key = feedKey;
    try {
      const params = new URLSearchParams({ ...scope, after: value.next_cursor });
      const next = await timeRequest(`/api/time/activities?${params}`, binding);
      if (!matchesTypeBox(TimeActivityListResponseSchema, next)) throw new Error("时间记录格式暂时无法核实。");
      if (latestKey.current === key) setFeed({ key, value: { ...next, activities: mergeTimePages(value.activities, next.activities) } });
    } catch (error) { if (latestKey.current === key) setMoreError(error instanceof Error ? error.message : "更多记录未能读取。"); }
    finally { if (latestKey.current === key) { setMoreBusy(false); moreLock.current = false; } }
  }
  function select(activity: TimeActivity) {
    if (new URLSearchParams(window.location.search).get("item") === activity.id && editor?.record?.id === activity.source_id) return;
    if (!canLeaveEditor()) return;
    selectAbort.current?.abort(); setEditor(null); setEditorError("");
    setSelectionRevision((v) => v + 1);
    updateTimeLocation({ item: activity.id, draft: activity.kind === "meeting_draft" ? activity.source_id : null });
  }
  async function ask() {
    if (!objective.trim() || reviewLock.current || !value) return;
    const controller = new AbortController(); reviewAbort.current?.abort(); reviewAbort.current = controller;
    reviewLock.current = true; setReviewBusy(true); setReviewError(""); setReview(null); const key = feedKey;
    try {
      const result = await timeRequest("/api/time/review", binding, { method: "POST", body: JSON.stringify({ scope, objective: objective.trim() }), signal: controller.signal });
      if (!matchesTypeBox(TimeReviewResponseSchema, result)) throw new Error("回顾结果格式暂时无法核实。");
      if (!controller.signal.aborted && latestKey.current === key) setReview({ key, value: result });
    } catch (error) { if (!controller.signal.aborted && latestKey.current === key) setReviewError(error instanceof Error ? error.message : "范围回顾暂时不可用。"); }
    finally { if (!controller.signal.aborted && latestKey.current === key) { setReviewBusy(false); reviewLock.current = false; } }
  }
  function showRecoveredEditor(record: TimeScheduleRecord | null, key: string) {
    setEditor(record && !record.content_available ? null : { key, record });
    updateTimeLocation({ item: record?.content_available ? `schedule:${record.id}` : null, draft: null });
  }
  function beginRecovery() {
    if (recoveryLock.current || !canLeaveEditor()) return null;
    const controller = new AbortController(); recoveryAbort.current?.abort(); selectAbort.current?.abort(); recoveryAbort.current = controller;
    recoveryLock.current = true; setRecoveryBusy(true); setEditor(null); return controller;
  }
  function finishRecovery(controller: AbortController) {
    if (!controller.signal.aborted) { recoveryLock.current = false; setRecoveryBusy(false); }
  }
  async function recover() {
    if (!pending) return; const controller = beginRecovery(); if (!controller) return; setRecovery("正在核实…");
    try {
      const current = await readTimeSchedule(pending.id, binding, controller.signal);
      if (controller.signal.aborted) return;
      if (current.last_operation_id === pending.key) {
        setRecovery(current.status === "deleted" ? "已核实：内容已删除。" : "已核实：上次操作已经保存。");
        clearTimeOperation(binding, { id: pending.id, key: pending.key }); clearTimeEditorDraft(binding, pending.id);
        showRecoveredEditor(current, current.id); refreshData();
      } else if (current.revision === pending.expectedRevision) setRecovery("上次修改尚未体现在当前版本中，原输入和操作 ID 已保留。请点击重试原操作。");
      else { setRecovery("服务器已有其他版本，原输入仍保留在恢复凭据中。请核对当前内容后决定是否放弃原操作。"); showRecoveredEditor(current, current.id); }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof TimeRequestError && error.status === 404) setRecovery("此记录暂未找到。可以用保存的原操作重试；操作 ID 不变，不会重复创建。");
      else setRecovery("暂时无法核实，请稍后重试。");
    } finally { finishRecovery(controller); }
  }
  async function retryPending() {
    if (!pending) return; const controller = beginRecovery(); if (!controller) return; setRecovery("正在重试原操作…");
    try {
      const result = await timeRequest(`/api/time/schedules/${pending.id}`, binding, { method: pending.method, body: JSON.stringify(pending.body), signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!matchesTypeBox(TimeScheduleResponseSchema, result)) throw new Error("结果暂时无法核实。");
      if (result.schedule.last_operation_id === pending.key) {
        clearTimeOperation(binding, { id: pending.id, key: pending.key }); clearTimeEditorDraft(binding, pending.id);
        setRecovery(result.schedule.status === "deleted" ? "已核实：内容已删除。" : "已核实：原操作已经保存。");
        showRecoveredEditor(result.schedule, result.schedule.id); refreshData();
      } else setRecovery("记录已有其他版本，请先核实当前状态。");
    } catch (error) { if (!controller.signal.aborted) setRecovery(error instanceof Error ? error.message : "重试结果仍无法核实。"); }
    finally { finishRecovery(controller); }
  }
  async function restoreEditorDraft() {
    if (!savedDraft || recoveryLock.current) return;
    const controller = new AbortController(); recoveryAbort.current?.abort(); selectAbort.current?.abort(); recoveryAbort.current = controller; recoveryLock.current = true; setRecoveryBusy(true);
    try {
      const record = savedDraft.existing ? await readTimeSchedule(savedDraft.id, binding, controller.signal) : null;
      if (controller.signal.aborted) return;
      if (record && !record.content_available) { clearTimeEditorDraft(binding, savedDraft.id); setRecovery("记录已删除，上次编辑内容已清除。"); return; }
      showRecoveredEditor(record, savedDraft.id); setRecovery("");
    } catch { if (!controller.signal.aborted) setRecovery("无法读取原安排，编辑内容仍保留。请重试或明确放弃。"); }
    finally { finishRecovery(controller); }
  }
  function shift(delta: number) { const { day, view, range, scope } = parseTimeLocation(new URLSearchParams(window.location.search), browserZone ?? "UTC"); if (range === "custom") { const size = (Date.parse(scope.to) - Date.parse(scope.from)) / 86400000; navigate({ day: addDays(scope.from, size * delta), from: addDays(scope.from, size * delta), to: addDays(scope.to, size * delta) }); return; } navigate({ day: view === "month" || range === "month" ? adjacentMonth(day, delta) : addDays(day, (view === "week" || range === "week" ? 7 : range === "past7" ? 7 : range === "next30" ? 30 : 1) * delta) }); }
  const activeReview = review?.key === feedKey ? review.value : null;
  const showDay = (d: string) => navigate({ day: d, view: "timeline", range: "day" });
  const selectedPerson = people.find((p) => p.id === personId);
  if (authInvalid) return <main className={styles.page} id="main-content"><h1>请重新登录</h1><p>登录已改变，时间记录已清空。</p><Link href="/login?callbackUrl=%2Fworkspace%2Fmeetings">重新登录</Link></main>;
  return <main className={styles.page} id="main-content" tabIndex={-1}>
    <header className={styles.header}><div><h1>时间</h1><p>把确定的安排放进日历，把待确认的事留在判断中。</p></div></header>
    {pending ? <div className={styles.notice} role="status">有一次{pending.method === "DELETE" ? "删除" : "保存"}尚未核实。{"title" in pending.body ? ` ${pending.body.title}` : ""}<button type="button" disabled={recoveryBusy} onClick={() => void recover()}>核实上次操作</button><button type="button" disabled={recoveryBusy} onClick={() => void retryPending()}>重试原操作</button><button type="button" disabled={recoveryBusy} onClick={() => { if (window.confirm("放弃此恢复凭据只会清除本标签页的原输入，不能撤销可能已保存的安排。确认后请检查时间记录。")) { clearTimeOperation(binding, { id: pending.id, key: pending.key }); clearTimeEditorDraft(binding, pending.id); setRecovery("已按你的选择清除恢复凭据。请核对当前时间记录。"); refreshData(); } }}>放弃恢复凭据</button><small>恢复内容仅保留在此浏览器标签页，最长一天；确认成功后即清除。</small></div> : null}{recovery ? <p className={styles.muted} role="status">{recovery}</p> : null}
    {savedDraft && !editor && !pending ? <div className={styles.notice}>有一份尚未保存的编辑：{savedDraft.fields.title || "未命名安排"}<button type="button" disabled={recoveryBusy} onClick={() => void restoreEditorDraft()}>恢复未保存编辑</button><button type="button" disabled={recoveryBusy} onClick={() => { if (window.confirm("确认丢弃这份尚未保存的编辑？")) { clearTimeEditorDraft(binding, savedDraft.id); setRecovery("已丢弃未保存编辑。"); refreshData(); } }}>丢弃未保存编辑</button></div> : null}
    {legacyDraft?.unavailable && location.draft ? <p className={styles.notice} role="status">这份会议草稿已处理或来源不可用。</p> : null}
    <div className={styles.toolbar}>
      <div className={styles.dateNavigation}>
        <button aria-label="上一段时间" onClick={() => shift(-1)} type="button"><ArrowLeft size={17} /></button>
        <div className={styles.dateTitle}>
          <strong>{formatDay(day, { year: "numeric", month: "long", day: "numeric" })}</strong>
          <span>{timeZone}{range === "day" ? "" : ` · ${scope.from.slice(5).replace("-", "/")} — ${addDays(scope.to, -1).slice(5).replace("-", "/")}`}</span>
        </div>
        <button aria-label="下一段时间" onClick={() => shift(1)} type="button"><ArrowRight size={17} /></button>
      </div>
      <div className={styles.toolbarActions}>
        <button type="button" onClick={() => navigate({ day: dateInZone(new Date(), parseTimeLocation(new URLSearchParams(window.location.search), browserZone ?? "UTC").timeZone) })}>今天</button>
        <div className={styles.segmented} aria-label="时间视图">{[["timeline", "时间线"], ["week", "周"], ["month", "月"]].map(([v, label]) => <button type="button" aria-pressed={view === v} key={v} onClick={() => navigate({ view: v!, range: v === "timeline" ? "day" : v! })}>{label}</button>)}</div>
        <button type="button" className={styles.filterToggle} aria-expanded={filters} onClick={() => setFilters(!filters)}><SlidersHorizontal size={16} />筛选{personId || kind ? " · 已启用" : ""}</button>
        <button type="button" className={styles.primary} disabled={Boolean(pending) || recoveryBusy || Boolean(savedDraft && !editor)} onClick={() => { if (!canLeaveEditor()) return; selectAbort.current?.abort(); setEditor({ key: crypto.randomUUID(), record: null }); setEditorError(""); updateTimeLocation({ item: null, draft: null }); }}><Plus size={16} aria-hidden="true" />添加日程</button>
      </div>
    </div>
    <div className={styles.scopeBar}><div className={styles.quickRanges}>{[["day", "当天"], ["past7", "过去 7 天"], ["next30", "未来 30 天"]].map(([r, label]) => <button key={r} type="button" aria-pressed={range === r && view === "timeline"} onClick={() => navigate({ view: "timeline", range: r! })}>{label}</button>)}<span>{selectedPerson ? `人物：${selectedPerson.label}` : personId ? "已筛选人物" : "全部人物"}{kind ? ` · ${TIME_KINDS[kind]}` : ""}</span>{personId || kind ? <button type="button" onClick={() => navigate({ person: null, kind: null })}>清除筛选</button> : null}</div><span>{value ? `${activities.length} 条${value.complete ? "" : " · 尚有更多"}` : "正在读取"}</span></div>
    {filters ? <section className={styles.filters} aria-label="时间筛选"><label>人物<select value={personId} onChange={(e) => navigate({ person: e.target.value })}><option value="">全部人物</option>{people.map((p) => <option value={p.id} key={p.id}>{p.label} · {p.context || p.id.slice(0, 6)}</option>)}</select></label><label>记录类型<select value={kind} onChange={(e) => navigate({ kind: e.target.value })}><option value="">全部记录</option>{Object.entries(TIME_KINDS).map(([k, label]) => <option value={k} key={k}>{label}</option>)}</select></label><label>显示时区<input defaultValue={timeZone} key={timeZone} list="time-zones" maxLength={100} onBlur={(e) => { if (e.target.value.trim()) navigate({ tz: e.target.value.trim() }); }} /></label><form className={styles.customRange} onSubmit={(e) => { e.preventDefault(); const to = addDays(customTo, 1); if (customFrom <= customTo && Date.parse(to) - Date.parse(customFrom) <= 93 * 86400000) navigate({ view: "timeline", range: "custom", from: customFrom, to, day: customFrom }); else setMoreError("请选择连续的 1–93 天。"); }}><label>从<input required type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label><label>到（含当天）<input required type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label><button type="submit">查看范围</button></form>{peopleError ? <p role="status">{peopleError}</p> : null}</section> : null}
    <datalist id="time-zones">{["Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "UTC"].map((tz) => <option key={tz} value={tz} />)}</datalist>
    <div className={styles.workspace}><section className={styles.canvas} aria-label="时间记录" aria-busy={!value && !feed?.error}>
      {feed?.key === feedKey && feed.error ? <div className={styles.empty} role="alert"><CalendarBlank size={28} /><h2>时间记录暂时无法读取</h2><p>{feed.error}</p><button type="button" onClick={refreshData}>重新读取</button></div> : !value ? <div className={styles.empty} role="status"><span className={styles.loadingDot} /><p>正在整理这段时间…</p></div> : <>
        {activities.length === 0 ? <div className={styles.empty} role="status"><CalendarBlank size={30} weight="light" /><h2>这段时间还没有记录</h2><p>{personId || kind ? "可以调整筛选，或为下一次沟通新建安排。" : "联系人创建、对话活动和安排会出现在这里。"}</p></div> : view === "month" ? <TimeMonth activities={activities} day={day} zone={timeZone} onDay={showDay} onSelect={select} /> : view === "week" ? <TimeWeek activities={activities} day={day} zone={timeZone} selected={selected} onDay={showDay} onSelect={select} /> : <TimeTimeline activities={activities} zone={timeZone} selected={selected} onSelect={select} />}
        {!value.complete ? <div className={styles.more}><p>当前只显示已读取的记录，不能据此判断其余时段为空。</p><button disabled={moreBusy} type="button" onClick={() => void loadMore()}>{moreBusy ? "读取中…" : "读取更多记录"}</button></div> : null}
        <p className={styles.coverage}>{value.coverage_note}</p>
      </>}{moreError ? <div role="alert" className={styles.notice}>{moreError}<button type="button" onClick={refreshData}>重新读取范围</button></div> : null}
    </section><aside className={styles.inspector} aria-label="时间详情">
      {editor ? <TimeScheduleEditor key={`${binding}:${editor.key}`} record={editor.record} draftId={editor.key} day={day} zone={timeZone} personId={personId} people={people} binding={binding} refreshKey={refresh} mutationBlocked={recoveryBusy || Boolean(pending && pending.id !== (editor.record?.id ?? editor.key))} onDirtyChange={setEditorDirty} onSaved={() => refreshData()} onClose={() => { if (recoveryLock.current) return; clearTimeEditorDraft(binding); setEditor(null);  updateTimeLocation({ item: null, draft: null }); }} /> : selectedActivity ? <section className={styles.detail}><div className={styles.inspectorHeading}><span className={styles.eyebrow}>记录详情</span><button type="button" aria-label="关闭详情" onClick={() => navigate({})}>×</button></div><div className={styles.detailIcon}><TimeActivityIcon kind={selectedActivity.kind} /></div><h2>{selectedActivity.title}</h2><span className={styles.badge}>{TIME_STATUSES[selectedActivity.status]}</span><p>{selectedActivity.summary}</p><dl><div><dt>时间</dt><dd>{formatDay(dateInZone(selectedActivity.occurred_at, timeZone))} {selectedActivity.all_day ? "全天" : formatTime(selectedActivity.occurred_at, timeZone)}</dd></div>{selectedActivity.person_label ? <div><dt>人物</dt><dd>{selectedActivity.person_label}{selectedActivity.context_label ? ` · ${selectedActivity.context_label}` : ""}</dd></div> : null}<div><dt>来源</dt><dd>{TIME_KINDS[selectedActivity.kind]} · {selectedActivity.authority === "unconfirmed" ? "尚待核对" : selectedActivity.authority === "user_authored" ? "由你记录" : "系统活动记录"}</dd></div></dl>
        {selectedActivity.kind === "meeting_draft" ? <TimeMeetingInspector id={selectedActivity.source_id} revision={selectedActivity.source_revision} binding={binding} refreshKey={refresh} returnHref={timeHref(new URLSearchParams(queryText), { item: null, draft: null })} /> : selectedActivity.kind === "schedule" ? <p role="status">{editorError || "正在读取安排…"}</p> : activityHref(selectedActivity) ? <Link className={styles.sourceLink} href={activityHref(selectedActivity)!}>打开来源<ArrowUpRight size={16} /></Link> : null}
        {selectedActivity.person_id ? <button type="button" onClick={() => navigate({ person: selectedActivity.person_id, view: "timeline", range: "past7" })}>查看这个人的时间线</button> : null}
      </section> : <section className={styles.contextIntro}><span className={styles.eyebrow}>此刻的上下文</span><h2>把时间串起来</h2><p>选择一条记录，回到原来的对话，或核对下一次安排。</p><div className={styles.contextRule} /><span>{formatDay(scope.from, { month: "short", day: "numeric" })} — {formatDay(addDays(scope.to, -1), { month: "short", day: "numeric" })}</span><p>{selectedPerson ? `${selectedPerson.label}的相关记录` : "所选时间内的活动记录"}</p></section>}
      <section className={styles.review} aria-label="范围回顾"><div className={styles.reviewTitle}><Sparkle aria-hidden="true" size={19} /><h2>一起回顾这段时间</h2></div><p>基于当前范围的记录摘要整理。结果待你判断。</p><form onSubmit={(e) => { e.preventDefault(); void ask(); }}><textarea aria-label="向 Agent 提问" rows={3} maxLength={1000} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="过去一周有哪些联系，需要我继续跟进？" /><button type="submit" disabled={reviewBusy || !value || !objective.trim()}>{reviewBusy ? "正在回顾…" : "回顾当前范围"}</button></form>{reviewError ? <p className={styles.error} role="alert">{reviewError}</p> : null}{activeReview ? <article className={styles.reviewResult}><span className={styles.badge}>待核对的整理</span><h3>{activeReview.title}</h3><p className={styles.reviewBody}>{activeReview.body}</p><details><summary>查看依据 · {activeReview.sources.length} 条{activeReview.complete ? "" : "，范围不完整"}</summary><ol>{activeReview.sources.map((a) => <li key={a.id}><button type="button" onClick={() => { if (activities.some((v) => v.id === a.id)) select(a); else navigate({ day: a.local_day, range: "day", view: "timeline" }); }}>{a.title} · {a.local_day}</button></li>)}</ol></details><small>{activeReview.coverage_note}</small></article> : null}</section>
    </aside></div>
  </main>;
}
