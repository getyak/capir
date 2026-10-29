import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { PeopleDirectoryApp } from "@/components/people-directory-app";
import {
  validReturnSessionId,
  withReturnSession,
} from "@/components/session-return-navigation";
import {
  backendSessionRecoveryHref,
  isBackendSessionExpiredError,
} from "@/lib/backend-session";
import {
  isIntegrationMode,
  loadPeopleDirectory,
  searchPeopleDirectory,
} from "@/lib/server/localBackend";

import { translate } from "@/lib/i18n";
import { getMarketingLocale } from "@/lib/server/marketing-locale";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getMarketingLocale();
  return {
    description: translate(locale, "账号专属的人物、关系情境与受治理来源目录。"),
    robots: { follow: false, index: false },
    title: translate(locale, "人物"),
  };
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string | string[]; session?: string | string[] }>;
}) {
  const locale = await getMarketingLocale();
  const parameters = await searchParams;
  const returnSessionId = validReturnSessionId(parameters.session);
  const queryInvalid = parameters.query !== undefined && typeof parameters.query !== "string";
  const query = (typeof parameters.query === "string" ? parameters.query : "")
    .normalize("NFKC")
    .trim()
    .slice(0, 160);
  const directoryHref = withReturnSession(
    query
      ? `/workspace/people?query=${encodeURIComponent(query)}`
      : "/workspace/people",
    returnSessionId,
  );
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(directoryHref)}`);
  }

  if (!isIntegrationMode()) {
    redirect("/workspace");
  }

  let people: Awaited<ReturnType<typeof loadPeopleDirectory>>["people"] = [];
  let error: string | null = queryInvalid ? translate(locale, "搜索条件无效，请只使用一个搜索条件。") : null;
  let sessionRecoveryHref: string | null = null;
  try {
    if (!queryInvalid) people = (
      await (query
        ? searchPeopleDirectory(query)
        : loadPeopleDirectory())
    ).people;
  } catch (caught) {
    if (isBackendSessionExpiredError(caught)) {
      error = translate(locale, caught.message);
      sessionRecoveryHref = backendSessionRecoveryHref(
        directoryHref,
      );
    } else {
      error =
        translate(locale, "无法连接账号专属后端；系统不会从陈旧数据推断关系状态。");
    }
  }

  return (
    <PeopleDirectoryApp
      error={error}
      people={people}
      query={query}
      returnSessionId={returnSessionId}
      sessionRecoveryHref={sessionRecoveryHref}
      queryInvalid={queryInvalid}
    />
  );
}
