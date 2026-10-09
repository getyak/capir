"use client";

import { CaretRight, ClockCounterClockwise, Plus, PushPin } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  WORKSPACE_NEW_CONVERSATION_EVENT,
} from "@/lib/workspace-navigation";
import {
  recentSessionRows,
} from "@/lib/workspace-recent-sessions";
import {
  organizeSessionRows,
  useSessionOrganization,
} from "@/lib/workspace-session-organization";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { useWorkspaceDirectory } from "./workspace-search";
import { WorkspaceListRow, useArrivalRegistry } from "./workspace-list-motion";
import {
  WorkspaceSelectionHighlight,
  WorkspaceSelectionScope,
} from "./workspace-selection-highlight";
import {
  WorkspaceSessionRow,
  type SessionRowOrganization,
} from "./workspace-session-row";
import styles from "./workspace-shell.module.css";

/** A disposable directory projection, never a second Session store. */
export function WorkspaceRecentSessions({
  binding,
  storageScope = null,
}: {
  binding: string;
  /** Stable account/user storage scope for local list organization. */
  storageScope?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const listId = useId();
  const archiveId = useId();
  const { data, loading, failed, retry } = useWorkspaceDirectory(binding, true);
  const { snapshot, setFlag } = useSessionOrganization(storageScope);
  const projected = data ? recentSessionRows(data.sessions, binding, undefined, 200) : null;
  const organized = projected
    ? organizeSessionRows(projected, snapshot.entries)
    : null;
  const current = !loading && !failed && organized
    ? { rows: { visible: organized.visible.slice(0, 8), archived: organized.archived.slice(0, 8) }, state: "ready" as const }
    : failed ? { rows: { visible: [], archived: [] }, state: "error" as const } : null;
  const visibleRows = current?.state === "ready" ? current.rows.visible : [];
  const archivedRows = current?.state === "ready" ? current.rows.archived : [];
  const arrival = useArrivalRegistry(projected?.map((row) => row.id) ?? [], current?.state === "ready");
  const empty = current?.state === "ready" && !current.rows.visible.length &&
    !current.rows.archived.length;

  function organizationFor(row: { id: string; title: string }): SessionRowOrganization {
    const entry = snapshot.entries[row.id];
    return {
      archived: entry?.archived ?? false,
      pinned: entry?.pinned ?? false,
      onToggle: (flag, value) => setFlag(row.id, flag, value),
      rowLabel: row.title,
    };
  }

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
        {empty ? (
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
      {snapshot.pendingInMemory ? (
        <p className={styles.orgNotice} role="status">
          本机存储不可用 · 归档与置顶仅在本页保留
        </p>
      ) : null}
      <div hidden={!expanded} id={listId}>
        {current?.state === "ready" ? (
          visibleRows.length ? (
            <WorkspaceSelectionScope>
              <ul className={styles.rowList}>
                {visibleRows.map((row) => (
                  <WorkspaceListRow arrival={arrival.isArrival(row.id)} key={row.id}>
                    <WorkspaceSessionRow organization={organizationFor(row)}>
                      <Link
                        aria-current={
                          pathname === `/workspace/sessions/${row.id}`
                            ? "page"
                            : undefined
                        }
                        aria-label={snapshot.entries[row.id]?.pinned
                          ? `${row.title}（已置顶）`
                          : undefined}
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
                        {snapshot.entries[row.id]?.pinned ? (
                          <small>
                            <PushPin aria-hidden="true" size={10} weight="fill" />
                            置顶
                          </small>
                        ) : null}
                        {row.unread ? <small>未读</small> : null}
                        <WorkspaceSelectionHighlight
                          selected={pathname === `/workspace/sessions/${row.id}`}
                        />
                      </Link>
                    </WorkspaceSessionRow>
                  </WorkspaceListRow>
                ))}
              </ul>
            </WorkspaceSelectionScope>
          ) : null
        ) : current?.state === "error" ? null : (
          <div aria-label="正在读取对话" role="status"><div aria-hidden="true" className={styles.historySkeleton} /></div>
        )}
        {current?.state === "ready" && !current.rows.visible.length ? null : (
          <Link aria-label="打开对话记录" className={styles.historyAll} href="/workspace/sessions">
            查看全部对话
          </Link>
        )}
        {archivedRows.length ? (
          <div className={styles.archivedGroup}>
            <button
              aria-controls={archiveId}
              aria-expanded={archiveExpanded}
              className={`${styles.groupTitle} ${styles.historyDisclosure}`}
              onClick={() => setArchiveExpanded((value) => !value)}
              type="button"
            >
              <span>已归档 · 本机整理（{archivedRows.length}）</span>
              <CaretRight aria-hidden="true" className={styles.personCaret} size={12} />
            </button>
            <div hidden={!archiveExpanded} id={archiveId}>
              <ul className={styles.rowList}>
                {archivedRows.map((row) => (
                  <li key={row.id}>
                    <WorkspaceSessionRow organization={organizationFor(row)}>
                      <Link
                        className={styles.sessionRow}
                        data-archived="true"
                        href={`/workspace/sessions/${row.id}`}
                        title={row.title}
                      >
                        {row.personId ? (
                          <PersonDirectoryAvatar className={styles.avatar} dataSize="small" id={row.personId} label={row.personLabel || row.title} />
                        ) : (
                          <span aria-hidden="true" className={styles.sessionMark} />
                        )}
                        <span className={styles.sessionTitle}>{row.title}</span>
                      </Link>
                    </WorkspaceSessionRow>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
      {current?.state === "error" ? (
        <p className={styles.historyRecovery}>暂时无法读取<button onClick={retry} type="button">重试</button></p>
      ) : null}
    </section>
  );
}
