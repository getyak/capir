import type { LocaleTag } from "@talent-signal/contracts";
import { translate, type TranslateVars } from "@/lib/i18n";
import Link from "next/link";
import { safeRedirectTarget } from "@/lib/safe-redirect";
import type { ConnectProvider } from "@/lib/login-continuity";
import styles from "./login.module.css";

const providerLabel: Record<ConnectProvider, string> = {
  google: "Google",
  apple: "Apple",
};

/**
 * GET-141 continuity panel, shown only with the server-sealed collision hint.
 * Neutral copy, one explicit verify-then-connect action, quiet ordinary-login
 * escape. No email, account or method inventory is ever disclosed, and the
 * original safe callback travels with both actions.
 */
export function LoginConnectContinuity({
  provider,
  callbackUrl,
  locale = "zh-CN",
}: {
  provider: ConnectProvider;
  callbackUrl: string;
  locale?: LocaleTag;
}) {
  const t = (key: string, vars?: TranslateVars) => translate(locale, key, vars);
  const label = providerLabel[provider];
  const target = safeRedirectTarget(callbackUrl);
  return (
    <section
      className={styles.connectPanel}
      aria-labelledby="connect-continuity-title"
      data-login-connect-continuity
    >
      <h2 id="connect-continuity-title">{t("继续使用已有账号")}</h2>
      <p className={styles.story}>
        {t("先用原来的方式登录，再连接 {provider}。联系人和会话会保留在同一个账号中。", { provider: label })}
      </p>
      <p className={styles.connectNote}>{t("连接前会再次验证身份，由你确认后生效。")}</p>
      <div className={styles.connectActions}>
        <Link
          className={styles.submit}
          href={`/login?connect=${provider}&callbackUrl=${encodeURIComponent(target)}`}
          data-connect-continuity-primary
        >
          {t("登录并连接 {provider}", { provider: label })}
        </Link>
        <Link
          className={styles.textButton}
          href={`/login?callbackUrl=${encodeURIComponent(target)}`}
          data-connect-continuity-escape
        >{t("先直接登录")}</Link>
      </div>
    </section>
  );
}
