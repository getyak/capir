import type { McpConnectionErrorCode } from "@talent-signal/contracts";

import {
  mcpPinnedExchange,
  McpTransportError,
  MCP_REQUEST_TIMEOUT_MS,
  MCP_RESPONSE_MAX_BYTES,
  type McpExchangeResponse,
} from "./mcpHttp.js";
import { McpUrlRejectedError, type McpResolvedTarget } from "./mcpSecurity.js";

/**
 * Streamable HTTP MCP client handshake.
 *
 * A connection is only verified after a real initialize, initialized
 * notification, and tools/list exchange against the validated pinned origin.
 * Discovery output is capability metadata, never instructions: tool names and
 * descriptions are stored as inert text and bounded in size.
 *
 * Error text is owned locally. Remote JSON-RPC error messages and transport
 * exception messages are never returned or persisted, so a hostile server
 * cannot make capri store or echo its own request credential.
 */

export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
] as const;

export const MCP_MAX_TOOLS = 100;
export const MCP_MAX_DIRECTORY_BYTES = 240_000;
export const MCP_MAX_TOOL_PAGES = 5;
export const MCP_MAX_TOOL_NAME = 128;
export const MCP_MAX_TOOL_DESCRIPTION = 2_000;
export const MCP_MAX_TOOL_SCHEMA_CHARS = 20_000;

/**
 * Fixed operator- and user-facing messages keyed by bounded error code. These
 * are the only strings any persistence or API response may carry.
 */
export const MCP_ERROR_MESSAGES: Record<McpConnectionErrorCode, string> = {
  MCP_CREDENTIAL_UNAVAILABLE:
    "This deployment cannot read the stored credential because MCP credential encryption is unavailable.",
  MCP_DNS_UNAVAILABLE:
    "The server hostname could not be resolved to a public address.",
  MCP_ENDPOINT_REJECTED:
    "The server URL is not an accepted public HTTPS origin.",
  MCP_HANDSHAKE_FAILED: "The MCP handshake could not be completed.",
  MCP_PROTOCOL_UNSUPPORTED:
    "The server negotiated an MCP protocol version this build does not support.",
  MCP_REDIRECT_REFUSED:
    "The server tried to redirect the request, which was refused.",
  MCP_REQUIRES_AUTH:
    "This server requires an authorization flow capri does not implement; no login was started.",
  MCP_RESPONSE_INVALID: "The server returned an unreadable MCP response.",
  MCP_RESPONSE_TOO_LARGE: "The server response exceeded the size limit.",
  MCP_TIMEOUT: "The server did not respond within the time limit.",
  MCP_TOO_MANY_TOOLS:
    "The server advertised more tools than this build accepts.",
  MCP_UNAUTHORIZED: "The server refused the supplied credential.",
};

export function mcpErrorCodeMessage(code: McpConnectionErrorCode): string {
  return MCP_ERROR_MESSAGES[code];
}

export interface McpDiscoveredTool {
  description: string;
  name: string;
  read_only: boolean;
  /** The original discovered input schema as bounded inert JSON text. */
  inputSchema: string | null;
}

export interface McpHandshakeResult {
  errorCode: McpConnectionErrorCode | null;
  errorMessage: string | null;
  protocolVersion: string | null;
  status: "failed" | "unauthorized" | "verified";
  tools: McpDiscoveredTool[];
}

export interface McpHandshakeInput {
  allowInsecureTls?: boolean;
  bearerSecret?: string | null;
  exchange?: typeof mcpPinnedExchange;
  target: McpResolvedTarget;
  timeoutMs?: number;
}

const TOOL_NAME = /^[A-Za-z0-9_.\-]{1,128}$/u;

function agentHeaders(input: McpHandshakeInput): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    ...(input.bearerSecret
      ? { authorization: `Bearer ${input.bearerSecret}` }
      : {}),
  };
}

function decodeJsonRpcResponse(
  response: McpExchangeResponse,
  expectedId: number,
): { hasError: boolean; result?: unknown } {
  const candidates: string[] = [];
  if (response.body.trim()) candidates.push(response.body.trim());
  if (response.contentType.toLowerCase().includes("text/event-stream")) {
    for (const block of response.body.split(/\r?\n\r?\n/u)) {
      const data = block
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).replace(/^ /u, ""))
        .join("\n")
        .trim();
      if (data) candidates.push(data);
    }
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        error?: unknown;
        jsonrpc?: unknown;
        id?: unknown;
        result?: unknown;
      };
      if (
        parsed &&
        typeof parsed === "object" &&
        ("result" in parsed !== ("error" in parsed)) &&
        parsed.jsonrpc === "2.0" && parsed.id === expectedId
      ) {
        return "error" in parsed
          ? { hasError: true }
          : { hasError: false, result: parsed.result };
      }
    } catch {
      // Try the next representation.
    }
  }
  throw new McpTransportError(
    "MCP_RESPONSE_INVALID",
    MCP_ERROR_MESSAGES.MCP_RESPONSE_INVALID,
  );
}

function failure(
  errorCode: McpConnectionErrorCode,
  httpStatus?: number,
): McpHandshakeResult {
  return {
    errorCode,
    errorMessage: failureMessage(errorCode, httpStatus),
    protocolVersion: null,
    status: "failed",
    tools: [],
  };
}

function failureMessage(
  errorCode: McpConnectionErrorCode,
  httpStatus?: number,
): string {
  return errorCode === "MCP_HANDSHAKE_FAILED" && httpStatus !== undefined
    ? `${MCP_ERROR_MESSAGES.MCP_HANDSHAKE_FAILED} (HTTP ${httpStatus})`
    : MCP_ERROR_MESSAGES[errorCode];
}

function unauthorized(errorCode: McpConnectionErrorCode): McpHandshakeResult {
  return {
    errorCode,
    errorMessage: MCP_ERROR_MESSAGES[errorCode],
    protocolVersion: null,
    status: "unauthorized",
    tools: [],
  };
}

async function call(
  input: McpHandshakeInput,
  id: number,
  method: string,
  params: Record<string, unknown>,
  sessionId: string | null,
  protocolVersion: string | null,
): Promise<McpExchangeResponse> {
  const exchange = input.exchange ?? mcpPinnedExchange;
  return exchange({
    allowInsecureTls: input.allowInsecureTls === true,
    body: JSON.stringify({ id, jsonrpc: "2.0", method, params }),
    expectedJsonRpcId: id,
    headers: {
      ...agentHeaders(input),
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      ...(protocolVersion ? { "mcp-protocol-version": protocolVersion } : {}),
    },
    maxBytes: MCP_RESPONSE_MAX_BYTES,
    method: "POST",
    target: input.target,
    timeoutMs: input.timeoutMs ?? MCP_REQUEST_TIMEOUT_MS,
  });
}

async function notifyInitialized(
  input: McpHandshakeInput,
  sessionId: string | null,
  protocolVersion: string,
): Promise<void> {
  const exchange = input.exchange ?? mcpPinnedExchange;
  const response = await exchange({
    allowInsecureTls: input.allowInsecureTls === true,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    expectedJsonRpcId: null,
    headers: {
      ...agentHeaders(input),
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      "mcp-protocol-version": protocolVersion,
    },
    maxBytes: MCP_RESPONSE_MAX_BYTES,
    method: "POST",
    target: input.target,
    timeoutMs: input.timeoutMs ?? MCP_REQUEST_TIMEOUT_MS,
  });
  if (response.status >= 400) {
    throw new McpTransportError(
      response.status === 401 || response.status === 403
        ? "MCP_UNAUTHORIZED"
        : "MCP_HANDSHAKE_FAILED",
      MCP_ERROR_MESSAGES.MCP_HANDSHAKE_FAILED,
    );
  }
}

/**
 * Selects the version to reply with. A version the client requested that this
 * build also supports is echoed; otherwise the latest supported version is
 * offered so the client can decide whether to continue.
 */
export function negotiateProtocolVersion(
  requested: unknown,
): string {
  return typeof requested === "string" &&
    (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : MCP_SUPPORTED_PROTOCOL_VERSIONS[0];
}

function normalizeTool(value: unknown, secret?: string | null): McpDiscoveredTool | null {
  if (!value || typeof value !== "object") return null;
  const tool = value as {
    annotations?: { readOnlyHint?: unknown };
    description?: unknown;
    inputSchema?: unknown;
    name?: unknown;
  };
  if (typeof tool.name !== "string" || !TOOL_NAME.test(tool.name)) return null;
  if (secret && tool.name.includes(secret)) return null;
  let description =
    typeof tool.description === "string"
      ? tool.description
      : "";
  if (secret) description = description.split(secret).join("[redacted]");
  description = description.replace(/\u0000/gu, "").slice(0, MCP_MAX_TOOL_DESCRIPTION).replace(/[\uD800-\uDFFF]/gu, "\uFFFD");
  let inputSchema: string | null = null;
  if (tool.inputSchema !== undefined) {
    let serialized = "";
    try {
      serialized = JSON.stringify(tool.inputSchema);
    } catch {
      return null;
    }
    if (serialized.length > MCP_MAX_TOOL_SCHEMA_CHARS) return null;
    if (secret) serialized = serialized.split(secret).join("[redacted]");
    inputSchema = serialized;
  }
  return {
    description,
    inputSchema,
    name: tool.name,
    read_only: tool.annotations?.readOnlyHint === true,
  };
}

export type McpToolCallStatus =
  | "succeeded"
  | "failed"
  | "outcome_unknown"
  | "unauthorized";

export interface McpToolCallInput {
  allowInsecureTls?: boolean;
  bearerSecret?: string | null;
  exchange?: typeof mcpPinnedExchange;
  target: McpResolvedTarget;
  timeoutMs?: number;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface McpToolCallResult {
  status: McpToolCallStatus;
  errorCode: McpConnectionErrorCode | null;
  protocolVersion: string | null;
  /** The tool reported `isError`; distinct from transport and JSON-RPC failure. */
  isError: boolean;
  /** A JSON-RPC error object, not a tool result. */
  jsonrpcError: boolean;
  /** True once the tools/call request body reached the socket. */
  effectSent: boolean;
  /** Raw tool result content as bounded JSON text; caller redacts before use. */
  resultText: string | null;
}

const MCP_TOOL_CALL_RESULT_MAX_CHARS = 64_000;

function toolCallFailure(
  errorCode: McpConnectionErrorCode,
  effectSent: boolean,
  status: McpToolCallStatus = "failed",
): McpToolCallResult {
  return {
    effectSent,
    errorCode,
    isError: false,
    jsonrpcError: false,
    protocolVersion: null,
    resultText: null,
    status,
  };
}

function toolResultText(result: unknown): string | null {
  if (result === undefined || result === null) return null;
  let text: string;
  try {
    text = JSON.stringify(result);
  } catch {
    return null;
  }
  if (text.length > MCP_TOOL_CALL_RESULT_MAX_CHARS) {
    text = `${text.slice(0, MCP_TOOL_CALL_RESULT_MAX_CHARS - 1)}…`;
  }
  return text;
}

/**
 * A real Streamable HTTP tool execution: initialize, initialized, tools/list
 * (bounded pagination) and tools/call with the negotiated session and protocol
 * headers. A JSON-RPC error and a tool `isError` result are distinguished.
 * When the request body has been sent and the outcome cannot be read, the
 * result is `outcome_unknown` so the caller never blindly retries a possibly
 * applied external effect.
 */
export async function performMcpToolCall(
  input: McpToolCallInput,
): Promise<McpToolCallResult> {
  const deadline = Date.now() + (input.timeoutMs ?? MCP_REQUEST_TIMEOUT_MS);
  let effectSent = false;
  function remaining(callInput: McpToolCallInput): McpHandshakeInput {
    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0) {
      throw new McpTransportError("MCP_TIMEOUT", MCP_ERROR_MESSAGES.MCP_TIMEOUT);
    }
    return {
      allowInsecureTls: callInput.allowInsecureTls === true,
      bearerSecret: callInput.bearerSecret ?? null,
      ...(callInput.exchange ? { exchange: callInput.exchange } : {}),
      target: callInput.target,
      timeoutMs,
    };
  }
  try {
    const initializeId = 101;
    const initializeResponse = await call(
      remaining(input),
      initializeId,
      "initialize",
      {
        capabilities: {},
        clientInfo: { name: "talent-signal", version: "1.0.0" },
        protocolVersion: MCP_SUPPORTED_PROTOCOL_VERSIONS[0],
      },
      null,
      null,
    );
    if (initializeResponse.status === 401) {
      return toolCallFailure("MCP_REQUIRES_AUTH", false, "unauthorized");
    }
    if (initializeResponse.status === 403) {
      return toolCallFailure("MCP_UNAUTHORIZED", false, "unauthorized");
    }
    if (initializeResponse.status >= 400) {
      return toolCallFailure("MCP_HANDSHAKE_FAILED", false);
    }
    const initialize = decodeJsonRpcResponse(initializeResponse, initializeId);
    if (initialize.hasError) return toolCallFailure("MCP_HANDSHAKE_FAILED", false);
    const protocolVersion =
      initialize.result &&
      typeof initialize.result === "object" &&
      typeof (initialize.result as { protocolVersion?: unknown }).protocolVersion ===
        "string"
        ? (initialize.result as { protocolVersion: string }).protocolVersion
        : null;
    if (
      !protocolVersion ||
      !(MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(
        protocolVersion,
      )
    ) {
      return toolCallFailure("MCP_PROTOCOL_UNSUPPORTED", false);
    }
    const sessionId =
      typeof initializeResponse.headers["mcp-session-id"] === "string"
        ? initializeResponse.headers["mcp-session-id"]
        : Array.isArray(initializeResponse.headers["mcp-session-id"])
          ? initializeResponse.headers["mcp-session-id"][0] ?? null
          : null;

    await notifyInitialized(remaining(input), sessionId, protocolVersion);

    // Discover the tool with the same bounded pagination as the handshake so
    // the execution targets exactly the advertised tool name.
    let found = false;
    let cursor: string | null = null;
    const cursors = new Set<string>();
    for (let page = 0; page < MCP_MAX_TOOL_PAGES; page += 1) {
      const response = await call(
        remaining(input),
        102 + page,
        "tools/list",
        cursor ? { cursor } : {},
        sessionId,
        protocolVersion,
      );
      if (response.status === 401) {
        return toolCallFailure("MCP_REQUIRES_AUTH", false, "unauthorized");
      }
      if (response.status >= 400) {
        return toolCallFailure("MCP_HANDSHAKE_FAILED", false);
      }
      const decoded = decodeJsonRpcResponse(response, 102 + page);
      if (decoded.hasError) return toolCallFailure("MCP_HANDSHAKE_FAILED", false);
      const result = decoded.result as
        | { nextCursor?: unknown; tools?: unknown }
        | undefined;
      if (!Array.isArray(result?.tools)) {
        return toolCallFailure("MCP_RESPONSE_INVALID", false);
      }
      for (const raw of result.tools) {
        const tool = normalizeTool(raw, input.bearerSecret);
        if (tool?.name === input.toolName) found = true;
      }
      if (typeof result?.nextCursor === "string" && result.nextCursor) {
        if (page === MCP_MAX_TOOL_PAGES - 1 || cursors.has(result.nextCursor)) {
          return toolCallFailure("MCP_TOO_MANY_TOOLS", false);
        }
        cursors.add(result.nextCursor);
        cursor = result.nextCursor;
      } else {
        cursor = null;
        break;
      }
    }
    if (!found) return toolCallFailure("MCP_HANDSHAKE_FAILED", false);

    const exchange = input.exchange ?? mcpPinnedExchange;
    const callId = 201;
    const response = await exchange({
      allowInsecureTls: input.allowInsecureTls === true,
      body: JSON.stringify({
        id: callId,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: input.arguments, name: input.toolName },
      }),
      expectedJsonRpcId: callId,
      headers: {
        ...agentHeaders(remaining(input)),
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        "mcp-protocol-version": protocolVersion,
      },
      maxBytes: MCP_RESPONSE_MAX_BYTES,
      method: "POST",
      onRequestSent: () => {
        effectSent = true;
      },
      target: input.target,
      timeoutMs: Math.max(0, deadline - Date.now()),
    });
    if (response.status === 401) {
      return toolCallFailure("MCP_UNAUTHORIZED", effectSent, "unauthorized");
    }
    if (response.status >= 500) {
      // A lost or failed upstream reply after dispatch cannot prove the effect
      // did not happen; it is unknown and never blindly retried.
      return toolCallFailure(
        "MCP_HANDSHAKE_FAILED",
        effectSent,
        effectSent ? "outcome_unknown" : "failed",
      );
    }
    if (response.status >= 400) {
      return toolCallFailure("MCP_HANDSHAKE_FAILED", effectSent);
    }
    let decoded: { hasError: boolean; result?: unknown };
    try {
      decoded = decodeJsonRpcResponse(response, callId);
    } catch {
      return toolCallFailure(
        "MCP_RESPONSE_INVALID",
        effectSent,
        effectSent ? "outcome_unknown" : "failed",
      );
    }
    if (decoded.hasError) {
      return {
        effectSent,
        errorCode: "MCP_HANDSHAKE_FAILED",
        isError: false,
        jsonrpcError: true,
        protocolVersion,
        resultText: null,
        status: "failed",
      };
    }
    const toolResult = decoded.result as { isError?: unknown; content?: unknown } | undefined;
    const isError = toolResult?.isError === true;
    return {
      effectSent,
      errorCode: isError ? "MCP_HANDSHAKE_FAILED" : null,
      isError,
      jsonrpcError: false,
      protocolVersion,
      resultText: toolResultText(decoded.result),
      status: isError ? "failed" : "succeeded",
    };
  } catch (error) {
    if (error instanceof McpUrlRejectedError) {
      const code: McpConnectionErrorCode =
        error.code === "MCP_DNS_UNAVAILABLE"
          ? "MCP_DNS_UNAVAILABLE"
          : "MCP_ENDPOINT_REJECTED";
      return toolCallFailure(code, effectSent);
    }
    if (error instanceof McpTransportError) {
      const known: McpConnectionErrorCode[] = [
        "MCP_DNS_UNAVAILABLE",
        "MCP_REDIRECT_REFUSED",
        "MCP_TIMEOUT",
        "MCP_RESPONSE_TOO_LARGE",
        "MCP_RESPONSE_INVALID",
        "MCP_HANDSHAKE_FAILED",
        "MCP_UNAUTHORIZED",
      ];
      const code = known.includes(error.code as McpConnectionErrorCode)
        ? (error.code as McpConnectionErrorCode)
        : "MCP_HANDSHAKE_FAILED";
      // After the tools/call body was sent the effect may have been applied;
      // an unreadable outcome is never retried and never reported as failure.
      const unknown =
        effectSent &&
        (code === "MCP_TIMEOUT" ||
          code === "MCP_HANDSHAKE_FAILED" ||
          code === "MCP_RESPONSE_INVALID" ||
          code === "MCP_RESPONSE_TOO_LARGE");
      return toolCallFailure(code, effectSent, unknown ? "outcome_unknown" : "failed");
    }
    return toolCallFailure("MCP_HANDSHAKE_FAILED", effectSent);
  }
}

/**
 * Runs the full handshake. Any protocol, auth, network, or schema failure is
 * returned as a non-verified result; the caller must not persist it as
 * connected.
 */
export async function performMcpHandshake(
  input: McpHandshakeInput,
): Promise<McpHandshakeResult> {
  const deadline = Date.now() + (input.timeoutMs ?? MCP_REQUEST_TIMEOUT_MS);
  function remainingInput(): McpHandshakeInput {
    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0) throw new McpTransportError("MCP_TIMEOUT", MCP_ERROR_MESSAGES.MCP_TIMEOUT);
    return { ...input, timeoutMs };
  }
  try {
    const initializeId = 1;
    const initializeResponse = await call(
      remainingInput(),
      initializeId,
      "initialize",
      {
        capabilities: {},
        clientInfo: { name: "talent-signal", version: "1.0.0" },
        protocolVersion: MCP_SUPPORTED_PROTOCOL_VERSIONS[0],
      },
      null,
      null,
    );
    if (initializeResponse.status === 401) {
      return unauthorized("MCP_REQUIRES_AUTH");
    }
    if (initializeResponse.status === 403) {
      return unauthorized("MCP_UNAUTHORIZED");
    }
    if (initializeResponse.status >= 400) {
      return failure("MCP_HANDSHAKE_FAILED", initializeResponse.status);
    }
    const initialize = decodeJsonRpcResponse(initializeResponse, initializeId);
    if (initialize.hasError) {
      return failure("MCP_HANDSHAKE_FAILED");
    }
    const protocolVersion =
      initialize.result &&
      typeof initialize.result === "object" &&
      typeof (initialize.result as { protocolVersion?: unknown }).protocolVersion ===
        "string"
        ? (initialize.result as { protocolVersion: string }).protocolVersion
        : null;
    if (
      !protocolVersion ||
      !(MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(
        protocolVersion,
      )
    ) {
      return failure("MCP_PROTOCOL_UNSUPPORTED");
    }
    const sessionId =
      typeof initializeResponse.headers["mcp-session-id"] === "string"
        ? initializeResponse.headers["mcp-session-id"]
        : Array.isArray(initializeResponse.headers["mcp-session-id"])
          ? initializeResponse.headers["mcp-session-id"][0] ?? null
          : null;

    await notifyInitialized(remainingInput(), sessionId, protocolVersion);

    const tools: McpDiscoveredTool[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    const cursors = new Set<string>();
    for (let page = 0; page < MCP_MAX_TOOL_PAGES; page += 1) {
      const response = await call(
        remainingInput(),
        2 + page,
        "tools/list",
        cursor ? { cursor } : {},
        sessionId,
        protocolVersion,
      );
      if (response.status === 401) {
        return unauthorized("MCP_REQUIRES_AUTH");
      }
      if (response.status >= 400) {
        return failure("MCP_HANDSHAKE_FAILED", response.status);
      }
      const decoded = decodeJsonRpcResponse(response, 2 + page);
      if (decoded.hasError) {
        return failure("MCP_HANDSHAKE_FAILED");
      }
      const result = decoded.result as
        | { nextCursor?: unknown; tools?: unknown }
        | undefined;
      if (!Array.isArray(result?.tools)) return failure("MCP_RESPONSE_INVALID");
      const listed = result.tools;
      for (const raw of listed) {
        const tool = normalizeTool(raw, input.bearerSecret);
        if (!tool || seen.has(tool.name)) continue;
        seen.add(tool.name);
        tools.push(tool);
        if (tools.length > MCP_MAX_TOOLS) {
          return failure("MCP_TOO_MANY_TOOLS");
        }
      }
      if (Buffer.byteLength(JSON.stringify(tools), "utf8") > MCP_MAX_DIRECTORY_BYTES) {
        return failure("MCP_RESPONSE_TOO_LARGE");
      }
      if (typeof result?.nextCursor === "string" && result.nextCursor) {
        if (page === MCP_MAX_TOOL_PAGES - 1 || cursors.has(result.nextCursor)) return failure("MCP_TOO_MANY_TOOLS");
        cursors.add(result.nextCursor);
        cursor = result.nextCursor;
      } else {
        cursor = null;
        break;
      }
    }

    remainingInput();
    return {
      errorCode: null,
      errorMessage: null,
      protocolVersion,
      status: "verified",
      tools,
    };
  } catch (error) {
    if (error instanceof McpUrlRejectedError) {
      const code: McpConnectionErrorCode =
        error.code === "MCP_DNS_UNAVAILABLE"
          ? "MCP_DNS_UNAVAILABLE"
          : "MCP_ENDPOINT_REJECTED";
      return failure(code);
    }
    if (error instanceof McpTransportError) {
      const known: McpConnectionErrorCode[] = [
        "MCP_DNS_UNAVAILABLE",
        "MCP_REDIRECT_REFUSED",
        "MCP_TIMEOUT",
        "MCP_RESPONSE_TOO_LARGE",
        "MCP_RESPONSE_INVALID",
        "MCP_HANDSHAKE_FAILED",
        "MCP_UNAUTHORIZED",
      ];
      const code = known.includes(error.code as McpConnectionErrorCode)
        ? (error.code as McpConnectionErrorCode)
        : "MCP_HANDSHAKE_FAILED";
      return failure(code);
    }
    return failure("MCP_HANDSHAKE_FAILED");
  }
}
