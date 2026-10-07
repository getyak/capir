"use client";

import {
  invalidateWorkspaceDirectory,
  workspaceDirectoryMutationInvalidates,
} from "@/lib/workspace-directory-cache";

export const WORKSPACE_SESSION_EXPIRED_EVENT =
  "talent-signal:workspace-session-expired";

function responseCode(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return null;
  if ("code" in payload) return payload.code;
  if (
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "code" in payload.error
  ) {
    return payload.error.code;
  }
  return null;
}

export function workspaceSessionExpired(
  status: number,
  payload: unknown,
): boolean {
  const code = responseCode(payload);
  return status === 401 && typeof code === "string" &&
    ["backend_session_expired", "SESSION_INVALID", "SESSION_EXPIRED", "AUTHENTICATION_REQUIRED"].includes(code);
}

export async function workspaceSessionFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  request: typeof fetch = fetch,
): Promise<Response> {
  const scope = typeof document !== "undefined"
    ? document.querySelector<HTMLElement>("[data-workspace-scope]")?.dataset.workspaceScope?.trim()
    : undefined;
  const target = typeof window !== "undefined" ? new URL(input instanceof Request ? input.url : String(input), window.location.href) : null;
  const local = target && target.origin === window.location.origin && target.pathname.startsWith("/api/");
  if (local && !scope) {
    window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT));
    invalidateWorkspaceDirectory(undefined, "discard");
    return Response.json({ code: "backend_session_expired" }, { status: 401 });
  }
  const scoped = scope && local ? { ...init, headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)) } : init;
  if (scope && local && scoped?.headers instanceof Headers) scoped.headers.set("X-Talent-Signal-Workspace", scope);
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const response = await request(input, scoped);
  if (response.status !== 401) {
    // A successful private-data mutation must not leave a pre-mutation
    // snapshot in the shared in-memory cache. Reads and unrelated endpoints
    // are untouched.
    if (
      response.ok &&
      local &&
      target &&
      workspaceDirectoryMutationInvalidates(method, target.pathname)
    ) {
      invalidateWorkspaceDirectory(undefined, "revalidate");
    }
    return response;
  }
  // Any 401 on the scoped workspace API must not leave a cached private
  // snapshot available. Discard first so live readers fail closed; the
  // recognized credential-loss codes additionally start recovery.
  if (local && target) {
    invalidateWorkspaceDirectory(undefined, "discard");
  }
  try {
    const payload = (await response.clone().json()) as unknown;
    if (
      local &&
      workspaceSessionExpired(response.status, payload) &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT));
    }
  } catch {
    // A malformed 401 remains with its caller and does not claim expiry.
  }
  return response;
}

// Compatibility names keep relationship feature call sites descriptive while
// Pursuit and future workspace clients share the same response boundary.
export const RELATIONSHIP_SESSION_EXPIRED_EVENT =
  WORKSPACE_SESSION_EXPIRED_EVENT;
export const relationshipIntegrationSessionExpired = workspaceSessionExpired;
export const relationshipIntegrationFetch = workspaceSessionFetch;
