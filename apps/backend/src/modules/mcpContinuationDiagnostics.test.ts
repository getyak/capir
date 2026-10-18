import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "./auth.js";
import {
  deliverMcpContinuation,
  MCP_CONTINUATION_ENQUEUE_FAILED,
  type McpInteractionContinuation,
  type McpInteractionDependencies,
} from "./mcpInteractions.js";

const accountId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const sessionId = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";

const auth = {
  accountId,
  accountSlug: "synthetic",
  userId,
  userEmail: "recruiter@example.test",
  userKind: "simulated_human",
  sessionId,
} as AuthContext;

function outboxRow() {
  return {
    account_id: accountId,
    created_by_user_id: userId,
    call_id: "synthetic-call",
    message_id: "50000000-0000-4000-8000-000000000001",
    idempotency_key: "mcp-cont-synthetic",
    body: "Continue the original task.",
    request_id: requestId,
    result_metadata: { choice: "accepted" },
    session_id: sessionId,
  };
}

function poolWith(
  dispatch: (sql: string, params: unknown[]) => Promise<unknown>,
): { pool: Pool; calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return dispatch(sql, params);
  });
  return { pool: { query } as unknown as Pool, calls };
}

describe("MCP durable continuation failure diagnostics", () => {
  it("keeps the row pending with the attempt increment and only the fixed error code", async () => {
    const failure = Object.assign(new Error("SECRET_CONTINUE_MESSAGE_CANARY"), {
      name: "SECRET_CONTINUE_NAME_CANARY",
      stack: "Error: SECRET_CONTINUE_MESSAGE_CANARY\n    at SECRET_CONTINUE_STACK_CANARY",
      cause: new Error("SECRET_CONTINUE_CAUSE_CANARY"),
    });
    const deliveries: McpInteractionContinuation[] = [];
    const dependencies = {
      continueConversation: vi.fn(async (input: McpInteractionContinuation) => {
        deliveries.push(input);
        throw failure;
      }),
    } as unknown as McpInteractionDependencies;
    const { pool, calls } = poolWith(async (sql) =>
      sql.includes("FROM mcp_continuation_outbox") ? { rows: [outboxRow()], rowCount: 1 } : { rows: [], rowCount: 0 },
    );

    await deliverMcpContinuation(pool, dependencies, auth, requestId);

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      sessionId,
      messageId: "50000000-0000-4000-8000-000000000001",
      idempotencyKey: "mcp-cont-synthetic",
      text: "Continue the original task.",
    });

    // The enqueue failure stays pending with attempts incremented and only the
    // fixed content-free code in last_error.
    const failureWrite = calls.find((call) => call.sql.includes("last_error = $3"));
    expect(failureWrite?.sql).toContain("attempts = attempts + 1");
    expect(failureWrite?.sql).toContain("state = 'pending'");
    expect(failureWrite?.sql).not.toContain("delivered");
    expect(failureWrite?.params).toEqual([accountId, requestId, MCP_CONTINUATION_ENQUEUE_FAILED]);
    expect(MCP_CONTINUATION_ENQUEUE_FAILED).toBe("MCP_CONTINUATION_ENQUEUE_FAILED");

    // No raw message, name, stack, cause, or code reaches any parameter.
    expect(JSON.stringify(calls)).not.toContain("CANARY");
    expect(calls.some((call) => call.sql.includes("state = 'delivered'"))).toBe(false);
  });

  it("lets recovery deliver exactly once and clear the fixed error", async () => {
    const deliveries: McpInteractionContinuation[] = [];
    const dependencies = {
      continueConversation: vi.fn(async (input: McpInteractionContinuation) => {
        deliveries.push(input);
      }),
    } as unknown as McpInteractionDependencies;
    let pending = true;
    const { pool, calls } = poolWith(async (sql) => {
      if (sql.includes("FROM mcp_continuation_outbox")) {
        return pending ? { rows: [outboxRow()], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("state = 'delivered'")) pending = false;
      return { rows: [], rowCount: 0 };
    });

    // Failed enqueue first: pending with the fixed code.
    const failing = {
      continueConversation: vi.fn(async () => {
        throw new Error("SECRET_RETRY_CANARY");
      }),
    } as unknown as McpInteractionDependencies;
    await deliverMcpContinuation(pool, failing, auth, requestId);
    expect(JSON.stringify(calls)).not.toContain("CANARY");

    // Recovery delivers the stored result exactly once and marks delivered
    // only while the row is still pending.
    await deliverMcpContinuation(pool, dependencies, auth, requestId);
    await deliverMcpContinuation(pool, dependencies, auth, requestId);

    expect(deliveries).toHaveLength(1);
    const deliveredWrite = calls.find((call) => call.sql.includes("state = 'delivered'"));
    expect(deliveredWrite?.sql).toContain("last_error = NULL");
    expect(deliveredWrite?.sql).toContain("attempts = attempts + 1");
    expect(deliveredWrite?.sql).toContain("state = 'pending'");
    expect(deliveredWrite?.params).toEqual([accountId, requestId]);
  });
});
