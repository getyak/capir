"use client";

import { useT } from "@/components/locale-provider";
import { ArrowRight, CircleNotch, MagnifyingGlass, X } from "@phosphor-icons/react";
import Form from "next/form";
import Link from "next/link";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "./ui/button";
import { withReturnSession } from "./session-return-navigation";
import styles from "./people-directory-app.module.css";

type Submission = { id: symbol; query: string; version: number };
type SearchState = {
  query: string; resultVersion: unknown; draft: string; version: number; composing: boolean;
  submissions: Submission[]; completed: symbol | null;
};
type SearchContext = {
  state: SearchState; input: React.RefObject<HTMLInputElement | null>; returnSessionId: string | null;
  change: (value: string) => void; compose: (value: boolean) => void;
  markKey: (event: React.KeyboardEvent) => void; releaseKey: () => void;
  submit: (event: React.FormEvent) => void; clear: (opener: HTMLAnchorElement | null) => boolean;
};
const Context = createContext<SearchContext | null>(null);
const normalized = (value: string) => value.normalize("NFKC").trim().slice(0, 160);

/** One local draft survives query readback; only the server query owns results. */
export function PeopleDirectorySearchProvider({ query, resultVersion, returnSessionId, children }: {
  query: string; resultVersion?: unknown; returnSessionId: string | null; children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const candidateEnter = useRef(false);
  const clearing = useRef<{ id: symbol; opener: HTMLAnchorElement | null; focusOwned: boolean } | null>(null);
  const [state, setState] = useState<SearchState>(() => ({ query, resultVersion, draft: query, version: 0, composing: false, submissions: [], completed: null }));

  // RSC readback supplies a fresh result array even for a repeated query.
  // Do not replace a newer draft with the older submission that just finished.
  // A same-query refresh owns results, never the local draft or another pending
  // submission. Unmatched Back/Forward restores only a changed committed query.
  if (!state.composing && (state.query !== query || state.resultVersion !== resultVersion)) {
    const queryChanged = state.query !== query;
    const matchIndex = state.submissions.findLastIndex(operation => operation.query === query);
    const match = state.submissions[matchIndex];
    const latest = matchIndex >= 0 && matchIndex === state.submissions.length - 1;
    const draft = match
      ? latest && match.version === state.version ? query : state.draft
      : queryChanged ? query : state.draft;
    setState({ ...state, query, resultVersion, draft,
      submissions: match ? latest ? [] : state.submissions.slice(matchIndex + 1)
        : queryChanged ? [] : state.submissions,
      completed: latest ? match!.id : null });
  }

  useEffect(() => {
    const moved = (event: Event) => {
      const request = clearing.current;
      const target = event.target;
      if (!request || !(target instanceof Node) || target === document.body) return;
      if (target !== input.current && target !== request.opener && !request.opener?.contains(target)) request.focusOwned = false;
    };
    document.addEventListener("pointerdown", moved, true);
    document.addEventListener("focusin", moved);
    return () => { document.removeEventListener("pointerdown", moved, true); document.removeEventListener("focusin", moved); };
  }, []);
  useLayoutEffect(() => {
    const request = clearing.current;
    if (!request || request.id !== state.completed) return;
    clearing.current = null;
    const active = document.activeElement;
    if (request.focusOwned && (active === document.body || active === request.opener || active === input.current)) input.current?.focus({ preventScroll: true });
  }, [state.completed]);

  function change(value: string) { setState(previous => ({ ...previous, draft: value, version: previous.version + 1 })); }
  function compose(value: boolean) {
    composing.current = value;
    const draft = input.current?.value;
    setState(previous => ({ ...previous, composing: value, draft: draft ?? previous.draft, version: previous.version + 1 }));
  }
  function submit(event: React.FormEvent) {
    if (composing.current || candidateEnter.current) { event.preventDefault(); return; }
    clearing.current = null;
    const query = normalized(input.current?.value ?? state.draft);
    setState(previous => ({ ...previous, submissions: [...previous.submissions.slice(-7), { id: Symbol("search"), query, version: previous.version }] }));
  }
  function clear(opener: HTMLAnchorElement | null) {
    if (composing.current) return false;
    const id = Symbol("clear-search");
    clearing.current = { id, opener, focusOwned: true };
    setState(previous => ({ ...previous, submissions: [...previous.submissions.slice(-7), { id, query: "", version: previous.version }] }));
    return true;
  }
  return <Context.Provider value={{ state, input, returnSessionId, change, compose, submit, clear,
    markKey(event) { if (event.key === "Enter" || event.nativeEvent.keyCode === 229) candidateEnter.current = composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229; },
    releaseKey() { candidateEnter.current = false; },
  }}>{children}</Context.Provider>;
}

export function PeopleDirectoryClearSearch({ icon = false }: { icon?: boolean }) {
  const t = useT();
  const search = useContext(Context);
  const opener = useRef<HTMLAnchorElement>(null);
  return <Link ref={opener} aria-label={icon ? t("清除人物搜索") : undefined}
    className={icon ? styles.clearSearch : undefined} href={withReturnSession("/workspace/people", search?.returnSessionId ?? null)}
    onNavigate={event => { if (search && !search.clear(opener.current)) event.preventDefault(); }} prefetch={false} scroll={false}>
    {icon ? <X aria-hidden="true" size={16} /> : t("清除搜索")}
  </Link>;
}

function SearchSubmit({ composing }: { composing: boolean }) {
  const t = useT();
  // Next's App Form schedules its router transition in this submit event;
  // React DOM provides the real host-form pending state to this descendant.
  const { pending } = useFormStatus();
  return <span className={styles.searchSubmit}>
    <Button aria-label={pending ? t("正在搜索人物…") : t("搜索人物")} aria-busy={pending} disabled={composing} variant="ghost" size="icon" type="submit">
      {pending ? <CircleNotch aria-hidden="true" className={styles.searchProgress} size={17} /> : <ArrowRight aria-hidden="true" size={15} />}
    </Button>
    <span className="sr-only" role="status">{pending ? t("正在搜索人物…") : ""}</span>
  </span>;
}

function SearchForm({ resultsId }: { resultsId?: string }) {
  const t = useT();
  const { state, input: inputRef, submit, markKey, releaseKey, change, compose, returnSessionId } = useContext(Context)!;
  return <Form action="/workspace/people" className={styles.search} data-filter-active={state.query ? true : undefined}
    onSubmit={submit} onKeyDown={markKey} onKeyUp={releaseKey} onPointerDown={releaseKey} scroll={false}>
    <MagnifyingGlass aria-hidden="true" size={20} />
    <input ref={inputRef} aria-label={t("按姓名或已确认联系方式搜索人物")} aria-describedby={resultsId}
      value={state.draft} maxLength={160} name="query" placeholder={t("按姓名、邮箱或电话查找…")} type="search"
      onChange={event => change(event.target.value)} onCompositionStart={() => compose(true)} onCompositionEnd={() => compose(false)} />
    {returnSessionId ? <input name="session" type="hidden" value={returnSessionId} /> : null}
    {state.query ? <PeopleDirectoryClearSearch icon /> : null}
    <SearchSubmit composing={state.composing} />
  </Form>;
}

export function PeopleDirectorySearch({ query, returnSessionId, resultsId }: {
  query: string; returnSessionId: string | null; resultsId?: string;
}) {
  const search = useContext(Context);
  return search ? <SearchForm resultsId={resultsId} /> : <PeopleDirectorySearchProvider query={query} returnSessionId={returnSessionId}><SearchForm resultsId={resultsId} /></PeopleDirectorySearchProvider>;
}
