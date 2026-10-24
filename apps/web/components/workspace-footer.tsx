"use client";

import {
  ArrowClockwise,
  ArrowDown,
  DownloadSimple,
  LinkSimple,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import {
  installUpdateHref,
  useDesktopChrome,
  type DesktopChromeSnapshot,
} from "./desktop-chrome";
import { useT, type TFunction } from "./locale-provider";
import styles from "./workspace-shell.module.css";

/**
 * The compact bottom-left workspace footer: account avatar, a flexible
 * Connect apps link and a compact download/update control.
 *
 * Labels remain visible in the expanded sidebar, with stable targets on hover
 * and focus. Hover never executes an effect; only an explicit activation opens
 * the entry's link.
 */

export function ConnectAppsPill() {
  const t = useT();
  return (
    <Link
      aria-label={t("连接应用（打开扩展工作区；不会自动连接任何服务）")}
      className={styles.connectPill}
      href="/workspace/extensions"
    >
      <LinkSimple aria-hidden="true" size={16} />
      <span className={styles.connectPillLabel}>{t("连接应用")}</span>
    </Link>
  );
}

function downloadTooltip(state: DesktopChromeSnapshot | null, t: TFunction): {
  title: string;
  detail: string;
} {
  if (!state) return { title: t("下载 capri"), detail: t("桌面与移动端安装与帮助") };
  if (state.phase === "downloading") {
    return {
      title: t("desktop.update.downloading", { progress: state.progress === null ? "" : ` ${state.progress}%` }),
      detail: t("正在完成已授权的更新，校验后将安装并重启。"),
    };
  }
  if (state.phase === "installing") {
    return { title: t("正在更新并重启"), detail: t("本次更新由主机安装，请稍候。") };
  }
  if (state.phase === "failed") {
    return {
      title: t("更新未完成"),
      detail: t("当前版本仍可使用；点击重试检查更新。"),
    };
  }
  if (state.phase === "available" && state.version) {
    return state.legacy
      ? {
          title: t("desktop.update.available", { version: state.version }),
          detail: t("点击查看本次更新。"),
        }
      : {
          title: t("desktop.update.available", { version: state.version }),
          detail: t("点击下载、校验并重启更新。"),
        };
  }
  return { title: t("下载 capri"), detail: t("桌面与移动端安装与帮助") };
}

function entryLabel(state: DesktopChromeSnapshot | null, t: TFunction): {
  icon: ReactNode;
  text: string;
  ariaLabel: string;
  href: string | null;
  status: boolean;
} {
  const icon = <DownloadSimple aria-hidden="true" size={16} />;
  if (!state) {
    return {
      icon,
      text: t("下载"),
      ariaLabel: t("下载 capri"),
      href: "/download",
      status: false,
    };
  }
  if (state.phase === "downloading") {
    return {
      icon: <ArrowDown aria-hidden="true" size={16} />,
      text: state.progress === null ? t("下载中") : `${state.progress}%`,
      ariaLabel: t("desktop.update.downloading", { progress: state.progress === null ? "" : ` ${state.progress}%` }),
      href: null,
      status: true,
    };
  }
  if (state.phase === "installing") {
    return {
      icon: <ArrowClockwise aria-hidden="true" size={16} />,
      text: t("更新中"),
      ariaLabel: t("正在更新并重启"),
      href: null,
      status: true,
    };
  }
  if (state.phase === "failed") {
    return {
      icon: <ArrowClockwise aria-hidden="true" size={16} />,
      text: t("重试"),
      ariaLabel: t("更新未完成，重新检查更新"),
      href: "talentsignal-desktop://updates",
      status: false,
    };
  }
  if (state.phase === "available" && state.version) {
    return {
      icon,
      text: t("更新"),
      ariaLabel: state.legacy
        ? t("desktop.update.view", { version: state.version })
        : t("desktop.update.install", { version: state.version }),
      href: installUpdateHref(state),
      status: false,
    };
  }
  // Idle: download and help stay reachable without inventing an available release.
  return {
    icon,
    text: t("下载"),
    ariaLabel: t("下载 capri"),
    href: "/download",
    status: false,
  };
}

/**
 * The download/update control with its custom tooltip. A real host
 * available version appears in the tooltip above; no native title tooltip
 * duplicates it, and an idle host never shows an invented release.
 */
export function WorkspaceDownloadEntry() {
  const t = useT();
  const wrap = useRef<HTMLSpanElement>(null);
  const control = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const controlRef = useCallback((node: HTMLElement | null) => {
    if (!node) restoreFocus.current = document.activeElement === control.current;
    control.current = node;
    if (node && restoreFocus.current) {
      restoreFocus.current = false;
      node.focus();
    }
  }, []);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape" && wrap.current?.matches(":hover, :focus-within")) setDismissed(true);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, []);
  const state = useDesktopChrome();
  const tooltipId = useId();
  const tooltip = downloadTooltip(state, t);
  const entry = entryLabel(state, t);
  const inner = (
    <>
      {entry.icon}
      <span className={styles.footerEntryLabel}>{entry.text}</span>
    </>
  );
  return (
    <span className={styles.footerEntryWrap} ref={wrap} data-dismissed={dismissed}
      onMouseEnter={() => setDismissed(false)} onFocus={() => setDismissed(false)}>
      {entry.status ? (
        <span
          aria-describedby={tooltipId}
          aria-label={entry.ariaLabel}
          className={styles.footerEntry}
          data-interactive="false"
          data-phase={state?.phase}
          role="status"
          tabIndex={0}
          ref={controlRef}
        >
          {inner}
        </span>
      ) : (
        <a
          aria-describedby={tooltipId}
          aria-label={entry.ariaLabel}
          className={styles.footerEntry}
          data-phase={state?.phase}
          href={entry.href ?? "/download"}
          ref={controlRef}
        >
          {inner}
        </a>
      )}
      <span className={styles.footerTooltip} id={tooltipId} role="tooltip">
        <strong>{tooltip.title}</strong>
        <small>{tooltip.detail}</small>
      </span>
    </span>
  );
}

/**
 * The bottom-left strip shares account and connections across Web and macOS.
 * A download/update entry appears only for a real native update state.
 */
export function WorkspaceFooterStrip({ children }: { children: ReactNode }) {
  const state = useDesktopChrome();
  const hosted = state !== null;
  const showUpdate = Boolean(state && state.phase !== "idle");
  return (
    <div className={styles.accountStrip} data-hosted={hosted ? "true" : "false"}>
      {children}
      <ConnectAppsPill />
      {showUpdate ? <WorkspaceDownloadEntry /> : null}
    </div>
  );
}
