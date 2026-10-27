"use client";
import { PushPin } from "@phosphor-icons/react";
import { useT } from "./locale-provider";
import styles from "./workspace-pin-indicator.module.css";

/** State only. The row's named menu owns the reversible pin command. */
export function WorkspacePinIndicator() {
  const t = useT();
  return <span className={styles.pin}>
    <PushPin aria-hidden="true" size={12} weight="fill" />
    <span className="sr-only">{t("sessions.pinned")}</span>
  </span>;
}
