"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { TimeScheduleResponseSchema, type TimeScheduleRecord, type TimeScheduleMutationRequest } from "@talent-signal/contracts";
import { calendarLocalTime, calendarUTCFromLocal } from "@/lib/calendar-draft";
import { addDays, type TimePerson } from "@/lib/time-workspace";
import { readTimeEditorDraft, rememberTimeEditorDraft, clearTimeEditorDraft, type TimeEditorFields } from "@/lib/time-workspace-storage";
import { matchesTypeBox } from "@/lib/typebox-validation";
import { clearTimeOperation, readTimeSchedule, rememberTimeOperation, timeRequest, TimeRequestError } from "@/lib/time-workspace-client";
import { workspaceSessionFetch } from "./workspace-session-request";
import styles from "./time-workspace.module.css";

type Fields = TimeEditorFields;
function fields(record: TimeScheduleRecord | null, day: string, zone: string, person: string): Fields {
  return record?.content_available ? { title: record.title!, note: record.note ?? "", person: record.person_id ?? "", start: calendarLocalTime(record.starts_at!, record.time_zone!).slice(0, 16), end: calendarLocalTime(record.ends_at!, record.time_zone!).slice(0, 16), zone: record.time_zone!, allDay: record.all_day, kind: record.kind!, reminder: record.reminder_minutes === null ? "none" : String(record.reminder_minutes), status: record.status === "deleted" ? "planned" : record.status }
    : { title: "", note: "", person, start: `${day}T09:00`, end: `${day}T09:30`, zone, allDay: false, kind: "meeting", reminder: "none", status: "planned" };
}
export function TimeScheduleEditor({ record: initial, draftId, day, zone, personId, people, binding, onSaved, onClose, onDirtyChange, refreshKey = 0, mutationBlocked = false }: {
  record: TimeScheduleRecord | null; day: string; zone: string; personId: string; people: TimePerson[]; binding: string;
  onSaved: (record: TimeScheduleRecord) => void; onClose: () => void; onDirtyChange: (dirty: boolean) => void; refreshKey?: number; mutationBlocked?: boolean; draftId?: string;
}) {
  const [restored] = useState(() => {
    const saved = readTimeEditorDraft(binding);
    return saved && (initial ? saved.id === initial.id : !saved.existing) ? saved : null;
  });
  const [record, setRecord] = useState(initial);
  const [value, setValue] = useState(() => restored?.fields ?? fields(initial, day, zone, personId));
  const latestFields = useRef(value);
  function replaceFields(next: Fields) { latestFields.current = next; setValue(next); }
  const [dirty, setDirty] = useState(Boolean(restored)), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [conflict, setConflict] = useState<TimeScheduleRecord | null>(restored && initial && restored.base_revision !== initial.revision ? initial : null);
  const [unknown, setUnknown] = useState(false), [notice, setNotice] = useState(restored ? "已恢复上次未保存的输入，请核对后保存。" : "");
  // A deleted or inaccessible arrangement is terminal: one compact view with
  // heading, explanation and Close replaces the whole form, so a deep link can
  // never render a blank disabled editor with the notice offscreen.
  const [terminal, setTerminal] = useState<{ kind: "deleted" | "unavailable"; message: string } | null>(null), [readbackError, setReadbackError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [readbackRetry, setReadbackRetry] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const id = useRef(initial?.id ?? restored?.id ?? draftId ?? ""), locked = useRef(false);
  const attempt = useRef<{ method: "PUT" | "DELETE"; body: TimeScheduleMutationRequest | { expected_revision: number; idempotency_key: string } } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirtyChange(dirty || unknown); return () => onDirtyChange(false); }, [dirty, unknown, onDirtyChange]);
  useEffect(() => {
    if (!dirty && !unknown) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const linkGuard = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const saved = readTimeEditorDraft(binding)?.id === id.current || Boolean(attempt.current);
      if (!window.confirm(saved ? "当前编辑已保留在本标签页，可以返回时间工作台恢复。现在离开？" : "当前输入未能保存，离开后可能丢失。现在离开？")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", guard); document.addEventListener("click", linkGuard, true);
    return () => { window.removeEventListener("beforeunload", guard); document.removeEventListener("click", linkGuard, true); };
  }, [dirty, unknown, binding]);
  const acceptReadback = useEffectEvent((current: TimeScheduleRecord) => {
    setReadbackError("");
    if (!current.content_available || current.status === "deleted") {
      replaceFields(fields(null, day, zone, "")); setRecord(current); setDirty(false); setUnknown(false); setConflict(null);
      clearTimeOperation(binding, { id: id.current }); clearTimeEditorDraft(binding, id.current); attempt.current = null;
      setTerminal({ kind: "deleted", message: "这条安排已删除，旧内容已清除。已导出的日历文件不会自动撤回。" });
    } else if (record && current.revision < record.revision) {
      setReadbackError("读取结果早于刚刚保存的版本，请重新核实后继续。");
    } else if (current.revision !== record?.revision) {
      if (dirty || unknown || attempt.current) { setConflict(current); setUnknown(false); setError("安排已在别处修改，请核对版本差异。"); }
      else { setRecord(current); replaceFields(fields(current, day, zone, personId)); }
    }
  });
  const rejectReadback = useEffectEvent((caught: unknown) => {
    if (caught instanceof TimeRequestError && ([401, 403, 404, 410].includes(caught.status) || caught.code === "session_stale")) {
      replaceFields(fields(null, day, zone, "")); setDirty(false); setUnknown(false); setConflict(null); clearTimeOperation(binding, { id: id.current }); clearTimeEditorDraft(binding, id.current); attempt.current = null;
      setTerminal({ kind: "unavailable", message: "这条安排已不可访问，旧内容已清除。" });
    } else setReadbackError("当前安排暂时无法重新核实。你的输入仍保留，请重新读取后继续。");
  });
  useEffect(() => {
    if (!record?.id) return;
    const controller = new AbortController();
    readTimeSchedule(record.id, binding, controller.signal).then((current) => {
      if (!controller.signal.aborted) acceptReadback(current);
    }).catch((caught: unknown) => { if (!controller.signal.aborted) rejectReadback(caught); });
    return () => controller.abort();
  }, [binding, record?.id, record?.revision, refreshKey, readbackRetry]);
  function change<K extends keyof Fields>(key: K, next: Fields[K]) {
    const changed = { ...latestFields.current, [key]: next };
    replaceFields(changed); setDirty(true);
    if (!id.current) id.current = crypto.randomUUID();
    persistDraft(changed); setNotice(""); setError(""); attempt.current = null;
  }
  function persistDraft(input = latestFields.current) {
    const saved = rememberTimeEditorDraft(binding, { id: id.current, existing: Boolean(record), base_revision: record?.revision ?? 0, fields: input, expires: Date.now() + 86400000 });
    setStorageError(saved ? "" : "未能在此标签页保留输入。请保持页面打开，恢复会话存储后重试。");
  }
  function applied(next: TimeScheduleRecord) {
    if (!mounted.current) return;
    clearTimeOperation(binding, { id: id.current, ...(attempt.current ? { key: attempt.current.body.idempotency_key } : {}) }); clearTimeEditorDraft(binding, id.current); attempt.current = null; setUnknown(false); setDirty(false); setConflict(null); setError(""); setRecord(next);
    replaceFields(fields(next.content_available ? next : null, day, zone, next.content_available ? personId : ""));
    setTerminal(next.content_available ? null : { kind: next.status === "deleted" ? "deleted" : "unavailable", message: next.status === "deleted" ? "内容已删除，旧内容已清除。已导出的日历事件需在日历应用中处理。" : "这条安排已不可访问，旧内容已清除。" });
    setNotice(next.content_available ? "已保存到时间工作台。" : ""); onSaved(next);
  }
  async function reconcile() {
    if (!attempt.current) return;
    setBusy(true); setError("");
    try {
      const current = await readTimeSchedule(id.current, binding);
      if (!mounted.current) return;
      if (current.last_operation_id === attempt.current.body.idempotency_key) applied(current);
      else if (current.revision === attempt.current.body.expected_revision) { setUnknown(false); setError("当前版本尚未包含这次修改，可以用同一个操作 ID 重试保存。"); }
      else { setConflict(current); setUnknown(false); setError("服务器保留了另一个版本。请先选择如何处理。"); }
    } catch (caught) {
      if (caught instanceof TimeRequestError && caught.status === 404 && attempt.current.body.expected_revision === 0) { setUnknown(false); setError("暂未找到这条安排。可以使用同一个操作 ID 重试保存。"); }
      else setError("操作结果仍无法核实，请稍后重新核实。");
    } finally { setBusy(false); }
  }
  async function mutate(method: "PUT" | "DELETE") {
    if (locked.current || conflict || terminal || readbackError || mutationBlocked) return;
    setError(""); setNotice("");
    try {
      if (!id.current) id.current = crypto.randomUUID();
      if (!attempt.current || attempt.current.method !== method) {
        const common = { expected_revision: record?.revision ?? 0, idempotency_key: crypto.randomUUID() };
        if (method === "DELETE") attempt.current = { method, body: common };
        else {
          const start = value.allDay ? `${value.start.slice(0, 10)}T00:00` : value.start;
          const end = value.allDay ? `${value.end.slice(0, 10)}T00:00` : value.end;
          const starts_at = calendarUTCFromLocal(start, value.zone), ends_at = calendarUTCFromLocal(end, value.zone);
          if (!value.title.trim() || Date.parse(ends_at) <= Date.parse(starts_at) || Date.parse(ends_at) - Date.parse(starts_at) > 7 * 86400000) throw new Error("请填写标题，结束时间须晚于开始时间，跨度不能超过 7 天。");
          if (value.status === "completed" && Date.parse(ends_at) > Date.now()) throw new Error("尚未结束的安排不能标记为已完成。");
          attempt.current = { method, body: { ...common, title: value.title.trim(), note: value.note.trim(), person_id: value.person || null, starts_at, ends_at, time_zone: value.zone, kind: value.kind, all_day: value.allDay, status: value.status, reminder_minutes: value.reminder === "none" ? null : Number(value.reminder) as 0 | 5 | 15 | 30 | 60 } };
        }
      }
      if (!rememberTimeOperation(binding, { id: id.current, key: attempt.current.body.idempotency_key, expectedRevision: attempt.current.body.expected_revision, method, expires: Date.now() + 86400000, body: attempt.current.body })) throw new Error("另一次操作尚未核实，或此页面的会话存储不可用。请先处理恢复凭据后再保存。");
      locked.current = true; setBusy(true);
      const result = await timeRequest(`/api/time/schedules/${id.current}`, binding, { method, body: JSON.stringify(attempt.current.body) });
      if (!mounted.current) return;
      if (!matchesTypeBox(TimeScheduleResponseSchema, result)) throw new Error("结果格式无法核实。");
      if (result.schedule.last_operation_id !== attempt.current.body.idempotency_key) { setConflict(result.schedule); setError("记录已在别处更新，请先处理版本差异。"); }
      else applied(result.schedule);
    } catch (caught) {
      if (!mounted.current) return;
      if (!locked.current) setError(caught instanceof Error && !caught.message.startsWith("CALENDAR_") ? caught.message : "此时区的时间不存在或重复，请选择明确的时间。");
      else if (caught instanceof TimeRequestError && [400, 401, 403, 404, 409, 410, 415, 422, 429].includes(caught.status)) {
        setError(caught.message);
        if ([400, 403, 404, 410, 415, 422].includes(caught.status)) clearTimeOperation(binding, { id: id.current });
        if (caught.status === 409 && caught.code !== "session_stale") {
          try { setConflict(await readTimeSchedule(id.current, binding)); } catch { setUnknown(true); }
        } else if (caught.status === 401 || caught.code === "session_stale") { replaceFields(fields(null, day, zone, "")); setRecord(null); clearTimeOperation(binding, { id: id.current }); clearTimeEditorDraft(binding, id.current); }
      } else { setUnknown(true); setError("连接中断，操作可能已完成。请核实结果后再修改。"); }
    } finally { locked.current = false; setBusy(false); }
  }
  async function exportFile() {
    if (!record || dirty) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await workspaceSessionFetch(`/api/time/schedules/${record.id}/export`, { method: "POST", headers: { "content-type": "application/json", "x-workspace-session": binding }, body: JSON.stringify({ expected_revision: record.revision }) });
      if (!mounted.current) return;
      if (!response.ok) { const body = await response.json(); throw new Error(body.message || "导出前无法核实安排。"); }
      const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `talent-signal-${record.id}.ics`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice("已生成日历文件，请在日历应用中核对并确认导入。修改内部安排不会同步已导出的事件。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "日历文件生成失败。"); }
    finally { setBusy(false); }
  }
  const disabled = busy || unknown || Boolean(conflict) || Boolean(terminal) || Boolean(readbackError) || mutationBlocked || record?.status === "deleted";
  if (terminal) return <section className={styles.editor} aria-label={terminal.kind === "deleted" ? "已删除的安排" : "不可访问的安排"}>
    <div className={styles.inspectorHeading}><div><span className={styles.eyebrow}>你的安排</span><h2>{terminal.kind === "deleted" ? "这条安排已删除" : "这条安排已不可访问"}</h2></div></div>
    <p className={styles.muted} role="status">{terminal.message}</p>
    <button className={styles.primary} type="button" onClick={onClose}>关闭</button>
  </section>;
  return <section className={styles.editor} aria-label={record ? "编辑安排" : "添加日程"}>
    <div className={styles.inspectorHeading}><div><span className={styles.eyebrow}>{record ? "你的安排" : "留一个时间"}</span><h2>{record ? "编辑安排" : "添加日程"}</h2></div><button type="button" aria-label="关闭编辑" onClick={() => { if ((!dirty && !unknown) || window.confirm(unknown ? "操作结果尚未核实，关闭后可继续核实。" : "离开会放弃尚未保存的修改。")) onClose(); }}>×</button></div>
    <p className={styles.muted}>保存在工作台。系统日历提醒需下载文件并确认导入。</p>
    <form onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} onSubmit={(event) => { event.preventDefault(); if (!busy) void mutate("PUT"); }}>
      <fieldset disabled={disabled} className={styles.formFields}>
        <label>标题<input autoFocus maxLength={200} required value={value.title} onChange={(e) => change("title", e.target.value)} placeholder="例如：与陈曦确认下一次沟通" /></label>
        <div className={styles.fieldPair}><label>类型<select value={value.kind} onChange={(e) => change("kind", e.target.value as Fields["kind"])}><option value="meeting">会面</option><option value="reminder">个人提醒</option></select></label><label>关联人物<select value={value.person} onChange={(e) => change("person", e.target.value)}><option value="">不关联人物</option>{people.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.context || p.id.slice(0, 6)}</option>)}</select></label></div>
        <label className={styles.checkLabel}><input type="checkbox" checked={value.allDay} onChange={(e) => { change("allDay", e.target.checked); if (e.target.checked && value.end.slice(0, 10) <= value.start.slice(0, 10)) change("end", `${addDays(value.start.slice(0, 10), 1)}T00:00`); }} />全天</label>
        <label>开始<input required type={value.allDay ? "date" : "datetime-local"} value={value.allDay ? value.start.slice(0, 10) : value.start} onChange={(e) => change("start", value.allDay ? `${e.target.value}T00:00` : e.target.value)} /></label>
        <label>{value.allDay ? "结束日期（不包含此日）" : "结束"}<input required type={value.allDay ? "date" : "datetime-local"} value={value.allDay ? value.end.slice(0, 10) : value.end} onChange={(e) => change("end", value.allDay ? `${e.target.value}T00:00` : e.target.value)} /></label>
        <label>时区<input required value={value.zone} maxLength={100} onChange={(e) => change("zone", e.target.value)} list="time-zones" /></label>
        <label>日历文件中的提醒<select value={value.reminder} onChange={(e) => change("reminder", e.target.value)}><option value="none">不添加提醒</option>{[0, 5, 15, 30, 60].map((m) => <option key={m} value={m}>{m === 0 ? "开始时" : `提前 ${m} 分钟`}</option>)}</select></label>
        <label>状态<select value={value.status} onChange={(e) => change("status", e.target.value as Fields["status"])}><option value="planned">内部安排</option><option value="completed">我已完成</option>{record ? <option value="cancelled">已取消</option> : null}</select></label>
        <label>私密备注<textarea maxLength={2000} rows={3} value={value.note} onChange={(e) => change("note", e.target.value)} placeholder="仅保留在工作台，不加入日历文件" /></label>
        <button className={styles.primary} type="submit">{busy ? "保存中…" : "保存安排"}</button>
      </fieldset>
    </form>
    {unknown ? <button disabled={busy} onClick={() => void reconcile()} type="button">重新核实操作结果</button> : null}
    {conflict ? <div role="alert" className={styles.notice}><strong>{conflict.content_available ? "这条安排已有另一个版本" : "这条安排已删除"}</strong><p>{conflict.title} · 修订 {conflict.revision}。你的编辑仍保留在输入框中。</p><button onClick={() => applied(conflict)} type="button">使用服务器版本</button>{conflict.content_available ? <button onClick={() => { setRecord(conflict); setConflict(null); setDirty(true); setUnknown(false); clearTimeOperation(binding, { id: id.current }); rememberTimeEditorDraft(binding, { id: id.current, existing: true, base_revision: conflict.revision, fields: latestFields.current, expires: Date.now() + 86400000 }); attempt.current = null; setError(""); }} type="button">保留我的输入，再次核对保存</button> : null}</div> : null}
    {record?.status === "planned" && !conflict && !unknown && !terminal && !readbackError ? <button disabled={busy || dirty} onClick={() => void exportFile()} type="button">下载日历文件</button> : null}
    {record?.content_available && !unknown && !terminal && !readbackError ? <div className={styles.deleteArea}>{deleteConfirm ? <><p>删除将清除标题和备注。已导出的系统日历事件需自行处理。</p><button disabled={busy || Boolean(conflict)} onClick={() => void mutate("DELETE")} type="button">确认删除内容</button><button onClick={() => setDeleteConfirm(false)} type="button">保留</button></> : <button disabled={busy} onClick={() => setDeleteConfirm(true)} type="button">删除安排</button>}</div> : null}
    {mutationBlocked ? <p className={styles.notice}>请先核实另一条安排的操作结果，再修改此安排。</p> : null}
    {readbackError ? <div role="alert" className={styles.notice}><p>{readbackError}</p><button type="button" onClick={() => setReadbackRetry((v) => v + 1)}>重新读取安排</button></div> : null}
    {storageError ? <div role="alert" className={styles.notice}><p>{storageError}</p><button type="button" onClick={() => persistDraft()}>重试保留输入</button></div> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}{notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
  </section>;
}
