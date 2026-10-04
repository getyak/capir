/**
 * Canonical capir test-space banner.
 *
 * Rendered only from the live canonical operator-owned run readback (never
 * from a cookie or account name). Protocol metadata (run/account/user ids,
 * run expiry, dataset state and counts) stays in hidden DOM attributes: the
 * DOM contract the owned browser runner verifies before reporting an entry
 * ready. Visible text is the quiet human summary.
 */
import type { CapirTestBannerData } from "@/lib/server/capir-test-entry";
import styles from "./capir-test-banner.module.css";

export type { CapirTestBannerData };

/** Concise deterministic deadline rendering (UTC, zh-CN product copy). */
export function formatDeadline(expiresAt: string): string {
  const at = new Date(expiresAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getUTCFullYear()}年${at.getUTCMonth() + 1}月${at.getUTCDate()}日 ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} (UTC)`;
}

export function CapirTestBanner({ banner }: { banner: CapirTestBannerData | null }) {
  if (!banner) return null;
  const datasetLabel = banner.datasetState === "ready" ? "合成数据已就绪" : "合成数据校验未通过";
  return (
    <aside
      className={styles.badge}
      role="status"
      data-capir-run-verification="true"
      data-capir-session-state={banner.sessionState}
      data-capir-run-state={banner.run.state}
      data-capir-demo-expiry={banner.expiresAt}
      data-capir-dataset-state={banner.datasetState}
      data-capir-contacts={String(banner.counts.contacts)}
      data-capir-observations={String(banner.counts.observations)}
      data-capir-tasks={String(banner.counts.tasks)}
      data-capir-run-id={banner.run.id}
      data-capir-account-id={banner.run.account_id}
      data-capir-user-id={banner.run.user_id}
      data-capir-username={banner.run.username}
    >
      <span className={styles.label}>测试空间</span>
      <span className={styles.detail}>{banner.run.username}</span>
      <span className={styles.detail}>有效期至 {formatDeadline(banner.expiresAt)}</span>
      <span className={`${styles.detail} ${styles.muted}`}>
        {datasetLabel}（人物 {banner.counts.contacts} · 观察 {banner.counts.observations} · 任务 {banner.counts.tasks}）
      </span>
    </aside>
  );
}
