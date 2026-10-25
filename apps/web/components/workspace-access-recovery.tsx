import type { ReactNode } from "react";

import { BrandMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";
import styles from "./workspace-access-recovery.module.css";

/** Presentation only: the layout keeps ownership of scope clearing and recovery actions. */
export function WorkspaceAccessRecovery({ children, unavailable = false }: { children: ReactNode; unavailable?: boolean }) {
  return (
    <div className={styles.shell} lang="zh-CN">
      <header className={styles.header}>
        <BrandMark />
        <ThemeToggle />
      </header>
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <section className={styles.panel} aria-live="polite" aria-labelledby="workspace-access-title">
          <p className={styles.eyebrow}>{unavailable ? "连接恢复中" : "继续之前，先确认账号"}</p>
          <h1 id="workspace-access-title">{unavailable ? "暂时无法连接账号服务" : "需要重新确认登录空间"}</h1>
          <p className={styles.description}>
            {unavailable ? "登录凭据和本地草稿已保留。连接恢复后可以继续，无需重新登录。" : "登录空间已变化或会话已过期，暂不能显示工作区内容。"}
          </p>
          <div className={styles.actions}>{children}</div>
          <p className={styles.privacy}>确认之前，这里不展示人物、对话或草稿。</p>
        </section>
      </main>
    </div>
  );
}
