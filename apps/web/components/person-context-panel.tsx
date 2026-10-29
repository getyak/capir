"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, CaretRight, X } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { PersonContextPreview } from "@/lib/person-context-preview";
import { subscribeWorkspaceDirectoryInvalidation } from "@/lib/workspace-directory-cache";
import { WORKSPACE_SESSION_EXPIRED_EVENT, workspaceSessionFetch } from "./workspace-session-request";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { coordinatorScopeIsCurrent, subscribeWorkspaceRefresh, workspaceRefreshGeneration } from "@/lib/workspace-refresh";
import { withReturnSession } from "./session-return-navigation";
import { useLocale, useT, type TFunction } from "./locale-provider";
import type { MarketingLocale } from "@/lib/marketing-locale";
import styles from "./person-context-panel.module.css";

type Selection = { personId: string; binding: string; pathname: string; returnSession: string | null; opener: HTMLElement | null };
type PanelContext = { open: (personId: string, opener?: HTMLElement | null) => void; selectedId: string | null };
const Context = createContext<PanelContext>({open: () => undefined, selectedId: null});
export const usePersonContextPanel = () => useContext(Context);
function previewDate(value: string, locale: MarketingLocale, t: TFunction) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("时间未知");
  return new Intl.DateTimeFormat(locale, {
    month: "short", day: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
  }).format(date);
}

export function PersonContextPanelProvider({binding, children}: {binding: string | null; children: ReactNode}) {
  const t = useT();
  const pathname = usePathname();
  const [selection, setSelection] = useState<Selection | null>(null);
  // Discard is authorization loss, not a retryable read error. Keep its fence
  // for this Provider's lifetime, including close/reopen and binding changes.
  // Store at most 64 bindings; never evict a tombstone and revive old access.
  // If that bound is exhausted, this Provider stays closed until remounted.
  // This is memory-only denial, never a source of new session authority.
  const revoked = useRef({bindings: new Set<string>(), exhausted: false});
  const bindingDenied = useCallback((candidate: string) => revoked.current.exhausted || revoked.current.bindings.has(candidate), []);
  const denyBinding = useCallback((candidate: string) => {
    const fence = revoked.current;
    if (!fence.bindings.has(candidate)) {
      if (fence.bindings.size >= 64) fence.exhausted = true;
      else fence.bindings.add(candidate);
    }
    const exhausted = fence.exhausted;
    setSelection(previous => exhausted || previous?.binding === candidate ? null : previous);
  }, []);
  // Render-time fences hide content before effects run on any scope or route
  // transition. Clear the intent too, so browser Back never reopens old data.
  const current = selection?.binding === binding && selection?.pathname === pathname ? selection : null;
  useEffect(() => { if (selection && !current) queueMicrotask(() => setSelection(previous => previous === selection ? null : previous)); }, [selection, current]);
  const open = useCallback((personId: string, opener?: HTMLElement | null) => {
    if (!binding || bindingDenied(binding)) return;
    setSelection({personId, binding, pathname, returnSession: pathname.match(/^\/workspace\/sessions\/([\da-f-]+)$/i)?.[1] ?? null, opener: opener ?? null});
  }, [binding, pathname, bindingDenied]);
  const close = useCallback(() => setSelection(null), []);
  useEffect(() => subscribeWorkspaceDirectoryInvalidation((keys, mode) => {
    if (mode === "discard" && binding && (keys === null || keys.includes(binding))) denyBinding(binding);
  }), [binding, denyBinding]);
  useEffect(() => {
    const expired = () => { if (binding) denyBinding(binding); else close(); };
    window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT,expired);
    return () => window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT,expired);
  }, [binding, denyBinding, close]);
  return <Context.Provider value={{open, selectedId: current?.personId ?? null}}>
    <Dialog.Root open={Boolean(current)} onOpenChange={value => {if (!value) close();}} modal>
      {children}
      {current && <Dialog.Portal><Dialog.Overlay className={`ts-workspace-theme ${styles.overlay}`} data-person-context-overlay />
        <Dialog.Content aria-describedby={undefined} className={`ts-workspace-theme ts-workspace-surface ${styles.panel}`} data-person-context-panel
          onCloseAutoFocus={event => {event.preventDefault(); const target = current.opener; requestAnimationFrame(() => {if (target?.isConnected) target.focus(); else document.querySelector<HTMLElement>("#queued-conversation-composer")?.focus();});}}>
          <div className={styles.top}><Dialog.Title>{t("人物背景")}</Dialog.Title><Dialog.Close aria-label={t("关闭人物背景")} className={styles.close}><X size={18} aria-hidden="true" /></Dialog.Close></div>
          <Preview key={`${current.binding}:${current.personId}`} selection={current} bindingDenied={bindingDenied} denyBinding={denyBinding}/>
        </Dialog.Content>
      </Dialog.Portal>}
    </Dialog.Root>
  </Context.Provider>;
}

function Preview({selection, bindingDenied, denyBinding}: {selection: Selection; bindingDenied: (binding: string) => boolean; denyBinding: (binding: string) => void}) {
  const t = useT();
  const locale = useLocale();
  const [result, setResult] = useState<PersonContextPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let controller: AbortController | null = null;
    let owned = true;
    let requestVersion = 0;
    let inFlight = false;
    async function load(force = false) {
      if (!owned || bindingDenied(selection.binding) || (inFlight && !force)) return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const version = ++requestVersion;
      const generation = workspaceRefreshGeneration(selection.binding);
      inFlight = true;
      // Clear derived content before an explicit invalidation. Routine bounded
      // refresh keeps the layout steady, then clears on any failed read.
      if (force) { setResult(null); setFailed(false); }
      try {
        const response = await workspaceSessionFetch(`/api/local-integration/people/${encodeURIComponent(selection.personId)}/preview`, {
          cache: "no-store", signal, headers: {"x-workspace-session": selection.binding},
        });
        if (!response.ok) throw new Error("unavailable");
        const body = await response.json() as PersonContextPreview;
        if (body.session_version !== selection.binding || body.person?.id !== selection.personId) throw new Error("stale");
        if (owned && !bindingDenied(selection.binding) && version === requestVersion && !signal.aborted && coordinatorScopeIsCurrent(selection.binding, generation)) {
          setResult(body); setFailed(false);
        }
      } catch {
        if (owned && !bindingDenied(selection.binding) && version === requestVersion && !signal.aborted) {setResult(null); setFailed(true);}
      } finally {
        if (version === requestVersion) inFlight = false;
      }
    }
    const unsubscribeRefresh = subscribeWorkspaceRefresh(selection.binding, (reason, generation) => {
      if (coordinatorScopeIsCurrent(selection.binding, generation)) void load(reason !== "interval");
    });
    const unsubscribe = subscribeWorkspaceDirectoryInvalidation((keys, mode) => {
      if (keys && !keys.includes(selection.binding)) return;
      if (mode === "revalidate") void load(true);
      else { denyBinding(selection.binding); requestVersion++; controller?.abort(); inFlight = false; setResult(null); setFailed(true); }
    });
    void load();
    return () => {owned = false; controller?.abort(); unsubscribe(); unsubscribeRefresh();};
  }, [selection.binding, selection.personId, attempt, bindingDenied, denyBinding]);
  const canonical = withReturnSession(`/workspace/people/${selection.personId}`, selection.returnSession);
  if (failed) return <div className={styles.state} role="alert"><p>{t("人物背景暂时无法读取。")}</p><button onClick={() => {setFailed(false); setAttempt(value => value + 1);}}>{t("重试")}</button></div>;
  if (!result) return <div className={styles.state} role="status">{t("正在读取人物背景…")}</div>;
  return <div className={styles.body}>
    <div className={styles.identity}><PersonDirectoryAvatar id={result.person.id} label={result.person.label} url={result.person.avatarUrl} size={48}/><div><h2>{result.person.label}</h2>{result.person.headline && <p>{result.person.headline}</p>}</div></div>
    {result.person.contexts.length > 0 && <div className={styles.metadata}><span>{t("关系情境")}</span><div>{result.person.contexts.map(context => <span key={context.id}>{context.label}</span>)}</div></div>}
    <section className={styles.memory}><h3>{t("与你有关")}</h3>{result.memory.length ? result.memory.map(item => <article key={item.id}>
      <span className={styles.kind}>{item.scope === "relationship" ? t("我们之间") : t("沟通背景")}{item.timeStatus === "future" ? ` · ${t("尚未发生")}` : item.timeStatus === "unknown" ? ` · ${t("时间未知")}` : ""}</span>
      <p>{item.text}</p><Link className={styles.provenance} href={canonical}>{[item.speaker, item.observedAt ? previewDate(item.observedAt, locale, t) : null, item.kind === "source_statement" ? t("来源陈述") : item.kind === "user_opinion" ? t("用户观点") : t("已保存事实")].filter(Boolean).join(" · ")}<span>{item.evidenceRetained ? t("核对人物记忆") : t("原始证据已不保留")}<CaretRight size={12} aria-hidden="true"/></span></Link>
    </article>) : <p className={styles.empty}>{t("暂无已保存的相关记忆。")}</p>}</section>
    <section className={styles.history}><h3>{t("最近对话")}</h3>{result.historyUnavailable ? <p className={styles.empty}>{t("相关对话暂时无法读取。")}</p> : result.history.length ? result.history.map(session => <Link key={session.id} href={`/workspace/sessions/${session.id}`}><time dateTime={session.updatedAt} title={t("对话更新时间")}>{previewDate(session.updatedAt, locale, t)}</time><span>{session.title}</span><CaretRight size={14} aria-hidden="true"/></Link>) : <p className={styles.empty}>{t("暂无相关对话。")}</p>}</section>
    <Link className={styles.destination} href={canonical}>{t("打开联系人页面")}<ArrowUpRight size={14} aria-hidden="true"/></Link>
  </div>;
}
