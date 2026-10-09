"use client";

import {
  CalendarBlank,
  ChatCircleDots,
  ClockCounterClockwise,
  Database,
  House,
  Plus,
  Plugs,
  SidebarSimple,
  Users,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type MouseEvent } from "react";

import {
  WORKSPACE_COMPOSE_HREF,
  WORKSPACE_FOCUS_AGENT_EVENT,
  WORKSPACE_NEW_CONVERSATION_EVENT,
  WORKSPACE_NAV_ROUTES,
  type WorkspaceNavRoute,
  type WorkspaceNavRouteId,
  workspaceCaptureIntent,
  workspaceNavRouteForPath,
  workspaceNavRoutes,
} from "@/lib/workspace-navigation";
import { useCollapsedState, useRailReveal } from "@/lib/workspace-rail-preference";

import { WorkspaceGlobalSearchDialog } from "./workspace-search";
import {
  WorkspaceSelectionHighlight,
  WorkspaceSelectionScope,
} from "./workspace-selection-highlight";
import styles from "./workspace-shell.module.css";

/** Presentation-only icon per route; route identity/hrefs live in the lib. */
const NAV_ICONS: Record<WorkspaceNavRouteId, Icon> = {
  home: Plus,
  people: Users,
  meetings: CalendarBlank,
  plugs: Plugs,
  today: House,
  sessions: ClockCounterClockwise,
  captures: Database,
};

function NavLink({
  collapsed,
  current,
  nested = false,
  route,
}: {
  collapsed: boolean;
  current: boolean;
  nested?: boolean;
  route: WorkspaceNavRoute;
}) {
  const NavigationIcon = NAV_ICONS[route.id];
  return (
    <Link
      aria-current={current ? "page" : undefined}
      aria-label={collapsed ? route.label : undefined}
      className={styles.navLink}
      data-mobile={route.mobile ? "true" : "false"}
      data-nested={nested ? "true" : undefined}
      data-primary-action={route.id === "home" ? "true" : undefined}
      href={route.href}
      key={route.id}
      onClick={
        route.id === "home"
          ? (event) => {
              if (event.defaultPrevented) return;
              const unhandled = window.dispatchEvent(new Event(WORKSPACE_NEW_CONVERSATION_EVENT, { cancelable: true }));
              if (!unhandled) event.preventDefault();
            }
          : undefined
      }
      title={collapsed ? route.label : undefined}
    >
      <NavigationIcon
        aria-hidden="true"
        className={styles.navIcon}
        size={17}
        weight={current && route.id !== "home" ? "fill" : "regular"}
      />
      <span>{route.label}</span>
      <WorkspaceSelectionHighlight selected={current} />
    </Link>
  );
}

export function WorkspaceShellNav({
  binding,
}: {
  binding: string | null;
}) {
  const pathname = usePathname();
  const { collapsed, setCollapsed } = useCollapsedState();
  // The floating edge-hover reveal shows the expanded labels without touching
  // the persisted collapse preference.
  const { revealed } = useRailReveal();
  const railCollapsed = collapsed && !revealed;
  const activeRoute = workspaceNavRouteForPath(pathname);
  // Desktop primary order: new conversation, Today, People, Meetings, Sources.
  // The mobile filter keeps only the first four (`mobile: true`).
  const primary = workspaceNavRoutes("primary");
  // The Sessions directory is already reachable from the recent-Sessions header
  // while the rail is expanded. A collapsed rail hides that scroll area, so the
  // same destination (and Sources intake) keeps one named icon link here
  // instead of duplicate rows.
  const collapsedUtility = [
    ...workspaceNavRoutes("utility"),
    ...workspaceNavRoutes("account"),
  ];

  return (
    <div
      className={styles.sidebarState}
      data-collapsed={railCollapsed}
    >
      <div className={styles.brandRow}>
        <Link
          aria-label="Talent Signal 工作台"
          className={styles.brand}
          href="/workspace"
        >
          <span aria-hidden="true" className={styles.brandMark} />
          <span className={styles.brandName}>Talent Signal</span>
        </Link>
        <div className={styles.brandActions}>
          <WorkspaceGlobalSearchDialog binding={binding} />
          <button
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-pressed={collapsed}
            className={styles.iconButton}
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            type="button"
          >
            <SidebarSimple aria-hidden="true" size={17} />
          </button>
        </div>
      </div>

      <nav aria-label="工作台导航" className={styles.nav}>
        <WorkspaceSelectionScope>
          <div className={styles.navGroup}>
            {primary.map((route) => (
              <NavLink
                collapsed={railCollapsed}
                current={activeRoute?.id === route.id}
                key={route.id}
                route={route}
              />
            ))}
          </div>
        {railCollapsed ? (
          <div className={styles.navGroup} data-collapsed-only="true">
            {collapsedUtility.map((route) => (
              <NavLink
                collapsed
                current={activeRoute?.id === route.id}
                key={`utility-${route.id}`}
                route={route}
              />
            ))}
          </div>
        ) : null}
        </WorkspaceSelectionScope>
      </nav>
    </div>
  );
}

export function WorkspaceCaptureLink() {
  const pathname = usePathname();

  function focusAgent(event: MouseEvent<HTMLAnchorElement>) {
    const intent = workspaceCaptureIntent(pathname, window.location.search);
    if (!intent.intercept) {
      return;
    }
    event.preventDefault();
    window.history.pushState(null, "", intent.href);
    window.dispatchEvent(new Event(WORKSPACE_FOCUS_AGENT_EVENT));
  }

  return (
    <Link
      aria-label="在当前关系情境中继续对话"
      className={styles.navLink}
      href={WORKSPACE_COMPOSE_HREF}
      onClick={focusAgent}
    >
      <ChatCircleDots aria-hidden="true" size={17} />
      <span>围绕此人对话</span>
    </Link>
  );
}

export function WorkspaceMobileSourcesLink() {
  return (
    <>
      <Link
        aria-label="打开对话记录"
        className={styles.mobileSources}
        href="/workspace/sessions"
        title="对话记录"
      >
        <ClockCounterClockwise aria-hidden="true" size={18} />
        <span>对话</span>
      </Link>
      <Link
        aria-label="打开扩展"
        className={styles.mobileSources}
        href="/workspace/extensions"
        title="扩展"
      >
        <Plugs aria-hidden="true" size={18} />
        <span>扩展</span>
      </Link>
    </>
  );
}

/** Shared route inventory for tests and the route header. */
export const WORKSPACE_SHELL_ROUTES = WORKSPACE_NAV_ROUTES;
