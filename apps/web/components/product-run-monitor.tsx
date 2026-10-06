"use client";
import { workspaceSessionFetch } from "./workspace-session-request";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowBendUpLeft, ArrowClockwise, ArrowCounterClockwise, ArrowLeft, ArrowUpRight, ChatCircle, Check, Circle, CircleHalf, CircleNotch, Clock, Desktop, DeviceMobile, MagnifyingGlass, Prohibit, Question, ThumbsDown, ThumbsUp, XCircle } from "@phosphor-icons/react";
import type { ProductRunDetail, ProductRunList, ProductRunSummary } from "@talent-signal/contracts";
import { reasonLabels } from "./product-feedback";
import {
  DEFAULT_REFRESH_INTERVAL_MS, REFRESH_INTERVALS_MS,
  contentEnvelope, contentStateText, conversationSourceImages, formatRunDuration, formatSpanDuration,
  mergeRunPage, normalizeRefreshInterval, pollTick, regressionCaptureKey, regressionCaptureSupport,
  resumeFetchDue, runReviewExport, statusLabel, statusPhase, traceRows, traceStats,
  type ConversationSourceImages as ConversationSourceImagesState, type StatusPhase,
} from "./product-run-monitor-state";
import styles from "./product-run-monitor.module.css";

const sentimentName = (value: string | null) => value === "helpful" ? "有帮助" : value === "unhelpful" ? "没帮上" : "未反馈";
const stamp = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const clock = (value: string) => new Date(value).toLocaleTimeString("zh-CN");
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
export const screenshotPreprocessingPreview = (output: unknown): unknown | null => object(output).preprocessing ?? null;

async function request<T>(path: string): Promise<T> {
  const response = await workspaceSessionFetch(`/api/product-runs${path}`, { cache: "no-store" });
  const value = await response.json(); if (!response.ok) throw new Error(value.message ?? "运行记录暂时不可用。"); return value;
}

/* Terminal indicators keep each final state distinct; unknown stays unknown. */
const phaseIcons: Record<StatusPhase, typeof Check> = {
  running: CircleNotch, completed: Check, failed: XCircle, cancelled: Prohibit, interrupted: ArrowCounterClockwise,
  waiting: Clock, partial: CircleHalf, fallback: ArrowBendUpLeft, unknown: Question,
};
function PhaseMark({ phase, label }: { phase: StatusPhase; label?: string }) {
  const Icon = phaseIcons[phase];
  return <span className={styles.phase} data-phase={phase}><Icon size={14} aria-hidden />{label ? <span>{label}</span> : null}</span>;
}

function DataPreview({ value, unavailable = false }: { value: unknown; unavailable?: boolean }) {
  // Source loss hides bodies; it never resurrects a previously cached one.
  if (unavailable) return <p className={styles.muted}>原始内容已不可用。</p>;
  const envelope = contentEnvelope(value);
  if (envelope) return <div className={styles.contentState}><p className={styles.muted}>{contentStateText(envelope)}</p>
    {envelope.hasValue ? <DataPreview value={envelope.value} /> : null}</div>;
  if (value == null) return <p className={styles.muted}>未记录</p>;
  if (typeof value === "string") return <p className={styles.prose}>{value}</p>;
  if (Array.isArray(value)) return <div className={styles.dataList}>{value.map((item, index) => <DataPreview key={index} value={item} />)}</div>;
  const data = object(value);
  if (data.type === "image_url" || data.type === "image") return <p className={styles.muted}>图片输入 · 原图见「上下文」</p>;
  if (data.role && data.content) return <section className={styles.message}><small>{String(data.role)}</small><DataPreview value={data.content} /></section>;
  if (typeof data.text === "string") return <p className={styles.prose}>{data.text}</p>;
  return <pre className={styles.json}>{JSON.stringify(value, (key, item) => key === "data_base64" || (typeof item === "string" && item.startsWith("data:image/")) ? "[image content]" : item, 2)}</pre>;
}
function Answer({ output }: { output: unknown }) {
  const data = object(output), blocks = Array.isArray(data.blocks) ? data.blocks : [];
  if (!blocks.length) return <DataPreview value={data.summary ?? output} />;
  return <div>{blocks.map((raw, index) => { const block = object(raw); return <section className={styles.answerBlock} key={String(block.id ?? index)}>
    <h3>{String(block.title ?? "回答")}</h3><p className={styles.prose}>{String(block.body ?? "")}</p>
  </section>; })}</div>;
}

function CaseCapture({ detail }: { detail: ProductRunDetail }) {
  const [expected, setExpected] = useState(detail.run.feedback.correction || "");
  const [state, setState] = useState(""), [busy, setBusy] = useState(false);
  const [savedCaseID, setSavedCaseID] = useState<string | null>(null);
  const operation = useRef<{ id: string; output_hash: string; expected_behavior: string } | null>(null);
  // Capture binds to one exact output version and resets when it changes.
  const support = regressionCaptureSupport(detail);
  async function save() {
    if (!support.supported || busy) return;
    setBusy(true);
    const body = operation.current ?? { id: crypto.randomUUID(), output_hash: support.outputHash, expected_behavior: expected };
    operation.current = body;
    try {
      const response = await workspaceSessionFetch(`/api/product-runs/${detail.run.id}/cases`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const value = await response.json(); if (!response.ok) throw new Error(value.message);
      setSavedCaseID(body.id); setState("saved");
    } catch (error) { setState((error as Error).message); }
    finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(runReviewExport(detail), null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `product-run-${detail.run.id}.json`; anchor.click(); URL.revokeObjectURL(url);
  }
  return <details className={styles.caseCapture}><summary>把这次运行用于 Eval</summary>
    <p>保留原始问题、回答和反馈。填写可判断的预期行为，再用原始输入比较不同模型或提示词。反馈只是用户评价，不会成为标准答案。</p>
    {state === "saved" ? <p role="status">已加入回归证据库。<Link href={`/workspace/lab?regression=${savedCaseID}`}>打开 Lab 比较版本 →</Link></p> : support.supported ? <>
      <label>怎样的回答才符合预期？<textarea maxLength={2000} value={expected} disabled={busy} onChange={event => { setExpected(event.target.value); operation.current = null; }} placeholder="例如：保留‘时间待确认’，先问清日期。" /></label>
      {state && <p role="alert">{state}</p>}
      <button disabled={busy || !expected.trim()} onClick={() => void save()}>{busy ? "正在保存…" : "加入回归证据库"}</button>
      <p className={styles.muted}>将绑定答案版本 {support.outputHash.slice(0, 12)}…；版本变化后需重新保存。</p>
    </> : <p>{support.reason === "missing-output-hash" ? "缺少可比较的答案版本（输出指纹为空或无效），暂不能加入回归证据库；可以先导出完整运行。"
      : support.reason === "image-run" ? "含图片的回答不可自动回放；可以先导出完整运行用于分析与案例设计。"
      : support.reason === "input-unproven" ? "这次输入的采集内容不完整，无法确认可安全回放；可以先导出完整运行用于分析与案例设计。"
      : "这类任务的自动回放尚未接入；可以先导出完整运行用于分析与案例设计。"}</p>}
    <button onClick={download}>导出运行与反馈</button>
  </details>;
}

/* Conversation originals: bytes only through the existing authenticated
 * conversation-image route for the exact persisted session/message identity.
 * Object URLs only; no base64 reaches the DOM or logs. */
function useSessionBinding(explicit: string | null | undefined, taskID: string | null): { binding: string | null; resolved: boolean } {
  const key = `${explicit ?? ""}|${taskID ?? ""}`;
  const [result, setResult] = useState<{ key: string; binding: string | null; resolved: boolean }>(() =>
    explicit ? { key, binding: explicit, resolved: true } : { key, binding: null, resolved: !taskID });
  // Identity-bound derivation: a binding minted for a previous login or task is
  // never visible for the current one, including before any effect can clear.
  const current = result.key === key ? result
    : explicit ? { key, binding: explicit, resolved: true }
    : { key, binding: null, resolved: !taskID };
  useEffect(() => {
    if (explicit || !taskID) return;
    let alive = true;
    const controller = new AbortController();
    // The existing chat-artifacts read mints the rendered login binding to an
    // authenticated client (the same bootstrap run-artifacts uses) even when
    // the upstream has no artifact task; only the response header is kept, and
    // no credential or artifact bytes are logged or stored.
    void workspaceSessionFetch(`/api/chat-artifacts/${encodeURIComponent(taskID)}`, { cache: "no-store", signal: controller.signal })
      .then(response => { const binding = response.headers.get("x-workspace-session"); if (alive) setResult({ key, binding, resolved: true }); })
      .catch(() => { if (alive && !controller.signal.aborted) setResult({ key, binding: null, resolved: true }); });
    return () => { alive = false; controller.abort(); };
  }, [explicit, taskID, key]);
  return current;
}

function ConversationSourceImage({ image, position, total, binding, resolved }: {
  image: { index: number; fileName: string; route: string }; position: number; total: number;
  binding: string | null; resolved: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!binding) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void workspaceSessionFetch(image.route, { cache: "no-store", headers: { "x-workspace-session": binding }, signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("image unavailable");
        const blob = await response.blob();
        // A withdrawn login or changed source aborts before any bytes display.
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [binding, image.route, attempt]);
  return <figure className={styles.sourceImage}>{url ? <a href={url} target="_blank" rel="noreferrer">
    <Image unoptimized src={url} width={220} height={320} alt={`原始图片 ${position + 1}：${image.fileName}`} />
    <span>查看原始图片 {position + 1} · {image.fileName} <ArrowUpRight size={14} /></span>
  </a> : <figcaption role={failed ? "alert" : "status"}>{!resolved ? "正在确认登录…"
    : !binding ? "当前登录无法读取原始图片，请重新打开工作台。"
    : failed ? <>原始图片 {position + 1} 暂时无法读取 <button type="button" onClick={() => { setUrl(null); setFailed(false); setAttempt(value => value + 1); }}>重试</button></>
    : `正在读取原始图片 ${position + 1} / ${total}…`}</figcaption>}</figure>;
}

function ConversationSourceImages({ source, binding, taskID }: {
  source: Extract<ConversationSourceImagesState, { state: "ready" }>; binding: string | null | undefined; taskID: string | null;
}) {
  const session = useSessionBinding(binding, taskID);
  return <div className={styles.images} aria-label="原始输入图片">{source.images.map(image =>
    // Keyed to the exact source route AND the login binding: a withdrawn login
    // or changed source unmounts the previous image in this same commit, so a
    // late response can never display old bytes.
    <ConversationSourceImage key={`${session.binding ?? "unbound"}|${image.route}`} image={image}
      position={image.index} total={source.images.length} binding={session.binding} resolved={session.resolved} />)}</div>;
}

function TraceView({ detail }: { detail: ProductRunDetail }) {
  const run = detail.run;
  const stats = traceStats(detail.spans);
  const rows = traceRows(detail.spans);
  return <>
    {/* Totals, model, attempts, failed tools and the final status stay separate
        semantics: a completed run never implies every tool succeeded. */}
    <div className={styles.traceSummary}>
      <div><small>总耗时</small><strong>{formatRunDuration(run.duration_ms, run.status)}</strong></div>
      <div><small>最终状态</small><strong><PhaseMark phase={statusPhase(run.status)} label={statusLabel(run.status)} /></strong></div>
      <div><small>模型</small><strong>{run.model ?? "未调用或未报告"}</strong></div>
      <div><small>请求次数</small><strong>{run.attempts}</strong></div>
      <div><small>记录步骤</small><strong>{stats.spanCount}</strong></div>
      <div><small>失败工具</small><strong>{stats.failedToolCount}</strong></div>
    </div>
    {!rows.length ? <p className={styles.muted}>这次运行没有记录执行步骤。请查看运行状态与原始输入。</p> : null}
    <ol className={styles.timeline}>{rows.map(({ span, depth, parentName }) => {
      const phase = statusPhase(span.status);
      return <li key={span.id} data-phase={phase} style={{ paddingInlineStart: Math.min(depth, 4) * 18 }}>
        <PhaseMark phase={phase} />
        <details><summary><strong>{span.name}</strong><small>{statusLabel(span.status)} · {formatSpanDuration(span)}{parentName ? ` · 来自 ${parentName}` : ""}</small></summary>
          <h4>输入</h4><DataPreview value={span.input} unavailable={!run.content_available} />
          <h4>输出</h4><DataPreview value={span.output} unavailable={!run.content_available} />
          {span.error ? <p className={styles.error}>{span.error}</p> : null}
          <details><summary>调用元数据</summary><DataPreview value={span.metadata} /></details>
        </details>
      </li>;
    })}</ol>
  </>;
}

export function ProductRunMonitor({ sessionBinding }: { sessionBinding?: string | null } = {}) {
  const [list, setList] = useState<ProductRunList | null>(null), [detail, setDetail] = useState<ProductRunDetail | null>(null);
  const [selectedID, setSelectedID] = useState<string | null>(null), [tab, setTab] = useState("answer");
  const [sentiment, setSentiment] = useState(""), [platform, setPlatform] = useState(""), [status, setStatus] = useState(""), [query, setQuery] = useState("");
  const [listError, setListError] = useState(""), [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false);
  const [listUpdatedAt, setListUpdatedAt] = useState<string | null>(null), [detailUpdatedAt, setDetailUpdatedAt] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true), [intervalMs, setIntervalMs] = useState(DEFAULT_REFRESH_INTERVAL_MS);
  // Historical paging pauses latest-page list polling; the manual refresh returns to the latest list.
  const [historical, setHistorical] = useState(false);
  const generation = useRef(0), detailGeneration = useRef(0);
  const listBusy = useRef(false), detailBusy = useRef(false);
  const lastListFetch = useRef<number | null>(null), lastDetailFetch = useRef<number | null>(null);

  const loadList = useCallback(async (cursor?: string) => {
    const ticket = ++generation.current;
    listBusy.current = true;
    setHistorical(!!cursor);
    const params = new URLSearchParams(); if (sentiment) params.set("sentiment", sentiment); if (platform) params.set("platform", platform);
    if (status) params.set("status", status); if (query.trim()) params.set("q", query.trim()); if (cursor) params.set("cursor", cursor);
    try {
      const next = await request<ProductRunList>(`?${params}`); if (ticket !== generation.current) return;
      setList(current => ({ ...next, runs: mergeRunPage(cursor && current ? current.runs : null, next.runs, !!cursor) }));
      setListUpdatedAt(new Date().toISOString()); setListError(""); lastListFetch.current = Date.now();
    } catch (caught) { if (ticket === generation.current) setListError((caught as Error).message); }
    finally { if (ticket === generation.current) { listBusy.current = false; setLoading(false); } }
  }, [sentiment, platform, status, query]);

  const loadDetail = useCallback(async (id: string) => {
    const ticket = ++detailGeneration.current;
    detailBusy.current = true;
    try {
      const next = await request<ProductRunDetail>(`/${id}`);
      if (ticket !== detailGeneration.current) return;
      setDetail(next); setDetailError(""); setDetailUpdatedAt(new Date().toISOString()); lastDetailFetch.current = Date.now();
    } catch (caught) { if (ticket === detailGeneration.current) setDetailError((caught as Error).message); }
    finally { if (ticket === detailGeneration.current) detailBusy.current = false; }
  }, []);

  // Debounced latest-page read on mount and on every filter change; the
  // generation fence discards any in-flight response from a previous filter set.
  useEffect(() => {
    const requestGeneration = generation;
    const timer = setTimeout(() => void loadList(), 200);
    return () => { clearTimeout(timer); requestGeneration.current++; };
  }, [loadList]);

  // Latest-page list polling: visible tab only, never overlapping, paused while
  // paging through history. Polling is read-only and triggers no provider or job.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!pollTick({ visible: document.visibilityState === "visible", autoRefresh, inFlight: listBusy.current, paused: historical })) return;
      void loadList();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [autoRefresh, intervalMs, historical, loadList]);

  // Selected detail polls on its own schedule, independent of list pagination.
  useEffect(() => {
    if (!selectedID) return;
    const requestGeneration = detailGeneration;
    const initial = setTimeout(() => void loadDetail(selectedID), 0);
    const timer = setInterval(() => {
      if (!pollTick({ visible: document.visibilityState === "visible", autoRefresh, inFlight: detailBusy.current })) return;
      void loadDetail(selectedID);
    }, intervalMs);
    return () => { clearTimeout(initial); clearInterval(timer); requestGeneration.current++; };
  }, [selectedID, loadDetail, autoRefresh, intervalMs]);

  // Visibility resume: one bounded immediate fetch per stream, never a burst.
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== "visible" || !autoRefresh) return;
      const now = Date.now();
      if (!historical && !listBusy.current && resumeFetchDue(lastListFetch.current, now, intervalMs)) void loadList();
      if (selectedID && !detailBusy.current && resumeFetchDue(lastDetailFetch.current, now, intervalMs)) void loadDetail(selectedID);
    };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, [autoRefresh, historical, selectedID, intervalMs, loadList, loadDetail]);

  function select(run: ProductRunSummary) { setSelectedID(run.id); setDetail(null); setDetailError(""); setDetailUpdatedAt(null); setTab("answer"); }
  function changeFilter(update: () => void) {
    // Old results must not appear to match the newly selected filters, even
    // during the debounce or while the next read is pending.
    generation.current++;
    setList(null); setListUpdatedAt(null); setListError("");
    setLoading(true); setHistorical(false);
    update();
  }
  async function loadMore() {
    const cursor = list?.next_cursor; if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try { await loadList(cursor); } finally { setLoadingMore(false); }
  }
  const refreshNow = useCallback(() => {
    setHistorical(false);
    void loadList();
    if (selectedID) void loadDetail(selectedID);
  }, [loadList, loadDetail, selectedID]);

  const current = detail?.run;
  const preprocessing = screenshotPreprocessingPreview(detail?.output);
  const conversationImages = detail && current ? conversationSourceImages(current, detail.input) : null;
  const pollingLabel = !autoRefresh ? "自动更新已关闭" : historical ? "自动更新已暂停 · 正在查看历史页" : `每 ${intervalMs / 1000} 秒更新 · 仅标签页可见时`;
  const listLabel = listError ? "列表 · 连接中断 · 保留上次结果" : listUpdatedAt ? `列表 · 更新于 ${clock(listUpdatedAt)}` : "列表 · 正在连接";
  const detailLabel = detailError ? "详情 · 读取失败 · 保留上次结果" : detailUpdatedAt ? `详情 · 更新于 ${clock(detailUpdatedAt)}` : "详情 · 正在读取";

  return <main className={styles.page} id="main-content">
    <header className={styles.header}><div><p className={styles.eyebrow}>AGENT / QUALITY</p><h1>运行与反馈<span>每次回答，都有来处</span></h1><p>查看 Web 与 iOS 的真实运行，理解用户觉得有用的地方，以及下一次可以改善什么。</p></div>
      <Link href="/workspace/evals">实验与回归 <ArrowUpRight size={16} /></Link></header>
    <div className={styles.toolbar}><div className={styles.filters} aria-label="反馈筛选">{[["", "全部", "all"], ["helpful", "有帮助", "helpful"], ["unhelpful", "没帮上", "unhelpful"], ["unrated", "未反馈", "unrated"]].map(([value, label, key]) =>
      <button key={key} aria-pressed={sentiment === value} onClick={() => { if (sentiment !== value) changeFilter(() => setSentiment(value!)); }}>{label}<span>{list?.counts[key as keyof ProductRunList["counts"]] ?? "—"}</span></button>)}</div>
      <div className={styles.refresh}>
        <label className={styles.autoRefresh}><input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} /> 自动刷新</label>
        <select className={styles.interval} aria-label="自动刷新间隔" value={intervalMs} disabled={!autoRefresh}
          onChange={event => setIntervalMs(normalizeRefreshInterval(Number(event.target.value)))}>
          {REFRESH_INTERVALS_MS.map(value => <option key={value} value={value}>{value / 1000} 秒</option>)}
        </select>
        <span className={styles.freshness} role="status"><span><i data-error={!!listError} />{listLabel}</span>
          {selectedID ? <span><i data-error={!!detailError} />{detailLabel}</span> : null}</span>
        <button aria-label="刷新运行" title="读取最新列表与详情" onClick={refreshNow}><ArrowClockwise size={18} /></button>
      </div></div>
    <div className={styles.searchBar}><label><MagnifyingGlass size={17} /><input value={query} onChange={event => changeFilter(() => setQuery(event.target.value))} placeholder="搜索当时的问题" aria-label="搜索运行" /></label>
      <select value={platform} onChange={event => changeFilter(() => setPlatform(event.target.value))} aria-label="来源平台"><option value="">所有平台</option><option value="web">Web</option><option value="ios">iOS</option><option value="unknown">其他／未标识</option></select>
      <select value={status} onChange={event => changeFilter(() => setStatus(event.target.value))} aria-label="执行状态"><option value="interrupted">已中断</option><option value="waiting_for_user">待确认</option><option value="partial">部分完成</option><option value="cancelled">已停止</option><option value="">所有状态</option><option value="completed">已完成</option><option value="running">运行中</option><option value="failed">失败</option><option value="fallback">已降级</option></select>
      <span>未反馈表示尚无评价</span></div>
    {listError && <div role="alert" className={styles.error}>{listError} <button onClick={() => void loadList()}>重新连接</button>{list && <span>以下保留上次读取的结果，可能已过时。</span>}</div>}
    <div className={styles.workspace} data-selected={!!selectedID}>
      <section className={styles.list} aria-label="运行列表"><div className={styles.listHeading}><span>最近运行</span><small>{pollingLabel}</small></div>
        {loading && !list ? <p className={styles.empty}>正在读取运行记录…</p> : !list?.runs.length ? <div className={styles.empty}><ChatCircle size={30} /><h2>{sentiment || query || platform || status ? "没有匹配的运行" : "等待第一条真实运行"}</h2><p>在 Web 或 iOS 发送一条消息，运行就会出现在这里。无需先点赞。</p></div> : list.runs.map(run => <button className={styles.run} aria-pressed={selectedID === run.id} key={run.id} onClick={() => select(run)}>
          <div className={styles.runMeta}>{run.platform === "ios" ? <DeviceMobile size={15} /> : <Desktop size={15} />}<span>{run.platform === "unknown" ? "未标识" : run.platform === "ios" ? "iOS" : "Web"}</span><time>{stamp(run.created_at)}</time></div>
          <strong>{run.objective || "截图与关系整理"}</strong><div className={styles.runFooter}><span className={styles.sentiment} data-value={run.feedback.sentiment ?? "unrated"}>{run.feedback.sentiment === "helpful" ? <ThumbsUp /> : run.feedback.sentiment === "unhelpful" ? <ThumbsDown /> : <Circle />}{sentimentName(run.feedback.sentiment)}</span><span>{statusLabel(run.status)} · {formatRunDuration(run.duration_ms, run.status)}</span></div>
        </button>)}
        {list?.next_cursor && <button className={styles.more} disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "正在加载…" : "加载更多"}</button>}
      </section>
      <section className={styles.detail} aria-label="运行详情"><button className={styles.back} onClick={() => { setSelectedID(null); setDetail(null); }}><ArrowLeft size={16} /> 返回运行列表</button>
        {detailError && !detail ? <div className={styles.empty} role="alert">{detailError}<button onClick={() => selectedID && void loadDetail(selectedID)}>重试</button></div> : !detail ? <div className={styles.placeholder}><ChatCircle size={34} /><h2>{selectedID ? "正在读取这次运行…" : "从一次真实回答开始"}</h2><p>选择左侧运行，预览用户的问题、当时的回答与完整执行细节。</p><div><span><ThumbsUp /> 看懂为什么有用</span><span><ThumbsDown /> 定位哪里没帮上</span><span><Circle /> 发现未反馈的运行</span></div></div> : <>
          {detailError && <div role="alert" className={styles.error}>{detailError} <span>以下保留上次读取的结果，可能已过时。</span><button onClick={() => selectedID && void loadDetail(selectedID)}>重试</button></div>}
          <header className={styles.detailHeader}><div><p>{current!.platform.toUpperCase()} <span>·</span> {stamp(current!.created_at)} <span>·</span> <PhaseMark phase={statusPhase(current!.status)} label={statusLabel(current!.status)} /></p><h2>{current!.objective || "截图与关系整理"}</h2></div><span className={styles.sentiment} data-value={current!.feedback.sentiment ?? "unrated"}>{sentimentName(current!.feedback.sentiment)}</span></header>
          <nav className={styles.tabs} aria-label="详情内容">{[["answer", "回答预览"], ["feedback", `反馈${detail.history.length ? ` · ${detail.history.length}` : ""}`], ["context", "上下文"], ["trace", `执行链路 · ${detail.spans.length}`]].map(([value, label]) => <button key={value} aria-current={tab === value ? "page" : undefined} onClick={() => setTab(value!)}>{label}</button>)}</nav>
          <div className={styles.detailBody}>{tab === "trace" ? <TraceView detail={detail} /> : !current!.content_available ? <div className={styles.empty}><p>原始内容已不可用，回答、反馈与原文不再显示。</p><p>运行状态与执行元数据仍可在「执行链路」核对。</p></div> : tab === "answer" ? <><div className={styles.userQuestion}><small>用户的问题</small><p>{current!.objective}</p></div><div className={styles.answer}><small>当时返回的回答</small><Answer output={detail.output} /></div><CaseCapture key={regressionCaptureKey(current!)} detail={detail} /></> : tab === "feedback" ? <>
            {!detail.history.length ? <div className={styles.empty}><Circle size={24} /><h3>还没有反馈</h3><p>运行已记录；没有评价不会被计为满意或不满意。</p></div> : detail.history.map((event, index) => <article className={styles.feedbackEvent} key={event.id}><header><strong>{event.sentiment ? sentimentName(event.sentiment) : "已撤回评价"}</strong><small>v{event.revision} · {stamp(event.updated_at!)}{index === 0 && event.output_hash === current!.output_hash && event.revision === current!.feedback.revision && event.sentiment === current!.feedback.sentiment ? " · 当前" : " · 历史"}</small></header><div className={styles.reasonTags}>{event.reasons.map(reason => <span key={reason}>{reasonLabels[reason] ?? reason}</span>)}</div>{event.selected_text && <blockquote>{event.selected_text}</blockquote>}{event.comment && <p className={styles.prose}>{event.comment}</p>}<details><summary>反馈对应的答案版本</summary><Answer output={event.output} /></details>{event.correction && <div className={styles.correction}><small>用户希望怎样回答</small><p>{event.correction}</p></div>}</article>)}
            {!!detail.corrections.length && <details><summary>已关联的纠正与回归案例</summary><DataPreview value={detail.corrections} /></details>}
          </> : <><h3>原始输入</h3><DataPreview value={detail.input} />
            {conversationImages?.state === "ready" && <ConversationSourceImages source={conversationImages} binding={sessionBinding} taskID={current!.task_id} />}
            {current!.task_kind === "screenshot" && current!.task_id && <div className={styles.images}>{(Array.isArray(object(detail.output).source_images) ? object(detail.output).source_images as unknown[] : [{image_index:0}]).map((item,index) => { const imageIndex=Number(object(item).image_index ?? index);const src=`/api/contact-agent/tasks/${current!.task_id}/images/${imageIndex}`;return <a key={imageIndex} href={src} target="_blank" rel="noreferrer"><Image unoptimized src={src} width={220} height={320} alt={`原始截图 ${imageIndex+1}`} /><span>查看发送的原始截图 {imageIndex+1} <ArrowUpRight size={14} /></span></a>; })}</div>}{preprocessing && <><h3>截图预处理（未确认）</h3><p className={styles.muted}>直接图像理解的结构化结果；不等同于已确认身份、事实或行动。</p><DataPreview value={preprocessing} /></>}<h3>冻结的 Memory、来源与模型输入</h3>{detail.execution ? <DataPreview value={detail.execution} /> : <>{detail.spans.filter(span => span.kind === "context" || span.kind === "llm").map(span => <details key={span.id}><summary>{span.name} · {stamp(span.started_at)}</summary><DataPreview value={span.input} /></details>)}{!detail.spans.length && <p className={styles.muted}>这次运行没有记录模型上下文。请查看执行状态与原始输入。</p>}</>}<details><summary>版本与关联标识</summary><DataPreview value={{ run_id: current!.id, task_id: current!.task_id, session_id: current!.session_id, output_hash: current!.output_hash, attempts: current!.attempts, model: current!.model }} /></details></>}</div>
        </>}
      </section>
    </div>
  </main>;
}
