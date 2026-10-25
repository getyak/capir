"use client";

import { useT } from "@/components/locale-provider";

import { useActionState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { confirmEmailVerification, type SignInState } from "@/app/login/actions";
import styles from "@/app/login/login.module.css";

/**
 * Intentional completion of the emailed verification link. A GET or mail
 * scanner never creates or signs in an account; only this explicit submit does.
 */
export function VerificationConfirmForm({ secret, redirectTo }: {
  secret: string;
  redirectTo: string;
}) {
  const t = useT();
  const [state, action, pending] = useActionState<SignInState, FormData>(
    confirmEmailVerification,
    { error: "" },
  );
  return (
    <section aria-labelledby="verify-title">
      <header className={styles.heading}>
        <p className={styles.eyebrow}>{t("确认这个邮箱")}</p>
        <h1 id="verify-title">{t("完成验证，创建你的账户。")}</h1>
        <p>{t("点击下面的按钮确认。如果是误点或邮件扫描，不需要任何操作。")}</p>
      </header>
      <form className={styles.form} action={action}>
        <input type="hidden" name="verificationSecret" value={secret} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        {state.error && <p className={styles.error} role="alert">{t(state.error)}</p>}
        <button className={styles.submit} type="submit" disabled={pending} aria-busy={pending}>
          {pending ? t("正在确认…") : t("确认并登录")}
          <ArrowRight aria-hidden="true" size={18} />
        </button>
      </form>
    </section>
  );
}
