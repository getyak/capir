"use client";

import type { ReactNode } from "react";
import { siteConfig } from "@/lib/site";
import type { ConversationWorkStatus } from "./conversation-feedback";
import styles from "./queued-conversation.module.css";

/**
 * One compact, truthful assistant work row beneath the sent message.
 *
 * It carries the current monochrome brand mark with the existing product
 * identity label and a readable status derived only from observed state. The
 * restrained pulse runs only while work is actually in flight; stopped,
 * paused and failed turns never animate, and prefers-reduced-motion disables
 * the animation in CSS.
 */
export function ConversationWorkRow({ status, children }: { status: ConversationWorkStatus; children?: ReactNode }) {
  return (
    <div className={styles.workRow} data-conversation-work data-phase={status.phase} data-animate={status.animate ? "true" : "false"}>
      <span className={styles.workLabel}>
        <span className={styles.mark} aria-hidden="true" data-work-mark />
        {siteConfig.name}
      </span>
      <span className={styles.workStatus} role="status">{status.text}</span>
      {status.animate && <span className={styles.pulse} aria-hidden="true" />}
      {children}
    </div>
  );
}
