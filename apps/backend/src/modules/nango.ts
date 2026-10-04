import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { ApiError } from "../lib/apiError.js";
import { sha256Hex } from "./mcpSchema.js";

/**
 * Optional Nango authorization infrastructure.
 *
 * Nango mediates user-owned OAuth for remote MCP servers. It is never product
 * truth: when `NANGO_API_KEY` or `NANGO_WEBHOOK_SIGNING_KEY` is absent, OAuth
 * is explicitly unavailable and no fake connected state exists. The base URL
 * is the fixed trusted Nango API origin (overridable only by deployment
 * configuration), a server-generated `connect_request_id` travels in the
 * session tags, and the approved MCP server URL is fixed into the session's
 * connection config so the client can never redirect the authorization.
 *
 * Call traffic for OAuth connections goes through the Nango proxy with the
 * frozen approved target, `Retries: 0`, and only selected MCP transport
 * headers. There is no arbitrary proxy path. Connection readback is metadata
 * only: the response credential material is dropped in memory and never
 * persisted, returned, or logged.
 */

export const NANGO_API_KEY_ENV = "NANGO_API_KEY";
export const NANGO_WEBHOOK_SIGNING_KEY_ENV = "NANGO_WEBHOOK_SIGNING_KEY";
export const NANGO_BASE_URL_ENV = "NANGO_BASE_URL";
export const NANGO_ENVIRONMENT_ENV = "NANGO_ENVIRONMENT";

export const NANGO_DEFAULT_BASE_URL = "https://api.nango.dev";
export const NANGO_MCP_GENERIC_PROVIDER = "mcp-generic";
export const NANGO_CONNECT_REQUEST_TAG = "connect_request_id";
export const NANGO_CONNECT_SESSION_TTL_SECONDS = 900;

export interface NangoConfig {
  apiKey: string;
  webhookSigningKey: string;
  baseUrl: string;
  environment: string | null;
}

function trustedNangoBase(raw: string | undefined): string {
  const value = (raw ?? "").trim() || NANGO_DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${NANGO_BASE_URL_ENV} must be a bare HTTPS origin.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/+$/u, "") !== ""
  ) {
    throw new Error(`${NANGO_BASE_URL_ENV} must be a bare HTTPS origin.`);
  }
  return url.origin;
}

/**
 * Explicit production configuration. Returns null when the deployment has not
 * configured Nango so callers can show OAuth as unavailable instead of
 * pretending.
 */
export function loadNangoConfig(
  env: NodeJS.ProcessEnv = process.env,
): NangoConfig | null {
  const apiKey = env[NANGO_API_KEY_ENV]?.trim();
  const webhookSigningKey = env[NANGO_WEBHOOK_SIGNING_KEY_ENV]?.trim();
  if (!apiKey || !webhookSigningKey) return null;
  return {
    apiKey,
    baseUrl: trustedNangoBase(env[NANGO_BASE_URL_ENV]),
    environment: env[NANGO_ENVIRONMENT_ENV]?.trim() || null,
    webhookSigningKey,
  };
}

export interface NangoConnectSession {
  token: string;
  connectLink: string | null;
  expiresAt: string;
  connectRequestId: string;
}

export interface NangoConnectSessionInput {
  accountId: string;
  connectRequestId: string;
  provider: string;
  sessionId: string | null;
  serverUrl: string;
  userId: string;
  /** Server-owned webhook endpoint for this deployment, when configured. */
  webhookUrlOverride?: string | null;
}

const TAG_VALUE = /^[A-Za-z0-9_.:\-/]{1,255}$/u;

function tagValue(value: string, field: string): string {
  const trimmed = value.trim();
  if (!TAG_VALUE.test(trimmed)) {
    throw new ApiError(
      400,
      "MCP_OAUTH_UNAVAILABLE",
      `The Nango connect session cannot bind ${field}.`,
    );
  }
  return trimmed;
}

/**
 * Creates one short-lived Nango connect session. The session is bound to the
 * server-generated connect_request_id, the account/user/session identities and
 * the approved MCP server URL through connection tags and a fixed
 * `connection_config.mcp_server_url`. The client can never widen any of them.
 */
export async function createNangoConnectSession(
  config: NangoConfig,
  input: NangoConnectSessionInput,
  fetcher: typeof fetch = fetch,
): Promise<NangoConnectSession> {
  const provider = tagValue(input.provider, "provider");
  const body = {
    allowed_integrations: [provider],
    integrations_config_defaults: {
      [provider]: {
        connection_config: { mcp_server_url: input.serverUrl },
      },
    },
    tags: {
      [NANGO_CONNECT_REQUEST_TAG]: tagValue(input.connectRequestId, "connect_request_id"),
      account_id: tagValue(input.accountId, "account_id"),
      user_id: tagValue(input.userId, "user_id"),
      session_id: input.sessionId ? tagValue(input.sessionId, "session_id") : "none",
      mcp_server_url: tagValue(input.serverUrl, "mcp_server_url"),
      provider,
    },
    ...(input.webhookUrlOverride
      ? { webhook_url_override: input.webhookUrlOverride }
      : {}),
  };
  const response = await fetcher(`${config.baseUrl}/connect/sessions`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status !== 201) {
    throw new ApiError(
      502,
      "MCP_OAUTH_UNAVAILABLE",
      "The authorization session could not be created.",
    );
  }
  const payload = (await response.json()) as {
    data?: { token?: unknown; connect_link?: unknown; expires_at?: unknown };
  };
  const token = payload.data?.token;
  if (typeof token !== "string" || token.length < 8 || token.length > 512) {
    throw new ApiError(
      502,
      "MCP_OAUTH_UNAVAILABLE",
      "The authorization session response was unusable.",
    );
  }
  return {
    connectLink:
      typeof payload.data?.connect_link === "string" &&
      payload.data.connect_link.startsWith("https://")
        ? payload.data.connect_link
        : null,
    connectRequestId: input.connectRequestId,
    expiresAt:
      typeof payload.data?.expires_at === "string"
        ? payload.data.expires_at
        : new Date(Date.now() + NANGO_CONNECT_SESSION_TTL_SECONDS * 1000).toISOString(),
    token,
  };
}

/**
 * Raw-body HMAC verification of an incoming Nango webhook
 * (`X-Nango-Hmac-Sha256`: HMAC-SHA256 hex of the exact raw body). Timing-safe
 * comparison; a legacy plain-SHA256 signature is never accepted.
 */
export function verifyNangoWebhookSignature(
  config: NangoConfig,
  rawBody: string,
  signatureHeader: string | string[] | undefined,
): boolean {
  const provided = Array.isArray(signatureHeader)
    ? signatureHeader[0]
    : signatureHeader;
  if (!provided) return false;
  const expected = createHmac("sha256", config.webhookSigningKey)
    .update(rawBody)
    .digest("hex");
  const providedHex = provided.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(providedHex)) return false;
  const expectedBytes = Buffer.from(expected, "hex");
  const providedBytes = Buffer.from(providedHex, "hex");
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

export interface NangoAuthWebhook {
  type: "auth";
  operation: "creation" | "override" | "refresh" | "deletion";
  connectionId: string;
  providerConfigKey: string;
  provider: string;
  environment: string | null;
  success: boolean;
  tags: Record<string, string>;
}

/** Strict structural parse; unknown or malformed webhooks are ignored. */
export function parseNangoAuthWebhook(rawBody: string): NangoAuthWebhook | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  if (value.type !== "auth") return null;
  const operation = value.operation;
  if (
    operation !== "creation" &&
    operation !== "override" &&
    operation !== "refresh" &&
    operation !== "deletion"
  ) {
    return null;
  }
  const connectionId = value.connectionId;
  const providerConfigKey = value.providerConfigKey;
  const provider = value.provider;
  if (
    typeof connectionId !== "string" ||
    connectionId.length < 1 ||
    connectionId.length > 200 ||
    typeof providerConfigKey !== "string" ||
    providerConfigKey.length < 1 ||
    providerConfigKey.length > 80 ||
    typeof provider !== "string" ||
    provider.length < 1 ||
    provider.length > 80
  ) {
    return null;
  }
  const tags: Record<string, string> = {};
  if (value.tags && typeof value.tags === "object" && value.tags !== null) {
    for (const [key, item] of Object.entries(value.tags as Record<string, unknown>)) {
      if (typeof item === "string" && item.length <= 255) tags[key.toLowerCase()] = item;
    }
  }
  return {
    connectionId,
    environment: typeof value.environment === "string" ? value.environment : null,
    operation,
    provider,
    providerConfigKey,
    success: value.success !== false,
    tags,
    type: "auth",
  };
}

export interface NangoConnectionMetadata {
  connectionId: string;
  providerConfigKey: string;
  provider: string | null;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  createdAt: string | null;
}

function metadataEntry(value: Record<string, unknown>): NangoConnectionMetadata {
  const tags: Record<string, string> = {};
  if (value.tags && typeof value.tags === "object" && value.tags !== null) {
    for (const [key, item] of Object.entries(value.tags as Record<string, unknown>)) {
      if (typeof item === "string" && item.length <= 255) tags[key.toLowerCase()] = item;
    }
  }
  const metadata: Record<string, unknown> = {};
  if (value.metadata && typeof value.metadata === "object" && value.metadata !== null) {
    for (const [key, item] of Object.entries(value.metadata as Record<string, unknown>)) {
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null) {
        metadata[key] = item;
      }
    }
  }
  return {
    connectionId:
      typeof value.connection_id === "string"
        ? value.connection_id
        : String(value.id ?? ""),
    createdAt: typeof value.created === "string" ? value.created : null,
    metadata,
    provider: typeof value.provider === "string" ? value.provider : null,
    providerConfigKey:
      typeof value.provider_config_key === "string"
        ? value.provider_config_key
        : "",
    tags,
  };
}

/**
 * Authoritative backend readback that never fetches credentials: the
 * connections list endpoint returns connections without credentials and can
 * filter by connection tags. The server-generated `connect_request_id` tag is
 * the only discovery key, so a client can never supply the authority for a
 * connection id. Credential material is never requested, returned, persisted,
 * or logged.
 */
export type NangoQueryOutcome =
  | { outcome: "success"; entries: NangoConnectionMetadata[] }
  | { outcome: "unavailable" }
  | { outcome: "unauthorized" }
  | { outcome: "malformed" }
  | { outcome: "truncated" };

export interface NangoConnectionQuery {
  connectionId?: string;
  providerConfigKey?: string;
  tags?: Record<string, string>;
}

/**
 * Credential-free authoritative metadata readback with EXACT filters
 * (`connectionId`, `integrationId`, `tags`, `limit`). Never a broad listing
 * for a bound identity, never credentials.
 *
 * The outcome distinguishes an authenticated success (including a genuinely
 * empty list) from unavailable/unauthorized/malformed responses: absence can
 * be concluded only from a successful exact query, never from a truncated or
 * failed read.
 */
export async function queryNangoConnections(
  config: NangoConfig,
  query: NangoConnectionQuery,
  fetcher: typeof fetch = fetch,
): Promise<NangoQueryOutcome> {
  const url = new URL(`${config.baseUrl}/connections`);
  if (query.connectionId) url.searchParams.set("connectionId", query.connectionId);
  if (query.providerConfigKey) url.searchParams.set("integrationId", query.providerConfigKey);
  for (const [key, value] of Object.entries(query.tags ?? {})) {
    url.searchParams.set(`tags[${key}]`, value);
  }
  // One extra item detects an incomplete page without treating truncation as absence.
  const limit = query.connectionId ? 2 : 21;
  url.searchParams.set("limit", String(limit));
  let response: Response;
  try {
    response = await fetcher(url.toString(), {
      headers: { authorization: `Bearer ${config.apiKey}` },
      method: "GET",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return { outcome: "unavailable" };
  }
  if (response.status === 401 || response.status === 403) return { outcome: "unauthorized" };
  if (!response.ok) return { outcome: "unavailable" };
  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    return { outcome: "malformed" };
  }
  // The production credential-free envelope is `{ "connections": [...] }`.
  // Any other shape is malformed: fail closed instead of trusting it.
  const envelope = (
    payload && typeof payload === "object" ? (payload as { connections?: unknown }) : null
  )?.connections;
  if (!Array.isArray(envelope)) return { outcome: "malformed" };
  if (envelope.length >= limit) return { outcome: "truncated" };
  const entries: NangoConnectionMetadata[] = [];
  const seen = new Set<string>();
  for (const item of envelope) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { outcome: "malformed" };
    const value = item as Record<string, unknown>;
    if (typeof value.connection_id !== "string" || !/^[A-Za-z0-9_.:\-]{1,200}$/u.test(value.connection_id) ||
        typeof value.provider_config_key !== "string" || !/^[A-Za-z0-9_.:\-]{1,80}$/u.test(value.provider_config_key) ||
        !value.tags || typeof value.tags !== "object" || Array.isArray(value.tags)) return { outcome: "malformed" };
    const entry = metadataEntry(value);
    if ((query.connectionId && entry.connectionId !== query.connectionId) ||
        (query.providerConfigKey && entry.providerConfigKey !== query.providerConfigKey)) return { outcome: "malformed" };
    const key = `${entry.providerConfigKey}:${entry.connectionId}`;
    if (seen.has(key)) return { outcome: "malformed" };
    seen.add(key);
    entries.push(entry);
  }
  return { outcome: "success", entries };
}

/** Convenience wrapper: entries only on an authoritative success. */
export async function listNangoConnectionsByTag(
  config: NangoConfig,
  tags: Record<string, string>,
  fetcher: typeof fetch = fetch,
): Promise<NangoConnectionMetadata[]> {
  const result = await queryNangoConnections(config, { tags }, fetcher);
  return result.outcome === "success" ? result.entries : [];
}

export interface NangoProxyRequest {
  body: string;
  connectionId: string;
  headers: Record<string, string>;
  path: string;
  providerConfigKey: string;
  /** The frozen approved MCP server origin, sent as Base-Url-Override. */
  targetOrigin: string;
  timeoutMs: number;
}

export interface NangoProxyResponse {
  body: string;
  contentType: string;
  status: number;
  headers: Record<string, string>;
}

export const NANGO_PROXY_MAX_RESPONSE_BYTES = 1_048_576;

/** A response that exceeded the bound is unreadable, never a proven failure. */
export class NangoProxyOverflowError extends Error {
  constructor() {
    super("The proxied MCP response exceeded the size limit.");
    this.name = "NangoProxyOverflowError";
  }
}

const PASSTHROUGH_HEADERS = new Set([
  "accept",
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
]);

/**
 * One POST through the Nango proxy to the frozen MCP target. Only the MCP
 * transport headers pass through, `Retries: 0` forbids proxy-side retries of a
 * possibly applied effect, and the path can only be the approved MCP endpoint
 * path supplied by the server.
 */
export async function nangoProxyPost(
  config: NangoConfig,
  input: NangoProxyRequest,
  fetcher: typeof fetch = fetch,
): Promise<NangoProxyResponse> {
  const path = input.path.startsWith("/") ? input.path.slice(1) : input.path;
  if (!/^[A-Za-z0-9/_\-.]{1,200}$/u.test(path) || path.includes("..")) {
    throw new ApiError(400, "MCP_OAUTH_UNAVAILABLE", "The proxy path is not accepted.");
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.apiKey}`,
    "connection-id": input.connectionId,
    "provider-config-key": input.providerConfigKey,
    retries: "0",
    "base-url-override": input.targetOrigin,
  };
  for (const [key, value] of Object.entries(input.headers)) {
    const lower = key.toLowerCase();
    if (PASSTHROUGH_HEADERS.has(lower)) headers[`nango-proxy-${lower}`] = value;
  }
  let response: Response;
  try {
    response = await fetcher(`${config.baseUrl}/proxy/${path}`, {
      body: input.body,
      headers,
      method: "POST",
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch {
    // The reply was lost after dispatch; the caller must treat an effect leg
    // as outcome_unknown instead of retrying a possibly applied call.
    return { body: "", contentType: "", headers: {}, status: 599 };
  }
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });
  const contentType = response.headers.get("content-type") ?? "";
  // Bytes are bounded while streaming: an oversized body aborts the read and
  // is unreadable, never silently truncated into a false result.
  let text = "";
  const reader = response.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (Buffer.byteLength(text, "utf8") > NANGO_PROXY_MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new NangoProxyOverflowError();
        }
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock?.();
    }
  } else {
    text = await response.text().catch(() => "");
    if (Buffer.byteLength(text, "utf8") > NANGO_PROXY_MAX_RESPONSE_BYTES) {
      throw new NangoProxyOverflowError();
    }
  }
  return {
    body: text,
    contentType,
    headers: responseHeaders,
    status: response.status,
  };
}

export type NangoDeleteOutcome =
  | "confirmed"
  | "already_missing"
  | "async"
  | "forbidden"
  | "failed";

/**
 * Bounded, idempotent broker-credential removal against the pinned Nango
 * runtime (`DELETE /connections/{connectionId}?provider_config_key=...`,
 * requires the `environment:connections:delete` scope).
 *
 * Only the exact stored identity is ever targeted. `unknown_connection` is
 * the one verified known-missing response that counts as already cleaned;
 * any other 400/403/timeout is a retryable pending failure, never a false
 * success. This deletes the Nango-held connection (and its credential); it is
 * not a universal vendor-side OAuth revocation.
 */
export async function deleteNangoConnection(
  config: NangoConfig,
  connectionId: string,
  providerConfigKey: string,
  fetcher: typeof fetch = fetch,
): Promise<NangoDeleteOutcome> {
  if (
    !/^[A-Za-z0-9_.:\-]{1,200}$/u.test(connectionId) ||
    !/^[A-Za-z0-9_.:\-]{1,80}$/u.test(providerConfigKey)
  ) {
    return "failed";
  }
  const url = new URL(
    `${config.baseUrl}/connections/${encodeURIComponent(connectionId)}`,
  );
  url.searchParams.set("provider_config_key", providerConfigKey);
  // The pinned handler validates `env` strictly and scopes the deletion by
  // it; the frozen broker environment travels with the cleanup identity.
  url.searchParams.set("env", config.environment ?? "DEV");
  let response: Response;
  try {
    response = await fetcher(url.toString(), {
      headers: { authorization: `Bearer ${config.apiKey}` },
      method: "DELETE",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return "failed";
  }
  if (response.status === 202) {
    // Asynchronous deletion is not removal: readback must confirm it.
    return "async";
  }
  if (response.status === 200) {
    // The pinned confirmed contract is `200 { "success": true }`.
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return body && typeof body === "object" && (body as { success?: unknown }).success === true
      ? "confirmed"
      : "failed";
  }
  if (response.status === 401 || response.status === 403) {
    return "forbidden";
  }
  if (response.status === 400 || response.status === 404) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const code =
      payload && typeof payload === "object"
        ? ((payload as { error?: { code?: unknown } }).error?.code ??
          (payload as { code?: unknown }).code)
        : undefined;
    // Only the pinned runtime's verified known-missing code counts as
    // already cleaned; an arbitrary 400 is a retryable failure.
    return code === "unknown_connection" ? "already_missing" : "failed";
  }
  return "failed";
}

export function newConnectRequestId(): string {
  return `mcpconn_${randomBytes(16).toString("hex")}`;
}

export function connectRequestTagFingerprint(tags: Record<string, string>): string {
  return sha256Hex(JSON.stringify(Object.entries(tags).sort(([a], [b]) => a.localeCompare(b))));
}
