"use client";

import { ArrowCounterClockwise, ArrowDown, ArrowUp, DotsSixVertical } from "@phosphor-icons/react";
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from "react";
import { projectListOrder, projectSessionOrder, useListOrder, type ListOrderKind } from "@/lib/workspace-list-order";
import { useT } from "./locale-provider";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import styles from "./workspace-list-order.module.css";

const Scope = createContext<string | null>(null);
export function WorkspaceListOrderScope({ scope, children }: { scope: string | null; children: ReactNode }) {
  return <Scope.Provider value={scope}>{children}</Scope.Provider>;
}
export type OrderControl = {
  handleProps: ButtonHTMLAttributes<HTMLButtonElement>;
  up: boolean;
  down: boolean;
  canReset: boolean;
  move(direction: -1 | 1): void;
  reset(): void;
};
type Drag = { id: string; pointer: number; x: number; y: number; startX: number; startY: number; engaged: boolean; button: HTMLButtonElement; target: string | null; edge: "before" | "after" };
const oneGroup = () => "all";

/** Drag is confined to an explicit handle. Normal links, text selection,
 * horizontal navigation and vertical touch scrolling retain their ownership. */
export function useWorkspaceListReorder<T extends { id: string }>(
  rows: readonly T[], kind: ListOrderKind,
  { scope: explicitScope, disabled = false, group = oneGroup, limit = Infinity, activity }: {
    scope?: string | null; disabled?: boolean; group?: (row: T) => string; limit?: number; activity?: (row: T) => number;
  } = {},
) {
  const inheritedScope = useContext(Scope);
  const scope = explicitScope === undefined ? inheritedScope : explicitScope;
  const { store, snapshot, ready } = useListOrder(scope, kind);
  const t = useT();
  const listId = useId();
  const groups = [...new Set(rows.map(group))];
  const ordered = groups.flatMap(key => kind === "sessions" && activity
    ? projectSessionOrder(rows.filter(row => group(row) === key), snapshot.ids, Date.parse(snapshot.updatedAt ?? "") || 0, activity)
    : projectListOrder(rows.filter(row => group(row) === key), snapshot.ids, row => row.id));
  const visible = ordered.slice(0, limit);
  const [indicator, setIndicator] = useState<{ id: string; target: string | null; edge: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const latest = useRef({ visible, ordered, group, store, disabled, active: true });
  const generation = useRef(0);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const suppressClick = useRef(0);
  useLayoutEffect(() => { generation.current += 1; }, [store]);
  useLayoutEffect(() => { latest.current = { visible, ordered, group, store, disabled, active: true }; });

  function cancel(announce = true) {
    const state = drag.current;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setIndicator(null);
    if (state?.engaged) {
      suppressClick.current = performance.now() + 500;
      if (announce) setAnnouncement(t("listOrder.cancelled"));
    }
    try { if (state?.button.hasPointerCapture(state.pointer)) state.button.releasePointerCapture(state.pointer); } catch { /* already released */ }
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || !drag.current) return;
      event.preventDefault(); event.stopPropagation();
      suppressClick.current = performance.now() + 500;
      drag.current.button.focus({ preventScroll: true }); cancel();
    };
    window.addEventListener("keydown", escape, true);
    const blur = () => cancel();
    window.addEventListener("blur", blur);
    return () => {
      if (latest.current.store === store) latest.current.active = false;
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", blur);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      drag.current = null;
    };
    // Event handlers deliberately read the current authorized projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  function allowed(id: string, target: string, owner = store) {
    const state = latest.current;
    if (!state.active || state.disabled || state.store !== owner) return [];
    const source = state.visible.find(row => row.id === id);
    const destination = state.visible.find(row => row.id === target);
    if (!source || !destination || state.group(source) !== state.group(destination)) return [];
    return state.visible.filter(row => state.group(row) === state.group(source)).map(row => row.id);
  }
  function move(id: string, target: string, edge: "before" | "after") {
    if (!store) return;
    const attempt = generation.current;
    void store.move(() => generation.current === attempt ? allowed(id, target) : [], id, target, edge, kind === "sessions" && activity ? { revision: snapshot.revision, ids: () => latest.current.ordered.map(row => row.id) } : undefined).then(saved => {
      if (latest.current.active && latest.current.store === store) setAnnouncement(saved ? t("listOrder.saved") : store.getSnapshot().status === "error" ? "" : t("listOrder.cancelled"));
    });
  }
  function locate() {
    const state = drag.current;
    if (!state?.engaged) return;
    state.target = null;
    // Real hit testing respects overflow clipping, fixed chrome and viewport
    // boundaries. Offscreen rows still have rectangles; those are not targets.
    const element = document.elementFromPoint(state.x, state.y)?.closest<HTMLElement>("[data-order-list]");
    if (element?.dataset.orderList === listId) {
      const rect = element.getBoundingClientRect();
      const id = element.dataset.orderId!;
      if (id !== state.id && allowed(state.id, id).length) {
        state.target = id;
        state.edge = state.y < rect.top + rect.height / 2 ? "before" : "after";
      }
    }
    setIndicator({ id: state.id, target: state.target, edge: state.edge });
  }
  function autoScroll() {
    const state = drag.current;
    if (!state?.engaged) return;
    let parent = state.button.parentElement;
    while (parent && !(parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY))) parent = parent.parentElement;
    const scroller = parent ?? document.scrollingElement;
    if (scroller) {
      const bounds = parent?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
      if (state.x >= bounds.left && state.x <= bounds.right && state.y >= bounds.top && state.y <= bounds.bottom) {
        const delta = state.y < bounds.top + 32 ? -10 : state.y > bounds.bottom - 32 ? 10 : 0;
        if (delta) { scroller.scrollTop += delta; locate(); }
      }
    }
    frame.current = requestAnimationFrame(autoScroll);
  }
  function begin(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (disabled || !store || store.getSnapshot().status === "saving" || event.button !== 0 || !event.isPrimary) return;
    event.stopPropagation();
    drag.current = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, button: event.currentTarget, engaged: false, target: null, edge: "before" };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    state.x = event.clientX; state.y = event.clientY;
    if (!state.engaged) {
      const dx = state.x - state.startX, dy = state.y - state.startY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      if (Math.abs(dx) > Math.abs(dy)) { cancel(); return; }
      state.engaged = true;
      setAnnouncement(t("listOrder.dragging"));
      frame.current = requestAnimationFrame(autoScroll);
    }
    event.preventDefault(); event.stopPropagation(); locate();
  }
  function finish(event: PointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    // A tap opens the ordinary menu. A drag suppresses its synthetic click.
    if (state.engaged && state.target) move(state.id, state.target, state.edge);
    cancel(!state.engaged || !state.target);
  }
  function control(id: string): OrderControl | undefined {
    // Match SSR until useSyncExternalStore has read the client snapshot.
    if (!store || !ready) return undefined;
    const row = visible.find(item => item.id === id);
    const siblings = row ? visible.filter(item => group(item) === group(row)) : [];
    const index = siblings.findIndex(item => item.id === id);
    return {
      up: !disabled && snapshot.status !== "saving" && index > 0,
      down: !disabled && snapshot.status !== "saving" && index >= 0 && index < siblings.length - 1,
      canReset: !disabled && snapshot.status !== "saving" && (snapshot.ids.length > 0 || snapshot.status === "error"),
      reset() {
        if (disabled || store.getSnapshot().status === "saving") return;
        const attempt = generation.current;
        void store.reset(() => generation.current === attempt && latest.current.active && latest.current.store === store && !latest.current.disabled);
      },
      move(direction) {
        // Relative commands stay unavailable until their previous destination
        // is confirmed. Two fast presses must not target the same old neighbor.
        if (store.getSnapshot().status === "saving") return;
        const current = latest.current.visible.find(item => item.id === id);
        const currentRows = current ? latest.current.visible.filter(item => latest.current.group(item) === latest.current.group(current)) : [];
        const neighbor = currentRows[currentRows.findIndex(item => item.id === id) + direction];
        if (neighbor) move(id, neighbor.id, direction < 0 ? "before" : "after");
      },
      handleProps: {
        className: styles.handle,
        title: t(disabled ? "listOrder.clearSearch" : "listOrder.handle"),
        "aria-description": t(disabled ? "listOrder.clearSearch" : "listOrder.instructions"),
        onPointerDown: event => begin(event, id), onPointerMove: pointerMove, onPointerUp: finish,
        onPointerCancel: () => cancel(), onLostPointerCapture: () => cancel(),
        onClickCapture: event => {
          if (performance.now() < suppressClick.current) { event.preventDefault(); event.stopPropagation(); }
        },
      },
    };
  }
  function rowProps(id: string) {
    return { "data-order-list": listId, "data-order-id": id,
      "data-order-dragging": indicator?.id === id ? "true" : undefined,
      "data-order-edge": indicator?.target === id ? indicator.edge : undefined,
      className: styles.row };
  }
  return { ordered, visible, control, rowProps,
    notice: <><span className="sr-only" role="status" aria-live="polite">{announcement}</span>
      {snapshot.status === "error" ? <p className={styles.notice} role="alert">{t("listOrder.failed")}</p> : null}
      {snapshot.status === "saving" ? <span className={styles.notice} role="status">{t("listOrder.saving")}</span> : null}</>,
  };
}

export function ListOrderActions({ control, onMove }: { control: OrderControl; onMove?: () => void }) {
  const t = useT();
  return <>
    <button disabled={!control.up} onClick={() => { control.move(-1); onMove?.(); }} type="button"><ArrowUp aria-hidden="true" size={15} />{t("listOrder.up")}</button>
    <button disabled={!control.down} onClick={() => { control.move(1); onMove?.(); }} type="button"><ArrowDown aria-hidden="true" size={15} />{t("listOrder.down")}</button>
    <button disabled={!control.canReset} onClick={() => { control.reset(); onMove?.(); }} type="button"><ArrowCounterClockwise aria-hidden="true" size={15} />{t("listOrder.reset")}</button>
  </>;
}
export function ListOrderMenu({ control, label }: { control: OrderControl | undefined; label: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!control) return null;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button {...control.handleProps} title={open ? undefined : control.handleProps.title} aria-label={t("listOrder.forTitle", { title: label })} type="button"><DotsSixVertical aria-hidden="true" size={16} /></button></PopoverTrigger>
    <PopoverContent className={styles.menu} align="end" aria-label={t("listOrder.forTitle", { title: label })}>
      <ListOrderActions control={control} onMove={() => setOpen(false)} />
      <small>{t("listOrder.local")}</small>
    </PopoverContent>
  </Popover>;
}
