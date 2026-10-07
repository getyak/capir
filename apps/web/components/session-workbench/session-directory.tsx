"use client";

import {
  ArrowRight,
  ChatCircleDots,
  Plus,
  Spinner,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { workspaceSessionFetch } from "@/components/workspace-session-request";

import {
  directoryStateNotice,
  formatSessionTime,
  isSessionId,
  sessionDisplayTitle,
  type SessionState,
} from "./session-view";
import styles from "./session-directory.module.css";

export type SessionSummary = {
  session_id: string;
  revision: number;
  updated_at: string;
  expires_at: string;
  state: SessionState;
  title: string;
  turn_count: number;
  is_unread: boolean;
  scope_kind: "unresolved_intent" | "relationship" | "identity_review";
  person_label: string;
  context_label: string;
  scope: { kind: string };
};

type Props = {
  renderedAt: string;
  initialSessions: SessionSummary[];
  initialComplete: boolean;
  initialNextCursor: string | null;
  sessionVersion: string | null;
  initialError: string | null;
  sessionRecoveryHref: string | null;
};

export function SessionDirectory({
  renderedAt,
  initialSessions,
  initialComplete,
  initialNextCursor,
  sessionVersion,
  initialError,
  sessionRecoveryHref,
}: Props) {
  const router = useRouter();
  // Hydration must use the server's clock snapshot, including at minute/hour
  // boundaries. Refresh relative labels only after the initial render.
  const [now, setNow] = useState(() => new Date(renderedAt));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [sessions, setSessions] = useState(initialSessions);
  const [complete, setComplete] = useState(initialComplete);
  const [cursor, setCursor] = useState(initialNextCursor);
  const [binding, setBinding] = useState(sessionVersion);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState<"create" | "more" | null>(null);
  const pendingCreate = useRef<{
    sessionId: string;
    updatedAt: string;
  } | null>(null);

  async function createSession() {
    if (!binding || busy) return;
    setBusy("create");
    setError("");
    const attempt =
      pendingCreate.current ??
      (pendingCreate.current = {
        sessionId: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
      });
    try {
      const response = await workspaceSessionFetch("/api/workspace-sessions", {
        body: JSON.stringify({
          session_id: attempt.sessionId,
          updated_at: attempt.updatedAt,
        }),
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-workspace-session": binding,
        },
        method: "POST",
      });
      const payload = (await response.json()) as {
        detail?: { session_id?: string };
        message?: string;
        session_version?: string;
      };
      if (!response.ok) throw new Error(payload.message || "无法新建对话。");
      if (payload.session_version) setBinding(payload.session_version);
      const created = isSessionId(payload.detail?.session_id)
        ? payload.detail.session_id
        : attempt.sessionId;
      pendingCreate.current = null;
      // A new unscoped Session has no turn and no model work; restoration is
      // the only next step, so navigate straight to it.
      router.push(`/workspace/sessions/${encodeURIComponent(created)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法新建对话。");
      setBusy(null);
    }
  }

  async function loadMore() {
    if (!cursor || busy) return;
    setBusy("more");
    setError("");
    try {
      const response = await workspaceSessionFetch(
        `/api/workspace-sessions?cursor=${encodeURIComponent(cursor)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        sessions?: SessionSummary[];
        complete?: boolean;
        next_cursor?: string | null;
        session_version?: string;
        message?: string;
      };
      if (!response.ok || !Array.isArray(payload.sessions)) {
        throw new Error(payload.message || "无法加载更多对话。");
      }
      setSessions((current) => {
        const seen = new Set(current.map((item) => item.session_id));
        return [
          ...current,
          ...payload.sessions!.filter((item) => !seen.has(item.session_id)),
        ];
      });
      setComplete(Boolean(payload.complete));
      setCursor(payload.next_cursor ?? null);
      if (payload.session_version) setBinding(payload.session_version);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法加载更多对话。");
    } finally {
      setBusy(null);
    }
  }

  const notice = directoryStateNotice({
    complete,
    total: sessions.length,
  });

  return (
    <main id="main-content" tabIndex={-1} aria-labelledby="sessions-title" className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title} id="sessions-title">
            对话
          </h1>
          <p className={styles.lede}>
            从上次停下的地方继续。
          </p>
        </div>
        <button
          className={styles.primary}
          disabled={!binding || busy !== null}
          onClick={() => void createSession()}
          type="button"
        >
          {busy === "create" ? (
            <Spinner aria-hidden="true" className={styles.spin} size={16} />
          ) : (
            <Plus aria-hidden="true" size={16} />
          )}
          <span>{busy === "create" ? "正在新建…" : "新建对话"}</span>
        </button>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
          {sessionRecoveryHref ? (
            <>
              {" "}
              <Link href={sessionRecoveryHref}>重新登录</Link>
            </>
          ) : null}
        </p>
      ) : null}

      {sessions.length === 0 ? (
        error ? null : <div className={styles.empty} role="status">
          <ChatCircleDots aria-hidden="true" size={26} weight="light" />
          <h2>{complete ? "每段思路，都可以从这里继续" : "对话还未读取完整"}</h2>
          <p>{complete ? "开始一段新对话，它会留在这里。" : notice}</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {sessions.map((session) => (
            <li key={session.session_id}>
              <Link
                className={styles.row}
                href={`/workspace/sessions/${encodeURIComponent(session.session_id)}`}
              >
                <span aria-hidden="true" className={styles.rowIcon}>
                  <ChatCircleDots size={18} weight="duotone" />
                </span>
                <span className={styles.rowBody}>
                  <span className={styles.rowTitle}>
                    <span className={styles.rowTitleText}>
                      {sessionDisplayTitle(session.title)}
                    </span>
                    {session.is_unread ? (
                      <span className={styles.unread}>未读</span>
                    ) : null}
                  </span>
                  <span className={styles.rowMeta}>
                    {session.scope_kind === "relationship"
                      ? `${session.person_label || "联系人"} · ${session.context_label || "关系情境"}`
                      : session.scope_kind === "identity_review"
                        ? "身份核对"
                        : // The display label is plain; the scope_kind value
                          // ("unresolved_intent") keeps its own semantics.
                          "独立对话"}
                    {" · "}
                    {session.turn_count === 0
                      ? "还没有回复"
                      : `${session.turn_count} 轮`}
                    {" · "}
                    {formatSessionTime(session.updated_at, now)}
                  </span>
                </span>
                <ArrowRight aria-hidden="true" size={16} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!complete ? (
        <div className={styles.moreRow}>
          <p className={styles.hint}>
            {notice ?? "列表尚未载入完整。"}
          </p>
          <button
            className={styles.secondary}
            disabled={busy !== null}
            onClick={() => void loadMore()}
            type="button"
          >
            {busy === "more" ? "正在加载…" : "加载更多"}
          </button>
        </div>
      ) : null}
    </main>
  );
}
