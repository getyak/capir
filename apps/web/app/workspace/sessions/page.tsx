import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SessionDirectory } from "@/components/session-workbench/session-directory";
import {
  backendSessionRecoveryHref,
  isBackendSessionExpiredError,
} from "@/lib/backend-session";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import {
  loadWorkspaceSessionDirectory,
  workspaceSessionSummaryWire,
  workspaceSessionsBinding,
  type WorkspaceSessionSummary,
} from "@/lib/server/workspaceSessions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "账号专属的智能助理对话目录。",
  robots: { follow: false, index: false },
  title: "对话 · capri",
};

export default async function SessionsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=%2Fworkspace%2Fsessions");
  }

  const claims = await readBackendSessionClaims();
  if (!claims) {
    redirect(
      backendSessionRecoveryHref("/workspace/sessions"),
    );
  }

  let summaries: WorkspaceSessionSummary[] = [];
  let complete = true;
  let nextCursor: string | null = null;
  let error: string | null = null;
  let sessionRecoveryHref: string | null = null;
  try {
    const directory = await loadWorkspaceSessionDirectory();
    summaries = directory.sessions;
    complete = directory.complete;
    nextCursor = directory.nextCursor;
  } catch (caught) {
    if (isBackendSessionExpiredError(caught)) {
      sessionRecoveryHref = backendSessionRecoveryHref("/workspace/sessions");
      error = "登录已过期，请重新登录后查看对话。";
    } else {
      // No fixture and no cache: an unreadable backend stays visibly unavailable.
      error =
        "无法连接账号专属后端；系统不会用缓存或示例数据代替真实对话。";
    }
  }

  const sessions = summaries.map((summary) =>
    workspaceSessionSummaryWire(summary, "active"),
  );

  return (
    <SessionDirectory
      renderedAt={new Date().toISOString()}
      initialComplete={complete}
      initialError={error}
      initialNextCursor={nextCursor}
      initialSessions={sessions}
      sessionRecoveryHref={sessionRecoveryHref}
      sessionVersion={workspaceSessionsBinding(claims)}
    />
  );
}
