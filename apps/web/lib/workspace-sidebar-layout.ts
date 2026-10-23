"use client";

import { createContext, useSyncExternalStore } from "react";
import {
  WORKSPACE_RAIL_COLLAPSED_KEY,
  WORKSPACE_RAIL_PREFERENCE_EVENT,
} from "./workspace-navigation";

export const SIDEBAR_LAYOUT_KEY = "talent-signal:workspace-sidebar-layout:v1";
export const SIDEBAR_DEFAULT_WIDTH = 248;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_HIDE_THRESHOLD = 160;

export type SidebarLayout = { width: number; hidden: boolean; collapsed: boolean };
export const WorkspaceSidebarPresentation = createContext<SidebarLayout | null>(null);
const DEFAULT: SidebarLayout = { width: SIDEBAR_DEFAULT_WIDTH, hidden: false, collapsed: false };
const serverSnapshot = JSON.stringify(DEFAULT);
let memoryPreference: string | null = null;

function normalize(value: Partial<SidebarLayout>): SidebarLayout {
  const width = typeof value.width === "number" && Number.isFinite(value.width)
    ? Math.round(Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, value.width)))
    : SIDEBAR_DEFAULT_WIDTH;
  const hidden = value.hidden === true;
  return { width, hidden, collapsed: !hidden && value.collapsed === true };
}

function snapshot(): string {
  if (memoryPreference !== null) return memoryPreference;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_LAYOUT_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return JSON.stringify(normalize(parsed));
      }
    }
    return JSON.stringify({ ...DEFAULT, collapsed: window.localStorage.getItem(WORKSPACE_RAIL_COLLAPSED_KEY) === "true" });
  } catch {
    return serverSnapshot;
  }
}

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SIDEBAR_LAYOUT_KEY && event.key !== WORKSPACE_RAIL_COLLAPSED_KEY) return;
    try {
      const storage = window.localStorage;
      if (event.storageArea && event.storageArea !== storage) return;
      storage.getItem(SIDEBAR_LAYOUT_KEY);
    } catch {
      // An unreadable external change cannot replace the working local fallback.
      return;
    }
    memoryPreference = null;
    notify();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(WORKSPACE_RAIL_PREFERENCE_EVENT, notify);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(WORKSPACE_RAIL_PREFERENCE_EVENT, notify);
  };
}

export function useWorkspaceSidebarLayout() {
  const serialized = useSyncExternalStore(subscribe, snapshot, () => serverSnapshot);
  const layout: SidebarLayout = JSON.parse(serialized);
  function setLayout(next: SidebarLayout) {
    const value = normalize(next);
    memoryPreference = JSON.stringify(value);
    try {
      window.localStorage.setItem(SIDEBAR_LAYOUT_KEY, memoryPreference);
      // Preserve compatibility with the previous compact-rail preference.
      window.localStorage.setItem(WORKSPACE_RAIL_COLLAPSED_KEY, String(value.collapsed));
      memoryPreference = null;
    } catch {
      // Presentation stays reversible when storage is denied or full.
    }
    window.dispatchEvent(new Event(WORKSPACE_RAIL_PREFERENCE_EVENT));
  }
  return { layout, setLayout };
}
