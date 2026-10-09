"use client";

import { motion, type Transition } from "motion/react";
import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

import {
  useCollapsedState,
  useRailReveal,
} from "@/lib/workspace-rail-preference";
import { useReducedMotionPreference } from "@/lib/use-reduced-motion";
import styles from "./workspace-shell.module.css";

/**
 * Interruptible sidebar spring with a floating edge-hover reveal.
 *
 * The collapse/expand width and offset animate as Motion-springs on CSS custom
 * properties, so the grid column tracks them without any DOM swap: navigation
 * icons keep their x/y positions while labels fade and clip. Hovering near the
 * window's left edge (or focusing the rail) floats the expanded sidebar above
 * content with a negative margin — no reflow — and never touches the persisted
 * collapse preference. Escape closes the float; leaving closes it after a
 * short grace.
 */

const EXPANDED_WIDTH = 236;
const COLLAPSED_WIDTH = 56;
const REVEAL_GRACE_MS = 180;
const DESKTOP_MEDIA = "(min-width: 761px)";

export const RAIL_SPRING: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 34,
  mass: 0.9,
};

function subscribeToDesktopMedia(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_MEDIA);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function desktopSidebarSnapshot() {
  try {
    return window.matchMedia(DESKTOP_MEDIA).matches;
  } catch {
    return true;
  }
}

function useDesktopSidebar(): boolean {
  return useSyncExternalStore(
    subscribeToDesktopMedia,
    desktopSidebarSnapshot,
    () => false,
  );
}

export function WorkspaceSidebarShell({ children }: { children: ReactNode }) {
  const { collapsed } = useCollapsedState();
  const { revealed, setRevealed } = useRailReveal();
  const reduceMotion = useReducedMotionPreference();
  const desktop = useDesktopSidebar();
  const closeTimer = useRef<number | null>(null);
  const floating = desktop && collapsed && revealed;

  const reveal = useCallback(() => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setRevealed(true);
  }, [setRevealed]);

  const scheduleClose = useCallback(() => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setRevealed(false), REVEAL_GRACE_MS);
  }, [setRevealed]);

  useEffect(() => {
    if (!floating) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRevealed(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [floating, setRevealed]);

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  const expanded = !collapsed || floating;
  const width = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  // Floating keeps the grid column at the collapsed width: the expanded
  // sidebar overlays content instead of reflowing it.
  const offset = floating ? COLLAPSED_WIDTH - EXPANDED_WIDTH : 0;

  return (
    <>
      {desktop && collapsed ? (
        <div
          aria-hidden="true"
          className={styles.railRevealStrip}
          onPointerEnter={reveal}
          onPointerLeave={scheduleClose}
        />
      ) : null}
      <motion.aside
        aria-label="Talent Signal 工作台"
        className={styles.sidebar}
        data-floating={floating ? "true" : undefined}
        initial={false}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            scheduleClose();
          }
        }}
        onFocusCapture={() => {
          if (collapsed && desktop) reveal();
        }}
        onPointerEnter={() => {
          if (collapsed && desktop) reveal();
        }}
        onPointerLeave={() => {
          if (collapsed && desktop) scheduleClose();
        }}
        animate={{
          "--sidebar-rail-width": `${width}px`,
          "--sidebar-rail-offset": `${offset}px`,
        }}
        transition={reduceMotion ? { duration: 0 } : RAIL_SPRING}
      >
        {children}
      </motion.aside>
    </>
  );
}
