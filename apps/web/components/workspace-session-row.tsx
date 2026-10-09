"use client";

import { Archive, DotsThreeVertical, PushPin, Tray } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { animate, motion, useMotionValue } from "motion/react";
import { useReducedMotionPreference } from "@/lib/use-reduced-motion";
import type { SessionOrganizationFlag } from "@/lib/workspace-session-organization";
import styles from "./workspace-shell.module.css";

/**
 * Swipeable local-organization row.
 *
 * Swipe left reveals the Archive and Pin actions; the same named actions live
 * in an always-reachable per-row menu so the gesture is optional. Everything
 * here is reversible local list organization: it never mutates the backend,
 * never stops an Agent run and never deletes evidence.
 */

export const SESSION_ROW_ACTIONS_WIDTH = 132;
const DRAG_THRESHOLD_PX = 10;
const CLOSE_GRACE_MS = 120;

export type SessionRowOrganization = {
  archived: boolean;
  pinned: boolean;
  onToggle: (flag: SessionOrganizationFlag, value: boolean) => void;
  /** Row title used to name the accessible buttons. */
  rowLabel: string;
};

type SwipeState = {
  pointerId: number;
  startX: number;
  startY: number;
  engaged: boolean;
  lastX: number;
  lastT: number;
  velocity: number;
};

export function SessionRowActionTray({
  organization,
}: {
  organization: SessionRowOrganization;
}) {
  const { archived, pinned, onToggle, rowLabel } = organization;
  return (
    <div className={styles.sessionRowTray}>
      <button
        aria-label={`${pinned ? "取消置顶" : "置顶"}：${rowLabel}`}
        className={styles.sessionRowTrayButton}
        data-action="pin"
        onClick={() => onToggle("pinned", !pinned)}
        type="button"
      >
        <PushPin aria-hidden="true" size={15} weight={pinned ? "fill" : "regular"} />
        <span>{pinned ? "取消置顶" : "置顶"}</span>
      </button>
      <button
        aria-label={`${archived ? "恢复" : "归档"}：${rowLabel}`}
        className={styles.sessionRowTrayButton}
        data-action="archive"
        onClick={() => onToggle("archived", !archived)}
        type="button"
      >
        {archived ? (
          <Tray aria-hidden="true" size={15} />
        ) : (
          <Archive aria-hidden="true" size={15} />
        )}
        <span>{archived ? "恢复" : "归档"}</span>
      </button>
    </div>
  );
}

/** Named, always-reachable alternative to the swipe gesture. */
export function SessionRowMenu({
  organization,
}: {
  organization: SessionRowOrganization;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const { archived, pinned, onToggle, rowLabel } = organization;
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current?.open && event.target instanceof Node && !menu.current.contains(event.target)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  function close() {
    if (menu.current) menu.current.open = false;
  }
  return (
    <details
      className={styles.sessionRowMenu}
      onKeyDown={(event: ReactKeyboardEvent<HTMLDetailsElement>) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          menu.current?.querySelector<HTMLElement>("summary")?.focus();
        }
      }}
      ref={menu}
    >
      <summary
        aria-label={`更多操作：${rowLabel}`}
        className={styles.sessionRowMenuTrigger}
        title="更多操作"
      >
        <DotsThreeVertical aria-hidden="true" size={15} />
      </summary>
      <div className={styles.sessionRowMenuPopover}>
        <button
          onClick={() => {
            onToggle("pinned", !pinned);
            close();
          }}
          type="button"
        >
          <PushPin aria-hidden="true" size={15} weight={pinned ? "fill" : "regular"} />
          <span>{pinned ? "取消置顶" : "置顶"}</span>
        </button>
        <button
          onClick={() => {
            onToggle("archived", !archived);
            close();
          }}
          type="button"
        >
          {archived ? (
            <Tray aria-hidden="true" size={15} />
          ) : (
            <Archive aria-hidden="true" size={15} />
          )}
          <span>{archived ? "恢复" : "归档"}</span>
        </button>
        <span className={styles.sessionRowMenuNote}>本机整理</span>
      </div>
    </details>
  );
}

export function useSessionRowSwipe() {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const openRef = useRef(false);
  const x = useMotionValue(0);
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const swipe = useRef<SwipeState | null>(null);
  const suppressUntil = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotionPreference();
  const settle = useCallback((next: boolean, velocity = 0) => {
    setDragging(false);
    openRef.current = next;
    setOpen(next);
    animation.current?.stop();
    if (reduceMotion) x.set(next ? -SESSION_ROW_ACTIONS_WIDTH : 0);
    else animation.current = animate(x, next ? -SESSION_ROW_ACTIONS_WIDTH : 0,
      { type: "spring", stiffness: 440, damping: 38, mass: 0.85, velocity });
  }, [reduceMotion, x]);
  const close = useCallback(() => {
    swipe.current = null;
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
    settle(false);
  }, [settle]);
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button, summary")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    animation.current?.stop();
    swipe.current = { pointerId: event.pointerId ?? 0, startX: event.clientX,
      startY: event.clientY, engaged: false, lastX: event.clientX, lastT: event.timeStamp, velocity: 0 };
  }, []);
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = swipe.current;
    if (!state || (event.pointerId ?? 0) !== state.pointerId) return;
    const dx = event.clientX - state.startX, dy = event.clientY - state.startY;
    if (!state.engaged) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD_PX) return;
      if (Math.abs(dy) >= Math.abs(dx)) { swipe.current = null; return; }
      state.engaged = true;
      setDragging(true);
      try { event.currentTarget.setPointerCapture(state.pointerId); } catch { /* capture optional */ }
    }
    event.preventDefault();
    const raw = (openRef.current ? -SESSION_ROW_ACTIONS_WIDTH : 0) + dx;
    x.set(raw < -SESSION_ROW_ACTIONS_WIDTH ? -SESSION_ROW_ACTIONS_WIDTH + (raw + SESSION_ROW_ACTIONS_WIDTH) * 0.35 : Math.min(0, raw));
    const dt = event.timeStamp - state.lastT;
    if (dt > 0) state.velocity = Math.max(-2000, Math.min(2000, (event.clientX - state.lastX) / dt * 1000));
    state.lastX = event.clientX; state.lastT = event.timeStamp;
  }, [x]);
  const finish = useCallback(() => {
    const state = swipe.current; swipe.current = null;
    if (!state?.engaged) return;
    suppressUntil.current = performance.now() + 350;
    settle(x.get() + state.velocity * 0.08 < -SESSION_ROW_ACTIONS_WIDTH / 2, state.velocity);
  }, [settle, x]);
  const cancel = useCallback(() => { swipe.current = null; settle(openRef.current); }, [settle]);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaX === 0 || Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.3) return;
      // Horizontal scrolling inside nested reading regions stays with them.
      if (event.target instanceof Element && event.target.closest("pre, table, [data-no-swipe]")) return;
      event.preventDefault(); event.stopPropagation();
      setDragging(true);
      animation.current?.stop();
      x.set(Math.max(-SESSION_ROW_ACTIONS_WIDTH, Math.min(0, x.get() - event.deltaX * (event.deltaMode === 1 ? 16 : 1))));
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => settle(x.get() < -SESSION_ROW_ACTIONS_WIDTH / 2), 130);
    };
    const toggle = (event: Event) => { if (event.target instanceof HTMLDetailsElement && event.target.open) close(); };
    element.addEventListener("toggle", toggle, true);
    element.addEventListener("wheel", wheel, { passive: false });
    return () => { element.removeEventListener("toggle", toggle, true); element.removeEventListener("wheel", wheel); if (wheelTimer.current) clearTimeout(wheelTimer.current); animation.current?.stop(); };
  }, [close, settle, x]);
  return { open, dragging, close, surface, x, onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: cancel,
    onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
      if (performance.now() >= suppressUntil.current || (event.target instanceof Element && event.target.closest("button, summary"))) return;
      suppressUntil.current = 0; event.preventDefault(); event.stopPropagation();
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape" && openRef.current) { event.preventDefault(); close(); }
    },
  };
}

export function WorkspaceSessionRow({ organization, children }: {
  organization: SessionRowOrganization; children?: ReactNode;
}) {
  const { open, dragging, close, surface, x, onClickCapture, onKeyDown, onPointerCancel, onPointerDown, onPointerMove, onPointerUp } = useSessionRowSwipe();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  return (
    <div className={styles.sessionRowShell} data-open={open ? "true" : "false"} data-dragging={dragging ? "true" : undefined} ref={surface}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (closeTimer.current) clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(close, CLOSE_GRACE_MS);
      }}
      onFocusCapture={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }}
      onClickCapture={onClickCapture} onKeyDown={onKeyDown}
      onPointerCancel={onPointerCancel} onPointerDown={onPointerDown}
      onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div inert={!open} aria-hidden={!open}><SessionRowActionTray organization={organization}/></div>
      <motion.div className={styles.sessionRowSlide} style={{ x }}>
        {children}<SessionRowMenu organization={organization}/>
      </motion.div>
    </div>
  );
}
