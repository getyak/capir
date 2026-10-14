"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { backendSessionRecoveryHref } from "@/lib/backend-session";
import { createPersonEntryCallback } from "@/lib/workspace-create-entry";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function currentEntry() {
  return window.location.pathname === "/workspace"
    ? createPersonEntryCallback(window.location.search) : null;
}

const serverEntry = () => null;

/** Layouts cannot read searchParams. Recover only the bounded draft locator after hydration. */
export function WorkspaceReauthenticationLink({ children }: { children: ReactNode }) {
  const callback = useSyncExternalStore(subscribe, currentEntry, serverEntry);
  return <Link href={callback ? backendSessionRecoveryHref(callback) : "/login?reason=backend_session_expired"}>
    {children}
  </Link>;
}
