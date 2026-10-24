"use client";

import { useT } from "@/components/locale-provider";
import styles from "./workspace-loading.module.css";

/**
 * Route-neutral skeleton for the workspace stage.
 *
 * The shell already persists across navigation, so this boundary must read as
 * the destination loading *in place* — not as a second page hero. The visible
 * surface is only structure (title + content blocks); the route-neutral status
 * copy stays available to assistive technology without being repeated on
 * screen on every navigation.
 */
export default function WorkspaceLoading() {
  const t = useT();
  return (
    <main id="main-content" className={styles.loading} tabIndex={-1}>
      <p className={styles.status} role="status" aria-live="polite">
        {t("workspace.loading.status")}
      </p>
      <p className={styles.assistive}>
        {t("workspace.loading.hint")}
      </p>
      <div aria-hidden="true" className={styles.skeleton}>
        <i className={styles.skeletonTitle} />
        <i />
        <i />
        <i className={styles.skeletonShort} />
      </div>
    </main>
  );
}
