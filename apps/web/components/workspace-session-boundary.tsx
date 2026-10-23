"use client";

import { useEffect, useState, type ReactNode } from "react";
import { backendSessionRecoveryHref } from "@/lib/backend-session";
import { useDesktopChrome } from "./desktop-chrome";
import { useLocale, useT } from "./locale-provider";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
import styles from "./account-settings.module.css";

/** Confirmed credential loss removes mounted private content, including chrome.
 * Network failures do not dispatch this event and retain their local recovery. */
export function WorkspaceSessionBoundary({ children }: { children: ReactNode }) {
  const [recoveryHref, setRecoveryHref] = useState<string | null>(null);
  const hosted = useDesktopChrome() !== null;
  const locale = useLocale();
  const t = useT();
  useEffect(() => {
    const expire = () => setRecoveryHref(backendSessionRecoveryHref(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    ));
    window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
  }, []);
  useEffect(() => {
    // Native intercepts an actual main-frame /login navigation before it paints.
    // A client-side error view or Next.js transition alone never reaches that
    // policy. This is only a recovery request; the host still owns authentication.
    if (recoveryHref && hosted) window.location.replace(recoveryHref);
  }, [recoveryHref, hosted]);
  if (!recoveryHref) return children;
  return <main lang={locale} className={`ts-workspace-theme quiet-workspace ${styles.page}`}>
    <section className={styles.section} role="alert">
      <h1>{t("登录已失效")}</h1>
      <p>{t("当前登录无法继续访问这个空间。重新登录后，再核对最新内容。")}</p>
      <a href={recoveryHref}>{t("重新登录")}</a>
    </section>
  </main>;
}
