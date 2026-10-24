"use client";

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
import { useLocale, useT } from "./locale-provider";
import type { LocaleTag } from "@talent-signal/contracts";
import styles from "./capir-test-banner.module.css";

export type { CapirTestBannerData };

/** Deterministic UTC deadline; locale affects presentation, never expiry. */
export function formatDeadline(expiresAt: string, locale: LocaleTag = "zh-CN"): string {
  const at = new Date(expiresAt);
  const date = new Intl.DateTimeFormat(locale, { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat(locale, { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle:"h23" }).format(at);
  return `${date} ${time} (UTC)`;
}

export function CapirTestBanner({ banner }: { banner: CapirTestBannerData | null }) {
  const t = useT();
  const locale = useLocale();
  if (!banner) return null;
  const datasetLabel = t(banner.datasetState === "ready" ? "合成数据已就绪" : "合成数据校验未通过");
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
      <span className={styles.label}>{t("测试空间")}</span>
      <span className={styles.detail}>{banner.run.username}</span>
      <span className={styles.detail}>{t("test.banner.expires", { date: formatDeadline(banner.expiresAt, locale) })}</span>
      <span className={`${styles.detail} ${styles.muted}`}>
        {t("test.banner.dataset", { state: datasetLabel, people: banner.counts.contacts, observations: banner.counts.observations, tasks: banner.counts.tasks })}
      </span>
    </aside>
  );
}
