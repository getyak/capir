"use client";

import type { ReactNode } from "react";
import { siteConfig } from "@/lib/site";
import type { ConversationWorkStatus } from "./conversation-feedback";
import styles from "./queued-conversation.module.css";

/**
 * One compact, truthful assistant work row beneath the sent message.
 *
 * The enclosing assistant message owns the single brand mark. This row
 * carries its name and a readable status derived only from observed state;
 * the outer mark may breathe while work is actually in flight. Stopped,
 * paused and failed turns never animate.
 */
export function ConversationWorkRow({ status, children }: { status: ConversationWorkStatus; children?: ReactNode }) {
  return (
    <div className={styles.workRow} data-conversation-work data-phase={status.phase} data-animate={status.animate ? "true" : "false"}>
      <span className={styles.workLabel}>
        {siteConfig.name}
      </span>
      <span className={styles.workStatus} role="status">{status.text}</span>
      {children}
    </div>
  );
}
