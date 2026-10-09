/**
 * Shared desktop-rail preference and transient reveal state.
 *
 * The collapsed/expanded preference is persisted per browser profile and never
 * changes through hover. The edge-hover reveal is transient, in-memory state:
 * floating the expanded sidebar over content must not rewrite the preference.
 */

import { useSyncExternalStore } from "react";

import {
  WORKSPACE_RAIL_COLLAPSED_KEY,
  WORKSPACE_RAIL_PREFERENCE_EVENT,
} from "./workspace-navigation";

const COLLAPSED_KEY = WORKSPACE_RAIL_COLLAPSED_KEY;
const COLLAPSED_EVENT = WORKSPACE_RAIL_PREFERENCE_EVENT;

let collapsedFallback = false;
let collapsedInMemory = false;
const revealListeners = new Set<() => void>();
let revealedFallback = false;

function collapsedSnapshot() {
  if (collapsedInMemory) return collapsedFallback;
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return collapsedFallback;
  }
}

function collapsedServerSnapshot() {
  return false;
}

function subscribeToCollapsedPreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(COLLAPSED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(COLLAPSED_EVENT, onChange);
  };
}

export function useCollapsedState(): {
  collapsed: boolean;
  setCollapsed(next: boolean): void;
} {
  const collapsed = useSyncExternalStore(
    subscribeToCollapsedPreference,
    collapsedSnapshot,
    collapsedServerSnapshot,
  );
  return {
    collapsed,
    setCollapsed(next: boolean) {
      setRailRevealed(false);
      collapsedFallback = next;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, String(next));
        collapsedInMemory = false;
      } catch {
        collapsedInMemory = true;
        // Keep this interaction usable when browser storage is unavailable.
      }
      window.dispatchEvent(new Event(COLLAPSED_EVENT));
    },
  };
}

function revealSnapshot() {
  return revealedFallback;
}

function subscribeToReveal(onChange: () => void) {
  revealListeners.add(onChange);
  return () => {
    revealListeners.delete(onChange);
  };
}

export function setRailRevealed(next: boolean) {
  if (revealedFallback === next) return;
  revealedFallback = next;
  for (const listener of revealListeners) listener();
}

/**
 * Transient expanded-sidebar reveal (hover near the window's left edge or
 * keyboard focus). Never touches the persisted collapse preference.
 */
export function useRailReveal(): {
  revealed: boolean;
  setRevealed(next: boolean): void;
} {
  const revealed = useSyncExternalStore(
    subscribeToReveal,
    revealSnapshot,
    () => false,
  );
  return { revealed, setRevealed: setRailRevealed };
}
