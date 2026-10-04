import { randomUUID } from "node:crypto";

import type {
  McpInteractionRequest,
  McpToolCallReceipt,
} from "@talent-signal/contracts";
import type { Pool } from "pg";

import { ApiError } from "../lib/apiError.js";
import { sha256Hex } from "./mcpSchema.js";
import {
  listMcpInteractions,
  mcpInteractionDependencies,
  proposeMcpChoice,
  proposeMcpConnection,
  proposeMcpToolCall,
  readMcpInteraction,
  readMcpToolCallReceipt,
  type McpChoiceOptionInput,
  type McpInteractionDependencies,
  type McpStagingAuthority,
} from "./mcpInteractions.js";
import {
  connectMcpConnection,
  listMcpConnections,
  type McpInboundDependencies,
} from "./mcpConnections.js";
import type { AuthContext } from "./auth.js";

/**
 * Host-side `mcp_connections` adapter for the ordinary workspace Agent.
 *
 * The model can list account-owned connections, stage connection and exact
 * tool-call proposals, and read approved receipts. Staging creates a durable
 * human request; nothing executes and no secret ever reaches the model, the
 * conversation, or any log. The human's exact approval in the request card is
 * the only execution authority.
 */

export interface WorkspaceMcpConnectionsResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface WorkspaceMcpConnections {
  handle(
    input: Record<string, unknown>,
  ): Promise<WorkspaceMcpConnectionsResult>;
}

export interface WorkspaceMcpConnectionsOptions {
  pool: Pool;
  auth: AuthContext;
  sessionID: string | null;
  messageID: string;
  dependencies?: McpInteractionDependencies;
  /** Live queue run claim; the only way host staging mints authority. */
  authority?: McpStagingAuthority;
}

function failure(code: string, message: string): WorkspaceMcpConnectionsResult {
  return { ok: false, error: { code, message } };
}

function requestSummary(request: McpInteractionRequest): Record<string, unknown> {
  return {
    call_id: request.call_id,
    expires_at: request.expires_at,
    kind: request.kind,
    purpose: request.purpose,
    request_id: request.id,
    state: request.state,
    target: {
      connection_id: request.target.connection_id,
      connection_label: request.target.connection_label,
      server_origin: request.target.server_origin,
      tool_name: request.target.tool_name,
    },
  };
}

function receiptSummary(receipt: McpToolCallReceipt): Record<string, unknown> {
  return {
    call_id: receipt.call_id,
    error_code: receipt.error_code,
    executed_at: receipt.executed_at,
    is_error: receipt.is_error,
    outcome: receipt.outcome,
    request_id: receipt.request_id,
    result_summary: receipt.result_summary,
    // Already redacted and bounded at settlement (24k). The display summary
    // is not the complete result and cannot answer questions beyond its cut.
    result_json: receipt.result_json,
    server_origin: receipt.server_origin,
    tool_name: receipt.tool_name,
  };
}

function deterministicKey(prefix: string, parts: readonly unknown[]): string {
  return `${prefix}-${sha256Hex(JSON.stringify([prefix, ...parts])).slice(0, 64)}`.slice(0, 128);
}

export function createWorkspaceMcpConnections(
  options: WorkspaceMcpConnectionsOptions,
): WorkspaceMcpConnections {
  const dependencies =
    options.dependencies ?? mcpInteractionDependencies();
  return {
    async handle(input) {
      const operation = input.operation;
      try {
        if (operation === "list") {
          const [connections, requests] = await Promise.all([
            listMcpConnections(options.pool, options.auth),
            listMcpInteractions(options.pool, options.auth, {
              sessionId: options.sessionID,
            }),
          ]);
          return {
            ok: true,
            data: {
              connections: connections.connections.map((connection) => ({
                auth_mode: connection.auth_mode,
                id: connection.id,
                friendly_name: connection.friendly_name,
                server_url: connection.server_url,
                status: connection.status,
                tools: connection.tools.slice(0, 30).map((tool) => ({
                  description: tool.description.slice(0, 400),
                  input_schema: tool.input_schema
                    ? JSON.stringify(
                        // Inert metadata; secret-shaped content is redacted
                        // before anything reaches the model.
                        redactSchemaForModel(tool.input_schema),
                      ).slice(0, 4_000)
                    : null,
                  name: tool.name,
                  read_only: tool.read_only,
                })),
              })),
              pending_requests: requests.requests
                .filter((request) => request.state === "pending" || request.state === "waiting")
                .slice(0, 20)
                .map(requestSummary),
              recent_requests: requests.requests.slice(0, 20).map(requestSummary),
            },
          };
        }
        if (operation === "propose_add") {
          const authMode = input.auth_mode;
          const friendlyName = input.friendly_name;
          const serverUrl = input.server_url;
          const purpose = input.purpose;
          if (
            (authMode !== "anonymous" && authMode !== "bearer" && authMode !== "oauth") ||
            typeof friendlyName !== "string" ||
            typeof serverUrl !== "string" ||
            typeof purpose !== "string"
          ) {
            return failure(
              "TOOL_INPUT_INVALID",
              "propose_add needs auth_mode, friendly_name, server_url and purpose.",
            );
          }
          const staged = await proposeMcpConnection(
            options.pool,
            options.auth,
            {
              auth_mode: authMode,
              ...(input.directory_entry_id
                ? { directory_entry_id: String(input.directory_entry_id) }
                : {}),
              friendly_name: friendlyName,
              idempotency_key: deterministicKey("mcpadd", [
                options.messageID,
                authMode,
                friendlyName,
                serverUrl,
                purpose,
              ]),
              message_id: options.messageID,
              purpose,
              server_url: serverUrl,
              ...(options.sessionID ? { session_id: options.sessionID } : {}),
            },
            dependencies,
            options.authority,
          );
          return {
            ok: true,
            data: {
              note: "The connection is not added yet. The user must approve it in the request card; continue the original task and reference this request.",
              ...requestSummary(staged.request),
            },
          };
        }
        if (operation === "propose_call") {
          const connectionId = input.connection_id;
          const toolName = input.tool_name;
          const args = input.arguments;
          const purpose = input.purpose;
          if (
            typeof connectionId !== "string" ||
            typeof toolName !== "string" ||
            typeof args !== "string" ||
            typeof purpose !== "string"
          ) {
            return failure(
              "TOOL_INPUT_INVALID",
              "propose_call needs connection_id, tool_name, arguments (JSON object string) and purpose.",
            );
          }
          const staged = await proposeMcpToolCall(
            options.pool,
            options.auth,
            {
              arguments: args,
              connection_id: connectionId,
              idempotency_key: deterministicKey("mcpcall", [
                options.messageID,
                connectionId,
                toolName,
                args,
                purpose,
              ]),
              message_id: options.messageID,
              purpose,
              ...(options.sessionID ? { session_id: options.sessionID } : {}),
              tool_name: toolName,
            },
            dependencies,
            options.authority,
          );
          return {
            ok: true,
            data: {
              note: "No tool has run. The user must approve this exact call in the request card; the approved receipt will return to this conversation.",
              ...requestSummary(staged.request),
            },
          };
        }
        if (operation === "connect") {
          const connectionId = input.connection_id;
          if (typeof connectionId !== "string") {
            return failure("TOOL_INPUT_INVALID", "connect needs connection_id.");
          }
          const current = (await listMcpConnections(options.pool, options.auth)).connections.find(
            (connection) => connection.id === connectionId,
          );
          if (!current) {
            return failure("MCP_CALL_TARGET_NOT_FOUND", "This connection no longer exists.");
          }
          const inbound: McpInboundDependencies = {
            allowInsecureTls: dependencies.allowInsecureTls === true,
            allowedOrigins: dependencies.allowedOrigins ?? [],
            encryptionKey: dependencies.encryptionKey ?? null,
            ...(dependencies.exchange ? { exchange: dependencies.exchange } : {}),
            ...(dependencies.resolver ? { resolver: dependencies.resolver } : {}),
          };
          const checked = await connectMcpConnection(
            options.pool,
            options.auth,
            connectionId,
            {
              expected_revision: current.revision,
              idempotency_key: deterministicKey("mcpconnect", [
                options.messageID,
                connectionId,
                current.revision,
              ]),
            },
            inbound,
          );
          return {
            ok: true,
            data: {
              auth_mode: checked.connection.auth_mode,
              connection_id: checked.connection.id,
              friendly_name: checked.connection.friendly_name,
              server_url: checked.connection.server_url,
              status: checked.connection.status,
              tools: checked.connection.tools.slice(0, 30).map((tool) => ({
                description: tool.description.slice(0, 400),
                name: tool.name,
                read_only: tool.read_only,
              })),
            },
          };
        }
        if (operation === "propose_choice") {
          const purpose = input.purpose;
          const rawOptions = input.options;
          if (typeof purpose !== "string" || typeof rawOptions !== "string") {
            return failure(
              "TOOL_INPUT_INVALID",
              "propose_choice needs purpose and options as a JSON array of {id,label,description?}.",
            );
          }
          let parsedOptions: unknown;
          try {
            parsedOptions = JSON.parse(rawOptions);
          } catch {
            return failure("TOOL_INPUT_INVALID", "options must be a JSON array.");
          }
          if (!Array.isArray(parsedOptions)) {
            return failure("TOOL_INPUT_INVALID", "options must be a JSON array.");
          }
          const options_list: McpChoiceOptionInput[] = parsedOptions.flatMap((item) => {
            const value = item as Record<string, unknown>;
            if (typeof value?.id !== "string" || typeof value?.label !== "string") return [];
            return [
              {
                ...(typeof value.description === "string"
                  ? { description: value.description }
                  : {}),
                id: value.id,
                label: value.label,
              },
            ];
          });
          const staged = await proposeMcpChoice(
            options.pool,
            options.auth,
            {
              idempotency_key: deterministicKey("mcpchoice", [
                options.messageID,
                purpose,
                rawOptions,
              ]),
              message_id: options.messageID,
              options: options_list,
              purpose,
              ...(options.sessionID ? { session_id: options.sessionID } : {}),
            },
            dependencies,
            options.authority,
          );
          return {
            ok: true,
            data: {
              note: "No decision was made. The user selects one option in the request card and the selection returns to this conversation.",
              ...requestSummary(staged.request),
            },
          };
        }
        if (operation === "read_receipt") {
          const callId = input.call_id;
          const requestId = input.request_id;
          if (typeof callId === "string") {
            const receipt = await readMcpToolCallReceipt(options.pool, options.auth, callId);
            if (!receipt) {
              return failure("MCP_RECEIPT_NOT_FOUND", "No approved receipt exists for this call_id.");
            }
            return { ok: true, data: { receipt: receiptSummary(receipt) } };
          }
          if (typeof requestId === "string") {
            const request = await readMcpInteraction(options.pool, options.auth, requestId);
            return {
              ok: true,
              data: {
                receipt: request.request.receipt
                  ? receiptSummary(request.request.receipt)
                  : null,
                request: requestSummary(request.request),
              },
            };
          }
          return failure("TOOL_INPUT_INVALID", "read_receipt needs call_id or request_id.");
        }
        return failure("TOOL_INPUT_INVALID", "Unknown mcp_connections operation.");
      } catch (error) {
        if (error instanceof ApiError) {
          return failure(error.code, error.message);
        }
        return failure(
          "MCP_INTERACTIONS_UNAVAILABLE",
          "The MCP interaction service is unavailable in this run.",
        );
      }
    },
  };
}

function redactSchemaForModel(schemaText: string): unknown {
  try {
    return redactJsonish(JSON.parse(schemaText));
  } catch {
    return "[unavailable]";
  }
}

function redactJsonish(value: unknown): unknown {
  // Kept local to avoid importing the backend redaction into agent-visible
  // strings twice; secret-shaped keys are dropped entirely for the model.
  if (Array.isArray(value)) return value.map(redactJsonish);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = /password|secret|token|api_?key|credential|authorization|passphrase/iu.test(key)
        ? "[redacted]"
        : redactJsonish(item);
    }
    return output;
  }
  return value;
}

export function newMcpInteractionRequestId(): string {
  return randomUUID();
}
