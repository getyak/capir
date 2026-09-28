import "server-only";

import { backendAuthBaseUrl, readBackendSessionClaims } from "./backendAuth";
import {
  mintMemoryEntryCapability,
  verifyMemoryEntryCapability,
  type MemoryEntryPayload,
} from "./memoryEntryCapability";
import { backendSessionIsExpired } from "../backend-session";
import { contactHandoffSessionVersion } from "./contact-handoff-session";
import { isAllowedMutationOrigin } from "../request-origin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const MAX_BODY_BYTES = 200_000;

/**
 * Strict allowlist for the same-origin Memory BFF. The browser can only reach
 * the additive GET-40 review routes; it can never supply account or user
 * authority, and the backend bearer token stays server-side.
 */
function backendPath(segments: string[]): string | null {
  const [first, second, third] = segments;
  if (segments.length === 1 && first === "proposals") return "/v1/memory/proposals";
  if (segments.length === 3 && first === "proposals" && uuid.test(second!) && third === "reviews") {
    return `/v1/memory/proposals/${second}/reviews`;
  }
  if (segments.length === 3 && first === "proposals" && uuid.test(second!) && third === "rebases") {
    return `/v1/memory/proposals/${second}/rebases`;
  }
  if (segments.length === 2 && first === "reviews" && uuid.test(second!)) {
    return `/v1/memory/reviews/${second}`;
  }
  if (segments.length === 3 && first === "reviews" && uuid.test(second!) && ["draft", "commits", "dismissals", "item-decisions", "contact-decisions"].includes(third!)) {
    return `/v1/memory/reviews/${second}/${third}`;
  }
  if (segments.length === 1 && first === "items") return "/v1/memory/items";
  if (segments.length === 3 && first === "items" && uuid.test(second!) && third === "mutations") {
    return `/v1/memory/items/${second}/mutations`;
  }
  if (segments.length === 3 && first === "pursuits" && uuid.test(second!) && third === "scopes") {
    return `/v1/memory/pursuits/${second}/scopes`;
  }
  if (segments.length === 2 && first === "operation-views" && uuid.test(second!)) {
    return `/v1/memory/operation-views/${second}`;
  }
  if (segments.length === 3 && first === "operation-views" && uuid.test(second!) && third === "undo") {
    return `/v1/memory/operation-views/${second}/undo`;
  }
  return null;
}

const READ_METHODS = new Set(["GET", "HEAD"]);

class MemoryEntryMismatch extends Error {}

/**
 * Enforce the signed capability against the actual resource lineage read from
 * the backend, never a browser target claim. A business capability plus an old
 * broad Chat review credential must not expose or mutate private items.
 */
function enforceLineage(
  entry: MemoryEntryPayload,
  target: {
    purpose?: string | null;
    person_id?: string | null;
    relationship_context_id?: string | null;
    source_session_id?: string | null;
    pursuit_id?: string | null;
    pursuit_role_id?: string | null;
    pursuit_role_evidence_fragment_id?: string | null;
    pursuit_capture_id?: string | null;
    pursuit_capture_version?: number | null;
  },
): void {
  if (target.purpose && target.purpose !== entry.purpose) throw new MemoryEntryMismatch();
  if (entry.purpose === "people") {
    if (!entry.personId || target.person_id !== entry.personId) throw new MemoryEntryMismatch();
  } else if (entry.purpose === "relationship") {
    if (!entry.personId || target.person_id !== entry.personId) throw new MemoryEntryMismatch();
    if (entry.contextId && target.relationship_context_id !== entry.contextId) {
      throw new MemoryEntryMismatch();
    }
  } else if (entry.purpose === "chat") {
    // A Chat capability binds the exact originating Session when it names one.
    if (!entry.sessionId || target.source_session_id !== entry.sessionId) {
      throw new MemoryEntryMismatch();
    }
  }
  if (entry.pursuitId && (
    target.pursuit_id !== entry.pursuitId || target.pursuit_role_id !== entry.pursuitRoleId ||
    target.pursuit_role_evidence_fragment_id !== entry.pursuitEvidenceFragmentId ||
    target.pursuit_capture_id !== entry.pursuitCaptureId || target.pursuit_capture_version !== entry.pursuitCaptureVersion
  )) throw new MemoryEntryMismatch();
}

async function readBackendJson(
  path: string,
  claims: { backendAccessToken: string },
  credential: string | null,
  signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${backendAuthBaseUrl()}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${claims.backendAccessToken}`,
      "x-talent-signal-platform": "web",
      ...(credential ? { "x-memory-review-credential": credential } : {}),
    },
    signal,
  });
  if (!response.ok) return null;
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function operationLineage(entry: MemoryEntryPayload) {
  return { session_id: entry.sessionId, pursuit_id: entry.pursuitId,
    pursuit_role_id: entry.pursuitRoleId, pursuit_role_evidence_fragment_id: entry.pursuitEvidenceFragmentId,
    pursuit_capture_id: entry.pursuitCaptureId, pursuit_capture_version: entry.pursuitCaptureVersion };
}

/** Derive the purpose-scoped query from the signed entry, never the browser. */
function derivedSearch(
  segments: string[],
  entry: MemoryEntryPayload,
  original: URLSearchParams,
): string {
  const [first, second, third] = segments;
  for (const [field, expected] of Object.entries({ person_id: entry.personId, relationship_context_id: entry.contextId, session_id: entry.sessionId })) {
    if (original.has(field) && original.get(field) !== expected) throw new MemoryEntryMismatch();
  }
  if (first === "proposals" && segments.length === 1) {
    const claimedPurpose = original.get("purpose");
    if (claimedPurpose && claimedPurpose !== entry.purpose) throw new MemoryEntryMismatch();
    const params = new URLSearchParams({ purpose: entry.purpose });
    if (entry.personId) params.set("person_id", entry.personId);
    if (entry.contextId) params.set("relationship_context_id", entry.contextId);
    if (entry.purpose === "chat" && entry.sessionId) params.set("session_id", entry.sessionId);
    return `?${params.toString()}`;
  }
  if (first === "operation-views" && segments.length === 2) {
    const claimedPurpose = original.get("purpose");
    if (claimedPurpose && claimedPurpose !== entry.purpose) throw new MemoryEntryMismatch();
    const params = new URLSearchParams({ purpose: entry.purpose });
    if (entry.personId) params.set("person_id", entry.personId);
    if (entry.contextId) params.set("relationship_context_id", entry.contextId);
    for (const [key, value] of Object.entries(operationLineage(entry))) {
      if (value != null) params.set(key, String(value));
    }
    return `?${params.toString()}`;
  }
  if (first === "items" && segments.length === 1) {
    const claimedSurface = original.get("surface");
    if (claimedSurface && claimedSurface !== entry.purpose) throw new MemoryEntryMismatch();
    const params = new URLSearchParams({ surface: entry.purpose });
    if (entry.personId) params.set("person_id", entry.personId);
    if (entry.contextId) params.set("relationship_context_id", entry.contextId);
    return `?${params.toString()}`;
  }
  if (first === "pursuits" && segments.length === 3 && third === "scopes") {
    if (entry.purpose !== "relationship" || entry.pursuitId !== second) {
      throw new MemoryEntryMismatch();
    }
  }
  const passthrough = original.toString();
  return passthrough ? `?${passthrough}` : "";
}

/** Reject a purpose/target claim that disagrees with the signed entry. */
function derivedBody(
  segments: string[],
  entry: MemoryEntryPayload,
  body: unknown,
): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = { ...(body as Record<string, unknown>) };
  const [first, , third] = segments;
  if (entry.purpose !== "chat") {
    for (const [field, expected] of Object.entries({ person_id: entry.personId, relationship_context_id: entry.contextId,
      pursuit_id: entry.pursuitId, pursuit_role_id: entry.pursuitRoleId, pursuit_role_evidence_fragment_id: entry.pursuitEvidenceFragmentId })) {
      if (field in record && record[field] !== expected) throw new MemoryEntryMismatch();
    }
  }
  if ("session_id" in record && entry.sessionId && record.session_id !== entry.sessionId) throw new MemoryEntryMismatch();
  if (first === "items" && third === "mutations") {
    if ("entry_scope" in record) throw new MemoryEntryMismatch();
    record.entry_scope = { purpose: entry.purpose, person_id: entry.personId, relationship_context_id: entry.contextId,
      pursuit_id: entry.pursuitId, pursuit_role_id: entry.pursuitRoleId, pursuit_role_evidence_fragment_id: entry.pursuitEvidenceFragmentId,
      pursuit_capture_id: entry.pursuitCaptureId ?? null, pursuit_capture_version: entry.pursuitCaptureVersion ?? null };
    return record;
  }
  if (first === "proposals" && segments.length === 1) {
    if (record.surface !== entry.purpose) throw new MemoryEntryMismatch();
    record.person_id = entry.personId;
    record.relationship_context_id = entry.contextId;
    if (entry.sessionId) record.session_id = entry.sessionId;
    return record;
  }
  if (first === "proposals" && segments.length === 3 && third === "reviews") {
    if (record.purpose !== entry.purpose) throw new MemoryEntryMismatch();
    record.person_id = entry.personId;
    record.relationship_context_id = entry.contextId;
    record.pursuit_id = entry.pursuitId;
    record.pursuit_role_id = entry.pursuitRoleId;
    record.pursuit_role_evidence_fragment_id = entry.pursuitEvidenceFragmentId;
    record.pursuit_capture_id = entry.pursuitCaptureId ?? null;
    record.pursuit_capture_version = entry.pursuitCaptureVersion ?? null;
    // The originating Session is server-validated by the backend against the
    // proposal; the browser cannot claim it.
    if (entry.sessionId) record.session_id = entry.sessionId;
    return record;
  }
  if (first === "proposals" && segments.length === 3 && third === "rebases") {
    // The contact decision belongs to the private Chat entry only.
    if (entry.purpose !== "chat") throw new MemoryEntryMismatch();
    return record;
  }
  if (first === "operation-views" && segments.length === 3 && third === "undo") {
    if (record.purpose !== entry.purpose) throw new MemoryEntryMismatch();
    record.person_id = entry.personId;
    record.relationship_context_id = entry.contextId;
    Object.assign(record, operationLineage(entry));
    return record;
  }
  return record;
}

/**
 * Authenticated same-origin Memory proxy.
 *
 * The current rendered login binding is re-read from the server session on
 * every call; a stale or changed binding is rejected before any backend
 * request. Purpose and target are derived from the server-signed entry
 * capability, so a browser cannot widen a business surface into private Chat.
 */
export async function memoryReviewRoute(request: Request, segments: string[]): Promise<Response> {
  try {
    const path = backendPath(segments);
    const method = request.method.toUpperCase();
    const entryMint = segments.length === 1 && segments[0] === "entry";
    if (!path && !entryMint) return json({ message: "内存接口无效。" }, 404);
    if (!READ_METHODS.has(method)) {
      if (!isAllowedMutationOrigin(request.headers)) return json({ message: "跨站请求已拒绝。" }, 403);
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        return json({ message: "请求格式无效。" }, 415);
      }
      const declared = Number(request.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        return json({ message: "请求内容过大。" }, 413);
      }
    }
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
      return json({ code: "backend_session_expired", message: "请重新登录。" }, 401);
    }
    if (request.headers.get("x-workspace-session") !== contactHandoffSessionVersion(claims)) {
      return json({ code: "session_stale", message: "登录已改变，请重新打开审阅。" }, 409);
    }
    // The rendered workspace account is server-verified, never merged from the
    // mutation body. This mirrors the other production workspace routes.
    if (request.headers.get("x-talent-signal-workspace") !== claims.backendAccountId) {
      return json({ code: "session_stale", message: "登录已改变，请重新打开审阅。" }, 409);
    }
    const entry = verifyMemoryEntryCapability(
      request.headers.get("x-memory-entry-capability"),
      claims,
    );
    if (entryMint) {
      // Only a currently valid review capability can renew its own scope.
      if (method !== "POST") return json({ message: "请求方式无效。" }, 405);
      if (!entry || entry.stage === "bootstrap") return json({ code: "memory_entry_invalid", message: "请重新打开这段对话。" }, 403);
      return json({ capability: mintMemoryEntryCapability(claims, entry) });
    }
    if (!entry || entry.stage === "bootstrap" || (entry.purpose === "chat" && !entry.sessionId)) {
      return json({ code: "memory_entry_invalid", message: "审阅入口已失效，请重新打开审阅。" }, 403);
    }
    if (!path) return json({ message: "内存接口无效。" }, 404);
    const reviewCredential = request.headers.get("x-memory-review-credential");
    let body: unknown;
    if (!READ_METHODS.has(method)) {
      try {
        body = await request.json();
      } catch {
        return json({ message: "请求格式无效。" }, 400);
      }
    }
    let search: string;
    try {
      search = derivedSearch(segments, entry, new URL(request.url).searchParams);
      if (body !== undefined) body = derivedBody(segments, entry, body);
    } catch (error) {
      if (error instanceof MemoryEntryMismatch) {
        return json({ code: "memory_entry_mismatch", message: "这次审阅入口与请求范围不一致。" }, 403);
      }
      throw error;
    }
    // Enforce the signed capability against the actual backend lineage before
    // forwarding any review/mutation, so a business capability plus a broad
    // Chat credential cannot reach private items.
    try {
      const lineageSignal = AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]);
      if (segments[0] === "reviews" && uuid.test(segments[1] ?? "")) {
        const view = await readBackendJson(
          `/v1/memory/reviews/${segments[1]}`,
          claims,
          reviewCredential,
          lineageSignal,
        );
        const review = view?.review as Record<string, unknown> | undefined;
        if (!review) {
          return json({ code: "memory_entry_mismatch", message: "无法确认这次审阅的实际范围。" }, 403);
        }
        enforceLineage(entry, {
          purpose: review.purpose as string | undefined,
          person_id: (review.person_id ?? null) as string | null,
          relationship_context_id: (review.relationship_context_id ?? null) as string | null,
          source_session_id: (review.source_session_id ?? null) as string | null,
          pursuit_id: (review.pursuit_id ?? null) as string | null,
          pursuit_role_id: review.pursuit_role_id as string | null,
          pursuit_role_evidence_fragment_id: review.pursuit_role_evidence_fragment_id as string | null,
          pursuit_capture_id: review.pursuit_capture_id as string | null,
          pursuit_capture_version: review.pursuit_capture_version as number | null,
        });
      } else if (segments[0] === "proposals" && segments[2] === "rebases") {
        const lineage = await readBackendJson(`/v1/memory/proposals/${segments[1]}/lineage`, claims, null, lineageSignal);
        if (!lineage) throw new MemoryEntryMismatch();
        enforceLineage(entry, lineage);
      } else if (segments[0] === "items" && segments[2] === "mutations") {
        const target = await readBackendJson(`/v1/memory/items/${segments[1]}/scope`, claims, null, lineageSignal);
        if (!target) throw new MemoryEntryMismatch();
        if (entry.purpose !== "chat") {
          if (target.scope === "self" || target.person_id !== entry.personId ||
              (entry.purpose === "relationship" && target.relationship_context_id !== entry.contextId)) throw new MemoryEntryMismatch();
        }
      }
    } catch (error) {
      if (error instanceof MemoryEntryMismatch) {
        return json({ code: "memory_entry_mismatch", message: "这次审阅入口与请求范围不一致。" }, 403);
      }
      throw error;
    }
    const response = await fetch(`${backendAuthBaseUrl()}${path}${search}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${claims.backendAccessToken}`,
        "x-talent-signal-platform": "web",
        ...(reviewCredential
          ? { "x-memory-review-credential": reviewCredential }
          : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
    });
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { ...headers, "Content-Type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return json({ code: "memory_unavailable", message: "记忆暂时无法读取。" }, 503);
  }
}
