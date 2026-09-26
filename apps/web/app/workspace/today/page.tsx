import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { PursuitTodayPage } from "@/components/pursuit-today-page";
import {
  backendSessionRecoveryHref,
  isBackendSessionExpiredError,
} from "@/lib/backend-session";
import {
  isPursuitIntegrationMode,
  loadPursuitToday,
} from "@/lib/server/pursuitBackend";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description:
    "需要关注的目标、待审阅内容和已分配行动。",
  robots: { follow: false, index: false },
  title: "今日",
};

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=%2Fworkspace%2Ftoday");
  }
  if (!isPursuitIntegrationMode()) redirect("/workspace");

  const parameters = await searchParams;
  const expanded = parameters.view === "all";
  let data: Awaited<ReturnType<typeof loadPursuitToday>> | null = null;
  let error: string | null = null;
  let sessionRecoveryHref: string | null = null;
  try {
    data = await loadPursuitToday({ expanded });
  } catch (caught) {
    if (isBackendSessionExpiredError(caught)) {
      error = caught.message;
      sessionRecoveryHref = backendSessionRecoveryHref("/workspace/today");
    } else {
      error =
        "暂时无法读取当前账号的目标，请稍后重试。";
    }
  }

  return (
    <PursuitTodayPage
      error={error}
      expanded={expanded}
      projection={data?.projection ?? null}
      providerMode={data?.providerMode ?? "safe_deterministic"}
      sessionRecoveryHref={sessionRecoveryHref}
    />
  );
}
