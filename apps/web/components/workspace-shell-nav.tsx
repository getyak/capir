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
import { usePathname, useRouter } from "next/navigation";
import { useSyncExternalStore, type MouseEvent } from "react";

import {
  WORKSPACE_COMPOSE_HREF,
  WORKSPACE_FOCUS_AGENT_EVENT,
  WORKSPACE_NEW_CONVERSATION_EVENT,
  WORKSPACE_NAV_ROUTES,
  WORKSPACE_RAIL_COLLAPSED_KEY,
  WORKSPACE_RAIL_PREFERENCE_EVENT,
  type WorkspaceNavRoute,
  type WorkspaceNavRouteId,
  workspaceCaptureIntent,
  workspaceNavRouteForPath,
  workspaceNavRoutes,
} from "@/lib/workspace-navigation";

import { WorkspaceGlobalSearchDialog } from "./workspace-search";
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

const COLLAPSED_KEY = WORKSPACE_RAIL_COLLAPSED_KEY;
const COLLAPSED_EVENT = WORKSPACE_RAIL_PREFERENCE_EVENT;
let collapsedFallback = false;

function collapsedSnapshot() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return collapsedFallback;
  }
}

function subscribeToCollapsedPreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(COLLAPSED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(COLLAPSED_EVENT, onChange);
  };
}

function useCollapsedState() {
  const collapsed = useSyncExternalStore(
    subscribeToCollapsedPreference,
    collapsedSnapshot,
    () => false,
  );
  return {
    collapsed,
    setCollapsed(next: boolean) {
      collapsedFallback = next;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, String(next));
      } catch {
        // Keep this interaction usable when browser storage is unavailable.
      }
      window.dispatchEvent(new Event(COLLAPSED_EVENT));
    },
  };
}

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
  const router = useRouter();
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
              if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              const unhandled = window.dispatchEvent(new Event(WORKSPACE_NEW_CONVERSATION_EVENT, { cancelable: true }));
              event.preventDefault();
              // A Session route may have no mounted Home reset listener. New
              // must bypass retained draft locators using a fresh server id.
              // https://nextjs.org/docs/app/api-reference/functions/use-router
              if (unhandled) router.push(`/workspace?draft_session=${crypto.randomUUID()}`);
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
  const activeRoute = workspaceNavRouteForPath(pathname);
  // Desktop primary order: new conversation, Today, People, Meetings, Sources.
  // The mobile filter keeps only the first four (`mobile: true`).
  const primary = workspaceNavRoutes("primary");
  // The Sessions directory is already reachable from the recent-Sessions header
  // while the rail is expanded. A collapsed rail hides that scroll area, so the
  // same destination keeps one named icon link here instead of a duplicate row.
  const collapsedUtility = workspaceNavRoutes("utility");

  return (
    <div
      className={styles.sidebarState}
      data-collapsed={collapsed}
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
          {collapsed && <WorkspaceGlobalSearchDialog binding={binding} />}
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

      {!collapsed && <WorkspaceGlobalSearchDialog binding={binding} presentation="field"/>}
      <nav aria-label="工作台导航" className={styles.nav}>
        <div className={styles.navGroup}>
          {primary.map((route) => (
            <NavLink
              collapsed={collapsed}
              current={activeRoute?.id === route.id}
              key={route.id}
              route={route}
            />
          ))}
        </div>
        {collapsed ? (
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
