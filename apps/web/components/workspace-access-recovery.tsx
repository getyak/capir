import type { ReactNode } from "react";

import { getMarketingLocale } from "@/lib/server/marketing-locale";
import { translate } from "@/lib/i18n";
import { BrandMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";
import styles from "./workspace-access-recovery.module.css";

/** Presentation only: the layout keeps ownership of scope clearing and recovery actions. */
export async function WorkspaceAccessRecovery({ children, unavailable = false }: { children: ReactNode; unavailable?: boolean }) {
  const locale = await getMarketingLocale();
  const t = (key: string) => translate(locale, key);
  return (
    <div className={styles.shell} lang={locale}>
      <header className={styles.header}>
        <BrandMark label={t("capri 首页")} />
        <ThemeToggle />
      </header>
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <section className={styles.panel} aria-live="polite" aria-labelledby="workspace-access-title">
          <p className={styles.eyebrow}>{t(unavailable ? "连接恢复中" : "继续之前，先确认账号")}</p>
          <h1 id="workspace-access-title">{t(unavailable ? "暂时无法连接账号服务" : "需要重新确认登录空间")}</h1>
          <p className={styles.description}>
            {t(unavailable ? "登录凭据和本地草稿已保留。连接恢复后可以继续，无需重新登录。" : "登录空间已变化或会话已过期，暂不能显示工作区内容。")}
          </p>
          <div className={styles.actions}>{children}</div>
          <p className={styles.privacy}>{t("确认之前，这里不展示人物、对话或草稿。")}</p>
        </section>
      </main>
    </div>
  );
}
