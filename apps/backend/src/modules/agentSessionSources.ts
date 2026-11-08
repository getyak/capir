import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import type { ChatResponseBlock } from "@talent-signal/contracts";
import type { PoolClient } from "pg";
import { savedMemoryDeadline, savedMemoryOwnArray, savedMemoryOwnRecord,
  savedMemoryUnavailable, savedMemoryUUID } from "./savedMemoryLineage.js";

export function markSessionContextAnswer(
  block: ChatResponseBlock,
  objective: string,
): ChatResponseBlock {
  if (block.kind !== "answer") return block;
  return {
    ...block,
    status: "proposed",
    title:
      `${/\p{Script=Han}/u.test(objective) ? "截图理解（待确认）" : "Unconfirmed screenshot interpretation"} · ${block.title}`.slice(
        0,
        240,
      ),
  };
}

export interface AgentSessionChatSource {
  taskID: string;
  fingerprint: string;
}

export type SessionChatRetention =
  | Readonly<{ kind: "session_bound"; original_expires_at: string }>
  | Readonly<{ kind: "canonical_no_session" }>;
declare const sessionChatRetentionBrand: unique symbol;
export interface SessionChatRetentionReceipt { readonly [sessionChatRetentionBrand]: true }
interface SessionChatRetentionFact {
  readonly accountID: string;
  readonly actorID: string;
  readonly taskID: string;
  readonly originSessionID: string | null;
  readonly retention: SessionChatRetention;
}
const sessionChatRetentionReceipts = new WeakMap<object,
  Readonly<SessionChatRetentionFact & { client: PoolClient }>>();

/** Source-retention fact only: not authentication, canonical completion,
 * transaction/COMMIT proof, or permission to publish a reply. The durable owner
 * must consume this exact receipt on the same client and verify its real
 * canonical completion before registering Memory lineage. */
export async function recordSessionChatSourcesWithRetention(
  client: PoolClient,
  auth: AuthContext,
  sessionID: string | undefined,
  taskID: string,
  sources: AgentSessionChatSource[],
  previousTaskIDs: string[] = [],
): Promise<SessionChatRetentionReceipt> {
  const fields = savedMemoryOwnRecord(auth,
    ["accountId", "accountSlug", "userId", "userEmail", "userKind", "sessionId"]);
  for (const key of ["accountSlug", "userEmail", "userKind", "sessionId"]) {
    if (typeof fields[key] !== "string") return savedMemoryUnavailable();
  }
  fields.accountId = savedMemoryUUID(fields.accountId);
  fields.userId = savedMemoryUUID(fields.userId);
  const current = Object.freeze(fields) as unknown as AuthContext;
  const currentTaskID = savedMemoryUUID(taskID);
  const currentSessionID = sessionID === undefined ? undefined : savedMemoryUUID(sessionID);
  const currentSources = savedMemoryOwnArray(sources, SESSION_CHAT_SOURCE_LIMIT).map(value => {
    const source = savedMemoryOwnRecord(value, ["taskID", "fingerprint"]);
    if (typeof source.fingerprint !== "string") return savedMemoryUnavailable();
    return Object.freeze({ taskID: savedMemoryUUID(source.taskID), fingerprint: source.fingerprint });
  });
  // The existing history owner supplies its own bound; do not invent a new
  // parent-count policy or silently truncate its admitted ancestry here.
  const currentPrevious = savedMemoryOwnArray(previousTaskIDs, Number.MAX_SAFE_INTEGER).map(savedMemoryUUID);
  await recordSessionChatSources(client, current, currentSessionID, currentTaskID,
    currentSources, currentPrevious);
  let retention: SessionChatRetention;
  if (currentSessionID === undefined) {
    // This is the real source owner's validated no-Session/no-source branch.
    // Missing task rows and caller-supplied NULL deadlines cannot select it.
    if (currentSources.length !== 0) return savedMemoryUnavailable();
    retention = Object.freeze({ kind: "canonical_no_session" });
  } else {
    // Same transaction/client readback of the row the canonical source owner
    // just inserted, preserving the database's six-digit value and all original
    // Session/ancestor/30-day narrowing. Never recreate it from a JS Date.
    const row = (await client.query<{ original_expires_at: string }>(
      `SELECT to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS original_expires_at
       FROM agent_session_chat_tasks
       WHERE account_id=$1 AND actor_user_id=$2 AND task_id=$3 AND origin_session_id=$4`,
      [current.accountId, current.userId, currentTaskID, currentSessionID],
    )).rows;
    if (row.length !== 1) return savedMemoryUnavailable();
    retention = Object.freeze({ kind: "session_bound",
      original_expires_at: savedMemoryDeadline(row[0]!.original_expires_at) });
  }
  const receipt = Object.freeze({}) as SessionChatRetentionReceipt;
  sessionChatRetentionReceipts.set(receipt, Object.freeze({ client,
    accountID: current.accountId, actorID: current.userId, taskID: currentTaskID,
    originSessionID: currentSessionID ?? null, retention }));
  return receipt;
}

/** Only the actual durable publication owner consumes this private one-use
 * source fact. A JSON copy, different client/actor/task or second use refuses. */
export function consumeSessionChatRetentionReceipt(client: PoolClient, auth: AuthContext,
  taskID: string, receipt: SessionChatRetentionReceipt): Readonly<SessionChatRetentionFact> {
  const fact = sessionChatRetentionReceipts.get(receipt);
  sessionChatRetentionReceipts.delete(receipt);
  if (!fact || fact.client !== client || fact.accountID !== auth.accountId
    || fact.actorID !== auth.userId || fact.taskID !== taskID) return savedMemoryUnavailable();
  return Object.freeze({ accountID: fact.accountID, actorID: fact.actorID,
    taskID: fact.taskID, originSessionID: fact.originSessionID, retention: fact.retention });
}
export const SESSION_CHAT_SOURCE_LIMIT = 20;
export interface AgentSessionScreenshotContext {
  id: string;
  subject_id: string | null;
  assignment_id: string | null;
  capture_id: string | null;
  source_resource_id: string | null;
  fingerprint: string;
  summary: string | null;
  findings: Array<{ text?: string; message_refs?: string[] }> | null;
  question: string | null;
  limitations: string[] | null;
}

export async function loadSessionScreenshotContexts(
  client: DatabaseClient,
  auth: AuthContext,
  taskIDs: string[],
): Promise<AgentSessionScreenshotContext[]> {
  if (!taskIDs.length) return [];
  return (
    await client.query<AgentSessionScreenshotContext>(
      `SELECT t.id,t.subject_id,t.assignment_id,t.capture_id,t.source_resource_id,
      agent_session_screenshot_fingerprint(t) AS fingerprint,
      t.state->'response'->>'summary' AS summary,t.state->'response'->'findings' AS findings,
      t.state->'response'->>'question' AS question,t.state->'response'->'limitations' AS limitations
    FROM screenshot_contact_tasks t WHERE t.account_id=$1 AND t.created_by_user_id=$2
      AND t.id::text=ANY($3::text[]) AND agent_session_screenshot_context_available($1,t.id)`,
      [auth.accountId, auth.userId, taskIDs],
    )
  ).rows;
}

export function screenshotConversationText(
  source: AgentSessionScreenshotContext,
  messageID: string,
): string {
  // Canonical Agent output only. Never read raw images, OCR messages, public page
  // bodies, or client display blocks to populate ordinary follow-up dialogue.
  return JSON.stringify({
    kind: "prior_screenshot_context",
    authority:
      "unconfirmed_interpretation_not_reviewed_evidence_or_action_authorization",
    task_id: source.id,
    message_id: messageID,
    capture_id: source.capture_id,
    source_resource_id: source.source_resource_id,
    summary: (source.summary ?? "").slice(0, 700),
    findings: (Array.isArray(source.findings) ? source.findings : [])
      .slice(0, 3)
      .map((finding) => ({
        text: (finding.text ?? "").slice(0, 200),
        message_refs: (finding.message_refs ?? [])
          .slice(0, 4)
          .map((ref) => ref.slice(0, 100)),
      })),
    question: source.question?.slice(0, 200) ?? null,
    limitations: (source.limitations ?? [])
      .slice(0, 2)
      .map((item) => item.slice(0, 150)),
  }).slice(0, 2000);
}

export async function inheritedSessionChatSources(
  client: DatabaseClient,
  auth: AuthContext,
  taskID: string,
): Promise<AgentSessionChatSource[] | null> {
  const available = await client.query<{ available: boolean }>(
    "SELECT agent_session_chat_sources_available($1,$2) AS available",
    [auth.accountId, taskID],
  );
  if (available.rows[0]?.available === false) return null;
  return (
    await client.query<{
      screenshot_task_id: string;
      source_fingerprint: string;
    }>(
      "SELECT screenshot_task_id,source_fingerprint FROM agent_session_chat_sources WHERE account_id=$1 AND actor_user_id=$2 AND task_id=$3",
      [auth.accountId, auth.userId, taskID],
    )
  ).rows.map((source) => ({
    taskID: source.screenshot_task_id,
    fingerprint: source.source_fingerprint,
  }));
}

export async function purgeUnavailableSessionChatSources(
  client: DatabaseClient,
  auth: AuthContext,
): Promise<void> {
  await client.query("SELECT purge_agent_session_chat_tasks($1)", [
    auth.accountId,
  ]);
  await client.query("SELECT retract_agent_session_chat_sources($1)", [
    auth.accountId,
  ]);
}

export async function assertSessionForChat(
  client: DatabaseClient,
  auth: AuthContext,
  sessionID: string,
  lock = false,
): Promise<Date> {
  const session = (
    await client
      .query<{
        expires_at: Date;
        deleted_at: Date | null;
      }>(`SELECT expires_at,deleted_at FROM agent_sessions WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3 ${lock ? "FOR SHARE NOWAIT" : ""}`, [auth.accountId, auth.userId, sessionID])
      .catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "55P03"
        )
          throw new ApiError(
            409,
            "AGENT_SESSION_CONFLICT",
            "The Session is changing. Retry against its current state.",
          );
        throw error;
      })
  ).rows[0];
  if (!session)
    throw new ApiError(
      404,
      "AGENT_SESSION_NOT_FOUND",
      "The Session is not available in this account and user scope.",
    );
  if (session.deleted_at || session.expires_at.valueOf() <= Date.now())
    throw new ApiError(
      410,
      "AGENT_SESSION_DELETED",
      "This Session was deleted or expired and its original requests cannot be retried.",
    );
  return session.expires_at;
}

export async function assertSessionChatSourcesAvailable(
  client: DatabaseClient,
  auth: AuthContext,
  taskID: string,
): Promise<void> {
  const owner = (
    await client.query<{ actor_user_id: string }>(
      "SELECT actor_user_id FROM agent_session_chat_tasks WHERE account_id=$1 AND task_id=$2",
      [auth.accountId, taskID],
    )
  ).rows[0];
  if (owner && owner.actor_user_id !== auth.userId)
    throw new ApiError(
      404,
      "AGENT_SESSION_NOT_FOUND",
      "The reply is not available in this account and user scope.",
    );
  const result = await client.query<{ available: boolean }>(
    "SELECT agent_session_chat_sources_available($1,$2) AS available",
    [auth.accountId, taskID],
  );
  if (result.rows[0]?.available === false)
    throw new ApiError(
      410,
      "AGENT_SESSION_CONTEXT_UNAVAILABLE",
      "The saved context for this reply was changed, withdrawn, or expired.",
    );
}

export async function recordSessionChatSources(
  client: DatabaseClient,
  auth: AuthContext,
  sessionID: string | undefined,
  taskID: string,
  sources: AgentSessionChatSource[],
  previousTaskIDs: string[] = [],
): Promise<void> {
  if (!sessionID && !sources.length) return;
  if (!sessionID || sources.length > SESSION_CHAT_SOURCE_LIMIT)
    throw new ApiError(
      409,
      "AGENT_SESSION_CONTEXT_UNAVAILABLE",
      "The screenshot context cannot be retained in this Session.",
    );
  // Generation can take seconds. Recheck the exact canonical content and take
  // short non-waiting source fences only when storing the result, never during
  // the model request. A concurrent revocation either wins or redacts on commit.
  await client.query("SET LOCAL lock_timeout = '100ms'");
  try {
    const ids = sources.map((source) => source.taskID);
    await client.query(
      "SELECT id FROM screenshot_contact_tasks WHERE account_id=$1 AND id=ANY($2::uuid[]) FOR SHARE NOWAIT",
      [auth.accountId, ids],
    );
    await client.query(
      `SELECT c.id FROM screenshot_contact_tasks t JOIN captures c ON c.account_id=t.account_id AND c.id=t.capture_id
      JOIN source_retention_receipts r ON r.account_id=c.account_id AND r.capture_id=c.id
      JOIN subjects p ON p.account_id=c.account_id AND p.id=c.subject_id
      JOIN assignments a ON a.account_id=c.account_id AND a.id=c.assignment_id
      WHERE t.account_id=$1 AND t.id=ANY($2::uuid[]) FOR SHARE OF c,r,p,a NOWAIT`,
      [auth.accountId, ids],
    );
    const sessionExpiresAt = await assertSessionForChat(
      client,
      auth,
      sessionID,
      true,
    );
    const current = await loadSessionScreenshotContexts(client, auth, ids);
    if (
      sources.some(
        (source) =>
          !current.some(
            (item) =>
              item.id === source.taskID &&
              item.fingerprint === source.fingerprint,
          ),
      )
    )
      throw new ApiError(
        409,
        "AGENT_SESSION_CONTEXT_UNAVAILABLE",
        "The screenshot context changed while the reply was being prepared. Ask again using its current state.",
      );
    const prior = (
      await client.query<{
        task_id: string;
        expires_at: Date;
        available: boolean;
      }>(
        "SELECT task_id,expires_at,agent_session_chat_sources_available(account_id,task_id) AS available FROM agent_session_chat_tasks WHERE account_id=$1 AND actor_user_id=$2 AND task_id=ANY($3::text[]) FOR SHARE NOWAIT",
        [auth.accountId, auth.userId, previousTaskIDs],
      )
    ).rows;
    if (prior.some((task) => !task.available))
      throw new ApiError(
        410,
        "AGENT_SESSION_CONTEXT_UNAVAILABLE",
        "The previous reply expired or was withdrawn while this answer was being prepared.",
      );
    const expiresAt = new Date(
      Math.min(
        sessionExpiresAt.valueOf(),
        Date.now() + 30 * 86_400_000,
        ...prior.map((task) => task.expires_at.valueOf()),
      ),
    );
    await client.query(
      // created_at defaults to the transaction's database clock. Bound expiry
      // to that same clock so app skew or a long transaction cannot exceed it.
      "INSERT INTO agent_session_chat_tasks(account_id,actor_user_id,task_id,origin_session_id,expires_at) VALUES($1,$2,$3,$4,LEAST($5::timestamptz,now()+interval '30 days'))",
      [auth.accountId, auth.userId, taskID, sessionID, expiresAt],
    );
    for (const source of sources)
      await client.query(
        "INSERT INTO agent_session_chat_sources(account_id,actor_user_id,task_id,screenshot_task_id,source_fingerprint) VALUES($1,$2,$3,$4,$5)",
        [
          auth.accountId,
          auth.userId,
          taskID,
          source.taskID,
          source.fingerprint,
        ],
      );
  } catch (error) {
    if (["55P03", "40P01"].includes((error as { code?: string }).code ?? ""))
      throw new ApiError(
        409,
        "AGENT_SESSION_CONTEXT_UNAVAILABLE",
        "The screenshot source is changing. Retry after its current state settles.",
      );
    throw error;
  }
}
