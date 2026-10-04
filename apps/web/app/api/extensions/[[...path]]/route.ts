import { NextRequest, NextResponse } from "next/server";

import {
  backendSessionIsExpired,
  isBackendSessionExpiredError,
} from "@/lib/backend-session";
import { isAllowedMutationOrigin } from "@/lib/request-origin";
import { backendAuthBaseUrl, readBackendSessionClaims } from "@/lib/server/backendAuth";
import { contactHandoffSessionVersion } from "@/lib/server/contact-handoff-session";
import {
  McpBodyError,
  readBoundedRequestBody,
} from "@/lib/server/mcpBoundedBody";
import { loadMcpExtensionSnapshot } from "@/lib/server/mcpExtensions";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_BODY_BYTES = 64 * 1024;
const MCP_MANAGEMENT_TIMEOUT_MS = 12_000;

/**
 * Same-origin adapter for MCP extension management. It forwards only the
 * closed set of workspace routes and never becomes a generic proxy.
 */
const ROUTES: Array<{ methods: string[]; path: string[] }> = [
  { methods: ["GET"], path: [] },
  { methods: ["GET", "POST"], path: ["connections"] },
  { methods: ["PUT"], path: ["connections", ":id"] },
  { methods: ["POST"], path: ["connections", ":id", "connect"] },
  { methods: ["POST"], path: ["connections", ":id", "disconnect"] },
  { methods: ["GET", "POST"], path: ["clients"] },
  { methods: ["POST"], path: ["clients", ":id", "revoke"] },
  { methods: ["GET"], path: ["endpoints"] },
  { methods: ["GET"], path: ["directory"] },
  { methods: ["GET"], path: ["oauth", "availability"] },
  { methods: ["POST"], path: ["oauth", "poll", ":token"] },
  { methods: ["GET"], path: ["interactions"] },
  { methods: ["POST"], path: ["interactions", "propose-call"] },
  { methods: ["POST"], path: ["interactions", "propose-connection"] },
  { methods: ["GET"], path: ["interactions", ":id"] },
  { methods: ["POST"], path: ["interactions", ":id", "resolve"] },
];

const TOKEN = /^[A-Za-z0-9_.:\-]{1,120}$/u;

function matches(path: string[], method: string): string[] | null {
  for (const route of ROUTES) {
    if (!route.methods.includes(method)) continue;
    if (route.path.length !== path.length) continue;
    const ok = route.path.every((segment, index) => {
      const value = path[index] ?? "";
      if (segment === ":id") return UUID.test(value);
      if (segment === ":token") return TOKEN.test(value);
      return segment === value;
    });
    if (ok) return route.path;
  }
  return null;
}

function response(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
    status,
  });
}

async function boundedJson(request: NextRequest): Promise<unknown | null> {
  const text = await readBoundedRequestBody(request, MAX_BODY_BYTES);
  if (!text) return null;
  return JSON.parse(text) as unknown;
}

async function relayFetch(url: string, init: RequestInit): Promise<NextResponse> {
  // A bounded upstream call: the timer aborts both the fetch and the body read
  // so a stalled backend cannot pin the route handler open.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_MANAGEMENT_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, { ...init, signal: controller.signal });
    const text = await upstream.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { message: "扩展服务返回了无法解析的响应。" };
    }
    return response(body, upstream.status);
  } catch (error) {
    if (controller.signal.aborted) {
      return response({ message: "扩展服务响应超时。" }, 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function handle(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
) {
  const method = request.method.toUpperCase();
  if (
    method !== "GET" &&
    method !== "HEAD" &&
    !isAllowedMutationOrigin(request.headers)
  ) {
    return response({ message: "请求来源不受支持。" }, 403);
  }
  const { path = [] } = await context.params;
  const normalized = path.filter((segment) => segment.length > 0);
  const route = matches(normalized, method);
  if (!route) {
    return response({ message: "不支持的操作。" }, 404);
  }
  try {
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
      return response(
        { code: "backend_session_expired", message: "请重新登录。" },
        401,
      );
    }
    if (
      request.headers.get("x-workspace-session") !==
      contactHandoffSessionVersion(claims)
    ) {
      return response(
        { code: "session_stale", message: "登录已改变，请重新打开扩展页。" },
        409,
      );
    }
    if (method === "GET" && normalized.length === 0) {
      return response(await loadMcpExtensionSnapshot(), 200);
    }
    const upstreamPath = route
      .map((segment, index) =>
        segment === ":id" || segment === ":token" ? normalized[index] : segment,
      )
      .join("/");
    const url = `${backendAuthBaseUrl()}/v1/mcp/${upstreamPath}`;

    if (method === "GET") {
      return await relayFetch(url, {
        cache: "no-store",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${claims.backendAccessToken}`,
        },
        method: "GET",
      });
    }

    let body: string | undefined;
    try {
      const parsed = await boundedJson(request);
      body = parsed === null ? undefined : JSON.stringify(parsed);
    } catch (error) {
      if (error instanceof McpBodyError) {
        return response(
          {
            message:
              error.failure === "too_large"
                ? "请求内容过长。"
                : "请求内容读取超时。",
          },
          error.failure === "too_large" ? 413 : 408,
        );
      }
      return response({ message: "请求格式无效。" }, 400);
    }
    return await relayFetch(url, {
      body,
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${claims.backendAccessToken}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      method,
    });
  } catch (error) {
    if (isBackendSessionExpiredError(error)) {
      return response(
        { code: "backend_session_expired", message: "请重新登录。" },
        401,
      );
    }
    if (error instanceof Error && error.name === "AbortError") {
      return response({ message: "扩展服务响应超时。" }, 504);
    }
    return response({ message: "扩展服务暂时不可用。" }, 503);
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
