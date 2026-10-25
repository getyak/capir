"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createWorkspaceNavigationMemory, rememberedWorkspaceNavigationHref } from "@/lib/workspace-navigation-continuity";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
import { subscribeWorkspaceDirectoryInvalidation } from "@/lib/workspace-directory-cache";

type NavigationContextValue = {
  snapshot: ReturnType<ReturnType<typeof createWorkspaceNavigationMemory>["getSnapshot"]>;
  remember: (href: string) => void;
  composerViews: Pick<ReturnType<typeof createWorkspaceNavigationMemory>, "rememberComposerView" | "readComposerView" | "forgetComposerView">;
};
const NavigationContext = createContext<NavigationContextValue | null>(null);
const EMPTY = { hrefs: {} };
const ignoreHref = () => {};

export function WorkspaceNavigationContinuityProvider({ scope, binding = null, children }: { scope: string | null; binding?: string | null; children?: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const location = `${pathname}${search ? `?${search}` : ""}`;
  const memory = useMemo(() => createWorkspaceNavigationMemory(scope), [scope]);
  const activeBinding = useRef(binding);
  useLayoutEffect(() => { activeBinding.current = binding; }, [binding]);
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
    const unsubscribe = subscribeWorkspaceDirectoryInvalidation((keys, mode) => {
      if (mode === "discard" && (keys === null || activeBinding.current && keys.includes(activeBinding.current))) expire();
    });
    return () => { window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire); unsubscribe(); };
  }, [memory]);
  const value = useMemo(() => ({ snapshot, remember: memory.remember, composerViews: memory }), [snapshot, memory]);
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

export function useWorkspaceComposerViewMemory() {
  return useContext(NavigationContext)?.composerViews ?? null;
}
