import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { loadMeetingDrafts } from "@/lib/server/meetingDrafts";
import { contactHandoffSessionVersion } from "@/lib/server/contact-handoff-session";
import { mintMemoryEntryCapability } from "@/lib/server/memoryEntryCapability";
import { SessionWorkbench } from "@/components/session-workbench/session-workbench";
import {
  backendSessionRecoveryHref,
  isBackendSessionExpiredError,
} from "@/lib/backend-session";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import { translate } from "@/lib/i18n";
import { getMarketingLocale } from "@/lib/server/marketing-locale";
import {
  isWorkspaceSessionId,
  loadWorkspaceSession,
  workspaceSessionDraftStorageScope,
  workspaceSessionDetailWire,
  workspaceSessionsBinding,
  type WorkspaceSessionDetailWire,
} from "@/lib/server/workspaceSessions";
import styles from "./session-recovery.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getMarketingLocale();
  return { robots: { follow: false, index: false }, title: translate(locale, "对话") };
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    redirect(
      `/login?callbackUrl=${encodeURIComponent(`/workspace/sessions/${id}`)}`,
    );
  }
  if (!isWorkspaceSessionId(id)) {
    redirect("/workspace/sessions");
  }

  const claims = await readBackendSessionClaims();
  if (!claims) {
    redirect(
      backendSessionRecoveryHref(`/workspace/sessions/${id}`),
    );
  }

  const locale = await getMarketingLocale();
  const t = (key: string) => translate(locale, key);

  let detail: WorkspaceSessionDetailWire | null = null;
  let error: string | null = null;
  let sessionRecoveryHref: string | null = null;
  try {
    detail = workspaceSessionDetailWire(await loadWorkspaceSession(id));
  } catch (caught) {
    if (isBackendSessionExpiredError(caught)) {
      sessionRecoveryHref = backendSessionRecoveryHref(`/workspace/sessions/${id}`);
      error = t("登录已过期，请重新登录后查看这段对话。");
    } else {
      error = t("无法读取这段对话。");
    }
  }

  if (!detail) {
    return (
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <section aria-labelledby="session-unavailable" className={styles.recovery}>
          <h1 className={styles.title} id="session-unavailable">{t("对话不可用")}</h1>
          <p className={styles.message} role="alert">{error}</p>
          <div className={styles.actions}>
            {sessionRecoveryHref ? (
              <a className={styles.primary} href={sessionRecoveryHref}>{t("重新登录")}</a>
            ) : null}
            <Link className={sessionRecoveryHref ? styles.secondary : styles.primary} href="/workspace/sessions">
              {t("返回对话列表")}
            </Link>
          </div>
        </section>
      </main>
    );
  }

  let meetingLinks: Array<{id: string; title: string}> = [];
  let meetingReadFailed = false;
  if (detail.state === "active") {
    try {
      const projection = await loadMeetingDrafts();
      const tasks = new Set(detail.turns.map(turn => turn.response.taskID));
      meetingLinks = projection.drafts.filter(draft => draft.origin_session_id === detail.session_id &&
        tasks.has(draft.source_task_id) && draft.status === "needs_review" && draft.content_available)
        .map(draft => ({id: draft.id, title: draft.title ?? "会议草稿"}));
    } catch { meetingReadFailed = true; }
  }
  return (
    <SessionWorkbench
      initialDetail={detail}
      entryCapability={mintMemoryEntryCapability(claims, { purpose: "chat", sessionId: id })}
      meetingLinks={meetingLinks}
      meetingReadFailed={meetingReadFailed}
      accountId={claims.backendAccountId}
      chatSessionVersion={contactHandoffSessionVersion(claims)}
      initialError={error}
      sessionRecoveryHref={sessionRecoveryHref}
      storageScope={workspaceSessionDraftStorageScope(claims)}
      sessionVersion={workspaceSessionsBinding(claims)}
    />
  );
}
