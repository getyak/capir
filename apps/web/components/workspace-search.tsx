"use client";

import {
  ChatCircle,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  searchWorkspaceResults,
  isWorkspaceSearchShortcut,
  type WorkspaceSearchPerson,
  type WorkspaceSearchSession,
} from "@/lib/workspace-search";
import {
  isWorkspaceDirectoryAbort,
  loadWorkspaceDirectory,
  readCachedWorkspaceDirectory,
  subscribeWorkspaceDirectoryInvalidation,
  type WorkspaceDirectorySessionResponse,
  type WorkspaceDirectorySnapshot,
  type WorkspaceDirectoryInvalidationMode,
} from "@/lib/workspace-directory-cache";
import {
  coordinatorScopeIsCurrent,
  subscribeWorkspaceRefresh,
} from "@/lib/workspace-refresh";
import { WORKSPACE_SESSION_EXPIRED_EVENT, workspaceSessionFetch } from "./workspace-session-request";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import styles from "./workspace-shell.module.css";

function cleanLabel(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A directory response is publishable only after both bodies are decoded and
 * the exact credential binding has been verified. Abort also covers body reads. */
export async function readWorkspaceDirectory(
  binding: string,
  signal: AbortSignal,
  request: typeof workspaceSessionFetch = workspaceSessionFetch,
): Promise<WorkspaceDirectorySnapshot | null> {
  const responses = await Promise.all([
    request("/api/local-integration/people", { cache: "no-store", signal }),
    request("/api/workspace-sessions", { cache: "no-store", signal }),
  ]);
  if (signal.aborted) return null;
  if (responses.some(response => !response.ok)) throw new Error("Directory unavailable");
  const [people, sessions] = await Promise.all(responses.map(response => response.json()));
  if (signal.aborted) return null;
  if (!binding || sessions?.session_version !== binding ||
      !Array.isArray(people?.people) || !Array.isArray(sessions?.sessions)) {
    throw new Error("Directory binding unavailable");
  }
  return { people, sessions };
}

export function activeDirectorySessions(payload: WorkspaceDirectorySessionResponse, now = Date.now()): WorkspaceDirectorySessionResponse {
  return { ...payload, sessions: (payload.sessions ?? []).filter(row =>
    row.state === "active" && typeof row.expires_at === "string" && Date.parse(row.expires_at) > now) };
}

/**
 * Disposable, bound data shared by search and the persistent people sidebar.
 *
 * Navigation continuity: the effect re-runs on pathname changes so a failed
 * read recovers on the next navigation, but it paints the account-keyed
 * in-memory snapshot first. A healthy read therefore survives navigation with
 * no reload flash; `pathname` no longer forces a network round trip.
 */
export function useWorkspaceDirectory(binding: string | null, enabled: boolean) {
  const pathname = usePathname();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const forceNextRead = useRef(false);
  const retry = useCallback(() => {
    // A user-requested retry must revalidate, never serve a stale cached value.
    forceNextRead.current = true;
    setRefreshVersion(value => value + 1);
  }, []);
  const [result, setResult] = useState<{ binding: string; data: WorkspaceDirectorySnapshot | null; failed: boolean } | null>(null);
  useEffect(() => {
    // Unbound or disabled surfaces render no directory. The previous binding's
    // state is filtered out below and reused from the cache on re-activation.
    if (!enabled || !binding) return;
    const key = binding;
    let disposed = false;
    let expired = false;
    function publish(data: WorkspaceDirectorySnapshot) {
      if (disposed || expired) return;
      setResult(current =>
        current?.binding === key && current.data === data && !current.failed
          ? current
          : { binding: key, data, failed: false });
    }
    function fail() {
      if (disposed || expired) return;
      setResult(current =>
        current?.binding === key && current.data
          ? { ...current, failed: true }
          : { binding: key, data: null, failed: true });
    }
    function load(force: boolean) {
      if (disposed || expired) return;
      // Paint the authorized snapshot first; revalidation replaces it in place.
      const cached = readCachedWorkspaceDirectory(key);
      if (cached) publish(cached);
      void loadWorkspaceDirectory(
        key,
        async (signal) => {
          const snapshot = await readWorkspaceDirectory(key, signal);
          if (!snapshot) {
            throw Object.assign(new Error("Directory read cancelled"), {
              name: "AbortError",
            });
          }
          return snapshot;
        },
        { force },
      )
        .then(publish)
        .catch((error: unknown) => {
          // An abort means the entry was invalidated. The invalidator either
          // reloads (a successful mutation) or marks the session expired.
          if (isWorkspaceDirectoryAbort(error)) return;
          fail();
        });
    }
    function onInvalidated(
      keys: readonly string[] | null,
      mode: WorkspaceDirectoryInvalidationMode,
    ) {
      if (disposed || expired) return;
      if (!(keys === null || keys.includes(key))) return;
      if (mode === "revalidate") {
        setResult(null);
        load(true);
        return;
      }
      // Discard (scope change, logout, any 401, expiry): fail closed and do not
      // re-read with the same credential. The scope boundary changes the
      // binding or unmounts the reader, so no revival is possible.
      expired = true;
      setResult({ binding: key, data: null, failed: true });
    }
    function onExpired() {
      if (disposed) return;
      expired = true;
      setResult({ binding: key, data: null, failed: true });
    }
    const force = forceNextRead.current;
    forceNextRead.current = false;
    load(force);
    const unsubscribe = subscribeWorkspaceDirectoryInvalidation(onInvalidated);
    // One shared refresh coordinator per binding: foreground, focus, network
    // recovery and a bounded active interval refresh People AND Sessions
    // together; hidden-surface polling pauses and in-flight work coalesces.
    const unsubscribeRefresh = subscribeWorkspaceRefresh(key, (reason, generation) => {
      if (!coordinatorScopeIsCurrent(key, generation)) return;
      load(reason === "interval" ? false : true);
    });
    window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, onExpired);
    return () => {
      disposed = true;
      unsubscribe();
      unsubscribeRefresh();
      window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, onExpired);
    };
  }, [binding, enabled, pathname, refreshVersion]);
  useEffect(() => {
    if (!enabled || result?.binding !== binding || !result?.data) return;
    const expirations = (result.data.sessions.sessions ?? []).map(row =>
      typeof row.expires_at === "string" ? Date.parse(row.expires_at) : NaN).filter(Number.isFinite);
    if (!expirations.length) return;
    const timer = window.setTimeout(() => setResult(current => current?.data && current.binding === binding
      ? { ...current, data: { ...current.data, sessions: activeDirectorySessions(current.data.sessions) } } : current),
    Math.min(2_147_483_647, Math.max(0, Math.min(...expirations) - Date.now())));
    return () => window.clearTimeout(timer);
  }, [result, binding, enabled]);
  const current = enabled && binding && result?.binding === binding ? result : null;
  return { data: current?.data ? { ...current.data, sessions: activeDirectorySessions(current.data.sessions) } : null,
    loading: Boolean(enabled && binding && !current), failed: current?.failed ?? !binding, retry };
}

/** Real account-scoped People directory projection; never a fixture. */
export function useWorkspaceSearchSources(binding: string | null, enabled: boolean) {
  const { data, loading, failed, retry } = useWorkspaceDirectory(binding, enabled);
  const people: WorkspaceSearchPerson[] = (data?.people.people ?? []).flatMap(person => {
    const id = cleanLabel(person.id), label = cleanLabel(person.display_label);
    return id && label ? [{ id, label, detail: cleanLabel(person.contexts?.[0]?.display_label) || "联系人",
      avatarUrl: cleanLabel(person.avatar?.url) || null }] : [];
  });
  const sessions: WorkspaceSearchSession[] = (data?.sessions.sessions ?? []).flatMap(row => {
    const id = cleanLabel(row.session_id), title = cleanLabel(row.title);
    return id && title ? [{ id, title, detail: [cleanLabel(row.person_label), cleanLabel(row.context_label)].filter(Boolean).join(" · ") || "账号专属对话" }] : [];
  });
  return { people, sessions, loading, failed, retry };
}

/**
 * One real global search surface over the authorized People directory and the
 * account's Session directory. It reads existing endpoints, keeps keyboard
 * semantics native and never claims a result the backend did not return.
 */
export function WorkspaceGlobalSearchDialog({
  binding,
  label = "搜索",
  presentation = "icon",
}: {
  binding: string | null;
  label?: string;
  presentation?: "icon" | "field" | "rail";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { people, sessions, loading, failed, retry } = useWorkspaceSearchSources(
    binding,
    open,
  );
  const results = searchWorkspaceResults({ people, sessions, query });

  const show = useCallback(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    setOpen(true);
    element.showModal();
    setQuery("");
    window.requestAnimationFrame(() => input.current?.focus());
  }, []);

  const close = useCallback(() => {
    dialog.current?.close();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (
        !typing &&
        !event.isComposing && isWorkspaceSearchShortcut(event)
      ) {
        // The shell mounts one trigger per breakpoint; only the visible one
        // owns the shortcut, so a hidden modal never opens.
        if (!trigger.current || trigger.current.offsetParent === null) return;
        event.preventDefault();
        show();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [show]);

  const hasQuery = query.normalize("NFKC").trim().length > 0;

  return (
    <>
      <button
        aria-label={label}
        className={
          presentation === "field"
            ? styles.searchTrigger
            : presentation === "rail"
              ? styles.railControl
              : styles.iconButton
        }
        onClick={show}
        ref={trigger}
        title={`${label} · ⌘K / Ctrl+K`}
        type="button"
      >
        <MagnifyingGlass aria-hidden="true" size={17} />
        {presentation === "field" && <><span>搜索人物或对话</span><kbd>⌘K</kbd></>}
      </button>
      <dialog
        aria-label="搜索人物与对话"
        className={styles.searchDialog}
        onClose={() => {
          // Native close events are queued. Ignore an older close if the user
          // has already reopened search, or its authorized directory disappears.
          if (dialog.current?.open) return;
          setOpen(false);
          setQuery("");
          trigger.current?.focus();
        }}
        ref={dialog}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Escape") {
            // A search input's native Escape clears its text before cancelling
            // the dialog. The visible shortcut promises one step back.
            event.preventDefault();
            close();
            return;
          }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const links = Array.from(dialog.current?.querySelectorAll<HTMLAnchorElement>("[data-search-result]") ?? []);
          if (!links.length) return;
          const index = links.indexOf(document.activeElement as HTMLAnchorElement);
          if (document.activeElement !== input.current && index < 0) return;
          event.preventDefault();
          const next = index < 0 ? (event.key === "ArrowDown" ? 0 : links.length - 1)
            : (index + (event.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
          links[next]?.focus();
          links[next]?.scrollIntoView({ block: "nearest" });
        }}
      >
        <div className={styles.searchDialogHeader}>
          <MagnifyingGlass aria-hidden="true" size={17} />
          <input
            aria-label="搜索人物与对话"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索人物与对话"
            ref={input}
            type="search"
            value={query}
          />
          <button
            aria-label="关闭搜索"
            className={`${styles.iconButton} ${styles.searchClose}`}
            onClick={close}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <div className={styles.searchResults}>
          {!hasQuery ? (
            <p className={styles.searchEmpty}>
              输入姓名、机构或对话标题。
            </p>
          ) : loading ? (
            <p className={styles.searchEmpty} role="status">
              正在读取当前账号的目录…
            </p>
          ) : failed ? (
            <div className={styles.searchEmpty} role="alert">
              <p>暂时无法读取人物与对话。请重试，已保存的内容不会丢失。</p>
              <button className={styles.searchRetry} onClick={retry} type="button">重新载入</button>
            </div>
          ) : results.total === 0 ? (
            <p className={styles.searchEmpty} role="status">没有找到“{query.trim()}”。试试姓名的一部分或机构名称。</p>
          ) : (
            <>
              {results.people.length ? (
                <>
                  <p className={styles.searchSection}>人物</p>
                  {results.people.map((person) => (
                    <Link
                      className={styles.searchResult}
                      data-search-result=""
                      href={`/workspace/people/${encodeURIComponent(person.id)}`}
                      key={person.id}
                      onClick={close}
                    >
                      <PersonDirectoryAvatar id={person.id} label={person.label} url={person.avatarUrl} className={styles.avatar} dataSize="row" />
                      <span>
                        <strong>{person.label}</strong>
                        <small>{person.detail}</small>
                      </span>
                    </Link>
                  ))}
                </>
              ) : null}
              {results.sessions.length ? (
                <>
                  <p className={styles.searchSection}>对话</p>
                  {results.sessions.map((session) => (
                    <Link
                      className={styles.searchResult}
                      data-search-result=""
                      href={`/workspace/sessions/${encodeURIComponent(session.id)}`}
                      key={session.id}
                      onClick={close}
                    >
                      <ChatCircle aria-hidden="true" size={17} />
                      <span>
                        <strong>{session.title}</strong>
                        <small>{session.detail}</small>
                      </span>
                    </Link>
                  ))}
                </>
              ) : null}
            </>
          )}
        </div>
        <p className={styles.searchHint}>↑ ↓ 选择 · Enter 打开 · Esc 关闭</p>
      </dialog>
    </>
  );
}
