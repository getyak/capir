import "server-only";
import type { SessionResponse } from "@talent-signal/contracts";
import { desktopAuthDeploymentOrigin, desktopAuthWebOrigin } from "./desktop-browser-login";
import { backendAuthBaseUrl } from "./backendAuth";
import { openDesktopRevocationProof } from "./desktop-revocation-seal";

export const DESKTOP_PERSISTENT_PATH = "/api/desktop-auth/persistent";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export class DesktopPersistentSessionError extends Error {
  constructor(readonly status: number) {
    super("The Mac session could not be verified.");
    this.name = "DesktopPersistentSessionError";
  }
}

export type DesktopPersistentFields = {
  action: "enroll" | "renew" | "revoke";
  device_secret: string;
  account_id: string;
  user_id: string;
  session_id?: string;
  revocation_proof?: string;
};
export type DesktopPersistentStatus = {
  status: "authenticated";
  account_id: string;
  user_id: string;
  session_id: string;
  session_expires_at: string;
  revocation_proof?: string;
};

async function boundedJSON(source: Request | Response, limit: number): Promise<unknown> {
  if (!source.body) throw new DesktopPersistentSessionError(400);
  const reader = source.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new DesktopPersistentSessionError(400);
      chunks.push(value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new DesktopPersistentSessionError(400);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function desktopPersistentFields(value: unknown): DesktopPersistentFields {
  if (!value || typeof value !== "object") throw new DesktopPersistentSessionError(400);
  const v = value as Record<string, unknown>;
  if (!["enroll", "renew", "revoke"].includes(String(v.action)) ||
      typeof v.device_secret !== "string" || !SECRET.test(v.device_secret) ||
      typeof v.account_id !== "string" || !UUID.test(v.account_id) ||
      typeof v.user_id !== "string" || !UUID.test(v.user_id)) {
    throw new DesktopPersistentSessionError(400);
  }
  const hasRevocation = v.session_id !== undefined || v.revocation_proof !== undefined;
  if (hasRevocation && (v.action !== "revoke" || typeof v.session_id !== "string" || !UUID.test(v.session_id)
    || typeof v.revocation_proof !== "string" || v.revocation_proof.length > 2048 || !v.revocation_proof)) {
    throw new DesktopPersistentSessionError(400);
  }
  return { action: v.action as DesktopPersistentFields["action"], device_secret: v.device_secret,
    account_id: v.account_id, user_id: v.user_id,
    ...(hasRevocation ? { session_id: v.session_id as string, revocation_proof: v.revocation_proof as string } : {}) };
}

/** JSON plus the custom native header cannot be submitted by a cross-site
 * HTML form. Cross-origin fetch preflight has no CORS permission here.
 * Validate a browser-supplied Origin even if it supplies the custom header. */
export async function desktopPersistentPostFields(request: Request): Promise<DesktopPersistentFields> {
  const origin = desktopAuthWebOrigin(request);
  const suppliedOrigin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (request.headers.get("x-capri-desktop-session") !== "1" ||
      request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" ||
      (suppliedOrigin !== null && suppliedOrigin !== origin) ||
      (site !== null && !["none", "same-origin"].includes(site))) {
    throw new DesktopPersistentSessionError(403);
  }
  const body = await boundedJSON(request, 4096);
  if (body && typeof body === "object" && "original_access_token" in body) throw new DesktopPersistentSessionError(400);
  return desktopPersistentFields(body);
}

async function backend(path: string, body?: unknown, access?: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(backendAuthBaseUrl() + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(access ? { authorization: "Bearer " + access } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new DesktopPersistentSessionError(503); }
  if (!response.ok) {
    // Access-status 401 only means this short cookie is unusable; native can
    // still renew it. A device capability is terminal ONLY on the canonical
    // stable codes, not an origin/audience/configuration/proxy rejection.
    if (path.endsWith("/status") && response.status === 401) {
      await response.body?.cancel().catch(() => {});
      throw new DesktopPersistentSessionError(401);
    }
    let code: unknown;
    try {
      const body = await boundedJSON(response, 8192) as { error?: { code?: unknown } };
      code = body?.error?.code;
    } catch { /* An unknown/malformed refusal is recoverable. */ }
    if (response.status === 401 && code === "DESKTOP_SESSION_REVOKED") throw new DesktopPersistentSessionError(401);
    if (response.status === 403 && code === "DESKTOP_SESSION_INELIGIBLE") throw new DesktopPersistentSessionError(403);
    throw new DesktopPersistentSessionError(503);
  }
  try { return await boundedJSON(response, 65_536); }
  catch { throw new DesktopPersistentSessionError(503); }
}

function persistentStatus(value: unknown): DesktopPersistentStatus {
  const v = value as Partial<DesktopPersistentStatus> | null;
  if (!v || v.status !== "authenticated" || !UUID.test(v.account_id ?? "") ||
      !UUID.test(v.user_id ?? "") || !UUID.test(v.session_id ?? "") ||
      typeof v.session_expires_at !== "string" ||
      !(Date.parse(v.session_expires_at) > Date.now())) throw new DesktopPersistentSessionError(503);
  return { status: "authenticated", account_id: v.account_id!, user_id: v.user_id!,
    session_id: v.session_id!, session_expires_at: v.session_expires_at };
}

export async function readDesktopPersistentStatus(access: string): Promise<DesktopPersistentStatus> {
  return persistentStatus(await backend("/v1/desktop-persistent-session/status", undefined, access));
}

/** Server-only Credentials provider. Auth.js owns cookie encoding/writes;
 * only the ordinary short access claims enter its encrypted JWT.
 * https://authjs.dev/reference/nextjs#signin */
export async function authorizeDesktopPersistentSession(credentials: Partial<Record<string, unknown>>) {
  const fields = desktopPersistentFields(credentials);
  if (fields.action === "revoke") throw new DesktopPersistentSessionError(400);
  const original = credentials.backend_access_token;
  if (fields.action === "enroll" && (typeof original !== "string" || original.length > 256 || !original)) {
    throw new DesktopPersistentSessionError(401);
  }
  const value = await backend("/v1/desktop-persistent-session/" + fields.action, {
    device_secret: fields.device_secret, web_origin: await desktopAuthDeploymentOrigin(),
    ...(fields.action === "renew" ? { account_id: fields.account_id, user_id: fields.user_id } : {}),
  }, fields.action === "enroll" ? original as string : undefined);
  const s = value as SessionResponse & { session_id: string };
  if (!s || typeof s.access_token !== "string" || !s.access_token || s.access_token.length > 256 ||
      !UUID.test(s.session_id ?? "") || s.account?.id !== fields.account_id || s.user?.id !== fields.user_id ||
      !["admin", "member"].includes(s.user?.role) || !(Date.parse(s.expires_at) > Date.now()) ||
      typeof s.account.name !== "string" || typeof s.account.slug !== "string" ||
      typeof s.user.email !== "string" || typeof s.user.display_name !== "string") {
    throw new DesktopPersistentSessionError(503);
  }
  return {
    id: s.user.id, email: s.user.email, name: s.user.display_name,
    backendAccessToken: s.access_token, backendAccountId: s.account.id,
    backendAccountName: s.account.name, backendAccountSlug: s.account.slug,
    backendExpiresAt: s.expires_at, backendRole: s.user.role,
    backendUserId: s.user.id, backendUsername: s.user.username ?? null, backendSessionId: s.session_id,
  };
}

export async function revokeDesktopPersistentSession(fields: DesktopPersistentFields) {
  if (fields.action !== "revoke") throw new DesktopPersistentSessionError(400);
  const origin = await desktopAuthDeploymentOrigin();
  let original: string | undefined;
  if (fields.revocation_proof !== undefined) {
    try { original = openDesktopRevocationProof(fields.revocation_proof, origin, { ...fields, session_id: fields.session_id! }); }
    catch { throw new DesktopPersistentSessionError(503); }
  }
  const result = await backend("/v1/desktop-persistent-session/revoke", {
    device_secret: fields.device_secret, account_id: fields.account_id, user_id: fields.user_id,
    web_origin: origin, ...(original ? { session_id: fields.session_id, original_access_token: original } : {}),
  });
  if (!result || typeof result !== "object" || !("revoked" in result) || result.revoked !== true) throw new DesktopPersistentSessionError(503);
}
