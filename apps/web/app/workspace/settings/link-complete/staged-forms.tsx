"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  completeStagedPassword,
  continueTargetLink,
  type LoginMethodActionState,
} from "@/app/workspace/settings/login-methods/actions";
import styles from "@/components/account-sign-in-methods.module.css";
import { useT } from "@/components/locale-provider";

export type RenderedOperationScope = {
  operationRef: string;
  accountId: string;
  userId: string;
  accountRevision: number;
  userRevision: number;
};

function ScopeFields({ scope }: { scope: RenderedOperationScope }) {
  return (
    <>
      <input type="hidden" name="operationRef" value={scope.operationRef} />
      <input type="hidden" name="accountId" value={scope.accountId} />
      <input type="hidden" name="userId" value={scope.userId} />
      <input type="hidden" name="accountRevision" value={String(scope.accountRevision)} />
      <input type="hidden" name="userRevision" value={scope.userRevision} />
    </>
  );
}

const PASSWORD_PATH = "/workspace/settings/link-complete/password";
const passwordMessages = {
  editing: "新密码需要 8 到 128 个字符。",
  pending: "这次更改仍在处理中，请稍后再检查结果。",
  applied: "已保存并核验。",
  unknown: "暂时无法确认这次更改的结果。请检查结果，不要重复提交密码。",
  invalid: "这次操作已过期或登录状态已变化。请回到设置重新验证。",
} as const;

/** One imported action and permalink survive both editor and result postbacks. */
export function StagedPasswordForm({ intent, scope, resultRef, initialState = {} }: {
  intent: "set_password" | "change_password";
  scope: RenderedOperationScope;
  resultRef?: string;
  initialState?: LoginMethodActionState;
}) {
  const t = useT();
  const resultUrl = `${PASSWORD_PATH}?result=${encodeURIComponent(scope.operationRef)}`;
  const [state, action, pending] = useActionState<LoginMethodActionState, FormData>(
    completeStagedPassword, initialState, resultUrl,
  );
  const busy = useRef(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const receipt = state.passwordResult?.ref === scope.operationRef ? state.passwordResult : undefined;
  const readOnly = Boolean((resultRef || state.passwordResult) && receipt?.state !== "editing");
  const confirmed = receipt?.state === "applied" && state.saved === true;
  useEffect(() => {
    if (pending || !state.passwordResult) return;
    busy.current = false;
    if (state.passwordResult.ref === scope.operationRef && state.passwordResult.state === "editing") {
      // This response is known to precede dispatch; only it can reopen save.
      try { window.history.replaceState(null, "", PASSWORD_PATH); } catch { /* GET recovery remains available. */ }
    }
  }, [pending, state, scope.operationRef]);
  const message = historyFailed
    ? t("恢复入口没有保存，尚未提交密码。请重试或打开只读恢复页面。")
    : receipt ? t(passwordMessages[receipt.state === "applied" && !confirmed ? "unknown" : receipt.state])
      : readOnly ? t(passwordMessages.unknown) : "";
  if (resultRef && resultRef !== scope.operationRef) {
    return <section className={styles.section}><p>{t("这个链接属于更早的操作。请回到账号设置。")}</p><a href="/workspace/settings?section=account">{t("返回账号设置")}</a></section>;
  }
  return (
    <section className={styles.section} aria-labelledby="staged-password-title">
      <h2 id="staged-password-title">{readOnly ? t("核对这次密码更改") : intent === "change_password" ? t("设置新密码") : t("设置密码")}</h2>
      <p className={styles.secondary}>{readOnly
        ? t("检查结果只核对这次操作，不会再次提交密码。")
        : t("当前身份已验证。新密码只在这一步输入，不会经过链接或网址。")}</p>
      <p className={styles.secondary}><a href={resultUrl}>{t("打开只读恢复页面")}</a></p>
      <form className={styles.stepUp} action={action} onSubmitCapture={(event) => {
        if (busy.current) { event.preventDefault(); return; }
        if (!readOnly) {
          try {
            // Null lets Next's native History integration perform RESTORE.
            // Preserve recovery before dispatch; keep password enabled until
            // React has captured FormData, then pending controls disable it.
            window.history.replaceState(null, "", resultUrl);
            setHistoryFailed(false);
          } catch {
            event.preventDefault(); setHistoryFailed(true); return;
          }
        }
        busy.current = true;
      }}>
        <ScopeFields scope={scope} />
        <input type="hidden" name="passwordMode" value={readOnly ? "check" : "save"} />
        {!readOnly && <label className={styles.field}>
          <span>{t("新密码")}</span>
          <input name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} disabled={pending} />
        </label>}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={pending} aria-busy={pending}>
            {pending ? readOnly ? t("正在检查…") : t("正在保存…") : readOnly ? t("检查结果") : t("保存密码")}
          </button>
          {readOnly && <a href="/workspace/settings?section=account">{t("返回账号设置")}</a>}
        </div>
        <p aria-live="polite" className={historyFailed || (receipt && !confirmed && receipt.state !== "pending") ? styles.error : styles.notice}>{message}</p>
      </form>
    </section>
  );
}

/** Continue the second (new-provider) proof of a staged linking operation. */
export function StagedTargetLinkForm({ targetProvider, note, scope }: {
  targetProvider: "apple" | "google";
  note: string;
  scope: RenderedOperationScope;
}) {
  const [pending, setPending] = useState(false);
  return (
    <section className={styles.section} aria-labelledby="staged-link-title">
      <h2 id="staged-link-title">{`将 ${targetProvider === "google" ? "Google" : "Apple"} 绑定到这个账户`}</h2>
      <p className={styles.secondary}>{note}</p>
      <form
        action={async (formData: FormData) => {
          setPending(true);
          await continueTargetLink(formData);
        }}
      >
        <ScopeFields scope={scope} />
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={pending} aria-busy={pending}>
            {pending ? "正在连接…" : "继续绑定"}
          </button>
        </div>
      </form>
    </section>
  );
}
