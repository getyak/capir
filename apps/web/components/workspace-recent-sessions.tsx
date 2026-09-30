"use client";

import { CaretRight, ClockCounterClockwise } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";

import {
  recentSessionRows,
} from "@/lib/workspace-recent-sessions";
import { useWorkspaceDirectory } from "./workspace-search";
import styles from "./workspace-shell.module.css";

/** A disposable directory projection, never a second Session store. */
export function WorkspaceRecentSessions({ binding }: { binding: string }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const { data, loading, failed, retry } = useWorkspaceDirectory(binding, true);
  const rows = data ? recentSessionRows(data.sessions, binding) : null;
  const current = !loading && !failed && rows
    ? { rows, state: "ready" as const }
    : failed ? { rows: [], state: "error" as const } : null;

  return (
    <section aria-label="最近对话" className={styles.group}>
      {current?.state === "ready" && !current.rows.length ? (
        <Link aria-label="打开对话记录" className={styles.historyHeader} data-empty="true" href="/workspace/sessions">
          <ClockCounterClockwise aria-hidden="true" size={16} />
          <span>对话记录</span>
          <CaretRight aria-hidden="true" size={12} />
        </Link>
      ) : (
        <button
          aria-controls={listId}
          aria-expanded={expanded}
          className={`${styles.groupTitle} ${styles.historyDisclosure}`}
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <span>最近对话</span>
          <CaretRight aria-hidden="true" className={styles.personCaret} size={12} />
        </button>
      )}
      <div hidden={!expanded} id={listId}>
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
                    <span
                      aria-hidden="true"
                      className={styles.sessionDot}
                      data-unread={row.unread ? "true" : "false"}
                    />
                    <span>{row.title}</span>
                    {row.unread ? <small>未读</small> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null
        ) : current?.state === "error" ? null : (
          <div aria-label="正在读取对话" role="status"><div aria-hidden="true" className={styles.historySkeleton} /></div>
        )}
        {current?.state === "ready" && !current.rows.length ? null : (
          <Link aria-label="打开对话记录" className={styles.historyAll} href="/workspace/sessions">
            查看全部对话
          </Link>
        )}
      </div>
      {current?.state === "error" ? (
        <p className={styles.historyRecovery}>暂时无法读取<button onClick={retry} type="button">重试</button></p>
      ) : null}
    </section>
  );
}
