import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { PursuitTodayPage } from "@/components/pursuit-today-page";
import {
  BackendSessionExpiredError,
  backendSessionRecoveryHref,
  backendSessionIsExpired,
  isBackendSessionExpiredError,
} from "@/lib/backend-session";
import {
  isPursuitIntegrationMode,
  loadPursuitToday,
} from "@/lib/server/pursuitBackend";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import { workspaceSessionsBinding } from "@/lib/server/workspaceSessions";

import { getMarketingLocale } from "@/lib/server/marketing-locale";
import { translate } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getMarketingLocale();
  return { description: translate(locale, "需要关注的目标、待审阅内容和已分配行动。"), robots: { follow: false, index: false }, title: translate(locale, "今日") };
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=%2Fworkspace%2Ftoday");
  }
  const locale = await getMarketingLocale();
  const pursuitEnabled = isPursuitIntegrationMode();
  const claims = await readBackendSessionClaims();
  const binding = claims && !backendSessionIsExpired(claims.backendExpiresAt) ? workspaceSessionsBinding(claims) : "";

  const parameters = await searchParams;
  const expanded = parameters.view === "all";
  let data: Awaited<ReturnType<typeof loadPursuitToday>> | null = null;
  let error: string | null = null;
  let sessionRecoveryHref: string | null = null;
  try {
    if (pursuitEnabled) data = await loadPursuitToday({ expanded });
  } catch (caught) {
    if (isBackendSessionExpiredError(caught)) {
      error = caught instanceof BackendSessionExpiredError && caught.message === "登录状态已失效，请重新登录后继续。"
        ? translate(locale, caught.message)
        : caught.message;
      sessionRecoveryHref = backendSessionRecoveryHref("/workspace/today");
    } else {
      error =
        translate(locale, "暂时无法读取当前账号的目标，请稍后重试。");
    }
  }

  return (
    <PursuitTodayPage
      binding={binding}
      expiresAt={claims?.backendExpiresAt ?? null}
      pursuitEnabled={pursuitEnabled}
      error={error}
      expanded={expanded}
      projection={data?.projection ?? null}
      providerMode={data?.providerMode ?? "safe_deterministic"}
      sessionRecoveryHref={sessionRecoveryHref}
    />
  );
}
