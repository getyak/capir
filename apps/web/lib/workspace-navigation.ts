/**
 * Pure route registry for the persistent workspace shell.
 *
 * Route identity, canonical hrefs, mobile placement and active-path matching
 * live here so the desktop rail, the compact mobile tab bar and the route
 * header read one authoritative inventory. This module is intentionally free
 * of React, Next.js and DOM concerns so it stays cheap to unit test and safe
 * to import from any runtime.
 *
 * The desktop rail prioritizes conversation, Today, People, Meetings and
 * Extensions. Source intake remains reachable from Extensions and source links.
 * The mobile dock retains four retrieval routes; its header owns Extensions.
 */

export type WorkspaceNavRouteId =
  | "home"
  | "people"
  | "meetings"
  | "plugs"
  | "today"
  | "sessions"
  | "captures";

export type WorkspaceNavSection = "primary" | "utility" | "account";

export type WorkspaceNavRoute = {
  readonly id: WorkspaceNavRouteId;
  /** Canonical link target. */
  readonly href: string;
  /** Visible label; also the collapsed-rail tooltip. */
  readonly label: string;
  /** Visual group in the sidebar. */
  readonly section: WorkspaceNavSection;
  /** Rendered in the compact mobile tab bar as well as the desktop rail. */
  readonly mobile: boolean;
  /** Path predicate used to derive `aria-current="page"`. */
  readonly matches: (pathname: string) => boolean;
};

/** Matches a base path exactly, or any nested path beneath it. */
export function workspacePathMatches(
  pathname: string | null | undefined,
  basePath: string,
): boolean {
  if (typeof pathname !== "string") return false;
  if (pathname === basePath) return true;
  const normalize = (value: string) =>
    value.endsWith("/") && value !== "/" ? value.slice(0, -1) : value;
  const normalizedPathname = normalize(pathname);
  const normalizedBase = normalize(basePath);
  return (
    normalizedPathname === normalizedBase ||
    normalizedPathname.startsWith(`${normalizedBase}/`)
  );
}

/** The unscoped conversation canvas is the default entry point. */
export function isWorkspaceHomePath(pathname: string | null | undefined): boolean {
  return pathname === "/workspace" || pathname === "/workspace/";
}

/**
 * Ordered navigation inventory. Primary order is the desktop rail order and
 * the mobile filter; Today owns Pursuit detail routes, which stay visible as
 * the active section even though they are not separate rail rows.
 */
export const WORKSPACE_NAV_ROUTES: readonly WorkspaceNavRoute[] = [
  {
    id: "home",
    href: "/workspace",
    label: "新对话",
    section: "primary",
    mobile: true,
    matches: (pathname) => isWorkspaceHomePath(pathname),
  },
  {
    id: "today",
    href: "/workspace/today",
    label: "今日",
    section: "primary",
    mobile: true,
    matches: (pathname) =>
      workspacePathMatches(pathname, "/workspace/today") ||
      workspacePathMatches(pathname, "/workspace/pursuits"),
  },
  {
    id: "people",
    href: "/workspace/people",
    label: "人物",
    section: "primary",
    mobile: true,
    matches: (pathname) => workspacePathMatches(pathname, "/workspace/people"),
  },
  {
    id: "meetings",
    href: "/workspace/meetings",
    label: "时间",
    section: "primary",
    mobile: true,
    matches: (pathname) => workspacePathMatches(pathname, "/workspace/meetings"),
  },
  {
    id: "captures",
    href: "/workspace/captures",
    label: "来源",
    section: "account",
    mobile: false,
    matches: (pathname) => workspacePathMatches(pathname, "/workspace/captures"),
  },
  {
    id: "sessions",
    href: "/workspace/sessions",
    label: "对话记录",
    // Rendered as one named icon link only while the rail is collapsed; the
    // recent-Sessions header owns the expanded entry so the route is never
    // duplicated or unreachable.
    section: "utility",
    mobile: false,
    matches: (pathname) => workspacePathMatches(pathname, "/workspace/sessions"),
  },
  {
    id: "plugs",
    href: "/workspace/extensions",
    label: "扩展",
    section: "primary",
    mobile: false,
    matches: (pathname) => workspacePathMatches(pathname, "/workspace/extensions") || workspacePathMatches(pathname, "/workspace/plugs"),
  },
];

/** Routes that fit the compact mobile tab bar, in rail order. */
export function workspaceMobileNavRoutes(): readonly WorkspaceNavRoute[] {
  return WORKSPACE_NAV_ROUTES.filter((route) => route.mobile);
}

export function workspaceNavRoutes(
  section: WorkspaceNavSection,
): readonly WorkspaceNavRoute[] {
  return WORKSPACE_NAV_ROUTES.filter((route) => route.section === section);
}

/** The single active section for a pathname, or null outside the workspace. */
export function workspaceNavRouteForPath(
  pathname: string | null | undefined,
): WorkspaceNavRoute | null {
  if (typeof pathname !== "string") return null;
  return WORKSPACE_NAV_ROUTES.find((route) => route.matches(pathname)) ?? null;
}

/** Whether a specific route is the active section for a pathname. */
export function isWorkspaceNavRouteCurrent(
  route: WorkspaceNavRoute,
  pathname: string,
): boolean {
  return route.matches(pathname);
}

/** Same-route compose entry point used by the scoped relationship desk. */
export const WORKSPACE_COMPOSE_HREF = "/workspace?surface=desk&intent=compose";

/** DOM event that hands keyboard focus to the workspace Agent composer. */
export const WORKSPACE_FOCUS_AGENT_EVENT = "talent-signal:focus-agent";

/** DOM event that resets the home canvas to a fresh conversation. */
export const WORKSPACE_NEW_CONVERSATION_EVENT =
  "talent-signal:new-conversation";

export type WorkspaceCaptureIntent =
  | { readonly intercept: false }
  | {
      readonly intercept: true;
      readonly href: typeof WORKSPACE_COMPOSE_HREF;
      readonly event: typeof WORKSPACE_FOCUS_AGENT_EVENT;
    };

/**
 * The scoped "new conversation" control is a same-route transition when the
 * relationship desk is already mounted, so it focuses the desk composer
 * instead of remounting the page. The unscoped home canvas owns its own
 * composer and must navigate normally. A loading surface must never be
 * intercepted: the composer may not exist yet.
 */
export function workspaceCaptureIntent(
  pathname: string,
  search: string,
): WorkspaceCaptureIntent {
  if (!isWorkspaceHomePath(pathname)) return { intercept: false };
  const surface = new URLSearchParams(search).get("surface");
  if (surface !== "desk") return { intercept: false };
  return {
    intercept: true,
    href: WORKSPACE_COMPOSE_HREF,
    event: WORKSPACE_FOCUS_AGENT_EVENT,
  };
}

/**
 * Compact rail control identity for the settled shared sidebar. The row is
 * presentation; every href and route predicate still lives in
 * `WORKSPACE_NAV_ROUTES` above, so mobile placement and the source,
 * extensions and new-conversation paths never move.
 */
export type WorkspaceRailControlId =
  | "today"
  | "conversation"
  | "people"
  | "meetings"
  | "search";

/**
 * Horizontal rail order: today, conversation, people, meetings, then the
 * scoped global search control. "conversation" is the durable conversation
 * canvas (`home`), and it also stays selected across Session detail pages.
 */
export const WORKSPACE_RAIL_CONTROLS: readonly WorkspaceRailControlId[] = [
  "today",
  "conversation",
  "people",
  "meetings",
  "search",
];

const WORKSPACE_RAIL_ROUTES: Record<
  Exclude<WorkspaceRailControlId, "search">,
  WorkspaceNavRouteId
> = {
  today: "today",
  conversation: "home",
  people: "people",
  meetings: "meetings",
};

/** Route link behind a rail control; the search control has no href. */
export function workspaceRailRoute(
  control: WorkspaceRailControlId,
): WorkspaceNavRoute | null {
  const routeId = WORKSPACE_RAIL_ROUTES[control as Exclude<WorkspaceRailControlId, "search">];
  return routeId
    ? WORKSPACE_NAV_ROUTES.find((route) => route.id === routeId) ?? null
    : null;
}

/**
 * The one selected rail control for a pathname. The conversation pill covers
 * the home canvas and the whole Session family (directory and detail), so an
 * opened transcript never lights a second destination.
 */
export function workspaceRailSelection(
  pathname: string | null | undefined,
): Exclude<WorkspaceRailControlId, "search"> | null {
  if (typeof pathname !== "string") return null;
  if (
    isWorkspaceHomePath(pathname) ||
    workspacePathMatches(pathname, "/workspace/sessions")
  ) {
    return "conversation";
  }
  for (const control of WORKSPACE_RAIL_CONTROLS) {
    if (control === "search" || control === "conversation") continue;
    const route = workspaceRailRoute(control);
    if (route?.matches(pathname)) return control;
  }
  return null;
}

/** Storage key for the collapsed desktop rail preference. */
export const WORKSPACE_RAIL_COLLAPSED_KEY =
  "talent-signal:workspace-rail-collapsed";

/** Same-tab notification event for collapsed-rail preference changes. */
export const WORKSPACE_RAIL_PREFERENCE_EVENT =
  "talent-signal:workspace-rail-preference";

/** Crumb label for the 58px route header, derived from the active route. */
export function workspaceRouteLabel(
  pathname: string | null | undefined,
): string {
  if (isWorkspaceHomePath(pathname)) return "新对话";
  if (workspacePathMatches(pathname, "/workspace/settings")) return "设置";
  if (workspacePathMatches(pathname, "/workspace/preferences")) return "回复偏好";
  if (workspacePathMatches(pathname, "/workspace/pursuits")) return "今日";
  return workspaceNavRouteForPath(pathname)?.label ?? "工作台";
}
