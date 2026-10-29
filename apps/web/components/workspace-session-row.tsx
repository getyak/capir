"use client";

import { Archive, DotsThree, PencilSimple, PushPin, Tray } from "@phosphor-icons/react";
import {
  Children,
  cloneElement,
  isValidElement,
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
import { useT } from "./locale-provider";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import styles from "./workspace-shell.module.css";
import { SessionRenameDialog, type SessionMenuTarget } from "./session-rename-dialog";
import { ListOrderActions, type OrderControl } from "./workspace-list-order";

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
  reorder?: OrderControl;
  session?: SessionMenuTarget;
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
  const t = useT();
  const { archived, pinned, onToggle, rowLabel } = organization;
  const pinLabel = t(pinned ? "sessionRow.unpin" : "sessionRow.pin");
  const archiveLabel = t(archived ? "sessionRow.restore" : "sessionRow.archive");
  return (
    <div className={styles.sessionRowTray}>
      <button
        aria-pressed={pinned}
        aria-label={t("sessionRow.actionForTitle", { action: pinLabel, title: rowLabel })}
        className={styles.sessionRowTrayButton}
        data-action="pin"
        onClick={() => onToggle("pinned", !pinned)}
        type="button"
      >
        <PushPin aria-hidden="true" size={15} weight={pinned ? "fill" : "regular"} />
        <span>{pinLabel}</span>
      </button>
      <button
        aria-label={t("sessionRow.actionForTitle", { action: archiveLabel, title: rowLabel })}
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
        <span>{archiveLabel}</span>
      </button>
    </div>
  );
}

/** Named, always-reachable alternative to the swipe gesture. */
export function SessionRowMenu({
  organization,
  onOpen,
  onOpenChange,
}: {
  organization: SessionRowOrganization;
  onOpen?: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const { archived, pinned, onToggle, rowLabel } = organization;
  return (
    <><div className={styles.sessionRowMenu} data-open={open ? "true" : undefined}>
      <Popover open={open} onOpenChange={value => { setOpen(value); onOpenChange?.(value); if (value) onOpen?.(); }}>
        <PopoverTrigger asChild>
          <button
            {...organization.reorder?.handleProps}
            ref={menuTrigger}
            title={open ? undefined : organization.reorder?.handleProps.title}
            aria-label={t("sessionRow.moreForTitle", { title: rowLabel })}
            className={`${styles.sessionRowMenuTrigger} ${organization.reorder?.handleProps.className ?? ""}`}
            type="button"
          >
            <DotsThree aria-hidden="true" size={18} />
          </button>
        </PopoverTrigger>
      <PopoverContent aria-label={t("sessionRow.moreForTitle", { title: rowLabel })}
        align="end" sideOffset={4} className={styles.sessionRowMenuPopover}>
        <span className={styles.sessionRowMenuTitle}>{rowLabel}</span>
        {organization.session && <button type="button" onClick={() => { setOpen(false); onOpenChange?.(false); setRenaming(true); }}>
          <PencilSimple aria-hidden="true" size={15} /><span>{t("sessionMenu.rename")}</span>
        </button>}
        <button
          aria-pressed={pinned}
          onClick={() => {
            onToggle("pinned", !pinned);
            setOpen(false);
            onOpenChange?.(false);
          }}
          type="button"
        >
          <PushPin aria-hidden="true" size={15} weight={pinned ? "fill" : "regular"} />
          <span>{t(pinned ? "sessionRow.unpin" : "sessionRow.pin")}</span>
        </button>
        <button
          onClick={() => {
            onToggle("archived", !archived);
            setOpen(false);
            onOpenChange?.(false);
          }}
          type="button"
        >
          {archived ? (
            <Tray aria-hidden="true" size={15} />
          ) : (
            <Archive aria-hidden="true" size={15} />
          )}
          <span>{t(archived ? "sessionRow.restore" : "sessionRow.archive")}</span>
        </button>
        {organization.reorder ? <ListOrderActions control={organization.reorder} onMove={() => { setOpen(false); onOpenChange?.(false); }} /> : null}
        <span className={styles.sessionRowMenuNote}>{t(organization.reorder ? "listOrder.sessionLocal" : "sessionRow.localOrganization")}</span>
      </PopoverContent>
      </Popover>
    </div>
    {renaming && organization.session && <SessionRenameDialog key={organization.session.id + organization.session.binding}
      target={organization.session} title={rowLabel} onClose={() => setRenaming(false)}
      returnFocus={() => { if (menuTrigger.current?.isConnected) menuTrigger.current.focus({ preventScroll: true }); }} />}</>
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
  const [menuOpen, setMenuOpen] = useState(false);
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
        {Children.map(children, child => isValidElement<{ title?: string }>(child) && menuOpen
          ? cloneElement(child, { title: undefined }) : child)}
        <SessionRowMenu organization={organization} onOpen={close} onOpenChange={setMenuOpen}/>
      </motion.div>
    </div>
  );
}
