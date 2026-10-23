import { TalentSignalHttpError } from "@talent-signal/contracts";
import { NextResponse } from "next/server";

import { backendSessionIsExpired, workspaceSessionExpiryHeaders } from "@/lib/backend-session";
import { isAllowedMutationOrigin } from "@/lib/request-origin";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import {
  createUnscopedWorkspaceSession,
  isWorkspaceSessionCursor,
  isWorkspaceSessionId,
  isWorkspaceSessionTimestamp,
  loadWorkspaceSessionDirectory,
  workspaceSessionDetailWire,
  workspaceSessionSummaryWire,
  workspaceSessionsBinding,
  type WorkspaceSessionState,
} from "@/lib/server/workspaceSessions";

export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { ...noStore, ...workspaceSessionExpiryHeaders(status, body) } });
}

function failure(error: unknown) {
  if (error instanceof TalentSignalHttpError) {
    return reply({ code: error.code, message: error.message }, error.status);
  }
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const message =
      "message" in error && typeof error.message === "string"
        ? error.message
        : "对话目录暂时不可用。";
    return reply({ code: error.code, message }, error.status);
  }
  return reply(
    {
      code: "agent_session_unavailable",
      message: "对话目录暂时不可用；系统不会展示陈旧内容。",
    },
    503,
  );
}

/**
 * Directory reads are server-authenticated: the browser never supplies an
 * account scope, and an unauthenticated caller receives no data at all.
 */
export async function GET(request: Request) {
  try {
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
      return reply({ code: "backend_session_expired", message: "请先登录。" }, 401);
    }
    const cursor = new URL(request.url).searchParams.get("cursor");
    if (cursor !== null && !isWorkspaceSessionCursor(cursor)) {
      return reply({ code: "agent_session_cursor_invalid", message: "分页标识无效。" }, 400);
    }
    const directory = await loadWorkspaceSessionDirectory({
      cursor: isWorkspaceSessionCursor(cursor) ? cursor : null,
    });
    return reply({
      sessions: directory.sessions.map((summary) =>
        workspaceSessionSummaryWire(summary, "active" as WorkspaceSessionState),
      ),
      complete: directory.complete,
      next_cursor: directory.nextCursor,
      session_version: workspaceSessionsBinding(claims),
    });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Create an unscoped Session. This performs no model work and binds no
 * relationship scope; identity selection stays an explicit People-directory
 * action after the fact.
 */
export async function POST(request: Request) {
  if (!isAllowedMutationOrigin(request.headers)) {
    return reply({ message: "跨站请求已拒绝。" }, 403);
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return reply({ message: "请求格式无效。" }, 415);
  }
  try {
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
      return reply({ code: "backend_session_expired", message: "请先登录。" }, 401);
    }
    if (request.headers.get("x-workspace-session") !== workspaceSessionsBinding(claims)) {
      return reply(
        { code: "session_stale", message: "登录已改变，请重新打开对话列表。" },
        409,
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return reply({ message: "请求格式无效。" }, 400);
    }
    const input = body as { session_id?: unknown; title?: unknown; updated_at?: unknown };
    if (
      !isWorkspaceSessionId(input?.session_id) ||
      !isWorkspaceSessionTimestamp(input.updated_at)
    ) {
      return reply({ message: "对话标识无效。" }, 400);
    }
    const detail = await createUnscopedWorkspaceSession({
      sessionId: input.session_id,
      title: typeof input.title === "string" ? input.title : undefined,
      updatedAt: input.updated_at,
    });
    return reply(
      {
        detail: workspaceSessionDetailWire(detail),
        session_version: workspaceSessionsBinding(claims),
      },
      201,
    );
  } catch (error) {
    return failure(error);
  }
}
