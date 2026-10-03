"use client";

import {
  CalendarBlank,
  ChatCircleDots,
  ClockCounterClockwise,
  House,
  Plus,
  LinkSimple,
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
  WORKSPACE_RAIL_CONTROLS,
  WORKSPACE_RAIL_PREFERENCE_EVENT,
  type WorkspaceNavRoute,
  type WorkspaceRailControlId,
  workspaceCaptureIntent,
  workspaceRailRoute,
  workspaceRailSelection,
} from "@/lib/workspace-navigation";
import { recentSessionRows } from "@/lib/workspace-recent-sessions";

import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { WorkspaceGlobalSearchDialog, useWorkspaceDirectory } from "./workspace-search";
import styles from "./workspace-shell.module.css";

/**
 * Compact shared sidebar (settled GET-129): 248px expanded / 72px collapsed.
 *
 * The expanded rail is one horizontal row of five controls — today,
 * conversation, people, meetings, scoped global search. The selected control
 * is a 74x36 pill with its label; the others stay 36x36 icons. Route identity
 * and hrefs live in `@/lib/workspace-navigation`; this file owns only
 * presentation. Generic icons use existing Phosphor components — the earlier
 * component map's `app/icon.tsx` match for "icon" is a false positive
 * (Next.js favicon route), never an icon source.
 */

/** Presentation labels for the compact rail; registry labels stay canonical. */
const RAIL_LABELS: Record<WorkspaceRailControlId, string> = {
  today: "今日",
  conversation: "对话",
  people: "人物",
  meetings: "时间",
  search: "搜索人物或对话",
};

const RAIL_ICONS: Record<Exclude<WorkspaceRailControlId, "search">, Icon> = {
  today: House,
  conversation: ChatCircleDots,
  people: Users,
  meetings: CalendarBlank,
};

const mobileSnapshot = () => window.matchMedia("(max-width: 760px)").matches;
const mobileSubscribe = (notify: () => void) => {const query = window.matchMedia("(max-width: 760px)"); query.addEventListener("change",notify); return () => query.removeEventListener("change",notify);};

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

function RailControl({
  control,
  current,
  route,
}: {
  control: Exclude<WorkspaceRailControlId, "search">;
  current: boolean;
  route: WorkspaceNavRoute;
}) {
  const router = useRouter();
  const mobile = useSyncExternalStore(mobileSubscribe,mobileSnapshot,() => false);
  const isNew = mobile && control === "conversation";
  const label = isNew ? "新对话" : RAIL_LABELS[control];
  const NavigationIcon = isNew ? Plus : RAIL_ICONS[control];
  return (
    <Link
      aria-current={current ? "page" : undefined}
      aria-label={label}
      className={styles.railControl}
      data-mobile={route.mobile ? "true" : "false"}
      data-selected={current ? "true" : undefined}
      href={route.href}
      key={route.id}
      title={label}
      onClick={event => {
        if (!isNew || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        const unhandled = window.dispatchEvent(new Event(WORKSPACE_NEW_CONVERSATION_EVENT,{cancelable:true}));
        if (unhandled) router.push(`/workspace?draft_session=${crypto.randomUUID()}`);
      }}
    >
      <NavigationIcon
        aria-hidden="true"
        className={styles.navIcon}
        size={18}
        weight={current ? "fill" : "regular"}
      />
      <span className={styles.railControlLabel}>{label}</span>
    </Link>
  );
}

/**
 * Recent Session avatar shortcuts for the collapsed rail. Rows come from the
 * account-scoped directory projection in server order — exact Session ids,
 * never an implicit personal ranking.
 */
function RailSessionShortcuts({ binding }: { binding: string | null }) {
  const pathname = usePathname();
  const { data, loading, failed } = useWorkspaceDirectory(binding, true);
  const rows =
    binding && data ? recentSessionRows(data.sessions, binding) : null;
  if (!binding || !rows || loading || failed || !rows.length) return null;
  return (
    <div aria-label="最近对话快捷方式" className={styles.railSessions}>
      {rows.slice(0, 5).map((row) => (
        <Link
          aria-current={pathname === `/workspace/sessions/${row.id}` ? "page" : undefined}
          aria-label={row.title}
          className={styles.railSessionAvatar}
          href={`/workspace/sessions/${row.id}`}
          key={row.id}
          title={row.title}
        >
          {row.personId ? (
            <PersonDirectoryAvatar
              className={styles.avatar}
              dataSize="small"
              id={row.personId}
              label={row.personLabel || row.title}
            />
          ) : (
            /* Sessions without a person reuse the brand mark; no fixture faces. */
            <span aria-hidden="true" className={styles.sessionMark} />
          )}
        </Link>
      ))}
    </div>
  );
}

export function WorkspaceShellNav({
  binding,
}: {
  binding: string | null;
}) {
  const pathname = usePathname();
  const { collapsed, setCollapsed } = useCollapsedState();
  const selection = workspaceRailSelection(pathname);

  return (
    <div
      className={styles.sidebarState}
      data-collapsed={collapsed}
    >
      <div className={styles.brandRow}>
        <Link
          aria-label="capri 工作台"
          className={styles.brand}
          href="/workspace"
        >
          <span aria-hidden="true" className={styles.brandMark} />
          <span className={styles.brandName}>capri</span>
        </Link>
        <div className={styles.brandActions}>
          <button
            aria-label="收起侧边栏"
            aria-pressed={false}
            className={styles.iconButton}
            onClick={() => setCollapsed(true)}
            title="收起侧边栏"
            type="button"
          >
            <SidebarSimple aria-hidden="true" size={17} />
          </button>
        </div>
      </div>

      <nav aria-label="工作台导航" className={styles.railRow}>
        {WORKSPACE_RAIL_CONTROLS.map((control) =>
          control === "search" ? (
            <WorkspaceGlobalSearchDialog
              binding={binding}
              key="search"
              label={RAIL_LABELS.search}
              presentation="rail"
            />
          ) : (
            <RailControl
              control={control}
              current={selection === control}
              key={control}
              route={workspaceRailRoute(control)!}
            />
          ),
        )}
      </nav>

      {/* Collapsed 72px rail: Session avatar shortcuts plus the lower utility
          group (search, people, collapse, connections). It stays in the DOM so
          the destinations remain reachable links in every state; CSS owns the
          collapsed/expanded swap. */}
      <div className={styles.railCollapsed} data-collapsed-only="true">
        <div className={styles.railCollapsedTop}>
          <Link aria-label="今日" className={styles.railIconLink} href="/workspace/today" title="今日">
            <House aria-hidden="true" size={18} />
          </Link>
          <Link aria-label="打开对话记录" className={styles.railIconLink} href="/workspace/sessions" title="对话记录">
            <ClockCounterClockwise aria-hidden="true" size={18} />
          </Link>
          <Link aria-label="时间" className={styles.railIconLink} href="/workspace/meetings" title="时间">
            <CalendarBlank aria-hidden="true" size={18} />
          </Link>
        </div>
        <RailSessionShortcuts binding={binding} />
        <div className={styles.railUtility}>
          <WorkspaceGlobalSearchDialog
            binding={binding}
            label={RAIL_LABELS.search}
            presentation="rail"
          />
          <Link aria-label="人物" className={styles.railIconLink} href="/workspace/people" title="人物">
            <Users aria-hidden="true" size={18} />
          </Link>
          <button
            aria-label="展开侧边栏"
            aria-pressed
            className={styles.iconButton}
            onClick={() => setCollapsed(false)}
            title="展开侧边栏"
            type="button"
          >
            <SidebarSimple aria-hidden="true" size={17} />
          </button>
          <Link
            aria-label="连接应用（打开扩展工作区；不会自动连接任何服务）"
            className={styles.railIconLink}
            href="/workspace/extensions"
            title="连接应用"
          >
            <LinkSimple aria-hidden="true" size={18} />
          </Link>
        </div>
      </div>
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
