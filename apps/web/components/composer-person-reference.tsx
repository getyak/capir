"use client";

import { Check } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SidebarPerson } from "@/lib/workspace-sidebar";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useT } from "./locale-provider";
import styles from "./workspace-composer.module.css";

/** Directory-only preview: no Memory fetch, identity binding or model request. */
export function ComposerPersonReference({ person, disabled = false }: { person: SidebarPerson; disabled?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false);
  const restoreFocus = useRef(false);
  function stay() { if (closeTimer.current) clearTimeout(closeTimer.current); }
  function leave() { stay(); closeTimer.current = setTimeout(() => setOpen(false), 180); }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  return <Popover open={open && !disabled} onOpenChange={setOpen}>
    <PopoverTrigger asChild disabled={disabled}>
      <button type="button" className={styles.reference} aria-label={t("composer.reference.view", { person: person.label })}
        onClick={event => {
          if (event.detail === 0) hovered.current = false;
          else if (hovered.current) { event.preventDefault(); stay(); setOpen(true); }
        }}
        onPointerEnter={event => { if (event.pointerType === "mouse") { hovered.current = true; stay(); setOpen(true); } }}
        onPointerLeave={event => { if (event.pointerType === "mouse") { hovered.current = false; leave(); } }}>
        <PersonDirectoryAvatar id={person.id} label={person.label} url={person.avatarUrl} size={22} />
        <span>@{person.label}</span><Check size={14} weight="bold" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" className={styles.referencePreview} aria-label={t("composer.reference.preview", { person: person.label })}
      onPointerEnter={stay} onPointerLeave={event => { if (event.pointerType === "mouse") leave(); }}
      onOpenAutoFocus={event => { restoreFocus.current = !hovered.current; if (!restoreFocus.current) event.preventDefault(); }}
      onCloseAutoFocus={event => { if (!restoreFocus.current) event.preventDefault(); }}>
      <div className={styles.referenceIdentity}><PersonDirectoryAvatar id={person.id} label={person.label} url={person.avatarUrl} size={36} />
        <strong>{person.label}</strong></div>
      <p>{person.contexts.length ? person.contexts.map(context => context.label).join(" · ") : t("暂无关系情境")}</p>
      <small>{t("已加入文字引用；不会自动绑定身份或读取人物记忆。")}</small>
      <Link href={`/workspace/people/${encodeURIComponent(person.id)}`}>{t("查看人物档案")}</Link>
    </PopoverContent>
  </Popover>;
}
