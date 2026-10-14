import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import styles from "./authorize.module.css";

/** Layout only: request validation and consent authority stay in the Page. */
export function AuthorizationFrame({ title, summary, children, note }: {
  title: string;
  summary: string;
  children?: ReactNode;
  note: string;
}) {
  return (
    <main className={styles.page} id="main-content" aria-labelledby="capir-auth-title">
      <div className={styles.panel}>
        <header className={styles.header}>
          <BrandMark />
          <ThemeToggle />
        </header>
        <p className={styles.eyebrow}>命令行登录</p>
        <h1 id="capir-auth-title">{title}</h1>
        <p className={styles.summary}>{summary}</p>
        {children}
        <p className={styles.note}>{note}</p>
      </div>
    </main>
  );
}
