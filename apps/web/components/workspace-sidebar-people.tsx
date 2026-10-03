"use client";
import { ArrowSquareOut } from "@phosphor-icons/react";
import Link from "next/link";
import { sidebarPeopleFromDirectory } from "@/lib/workspace-sidebar";
import { useWorkspaceDirectory } from "./workspace-search";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { usePersonContextPanel } from "./person-context-panel";
import styles from "./workspace-shell.module.css";

/** Exact directory IDs open a read-only preview; no automatic context binding. */
export function WorkspaceSidebarPeople({binding}: {binding: string | null}) {
  const {data, loading, failed, retry} = useWorkspaceDirectory(binding, true);
  const {open, selectedId} = usePersonContextPanel();
  const people = sidebarPeopleFromDirectory(data?.people, 2);
  if (!loading && !failed && people.length === 0) return null;
  return <section aria-label="相关人物" className={styles.group}>
    <header className={styles.groupTitle}><span>相关人物</span><Link aria-label="查看全部人物" href="/workspace/people"><ArrowSquareOut size={13} aria-hidden="true"/></Link></header>
    {loading ? <p className={styles.groupEmpty}>正在读取…</p> : failed ? <p className={styles.historyRecovery}>人物暂时无法读取<button onClick={retry}>重试</button></p> :
      <div className={styles.personChips}>{people.map(person => <button key={person.id} className={styles.personChip} aria-label={`查看 ${person.label} 的人物背景`} aria-pressed={selectedId === person.id}
        onClick={event => open(person.id,event.currentTarget)} title={person.label}>
        <PersonDirectoryAvatar id={person.id} label={person.label} url={person.avatarUrl} size={22}/><span>{person.label}</span>
      </button>)}</div>}
  </section>;
}
