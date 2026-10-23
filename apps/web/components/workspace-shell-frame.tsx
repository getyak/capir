"use client";

import { useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import {
  SIDEBAR_HIDE_THRESHOLD,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useWorkspaceSidebarLayout,
  WorkspaceSidebarPresentation,
  type SidebarLayout,
} from "@/lib/workspace-sidebar-layout";
import { useT } from "./locale-provider";
import styles from "./workspace-shell.module.css";

const mobileSnapshot = () => window.matchMedia("(max-width: 760px)").matches;
function subscribeMobile(notify: () => void) {
  const query = window.matchMedia("(max-width: 760px)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}
function subscribeViewport(notify: () => void) {
  window.addEventListener("resize", notify);
  return () => window.removeEventListener("resize", notify);
}

/** Local presentation only; Session and account state remain server-owned. */
export function WorkspaceShellFrame({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const t = useT();
  const { layout, setLayout } = useWorkspaceSidebarLayout();
  const [preview, setPreview] = useState<SidebarLayout | null>(null);
  const mobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, () => false);
  const viewportWidth = useSyncExternalStore(subscribeViewport, () => window.innerWidth, () => 1024);
  const shell = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; initial: SidebarLayout; next: SidebarLayout } | null>(null);
  const sidebarId = useId();
  const current = preview ?? layout;
  const hidden = !mobile && current.hidden;
  const availableWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - 360));
  const width = current.hidden ? 0 : current.collapsed ? 72 : Math.min(availableWidth, current.width);

  function maxWidth() {
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, (shell.current?.clientWidth || window.innerWidth) - 360));
  }
  function resized(raw: number): SidebarLayout {
    return raw < SIDEBAR_HIDE_THRESHOLD
      ? { ...layout, hidden: true, collapsed: false }
      : { width: Math.round(Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxWidth(), raw))), hidden: false, collapsed: false };
  }
  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!cancelled) setLayout(active.next);
    setPreview(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && drag.current) {
      const pointerId = drag.current.pointerId;
      drag.current = null;
      setPreview(null);
      if (event.currentTarget.hasPointerCapture?.(pointerId)) event.currentTarget.releasePointerCapture(pointerId);
      event.preventDefault();
      return;
    }
    if (drag.current) return;
    let next: SidebarLayout;
    switch (event.key) {
      case "ArrowLeft": next = width <= SIDEBAR_MIN_WIDTH ? { ...layout, hidden: true, collapsed: false } : resized(width - 16); break;
      case "ArrowRight": next = resized(width < SIDEBAR_MIN_WIDTH ? SIDEBAR_MIN_WIDTH : width + 16); break;
      case "Home": next = { ...layout, hidden: true, collapsed: false }; break;
      case "End": next = resized(maxWidth()); break;
      case "Enter": next = { ...layout, hidden: !layout.hidden, collapsed: false }; break;
      default: return;
    }
    event.preventDefault();
    setLayout(next);
  }

  return (
    <div
      className={`ts-workspace-theme quiet-workspace ${styles.shell}`}
      data-sidebar-collapsed={current.collapsed}
      data-sidebar-compact={width < 248}
      data-sidebar-hidden={hidden}
      data-sidebar-resizing={preview !== null}
      lang="zh-CN"
      ref={shell}
      style={{ "--workspace-sidebar-width": `${width}px` } as CSSProperties}
    >
      <aside aria-hidden={hidden || undefined} aria-label={t("capri 工作台")} className={styles.sidebar} id={sidebarId} inert={hidden}>
        <WorkspaceSidebarPresentation value={current}>{sidebar}</WorkspaceSidebarPresentation>
      </aside>
      {children}
      <div
        aria-controls={sidebarId}
        aria-label={hidden ? t("显示侧边栏") : t("调整侧边栏宽度")}
        aria-orientation="vertical"
        aria-valuemax={availableWidth}
        aria-valuemin={0}
        aria-valuenow={width}
        aria-valuetext={hidden ? t("已隐藏，向右拖动或按回车显示") : current.collapsed ? t("紧凑侧栏") : t("{width} 像素", { width })}
        className={styles.sidebarResizeHandle}
        onDoubleClick={() => setLayout({ ...layout, hidden: false, collapsed: false })}
        onKeyDown={onKeyDown}
        onLostPointerCapture={event => finish(event, true)}
        onPointerCancel={event => finish(event, true)}
        onPointerDown={event => {
          if (mobile || event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, initial: layout, next: layout };
        }}
        onPointerMove={event => {
          const active = drag.current;
          if (!active || active.pointerId !== event.pointerId) return;
          if (Math.abs(event.clientX - active.startX) < 3) {
            active.next = active.initial;
            setPreview(null);
            return;
          }
          active.next = resized(active.startWidth + event.clientX - active.startX);
          setPreview(active.next);
        }}
        onPointerUp={event => finish(event)}
        role="separator"
        tabIndex={0}
        title={hidden ? t("向右拖动或双击显示侧边栏") : t("拖动调整宽度，向左收起")}
      />
    </div>
  );
}
