import { ArrowCounterClockwise, ArrowRight, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import styles from "./workspace-disconnected-state.module.css";

export function WorkspaceDisconnectedState({
  description,
  eyebrow = "连接暂时中断",
  hint,
  primaryHref = "/workspace",
  primaryLabel = "返回工作台",
  secondaryHref = "/workspace/settings",
  secondaryLabel = "查看账号设置",
  title = "工作台暂时无法连接。",
}: {
  description: string;
  eyebrow?: string;
  hint: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  title?: string;
}) {
  return (
    <section className={styles.panel} role="alert">
      <div className={styles.header}>
        <span className={styles.icon}>
          <WarningCircle aria-hidden="true" size={22} />
        </span>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <div className={styles.actions}>
        <a className={styles.primary} href={primaryHref}>
          {primaryLabel}
          <ArrowRight aria-hidden="true" size={16} />
        </a>
        <Link className={styles.secondary} href={secondaryHref}>
          {secondaryLabel}
        </Link>
      </div>

      <p className={styles.hint}>
        <ArrowCounterClockwise aria-hidden="true" size={14} /> {hint}
      </p>
    </section>
  );
}
