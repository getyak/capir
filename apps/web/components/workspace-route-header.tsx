"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Ghost } from "@phosphor-icons/react";

import {
  isWorkspaceHomePath,
  workspaceRouteLabel,
} from "@/lib/workspace-navigation";
import { useT } from "./locale-provider";
import styles from "./workspace-shell.module.css";

const SESSION_DETAIL = /^\/workspace\/sessions\/[^/]+$/u;

export function WorkspacePrivacyEntry({ mobile = false }: { mobile?: boolean }) {
  const t = useT();
  const pathname = usePathname();
  if (!isWorkspaceHomePath(pathname)) return null;
  return <Link href="/workspace/private" aria-label={t("隐私模式")} title={t("隐私模式")}
    className={`${styles.privacyEntry} ${mobile ? styles.mobilePrivacyEntry : ""}`}>
    <Ghost size={17} aria-hidden="true"/><span>{t("隐私模式")}</span>
  </Link>;
}

/**
 * The 58px route header. It states where the user is for directory surfaces.
 * A Session detail supplies all of its context in its own compact header, so
 * this shell header returns nothing there instead of repeating a crumb.
 */
export function WorkspaceRouteHeader() {
  const t = useT();
  const pathname = usePathname();

  if (SESSION_DETAIL.test(pathname)) return null;

  const label = workspaceRouteLabel(pathname);

  return (
    <header className={styles.routeHeader}>
      <div className={styles.crumb}>
        <strong>{t(isWorkspaceHomePath(pathname) ? "新对话" : label)}</strong>
      </div>
      <WorkspacePrivacyEntry />
    </header>
  );
}
