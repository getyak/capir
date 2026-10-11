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
}: {
  provider: ConnectProvider;
  callbackUrl: string;
}) {
  const label = providerLabel[provider];
  const target = safeRedirectTarget(callbackUrl);
  return (
    <section
      className={styles.connectPanel}
      aria-labelledby="connect-continuity-title"
      data-login-connect-continuity
    >
      <h2 id="connect-continuity-title">继续使用已有账号</h2>
      <p className={styles.story}>
        {`先用原来的方式登录，再连接 ${label}。联系人和会话会保留在同一个账号中。`}
      </p>
      <p className={styles.connectNote}>连接前会再次验证身份，由你确认后生效。</p>
      <div className={styles.connectActions}>
        <Link
          className={styles.submit}
          href={`/login?connect=${provider}&callbackUrl=${encodeURIComponent(target)}`}
          data-connect-continuity-primary
        >
          {`登录并连接 ${label}`}
        </Link>
        <Link
          className={styles.textButton}
          href={`/login?callbackUrl=${encodeURIComponent(target)}`}
          data-connect-continuity-escape
        >
          先直接登录
        </Link>
      </div>
    </section>
  );
}
