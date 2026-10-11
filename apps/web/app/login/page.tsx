import { AppleLogo, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { canonicalLoginTarget, oauthRetryTarget } from "@/lib/onboarding-navigation";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AccountAccessForm } from "@/components/account-access-form";
import { BrandMark } from "@/components/brand-mark";
import { EmailSignInForm } from "@/components/email-sign-in-form";
import { VerificationConfirmForm } from "@/components/verification-confirm-form";
import {
  LINK_COMPLETE_PATH,
  readAuthOperation,
  readAuthProof,
  readAuthRound,
  validateStagedProof,
} from "@/lib/server/stagedAuth";
import { connectProviderFrom, loginContinuationTarget, settingsLinkErrorTarget } from "@/lib/login-continuity";
import { readLoginCollisionHint } from "@/lib/server/loginCollision";
import { OAuthSubmit } from "@/components/oauth-submit";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAuthAvailability, safeRedirectTarget } from "@/lib/auth-config";
import { getGoogleOAuthCredentials } from "@/lib/server/google-oauth";
import { signInWithApple, signInWithDefaultAccount, signInWithGoogle } from "./actions";
import { DesktopNativeLoginNotice, isNativeLoginUserAgent } from "./desktop-native-notice";
import styles from "./login.module.css";
import { AccountContinuity } from "./account-continuity";
import { LoginConnectContinuity } from "./login-connect-continuity";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "登录与注册",
  description: "从你开始，建立自己的 capri 关系工作台。",
  robots: { follow: false, index: false },
};
const oauthErrors: Record<string, string> = {
  AccessDenied: "登录已取消。准备好后，可以再试一次。",
  Configuration: "这次连接没有完成。已有账号请使用原登录方式，或稍后重试。",
  OAuthCallbackError: "这次登录没有完成，请重新连接。",
  // `OAuthAccountNotLinked` deliberately has no entry: an account-collision
  // message is shown only with the server-sealed collision hint. A forged
  // error query alone never claims that an account exists.
};

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; reason?: string; mode?: string; verification?: string; connect?: string }>;
}) {
  const [session, parameters] = await Promise.all([auth(), searchParams]);
  const requestHeaders = await headers();
  // Display-only native defense (ADR 0022): the Mac app owns its signed-out
  // browser-login surface and intercepts /login itself; a direct native load
  // of this page must never show a password, registration or provider form.
  if (isNativeLoginUserAgent(requestHeaders.get("user-agent"))) {
    return <DesktopNativeLoginNotice />;
  }
  const requestOrigin = `${requestHeaders.get("x-forwarded-proto") === "https" ? "https" : "http"}://${requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000"}`;
  const canonical = canonicalLoginTarget(requestOrigin, process.env.AUTH_URL, parameters, process.env.NODE_ENV === "production");
  if (canonical) redirect(canonical);
  const callbackUrl = parameters.callbackUrl ? safeRedirectTarget(parameters.callbackUrl)
    : parameters.error ? oauthRetryTarget((await cookies()).get("talent-signal.callback-url")?.value, process.env.AUTH_URL ?? requestOrigin) : "/workspace";
  const sessionExpired = parameters.reason === "backend_session_expired";
  // GET-141 continuity: the sealed hint (provider + seal time only) is the
  // sole authority for collision messaging. A missing or expired hint shows
  // only the generic neutral error and discloses no account information.
  const collisionHint =
    parameters.error === "OAuthAccountNotLinked"
      ? await readLoginCollisionHint()
      : null;
  // Navigation hint only: where a completed login continues. Never proof of
  // a collision, an account or a link result.
  const connectHint = connectProviderFrom(parameters.connect);
  // With an active connect hint every sign-in path continues to the
  // preselected connecting panel; the original callback rides along as the
  // return hint. An already-authenticated arrival uses the same destination.
  const destination =
    connectHint && !parameters.error
      ? loginContinuationTarget({ callbackUrl, provider: connectHint })
      : callbackUrl;
  if (session?.user && !sessionExpired && !parameters.error) {
    redirect(`/onboarding?callbackUrl=${encodeURIComponent(destination)}`);
  }
  // Staged Settings operations never fall through to ordinary login: a staged
  // proof returns to its fixed same-origin completion route, and a cancelled
  // or stale one exits through the fail-closed cleanup route. State lives in
  // sealed cookies; no URL success flag is trusted.
  const stagedOperation = await readAuthOperation();
  const stagedRound = await readAuthRound();
  const stagedProof = await readAuthProof(
    stagedRound?.role === "duplicate" ? "duplicate" : "current",
  );
  // Owned completion only: a proof matching the CURRENT sealed round (role,
  // provider, challenge, purpose) inside the frozen flow lifetime. A delayed
  // error from another round never borrows the current round's authority.
  const ownedCompletion =
    parameters.error === "AccessDenied" &&
    validateStagedProof({
      operation: stagedOperation,
      round: stagedRound,
      proof: stagedProof,
      role: stagedRound?.role ?? "current",
    });
  if (ownedCompletion) {
    redirect(LINK_COMPLETE_PATH);
  }
  if (parameters.error && !sessionExpired && (stagedProof || stagedOperation)) {
    // An error arriving from an unknown earlier round can never borrow the
    // CURRENT operation's authority to cancel or execute it; the sealed
    // operation stays untouched and only its sanitized navigation hints
    // accompany the recoverable return.
    redirect(
      settingsLinkErrorTarget({
        provider:
          stagedOperation?.intent === "link_provider"
            ? stagedOperation.targetProvider
            : undefined,
        returnTo: stagedOperation?.returnTo,
      }),
    );
  }
  if (parameters.error && !sessionExpired && session?.user) {
    // An already-authenticated collision continues on the authenticated
    // Settings surface with the provider's connecting panel preselected and
    // the original callback preserved; other errors keep the generic return.
    redirect(
      collisionHint
        ? loginContinuationTarget({ callbackUrl, provider: collisionHint.provider })
        : "/workspace/settings?section=account&link=error",
    );
  }
  const verificationSecret = parameters.verification?.trim() ?? "";
  const availability = getAuthAvailability(process.env, { google: Boolean(getGoogleOAuthCredentials()) });
  const error = sessionExpired ? "登录已过期。重新登录后，可以继续刚才的工作。"
    : collisionHint ? ""
    : parameters.error ? (oauthErrors[parameters.error] ?? "登录未完成，请重试或换一种方式。") : "";
  const providers = (
    <div className={styles.providers}>
      <form action={signInWithGoogle} data-oauth-form="true">
        <input type="hidden" name="redirectTo" value={destination} />
        <OAuthSubmit disabled={!availability.google} className={styles.provider}>
          <Image src="/images/google-sign-in.png" width={20} height={20} alt="" unoptimized />
          <span>使用 Google 继续</span>
          {!availability.google && <small>暂不可用</small>}
        </OAuthSubmit>
        <OAuthSubmit formAction={signInWithApple} disabled={!availability.apple} className={`${styles.provider} ${styles.apple}`}>
          <AppleLogo aria-hidden="true" size={21} weight="fill" />
          <span>使用 Apple 继续</span>
          {!availability.apple && <small>暂不可用</small>}
        </OAuthSubmit>
      </form>
    </div>
  );
  return (
    <main id="main-content" className={styles.page} tabIndex={-1}>
      <div className={styles.topbar}>
        <BrandMark />
        <div className={styles.utilities}>
          <Link href="/">返回首页 <ArrowUpRight size={14} aria-hidden="true" /></Link>
          <ThemeToggle />
        </div>
      </div>
      <div className={styles.stage}>
        <AccountContinuity />
        <div className={styles.content}>
          {collisionHint ? (
            <LoginConnectContinuity provider={collisionHint.provider} callbackUrl={callbackUrl} />
          ) : (
          <>
          {!parameters.error && connectHint && (
            <p className={styles.connectHint} role="status" data-connect-continuity-hint>
              {`登录后会带你继续连接 ${connectHint === "google" ? "Google" : "Apple"}。`}
            </p>
          )}
          {verificationSecret ? (
            <VerificationConfirmForm secret={verificationSecret} redirectTo={destination} />
          ) : availability.password ? (
            <AccountAccessForm callbackUrl={destination} registrationEnabled={availability.registration}
              initialMode={parameters.mode === "register" ? "register" : "sign-in"} notice={error}>
              {providers}
            </AccountAccessForm>
          ) : (
            <section aria-labelledby="sign-in-title">
              <header className={styles.heading}><h1 id="sign-in-title">从你开始。</h1><p>一个安静的地方，留住重要的人与对话。</p></header>
              {error && <p className={styles.error} role="alert">{error}</p>}
              {providers}
              {availability.email && <EmailSignInForm callbackUrl={destination} enabled />}
              {!availability.google && !availability.apple && !availability.email && <p className={styles.caption}>这个工作台暂未开放登录，请稍后再试。</p>}
            </section>
          )}
          {availability.defaultAccount && (
            <form action={signInWithDefaultAccount} className={styles.fixture}>
              <input type="hidden" name="redirectTo" value={destination} />
              <button type="submit">使用开发测试账号 · {availability.defaultAccountName}</button>
            </form>
          )}
          </>
          )}
          <p className={styles.privacy}>同一账号，联系人与会话自动同步。</p>
        </div>
      </div>
      <footer className={styles.footer}>只带入你选择分享的内容。</footer>
    </main>
  );
}
