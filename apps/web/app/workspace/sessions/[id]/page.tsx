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
import {
  isWorkspaceSessionId,
  loadWorkspaceSession,
  workspaceSessionDraftStorageScope,
  workspaceSessionDetailWire,
  workspaceSessionsBinding,
  type WorkspaceSessionDetailWire,
} from "@/lib/server/workspaceSessions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "对话 · capri",
};

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

  let detail: WorkspaceSessionDetailWire | null = null;
  let error: string | null = null;
  let sessionRecoveryHref: string | null = null;
  try {
    detail = workspaceSessionDetailWire(await loadWorkspaceSession(id));
  } catch (caught) {
    if (isBackendSessionExpiredError(caught)) {
      sessionRecoveryHref = backendSessionRecoveryHref(`/workspace/sessions/${id}`);
      error = "登录已过期，请重新登录后查看这段对话。";
    } else {
      error = "无法读取这段对话；系统不会用缓存或示例内容代替。";
    }
  }

  if (!detail) {
    return (
      <section aria-labelledby="session-unavailable" className="workspace-section">
        <h1 id="session-unavailable">对话不可用</h1>
        <p role="alert">{error}</p>
        {sessionRecoveryHref ? (
          <a href={sessionRecoveryHref}>重新登录</a>
        ) : null}
        <p>
          <Link href="/workspace/sessions">返回对话列表</Link>
        </p>
      </section>
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
