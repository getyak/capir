import { TalentSignalHttpError } from "@talent-signal/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import styles from "../browser-login.module.css";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { readPrimaryBackendSessionClaims } from "@/lib/server/backendAuth";
import {
  DesktopAuthRequestError,
  desktopAuthBearerClient,
  desktopAuthDeploymentOrigin,
  sealDesktopAuthCsrf,
} from "@/lib/server/desktop-browser-login";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "确认 Mac 登录",
  robots: { follow: false, index: false },
};

type SearchParams = Promise<{ attempt?: string; state?: string }>;

function safeReturnTarget(attempt: string, state: string): string {
  return `/desktop-auth/authorize?attempt=${encodeURIComponent(attempt)}&state=${encodeURIComponent(state)}`;
}

/**
 * First-party browser confirmation (ADR 0022). It shows the live
 * backend-verified identity and the request's matching hint, and offers one
 * intentional Continue or Cancel. A GET never mutates anything; both actions
 * are same-origin POSTs carrying the sealed CSRF proof and the state binding.
 */
export default async function DesktopAuthAuthorizePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const parameters = await searchParams;
  const attempt = parameters.attempt?.trim() ?? "";
  const state = parameters.state?.trim() ?? "";
  const validShape =
    /^[0-9a-f-]{36}$/iu.test(attempt) &&
    /^[A-Za-z0-9_-]{32,256}$/.test(state);
  if (!validShape) {
    return (
      <main id="main-content" className={styles.page}><div className={styles.topbar}><Link href="/" className="brand">capri</Link><span>Mac 登录</span></div><div className={styles.content}>
        <h1>登录请求无效</h1>
        <p>这个登录链接不完整。请回到 Mac，重新发起登录。</p>
      </div></main>
    );
  }
  const session = await auth();
  if (!session?.user) {
    // A signed-out browser uses the existing login methods and onboarding,
    // then returns to this exact request.
    redirect(`/login?callbackUrl=${encodeURIComponent(safeReturnTarget(attempt, state))}`);
  }
  // Primary claims only: the confirmation page never consults a testWorkspace
  // or Lab fallback, and the sealed form binds this exact primary session.
  const claims = await readPrimaryBackendSessionClaims();
  if (!claims) {
    redirect(`/login?reason=backend_session_expired&callbackUrl=${encodeURIComponent(safeReturnTarget(attempt, state))}`);
  }
  const client = desktopAuthBearerClient(claims.backendAccessToken);
  let identity: Awaited<ReturnType<typeof client.currentSession>>;
  let grant: Awaited<ReturnType<typeof client.readDesktopBrowserLoginGrant>>;
  try {
    [identity, grant] = await Promise.all([
      client.currentSession(),
      client.readDesktopBrowserLoginGrant(attempt, state, await desktopAuthDeploymentOrigin()),
    ]);
  } catch (error) {
    if (error instanceof TalentSignalHttpError && error.status === 401) {
      // A still-present Auth.js cookie cannot authorize a revoked backend
      // session. Force the ordinary browser sign-in surface without a GET
      // cookie mutation, then return to this exact unapproved Mac operation.
      redirect(`/login?reason=backend_session_expired&callbackUrl=${encodeURIComponent(safeReturnTarget(attempt, state))}`);
    }
    const unknown =
      error instanceof DesktopAuthRequestError ||
      (error instanceof Error && "code" in error);
    return (
      <main id="main-content" className={styles.page}><div className={styles.topbar}><Link href="/" className="brand">capri</Link><span>Mac 登录</span></div><div className={styles.content}>
        <h1>登录请求无法核对</h1>
        <p>
          {unknown
            ? "这个 Mac 登录请求已经失效或不存在。请回到 Mac，重新发起登录。"
            : "暂时无法连接登录服务。请稍后回到 Mac 重试。"}
        </p>
        <Link href="/workspace">回到工作区</Link>
      </div></main>
    );
  }
  // The displayed identity must be the exact primary account and user whose
  // token fingerprint the confirmation seal binds; anything else fails closed.
  if (
    identity.account.id !== claims.backendAccountId ||
    identity.user.id !== claims.backendUserId
  ) {
    return (
      <main id="main-content" className={styles.page}><div className={styles.topbar}><Link href="/" className="brand">capri</Link><span>Mac 登录</span></div><div className={styles.content}>
        <h1>登录状态已变化</h1>
        <p>浏览器的登录身份与页面显示不一致。请回到 Mac，重新发起登录。</p>
        <Link href="/workspace">回到工作区</Link>
      </div></main>
    );
  }
  if (grant.state !== "prepared") {
    const outcome = {
      approved: {
        title: "登录请求已确认",
        message: "这个 Mac 登录请求已经确认过。请回到 Mac 继续；如果 Mac 没有继续，请在 Mac 重新发起登录。",
      },
      consumed: {
        title: "登录请求已完成",
        message: "这个 Mac 登录请求已经完成登录，没有可再确认的内容。如果这不是你的操作，请在设置中退出该 Mac 的会话。",
      },
      cancelled: {
        title: "登录请求已取消",
        message: "这个 Mac 登录请求已取消。请回到 Mac，重新发起登录。",
      },
      expired: {
        title: "登录请求已过期",
        message: "这个 Mac 登录请求已过期。请回到 Mac，重新发起登录。",
      },
    }[grant.state];
    return (
      <main id="main-content" className={styles.page}><div className={styles.topbar}><Link href="/" className="brand">capri</Link><span>Mac 登录</span></div><div className={styles.content}>
        <h1>{outcome.title}</h1>
        <p>{outcome.message}</p>
        <Link href="/workspace">回到工作区</Link>
      </div></main>
    );
  }
  // The seal binds the live primary session, so a later tab whose cookie
  // changed can never post this form for another identity.
  const csrf = await sealDesktopAuthCsrf(attempt, state, {
    backendAccessToken: claims.backendAccessToken,
    backendAccountId: claims.backendAccountId,
    backendUserId: claims.backendUserId,
  });
  return (
    <main id="main-content" className={styles.page}><div className={styles.topbar}><Link href="/" className="brand">capri</Link><span>Mac 登录</span></div><div className={styles.content}>
      <h1>确认在这台 Mac 上登录</h1>
      <p className={styles.description}>确认账号与匹配码后，工作区将在 Mac 上打开。</p>
      <div className={styles.identity}>
        <strong>{identity.user.display_name}</strong>
        <p>{identity.user.email}<br />{identity.account.name}</p>
      </div>
      <div className={styles.pairing}>
        <span>与你的 Mac 核对匹配码</span><strong>{grant.matching_hint}</strong>
      </div>
      <p className={styles.notice}>仅在你刚刚从 Mac 发起登录、且匹配码一致时继续。</p>
      <form method="POST" action="/api/desktop-auth/approve">
        <input type="hidden" name="attempt_id" value={attempt} />
        <input type="hidden" name="state" value={state} />
        <input type="hidden" name="csrf_token" value={csrf.token} />
        <input type="hidden" name="csrf_sealed" value={csrf.sealed} />
        <button className={styles.primary} type="submit">继续，登录到这台 Mac</button>
      </form>
      <form method="POST" action="/api/desktop-auth/decline">
        <input type="hidden" name="attempt_id" value={attempt} />
        <input type="hidden" name="state" value={state} />
        <input type="hidden" name="csrf_token" value={csrf.token} />
        <input type="hidden" name="csrf_sealed" value={csrf.sealed} />
        <button className={styles.secondary} type="submit">取消</button>
      </form>
    </div></main>
  );
}
