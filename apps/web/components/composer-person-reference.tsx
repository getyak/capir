"use client";

import { Check } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SidebarPerson } from "@/lib/workspace-sidebar";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import styles from "./workspace-composer.module.css";

/** Directory-only preview: no Memory fetch, identity binding or model request. */
export function ComposerPersonReference({ person, disabled = false }: { person: SidebarPerson; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  function stay() { if (closeTimer.current) clearTimeout(closeTimer.current); }
  function leave() { stay(); closeTimer.current = setTimeout(() => setOpen(false), 180); }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  return <Popover open={open && !disabled} onOpenChange={setOpen}>
    <PopoverTrigger asChild disabled={disabled}>
      <button ref={trigger} type="button" className={styles.reference} aria-label={`查看 ${person.label} 的引用信息`}
        onClick={event => { if (event.detail > 0 && hovered.current) { event.preventDefault(); stay(); setOpen(true); } }}
        onPointerEnter={event => { if (event.pointerType === "mouse") { hovered.current = true; stay(); setOpen(true); } }}
        onPointerLeave={event => { if (event.pointerType === "mouse") { hovered.current = false; leave(); } }}>
        <PersonDirectoryAvatar id={person.id} label={person.label} url={person.avatarUrl} size={22} />
        <span>@{person.label}</span><Check size={14} weight="bold" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent ref={panel} side="top" className={styles.referencePreview} aria-label={`${person.label} 的简要资料`}
      onPointerEnter={stay} onPointerLeave={event => { if (event.pointerType === "mouse") leave(); }}
      onOpenAutoFocus={event => event.preventDefault()}
      onCloseAutoFocus={event => { event.preventDefault(); if (panel.current?.contains(document.activeElement)) trigger.current?.focus(); }}>
      <div className={styles.referenceIdentity}><PersonDirectoryAvatar id={person.id} label={person.label} url={person.avatarUrl} size={36} />
        <strong>{person.label}</strong></div>
      <p>{person.contexts.length ? person.contexts.map(context => context.label).join(" · ") : "暂无关系情境"}</p>
      <small>已加入文字引用；不会自动绑定身份或读取人物记忆。</small>
      <Link href={`/workspace/people/${encodeURIComponent(person.id)}`}>查看人物档案</Link>
    </PopoverContent>
  </Popover>;
}
