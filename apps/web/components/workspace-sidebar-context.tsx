"use client";

import { usePathname } from "next/navigation";

import { isWorkspaceHomePath, workspacePathMatches } from "@/lib/workspace-navigation";
import { WorkspaceRecentSessions } from "./workspace-recent-sessions";
import { WorkspaceSidebarCalendar } from "./workspace-sidebar-calendar";
import { WorkspaceSidebarPeople } from "./workspace-sidebar-people";

/** The middle column selects objects for the current entry, never a second store. */
export function WorkspaceSidebarContext({
  binding,
  storageScope,
}: {
  binding: string | null;
  storageScope: string | null;
}) {
  const pathname = usePathname();
  if (!binding) return null;
  if (workspacePathMatches(pathname, "/workspace/people")) {
    return <WorkspaceSidebarPeople key={binding} binding={binding} />;
  }
  if (workspacePathMatches(pathname, "/workspace/meetings")) {
    return <WorkspaceSidebarCalendar key={binding} binding={binding} />;
  }
  if (isWorkspaceHomePath(pathname) || workspacePathMatches(pathname, "/workspace/sessions")) {
    return <WorkspaceRecentSessions binding={binding} storageScope={storageScope} />;
  }
  return null;
}
