"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

import { isWorkspaceHomePath, workspacePathMatches } from "@/lib/workspace-navigation";
import { WorkspaceRecentSessions } from "./workspace-recent-sessions";
import { WorkspaceSidebarCalendar } from "./workspace-sidebar-calendar";
import { WorkspaceSidebarPeople } from "./workspace-sidebar-people";
import { useWorkspaceBrowse } from "./workspace-browse";
import styles from "./workspace-shell.module.css";
import directoryStyles from "./workspace-sidebar-people.module.css";

/** The middle column selects objects for the current entry, never a second store. */
export function WorkspaceSidebarContext({
  binding,
  storageScope,
}: {
  binding: string | null;
  storageScope: string | null;
}) {
  const pathname = usePathname();
  const browse = useWorkspaceBrowse();
  if (!binding) return null;
  if (browse) {
    return <div id="workspace-sidebar-browser" className={styles.browsePanels} key={binding}>
      {browse.enabled ? browse.visited.map(section => (
        <div className={styles.browsePanel} key={section} hidden={browse.selection !== section}>
          {section === "people" ? <WorkspaceSidebarPeople binding={binding} browseHref={browse.href("/workspace/people")} /> :
            section === "meetings" ? <WorkspaceSidebarCalendar binding={binding} browseHref={browse.href("/workspace/meetings")} /> :
              section === "conversation" ? <WorkspaceRecentSessions binding={binding} storageScope={storageScope} /> :
                <section aria-label="今日导航" className={directoryStyles.directory}>
                  <h2 className={directoryStyles.heading}>今日</h2>
                  <Link className={directoryStyles.person} href="/workspace/today" prefetch={false}>查看今日</Link>
                </section>}
        </div>
      )) : null}
    </div>;
  }
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
