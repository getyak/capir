"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import type { MarketingLocale } from "@/lib/marketing-locale";
import styles from "./download.module.css";

export function CopyCode({ code, label, locale }: { code: string; label: string; locale: MarketingLocale }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const generation = useRef(0);
  const id = useId();
  const en = locale === "en";
  useEffect(() => { generation.current += 1; }, [code]);
  async function copy() {
    const attempt = ++generation.current;
    setState("idle");
    try {
      await navigator.clipboard.writeText(code);
      if (attempt === generation.current) setState("copied");
    } catch {
      if (attempt === generation.current) setState("failed");
    }
  }
  // Keying the component by the selected setup prevents stale feedback.
  return <div className={styles.codeBox}>
    <div className={styles.codeHeader}>
      <span id={id}>{label}</span>
      <button type="button" onClick={() => void copy()} aria-label={`${en ? "Copy" : "复制"} ${label}`}>
        {state === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        {state === "copied" ? (en ? "Copied" : "已复制") : (en ? "Copy" : "复制")}
      </button>
    </div>
    <pre tabIndex={0} aria-labelledby={id}><code>{code}</code></pre>
    <p className={styles.copyStatus} role="status">
      {state === "failed" ? (en ? "Copy unavailable. Select the text above and copy it manually." : "无法访问剪贴板。请选中上方文本，手动复制。") : state === "copied" ? (en ? "Copied to clipboard." : "已复制到剪贴板。") : "\u00a0"}
    </p>
  </div>;
}
