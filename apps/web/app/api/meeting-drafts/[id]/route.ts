import {
  MeetingDraftUpdateRequestSchema,
  TalentSignalHttpError,
  type MeetingDraftUpdateRequest,
} from "@talent-signal/contracts";
import { NextResponse } from "next/server";

import { backendSessionIsExpired } from "@/lib/backend-session";
import { isAllowedMutationOrigin } from "@/lib/request-origin";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import {
  readMeetingDraft,
  updateMeetingDraft,
} from "@/lib/server/meetingDrafts";
import {
  isWorkspaceSessionId,
  workspaceSessionsBinding,
} from "@/lib/server/workspaceSessions";
import { matchesTypeBox } from "@/lib/typebox-validation";

const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

async function authorizedRequest(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<
  | { claims: NonNullable<Awaited<ReturnType<typeof readBackendSessionClaims>>>; id: string }
  | NextResponse
> {
  if (!isAllowedMutationOrigin(request.headers)) {
    return reply({ code: "origin_rejected", message: "跨站请求已拒绝。" }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return reply({ code: "invalid_content_type", message: "请求格式无效。" }, 415);
  }
  const claims = await readBackendSessionClaims();
  if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
    return reply({ code: "backend_session_expired", message: "请先登录。" }, 401);
  }
  if (request.headers.get("x-workspace-session") !== workspaceSessionsBinding(claims)) {
    return reply({ code: "session_stale", message: "登录已变化，请刷新后重试。" }, 409);
  }
  const { id } = await context.params;
  if (!isWorkspaceSessionId(id)) {
    return reply({ code: "meeting_draft_invalid", message: "会议草稿标识无效。" }, 400);
  }
  return { claims, id };
}

function backendFailure(error: unknown): NextResponse {
  if (error instanceof TalentSignalHttpError) {
    return reply({ code: error.code, message: error.message }, error.status);
  }
  return reply(
    {
      code: "meeting_draft_unavailable",
      message: "会议草稿状态暂时无法核验；页面没有假设操作成功。",
    },
    503,
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const claims = await readBackendSessionClaims();
  if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
    return reply({ code: "backend_session_expired", message: "请先登录。" }, 401);
  }
  const binding = workspaceSessionsBinding(claims);
  if (request.headers.get("x-workspace-session") !== binding) {
    return reply({ code: "session_stale", message: "登录已变化，请刷新后重试。" }, 409);
  }
  const { id } = await context.params;
  if (!isWorkspaceSessionId(id)) {
    return reply({ code: "meeting_draft_invalid", message: "会议草稿标识无效。" }, 400);
  }
  try {
    const draft = await readMeetingDraft(id);
    return reply({ draft, session_version: binding });
  } catch (error) {
    return backendFailure(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorized = await authorizedRequest(request, context);
  if (authorized instanceof NextResponse) return authorized;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply({ code: "meeting_draft_invalid", message: "请求格式无效。" }, 400);
  }
  if (!matchesTypeBox(MeetingDraftUpdateRequestSchema, body)) {
    return reply({ code: "meeting_draft_invalid", message: "会议草稿修改参数无效。" }, 400);
  }
  try {
    const draft = await updateMeetingDraft(
      authorized.id,
      body as MeetingDraftUpdateRequest,
    );
    return reply({
      draft,
      session_version: workspaceSessionsBinding(authorized.claims),
    });
  } catch (error) {
    if (
      error instanceof TalentSignalHttpError &&
      error.status === 409 &&
      error.code === "MEETING_DRAFT_REVISION_CONFLICT"
    ) {
      try {
        const draft = await readMeetingDraft(authorized.id);
        return reply({ code: error.code, draft, message: error.message }, 409);
      } catch (readError) {
        return backendFailure(readError);
      }
    }
    return backendFailure(error);
  }
}

/**
 * Re-read source authority immediately before generating an ICS file. This is
 * deliberately a same-origin POST so a stale open tab cannot rely on cached
 * content after source revocation, expiry, dismissal, or another edit.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorized = await authorizedRequest(request, context);
  if (authorized instanceof NextResponse) return authorized;
  let body: { expected_revision?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return reply({ code: "meeting_draft_invalid", message: "请求格式无效。" }, 400);
  }
  if (!Number.isInteger(body.expected_revision) || Number(body.expected_revision) < 1) {
    return reply({ code: "meeting_draft_invalid", message: "导出核验参数无效。" }, 400);
  }
  try {
    const draft = await readMeetingDraft(authorized.id);
    if (
      draft.status !== "needs_review" ||
      !draft.content_available ||
      draft.revision !== Number(body.expected_revision)
    ) {
      return reply(
        {
          code: "MEETING_DRAFT_EXPORT_CONFLICT",
          message: "草稿已变化或来源不再可用，请刷新后重新核对。",
        },
        409,
      );
    }
    return reply({
      draft,
      session_version: workspaceSessionsBinding(authorized.claims),
    });
  } catch (error) {
    return backendFailure(error);
  }
}
