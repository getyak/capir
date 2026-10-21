"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createWorkspaceNavigationMemory, createWorkspaceSourceFocusMemory, rememberedWorkspaceNavigationHref } from "@/lib/workspace-navigation-continuity";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";

type NavigationContextValue = {
  snapshot: ReturnType<ReturnType<typeof createWorkspaceNavigationMemory>["getSnapshot"]>;
  remember: (href: string) => void;
  location: string;
  sourceFocus: ReturnType<typeof createWorkspaceSourceFocusMemory>;
};
const NavigationContext = createContext<NavigationContextValue | null>(null);
const EMPTY = { hrefs: {} };
const ignoreHref = () => {};

export function WorkspaceNavigationContinuityProvider({ scope, binding = null, children }: { scope: string | null; binding?: string | null; children?: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const location = `${pathname}${search ? `?${search}` : ""}`;
  const memory = useMemo(() => createWorkspaceNavigationMemory(scope), [scope]);
  const sourceFocus = useMemo(() => createWorkspaceSourceFocusMemory(scope, binding), [scope, binding]);
  useLayoutEffect(() => () => sourceFocus.clear(), [sourceFocus]);
  useLayoutEffect(() => { sourceFocus.observe(location); }, [sourceFocus, location]);
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
    const expire = () => { memory.expire(); sourceFocus.expire(); };
    const cancel = () => sourceFocus.clear();
    const navigation = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || link.target && link.target !== "_self") return;
      let target: URL;
      try { target = new URL(link.href); } catch { return; }
      if (target.origin === window.location.origin && target.href !== window.location.href) cancel();
    };
    window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
    window.addEventListener("popstate", cancel);
    document.addEventListener("click", navigation, true);
    return () => { window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire); window.removeEventListener("popstate", cancel); document.removeEventListener("click", navigation, true); };
  }, [memory, sourceFocus]);
  const value = useMemo(() => ({ snapshot, remember: memory.remember, sourceFocus, location }), [snapshot, memory, sourceFocus, location]);
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

export function useRequestSessionSourceFocus() {
  const value = useContext(NavigationContext);
  return (binding: string | null, sessionId: string) => value?.sourceFocus.request(binding, sessionId, `${window.location.pathname}${window.location.search}${window.location.hash}`);
}

/** Only a final authorized Session surface calls this; loading placeholders do not. */
export function useSessionSourceFocus(target: RefObject<HTMLElement | null>, binding: string | null, sessionId: string, ready: boolean) {
  const value = useContext(NavigationContext), sourceFocus = value?.sourceFocus, location = value?.location;
  useEffect(() => {
    if (!sourceFocus || !ready) return;
    const href = `/workspace/sessions/${encodeURIComponent(sessionId)}`;
    const id = sourceFocus.peek(binding, href);
    if (id === null || location !== href) return;
    const timer = window.setTimeout(() => {
      const actual = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (!sourceFocus.consume(id, binding, actual)) return;
      const heading = target.current;
      if (!heading?.isConnected || !heading.getClientRects().length || getComputedStyle(heading).visibility === "hidden") return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement && active.getClientRects().length && getComputedStyle(active).visibility !== "hidden") return;
      heading.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sourceFocus, location, target, binding, sessionId, ready]);
}
