import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { CONTRACT_VERSION } from "@talent-signal/contracts";
import type { SourceAuthorizationDecisionResponse } from "@talent-signal/contracts";

import type { AuthContext } from "./auth.js";
import {
  RELATIONSHIP_WIKI_COMPILATION_FAILED,
  runPendingSourceAuthorizationCompilationJobs,
} from "./sourceAuthorization.js";

const accountId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const subjectId = "30000000-0000-4000-8000-000000000001";
const assignmentId = "40000000-0000-4000-8000-000000000001";
const captureId = "50000000-0000-4000-8000-000000000001";
const decisionId = "60000000-0000-4000-8000-000000000001";
const jobId = "70000000-0000-4000-8000-000000000001";
const idempotencyRecordId = "80000000-0000-4000-8000-000000000001";
const workerId = "synthetic-compile-worker";

function responseBody(): SourceAuthorizationDecisionResponse {
  return {
    contract_version: CONTRACT_VERSION,
    decision_id: decisionId,
    root_capture_id: captureId,
    affected_capture_ids: [captureId],
    decision: "revoke",
    prior_authorization_state: "authorized",
    authorization_state: "revoked",
    authorization_expires_at: null,
    person_id: subjectId,
    relationship_context_id: assignmentId,
    root_capture_version: 2,
    states_retracted: 0,
    prior_states_reopened_for_review: 0,
    claims_reopened: 0,
    actions_revoked: 0,
    completed_actions_requiring_follow_up: 0,
    external_effects_requiring_follow_up: 0,
    identity_handles_returned_to_review: 0,
    knowledge_snapshots_invalidated: [],
    compilation: null,
    compilation_error: null,
    decided_at: "2026-08-07T00:00:00.000Z",
  };
}

function compilationJob() {
  return {
    id: jobId,
    account_id: accountId,
    account_slug: "synthetic",
    decision_id: decisionId,
    idempotency_record_id: idempotencyRecordId,
    requested_by_user_id: userId,
    user_email: "recruiter@example.test",
    subject_id: subjectId,
    assignment_id: assignmentId,
    transition_actor: "human",
    decision: "revoke",
    response_body: responseBody(),
    lease_owner: workerId,
  };
}

describe("source authorization compilation failure diagnostics", () => {
  it("keeps lease, idempotency, and retry correct while retaining only the fixed diagnostic", async () => {
    const canary = Object.assign(new Error("SECRET_COMPILE_MESSAGE_CANARY"), {
      name: "SECRET_COMPILE_NAME_CANARY",
      stack: "Error: SECRET_COMPILE_MESSAGE_CANARY\n    at SECRET_COMPILE_STACK_CANARY",
      cause: new Error("SECRET_COMPILE_CAUSE_CANARY"),
    });
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    let claims = 0;
    const dispatch = async (sql: string, params: unknown[] = []): Promise<unknown> => {
      calls.push({ sql, params });
      if (sql.includes("WITH candidate AS")) {
        claims += 1;
        return claims === 1
          ? { rows: [compilationJob()], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO idempotency_records")) {
        // The Wiki recompilation fails on its first durable step with raw
        // private exception content.
        throw canary;
      }
      if (sql.includes("source_authorization_compilation_jobs") && sql.includes("RETURNING id")) {
        return { rows: [{ id: jobId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => dispatch(sql, params)),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => dispatch(sql, params)),
      connect: vi.fn(async () => client),
    } as unknown as Pool;

    const result = await runPendingSourceAuthorizationCompilationJobs(pool, {
      workerId,
    });

    expect(result).toEqual({ claimed: 1, completed: 0, retried: 1 });

    // Job row: retry with the lease released and only the fixed diagnostic in
    // last_error; the idempotency response keeps compilation null and the same
    // fixed error so recovery can recompile.
    const jobWrite = calls.find(
      (call) => call.sql.includes("source_authorization_compilation_jobs") && call.sql.includes("RETURNING id"),
    );
    expect(jobWrite?.sql).toContain("lease_owner = $2");
    expect(jobWrite?.params).toEqual([
      idempotencyRecordId,
      workerId,
      false,
      true,
      null,
      RELATIONSHIP_WIKI_COMPILATION_FAILED,
    ]);
    const recordWrite = calls.find(
      (call) => call.sql.includes("UPDATE idempotency_records") && call.sql.includes("response_body"),
    );
    expect(recordWrite?.params).toEqual([
      idempotencyRecordId,
      expect.objectContaining({
        compilation: null,
        compilation_error: RELATIONSHIP_WIKI_COMPILATION_FAILED,
      }),
    ]);

    // No raw message, name, stack, cause, or code reaches any parameter.
    expect(RELATIONSHIP_WIKI_COMPILATION_FAILED).toBe(
      "Relationship Wiki recompilation failed.",
    );
    for (const canaryPart of [
      "SECRET_COMPILE_MESSAGE_CANARY",
      "SECRET_COMPILE_NAME_CANARY",
      "SECRET_COMPILE_STACK_CANARY",
      "SECRET_COMPILE_CAUSE_CANARY",
    ]) {
      expect(JSON.stringify(calls)).not.toContain(canaryPart);
    }
  });

  it("maps a typed non-Error throw to the same fixed diagnostic", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    let claims = 0;
    const dispatch = async (sql: string, params: unknown[] = []): Promise<unknown> => {
      calls.push({ sql, params });
      if (sql.includes("WITH candidate AS")) {
        claims += 1;
        return claims === 1
          ? { rows: [compilationJob()], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO idempotency_records")) {
        throw "SECRET_STRING_THROW_CANARY";
      }
      if (sql.includes("source_authorization_compilation_jobs") && sql.includes("RETURNING id")) {
        return { rows: [{ id: jobId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => dispatch(sql, params)),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => dispatch(sql, params)),
      connect: vi.fn(async () => client),
    } as unknown as Pool;

    await runPendingSourceAuthorizationCompilationJobs(pool, { workerId });
    const jobWrite = calls.find(
      (call) => call.sql.includes("source_authorization_compilation_jobs") && call.sql.includes("RETURNING id"),
    );
    expect(jobWrite?.params?.[5]).toBe(RELATIONSHIP_WIKI_COMPILATION_FAILED);
    expect(JSON.stringify(calls)).not.toContain("SECRET_STRING_THROW_CANARY");
  });
});
