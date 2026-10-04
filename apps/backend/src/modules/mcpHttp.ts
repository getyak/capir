import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

import type { McpResolvedTarget } from "./mcpSecurity.js";

/**
 * One bounded HTTPS exchange with a DNS-pinned public address.
 *
 * The pinned lookup ignores the hostname's current resolution, so a rebinding
 * answer after validation cannot redirect the request. Redirects are refused
 * because following one would leave the validated origin.
 */

export class McpTransportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "McpTransportError";
    this.code = code;
  }
}

export interface McpExchangeInput {
  allowInsecureTls?: boolean;
  body?: string;
  expectedJsonRpcId?: number | string | null;
  headers: Record<string, string>;
  maxBytes?: number;
  method: "GET" | "POST";
  /** Fires once the request body has been handed to the socket. */
  onRequestSent?: () => void;
  target: McpResolvedTarget;
  timeoutMs?: number;
}

export interface McpExchangeResponse {
  body: string;
  contentType: string;
  headers: http.IncomingHttpHeaders;
  status: number;
}

export const MCP_REQUEST_TIMEOUT_MS = 10_000;
export const MCP_RESPONSE_MAX_BYTES = 1_048_576;

function splitSseEvents(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  let rest = buffer;
  const separator = /\r?\n\r?\n/u;
  while (true) {
    const match = separator.exec(rest);
    if (!match || match.index === undefined) break;
    events.push(rest.slice(0, match.index));
    rest = rest.slice(match.index + match[0].length);
  }
  return { events, rest };
}

function eventData(event: string): string | null {
  const data = event
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).replace(/^ /u, ""));
  return data.length ? data.join("\n") : null;
}

function jsonRpcId(payload: string): unknown {
  try {
    const parsed = JSON.parse(payload) as { id?: unknown };
    return parsed.id;
  } catch {
    return undefined;
  }
}

export async function mcpPinnedExchange(
  input: McpExchangeInput,
): Promise<McpExchangeResponse> {
  const timeoutMs = input.timeoutMs ?? MCP_REQUEST_TIMEOUT_MS;
  const maxBytes = input.maxBytes ?? MCP_RESPONSE_MAX_BYTES;
  const target = input.target;
  const isHttps = target.url.protocol === "https:";

  return await new Promise<McpExchangeResponse>((resolve, reject) => {
    let settled = false;
    let rawBody = "";
    let sseBuffer = "";
    let responseContentType = "";

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      reject(error);
    };
    const succeed = (response: McpExchangeResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      resolve(response);
    };

    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (typeof options === "object" && options.all) {
        callback(null, [{ address: target.address, family: target.family }]);
        return;
      }
      callback(null, target.address, target.family);
    };

    const request = (isHttps ? https : http).request(
      {
        agent: false,
        headers: { host: target.url.host, ...input.headers },
        hostname: target.url.hostname,
        lookup,
        method: input.method,
        path: `${target.url.pathname}${target.url.search}`,
        port: target.url.port || (isHttps ? 443 : 80),
        protocol: target.url.protocol,
        ...(isHttps
          ? {
              rejectUnauthorized: !input.allowInsecureTls,
              servername: target.url.hostname,
            }
          : {}),
      },
      (response) => {
        responseContentType = String(response.headers["content-type"] ?? "");
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          fail(
            new McpTransportError(
              "MCP_REDIRECT_REFUSED",
              "The MCP server tried to redirect the request.",
            ),
          );
          return;
        }
        const isSse = responseContentType
          .toLowerCase()
          .includes("text/event-stream");

        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (settled) return;
          if (rawBody.length + chunk.length > maxBytes) {
            fail(
              new McpTransportError(
                "MCP_RESPONSE_TOO_LARGE",
                "The MCP server response exceeded the size limit.",
              ),
            );
            return;
          }
          rawBody += chunk;
          if (!isSse) return;
          sseBuffer += chunk;
          const { events, rest } = splitSseEvents(sseBuffer);
          sseBuffer = rest;
          for (const event of events) {
            const data = eventData(event);
            if (data === null) continue;
            const id = jsonRpcId(data);
            if (
              input.expectedJsonRpcId !== null &&
              input.expectedJsonRpcId !== undefined &&
              String(id) === String(input.expectedJsonRpcId)
            ) {
              succeed({
                body: data,
                contentType: responseContentType,
                headers: response.headers,
                status,
              });
              return;
            }
          }
        });
        response.on("end", () => {
          if (settled) return;
          succeed({
            body: rawBody,
            contentType: responseContentType,
            headers: response.headers,
            status,
          });
        });
        response.on("error", () => {
          fail(
            new McpTransportError(
              "MCP_HANDSHAKE_FAILED",
              "The MCP exchange could not be completed.",
            ),
          );
        });
      },
    );

    const timer = setTimeout(() => {
      fail(
        new McpTransportError(
          "MCP_TIMEOUT",
          "The MCP server did not respond within the timeout.",
        ),
      );
    }, timeoutMs);

    request.on("error", (error) => {
      if (settled) return;
      const code =
        (error as NodeJS.ErrnoException).code === "ENOTFOUND" ||
        (error as NodeJS.ErrnoException).code === "EAI_AGAIN"
          ? "MCP_DNS_UNAVAILABLE"
          : "MCP_HANDSHAKE_FAILED";
      // The OS exception text is never surfaced or persisted.
      fail(
        new McpTransportError(
          code,
          code === "MCP_DNS_UNAVAILABLE"
            ? "The MCP server hostname could not be resolved."
            : "The MCP connection could not be completed.",
        ),
      );
    });

    if (input.body !== undefined) {
      request.write(input.body);
    }
    request.end();
    // The effect leg now owns a possible external outcome: every later
    // unreadable failure must be treated as outcome_unknown by callers.
    input.onRequestSent?.();
  });
}
