"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { personDirectoryEntryId } from "./people-directory-navigation";

export function PeopleDirectoryReturnList({ children, className }: {
  children: ReactNode;
  className: string;
}) {
  const list = useRef<HTMLOListElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/workspace/people") return;
    const hash = window.location.hash.slice(1);
    const entryId = personDirectoryEntryId(hash.slice("person-".length));
    if (hash !== entryId || document.activeElement !== document.body) return;
    const target = list.current?.querySelector<HTMLAnchorElement>(`a[id="${entryId}"]`);
    // Next's active scroll handler handles the fragment position but leaves
    // focus untouched. Restore only this list's named return, once per route
    // entry, without overriding a control the user has already focused.
    if (target instanceof HTMLAnchorElement) {
      target.focus({ preventScroll: true });
    }
  }, [pathname]);

  function rememberEntry(event: MouseEvent<HTMLOListElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target.closest("a") : null;
    if (!(target instanceof HTMLAnchorElement) || !event.currentTarget.contains(target)) return;
    const id = target.id;
    if (personDirectoryEntryId(id.slice("person-".length)) !== id) return;
    const current = new URL(window.location.href);
    const destination = new URL(target.href);
    if (current.pathname !== "/workspace/people" || destination.origin !== current.origin
      || destination.pathname !== `/workspace/people/${id.slice("person-".length)}`) return;
    current.hash = id;
    // Name the existing history entry without creating a new Back step or
    // discarding Next's history state. A restricted host still navigates.
    try { window.history.replaceState(window.history.state, "", current.href); } catch { /* Explicit return remains available. */ }
  }

  return <ol ref={list} className={className} aria-label="联系人列表" onClickCapture={rememberEntry}>{children}</ol>;
}
