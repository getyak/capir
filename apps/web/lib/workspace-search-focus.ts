/**
 * Bounded, in-memory focus handoff for global search result activation.
 *
 * The workspace shell keeps its global search trigger across navigation and
 * the installed Next layout-router deliberately does not focus the new route,
 * so an accepted same-tab result would leave keyboard focus on the closed
 * dialog's trigger. This helper closes that gap with the narrowest possible
 * production surface: it watches only the workspace content root, for a finite
 * time, for the ONE final Person or Session heading marked with the exact
 * selected destination pathname, then focuses it and stops.
 *
 * Authority rules: a focus intent is never persisted, never retried across the
 * credential lifecycle, and never overrides a focus the user (or another
 * surface) has chosen. Another navigation, a popstate, scope expiry, an
 * account change, an unmount, a newer intent, or any deliberate focus movement
 * cancels the handoff. A loading surface carries no marker and can never
 * consume an intent.
 */

export const WORKSPACE_SEARCH_FOCUS_ATTR = "data-workspace-focus-href";

/** Canonical pathname key shared by search result links and destination headings. */
export function workspaceSearchFocusHref(href: string): string {
  try {
    return new URL(href, "http://workspace.local").pathname;
  } catch {
    return href;
  }
}

/**
 * Marker props for one settled destination heading (tabIndex -1 included).
 * Loading placeholders and intermediate surfaces must never receive them.
 */
export function workspaceSearchFocusTargetProps(href: string): {
  tabIndex: -1;
  "data-workspace-focus-href": string;
} {
  return { tabIndex: -1, "data-workspace-focus-href": workspaceSearchFocusHref(href) };
}

export type WorkspaceSearchFocusHandoff = { cancel: () => void };

export function beginWorkspaceSearchFocusHandoff({
  href,
  isCurrent,
  cancelOn = [],
  timeoutMs = 2000,
  root,
}: {
  /** Exact destination href selected in search; matched by pathname. */
  href: string;
  /** Credential-lifecycle check; returning false ends the handoff silently. */
  isCurrent?: () => boolean;
  /** Window events that end the handoff (workspace session expiry). */
  cancelOn?: readonly string[];
  /** Finite bound; the handoff never outlives it. */
  timeoutMs?: number;
  /** Narrow workspace DOM root to observe; defaults to the routed content. */
  root?: ParentNode | null;
}): WorkspaceSearchFocusHandoff {
  const requestedScope = root ?? document.getElementById("workspace-content");
  if (!requestedScope) return { cancel: () => {} };
  const scope = requestedScope;
  const targetHref = workspaceSearchFocusHref(href);
  let finished = false;
  let deadline: number | undefined;
  let firstCheck: number | undefined;
  let observer: MutationObserver | undefined;

  function cleanup() {
    if (finished) return;
    finished = true;
    if (deadline !== undefined) window.clearTimeout(deadline);
    if (firstCheck !== undefined) window.clearTimeout(firstCheck);
    observer?.disconnect();
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("click", onLinkClick, true);
    window.removeEventListener("popstate", cancel);
    for (const name of cancelOn) window.removeEventListener(name, cancel);
  }

  function cancel() {
    cleanup();
  }

  function findTarget(): HTMLElement | null {
    for (const node of scope.querySelectorAll(`[${WORKSPACE_SEARCH_FOCUS_ATTR}]`)) {
      if (node instanceof HTMLElement && node.getAttribute(WORKSPACE_SEARCH_FOCUS_ATTR) === targetHref
        && !node.closest('[hidden], [inert], [aria-hidden="true"]')
        && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden") {
        return node;
      }
    }
    return null;
  }

  /** A visible, actually focused element belongs to its owner; never steal it. */
  function userOwnsFocus(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    if (active === document.body || active === document.documentElement) return false;
    if (!active.isConnected) return false;
    return Boolean(active.getClientRects().length) && getComputedStyle(active).visibility !== "hidden";
  }

  function attempt() {
    if (finished) return;
    if (isCurrent && !isCurrent()) {
      cancel();
      return;
    }
    const target = findTarget();
    if (!target) return;
    if (document.activeElement === target) {
      // The destination (or the user) already placed focus on the target.
      cleanup();
      return;
    }
    if (userOwnsFocus()) {
      cancel();
      return;
    }
    // Only the selected destination route may receive the handoff.
    if (window.location.pathname !== targetHref) return;
    cleanup();
    target.focus({ preventScroll: true });
  }

  function onFocusIn(event: Event) {
    if (finished) return;
    const focused = event.target instanceof HTMLElement ? event.target : null;
    if (focused && focused.getAttribute(WORKSPACE_SEARCH_FOCUS_ATTR) === targetHref) {
      cleanup();
      return;
    }
    // Any other focus movement is the user's (or another surface's) choice.
    cancel();
  }

  function onLinkClick(event: Event) {
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest<HTMLAnchorElement>("a[href]") ?? null;
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    let destination: URL;
    try {
      destination = new URL(link.href);
    } catch {
      return;
    }
    // A newer ordinary navigation invalidates this intent even when blocked.
    if (destination.origin === window.location.origin && destination.pathname !== targetHref) {
      cancel();
    }
  }

  for (const name of cancelOn) window.addEventListener(name, cancel);
  window.addEventListener("popstate", cancel);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("click", onLinkClick, true);
  if (scope) {
    observer = new MutationObserver(() => attempt());
    observer.observe(scope, { childList: true, subtree: true });
  }
  // The handoff starts only after the dialog close released its focus trap, so
  // the first check runs a tick later and the whole watch stays bounded.
  firstCheck = window.setTimeout(() => {
    firstCheck = undefined;
    attempt();
  }, 0);
  deadline = window.setTimeout(() => {
    deadline = undefined;
    attempt();
    cancel();
  }, timeoutMs);

  return { cancel };
}
