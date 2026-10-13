"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createWorkspaceNavigationMemory, rememberedWorkspaceNavigationHref } from "@/lib/workspace-navigation-continuity";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";

type NavigationContextValue = {
  snapshot: ReturnType<ReturnType<typeof createWorkspaceNavigationMemory>["getSnapshot"]>;
  remember: (href: string) => void;
};
const NavigationContext = createContext<NavigationContextValue | null>(null);
const EMPTY = { hrefs: {} };
const ignoreHref = () => {};

export function WorkspaceNavigationContinuityProvider({ scope, children }: { scope: string | null; children?: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const location = `${pathname}${search ? `?${search}` : ""}`;
  const memory = useMemo(() => createWorkspaceNavigationMemory(scope), [scope]);
  const snapshot = useSyncExternalStore(memory.subscribe, memory.getSnapshot, () => EMPTY);
  const lastObservedLocation = useRef<string | null>(null);
  useEffect(() => {
    // Only deliberate URL changes update memory. A context rerender must not
    // overwrite a visible committed search that has not been submitted yet.
    // Keeping this observation across scope changes also prevents the new
    // account from inheriting the previous account's current locator.
    if (lastObservedLocation.current === location) return;
    lastObservedLocation.current = location;
    memory.remember(location);
  }, [location, memory]);
  useEffect(() => {
    const expire = () => memory.expire();
    window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
  }, [memory]);
  const value = useMemo(() => ({ snapshot, remember: memory.remember }), [snapshot, memory]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useWorkspaceNavigationHref(href: string): string {
  const value = useContext(NavigationContext);
  return value ? rememberedWorkspaceNavigationHref(value.snapshot, href) : href;
}

/** People commits only completed IME input through this vetted setter. */
export function useRememberWorkspaceNavigationHref(): (href: string) => void {
  return useContext(NavigationContext)?.remember ?? ignoreHref;
}
