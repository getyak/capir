"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MemoryProposalListResponse, MemoryProposalRecord } from "@talent-signal/contracts";
import { useT } from "../locale-provider";
import { Button } from "../ui/button";
import { WORKSPACE_SESSION_EXPIRED_EVENT, workspaceSessionFetch } from "../workspace-session-request";
import { subscribeWorkspaceDirectoryInvalidation } from "@/lib/workspace-directory-cache";
import { MemoryReviewCard, type MemoryReviewCardProps } from "./memory-review-card";

type Page = Pick<MemoryProposalListResponse, "proposals" | "has_more" | "next_cursor" | "snapshot_at">;
type Props = {
  binding: string | null; entryCapability: string; purpose: "chat" | "people" | "relationship";
  personId?: string | null; contextId?: string | null; sessionId?: string | null;
  pursuit?: MemoryReviewCardProps["pursuit"]; initialPage: Page; className?: string;
};
type State = { identity: string; sourceSignature: string; capability: string;
  page: Page; phase: "ready" | "loading" | "stale" | "expired"; error: boolean };
const empty: Page = { proposals: [], has_more: false, next_cursor: null };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;

function live(page: Page): Page {
  const unique = new Map<string, MemoryProposalRecord>();
  for (const row of page.proposals) {
    if (Date.parse(row.expires_at) > Date.now()
      && row.revision >= (unique.get(row.proposal_id)?.revision ?? 0)) unique.set(row.proposal_id, row);
  }
  return { ...page, proposals: [...unique.values()] };
}

function readPage(value: unknown, props: Props, cursor: string | null, prior: Page): Page {
  const page = value as Page | null;
  if (!page || !Array.isArray(page.proposals) || page.proposals.length > 50
    || typeof page.has_more !== "boolean" || typeof page.snapshot_at !== "string"
    || !Number.isFinite(Date.parse(page.snapshot_at))
    || (page.has_more ? typeof page.next_cursor !== "string" || !page.next_cursor
      || page.next_cursor.length > 1024 || page.next_cursor === cursor : page.next_cursor !== null)
    || (cursor && page.snapshot_at !== prior.snapshot_at)) throw new Error("Invalid proposal continuation");
  for (const row of page.proposals) {
    if (!row || !uuid.test(row.proposal_id) || !Number.isSafeInteger(row.revision) || row.revision < 1
      || !Number.isFinite(Date.parse(row.expires_at)) || !Number.isFinite(Date.parse(row.created_at))
      || !Number.isSafeInteger(row.item_count) || row.item_count < 1
      || !Number.isSafeInteger(row.default_selected_count) || row.default_selected_count < 0
      || row.default_selected_count > row.item_count
      || (props.purpose === "chat" && row.surface !== "chat")
      || (props.purpose !== "chat" && row.person_id && row.person_id !== props.personId)
      || (props.contextId && row.relationship_context_id && row.relationship_context_id !== props.contextId)) {
      throw new Error("Invalid proposal page scope");
    }
  }
  if (cursor && page.proposals.some(row => prior.proposals.some(old => old.proposal_id === row.proposal_id))) {
    throw new Error("Repeated proposal page");
  }
  return live(page);
}

async function loginChanged(response: Response, signal: AbortSignal, isCurrent: () => boolean): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) return false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (!isCurrent()) return false;
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4096) { cancel(); return false; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    return row.code === "session_stale" || (row.error !== null && typeof row.error === "object"
      && (row.error as Record<string, unknown>).code === "session_stale");
  } catch { return false; }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

/** One current page, explicit one-request continuation, no unbounded append or
 * persistent cache. Review/commit authority remains inside MemoryReviewCard.
 */
export function MemoryProposalPages(props: Props) {
  const t = useT();
  const identity = JSON.stringify([props.binding, props.purpose, props.personId ?? null,
    props.contextId ?? null, props.sessionId ?? null, props.pursuit ?? null]);
  const signature = JSON.stringify(props.initialPage);
  const [state, setState] = useState<State>(() => ({ identity, sourceSignature: signature, capability: props.entryCapability,
    page: live(props.initialPage), phase: "ready", error: false }));
  const generation = useRef(0), request = useRef<AbortController | null>(null), busy = useRef(false);
  const region = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<{ epoch: number; opener: Element | null } | null>(null);
  const currentIdentity = useRef(identity);
  let current = state;
  // React's conditional render-time adjustment removes an obsolete source
  // before its children render, rather than syncing old data in an effect.
  if (state.identity !== identity || state.sourceSignature !== signature || state.capability !== props.entryCapability) {
    current = { identity, sourceSignature: signature, capability: props.entryCapability,
      page: live(props.initialPage), phase: "ready", error: false };
    setState(current);
  }

  useLayoutEffect(() => {
    currentIdentity.current = identity;
    generation.current += 1; request.current?.abort(); busy.current = false;
    return () => { generation.current += 1; request.current?.abort(); busy.current = false; };
    // A changed server snapshot/revision or capability revokes any old await.
  }, [identity, signature, props.entryCapability]);

  useEffect(() => {
    function invalidate(expired = false) {
      generation.current += 1; request.current?.abort(); busy.current = false;
      setState(previous => ({ ...previous, identity, sourceSignature: signature, capability: props.entryCapability, page: empty,
        phase: expired || previous.phase === "expired" ? "expired" : "stale", error: false }));
    }
    const expire = () => invalidate(true);
    const focus = () => invalidate(); // Current source/login cannot be proved locally.
    const visible = () => { if (document.visibilityState === "visible") invalidate(); };
    const unsubscribe = subscribeWorkspaceDirectoryInvalidation((keys, mode) => {
      if (keys !== null && (!props.binding || !keys.includes(props.binding))) return;
      // Existing auth/source/revision withdrawal bus, including revalidation
      // after destructive changes. No read is started automatically.
      invalidate(mode === "discard");
    });
    window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    return () => {
      unsubscribe(); window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
      window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visible);
    };
  }, [identity, signature, props.entryCapability, props.binding]);

  useEffect(() => {
    const deadline = Math.min(...current.page.proposals.map(row => Date.parse(row.expires_at)));
    if (!Number.isFinite(deadline)) return;
    const timer = setTimeout(() => setState(previous => ({ ...previous, page: live(previous.page) })),
      Math.max(1, Math.min(2_147_483_647, deadline - Date.now() + 1)));
    return () => clearTimeout(timer);
  }, [current.page]);

  useLayoutEffect(() => {
    const ticket = pendingFocus.current;
    if (!ticket || current.phase !== "ready") return;
    pendingFocus.current = null;
    if (ticket.epoch !== generation.current || currentIdentity.current !== identity) return;
    const active = document.activeElement;
    if (active === ticket.opener || active === document.body || !active?.isConnected) region.current?.focus();
  }, [current.page, current.phase, identity]);

  async function read(cursor: string | null) {
    if (!props.binding || current.phase === "expired" || busy.current) return;
    busy.current = true;
    const epoch = ++generation.current, controller = new AbortController(); request.current = controller;
    const opener = document.activeElement;
    const isCurrent = () => !controller.signal.aborted && epoch === generation.current && currentIdentity.current === identity;
    setState(previous => ({ ...previous, phase: "loading", error: false }));
    const deadline = setTimeout(() => {
      if (!isCurrent()) return;
      generation.current += 1; controller.abort(); busy.current = false;
      setState(previous => ({ ...previous, phase: "ready", error: true }));
    }, 15_000);
    try {
      const params = new URLSearchParams({ paginate: "true", purpose: props.purpose });
      if (props.personId) params.set("person_id", props.personId);
      if (props.contextId) params.set("relationship_context_id", props.contextId);
      if (props.sessionId) params.set("session_id", props.sessionId);
      if (cursor) params.set("cursor", cursor);
      const response = await workspaceSessionFetch(`/api/memory/proposals?${params}`, {
        cache: "no-store", signal: controller.signal, headers: { "x-workspace-session": props.binding,
          "x-memory-entry-capability": props.entryCapability },
      });
      if (!isCurrent()) return;
      if (!response.ok) {
        const staleLogin = response.status === 409
          && await loginChanged(response, controller.signal, isCurrent);
        if (!isCurrent()) return;
        if ([401, 403, 409, 410].includes(response.status)) {
          generation.current += 1;
          busy.current = false;
          setState({ identity, sourceSignature: signature, capability: props.entryCapability,
            page: empty, phase: response.status === 401 || staleLogin ? "expired" : "stale", error: false });
          // The same event removes Person/account chrome in the actual
          // WorkspaceSessionBoundary. A cursor-only409 never expires login.
          if (staleLogin) window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT));
          return;
        }
        throw new Error("Proposal page unavailable");
      }
      const body: unknown = await response.json();
      if (!isCurrent()) return;
      const page = readPage(body, props, cursor, current.page);
      if (!isCurrent()) return;
      pendingFocus.current = { epoch, opener };
      setState({ identity, sourceSignature: signature, capability: props.entryCapability, page, phase: "ready", error: false });
    } catch {
      if (epoch === generation.current && currentIdentity.current === identity) {
        setState(previous => ({ ...previous, phase: "ready", error: true }));
      }
    } finally {
      clearTimeout(deadline);
      if (epoch === generation.current) busy.current = false;
    }
  }

  if (current.phase === "expired") return <p role="alert">{t("当前登录无法继续访问这个空间。重新登录后，再核对最新内容。")}</p>;
  return <div aria-busy={current.phase === "loading"}>
    <p>{t("这是上次读取的提案快照。后续变化请重新读取最新。")}</p>
    {current.phase === "stale" ? <p role="status">{t("来源或审阅已变化，无法操作。请重新读取当前内容。")}</p> : null}
    {current.error ? <p role="alert">{t("读取失败。")}</p> : null}
    <ul ref={region} tabIndex={-1} aria-label={t("待确认变化")} className={props.className}>{current.page.proposals.map(proposal => <li key={proposal.proposal_id}>
      <MemoryReviewCard binding={props.binding} entryCapability={props.entryCapability} purpose={props.purpose}
        personId={props.personId ?? null} contextId={props.contextId ?? proposal.relationship_context_id ?? null}
        sessionId={props.sessionId ?? null} pursuit={props.pursuit ?? null}
        proposal={{ proposal_id: proposal.proposal_id, revision: proposal.revision }} />
    </li>)}</ul>
    {current.phase === "ready" && !current.page.proposals.length
      ? <p>{t("当前页没有可显示的提案。可重新读取最新内容。")}</p> : null}
    <div>
      {current.page.has_more && current.page.next_cursor && current.phase !== "stale"
        ? <Button variant="outline" disabled={current.phase === "loading"} onClick={() => void read(current.page.next_cursor ?? null)}>{t("继续查看")}</Button> : null}
      <Button variant="ghost" disabled={!props.binding || current.phase === "loading"} onClick={() => void read(null)}>{t("重新读取最新")}</Button>
    </div>
  </div>;
}
