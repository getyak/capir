"use client";

import { CaretRight, ClockCounterClockwise } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  recentSessionRows,
} from "@/lib/workspace-recent-sessions";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { useWorkspaceDirectory } from "./workspace-search";
import styles from "./workspace-shell.module.css";

/** A disposable directory projection, never a second Session store. */
export function WorkspaceRecentSessions({ binding }: { binding: string }) {
  const pathname = usePathname();
  const { data, loading, failed, retry } = useWorkspaceDirectory(binding, true);
  const rows = data ? recentSessionRows(data.sessions, binding) : null;
  const current = !loading && !failed && rows
    ? { rows, state: "ready" as const }
    : failed ? { rows: [], state: "error" as const } : null;

  return (
    <section aria-label="最近对话" className={styles.group}>
      <Link aria-label="打开对话记录" className={styles.historyHeader} data-empty={current?.state === "ready" && !current.rows.length ? "true" : "false"} href="/workspace/sessions">
        {current?.state === "ready" && !current.rows.length ? <ClockCounterClockwise aria-hidden="true" size={16} /> : null}
        <span>{current?.state === "ready" && !current.rows.length ? "对话记录" : "最近对话"}</span>
        <CaretRight aria-hidden="true" size={12} />
      </Link>
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
