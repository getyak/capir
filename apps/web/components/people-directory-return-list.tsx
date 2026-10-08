"use client";

import { useEffect, useRef, type ReactNode } from "react";
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
    const target = document.getElementById(hash);
    // Next's active scroll handler handles the fragment position but leaves
    // focus untouched. Restore only this list's named return, once per route
    // entry, without overriding a control the user has already focused.
    if (target instanceof HTMLAnchorElement && list.current?.contains(target)) {
      target.focus({ preventScroll: true });
    }
  }, [pathname]);

  return <ol ref={list} className={className} aria-label="联系人列表">{children}</ol>;
}
