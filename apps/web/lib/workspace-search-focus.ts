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

/** Navigation identity retains query/hash; only the heading marker is a pathname. */
function navigationHref(href: string): string {
  const url = new URL(href, "http://workspace.local");
  return `${url.pathname}${url.search}${url.hash}`;
}

function currentHref(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
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

export type WorkspaceSearchFocusHandoff = { cancel: () => void; observeLocation: (href: string) => void };

export function beginWorkspaceSearchFocusHandoff({
  href,
  fromHref = currentHref(),
  isCurrent,
  cancelOn = [],
  timeoutMs = 8000,
  root,
}: {
  /** Exact destination href selected in search; matched by pathname. */
  href: string;
  /** Source route may remain committed while the selected destination loads. */
  fromHref?: string;
  /** Credential-lifecycle check; returning false ends the handoff silently. */
  isCurrent?: () => boolean;
  /** Window events that end the handoff (workspace session expiry). */
  cancelOn?: readonly string[];
  /** Finite bound; the handoff never outlives it. */
  timeoutMs?: number;
  /** Narrow workspace DOM root to observe; defaults to the routed content. */
  root?: ParentNode | null;
}): WorkspaceSearchFocusHandoff {
  const targetHref = workspaceSearchFocusHref(href);
  const targetLocation = navigationHref(href);
  const sourceHref = navigationHref(fromHref);
  const scope = root ?? document.getElementById("workspace-content");
  let finished = false;
  let arrived = false;
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
    window.removeEventListener("hashchange", onLocationChange);
    for (const name of cancelOn) window.removeEventListener(name, cancel);
  }

  function cancel() {
    cleanup();
  }

  function observeLocation(href: string) {
    if (finished) return;
    const location = navigationHref(href);
    if (location === targetLocation) arrived = true;
    else if (arrived || location !== sourceHref) cancel();
  }

  function onLocationChange() { observeLocation(currentHref()); }

  function visible(node: HTMLElement): boolean {
    if (!node.isConnected || !node.getClientRects().length || node.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
        || style.opacity === "0" || style.contentVisibility === "hidden") return false;
    }
    return true;
  }

  function findTarget(): HTMLElement | null {
    for (const node of scope?.querySelectorAll(`[${WORKSPACE_SEARCH_FOCUS_ATTR}]`) ?? []) {
      if (node instanceof HTMLElement && node.getAttribute(WORKSPACE_SEARCH_FOCUS_ATTR) === targetHref && visible(node)) {
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
    return visible(active);
  }

  function attempt() {
    if (finished) return;
    observeLocation(currentHref());
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
    if (currentHref() !== targetLocation) return;
    cleanup();
    target.focus({ preventScroll: true });
    // Same-address selection may retain an old reading position. Reveal the
    // explicitly selected heading using its existing scroll containers.
    target.scrollIntoView({ block: "nearest" });
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
    if (destination.origin === window.location.origin && navigationHref(destination.href) !== targetLocation) {
      cancel();
    }
  }

  // Never widen observation to the body when the owning workspace is gone.
  if (!scope) return { cancel, observeLocation };
  for (const name of cancelOn) window.addEventListener(name, cancel);
  window.addEventListener("popstate", cancel);
  window.addEventListener("hashchange", onLocationChange);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("click", onLinkClick, true);
  if (scope) {
    observer = new MutationObserver(() => attempt());
    observer.observe(scope, { childList: true, subtree: true, attributes: true,
      attributeFilter: [WORKSPACE_SEARCH_FOCUS_ATTR, "hidden", "inert", "aria-hidden", "style", "class"] });
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

  return { cancel, observeLocation };
}
