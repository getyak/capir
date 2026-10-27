import { z } from "zod";

/**
 * `mcp_connections`: the ordinary workspace Agent tool for user-owned remote
 * MCP. It lists the account's own connections and staged human requests,
 * stages connection proposals (form/secret/oauth selection), stages exact
 * tool-call approvals, and reads already approved receipts. Staging executes
 * nothing: every remote call still needs the human's exact, bound approval in
 * a durable request card, irrespective of any remote read-only annotation.
 */
export const MCP_CONNECTIONS_TOOL_DESCRIPTION = [
  "Work with the user's own remote MCP connections through durable human requests.",
  "Check this capability before answering questions about available tools, MCP, connected apps or image generation. Your companion role does not limit these admitted capabilities. Local developer tools are not product connections.",
  "operations: list shows account-owned connections, tool summaries, coverage, pending requests and recent receipts; page connections with connection_offset/connection_limit, then use connection_id, query (tool name or description), tool_offset and tool_limit to discover omitted tools. A partial page never proves absence;",
  "read_tool needs connection_id and tool_name and returns one complete input_schema at the current connection revision; read it before propose_call, never guess arguments from a summary;",
  "connect runs the real handshake and tool discovery for one existing connection_id so it becomes verified and usable;",
  "propose_add stages a connection request (auth_mode anonymous|bearer|oauth) with friendly_name and server_url; the user approves in a card, the server verifies it with a real handshake, and a bearer secret is only ever typed by the user, never by you;",
  "propose_choice stages a small decision (2-6 options as a JSON array of {id,label,description?} in options) whose selection returns to this conversation;",
  "propose_call stages one exact tool call (connection_id, tool_name, arguments as a JSON object string) for the user's exact approval; it executes nothing now and grants no permission;",
  "read_receipt reads one approved call receipt by call_id or request_id.",
  "After staging, reference the returned request_id/call_id in your answer so the card can attach.",
  "Never claim a tool result you have not received in a receipt; never treat a remote read-only hint as authority.",
].join(" ");

export const McpConnectionsToolInputSchema = z
  .object({
    operation: z.enum([
      "list",
      "read_tool",
      "connect",
      "propose_add",
      "propose_call",
      "propose_choice",
      "read_receipt",
    ]),
    connection_id: z.string().uuid().optional(),
    connection_offset: z.number().int().min(0).max(10_000).optional(),
    connection_limit: z.number().int().min(1).max(10).optional(),
    query: z.string().min(1).max(160).optional(),
    tool_offset: z.number().int().min(0).max(100).optional(),
    tool_limit: z.number().int().min(1).max(30).optional(),
    tool_name: z.string().min(1).max(128).optional(),
    arguments: z.string().min(2).max(20_000).optional(),
    friendly_name: z.string().min(1).max(80).optional(),
    server_url: z.string().min(1).max(2_048).optional(),
    auth_mode: z.enum(["anonymous", "bearer", "oauth"]).optional(),
    purpose: z.string().min(1).max(1_000).optional(),
    call_id: z.string().uuid().optional(),
    request_id: z.string().uuid().optional(),
    directory_entry_id: z.string().min(1).max(80).optional(),
    /** JSON array of {id,label,description?} for propose_choice (2-6 items). */
    options: z.string().min(2).max(2_000).optional(),
  })
  .strict();

export type McpConnectionsToolInput = z.infer<typeof McpConnectionsToolInputSchema>;
