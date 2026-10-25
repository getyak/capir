import { sessionBindingCredentials } from "./primary-session-binding";
import "server-only";

import { createHmac } from "node:crypto";

import {
  AgentSessionListResponseSchema,
  AgentSessionPayloadSchema,
  AgentSessionResponseSchema,
  TalentSignalClient,
  TalentSignalHttpError,
  type AgentSessionListResponse,
  type AgentSessionPayload,
  type AgentSessionRecord,
} from "@talent-signal/contracts";

import { matchesTypeBox } from "../typebox-validation";
import { authSecret, authenticatedBackendClient as signedInBackendClient, type BackendSessionClaims } from "./backendAuth";

/**
 * Web Agent Session vertical slice.
 *
 * Everything here is a view over the existing `/v1/agent-sessions` contract.
 * The browser never talks to the backend directly, never reads a fixture, and
 * never reaches a database. Session content stays display-only: it is a
 * conversation for continuity, never evidence, identity, or execution
 * authority. `display_authority` is always `stale_unconfirmed`, and this module
 * surfaces that truth instead of upgrading it.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_CURSOR = /^[A-Za-z0-9_-]{1,512}$/u;

/** Sessions retain for thirty days; the composer draft expires sooner. */
export const SESSION_RETENTION_DAYS = 30;
const MAX_TITLE_SEGMENTS = 32;
const MAX_TITLE_CODE_POINTS = 256;
export const MAX_COMPOSER_DRAFT_LENGTH = 12_000;

export type WorkspaceSessionScope =
  | {
      kind: "relationship";
      personId: string;
      relationshipContextId: string;
      personLabel: string;
      contextLabel: string;
      href: string;
    }
  | {
      kind: "identity_review";
      identityCaseId: string | null;
      personLabel: string;
      contextLabel: string;
      href: string | null;
    }
  | {
      kind: "unscoped";
      personLabel: string;
      contextLabel: string;
      href: null;
    };

export type WorkspaceSessionSummary = {
  sessionId: string;
  revision: number;
  updatedAt: string;
  expiresAt: string;
  title: string;
  turnCount: number;
  isUnread: boolean;
  scopeKind: AgentSessionPayload["scopeKind"];
  personId: string | null;
  relationshipContextId: string | null;
  personLabel: string;
  contextLabel: string;
  scope: WorkspaceSessionScope;
};

export type WorkspaceSessionDirectory = {
  sessions: WorkspaceSessionSummary[];
  complete: boolean;
  nextCursor: string | null;
};

export type WorkspaceSessionDetail = {
  record: AgentSessionRecord;
  summary: WorkspaceSessionSummary;
  turns: AgentSessionPayload["turns"];
  composerDraft: string | null;
  composerDraftUpdatedAt: string | null;
  state: WorkspaceSessionState;
};

export type WorkspaceSessionState =
  | "active"
  | "deleted"
  | "expired"
  | "unavailable";

export function isWorkspaceSessionId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isWorkspaceSessionCursor(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_CURSOR.test(value);
}

export function isWorkspaceSessionTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * Opaque non-authorizing exact-login binding, domain-separated from handoff.
 * Mac access renewal preserves its canonical session; new primary login does
 * not. Ordinary browser logins retain their exact credential/expiry boundary.
 */
export function workspaceSessionsBinding(claims: BackendSessionClaims): string {
  const identity = sessionBindingCredentials(claims);
  return createHmac("sha256", authSecret())
    .update(
      JSON.stringify([
        "workspace-sessions.v1",
        claims.backendAccountId,
        claims.backendUserId,
        ...(identity.backendSessionId
          ? ["persistent-macos.v1", identity.backendSessionId]
          : [identity.backendAccessToken, identity.backendExpiresAt]),
      ]),
    )
    .digest("hex");
}

/**
 * Stable, non-authorizing browser-storage partition for recoverable drafts.
 * It intentionally excludes the rotating access token and is never accepted
 * by an API as authentication or mutation authority.
 */
export function workspaceSessionDraftStorageScope(
  claims: BackendSessionClaims,
): string {
  return createHmac("sha256", authSecret())
    .update(
      JSON.stringify([
        "workspace-session-draft-storage.v1",
        claims.backendAccountId,
        claims.backendUserId,
      ]),
    )
    .digest("hex");
}

/**
 * The stored payload is authoritative, but a restored block or an old client
 * may hand back a shape we cannot render truthfully. Reject it rather than
 * guessing at missing authority.
 */
export function isWorkspaceSessionPayload(
  value: unknown,
): value is AgentSessionPayload {
  return matchesTypeBox(AgentSessionPayloadSchema, value);
}

export function isWorkspaceSessionListResponse(
  value: unknown,
): value is AgentSessionListResponse {
  return matchesTypeBox(AgentSessionListResponseSchema, value);
}

/** A Session is only `active` when a payload is present and the clock agrees. */
export function workspaceSessionState(
  record: Pick<AgentSessionRecord, "deleted_at" | "expires_at" | "payload">,
  now = Date.now(),
): WorkspaceSessionState {
  if (record.deleted_at) return "deleted";
  const expiration = Date.parse(record.expires_at);
  if (!Number.isFinite(expiration) || expiration <= now) return "expired";
  if (!record.payload) return "unavailable";
  return "active";
}

export function workspaceSessionStateLabel(state: WorkspaceSessionState): string {
  switch (state) {
    case "deleted":
      return "已删除";
    case "expired":
      return "已过期";
    case "unavailable":
      return "内容不可用";
    case "active":
      return "可用";
  }
}

function oneLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Display-only title bounded to one line and thirty-two user-perceived
 * characters, matching the mobile composer budget. Never renames the Session.
 */
export function workspaceSessionDisplayTitle(value: string): string {
  const normalized = oneLine(value);
  if (!normalized) return "未命名对话";
  let segments: string[];
  try {
    segments = Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        normalized,
      ),
      (part) => part.segment,
    );
  } catch {
    segments = Array.from(normalized);
  }
  const accepted: string[] = [];
  let codePoints = 0;
  for (const segment of segments) {
    const size = Array.from(segment).length;
    if (
      accepted.length >= MAX_TITLE_SEGMENTS ||
      codePoints + size > MAX_TITLE_CODE_POINTS
    ) {
      break;
    }
    accepted.push(segment);
    codePoints += size;
  }
  return accepted.join("").trim() || "未命名对话";
}

/**
 * A relationship-scoped Session returns to the governed workspace surface with
 * a return parameter. An unscoped Session returns to the People directory for
 * explicit identity selection and does not claim scope changed.
 */
export function workspaceSessionScope(
  payload: Pick<
    AgentSessionPayload,
    | "scopeKind"
    | "personID"
    | "relationshipContextID"
    | "identityResolutionCaseID"
    | "personDisplayLabel"
    | "contextDisplayLabel"
  >,
): WorkspaceSessionScope {
  const personLabel = payload.personDisplayLabel.trim();
  const contextLabel = payload.contextDisplayLabel?.trim() ?? "";
  if (
    payload.scopeKind === "relationship" &&
    payload.personID &&
    payload.relationshipContextID
  ) {
    // The exact Session return parameter is added by workspaceSessionReturnHref.
    const parameters = new URLSearchParams({
      context: payload.relationshipContextID,
      person: payload.personID,
    });
    return {
      kind: "relationship",
      personId: payload.personID,
      relationshipContextId: payload.relationshipContextID,
      personLabel,
      contextLabel,
      href: `/workspace?${parameters.toString()}`,
    };
  }
  if (payload.scopeKind === "identity_review") {
    const caseId =
      payload.identityResolutionCaseID && UUID.test(payload.identityResolutionCaseID)
        ? payload.identityResolutionCaseID
        : null;
    return {
      kind: "identity_review",
      identityCaseId: caseId,
      personLabel,
      contextLabel,
      href: caseId
        ? `/workspace?identity_case=${encodeURIComponent(caseId)}`
        : null,
    };
  }
  return {
    kind: "unscoped",
    personLabel,
    contextLabel,
    href: null,
  };
}

/** The exact return link, including this Session for restoration. */
export function workspaceSessionReturnHref(
  summary: Pick<WorkspaceSessionSummary, "sessionId" | "scope">,
): { href: string; label: string; note: string } {
  if (summary.scope.kind === "relationship") {
    const parameters = new URLSearchParams({
      context: summary.scope.relationshipContextId,
      person: summary.scope.personId,
      session: summary.sessionId,
    });
    return {
      href: `/workspace?${parameters.toString()}`,
      label: `回到 ${summary.scope.personLabel || "该联系人"} 的关系工作台`,
      note: "关系范围来自这条对话的会话记录。",
    };
  }
  if (summary.scope.kind === "identity_review") {
    return {
      href: summary.scope.href ?? "/workspace/people",
      label: "继续处理身份核对",
      note: "这条对话属于身份核对，不绑定某个联系人或关系情境。",
    };
  }
  return {
    href: "/workspace/people",
    label: "在联系人目录中选择身份",
    note: "这条对话还没有绑定联系人或关系情境；请在联系人目录中显式选择。",
  };
}

export function workspaceSessionSummary(record: AgentSessionRecord): WorkspaceSessionSummary | null {
  if (!record.payload) return null;
  const payload = record.payload;
  return {
    sessionId: record.session_id,
    revision: record.revision,
    updatedAt: record.updated_at,
    expiresAt: record.expires_at,
    title: workspaceSessionDisplayTitle(payload.title),
    turnCount: payload.turns.length,
    isUnread: payload.isUnread,
    scopeKind: payload.scopeKind,
    personId: payload.personID ?? null,
    relationshipContextId: payload.relationshipContextID ?? null,
    personLabel: payload.personDisplayLabel.trim(),
    contextLabel: payload.contextDisplayLabel?.trim() ?? "",
    scope: workspaceSessionScope(payload),
  };
}

/**
 * Truthful directory projection: tombstoned, expired, and payload-less records
 * keep their identity and state but are never presented as resumable content.
 */
export function workspaceSessionDirectory(
  response: AgentSessionListResponse,
  now = Date.now(),
): WorkspaceSessionDirectory {
  const sessions: WorkspaceSessionSummary[] = [];
  for (const record of response.sessions) {
    if (workspaceSessionState(record, now) !== "active") continue;
    const summary = workspaceSessionSummary(record);
    if (summary) sessions.push(summary);
  }
  return {
    sessions,
    complete: response.complete,
    nextCursor: response.next_cursor,
  };
}

export function workspaceSessionDetail(
  record: AgentSessionRecord,
  now = Date.now(),
): WorkspaceSessionDetail {
  const summary = workspaceSessionSummary(record);
  return {
    record,
    summary: summary ?? {
      sessionId: record.session_id,
      revision: record.revision,
      updatedAt: record.updated_at,
      expiresAt: record.expires_at,
      title: "内容不可用",
      turnCount: 0,
      isUnread: false,
      scopeKind: "unresolved_intent",
      personId: null,
      relationshipContextId: null,
      personLabel: "",
      contextLabel: "",
      scope: workspaceSessionScope({
        scopeKind: "unresolved_intent",
        personDisplayLabel: "",
        contextDisplayLabel: "",
      }),
    },
    turns: record.payload?.turns ?? [],
    composerDraft: record.payload?.composerDraft ?? null,
    composerDraftUpdatedAt: record.payload?.composerDraftUpdatedAt ?? null,
    state: workspaceSessionState(record, now),
  };
}

/**
 * Wire shape returned to the browser. It mirrors the canonical display-only
 * fields and adds the server-computed state. The browser never receives a
 * mutation channel or an authority upgrade.
 */
export type WorkspaceSessionSummaryWire = {
  session_id: string;
  revision: number;
  updated_at: string;
  expires_at: string;
  state: WorkspaceSessionState;
  title: string;
  turn_count: number;
  is_unread: boolean;
  scope_kind: AgentSessionPayload["scopeKind"];
  person_id: string | null;
  relationship_context_id: string | null;
  person_label: string;
  context_label: string;
  scope: WorkspaceSessionScope;
};

export type WorkspaceSessionDetailWire = WorkspaceSessionSummaryWire & {
  deleted_at: string | null;
  display_authority: AgentSessionRecord["display_authority"];
  composer_draft: string | null;
  composer_draft_updated_at: string | null;
  turns: AgentSessionPayload["turns"];
};

export function workspaceSessionSummaryWire(
  summary: WorkspaceSessionSummary,
  state: WorkspaceSessionState,
): WorkspaceSessionSummaryWire {
  return {
    session_id: summary.sessionId,
    revision: summary.revision,
    updated_at: summary.updatedAt,
    expires_at: summary.expiresAt,
    state,
    title: summary.title,
    turn_count: summary.turnCount,
    is_unread: summary.isUnread,
    scope_kind: summary.scopeKind,
    person_id: summary.personId,
    relationship_context_id: summary.relationshipContextId,
    person_label: summary.personLabel,
    context_label: summary.contextLabel,
    scope: summary.scope,
  };
}

export function workspaceSessionDetailWire(
  detail: WorkspaceSessionDetail,
): WorkspaceSessionDetailWire {
  return {
    ...workspaceSessionSummaryWire(detail.summary, detail.state),
    deleted_at: detail.record.deleted_at,
    display_authority: detail.record.display_authority,
    composer_draft: detail.composerDraft,
    composer_draft_updated_at: detail.composerDraftUpdatedAt,
    turns: detail.turns,
  };
}

/** Draft persistence is bounded by the shared contract, never by the browser. */
export function boundedComposerDraft(value: string): string {
  if (value.length <= MAX_COMPOSER_DRAFT_LENGTH) return value;
  return value.slice(0, MAX_COMPOSER_DRAFT_LENGTH);
}

export function composerDraftIsDirty(
  draft: string,
  record: Pick<AgentSessionRecord, "payload">,
): boolean {
  return boundedComposerDraft(draft) !== (record.payload?.composerDraft ?? "");
}

const CONFLICT_CODES = new Set([
  "AGENT_SESSION_REVISION_CONFLICT",
  "AGENT_SESSION_IDEMPOTENCY_CONFLICT",
  "AGENT_SESSION_SCOPE_CHANGED",
  "AGENT_SESSION_SOURCE_BUSY",
]);

/**
 * A concurrent revision conflict must never overwrite the other device's work.
 * The caller keeps the local draft and offers reload-latest.
 */
export function isSessionConflict(error: unknown): boolean {
  return (
    error instanceof TalentSignalHttpError &&
    (error.status === 409 || CONFLICT_CODES.has(error.code))
  );
}

export function isSessionGone(error: unknown): boolean {
  return (
    error instanceof TalentSignalHttpError &&
    (error.status === 410 || error.code === "AGENT_SESSION_DELETED")
  );
}

async function client(): Promise<TalentSignalClient> {
  const signedIn = await signedInBackendClient();
  if (!signedIn) {
    // There is no shared account and no fixture fallback for account-scoped
    // Sessions. An unauthenticated read must fail closed.
    throw new TalentSignalHttpError(
      401,
      "backend_session_expired",
      "请先登录再查看对话。",
      null,
    );
  }
  return signedIn;
}

function assertList(value: unknown): AgentSessionListResponse {
  if (!isWorkspaceSessionListResponse(value)) {
    throw new TalentSignalHttpError(
      502,
      "agent_session_unavailable",
      "后端返回的对话目录不符合约定，已停止展示。",
      null,
    );
  }
  return value;
}

export async function loadWorkspaceSessionDirectory(options: {
  cursor?: string | null;
} = {}): Promise<WorkspaceSessionDirectory> {
  const after = isWorkspaceSessionCursor(options.cursor) ? options.cursor : null;
  const response = assertList(
    await (await client()).listAgentSessions(after ?? undefined),
  );
  return workspaceSessionDirectory(response);
}

export async function loadWorkspaceSession(
  sessionId: string,
): Promise<WorkspaceSessionDetail> {
  if (!isWorkspaceSessionId(sessionId)) {
    throw new TalentSignalHttpError(400, "agent_session_invalid", "对话标识无效。", null);
  }
  const response = await (await client()).getAgentSession(sessionId);
  if (!matchesTypeBox(AgentSessionResponseSchema, response)) {
    throw new TalentSignalHttpError(
      502,
      "agent_session_unavailable",
      "后端返回的对话不符合约定，已停止展示。",
      null,
    );
  }
  return workspaceSessionDetail(response.session);
}

/**
 * Create an unscoped Session with no model work. The id is generated locally so
 * the caller owns the idempotency key: a retry after an unknown response
 * reuses the same Session instead of duplicating the conversation.
 */
export async function createUnscopedWorkspaceSession(options: {
  sessionId: string;
  idempotencyKey?: string;
  title?: string;
  updatedAt: string;
}): Promise<WorkspaceSessionDetail> {
  if (
    !isWorkspaceSessionId(options.sessionId) ||
    !isWorkspaceSessionTimestamp(options.updatedAt)
  ) {
    throw new TalentSignalHttpError(400, "agent_session_invalid", "对话标识无效。", null);
  }
  const title = workspaceSessionDisplayTitle(
    options.title?.trim() || "新的对话",
  );
  const response = await (await client()).saveAgentSession(options.sessionId, {
    expected_revision: 0,
    idempotency_key: options.idempotencyKey ?? options.sessionId,
    payload: {
      id: options.sessionId,
      isUnread: false,
      scopeKind: "unresolved_intent",
      title,
      turns: [],
      updatedAt: options.updatedAt,
      personDisplayLabel: "",
      contextDisplayLabel: "",
    },
  });
  return workspaceSessionDetail(response.session);
}

export type SaveWorkspaceSessionDraftInput = {
  sessionId: string;
  expectedRevision: number;
  idempotencyKey: string;
  composerDraft: string;
  composerDraftUpdatedAt: string;
};

/**
 * Persist only the composer draft against the exact revision read from the
 * backend. Turns, title, scope, and feedback are carried through unchanged:
 * this vertical slice never invents conversation content or narrows authority.
 */
export async function saveWorkspaceSessionDraft(
  input: SaveWorkspaceSessionDraftInput,
): Promise<WorkspaceSessionDetail> {
  if (
    !isWorkspaceSessionId(input.sessionId) ||
    !UUID.test(input.idempotencyKey) ||
    !isWorkspaceSessionTimestamp(input.composerDraftUpdatedAt)
  ) {
    throw new TalentSignalHttpError(400, "agent_session_invalid", "保存参数无效。", null);
  }
  if (
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 1
  ) {
    throw new TalentSignalHttpError(400, "agent_session_invalid", "保存参数无效。", null);
  }
  const current = await loadWorkspaceSession(input.sessionId);
  if (current.state !== "active" || !current.record.payload) {
    throw new TalentSignalHttpError(
      410,
      "AGENT_SESSION_DELETED",
      "这段对话已删除或过期，未保存任何内容。",
      null,
    );
  }
  const draft = boundedComposerDraft(input.composerDraft);
  if (current.record.revision !== input.expectedRevision) {
    if (
      current.record.revision > input.expectedRevision &&
      current.record.payload.composerDraft === draft &&
      current.record.payload.composerDraftUpdatedAt ===
        input.composerDraftUpdatedAt
    ) {
      // The original mutation committed but its response was lost. The exact
      // caller-owned draft identity is already canonical, so replay success
      // without rebuilding a differently hashed backend request.
      return current;
    }
    throw new TalentSignalHttpError(
      409,
      "AGENT_SESSION_REVISION_CONFLICT",
      "另一端已更新这段对话；已保留本地草稿，请重新载入后核对。",
      null,
    );
  }
  const response = await (await client()).saveAgentSession(input.sessionId, {
    expected_revision: input.expectedRevision,
    idempotency_key: input.idempotencyKey,
    payload: {
      ...current.record.payload,
      composerDraft: draft,
      composerDraftUpdatedAt: input.composerDraftUpdatedAt,
    },
  });
  return workspaceSessionDetail(response.session);
}

export type DeleteWorkspaceSessionInput = {
  sessionId: string;
  expectedRevision: number;
  idempotencyKey: string;
};

/** Tombstone deletion. Reversible only by the canonical record, never locally. */
export async function deleteWorkspaceSession(
  input: DeleteWorkspaceSessionInput,
): Promise<WorkspaceSessionDetail> {
  if (!isWorkspaceSessionId(input.sessionId) || !UUID.test(input.idempotencyKey)) {
    throw new TalentSignalHttpError(400, "agent_session_invalid", "删除参数无效。", null);
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new TalentSignalHttpError(400, "agent_session_invalid", "删除参数无效。", null);
  }
  const response = await (await client()).deleteAgentSession(input.sessionId, {
    expected_revision: input.expectedRevision,
    idempotency_key: input.idempotencyKey,
  });
  return workspaceSessionDetail(response.session);
}
