"use client";

import { useT } from "@/components/locale-provider";

import { ArrowRight } from "@phosphor-icons/react";
import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { signInWithEmail, type SignInState } from "@/app/login/actions";
import { PasswordField } from "@/app/login/password-field";
import styles from "@/app/login/login.module.css";

const initialState: SignInState = { error: "" };

function SubmitButton({ enabled }: { enabled: boolean }) {
  const t = useT();
  const { pending } = useFormStatus();

  return (
    <button
      className="button auth-submit"
      type="submit"
      disabled={pending || !enabled}
      aria-busy={pending}
    >
      {pending ? t("正在登录…") : t("使用邮箱继续")}
      <ArrowRight aria-hidden="true" size={17} />
    </button>
  );
}

function FormError({
  describedBy,
  state,
}: {
  describedBy?: string;
  state: SignInState;
}) {
  const t = useT();
  const { pending } = useFormStatus();
  if (!state.error) return null;
  return (
    <div className="auth-error" role="alert" id={describedBy}>
      <p>{t(state.error)}</p>
      {state.retryable ? (
        <button
          type="submit"
          className={styles.retry}
          disabled={pending}
          aria-busy={pending}
        >{t("重试")}</button>
      ) : null}
    </div>
  );
}

export function EmailSignInForm({
  callbackUrl,
  enabled,
}: {
  callbackUrl: string;
  enabled: boolean;
}) {
  const t = useT();
  const [state, formAction, pending] = useActionState(
    signInWithEmail,
    initialState,
  );
  const [password, setPassword] = useState("");
  const errorId = useId();
  const describedBy = state.error ? errorId : undefined;

  return (
    <form
      className="email-sign-in"
      action={formAction}
      onSubmit={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      <input type="hidden" name="redirectTo" value={callbackUrl} />
      <div className="auth-field">
        <label htmlFor="sign-in-email">{t("邮箱")}</label>
        <input
          id="sign-in-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@searchfirm.com"
          defaultValue={state.values?.email ?? ""}
          disabled={!enabled || pending}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={describedBy}
          required
        />
      </div>
      <PasswordField
        id="sign-in-password"
        name="password"
        label={t("密码")}
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        placeholder={t("输入密码")}
        minLength={8}
        maxLength={128}
        required
        disabled={!enabled || pending}
        invalid={Boolean(state.error)}
        describedBy={describedBy}
      />
      <FormError state={state} describedBy={errorId} />
      <SubmitButton enabled={enabled} />
      {!enabled && (
        <p className="auth-configuration-note">{t("配置默认账号和密码哈希后，即可使用邮箱登录。")}</p>
      )}
    </form>
  );
}
