"use client";

import { useState } from "react";

import {
  type LegacyConversationRecovery,
} from "@/lib/conversation-legacy";
import { useLocale, useT } from "../locale-provider";
import styles from "./queued-conversation.module.css";

/**
 * One compact, truthful notice for a legacy conversation-home send record.
 *
 * The queue surface cannot prove an old blocking send was delivered, so the
 * notice states only what is known and never invents a status. The exact
 * original content stays one deliberate step away. Do not link to the legacy
 * Session controller: it can rebase an uncertain home send as a new draft.
 * Nothing here submits, re-keys, converts or removes the original record.
 */
export function LegacyRecoveryNotice({
  recovery,
}: {
  recovery: LegacyConversationRecovery;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const submission =
    recovery.delivery === "attempted" ? "上次提交结果未确认" : "是否已提交未知";
  return (
    <section aria-label={t("旧版未完成消息")} className={styles.recovery}>
      <div className={styles.recoveryRow}>
        <p>
          {t("conversation.legacy.notice", { status: t(submission) })}
          <small>
            {t("conversation.legacy.expires", { date: new Date(recovery.expiresAt).toLocaleDateString(locale) })}
          </small>
        </p>
        <span className={styles.recoveryActions}>
          <button
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            {t(open ? "收起原文" : "查看原文")}
          </button>
        </span>
      </div>
      {open ? (
        <pre
          aria-label={t("旧版消息原文")}
          className={styles.recoveryContent}
          tabIndex={0}
        >
          {recovery.objective}
        </pre>
      ) : null}
    </section>
  );
}
