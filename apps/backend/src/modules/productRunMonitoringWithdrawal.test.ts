import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "./auth.js";
import { registerProductRunMonitoring } from "./productRuns.js";

describe("Lab withdrawal while serializing a rejected product response", () => {
  it.each([
    { kind: "lab_human", status: 409, code: "P0001", message: "LAB_TEST_WORKSPACE_CLOSED", retained: true },
    { kind: "password_human", status: 409, code: "P0001", message: "LAB_TEST_WORKSPACE_CLOSED", retained: false },
    { kind: "lab_human", status: 201, code: "P0001", message: "LAB_TEST_WORKSPACE_CLOSED", retained: false },
    { kind: "lab_human", status: 409, code: "P0001", message: "OTHER_DATABASE_FAILURE", retained: false },
    { kind: "lab_human", status: 409, code: "OTHER", message: "LAB_TEST_WORKSPACE_CLOSED", retained: false },
  ] as const)("preserves only an already rejected Lab response: $kind/$status/$code/$message", async scenario => {
    const id = randomUUID();
    let rollbacks = 0, releases = 0, writes = 0, flushProbes = 0;
    const query = async (sql: string) => {
      if (sql.startsWith("INSERT INTO product_runs(")) return { rows: [{ source_generation: "1" }] };
      if (sql.startsWith("SELECT id,task_id,task_kind,")) return { rows: [{ id, task_id: null, task_kind: "conversation", revision: 0 }] };
      if (sql.startsWith("UPDATE product_runs SET task_id=")) {
        writes += 1;
        throw Object.assign(new Error(scenario.message), { code: scenario.code });
      }
      if (sql === "ROLLBACK") rollbacks += 1;
      if (sql.includes("SELECT product_run_source_available(r.id)")) flushProbes += 1;
      return { rows: [] };
    };
    const client = { query, release() { releases += 1; } };
    const pool = { query, async connect() { return client; } } as unknown as Pool;
    const app = Fastify();
    app.setErrorHandler((_error, _request, reply) => reply.status(500).send({ error: { code: "MONITOR_FAILED" } }));
    const authenticate = async (request: import("fastify").FastifyRequest) => {
      request.auth = { accountId: randomUUID(), userId: randomUUID(), sessionId: randomUUID(), userKind: scenario.kind } as AuthContext;
    };
    registerProductRunMonitoring(app, pool, authenticate);
    const original = { error: { code: "LEGACY_CHAT_AUTHORITY_UNAVAILABLE" } };
    app.post("/v1/chat/unscoped-tasks", { preHandler: authenticate }, async (_request, reply) => reply.status(scenario.status).send(original));
    try {
      const result = await app.inject({ method: "POST", url: "/v1/chat/unscoped-tasks", payload: { objective: "Synthetic withdrawal" } });
      expect(writes).toBe(1);
      expect(rollbacks).toBe(1);
      if (scenario.retained) {
        expect(result.statusCode).toBe(409);
        expect(result.json()).toEqual(original);
        expect(flushProbes).toBe(1);
        expect(releases).toBe(2);
      } else {
        expect(result.statusCode).toBe(500);
        expect(result.json()).toEqual({ error: { code: "MONITOR_FAILED" } });
        expect(flushProbes).toBe(0);
        expect(releases).toBe(1);
      }
    } finally { await app.close(); }
  });
});
