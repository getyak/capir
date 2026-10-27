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
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { beginWorkspaceSignOut, completeWorkspaceSignOut, observeWorkspaceSignOutBinding, releaseWorkspaceSignOut, workspaceSignOutAttemptIsCurrent } from "./workspace-signout-state";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { confirmedWorkspaceSignOut, type WorkspaceSignOutResult } from "@/lib/workspace-signout";
import { LOCALE_ENDONYMS } from "@talent-signal/contracts";
import { useAccountLanguage, useLocale, useT } from "./locale-provider";

import {
  accountDisplayName,
  type AccountIdentity,
} from "@/lib/workspace-account";
import {
  WEEKLY_USAGE_LABEL,
  createWeeklyUsageStore,
  fetchWeeklyUsage,
  type WeeklyUsageStore,
  type WeeklyUsageView,
} from "@/lib/weekly-usage";
import { clearAllSessionOrganization } from "@/lib/workspace-session-organization";
import { subscribeTheme } from "@/lib/theme-preference";
import { SupportEmailEntry } from "./support-email-entry";
import { DesktopAccountLink, DesktopDeviceSettingsLink, DesktopUpdateBanner, useDesktopChrome } from "./desktop-chrome";
import { WorkspaceFooterStrip } from "./workspace-footer";
import { ThemeToggle } from "./theme-toggle";
import { clearAllPendingSessionDrafts } from "./session-workbench/session-draft-pending";
import { clearAllPendingMeetingDraftIntents } from "@/lib/meeting-draft-pending";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { AvatarEditor } from "./avatar-editor";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import styles from "./workspace-shell.module.css";

type SignOutIssue =
  | { binding: string | null; kind: "stale_action" | "unconfirmed" | "scope_changed" }
  | { binding: string; kind: "confirmed_local"; redirectTo: Extract<WorkspaceSignOutResult, { status: "signed_out" }>["redirectTo"] };

const noopSubscribe = () => () => {};
const loadingView: WeeklyUsageView = { status: "loading" };

function formatUsageWindow(start: string, end: string, locale: string): string {
  const day = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat(locale, {
          month: "long",
          day: "numeric",
          timeZone: "Asia/Shanghai",
        }).format(date);
  };
  return `${day(start)} – ${day(end)}`;
}

function formatUsageTime(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

/** Read-only weekly usage row with a disclosure; never fabricates a count. */
export function WeeklyUsageRow({ store }: { store: WeeklyUsageStore | null }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const disclosure = useRef<HTMLButtonElement>(null);
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
          ref={disclosure}
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <CaretRight
            aria-hidden="true"
            className={styles.usageCaret}
            size={12}
            style={open ? { transform: "rotate(90deg)" } : undefined}
          />
          <span>{t(WEEKLY_USAGE_LABEL)}</span>
        </button>
        <strong data-usage-state={view.status}>
          {view.status === "loading"
            ? t("读取中…")
            : view.status === "error"
              ? t("暂时无法读取")
              : view.usage.count}
        </strong>
        {view.status === "error" && store ? (
          <button
            className={styles.usageRetry}
            onClick={() => {
              // The retry disappears while loading; retain a stable focus target.
              disclosure.current?.focus();
              store.refresh();
            }}
            type="button"
          >
            {t("重试")}
          </button>
        ) : null}
      </span>
      {open ? (
        <span className={styles.usageDetail}>
          {usage ? (
            <>
              <span>
                {t("{window} · 北京时间，每周一重置。", { window: formatUsageWindow(usage.window.start, usage.window.end, locale) })}
              </span>
              <span>
                {t("每周参考额度 {allowance}，不限制使用，也不是付费余额。", { allowance: usage.allowance })}
              </span>
              <span>
                {t("仅计保留的运行记录；重试不重复计数，非计费账单。")}
              </span>
              <span>{t("读取于 {time}", { time: formatUsageTime(usage.computed_at, locale) })}</span>
            </>
          ) : view.status === "error" ? (
            <span>{t("没有可用的用量数据。重试前不会显示数字。")}</span>
          ) : (
            <span>{t("正在读取本周用量…")}</span>
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
  signOutAction: (formData: FormData) => unknown | Promise<unknown>;
  /** Synthetic usage store for previews and tests; production loads the API. */
  usage?: WeeklyUsageStore | null;
  /** Opaque binding to the rendered account, member and session. */
  usageBinding?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutIssue, setSignOutIssue] = useState<SignOutIssue | null>(null);
  const activeSignOutIssue = signOutIssue?.binding === usageBinding ? signOutIssue : null;
  const signOutBusy = useRef(false);
  useLayoutEffect(() => observeWorkspaceSignOutBinding(usageBinding), [usageBinding]);
  const hosted = useDesktopChrome() !== null;
  const locale = useLocale();
  const language = useAccountLanguage();
  const t = useT();
  const languageValue = language === "system"
    ? `${t("language.option.system")} · ${LOCALE_ENDONYMS[locale]}`
    : language === null
      ? t("language.preference.unavailable", { language: LOCALE_ENDONYMS[locale] })
      : LOCALE_ENDONYMS[language];
  const popover = useRef<HTMLDivElement>(null);
  const scopeKey = usageBinding;
  const [usageScope, setUsageScope] = useState<{
    key: string | null;
    store: WeeklyUsageStore;
  } | null>(null);
  const identity: AccountIdentity = { accountName, workspaceName, avatarUrl };
  const displayName = accountName.trim() ? accountDisplayName(identity) : t("账号");
  const workspaceLabel = workspaceName?.trim() || t("个人工作区");
  // A scope change drops the previous account's result before any new read.
  const usageStore =
    injectedUsage ?? (usageScope?.key === scopeKey ? usageScope.store : null);

  function clearPendingLocalIntents() {
    clearTimeWorkspaceStorage();
    clearAllPendingMeetingDraftIntents();
    // One partitioned store also removes any unsent conversation canvas intent.
    clearAllPendingSessionDrafts();
    // Local list organization (archive/pin) leaves with the same boundary, so
    // no account can inherit another's local projection on this browser.
    clearAllSessionOrganization();
  }

  async function submitSignOut(formData: FormData) {
    if (signOutBusy.current || activeSignOutIssue?.kind === "confirmed_local") return;
    const binding = usageBinding;
    if (!binding) { setSignOutIssue({ binding, kind: "scope_changed" }); return; }
    const attempt = beginWorkspaceSignOut(binding);
    if (!attempt) return;
    signOutBusy.current = true;
    setSigningOut(true);
    setSignOutIssue(null);
    formData.set("workspaceBinding", binding);
    let result: unknown;
    try {
      result = await signOutAction(formData);
    } catch (error) {
      if (workspaceSignOutAttemptIsCurrent(attempt)) {
        setSignOutIssue({ binding, kind: unstable_isUnrecognizedActionError(error) ? "stale_action" : "unconfirmed" });
      }
      return;
    } finally {
      releaseWorkspaceSignOut(attempt);
      signOutBusy.current = false;
      setSigningOut(false);
    }
    if (!workspaceSignOutAttemptIsCurrent(attempt)) return;
    if (!confirmedWorkspaceSignOut(result, binding, hosted)) {
      setSignOutIssue({ binding, kind: result && typeof result === "object" && "status" in result && result.status === "scope_changed" ? "scope_changed" : "unconfirmed" });
      return;
    }
    let fenced = false;
    flushSync(() => { fenced = completeWorkspaceSignOut(result, attempt, hosted); });
    if (!fenced) return;
    // Local sign-out is already verified. Cleanup may have partially completed
    // if storage or navigation throws; never describe that as a preserved draft.
    try {
      clearPendingLocalIntents();
      window.location.assign(result.redirectTo);
    } catch {
      setSignOutIssue({ binding, kind: "confirmed_local", redirectTo: result.redirectTo });
    }
  }

  function close() {
    setOpen(false);
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next || injectedUsage) return;
    // Start only on opening; scope changes never project a stale count.
    if (usageScope && usageScope.key === scopeKey) usageScope.store.refresh();
    else setUsageScope({ key: scopeKey, store: createWeeklyUsageStore(
      (signal) => fetchWeeklyUsage(signal, usageBinding),
    ) });
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

  // The workspace follows system and other-window changes even while the
  // account popover (and its ThemeToggle subscriber) is unmounted.
  useEffect(() => subscribeTheme(() => {}), []);
  useEffect(() => () => usageScope?.store.dispose(), [usageScope]);

  return (
    <WorkspaceFooterStrip>
      <div className={styles.accountMenu}>
        <Popover open={open} onOpenChange={changeOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-slot="account-trigger"
              aria-label={`${displayName} · ${workspaceLabel}`}
              className={styles.accountTrigger}
            >
              <PersonDirectoryAvatar id="self" self label={accountName} url={avatarUrl} className={styles.avatar} dataSize="account" />
              <span className={styles.accountName}>
                <strong>{displayName}</strong>
                <small>{workspaceLabel}</small>
              </span>
              <CaretDown aria-hidden="true" className={styles.accountChevron} size={12} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            aria-label={t("账号与空间操作")}
            className={styles.accountPopover}
            side="top"
            ref={popover}
            onEscapeKeyDown={(event) => {
              // During a fast modal mount our capture listener can still be
              // registered. Escape belongs to the editor, never its parent.
              if (event.target instanceof Element && event.target.closest("[data-avatar-editor]")) {
                event.preventDefault();
                return;
              }
              const submenu = popover.current?.querySelector<HTMLDetailsElement>("details[open]");
              if (!submenu) return;
              event.preventDefault();
              submenu.open = false;
              submenu.querySelector("summary")?.focus();
            }}
            onInteractOutside={(event) => {
              // The avatar modal owns its own dismissal and restores its trigger.
              const target = event.detail.originalEvent.target;
              if (target instanceof Element && target.closest("[data-avatar-editor]")) event.preventDefault();
            }}
            onKeyDown={(event) => {
              if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              const target = event.target;
              if (target instanceof Element && target.closest("input,textarea,select,[contenteditable=true]")) return;
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                moveFocus(event.key as "ArrowDown" | "ArrowUp" | "End" | "Home");
              }
            }}
          >
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
            <a aria-label={t("在手机上使用 capri")} href="/download" onClick={() => close()}>
              <DeviceMobile aria-hidden="true" size={16} />
              <span>{t("移动端 capri")}</span>
            </a>
            <details className={styles.accountSubmenu}>
              <summary aria-label={t("帮助与支持")}>
                <Lifebuoy aria-hidden="true" size={16} />
                <span>{t("帮助与支持")}</span>
                <CaretRight aria-hidden="true" className={styles.submenuCaret} size={12} />
              </summary>
              <div className={styles.submenuPanel}>
                <a href={hosted ? "talentsignal-desktop://settings" : "/workspace/settings/diagnostics"} onClick={() => close()}>
                  <span>{t(hosted ? "此 Mac 设置与检测" : "系统检测")}</span>
                </a>
                <a href="/workspace/settings" onClick={() => close()}>
                  <span>{t("工作区设置")}</span>
                </a>
                <SupportEmailEntry subject={t("capri 支持")} onNavigate={() => close()}>
                  <span>{t("邮件联系支持 ↗")}</span>
                </SupportEmailEntry>
              </div>
            </details>
            <hr />
            <DesktopAccountLink onClick={() => close()} />
            <DesktopDeviceSettingsLink onClick={() => close()} />
            <span className={styles.accountMetaRow} role="group" aria-label={t("language.display.label")}>
              <Globe aria-hidden="true" size={16} />
              <span>{t("language.display.label")}</span>
              <strong>{languageValue}</strong>
            </span>
            <ThemeToggle label="切换工作区明暗主题" showValue variant="row" />
            <hr />
            {fixtureWorkspace ? (
              <span className={styles.accountMetaRow}>
                <span>{t("工作区")}</span>
                <strong>{t("合成测试空间")}</strong>
              </span>
            ) : null}
            <form action={submitSignOut}>
              <input type="hidden" name="desktopHost" value={String(hosted)} />
              <button type="submit" disabled={signingOut || activeSignOutIssue?.kind === "confirmed_local"}>
                <SignOut aria-hidden="true" size={16} />
                <span>{t(signingOut ? "正在退出登录…" : "退出登录")}</span>
              </button>
              {activeSignOutIssue ? <div role="alert">
                {activeSignOutIssue.kind === "confirmed_local" ? <>
                  <p>{t("页面登录已确认退出，但本地清理或页面跳转未完成。请打开退出后的页面继续。")}</p>
                  <a href={activeSignOutIssue.redirectTo}>{t("打开退出后的页面")}</a>
                </> : <>
                  <p>{t(activeSignOutIssue.kind === "stale_action"
                    ? "页面已更新。请重新载入后，再选择退出登录。本地草稿仍保留。"
                    : activeSignOutIssue.kind === "scope_changed"
                      ? "无法核验当前登录空间，未执行这次退出请求。请重新载入后核对当前账号。"
                      : "无法确认退出结果。本地草稿仍保留。请重新载入并核对当前账号，再决定是否重试。")}</p>
                  <button type="button" onClick={() => window.location.reload()}>{t("重新载入页面")}</button>
                </>}
              </div> : null}
            </form>
          </PopoverContent>
        </Popover>
      </div>
    </WorkspaceFooterStrip>
  );
}
