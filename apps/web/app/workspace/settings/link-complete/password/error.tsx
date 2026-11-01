"use client";

import { useSearchParams } from "next/navigation";
import { useT } from "@/components/locale-provider";
import styles from "@/components/account-sign-in-methods.module.css";

/** Recover by GET only; never retry the failed password action. */
export default function PasswordRecoveryError() {
  const t = useT();
  const ref = useSearchParams()?.get("result");
  const href = ref && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)
    ? `/workspace/settings/link-complete/password?result=${encodeURIComponent(ref)}`
    : "/workspace/settings?section=account";
  return <section className={styles.section}>
    <h2>{t("核对这次密码更改")}</h2>
    <p>{t("页面没有收到更改结果。请通过只读页面核对结果。")}</p>
    <div className={styles.actions}>
      {ref && href !== "/workspace/settings?section=account" && <a href={href}>{t("打开只读恢复页面")}</a>}
      <a href="/workspace/settings?section=account">{t("返回账号设置")}</a>
    </div>
  </section>;
}
