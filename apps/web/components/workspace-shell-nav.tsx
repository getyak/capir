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
import { useContext, useLayoutEffect, useRef, useSyncExternalStore, type MouseEvent } from "react";

import {
  WORKSPACE_COMPOSE_HREF,
  WORKSPACE_FOCUS_AGENT_EVENT,
  WORKSPACE_NEW_CONVERSATION_EVENT,
  WORKSPACE_NAV_ROUTES,
  WORKSPACE_RAIL_CONTROLS,
  type WorkspaceNavRoute,
  type WorkspaceRailControlId,
  workspaceCaptureIntent,
  workspaceRailRoute,
  workspaceRailSelection,
} from "@/lib/workspace-navigation";
import { recentSessionRows } from "@/lib/workspace-recent-sessions";
import { organizeSessionRows, useSessionOrganization } from "@/lib/workspace-session-organization";
import { useWorkspaceSidebarLayout, WorkspaceSidebarPresentation } from "@/lib/workspace-sidebar-layout";

import { WorkspaceSessionAvatar } from "./workspace-session-avatar";
import { useT } from "./locale-provider";
import { useWorkspaceNavigationHref } from "./workspace-navigation-continuity";
import { useWorkspaceBrowse, type WorkspaceBrowseSection } from "./workspace-browse";
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

/** Presentation label keys for the compact rail; registry labels stay canonical. */
const RAIL_LABEL_KEYS: Record<Exclude<WorkspaceRailControlId, "search">, string> = {
  today: "今日",
  conversation: "nav.rail.conversation",
  people: "nav.rail.people",
  meetings: "时间",
};

const RAIL_SEARCH_KEY = "nav.rail.search";

const RAIL_ICONS: Record<Exclude<WorkspaceRailControlId, "search">, Icon> = {
  today: House,
  conversation: ChatCircleDots,
  people: Users,
  meetings: CalendarBlank,
};

const mobileSnapshot = () => window.matchMedia("(max-width: 760px)").matches;
const mobileSubscribe = (notify: () => void) => {const query = window.matchMedia("(max-width: 760px)"); query.addEventListener("change",notify); return () => query.removeEventListener("change",notify);};

function RailControl({
  control,
  current,
  route,
  compact = false,
  onBrowse,
}: {
  control: Exclude<WorkspaceRailControlId, "search">;
  current: boolean;
  route: WorkspaceNavRoute;
  compact?: boolean;
  onBrowse?: (control: WorkspaceBrowseSection) => void;
}) {
  const router = useRouter();
  const t = useT();
  const browse = useWorkspaceBrowse();
  const mobile = useSyncExternalStore(mobileSubscribe,mobileSnapshot,() => false);
  const rememberedRouteHref = useWorkspaceNavigationHref(route.href);
  const rememberedHref = !mobile && browse ? browse.href(route.href) : rememberedRouteHref;
  const isNew = !compact && mobile && control === "conversation";
  const label = t(isNew ? "conversation.new" : RAIL_LABEL_KEYS[control]);
  const NavigationIcon = isNew ? Plus : RAIL_ICONS[control];
  return (
    <Link
      aria-current={current ? !mobile && browse?.enabled ? "location" : "page" : undefined}
      aria-controls={!mobile && browse?.enabled ? "workspace-sidebar-browser" : undefined}
      aria-label={label}
      className={compact ? styles.railIconLink : styles.railControl}
      data-mobile={route.mobile ? "true" : "false"}
      data-selected={current ? "true" : undefined}
      data-browse-section={control}
      href={isNew ? route.href : rememberedHref}
      prefetch={false}
      key={route.id}
      title={label}
      onClick={event => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        if (!mobile && browse?.enabled) {
          event.preventDefault();
          browse.select(control);
          onBrowse?.(control);
          return;
        }
        if (!isNew) return;
        event.preventDefault();
        const unhandled = window.dispatchEvent(new Event(WORKSPACE_NEW_CONVERSATION_EVENT,{cancelable:true}));
        if (unhandled) router.push(`/workspace?draft_session=${crypto.randomUUID()}&intent=compose`);
      }}
    >
      <NavigationIcon
        aria-hidden="true"
        className={styles.navIcon}
        size={18}
        weight={current ? "fill" : "regular"}
      />
      {!compact && <span className={styles.railControlLabel}>{label}</span>}
    </Link>
  );
}

/**
 * Recent Session avatar shortcuts for the collapsed rail. Rows come from the
 * account-scoped directory projection in server order — exact Session ids,
 * never an implicit personal ranking.
 */
function RailSessionShortcuts({ binding, storageScope }: { binding: string | null; storageScope: string | null }) {
  const t = useT();
  const pathname = usePathname();
  const { data, loading, failed } = useWorkspaceDirectory(binding, true);
  const { snapshot } = useSessionOrganization(storageScope);
  const projected = binding && data ? recentSessionRows(data.sessions, binding, undefined, 200) : null;
  const rows = projected ? organizeSessionRows(projected, snapshot.entries).visible : null;
  if (!binding || !rows || loading || failed || !rows.length) return null;
  return (
    <div aria-label={t("nav.sessions.shortcut")} className={styles.railSessions}>
      {rows.slice(0, 5).map((row) => (
        <Link
          aria-current={pathname === `/workspace/sessions/${row.id}` ? "page" : undefined}
          aria-label={row.unread ? t("{title}（未读）", { title: row.title }) : row.title}
          className={styles.railSessionAvatar}
          href={`/workspace/sessions/${row.id}`}
          key={row.id}
          title={row.unread ? t("{title}（未读）", { title: row.title }) : row.title}
        >
          <WorkspaceSessionAvatar personId={row.personId} label={row.personLabel || row.title} />
          {row.unread && <span aria-hidden="true" className={styles.railSessionUnread} />}
        </Link>
      ))}
    </div>
  );
}

export function WorkspaceShellNav({
  binding,
  storageScope = null,
}: {
  binding: string | null;
  /** The same account/user-stable scope used by the expanded Session list. */
  storageScope?: string | null;
}) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const { layout, setLayout } = useWorkspaceSidebarLayout();
  const presentation = useContext(WorkspaceSidebarPresentation) ?? layout;
  const collapsed = presentation.collapsed;
  const setCollapsed = (next: boolean) => setLayout({ ...layout, collapsed: next, hidden: false });
  const browse = useWorkspaceBrowse();
  const mobile = useSyncExternalStore(mobileSubscribe, mobileSnapshot, () => false);
  const selection = !mobile && browse?.enabled ? browse.selection : workspaceRailSelection(pathname);
  const collapseToggle = useRef<HTMLButtonElement>(null);
  const expandToggle = useRef<HTMLButtonElement>(null);
  const primaryNav = useRef<HTMLElement>(null);
  const pendingBrowseFocus = useRef<WorkspaceBrowseSection | null>(null);

  useLayoutEffect(() => {
    if (!collapsed && pendingBrowseFocus.current) {
      primaryNav.current?.querySelector<HTMLAnchorElement>(`[data-browse-section="${pendingBrowseFocus.current}"]`)?.focus({ preventScroll: true });
      pendingBrowseFocus.current = null;
      return;
    }
    const hidden = collapsed ? collapseToggle.current : expandToggle.current;
    if (document.activeElement === hidden) {
      (collapsed ? expandToggle.current : collapseToggle.current)?.focus();
    }
  }, [collapsed]);

  function startNewConversation() {
    const unhandled = window.dispatchEvent(new Event(WORKSPACE_NEW_CONVERSATION_EVENT, { cancelable: true }));
    if (unhandled) router.push(`/workspace?draft_session=${crypto.randomUUID()}&intent=compose`);
  }

  return (
    <div
      className={styles.sidebarState}
      data-collapsed={collapsed}
    >
      <div className={styles.brandRow}>
        <Link
          aria-label={t("capri 工作台")}
          className={styles.brand}
          href="/workspace"
        >
          <span aria-hidden="true" className={styles.brandMark} />
          <span className={styles.brandName}>capri</span>
        </Link>
        <div className={styles.brandActions}>
          <button
            aria-label={t("nav.collapse")}
            aria-pressed={false}
            className={styles.iconButton}
            onClick={() => setCollapsed(true)}
            ref={collapseToggle}
            title={t("nav.collapse")}
            type="button"
          >
            <SidebarSimple aria-hidden="true" size={17} />
          </button>
        </div>
      </div>

      <nav aria-label={t("nav.label")} className={styles.railRow} ref={primaryNav}>
        {WORKSPACE_RAIL_CONTROLS.map((control) =>
          control === "search" ? (
            <WorkspaceGlobalSearchDialog
              binding={binding}
              key="search"
              label={t(RAIL_SEARCH_KEY)}
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

      {/* Both presentations share the primary destination order. Compose and
          recent conversations follow it; lower utilities stay at the end.
          The collapsed rail stays in the DOM so
          the destinations remain reachable links in every state; CSS owns the
          collapsed/expanded swap. */}
      <nav aria-label={t("nav.labelCollapsed")} className={styles.railCollapsed} data-collapsed-only="true">
        <div className={styles.railCollapsedTop}>
          {WORKSPACE_RAIL_CONTROLS.map(control => control === "search" ? (
            <WorkspaceGlobalSearchDialog binding={binding} key={control} label={t(RAIL_SEARCH_KEY)} presentation="rail" />
          ) : (
            <RailControl compact control={control} current={selection === control} key={control} route={workspaceRailRoute(control)!} onBrowse={section => { pendingBrowseFocus.current = section; setCollapsed(false); }} />
          ))}
        </div>
        <div className={styles.railCollapsedTop}>
          <button aria-label={t("conversation.startNew")} className={styles.iconButton} onClick={startNewConversation} title={t("conversation.startNew")} type="button">
            <Plus aria-hidden="true" size={18} />
          </button>
        </div>
        <RailSessionShortcuts binding={binding} storageScope={storageScope} />
        <div className={styles.railUtility}>
          <Link aria-label={t("nav.openSessions")} className={styles.railIconLink} href="/workspace/sessions" title={t("nav.sessionsTitle")}>
            <ClockCounterClockwise aria-hidden="true" size={18} />
          </Link>
          <button
            aria-label={t("nav.expand")}
            aria-pressed
            className={styles.iconButton}
            onClick={() => setCollapsed(false)}
            ref={expandToggle}
            title={t("nav.expand")}
            type="button"
          >
            <SidebarSimple aria-hidden="true" size={17} />
          </button>
          <Link
            aria-label={t("nav.extensionsHint")}
            className={styles.railIconLink}
            href="/workspace/extensions"
            aria-current={WORKSPACE_NAV_ROUTES.find(route => route.id === "plugs")?.matches(pathname) ? "page" : undefined}
            title={t("nav.extensionsTitle")}
          >
            <LinkSimple aria-hidden="true" size={18} />
          </Link>
        </div>
      </nav>
    </div>
  );
}

export function WorkspaceCaptureLink() {
  const pathname = usePathname();
  const t = useT();

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
      aria-label={t("nav.capture")}
      className={styles.navLink}
      href={WORKSPACE_COMPOSE_HREF}
      onClick={focusAgent}
    >
      <ChatCircleDots aria-hidden="true" size={17} />
      <span>{t("nav.captureLabel")}</span>
    </Link>
  );
}

export function WorkspaceMobileSourcesLink() {
  const t = useT();
  return (
    <>
      <Link
        aria-label={t("nav.openSessions")}
        className={styles.mobileSources}
        href="/workspace/sessions"
        title={t("nav.sessionsTitle")}
      >
        <ClockCounterClockwise aria-hidden="true" size={18} />
        <span>{t("nav.sessions.mobileLabel")}</span>
      </Link>
      <Link
        aria-label={t("nav.openExtensions")}
        className={styles.mobileSources}
        href="/workspace/extensions"
        title={t("扩展")}
      >
        <Plugs aria-hidden="true" size={18} />
        <span>{t("扩展")}</span>
      </Link>
    </>
  );
}

/** Shared route inventory for tests and the route header. */
export const WORKSPACE_SHELL_ROUTES = WORKSPACE_NAV_ROUTES;
