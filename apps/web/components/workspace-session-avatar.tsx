"use client";

import { ChatCircleDots } from "@phosphor-icons/react";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import styles from "./workspace-shell.module.css";

/** Recognize an existing person; otherwise identify only the conversation. */
export function WorkspaceSessionAvatar({ personId, label }: { personId: string | null; label: string }) {
  return personId ? (
    <PersonDirectoryAvatar className={styles.avatar} size={18} id={personId} label={label} />
  ) : (
    <span aria-hidden="true" className={styles.sessionMark}>
      <ChatCircleDots size={16} />
    </span>
  );
}
