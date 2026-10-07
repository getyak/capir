"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { backendSessionRecoveryHref } from "@/lib/backend-session";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
import styles from "./account-settings.module.css";

/** Confirmed credential loss removes mounted private content, including chrome.
 * Network failures do not dispatch this event and retain their local recovery. */
export function WorkspaceSessionBoundary({ children }: { children: ReactNode }) {
  const [recoveryHref, setRecoveryHref] = useState<string | null>(null);
  useEffect(() => {
    const expire = () => setRecoveryHref(backendSessionRecoveryHref(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    ));
    window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
  }, []);
  if (!recoveryHref) return children;
  return <main lang="zh-CN" className={`ts-workspace-theme quiet-workspace ${styles.page}`}>
    <section className={styles.section} role="alert">
      <h1>登录已失效</h1>
      <p>当前登录无法继续访问这个空间。重新登录后，再核对最新内容。</p>
      <Link href={recoveryHref}>重新登录</Link>
    </section>
  </main>;
}
