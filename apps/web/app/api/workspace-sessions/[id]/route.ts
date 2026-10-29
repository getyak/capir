import { TalentSignalHttpError } from "@talent-signal/contracts";
import { NextResponse } from "next/server";

import { backendSessionIsExpired } from "@/lib/backend-session";
import { isAllowedMutationOrigin } from "@/lib/request-origin";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import {
  boundedComposerDraft,
  deleteWorkspaceSession,
  isWorkspaceSessionId,
  isWorkspaceSessionTimestamp,
  loadWorkspaceSession,
  renameWorkspaceSession,
  saveWorkspaceSessionDraft,
  workspaceSessionDetailWire,
  workspaceSessionsBinding,
} from "@/lib/server/workspaceSessions";

export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

function failure(error: unknown) {
  if (error instanceof TalentSignalHttpError) {
    return reply({ code: error.code, message: error.message }, error.status);
  }
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    const code =
      "code" in error && typeof error.code === "string"
        ? error.code
        : "agent_session_unavailable";
    const message =
      error instanceof Error && error.message
        ? error.message
        : "这段对话暂时不可用。";
    return reply({ code, message }, error.status);
  }
  return reply(
    {
      code: "agent_session_unavailable",
      message: "这段对话暂时不可用；本地草稿会保留，可以稍后重试。",
    },
    503,
  );
}

async function sessionId(context: {
  params: Promise<{ id: string }>;
}): Promise<string | null> {
  const id = (await context.params).id;
  return isWorkspaceSessionId(id) ? id : null;
}

/**
 * Mutations require both a same-origin browser request and the opaque UI
 * session binding. A stale binding returns 409 so the client can reopen the
 * directory without overwriting another login's data.
 */
async function guardMutation(
  request: Request,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (!isAllowedMutationOrigin(request.headers)) {
    return { ok: false, response: reply({ message: "跨站请求已拒绝。" }, 403) };
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return { ok: false, response: reply({ message: "请求格式无效。" }, 415) };
  }
  const claims = await readBackendSessionClaims();
  if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
    return {
      ok: false,
      response: reply({ code: "backend_session_expired", message: "请先登录。" }, 401),
    };
  }
  if (request.headers.get("x-workspace-session") !== workspaceSessionsBinding(claims)) {
    return {
      ok: false,
      response: reply(
        { code: "session_stale", message: "登录已改变，请重新打开对话列表。" },
        409,
      ),
    };
  }
  return { ok: true };
}

/** Detail reads are server-authenticated; deleted and expired states stay explicit. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const id = await sessionId(context);
    if (!id) return reply({ message: "对话标识无效。" }, 400);
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
      return reply({ code: "backend_session_expired", message: "请先登录。" }, 401);
    }
    const detail = await loadWorkspaceSession(id);
    return reply({
      detail: workspaceSessionDetailWire(detail),
      session_version: workspaceSessionsBinding(claims),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardMutation(request);
  if (!guard.ok) return guard.response;
  try {
    const id = await sessionId(context);
    if (!id) return reply({ message: "对话标识无效。" }, 400);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return reply({ message: "请求格式无效。" }, 400);
    }
    const input = body as {
      expected_revision?: unknown;
      idempotency_key?: unknown;
      composer_draft?: unknown;
      composer_draft_updated_at?: unknown;
    };
    if (
      !Number.isInteger(input?.expected_revision) ||
      typeof input.idempotency_key !== "string" ||
      !UUID.test(input.idempotency_key) ||
      typeof input.composer_draft !== "string" ||
      !isWorkspaceSessionTimestamp(input.composer_draft_updated_at)
    ) {
      return reply({ message: "保存参数无效。" }, 400);
    }
    const detail = await saveWorkspaceSessionDraft({
      sessionId: id,
      expectedRevision: input.expected_revision as number,
      idempotencyKey: input.idempotency_key,
      composerDraft: boundedComposerDraft(input.composer_draft),
      composerDraftUpdatedAt: input.composer_draft_updated_at,
    });
    return reply({ detail: workspaceSessionDetailWire(detail) });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (!guard.ok) return guard.response;
  try {
    const id = await sessionId(context);
    if (!id) return reply({ code: "agent_session_invalid" }, 400);
    const input: unknown = await request.json().catch(() => null);
    if (!input || typeof input !== "object" || !("title" in input) || typeof input.title !== "string"
      || !("expected_revision" in input) || !Number.isSafeInteger(input.expected_revision)
      || !("idempotency_key" in input) || typeof input.idempotency_key !== "string" || !UUID.test(input.idempotency_key)) {
      return reply({ code: "agent_session_invalid" }, 400);
    }
    const detail = await renameWorkspaceSession({ sessionId: id, title: input.title,
      expectedRevision: input.expected_revision as number, idempotencyKey: input.idempotency_key });
    return reply({ detail: workspaceSessionDetailWire(detail) });
  } catch (error) { return failure(error); }
}

/** Tombstone deletion, only after the client's explicit confirmation. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardMutation(request);
  if (!guard.ok) return guard.response;
  try {
    const id = await sessionId(context);
    if (!id) return reply({ message: "对话标识无效。" }, 400);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return reply({ message: "请求格式无效。" }, 400);
    }
    const input = body as {
      expected_revision?: unknown;
      idempotency_key?: unknown;
    };
    if (
      !Number.isInteger(input?.expected_revision) ||
      typeof input.idempotency_key !== "string" ||
      !UUID.test(input.idempotency_key)
    ) {
      return reply({ message: "删除参数无效。" }, 400);
    }
    const detail = await deleteWorkspaceSession({
      sessionId: id,
      expectedRevision: input.expected_revision as number,
      idempotencyKey: input.idempotency_key,
    });
    return reply({ detail: workspaceSessionDetailWire(detail) });
  } catch (error) {
    return failure(error);
  }
}
