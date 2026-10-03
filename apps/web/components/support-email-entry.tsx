"use client";

import { useState, type ReactNode } from "react";
import { siteConfig } from "@/lib/site";
import { useDesktopChrome } from "./desktop-chrome";
import styles from "./workspace-shell.module.css";

/** Older hosts cancel mailto. Give them a usable address rather than a dead link. */
export function SupportEmailEntry({ children, subject, onNavigate }: {
  children: ReactNode;
  subject?: string;
  onNavigate?: () => void;
}) {
  const host = useDesktopChrome();
  const [copied, setCopied] = useState(false);
  if (!host || host.supportMailHandoff) {
    return <a href={`mailto:${siteConfig.email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`}
      onClick={host ? undefined : onNavigate}>{children}</a>;
  }
  return <span className={styles.supportEmailFallback}>
    <button className={styles.supportEmailButton} type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(siteConfig.email); setCopied(true); }
      catch { setCopied(false); }
    }}>{copied ? "已复制支持邮箱" : "复制支持邮箱"}</button>
    <small aria-live="polite">{siteConfig.email} · 在邮件应用中联系</small>
  </span>;
}
