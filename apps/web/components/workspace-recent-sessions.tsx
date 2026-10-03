"use client";

import { CaretRight, ClockCounterClockwise, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  WORKSPACE_NEW_CONVERSATION_EVENT,
} from "@/lib/workspace-navigation";
import {
  recentSessionRows,
} from "@/lib/workspace-recent-sessions";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { useWorkspaceDirectory } from "./workspace-search";
import styles from "./workspace-shell.module.css";

/** A disposable directory projection, never a second Session store. */
export function WorkspaceRecentSessions({ binding }: { binding: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data, loading, failed, retry } = useWorkspaceDirectory(binding, true);
  const rows = data ? recentSessionRows(data.sessions, binding) : null;
  const current = !loading && !failed && rows
    ? { rows, state: "ready" as const }
    : failed ? { rows: [], state: "error" as const } : null;

  // Same flow as the former rail control: a mounted Home canvas resets to a
  // fresh conversation in place; otherwise a fresh server id bypasses retained
  // draft locators. https://nextjs.org/docs/app/api-reference/functions/use-router
  function startNewConversation() {
    const unhandled = window.dispatchEvent(
      new Event(WORKSPACE_NEW_CONVERSATION_EVENT, { cancelable: true }),
    );
    if (unhandled) router.push(`/workspace?draft_session=${crypto.randomUUID()}`);
  }

  return (
    <section aria-label="最近对话" className={styles.group}>
      <div className={styles.historyBar}>
        <Link aria-label="打开对话记录" className={styles.historyHeader} data-empty={current?.state === "ready" && !current.rows.length ? "true" : "false"} href="/workspace/sessions">
          {current?.state === "ready" && !current.rows.length ? <ClockCounterClockwise aria-hidden="true" size={16} /> : null}
          <span>{current?.state === "ready" && !current.rows.length ? "对话记录" : "最近对话"}</span>
          <CaretRight aria-hidden="true" size={12} />
        </Link>
        <button
          aria-label="开始新对话"
          className={styles.newConversation}
          onClick={startNewConversation}
          title="开始新对话"
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          <span>新对话</span>
        </button>
      </div>
      {current?.state === "ready" ? (
        current.rows.length ? (
          <ul className={styles.rowList}>
            {current.rows.map((row) => (
              <li key={row.id}>
                <Link
                  aria-current={
                    pathname === `/workspace/sessions/${row.id}`
                      ? "page"
                      : undefined
                  }
                  className={styles.sessionRow}
                  href={`/workspace/sessions/${row.id}`}
                  title={row.title}
                >
                  {row.personId ? (
                    <PersonDirectoryAvatar className={styles.avatar} dataSize="small" id={row.personId} label={row.personLabel || row.title} />
                  ) : (
                    /* Sessions without a person reuse the brand mark; no fixture faces. */
                    <span aria-hidden="true" className={styles.sessionMark} />
                  )}
                  <span className={styles.sessionTitle}>{row.title}</span>
                  {row.unread ? <small>未读</small> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null
      ) : current?.state === "error" ? (
        <p className={styles.historyRecovery}>暂时无法读取<button onClick={retry} type="button">重试</button></p>
      ) : (
        <div aria-label="正在读取对话" role="status"><div aria-hidden="true" className={styles.historySkeleton} /></div>
      )}
    </section>
  );
}
