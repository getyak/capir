"use client";

import { clearTimeWorkspaceStorage } from "@/lib/time-workspace-storage";
import {
  CaretDown,
  Globe,
  SignOut,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import {
  accountDisplayName,
  accountMenuLabel,
  accountWorkspaceLabel,
  type AccountIdentity,
} from "@/lib/workspace-account";
import { clearAllSessionOrganization } from "@/lib/workspace-session-organization";
import { DesktopAccountLink, DesktopDeviceSettingsLink, DesktopUpdateButton } from "./desktop-chrome";
import { ThemeToggle } from "./theme-toggle";
import { clearAllPendingSessionDrafts } from "./session-workbench/session-draft-pending";
import { clearAllPendingMeetingDraftIntents } from "@/lib/meeting-draft-pending";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { AvatarEditor } from "./avatar-editor";
import styles from "./workspace-shell.module.css";


export function WorkspaceAccountMenu({
  accountName,
  workspaceName,
  avatarUrl = null,
  fixtureWorkspace = false,
  signOutAction,
}: {
  accountName: string;
  workspaceName: string | null;
  avatarUrl?: string | null;
  fixtureWorkspace?: boolean;
  signOutAction: (formData: FormData) => void | Promise<void>;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const identity: AccountIdentity = { accountName, workspaceName, avatarUrl };
  const displayName = accountDisplayName(identity);
  const workspaceLabel = accountWorkspaceLabel(identity);

  function clearPendingLocalIntents() {
    clearTimeWorkspaceStorage();
    clearAllPendingMeetingDraftIntents();
    // One partitioned store also removes any unsent conversation canvas intent.
    clearAllPendingSessionDrafts();
    // Local list organization (archive/pin) leaves with the same boundary, so
    // no account can inherit another's local projection on this browser.
    clearAllSessionOrganization();
  }

  function close(returnFocus = false) {
    if (menu.current) menu.current.open = false;
    if (returnFocus) trigger.current?.focus();
  }

  function moveFocus(key: "ArrowDown" | "ArrowUp" | "End" | "Home") {
    const items = Array.from(
      popover.current?.querySelectorAll<HTMLElement>(
        "a[href],button:not([disabled])",
      ) ?? [],
    );
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
    <div className={styles.accountControls}>
    <details
      className={styles.accountMenu}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(true);
        } else if (
          menu.current?.open &&
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          moveFocus(event.key as "ArrowDown" | "ArrowUp" | "End" | "Home");
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
        <hr />
        <DesktopAccountLink onClick={() => close()} />
        <span className={styles.accountMetaRow}>
          <span aria-label="账号与偏好会在此账号的默认浏览器中打开；浏览器的登录状态可能与本应用不同。">
            在此账号的默认浏览器中打开 · 浏览器登录状态可能与本应用不同
          </span>
        </span>
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
    <DesktopUpdateButton />
    </div>
  );
}
