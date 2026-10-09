import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccountOnboardingForm } from "@/components/account-onboarding-form";
import { authenticatedBackendClient, readBackendSessionClaims } from "@/lib/server/backendAuth";
import { workspaceSessionsBinding } from "@/lib/server/workspaceSessions";
import { safeRedirectTarget } from "@/lib/auth-config";
import { withAuthRequestTimeout } from "@/lib/auth-request-timeout";
import { backendSessionIsExpired, isBackendSessionExpiredError } from "@/lib/backend-session";
import { auth } from "@/auth";
import styles from "@/app/login/login.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "关于你", robots: { follow: false, index: false } };
export default async function OnboardingPage({ searchParams }: {
  searchParams: Promise<{ callbackUrl?: string; edit?: string }>;
}) {
  const parameters = await searchParams;
  const requested = safeRedirectTarget(parameters.callbackUrl);
  const callbackUrl = /^\/(?:onboarding|login)(?:[/?#]|$)/.test(requested) ? "/workspace" : requested;
  const edit = parameters.edit === "true";
  const claims = await readBackendSessionClaims().catch((error) => {
    if (isBackendSessionExpiredError(error)) redirect(`/login?reason=backend_session_expired&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    throw error;
  });
  if (!claims && !(await auth())?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
    // The backend-bound session failed or expired even though the primary
    // auth session may still exist. Send the EXISTING recovery reason so the
    // login page renders its recovery form instead of bouncing back here.
    redirect(
      `/login?reason=backend_session_expired&callbackUrl=${encodeURIComponent(callbackUrl)}`,
    );
  }
  const data = await (async () => {
    try { const client = await authenticatedBackendClient(); return client ? await withAuthRequestTimeout(signal => client.accountOnboarding(signal), { timeoutMs: 5_000 }) : null; }
    catch (error) {
      if (isBackendSessionExpiredError(error)) redirect(`/login?reason=backend_session_expired&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      return null;
    }
  })();
  if (data && (data.account_id !== claims.backendAccountId || data.user_id !== claims.backendUserId)) redirect("/login?reason=backend_session_expired");
  if (data && data.status !== "pending" && !edit) redirect(callbackUrl);
  return <main id="main-content" className={styles.page} tabIndex={-1}>
    <div className={styles.topbar}><BrandMark /><div className={styles.utilities}>
      <Link href={callbackUrl}>进入工作台 <ArrowUpRight size={14} aria-hidden="true" /></Link><ThemeToggle />
    </div></div>
    <div className={styles.stage}><div className={styles.content}>
      {data ? <AccountOnboardingForm initial={data} callbackUrl={callbackUrl} edit={edit}
        scope={{ accountId: claims.backendAccountId, userId: claims.backendUserId, binding: workspaceSessionsBinding(claims) }} /> :
        <section><header className={styles.heading}><h1>稍后再认识你，也可以。</h1><p>个人资料暂时无法载入。你可以先进入工作台，之后在设置中补充。</p></header>
          <p className={styles.error} role="alert">资料还未载入，未做任何修改。</p>
          <Link className={styles.submit} href={callbackUrl}>先进入工作台</Link>
          <p className={styles.switchMode}><a href={`/onboarding?callbackUrl=${encodeURIComponent(callbackUrl)}${edit ? "&edit=true" : ""}`}>重试载入</a></p>
        </section>}
    </div></div>
    <footer className={styles.footer}>TALENT SIGNAL <span>关于你，由你决定。</span></footer>
  </main>;
}
