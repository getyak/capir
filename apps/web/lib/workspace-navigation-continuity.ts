import { isSessionId } from "@/components/session-workbench/session-view";
import { validMeetingDay } from "./meeting-calendar";
import { validTimeZone } from "./time-workspace";

export type WorkspaceNavigationDestination = "conversation" | "people" | "meetings";
export type WorkspaceNavigationLocator = { destination: WorkspaceNavigationDestination; href: string };
const BASE = "https://workspace.invalid";
const CONTROL = /[\u0000-\u001f\u007f]/u;
const QUERY_LIMIT = 500;
const UUID_KEYS = new Set(["draft_session", "capture", "context", "identity_case", "person", "session", "draft"]);
const HOME_VALUES: Record<string, readonly string[]> = {
  surface: ["desk", "loading"], intent: ["compose", "capture", "create-contact"],
};
const TIME_VALUES: Record<string, readonly string[]> = {
  view: ["timeline", "week", "month"], range: ["day", "week", "month", "past7", "next30", "custom"],
  kind: ["person_created", "session_activity", "meeting_draft", "schedule"], upcoming: ["7", "30"],
};

function validQuery(query: URLSearchParams, allowed: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const [key, value] of query) {
    if (!allowed.includes(key) || seen.has(key) || CONTROL.test(value)) return false;
    seen.add(key);
    if (UUID_KEYS.has(key)) { if (!isSessionId(value)) return false; }
    else if (key === "query" || key === "directory_query") { if (value.length > QUERY_LIMIT) return false; }
    else if (key === "day" || key === "from" || key === "to") { if (!validMeetingDay(value)) return false; }
    else if (key === "tz") { if (!validTimeZone(value)) return false; }
    else if (key === "item") {
      const [kind, id, day, ...extra] = value.split(":");
      if (!isSessionId(id) || extra.length) return false;
      if (kind === "session_activity") { if (!validMeetingDay(day)) return false; }
      else if (!["person_created", "meeting_draft", "schedule"].includes(kind) || day !== undefined) return false;
    } else if (!(HOME_VALUES[key] ?? TIME_VALUES[key])?.includes(value)) return false;
  }
  return true;
}

/** Private page positions only: no arbitrary URLs, auth values, or evidence content. */
export function vetWorkspaceNavigationHref(value: unknown): WorkspaceNavigationLocator | null {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || CONTROL.test(value)) return null;
  let url: URL;
  try { url = new URL(value, BASE); } catch { return null; }
  if (url.origin !== BASE || url.pathname !== value.split(/[?#]/u, 1)[0]) return null;
  const path = url.pathname.replace(/\/$/u, "");
  const query = url.searchParams;
  if (path === "/workspace") {
    if (url.hash || !validQuery(query, [...UUID_KEYS].filter(key => key !== "draft").concat(Object.keys(HOME_VALUES)))) return null;
    return { destination: "conversation", href: path + url.search };
  }
  const session = /^\/workspace\/sessions\/([^/]+)$/u.exec(path);
  if (session) {
    if (!isSessionId(session[1]) || query.size || url.hash) return null;
    return { destination: "conversation", href: path };
  }
  if (path === "/workspace/people") {
    if (!validQuery(query, ["query", "session"]) || (url.hash && !/^#person-[0-9a-f-]{36}$/u.test(url.hash))) return null;
    if (url.hash && !isSessionId(url.hash.slice(8))) return null;
    return { destination: "people", href: path + url.search + url.hash };
  }
  const person = /^\/workspace\/people\/([^/]+)$/u.exec(path);
  if (person) {
    // A detail route only carries an explicitly supplied directory search.
    // Opening a Person by any other route cannot erase the remembered list.
    if (!isSessionId(person[1]) || url.hash || !query.has("directory_query") || !validQuery(query, ["directory_query", "session"])) return null;
    const directory = new URLSearchParams();
    const search = query.get("directory_query")!;
    if (search) directory.set("query", search);
    if (query.has("session")) directory.set("session", query.get("session")!);
    return { destination: "people", href: `/workspace/people${directory.size ? `?${directory}` : ""}` };
  }
  if (path === "/workspace/meetings") {
    if (url.hash || !validQuery(query, ["day", "from", "to", "tz", "person", "draft", "item", ...Object.keys(TIME_VALUES)])) return null;
    return { destination: "meetings", href: path + url.search };
  }
  return null;
}

export type WorkspaceNavigationSnapshot = {
  readonly hrefs: Readonly<Partial<Record<WorkspaceNavigationDestination, string>>>;
};

export type WorkspaceComposerView = {
  readonly start: number;
  readonly end: number;
  readonly direction: "forward" | "backward" | "none";
  readonly scrollTop: number;
};

// A non-authoritative UI stamp avoids retaining another copy of private draft
// text. It can match a clamped presentation state, never identity or an action.
function composerViewStamp(draft: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < draft.length; index++) {
    const unit = draft.charCodeAt(index);
    first = Math.imul(first ^ unit, 0x01000193);
    second = Math.imul(second ^ unit, 0x85ebca6b);
  }
  return `${draft.length}:${first >>> 0}:${second >>> 0}`;
}

/** Locators and bounded editor presentation live only in this authenticated mount. */
export function createWorkspaceNavigationMemory(scope: string | null) {
  let expired = typeof scope !== "string" || !/^[0-9a-f]{64}$/u.test(scope);
  let snapshot: WorkspaceNavigationSnapshot = { hrefs: {} };
  const listeners = new Set<() => void>();
  // No text, storage record, render output or second draft authority is kept.
  const composerViews = new Map<string, { stamp: string; view: WorkspaceComposerView }>();
  function publish(hrefs: WorkspaceNavigationSnapshot["hrefs"]) {
    snapshot = { hrefs }; for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    remember(href: string) {
      if (expired) return;
      const locator = vetWorkspaceNavigationHref(href);
      if (!locator || snapshot.hrefs[locator.destination] === locator.href) return;
      publish({ ...snapshot.hrefs, [locator.destination]: locator.href });
    },
    rememberComposerView(key: string, draft: string, view: WorkspaceComposerView) {
      if (expired || !isSessionId(key) || draft.length > 64_000) return;
      if (!draft) return;
      if (!Number.isInteger(view.start) || !Number.isInteger(view.end) ||
          view.start < 0 || view.end < view.start || view.end > draft.length ||
          !["forward", "backward", "none"].includes(view.direction) ||
          !Number.isFinite(view.scrollTop) || view.scrollTop < 0) return;
      composerViews.delete(key);
      composerViews.set(key, { stamp: composerViewStamp(draft), view: { ...view } });
      if (composerViews.size > 16) composerViews.delete(composerViews.keys().next().value!);
    },
    readComposerView(key: string, draft: string): WorkspaceComposerView | null {
      if (expired) return null;
      const entry = composerViews.get(key);
      return entry?.stamp === composerViewStamp(draft) ? { ...entry.view } : null;
    },
    forgetComposerView(key: string) { composerViews.delete(key); },
    expire() { expired = true; composerViews.clear(); publish({}); },
  };
}

export function rememberedWorkspaceNavigationHref(snapshot: WorkspaceNavigationSnapshot, canonical: string): string {
  const destination = canonical === "/workspace" ? "conversation" : canonical === "/workspace/people" ? "people" : canonical === "/workspace/meetings" ? "meetings" : null;
  return destination ? snapshot.hrefs[destination] ?? canonical : canonical;
}
