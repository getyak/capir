"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { workspaceRailSelection, type WorkspaceRailControlId } from "@/lib/workspace-navigation";
import { createWorkspaceNavigationMemory, rememberedWorkspaceNavigationHref } from "@/lib/workspace-navigation-continuity";
import { subscribeWorkspaceDirectoryInvalidation } from "@/lib/workspace-directory-cache";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";

export type WorkspaceBrowseSection = Exclude<WorkspaceRailControlId, "search">;
type BrowseState = {
  selection: WorkspaceBrowseSection;
  visited: readonly WorkspaceBrowseSection[];
  enabled: boolean;
};
type BrowseContextValue = BrowseState & {
  select: (section: WorkspaceBrowseSection) => void;
  href: (canonical: string) => string;
  remember: (href: string) => void;
};
const BrowseContext = createContext<BrowseContextValue | null>(null);
const EMPTY = { hrefs: {} };

/** Mount with the authenticated scope as its key; no private state is persisted. */
export function WorkspaceBrowseProvider({ scope, binding, children }: { scope: string | null; binding?: string | null; children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  // Seed once from an admitted deep link. Later work-route changes cannot move
  // the left browser's filter, calendar scope or selection.
  const [memory] = useState(() => {
    const value = createWorkspaceNavigationMemory(scope);
    value.remember(`${pathname}${search ? `?${search}` : ""}`);
    return value;
  });
  const snapshot = useSyncExternalStore(memory.subscribe, memory.getSnapshot, () => EMPTY);
  const [state, setState] = useState<BrowseState>(() => {
    const selection = workspaceRailSelection(pathname) ?? "conversation";
    return { selection, visited: [selection], enabled: true };
  });
  useEffect(() => {
    const expire = () => {
      memory.expire();
      setState({ selection: "conversation", visited: [], enabled: false });
    };
    window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
    const unsubscribe = subscribeWorkspaceDirectoryInvalidation((keys, mode) => {
      if (mode === "discard" && (keys === null || binding && keys.includes(binding))) expire();
    });
    return () => {
      window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
      unsubscribe();
    };
  }, [memory, binding]);
  const value: BrowseContextValue = {
    ...state,
    href: canonical => rememberedWorkspaceNavigationHref(snapshot, canonical),
    remember: memory.remember,
    select(section) {
      setState(current => current.enabled ? {
        ...current, selection: section,
        visited: current.visited.includes(section) ? current.visited : [...current.visited, section],
      } : current);
    },
  };
  return <BrowseContext.Provider value={scope ? value : null}>{children}</BrowseContext.Provider>;
}

export function useWorkspaceBrowse() {
  return useContext(BrowseContext);
}
