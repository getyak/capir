"use client";

import {
  ArrowClockwise,
  ArrowDown,
  DownloadSimple,
  LinkSimple,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import {
  installUpdateHref,
  useDesktopChrome,
  type DesktopChromeSnapshot,
} from "./desktop-chrome";
import styles from "./workspace-shell.module.css";

/**
 * The compact bottom-left workspace footer: account avatar, a flexible
 * Connect apps pill and a circular download/update entry.
 *
 * Geometry is CSS-only. Hovering or focusing the download entry contracts the
 * Connect apps pill to its icon while the entry widens in place (constant 224px
 * strip, 220ms easing, immediate under reduced motion). Hover never executes an
 * effect; only an explicit activation opens the entry's link.
 */

export function ConnectAppsPill() {
  return (
    <Link
      aria-label="连接应用（打开扩展工作区；不会自动连接任何服务）"
      className={styles.connectPill}
      href="/workspace/extensions"
    >
      <span className={styles.connectPillLabel}>连接应用</span>
      <LinkSimple aria-hidden="true" size={18} />
    </Link>
  );
}

function downloadTooltip(state: DesktopChromeSnapshot | null): {
  title: string;
  detail: string;
} {
  if (!state) return { title: "下载 capri", detail: "桌面与移动端安装与帮助" };
  if (state.phase === "downloading") {
    return {
      title: `正在下载更新${state.progress === null ? "" : ` ${state.progress}%`}`,
      detail: "下载与校验完成后会提示安装。",
    };
  }
  if (state.phase === "installing") {
    return { title: "正在更新并重启", detail: "本次更新由主机安装，请稍候。" };
  }
  if (state.phase === "failed") {
    return {
      title: "更新未完成",
      detail: "当前版本仍可使用；点击重试检查更新。",
    };
  }
  if (state.phase === "available" && state.version) {
    return state.legacy
      ? {
          title: `macOS ${state.version} 可用`,
          detail: "点击查看本次更新。",
        }
      : {
          title: `macOS ${state.version} 可用`,
          detail: "点击下载、校验并重启更新。",
        };
  }
  return { title: "下载 capri", detail: "桌面与移动端安装与帮助" };
}

function entryLabel(state: DesktopChromeSnapshot | null): {
  icon: ReactNode;
  text: string;
  ariaLabel: string;
  href: string | null;
  status: boolean;
} {
  const icon = <ArrowDown aria-hidden="true" size={15} weight="bold" />;
  if (!state) {
    return {
      icon: <DownloadSimple aria-hidden="true" size={15} weight="bold" />,
      text: "下载",
      ariaLabel: "下载 capri",
      href: "/download",
      status: false,
    };
  }
  if (state.phase === "downloading") {
    return {
      icon,
      text: state.progress === null ? "下载中" : `${state.progress}%`,
      ariaLabel: `正在下载更新${state.progress === null ? "" : ` ${state.progress}%`}`,
      href: null,
      status: true,
    };
  }
  if (state.phase === "installing") {
    return {
      icon,
      text: "更新中",
      ariaLabel: "正在更新并重启",
      href: null,
      status: true,
    };
  }
  if (state.phase === "failed") {
    return {
      icon: <ArrowClockwise aria-hidden="true" size={15} />,
      text: "重试更新",
      ariaLabel: "更新未完成，重新检查更新",
      href: "talentsignal-desktop://updates",
      status: false,
    };
  }
  if (state.phase === "available" && state.version) {
    return {
      icon,
      text: "更新",
      ariaLabel: state.legacy
        ? `查看 macOS ${state.version} 更新`
        : `更新至 macOS ${state.version} 并重启`,
      href: installUpdateHref(state),
      status: false,
    };
  }
  // Idle: download and help stay reachable without inventing an available release.
  return {
    icon: <DownloadSimple aria-hidden="true" size={15} weight="bold" />,
    text: "下载",
    ariaLabel: "下载 capri",
    href: "/download",
    status: false,
  };
}

/**
 * The circular download/update entry with its custom tooltip. A real host
 * available version appears in the tooltip above; no native title tooltip
 * duplicates it, and an idle host never shows an invented release.
 */
export function WorkspaceDownloadEntry() {
  const wrap = useRef<HTMLSpanElement>(null);
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
  const tooltip = downloadTooltip(state);
  const entry = entryLabel(state);
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
