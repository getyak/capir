"use client";

import { clearTimeWorkspaceStorage } from "@/lib/time-workspace-storage";
import {
  CaretDown,
  CaretRight,
  DeviceMobile,
  Globe,
  Lifebuoy,
  SignOut,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  accountDisplayName,
  accountMenuLabel,
  accountWorkspaceLabel,
  type AccountIdentity,
} from "@/lib/workspace-account";
import {
  WEEKLY_ALLOWANCE_LABEL,
  WEEKLY_USAGE_LABEL,
  createWeeklyUsageStore,
  fetchWeeklyUsage,
  type WeeklyUsageStore,
  type WeeklyUsageView,
} from "@/lib/weekly-usage";
import { SupportEmailEntry } from "./support-email-entry";
import { DesktopAccountLink, DesktopAccountNotice, DesktopDeviceSettingsLink, DesktopUpdateBanner, useDesktopChrome } from "./desktop-chrome";
import { WorkspaceFooterStrip } from "./workspace-footer";
import { ThemeToggle } from "./theme-toggle";
import { clearAllPendingSessionDrafts } from "./session-workbench/session-draft-pending";
import { clearAllPendingMeetingDraftIntents } from "@/lib/meeting-draft-pending";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { AvatarEditor } from "./avatar-editor";
import styles from "./workspace-shell.module.css";

const noopSubscribe = () => () => {};
const loadingView: WeeklyUsageView = { status: "loading" };

function formatUsageWindow(start: string, end: string): string {
  const day = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat("zh-CN", {
          month: "long",
          day: "numeric",
          timeZone: "Asia/Shanghai",
        }).format(date);
  };
  return `${day(start)} – ${day(end)}`;
}

function formatUsageTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

/** Read-only weekly usage row with a disclosure; never fabricates a count. */
export function WeeklyUsageRow({ store }: { store: WeeklyUsageStore | null }) {
  const [open, setOpen] = useState(false);
  const view = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : () => loadingView,
    () => loadingView,
  );
  const usage = view.status === "ready" ? view.usage : null;
  return (
    <span className={styles.usageBlock}>
      <span className={styles.usageRow}>
        <button
          aria-expanded={open}
          className={styles.usageDisclosure}
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <CaretRight
            aria-hidden="true"
            className={styles.usageCaret}
            size={12}
            style={open ? { transform: "rotate(90deg)" } : undefined}
          />
          <span>{WEEKLY_USAGE_LABEL}</span>
        </button>
        <strong data-usage-state={view.status}>
          {view.status === "loading"
            ? "读取中…"
            : view.status === "error"
              ? "暂时无法读取"
              : view.usage.count}
        </strong>
        {view.status === "error" && store ? (
          <button
            className={styles.usageRetry}
            onClick={() => store.refresh()}
            type="button"
          >
            重试
          </button>
        ) : null}
      </span>
      {open ? (
        <span className={styles.usageDetail}>
          {usage ? (
            <>
              <span>
                {formatUsageWindow(usage.window.start, usage.window.end)} · 北京时间，每周一重置。
              </span>
              <span>
                {WEEKLY_ALLOWANCE_LABEL} {usage.allowance}，不限制使用，也不是付费余额。
              </span>
              <span>
                仅计保留的运行记录；重试不重复计数，非计费账单。
              </span>
              <span>读取于 {formatUsageTime(usage.computed_at)}</span>
            </>
          ) : view.status === "error" ? (
            <span>没有可用的用量数据。重试前不会显示数字。</span>
          ) : (
            <span>正在读取本周用量…</span>
          )}
        </span>
      ) : null}
    </span>
  );
}

export function WorkspaceAccountMenu({
  accountName,
  workspaceName,
  avatarUrl = null,
  fixtureWorkspace = false,
  signOutAction,
  usage: injectedUsage = null,
  usageBinding = null,
}: {
  accountName: string;
  workspaceName: string | null;
  avatarUrl?: string | null;
  fixtureWorkspace?: boolean;
  signOutAction: (formData: FormData) => void | Promise<void>;
  /** Synthetic usage store for previews and tests; production loads the API. */
  usage?: WeeklyUsageStore | null;
  /** Opaque binding to the rendered account, member and session. */
  usageBinding?: string | null;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const hosted = useDesktopChrome() !== null;
  const popover = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const scopeKey = usageBinding;
  const [usageScope, setUsageScope] = useState<{
    key: string | null;
    store: WeeklyUsageStore;
  } | null>(null);
  const identity: AccountIdentity = { accountName, workspaceName, avatarUrl };
  const displayName = accountDisplayName(identity);
  const workspaceLabel = accountWorkspaceLabel(identity);
  // A scope change drops the previous account's result before any new read.
  const usageStore =
    injectedUsage ?? (usageScope?.key === scopeKey ? usageScope.store : null);

  function clearPendingLocalIntents() {
    clearTimeWorkspaceStorage();
    clearAllPendingMeetingDraftIntents();
    // One partitioned store also removes any unsent conversation canvas intent.
    clearAllPendingSessionDrafts();
  }

  function close(returnFocus = false) {
    if (menu.current) menu.current.open = false;
    if (returnFocus) trigger.current?.focus();
  }

  function moveFocus(key: "ArrowDown" | "ArrowUp" | "End" | "Home") {
    const items = Array.from(
      popover.current?.querySelectorAll<HTMLElement>(
        "a[href],button:not([disabled]),summary",
      ) ?? [],
    ).filter((item) => {
      const closed = item.closest("details:not([open])");
      return !closed || item === closed.querySelector(":scope > summary");
    });
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let index: number;
    if (key === "Home") index = 0;
    else if (key === "End") index = items.length - 1;
    else if (current === -1) index = key === "ArrowUp" ? items.length - 1 : 0;
    else if (key === "ArrowDown") index = (current + 1) % items.length;
    else index = (current - 1 + items.length) % items.length;
    items[index]?.focus();
  }

  useEffect(() => () => usageScope?.store.dispose(), [usageScope]);

  useEffect(() => {
    const closeFromOutside = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-avatar-editor]")) return;
      if (
        menu.current?.open &&
        target instanceof Node &&
        !menu.current.contains(target)
      ) {
        close();
      }
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("focusin", closeFromOutside);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("focusin", closeFromOutside);
    };
  }, []);

  return (
    <WorkspaceFooterStrip>
    <details
      className={styles.accountMenu}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          const submenu = popover.current?.querySelector<HTMLDetailsElement>("details[open]");
          if (submenu) {
            submenu.open = false;
            submenu.querySelector("summary")?.focus();
          } else close(true);
        } else if (
          menu.current?.open &&
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          moveFocus(event.key as "ArrowDown" | "ArrowUp" | "End" | "Home");
        }
      }}
      onToggle={(event) => {
        if (!(event.currentTarget as HTMLDetailsElement).open) return;
        // The weekly usage read starts with this menu open, per current scope.
        if (!injectedUsage) {
          if (usageScope && usageScope.key === scopeKey) usageScope.store.refresh();
          else setUsageScope({ key: scopeKey, store: createWeeklyUsageStore(
            (signal) => fetchWeeklyUsage(signal, usageBinding),
          ) });
        }
      }}
      ref={menu}
    >
      <summary
        aria-label={accountMenuLabel(identity)}
        className={styles.accountTrigger}
        ref={trigger}
      >
        <PersonDirectoryAvatar id="self" self label={accountName} url={avatarUrl} className={styles.avatar} dataSize="account" />
        <span className={styles.accountName}>
          <strong>{displayName}</strong>
          <small>{workspaceLabel}</small>
        </span>
        <CaretDown aria-hidden="true" className={styles.accountChevron} size={12} />
      </summary>
      <div aria-label="账号与空间操作" className={styles.accountPopover} ref={popover}>
        <span className={styles.accountSummary}>
          <AvatarEditor id="self" self label={accountName} url={avatarUrl} size={44} />
          <span>
            <strong>{displayName}</strong>
            <small>{workspaceLabel}</small>
          </span>
        </span>
        <DesktopUpdateBanner onNavigate={() => close()} />
        <hr />
        <WeeklyUsageRow store={usageStore} />
        <a aria-label="在手机上使用 Talent Signal" href="/download" onClick={() => close()}>
          <DeviceMobile aria-hidden="true" size={16} />
          <span>移动端 Talent Signal</span>
        </a>
        <details className={styles.accountSubmenu}>
          <summary aria-label="帮助与支持">
            <Lifebuoy aria-hidden="true" size={16} />
            <span>帮助与支持</span>
            <CaretRight aria-hidden="true" className={styles.submenuCaret} size={12} />
          </summary>
          <div className={styles.submenuPanel}>
            <a href={hosted ? "talentsignal-desktop://settings" : "/workspace/settings/diagnostics"} onClick={() => close()}>
              <span>{hosted ? "此 Mac 设置与检测" : "系统检测"}</span>
            </a>
            <a href="/workspace/settings" onClick={() => close()}>
              <span>工作区设置</span>
            </a>
            <SupportEmailEntry subject="Talent Signal 支持" onNavigate={() => close()}>
              <span>邮件联系支持 ↗</span>
            </SupportEmailEntry>
          </div>
        </details>
        <hr />
        <DesktopAccountLink onClick={() => close()} />
        <DesktopAccountNotice />
        <DesktopDeviceSettingsLink onClick={() => close()} />
        <span className={styles.accountMetaRow}>
          <Globe aria-hidden="true" size={16} />
          <span>语言</span>
          <strong>简体中文</strong>
        </span>
        <ThemeToggle label="切换工作区明暗主题" showValue variant="row" />
        <hr />
        {fixtureWorkspace ? (
          <span className={styles.accountMetaRow}>
            <span>工作区</span>
            <strong>合成测试空间</strong>
          </span>
        ) : null}
        <form action={signOutAction} onSubmit={clearPendingLocalIntents}>
          <button type="submit">
            <SignOut aria-hidden="true" size={16} />
            <span>退出登录</span>
          </button>
        </form>
      </div>
    </details>
    </WorkspaceFooterStrip>
  );
}
