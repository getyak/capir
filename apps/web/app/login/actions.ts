"use server";

import { TalentSignalClient, TalentSignalHttpError } from "@talent-signal/contracts";
import { clearTestWorkspaceSession } from "@/lib/server/testWorkspaceSession";
import { readPrimaryBackendSessionClaims, backendAuthBaseUrl, registerBackendAccount } from "@/lib/server/backendAuth";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { prepareGoogleSignIn, bindGoogleNonce } from "@/lib/server/google-session";
import { prepareAppleSignIn, bindAppleNonce } from "@/lib/server/apple-session";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import {
  deriveRegistrationDisplayName,
  getAuthAvailability,
  passwordRegistrationSchema,
  passwordSignInSchema,
  safeRedirectTarget,
} from "@/lib/auth-config";
import { onboardingCallbackTarget, onboardingStartTarget } from "@/lib/onboarding-navigation";
import {
  authFailureCodeFromCredentialsCode,
  authFailureIsRetryable,
  authFailureMessage,
  type AuthFailureCode,
} from "@/lib/auth-feedback";
import { authenticatedBackendClient } from "@/lib/server/backendAuth";

export type SignInState = {
  error: string;
  code?: AuthFailureCode;
  retryable?: boolean;
  /** Verified signup started: the code was sent, never returned. */
  sent?: boolean;
  /** Non-secret values restored onto the form after a failed action. */
  values?: {
    displayName?: string;
    email?: string;
    identifier?: string;
  };
};

const BACKEND_LOGOUT_TIMEOUT_MS = 1_500;

function isNextRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failedState(
  code: AuthFailureCode,
  mode: "register" | "sign-in",
  values?: SignInState["values"],
  message: string = authFailureMessage(code, mode),
): SignInState {
  return {
    error: message,
    code,
    retryable: authFailureIsRetryable(code),
    values,
  };
}

async function logoutBackendWithinDeadline(
  logout: () => Promise<unknown>,
) {
  let timeoutID: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      logout(),
      new Promise<never>((_, reject) => {
        timeoutID = setTimeout(
          () => reject(new Error("Backend logout timed out.")),
          BACKEND_LOGOUT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutID) clearTimeout(timeoutID);
  }
}

export async function signInWithPasswordAccount(
  _previousState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const values = { identifier: formString(formData, "identifier") };
  if (!getAuthAvailability().password) {
    return failedState(
      "invalid_input",
      "sign-in",
      values,
      "密码登录暂未开放。",
    );
  }
  const parsed = passwordSignInSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return failedState("invalid_input", "sign-in", values);
  }

  try {
    await signIn("password-account", {
      ...parsed.data,
      mode: "sign-in",
      redirect: false,
      redirectTo: onboardingStartTarget(formData.get("redirectTo")),
    });
    // A deliberately completed login replaces the primary identity. Clear
    // the old identity-bound test selection only after authentication succeeds.
    await clearTestWorkspaceSession();
    redirect(onboardingStartTarget(formData.get("redirectTo")));
  } catch (error) {
    if (error instanceof AuthError) {
      const code = authFailureCodeFromCredentialsCode(
        "code" in error ? String(error.code) : "",
        "sign-in",
      );
      return failedState(code, "sign-in", values);
    }
    throw error;
  }
  return { error: "" };
}

export async function registerPasswordAccount(
  _previousState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = formString(formData, "email");
  const displayName = formString(formData, "displayName");
  const values = { displayName, email };
  if (!getAuthAvailability().registration) {
    return failedState(
      "invalid_input",
      "register",
      values,
      "注册暂未开放。",
    );
  }
  const parsed = passwordRegistrationSchema.safeParse({
    username: formData.get("username") || `u${randomUUID().replaceAll("-", "")}`,
    email,
    displayName: displayName || undefined,
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return failedState(
      "invalid_input",
      "register",
      values,
      "请填写有效邮箱，并设置至少 8 个字符的密码。",
    );
  }

  try {
    // Verified signup: this only starts delivery. The response is generic and
    // contains no code; the account activates when the owner confirms.
    await registerBackendAccount({
      username: parsed.data.username,
      email: parsed.data.email,
      display_name: deriveRegistrationDisplayName(
        parsed.data.email,
        parsed.data.displayName,
      ),
      password: parsed.data.password,
    });
  } catch (error) {
    if (error instanceof TalentSignalHttpError) {
      if (error.code === "PASSWORD_ACCOUNT_EXISTS") {
        return failedState("account_exists", "register", values);
      }
      if (error.status === 503 || error.status === 502) {
        return failedState(
          "service_unavailable",
          "register",
          values,
          "验证邮件暂时无法发送，账号未创建。请稍后重试。",
        );
      }
      if (error.status === 429) {
        return failedState("rate_limited", "register", values);
      }
    }
    return failedState("registration_result_unknown", "register", values);
  }
  return { error: "", sent: true, values: { email } };
}

export async function signInWithEmail(
  _previousState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const values = { email: formString(formData, "email") };
  const redirectTo = safeRedirectTarget(formData.get("redirectTo"));

  try {
    await signIn("email-password", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      const code =
        error.type === "CredentialsSignin"
          ? authFailureCodeFromCredentialsCode(
              "code" in error ? String(error.code) : "",
              "sign-in",
            )
          : "service_unavailable";
      return failedState(code, "sign-in", values);
    }
    throw error;
  }

  return { error: "" };
}

export async function signInWithGoogle(formData: FormData) {
  const redirectTo = onboardingStartTarget(formData.get("redirectTo"));
  const callbackTarget = onboardingCallbackTarget(formData.get("redirectTo"));
  try {
    const nonce = await prepareGoogleSignIn();
    const url = await signIn("google", { redirect: false, redirectTo });
    redirect(await bindGoogleNonce(url, nonce));
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect(
      `/login?error=Configuration&callbackUrl=${encodeURIComponent(callbackTarget)}`,
    );
  }
}

export async function signInWithApple(formData: FormData) {
  const redirectTo = onboardingStartTarget(formData.get("redirectTo"));
  const callbackTarget = onboardingCallbackTarget(formData.get("redirectTo"));
  try {
    const nonce = await prepareAppleSignIn();
    const url = await signIn("apple", { redirect: false, redirectTo });
    redirect(await bindAppleNonce(url, nonce));
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect(
      `/login?error=Configuration&callbackUrl=${encodeURIComponent(callbackTarget)}`,
    );
  }
}

export async function signInWithDefaultAccount(formData: FormData) {
  await signIn("default-account", {
    redirectTo: safeRedirectTarget(formData.get("redirectTo")),
  });
}

export async function signOutOfWorkspace() {
  try {
    const backend = await authenticatedBackendClient();
    if (backend) {
      await logoutBackendWithinDeadline(() => backend.logout());
    }
  } catch {
    // Local sign-out must still succeed if the backend session expired or the
    // account service is temporarily unreachable.
  }
  try {
    const primary = await readPrimaryBackendSessionClaims();
    if (primary) await logoutBackendWithinDeadline(() => new TalentSignalClient(backendAuthBaseUrl(), primary.backendAccessToken).logout());
  } catch { /* Local sign-out remains available during an outage. */ }
  await clearTestWorkspaceSession();
  await signOut({ redirectTo: "/" });
}

/** Intentional completion of the emailed verification link/code. */
export async function confirmEmailVerification(
  _previousState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const secret = formString(formData, "verificationSecret");
  const redirectTo = safeRedirectTarget(formData.get("redirectTo"));
  try {
    await signIn("email-verification", {
      verificationSecret: secret,
      redirectTo: onboardingStartTarget(redirectTo),
    });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    if (error instanceof AuthError) {
      return failedState("invalid_input", "register", undefined, "这个验证链接无效或已过期。请重新注册，获取新的验证邮件。");
    }
    throw error;
  }
  return { error: "" };
}
